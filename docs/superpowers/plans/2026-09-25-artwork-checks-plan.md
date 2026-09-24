# Artwork Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant view checks every supplied artwork file exactly on disk — the customer page's checklist on exact values plus ink coverage, rich black and trimmed bleed — with a preview, trim/bleed lines and a problem-area overlay.

**Architecture:** The page derives per-file parameters from the project and `CONFIG` and posts them with `/api/check`. `plant/checks.py` measures (PyMuPDF for PDF structure and rendering, Pillow for JPEG/TIFF headers, numpy for pixels) and writes previews to `plant/work/<stem>.checks/`. Pure JS in `src/lib/artwork-checks.js` judges, reusing `buildChecklistRows`.

**Tech Stack:** Python ≥ 3.12 via uv (`pymupdf`, `pillow`, `numpy`), plain ES modules, `node --test`, `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-25-artwork-checks-design.md` (page field: `docs/superpowers/specs/2026-09-25-pdf-page-choice-design.md`)

**Prerequisite:** the PDF page choice plan (`2026-09-25-pdf-page-choice-plan.md`) is done — slots carry `page`, `buildChecklistRows` takes `page`.

## Global Constraints

- `plant/server.py` stays standard library; only `checks.py`'s artwork part imports `pymupdf`, `PIL`, `numpy`, lazily.
- Without the libraries: `artwork` result is `{"error": "needs PyMuPDF: uv run --project plant plant/server.py"}`; audio unaffected.
- Generated files only in `plant/work/<stem>.checks/`, never inside the unpacked zip.
- Coverage measured at 72 dpi; a pixel is "inked" above 5 % coverage.
- Rule thresholds: Ink and Black fail above 0.5 % of the page area; Bleed fails when `outerInkPct` is null, or `innerInkPct ≥ 20` and `outerInkPct < 5`.
- CONFIG per format `printCheck`: `inkLimitPct: {labels: 220, innerSleeve: 300, outerCover: 300, inlay: 300}`, `black: {kMinPct: 85, cmyMaxPct: 30}`, `checks.ink|black|bleed: {severity: "warn"}`.
- Plant view shows every row (debug mode on).
- Commands: `uv run --project plant plant/server.py`; `uv run --project plant python -m unittest discover plant`; `node --test tests/`.
- Commit messages: short, imperative; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A slot whose `page` is beyond the PDF's page count must yield a per-file `error`, not a crash of the whole check — tested in Task 4.
- An encrypted PDF must report `encrypted: true` and skip pixel work instead of raising — tested in Task 4.
- A label PDF without bleed (page = trim size) must fail Bleed as "no bleed in file", not pass because the bleed band is empty of pixels — tested in Tasks 5 and 7.
- An RGB JPEG without dpi must be measured at `targetMm` (browser behaviour), not at PyMuPDF's default 96 dpi page size — tested in Task 5.
- A POST to `/api/check` with no body (older page) or invalid JSON must answer 200 with audio only, resp. 400 — tested in Task 6.

---

### Task 1: uv project for the plant tools

**Files:**
- Create: `plant/pyproject.toml`, `plant/uv.lock` (generated)
- Modify: `.gitignore`, `CLAUDE.md`

- [ ] **Step 1: pyproject** — create `plant/pyproject.toml`:

```toml
# Plant tools' Python dependencies, run through uv (no package, no build):
#   uv run --project plant plant/server.py
[project]
name = "record-orderbook-plant"
version = "0.0.0"
requires-python = ">=3.12"
dependencies = ["pymupdf", "pillow", "numpy"]

[tool.uv]
package = false
```

- [ ] **Step 2: lock and check** —

Run: `uv lock --project plant && uv run --project plant python -c "import pymupdf, PIL, numpy; print(pymupdf.__version__)"`
Expected: prints a PyMuPDF version; `plant/uv.lock` exists.

- [ ] **Step 3: gitignore** — under the "Plant view working copies" block in `.gitignore` add `/plant/.venv/`.

- [ ] **Step 4: CLAUDE.md** — in Commands replace the two plant lines with:

```
uv run --project plant plant/server.py   # plant view on http://127.0.0.1:8765/
uv run --project plant python -m unittest discover plant   # plant server + checks tests
brew install ffmpeg uv        # plant checks need ffprobe/ffmpeg; uv installs the Python libs
```

and in Architecture extend the `plant/checks.py` bullet with: "Piece 2 (artwork): PyMuPDF/Pillow/numpy facts, ink/black/bleed measurements, preview + overlay PNG; rules in `src/lib/artwork-checks.js`. Spec: `docs/superpowers/specs/2026-09-25-artwork-checks-design.md`."

- [ ] **Step 5: existing tests still run under uv**

Run: `uv run --project plant python -m unittest discover plant`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add plant/pyproject.toml plant/uv.lock .gitignore CLAUDE.md
git commit -m "plant: uv project with pymupdf, pillow, numpy

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CONFIG and its validation

**Files:**
- Modify: `src/config.js` (each format's `printCheck`), `src/lib/config-validation.js`
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces: `format.printCheck.inkLimitPct.{labels, innerSleeve, outerCover, inlay}` (numbers), `format.printCheck.black.{kMinPct, cmyMaxPct}`, `format.printCheck.checks.{ink, black, bleed}.severity`.

- [ ] **Step 1: Failing tests** — append to `tests/config-validation.test.js` (it already builds a valid `config` clone per test; follow the file's existing clone helper — the tests at lines ~41–51 mutate `config.formats[0].printCheck`):

```js
test("printCheck ink limits, black thresholds and new check severities are validated", () => {
  const cases = [
    [c => { delete c.formats[0].printCheck.inkLimitPct.labels; }, /inkLimitPct\.labels/],
    [c => { c.formats[0].printCheck.inkLimitPct.inlay = 500; }, /inkLimitPct\.inlay/],
    [c => { c.formats[0].printCheck.black.kMinPct = "85"; }, /black\.kMinPct/],
    [c => { c.formats[0].printCheck.checks.bleed.severity = "loud"; }, /checks\.bleed\.severity/]
  ];
  for(const [mutate, message] of cases){
    const config = structuredClone(CONFIG);
    mutate(config);
    assert.throws(() => validateConfig(config), message);
  }
  assert.doesNotThrow(() => validateConfig(structuredClone(CONFIG)));
});
```

(If the file imports `CONFIG` under another name, use that.)

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/config-validation.test.js`
Expected: FAIL.

- [ ] **Step 3: CONFIG** — in `src/config.js`, in each of the three formats' `printCheck`, after the `dpi` line add:

```js
        // Max total ink (C+M+Y+K, %) per part. Labels are baked in the
        // oven before pressing, so they stay well below ISO Coated v2 300 %.
        inkLimitPct: { labels: 220, innerSleeve: 300, outerCover: 300, inlay: 300 },
        // Black should be 100 % K: a black-looking pixel (K ≥ kMinPct)
        // with more than cmyMaxPct C+M+Y counts as rich black.
        black: { kMinPct: 85, cmyMaxPct: 30 },
```

and inside `checks` add:

```js
          ink:          { severity: "warn" },
          black:        { severity: "warn" },
          bleed:        { severity: "warn" },
```

(The customer page never produces these rows; they are plant-only.)

- [ ] **Step 4: Validation** — in `src/lib/config-validation.js` add `"ink", "black", "bleed"` to `CHECK_NAMES`, and at the end of `validatePrintCheck`:

```js
  const ink = object(printCheck.inkLimitPct, `${path}.inkLimitPct`);
  for(const part of ["labels", "innerSleeve", "outerCover", "inlay"]){
    number(ink[part], `${path}.inkLimitPct.${part}`);
    if(ink[part] > 400) fail(`${path}.inkLimitPct.${part}`, "must not exceed 400");
  }
  const black = object(printCheck.black, `${path}.black`);
  number(black.kMinPct, `${path}.black.kMinPct`);
  number(black.cmyMaxPct, `${path}.black.cmyMaxPct`);
```

- [ ] **Step 5: Run all tests**

Run: `node --test tests/`
Expected: PASS (fix any test fixture that builds a hand-written printCheck without the new fields by adding them).

- [ ] **Step 6: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/
git commit -m "config: per-part ink limits, black thresholds, ink/black/bleed check severities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `effectiveDpi` in `buildChecklistRows`; export `resolveSeverity`

**Files:**
- Modify: `src/lib/print-artwork.js`
- Test: `tests/print-artwork.test.js`

**Interfaces:**
- Produces: `buildChecklistRows` uses `parsed.effectiveDpi` (`{x, y}`) when present for the Resolution row; `export function resolveSeverity(configSeverity, passed)`.

- [ ] **Step 1: Failing test** — append:

```js
test("buildChecklistRows prefers effectiveDpi over pixels-per-page", () => {
  const parsed = { pageSizeMm: TARGET, imagePx: { w: 5000, h: 5000 }, effectiveDpi: { x: 150, y: 160 },
    declaredDpi: null, colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null,
    encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4", pageCount: 1 };
  const row = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, true).find(r => r.feature === "Resolution");
  assert.equal(row.detected, "~150dpi");
  assert.equal(row.expected, "≥300dpi");
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/print-artwork.test.js`
Expected: FAIL (detected is ~1296dpi).

- [ ] **Step 3: Implement** — in `buildChecklistRows`, directly after the `if(parsed.pageSizeMm){…} else if(parsed.imagePx){…}` block add:

```js
  // The plant measures each placed image's own resolution exactly.
  if(parsed.effectiveDpi) impliedDpi = parsed.effectiveDpi;
```

Change `function resolveSeverity` to `export function resolveSeverity`. Add `effectiveDpi` to the shape comment at the top: `// - effectiveDpi — {x,y}, plant only: lowest resolution of any placed image.`

- [ ] **Step 4: Run all tests**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print-artwork.js tests/print-artwork.test.js
git commit -m "print artwork: exact effectiveDpi overrides the pixels-per-page estimate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `checks.py` — artwork structure facts

**Files:**
- Create: `plant/artwork.py`
- Test: `plant/test_artwork.py`

**Interfaces:**
- Produces: `artwork.structure(path, page)` → `(kind, parsed, unembedded_fonts)`; raises `ArtworkError` with a message for unreadable files or a page beyond the count. `parsed` has exactly the keys `pageSizeMm, imagePx, declaredDpi, colorMode, spotColors, iccProfileName, trimBoxMm, encrypted, hasUnembeddedFonts, pdfVersion, pageCount, effectiveDpi`.

`checks.py` stays the entry point; the artwork code lives in its own module so the audio part never imports the libraries.

- [ ] **Step 1: Failing tests** — create `plant/test_artwork.py`:

```python
import tempfile
import unittest
from pathlib import Path

try:
    import pymupdf
    from PIL import Image
    import artwork
except ImportError:
    pymupdf = None

MM = 72 / 25.4


def pdf(path, size_mm=106, trim_mm=None, fills=(), text=False, image_dpi=None, pages=1):
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
        if trim_mm:
            o = (size_mm - trim_mm) / 2 * MM
            page.set_trimbox(pymupdf.Rect(o, o, o + trim_mm * MM, o + trim_mm * MM))
        for rect_mm, cmyk in fills:
            page.draw_rect(pymupdf.Rect(*(v * MM for v in rect_mm)), color=None, fill=cmyk)
        if text:
            page.insert_text((20, 40), "Label", fontname="helv")  # base-14: not embedded
        if image_dpi:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, image_dpi, image_dpi))
            pix.clear_with(200)
            page.insert_image(pymupdf.Rect(0, 0, 72, 72), pixmap=pix)  # 1 inch
    doc.save(path)


@unittest.skipIf(pymupdf is None, "needs uv run --project plant")
class StructureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_pdf_boxes_fonts_colour_and_dpi(self):
        path = self.dir / "a.pdf"
        pdf(path, trim_mm=100, fills=[((0, 0, 106, 106), (0, 0, 0, 1))], text=True, image_dpi=150)
        kind, parsed, fonts = artwork.structure(path, 1)
        self.assertEqual(kind, "pdf")
        self.assertAlmostEqual(parsed["trimBoxMm"]["w"], 100, places=1)
        self.assertAlmostEqual(parsed["pageSizeMm"]["w"], 100, places=1)  # TrimBox beats MediaBox
        self.assertEqual(parsed["colorMode"], "RGB")  # the RGB image wins
        self.assertEqual(round(parsed["effectiveDpi"]["x"]), 150)
        self.assertTrue(parsed["hasUnembeddedFonts"])
        self.assertIn("Helvetica", fonts)
        self.assertFalse(parsed["encrypted"])
        self.assertEqual(parsed["pageCount"], 1)
        self.assertRegex(parsed["pdfVersion"], r"^\d\.\d$")

    def test_cmyk_vector_only(self):
        path = self.dir / "k.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0, 0, 0, 1))])
        _, parsed, fonts = artwork.structure(path, 1)
        self.assertEqual(parsed["colorMode"], "CMYK")
        self.assertIsNone(parsed["trimBoxMm"])
        self.assertIsNone(parsed["effectiveDpi"])
        self.assertEqual(fonts, [])

    def test_page_beyond_count_is_an_error(self):
        path = self.dir / "two.pdf"
        pdf(path, pages=2)
        self.assertEqual(artwork.structure(path, 2)[1]["pageCount"], 2)
        with self.assertRaisesRegex(artwork.ArtworkError, "page 3 of 2"):
            artwork.structure(path, 3)

    def test_encrypted(self):
        path = self.dir / "enc.pdf"
        doc = pymupdf.open()
        doc.new_page()
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
        _, parsed, _ = artwork.structure(path, 1)
        self.assertTrue(parsed["encrypted"])

    def test_tiff_and_jpeg_headers(self):
        tif, jpg = self.dir / "a.tif", self.dir / "a.jpg"
        Image.new("CMYK", (118, 118), (0, 0, 0, 255)).save(tif, dpi=(300, 300))
        Image.new("RGB", (100, 50), (0, 0, 0)).save(jpg)
        kind, parsed, _ = artwork.structure(tif, 1)
        self.assertEqual((kind, parsed["colorMode"], parsed["declaredDpi"]), ("tiff", "CMYK", {"x": 300, "y": 300}))
        kind, parsed, _ = artwork.structure(jpg, 1)
        self.assertEqual((kind, parsed["colorMode"], parsed["imagePx"]), ("jpeg", "RGB", {"w": 100, "h": 50}))
        self.assertIsNone(parsed["declaredDpi"])

    def test_unreadable(self):
        bad = self.dir / "bad.pdf"
        bad.write_bytes(b"%PDF-1.4 garbage")
        with self.assertRaises(artwork.ArtworkError):
            artwork.structure(bad, 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to see it fail**

Run: `uv run --project plant python -m unittest plant/test_artwork.py` (from repo root: `cd plant && uv run python -m unittest test_artwork`)
Expected: FAIL — `No module named 'artwork'` (tests import it inside the try, so the class is skipped only when PyMuPDF is missing; with uv it errors).

- [ ] **Step 3: Implement** — create `plant/artwork.py`:

```python
"""Artwork facts for the plant view: structure (PyMuPDF for PDF, Pillow
for JPEG/TIFF headers) and pixel measurements (see measure()). The
shape of `parsed` is the one src/lib/print-artwork.js documents, so the
customer page's rules (buildChecklistRows) judge it unchanged.
"""
import io
import re

import numpy
import pymupdf
from PIL import Image, ImageCms

MM_PER_PT = 25.4 / 72


class ArtworkError(Exception):
    """A file the checks can't read; the message goes to the page."""


def sniff(path):
    head = path.open("rb").read(4)
    if head.startswith(b"%PDF"):
        return "pdf"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    return "unknown"


def size_mm(rect):
    return {"w": rect.width * MM_PER_PT, "h": rect.height * MM_PER_PT}


def icc_name(data):
    try:
        return ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(data))).strip() or None
    except (OSError, ImageCms.PyCMSError):
        return "embedded ICC profile (name unavailable)"


def pdf_icc_name(doc):
    # Output intent first (PDF/X): Catalog /OutputIntents [<< /DestOutputProfile n 0 R >>].
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "OutputIntents")
    refs = re.findall(r"(\d+) 0 R", value) if kind in ("array", "xref") else []
    for ref in refs:
        kind, value = doc.xref_get_key(int(ref), "DestOutputProfile")
        if kind == "xref":
            return icc_name(doc.xref_stream(int(value.split()[0])))
    for xref in range(1, doc.xref_length()):
        m = re.search(r"/ICCBased\s+(\d+)\s+0\s+R", doc.xref_object(xref, compressed=False))
        if m:
            return icc_name(doc.xref_stream(int(m.group(1))))
    return None


def spot_colours(doc):
    names = set()
    for xref in range(1, doc.xref_length()):
        obj = doc.xref_object(xref, compressed=False)
        names.update(re.findall(r"/Separation\s*/([^\s/\[\]<>()]+)", obj))
        for group in re.findall(r"/DeviceN\s*\[([^\]]*)\]", obj):
            names.update(re.findall(r"/([^\s/\[\]<>()]+)", group))
    # PDF names escape bytes as #xx (e.g. PANTONE#20185#20C).
    names = {re.sub(r"#([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), n) for n in names}
    return sorted(names - {"All", "None", "Cyan", "Magenta", "Yellow", "Black"})


# Content-stream colour operators: last operand, then the operator.
OPS = {"CMYK": rb"[\d.]\s+[kK]\b", "RGB": rb"[\d.]\s+(?:rg|RG)\b", "Gray": rb"[\d.]\s+[gG]\b"}


def colour_mode(doc, page):
    modes = set()
    for img in page.get_images(full=True):
        n = doc.extract_image(img[0]).get("colorspace", 0)
        modes.add({1: "Gray", 3: "RGB", 4: "CMYK"}.get(n))
    content = page.read_contents()
    modes.update(mode for mode, op in OPS.items() if re.search(op, content))
    # RGB anywhere is what needs fixing, so it wins.
    return next((m for m in ("RGB", "CMYK", "Gray") if m in modes), "unknown")


def effective_dpi(page):
    lowest = None
    for info in page.get_image_info():
        bbox = pymupdf.Rect(info["bbox"])
        if bbox.width <= 0 or bbox.height <= 0:
            continue
        dpi = {"x": info["width"] / (bbox.width / 72), "y": info["height"] / (bbox.height / 72)}
        if lowest is None or min(dpi.values()) < min(lowest.values()):
            lowest = dpi
    return lowest


def raw_box(doc, page, key):
    """The page's own box, or None — PyMuPDF's page.trimbox falls back to
    the MediaBox when the key is absent."""
    return doc.xref_get_key(page.xref, key)[0] != "null"


def pdf_structure(path, page_no):
    try:
        doc = pymupdf.open(path)
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise ArtworkError(f"can't read PDF: {error}") from None
    encrypted = doc.is_encrypted or doc.needs_pass
    if doc.needs_pass:
        # Nothing past the trailer is readable without the password.
        return {"pageSizeMm": None, "imagePx": None, "declaredDpi": None, "colorMode": "unknown",
                "spotColors": [], "iccProfileName": None, "trimBoxMm": None, "encrypted": True,
                "hasUnembeddedFonts": None, "pdfVersion": None, "pageCount": doc.page_count,
                "effectiveDpi": None}, []
    if not 1 <= page_no <= doc.page_count:
        raise ArtworkError(f"page {page_no} of {doc.page_count}")
    page = doc[page_no - 1]
    boxes = {"BleedBox": page.bleedbox, "TrimBox": page.trimbox, "MediaBox": page.mediabox}
    page_box = next(rect for key, rect in boxes.items() if key == "MediaBox" or raw_box(doc, page, key))
    fonts = sorted({f[3].split("+")[-1] for f in page.get_fonts() if f[1] == "n/a" and f[2] != "Type3"})
    images = page.get_images(full=True)
    largest = max(images, key=lambda i: i[2] * i[3], default=None)
    version = (doc.metadata.get("format") or "").removeprefix("PDF ") or None
    return {
        "pageSizeMm": size_mm(page_box),
        "imagePx": {"w": largest[2], "h": largest[3]} if largest else None,
        "declaredDpi": None,
        "colorMode": colour_mode(doc, page),
        "spotColors": spot_colours(doc),
        "iccProfileName": pdf_icc_name(doc),
        "trimBoxMm": size_mm(page.trimbox) if raw_box(doc, page, "TrimBox") else None,
        "encrypted": encrypted,
        "hasUnembeddedFonts": bool(fonts),
        "pdfVersion": version,
        "pageCount": doc.page_count,
        "effectiveDpi": effective_dpi(page),
    }, fonts


def raster_structure(path):
    try:
        with Image.open(path) as im:
            dpi = im.info.get("dpi")
            icc = im.info.get("icc_profile")
            mode, size = im.mode, im.size
    except OSError as error:
        raise ArtworkError(f"can't read image: {error}") from None
    return {
        "pageSizeMm": None,
        "imagePx": {"w": size[0], "h": size[1]},
        "declaredDpi": {"x": round(dpi[0]), "y": round(dpi[1])} if dpi and dpi[0] and dpi[1] else None,
        "colorMode": {"CMYK": "CMYK", "RGB": "RGB", "L": "Gray", "1": "Gray"}.get(mode, "unknown"),
        "spotColors": [],
        "iccProfileName": icc_name(icc) if icc else None,
        "trimBoxMm": None, "encrypted": None, "hasUnembeddedFonts": None, "pdfVersion": None,
        "pageCount": 1, "effectiveDpi": None,
    }, []


def structure(path, page_no):
    kind = sniff(path)
    if kind == "pdf":
        return (kind, *pdf_structure(path, page_no))
    if kind in ("jpeg", "tiff"):
        return (kind, *raster_structure(path))
    raise ArtworkError("unrecognized file — expected PDF, JPG, or TIFF")
```

(`numpy` is imported here already; Task 5 uses it.)

- [ ] **Step 4: Run the tests**

Run: `cd plant && uv run python -m unittest test_artwork -v`
Expected: all PASS. If a PyMuPDF API name differs in the locked version (e.g. `set_trimbox`, `needs_pass`), check `uv run python -c "import pymupdf; help(pymupdf.Page.set_trimbox)"` and adapt — the test's intent stays.

- [ ] **Step 5: Commit**

```bash
git add plant/artwork.py plant/test_artwork.py
git commit -m "plant artwork: structure facts (boxes, fonts, colour, spots, ICC, dpi) in the browser parser's shape

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `artwork.py` — ink, black, bleed, preview, overlay

**Files:**
- Modify: `plant/artwork.py`
- Test: `plant/test_artwork.py`

**Interfaces:**
- Consumes: `structure()` (Task 4).
- Produces: `artwork.facts(path, params, out_dir, base)` → dict `{kind, parsed, unembeddedFonts, pageMm, trimRectMm, ink: {maxPct, overPct}, black: {richPct}, bleed: {outerInkPct, innerInkPct}, preview, overlay}` or `{error}`. `params` is the page's dict: `targetMm, trimMm, bleedMm, round, page, inkLimitPct, black: {kMinPct, cmyMaxPct}, toleranceMm`.

- [ ] **Step 1: Failing tests** — append to `plant/test_artwork.py` inside the module (new class):

```python
LABEL = {"targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "bleedMm": 3, "round": True,
         "page": 1, "inkLimitPct": 220, "black": {"kMinPct": 85, "cmyMaxPct": 30}, "toleranceMm": 0.5}


@unittest.skipIf(pymupdf is None, "needs uv run --project plant")
class MeasureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def facts(self, path, **over):
        return artwork.facts(path, {**LABEL, **over}, self.dir, path.name)

    def test_ink_over_limit_and_rich_black(self):
        path = self.dir / "rich.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0.6, 0.6, 0.6, 1))])
        f = self.facts(path)
        self.assertGreater(f["ink"]["maxPct"], 270)
        self.assertGreater(f["ink"]["overPct"], 99)
        self.assertGreater(f["black"]["richPct"], 99)
        self.assertTrue((self.dir / f["preview"]).is_file())
        self.assertTrue((self.dir / f["overlay"]).is_file())

    def test_pure_k_is_clean(self):
        path = self.dir / "k.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0, 0, 0, 1))])
        f = self.facts(path)
        self.assertLess(f["ink"]["overPct"], 0.5)
        self.assertLess(f["black"]["richPct"], 0.5)

    def test_round_label_trimmed_to_the_circle(self):
        path = self.dir / "trimmed.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=106 * MM, height=106 * MM)
        page.draw_circle((53 * MM, 53 * MM), 50 * MM, color=None, fill=(0, 1, 0, 0))
        doc.save(path)
        b = self.facts(path)["bleed"]
        self.assertGreater(b["innerInkPct"], 90)
        self.assertLess(b["outerInkPct"], 5)

    def test_bled_label_and_no_bleed_in_file(self):
        bled = self.dir / "bled.pdf"
        pdf(bled, fills=[((0, 0, 106, 106), (0, 1, 0, 0))])
        self.assertGreater(self.facts(bled)["bleed"]["outerInkPct"], 90)
        flush = self.dir / "flush.pdf"
        pdf(flush, size_mm=100, fills=[((0, 0, 100, 100), (0, 1, 0, 0))])
        self.assertIsNone(self.facts(flush)["bleed"]["outerInkPct"])

    def test_rect_part_uses_trimbox_position(self):
        path = self.dir / "sleeve.pdf"
        pdf(path, size_mm=106, trim_mm=100, fills=[((3, 3, 103, 103), (0, 1, 0, 0))])
        f = self.facts(path, round=False)
        self.assertAlmostEqual(f["trimRectMm"]["x"], 3, places=1)
        self.assertLess(f["bleed"]["outerInkPct"], 5)
        self.assertGreater(f["bleed"]["innerInkPct"], 90)

    def test_jpeg_without_dpi_is_measured_at_target_size(self):
        jpg = self.dir / "a.jpg"
        Image.new("RGB", (300, 300), (0, 0, 0)).save(jpg)
        f = self.facts(jpg)
        self.assertAlmostEqual(f["pageMm"]["w"], 106, places=1)
        self.assertGreater(f["black"]["richPct"], 90)  # RGB black separates to rich black

    def test_errors_are_per_file(self):
        path = self.dir / "one.pdf"
        pdf(path)
        self.assertIn("page 2 of 1", self.facts(path, page=2)["error"])
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plant && uv run python -m unittest test_artwork -v`
Expected: FAIL — `artwork.facts` missing.

- [ ] **Step 3: Implement** — append to `plant/artwork.py`:

```python
MEASURE_DPI = 72      # 1 px ≈ 0.35 mm, averages like a densitometer spot
INKED_PCT = 5         # a pixel with more coverage counts as printed
PREVIEW_PX = 800      # long side of the preview PNG
OVER = (220, 0, 0, 170)       # overlay: over the ink limit
RICH = (255, 140, 0, 170)     # overlay: rich black


def page_geometry(doc_page, kind, parsed, params):
    """Page size and trim rectangle in mm, top-left origin."""
    if kind == "pdf":
        crop = doc_page.cropbox
        page_mm = size_mm(crop)
        if parsed["trimBoxMm"]:
            t = doc_page.trimbox
            return page_mm, {"x": (t.x0 - crop.x0) * MM_PER_PT, "y": (t.y0 - crop.y0) * MM_PER_PT,
                             "w": t.width * MM_PER_PT, "h": t.height * MM_PER_PT}
    elif parsed["declaredDpi"]:
        px, dpi = parsed["imagePx"], parsed["declaredDpi"]
        page_mm = {"w": px["w"] / dpi["x"] * 25.4, "h": px["h"] / dpi["y"] * 25.4}
    else:
        page_mm = dict(params["targetMm"])  # no dpi: taken to be the data size, as in the browser
    trim = params["trimMm"]
    return page_mm, {"x": (page_mm["w"] - trim["w"]) / 2, "y": (page_mm["h"] - trim["h"]) / 2, **trim}


def render(doc_page, page_mm, dpi, colorspace):
    sx = page_mm["w"] / 25.4 * dpi / doc_page.rect.width
    sy = page_mm["h"] / 25.4 * dpi / doc_page.rect.height
    return doc_page.get_pixmap(matrix=pymupdf.Matrix(sx, sy), colorspace=colorspace, alpha=False)


def bands(shape, trim, bleed_mm, round_):
    """Boolean masks (outside-the-trim bleed band, inside-the-trim band of
    the same width) on a 72 dpi grid."""
    h, w = shape
    px = MEASURE_DPI / 25.4
    ys, xs = numpy.mgrid[0:h, 0:w]
    x, y = (xs + 0.5) / px, (ys + 0.5) / px  # pixel centres in mm
    if round_:
        r = trim["w"] / 2
        d = numpy.hypot(x - (trim["x"] + r), y - (trim["y"] + r))
        return (d > r) & (d <= r + bleed_mm), (d <= r) & (d > r - bleed_mm)

    def inside(grow):
        return ((x >= trim["x"] - grow) & (x <= trim["x"] + trim["w"] + grow)
                & (y >= trim["y"] - grow) & (y <= trim["y"] + trim["h"] + grow))
    return inside(bleed_mm) & ~inside(0), inside(0) & ~inside(-bleed_mm)


def share(mask, where):
    n = where.sum()
    return round(float((mask & where).sum() / n * 100), 2) if n else 0.0


def facts(path, params, out_dir, base):
    try:
        kind, parsed, fonts = structure(path, params["page"])
        if parsed["encrypted"] and parsed["pageSizeMm"] is None:
            return {"kind": kind, "parsed": parsed, "unembeddedFonts": fonts}
        doc = pymupdf.open(path)
        doc_page = doc[params["page"] - 1 if kind == "pdf" else 0]
    except ArtworkError as error:
        return {"error": str(error)}
    page_mm, trim = page_geometry(doc_page, kind, parsed, params)

    cmyk = render(doc_page, page_mm, MEASURE_DPI, pymupdf.csCMYK)
    ink = numpy.frombuffer(cmyk.samples, numpy.uint8).reshape(cmyk.height, cmyk.width, 4) / 255 * 100
    total = ink.sum(axis=2)
    c, m, y, k = (ink[..., i] for i in range(4))
    black = params["black"]
    rich = ((k >= black["kMinPct"]) | ((c >= 60) & (m >= 60) & (y >= 60))) & (c + m + y > black["cmyMaxPct"])
    over = total > params["inkLimitPct"]
    everywhere = numpy.ones_like(over)

    outer, inner = bands(total.shape, trim, params["bleedMm"], params["round"])
    inked = total > INKED_PCT
    tol, bleed = params["toleranceMm"], params["bleedMm"]
    no_bleed = (page_mm["w"] < trim["w"] + 2 * bleed - tol or page_mm["h"] < trim["h"] + 2 * bleed - tol)

    preview_name, overlay_name = base + ".png", base + ".overlay.png"
    scale = PREVIEW_PX / max(page_mm["w"], page_mm["h"]) * 25.4
    render(doc_page, page_mm, scale, pymupdf.csRGB).save(out_dir / preview_name)
    layer = numpy.zeros((*total.shape, 4), numpy.uint8)
    layer[over] = OVER
    layer[rich] = RICH
    preview_size = Image.open(out_dir / preview_name).size
    Image.fromarray(layer, "RGBA").resize(preview_size, Image.NEAREST).save(out_dir / overlay_name)

    return {
        "kind": kind, "parsed": parsed, "unembeddedFonts": fonts,
        "pageMm": page_mm, "trimRectMm": trim,
        "ink": {"maxPct": round(float(total.max()), 1), "overPct": share(over, everywhere)},
        "black": {"richPct": share(rich, everywhere)},
        "bleed": {"outerInkPct": None if no_bleed else share(inked, outer), "innerInkPct": share(inked, inner)},
        "preview": preview_name, "overlay": overlay_name,
    }
```

Note: for an encrypted file that still opens (owner password only) `structure` returns a full `parsed` and measuring proceeds.

- [ ] **Step 4: Run the tests**

Run: `cd plant && uv run python -m unittest test_artwork -v`
Expected: PASS. If `test_jpeg_without_dpi…` fails on richPct, print `ink.max(axis=(0,1))` for the black JPEG: MuPDF's default RGB→CMYK should give high CMY plus K for pure black; adjust only the test's expectation, not the rule, and note the observed values in the commit message.

- [ ] **Step 5: Commit**

```bash
git add plant/artwork.py plant/test_artwork.py
git commit -m "plant artwork: ink coverage, rich black, bleed bands, preview and overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Wire artwork into `checks.run` and `/api/check`

**Files:**
- Modify: `plant/checks.py`, `plant/server.py`
- Test: `plant/test_checks.py`, `plant/test_server.py`

**Interfaces:**
- Consumes: `artwork.facts` (Task 5).
- Produces: `checks.run(project_dir, out_dir, artwork_params=None)` → the audio result (`{files}` or `{error: "needs ffmpeg"}`) plus key `artwork`: `{name: facts}` or `{error}`; `/api/check` accepts JSON `{artwork: {name: params}}` (empty body = `{}`).

- [ ] **Step 1: Failing tests** — in `plant/test_checks.py` add:

```python
class ArtworkWiringTest(unittest.TestCase):
    def test_run_passes_params_and_keeps_audio_errors_separate(self):
        import checks
        saved_which, saved_artwork = checks.shutil.which, checks.artwork_facts
        checks.shutil.which = lambda name: None
        checks.artwork_facts = lambda path, params, out_dir, base: {"page": params["page"], "base": base}
        try:
            with tempfile.TemporaryDirectory() as tmp:
                project = Path(tmp) / "p"
                project.mkdir()
                (project / "L.pdf").write_bytes(b"%PDF")
                result = run(project, Path(tmp) / "out", {"L.pdf": {"page": 2}, "gone.pdf": {"page": 1}})
            self.assertEqual(result["error"], "needs ffmpeg")
            self.assertEqual(result["artwork"]["L.pdf"], {"page": 2, "base": "L.pdf"})
            self.assertEqual(result["artwork"]["gone.pdf"], {"error": "not in the zip"})
        finally:
            checks.shutil.which, checks.artwork_facts = saved_which, saved_artwork
```

In `plant/test_server.py`, class `HttpTest`, add:

```python
    def test_check_body_must_be_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved, server.WORK = server.WORK, Path(tmp)
            try:
                body = make_zip([("p/project.json", b"{}")]).getvalue()
                self.post({"X-Filename": "p.zip", "Content-Length": str(len(body))}, body)
                status, text = self.post({"X-Filename": "p.zip", "Content-Length": "5"}, b"{nope", path="/api/check")
                self.assertEqual((status, text), (400, "check request is not valid JSON"))
                status, _ = self.post({"X-Filename": "p.zip", "Content-Length": "0"}, path="/api/check")
                self.assertEqual(status, 200)
            finally:
                server.WORK = saved
```

- [ ] **Step 2: Run to see them fail**

Run: `cd plant && uv run python -m unittest -v`
Expected: FAIL.

- [ ] **Step 3: checks.py** — add near the top:

```python
def artwork_facts(path, params, out_dir, base):
    """artwork.facts, imported only when artwork is checked."""
    import artwork
    return artwork.facts(path, params, out_dir, base)


def check_artwork(project_dir, out_dir, params_by_name):
    try:
        import artwork  # noqa: F401 — only to fail early without the libraries
    except ImportError:
        return {"error": "needs PyMuPDF: uv run --project plant plant/server.py"}
    result = {}
    for name, params in params_by_name.items():
        path = project_dir / name
        result[name] = (artwork_facts(path, params, out_dir, name.replace("/", "_"))
                        if path.is_file() else {"error": "not in the zip"})
    return result
```

Change `run` to:

```python
def run(project_dir, out_dir, artwork_params=None):
    """Facts for every audio file under project_dir, keyed by its name
    relative to it, plus artwork facts for the files named in
    artwork_params; previews and facts.json go to out_dir (replaced)."""
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    result = audio(project_dir, out_dir)
    result["artwork"] = check_artwork(project_dir, out_dir, artwork_params or {})
    (out_dir / "facts.json").write_text(json.dumps(result, indent=1))
    return result
```

and move the former audio body into:

```python
def audio(project_dir, out_dir):
    if not (shutil.which("ffprobe") and shutil.which("ffmpeg")):
        return {"error": "needs ffmpeg"}
    files = {}
    for path in sorted(project_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
            continue
        name = path.relative_to(project_dir).as_posix()
        facts = probe_facts(path)
        if "error" not in facts:
            try:
                facts["preview"], facts["waveform"] = render_previews(path, out_dir, name.replace("/", "_"))
            except subprocess.CalledProcessError as error:
                facts["previewError"] = error.stderr.decode(errors="replace").strip() or "ffmpeg failed"
        files[name] = facts
    return {"files": files}
```

Update the existing `NoFfmpegTest` expectation: `run(...)` now returns `{"error": "needs ffmpeg", "artwork": {}}`.

- [ ] **Step 4: server.py** — `run_checks(stem, artwork_params)` passes `artwork_params` to `checks.run(found[0].parent, checks_dir(dest), artwork_params)`. In `do_POST`'s `/api/check` branch, before calling it:

```python
            try:
                length = int(self.headers.get("Content-Length", 0))
                request = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                raise OpenError("check request is not valid JSON") from None
            result = run_checks(zip_stem(self.headers.get("X-Filename", "")), request.get("artwork", {}))
```

(inside the existing `try … except OpenError` so the message becomes the 400 reply).

- [ ] **Step 5: Run all plant tests**

Run: `cd plant && uv run python -m unittest -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plant/checks.py plant/server.py plant/test_checks.py plant/test_server.py
git commit -m "plant checks: /api/check takes artwork params, run() returns audio + artwork facts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `src/lib/artwork-checks.js` — slots, rows, verdict

**Files:**
- Create: `src/lib/artwork-checks.js`
- Test: `tests/artwork-checks.test.js`

**Interfaces:**
- Consumes: `buildChecklistRows(…, page)`, `resolveSeverity` (print-artwork.js); `getFormat`, `labelDataSizeMm`, `flatDataMm`, `productById` (format-catalogue.js).
- Produces:
  - `artworkSlots(project, config)` → `[{title, name, params}]` in page order (Label A, Label B, Inner sleeve, Cover, Inlay front, Inlay back), only slots with a file (labels: not whitelabel; others: printed product). `params` = `{part, targetMm, trimMm, bleedMm, round, page, inkLimitPct, black, toleranceMm}`.
  - `artworkRows(facts, params, printCheck)` → rows `{feature, severity, detected, expected}`.
  - `artworkVerdict(rows)` → `"ok" | "review" | "customer"`.

- [ ] **Step 1: Failing tests** — create `tests/artwork-checks.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { artworkSlots, artworkRows, artworkVerdict } from "../src/lib/artwork-checks.js";

const printCheck = getFormat(CONFIG, "12").printCheck;
const printed = getFormat(CONFIG, "12").printableParts.outerCover.products.find(p => p.kind === "printed");

function project(over){
  return prepareProject({format:"12", ...over}, CONFIG);
}

test("artworkSlots: labels unless whitelabel, printed parts only, page and limits", () => {
  const slots = artworkSlots(project({
    labels:{sides:{A:{fileName:"L_A.pdf"}, B:{fileName:"L_B.pdf", page:2, whitelabel:true}}},
    coverSleeve:{cover:{productId: printed.id, fileName:"C.pdf"}}
  }), CONFIG);
  assert.deepEqual(slots.map(s => [s.title, s.name]), [["Label A", "L_A.pdf"], ["Cover", "C.pdf"]]);
  const label = getFormat(CONFIG, "12").printableParts.label;
  assert.deepEqual(slots[0].params, {
    part: "labels", round: true, page: 1, bleedMm: label.bleedMm,
    targetMm: {w: label.diameterMm + 2 * label.bleedMm, h: label.diameterMm + 2 * label.bleedMm},
    trimMm: {w: label.diameterMm, h: label.diameterMm},
    inkLimitPct: 220, black: printCheck.black, toleranceMm: printCheck.sizeToleranceMm
  });
  assert.equal(slots[1].params.inkLimitPct, 300);
  assert.equal(slots[1].params.round, false);
});

const clean = {
  kind: "pdf",
  parsed: { pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: "ISO Coated v2 300% (ECI)", trimBoxMm: {w: 100, h: 100}, encrypted: false,
    hasUnembeddedFonts: false, pdfVersion: "1.4", pageCount: 1, effectiveDpi: null },
  ink: {maxPct: 180, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 95, innerInkPct: 97}
};
const params = { targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, page: 1, inkLimitPct: 220 };

function row(facts, feature){
  return artworkRows(facts, params, printCheck).find(r => r.feature === feature);
}

test("artworkRows: clean file passes Ink, Black, Bleed", () => {
  assert.equal(row(clean, "Ink").severity, "info");
  assert.equal(row(clean, "Black").severity, "info");
  assert.equal(row(clean, "Bleed").severity, "info");
  assert.equal(artworkVerdict(artworkRows(clean, params, printCheck)), "ok");
});

test("artworkRows: ink over limit and rich black", () => {
  const ink = row({...clean, ink: {maxPct: 330, overPct: 12.5}}, "Ink");
  assert.deepEqual(ink, {feature: "Ink", severity: "warn", detected: "max 330 %, 12.5 % of the area over", expected: "≤ 220 %"});
  assert.equal(row({...clean, ink: {maxPct: 400, overPct: 0.4}}, "Ink").severity, "info");
  const black = row({...clean, black: {richPct: 3}}, "Black");
  assert.deepEqual(black, {feature: "Black", severity: "warn", detected: "rich black on 3.0 % of the area", expected: "100 % K"});
});

test("artworkRows: trimmed artwork and no bleed in the file", () => {
  assert.deepEqual(row({...clean, bleed: {outerInkPct: 1, innerInkPct: 90}}, "Bleed"),
    {feature: "Bleed", severity: "warn", detected: "empty — artwork looks trimmed", expected: "artwork into the 3 mm bleed"});
  assert.deepEqual(row({...clean, bleed: {outerInkPct: null, innerInkPct: 90}}, "Bleed"),
    {feature: "Bleed", severity: "warn", detected: "no bleed in the file", expected: "3 mm bleed"});
  // a light design with a white edge on purpose: little ink inside either
  assert.equal(row({...clean, bleed: {outerInkPct: 0, innerInkPct: 5}}, "Bleed").severity, "info");
});

test("artworkRows: errors and verdicts", () => {
  assert.deepEqual(artworkRows({error: "page 3 of 2"}, params, printCheck),
    [{feature: "File", severity: "error", detected: "page 3 of 2", expected: null}]);
  assert.equal(artworkVerdict([{severity: "info"}, {severity: "warn"}]), "review");
  assert.equal(artworkVerdict([{severity: "warn"}, {severity: "error"}]), "customer");
});

test("artworkRows: encrypted file without pixel facts", () => {
  const rows = artworkRows({kind: "pdf", parsed: {...clean.parsed, encrypted: true}}, params, printCheck);
  assert.equal(rows.find(r => r.feature === "Encryption").severity, "error");
  assert.ok(!rows.some(r => r.feature === "Ink"));
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/artwork-checks.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — create `src/lib/artwork-checks.js`:

```js
// Pure artwork rules for the plant view: which files to measure (with
// the part's parameters, sent to plant/checks.py) and how to judge the
// facts it returns — the customer page's checklist on exact values plus
// Ink, Black and Bleed. No DOM.

import { getFormat, labelDataSizeMm, flatDataMm, productById } from "./format-catalogue.js";
import { buildChecklistRows, resolveSeverity } from "./print-artwork.js";

// Share of the page area (%) a problem may cover before it counts —
// single stray pixels don't.
const AREA_PCT = 0.5;
// Bleed: ink right inside the cut but hardly any in the bleed means the
// artwork was trimmed to the finished size.
const EDGE_INKED_PCT = 20, BLEED_EMPTY_PCT = 5;

export function artworkSlots(project, config){
  const format = getFormat(config, project.format);
  const {printCheck, printableParts: parts} = format;
  const slots = [];
  const add = (title, slot, part, sizes) => {
    if(!slot.fileName) return;
    slots.push({title, name: slot.fileName, params: {
      part, ...sizes, page: slot.page, inkLimitPct: printCheck.inkLimitPct[part],
      black: printCheck.black, toleranceMm: printCheck.sizeToleranceMm
    }});
  };

  const label = parts.label;
  const data = labelDataSizeMm(label);
  for(const side of ["A", "B"]){
    const slot = project.labels.sides[side];
    if(slot.whitelabel) continue;
    add(`Label ${side}`, slot, "labels", {targetMm: {w: data, h: data},
      trimMm: {w: label.diameterMm, h: label.diameterMm}, bleedMm: label.bleedMm, round: true});
  }

  const sleeve = project.coverSleeve;
  for(const [title, slot, part, productId] of [
    ["Inner sleeve", sleeve.innerSleeve, "innerSleeve", sleeve.innerSleeve.productId],
    ["Cover", sleeve.cover, "outerCover", sleeve.cover.productId],
    ["Inlay front", sleeve.inlay.front, "inlay", sleeve.inlay.productId],
    ["Inlay back", sleeve.inlay.back, "inlay", sleeve.inlay.productId]
  ]){
    const product = productById((parts[part] && parts[part].products) || [], productId);
    if(!product || product.kind !== "printed") continue;
    add(title, slot, part, {targetMm: flatDataMm(product), trimMm: product.trimMm,
      bleedMm: product.bleedMm, round: false});
  }
  return slots;
}

function measuredRows(facts, params, checks){
  const rows = [];
  const inkOk = facts.ink.overPct <= AREA_PCT;
  rows.push({feature: "Ink", severity: resolveSeverity(checks.ink.severity, inkOk),
    detected: `max ${Math.round(facts.ink.maxPct)} %` + (inkOk ? "" : `, ${facts.ink.overPct.toFixed(1)} % of the area over`),
    expected: inkOk ? null : `≤ ${params.inkLimitPct} %`});

  const blackOk = facts.black.richPct <= AREA_PCT;
  rows.push({feature: "Black", severity: resolveSeverity(checks.black.severity, blackOk),
    detected: blackOk ? "no rich black" : `rich black on ${facts.black.richPct.toFixed(1)} % of the area`,
    expected: blackOk ? null : "100 % K"});

  const {outerInkPct: outer, innerInkPct: inner} = facts.bleed;
  const noBleed = outer === null;
  const trimmed = !noBleed && inner >= EDGE_INKED_PCT && outer < BLEED_EMPTY_PCT;
  rows.push({feature: "Bleed", severity: resolveSeverity(checks.bleed.severity, !noBleed && !trimmed),
    detected: noBleed ? "no bleed in the file" : trimmed ? "empty — artwork looks trimmed" : "ok",
    expected: noBleed ? `${params.bleedMm} mm bleed` : trimmed ? `artwork into the ${params.bleedMm} mm bleed` : null});
  return rows;
}

export function artworkRows(facts, params, printCheck){
  if(facts.error) return [{feature: "File", severity: "error", detected: facts.error, expected: null}];
  const rows = buildChecklistRows(facts.parsed, facts.kind, params.targetMm, params.trimMm, printCheck, true, params.page);
  return facts.ink ? rows.concat(measuredRows(facts, params, printCheck.checks)) : rows;
}

export function artworkVerdict(rows){
  if(rows.some(row => row.severity === "error")) return "customer";
  if(rows.some(row => row.severity === "warn")) return "review";
  return "ok";
}
```

- [ ] **Step 4: Run all tests**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/artwork-checks.js tests/artwork-checks.test.js
git commit -m "artwork checks: slots with part params, Ink/Black/Bleed rows, verdict

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Plant view — Artwork section

**Files:**
- Modify: `src/lib/plant-overview.js`, `src/plant/app.js`, `src/plant/index.html`
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `artworkSlots`, `artworkRows`, `artworkVerdict` (Task 7); `CHECKLIST_ICON` (print-artwork.js); `/api/check` artwork result (Task 6).
- Produces: `renderArtwork(slots, artworkFacts, printCheck, base)` → HTML string.

- [ ] **Step 1: Failing tests** — append to `tests/plant-overview.test.js` (add `renderArtwork` to the import):

```js
test("artwork: verdict, preview with trim/bleed lines, overlay, rows", () => {
  const slots = [{title: "Label A", name: "L <A>.pdf", params: {targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100},
    bleedMm: 3, round: true, page: 1, inkLimitPct: 220}}];
  const facts = {"L <A>.pdf": {kind: "pdf", parsed: {pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: null}, pageMm: {w: 106, h: 106}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: 330, overPct: 10}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: "L <A>.pdf.png", overlay: "L <A>.pdf.overlay.png"}};
  const html = renderArtwork(slots, facts, getFormat(CONFIG, "12").printCheck, "/work/p.checks/");
  assert.ok(html.startsWith("<section><h2>Artwork"));
  assert.ok(html.includes("L &lt;A&gt;.pdf"));
  assert.ok(html.includes('class="verdict review">review'));
  assert.ok(html.includes('src="/work/p.checks/L%20%3CA%3E.pdf.png"'));
  assert.ok(html.includes('viewBox="0 0 106 106"'));
  assert.ok(html.includes('<circle class="trim" cx="53" cy="53" r="50"'));
  assert.ok(html.includes('<circle class="bleed" cx="53" cy="53" r="53"'));
  assert.ok(html.includes("max 330 %"));
});

test("artwork: needs PyMuPDF, no slots", () => {
  const printCheck = getFormat(CONFIG, "12").printCheck;
  assert.ok(renderArtwork([{title: "Cover", name: "C.pdf", params: {}}], {error: "needs PyMuPDF"}, printCheck, "/w/").includes("needs PyMuPDF"));
  assert.equal(renderArtwork([], {}, printCheck, "/w/"), "");
});
```

(Add `import { getFormat } from "../src/lib/format-catalogue.js";` if the test file lacks it.)

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/plant-overview.test.js`
Expected: FAIL.

- [ ] **Step 3: renderArtwork** — in `src/lib/plant-overview.js` import `{ artworkRows, artworkVerdict }` from `./artwork-checks.js` and `{ CHECKLIST_ICON }` from `./print-artwork.js`, then add:

```js
const VERDICT = {ok: "OK", review: "review", customer: "needs customer"};

// Trim (solid) and bleed (dashed) in page millimetres; the SVG stretches
// over the preview, so the lines sit where the cut will be.
function cutLinesSvg(page, trim, bleedMm, round){
  const n = v => Math.round(v * 100) / 100;
  const shape = (cls, grow) => round
    ? `<circle class="${cls}" cx="${n(trim.x + trim.w / 2)}" cy="${n(trim.y + trim.h / 2)}" r="${n(trim.w / 2 + grow)}"/>`
    : `<rect class="${cls}" x="${n(trim.x - grow)}" y="${n(trim.y - grow)}" width="${n(trim.w + 2 * grow)}" height="${n(trim.h + 2 * grow)}"/>`;
  return `<svg viewBox="0 0 ${n(page.w)} ${n(page.h)}" preserveAspectRatio="none">${shape("trim", 0)}${shape("bleed", bleedMm)}</svg>`;
}

function checklistHtml(rows){
  return `<table>${rows.map(r => `<tr class="${r.severity}"><td>${CHECKLIST_ICON[r.severity]}</td>`
    + `<td>${escapeHtml(r.feature)}</td><td>${escapeHtml(r.detected)}</td><td>${escapeHtml(r.expected || "")}</td></tr>`).join("")}</table>`;
}

// One block per artwork file: verdict, preview with cut lines and a
// switchable problem-area overlay, the checklist. base: URL folder of
// the check output.
export function renderArtwork(slots, artworkFacts, printCheck, base){
  if(!slots.length) return "";
  if(artworkFacts.error) return group("Artwork", `<p class="missing">${escapeHtml(artworkFacts.error)}</p>`);
  return group("Artwork", slots.map(({title, name, params}) => {
    const facts = artworkFacts[name] || {error: "not checked"};
    const rows = artworkRows(facts, params, printCheck);
    const verdict = artworkVerdict(rows);
    let body = `<p><b>${escapeHtml(title)}</b> <span class="ident">${escapeHtml(name)}</span> `
      + `<span class="verdict ${verdict}">${VERDICT[verdict]}</span></p>`;
    if(facts.preview){
      const url = file => escapeHtml(base + encodeURIComponent(file));
      body += `<label class="chk"><input type="checkbox" class="show-overlay"> problem areas</label>`
        + `<div class="art" style="aspect-ratio:${facts.pageMm.w} / ${facts.pageMm.h}">`
        + `<img src="${url(facts.preview)}" alt=""><img class="overlay" hidden src="${url(facts.overlay)}" alt="">`
        + cutLinesSvg(facts.pageMm, facts.trimRectMm, params.bleedMm, params.round) + `</div>`;
    }
    return `<div class="art-file">${body}${checklistHtml(rows)}</div>`;
  }).join(""));
}
```

- [ ] **Step 4: app.js** — import `artworkSlots` from `../lib/artwork-checks.js`, `renderArtwork` from `../lib/plant-overview.js`, `getFormat` from `../lib/format-catalogue.js`. In `openZip`:
  - render `'<div id="audio"></div><div id="artwork"></div>'` instead of `'<div id="audio"></div>'`;
  - before the check request: `const slots = artworkSlots(project, CONFIG);`
  - the check request becomes

```js
    const checked = await fetch("/api/check", {method: "POST",
      headers: {...headers, "Content-Type": "application/json"},
      body: JSON.stringify({artwork: Object.fromEntries(slots.map(s => [s.name, s.params]))})});
```

  - status text `"Checking audio and artwork…"`;
  - after the audio render:

```js
    document.getElementById("artwork").innerHTML =
      renderArtwork(slots, facts.artwork, getFormat(CONFIG, project.format).printCheck, base);
```

  - add the overlay toggle next to the click handler:

```js
// "problem areas" checkbox: show or hide that file's overlay.
out.addEventListener("change", e => {
  if(!e.target.matches(".show-overlay")) return;
  e.target.closest(".art-file").querySelector(".overlay").hidden = !e.target.checked;
});
```

- [ ] **Step 5: CSS** — in `src/plant/index.html` add:

```css
  /* Artwork: preview with the plant's overlay and cut lines on top. */
  .art-file{ margin:6px 0 12px; }
  .art{ position:relative; max-width:420px; }
  .art img{ display:block; width:100%; height:100%; }
  .art .overlay, .art svg{ position:absolute; inset:0; width:100%; height:100%; }
  .art .trim, .art .bleed{ fill:none; stroke-width:1; vector-effect:non-scaling-stroke; }
  .art .trim{ stroke:var(--ink); }
  .art .bleed{ stroke:var(--danger); stroke-dasharray:4 3; }
  .verdict.review, tr.warn{ color:#8a5a00; }
  .verdict.customer, tr.error{ color:var(--danger); }
  .verdict.ok{ font-weight:700; }
```

- [ ] **Step 6: Run all tests and an end-to-end check**

Run: `node --test tests/ && cd plant && uv run python -m unittest && cd .. && node build/build.js`
Expected: PASS. Then `uv run --project plant plant/server.py`, open a project zip with a label PDF and a cover: Artwork section shows verdicts, previews with circle/rect cut lines, "problem areas" toggles the overlay. (Ask the user before driving Chrome.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/plant-overview.js src/plant/app.js src/plant/index.html tests/plant-overview.test.js
git commit -m "plant view: Artwork section with verdict, cut lines, problem-area overlay, checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
