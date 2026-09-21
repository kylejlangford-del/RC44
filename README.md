# RC44 — Artemis & Gemera

Browser-based tools for the RC44 team, under the Seagull Lab banner. Static site, served via GitHub Pages from the repo root.

## Tools

- **Main Battens** (`main-battens/`) — pick which of the 6 mainsail battens is installed on each boat, compare Artemis vs Gemera by name and EI (stiffness) side by side, and manage the inventory (add battens, decommission old ones).
- **Wind Calibrator** (`wind-calibrator/`) — load a B&G H5000 CSV log export and get suggested corrections for the wind-angle, wind-speed and boat-speed calibration tables, based on a port/starboard tack comparison during steady sailing.
- **Sail Shots** (`sail-shots/`) — filter historical sail scans by TWS, boat speed and max camber, and compare Artemis vs Gemera side by side, with an overlay view and the scan data in text boxes underneath for debriefs.

## How data gets updated

There's no backend — each tool edits its data in the browser (saved to `localStorage`) and offers **Download data.js**, which regenerates that tool's data file. Publishing an update means replacing the matching file in the repo (`main-battens/data.js`, `sail-shots/data.js`) via GitHub's **Add file → Upload files**, or asking Claude to do it directly against the repo.

New sail-shot photos added through the page are inlined as data URLs in local storage; before publishing, save each new photo as a real file under `sail-shots/photos/` and update its `file` path in the downloaded `data.js` (the download flags which ones still need this).

## Batten inventory — import notes (2026-09-21)

Seeded from the Artemis and Gemera batten spreadsheets:
- **Gemera** had a clear "currently installed" table plus a full inventory list per batten position — both imported.
- **Artemis** had several overlapping/inconsistent tables with no single reliable "currently installed" signal, so its full inventory catalog per position was imported but the installed picks were left unset. Set them once in the Main Battens page and `data.js` becomes the record from then on.
