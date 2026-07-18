# Solarpotenzial-Rechner Gemeinde Risch · Verein Elektrisch

Interaktive Website: Solarpotenzial, aktuelle Produktion, Verbrauch und
Ausbaukosten für die Gemeinde Risch (BFS-Nr. 1707) – mit automatischer
Datenanbindung an den «Energie Reporter» (geoimpact / EnergieSchweiz, CC BY 4.0).

Technik: Vite + React (statische Website) + kleiner PHP-Proxy für die Live-Daten.

---

## 1. Einmalige Einrichtung auf dem Notebook

Voraussetzungen: [Node.js LTS](https://nodejs.org) (Version 20+) und Git.

```bash
# Projekt entpacken, dann im Projektordner:
npm install        # Abhängigkeiten installieren
npm run dev        # lokale Vorschau auf http://localhost:5173
npm run build      # erzeugt den fertigen Website-Ordner "dist/"
```

Hinweis zur lokalen Vorschau: Der PHP-Proxy (`/api/energiereporter.php`)
läuft nur auf dem Server. Lokal springt die App automatisch auf den
Direktabruf bzw. die eingebetteten Werte um – der Status wird oben auf
der Seite angezeigt.

## 2. GitHub-Repository anlegen

```bash
git init
git add .
git commit -m "Solarpotenzial-Rechner Risch"
git branch -M main
git remote add origin git@github.com:IHR-KONTO/solar-risch.git
git push -u origin main
```

(Repository vorher leer auf github.com anlegen; privat reicht.)

## 3. Infomaniak vorbereiten (einmalig, ca. 10 Minuten)

Wichtig: Es braucht ein bezahltes Webhosting (Apache/PHP). Das
Gratis-«Starter»-Hosting hat kein SSH und funktioniert mit diesem
Workflow nicht.

1. **Site anlegen:** Manager → Webhosting → «Website hinzufügen»,
   z.B. `solar.ihredomain.ch` (SSL/Let's-Encrypt ist automatisch dabei).
2. **FTP/SSH-Benutzer:** Im Hosting links «FTP/SSH» → Konto mit
   FTP **und** SSH-Rechten anlegen. Notieren:
   - Host: `xxxxx.ftp.infomaniak.com`
   - Benutzername
   - Zielpfad der Site, z.B. `/home/clients/XXXXXXXX/sites/solar.ihredomain.ch/`
     (im Manager unter der Site ersichtlich; `XXXXXXXX` ist Ihre Kunden-ID)
3. **SSH aktivieren:** Im Hosting unter FTP/SSH sicherstellen, dass
   SSH für das Konto eingeschaltet ist.

## 4. SSH-Schlüssel für das automatische Deployment

Auf dem Notebook (Terminal / Git Bash):

```bash
# WICHTIG: Infomaniak akzeptiert nur ed25519-Schlüssel, RSA wird abgelehnt.
ssh-keygen -t ed25519 -C "github-deploy" -f ~/.ssh/infomaniak_deploy -N ""

# Öffentlichen Schlüssel auf den Server bringen (Passwort des FTP/SSH-Kontos):
ssh BENUTZER@xxxxx.ftp.infomaniak.com "mkdir -p ~/.ssh && chmod 700 ~/.ssh"
cat ~/.ssh/infomaniak_deploy.pub | ssh BENUTZER@xxxxx.ftp.infomaniak.com "cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# Test (sollte ohne Passwort funktionieren):
ssh -i ~/.ssh/infomaniak_deploy BENUTZER@xxxxx.ftp.infomaniak.com "echo OK"
```

## 5. GitHub-Secrets setzen

GitHub → Ihr Repository → Settings → Secrets and variables → Actions →
«New repository secret», vier Stück:

| Secret           | Wert                                                        |
|------------------|-------------------------------------------------------------|
| `DEPLOY_HOST`    | `xxxxx.ftp.infomaniak.com`                                  |
| `DEPLOY_USER`    | Ihr FTP/SSH-Benutzername                                    |
| `DEPLOY_SSH_KEY` | kompletter Inhalt von `~/.ssh/infomaniak_deploy` (privat!)  |
| `DEPLOY_PATH`    | z.B. `/home/clients/XXXXXXXX/sites/solar.ihredomain.ch/`    |

## 6. Fertig – ab jetzt gilt:

```bash
git add .
git commit -m "Änderung XY"
git push
```

→ GitHub baut die Seite und lädt sie automatisch zu Infomaniak hoch
(Reiter «Actions» im Repository zeigt den Fortschritt). Nach 1–2 Minuten
ist die Änderung live.

---

## Datenquellen & Lizenz

- Energie Reporter – Daten: geoimpact AG / EnergieSchweiz, CC BY 4.0
  (Quellennennung ist im Seitenfooter enthalten und muss bestehen bleiben)
- BFE Sonnendach.ch: Solarpotenziale der Schweizer Gemeinden (opendata.swiss)
- Energie- und Klimastrategie der Gemeinde Risch, 2025
- Marktpreise: Swissolar / EnergieSchweiz

## Projektstruktur

```
index.html                    Einstiegsseite
src/App.jsx                   der gesamte Rechner (Design, Logik, Texte)
src/main.jsx                  React-Start
public/api/energiereporter.php  Daten-Proxy mit 12h-Cache (läuft auf Infomaniak)
.github/workflows/deploy.yml  automatisches Deployment
```

Zahlen anpassen: Alle eingebetteten Basiswerte stehen zuoberst in
`src/App.jsx` im Objekt `D` (Potenzial, Verbrauch, Preise usw.).
