# Artwork Geometry Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant view offers size and bleed fixes (scale to fit, keep 1:1, trim + rebuild bleed, zoom into bleed) for every printed part whose Size or Bleed row fails, shows each as a preview with cut lines, and writes the one staff pick as the slot's next `_v<N>.pdf` at the part's `fixDpi`.

**Architecture:** `geometryFixes` in `src/lib/artwork-checks.js` (pure JS) decides which candidates apply and their geometry. `plant/geomfix.py` renders a candidate it is handed: source pixels in its own colours (shared helper `artwork.pixels`), scaled, centred, mirrored outside the kept region, one raster PDF (shared helper `artwork.raster_pdf`). Two server endpoints (preview, fix); the page shows tiles under the slot's preview and a "use this" button that writes and uses the fix.

**Tech Stack:** Node ≥18 `node --test`; Python stdlib server, PyMuPDF, Pillow (`LANCZOS`), numpy (`numpy.pad`), `unittest`. No new libraries.

**Spec:** `docs/superpowers/specs/2026-10-01-artwork-geometry-fix-design.md`

## Global Constraints

- No new runtime dependencies (browser) and no new Python libraries: PyMuPDF, Pillow, numpy only.
- Never overwrite: a fix is the slot's next `_v<N>.pdf`; the fix endpoint answers 409 when the name exists.
- Colours kept: CMYK and grey read as their own numbers (colour management off), RGB stays RGB.
- Every fixed file is written at `printCheck.fixDpi[part]`: `{ labels: 1200, innerSleeve: 400, outerCover: 400, inlay: 400 }`.
- Previews only in `CONFIG.fixerStages`; named `<file>.<sha12>.<id>.<geometry8>.png` in the job's `.checks/`, made once.
- A pick writes no line log entry (the colour fixer must still run on the new file).
- Comments short, explain why; match the surrounding style. Commit messages short, imperative, precise, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Run `node --test tests/` and `uv run --project plant python -m unittest discover plant` before each commit that touches the respective side.

## Review Focus

1. Encrypted or unreadable file in a slot whose Size row fails — the preview request answers 400 with a message, the page shows it and goes on with the next slot (Task 5 test).
2. Multi-page PDF with a page choice — the fix renders the slot's page, not page 1 (Task 4 test).
3. A PDF with `/Rotate` — rendered as displayed, so its size matches the Size row (Task 3 test).
4. Grey (mode L, 2-D array) and RGB sources — padding and the PDF image keep their mode (Task 4 tests).
5. Mis-tagged raster (72 dpi tag on print pixels) — only `fit`, dpiAfter shows the real detail (Task 2 test).

---

### Task 1: `fixDpi` per part

**Files:**
- Modify: `src/config.js` (three `fixDpi: 1200,` lines, ~103, ~230, ~313, and their comment)
- Modify: `src/lib/config-validation.js:42-75` (`validatePrintCheck`)
- Modify: `src/plant/app.js:234`, `src/plant/app.js:324`
- Modify: `plant/CLAUDE.md` (colourfix bullet)
- Test: `tests/config-validation.test.js:209-213`

**Interfaces:**
- Produces: `printCheck.fixDpi` = `{labels, innerSleeve, outerCover, inlay}` (positive integers). `colourfix` keeps taking `params.fixDpi` as a number; the page passes `printCheck.fixDpi.labels`.

- [ ] **Step 1: Write the failing test** — replace the first block of `test("validates fixDpi and the print profiles", …)`:

```js
test("validates fixDpi and the print profiles", () => {
  const dpi = copy();
  dpi.formats[0].printCheck.fixDpi.inlay = 0;
  assert.throws(() => validateConfig(dpi), /CONFIG\.formats\[0\]\.printCheck\.fixDpi\.inlay must be a positive integer/);
  const flat = copy();
  flat.formats[0].printCheck.fixDpi = 1200;
  assert.throws(() => validateConfig(flat), /CONFIG\.formats\[0\]\.printCheck\.fixDpi must be an object/);
```

(keep the profile assertions that follow unchanged)

- [ ] **Step 2: Run it** — `node --test tests/config-validation.test.js` → FAIL (`fixDpi.inlay` of a number).

- [ ] **Step 3: Implement**

`src/config.js`, all three formats:

```js
        // Resolution of a plant-side fix per part (colour fix: labels; size/bleed fix: all).
        fixDpi: { labels: 1200, innerSleeve: 400, outerCover: 400, inlay: 400 },
```

`src/lib/config-validation.js` — above `validatePrintCheck`:

```js
const PRINTED_PARTS = ["labels", "innerSleeve", "outerCover", "inlay"];
```

replace the `fixDpi` line:

```js
  const fixDpi = object(printCheck.fixDpi, `${path}.fixDpi`);
  for(const part of PRINTED_PARTS){
    if(!Number.isInteger(fixDpi[part]) || fixDpi[part] <= 0) fail(`${path}.fixDpi.${part}`, "must be a positive integer");
  }
```

and the ink loop's literal list becomes `for(const part of PRINTED_PARTS){`.

`src/plant/app.js` — line 234: `fixDpi: printCheck.fixDpi.labels`; line 324: `fixDpi: getFormat(CONFIG, view.format).printCheck.fixDpi.labels`.

`plant/CLAUDE.md` colourfix bullet: `` one CMYK image at `printCheck.fixDpi.labels` ``.

- [ ] **Step 4: Run** — `node --test tests/` → PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/lib/config-validation.js src/plant/app.js plant/CLAUDE.md tests/config-validation.test.js
git commit -m "config: fixDpi per printed part (labels 1200, flat parts 400)"
```

---

### Task 2: `geometryFixes` — which fixes apply

**Files:**
- Modify: `src/lib/artwork-checks.js` (new `bleedTrimmed`, used by `measuredRows`; new export `geometryFixes`)
- Test: `tests/artwork-checks.test.js`

**Interfaces:**
- Consumes: check facts (`pageMm`, `parsed.effectiveDpi`, `parsed.declaredDpi`, `bleed.{outerInkPct, innerInkPct}`, `error`), slot params (`targetMm`, `trimMm`, `bleedMm`, `toleranceMm`).
- Produces: `geometryFixes(facts, params) → [{id: "fit"|"keep"|"rebuild"|"zoom", title: string, scale: number, keep: "file"|"trim", fill: "mirror"|null, dpiAfter: number|null}]`.

- [ ] **Step 1: Write the failing tests** — add `geometryFixes` to the import, then:

```js
const geo = (pageMm, over = {}) => ({kind: "pdf", parsed: {...clean.parsed, effectiveDpi: null, ...over.parsed},
  pageMm, ink: clean.ink, black: clean.black, bleed: {outerInkPct: 95, innerInkPct: 97, ...over.bleed}});
const label7 = {targetMm: {w: 98, h: 98}, trimMm: {w: 92, h: 92}, bleedMm: 3, toleranceMm: 0.5, round: true};

test("geometryFixes: a 96 mm label for 92 + 3 — scale to fit or keep 1:1 and mirror", () => {
  const fixes = geometryFixes(geo({w: 96.012, h: 96.012}, {parsed: {effectiveDpi: {x: 300, y: 300}}}), label7);
  assert.deepEqual(fixes.map(f => [f.id, f.title, f.keep, f.fill, f.dpiAfter]), [
    ["fit", "Scale to fit · ×1.021", "file", null, 294],
    ["keep", "Keep 1:1 · mirror 1.0 mm", "file", "mirror", 300]]);
  assert.ok(Math.abs(fixes[0].scale - 98 / 96.012) < 1e-9);
  assert.equal(fixes[1].scale, 1);
});

test("geometryFixes: right size, empty bleed — rebuild or zoom", () => {
  const fixes = geometryFixes(geo({w: 106, h: 106}, {bleed: {outerInkPct: 1, innerInkPct: 90}}), params);
  assert.deepEqual(fixes.map(f => [f.id, f.title, f.scale, f.keep, f.fill, f.dpiAfter]), [
    ["rebuild", "Trim + rebuild bleed · mirror 3.0 mm", 1, "trim", "mirror", null],
    ["zoom", "Zoom into bleed · ×1.060", 1.06, "file", null, null]]);
});

test("geometryFixes: smaller than the trim — only scale to fit", () => {
  assert.deepEqual(geometryFixes(geo({w: 90, h: 90}), params).map(f => f.id), ["fit"]);
});

test("geometryFixes: other aspect — cover and crop centred", () => {
  const fixes = geometryFixes(geo({w: 212, h: 106}), params);
  assert.deepEqual(fixes.map(f => f.title), ["Scale to fit · ×1.000 · crops 53.0 mm", "Keep 1:1 · crops 53.0 mm"]);
});

test("geometryFixes: a 72 dpi tag on print pixels — fit shows the real detail", () => {
  const fixes = geometryFixes(geo({w: 1158 / 72 * 25.4, h: 1158 / 72 * 25.4}, {parsed: {declaredDpi: {x: 72, y: 72}}}), label7);
  assert.deepEqual(fixes.map(f => [f.id, f.dpiAfter]), [["fit", 300], ["keep", 72]]);
});

test("geometryFixes: nothing for a passing, broken or unmeasured file", () => {
  assert.deepEqual(geometryFixes(geo({w: 106, h: 106}), params), []);
  assert.deepEqual(geometryFixes({error: "can't read"}, params), []);
  assert.deepEqual(geometryFixes({kind: "pdf", parsed: clean.parsed}, params), []);
  assert.deepEqual(geometryFixes(undefined, params), []);
});
```

(`params` and `clean` are the existing fixtures at the top of the file: target 106, trim 100, bleed 3. Add `toleranceMm: 0.5` to `params` if absent — it is used by `geometryFixes`.)

- [ ] **Step 2: Run** — `node --test tests/artwork-checks.test.js` → FAIL (`geometryFixes` is not exported).

- [ ] **Step 3: Implement** in `src/lib/artwork-checks.js`. Above `measuredRows`:

```js
// Ink right inside the cut but hardly any in the bleed: the artwork was
// trimmed to the finished size.
function bleedTrimmed(facts){
  const {outerInkPct: outer, innerInkPct: inner} = facts.bleed;
  return outer !== null && inner >= EDGE_INKED_PCT && outer < BLEED_EMPTY_PCT;
}
```

In `measuredRows` replace `const trimmed = !noBleed && inner >= EDGE_INKED_PCT && outer < BLEED_EMPTY_PCT;` with `const trimmed = bleedTrimmed(facts);` and drop `inner` from the destructuring if unused.

After `fixable`:

```js
// Size and bleed fixes for a checked file, rendered by plant/geomfix.py:
// the source scaled by `scale` and centred on the data size, `keep` (the
// whole "file" or the "trim") kept, the rest mirrored from its edge when
// `fill` is set. dpiAfter: the detail the file really has afterwards —
// the fix is written at fixDpi regardless.
export function geometryFixes(facts, params){
  if(!facts || facts.error || !facts.pageMm || !facts.bleed) return [];
  const S = facts.pageMm, T = params.targetMm, trim = params.trimMm, tol = params.toleranceMm;
  const dpi = facts.parsed.effectiveDpi || facts.parsed.declaredDpi;
  const make = (id, title, scale, keep, fill) => ({id, title, scale, keep, fill,
    dpiAfter: dpi ? Math.round(Math.min(dpi.x, dpi.y) / scale) : null});
  const mm = v => `${v.toFixed(1)} mm`;
  // Per side and axis: cropped (> 0) or missing (< 0) after scaling.
  const over = scale => ({w: (S.w * scale - T.w) / 2, h: (S.h * scale - T.h) / 2});
  const crop = o => Math.max(o.w, o.h) > tol ? ` · crops ${mm(Math.max(o.w, o.h))}` : "";
  if(Math.abs(S.w - T.w) > tol || Math.abs(S.h - T.h) > tol){
    const fit = Math.max(T.w / S.w, T.h / S.h);
    const fixes = [make("fit", `Scale to fit · ×${fit.toFixed(3)}${crop(over(fit))}`, fit, "file", null)];
    // Mirroring a file smaller than the trim would reach inside the cut.
    if(S.w >= trim.w && S.h >= trim.h){
      const o = over(1), mirror = Math.max(0, -o.w, -o.h);
      fixes.push(make("keep", `Keep 1:1${mirror > 0 ? ` · mirror ${mm(mirror)}` : ""}${crop(o)}`, 1, "file", "mirror"));
    }
    return fixes;
  }
  if(!bleedTrimmed(facts)) return [];
  const zoom = Math.max(T.w / trim.w, T.h / trim.h);
  return [make("rebuild", `Trim + rebuild bleed · mirror ${mm(params.bleedMm)}`, 1, "trim", "mirror"),
    make("zoom", `Zoom into bleed · ×${zoom.toFixed(3)}`, zoom, "file", null)];
}
```

- [ ] **Step 4: Run** — `node --test tests/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/artwork-checks.js tests/artwork-checks.test.js
git commit -m "artwork checks: geometryFixes (fit, keep 1:1, rebuild bleed, zoom) with the detail kept"
```

---

### Task 3: Shared pixel reading and raster PDF (`artwork.pixels`, `artwork.raster_pdf`)

**Files:**
- Modify: `plant/artwork.py` (two new functions after `render`)
- Modify: `plant/colourfix.py` (`_raster` and the PDF tail of `fix_label` use them)
- Test: `plant/test_artwork.py`, existing `plant/test_colourfix.py` must stay green

**Interfaces:**
- Produces:
  - `artwork.pixels(path, kind, parsed, params, dpi) → (PIL.Image in mode "CMYK"|"RGB"|"L", page_mm {"w","h"})` — `params` needs `page`, `targetMm`.
  - `artwork.raster_pdf(a: numpy array (h,w[,n]), mode: "CMYK"|"RGB"|"L", page_mm, trim_mm) → pymupdf.Document` — one page of `page_mm` (= BleedBox), the image filling it, TrimBox `trim_mm` centred.
  - `artwork.save_atomic(doc, out)` — saves to `.<name>.part`, then renames.

- [ ] **Step 1: Write the failing tests** in `plant/test_artwork.py`:

```python
class PixelsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_cmyk_pdf_keeps_its_numbers(self):
        path = self.dir / "a.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=50 * MM, height=50 * MM)
        page.draw_rect(page.rect, color=None, fill=(0.6, 0.4, 0.4, 1))
        doc.save(path)
        kind, parsed, _ = artwork.structure(path, 1)
        im, page_mm = artwork.pixels(path, kind, parsed, {"page": 1, "targetMm": {"w": 50, "h": 50}}, 100)
        self.assertEqual(im.mode, "CMYK")
        self.assertEqual(im.getpixel((97, 97)), (153, 102, 102, 255))
        self.assertAlmostEqual(page_mm["w"], 50, places=3)

    def test_rotated_pdf_as_displayed(self):
        path = self.dir / "r.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=100 * MM, height=50 * MM)
        page.draw_rect(page.rect, color=None, fill=(0, 0, 0, 1))
        page.set_rotation(90)
        doc.save(path)
        kind, parsed, _ = artwork.structure(path, 1)
        im, page_mm = artwork.pixels(path, kind, parsed, {"page": 1, "targetMm": {"w": 50, "h": 100}}, 50)
        self.assertLess(im.width, im.height)
        self.assertAlmostEqual(page_mm["h"], 100, places=3)

    def test_raster_resampled_to_dpi(self):
        path = self.dir / "t.tif"
        Image.new("CMYK", (300, 300), (0, 0, 0, 255)).save(path, dpi=(300, 300))
        kind, parsed, _ = artwork.structure(path, 1)
        im, page_mm = artwork.pixels(path, kind, parsed, {"page": 1, "targetMm": {"w": 25.4, "h": 25.4}}, 150)
        self.assertEqual(im.size, (150, 150))
        self.assertAlmostEqual(page_mm["w"], 25.4, places=3)

    def test_raster_pdf_boxes(self):
        import numpy
        doc = artwork.raster_pdf(numpy.zeros((10, 20), numpy.uint8), "L", {"w": 106, "h": 53}, {"w": 100, "h": 47})
        page = doc[0]
        self.assertAlmostEqual(page.rect.width / MM, 106, places=3)
        self.assertAlmostEqual(page.trimbox.x0 / MM, 3, places=3)
        self.assertEqual(pymupdf.Pixmap(doc, page.get_images(full=True)[0][0]).n, 1)
```

- [ ] **Step 2: Run** — `cd plant && uv run --project . python -m unittest test_artwork -v` → FAIL (`no attribute 'pixels'`).

- [ ] **Step 3: Implement** in `plant/artwork.py`, after `render`:

```python
def pixels(path, kind, parsed, params, dpi):
    """The data area as a Pillow image at dpi, in its own colours: CMYK and
    grey as their numbers, RGB as RGB; a PDF on its data box as displayed
    (/Rotate), a raster resampled with Lanczos. Returns (image, data size in mm)."""
    if kind == "pdf":
        doc = pymupdf.open(path)
        page = doc[params["page"] - 1]
        clip = (data_box(doc, page) * page.rotation_matrix).normalize()
        page_mm = size_mm(clip)
        # Only a PDF known to be RGB is RGB: "unknown" is mostly vector
        # CMYK painted with cs/scn, read as its own numbers.
        mode = parsed["colorMode"]
        space = pymupdf.csRGB if mode == "RGB" else pymupdf.csGRAY if mode == "Gray" else pymupdf.csCMYK
        pix = render(page, clip, page_mm, dpi, space, managed=mode == "RGB")
        return Image.frombytes({1: "L", 3: "RGB", 4: "CMYK"}[pix.n], (pix.width, pix.height), pix.samples), page_mm
    im = Image.open(path)
    im.load()
    if im.mode not in ("CMYK", "RGB", "L"):
        im = im.convert("L" if im.mode in ("1", "LA", "I", "I;16") else "RGB")
    dpi_in = parsed["declaredDpi"]
    page_mm = ({"w": im.width / dpi_in["x"] * 25.4, "h": im.height / dpi_in["y"] * 25.4}
               if dpi_in else dict(params["targetMm"]))
    size = (round(page_mm["w"] / 25.4 * dpi), round(page_mm["h"] / 25.4 * dpi))
    return (im if im.size == size else im.resize(size, Image.LANCZOS)), page_mm


def raster_pdf(a, mode, page_mm, trim_mm):
    """One image filling a page of page_mm (the BleedBox), TrimBox trim_mm centred."""
    doc = pymupdf.open()
    page = doc.new_page(width=page_mm["w"] / MM_PER_PT, height=page_mm["h"] / MM_PER_PT)
    space = {"CMYK": pymupdf.csCMYK, "RGB": pymupdf.csRGB, "L": pymupdf.csGRAY}[mode]
    page.insert_image(page.rect, pixmap=pymupdf.Pixmap(space, a.shape[1], a.shape[0],
                                                       numpy.ascontiguousarray(a).tobytes(), 0))
    page.set_bleedbox(page.rect)
    tx, ty = (page_mm["w"] - trim_mm["w"]) / 2 / MM_PER_PT, (page_mm["h"] - trim_mm["h"]) / 2 / MM_PER_PT
    page.set_trimbox(pymupdf.Rect(tx, ty, tx + trim_mm["w"] / MM_PER_PT, ty + trim_mm["h"] / MM_PER_PT))
    return doc


def save_atomic(doc, out):
    """Never a half-written file under the final name."""
    part = out.with_name(f".{out.name}.part")
    doc.save(part, deflate=True)
    part.rename(out)
```

`plant/colourfix.py` — replace `_raster` with:

```python
def _raster(path, kind, parsed, params, profile_path):
    """(CMYK array, data size in mm). CMYK and grey are read unmanaged."""
    im, page_mm = artwork.pixels(path, kind, parsed, params, params["fixDpi"])
    return _to_cmyk(im, profile_path), page_mm
```

and the end of `fix_label` (from `w, h = …` to `part.rename(out)`) with:

```python
    artwork.save_atomic(artwork.raster_pdf(fixed, "CMYK", page_mm, params["trimMm"]), out)
```

Remove `MM_PER_PT` from `colourfix.py` if now unused.

- [ ] **Step 4: Run** — `uv run --project plant python -m unittest discover plant` → PASS (incl. all `test_colourfix`).

- [ ] **Step 5: Commit**

```bash
git add plant/artwork.py plant/colourfix.py plant/test_artwork.py
git commit -m "plant artwork: pixels (own colours, as displayed, Lanczos) and raster_pdf shared with the colour fix"
```

---

### Task 4: `plant/geomfix.py` — render a candidate

**Files:**
- Create: `plant/geomfix.py`
- Test: `plant/test_geomfix.py`
- Modify: `plant/CLAUDE.md` (new bullet)

**Interfaces:**
- Consumes: `artwork.structure`, `artwork.pixels`, `artwork.raster_pdf`, `artwork.save_atomic`, `artwork.PREVIEW_PX`, `artwork.ArtworkError`.
- Produces:
  - `geomfix.render(path, params, candidate, out: Path, dpi)` — `out` `.pdf` → the fix, `.png` → a preview. `params`: `page`, `targetMm`, `trimMm`, `round`. `candidate`: `scale`, `keep`, `fill` (from Task 2).
  - `geomfix.preview_dpi(target_mm) → float`
  - `geomfix.FixError` (message for the page)
  - `geomfix.radial_mirror(a, r)`, `geomfix.fit(a, h, w, mode)` (tested directly)

- [ ] **Step 1: Write the failing tests** — `plant/test_geomfix.py`:

```python
import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf
from PIL import Image

import artwork
import geomfix

MM = 72 / 25.4
RECT = {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "round": False}
KEEP = {"id": "keep", "scale": 1, "keep": "file", "fill": "mirror"}
REBUILD = {"id": "rebuild", "scale": 1, "keep": "trim", "fill": "mirror"}


def px(mm, dpi):
    return round(mm / 25.4 * dpi)


class MirrorTest(unittest.TestCase):
    def test_radial_mirror_reflects_at_the_circle(self):
        a = numpy.tile(numpy.arange(101, dtype=numpy.uint16), (101, 1))  # value = x
        out = geomfix.radial_mirror(a, 30)
        self.assertEqual(out[50, 85], 75)   # d = 35 → 2·30 − 35 = 25 from the centre
        self.assertEqual(out[50, 60], 60)   # inside: untouched
        self.assertEqual(out[50, 15], 25)

    def test_fit_crops_and_pads(self):
        a = numpy.arange(16, dtype=numpy.uint8).reshape(4, 4)
        self.assertEqual(geomfix.fit(a, 2, 2, "edge").tolist(), [[5, 6], [9, 10]])
        self.assertEqual(geomfix.fit(a, 4, 6, "symmetric")[0].tolist(), [0, 0, 1, 2, 3, 3])


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, out):
        doc = pymupdf.open(out)
        page = doc[0]
        pix = pymupdf.Pixmap(doc, page.get_images(full=True)[0][0])
        return page, pix

    def stripe_pdf(self, size_mm=100):
        """Light K page, a cyan stripe 5 mm wide on the left edge."""
        path = self.dir / "s.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
        page.draw_rect(page.rect, color=None, fill=(0, 0, 0, 0.2))
        page.draw_rect(pymupdf.Rect(0, 0, 5 * MM, size_mm * MM), color=None, fill=(1, 0, 0, 0))
        doc.save(path)
        return path

    def test_keep_mirrors_the_missing_bleed(self):
        out = self.dir / "k.pdf"
        geomfix.render(self.stripe_pdf(), RECT, KEEP, out, 50)
        page, pix = self.image(out)
        self.assertAlmostEqual(page.rect.width / MM, 106, places=2)
        self.assertAlmostEqual(page.trimbox.x0 / MM, 3, places=2)
        self.assertEqual((pix.width, pix.n), (px(106, 50), 4))
        self.assertEqual(pix.pixel(px(1.5, 50), pix.height // 2), (255, 0, 0, 0))   # mirrored stripe
        self.assertEqual(pix.pixel(pix.width // 2, pix.height // 2), (0, 0, 0, 51))  # kept, own numbers

    def test_rebuild_drops_the_white_bleed(self):
        path = self.dir / "w.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=106 * MM, height=106 * MM)
        page.draw_rect(pymupdf.Rect(3 * MM, 3 * MM, 103 * MM, 103 * MM), color=None, fill=(0.5, 0, 0, 0))
        doc.save(path)
        out = self.dir / "r.pdf"
        geomfix.render(path, RECT, REBUILD, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(px(1, 50), px(1, 50)), pix.pixel(pix.width // 2, pix.height // 2))

    def test_fit_resamples_a_raster_to_the_fix_dpi(self):
        path = self.dir / "l.tif"
        Image.new("CMYK", (1134, 1134), (0, 0, 0, 255)).save(path, dpi=(300, 300))
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True}
        out = self.dir / "f.pdf"
        geomfix.render(path, params, {"id": "fit", "scale": 98 / (1134 / 300 * 25.4), "keep": "file", "fill": None}, out, 300)
        page, pix = self.image(out)
        self.assertEqual((pix.width, pix.height), (px(98, 300), px(98, 300)))
        self.assertAlmostEqual(page.trimbox.width / MM, 92, places=2)

    def test_round_rebuild_mirrors_radially(self):
        path = self.dir / "c.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=98 * MM, height=98 * MM)
        page.draw_circle(page.rect.center, 46 * MM, color=None, fill=(0, 1, 0, 0))  # magenta trim circle, white outside
        doc.save(path)
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True}
        out = self.dir / "c_fix.pdf"
        geomfix.render(path, params, REBUILD, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(pix.width // 2, px(1, 50)), (0, 255, 0, 0))  # bleed ring now magenta

    def test_grey_and_rgb_keep_their_mode(self):
        grey = self.dir / "g.jpg"
        Image.new("L", (394, 394), 128).save(grey, dpi=(100, 100))
        out = self.dir / "g.pdf"
        geomfix.render(grey, RECT, KEEP, out, 50)
        self.assertEqual(self.image(out)[1].n, 1)
        rgb = self.dir / "rgb.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=100 * MM, height=100 * MM)
        page.draw_rect(page.rect, color=None, fill=(1, 0, 0))
        doc.save(rgb)
        geomfix.render(rgb, RECT, KEEP, self.dir / "rgb_fix.pdf", 50)
        self.assertEqual(self.image(self.dir / "rgb_fix.pdf")[1].n, 3)

    def test_the_slots_page(self):
        path = self.dir / "p.pdf"
        doc = pymupdf.open()
        for fill in ((0, 0, 0, 1), (0, 0, 1, 0)):
            page = doc.new_page(width=100 * MM, height=100 * MM)
            page.draw_rect(page.rect, color=None, fill=fill)
        doc.save(path)
        out = self.dir / "p_fix.pdf"
        geomfix.render(path, {**RECT, "page": 2}, KEEP, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(pix.width // 2, pix.height // 2), (0, 0, 255, 0))

    def test_preview_png(self):
        out = self.dir / "k.png"
        geomfix.render(self.stripe_pdf(), RECT, KEEP, out, geomfix.preview_dpi(RECT["targetMm"]))
        with Image.open(out) as im:
            self.assertEqual(im.mode, "RGB")
            self.assertLessEqual(abs(max(im.size) - artwork.PREVIEW_PX), 1)

    def test_encrypted_and_unknown_files_refused(self):
        path = self.dir / "e.pdf"
        doc = pymupdf.open()
        doc.new_page()
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
        with self.assertRaisesRegex(geomfix.FixError, "encrypted"):
            geomfix.render(path, RECT, KEEP, self.dir / "e_fix.pdf", 50)
        junk = self.dir / "x.pdf"
        junk.write_bytes(b"nope")
        with self.assertRaises(geomfix.FixError):
            geomfix.render(junk, RECT, KEEP, self.dir / "x_fix.pdf", 50)
        self.assertFalse((self.dir / "e_fix.pdf").exists())
```

- [ ] **Step 2: Run** — `cd plant && uv run --project . python -m unittest test_geomfix -v` → FAIL (`No module named 'geomfix'`).

- [ ] **Step 3: Implement** — `plant/geomfix.py`:

```python
"""Plant-side size and bleed fix for printed parts: the candidate staff
picked (geometryFixes in src/lib/artwork-checks.js) — the source scaled
and centred on the data size, the kept region as it is, the rest mirrored
from its edge — as one raster PDF at fixDpi in the file's own colours.
Spec: docs/superpowers/specs/2026-10-01-artwork-geometry-fix-design.md."""
import numpy
import pymupdf

import artwork

STRIP = 256  # rows per pass of the radial mirror: index arrays stay small at 1200 dpi


class FixError(Exception):
    """A file this fix can't handle; the message goes to the page."""


def fit(a, h, w, mode):
    """a centred on h×w: cropped where larger, padded where smaller —
    "symmetric" mirrors from the edge, "edge" repeats it (scale rounding)."""
    top, left = max(a.shape[0] - h, 0) // 2, max(a.shape[1] - w, 0) // 2
    a = a[top:top + h, left:left + w]
    dy, dx = h - a.shape[0], w - a.shape[1]
    pad = [(dy // 2, dy - dy // 2), (dx // 2, dx - dx // 2)] + [(0, 0)] * (a.ndim - 2)
    return numpy.pad(a, pad, mode=mode)


def radial_mirror(a, r):
    """Pixels further than r (px) from the centre take the pixel mirrored at
    that circle: same angle, d' = 2r − d. Past 2r it stays at the centre —
    corners far outside the bleed are cut away."""
    h, w = a.shape[:2]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    dx = numpy.arange(w, dtype=numpy.float32) - cx
    out = numpy.empty_like(a)
    for y in range(0, h, STRIP):
        dy = (numpy.arange(y, min(y + STRIP, h), dtype=numpy.float32) - cy)[:, None]
        d = numpy.hypot(dx, dy)
        f = numpy.where(d > r, numpy.clip(2 * r - d, 0, None) / numpy.maximum(d, 1e-6), 1)
        sy = numpy.clip(numpy.rint(cy + dy * f), 0, h - 1).astype(numpy.intp)
        sx = numpy.clip(numpy.rint(cx + dx * f), 0, w - 1).astype(numpy.intp)
        out[y:y + STRIP] = a[sy, sx]
    return out


def preview_dpi(target_mm):
    return artwork.PREVIEW_PX / max(target_mm["w"], target_mm["h"]) * 25.4


def build(path, params, candidate, dpi):
    """The fixed data area at dpi: (pixel array, Pillow mode)."""
    try:
        kind, parsed, _ = artwork.structure(path, params["page"])
    except artwork.ArtworkError as error:
        raise FixError(str(error)) from None
    if parsed["encrypted"] and parsed["pageSizeMm"] is None:
        raise FixError("the PDF is encrypted")
    # Rendered at dpi × scale, the source lands at dpi once scaled.
    im, _ = artwork.pixels(path, kind, parsed, params, dpi * candidate["scale"])
    a = numpy.asarray(im)
    px = lambda mm: round(mm / 25.4 * dpi)
    target, trim = params["targetMm"], params["trimMm"]
    h, w = px(target["h"]), px(target["w"])
    if candidate["keep"] == "trim" and params["round"]:
        a = radial_mirror(fit(a, h, w, "edge"), trim["w"] / 2 / 25.4 * dpi)
    elif candidate["keep"] == "trim":
        a = fit(fit(a, px(trim["h"]), px(trim["w"]), "edge"), h, w, "symmetric")
    else:
        a = fit(a, h, w, "symmetric" if candidate["fill"] == "mirror" else "edge")
    return a, im.mode


def render(path, params, candidate, out, dpi):
    """The fix as a PDF (page = data size, TrimBox the trim centred), or for
    an out *.png the same as a preview, shown in RGB like the check previews."""
    a, mode = build(path, params, candidate, dpi)
    doc = artwork.raster_pdf(a, mode, params["targetMm"], params["trimMm"])
    if out.suffix == ".png":
        part = out.with_name(f".{out.name}.part")
        zoom = pymupdf.Matrix(dpi / 72, dpi / 72)  # get_pixmap(dpi=) wants an int
        doc[0].get_pixmap(matrix=zoom, colorspace=pymupdf.csRGB, alpha=False).save(part, output="png")
        part.rename(out)
    else:
        artwork.save_atomic(doc, out)
```


`plant/CLAUDE.md`, after the colourfix bullet:

```markdown
- `geomfix.py` — size and bleed fix, all printed parts: the candidate
  the page picked (`geometryFixes` in `src/lib/artwork-checks.js`:
  fit, keep 1:1, rebuild bleed, zoom), the source in its own colours
  at `fixDpi[part]` (rasters resampled with Lanczos), kept region as
  is, the rest mirrored (`numpy.pad` symmetric; radial for labels),
  one raster PDF; previews the same as PNG. Spec:
  `docs/superpowers/specs/2026-10-01-artwork-geometry-fix-design.md`.
```

- [ ] **Step 4: Run** — `uv run --project plant python -m unittest discover plant` → PASS.

- [ ] **Step 5: Commit**

```bash
git add plant/geomfix.py plant/test_geomfix.py plant/CLAUDE.md
git commit -m "plant geomfix: render a size/bleed fix (scaled, centred, mirrored bleed) as one raster PDF or preview"
```

---

### Task 5: Server endpoints

**Files:**
- Modify: `plant/server.py` (route table ~line 170, `fix_label` ~363, two new methods)
- Test: `plant/test_server.py`

**Interfaces:**
- Consumes: `geomfix.render`, `geomfix.preview_dpi`, `geomfix.FixError`, `checks.preview_base(name, digest)`, `jobs.sha256`, `jobs.plain`, `jobs.find`.
- Produces:
  - `POST /api/fix/geometry/preview` `{job, file, params, candidates: [{id, scale, keep, fill, …}]}` → `{previews: {id: "<file>.<sha12>.<id>.<geometry8>.png"}}`; existing PNGs reused. `geometry8`: first 8 hex of the sha256 of the page, target, trim, round and the candidate's scale/keep/fill, so a changed product never reuses a stale preview. `server.py` imports `hashlib` and `json` at the top if not already.
  - `POST /api/fix/geometry` `{job, file, newName, params (with fixDpi number), candidate}` → `{name}`; 409 if `newName` exists, 400 on `FixError` or a bad name.

- [ ] **Step 1: Write the failing tests** in `plant/test_server.py`, next to `test_fix_label_writes_the_next_version_once`:

```python
    def geometry_job(self):
        import pymupdf
        folder = self.root / "20_DONE" / "X_band_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        doc = pymupdf.open()
        page = doc.new_page(width=96 * 72 / 25.4, height=96 * 72 / 25.4)
        page.draw_rect(page.rect, color=None, fill=(0.6, 0.4, 0.4, 0))
        doc.save(folder / "X_labels_A_v1.pdf")
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True}
        return folder, params, {"id": "keep", "scale": 1, "keep": "file", "fill": "mirror"}

    def test_geometry_previews_are_made_once(self):
        folder, params, keep = self.geometry_job()
        body = {"job": "X_band_261001-1432", "file": "X_labels_A_v1.pdf", "params": params, "candidates": [keep]}
        status, reply = self.post("/api/fix/geometry/preview", body)
        self.assertEqual(status, 200)
        name = reply["previews"]["keep"]
        self.assertRegex(name, r"^X_labels_A_v1\.pdf\.[0-9a-f]{12}\.keep\.[0-9a-f]{8}\.png$")
        made = (folder / ".checks" / name).stat().st_mtime_ns
        self.assertEqual(self.post("/api/fix/geometry/preview", body), (200, reply))
        self.assertEqual((folder / ".checks" / name).stat().st_mtime_ns, made)
        other = {**body, "params": {**params, "targetMm": {"w": 99, "h": 99}}}
        self.assertNotEqual(self.post("/api/fix/geometry/preview", other)[1]["previews"]["keep"], name)
        self.assertEqual(self.post("/api/fix/geometry/preview", {**body, "candidates": [{**keep, "id": "../x"}]})[0], 400)

    def test_geometry_fix_writes_the_next_version_once(self):
        folder, params, keep = self.geometry_job()
        body = {"job": "X_band_261001-1432", "file": "X_labels_A_v1.pdf", "newName": "X_labels_A_v2.pdf",
                "params": {**params, "fixDpi": 100}, "candidate": keep}
        self.assertEqual(self.post("/api/fix/geometry", body), (200, {"name": "X_labels_A_v2.pdf"}))
        self.assertTrue((folder / "X_labels_A_v2.pdf").is_file())
        self.assertEqual(self.post("/api/fix/geometry", body)[0], 409)
        self.assertEqual(self.post("/api/fix/geometry", {**body, "newName": "../x.pdf"})[0], 400)

    def test_geometry_refuses_an_unreadable_file(self):
        folder, params, keep = self.geometry_job()
        (folder / "X_labels_B_v1.pdf").write_bytes(b"nope")
        body = {"job": "X_band_261001-1432", "file": "X_labels_B_v1.pdf", "params": params, "candidates": [keep]}
        self.assertEqual(self.post("/api/fix/geometry/preview", body)[0], 400)
```

- [ ] **Step 2: Run** — `cd plant && uv run --project . python -m unittest test_server -v` → FAIL (404 or no route).

- [ ] **Step 3: Implement** in `plant/server.py`. Route table: add `"/api/fix/geometry/preview": self.fix_geometry_preview, "/api/fix/geometry": self.fix_geometry,` next to `"/api/fix/label": self.fix_label`.

Pull the shared checks out of `fix_label`:

```python
    def fix_paths(self, r):
        """(source, target) of a fix in the job: the source must exist, the
        target must not — a fix never writes over a file."""
        folder = jobs.find(JOBS, r["job"])[1]
        source, target = folder / jobs.plain(r["file"]), folder / jobs.plain(r["newName"])
        if not source.is_file():
            raise JobError(f"no file {r['file']}")
        if target.exists():
            raise Conflict(f"{r['newName']} exists already")
        return source, target
```

`fix_label` then starts with `r = self.body()` and `source, target = self.fix_paths(r)` (the rest unchanged). New methods:

```python
    def fix_geometry(self):
        """A size/bleed fix as the slot's next version (the page names it
        and picks the candidate); the in-use file is never touched (geomfix.py)."""
        import geomfix
        r = self.body()
        source, target = self.fix_paths(r)
        try:
            geomfix.render(source, r["params"], r["candidate"], target, r["params"]["fixDpi"])
        except geomfix.FixError as error:
            raise JobError(str(error)) from None
        self.json({"name": r["newName"]})

    def fix_geometry_preview(self):
        """Previews of the size/bleed fixes the page computed, in .checks/
        named by the file's content and the fix — made once."""
        import checks
        import geomfix
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        source = folder / jobs.plain(r["file"])
        if not source.is_file():
            raise JobError(f"no file {r['file']}")
        out = folder / ".checks"
        out.mkdir(exist_ok=True)
        base = checks.preview_base(r["file"], jobs.sha256(source))
        params, previews = r["params"], {}
        for candidate in r["candidates"]:
            # The geometry is in the name too: another product or format
            # for the same file must not reuse a stale preview.
            what = json.dumps([params["page"], params["targetMm"], params["trimMm"], params["round"],
                               candidate["scale"], candidate["keep"], candidate["fill"]], sort_keys=True)
            key = hashlib.sha256(what.encode()).hexdigest()[:8]
            name = jobs.plain(f"{base}.{jobs.plain(candidate['id'])}.{key}.png")
            if not (out / name).exists():
                try:
                    geomfix.render(source, params, candidate, out / name, geomfix.preview_dpi(params["targetMm"]))
                except geomfix.FixError as error:
                    raise JobError(str(error)) from None
            previews[candidate["id"]] = name
        self.json({"previews": previews})
```

(`jobs.plain` refuses `../x`, a slash or a leading dot → `JobError` → 400.)

- [ ] **Step 4: Run** — `uv run --project plant python -m unittest discover plant` → PASS.

- [ ] **Step 5: Commit**

```bash
git add plant/server.py plant/test_server.py
git commit -m "plant server: /api/fix/geometry (next version, never over a file) and cached previews"
```

---

### Task 6: Candidate tiles in the artwork section

**Files:**
- Modify: `src/lib/plant-overview.js` (`artFileHtml`, `renderArtwork`, new `geometryTilesHtml`)
- Modify: `src/plant/structure.css` (tile grid)
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: Task 2 candidates; `cutLinesSvg(page, trim, bleedMm, round, holeMm)` (existing, same file); `printCheck.fixDpi[part]`, `printCheck.dpi.min`.
- Produces: `renderArtwork(files, checkable, facts, printCheck, base, gaps, compare = [], fixes = {})` — `fixes`: `{fileName: [{candidate, preview}]}`. Button markup: `<button type="button" class="geo" data-slot="<slot index>" data-id="<candidate id>">use this</button>`.

- [ ] **Step 1: Write the failing test** in `tests/plant-overview.test.js` (reuses `files`, `printCheck` of that file; the label slot has index 2 as in the colour-fix test):

```js
test("artwork: size fix tiles with cut lines, detail and a use button", () => {
  const params = {part: "labels", targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, round: true,
    page: 1, inkLimitPct: 220, holeMm: 7.4, black: {kMinPct: 85, cmyMaxPct: 30}, toleranceMm: 0.5};
  const checkable = [{title: "Label A", name: "lab_a_v1.pdf", params}];
  const facts = {"lab_a_v1.pdf": {kind: "pdf", parsed: {pageSizeMm: {w: 104, h: 104}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: {x: 300, y: 300}}, pageMm: {w: 104, h: 104}, trimRectMm: {x: 2, y: 2, w: 100, h: 100},
    ink: {maxPct: 200, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}, preview: "a.png", overlay: "a.overlay.png"}};
  const fixes = {"lab_a_v1.pdf": [
    {candidate: {id: "fit", title: "Scale to fit · ×1.019", scale: 1.019, keep: "file", fill: null, dpiAfter: 294}, preview: "a.fit.png"},
    {candidate: {id: "keep", title: "Keep 1:1 · mirror 1.0 mm", scale: 1, keep: "file", fill: "mirror", dpiAfter: 300}, preview: "a.keep.png"}]};
  const html = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", [], [], fixes);
  assert.ok(html.includes('<img src="/jobs/j1/a.keep.png" alt="">'));
  assert.ok(html.includes('<circle class="trim" cx="53" cy="53" r="50"'));
  assert.ok(html.includes(`Scale to fit · ×1.019 · ${CHECKLIST_ICON.warn} detail 294 → 1200 dpi`));
  assert.ok(html.includes("Keep 1:1 · mirror 1.0 mm · detail 300 → 1200 dpi"));
  assert.ok(html.includes('<button type="button" class="geo" data-slot="2" data-id="keep">use this</button>'));
  assert.ok(!renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", []).includes('class="geo"'));
});
```

Add `import { CHECKLIST_ICON } from "../src/lib/print-artwork.js";` at the top of the test file if not imported.

- [ ] **Step 2: Run** — `node --test tests/plant-overview.test.js` → FAIL.

- [ ] **Step 3: Implement** in `src/lib/plant-overview.js`, after `cutLinesSvg`:

```js
// Size/bleed fix candidates of a file in use: each preview with the cut
// lines where they'll be, the detail it really has, a button to use it.
function geometryTilesHtml(fixes, params, printCheck, base, slotIndex){
  const T = params.targetMm, trim = params.trimMm;
  const rect = {x: (T.w - trim.w) / 2, y: (T.h - trim.h) / 2, ...trim};
  const out = printCheck.fixDpi[params.part];
  return `<div class="geometry">` + fixes.map(({candidate: c, preview}) => {
    const low = c.dpiAfter !== null && c.dpiAfter < printCheck.dpi.min;
    const detail = c.dpiAfter === null ? `${out} dpi` : `detail ${c.dpiAfter} → ${out} dpi`;
    return `<figure><div class="art" style="aspect-ratio:${T.w} / ${T.h}">`
      + `<img src="${escapeHtml(base + encodeURIComponent(preview))}" alt="">`
      + cutLinesSvg(T, rect, params.bleedMm, params.round, params.holeMm) + `</div>`
      + `<figcaption>${escapeHtml(c.title)} · ${low ? CHECKLIST_ICON.warn + " " : ""}${detail} `
      + `<button type="button" class="geo" data-slot="${slotIndex}" data-id="${escapeHtml(c.id)}">use this</button></figcaption></figure>`;
  }).join("") + `</div>`;
}
```

`artFileHtml(…, slotIndex, fixes = [])`: after the `if(facts.preview){ … }` block add

```js
  if(slotIndex !== null && fixes.length) body += geometryTilesHtml(fixes, params, printCheck, base, slotIndex);
```

`renderArtwork(files, checkable, facts, printCheck, base, gaps, compare = [], fixes = {})`: the in-use call becomes
`artFileHtml(c, facts[c.name] || {error: "not checked"}, printCheck, base, slot ? slot.index : null, fixes[c.name] || [])`.
Extend its doc comment: `fixes: {name: [{candidate, preview}]} — size/bleed fix previews (geometryFixes).`

`src/plant/structure.css`, after the `.art` rules:

```css
.geometry{ display:grid; grid-template-columns:repeat(auto-fill, minmax(14rem, 1fr)); gap:1rem; margin:1rem 0; }
.geometry figure{ margin:0; }
```

- [ ] **Step 4: Run** — `node --test tests/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js src/plant/structure.css tests/plant-overview.test.js
git commit -m "plant view: size fix tiles under the file — preview, cut lines, detail, use this"
```

---

### Task 7: Page flow — previews on load, "use this" writes and uses

**Files:**
- Modify: `src/plant/app.js` (imports; `showJob` after the artwork replace; click handler)

**Interfaces:**
- Consumes: `geometryFixes` (Task 2), `/api/fix/geometry/preview` and `/api/fix/geometry` (Task 5), `renderArtwork(…, fixes)` (Task 6), `printCheck.fixDpi[part]` (Task 1), existing `nextVersionName`, `versionOf`, `useVersion`, `historyEntry`, `jobName`, `postJson`, `busy`.
- Produces: `view.fixes` (`{fileName: [{candidate, preview}]}`).

- [ ] **Step 1: Imports** — `import { artworkSlots, newerToCompare, geometryFixes } from "../lib/artwork-checks.js";`

- [ ] **Step 2: Previews in `showJob`** — directly after `replace("basic", renderBasic(…));` and before the colour-fixer loop:

```js
    // Size and bleed fixes: a preview per candidate (made once per file
    // content), under the file for staff to pick; only where fixers run.
    const fixes = {};
    if((CONFIG.fixerStages || []).includes(data.stage)){
      for(const c of checkable){
        const candidates = geometryFixes(artworkFacts[c.name], c.params);
        if(!candidates.length) continue;
        busy(`previewing size fixes of ${c.name}`);
        try{
          const {previews} = await postJson("/api/fix/geometry/preview", {job, file: c.name, params: c.params, candidates});
          if(id !== latest) return;
          fixes[c.name] = candidates.map(candidate => ({candidate, preview: previews[candidate.id]}));
        }catch(err){
          error.textContent = `Couldn't preview size fixes of ${c.name}: ${err.message}`;
        }
      }
      if(Object.keys(fixes).length) replace("artwork", renderArtwork(files, checkable, artworkFacts, printCheck, base, gaps, compare, fixes));
    }
    view.fixes = fixes;
```

- [ ] **Step 3: "use this"** — selector: `".use, #move, #rescan, .merge, #accept, .fix, .geo, .line-act"`. New branch before `} else if(button.matches(".fix")){`:

```js
    } else if(button.matches(".geo")){
      // A size/bleed fix: written as the slot's next version and used —
      // picking is the decision. No line log: the new file passes by its checks.
      const slot = view.slots[Number(button.dataset.slot)];
      const check = view.checkable.find(c => c.name === slot.name);
      const {candidate} = view.fixes[slot.name].find(f => f.candidate.id === button.dataset.id);
      const newName = nextVersionName(versionOf(slot.name).base, ".pdf", view.names);
      busy(`fixing the size of ${slot.name}`);
      await postJson("/api/fix/geometry", {job: view.job, file: slot.name, newName, candidate,
        params: {...check.params, fixDpi: getFormat(CONFIG, view.format).printCheck.fixDpi[check.params.part]}});
      const project = structuredClone(view.raw);
      useVersion(project, slot.path, newName);
      const detail = candidate.dpiAfter === null ? "" : `, detail ${candidate.dpiAfter} dpi`;
      project.history = [...(project.history || []),
        historyEntry(`${slot.title}: size fix (${candidate.title}), ${slot.name} → ${newName}${detail}`, new Date())];
      const {job} = await postJson("/api/assign", {job: view.job, file: newName, newName, project, basedOn: view.hash,
        name: jobName(project)});
      if(job !== view.job){
        location.hash = `#/job/${encodeURIComponent(job)}`;
        return;
      }
```

- [ ] **Step 4: Run all tests** — `node --test tests/` and `uv run --project plant python -m unittest discover plant` → PASS. `node build/build.js` → builds (customer page untouched, but the shared `config.js` changed).

- [ ] **Step 5: Smoke test on the sample job (no browser)** — with the plant server running (restart it so the new endpoints load):

```bash
curl -s -X POST http://127.0.0.1:8765/api/fix/geometry/preview -H 'Content-Type: application/json' -d '{
  "job": "KMPN012_aroop_roy_high_riding_261001-2236", "file": "KMPN012_labels_A_v1.pdf",
  "params": {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": true},
  "candidates": [{"id": "fit", "scale": 1.0207, "keep": "file", "fill": null},
                 {"id": "keep", "scale": 1, "keep": "file", "fill": "mirror"}]}'
```

Expected: `{"previews": {"fit": "KMPN012_labels_A_v1.pdf.d01268a7575c.fit.<8 hex>.png", "keep": "…"}}`; view both PNGs (Read tool) — background continuous to the edge, no seam.

- [ ] **Step 6: Check a written fix** — never in the sample job itself: copy it, write the fix there, check it.

```bash
cp -R plant/jobs/00_INBOX/KMPN012_aroop_roy_high_riding_261001-2236 plant/jobs/20_DONE/KMPN012_smoke_261001-0000
curl -s -X POST http://127.0.0.1:8765/api/fix/geometry -H 'Content-Type: application/json' -d '{
  "job": "KMPN012_smoke_261001-0000", "file": "KMPN012_labels_A_v1.pdf", "newName": "KMPN012_labels_A_v2.pdf",
  "params": {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": true, "fixDpi": 1200},
  "candidate": {"id": "keep", "scale": 1, "keep": "file", "fill": "mirror"}}'
cd plant && uv run --project . python -c "
import artwork, json
p = 'jobs/20_DONE/KMPN012_smoke_261001-0000/KMPN012_labels_A_v2.pdf'
k, parsed, _ = artwork.structure(p, 1)
print(json.dumps({x: parsed[x] for x in ('pageSizeMm', 'trimBoxMm', 'effectiveDpi', 'colorMode')}))"
```

Expected: `pageSizeMm` 98×98, `trimBoxMm` 92×92, `effectiveDpi` ≈ 1200, `colorMode` CMYK. Look at a 100 % crop of the v2 render around the logo: edges smooth, not blocky (the embedded image is upscaled by MuPDF; KMPN012's image has `/Interpolate true`). Then remove the copy with `trash plant/jobs/20_DONE/KMPN012_smoke_261001-0000` and ask the user to open the real job in the plant view and pick one (browser check only with the user's OK).

- [ ] **Step 7: Commit**

```bash
git add src/plant/app.js
git commit -m "plant view: size fix previews on load where fixers run; use this writes the next version and uses it"
```

---

## Self-review notes

- Spec coverage: candidates (T2), rendering incl. resample at fixDpi and mirror (T3, T4), config (T1), endpoints and caching (T5), tiles with cut lines and detail warning (T6), flow, history with detail, no line log (T7), docs (T1, T4). Out of scope items not planned.
- Names used across tasks: `geometryFixes`, `{id, title, scale, keep, fill, dpiAfter}`, `artwork.pixels`, `artwork.raster_pdf`, `artwork.save_atomic`, `geomfix.render/preview_dpi/FixError/fit/radial_mirror`, `/api/fix/geometry[/preview]`, `renderArtwork(…, fixes)`, `.geo` — consistent.
