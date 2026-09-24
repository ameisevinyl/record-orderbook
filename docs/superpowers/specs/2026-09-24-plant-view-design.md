# Plant view — design

Status: approved in conversation, pending written-spec review.
Replaces the earlier plant-view design (customer form reused, locked,
god mode), which was built on branch `plant-view` and rejected after a
browser review: it copied the customer frontend and read as cluttered.

## Context

A customer's project zip reaches the plant. Staff first want a quick
overview of what was supplied and whether it is complete. Complete →
run the deep, on-disk checks (next sub-project). Incomplete → staff see
the gaps and decide (e.g. send a quote anyway).

The plant view does not repeat the customer tool's browser checks and
shows no specs — staff know them. Real checks run later with backend
tools (ffprobe/sox, pikepdf/Ghostscript/Pillow) on the files on disk.

Later sub-projects, each with its own spec: deep checks on disk,
inquiry/order/change detection and the inbox/quotes/orders/done
folders, price list + quote engine, offers in the customer tool,
shipping estimate, customer links from the same server, editing.

## Architecture

- **`plant/server.py`** — Python ≥3.10, standard library only
  (`http.server`, `zipfile`, `json`, `pathlib`). Binds `127.0.0.1` only.
  Run: `python3 plant/server.py` (port 8765, `--port` to change).
  - `GET /` → `src/plant/index.html`; `GET /src/...` → files under the
    repo's `src/` (ES modules, no build step).
  - `POST /api/open` — body is the zip, header `X-Filename` its name.
    Unpacks into `plant/work/<zip stem>/` (gitignored; replaced if it
    exists) and returns JSON
    `{name, project, files: [{name, size}]}` where `project` is the raw
    `project.json` and `files` lists every other entry, names relative
    to the project folder.
  - Unpacking is safe: rejects absolute paths, `..` segments, symlink
    entries and duplicate names; requires exactly one `project.json`.
    Errors return HTTP 400 with a plain-text message.
- **`src/plant/index.html` + `src/plant/app.js`** — the page. Imports
  `CONFIG` and `src/lib` directly. Page flow: Load project → POST the
  zip → `prepareProject(project, CONFIG)` → render.
- **`src/lib/completeness.js`** — pure: `projectGaps(project, config,
  files)` → `[{group, text}]`. Builds on existing `src/lib` rules.
- **`src/lib/plant-overview.js`** — pure: `renderOverview(project,
  config, files)` → HTML string.

The customer tool is unchanged. Its status checklist does similar checks
from the DOM (`updateChecklist` in `tracklist.js`); moving it onto
`completeness.js` so both views share one rule set is a separate
follow-up.

## Page

- Only a Load project button until something is loaded. Then, top to
  bottom: zip name + catalogue number / title / artist, the completeness
  list, the overview.
- Completeness list: one line per gap, prefixed with its group. None →
  "Complete — ready for checks".
- Overview, in customer form order: Release, Side A, Side B, Notes,
  Labels, Inner sleeve, Cover, Inlay, Vinyl colour & quantity, Billing,
  Shipping, History (when present). Each group: a heading plus
  `label  value` rows. Tracklist per side as a table (position, title,
  artist, length, gap, file) with total playing time against the
  format's limits. Referenced files are shown with their size, missing
  ones marked "missing".
- No specs, previews, form controls or toggles. Font and colour
  variables copied from the customer sheet into a small stylesheet in
  `src/plant/index.html`.
- All project text is HTML-escaped.

## Completeness rules (`projectGaps`)

Group → gap:

- Release: no catalogue number.
- Side A/B (B skipped when blank): continuous side without its audio
  file, or with an unparseable length (an empty continuous length is
  fine — the deep check measures it); otherwise no tracks, a track
  without an audio file, a track length missing or unparseable
  (`parseTime`); total over the format's max for its rpm and cut
  (`computeStatus` level `danger`).
- Files: a file named in `project.json` that the production choices need (same rule as
  `includeSideFile` with `forSend: true`, plus artwork below) that is
  not among `files` (chosen by the customer but missing from the zip —
  distinct from the "no file" gaps below).
- Labels: a side that isn't whitelabel has no file (a blank side B
  still gets a physical label — same rule as the customer tool).
- Inner sleeve / Cover / Inlay: a printed product selected without its
  artwork file(s) (inlay: front and back).
- Quantity: no vinyl colour row with a quantity; an invalid quantity;
  a colour below `minOrderQty` (`belowMinimum`).
- Billing: `missingAddressFields`; malformed email
  (`emailFormatValid`).
- Shipping: no address; per address `missingAddressFields`; shipped
  quantities per colour exceed the pressed quantity or are invalid
  (`allocateQuantities`; the first address takes the remainder by
  design, so a remainder is not a gap).

## Errors

Server errors (not a zip, no/duplicate `project.json`, unsafe path) and
`prepareProject` errors are shown as one message at the top; nothing is
rendered half. The previous overview is cleared on a new load.

## Branch cleanup (`plant-view`)

Revert: `<fieldset id="orderForm">` wrapper and its CSS, `PLANT_VIEW`
in `debug-mode.js` and its test, the `dist/plant.html` build target and
`tests/build.test.js`, `src/plant.js`, `src/plant.css`,
`src/lib/plant-view.js` and its test, the `projectloaded` event, the
plant-view lines in `CLAUDE.md`, the old plan
`docs/superpowers/plans/2026-09-24-plant-view-plan.md`.
Keep: `history` in `prepareProject`/`historyEntry`, carrying it through
customer load/save, and the HISTORY block in `order_summary.txt`.

## Docs

`CLAUDE.md`: the `python3 plant/server.py` command next to the build
command, and one Architecture bullet for `plant/` + `src/plant/`.

## Tests

- `node --test tests/`: `completeness.test.js` (each gap, a complete
  project → `[]`); `plant-overview.test.js` (values present, missing
  file marked, text escaped).
- `python3 -m unittest discover plant`: `plant/test_server.py` — valid
  zip unpacks and lists sizes; absolute path, `..` and symlink entries
  rejected; missing and duplicate `project.json` rejected.

## Out of scope

Deep checks, inquiry/order/change detection, folders, editing, quotes,
the customer checklist refactor. Editing (god mode, e.g. phone-in
changes) may later reuse the customer form; the overview does not.
