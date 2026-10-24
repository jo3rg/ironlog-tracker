# IRON.LOG

Eine schlanke Progressive Web App (PWA) zum Tracken von Krafttraining,
Körpergewicht und Ernährung. Läuft komplett offline, alle Daten werden
ausschließlich lokal im Browser gespeichert.

## Hosting / Installation

Die App wird als statische PWA ohne Backend gehostet. Für den Garmin-Workout-Export müssen `index.html`, `garmin.js`, `manifest.json` und `sw.js` gemeinsam bereitgestellt werden.

1. Die vier Dateien auf einen statischen HTTPS-Host legen
   (z.B. GitHub Pages, Netlify, Cloudflare Pages)
2. Die HTTPS-URL am Smartphone in Chrome öffnen
3. Menü → „Zum Startbildschirm hinzufügen"

Alternativ baut `npm run build` das auslieferbare Bundle nach `dist/`, das nur die sechs App-Dateien enthält. `npm run dist:all` erzeugt zusätzlich die `.FIT`-Workout-Dateien unter `dist/workouts/` für den Weg auf die Uhr. Der komplette Ablauf bis zur abgeschlossenen Aktivität steht in [`GARMIN-RELEASE-0.md`](GARMIN-RELEASE-0.md).

> HTTPS ist erforderlich, damit Kamera-Zugriff und PWA-Installation funktionieren.
> Garmin-Export erzeugt eine `.FIT`-Workout-Datei lokal im Browser; abgeschlossene
> Krafttrainings können als Original-`.FIT` aus Garmin Connect manuell zurückimportiert
> werden. Automatische Synchronisierung, Garmin-Konto-Verbindung und Live-Steuerung
> der Uhr gibt es nicht.

## Funktionen (Überblick)

- Trainings-Tracking mit Pausen-Timer und Fortschritts-Diagrammen
- Konfigurierbares Profil → automatische Kalorien-/Makro-Ziele
- Ernährungs-Tracking inkl. Barcode-Scanner
- Mehrere Trainingspläne, importier- und exportierbar
- Garmin-Workout-Export als `.FIT` und manueller Import abgeschlossener Krafttrainings aus Garmin Connect
- Daten-Export/Import als JSON (Backup)

Der manuelle Ablauf und die Checkliste für einen echten Garmin-Watch-Test stehen in [`GARMIN-RELEASE-0.md`](GARMIN-RELEASE-0.md).

## Daten & Privatsphäre

Alle Eingaben (Training, Körpergewicht, Ernährung) bleiben lokal auf dem
Gerät (localStorage). Es gibt keinen Server und keine Accounts. Der einzige
ausgehende Aufruf ist die Barcode-Abfrage an eine offene Lebensmittel-API.

**Empfehlung:** Regelmäßig ein Backup über die Export-Funktion erstellen.

## Trainingsplan-Import

Das Format zum Importieren eigener Pläne ist in `PLAN-FORMAT.md` beschrieben.

## Automatisierter Garmin-E2E-Test

Voraussetzungen: Node.js 20+, Python 3 und Playwright Chromium.

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

Die Suite startet IRON.LOG in Chromium und läuft ohne manuelles Dateikopieren:

| Spec | Prüft |
| --- | --- |
| `tests/garmin-export.spec.js` | Jeder Plantag erzeugt eine FIT-Datei, die das Garmin FIT SDK fehlerfrei liest (CRC, Schritte, Übungstitel) |
| `tests/garmin-import.spec.js` | Import einer abgeschlossenen Kraftaktivität: Sätze, Gewicht, Wiederholungen, Pausensätze, Zeitübungen, Datumsableitung, Ablehnung fremder Dateien, Duplikaterkennung |
| `tests/garmin-roundtrip.spec.js` | Kompletter Umlauf: Workout-Download aus der App, Aktivität im Speicher, Import, Sollwerte in der Historie |

Die Garmin-Seite ist simuliert: der Test baut echte FIT-Nachrichten, aber ohne Uhr und ohne Garmin Connect. Der Test ersetzt keinen Lauf auf einer echten Uhr, siehe `GARMIN-RELEASE-0.md`. In CI läuft die Suite über `.github/workflows/e2e.yml`. `package.json`, `playwright.config.js` und `tests/` gehören nur zur Entwicklung und werden nicht ausgeliefert.

## Aktualisierung

Hinweise zum Austausch der App-Datei stehen in `UPDATE.md`.
