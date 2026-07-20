# CLAUDE.md — Solarpotenzial-Rechner Gemeinde Risch

## Projekt

Interaktive Website des **Vereins Elektrisch** für die Gemeinde Risch (Rotkreuz,
Buonas, Holzhäusern; **BFS-Nr. 1707**, Kanton Zug). Ziel: Der Bevölkerung einfach
und ehrlich zeigen, wie viel Solarpotenzial die Dächer haben, wie viel heute
genutzt wird, was der Ausbau kostet und was er bringt (Franken, CO2,
Unabhängigkeit). Zielgruppe: Laien — vor Budgetabstimmungen, Renovationen,
Neuanschaffungen.

## Tech-Stack & Befehle

- Vite + React 18, `papaparse`. Bewusst **kein** TypeScript, Tailwind oder UI-Framework.
- `npm install` · `npm run dev` (localhost:5173) · `npm run build` (→ `dist/`) · `npm run preview`
- **Nach jeder Änderung muss `npm run build` fehlerfrei durchlaufen.**

## Struktur

```
src/App.jsx                      DIE gesamte App in einer Datei (bewusst so):
                                 Konstanten → ZIP-Parser → Komponenten → Sektionen,
                                 CSS im <style>-Tag der Komponente
src/main.jsx                     React-Einstieg
public/api/energiereporter.php   Daten-Proxy mit 12h-Cache; wird von Vite 1:1 nach
                                 dist/api/ kopiert; läuft NUR auf dem Server (PHP)
.github/workflows/deploy.yml     Push auf main → Build → rsync zu Infomaniak
```

## Deployment

Push auf `main` deployt automatisch (GitHub Actions → rsync über SSH zu
Infomaniak). Secrets im Repo: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`
(ed25519!), `DEPLOY_PATH`. **Achtung:** rsync läuft mit `--delete` — falscher
`DEPLOY_PATH` löscht fremde Dateien im Zielordner.

## Datenarchitektur (wichtig)

1. **Eingebettete Basiswerte** = Fallback, Stand Juli 2026 (Objekte `D`, `HISTORY_EST`, `COMPARE`, `CH_EST`, `GELD`, `CO2`, `PRICE` — alle zuoberst in `App.jsx`).
2. **Live-Daten**: Energie Reporter (geoimpact/EnergieSchweiz, CC BY 4.0) als ZIP.
   `fetchCsvFromZip` probiert URLs der Reihe nach: zuerst `/api/energiereporter.php`
   (gleiche Domain → kein CORS), dann Direktabruf `opendata.geoimpact.ch`.
3. ZIPs werden **im Browser** entpackt: eigener Mini-Parser (`unzip`) +
   nativer `DecompressionStream('deflate-raw')` — keine Zusatzbibliothek einführen.
4. Filter: `bfs_nr === 1707`. Vergleichsgemeinden: Baar 1701, Cham 1702,
   Hünenberg 1703, Steinhausen 1708, Zug 1711.
5. CSV-Spaltennamen defensiv über `pickNum(row, COLS.xxx)` auflösen — der
   Energie Reporter kann Spalten umbenennen. Verifiziert: `bfs_nr`,
   `solar_potential_usage`, `solar_power_installed_kwp`,
   `renelec_production_solar_mwh_per_year`, `elec_consumption_mwh_per_year`.
   Noch **unverifiziert** (Kandidatenlisten in `COLS`): E-Auto- und
   Heizungs-Spalten → nach erstem Live-Betrieb im Browser-Log prüfen und fixieren.
6. Status-Badge (`loading | live | fallback`) zeigt immer an, welche Daten aktiv
   sind — dieses Prinzip nie entfernen.

## Zentrale Kennzahlen (Quellen)

| Wert | Zahl | Quelle |
|---|---|---|
| Dach-Solarpotenzial | 64.6 GWh/a | BFE Sonnendach.ch, Ausgabe 2025 |
| inkl. Fassaden | 88.8 GWh/a | BFE Sonnendach.ch, Ausgabe 2025 |
| Verbrauch total | 290 GWh/a (130 Mobilität / 118 Wärme / 42 Strom) | Energie- und Klimabilanz Gemeinde Risch, Bilanzjahr 2021 (OekoWatt) |
| Strom inkl. WP/Boiler/E-Autos | ≈ 70 GWh/a | dito, hergeleitet |
| Elektrifizierter Bedarf | ≈ 120 GWh/a | Modell: WP JAZ 3, E-Auto-Faktor 3 |
| CO2 | 60'500 t/a total, ~40'000 t fossil vermeidbar | Gemeindebilanz 2021 |
| Fossiler Geldabfluss | ≈ CHF 25 Mio/a (20–30) | Modell aus 57 GWh Wärme + 96 GWh Treibstoff |
| Kosten | 1'800–2'800 CHF/kWp klein · 950–1'400 gross | Swissolar/EnergieSchweiz 2025/26 |

## Grundprinzipien (nicht verletzen)

1. **Transparenz:** Jede Zahl und jedes Modell MUSS im Abschnitt
   «Daten, Annahmen & Fehlerquellen» dokumentiert sein. Neues Feature mit neuen
   Annahmen → neuer `src-item`-Eintrag dort.
2. **Ehrlichkeit vor Werbung:** Einschränkungen (Winterlücke, Mittagsspitze,
   Speicherbedarf) bleiben sichtbar. Das ist die Glaubwürdigkeitsbasis des Vereins.
3. **Sprache:** Schweizer Hochdeutsch, **ss statt ß**. Zahlen immer über den
   Helfer `f()` formatieren (de-CH, Apostroph-Tausender).
4. **Lizenz:** CC-BY-Quellennennung (Energie Reporter, geoimpact, EnergieSchweiz)
   im Footer muss bestehen bleiben.
5. **Design-System:** Farben nur über CSS-Variablen (`--amber`, `--ink`,
   `--green`, `--clay`, …), Fonts Archivo (Titel, font-stretch 125%) +
   IBM Plex Sans/Mono (Zahlen = Mono). Bestehende Bausteine wiederverwenden
   (`.card`, `.res`, `.dbar`, `.cmp-row`, `Stat`, `Bar`).
6. `App.jsx` bleibt eine Datei, solange wartbar — sie dient auch 1:1 als
   Claude-Artefakt. Deshalb: keine Browser-Storage-APIs (localStorage etc.),
   keine neuen Imports ausser `react`/`papaparse` ohne guten Grund.

## Stolperfallen

- **JSX-Text interpretiert `\uXXXX` NICHT** — immer echte UTF-8-Zeichen
  (ä, ö, ü, –, «») direkt schreiben. Das hat schon einmal gebissen.
- `public/` wird unverändert nach `dist/` kopiert; der PHP-Proxy funktioniert
  lokal (`npm run dev`) nicht → App fällt auf Direktabruf/Fallback zurück,
  Badge zeigt es an. Das ist erwartetes Verhalten, kein Bug.
- Slider-Minimum ist dynamisch (`base.heutePct`); der `setPct`-Effekt zieht den
  Regler nach, sobald Live-Daten eintreffen — bei Änderungen an der Live-Logik
  mitdenken.
- Energie-Reporter-Anteile können als Bruch (0–1) oder Prozent kommen →
  `toPct()`-Guard beibehalten.

## Typische Aufgaben

- **Zahlen aktualisieren:** nur die Konstanten-Objekte zuoberst ändern und den
  passenden Fehlerquellen-Text nachführen.
- **Vergleichsgemeinde tauschen:** `COMPARE` (BFS-Nummer beachten).
- **Neue Sektion:** Muster `<section><h2>…</h2><p className="subtle">…</p>
  <div className="card">…</div></section>` übernehmen; wenn sie vom
  Master-Slider abhängen soll, aus `pct` bzw. `c`/`geld` ableiten.

## Backlog (mit Verein besprochen, noch nicht gebaut)

- «Was bedeutet das für mich?»: Haustyp-Rechner (EFH/MFH/Gewerbe) mit
  Amortisation + Link auf sonnendach.ch (eigenes Dach per Adresse)
- Ziel-Tracker 2050: Soll/Ist-Zubaupfad («3× schneller nötig»)
- Renovations-Wegweiser: Checkliste + Förderungen Bund/Kanton Zug/Steuerabzug
- Erfolgsgeschichten aus dem Dorf, Social-Media-Teilkarten
- Live-Anzeige «Sonnenproduktion jetzt»
- E-Auto-/Heizungs-Spaltennamen nach erstem Live-Betrieb fixieren

## Grafik-Assets

- **Skyline** (`Stadt`/`Skyline` in `App.jsx`): stilisierte Rotkreuzer Wahrzeichen
  v.l.n.r.: Dorfkirche St. Verena (Risch), Schloss Buonas, Bauernhaus
  Holzhäusern, Bahnhof Rotkreuz mit roter S-Bahn, rotes Wegkreuz (Namensgeber!),
  Kirche Rotkreuz, Suurstoffi/Campus HSLU, Holzhochhaus Arbo, Aglaya mit
  begrünten Terrassen, Wohnquartier; Hintergrund Rigi + Zugersee.
  S-Bahn und Wegkreuz bleiben in beiden Zuständen rot (Wiedererkennungs-Anker).
- **Wappen**: offizielles Gemeindewappen als Data-URI-Konstante `WAPPEN` am
  Dateiende (9 KB, quantisiert; Quelle Wikimedia Commons, zusätzlich als
  `public/wappen-risch.png`). Positioniert rechts oben im Seitenkopf
  (`.wappen-img`). Für die finale Website: offizielle Datei + Verwendungs-OK
  bei der Gemeindekanzlei anfragen, dann ggf. austauschen.

## Offenes Feedback (Lukas, Juli 2026) — noch NICHT umgesetzt

- Byline «Vorgestellt von Verein Elekt-Risch»: Schreibweise «Elekt-Risch» bestätigen lassen
- Sommertag-Abschnitt: Unklar, welche «Box» weggelassen werden soll (dritte
  Balkenzeile E-Autos? Fazit-Box?); zusätzlich Wintertag-Balken (~25 % des
  Sommerertrags) einbauen, sobald geklärt
- Kleine Notizen unter den Schieber-Ergebniskarten (evtl. Einheiten zusätzlich
  in kWh erklären, «Ende 2025/2035»?): Bedeutung beim Team nachfragen
