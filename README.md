# dnd-dm-board-digi

Ein lokal laufendes digitales DM-Board für D&D-Sessions – als Ersatz für das physische DM-Board am Spieltisch. Reine DM-Ansicht, kein Account, keine Cloud: läuft komplett offline auf dem eigenen Rechner, alle Daten werden dauerhaft in einer lokalen Datei gespeichert und beim Serverstart automatisch geladen.

## Funktionen

- **Initiative-Tracker** – Kämpfer hinzufügen (Spieler/NPC/Monster), Initiative/HP/RK direkt inline bearbeiten, Schaden/Heilung per Klick, Zustände (Vergiftet, Liegend, Bewusstlos, …) zuweisen, Runde & aktuellen Zug verfolgen (Weiter/Zurück).
- **NPC- & Monster-Bibliothek** – Statblocks anlegen (RK, HP, Attribute, Fähigkeiten, Aktionen, Tags), durchsuchen/filtern, mit einem Klick (auch mehrfach, z. B. „3 Goblins“, optional mit automatisch gewürfelter Initiative) zum laufenden Kampf hinzufügen.
- **Session-/Kampagnen-Notizen** – Notizen mit Titel, Tags und Freitext anlegen, durchsuchen und bearbeiten.
- **Würfelwurf-Tool** – Schnellwürfe (W4–W100), Vorteil/Nachteil für W20, eigene Ausdrücke wie `2W6+3`, Wurfverlauf mit Einzelwürfen.

Alle Änderungen werden sofort auf der Festplatte gespeichert (`data/db.json`) – ein Neustart des Servers stellt den letzten Stand automatisch wieder her.

## Installation & Start

Voraussetzung: [Node.js](https://nodejs.org/) ab Version 18.

```bash
npm install
npm start
```

Danach im Browser öffnen: **http://localhost:3000**

Der Port lässt sich bei Bedarf über die Umgebungsvariable `PORT` ändern, z. B. `PORT=4000 npm start`.

Zum Entwickeln mit automatischem Neustart bei Codeänderungen:

```bash
npm run dev
```

## Daten & Speicherort

Alle Daten (Kampf, Bibliothek, Notizen, Würfelverlauf) liegen in `data/db.json`. Diese Datei wird beim ersten Start automatisch angelegt. Zum Sichern oder Übertragen der Kampagne genügt es, diese eine Datei zu kopieren.

## Technik

- Backend: Node.js + Express, liefert eine REST-API und die statischen Frontend-Dateien aus.
- Frontend: reines HTML/CSS/JavaScript ohne Build-Schritt und ohne externe Abhängigkeiten – funktioniert vollständig offline.
