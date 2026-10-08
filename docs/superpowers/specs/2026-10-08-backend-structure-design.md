# Backend structure: dashboard, staff order view, role views

Status: design, awaiting review. Five sub-projects, each gets its own plan:
1 server shell, 2 dashboard, 3 staff order view, 4 quote and PRICING, 5 role views.

## Goal

The plant view becomes the plant's staff app on its own server: an overview of
all orders for the boss, the customer frontend as the order view for staff, and
the pricelist / plant-config helpers working on the files on disk. The
customer page stays one offline file; only the staff side needs the server.

## Decisions

- **Access:** no login. Staff mode is read-only for everything the customer
  sent. God mode is a deliberate toggle (confirmation), every change in it is
  logged in `history` (field, old, new). This stops accidents, not a determined
  person on the LAN. A PIN or users can later sit behind the same toggle; the
  server owns all writes, so the check lives in one place (`/api/project`).
- **Column state:** production lines (`CONFIG.lines`, `src/lib/lines.js`),
  derived on every scan from check results and `plant.lines` (append-only log,
  entries count while their files keep their sha256).
- **Order view:** `index.html` in staff mode, not a copy and not an iframe.
- **Quote:** a file `price_quote.json` in the job folder, no stage, no gate.
- **State** stays in each job's `project.json` (+ `price_quote.json`); Python
  does disk and serving, the pages decide.

## 1 Server shell and helpers

One staff app with a menu: Dashboard, Archive, Pricelist, Plant config, later
Fixers. Dashboard, order and Archive are hash routes of one page (as the plant
view now); Pricelist and Plant config stay their own pages (`sheet.css`).

- `GET/PUT /api/pricelist` and `/api/plant-config` read and write the real
  files (`src/pricelist.json`, `src/plant.config.local.js`). The page keeps
  parsing, validating and formatting (`lib/pricelist.js`, `lib/plant-config.js`);
  Python writes atomically and refuses with 409 when the file changed since the
  page read it (same rule as `project.json`). Open/Save-as-download stays for
  the standalone `dist/` pages.
- Menu holds "Load zip" / "Load folder" (existing `/api/upload*`).

## 2 Dashboard

- `CONFIG.lines` grows to the columns: audio (master, reference cut, plating),
  labels, inner sleeves, covers, inlays, press, pack, ship. Each has its
  `steps` and `after`; an order has a column only for the products it orders.
- A row per order, stages INBOX to DONE; ARCHIVE is its own view. A cell shows
  the line's current step as symbol + colour: done, current, waiting (`after`),
  blocked by a check. The cell title gives the step and the reason.
- Pure rendering in `src/lib` (replaces `renderBoard`), tested like
  `plant-board.js`. A row click opens the order.
- Open: exact steps for press, pack, ship; symbol and colour vocabulary.

## 3 Staff order view

- Served at `/order/<job>`. The page fetches `/api/zip?job=` and gives it to
  `loadProject(file)` of the customer page (no second loader), with a `staff`
  flag. The flag disables every customer field and upload.
- Staff panels (checks, previews, versions, production lines, notes, deadline,
  history) are further `details.panel`s from `src/plant/`, built from the
  existing `plant-overview.js` renderers.
- God mode: header toggle, confirmation, fields unlock; saves go through
  `/api/project` with `basedOn` (409) and write a history entry per change.
- **First step is a spike:** does the job's zip carry the files the slots point
  at, including `_v<N>`, so `loadProject` re-attaches them? If not, the zip
  route or the staff loader changes before anything else is built.

## 4 Quote and PRICING

- `price_quote.json`: `{created, validUntil, currency, vat, items, discounts:
  [{key, from?, percent}], order, result}`. `items` is a frozen copy of the
  pricelist, `order` the input given to `quote()` (`src/lib/quote.js`),
  `result` its `{lines, net, missing}`. Attachable to any job with enough info.
  A PDF is made from it later.
- Customer page: if the zip holds the file, a PRICING panel appears: net total,
  valid until, VAT note, no per-product prices. The plant sends the zip back.
- Staff: the same panel plus a breakdown panel (lines, `missing`, discounts).
- VAT is stored, not applied (unchanged).
- Open: how a discount is keyed (item key and quantity tier).

## 5 Role views

Mastering, pressing, printed: for now each shows the checks of its lines from
the same job data (audio checks, press facts, artwork checks). Chosen from the
menu; no access control. Fixers get their own page; `fixerStages` auto-fix
stays until then.

## Testing

`node --test tests/` for new pure logic (dashboard rows, quote file, staff
lock); `python -m unittest discover plant` for the new routes (file read/write,
409); the stub-DOM smoke test for page scripts. Browser checks only on request.

## Order and risk

1 → 2 → 3 → 4 → 5. The one real risk is the zip → `loadProject` spike in 3; do
it before the plan for 3 is fixed, because it may change what the server serves.
