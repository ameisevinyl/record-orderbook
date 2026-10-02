# Artwork Fix Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per printed part, the plant view runs the checks and proposes one fix at a time in the order size → pdf → colour; staff accept (use it) or dismiss (trash it); what can't be fixed shows "needs correction by hand"; unused versions can be trashed into the job's `.trash/`.

**Architecture:** Pure JS decides (`src/lib/fix-flow.js`: `fixStep`, `slotFlow`; an "Output intent" row in `artworkRows`); Python renders (`geomfix.render` for size/pdf, `colourfix.fix`/`assign` for colour, `artwork.pdfx` + a PDF 1.3 `save_atomic`). One endpoint `/api/fix` replaces the three old fix endpoints; `/api/trash` moves files. The log is `project.plant.fixes`.

**Tech Stack:** Node ≥18 `node --test`; Python stdlib server, PyMuPDF, Pillow (`ImageCms`, LittleCMS), numpy, `unittest`. No new libraries.

**Spec:** `docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md` (builds on `2026-10-01-artwork-geometry-fix-design.md`, branch `geometry-fix`).

## Global Constraints

- Work on branch `geometry-fix`. No new runtime dependencies, no new Python libraries.
- Files are never overwritten: a fix is the slot's next `_v<N>.pdf`; trash moves into `<job>/.trash/`, a name already there gets `_<n>` before the extension.
- Every fix output is PDF 1.3 (`%PDF-1.3` header, no object streams); after the colour step PDF/X-1a:2001 (OutputIntent + `GTS_PDFXVersion (PDF/X-1:2001)`, `GTS_PDFXConformance (PDF/X-1a:2001)`, `Trapped /False`).
- Step order size → pdf → colour; one proposal per page load, only in `CONFIG.fixerStages`.
- `black.neutralTolPct: 10`; neutral = max(C,M,Y) − min(C,M,Y) ≤ tol and C+M+Y > 0 → K only at the same L*.
- Production lines stay as data; only the step strip leaves the page.
- Comments short, why not what; match surrounding style. Commits short, imperative, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each commit run the side's suite: `node --test tests/`, `uv run --project plant python -m unittest discover plant`; at the end also `node build/build.js` (the build flattens all modules into one scope — no duplicate top-level names).

## Review Focus

1. A slot whose facts are still missing (check failed, file gone) — no fix is made, the page shows the check error, not a crash (Task 4 test: `fixStep(undefined)`/error facts).
2. Two slots both needing fixes — one proposal per load, the next slot after the reload (Task 7, by code reading: `return` after the first).
3. Dismiss while the proposal file was already trashed by hand — `/api/trash` answers 400 "no file", page shows it; the log stays consistent because project.json is written first only when all files exist (Task 5 test).
4. RGB source through size → pdf → colour — geometry keeps RGB, colour converts through the profile (Task 3 test with Generic CMYK).
5. The print profile can't be downloaded — `/api/fix` answers 400 with "print profile: …", logged as refused, shown as manual (Task 5 test).

---

### Task 1: Config — print profile per part, neutral tolerance

**Files:**
- Modify: `src/config.js` (`printProfiles` ~line 443; `black: { kMinPct: 85, cmyMaxPct: 30 }` in every format)
- Modify: `src/lib/config-validation.js` (`validatePrintCheck` black block; `validatePrintProfiles` ~158)
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces: `CONFIG.printProfiles.{labels, innerSleeve, outerCover, inlay}` = `{name, conditionId, url, file}`; `printCheck.black.neutralTolPct`.

- [ ] **Step 1: Failing tests** — append to `tests/config-validation.test.js`:

```js
test("print profiles per printed part with a condition id; neutral tolerance", () => {
  const missing = copy();
  delete missing.printProfiles.inlay;
  assert.throws(() => validateConfig(missing), /CONFIG\.printProfiles\.inlay must be an object/);
  const noId = copy();
  noId.printProfiles.labels = {...noId.printProfiles.labels, conditionId: ""};
  assert.throws(() => validateConfig(noId), /CONFIG\.printProfiles\.labels\.conditionId must be a non-empty string/);
  const tol = copy();
  delete tol.formats[0].printCheck.black.neutralTolPct;
  assert.throws(() => validateConfig(tol), /CONFIG\.formats\[0\]\.printCheck\.black\.neutralTolPct must be a positive number/);
});
```

- [ ] **Step 2: Run** `node --test tests/config-validation.test.js` → FAIL (no throw).

- [ ] **Step 3: Implement.** `src/config.js` — before `export const CONFIG = {`:

```js
// Offset print condition of every printed part to start with (FOGRA39).
const ISO_COATED_V2 = { name: "ISO Coated v2 (ECI)", conditionId: "FOGRA39",
  url: "https://eci.org/lib/exe/eci_offset_2009.zip", file: "ISOcoated_v2_eci.icc" };
```

`printProfiles` becomes `{ labels: ISO_COATED_V2, innerSleeve: ISO_COATED_V2, outerCover: ISO_COATED_V2, inlay: ISO_COATED_V2 },` (keep its comment, add "per printed part; the colour step assigns it as OutputIntent"). Every `black: { kMinPct: 85, cmyMaxPct: 30 },` becomes `black: { kMinPct: 85, cmyMaxPct: 30, neutralTolPct: 10 },`.

`src/lib/config-validation.js` — after `number(black.cmyMaxPct, …)`: `number(black.neutralTolPct, `${path}.black.neutralTolPct`);`. `validatePrintProfiles`:

```js
function validatePrintProfiles(value){
  const profiles = object(value, "CONFIG.printProfiles");
  for(const part of CHECKED_PARTS){
    const path = `CONFIG.printProfiles.${part}`;
    const entry = object(profiles[part], path);
    string(entry.name, `${path}.name`);
    string(entry.conditionId, `${path}.conditionId`);
    if(typeof entry.url !== "string" || !entry.url.startsWith("https://")) fail(`${path}.url`, "must start with https://");
    if(typeof entry.file !== "string" || !/^[^/\\]+\.icc$/i.test(entry.file) || entry.file.startsWith(".")) fail(`${path}.file`, "must be a plain .icc file name");
  }
}
```

(keep the exact existing function header if it differs; `CHECKED_PARTS` is defined above `validatePrintCheck`). If the existing profile tests mutate `printProfiles.labels.url` in place, the shared object now changes all four parts — fine for their regexes.

- [ ] **Step 4: Run** `node --test tests/` → PASS; `node build/build.js` → builds.

- [ ] **Step 5: Commit** `config: print profile per printed part (FOGRA39 to start), black.neutralTolPct`.

---

### Task 2: PDF 1.3 output, PDF/X-1a marking, `outputIntent` fact

**Files:**
- Modify: `plant/artwork.py` (`pdf_icc_name` → `output_intent_name` + fallback; `pdf_structure`, `raster_structure` gain `outputIntent`; `save_atomic` writes 1.3; new `pdfx`)
- Modify: `plant/checks.py:28` (`CHECKS_VERSION = 5`)
- Modify: `src/lib/print-artwork.js` (parsed shape comment: `outputIntent` plant only)
- Test: `plant/test_artwork.py`

**Interfaces:**
- Produces: `parsed.outputIntent: str|None`; `artwork.save_atomic(doc, out)` (PDF 1.3); `artwork.pdfx(doc, profile_path, profile)` with `profile = {name, conditionId}`.

- [ ] **Step 1: Failing tests** — in `PixelsTest` of `plant/test_artwork.py`:

```python
    def test_saved_as_pdf_13_without_object_streams(self):
        import numpy
        out = self.dir / "o.pdf"
        artwork.save_atomic(artwork.raster_pdf(numpy.zeros((4, 4, 4), numpy.uint8), "CMYK",
                                               {"w": 10, "h": 10}, {"w": 8, "h": 8}), out)
        data = out.read_bytes()
        self.assertTrue(data.startswith(b"%PDF-1.3"))
        self.assertNotIn(b"/ObjStm", data)

    def test_pdfx_sets_the_output_intent(self):
        import numpy
        out = self.dir / "x.pdf"
        doc = artwork.raster_pdf(numpy.zeros((4, 4, 4), numpy.uint8), "CMYK", {"w": 10, "h": 10}, {"w": 8, "h": 8})
        artwork.pdfx(doc, GENERIC_CMYK, {"name": "Generic", "conditionId": "FOGRA39"})
        artwork.save_atomic(doc, out)
        _, parsed, _ = artwork.structure(out, 1)
        self.assertEqual(parsed["outputIntent"], artwork.icc_name(Path(GENERIC_CMYK).read_bytes()))
        self.assertEqual(parsed["pdfVersion"], "1.3")
        saved = pymupdf.open(out)
        info = int(saved.xref_get_key(-1, "Info")[1].split()[0])
        self.assertEqual(saved.xref_get_key(info, "GTS_PDFXConformance")[1], "PDF/X-1a:2001")

    def test_no_output_intent(self):
        path = self.dir / "n.pdf"
        pdf(path)
        self.assertIsNone(artwork.structure(path, 1)[1]["outputIntent"])
```

(`pdf(path)` is the file's existing helper; `GENERIC_CMYK` its constant. Guard the class or test with `@unittest.skipUnless(Path(GENERIC_CMYK).is_file(), "needs a CMYK profile")` for `test_pdfx_sets_the_output_intent`.)

- [ ] **Step 2: Run** `cd plant && uv run --project . python -m unittest test_artwork` → FAIL (header 1.7, no `pdfx`, no `outputIntent`).

- [ ] **Step 3: Implement** in `plant/artwork.py`:

```python
def output_intent_name(doc):
    """The PDF/X OutputIntent's profile: Catalog /OutputIntents [<< /DestOutputProfile n 0 R >>]."""
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "OutputIntents")
    if kind == "xref":
        kind, value = "array", doc.xref_object(int(value.split()[0]), compressed=True)
    for ref in re.findall(r"(\d+) 0 R", value) if kind == "array" else []:
        kind, value = doc.xref_get_key(int(ref), "DestOutputProfile")
        if kind == "xref":
            return icc_name(doc.xref_stream(int(value.split()[0])))
    return None


def pdf_icc_name(doc):
    # Output intent first (PDF/X), else any embedded profile.
    name = output_intent_name(doc)
    if name:
        return name
    for xref in range(1, doc.xref_length()):
        m = re.search(r"/ICCBased\s+(\d+)\s+0\s+R", doc.xref_object(xref, compressed=True))
        if m:
            return icc_name(doc.xref_stream(int(m.group(1))))
    return None
```

`pdf_structure`: add `"outputIntent": output_intent_name(doc),` to the normal dict and `"outputIntent": None,` to the encrypted dict; `raster_structure`: `"outputIntent": None,`.

```python
def save_atomic(doc, out):
    """As PDF 1.3 — MuPDF writes 1.7 for a new file; the header is patched,
    no object streams are written — never half-written under the final name."""
    data = re.sub(rb"^%PDF-1\.\d", b"%PDF-1.3", doc.tobytes(deflate=True), count=1)
    part = out.with_name(f".{out.name}.part")
    part.write_bytes(data)
    part.rename(out)


def pdfx(doc, profile_path, profile):
    """Marks doc PDF/X-1a:2001: the part's profile as OutputIntent, the GTS
    keys in Info. The pixel numbers stay as they are."""
    icc = doc.get_new_xref()
    doc.update_object(icc, "<< /N 4 >>")
    doc.update_stream(icc, Path(profile_path).read_bytes())
    intent = doc.get_new_xref()
    doc.update_object(intent, "<< /Type /OutputIntent /S /GTS_PDFX"
                      f" /OutputConditionIdentifier {pymupdf.get_pdf_str(profile['conditionId'])}"
                      f" /Info {pymupdf.get_pdf_str(profile['name'])} /RegistryName (http://www.color.org)"
                      f" /DestOutputProfile {icc} 0 R >>")
    doc.xref_set_key(doc.pdf_catalog(), "OutputIntents", f"[{intent} 0 R]")
    if doc.xref_get_key(-1, "Info")[0] == "null":
        doc.set_metadata({"producer": "record-orderbook plant"})
    info = int(doc.xref_get_key(-1, "Info")[1].split()[0])
    doc.xref_set_key(info, "GTS_PDFXVersion", "(PDF/X-1:2001)")
    doc.xref_set_key(info, "GTS_PDFXConformance", "(PDF/X-1a:2001)")
    doc.xref_set_key(info, "Trapped", "/False")
```

Add `from pathlib import Path` to the imports. `plant/checks.py`: `CHECKS_VERSION = 5  # … 5: outputIntent`. `src/lib/print-artwork.js` parsed-shape comment, next to `effectiveDpi`: `// - outputIntent — plant only: the PDF/X OutputIntent's profile name, or null.`

- [ ] **Step 4: Run** `uv run --project plant python -m unittest discover plant` → PASS (geomfix/colourfix outputs now 1.3 too).

- [ ] **Step 5: Commit** `plant artwork: fixes saved as PDF 1.3, pdfx marks PDF/X-1a, outputIntent fact`.

---

### Task 3: Colour fix for every part (neutral greys → K), assign

**Files:**
- Modify: `plant/colourfix.py` (rules, strips, `fix` replaces `fix_label`, new `assign`, `lab_transform`, `light`)
- Modify: `plant/server.py` (`fix_label` calls `colourfix.fix` until Task 5 replaces it)
- Test: `plant/test_colourfix.py`, `plant/test_server.py` (`test_fix_label_…` params)

**Interfaces:**
- Produces:
  - `colourfix.fix(path, params, out, profile_path) → str` (what it did) — params: `page, targetMm, trimMm, toleranceMm, inkLimitPct, black{kMinPct, neutralTolPct}, fixDpi, profile{name, conditionId}`; writes PDF/X-1a.
  - `colourfix.assign(path, params, out, profile_path) → str` — copy + `pdfx`.
  - `colourfix.fix_pixels(cmyk, light, ramp, ink_limit, k_min, neutral_tol) → (uint8 array, numpy int array [black, neutral, capped])`.
  - `colourfix.lab_transform(profile_path) → (transform, ramp[101])`, `colourfix.light(cmyk, transform) → float32 L*`.

- [ ] **Step 1: Failing tests.** In `plant/test_colourfix.py`:
  - `PARAMS` gains `"black": {"kMinPct": 85, "neutralTolPct": 10}` and `"profile": {"name": "Generic", "conditionId": "FOGRA39"}`.
  - Replace `RulesTest` with:

```python
RAMP = numpy.linspace(100, 0, 101)  # L* = 100 − K: K reads straight off


class RulesTest(unittest.TestCase):
    def fix(self, *cmyk, light=50):
        out, _ = colourfix.fix_pixels(px(*cmyk), numpy.array([[light]], numpy.float32), RAMP, 220, 85, 10)
        return pct(out)

    def test_rules(self):
        self.assertEqual(self.fix(60, 40, 40, 100), [0, 0, 0, 100])          # K ≥ 85 → pure K
        self.assertEqual(self.fix(34, 37, 35, 36, light=40), [0, 0, 0, 60])  # neutral → K at its lightness
        self.assertEqual(self.fix(60, 55, 55, 40, light=20), [0, 0, 0, 80])  # rich grey edge, 210 %
        self.assertEqual(self.fix(100, 100, 0, 50), [85, 85, 0, 50])         # colour over the limit: CMY scaled
        self.assertEqual(self.fix(60, 20, 20, 10), [60, 20, 20, 10])         # tinted, under the limit: untouched
        self.assertEqual(self.fix(0, 0, 0, 40), [0, 0, 0, 40])               # pure K grey stays
        self.assertEqual(self.fix(0, 0, 0, 0), [0, 0, 0, 0])

    def test_counts(self):
        a = numpy.concatenate([px(60, 40, 40, 100), px(34, 37, 35, 36), px(100, 100, 0, 50)], axis=1)
        _, counts = colourfix.fix_pixels(a, numpy.full((1, 3), 50, numpy.float32), RAMP, 220, 85, 10)
        self.assertEqual(counts.tolist(), [1, 1, 1])
```

  - Mark `FixTest` and `ReviewFixesTest` with `@unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")`; replace every `colourfix.fix_label(src, PARAMS, out)` / `fix_label(…, GENERIC_CMYK)` with `colourfix.fix(src, PARAMS, out, GENERIC_CMYK)`; `test_rgb_without_profile_refuses` becomes:

```python
    def test_no_profile_refuses(self):
        src = self.dir / "r.jpg"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        with self.assertRaisesRegex(colourfix.FixError, "print profile"):
            colourfix.fix(src, PARAMS, self.dir / "r_v2.pdf", None)
```

  - Replace `test_strips_give_the_same_result_as_the_whole` with:

```python
    def test_strips_give_the_same_result_as_the_whole(self):
        rng = numpy.random.default_rng(1)
        a = rng.integers(0, 256, (1300, 7, 4), dtype=numpy.uint8)
        t, ramp = colourfix.lab_transform(GENERIC_CMYK)
        strips, n1 = colourfix.fix_in_strips(a, t, ramp, 220, 85, 10)
        whole, n2 = colourfix.fix_pixels(a, colourfix.light(a, t), ramp, 220, 85, 10)
        self.assertTrue(numpy.array_equal(strips, whole))
        self.assertEqual(n1.tolist(), n2.tolist())
```

  - Add to `FixTest`:

```python
    def test_neutral_grey_keeps_its_lightness_as_k(self):
        src, out = self.dir / "n.pdf", self.dir / "n_v2.pdf"
        cmyk_pdf(src, fill=(0.34, 0.37, 0.35, 0.36))
        detail = colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        c, m, y, k = pix.pixel(10, 10)
        self.assertEqual((c, m, y), (0, 0, 0))
        t, _ = colourfix.lab_transform(GENERIC_CMYK)
        before = colourfix.light(px(34, 37, 35, 36), t)[0, 0]
        after = colourfix.light(numpy.array([[[0, 0, 0, k]]], numpy.uint8), t)[0, 0]
        self.assertLess(abs(before - after), 2)
        self.assertIn("neutral → K 100.0 %", detail)

    def test_fixed_file_is_pdfx(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src)
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, parsed, _ = artwork.structure(out, 1)
        self.assertEqual(parsed["pdfVersion"], "1.3")
        self.assertIsNotNone(parsed["outputIntent"])

    def test_assign_keeps_the_numbers(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src, fill=(0.6, 0.4, 0.4, 0.2))
        self.assertIn("colours unchanged", colourfix.assign(src, PARAMS, out, GENERIC_CMYK))
        page = pymupdf.open(out)[0]
        self.assertIsNotNone(artwork.structure(out, 1)[1]["outputIntent"])
        self.assertEqual(out.read_bytes()[:8], b"%PDF-1.3")
        pymupdf.TOOLS.set_icc(False)
        try:
            pix = page.get_pixmap(colorspace=pymupdf.csCMYK, alpha=False)
        finally:
            pymupdf.TOOLS.set_icc(True)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(5, 5)], [60, 40, 40, 20])
```

  (import `artwork` at the top of the test file.)
  - `plant/test_server.py` `test_fix_label_writes_the_next_version_once`: its params gain `"black": {"kMinPct": 85, "neutralTolPct": 10}` and `"profile"` becomes `None` → expect **400** "print profile" for the first post (the endpoint goes in Task 5; adjust the assertions: first post 400, no file written).

- [ ] **Step 2: Run** `cd plant && uv run --project . python -m unittest test_colourfix test_server` → FAIL (`fix_pixels` signature, no `fix`/`assign`).

- [ ] **Step 3: Implement** `plant/colourfix.py` (module docstring: "for every printed part", the three rules, PDF/X-1a; `from PIL import Image, ImageCms`; `import pymupdf` again for `assign`):

```python
def fix_pixels(cmyk, light, ramp, ink_limit, k_min, neutral_tol):
    """Per pixel, in this order: K ≥ k_min → pure K; neutral (C, M, Y within
    neutral_tol of each other) → K only at its lightness (light: L* per
    pixel, ramp: L* of K = 0..100 in the part's profile); else total ink
    over the limit → C, M, Y scaled, K kept. Returns the pixels and how
    many each rule changed (black, neutral, capped)."""
    c = cmyk.astype(numpy.float32) * (100 / 255)
    k, cmy = c[..., 3], c[..., :3]
    total = cmy.sum(axis=-1)
    black = k >= k_min
    neutral = (cmy.max(axis=-1) - cmy.min(axis=-1) <= neutral_tol) & (total > 0) & ~black
    room = numpy.clip(ink_limit - k, 0, None)
    capped = (total + k > ink_limit) & (total > 0) & ~neutral & ~black
    out = c.copy()
    out[..., :3] *= numpy.where(capped, room / numpy.maximum(total, 1e-6), 1.0)[..., None]
    out[neutral] = 0
    out[..., 3][neutral] = numpy.interp(light[neutral], ramp[::-1], numpy.arange(100, -1, -1))
    out[black] = (0, 0, 0, 100)
    pixels = numpy.round(out * 2.55).clip(0, 255).astype(numpy.uint8)
    return pixels, numpy.array([black.sum(), neutral.sum(), capped.sum()])


def light(cmyk, transform):
    """L* (0–100) per pixel through the part's profile."""
    h, w = cmyk.shape[:2]
    im = Image.frombytes("CMYK", (w, h), numpy.ascontiguousarray(cmyk).tobytes())
    return numpy.asarray(ImageCms.applyTransform(im, transform))[..., 0].astype(numpy.float32) * (100 / 255)


def lab_transform(profile_path):
    """CMYK → Lab through the part's profile, and the L* of K = 0..100 in it."""
    transform = ImageCms.buildTransform(ImageCms.getOpenProfile(str(profile_path)), ImageCms.createProfile("LAB"),
                                        "CMYK", "LAB")
    ramp = numpy.zeros((1, 101, 4), numpy.uint8)
    ramp[0, :, 3] = numpy.round(numpy.arange(101) * 2.55)
    return transform, light(ramp, transform)[0]


def fix_in_strips(cmyk, transform, ramp, ink_limit, k_min, neutral_tol):
    out = numpy.empty_like(cmyk)
    counts = numpy.zeros(3, numpy.int64)
    for y in range(0, cmyk.shape[0], STRIP):
        part = cmyk[y:y + STRIP]
        out[y:y + STRIP], n = fix_pixels(part, light(part, transform), ramp, ink_limit, k_min, neutral_tol)
        counts += n
    return out, counts
```

`_to_cmyk` RGB message → `"RGB needs the part's print profile"`. `fix_label` → `fix`:

```python
def fix(path, params, out, profile_path):
    """The part's colour fix as out, PDF/X-1a; returns what it did."""
    if profile_path is None:
        raise FixError("the part's print profile isn't available — see the plant server's output")
    # (the existing structure/size guard of fix_label, unchanged; message "the file is …")
    cmyk, page_mm = _raster(path, kind, parsed, params, profile_path)
    transform, ramp = lab_transform(profile_path)
    black = params["black"]
    fixed, counts = fix_in_strips(cmyk, transform, ramp, params["inkLimitPct"], black["kMinPct"], black["neutralTolPct"])
    doc = artwork.raster_pdf(fixed, "CMYK", page_mm, params["trimMm"])
    artwork.pdfx(doc, profile_path, params["profile"])
    artwork.save_atomic(doc, out)
    pct = counts / (cmyk.shape[0] * cmyk.shape[1]) * 100
    return f"pure K {pct[0]:.1f} %, neutral → K {pct[1]:.1f} %, ink capped {pct[2]:.1f} % of the area"


def assign(path, params, out, profile_path):
    """A copy with the part's profile as OutputIntent (PDF/X-1a), numbers untouched."""
    if profile_path is None:
        raise FixError("the part's print profile isn't available — see the plant server's output")
    try:
        doc = pymupdf.open(path)
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise FixError(f"can't read PDF: {error}") from None
    if doc.needs_pass:
        raise FixError("the PDF is encrypted")
    artwork.pdfx(doc, profile_path, params["profile"])
    artwork.save_atomic(doc, out)
    return f"assigned {params['profile']['name']}, colours unchanged"
```

Keep the existing size-guard message text but say "the file is" instead of "the label is" (update `test_refuses_wrong_size`'s regex accordingly: `"210.0×210.0 mm, expected 106×106 mm"` still matches). `plant/server.py` `fix_label`: call `colourfix.fix(source, params, target, profile)`; `ProfileError` → `profile = None` (then `fix` refuses — 400).

- [ ] **Step 4: Run** `uv run --project plant python -m unittest discover plant` → PASS.

- [ ] **Step 5: Commit** `plant colourfix: every part, neutral greys to K at their lightness, PDF/X-1a; assign keeps the numbers`.

---

### Task 4: Flow rules — `fixStep`, `slotFlow`, Output intent row

**Files:**
- Create: `src/lib/fix-flow.js`
- Modify: `src/lib/artwork-checks.js` (`artworkSlots` params gain `fixDpi`, `profile`; `measuredRows` "Output intent" row; export `bleedTrimmed`)
- Modify: `src/lib/lines.js` (`ROWS.colour` adds `"Output intent"`)
- Test: `tests/fix-flow.test.js`, `tests/artwork-checks.test.js` (artworkSlots params), `tests/lines.test.js` if fixtures need `outputIntent`

**Interfaces:**
- Consumes: `artworkRows`, `bleedTrimmed` (artwork-checks).
- Produces:
  - slot params: `{…, fixDpi: printCheck.fixDpi[part], profile: config.printProfiles[part]}`.
  - `fixStep(facts, params, printCheck, closed = []) → {step, fix: {kind: "geometry"|"assign"|"colour", candidate?, detail}} | {step, manual: string} | null`.
  - `slotFlow(log, facts, params, printCheck, names) → {current, proposal}` — `proposal`: the pending `plant.fixes` entry or null.
  - `FIX_STEPS = ["size", "pdf", "colour"]`.

- [ ] **Step 1: Failing tests** — `tests/fix-flow.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { fixStep, slotFlow } from "../src/lib/fix-flow.js";

const printCheck = getFormat(CONFIG, "7").printCheck;
const profile = CONFIG.printProfiles.labels;
const params = {part: "labels", targetMm: {w: 98, h: 98}, trimMm: {w: 92, h: 92}, bleedMm: 3, round: true, page: 1,
  inkLimitPct: 220, black: printCheck.black, toleranceMm: 0.5, fixDpi: 1200, profile};
const f = (over = {}) => ({kind: "pdf", sha256: "s1", pageMm: {w: 98, h: 98}, ink: {maxPct: 200, overPct: 0},
  black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}, ...over,
  parsed: {pageSizeMm: {w: 98, h: 98}, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: profile.name, outputIntent: profile.name, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.3", pageCount: 1, effectiveDpi: {x: 300, y: 300}, ...over.parsed}});
const sized = (w, h, over = {}) => f({...over, pageMm: {w, h}, parsed: {pageSizeMm: {w, h}, ...over.parsed}});

test("fixStep: all pass → null; unreadable or encrypted → manual", () => {
  assert.equal(fixStep(f(), params, printCheck), null);
  assert.equal(fixStep(undefined, params, printCheck), null);
  assert.deepEqual(fixStep({error: "can't read"}, params, printCheck), {step: "pdf", manual: "can't read"});
  assert.match(fixStep({kind: "pdf", parsed: f().parsed}, params, printCheck).manual, /encrypted/);
});

test("fixStep size: within the bleed crop/mirror 1:1, beyond scale, right size rebuild, wrong ratio manual", () => {
  assert.deepEqual(fixStep(sized(96.012, 96.012), params, printCheck),
    {step: "size", fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: "mirror"},
      detail: "crop/add bleed 1:1, mirror 1.0 mm · detail 300 dpi"}});
  const big = fixStep(sized(408.5, 408.5, {parsed: {effectiveDpi: {x: 72, y: 72}}}), params, printCheck);
  assert.equal(big.fix.candidate.keep, "file");
  assert.equal(big.fix.detail, "scaled ×0.240 · detail 300 dpi");
  assert.deepEqual(fixStep(f({bleed: {outerInkPct: 1, innerInkPct: 90}}), params, printCheck).fix,
    {kind: "geometry", candidate: {scale: 1, keep: "trim", fill: "mirror"}, detail: "rebuilt the 3 mm bleed by mirroring"});
  assert.match(fixStep(sized(196, 98), params, printCheck).manual, /aspect ratio 196\.0×98\.0 mm vs 98×98 mm/);
});

test("fixStep order: size before pdf before colour; closed steps skipped", () => {
  const jpg = sized(96.012, 96.012, {kind: "jpeg", parsed: {pdfVersion: null, outputIntent: null}});
  assert.equal(fixStep(jpg, params, printCheck).step, "size");
  assert.deepEqual(fixStep(jpg, params, printCheck, ["size"]),
    {step: "pdf", fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: null}, detail: "rasterized at 1200 dpi, PDF 1.3"}});
  assert.equal(fixStep(jpg, params, printCheck, ["size", "pdf"]).step, "colour");
});

test("fixStep colour: only the profile → assign; ink, black or mode → colour fix", () => {
  assert.deepEqual(fixStep(f({parsed: {outputIntent: null}}), params, printCheck),
    {step: "colour", fix: {kind: "assign", detail: `assigned ${profile.name}, colours unchanged`}});
  assert.equal(fixStep(f({ink: {maxPct: 330, overPct: 10}}), params, printCheck).fix.kind, "colour");
  assert.equal(fixStep(f({parsed: {colorMode: "RGB"}}), params, printCheck).fix.kind, "colour");
});

test("slotFlow: pending proposal, dismissed step skipped, refused shown as manual, other content ignored", () => {
  const kmpn = sized(96.012, 96.012);
  const proposed = {step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v2.pdf", at: "t", result: "proposed", detail: "x"};
  assert.equal(slotFlow([proposed], kmpn, params, printCheck, ["K_labels_A_v2.pdf"]).proposal, proposed);
  assert.equal(slotFlow([proposed], kmpn, params, printCheck, []).proposal, null, "proposal file trashed by hand");
  const dismissed = [proposed, {...proposed, result: "dismissed"}];
  assert.equal(slotFlow(dismissed, kmpn, params, printCheck, []).current, null, "size dismissed, pdf and colour pass");
  const refused = [{step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", at: "t", result: "refused", error: "boom"}];
  assert.deepEqual(slotFlow(refused, kmpn, params, printCheck, []).current, {step: "size", manual: "fix refused — boom"});
  assert.equal(slotFlow([{...proposed, sha256: "other"}], kmpn, params, printCheck, ["K_labels_A_v2.pdf"]).proposal, null);
});
```

In `tests/artwork-checks.test.js` the `artworkSlots` params deepEqual gains `fixDpi: printCheck.fixDpi.labels, profile: CONFIG.printProfiles.labels`.

- [ ] **Step 2: Run** `node --test tests/` → FAIL (`fix-flow.js` missing; artworkSlots params).

- [ ] **Step 3: Implement.** `src/lib/artwork-checks.js`: `export function bleedTrimmed`; in `artworkSlots`' `add`: `fixDpi: printCheck.fixDpi[part], profile: config.printProfiles[part]` in params; in `measuredRows` after the Bleed row:

```js
  // The OutputIntent a PDF/X-1a for this part carries (plant facts only).
  if(params.profile && "outputIntent" in facts.parsed){
    const own = facts.parsed.outputIntent;
    const ok = own === params.profile.name;
    rows.push({feature: "Output intent", severity: resolveSeverity(checks.colorProfile.severity, ok),
      detected: own || "none", expected: ok ? null : params.profile.name});
  }
```

`src/lib/lines.js`: `colour: ["Colour mode", "Ink", "Black", "Output intent"]`.

`src/lib/fix-flow.js`:

```js
// The plant's fix flow per printed part: the checks decide the first
// failing step (size → pdf → colour), each step has one fix, proposed as
// the slot's next version and accepted or dismissed by staff; the log is
// project.plant.fixes. Spec: docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md.

import { artworkRows, bleedTrimmed } from "./artwork-checks.js";

export const FIX_STEPS = ["size", "pdf", "colour"];
const BAD = new Set(["warn", "error"]);

// The size step's one fix by rule: within the bleed crop or mirror 1:1
// (the design stays where it is against the cut), beyond it scale, right
// size with an empty bleed rebuild it. A wrong ratio only a person fixes.
function sizeFix(facts, params){
  const S = facts.pageMm, T = params.targetMm, tol = params.toleranceMm, bleed = params.bleedMm;
  const dpi = facts.parsed.effectiveDpi || facts.parsed.declaredDpi;
  const detail = scale => dpi ? ` · detail ${Math.round(Math.min(dpi.x, dpi.y) / scale)} dpi` : "";
  if(Math.abs(S.w - T.w) <= tol && Math.abs(S.h - T.h) <= tol){
    return {candidate: {scale: 1, keep: "trim", fill: "mirror"}, detail: `rebuilt the ${bleed} mm bleed by mirroring`};
  }
  const k = Math.max(T.w / S.w, T.h / S.h);
  if(Math.abs(S.w * k - T.w) > tol || Math.abs(S.h * k - T.h) > tol){
    return {manual: `aspect ratio ${S.w.toFixed(1)}×${S.h.toFixed(1)} mm vs ${T.w}×${T.h} mm — needs correction by hand`};
  }
  const dw = (T.w - S.w) / 2;
  if(Math.abs(dw) <= bleed && Math.abs((T.h - S.h) / 2) <= bleed){
    const what = dw >= 0 ? `mirror ${dw.toFixed(1)} mm` : `crop ${(-dw).toFixed(1)} mm`;
    return {candidate: {scale: 1, keep: "file", fill: "mirror"}, detail: `crop/add bleed 1:1, ${what}${detail(1)}`};
  }
  return {candidate: {scale: k, keep: "file", fill: null}, detail: `scaled ×${k.toFixed(3)}${detail(k)}`};
}

// The first failing step of a checked file that isn't closed (dismissed)
// for its content, with its fix or why only a person can fix it; null
// when every step passes or the file isn't checked yet.
export function fixStep(facts, params, printCheck, closed = []){
  if(!facts) return null;
  if(facts.error) return {step: "pdf", manual: facts.error};
  if(!facts.pageMm) return {step: "pdf", manual: "encrypted PDF — needs the file without a password"};
  const rows = artworkRows(facts, params, printCheck);
  const bad = names => rows.some(r => names.includes(r.feature) && BAD.has(r.severity));
  const fails = {
    size: bad(["Size"]) || bleedTrimmed(facts),
    pdf: facts.kind !== "pdf" || facts.parsed.pdfVersion !== "1.3",
    colour: bad(["Colour mode", "Ink", "Black", "Output intent"])
  };
  const step = FIX_STEPS.find(s => fails[s] && !closed.includes(s));
  if(!step) return null;
  if(step === "size"){
    const fix = sizeFix(facts, params);
    return fix.manual ? {step, manual: fix.manual} : {step, fix: {kind: "geometry", ...fix}};
  }
  if(step === "pdf"){
    return {step, fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: null},
      detail: `rasterized at ${params.fixDpi} dpi, PDF 1.3`}};
  }
  return {step, fix: bad(["Colour mode", "Ink", "Black"])
    ? {kind: "colour", detail: "colour fix"}
    : {kind: "assign", detail: `assigned ${params.profile.name}, colours unchanged`}};
}

// A slot's place in the flow from the fixes log (entries of this file
// content only): the current step, and the pending proposal — proposed,
// its file still there, not dismissed since. A refused fix stops the flow.
export function slotFlow(log, facts, params, printCheck, names){
  const mine = facts ? log.filter(e => e.sha256 === facts.sha256) : [];
  const last = step => mine.filter(e => e.step === step).at(-1);
  const closed = FIX_STEPS.filter(s => (last(s) || {}).result === "dismissed");
  const current = fixStep(facts, params, printCheck, closed);
  if(!current || current.manual) return {current, proposal: null};
  const entry = last(current.step);
  if(entry && entry.result === "refused") return {current: {step: current.step, manual: `fix refused — ${entry.error}`}, proposal: null};
  return {current, proposal: entry && entry.result === "proposed" && names.includes(entry.to) ? entry : null};
}
```

(The "Size" row and the "Output intent" row both come from `artworkRows`; `fixStep`'s `colour` detail for `kind: "colour"` is replaced by the server's reply.) Run `tests/lines.test.js`: where its fixtures now fail colour on "Output intent: none", add `outputIntent: CONFIG.printProfiles.labels.name` to the fixture's `parsed`.

- [ ] **Step 4: Run** `node --test tests/` → PASS; `node build/build.js` → builds.

- [ ] **Step 5: Commit** `fix flow: fixStep (size → pdf → colour, one fix by rule) and slotFlow from plant.fixes; Output intent row`.

---

### Task 5: Server — `/api/fix`, `/api/trash`, `jobs.trash`

**Files:**
- Modify: `plant/jobs.py` (new `trash`)
- Modify: `plant/server.py` (route table; `fix` replaces `fix_label`, `fix_geometry`, `fix_geometry_preview`; new `trash`)
- Test: `plant/test_jobs.py`, `plant/test_server.py` (old fix tests replaced)

**Interfaces:**
- Produces: `POST /api/fix {job, file, newName, step, params, fix}` → `{name, detail}`; `POST /api/trash {job, files, project, basedOn}` → `{projectHash}`; `jobs.trash(folder, name) → str` (name in `.trash/`).

- [ ] **Step 1: Failing tests.** `plant/test_jobs.py`:

```python
class TrashTest(unittest.TestCase):
    def test_moves_into_the_job_trash_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "X_labels_A_v2.pdf").write_bytes(b"one")
            self.assertEqual(jobs.trash(folder, "X_labels_A_v2.pdf"), "X_labels_A_v2.pdf")
            (folder / "X_labels_A_v2.pdf").write_bytes(b"two")
            self.assertEqual(jobs.trash(folder, "X_labels_A_v2.pdf"), "X_labels_A_v2_1.pdf")
            self.assertEqual((folder / ".trash" / "X_labels_A_v2.pdf").read_bytes(), b"one")
            for bad in ("project.json", ".checks", "../x", "missing.pdf"):
                with self.assertRaises(jobs.JobError):
                    jobs.trash(folder, bad)
```

(use the file's existing imports; add `tempfile`/`Path` if missing.) `plant/test_server.py`: delete `test_fix_label_…`, `geometry_job`, `test_geometry_*`; add

```python
    def fix_job(self):
        import pymupdf
        folder = self.root / "20_DONE" / "X_band_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        doc = pymupdf.open()
        page = doc.new_page(width=96 * 72 / 25.4, height=96 * 72 / 25.4)
        page.draw_rect(page.rect, color=None, fill=(0.6, 0.4, 0.4, 0))
        doc.save(folder / "X_labels_A_v1.pdf")
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True, "fixDpi": 100,
                  "toleranceMm": 0.5, "inkLimitPct": 220, "black": {"kMinPct": 85, "neutralTolPct": 10},
                  "profile": {"name": "ISO", "conditionId": "FOGRA39", "url": "https://127.0.0.1:9/x.icc", "file": "nope_test.icc"}}
        return folder, {"job": "X_band_261001-1432", "file": "X_labels_A_v1.pdf", "newName": "X_labels_A_v2.pdf",
                        "step": "size", "params": params}

    def test_fix_writes_the_next_version_once(self):
        folder, body = self.fix_job()
        body["fix"] = {"kind": "geometry", "candidate": {"scale": 1, "keep": "file", "fill": "mirror"}, "detail": "1:1"}
        self.assertEqual(self.post("/api/fix", body), (200, {"name": "X_labels_A_v2.pdf", "detail": "1:1"}))
        self.assertEqual((folder / "X_labels_A_v2.pdf").read_bytes()[:8], b"%PDF-1.3")
        self.assertEqual(self.post("/api/fix", body)[0], 409)
        self.assertEqual(self.post("/api/fix", {**body, "newName": "../x.pdf"})[0], 400)
        self.assertEqual(self.post("/api/fix", {**body, "newName": "X_labels_A_v3.pdf", "fix": {"kind": "magic"}})[0], 400)

    def test_fix_without_its_profile_is_refused(self):
        folder, body = self.fix_job()
        status, text = self.post("/api/fix", {**body, "step": "colour", "fix": {"kind": "assign", "detail": "x"}})
        self.assertEqual(status, 400)
        self.assertIn("print profile", text)
        self.assertFalse((folder / "X_labels_A_v2.pdf").exists())

    def test_trash_saves_the_log_then_moves(self):
        folder, body = self.fix_job()
        (folder / "X_labels_A_v2.pdf").write_bytes(b"x")
        digest = self.get("/api/job?job=X_band_261001-1432")[1]["projectHash"]
        req = {"job": body["job"], "files": ["X_labels_A_v2.pdf"], "project": {"catalogue": "X", "plant": {"fixes": []}}, "basedOn": digest}
        status, reply = self.post("/api/trash", req)
        self.assertEqual(status, 200)
        self.assertTrue((folder / ".trash" / "X_labels_A_v2.pdf").is_file())
        self.assertEqual(self.post("/api/trash", req)[0], 409)
        gone = {**req, "basedOn": reply["projectHash"]}
        self.assertEqual(self.post("/api/trash", gone)[0], 400)
        self.assertEqual(json.loads((folder / "project.json").read_text())["plant"], {"fixes": []})
```

(`icc.ensure` with an unreachable `https://127.0.0.1:9/…` fails fast → `ProfileError`. If `icc` caches to `plant/icc/`, the file name `nope_test.icc` never exists.)

- [ ] **Step 2: Run** `cd plant && uv run --project . python -m unittest test_jobs test_server` → FAIL (no `trash`, 404s).

- [ ] **Step 3: Implement.** `plant/jobs.py`:

```python
def trash(folder, name):
    """Moves a job file into <job>/.trash/: out of listings, checks and
    zips, recoverable by hand on any filesystem. A name already there
    gets _<n> — nothing is overwritten."""
    if plain(name) == "project.json":
        raise JobError("project.json can't be trashed")
    source = folder / name
    if not source.is_file():
        raise JobError(f"no file {name}")
    bin_ = folder / ".trash"
    bin_.mkdir(exist_ok=True)
    target, n = bin_ / name, 1
    while target.exists():
        target, n = bin_ / f"{source.stem}_{n}{source.suffix}", n + 1
    source.rename(target)
    return target.name
```

`plant/server.py`: route table — remove `/api/fix/label`, `/api/fix/geometry`, `/api/fix/geometry/preview`; add `"/api/fix": self.fix, "/api/trash": self.trash`. Delete `fix_label`, `fix_geometry`, `fix_geometry_preview` (and the now-unused `hashlib` import). Add:

```python
    def fix(self):
        """One step's fix as the slot's next version (the page names it and
        says which): geometry (size, pdf), assign or colour. The file in use
        is never touched; a refusal goes to the page as 400."""
        import colourfix
        import geomfix
        import icc
        r = self.body()
        source, target = self.fix_paths(r)
        params, fix = r["params"], r["fix"]
        try:
            if fix["kind"] == "geometry":
                geomfix.render(source, params, fix["candidate"], target, params["fixDpi"])
                detail = fix["detail"]
            else:
                run = {"assign": colourfix.assign, "colour": colourfix.fix}[fix["kind"]]
                try:
                    profile = icc.ensure(params["profile"])
                except icc.ProfileError as error:
                    raise JobError(f"print profile: {error}") from None
                detail = run(source, params, target, profile)
        except (geomfix.FixError, colourfix.FixError) as error:
            raise JobError(str(error)) from None
        self.json({"name": r["newName"], "detail": detail})

    def trash(self):
        """Saves project.json (the page's log of it, 409 when it changed),
        then moves the files into the job's .trash/. Every file must exist
        first, so a refusal changes nothing."""
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        if not isinstance(r.get("project"), dict):
            raise JobError("project must be an object")
        for name in r["files"]:
            if not (folder / jobs.plain(name)).is_file():
                raise JobError(f"no file {name}")
        digest = jobs.write_project(folder, r["project"], r["basedOn"])
        for name in r["files"]:
            jobs.trash(folder, name)
        self.json({"projectHash": digest})
```

(The `{…}[kind]` lookup raises `KeyError` → 400 "bad request" for an unknown kind. `jobs.write_project` raises `Conflict` → 409.)

- [ ] **Step 4: Run** `uv run --project plant python -m unittest discover plant` → PASS.

- [ ] **Step 5: Commit** `plant server: /api/fix (geometry, assign, colour) and /api/trash into the job's .trash/`.

---

### Task 6: Page rendering — flow per slot, trash buttons, no step strip

**Files:**
- Modify: `src/lib/plant-overview.js` (`renderArtwork`, `artFileHtml`, `versionsCell`, `renderProduction`; remove `geometryTilesHtml`, `fixable` import, compare param)
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `slotFlow` result `{current, proposal}`; `cutLinesSvg`.
- Produces: `renderArtwork(files, checkable, facts, printCheck, base, gaps, flows = {})` — `flows: {fileName: {current, proposal}}`; buttons:
  - `<button type="button" class="accept" data-slot="<i>">accept</button>`, `<button type="button" class="dismiss" data-slot="<i>">dismiss</button>`
  - per other version: `<button type="button" class="trash" data-slot="<i>" data-file="<name>">trash</button>`
  - `<button type="button" class="trash-old" data-slot="<i>">trash old versions (N)</button>` when `flows[name].current === null` and the slot has others.
- `renderProduction(states, partners)`: no step strip; per line its name, and either the current action buttons (as today) or, at a check step, `<p>artwork: <why></p>`.

- [ ] **Step 1: Failing tests** — in `tests/plant-overview.test.js` replace the "fix button … comparison side by side" test and the "size fix tiles" test with:

```js
test("artwork: flow per slot — proposal with its checks and accept/dismiss, manual line, trash", () => {
  const params = {part: "labels", targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, round: true,
    page: 1, inkLimitPct: 220, holeMm: 7.4, black: {kMinPct: 85, cmyMaxPct: 30}, toleranceMm: 0.5};
  const checkable = [{title: "Label A", name: "lab_a_v1.pdf", params}];
  const one = (w, name) => ({kind: "pdf", parsed: {pageSizeMm: {w, h: w}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.3", pageCount: 1, effectiveDpi: null}, pageMm: {w, h: w}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: 200, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: `${name}.png`, overlay: `${name}.overlay.png`});
  const facts = {"lab_a_v1.pdf": one(104, "a1"), "lab_a_v2.pdf": one(106, "a2")};
  const proposal = {step: "size", file: "lab_a_v1.pdf", sha256: "s", to: "lab_a_v2.pdf", at: "t", result: "proposed",
    detail: "crop/add bleed 1:1, mirror 1.0 mm"};
  const flows = {"lab_a_v1.pdf": {current: {step: "size", fix: {kind: "geometry"}}, proposal}};
  const html = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", [], flows);
  assert.ok(html.includes('<div class="proposal"><h4>size: crop/add bleed 1:1, mirror 1.0 mm — lab_a_v2.pdf</h4>'));
  assert.ok(html.includes('src="/jobs/j1/a2.png"'));
  assert.ok(html.includes('<button type="button" class="accept" data-slot="2">accept</button>'));
  assert.ok(html.includes('<button type="button" class="dismiss" data-slot="2">dismiss</button>'));
  const manual = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", [],
    {"lab_a_v1.pdf": {current: {step: "size", manual: "aspect <ratio>"}, proposal: null}});
  assert.ok(manual.includes('<p class="manual">size: aspect &lt;ratio&gt; — fix the file and save it into the job folder (same name, or any name + use)</p>'));
});

test("artwork: trash per other version; trash old versions only when the flow is through", () => {
  const checkable = artworkSlots(project, CONFIG);
  const name = checkable[0].name;
  const slot = files.slots.find(s => s.name === name);
  const withOthers = {...files, slots: files.slots.map(s => s === slot ? {...s, others: [{name: "old_v0.pdf", newer: false}]} : s)};
  const through = renderArtwork(withOthers, checkable, null, printCheck, "/jobs/j1/", [], {[name]: {current: null, proposal: null}});
  assert.ok(through.includes(`<button type="button" class="trash" data-slot="${slot.index}" data-file="old_v0.pdf">trash</button>`));
  assert.ok(through.includes(`<button type="button" class="trash-old" data-slot="${slot.index}">trash old versions (1)</button>`));
  const open = renderArtwork(withOthers, checkable, null, printCheck, "/jobs/j1/", [], {[name]: {current: {step: "pdf", fix: {}}, proposal: null}});
  assert.ok(!open.includes("trash-old"));
});
```

(`project`, `files`, `printCheck` are the file's existing fixtures; if `project` has no artwork slot with a file, use the fixture the other artwork tests use.) Update the production test: no `→` step strip; a check step shows `<p>artwork: Label A: 96 &lt;mm&gt;</p>`; approve/send/back buttons unchanged:

```js
  const check = renderProduction([st("bleed", "check")], partners);
  assert.ok(!check.includes("→"));
  assert.ok(check.includes("<p>artwork: Label A: 96 &lt;mm&gt;</p>"));
```

(keep the existing approve/send/back/checking assertions.)

- [ ] **Step 2: Run** `node --test tests/plant-overview.test.js` → FAIL.

- [ ] **Step 3: Implement** in `src/lib/plant-overview.js`:
  - Imports: drop `fixable`.
  - `versionsCell(slot)`: each other version gets ` <button type="button" class="trash" data-slot="${slot.index}" data-file="${escapeHtml(o.name)}">trash</button>` after its use button.
  - `renderProduction`: drop the `steps` line; body = `<h3>…</h3>`; for a current step of kind `check`: `<p>artwork: ${escapeHtml(s.why)}</p>`; other kinds as today.
  - Delete `geometryTilesHtml`; `artFileHtml({title, params}, facts, printCheck, base, slotIndex, flow = null)`: drop the "fix colours" button; after the checklist table:

```js
  if(flow && flow.current && flow.current.manual){
    out += `<p class="manual">${escapeHtml(flow.current.step)}: ${escapeHtml(flow.current.manual)}`
      + ` — fix the file and save it into the job folder (same name, or any name + use)</p>`;
  }
```

    and the proposal box (rendered by `renderArtwork`, which has the proposal's facts):

```js
// A pending fix: what it did, its own preview with cut lines and all its
// checks, accept or dismiss.
function proposalHtml(proposal, facts, params, printCheck, base, slotIndex){
  return `<div class="proposal"><h4>${escapeHtml(proposal.step)}: ${escapeHtml(proposal.detail)} — ${escapeHtml(proposal.to)}</h4>`
    + artFileHtml({title: proposal.to, params: {...params, page: 1}}, facts || {error: "not checked"}, printCheck, base, null)
    + `<p><button type="button" class="accept" data-slot="${slotIndex}">accept</button> `
    + `<button type="button" class="dismiss" data-slot="${slotIndex}">dismiss</button></p></div>`;
}
```

  - `renderArtwork(files, checkable, facts, printCheck, base, gaps, flows = {})`: the slot table's verdict cell gains, when `flows[s.name] && flows[s.name].current === null && s.others.length`, ` <button type="button" class="trash-old" data-slot="${s.index}">trash old versions (${s.others.length})</button>`; per checkable:

```js
    const flow = flows[c.name] || null;
    const own = artFileHtml(c, facts[c.name] || {error: "not checked"}, printCheck, base, slot ? slot.index : null, flow);
    return own + (flow && flow.proposal && slot ? proposalHtml(flow.proposal, facts[flow.proposal.to], c.params, printCheck, base, slot.index) : "");
```

  (the trash buttons render with and without facts — they come from the slot table.) Update the doc comment: `flows: {name: slotFlow()} — the fix flow per slot`.
  - `src/plant/theme.css`: `.proposal{ margin:12px 0 18px; padding-left:12px; border-left:3px solid var(--ink-dim); }` and `.manual{ color:var(--danger); font-weight:700; }`; remove the `.geometry` rules there and in `structure.css`.

- [ ] **Step 4: Run** `node --test tests/` → PASS.

- [ ] **Step 5: Commit** `plant view: the fix flow per slot (proposal with its checks, accept/dismiss, manual), trash buttons; no step strip`.

---

### Task 7: Page flow, removals, docs, smoke test

**Files:**
- Modify: `src/plant/app.js`
- Modify: `src/lib/artwork-checks.js` (remove `fixable`, `newerToCompare`, `geometryFixes`), `src/lib/lines.js` (remove `fixerTargets`)
- Modify: `tests/artwork-checks.test.js`, `tests/lines.test.js` (remove their tests)
- Modify: `plant/geomfix.py` docstring, `plant/CLAUDE.md`, `CLAUDE.md` (Architecture: fix flow, `.trash/`; "Files are never overwritten" stays, add "unused versions are trashed into `.trash/`")

**Interfaces:**
- Consumes: `slotFlow`, `FIX_STEPS` (Task 4), `/api/fix`, `/api/trash` (Task 5), `renderArtwork(…, flows)` (Task 6), `useVersion`, `nextVersionName`, `versionOf`, `historyEntry`, `jobName`, `postJson`.

- [ ] **Step 1: Remove dead code and its tests** — `fixable`, `newerToCompare`, `geometryFixes` (keep `bleedTrimmed`), `fixerTargets`; their tests in `tests/artwork-checks.test.js` and `tests/lines.test.js`; their imports. Run `node --test tests/` → PASS.

- [ ] **Step 2: `app.js` load flow** — imports: `artworkSlots` only from artwork-checks; `import { slotFlow } from "../lib/fix-flow.js";`; `lineState, logEntry` from lines. In `showJob`:
  - drop `compare`; the artwork check request becomes `artwork: Object.fromEntries([...checkable.map(c => [c.name, c.params]), ...pendingTargets])` where pending targets are computed from the log before the check:

```js
  const log = (data.project.plant || {}).fixes || [];
  // A proposed fix's file is checked too (on its first page), so its box shows all its checks.
  const proposed = checkable.flatMap(c => log.filter(e => e.file === c.name && e.result === "proposed" && view.names.includes(e.to))
    .map(e => [e.to, {...c.params, page: 1}]));
```

  - after the artwork facts: `const flows = Object.fromEntries(checkable.map(c => [c.name, slotFlow(log, artworkFacts[c.name], c.params, printCheck, view.names)]));` render with `renderArtwork(files, checkable, artworkFacts, printCheck, base, gaps, flows)`; `Object.assign(view, {project, artworkFacts, flows})`.
  - replace the geometry-preview block and the fixer loop with:

```js
    // One fix per load where fixers run: the first slot whose step has a
    // fix and no pending proposal gets one, as its next version; the reload
    // checks it and shows it for accept or dismiss.
    if((CONFIG.fixerStages || []).includes(data.stage)){
      const c = checkable.find(c => { const f = flows[c.name]; return f.current && f.current.fix && !f.proposal; });
      if(c){
        const {current} = flows[c.name];
        const newName = nextVersionName(versionOf(c.name).base, ".pdf", view.names);
        const entry = {step: current.step, file: c.name, sha256: artworkFacts[c.name].sha256, at: new Date().toISOString()};
        busy(`${current.step} fix of ${c.name}`);
        let note;
        try{
          const reply = await postJson("/api/fix", {job, file: c.name, newName, step: current.step, params: c.params, fix: current.fix});
          Object.assign(entry, {to: newName, result: "proposed", detail: reply.detail});
          note = `${c.title}: ${current.step} fix proposed — ${reply.detail} (${newName})`;
        }catch(err){
          if(id !== latest) return;
          Object.assign(entry, {result: "refused", error: err.message});
          note = `${c.title}: ${current.step} fix refused — ${err.message}`;
        }
        const raw = structuredClone(view.raw);
        raw.plant = raw.plant || {};
        raw.plant.fixes = [...(raw.plant.fixes || []), entry];
        raw.history = [...(raw.history || []), historyEntry(note, new Date())];
        await postJson("/api/project", {job, project: raw, basedOn: view.hash});
        if(id === latest) route();
        return;
      }
    }
```

- [ ] **Step 3: `app.js` buttons** — selector `".use, #move, #rescan, .merge, #accept, .accept, .dismiss, .trash, .trash-old, .line-act"`; remove the `.fix` and `.geo` branches; add (before `.merge`):

```js
    } else if(button.matches(".accept, .dismiss")){
      const slot = view.slots[Number(button.dataset.slot)];
      const {proposal} = view.flows[slot.name];
      const accepted = button.matches(".accept");
      const project = structuredClone(view.raw);
      project.plant = project.plant || {};
      project.plant.fixes = [...(project.plant.fixes || []),
        {step: proposal.step, file: proposal.file, sha256: proposal.sha256, to: proposal.to,
          at: new Date().toISOString(), result: accepted ? "accepted" : "dismissed"}];
      project.history = [...(project.history || []), historyEntry(`${slot.title}: ${proposal.step} — ${proposal.detail} `
        + (accepted ? `accepted (${slot.name} → ${proposal.to})` : `dismissed, ${proposal.to} trashed`), new Date())];
      if(accepted){
        useVersion(project, slot.path, proposal.to);
        const {job} = await postJson("/api/assign", {job: view.job, file: proposal.to, newName: proposal.to, project,
          basedOn: view.hash, name: jobName(project)});
        if(job !== view.job){
          location.hash = `#/job/${encodeURIComponent(job)}`;
          return;
        }
      } else {
        await postJson("/api/trash", {job: view.job, files: [proposal.to], project, basedOn: view.hash});
      }
    } else if(button.matches(".trash, .trash-old")){
      // Unused versions into the job's .trash/ — recoverable by hand.
      const slot = view.slots[Number(button.dataset.slot)];
      const trashed = button.matches(".trash") ? [button.dataset.file] : slot.others.map(o => o.name);
      const project = structuredClone(view.raw);
      project.history = [...(project.history || []), historyEntry(`${slot.title}: trashed ${trashed.join(", ")}`, new Date())];
      await postJson("/api/trash", {job: view.job, files: trashed, project, basedOn: view.hash});
```

- [ ] **Step 4: Docs** — `plant/geomfix.py` docstring: "the fix flow's size and pdf steps (src/lib/fix-flow.js)". `plant/CLAUDE.md`: geomfix bullet → size/pdf steps of the flow; colourfix bullet → every part, neutral → K at the same L*, assign, PDF/X-1a; new bullet:

```markdown
- Fix flow (`src/lib/fix-flow.js`, spec
  `docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md`): per
  slot size → pdf → colour, one proposal per load (`/api/fix`, the
  slot's next `_v<N>.pdf`, PDF 1.3 / PDF/X-1a after colour), accept =
  use, dismiss = `/api/trash` into the job's `.trash/`; log
  `plant.fixes`.
```

  `CLAUDE.md` workflow point 7, after "Files are never overwritten…": "Versions not in use can be trashed from the plant view into the job's `.trash/` (recoverable by hand)." Architecture plant paragraph: replace "the colour fixer runs by itself" with "the fix flow (size → pdf → colour) proposes one fix at a time".

- [ ] **Step 5: Run everything** — `node --test tests/`, `uv run --project plant python -m unittest discover plant`, `node build/build.js` → all pass; `node --check src/plant/app.js`.

- [ ] **Step 6: Smoke test without a browser** — copy the sample job, post one fix per step, check the outputs, trash, then remove the copy:

```bash
cp -R plant/jobs/00_INBOX/KMPN012_aroop_roy_high_riding_261001-2236 plant/jobs/20_DONE/KMPN012_smoke_261002-0000
# with the plant server running in a separate terminal (restart it for the new endpoints):
P='{"page":1,"targetMm":{"w":98,"h":98},"trimMm":{"w":92,"h":92},"round":true,"fixDpi":1200,"toleranceMm":0.5,"inkLimitPct":220,"black":{"kMinPct":85,"cmyMaxPct":30,"neutralTolPct":10},"profile":{"name":"ISO Coated v2 (ECI)","conditionId":"FOGRA39","url":"https://eci.org/lib/exe/eci_offset_2009.zip","file":"ISOcoated_v2_eci.icc"}}'
curl -s -X POST http://127.0.0.1:8765/api/fix -H 'Content-Type: application/json' -d "{\"job\":\"KMPN012_smoke_261002-0000\",\"file\":\"KMPN012_labels_A_v1.pdf\",\"newName\":\"KMPN012_labels_A_v2.pdf\",\"step\":\"size\",\"params\":$P,\"fix\":{\"kind\":\"geometry\",\"candidate\":{\"scale\":1,\"keep\":\"file\",\"fill\":\"mirror\"},\"detail\":\"1:1\"}}"
curl -s -X POST http://127.0.0.1:8765/api/fix -H 'Content-Type: application/json' -d "{\"job\":\"KMPN012_smoke_261002-0000\",\"file\":\"KMPN012_labels_A_v2.pdf\",\"newName\":\"KMPN012_labels_A_v3.pdf\",\"step\":\"colour\",\"params\":$P,\"fix\":{\"kind\":\"colour\",\"detail\":\"x\"}}"
cd plant && uv run --project . python -c "
import artwork
for v in (2, 3):
    p = f'jobs/20_DONE/KMPN012_smoke_261002-0000/KMPN012_labels_A_v{v}.pdf'
    k, parsed, _ = artwork.structure(p, 1)
    print(v, parsed['pageSizeMm'], parsed['pdfVersion'], parsed['colorMode'], parsed['outputIntent'])"
cd .. && trash plant/jobs/20_DONE/KMPN012_smoke_261002-0000
```

Expected: v2 98×98 mm, `1.3`, CMYK, outputIntent None; v3 98×98, `1.3`, CMYK, `ISO Coated v2 (ECI)`; the colour reply's detail lists pure K / neutral → K / capped shares. Then ask the user to open KMPN012 in the plant view (browser only with the user's OK).

- [ ] **Step 7: Commit** `plant view: fix flow on load (one proposal per load), accept/dismiss/trash; old fixer and tiles removed; docs`.

---

## Self-review notes

- Spec coverage: steps and rules (T4), pdf 1.3 + PDF/X-1a (T2), colour fix for all parts with neutral rule + assign (T3), config (T1), `outputIntent` fact + CHECKS_VERSION (T2), log `plant.fixes` (T4 slotFlow, T7 writes), `/api/fix` + `/api/trash` + `.trash/` (T5), page per slot + trash buttons + no step strip (T6), load flow and removals (T7), manual correction (T4 manual, T6 line; re-entry by sha256 is inherent).
- Names across tasks: `fixStep`, `slotFlow`, `FIX_STEPS`, `{current, proposal}`, `plant.fixes` entry `{step, file, sha256, to, at, result, detail, error}`, `colourfix.fix/assign`, `artwork.pdfx/save_atomic/output_intent_name`, `jobs.trash`, `/api/fix {…, fix: {kind, candidate?, detail}}`, `renderArtwork(…, flows)`, buttons `.accept .dismiss .trash .trash-old`.
