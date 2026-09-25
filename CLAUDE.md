# CLAUDE.md

Project brief for Claude Code. Read this before making changes.

## What this is

A single browser page a record pressing plant hands to its customers
(label owners, artists) to assemble one release's order: tracklist and
playing time per side, printed parts (labels, inner sleeve, cover, inlay),
vinyl colour and quantity, billing and shipping addresses. All fields
belong to one release record (catalogue number, format, title, artist).
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
3. A "project" is always a single .zip — not a bare JSON file, and not a
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
7. The plant reopens the same tool and loads the project zip back to
   review or edit an order (e.g. a phone-in quantity change), and saves
   it again as a new zip — either resending the same files, or swapping
   one out first.

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
- Project folder / zip name: `<YYMMDD>_<catalogue#>_<customer-email>`

Versioning isn't tracked yet — every name above gets a fixed `v1` for
now; revisit if/when the plant needs to tell file revisions apart.

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
uv run --project plant plant/server.py   # plant view on http://127.0.0.1:8765/
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
- `tests/*.test.js` mirrors `src/lib/`. New pure logic needs a test.
- `plant/server.py` + `src/plant/` — the plant (staff) view: a stdlib
  Python server on 127.0.0.1 that serves `src/plant/` and `src/`
  unbuilt and unpacks opened project zips into `plant/work/`
  (gitignored). The page renders `project.json` itself
  (`src/lib/plant-overview.js`, `src/lib/completeness.js`), not the
  customer form (god-mode editing may reuse the form later).
- `plant/checks.py` — deep checks on disk, piece 1 (audio): ffprobe
  facts, AIFF `MARK` markers, MP3 + waveform PNG per file, written to
  `plant/work/<stem>.checks/` (beside the unpacked zip, never inside).
  Python only reads facts; the rules live in `src/lib/audio-checks.js`.
  Spec: `docs/superpowers/specs/2026-09-24-audio-checks-design.md`.
  Piece 2 (artwork, `plant/artwork.py`): PyMuPDF/Pillow/numpy facts,
  ink/black/bleed measurements, preview + overlay PNG; rules in
  `src/lib/artwork-checks.js`. Spec:
  `docs/superpowers/specs/2026-09-25-artwork-checks-design.md`.
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
- **Matrix / runout inscription** — text etched into the runout groove
  (the dead wax between the last track and the label) of each side,
  e.g. the catalogue number plus side letter. Defaults to
  `<catalogue> <side>`, editable per side, until the customer types
  their own — see `applyDefaultMatrix` in `tracklist.js`.
- **Plant identity** (`CONFIG.plant`) — this deployment's own business
  data: `imprint` (EU/German legal imprint fields, shown small in the
  footer) and `transfer` (where finished packages get sent — a direct
  upload link if the plant has one, else a transfer service's homepage
  + recipient email; see `src/lib/transfer.js`). The committed
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
