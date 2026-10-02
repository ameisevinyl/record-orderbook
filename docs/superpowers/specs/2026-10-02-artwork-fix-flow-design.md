# Artwork fix flow — design

Status: approved in conversation 2026-10-02, pending written-spec review. Replaces the
candidate tiles of `2026-10-01-artwork-geometry-fix-design.md` and the automatic colour
fixer of `2026-10-02-production-lines-design.md`; builds on branch `geometry-fix`
(`geometryFixes`, `geomfix.py`, `artwork.pixels`/`raster_pdf`, `fixDpi` per part).

## Context

Each printed part goes to a printing house that expects one exact file: data size (trim +
bleed), PDF/X-1a, CMYK within the ink limit, rich black only where wanted. Customers send
anything. Plant staff today fix files by hand in Photoshop. The plant view now runs the
checks, proposes one fix at a time in a fixed order, and staff accept or dismiss each.
What can't be fixed automatically is fixed by hand and dropped back into the job folder.

## Decisions

- **Plant view only**, all printed parts (labels, inner sleeve, cover, inlay).
- **One flow per slot, top to bottom:** latest preview → checks → the current fix proposal
  (preview, what it did, all its checks, accept / dismiss) → the next.
- **Steps in order: size → pdf → colour.** The current step is the first failing step
  without a `dismissed` entry for the file in use (by sha256). A wrong aspect ratio stops
  the flow at size: "needs correction by hand".
- **A proposal is a real file:** the slot's next `_v<N>.pdf`, checked like any file.
  **Accept** = use it. **Dismiss** = trash it, log `dismissed`.
- **Trash, not delete:** a job-local `.trash/` folder (dot folders stay out of listings,
  checks and zips; recoverable by hand on any filesystem). Files are still never
  overwritten.
- **Proposals are made automatically** in `CONFIG.fixerStages`, one per page load —
  replacing the colour fixer in `fixerTargets`.
- **Production lines stay as data** (`lines.js`, `plant.lines`, the board); the job page
  loses the step strip, the Production section keeps only its current action
  (approve / send / back).
- Output of every fix: one raster at `fixDpi[part]`, PDF 1.3. After the colour step the
  file is PDF/X-1a:2001 (OutputIntent + GTS keys). Conformance beyond our own checks needs
  a preflight tool (Acrobat/PitStop) — not part of this work.

## The steps (rules in `src/lib/artwork-checks.js`, pixels in `plant/`)

`fixStep(facts, params, printCheck, dismissed) → {step, fix} | {step, manual: reason} | null`
— pure: the first failing step; `fix` is what Python is handed; `manual` when no fix
exists; `null` when all pass. `dismissed`: the steps dismissed for this sha256.

### size

Fails when the Size row fails, or the Bleed row says "trimmed".

- **Ratio:** right when scaling S to T leaves both sides within `sizeToleranceMm`
  (|S.w·k − T.w| ≤ tol and |S.h·k − T.h| ≤ tol for k = T.w / S.w). Else
  `manual: "aspect ratio S.w×S.h vs T.w×T.h — needs correction by hand"`.
- **Proposal by rule** (one, from `geometryFixes`):
  - size wrong, |T − S| / 2 ≤ `bleedMm` on both axes → `keep` (1:1, crop or mirror);
  - size wrong, larger difference → `fit` (scale);
  - size right, bleed empty → `rebuild` (crop to the trim, mirror the bleed).
- `zoom` and the candidate tiles are removed.
- What it did, e.g. "crop/add bleed 1:1, mirror 1.0 mm · detail 300 dpi",
  "scaled ×0.240 · detail 300 dpi", "rebuilt 3 mm bleed by mirroring".

### pdf

Fails when the file isn't a PDF or `parsed.pdfVersion !== "1.3"`.

- Fix: `geomfix.render` with the identity candidate (scale 1, keep file, no fill) — the
  data area rasterized at `fixDpi[part]`, flattened (no transparency, layers, fonts).
- `artwork.raster_pdf` always writes PDF 1.3: header `%PDF-1.3` (patched, same length),
  no object streams. So a size fix passes pdf by itself.
- What it did: "rasterized at 1200 dpi, PDF 1.3".

### colour

Fails when Ink or Black warns, the colour mode isn't CMYK (RGB, Gray), or the OutputIntent
isn't the part's profile (`facts.parsed.outputIntent !== printProfiles[part].name`).

- **assign** (Ink, Black and mode pass, only the OutputIntent is wrong): a copy of the file
  with the part's profile as OutputIntent and the PDF/X-1a keys; pixel numbers untouched.
  What it did: "assigned ISO Coated v2 (ECI), colours unchanged".
- **colour fix** (anything else): `colourfix` for every part, with its own limit
  (`inkLimitPct[part]`) and profile, rules in this order per pixel:
  1. K ≥ `black.kMinPct` → 0/0/0/100;
  2. **neutral** — max(C,M,Y) − min(C,M,Y) ≤ `black.neutralTolPct` (10) and C+M+Y > 0 →
     K only, at the same lightness: L* of the pixel through the part's profile
     (LittleCMS, CMYK → Lab), K from the profile's K-only ramp with that L* (a 101-step
     lookup, interpolated). E.g. 34/37/35/36 → 0/0/0/≈60;
  3. total ink over the limit → C, M, Y scaled, K kept.
  Then the OutputIntent as in assign. What it did: "pure K 12.4 %, neutral → K 3.1 %, ink
  capped 0.8 % of the area".
- **PDF/X-1a keys:** Catalog `/OutputIntents [<< /Type /OutputIntent /S /GTS_PDFX
  /OutputConditionIdentifier (<id>) /Info (<name>) /RegistryName (http://www.color.org)
  /DestOutputProfile <ICC stream, /N 4> >>]`; Info `/GTS_PDFXVersion (PDF/X-1:2001)`,
  `/GTS_PDFXConformance (PDF/X-1a:2001)`, `/Trapped /False`. One helper
  `artwork.pdfx(doc, profile)` used by assign and the colour fix.

## Facts (`plant/artwork.py`)

- `parsed.outputIntent`: the OutputIntent's profile name, or null (today's
  `iccProfileName` falls back to any ICCBased profile — kept for the customer checklist).
- `CHECKS_VERSION` bumped: cached facts lack `outputIntent`.

## Config (`src/config.js`)

- `printProfiles` per part: `labels`, `innerSleeve`, `outerCover`, `inlay` (ISO Coated v2
  (ECI) to start), each with `conditionId` (e.g. `"FOGRA39"`) besides `name`, `url`, `file`.
- `printCheck.black.neutralTolPct: 10`.
- `src/lib/config-validation.js` checks both.

## Log (`project.json`)

`plant.fixes: [{step, file, sha256, to, at, result, detail?, error?}]`, append-only,
hand-editable:
- `result: "proposed"` when the fix wrote `to`; `"accepted"` / `"dismissed"` later
  (a new entry, same step and sha256); `"refused"` with `error` when the fix failed.
- `detail` is "what it did".
- The pending proposal of a slot: a `proposed` entry for the file in use's sha256 with no
  later entry for it. Shown, not made again.
- A refused step counts like dismissed for that sha256 (no retry on every load); the page
  shows the error and "needs correction by hand".
- History lines as today: "Label A: size — crop/add bleed 1:1 accepted (v1 → v2)".

## Plant server (`plant/server.py`)

- `POST /api/fix` `{job, file, newName, step, params, fix}` → `{name, detail}`. Dispatches
  to `geomfix.render` (size, pdf), `colourfix.fix` (colour fix) or `colourfix.assign`;
  409 when `newName` exists, 400 on a refused fix. Replaces `/api/fix/label`,
  `/api/fix/geometry`, `/api/fix/geometry/preview`.
- `POST /api/trash` `{job, files: [name], project, basedOn}` → moves each top-level file
  into `<job>/.trash/` (a name already there gets `_<n>` before the extension), then saves
  `project.json` (the dismiss / trash log) with the 409 guard.
- `jobs.py`: `trash(folder, name)`.

## Page (`src/plant/app.js`, `src/lib/plant-overview.js`)

Per checked slot, in the artwork section:
1. the file in use: preview with cut lines, its checks;
2. a red line when the flow stopped: the step and "needs correction by hand — fix the file
   and save it into the job folder (same name, or any name + use)";
3. the pending proposal: preview with cut lines, "what it did", all its checks,
   **accept** / **dismiss**;
4. in the slot table, each version not in use with **use** and **trash**; when the file in
   use passes every step, **trash old versions (N)**.

On load (in `fixerStages`), after the checks: for the first slot whose current step has a
fix and no pending proposal, `POST /api/fix`, log `proposed`, reload. One fix per load.
Accept: `useVersion` + log `accepted` + history, via `/api/assign`. Dismiss: `/api/trash`
with the log entry.

Removed: `renderProduction`'s step strip (the section keeps the current action button),
`newerToCompare` side-by-side (the proposal replaces it), the geometry tiles and their
endpoints, `fixerTargets` (lines no longer drive a fixer).

## Manual correction

When a step stops with "needs correction by hand", or staff dismiss and don't want the
proposal: someone fixes the file (Photoshop, InDesign) and saves it into the job folder.
- Same name as the file in use: new sha256 → its checks and the flow start again from size.
- Any other name: listed as unmanaged; **use** on the slot makes it the next `_v<N>`.
- The customer can resend through the inbox as before.

## Testing

- `tests/artwork-checks.test.js`: `fixStep` — order (size before pdf before colour),
  dismissed steps skipped, wrong ratio → manual, rule choice keep / fit / rebuild, pdf on
  JPG and PDF 1.7, colour assign vs fix, all pass → null.
- `tests/plant-overview.test.js`: proposal box (preview, detail, checks, accept/dismiss),
  manual line, trash buttons, trash old versions only when all pass; no step strip.
- `plant/test_colourfix.py`: neutral → K at the same L* (34/37/35/36 → K ≈ 60 ± 3), tinted
  pixels untouched by the neutral rule, rule order; flat-part limit 300.
- `plant/test_artwork.py`: `raster_pdf` writes `%PDF-1.3` and no ObjStm; `pdfx` sets
  OutputIntent and keys, `outputIntent` fact reads it back.
- `plant/test_jobs.py`, `plant/test_server.py`: trash moves into `.trash/` with `_<n>` on
  a clash, never touches dot files or folders; `/api/fix` dispatch, 409, 400.
- `tests/config-validation.test.js`: profiles per part, `conditionId`, `neutralTolPct`.

## Out of scope

- Fixing a wrong aspect ratio; a full PDF/X preflight; spot colours (rasterized into CMYK
  as before); represses; customer-side fixes.
