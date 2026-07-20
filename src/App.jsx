import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

/* ============================================================
   SOLARPOTENZIAL-RECHNER GEMEINDE RISCH · Verein Elektrisch
   Version 2 – mit automatischer Datenanbindung an den
   «Energie Reporter» (geoimpact AG / EnergieSchweiz, CC BY 4.0).

   Beim Laden versucht die Seite, die offenen Datensätze
   abzurufen und die Werte für Risch (BFS-Nr. 1707) live zu
   aktualisieren. Gelingt das nicht (z.B. Vorschau-Sandbox oder
   CORS), rechnet sie mit den eingebetteten Werten weiter.

   Hinweis für den Betrieb auf der Vereins-Website:
   Blockiert der Browser die Direktabfrage (CORS), die beiden
   URLs unten auf einen eigenen kleinen Proxy zeigen lassen
   (z.B. Cloudflare Worker, der die ZIPs 1:1 durchreicht).
   ============================================================ */

const LIVE = {
  bfsNr: 1707,
  // Reihenfolge: 1. eigener Proxy (gleiche Domain, kein CORS-Problem),
  // 2. Direktabruf bei geoimpact (falls deren Server CORS erlaubt).
  latestUrls: [
    "/api/energiereporter.php?file=latest",
    "https://opendata.geoimpact.ch/energiereporter/energyreporter_latest.zip",
  ],
  historizedUrls: [
    "/api/energiereporter.php?file=historized",
    "https://opendata.geoimpact.ch/energiereporter/energyreporter_historized.zip",
  ],
};

/* ---------- Eingebettete Basisdaten (Fallback) ---------- */
const D = {
  potenzialDachGWh: 64.6,      // BFE Sonnendach, Ausgabe 2025, nur Dächer
  potenzialFassadeGWh: 88.83,  // BFE 2025, Dächer + Fassaden
  ertragKWhProKWp: 950,        // spezifischer Ertrag Mittelland (±10 %)
  heuteAnteilPct: 11,          // genutzter Anteil Dachpotenzial (Schätzung 2026)
  stromHeuteGWh: 70,           // Strom inkl. Wärmepumpen, Boiler, E-Autos
  endenergieGWh: 290,          // gesamter Endenergieverbrauch 2021
  elektrifiziertGWh: 120,      // Modell: alles elektrisch (WP JAZ 3, E-Auto Faktor 3)
  sommertagKWhProKWp: 5.5,     // Ertrag an einem wolkenlosen Sommertag
  einwohner: 12000,
  eivFoerderung: 0.15,         // Einmalvergütung Bund, grober Durchschnitt
};

const PRICE = {
  guenstig: { klein: 1800, gross: 950, label: "günstig" },
  mittel: { klein: 2300, gross: 1150, label: "mittel" },
  hoch: { klein: 2800, gross: 1400, label: "konservativ" },
};

// Rückrechnung anhand des schweizweiten Wachstums (wird durch Live-Daten ersetzt)
const HISTORY_EST = [
  { jahr: 2015, gwh: 1.5 }, { jahr: 2016, gwh: 1.9 }, { jahr: 2017, gwh: 2.3 },
  { jahr: 2018, gwh: 2.8 }, { jahr: 2019, gwh: 3.3 }, { jahr: 2020, gwh: 3.9 },
  { jahr: 2021, gwh: 4.5 }, { jahr: 2022, gwh: 5.2 }, { jahr: 2023, gwh: 5.9 },
  { jahr: 2024, gwh: 6.6 }, { jahr: 2025, gwh: 7.1 }, { jahr: 2026, gwh: 7.8 },
];

const VERBRAUCH = [
  {
    name: "Mobilität", total: 130, erneuerbar: 6,
    detail: "Auto, Lieferwagen, Bahn, Flugreisen ab CH",
    hinweis: "87 % der Autos fahren fossil (Stand 2021)",
  },
  {
    name: "Wärme", total: 118, erneuerbar: 50,
    detail: "Heizen und Warmwasser in Häusern und Betrieben",
    hinweis: "49 % Heizöl & Erdgas · 25 % Wärmepumpen",
  },
  {
    name: "Strom", total: 42, erneuerbar: 23,
    detail: "Geräte, Licht, Gewerbe & Industrie (ohne Wärme/Mobilität)",
    hinweis: "46 % des Strombezugs stammt aus Kernenergie",
  },
];

/* ---------- Gemeindevergleich (Energie-Reporter-Indikatoren) ---------- */
// Eingebettete Richtwerte (Stand ~2026); werden durch Live-Daten ersetzt.
const COMPARE = [
  { bfs: 1707, name: "Risch",       est: { solar: 11, ecar: 9,  heat: 42 } },
  { bfs: 1702, name: "Cham",        est: { solar: 12, ecar: 9,  heat: 45 } },
  { bfs: 1703, name: "Hünenberg",   est: { solar: 15, ecar: 10, heat: 40 } },
  { bfs: 1701, name: "Baar",        est: { solar: 12, ecar: 9,  heat: 38 } },
  { bfs: 1708, name: "Steinhausen", est: { solar: 13, ecar: 8,  heat: 38 } },
  { bfs: 1711, name: "Zug",         est: { solar: 8,  ecar: 10, heat: 45 } },
];
const CH_EST = { solar: 10, ecar: 7, heat: 35 };

// Spaltennamen im Energie Reporter koennen aendern - defensiv nachschlagen.
const COLS = {
  solar: ["solar_potential_usage"],
  ecar: ["electric_motorcar_share", "electric_car_share", "electric_vehicle_share"],
  heat: ["renewable_heating_share", "renheat_share", "heating_renewable_share"],
};
const pickNum = (row, keys) => {
  for (const k of keys) {
    const v = Number(row?.[k]);
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return null;
};

/* ---------- Franken & CO2 ---------- */
const GELD = {
  fossilAbflussMio: 25, // CHF Mio/Jahr fuer Heizoel, Gas, Benzin, Diesel (Spanne 20-30)
  stromwertRpKWh: 20,   // Wert des Solarstroms (vermiedener Einkauf, Rp./kWh)
};
const CO2 = {
  totalT: 60500, // t CO2eq, Gemeindebilanz 2021
  fossilT: 40000, // davon via Elektrifizierung + Solar vermeidbar (Waerme + Strasse)
  tProGWh: 720,  // t CO2 pro zusaetzlicher GWh Solarstrom, der Oel/Benzin ersetzt
  flugT: 2,      // Retourflug ZRH-New York pro Person
  autoT: 1.8,    // Durchschnittsauto und -jahr (12'000 km)
  erdrundeT: 6,  // einmal um die Erde im Benziner (40'000 km)
};

const f = (n, d = 0) =>
  n.toLocaleString("de-CH", { maximumFractionDigits: d, minimumFractionDigits: 0 });

/* ============================================================
   Mini-ZIP-Leser: liest ZIP-Dateien direkt im Browser, ohne
   Zusatzbibliothek. Nutzt den nativen DecompressionStream.
   ============================================================ */
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(arrayBuffer) {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  // End-of-Central-Directory-Signatur (0x06054b50) von hinten suchen
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Kein ZIP-Verzeichnis gefunden");
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(buf.subarray(off + 46, off + 46 + nameLen));
    entries.push({
      name,
      async text() {
        const lNameLen = dv.getUint16(localOff + 26, true);
        const lExtraLen = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lNameLen + lExtraLen;
        const data = buf.subarray(start, start + compSize);
        const raw = method === 8 ? await inflateRaw(data) : data;
        return new TextDecoder().decode(raw);
      },
    });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function fetchCsvFromZip(urls, namePart) {
  let lastError = new Error("keine Quelle erreichbar");
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = await unzip(await res.arrayBuffer());
      const entry = entries.find((e) => e.name.includes(namePart));
      if (!entry) throw new Error("CSV nicht im ZIP gefunden");
      const text = await entry.text();
      return Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true }).data;
    } catch (e) { lastError = e; }
  }
  throw lastError;
}

/* ---------- Rotkreuzer Skyline (Signatur-Element) ---------- */
// Wahrzeichen v.l.n.r.: Dorfkirche St. Verena (Risch), Schloss Buonas,
// Bauernhaus Holzhaeusern, Bahnhof Rotkreuz mit roter S-Bahn, das
// namensgebende rote Wegkreuz, Kirche Rotkreuz, Suurstoffi/Campus HSLU,
// Holzhochhaus Arbo, Aglaya mit begruenten Terrassen, Wohnquartier.
// Im Hintergrund: Rigi mit Sendeturm und ein Streifen Zugersee.
function Stadt() {
  return (
    <>
      <g><title>Dorfkirche St. Verena, Risch</title>
        <rect className="wand" x="30" y="135" width="52" height="35" />
        <polygon className="dach" points="26,135 86,135 56,118" />
        <rect className="wand" x="12" y="95" width="21" height="75" />
        <polygon className="dach" points="8,95 37,95 22.5,60" />
        <path className="lin" d="M22.5,60 V50 M17.5,55 H27.5" />
        <circle className="deko" cx="22.5" cy="105" r="4" />
      </g>
      <g><title>Schloss Buonas</title>
        <rect className="wand" x="112" y="100" width="26" height="70" />
        <polygon className="dach" points="106,100 144,100 125,70" />
        <path className="lin" d="M125,70 V59" />
        <polygon className="rot" points="125,59 137,62 125,66" />
        <rect className="wand" x="144" y="122" width="52" height="48" />
        <polygon className="dach" points="140,122 200,122 186,104 154,104" />
      </g>
      <g><title>Bauernhaus Holzhäusern</title>
        <rect className="wand" x="216" y="132" width="62" height="38" />
        <polygon className="dach" points="208,132 286,132 247,104" />
        <rect className="wand" x="286" y="144" width="22" height="26" />
        <polygon className="dach" points="282,144 312,144 297,130" />
      </g>
      {/* Aufnahmegebaeude mit auskragendem Perrondach, darunter die rote
          S-Bahn (Raeder stehen auf der Grundlinie) */}
      <g><title>Bahnhof Rotkreuz</title>
        <rect className="wand" x="330" y="124" width="72" height="46" />
        <rect className="pv" x="325" y="116" width="82" height="8" />
        <circle className="deko" cx="341" cy="136" r="6" />
        <path className="duenn" d="M341,136 V131 M341,136 H345" />
        <rect className="deko" x="357" y="150" width="14" height="20" />
        <rect className="deko" x="379" y="134" width="18" height="12" />
        <rect className="dach" x="402" y="116" width="68" height="8" />
        <path className="duenn" d="M467,124 V170" />
        <rect className="rot" x="406" y="142" width="58" height="22" rx="5" />
        <rect className="deko" x="411" y="147" width="48" height="7" />
        <path className="duenn" d="M436,147 V154" />
        <circle className="wand" cx="418" cy="167" r="3" />
        <circle className="wand" cx="452" cy="167" r="3" />
        <path className="duenn" d="M420,142 L426,134 L432,142 M422,134 H430" />
      </g>
      <g><title>Wegkreuz – Namensgeber von Rotkreuz</title>
        <path className="rotlin" d="M482,170 V146 M475,153 H489" />
      </g>
      <g><title>Kirche Rotkreuz</title>
        <rect className="wand" x="498" y="90" width="19" height="80" />
        <path className="lin" d="M507.5,90 V78 M502.5,83 H512.5" />
        <rect className="wand" x="521" y="128" width="52" height="42" />
        <polygon className="dach" points="517,128 577,128 547,110" />
      </g>
      <g><title>Suurstoffi / Campus HSLU</title>
        <rect className="wand" x="592" y="118" width="34" height="52" />
        <rect className="pv" x="592" y="113" width="34" height="5" />
        <rect className="wand" x="630" y="104" width="40" height="66" />
        <rect className="pv" x="630" y="99" width="40" height="5" />
        <rect className="wand" x="674" y="126" width="28" height="44" />
        <rect className="pv" x="674" y="121" width="28" height="5" />
      </g>
      <g><title>Holzhochhaus Arbo</title>
        <rect className="wand" x="716" y="52" width="60" height="118" />
        <rect className="pv" x="716" y="46" width="60" height="6" />
        <path className="duenn" d="M728,56 V166 M740,56 V166 M752,56 V166 M764,56 V166 M716,82 H776 M716,110 H776 M716,138 H776" />
      </g>
      {/* Aglaya, Variante A: schmaler Sockel, auskragender Turm (unten schmal,
          oben breit), Schulter links tiefer, Hauptturm rechts hoeher,
          runde Ecken, Balkonbaender, Baeume auf beiden Daechern */}
      <g><title>Aglaya, Suurstoffi</title>
      <polygon className="wand" points="826,170 826,138 829,134 857,134 860,138 860,170" />
      <path className="duenn" d="M833,140 V166 M841,140 V166 M849,140 V166 M827,148 H859 M827,158 H859" />
      <polygon className="wand" points="829,134 857,134 874,124 812,124" />
      <rect className="wand" x="812" y="50" width="36" height="74" rx="5" />
      <rect className="wand" x="844" y="27" width="34" height="97" rx="5" />
      <path className="duenn" d="M814,58 H844 M814,66 H844 M814,74 H844 M814,82 H844 M814,90 H844 M814,98 H844 M814,106 H844 M814,114 H844 M846,34 H876 M846,42 H876 M846,50 H876 M846,58 H876 M846,66 H876 M846,74 H876 M846,82 H876 M846,90 H876 M846,98 H876 M846,106 H876 M846,114 H876" />
      <circle className="wand" cx="812" cy="62" r="2.5" />
      <circle className="wand" cx="812" cy="84" r="2.5" />
      <circle className="wand" cx="812" cy="106" r="2.5" />
      <circle className="wand" cx="878" cy="46" r="2.5" />
      <circle className="wand" cx="878" cy="74" r="2.5" />
      <circle className="wand" cx="878" cy="102" r="2.5" />
      <rect className="pv" x="814" y="47" width="32" height="3.5" />
      <rect className="pv" x="846" y="24" width="30" height="3.5" />
      <circle className="gruen" cx="820" cy="44" r="3.5" />
      <circle className="gruen" cx="829" cy="42" r="4" />
      <circle className="gruen" cx="839" cy="44" r="3" />
      <circle className="gruen" cx="852" cy="21" r="3.5" />
      <circle className="gruen" cx="861" cy="19" r="4" />
      <circle className="gruen" cx="871" cy="21" r="3" />
      <circle className="gruen" cx="812" cy="74" r="2" />
      <circle className="gruen" cx="812" cy="96" r="2" />
      <circle className="gruen" cx="878" cy="60" r="2" />
      <circle className="gruen" cx="878" cy="88" r="2" />
      </g>
      <g><title>Wohnquartier Rotkreuz</title>
        <rect className="wand" x="916" y="128" width="70" height="42" />
        <polygon className="dach" points="910,128 992,128 951,110" />
      </g>
    </>
  );
}

// Wahrzeichen mit ihrer Spalte in der Skyline. Einzige Quelle fuer die
// Legende UND die Hitboxen - beide bleiben so automatisch synchron.
const WAHRZEICHEN = [
  { name: "Dorfkirche St. Verena", x: 0, w: 100 },
  { name: "Schloss Buonas", x: 100, w: 108 },
  { name: "Bauernhaus Holzhäusern", x: 208, w: 112 },
  { name: "Bahnhof Rotkreuz", x: 320, w: 154 },
  { name: "Wegkreuz", x: 474, w: 20 },
  { name: "Kirche Rotkreuz", x: 494, w: 91 },
  { name: "Suurstoffi/Campus HSLU", x: 585, w: 123 },
  { name: "Holzhochhaus Arbo", x: 708, w: 86 },
  { name: "Aglaya", x: 794, w: 106 },
  { name: "Wohnquartier", x: 900, w: 100 },
];

function Skyline({ pct }) {
  const [aktiv, setAktiv] = useState(null);
  const t = Math.max(0, Math.min(1, pct / 100));
  const sunX = 50 + 900 * t;
  const sunY = 110 - 85 * Math.sin(Math.PI * (0.12 + 0.76 * t));
  return (
    <>
    <svg viewBox="0 0 1000 200" className="skyline" role="img"
      aria-label={`Rotkreuzer Skyline: ${pct} Prozent des Solarpotenzials belegt`}>
      <defs>
        <clipPath id="fillclip">
          <rect x="0" y="0" width={1000 * t} height="200" />
        </clipPath>
      </defs>
      <polygon className="rigi" points="0,170 0,140 180,128 380,118 600,92 758,58 830,74 886,64 1000,112 1000,170" />
      <path className="duenn" d="M758,58 V36" />
      <rect className="see" x="0" y="164" width="200" height="6" />
      <circle cx={sunX} cy={sunY} r="17" className="sun" />
      <circle cx={sunX} cy={sunY} r="26" className="sun-halo" />
      <g className="b"><Stadt /></g>
      <g className="s" clipPath="url(#fillclip)"><Stadt /></g>
      <line x1="0" y1="170" x2="1000" y2="170" className="ground" />
      {/* Markierung unter der Grundlinie: zeigt, welches Wahrzeichen gemeint ist */}
      {aktiv !== null && (
        <rect className="wz-mark" x={WAHRZEICHEN[aktiv].x + 4} y="173"
          width={WAHRZEICHEN[aktiv].w - 8} height="3" rx="1.5" />
      )}
      {/* Transparente Spalten - fangen die Maus auch ueber den Luecken */}
      {WAHRZEICHEN.map((w, i) => (
        <rect key={w.name} x={w.x} y="0" width={w.w} height="178"
          fill="transparent" className="wz-hit"
          onMouseEnter={() => setAktiv(i)} onMouseLeave={() => setAktiv(null)} />
      ))}
    </svg>
    <p className="skyline-legende">
      {WAHRZEICHEN.map((w, i) => (
        <span key={w.name}>
          {i > 0 && <span className="wz-sep"> · </span>}
          <span className={"wz-name" + (aktiv === i ? " ist-aktiv" : "")}
            onMouseEnter={() => setAktiv(i)} onMouseLeave={() => setAktiv(null)}>
            {w.name}
          </span>
        </span>
      ))}
    </p>
    </>
  );
}

/* ---------- Kleine Bausteine ---------- */
function Stat({ value, unit, label }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}<span className="stat-unit">{unit}</span></div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Bar({ label, mwh, max, tone, note, unit = "MWh" }) {
  const w = Math.min(100, (mwh / max) * 100);
  return (
    <div className="dbar">
      <div className="dbar-head">
        <span>{label}</span>
        <span className="mono">{f(mwh)} {unit}</span>
      </div>
      <div className="dbar-track">
        <div className={`dbar-fill ${tone}`} style={{ width: `${w}%` }} />
      </div>
      {note && <div className="dbar-note">{note}</div>}
    </div>
  );
}

export default function SolarRechnerRisch() {
  const [pct, setPct] = useState(D.heuteAnteilPct);
  const [grossAnteil, setGrossAnteil] = useState(55);
  const [preis, setPreis] = useState("mittel");
  const [eiv, setEiv] = useState(true);
  const [zieljahr, setZieljahr] = useState(2040);

  // Live-Daten Energie Reporter
  const [status, setStatus] = useState("loading"); // loading | live | fallback
  const [live, setLive] = useState(null);          // aktuelle Kennzahlen Risch
  const [liveHist, setLiveHist] = useState(null);  // Jahresreihe Solarproduktion
  const [compare, setCompare] = useState(null);  // Gemeindevergleich

  useEffect(() => {
    let alive = true;

    (async () => {
      // 1) Aktuelle Kennzahlen
      try {
        const rows = await fetchCsvFromZip(LIVE.latestUrls, "municipality");
        const r = rows.find((x) => Number(x.bfs_nr) === LIVE.bfsNr);
        if (!r) throw new Error("Gemeinde nicht gefunden");
        if (!alive) return;
        setLive({
          usage: Number(r.solar_potential_usage) || null,               // Anteil (0..1)
          installedKwp: Number(r.solar_power_installed_kwp) || null,    // kWp
          solarMwh: Number(r.renelec_production_solar_mwh_per_year) || null,
          elecMwh: Number(r.elec_consumption_mwh_per_year) || null,
          stand: r.solar_potential_usage_last_change || r.elec_consumption_date_until || "",
        });
        setStatus("live");

        // Gemeindevergleich aus derselben Tabelle ableiten
        try {
          const toPct = (v) => (v == null ? null : v <= 1.5 ? v * 100 : v);
          const list = COMPARE.map((g) => {
            const row = rows.find((x) => Number(x.bfs_nr) === g.bfs);
            const sv = row ? pickNum(row, COLS.solar) : null;
            const ev = row ? pickNum(row, COLS.ecar) : null;
            const hv = row ? pickNum(row, COLS.heat) : null;
            return {
              name: g.name,
              live: sv != null,
              solar: sv != null ? toPct(sv) : g.est.solar,
              ecar: ev != null ? toPct(ev) : g.est.ecar,
              heat: hv != null ? toPct(hv) : g.est.heat,
            };
          });
          let s = 0, e = 0, h = 0, ns = 0, ne = 0, nh = 0;
          for (const row of rows) {
            const sv = pickNum(row, COLS.solar); if (sv != null) { s += sv; ns++; }
            const ev = pickNum(row, COLS.ecar); if (ev != null) { e += ev; ne++; }
            const hv = pickNum(row, COLS.heat); if (hv != null) { h += hv; nh++; }
          }
          list.push({
            name: "CH-Schnitt", ch: true, live: ns > 0,
            solar: ns ? toPct(s / ns) : CH_EST.solar,
            ecar: ne ? toPct(e / ne) : CH_EST.ecar,
            heat: nh ? toPct(h / nh) : CH_EST.heat,
          });
          setCompare(list);
        } catch (e2) { /* Vergleich bleibt Richtwert */ }
      } catch (e) {
        if (alive) setStatus("fallback");
      }

      // 2) Historisierung (monatlich seit 2021) → Jahreswerte
      try {
        const rows = await fetchCsvFromZip(LIVE.historizedUrls, "municipality");
        const mine = rows.filter((x) => Number(x.bfs_nr) === LIVE.bfsNr);
        const byYear = new Map();
        for (const r of mine) {
          const jahr = Number(String(r.energyreporter_date || "").slice(0, 4));
          if (!jahr) continue;
          const gwh =
            Number(r.renelec_production_solar_mwh_per_year) > 0
              ? Number(r.renelec_production_solar_mwh_per_year) / 1000
              : Number(r.solar_potential_usage) > 0
                ? Number(r.solar_potential_usage) * D.potenzialDachGWh
                : null;
          if (gwh != null) byYear.set(jahr, gwh); // letzter Monatswert pro Jahr gewinnt
        }
        if (alive && byYear.size > 0) setLiveHist(byYear);
      } catch (e) { /* Historie bleibt Schätzung */ }
    })();

    return () => { alive = false; };
  }, []);

  // Basisgrössen: Live-Werte haben Vorrang, sonst eingebettete Näherungen
  const base = useMemo(() => {
    const heuteGWh =
      live?.solarMwh ? live.solarMwh / 1000
        : live?.usage ? live.usage * D.potenzialDachGWh
          : (D.heuteAnteilPct / 100) * D.potenzialDachGWh;
    const heutePct = Math.max(1, Math.min(100, Math.round((heuteGWh / D.potenzialDachGWh) * 100)));
    const stromGWh = live?.elecMwh ? live.elecMwh / 1000 : D.stromHeuteGWh;
    const potMWp = live?.installedKwp && live?.usage
      ? live.installedKwp / 1000 / live.usage
      : (D.potenzialDachGWh * 1000) / D.ertragKWhProKWp;
    const sommertagStromMWh = Math.round((stromGWh * 1000) / 365 * 0.92); // Sommer leicht tiefer
    const sommertagElektrifiziertMWh = sommertagStromMWh + 88;            // + E-Mobilität
    return { heuteGWh, heutePct, stromGWh, potMWp, sommertagStromMWh, sommertagElektrifiziertMWh };
  }, [live]);

  // Slider nachführen, sobald Live-Daten da sind
  useEffect(() => {
    setPct((p) => Math.max(p === D.heuteAnteilPct ? 0 : p, base.heutePct));
  }, [base.heutePct]);

  const c = useMemo(() => {
    const prodGWh = (pct / 100) * D.potenzialDachGWh;
    const mwp = (pct / 100) * base.potMWp;
    const addMWp = Math.max(0, ((pct - base.heutePct) / 100) * base.potMWp);
    const p = PRICE[preis];
    const g = grossAnteil / 100;
    const blended = p.klein * (1 - g) + p.gross * g;
    const invest = addMWp * 1000 * blended;
    const foerder = eiv ? invest * D.eivFoerderung : 0;
    const netto = invest - foerder;
    const jahre = Math.max(1, zieljahr - 2026);
    const tagMWh = mwp * D.sommertagKWhProKWp;
    return {
      prodGWh, mwp, addMWp, blended, invest, foerder, netto, jahre, tagMWh,
      pctStrom: (prodGWh / base.stromGWh) * 100,
      pctElektrifiziert: (prodGWh / D.elektrifiziertGWh) * 100,
      deckSommerHeute: (tagMWh / base.sommertagStromMWh) * 100,
    };
  }, [pct, grossAnteil, preis, eiv, zieljahr, base]);

  const breakEvenPct = Math.ceil(
    (base.sommertagStromMWh / (base.potMWp * D.sommertagKWhProKWp)) * 100
  );

  const history = useMemo(() => {
    return HISTORY_EST.map((h) => {
      const liveVal = liveHist?.get(h.jahr);
      return liveVal != null
        ? { jahr: h.jahr, gwh: liveVal, live: true }
        : { ...h, live: false };
    });
  }, [liveHist]);
  const histMax = Math.max(...history.map((h) => h.gwh));

  const vergleich = useMemo(() => {
    if (compare) return compare;
    const rows = COMPARE.map((g) => ({ name: g.name, live: false, ...g.est }));
    rows.push({ name: "CH-Schnitt", ch: true, live: false, ...CH_EST });
    return rows;
  }, [compare]);

  const rischRank = useMemo(() => {
    const peers = vergleich.filter((v) => !v.ch);
    const sorted = [...peers].sort((a, b) => b.solar - a.solar);
    return { pos: sorted.findIndex((v) => v.name === "Risch") + 1, n: peers.length };
  }, [vergleich]);

  const geld = useMemo(() => {
    const stromwertMio = (c.prodGWh * 1e6 * GELD.stromwertRpKWh) / 100 / 1e6;
    const abflussJahre = c.netto / (GELD.fossilAbflussMio * 1e6);
    const addGWh = Math.max(0, c.prodGWh - base.heuteGWh);
    const co2T = Math.min(addGWh * CO2.tProGWh, CO2.fossilT);
    return { stromwertMio, abflussJahre, co2T };
  }, [c, base.heuteGWh]);

  const ernTotal = VERBRAUCH.reduce((s, v) => s + v.erneuerbar, 0);
  const ernPct = Math.round((ernTotal / D.endenergieGWh) * 100);

  let sommerFazit;
  if (c.tagMWh >= base.sommertagElektrifiziertMWh) {
    sommerFazit = "Ja – dieser Ausbaugrad würde an einem sonnigen Sommertag sogar den Bedarf decken, wenn zusätzlich alle Autos elektrisch fahren.";
  } else if (c.tagMWh >= base.sommertagStromMWh) {
    sommerFazit = "Ja – dieser Ausbaugrad deckt an einem sonnigen Sommertag den gesamten heutigen Strombedarf der Gemeinde.";
  } else {
    sommerFazit = `Noch nicht ganz: Ab rund ${breakEvenPct} % Ausbaugrad würde ein sonniger Sommertag den gesamten heutigen Strombedarf decken.`;
  }

  const statusText = {
    loading: "Live-Daten werden geladen …",
    live: `Live-Daten: Energie Reporter (geoimpact / EnergieSchweiz)${live?.stand ? ", Stand " + live.stand : ""}`,
    fallback: "Eingebettete Daten, Stand Juli 2026 – Live-Abfrage in dieser Umgebung nicht möglich",
  }[status];

  return (
    <div className="page">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100,500;100,700;125,800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

        :root{
          --sky:#EDF3F6; --ink:#10293F; --ink-soft:#3D566B; --line:#CFDEE6;
          --amber:#F0A400; --amber-deep:#C98800; --green:#2E7D53;
          --clay:#B44A32; --graphite:#1C242C; --card:#FFFFFF;
        }
        *{box-sizing:border-box;margin:0;padding:0}
        .page{
          background:var(--sky); color:var(--ink); min-height:100vh;
          font-family:'IBM Plex Sans',system-ui,sans-serif; font-size:16px; line-height:1.55;
        }
        .wrap{max-width:1040px;margin:0 auto;padding:0 20px}
        .mono{font-family:'IBM Plex Mono',monospace}
        h1,h2{font-family:'Archivo',sans-serif;font-stretch:125%;line-height:1.05;letter-spacing:-.01em}
        h1{font-size:clamp(34px,6vw,58px);font-weight:800}
        h2{font-size:clamp(24px,3.4vw,34px);font-weight:800;margin-bottom:10px}
        .eyebrow{
          font-family:'IBM Plex Mono',monospace;font-size:12px;letter-spacing:.18em;
          text-transform:uppercase;color:var(--amber-deep);font-weight:600;margin-bottom:14px;
        }
        .lead{color:var(--ink-soft);max-width:640px;font-size:17px;margin-top:14px}

        .badge{
          display:inline-flex;align-items:center;gap:8px;margin-top:18px;
          font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--ink-soft);
          background:var(--card);border:1px solid var(--line);border-radius:99px;padding:7px 14px;
        }
        .badge-dot{width:9px;height:9px;border-radius:99px;background:#9AAAB8}
        .badge-dot.live{background:var(--green)}
        .badge-dot.loading{background:var(--amber);animation:pulse 1.2s infinite}
        @keyframes pulse{50%{opacity:.35}}

        header{padding:56px 0 8px;position:relative}
        header h1{padding-right:clamp(110px,17vw,175px)}
        .wappen-img{position:absolute;top:48px;right:0;width:clamp(96px,14vw,150px);height:auto;
          filter:drop-shadow(0 3px 8px rgba(16,41,63,.22))}
        .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:30px 0 8px}
        .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
        .stat-value{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600}
        .stat-unit{font-size:15px;margin-left:5px;color:var(--ink-soft);font-weight:500}
        .stat-label{font-size:13.5px;color:var(--ink-soft);margin-top:4px}
        .stat-label a{color:var(--amber-deep);font-weight:600}
        .nutzen{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
        .nutzen-chip{background:var(--ink);color:#F4EFE2;border-radius:99px;padding:8px 16px;
          font-weight:600;font-size:14.5px}

        section{padding:44px 0}
        .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px}
        .subtle{color:var(--ink-soft);font-size:14.5px}

        .skyline{width:100%;height:auto;display:block;margin:8px 0 4px}
        .skyline-legende{font-size:11.5px;line-height:1.7;color:var(--ink-soft);margin:0 0 4px;letter-spacing:.01em}
        .skyline-legende .wz-sep{opacity:.45}
        .wz-name{opacity:.7;padding:1px 2px;border-radius:3px;transition:opacity .12s,background .12s,color .12s}
        .wz-name.ist-aktiv{opacity:1;color:var(--ink);background:color-mix(in srgb,var(--amber) 20%,transparent)}
        .wz-hit{cursor:help}
        .wz-mark{fill:var(--amber)}
        .skyline .lin,.skyline .duenn,.skyline .rotlin{fill:none;stroke-linecap:round}
        .skyline .lin{stroke-width:3}
        .skyline .duenn{stroke-width:1.6}
        .skyline .rotlin{stroke:#C0392B;stroke-width:4.5}
        .skyline .rot{fill:#C0392B}
        .skyline .rigi{fill:#DCE8EF}
        .skyline .see{fill:#C6DDEB}
        .skyline .b .wand,.skyline .b .dach,.skyline .b .pv,.skyline .b .gruen{fill:#C4D4DD}
        .skyline .b .deko{fill:#EDF3F6}
        .skyline .b .lin{stroke:#A9BDC9}
        .skyline .b .duenn{stroke:#B9CBD6}
        .skyline .s .wand{fill:var(--graphite)}
        .skyline .s .dach,.skyline .s .pv{fill:var(--amber)}
        .skyline .s .gruen{fill:var(--green)}
        .skyline .s .deko{fill:#EDF3F6}
        .skyline .s .lin{stroke:var(--graphite)}
        .skyline .s .duenn{stroke:#39434D}
        .sun{fill:var(--amber)}
        .sun-halo{fill:var(--amber);opacity:.18}
        .ground{stroke:var(--ink);stroke-width:2}

        input[type=range]{width:100%;accent-color:var(--amber-deep);height:34px;cursor:pointer}
        input[type=range]:focus-visible,button:focus-visible,input[type=checkbox]:focus-visible{
          outline:3px solid var(--amber-deep);outline-offset:2px;border-radius:6px}
        .slider-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
        .slider-val{font-family:'IBM Plex Mono',monospace;font-size:40px;font-weight:600}
        .slider-scale{display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-soft);
          font-family:'IBM Plex Mono',monospace;margin-top:-4px}

        .resgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-top:22px}
        .res{border-left:4px solid var(--amber);background:#FDF6E5;border-radius:0 12px 12px 0;padding:14px 16px}
        .res.blue{border-color:var(--ink);background:#E7EEF3}
        .res.green{border-color:var(--green);background:#E9F3EC}
        .res-big{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:600}
        .res-lbl{font-size:13.5px;color:var(--ink-soft);margin-top:2px}

        .dbar{margin-top:18px}
        .dbar-head{display:flex;justify-content:space-between;font-weight:600;font-size:15px;margin-bottom:6px}
        .dbar-track{background:#E1EAEF;border-radius:99px;height:22px;overflow:hidden}
        .dbar-fill{height:100%;border-radius:99px;transition:width .35s ease}
        .dbar-fill.amber{background:var(--amber)}
        .dbar-fill.blue{background:var(--ink)}
        .dbar-fill.slate{background:#6C8296}
        .dbar-note{font-size:13px;color:var(--ink-soft);margin-top:5px}
        .fazit{margin-top:22px;padding:16px 18px;border-radius:12px;background:var(--graphite);
          color:#F4EFE2;font-size:16px;font-weight:500}

        .hist{display:flex;align-items:flex-end;gap:6px;height:190px;margin-top:26px}
        .hist-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px;height:100%}
        .hist-bar{width:100%;max-width:44px;background:var(--amber);border-radius:6px 6px 2px 2px;
          transition:height .3s ease;min-height:4px}
        .hist-bar.est{background:repeating-linear-gradient(45deg,var(--amber),var(--amber) 5px,#F7C64F 5px,#F7C64F 10px)}
        .hist-num{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ink-soft)}
        .hist-year{font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:600}
        .hist-legend{display:flex;gap:18px;font-size:13px;color:var(--ink-soft);margin-top:14px;flex-wrap:wrap}
        .swatch{display:inline-block;width:14px;height:14px;border-radius:4px;margin-right:6px;vertical-align:-2px;background:var(--amber)}
        .swatch.est{background:repeating-linear-gradient(45deg,var(--amber),var(--amber) 4px,#F7C64F 4px,#F7C64F 8px)}

        .vgrid{display:grid;gap:16px;margin-top:22px}
        .vrow{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
        .vrow-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
        .vrow-name{font-family:'Archivo',sans-serif;font-weight:800;font-size:19px}
        .vrow-total{font-family:'IBM Plex Mono',monospace;font-weight:600}
        .vtrack{display:flex;height:26px;border-radius:8px;overflow:hidden;margin:10px 0 6px;background:#E1EAEF}
        .vseg-ern{background:var(--green)}
        .vseg-fos{background:var(--clay)}
        .vlegend{display:flex;gap:18px;font-size:13px;color:var(--ink-soft);flex-wrap:wrap}
        .dot{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}

        .ctrl{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:22px;margin-top:8px}
        .ctrl label{font-weight:600;font-size:14.5px;display:block;margin-bottom:6px}
        .seg{display:flex;gap:8px;flex-wrap:wrap}
        .seg button{
          font-family:'IBM Plex Mono',monospace;font-size:13.5px;font-weight:600;padding:8px 14px;
          border-radius:99px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
        .seg button.on{background:var(--ink);border-color:var(--ink);color:#fff}
        .check{display:flex;align-items:center;gap:10px;font-size:14.5px;font-weight:500;margin-top:10px}
        .check input{width:18px;height:18px;accent-color:var(--green)}

        .cost-hero{display:flex;flex-wrap:wrap;gap:26px;align-items:baseline;margin-top:24px}
        .cost-big{font-family:'IBM Plex Mono',monospace;font-size:clamp(36px,6vw,54px);font-weight:600}
        .cost-sub{font-size:14px;color:var(--ink-soft)}
        table{width:100%;border-collapse:collapse;margin-top:18px;font-size:14.5px}
        td{padding:9px 4px;border-top:1px solid var(--line)}
        td:last-child{text-align:right;font-family:'IBM Plex Mono',monospace;font-weight:600}

        .src{display:grid;gap:14px;margin-top:20px}
        .src-item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 18px;font-size:14.5px}
        .src-item strong{display:block;margin-bottom:3px}
        .cmp-block{margin-top:24px}
        .cmp-titel{font-weight:600;font-size:15px;margin-bottom:8px}
        .cmp-row{display:grid;grid-template-columns:104px 1fr 60px;gap:10px;align-items:center;margin-top:6px}
        .cmp-name{font-size:13.5px;color:var(--ink-soft)}
        .cmp-row.me .cmp-name{color:var(--ink);font-weight:700}
        .cmp-track{background:#E1EAEF;border-radius:99px;height:14px;overflow:hidden;display:block}
        .cmp-fill{display:block;height:100%;border-radius:99px;background:#6C8296;transition:width .35s ease}
        .cmp-row.me .cmp-fill{background:var(--amber)}
        .cmp-row.ch .cmp-fill{background:var(--ink)}
        .cmp-val{font-size:13px;text-align:right}
        .tacho{display:flex;height:26px;border-radius:99px;overflow:hidden;background:#E1EAEF}
        .tacho-rest{background:var(--clay);height:100%;transition:width .35s ease}
        .tacho-saved{background:var(--green);height:100%;transition:width .35s ease}
        .chips{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
        .chip{background:#E9F3EC;border:1px solid #CBE2D2;border-radius:99px;padding:7px 13px;font-size:13.5px;font-weight:500}
        .src-item .subtle{display:block}

        footer{padding:40px 0 60px;color:var(--ink-soft);font-size:13.5px;border-top:1px solid var(--line);margin-top:30px}

        @media (prefers-reduced-motion: reduce){
          .dbar-fill,.hist-bar{transition:none}
          .badge-dot.loading{animation:none}
        }
      `}</style>

      <div className="wrap">
        {/* ---------- HERO ---------- */}
        <header>
          <img className="wappen-img" src={WAPPEN} alt="Wappen der Gemeinde Risch" />
          <div className="eyebrow">Verein Elektrisch · Gemeinde Risch</div>
          <h1>Wie viel Sonne steckt in unseren Dächern?</h1>
          <p className="lead">
            Der Solarpotenzial-Rechner zeigt für Risch, Rotkreuz, Buonas und Holzhäusern,
            was unsere Dächer heute leisten, was möglich wäre – und was uns das kosten würde.
            Alle Werte sind sorgfältige Näherungen; die Annahmen finden Sie ganz unten.
          </p>
          <div className="nutzen" aria-label="Worum es geht">
            <span className="nutzen-chip">Gute Luft für uns.</span>
            <span className="nutzen-chip">Jobs für uns.</span>
            <span className="nutzen-chip">Einer der wenigen Fälle, in denen alle gewinnen.</span>
          </div>
          <div className="badge" role="status">
            <span className={`badge-dot ${status}`} />
            {statusText}
          </div>
          <div className="statgrid">
            <Stat value="64.6" unit="GWh/Jahr" label="Solarstrom-Potenzial aller geeigneten Dächer in der Gemeinde (BFE, Ausgabe 2025)" />
            <Stat
              value={`≈ ${f(base.heuteGWh, 1)}`} unit="GWh/Jahr"
              label={<>heute produziert – rund {base.heutePct} % des Potenzials{live?.installedKwp ? ` (${f(live.installedKwp / 1000, 1)} MWp installiert)` : ""} · <a href="https://www.energiereporter.ch" target="_blank" rel="noreferrer">Quelle: Energie Reporter</a></>}
            />
            <Stat value={f(base.stromGWh, 0)} unit="GWh/Jahr" label="Stromverbrauch der ganzen Gemeinde" />
          </div>
        </header>

        {/* ---------- MASTER-SLIDER ---------- */}
        <section>
          <h2>Drehen Sie die Sonne auf</h2>
          <p className="subtle" style={{ maxWidth: 620 }}>
            Der Regler steuert, wie viel des Dachpotenzials belegt ist. Er beginnt beim
            heutigen Stand und wirkt auf alle Rechnungen dieser Seite – auch auf den
            Kostenrechner weiter unten.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <Skyline pct={pct} />
            <div className="slider-head">
              <span style={{ fontWeight: 600 }}>Ausbaugrad des Dachpotenzials</span>
              <span className="slider-val">{pct} %</span>
            </div>
            <input
              type="range" min={base.heutePct} max={100} step={1} value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              aria-label="Ausbaugrad des Dachpotenzials in Prozent"
            />
            <div className="slider-scale">
              <span>{base.heutePct} % · heute</span>
              <span>100 % · volles Potenzial</span>
            </div>

            <div className="resgrid">
              <div className="res">
                <div className="res-big">{f(c.prodGWh, 1)} GWh</div>
                <div className="res-lbl">Solarstrom pro Jahr ({f(c.mwp, 0)} MWp installiert)</div>
              </div>
              <div className="res blue">
                <div className="res-big">{f(c.pctStrom, 0)} %</div>
                <div className="res-lbl">des heutigen Stromverbrauchs ({f(base.stromGWh, 0)} GWh)</div>
              </div>
              <div className="res green">
                <div className="res-big">{f(c.pctElektrifiziert, 0)} %</div>
                <div className="res-lbl">des Bedarfs, wenn Heizen &amp; Autofahren elektrisch sind (~120 GWh)</div>
              </div>
            </div>
            <p className="subtle" style={{ marginTop: 16 }}>
              Zum Vergleich: Werden zusätzlich geeignete Fassaden genutzt, steigt das
              Potenzial auf 88.8 GWh pro Jahr – mehr als der heutige Stromverbrauch der
              ganzen Gemeinde.
            </p>
          </div>
        </section>

        {/* ---------- SONNIGER TAG ---------- */}
        <section>
          <h2>Ein schöner Sommertag</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Die Kernfrage: Könnten wir uns an einem wolkenlosen Sommertag selbst versorgen?
            Die Balken zeigen die Tagesbilanz beim oben gewählten Ausbaugrad von {pct} %.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <Bar
              label={`Solarproduktion an einem Sommertag (${pct} % Ausbau)`}
              mwh={c.tagMWh} max={Math.max(420, base.sommertagElektrifiziertMWh * 1.4)} tone="amber"
              note={`Annahme: 5.5 kWh pro kWp und Tag – deckt ${f(c.deckSommerHeute, 0)} % des heutigen Tagesbedarfs`}
            />
            <Bar
              label="Strombedarf der Gemeinde an einem Sommertag – heute"
              mwh={base.sommertagStromMWh} max={Math.max(420, base.sommertagElektrifiziertMWh * 1.4)} tone="blue"
              note="Haushalte, Gewerbe, Industrie, Warmwasser (Heizung im Sommer kaum relevant)"
            />
            <Bar
              label="Strombedarf, wenn zusätzlich alle Autos elektrisch fahren"
              mwh={base.sommertagElektrifiziertMWh} max={Math.max(420, base.sommertagElektrifiziertMWh * 1.4)} tone="slate"
              note="Modellrechnung: heutige Strassenkilometer vollständig elektrisch"
            />
            <div className="fazit">{sommerFazit}</div>
            <p className="subtle" style={{ marginTop: 14 }}>
              Wichtig: Die Sonne liefert mittags mehr, als gleichzeitig verbraucht wird.
              Für eine echte Tages-Selbstversorgung braucht es Speicher und das Netz.
              Im Winter liegt der Tagesertrag nur bei etwa einem Viertel eines Sommertags –
              die Winterlücke löst Solar allein nicht.
            </p>
          </div>
        </section>

        {/* ---------- HISTORIE ---------- */}
        <section>
          <h2>Schritt für Schritt zu mehr Strom</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Solarstromproduktion in der Gemeinde Risch pro Jahr. Wo verfügbar, stammen die
            Werte direkt aus der monatlichen Historisierung des Energie Reporters
            (jeweils letzter Datenstand des Jahres); schraffierte Balken sind Schätzungen.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <div className="hist">
              {history.map((h) => (
                <div className="hist-col" key={h.jahr}>
                  <div className="hist-num">{f(h.gwh, 1)}</div>
                  <div
                    className={`hist-bar ${h.live ? "" : "est"}`}
                    style={{ height: `${(h.gwh / histMax) * 78}%` }}
                    title={`${h.jahr}: ca. ${f(h.gwh, 1)} GWh${h.live ? " (Energie Reporter)" : " (Schätzung)"}`}
                  />
                  <div className="hist-year">{String(h.jahr).slice(2)}</div>
                </div>
              ))}
            </div>
            <div className="hist-legend">
              <span><span className="swatch" />Energie Reporter (gemessen/modelliert)</span>
              <span><span className="swatch est" />Schätzung / Hochrechnung</span>
            </div>
            <p className="subtle" style={{ marginTop: 14 }}>
              In GWh pro Jahr. Beim Tempo der letzten Jahre wäre das volle Dachpotenzial
              erst in über 70 Jahren erreicht. Für das Ziel der Gemeinde – Potenzial bis
              2050 ausgeschöpft – müsste der Zubau rund dreimal schneller werden.
            </p>
          </div>
        </section>

        {/* ---------- GEMEINDEVERGLEICH ---------- */}
        <section>
          <h2>Wie stehen wir im Vergleich da?</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Die drei Kernindikatoren des Energie Reporters für Risch, die Nachbargemeinden
            und den Schweizer Schnitt.
            {compare ? " Live-Werte." : " Ohne Live-Verbindung: Richtwerte, Stand 2026."}
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <p style={{ fontWeight: 600 }}>
              Beim Solarausbau liegt Risch auf Platz {rischRank.pos} von {rischRank.n} in
              diesem Vergleich – machbar ist deutlich mehr: Keine Gemeinde ist auch nur
              annähernd an ihrem Potenzial.
            </p>
            {[
              { key: "solar", titel: "Solarstrom-Potenzial ausgeschöpft" },
              { key: "ecar", titel: "Steckerfahrzeuge (E-Autos & Plug-ins) an allen Autos" },
              { key: "heat", titel: "Erneuerbar heizen" },
            ].map((ind) => {
              const maxV = Math.max(...vergleich.map((v) => v[ind.key]));
              return (
                <div className="cmp-block" key={ind.key}>
                  <div className="cmp-titel">{ind.titel}</div>
                  {vergleich.map((v) => (
                    <div
                      className={`cmp-row ${v.name === "Risch" ? "me" : ""} ${v.ch ? "ch" : ""}`}
                      key={v.name}
                    >
                      <span className="cmp-name">{v.name}</span>
                      <span className="cmp-track">
                        <span className="cmp-fill" style={{ width: `${(v[ind.key] / maxV) * 100}%` }} />
                      </span>
                      <span className="cmp-val mono">{f(v[ind.key], 0)} %</span>
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="subtle" style={{ marginTop: 16 }}>
              Quelle: Energie Reporter (geoimpact / EnergieSchweiz). Der Nachbarschafts-Blick
              lohnt sich: Was Hünenberg oder Cham schaffen, schafft Risch auch.
            </p>
          </div>
        </section>

        {/* ---------- VERBRAUCH ---------- */}
        <section>
          <h2>Wo unsere Energie heute hingeht</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Endenergieverbrauch der Gemeinde Risch nach Verbrauchergruppen
            (Energie- und Klimabilanz 2021). Grün = erneuerbarer Anteil.
            Insgesamt sind heute rund {ernPct} % erneuerbar.
          </p>
          <div className="vgrid">
            {VERBRAUCH.map((v) => {
              const ep = (v.erneuerbar / v.total) * 100;
              return (
                <div className="vrow" key={v.name}>
                  <div className="vrow-head">
                    <span className="vrow-name">{v.name}</span>
                    <span className="vrow-total">{f(v.total)} GWh · {f(ep, 0)} % erneuerbar</span>
                  </div>
                  <div className="subtle">{v.detail}</div>
                  <div className="vtrack" role="img"
                    aria-label={`${v.name}: ${f(ep, 0)} Prozent erneuerbar`}>
                    <div className="vseg-ern" style={{ width: `${ep}%` }} />
                    <div className="vseg-fos" style={{ width: `${100 - ep}%` }} />
                  </div>
                  <div className="subtle">{v.hinweis}</div>
                </div>
              );
            })}
          </div>
          <div className="vlegend" style={{ marginTop: 14 }}>
            <span><span className="dot" style={{ background: "var(--green)" }} />erneuerbar</span>
            <span><span className="dot" style={{ background: "var(--clay)" }} />fossil / nicht erneuerbar</span>
          </div>
          <div className="card" style={{ marginTop: 22 }}>
            <strong>Einordnung Solarstrom:</strong>{" "}
            Die heutige Produktion (≈ {f(base.heuteGWh, 1)} GWh) deckt rund{" "}
            {f((base.heuteGWh / base.stromGWh) * 100, 0)} % des Stromverbrauchs und{" "}
            {f((base.heuteGWh / D.endenergieGWh) * 100, 1)} % des gesamten Energieverbrauchs.
            Das volle Dachpotenzial entspräche {f((D.potenzialDachGWh / base.stromGWh) * 100, 0)} %
            des heutigen Stromverbrauchs – und über der Hälfte des Bedarfs einer
            vollständig elektrifizierten Gemeinde.
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <strong>Wieviel Strom braucht die Energiewende in Risch?</strong>
            <p className="subtle" style={{ marginTop: 6 }}>
              Werden Heizen und Autofahren elektrisch, steigt der Strombedarf –
              unsere Dächer könnten mehr als die Hälfte davon liefern.
            </p>
            <Bar label="Stromverbrauch heute" mwh={base.stromGWh} max={140} tone="blue" unit="GWh"
              note="Haushalte, Gewerbe, Industrie – gemessener Jahresverbrauch" />
            <Bar label="Strombedarf bei vollzogener Energiewende" mwh={D.elektrifiziertGWh} max={140} tone="slate" unit="GWh"
              note="Modell: fossile Heizungen durch Wärmepumpen ersetzt, Strassenverkehr elektrisch (±20 GWh)" />
            <Bar label="Solarstrom-Potenzial unserer Dächer" mwh={D.potenzialDachGWh} max={140} tone="amber" unit="GWh"
              note="Dazu kämen Fassaden (bis 88.8 GWh total), Wasserkraft und Importe für den Rest" />
          </div>
        </section>

        {/* ---------- FRANKEN & CO2 ---------- */}
        <section>
          <h2>Geld, das im Dorf bleibt – und CO2, das wegfällt</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Für Heizöl, Erdgas, Benzin und Diesel fliessen aus Risch jedes Jahr rund
            CHF {GELD.fossilAbflussMio} Millionen ab (Spanne 20–30, je nach Preisen).
            Sonne vom eigenen Dach ersetzt Importe durch lokale Wertschöpfung –
            Aufträge für Installateure, tiefere Stromrechnungen, Wert fürs Gebäude.
          </p>
          <div className="card" style={{ marginTop: 20 }}>
            <div className="resgrid">
              <div className="res">
                <div className="res-big">CHF {f(geld.stromwertMio, 1)} Mio</div>
                <div className="res-lbl">Stromwert pro Jahr von unseren Dächern beim gewählten Ausbau ({pct} %)</div>
              </div>
              <div className="res blue">
                <div className="res-big">{f(geld.abflussJahre, 1)} Jahre</div>
                <div className="res-lbl">fossiler Energieausgaben entsprechen der gesamten Ausbau-Investition</div>
              </div>
              <div className="res green">
                <div className="res-big">CHF {f(GELD.fossilAbflussMio * 25)} Mio</div>
                <div className="res-lbl">verlassen Risch in den nächsten 25 Jahren, wenn alles bleibt wie heute</div>
              </div>
            </div>

            <div className="dbar-head" style={{ marginTop: 28 }}>
              <span>CO2-Tacho der Gemeinde</span>
              <span className="mono">{f(CO2.totalT - geld.co2T)} von {f(CO2.totalT)} t/Jahr</span>
            </div>
            <div className="tacho" role="img"
              aria-label={`CO2: ${f(geld.co2T)} von ${f(CO2.totalT)} Tonnen eingespart`}>
              <div className="tacho-rest" style={{ width: `${((CO2.totalT - geld.co2T) / CO2.totalT) * 100}%` }} />
              <div className="tacho-saved" style={{ width: `${(geld.co2T / CO2.totalT) * 100}%` }} />
            </div>
            <div className="dbar-note">
              Grün = Einsparung, wenn der zusätzliche Solarstrom via Wärmepumpen und
              E-Autos Heizöl, Gas und Treibstoff ersetzt (Modell: ~{CO2.tProGWh} t pro GWh).
            </div>
            <div className="chips">
              <span className="chip">✈ {f(geld.co2T / CO2.flugT)} Retourflüge Zürich–New York</span>
              <span className="chip">🚗 {f(geld.co2T / CO2.autoT)} Autos ein Jahr stillgelegt</span>
              <span className="chip">🌍 {f(geld.co2T / CO2.erdrundeT)} Erdumrundungen im Benziner</span>
            </div>
          </div>
        </section>

        {/* ---------- KOSTENRECHNER ---------- */}
        <section>
          <h2>Was würde der Ausbau kosten?</h2>
          <p className="subtle" style={{ maxWidth: 640 }}>
            Investition, um vom heutigen Stand ({base.heutePct} %) auf den oben gewählten
            Ausbaugrad von {pct} % zu kommen – das sind {f(c.addMWp, 1)} MWp zusätzliche
            Anlagen. Getragen würden die Kosten grösstenteils von privaten
            Eigentümerschaften und Firmen, nicht von der Gemeindekasse.
          </p>

          <div className="card" style={{ marginTop: 20 }}>
            <div className="ctrl">
              <div>
                <label htmlFor="gross">Anteil Grossanlagen (Industrie, grosse Dächer): {grossAnteil} %</label>
                <input id="gross" type="range" min={0} max={100} step={5}
                  value={grossAnteil} onChange={(e) => setGrossAnteil(Number(e.target.value))} />
                <div className="subtle">Grossanlagen kosten pro kWp rund halb so viel wie Kleinanlagen.</div>
              </div>
              <div>
                <label>Preis-Szenario (CHF pro kWp)</label>
                <div className="seg" role="group" aria-label="Preis-Szenario wählen">
                  {Object.entries(PRICE).map(([k, v]) => (
                    <button key={k} className={preis === k ? "on" : ""} onClick={() => setPreis(k)}>
                      {v.label}
                    </button>
                  ))}
                </div>
                <div className="subtle" style={{ marginTop: 8 }}>
                  Kleinanlagen {f(PRICE[preis].klein)} / Grossanlagen {f(PRICE[preis].gross)} CHF pro kWp
                </div>
                <div className="check">
                  <input id="eiv" type="checkbox" checked={eiv}
                    onChange={(e) => setEiv(e.target.checked)} />
                  <label htmlFor="eiv" style={{ margin: 0 }}>Bundesförderung abziehen (Einmalvergütung, ≈ 15 %)</label>
                </div>
              </div>
              <div>
                <label>Zieljahr für den Ausbau</label>
                <div className="seg" role="group" aria-label="Zieljahr wählen">
                  {[2035, 2040, 2050].map((j) => (
                    <button key={j} className={zieljahr === j ? "on" : ""} onClick={() => setZieljahr(j)}>
                      {j}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="cost-hero">
              <div>
                <div className="cost-big">CHF {f(c.netto / 1e6, 0)} Mio</div>
                <div className="cost-sub">
                  Netto-Investition ({eiv ? "nach" : "ohne"} Bundesförderung) ·
                  Mischpreis {f(c.blended)} CHF/kWp
                </div>
              </div>
            </div>

            <table>
              <tbody>
                <tr><td>Zusätzliche Leistung</td><td>{f(c.addMWp, 1)} MWp</td></tr>
                <tr><td>Brutto-Investition</td><td>CHF {f(c.invest / 1e6, 0)} Mio</td></tr>
                <tr><td>Bundesförderung (Einmalvergütung)</td><td>− CHF {f(c.foerder / 1e6, 0)} Mio</td></tr>
                <tr><td>Pro Einwohner:in (12'000 Personen)</td><td>CHF {f(c.netto / D.einwohner)}</td></tr>
                <tr><td>Pro Jahr bis {zieljahr} ({c.jahre} Jahre)</td><td>CHF {f(c.netto / c.jahre / 1e6, 1)} Mio</td></tr>
                <tr><td>Solarstrom-Gestehungskosten (Richtwert)</td><td>6 – 12 Rp./kWh</td></tr>
              </tbody>
            </table>
            <p className="subtle" style={{ marginTop: 14 }}>
              Zum Vergleich: Strom aus dem Netz kostet Haushalte heute rund 25–30 Rp./kWh.
              Solarstrom vom eigenen Dach ist über die Lebensdauer meist die günstigste
              Stromquelle – die Investition zahlt sich in der Regel in 10–15 Jahren zurück.
              Nicht enthalten: allfällige Netzverstärkungen und Speicher.
            </p>
          </div>
        </section>

        {/* ---------- DATEN & FEHLERQUELLEN ---------- */}
        <section>
          <h2>Daten, Annahmen &amp; Fehlerquellen</h2>
          <p className="subtle" style={{ maxWidth: 660 }}>
            Dieser Rechner arbeitet bewusst mit transparenten Näherungen. Wer die Zahlen
            weiterverwendet, sollte die folgenden Unsicherheiten kennen.
          </p>
          <div className="src">
            <div className="src-item">
              <strong>Live-Datenanbindung: Energie Reporter (CC BY 4.0)</strong>
              Beim Laden ruft die Seite die offenen Datensätze «energyreporter_latest» und
              «energyreporter_historized» ab (geoimpact AG / EnergieSchweiz, opendata.swiss)
              und übernimmt für Risch (BFS 1707): installierte kWp, Solarproduktion,
              Potenzial-Ausnutzung und den gemessenen Stromverbrauch.
              <span className="subtle">Schlägt die Abfrage fehl (Vorschau-Sandbox oder CORS-Sperre des Browsers), rechnet die Seite mit eingebetteten Werten weiter – der Status wird oben angezeigt. Für die Vereins-Website bei Bedarf einen kleinen Daten-Proxy (z.B. Cloudflare Worker) vorschalten; die URLs sind im Quellcode zuoberst konfigurierbar. Bei Veröffentlichung müssen Energie Reporter als Quelle sowie geoimpact und EnergieSchweiz genannt und verlinkt werden – der Footer erfüllt das bereits.</span>
            </div>
            <div className="src-item">
              <strong>Potenzial: 64.6 GWh (Dächer) / 88.8 GWh (inkl. Fassaden)</strong>
              BFE Sonnendach.ch, Gemeinde Risch (BFS-Nr. 1707), Ausgabe 2025. Technisches
              Potenzial: nur gut geeignete Flächen, 70 % Belegung, Modulwirkungsgrad 20 %.
              <span className="subtle">Unsicherheit ±10–15 %. Bereits gebaute Anlagen sind im Potenzial enthalten. Denkmalschutz und bauliche Sonderfälle sind nicht abgezogen. Hinweis: Der Energie Reporter nutzt ein eigenes, leicht abweichendes Potenzialmodell – der Ausbaugrad hier wird einheitlich auf die 64.6 GWh des BFE bezogen.</span>
            </div>
            <div className="src-item">
              <strong>Heute installiert: ≈ {f(base.heuteGWh, 1)} GWh ({base.heutePct} % des Potenzials)</strong>
              Primär aus dem Energie Reporter; ohne Live-Verbindung aus der Energie- und
              Klimastrategie der Gemeinde Risch (2025: «rund 10 % genutzt»), fortgeschrieben.
              <span className="subtle">Unsicherheit im Fallback ±2 GWh. Die Jahresreihe vor 2021 bleibt eine Rückrechnung anhand des schweizweiten Wachstums – der Energie Reporter historisiert erst seit März 2021.</span>
            </div>
            <div className="src-item">
              <strong>Verbrauch: 290 GWh gesamt · 130 Mobilität · 118 Wärme · 42 Strom</strong>
              Energie- und Klimabilanz der Gemeinde Risch, Bilanzjahr 2021 (OekoWatt AG).
              Stromverbrauch inkl. Wärmepumpen, Boiler und E-Autos: ≈ 70 GWh; mit
              Live-Verbindung wird der gemessene Wert des Energie Reporters verwendet.
              <span className="subtle">Bevölkerung und Verbrauch sind seit 2021 gewachsen (+5–10 %). Mobilität enthält auch Flugreisen und Bahn; erneuerbare Anteile pro Gruppe sind teilweise modelliert.</span>
            </div>
            <div className="src-item">
              <strong>Sommertag: 5.5 kWh pro kWp und Tag</strong>
              Typischer wolkenloser Junitag im Mittelland (Spanne 5–6 kWh/kWp). Tagesbedarf
              = Jahresstromverbrauch / 365, Sommer −8 %; elektrifizierter Tag + ~88 MWh
              für E-Mobilität.
              <span className="subtle">Bilanzbetrachtung über 24 h: Mittags entsteht ein Überschuss, abends eine Lücke – ohne Speicher ist «rechnerisch gedeckt» nicht «physisch autark». Wintertage liefern nur ~25 % eines Sommertags.</span>
            </div>
            <div className="src-item">
              <strong>Elektrifizierter Bedarf: ≈ 120 GWh pro Jahr</strong>
              Modell: heutiger Strom + fossile Heizungen ersetzt durch Wärmepumpen
              (Jahresarbeitszahl 3) + Strassenverkehr elektrisch (Effizienzfaktor 3).
              <span className="subtle">Unsicherheit ±20 GWh, abhängig von Sanierungen, Fernwärmeausbau und Verkehrsentwicklung.</span>
            </div>
            <div className="src-item">
              <strong>Gemeindevergleich: Indikatoren des Energie Reporters</strong>
              Solar-Ausnutzung, Anteil Steckerfahrzeuge und erneuerbares Heizen stammen aus
              derselben Live-Tabelle (alle Schweizer Gemeinden); der CH-Schnitt ist das
              ungewichtete Mittel aller Gemeinden.
              <span className="subtle">Ohne Live-Verbindung zeigt die Seite eingebettete Richtwerte (Stand 2026, ±einige Prozentpunkte) – der Status oben gilt auch hier. Die Solar-Ausnutzung der Nachbarn bezieht sich auf deren eigenes Potenzialmodell.</span>
            </div>
            <div className="src-item">
              <strong>Geldabfluss: ≈ CHF 25 Mio pro Jahr (Spanne 20–30)</strong>
              Modell: 57 GWh fossile Wärme × ~12 Rp./kWh + 96 GWh Treibstoffe × ~18 Rp./kWh.
              Stromwert der Solarproduktion: {GELD.stromwertRpKWh} Rp./kWh (vermiedener Einkauf).
              <span className="subtle">Preisniveaus 2025/26, stark abhängig von Öl-, Gas- und Treibstoffpreisen. «Im Dorf bleiben» heisst: Ausgaben verschieben sich zu lokaler Produktion, Installation und Unterhalt – ein Teil fliesst weiterhin an Hersteller ab.</span>
            </div>
            <div className="src-item">
              <strong>CO2-Modell: ~720 t pro zusätzlicher GWh Solarstrom</strong>
              Gilt, wenn der Strom via Wärmepumpen und E-Autos Heizöl, Gas und Treibstoff
              ersetzt (1 GWh Strom ≈ 3 GWh fossil). Obergrenze: ~40'000 t – die fossilen
              Emissionen aus Wärme und Strassenverkehr (Basis: 60'500 t Gesamtemissionen 2021).
              <span className="subtle">Solarstrom, der nur den heutigen CH-Strommix ersetzt, spart deutlich weniger – die grosse Wirkung entsteht erst zusammen mit der Elektrifizierung. Vergleichswerte: Retourflug ZRH–NY ≈ 2 t, Durchschnittsauto ≈ 1.8 t/Jahr, Erdumrundung im Benziner ≈ 6 t.</span>
            </div>
            <div className="src-item">
              <strong>Kosten: 1'800–2'800 CHF/kWp (klein) · 950–1'400 CHF/kWp (gross)</strong>
              Marktpreise Schweiz 2025/26 (Swissolar-Solarmonitor, EnergieSchweiz-Marktstudie,
              Anbieter-Richtpreise). Einmalvergütung des Bundes: grob 15 % der Investition.
              <span className="subtle">Preise ändern sich laufend; Netzausbau, Speicher und Rückbau sind nicht eingerechnet. Ab 2026 richtet sich die Rückliefervergütung nach Marktpreisen – das verändert die Wirtschaftlichkeit einzelner Anlagen, nicht aber die Grössenordnung hier.</span>
            </div>
          </div>
        </section>

        <footer>
          Verein Elektrisch · Solarpotenzial-Rechner Gemeinde Risch · Datenstand Juli 2026.
          Quellen: Energie Reporter (www.energiereporter.ch) – Daten: geoimpact AG /
          EnergieSchweiz, CC BY 4.0 · BFE Sonnendach.ch (Solarpotenziale der Schweizer
          Gemeinden, opendata.swiss) · Energie- und Klimastrategie Gemeinde Risch 2025 ·
          Swissolar &amp; EnergieSchweiz Marktbeobachtung. Wappen: Gemeinde Risch (Quelle: Wikimedia Commons). Alle Angaben sind Näherungen ohne Gewähr.
        </footer>
      </div>
    </div>
  );
}

/* Offizielles Gemeindewappen Risch (Quelle: Wikimedia Commons).
   Als Data-URI eingebettet, damit es auch im Claude-Artefakt erscheint.
   Kann durch die offizielle Datei der Gemeindekanzlei ersetzt werden. */
const WAPPEN = "data:image/png;base64,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";
