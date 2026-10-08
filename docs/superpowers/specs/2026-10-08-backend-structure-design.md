# Backend structure: dashboard, staff order view, quote

Status: design, awaiting review. Four sub-projects, each gets its own plan:
1 server shell, 2 dashboard (with role presets), 3 staff order view, 4 quote
and PRICING.

## Goal

The plant view becomes the plant's staff app on its own server: an overview of
all orders for the boss, the customer frontend as the order view for staff, and
the pricelist / plant-config helpers working on the files on disk. The
customer page stays one offline file; only the staff side needs the server.

## Decisions

- **Access:** no login. Staff mode is read-only for everything the customer
  sent. God mode is a deliberate toggle (confirmation); every change in it is
  written to `history` as text. This stops accidents, not a determined person
  on the LAN. A PIN or users can later sit behind the same toggle; the server
  owns all writes, so the check lives in one place (`/api/project`).
- **Column state:** production lines (`CONFIG.lines`, `src/lib/lines.js`),
  derived on every scan from check results and `plant.lines` (append-only log,
  entries count while their files keep their sha256).
- **Order view:** `index.html` in staff mode, not a copy and not an iframe.
- **Quote:** a file `price_quote.json` in the job folder, no stage, no gate.
- **State** stays in each job's `project.json` (+ `price_quote.json`); Python
  does disk and serving, the pages decide.

## 1 Server shell and helpers

One staff app with a menu: Dashboard, Archive, Pricelist, Plant config, later
Fixers. Dashboard and Archive are hash routes of one page (as the plant view
now). The order view (3), Pricelist and Plant config are pages of their own
(`/order/<job>`, `sheet.css` pages); a dashboard row click navigates to the
order page.

- `GET` and `POST /api/staff-file?name=pricelist|plant-config` (POST so the
  JSON-only guard applies) read and write the real files (`src/pricelist.json`, `src/plant.config.local.js`). The page keeps
  parsing, validating and formatting (`lib/pricelist.js`, `lib/plant-config.js`);
  Python writes atomically and refuses with 409 when the file changed since the
  page read it (same rule as `project.json`). Served by the server, the pages
  read the live `src/` files, no rebuild; Open/Save-as-download stays for the
  standalone `dist/` pages.
- Menu bar: Plant view, Pricelist, Plant config (one list, `src/lib/menu.js`)
  beside the Load zip / Load folder buttons (existing `/api/upload*`). Archive
  and Fixers join with their parts.
- Small enough to land as the first commit of 2.

## 2 Dashboard (the board)

Sketch: `docs/kanban_board_template.csv`. The German chain is the model:
Anfrage (INBOX), Angebot (QUOTES), Angebotsbestätigung (the job moves from
INBOX to PREPRESS), Auftrag (production lanes, and INVOICE at the same
time), Lieferschein, Rechnung.

- **A kanban, not a table per order:** columns are lanes (`CONFIG.board`),
  orders are cards (the catalogue number, linking to the order) in every lane
  whose line is open for them: on the order, not done, not waiting for an
  earlier line. The same order can sit in several lanes. Two header rows
  (groups, lanes), sticky; pure rendering in `src/lib/dashboard.js`.
- **Columns:** INBOX · QUOTES · PREPRESS (MASTERING, PLATING, LABELS,
  SLEEVES, COVERS, INLAYS) · PRESS (TESTPRESS, PRESS, PACK, INVOICE, SHIP) · DONE.
  INBOX and DONE show the jobs in their stage folder; QUOTES the jobs in the
  INBOX folder that have a `price_quote.json` (INBOX the ones without, and
  received zips/folders as "new" cards). The lanes show jobs in the ORDERS
  sub-stages only.
- **Lines** (`CONFIG.lines`, hand-confirmed unless they check artwork):
  mastering (approve, cut), plating (to the plater, stampers back; after
  mastering), labels/sleeves/covers/inlays (artwork checks, approve, printer),
  testpress (only when ordered; after plating; back, then approved), press
  (after plating, labels and the testpress), pack (after press and the printed parts),
  invoice (open from the start of production), ship (after pack). Linking
  mastering to the audio checks, and the Lieferschein as a step, come later.
- **Nothing open:** an order through every line is a card in the last stage
  column marked "all lines through, move to DONE"; the move stays manual (the
  archive clock starts at it).
- **Unreadable jobs** are listed in the header's problem list, not as cards.
- Role views come back as filters of the same board when they have content.
- The archive stage holds zips, not jobs: `#/archive` lists them from
  `/api/board` (`archive`).

## 3 Staff order view

- Served at `/order/<job>`, loading `index.html` with a `staff` flag.
- **Data:** from `/api/job` (project, `projectHash`, file list, `plant`), not
  from `/api/zip`: the zip strips `plant` (stage, lines, fixes) and would
  re-zip and stream the whole job, WAVs included, on every open. Files are
  fetched lazily from `/jobs/<job>/files/<file>`.
- **Loader:** `loadProject` is coupled to zip bytes. It is split into parse
  and apply: zip → `{project, fileMap}` for the customer, `/api/job` + lazy
  `File`s for staff, one apply path.
- **Lock:** the sheet gets `inert` permanently (what `runProjectAction` already
  does while it works), which disables every field, button and upload. God
  mode lifts it.
- Staff panels (checks, previews, versions, production lines, notes, deadline,
  history) are further `details.panel`s from `src/plant/`, built from the
  existing `plant-overview.js` renderers.
- **God mode:** header toggle with confirmation. A pure helper in
  `src/lib/project.js` turns old vs. new `project.json` into the free-text
  history entries (`catalogue: X → Y`), so history keeps one shape
  (`historyEntry(note, date)`) and the diff is unit-tested. Saves go through
  `/api/project` with `basedOn` (409); the server stays dumb.
- **First step is a spike:** split `loadProject` into parse and apply and feed
  it from `/api/job`. The risk is the coupling to zip bytes (every `apply*`
  takes a `fileMap` of `File`s), not what the zip contains.

## 4 Quote and PRICING

- `price_quote.json`: `{created, validUntil, currency, vat, items, order,
  result}`. `items` is a frozen copy of the pricelist, `order` the input given
  to `quote()` (`src/lib/quote.js`), `result` its `{lines, net, missing}`.
  Attachable to any job with enough info. A PDF is made from it later.
- **No discounts** in the format (the pricelist spec lists them as "Not yet");
  both sides are the plant's own code, so a field costs nothing to add later.
- **Writer:** a button in the staff order view; the page runs `quote()` and
  PUTs the file with the same 409 rule as `project.json`. The job zip carries
  the file along (it holds every top-level file).
- Customer page: if the zip holds the file, a PRICING panel appears: net total,
  valid until, VAT note, no per-product prices. The quote is one-directional:
  the customer's own re-save (`saveProject` builds the zip from scratch) drops
  `price_quote.json`; that is intended.
- Staff: the same panel plus a breakdown panel (lines, `missing`).
- VAT is stored, not applied (unchanged).

## Testing

`node --test tests/` for new pure logic (dashboard rows, god-mode diff, quote
file); `python -m unittest discover plant` for the new routes (file
read/write, 409); the stub-DOM smoke test for page scripts. Browser checks only
on request.

## Order and risk

1 → 2 → 3 → 4. The one real risk is the loader split in 3; spike it before the
plan for 3 is fixed.
