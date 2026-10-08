# CLAUDE.md

Project brief for Claude Code. Read this before making changes.

## What this is

A single browser page a record pressing plant hands to its customers
(label owners, artists) to assemble one release's order: tracklist and
playing time per side, printed parts (labels, inner sleeve, cover, inlay),
vinyl colour and quantity, billing and shipping addresses. All fields
belong to one release record (catalogue number, format, production
title, artist).
Not built for one specific plant — a plant configures it via `CONFIG` and
gives it to its own customers.

Zero setup: open the HTML file, it works, offline, no install.

The maintainer is a programmer, preferring minimalistic, simple, low-level
style. Use modern solutions when they're simple and widely accepted.
Comments are short and assume everybody can read the code. Don't repeat
yourself. Be short and precise.

## Workflow (why the tool is shaped the way it is)

1. The plant sends the tool to the customer (the HTML file, or a link).
2. The customer fills in the form top to bottom — release info,
   tracklist, printed parts, quantities, billing/shipping — with
   inline info and warnings at each step. Audience is professional
   label owners/artists, not beginners: the default UI stays terse;
   deeper explanations sit behind a per-field info icon for whoever
   needs them (`CONFIG.infoText`), not inline for everyone.
3. For the customer, a "project" is always a single .zip — not a bare JSON file, and not a
   live folder on disk. This is a deliberate, cross-browser-driven choice
   (see git history / the design discussion this came out of): writing
   into and reading back a real OS folder needs the File System Access
   API, which is Chromium-only — Safari has no directory access and
   Firefox has none at all. A .zip only needs `<input type=file>` and a
   download, which every browser supports. At any point the customer can
   save the current state (`saveProject` in `tracklist.js`) and reopen
   that zip later to resume (`loadProject`) — files inside it get
   re-attached automatically by exact filename match, since the tool
   controls both the write and the read side of that name (see the
   naming convention below).
4. Everything must be complete and correct before sending to the plant —
   "Send to Plant" warns (dismissibly, "send anyway") on anything still
   flagged by a module's checklist, rather than silently shipping gaps.
5. The zip always contains: `project.json` (the complete, re-loadable
   form state — fixed name, so `loadProject` can find it inside any
   zip), two human-readable text files, and the customer's own
   audio/artwork files renamed to the plant's internal convention (see
   below). The two text files exist because they go to different
   people: `order_summary.txt` is the complete order (release info,
   file manifest, tracklist, notes, billing/shipping) for customer
   service / production management; `tracklist.txt` is the same
   release info, tracklist and notes but *without* billing/shipping
   or the artwork file manifest, for the mastering engineer and
   graphics department, who don't need the customer's order details
   or a listing of files they already have. Everything
   is nested under one folder inside the zip, named per the project
   naming convention below. See `src/lib/zip.js` for the writer/reader and
   `src/lib/package-naming.js` for the naming.
6. The page is printable to PDF (see the `@media print` rules in
   `src/index.html`) for the rare customer who wants a paper copy —
   not a primary flow, don't design around it.
7. At the plant a project is a job folder in a jobs tree on any
   filesystem (local, NAS, Nextcloud): stage folders `00_INBOX`,
   `10_ORDERS/10_PREPRESS`, `10_ORDERS/20_PRESS`, `20_DONE`,
   `99_ARCHIVE` (any `NN_NAME` folder counts; numbers leave room). A job
   moves by moving its folder — plant view, Finder or `mv`. All workflow
   state lives in its `project.json` (`plant.stage`, `history`), which
   stays hand-editable. Files are never overwritten: a fix or a resent
   file becomes the next `_v<N>`, and the slot in `project.json` points
   at the version that counts; versions not in use can be trashed
   from the plant view into the job's `.trash/` (recoverable by hand). A received zip or unpacked folder in
   `00_INBOX` (copied in, synced, or loaded in the plant view) becomes a
   new job or merges into the job with its catalogue number
   (`mergeResend` in `src/lib/versions.js`; a zip with the key of an
   existing job — see the naming convention — can only merge); `plant.received` keeps the
   sha256 of every file as it came in, so resending the same content
   doesn't undo a fix saved over it under the same name. In the inbox, a folder is a
   job only once `plant.stage` is set — the customer page never writes
   it, and the plant's zip download leaves it out.

## File naming convention (`src/lib/package-naming.js` — applied when building the package, not on upload)

- Tracks: `<catalogue#>_<side><n>_<title>_<artist>_v<rev>.<ext>` — e.g.
  `PNKRCK007_A1_my_way_artist_v1.wav`. The catalogue# prefix keeps the
  name unique once a file is pulled out of its project folder (e.g. into
  a shared mastering working directory) — same reasoning as printed
  parts below.
- A whole side delivered as one continuous file:
  `<catalogue#>_<side>_side_v<rev>.<ext>` — e.g. `PNKRCK007_A_side_v1.wav`
- Printed parts: `<catalogue#>_<part>_<side-or-variant>_v<rev>.<ext>` —
  e.g. `PNKRCK007_labels_A_v1.pdf`
- Project folder / zip name: `<catalogue#>_<artist>_<title>_<YYMMDD-HHMM>` —
  e.g. `PNKRCK007_the_band_loud_record_261001-1432`. The catalogue number
  is required to save; artist and production title are optional. Local
  time (the customer's on save, the plant server's on a change); artist
  and title slugged, max 32 chars each, left out when empty, `untitled`
  when both are. No email: the name
  travels through transfer services. Without the stamp it is the job's
  key (`job_key` in `plant/jobs.py`). A plant job folder is renamed when
  its content changes through the plant view (merging a resend, using a
  file version): the page builds the name from its project.json with
  `projectFileName` and the plant's local time, so older names convert
  too. Moving doesn't rename. Jobs are found by key, so an older stamp
  still resolves. Same key = same job — a repress isn't told apart yet.

The customer page always writes `v1`. Higher versions are made at the
plant only (`src/lib/versions.js`): staff fixes, files assigned by hand,
changed files of a resend.

## Hard constraints — do not relax these without asking

- **No runtime dependencies.** No CDN scripts, no npm packages shipped to
  the browser. If something needs a capability (ZIP writing, WAV/AIFF
  header parsing, graphic file format checks (PDF or TIFF) etc.), implement it directly — see `src/lib/zip.js` and
  `src/lib/audio-duration.js` for the existing style.
- **`dist/index.html` must remain a single, self-contained file.** No
  external requests at runtime (fonts, scripts, images). It has to work
  offline and keep working with no maintenance.
- **Dev tooling may use Node, but zero npm installs.** Tests run on
  `node --test` (built into Node ≥18). The build script is plain Node
  `fs` string-concatenation — no bundler, no transpiler.
- **KISS.** Prefer the boring, obvious solution. No premature abstraction.
  Don't introduce a framework, state library, or build tool to solve a
  problem that a plain function solves.

## Commands

```
node --test tests/            # run all unit tests
node build/build.js           # build dist/index.html from src/
node build/pricelist.js extract|generate|check   # item keys from CONFIG / sync src/pricelist.json / find unpriced
uv run --project plant plant/server.py [--jobs <folder>]   # plant view on http://127.0.0.1:8765/, jobs tree default plant/jobs/ (won't start below the versions in plant/pyproject.toml)
uv run --project plant plant/archive.py --jobs <folder> --days 60   # cron: zip long-done jobs into 99_ARCHIVE
uv run --project plant python -m unittest discover plant   # plant server + checks tests
brew install ffmpeg uv        # plant checks need ffprobe/ffmpeg; uv installs the Python libs
```

Run tests before considering any change done. There is no linter/formatter
configured on purpose — keep it that way unless asked.

## Architecture

- `src/lib/*.js` — pure, DOM-free, unit-testable without a browser.
  Exceptions: `debug-mode.js` reads `location`, and the
  File/Blob/`<audio>` half of `audio-duration.js` is browser-only.
- `src/modules/*.js` — one file per artifact type. Each module owns its
  DOM template and must not reach into another module's DOM.
  `tracklist.js` owns project save/load and the zip package — other
  modules expose a `collect*`/`apply*` pair for it to call.
  `printed-parts.js` is cover, inner sleeve and inlay from one table.
  Every artwork upload (those and `labels.js`) is one
  `artwork-slot.js` slot, handed its own element ids by the caller;
  sizes and spec rows come from `artworkSize`/`partSpecRows` in
  `src/lib/format-catalogue.js`, also used by the plant's checks.
- `tests/*.test.js` mirrors `src/lib/`. New pure logic needs a test.
- `plant/server.py` + `src/plant/` — the plant (staff) view: a stdlib
  Python server on 127.0.0.1 that serves `src/plant/` and `src/`
  unbuilt and works on the jobs tree (`plant/jobs.py`: scan, move,
  accept/merge inbox zips, safe `project.json` writes — refused with 409
  when the file changed since the page read it). Python does the disk,
  the page decides (`src/lib/versions.js`). Spec:
  `docs/superpowers/specs/2026-09-29-job-folders-design.md`.
  Each fact is shown once. Artwork previews carry their raw CMYK, shown
  under the pointer. The fix flow (`src/lib/fix-flow.js`) proposes one
  fix at a time per printed part — size → pdf → colour, the last making
  it PDF/X-1a — accept uses it, dismiss trashes it; log `plant.fixes`.
  Spec: `docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md`.
  Through the flow, a part gets a customer proof (`plant/proof.py`):
  the file with trim and hole drawn on, still CMYK PDF/X. Spec:
  `docs/superpowers/specs/2026-10-02-customer-proof-design.md`.
  Production lines (`src/lib/lines.js`,
  `CONFIG.lines`): per product its steps — checks (live from the check
  results), approve, send to a partner,
  back — where a line stands is derived on every scan; `plant.lines` in
  `project.json` keeps an append-only log whose entries count while their
  files keep their sha256. Spec:
  `docs/superpowers/specs/2026-10-02-production-lines-design.md`.
  Grouping stages (10_ORDERS) hold no jobs. `project.json` is the reference and
  the naming convention strict: a slot's file and its `_v<N>` versions
  are managed (versions listed with "use", checked once in use); every
  other file in the job folder is unmanaged — only listed, never renamed
  into a slot, checked or plotted. The page's look is layered:
  `structure.css` is structure only, `theme.css` on top carries the design
  system (DESIGN.md tokens; a plant overrides the `:root` values). Spec:
  `docs/superpowers/specs/2026-09-29-plant-view-layout-design.md`.
- Prices: `src/pricelist.json` (gitignored, the plant's real prices; the
  committed `src/pricelist.example.json` is the template) holds net
  prices per item key derived from CONFIG (`src/lib/pricelist.js`,
  `build/pricelist.js`); `src/lib/quote.js` turns an order into a net
  quote. `vat` is stored, not applied yet. The `pricelist-filler`
  agent fills the list from a plant's PDF/CSV. Spec:
  `docs/superpowers/specs/2026-10-08-pricelist-quote-design.md`.
- Deep checks on disk (`plant/checks.py`, `spectrum.py`, `artwork.py`):
  see `plant/CLAUDE.md`. Python only reads facts; the rules live in
  `src/lib/audio-checks.js` and `src/lib/artwork-checks.js`.
- `src/plant.config.local.js` (gitignored, copied from the committed
  sample `src/plant.config.local.example.js`) holds a real plant's
  identity; `build/build.js` bundles it instead of the sample when
  present, and aborts when `CI` is set and it exists, so a plant's
  identity never reaches a public build.

## Domain glossary (so you don't have to ask)

- **Catalogue number** — the release's unique order ID; required on every
  artifact type. Example: PNKRCK007
- **Side A / Side B** — vinyl has two playable sides; B may be blank.
  Tracks are numbered A1, A2… / B1, B2… in play order.
- **RPM** — 33⅓ or 45. Default by format: 7"→45, 10"→33, 12"→33.
- **Format** — 7" single, 10" EP, 12" LP — physical disc diameter.
- **Soundsystem cut** — a hotter, louder cutting style (club/soundsystem
  pressings); shortens the recommended max playing time per side.
- **Lacquer / cutting** — the mastering engineer cuts a lacquer disc from
  the audio; playing time and groove pitch trade off against each other,
  hence the per-side time warnings in the tracklist tool.
- **Gap / mark** — the pause inserted before a track during cutting: none,
  2s, or a custom value. Distinct from the always-present locating groove
  marker.
- **Whitelabel** — a test/promo pressing with a blank or minimal label,
  as opposed to the final printed label.
- **Reference cut** — a one-off acetate cut from the master so the
  customer hears the sound before the master for plating is cut; one
  per order.
- **Testpress** — the first records off the stamper, checking the
  pressing (not mix or master); a quantity, default 3, recommended
  from 1,000 records up (`CONFIG.proofs`).
- **Matrix / runout inscription** — text etched into the runout groove
  (the dead wax between the last track and the label) of each side,
  e.g. the catalogue number plus side letter. Defaults to
  `<catalogue> <side>`, editable per side, until the customer types
  their own — see `applyDefaultMatrix` in `tracklist.js`.
- **Plant identity** (`CONFIG.plant`) — this deployment's own business
  data: `imprint` (EU/German legal imprint fields, shown small in the
  footer) and `transfer` (where finished packages get sent — a direct
  upload link if the plant has one, else the transfer services the
  customer picks from + recipient email — e.g. SwissTransfer, or
  FilePizza (`direct`: browser to browser, no server storage, the
  customer keeps the tab open); see `src/lib/transfer.js`). The committed
  `src/plant.config.local.example.js` holds safe sample data; a real
  plant's actual data lives in `src/plant.config.local.js` (gitignored,
  copied from the example) and is bundled at build time — see
  Architecture below.
- **Project** — one release's complete form state, saved/loaded as a
  single .zip (`project.json` + `order_summary.txt` + `tracklist.txt` +
  renamed customer files) — see the Workflow section above for why it's
  a zip and not a bare JSON file or a live folder, and for why there
  are two text files.
- see also: https://www.sst-ffm.de/en/frequently-given-answers for record mastering insights
- see also https://www.randmuzik.de/en/specifications/ for record specific printed parts

## Conventions

- Plain, modern JS (ES2020+ features are fine — target is current
  evergreen browsers, not legacy IE-era compatibility).
- Plant-specific values (playing-time thresholds, default RPM, plant
  identity, printing specs) live in a single `CONFIG` object — never
  hardcode them elsewhere. Real plant identity (imprint/transfer) is
  the one exception that doesn't belong in the committed `config.js` —
  see `CONFIG.plant` above.
- Comments explain *why*, not *what*, especially around anything
  reverse-engineered from a file format spec (WAV/AIFF chunks, ZIP
  headers) — cite the chunk/field being read.
- Commit messages: short, imperative, no ceremony, scientific, precise, DRY
