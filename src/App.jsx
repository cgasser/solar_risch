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

/* ---------- Dach-Silhouette (Signatur-Element) ---------- */
const HOUSES = [
  { x: 0, w: 74, h: 52 }, { x: 84, w: 60, h: 70 }, { x: 154, w: 92, h: 44 },
  { x: 256, w: 56, h: 84 }, { x: 322, w: 110, h: 58 }, { x: 442, w: 66, h: 96 },
  { x: 518, w: 88, h: 50 }, { x: 616, w: 120, h: 74 }, { x: 746, w: 62, h: 46 },
  { x: 818, w: 96, h: 62 }, { x: 924, w: 76, h: 88 },
];

function Skyline({ pct }) {
  const t = Math.max(0, Math.min(1, pct / 100));
  const sunX = 50 + 900 * t;
  const sunY = 96 - 78 * Math.sin(Math.PI * (0.12 + 0.76 * t));
  const roofs = HOUSES.map((h, i) => {
    const yTop = 150 - h.h;
    return (
      <g key={i}>
        <rect x={h.x} y={yTop} width={h.w} height={h.h} />
        <polygon
          points={`${h.x - 5},${yTop} ${h.x + h.w + 5},${yTop} ${h.x + h.w / 2},${yTop - 22}`}
        />
      </g>
    );
  });
  return (
    <svg viewBox="0 0 1000 152" className="skyline" role="img"
      aria-label={`Dach-Silhouette: ${pct} Prozent des Solarpotenzials belegt`}>
      <defs>
        <clipPath id="fillclip">
          <rect x="0" y="0" width={1000 * t} height="152" />
        </clipPath>
      </defs>
      <circle cx={sunX} cy={sunY} r="17" className="sun" />
      <circle cx={sunX} cy={sunY} r="26" className="sun-halo" />
      <g className="roof-base">{roofs}</g>
      <g className="roof-solar" clipPath="url(#fillclip)">{roofs}</g>
      <line x1="0" y1="151" x2="1000" y2="151" className="ground" />
    </svg>
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

function Bar({ label, mwh, max, tone, note }) {
  const w = Math.min(100, (mwh / max) * 100);
  return (
    <div className="dbar">
      <div className="dbar-head">
        <span>{label}</span>
        <span className="mono">{f(mwh)} MWh</span>
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

        header{padding:56px 0 8px}
        .statgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:30px 0 8px}
        .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
        .stat-value{font-family:'IBM Plex Mono',monospace;font-size:30px;font-weight:600}
        .stat-unit{font-size:15px;margin-left:5px;color:var(--ink-soft);font-weight:500}
        .stat-label{font-size:13.5px;color:var(--ink-soft);margin-top:4px}

        section{padding:44px 0}
        .card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px}
        .subtle{color:var(--ink-soft);font-size:14.5px}

        .skyline{width:100%;height:auto;display:block;margin:8px 0 4px}
        .roof-base rect,.roof-base polygon{fill:#C4D4DD}
        .roof-solar rect{fill:var(--graphite)}
        .roof-solar polygon{fill:var(--amber)}
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
          <div className="eyebrow">Verein Elektrisch · Gemeinde Risch</div>
          <h1>Wie viel Sonne steckt in unseren Dächern?</h1>
          <p className="lead">
            Der Solarpotenzial-Rechner zeigt für Risch, Rotkreuz, Buonas und Holzhäusern,
            was unsere Dächer heute leisten, was möglich wäre – und was uns das kosten würde.
            Alle Werte sind sorgfältige Näherungen; die Annahmen finden Sie ganz unten.
          </p>
          <div className="badge" role="status">
            <span className={`badge-dot ${status}`} />
            {statusText}
          </div>
          <div className="statgrid">
            <Stat value="64.6" unit="GWh/Jahr" label="Solarstrom-Potenzial aller geeigneten Dächer (BFE, Ausgabe 2025)" />
            <Stat
              value={`≈ ${f(base.heuteGWh, 1)}`} unit="GWh/Jahr"
              label={`heute produziert – rund ${base.heutePct} % des Potenzials${live?.installedKwp ? ` (${f(live.installedKwp / 1000, 1)} MWp installiert)` : ""}`}
            />
            <Stat value={f(base.stromGWh, 0)} unit="GWh/Jahr" label="Stromverbrauch der ganzen Gemeinde inkl. Wärmepumpen" />
            <Stat value="290" unit="GWh/Jahr" label="gesamter Energieverbrauch inkl. Verkehr und Heizen (2021)" />
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
              <div className="res blue">
                <div className="res-big">≈ {f(c.netto / 1e6, 0)} Mio</div>
                <div className="res-lbl">CHF Investition für diesen Ausbau (Details im Kostenrechner)</div>
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
          <h2>Der Verlauf: langsam, aber stetig</h2>
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
          Swissolar &amp; EnergieSchweiz Marktbeobachtung. Alle Angaben sind Näherungen ohne Gewähr.
        </footer>
      </div>
    </div>
  );
}
