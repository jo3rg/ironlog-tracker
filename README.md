# IRON.LOG

Eine schlanke Progressive Web App (PWA) zum Tracken von Krafttraining,
Körpergewicht und Ernährung. Läuft komplett offline, alle Daten werden
ausschließlich lokal im Browser gespeichert.

## Hosting / Installation

Die App ist eine statische PWA ohne Backend. Baue und hoste das komplette Bundle:

1. `npm run build` ausführen.
2. Alle Dateien aus `dist/` auf einen statischen HTTPS-Host legen (z. B. GitHub Pages, Netlify oder Cloudflare Pages).
3. Die HTTPS-URL am Smartphone in Chrome öffnen.
4. Menü → „Zum Startbildschirm hinzufügen“.

`npm run dist:all` baut das Bundle und erzeugt zusätzlich `.FIT`-Workout-Dateien unter `dist/workouts/`.

> HTTPS ist erforderlich, damit Kamera-Zugriff und PWA-Installation funktionieren.
> Garmin-Workouts können als `.FIT` exportiert und direkt per Bluetooth oder
> USB an die Uhr übertragen werden. Für Garmin Connect gibt es zusätzlich einen
> strukturierten Workout-JSON-Export, den du mit einer Drittanbieter-Erweiterung
> in Connect importierst; Connect bietet selbst keinen JSON-Workout-Import.
> Diese Erweiterung erhält Zugriff auf deine Connect-Sitzung. Prüfe den Anbieter,
> bevor du sie installierst. Abgeschlossene Krafttrainings können als Original-
> `.FIT` aus Garmin Connect manuell zurückimportiert werden. Die PWA speichert
> keine Garmin-Zugangsdaten und verbindet sich nicht mit dem Connect-Konto.

## Funktionen (Überblick)

- Trainings-Tracking mit Pausen-Timer und Fortschritts-Diagrammen
- Konfigurierbares Profil → automatische Kalorien-/Makro-Ziele
- Ernährungs-Tracking inkl. Barcode-Scanner
- Mehrere Trainingspläne, importier- und exportierbar
- Garmin-Workout-Export als `.FIT` und Garmin-Connect-Workout-Export als `.json`
  (Import in Connect nur mit einer Drittanbieter-Erweiterung), direkter
  Bluetooth-Transfer und manueller Import abgeschlossener Krafttrainings
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
| `tests/garmin-codec.spec.js` | Protobuf- und COBS-Kodierung der Bluetooth-Nachrichten |
| `tests/garmin-ble.spec.js` | Upload zur Uhr gegen eine Mock-Uhr: Sitzungsaufbau, Datei anlegen, Byte-Transfer mit laufender CRC, Ablehnung durch die Uhr |
| `tests/garmin-ble-ui.spec.js` | Bluetooth-Knopf in der App und die Fehlermeldung ohne Web Bluetooth |
| `tests/garmin-connect.spec.js` | Connect-Workout-JSON-Struktur, Gewichts-/Satz-/Pausenwerte, nicht zugeordnete Übungen und App-Download |

Die Garmin-Seite ist simuliert: FIT- und Workout-JSON werden lokal geprüft. Die Suite spricht das Bluetooth-Protokoll gegen eine nachgebaute Uhr, aber weder mit Garmin Connect noch mit einer echten Uhr. Sie ersetzt keinen Hardwaretest; Details stehen in `GARMIN-RELEASE-0.md`. In CI läuft die Suite über `.github/workflows/e2e.yml`. `package.json`, `playwright.config.js` und `tests/` gehören nur zur Entwicklung und werden nicht ausgeliefert.

## Aktualisierung

Hinweise zum Austausch der App-Datei stehen in `UPDATE.md`.
