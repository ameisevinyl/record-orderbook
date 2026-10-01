# Artwork geometry fix — design

Status: approved in conversation 2026-10-01, pending written-spec review. Deep checks,
next to the label colour fix (`2026-10-01-label-colour-fix-design.md`).

## Context

Printed parts must arrive at exactly the data size (trim + bleed). Typical faults:
- wrong size: another plant's template, or the wrong bleed — e.g. KMPN012 (7", target
  92 + 2×3 = 98 mm) sent its labels at 96.0 mm, background to the edge;
- right size, empty bleed: the artwork was trimmed to the finished size and placed on a
  white data area;
- a raster with right pixels but a wrong or missing dpi tag, so its size reads wrong.

Today staff fix these by hand. This feature computes the fixes that apply, shows each as a
preview with the cut lines, and writes the one staff pick as the slot's next version.

## Decisions

- **Plant view only.** The customer page can't render a PDF without a dependency.
- **All printed parts:** labels (round) and inner sleeve, cover, inlay (rect).
- **Raster:** a fixed file is one raster at the part's `fixDpi`, in a PDF — a PDF that
  needs fixing may be rasterized (like the colour fix). Colour numbers are kept: CMYK and
  grey read unmanaged, RGB stays RGB (the colour checks judge it as before).
- **Bleed fill: mirror** — outward from the kept region's edge; radial for labels
  (d′ = 2r − d), per axis for rects (corners mirror twice).
- **Resolution: always delivered at `fixDpi`.** The file goes on to a printing house that
  expects a minimum (e.g. 300 dpi); a 300 dpi label scaled 96 → 98 mm would be 294 dpi.
  So every fixed file is written at the part's `fixDpi`: PDFs rendered at it, rasters
  resampled to it with Pillow (`LANCZOS`, CMYK native — no own resampler, no new library;
  pyvips only if Pillow's memory ever becomes a problem). Upsampling adds no detail, so
  each candidate shows the real detail (`dpiAfter`) next to the output dpi and warns below
  `dpi.min`; the history entry records it.
- **Rules in JS, pixels in Python:** which candidates apply and their geometry come from
  `src/lib/artwork-checks.js`; `plant/geomfix.py` renders what it is handed.
- **Previews automatic, write on pick:** previews only (`.checks/`); the full file is
  written when staff pick a candidate. Never overwrite.

## Candidates (`geometryFixes(facts, params)` in `src/lib/artwork-checks.js`)

S = the file's data area in mm (`facts.pageMm`), T = `params.targetMm`, trim =
`params.trimMm`. Every candidate is centred: the source, scaled by `scale`, is placed with
its centre on T's centre; whatever falls outside T is cropped.

```js
{id, title, scale, keep, fill, dpiAfter}
// keep: "file" (the whole source) | "trim" (trim circle for a round part, trim rect else)
// fill: "mirror" | null — fills T outside the scaled keep region
// dpiAfter: facts' effective (or declared) dpi / scale; null when unknown (pure vector)
```

| id | applies when | scale | keep | fill |
|---|---|---|---|---|
| `fit` "Scale to fit" | Size row fails | max(Tw/Sw, Th/Sh) | file | — |
| `keep` "Keep 1:1" | Size row fails and Sw ≥ trimW and Sh ≥ trimH | 1 | file | mirror |
| `rebuild` "Trim + rebuild bleed" | Size row ok, Bleed row "trimmed" | 1 | trim | mirror |
| `zoom` "Zoom into bleed" | Size row ok, Bleed row "trimmed" | max(Tw/trimW, Th/trimH) | file | — |

- `fit` scales to cover T: a different aspect is cropped centred, the crop shown in the
  title ("crops 4 mm left/right").
- `keep` mirrors where S is smaller than T and crops where it's larger.
- A file smaller than the trim gets only `fit`: mirroring would reach inside the cut.
- The Size and Bleed rows are the existing ones (`artworkRows`), so a candidate exists
  exactly when the checks complain.
- KMPN012: `fit` (×1.021, 300 → 294 dpi) and `keep` (mirror 1 mm).

## Rendering (`plant/geomfix.py`)

```python
render(path, params, candidate, out, dpi)   # writes out (.pdf, or .png for a preview)
```

1. **Source to pixels** in its own numbers (`colourfix._raster`'s reading, moved to a shared
   helper): a PDF is rendered on its data box at `dpi` × `scale`, so it lands at `dpi`
   after scaling; a JPG/TIFF is resampled with Pillow `LANCZOS` to the same pixel size
   (a mis-tagged raster's real size comes from its pixels and `fit`'s scale).
2. **Geometry in numpy:** the source centred on a T canvas; pixels outside the keep
   region (inside T) take the mirrored pixel — rect: `numpy.pad(mode="symmetric")`;
   round: d′ = 2r − d by index arithmetic (no library does radial mirroring).
3. **PDF:** one image, page = T = BleedBox, TrimBox = trim centred (as `colourfix.fix_label`).
4. **Preview:** the same at 72 dpi, converted for display (RGB, like the check previews),
   written as PNG at `PREVIEW_PX` long side.

`FixError` (message to the page) for unreadable files and encrypted PDFs.

## Config (`src/config.js`)

- `printCheck.fixDpi` becomes per part, like `inkLimitPct`:
  `{ labels: 1200, innerSleeve: 400, outerCover: 400, inlay: 400 }`. The colour fix reads
  `fixDpi.labels`. A cover at 400 dpi is ~10000×5000 px × 4 channels ≈ 200 MB — no strips.
- `src/lib/config-validation.js` checks each entry is a positive integer.

## Plant server (`plant/server.py`)

- `POST /api/fix/geometry/preview` `{job, file, params, candidates}` → `{previews: {id: name}}`.
  Name `<file>.<sha12>.<id>.png` in `.checks/`; an existing one is reused, so a reload
  doesn't render again.
- `POST /api/fix/geometry` `{job, file, newName, params, candidate}` → `{name}`. Writes the
  full-resolution PDF; 409 when `newName` exists. Same shape as `/api/fix/label`.

## Page (`src/plant/app.js`, `src/lib/plant-overview.js`)

- After the artwork checks, in `CONFIG.fixerStages`: for each checked slot with candidates,
  request the previews (one slot after another, progress in the busy line).
- Under the slot's preview: one tile per candidate — preview, `cutLinesSvg` with
  page = T, trim centred, bleed, round, hole — and a caption, e.g.
  "Scale to fit · ×1.021 · detail 294 → 1200 dpi", "Keep 1:1 · mirror 1 mm". A `dpiAfter`
  below `printCheck.dpi.min` is shown as a warning.
- Button "use this": `/api/fix/geometry` with `nextVersionName(base, ".pdf")`, then
  `/api/assign` makes it the slot's file; history: "Label A: size fix (keep 1:1),
  KMPN012_labels_A_v1.pdf → KMPN012_labels_A_v2.pdf, detail 294 dpi". Picking is the decision.
- Outside `fixerStages` no previews are made (opening a finished job only looks).

## Lines

- A pick writes no line log entry: the new file passes size/bleed by its checks.
- The colour fixer then runs on the new file by itself — `fixerTargets` only skips files a
  `by: "fixer"` entry names. Its "fix the size first" stays as the guard.
- Non-label parts have no line yet; their candidates show in the artwork section all the same.

## Testing

- `tests/artwork-checks.test.js`, `geometryFixes`: KMPN012 → `fit` + `keep`; exact size
  with empty bleed → `rebuild` + `zoom`; smaller than trim → `fit` only; aspect mismatch
  crop; `dpiAfter` (declared, effective, null); a passing file → none.
- `plant/test_geomfix.py` on synthetic CMYK PDF and TIFF: output size = T; kept pixels keep
  their exact numbers (scale 1); a mirrored pixel equals its source pixel (rect and radial);
  a 300 dpi raster scaled up comes out at `fixDpi`; TrimBox centred.
- `plant/test_server.py`: preview cached by name; fix never writes over an existing file.
- `tests/config-validation.test.js`: `fixDpi` per part.

## Out of scope

- Customer-side suggestions; sharpening or AI upscaling; content-aware fill; moving artwork
  off-centre; lines for non-label parts.
