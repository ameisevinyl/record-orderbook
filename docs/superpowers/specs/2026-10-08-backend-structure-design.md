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

Built as information only (revised with the user): no move logic, no fixing,
no god mode yet, and it writes nothing.

- Served at `/order/<job>` (`plant/server.py`): the customer page with its
  script by absolute path and `src/staff.js` / `staff.css` added. A board
  card links there; the old job page stays reachable ("files & fixes" in the
  bar) until its parts have moved.
- **Data:** from `/api/job` (project, file list, `plant`), not `/api/zip`.
  `loadProject` is split: the zip half stays, `applyProject(p, fileMap)` fills
  the form from a prepared project and the files; staff call it with no files.
  A slot reads `file: <name>` (no `please re-select`); no file bytes are
  fetched, so opening an order downloads no audio.
- **Lock:** every control is `disabled` (not `inert`, which would stop the
  panels folding), also the ones the page creates later.
- **The plant's checks replace the browser's:** artwork slots show the
  backend's check rows and preview (`showChecks`), audio file lines the
  backend's duration and format (`showAudioChecks`); the page's own Status
  list (it would call every file missing) is hidden for the plant's list
  (completeness gaps, audio findings, artwork that needs a look).
- **What the plant adds:** the bar (stage, link back), a Plant panel with the
  order's production lines (read-only), history, files outside the order.
- **Later:** god mode (a header toggle with confirmation; a pure
  `projectDiff(old, new)` in `src/lib/project.js` that turns the change into
  free-text `history` entries; saves through `/api/project` with `basedOn`),
  the price section (part 4: the quote needs the plating choice, which the
  order doesn't carry yet), fixes in the order view.

## 4 Quote and PRICING

- **The file** `price_quote.json` in the job folder: `{version, created,
  validUntil (the pricelist's), currency, order (the input given to
  `quote()`), lines (the priced lines: the prices used), net, copies, perCopy,
  vat: {case, rate, amount, gross, note, vatId: {id, status, name, checked}}}`.
  No frozen copy of the whole pricelist, no discounts. Its presence moves the
  card from INBOX to QUOTES; the customer's acceptance stays the Move to
  PREPRESS. A re-quote overwrites (409 on change).
- **Who writes it:** the Quote panel of the staff order view. The page prices
  the order (`src/lib/price-quote.js`: `orderFromProject`, `buildPriceQuote`)
  from the live pricelist (`/api/staff-file?name=pricelist`) and saves it
  with `POST /api/quote` (`{job, quote, basedOn}`); `/api/job` returns
  `quote` and `quoteHash`. Nothing is saved while prices are missing or the
  quantity is empty. Plating is `quote()`'s default (1-step): the plant
  decides it, the order doesn't carry it.
- **What the customer sees:** a Pricing panel (`src/modules/pricing.js`) when
  the project zip the plant sent back holds `price_quote.json`: the net price,
  the net price per copy, the VAT line (with amount and total where VAT is
  charged), valid until — never a product line. The zip the plant
  downloads (`/api/zip`) carries only that customer copy of the file
  (`jobs.customer_quote`: totals and the VAT line, no lines, order or VAT ID
  check); the plant's own file stays whole. A customer's own re-save drops
  it. Staff see every line in the Quote panel.
- **VAT** (`src/lib/vat-case.js`, plant in the EU; by the billing address,
  staff can override the proposal): same country = plus VAT (domestic); another
  EU country with a VAT ID that VIES found valid, from a member state other
  than the plant's = reverse charge; another EU country otherwise (private, ID
  missing, invalid or not checked) = plus VAT at the plant's rate (no OSS
  destination rates); outside the EU = no VAT (export). A plant outside the EU
  or without a country = net only, "VAT not applied". Reverse charge is never
  proposed on an unchecked number. The rate is the pricelist's `vat.rate`.
- **VAT ID check:** `plant/vies.py` asks the EU's VIES service from the plant
  server when staff press "check on VIES" (`POST /api/vat-check`); the answer
  and its date are saved in the quote. A service that doesn't answer is
  "unchecked", never "invalid". The service's address and reply shape are in
  one place (`URL`, `parse`) and must be confirmed against the live service.
- Not built: a PDF quote, quote history, VAT splits per shipment.

## Testing

`node --test tests/` for new pure logic (dashboard rows, god-mode diff, quote
file); `python -m unittest discover plant` for the new routes (file
read/write, 409); the stub-DOM smoke test for page scripts. Browser checks only
on request.

## Order and risk

1 → 2 → 3 → 4. The one real risk is the loader split in 3; spike it before the
plan for 3 is fixed.
