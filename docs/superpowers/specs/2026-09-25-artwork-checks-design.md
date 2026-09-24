# Artwork checks (deep checks, piece 2) — design

Status: approved in conversation, pending written-spec review.

## Context

Deep checks on disk come in five pieces: 1 audio (done), 2 artwork
checks, 3 print output, 4 previews, 5 helpers. This is piece 2: check
every supplied artwork file (labels, inner sleeve, cover, inlay)
authoritatively on disk and show the problems in the plant view.

The customer page already checks artwork in the browser, heuristically
from the raw bytes (`src/lib/print-artwork.js`: parsers +
`buildChecklistRows`, driven by each format's `CONFIG.printCheck`).
Piece 2 measures exactly and adds what a browser can't: ink coverage,
black that isn't pure K, and trimmed artwork with empty bleed.

Piece 2 only detects. Fixing is piece 3: on request the plant view
re-separates RGB (and CMYK derived from RGB) through a per-part
separation profile with maximum black generation, rendered at
1200 dpi; staff compare before/after and accept, reject, or order a
paid manual correction. Vector PDFs from professionals are usually
clean and need no fix.

Out of scope: fixes, PDF 1.3 output, CMYK soft proofs (piece 3); a
safe-area check (text too close to the cut — too many false positives
from backgrounds).

## Architecture

Same split as the audio checks: the page decides what to measure,
Python measures, JS judges.

- **Page → server.** `POST /api/check` gets a JSON body
  `{artwork: {"<file name>": params}}`. The page derives `params` from
  the project and `CONFIG` (`artworkParams`, below), so Python never
  reads `CONFIG` or `project.json`.
- **`plant/checks.py`** — `run(project_dir, out_dir, artwork)` returns
  `{files, artwork}`: `files` is the audio facts as before, `artwork`
  the facts per artwork file named in the request. Previews go to
  `plant/work/<stem>.checks/` like the audio previews.
- **`src/lib/artwork-checks.js`** (new, pure):
  - `artworkParams(project, config)` → params per referenced artwork
    file.
  - `artworkRows(facts, params, printCheck)` → checklist rows
    `{feature, severity, detected, expected}`:
    `buildChecklistRows(facts.parsed, facts.kind, params.targetMm,
    params.trimMm, printCheck, true)` plus the new Ink, Black and
    Bleed rows. Debug mode on: staff see every row.
  - `artworkVerdict(rows)` → `"ok" | "review" | "customer"`: any
    `error` row → customer, any `warn` → review.
- **`src/lib/print-artwork.js`** — one change: `buildChecklistRows`
  uses `parsed.effectiveDpi` when present, instead of deriving it from
  `imagePx` and page size. The browser parsers never set it.
- **`src/lib/plant-overview.js`** — `renderArtwork(project, facts,
  rowsByFile, base)`.
- **`src/plant/app.js`** — sends the params with the check request,
  renders the Artwork section after Audio.

## Params (page → Python)

Per artwork file:

```
{ part: "labels" | "innerSleeve" | "outerCover" | "inlay",
  targetMm: {w, h},   // data size, bleed included
  trimMm: {w, h},     // finished size
  bleedMm,
  round,              // true for labels
  inkLimitPct,        // part's coverage limit
  black: {kMinPct, cmyMaxPct} }
```

Sizes come from the existing helpers: `labelDataSizeMm` (labels:
diameter + 2 × bleed, square), `flatDataMm` / `trimMm` (other parts).
Which files: labels A/B unless whitelabel; inner sleeve, cover, inlay
front/back when their product is printed.

## Facts (Python → page)

Per artwork file:

```
{ kind: "pdf" | "jpeg" | "tiff" | "unknown",
  parsed: {…},        // the shape print-artwork.js documents, + effectiveDpi
  unembeddedFonts: [names],
  pageMm: {w, h}, trimRectMm: {x, y, w, h},
  ink: {maxPct, overPct},          // overPct: % of page area above inkLimitPct
  black: {richPct},                // % of page area black-looking but CMY > cmyMaxPct
  bleed: {outerInkPct, innerInkPct},
  preview: "<n>.png", overlay: "<n>.overlay.png",
  error }
```

- **PDF (PyMuPDF), page 1:**
  - boxes: BleedBox → TrimBox → MediaBox for `pageSizeMm`, same
    priority as the browser parser; TrimBox read raw from the page
    object (PyMuPDF falls back to the MediaBox when it is absent)
  - `pdfVersion`, `encrypted`, fonts (`page.get_fonts`, not embedded
    = no font file), spot colours (Separation/DeviceN names), ICC name
    (output intent, else first ICCBased)
  - `colorMode` from image colour spaces and vector/text colour
    operators: CMYK, RGB, Gray, or "unknown"
  - `effectiveDpi`: per placed image its pixels over its placed size;
    the lowest counts
- **JPG/TIFF (Pillow):** pixels, declared dpi, mode (CMYK/RGB/L),
  embedded ICC name. Page size from pixels and dpi; without dpi the
  file is taken to be `targetMm`, as the browser does.
- **Pixels (PyMuPDF render + numpy):** the page rendered in CMYK at
  72 dpi (1 px ≈ 0.35 mm, which also averages like a densitometer
  spot). Per pixel coverage = C+M+Y+K in %.
  - **ink:** max coverage; share of pixels above `inkLimitPct`.
  - **black:** a pixel looks black when K ≥ `kMinPct` or C, M, Y are
    all ≥ 60 %; rich when its C+M+Y > `cmyMaxPct`.
  - **bleed:** trim = TrimBox, else `trimMm` centred on the page. Two
    bands of the bleed's width: outside the trim (the bleed) and just
    inside it; for round labels rings around the trim circle. A pixel
    is inked above 5 % coverage. `outerInkPct` / `innerInkPct` = inked
    share of each band. Bleed area outside the page (file has no
    bleed) → `outerInkPct: null`.
  - For RGB sources the CMYK values are MuPDF's default conversion — an
    estimate; the real separation happens in piece 3.
- **Preview:** the page as RGB PNG, 800 px on the long side; overlay
  PNG, same size, transparent, red where over the ink limit, orange
  where black is rich.
- **Errors:** an unreadable file gets `error`; without the Python
  libraries the whole `artwork` result is `{error: "needs PyMuPDF: uv
  run --project plant plant/server.py"}`. Audio is unaffected.

## Rules (JS)

Existing rows via `buildChecklistRows`, on exact values: size,
resolution, colour mode + spot colours, colour profile, PDF version,
TrimBox, encryption, fonts. New rows, same shape and severity model:

- **Ink** — `max X %`; fails when `overPct` > 0.5 (single stray pixels
  don't count). Expected `≤ inkLimitPct %`.
- **Black** — `rich black on X % of the area`; fails when `richPct` >
  0.5. Expected `100 % K`.
- **Bleed** — fails when `outerInkPct` is null (no bleed in the file)
  or when `innerInkPct` ≥ 20 and `outerInkPct` < 5: artwork runs to
  the cut but the bleed is empty — probably trimmed.

## CONFIG

Per format in `printCheck`:

```
inkLimitPct: { labels: 220, innerSleeve: 300, outerCover: 300, inlay: 300 },
black: { kMinPct: 85, cmyMaxPct: 30 },
checks: { …existing, ink: {severity: "warn"}, black: {severity: "warn"},
          bleed: {severity: "warn"} }
```

Labels 220 %: offset on profibulk, labels are baked in the oven before
pressing, so below 300 % and ideally near 200 %. Everything else follows
ISO Coated v2 300 % (ECI). `config-validation.js` checks the new
fields.

## Plant view

An **Artwork** section after Audio, one block per file in page order
(labels A, B, inner sleeve, cover, inlay front, back):

- heading: part, file name, verdict (OK / review / needs customer)
- the preview at full width with the trim line (solid) and the bleed
  line (dashed) drawn over it in percent of `pageMm`, a circle for
  labels; a checkbox "problem areas" shows the overlay
- the checklist rows as a table (feature, detected, expected), the
  row's severity as the same icons as the customer page
  (`CHECKLIST_ICON`)

Plain and dense like the rest of the plant view.

## Setup (uv)

- `plant/pyproject.toml` — no package, dependencies `pymupdf`,
  `pillow`, `numpy`; `plant/uv.lock` committed; `plant/.venv`
  gitignored.
- Run: `uv run --project plant plant/server.py`; tests:
  `uv run --project plant -m unittest discover plant`.
- `plant/server.py` stays standard library; only the artwork part of
  `checks.py` imports the libraries, lazily.
- The repo is MIT; PyMuPDF is AGPL. That binds the plant tool as run
  (its source must be offered to users over a network), which a public
  repo already does.

## Tests

- `plant/test_checks.py` — PDFs built with PyMuPDF in the test: CMYK
  fills at known coverage (over/under limit), 100 % K vs rich black
  text areas, artwork with and without bleed (rect and round), TrimBox
  present/absent, an RGB image at known placement for `effectiveDpi`,
  an unembedded font; a CMYK TIFF and an RGB JPEG via Pillow. Skipped
  without the libraries.
- `plant/test_server.py` — `/api/check` passes the artwork params
  through.
- `tests/artwork-checks.test.js` — `artworkParams` per part and
  format, each new rule, `effectiveDpi` in `buildChecklistRows`,
  verdicts.
- `tests/plant-overview.test.js` — `renderArtwork` markup (lines in
  percent, overlay, escaping).
