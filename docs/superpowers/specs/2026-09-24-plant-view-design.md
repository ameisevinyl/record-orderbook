# Plant view — design

Status: approved in conversation, pending written-spec review

## Context

A customer's project zip reaches the plant. Staff need to open it the
same way the customer reopens it locally, see every flagged problem at
once, and occasionally fix something (a phone-in quantity change, a
swapped artwork file) without changing customer data by accident.

This is sub-project 1 of the plant-side backend. Later sub-projects,
each with its own spec: (2) deep-check + proof CLI (Python: ffprobe/sox,
pikepdf/Ghostscript/Pillow), (3) price list + quote engine, (4) offer
display, quantity tolerance and order lifecycle in the customer tool,
(5) shipping estimate, (6) server with keyed customer links.

## Decisions

- **Separate file.** `build/build.js` also writes `dist/plant.html`.
  Customers never see a plant or god-mode switch; `dist/index.html` is
  unchanged.
- **Same modules, locked.** The plant view loads the project into the
  existing modules via `loadProject`, so files re-attach and every
  browser check runs again. No second implementation of the form or of
  issue detection.
- **"All problems shown"** means: the existing status checklist plus
  every artwork checklist, with debug-level rows and passed items
  visible. Warnings the customer dismissed with "send anyway" are not
  persisted; re-running the checks brings them back.

## Build

- `build.js` emits two outputs from the same `src/index.html` and
  `FILES` list. The plant output prepends `globalThis.PLANT_VIEW = true;`,
  inlines `src/plant.css` and appends `src/plant.js` after `src/app.js`.
- `src/lib/debug-mode.js` exports
  `const PLANT_VIEW = globalThis.PLANT_VIEW === true;` — the one
  declaration, so the flattened scope has no collision, and an unbundled
  `src/index.html` (dev) runs as the customer view.
- `isDebugMode()` returns true when `PLANT_VIEW` is true, which enables
  the plant-only checklist rows (PDF version, font embedding, "not
  detected" rows, shipping weights) with no further code.

## Locking and god mode

- The form content after the page header is wrapped in
  `<fieldset id="orderForm">`; the plant view sets `disabled` on load,
  which natively locks every input, select, textarea and button inside.
  The customer view never sets it.
- Toolbar toggle "Edit (god mode)" removes `disabled` and shows a red
  banner: "Editing — changes alter the customer's order". Toggling off
  restores the lock.
- Edits unlock file pickers too, so staff can swap an artwork file.
- Nothing saves automatically. A `beforeunload` warning fires while
  edits are unsaved.

## Layout (`src/plant.css`, `src/plant.js`)

- Sticky one-line toolbar: Open zip, Edit toggle, Save zip, and the
  project identity (catalogue number, customer email, date saved).
- The status checklist is pinned at the top.
- Hidden: info icons, placeholders, captions/hints, header decoration,
  and customer actions (Send to Plant, Print, Specs download).
- `plant.js` sets `open` on every `<details>` and CSS hides their
  `<summary>`, so spec boxes read as plain key/value rows.
- Artwork previews shrink to fixed ~160px thumbnails, still clickable
  for full size.
- 13px base font, tight padding; sections flow in columns on wide
  screens, same grouping and order as the customer form.
- Print behaviour is unchanged (existing `@media print` rules).

## Saving and history

- Save uses the existing `saveProject`; the zip gets today's
  `<YYMMDD>_<catalogue#>_<customer-email>` name.
- If anything was edited in god mode, Save first asks for a one-line
  note (e.g. "qty 300 → 500, per phone 24.09."). Save without edits
  (re-packaging) asks nothing.
- The note is appended to `project.json` as
  `history: [{ savedAt, by: "plant", note }]` (ISO timestamp) and
  printed as a History block at the end of `order_summary.txt`.
- The customer tool preserves `history` on load/save and ignores it
  otherwise; projects without the field load as before.
- Open issues never block Save in the plant view — staff decide.

## Error handling

Existing load path only: a broken zip or missing `project.json` already
reports an error in `loadProject`. Nothing plant-specific.

## Tests (`node --test tests/`)

- `prepareProject` keeps `history` through a save/load round trip and
  accepts projects without it.
- `buildOrderSummaryText` prints the History block when present, nothing
  when absent.
- Build: `dist/plant.html` contains `globalThis.PLANT_VIEW = true`, the
  plant CSS and `plant.js`; `dist/index.html` contains none of them.

## Out of scope

Prices/offers, CLI deep checks and proofs, server/links, field-level
diff of edits (the history note covers it).
