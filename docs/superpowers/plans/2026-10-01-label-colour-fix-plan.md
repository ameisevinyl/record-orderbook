# Label colour fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant view offers "fix colours" on a label whose ink or black check warns, and writes a press-safe version: rich black becomes pure K, total ink is capped at the label limit, RGB goes through a downloaded CMYK profile. It shows the fix next to the label in use, with Retina-sharp previews and a CMYK readout under the mouse.

**Architecture:** Python reads and writes files, and the page decides; this is how the plant view already works.
- `plant/icc.py` downloads output profiles named in `CONFIG.printProfiles` into the gitignored `plant/icc/`.
- `plant/colourfix.py` renders a label's data area at `fixDpi`, applies two pixel rules and writes a one-image CMYK PDF as the slot's next version.
- `plant/artwork.py` gets bigger previews plus a raw CMYK preview file, which the page reads for the hover readout.
- Pure page logic (which slots are fixable, which newer versions to compare) lives in `src/lib/artwork-checks.js`. The rendering goes in `src/lib/plant-overview.js`, the wiring in `src/plant/app.js`.

**Tech Stack:** Python 3 (stdlib, PyMuPDF, Pillow with `ImageCms`/LittleCMS, numpy), `unittest`; plain ES modules, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-01-label-colour-fix-design.md`

## Global Constraints

- **Rules:** K ≥ `black.kMinPct` → 0/0/0/100. Otherwise, total ink over the label limit → C, M and Y scaled by `(limit − K) / (C+M+Y)` (never below 0), with K kept.
- **Input:** CMYK keeps the file's own numbers (no colour management). Greyscale goes into K only. RGB goes through LittleCMS (perceptual) into the labels profile.
- **Config values:** `inkLimitPct.labels` (220), `black.kMinPct` (85), and the new per-format `printCheck.fixDpi` (1200). They come from `CONFIG` through the page in the request params; nothing is hardcoded in Python.
- **Never overwrite:** the fix is written as the slot's next version, always `.pdf`, named by the page with `nextVersionName`. An existing name is a `Conflict`. Nothing changes the slot without "use".
- **Labels only.**
- **Not included:** ArgyllCMS, PDF/X and bleed generation.
- **No repo copies:** profiles are never committed. `plant/icc/` is gitignored.
- **Profile source:** the labels profile is `{name: "ISO Coated v2 (ECI)", url: "https://eci.org/lib/exe/eci_offset_2009.zip", file: "ISOcoated_v2_eci.icc"}`, verified 2026-10-01. The zip holds `ECI_Offset_2009/ISOcoated_v2_eci.icc` plus `__MACOSX/` junk; match a member by its basename and skip `__MACOSX/`.
- **Tests and commits:** run `node --test tests/` and `uv run --project plant python -m unittest discover plant` before every commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **One shared scope:** every file in `build/build.js` FILES shares one top-level scope, so no duplicate top-level names. The plant page files aren't in the build.

## Review Focus

1. **Size refusal:** a label whose data area isn't the label's data size (e.g. an A4 page) must be refused with a clear message, not fixed into a wrong-sized PDF. Covered in Task 3 (`test_refuses_wrong_size`).
2. **RGB without a profile:** a missing profile, with the download failing (offline), refuses with the profile's name. CMYK and grey still fix. Covered in Task 3 (`test_rgb_without_profile_refuses`).
3. **Running the fix twice:** the second request carries the same `newName` and gets a 409, not a silent overwrite. Covered in Task 4.
4. **K above the limit on its own (e.g. 100 K over a 90 % limit):** C, M and Y go to 0, K stays, and the pixel is never negative. Covered in Task 3 (`test_rules`).
5. **A multi-page PDF label:** the fix renders `params.page`, not page 1. Covered in Task 3 (`test_uses_the_chosen_page`).

---

### Task 1: Config — `fixDpi`, `printProfiles`, validation; spec URL; gitignore

**Files:**
- Modify: `src/config.js` (each format's `printCheck`; top-level `printProfiles`)
- Modify: `src/lib/config-validation.js`
- Modify: `docs/superpowers/specs/2026-10-01-label-colour-fix-design.md` (the URL)
- Modify: `.gitignore`
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces:
  - `format.printCheck.fixDpi` (positive integer).
  - `CONFIG.printProfiles = {labels: {name, url, file}}`, where `url` starts with `https://` and `file` ends `.icc`, contains no `/`, and isn't `..`.

- [ ] **Step 1: Write the failing test** (append to `tests/config-validation.test.js`)

```js
test("validates fixDpi and the print profiles", () => {
  const dpi = copy();
  dpi.formats[0].printCheck.fixDpi = 0;
  assert.throws(() => validateConfig(dpi), /CONFIG\.formats\[0\]\.printCheck\.fixDpi must be a positive integer/);

  const url = copy();
  url.printProfiles.labels.url = "http://example.com/x.icc";
  assert.throws(() => validateConfig(url), /CONFIG\.printProfiles\.labels\.url must start with https:\/\//);

  const file = copy();
  file.printProfiles.labels.file = "../x.icc";
  assert.throws(() => validateConfig(file), /CONFIG\.printProfiles\.labels\.file must be a plain \.icc file name/);

  assert.equal(CONFIG.printProfiles.labels.file, "ISOcoated_v2_eci.icc");
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/config-validation.test.js`
Expected: FAIL; `printProfiles` is undefined, so a TypeError on `.labels`.

- [ ] **Step 3: Implement**

In `src/config.js`:
- In each format's `printCheck`, after `sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 },` (3×), add this line:

  ```js
          // Resolution of a plant-side colour fix (a label rendered to one CMYK image).
          fixDpi: 1200,
  ```
- After the top-level `proofs: {…},` block:

  ```js
    // Output profile per printed part, for turning RGB artwork into CMYK
    // in a plant-side fix. The plant server downloads it into plant/icc/
    // when missing (a .zip: the member with this file name); never committed.
    printProfiles: {
      labels: { name: "ISO Coated v2 (ECI)", url: "https://eci.org/lib/exe/eci_offset_2009.zip", file: "ISOcoated_v2_eci.icc" }
    },
  ```

In `src/lib/config-validation.js`:
- In `validatePrintCheck`, after the `dpi` lines:

  ```js
    if(!Number.isInteger(printCheck.fixDpi) || printCheck.fixDpi <= 0) fail(`${path}.fixDpi`, "must be a positive integer");
  ```
- Add a function:

  ```js
  function validatePrintProfiles(value){
    const profiles = object(value, "CONFIG.printProfiles");
    for(const [part, entry] of Object.entries(profiles)){
      const path = `CONFIG.printProfiles.${part}`;
      object(entry, path);
      string(entry.name, `${path}.name`);
      if(typeof entry.url !== "string" || !entry.url.startsWith("https://")) fail(`${path}.url`, "must start with https://");
      if(typeof entry.file !== "string" || !/^[^/\\]+\.icc$/i.test(entry.file) || entry.file.startsWith(".")) fail(`${path}.file`, "must be a plain .icc file name");
    }
  }
  ```
- Call `validatePrintProfiles(config.printProfiles);` after `validateProofs(config.proofs);`.

In the spec, replace the URL `https://eci.org/_media/downloads/icc_profiles_from_eci/eci_offset_2009.zip` with `https://eci.org/lib/exe/eci_offset_2009.zip`, and delete the sentence "Verify the exact name in the ECI zip when implementing."

Append to `.gitignore`:

```
# Output profiles the plant server downloads (CONFIG.printProfiles).
/plant/icc/
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/config-validation.test.js .gitignore docs/superpowers/specs/2026-10-01-label-colour-fix-design.md
git commit -m "config: fixDpi per format, printProfiles (labels: ISO Coated v2 from ECI); plant/icc/ ignored"
```

---

### Task 2: Profile download — `plant/icc.py`, `POST /api/profiles`

**Files:**
- Create: `plant/icc.py`
- Modify: `plant/server.py` (route and handler)
- Test: `plant/test_icc.py`, `plant/test_server.py`

**Interfaces:**
- Produces:
  - `icc.ICC_DIR` (`Path`, default `plant/icc/`).
  - `icc.path(spec, icc_dir=ICC_DIR) -> Path | None`: the profile file if present.
  - `icc.ensure(spec, icc_dir=ICC_DIR) -> Path`: downloads if missing, raising `icc.ProfileError(message)` on failure.
  - `icc.ensure_all(specs, icc_dir=ICC_DIR)` starts a daemon thread per missing profile.
  - `spec` = `{"name", "url", "file"}`.
- Server `POST /api/profiles` `{profiles: {part: spec}}` → `{}`; downloads run in the background.

- [ ] **Step 1: Write the failing tests** (`plant/test_icc.py`)

```python
import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import ImageCms

import icc


def profile_bytes():
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


class IccTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.out = self.dir / "icc"

    def tearDown(self):
        self.tmp.cleanup()

    def test_direct_icc_is_downloaded_once(self):
        src = self.dir / "p.icc"
        src.write_bytes(profile_bytes())
        spec = {"name": "P", "url": src.as_uri(), "file": "p.icc"}
        self.assertIsNone(icc.path(spec, self.out))
        self.assertEqual(icc.ensure(spec, self.out).read_bytes(), profile_bytes())
        src.unlink()  # a second call must not download again
        self.assertEqual(icc.ensure(spec, self.out), self.out / "p.icc")

    def test_member_of_a_zip_by_basename_skipping_macosx(self):
        z = self.dir / "e.zip"
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("__MACOSX/ECI/._ISOcoated_v2_eci.icc", b"junk")
            zf.writestr("ECI/ISOcoated_v2_eci.icc", profile_bytes())
        spec = {"name": "ISO", "url": z.as_uri(), "file": "ISOcoated_v2_eci.icc"}
        self.assertEqual(icc.ensure(spec, self.out).read_bytes(), profile_bytes())

    def test_failures_name_the_profile_and_leave_nothing(self):
        for url in [(self.dir / "missing.icc").as_uri(), (self.dir / "x.zip").as_uri()]:
            if url.endswith(".zip"):
                with zipfile.ZipFile(self.dir / "x.zip", "w") as zf:
                    zf.writestr("other.icc", profile_bytes())
            with self.assertRaisesRegex(icc.ProfileError, "ISO Coated"):
                icc.ensure({"name": "ISO Coated", "url": url, "file": "p.icc"}, self.out)
        self.assertEqual(list(self.out.glob("*")) if self.out.exists() else [], [])

    def test_unsafe_file_names_are_refused(self):
        with self.assertRaises(icc.ProfileError):
            icc.path({"name": "x", "url": "https://x", "file": "../x.icc"}, self.out)
```

- [ ] **Step 2: Run it and check it fails**

Run: `uv run --project plant python -m unittest discover plant`
Expected: ERROR, `No module named 'icc'`.

- [ ] **Step 3: Implement `plant/icc.py`**

```python
"""Output profiles (CONFIG.printProfiles) for plant-side colour fixes:
downloaded into plant/icc/ when missing — never committed. A .zip URL
yields its member with the profile's file name (__MACOSX/ copies skipped)."""
import io
import threading
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ICC_DIR = Path(__file__).resolve().parent / "icc"
LOCK = threading.Lock()


class ProfileError(Exception):
    """A profile that isn't there and couldn't be downloaded."""


def _file(spec):
    name = spec.get("file", "")
    if not name.endswith(".icc") or "/" in name or "\\" in name or name.startswith("."):
        raise ProfileError(f"bad profile file name: {name!r}")
    return name


def path(spec, icc_dir=ICC_DIR):
    target = Path(icc_dir) / _file(spec)
    return target if target.is_file() else None


def ensure(spec, icc_dir=ICC_DIR):
    found = path(spec, icc_dir)
    if found:
        return found
    name = _file(spec)
    with LOCK:
        if path(spec, icc_dir):
            return path(spec, icc_dir)
        try:
            with urllib.request.urlopen(spec["url"], timeout=60) as response:
                data = response.read()
            if spec["url"].lower().endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    members = [m for m in zf.namelist()
                               if PurePosixPath(m).name == name and not m.startswith("__MACOSX/")]
                    if not members:
                        raise ProfileError(f"{spec['name']}: {name} is not in {spec['url']}")
                    data = zf.read(members[0])
        except ProfileError:
            raise
        except (OSError, zipfile.BadZipFile, ValueError) as error:
            raise ProfileError(f"{spec['name']} not available: {error}") from None
        icc_dir = Path(icc_dir)
        icc_dir.mkdir(parents=True, exist_ok=True)
        part = icc_dir / f".{name}.part"
        part.write_bytes(data)
        part.rename(icc_dir / name)
        return icc_dir / name


def ensure_all(specs, icc_dir=ICC_DIR):
    """Downloads every missing profile in the background; a failure is
    printed and tried again on the next request."""
    for spec in specs.values():
        if path(spec, icc_dir) is None:
            def run(spec=spec):
                try:
                    ensure(spec, icc_dir)
                except ProfileError as error:
                    print(f"profile: {error}")
            threading.Thread(target=run, daemon=True).start()
```

In `plant/server.py`:
- Add `"/api/profiles": self.profiles,` to the `do_POST` dict.
- Add the handler next to `spectrum`:

  ```python
      def profiles(self):
          """The page sends CONFIG.printProfiles on load; missing ones are
          downloaded in the background (icc.py)."""
          import icc
          specs = self.body().get("profiles", {})
          if not isinstance(specs, dict):
              raise JobError("profiles must be an object")
          icc.ensure_all(specs)
          self.json({})
  ```

- [ ] **Step 4: Server test** (append to `plant/test_server.py`, inside `HttpTest`, before `class StartupTest`)

```python
    def test_profiles_start_downloads_and_answer_at_once(self):
        self.assertEqual(self.post("/api/profiles", {"profiles": {}}), (200, {}))
        self.assertEqual(self.post("/api/profiles", {"profiles": []})[0], 400)
```

- [ ] **Step 5: Run the tests**

Run: `uv run --project plant python -m unittest discover plant`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add plant/icc.py plant/test_icc.py plant/server.py plant/test_server.py
git commit -m "plant: output profiles downloaded on demand into plant/icc/ (zip member by name), /api/profiles"
```

---

### Task 3: The fix — `plant/colourfix.py`

**Files:**
- Create: `plant/colourfix.py`
- Test: `plant/test_colourfix.py`

**Interfaces:**
- Consumes:
  - `artwork.structure(path, page)`, `artwork.data_box(doc, page)`, `artwork.size_mm(rect)`, `artwork.ArtworkError`;
  - `icc.ensure(spec)`, `icc.ProfileError`.
- Produces:
  - `colourfix.fix_pixels(cmyk: numpy uint8 (h, w, 4), ink_limit: float, k_min: float) -> numpy uint8 (h, w, 4)`.
  - `colourfix.fix_label(path, params, out, profile_path=None)`. It raises `colourfix.FixError(message)` and writes the PDF to `out`.
  - `params` keys: `page`, `targetMm`, `trimMm`, `toleranceMm`, `inkLimitPct`, `black.kMinPct`, `fixDpi`. `profile_path` is resolved by the caller (Task 4), and is needed only for RGB input.

- [ ] **Step 1: Write the failing tests** (`plant/test_colourfix.py`)

```python
import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf
from PIL import Image

import colourfix

MM = 72 / 25.4
GENERIC_CMYK = Path("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc")
PARAMS = {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "toleranceMm": 0.5,
          "inkLimitPct": 220, "black": {"kMinPct": 85}, "fixDpi": 150}


def px(*cmyk):
    return numpy.array([[[round(v * 2.55) for v in cmyk]]], numpy.uint8)


def pct(a):
    return [round(v / 2.55) for v in a[0, 0]]


def cmyk_pdf(path, size_mm=106, fill=(0.6, 0.4, 0.4, 1), pages=1):
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
        page.draw_rect(page.rect, color=None, fill=fill)
    doc.save(path)


class RulesTest(unittest.TestCase):
    def test_rules(self):
        fix = lambda *v: pct(colourfix.fix_pixels(px(*v), 220, 85))
        self.assertEqual(fix(60, 40, 40, 100), [0, 0, 0, 100])    # rich black → pure K
        self.assertEqual(fix(80, 70, 70, 90), [0, 0, 0, 100])     # K ≥ 85 counts as black
        self.assertEqual(fix(100, 100, 100, 0), [73, 73, 73, 0])  # 300 % colour → 220 %, hue kept
        self.assertEqual(fix(50, 50, 50, 80), [47, 47, 47, 80])   # K kept, CMY scaled by 140/150
        self.assertEqual(fix(0, 0, 0, 0), [0, 0, 0, 0])
        self.assertEqual(fix(0, 0, 0, 100), [0, 0, 0, 100])
        self.assertEqual(fix(30, 20, 10, 40), [30, 20, 10, 40])   # under the limit: untouched
        self.assertEqual(pct(colourfix.fix_pixels(px(50, 50, 0, 84), 90, 85)), [3, 3, 0, 84])  # K near the limit


class FixTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, out):
        doc = pymupdf.open(out)
        page = doc[0]
        (xref, *_), = page.get_images(full=True)
        pix = pymupdf.Pixmap(doc, xref)
        return doc, page, pix

    def test_cmyk_pdf_becomes_one_cmyk_image_at_fix_dpi(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src)
        colourfix.fix_label(src, PARAMS, out)
        doc, page, pix = self.image(out)
        self.assertAlmostEqual(page.rect.width / MM, 106, places=1)
        self.assertAlmostEqual(page.trimbox.width / MM, 100, places=1)
        self.assertAlmostEqual(page.trimbox.x0 / MM, 3, places=1)
        self.assertEqual(pix.n, 4)
        self.assertAlmostEqual(pix.width, 106 / 25.4 * 150, delta=2)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 100])

    def test_grey_goes_into_k(self):
        src, out = self.dir / "g.tif", self.dir / "g_v2.pdf"
        Image.new("L", (626, 626), 64).save(src, dpi=(150, 150))  # 106 mm at 150 dpi
        colourfix.fix_label(src, PARAMS, out)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 75])

    @unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
    def test_rgb_goes_through_the_profile(self):
        src, out = self.dir / "r.jpg", self.dir / "r_v2.pdf"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        colourfix.fix_label(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        c, m, y, k = pix.pixel(10, 10)
        self.assertGreater(m, c)
        self.assertLessEqual((c + m + y + k) / 2.55, 220.5)

    def test_rgb_without_profile_refuses(self):
        src = self.dir / "r.jpg"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        with self.assertRaisesRegex(colourfix.FixError, "RGB needs the labels profile"):
            colourfix.fix_label(src, PARAMS, self.dir / "r_v2.pdf")

    def test_refuses_wrong_size(self):
        src = self.dir / "a4.pdf"
        cmyk_pdf(src, size_mm=210)
        with self.assertRaisesRegex(colourfix.FixError, "210.0×210.0 mm, expected 106×106 mm"):
            colourfix.fix_label(src, PARAMS, self.dir / "x.pdf")
        self.assertFalse((self.dir / "x.pdf").exists())

    def test_uses_the_chosen_page(self):
        src, out = self.dir / "two.pdf", self.dir / "two_v2.pdf"
        doc = pymupdf.open()
        for fill in [(0, 0, 0, 0), (0, 0, 0, 0.5)]:
            page = doc.new_page(width=106 * MM, height=106 * MM)
            page.draw_rect(page.rect, color=None, fill=fill)
        doc.save(src)
        colourfix.fix_label(src, {**PARAMS, "page": 2}, out)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 50])
```

- [ ] **Step 2: Run them and check they fail**

Run: `uv run --project plant python -m unittest discover plant`
Expected: ERROR, `No module named 'colourfix'`.

- [ ] **Step 3: Implement `plant/colourfix.py`**

```python
"""Plant-side colour fix for labels (baked in the oven before pressing:
rich black and heavy ink don't dry). The label's data area becomes one
CMYK image at fixDpi with two rules — black (K ≥ kMinPct) → 0/0/0/100,
total ink over the limit → C, M, Y scaled down, K kept — written as a
PDF. CMYK keeps the file's own numbers, grey goes into K, RGB goes
through the part's output profile (LittleCMS). Spec:
docs/superpowers/specs/2026-10-01-label-colour-fix-design.md."""
import numpy
import pymupdf
from PIL import Image, ImageCms

import artwork

MM_PER_PT = 25.4 / 72


class FixError(Exception):
    """A label this fix can't handle; the message goes to the page."""


def fix_pixels(cmyk, ink_limit, k_min):
    c = cmyk.astype(numpy.float32) * (100 / 255)
    k = c[..., 3]
    cmy = c[..., :3].sum(axis=-1)
    room = numpy.clip(ink_limit - k, 0, None)
    scale = numpy.where((cmy + k > ink_limit) & (cmy > 0), room / numpy.maximum(cmy, 1e-6), 1.0)
    out = c.copy()
    out[..., :3] *= scale[..., None]
    out[k >= k_min] = (0, 0, 0, 100)
    return numpy.round(out * 2.55).clip(0, 255).astype(numpy.uint8)


def _to_cmyk(im, profile_path):
    if im.mode == "CMYK":
        return numpy.asarray(im)
    if im.mode in ("L", "1", "LA"):
        k = 255 - numpy.asarray(im.convert("L"))
        out = numpy.zeros((*k.shape, 4), numpy.uint8)
        out[..., 3] = k
        return out
    if profile_path is None:
        raise FixError("RGB needs the labels profile, which isn't available — see the plant server's output")
    to_cmyk = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), ImageCms.getOpenProfile(str(profile_path)),
                                      "RGB", "CMYK", renderingIntent=ImageCms.Intent.PERCEPTUAL)
    return numpy.asarray(ImageCms.applyTransform(im.convert("RGB"), to_cmyk))


def _raster(path, params, profile_path):
    """(CMYK array, data size in mm). CMYK and grey are read unmanaged."""
    kind, parsed, _ = artwork.structure(path, params["page"])
    dpi = params["fixDpi"]
    if kind == "pdf":
        doc = pymupdf.open(path)
        page = doc[params["page"] - 1]
        clip = (artwork.data_box(doc, page) * page.rotation_matrix).normalize()
        page_mm = artwork.size_mm(clip)
        mode = parsed["colorMode"]
        own = mode in ("CMYK", "Gray")
        space = pymupdf.csCMYK if mode == "CMYK" else pymupdf.csGRAY if mode == "Gray" else pymupdf.csRGB
        with artwork.ICC_LOCK:
            pymupdf.TOOLS.set_icc(not own)
            try:
                pix = page.get_pixmap(dpi=dpi, clip=clip, colorspace=space, alpha=False)
            finally:
                pymupdf.TOOLS.set_icc(True)
        im = Image.frombytes({1: "L", 3: "RGB", 4: "CMYK"}[pix.n], (pix.width, pix.height), pix.samples)
    else:
        im = Image.open(path)
        im.load()
        dpi_in = parsed["declaredDpi"]
        page_mm = ({"w": im.width / dpi_in["x"] * 25.4, "h": im.height / dpi_in["y"] * 25.4}
                   if dpi_in else dict(params["targetMm"]))
        im = im.resize((round(page_mm["w"] / 25.4 * dpi), round(page_mm["h"] / 25.4 * dpi)), Image.LANCZOS)
    return _to_cmyk(im, profile_path), page_mm


def fix_label(path, params, out, profile_path=None):
    target, tol = params["targetMm"], params["toleranceMm"]
    kind, parsed, _ = artwork.structure(path, params["page"])
    size = parsed["pageSizeMm"] or (
        {"w": parsed["imagePx"]["w"] / parsed["declaredDpi"]["x"] * 25.4,
         "h": parsed["imagePx"]["h"] / parsed["declaredDpi"]["y"] * 25.4} if parsed["declaredDpi"] else target)
    if abs(size["w"] - target["w"]) > tol or abs(size["h"] - target["h"]) > tol:
        raise FixError(f"the label is {size['w']:.1f}×{size['h']:.1f} mm, expected "
                       f"{target['w']:g}×{target['h']:g} mm — fix the size first")
    cmyk, page_mm = _raster(path, params, profile_path)
    fixed = fix_pixels(cmyk, params["inkLimitPct"], params["black"]["kMinPct"])
    w, h = page_mm["w"] / MM_PER_PT, page_mm["h"] / MM_PER_PT
    trim = params["trimMm"]
    tx, ty = (page_mm["w"] - trim["w"]) / 2 / MM_PER_PT, (page_mm["h"] - trim["h"]) / 2 / MM_PER_PT
    doc = pymupdf.open()
    page = doc.new_page(width=w, height=h)
    pix = pymupdf.Pixmap(pymupdf.csCMYK, fixed.shape[1], fixed.shape[0], fixed.tobytes(), 0)
    page.insert_image(page.rect, pixmap=pix)
    page.set_bleedbox(page.rect)
    page.set_trimbox(pymupdf.Rect(tx, ty, tx + trim["w"] / MM_PER_PT, ty + trim["h"] / MM_PER_PT))
    part = out.with_name(f".{out.name}.part")
    doc.save(part, deflate=True)
    part.rename(out)
```

Notes for the implementer:
- `artwork.size_mm` and `artwork.ICC_LOCK` exist (`plant/artwork.py`). Check `size_mm`'s name with `grep -n "def size_mm" plant/artwork.py`.
- If `page.insert_image(pixmap=…)` stores a CMYK pixmap as RGB in the installed PyMuPDF, write it as a CMYK TIFF in memory with Pillow (`Image.fromarray(fixed, "CMYK").save(buf, "TIFF", compression="tiff_lzw")`) and pass `stream=buf.getvalue()`. The tests (`pix.n == 4`) catch it.
- Record which way was used in the commit message.

- [ ] **Step 4: Run the tests and check they pass**

Run: `uv run --project plant python -m unittest discover plant`
Expected: OK; on Macs the RGB test runs too.

- [ ] **Step 5: Commit**

```bash
git add plant/colourfix.py plant/test_colourfix.py
git commit -m "plant colourfix: label data area as one CMYK image at fixDpi, black → pure K, ink capped with K kept; grey → K, RGB via profile"
```

---

### Task 4: Fix endpoint — `POST /api/fix/label`

**Files:**
- Modify: `plant/server.py`
- Test: `plant/test_server.py`

**Interfaces:**
- Consumes: `colourfix.fix_label`, `colourfix.FixError`, `icc.ensure`, `icc.ProfileError`, `jobs.find`, `jobs.plain`, `jobs.Conflict`, `jobs.JobError`.
- Produces: `POST /api/fix/label` `{job, file, newName, params}` → `{name: newName}`.
  - `params` = the slot's check params plus `fixDpi` and `profile` (a spec or `null`).
  - Errors: 409 when `newName` exists; 400 with the `FixError` message.

- [ ] **Step 1: Write the failing test** (append inside `HttpTest`)

```python
    def test_fix_label_writes_the_next_version_once(self):
        import pymupdf
        folder = self.root / "20_DONE" / "X_band_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        doc = pymupdf.open()
        page = doc.new_page(width=106 * 72 / 25.4, height=106 * 72 / 25.4)
        page.draw_rect(page.rect, color=None, fill=(0.6, 0.4, 0.4, 1))
        doc.save(folder / "X_labels_A_v1.pdf")
        body = {"job": "X_band_261001-1432", "file": "X_labels_A_v1.pdf", "newName": "X_labels_A_v2.pdf",
                "params": {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100},
                           "toleranceMm": 0.5, "inkLimitPct": 220, "black": {"kMinPct": 85}, "fixDpi": 100, "profile": None}}
        self.assertEqual(self.post("/api/fix/label", body), (200, {"name": "X_labels_A_v2.pdf"}))
        self.assertTrue((folder / "X_labels_A_v2.pdf").is_file())
        self.assertEqual(self.post("/api/fix/label", body)[0], 409)
        self.assertEqual(self.post("/api/fix/label", {**body, "newName": "../x.pdf"})[0], 400)
        wrong = {**body, "newName": "X_labels_A_v3.pdf", "params": {**body["params"], "targetMm": {"w": 98, "h": 98}}}
        status, text = self.post("/api/fix/label", wrong)
        self.assertEqual(status, 400)
        self.assertIn("fix the size first", text)
```

- [ ] **Step 2: Run it and check it fails**

Run: `uv run --project plant python -m unittest discover plant`
Expected: FAIL, 404 for `/api/fix/label`.

- [ ] **Step 3: Implement** in `plant/server.py`:
- Add `"/api/fix/label": self.fix_label,` to the `do_POST` dict.
- Add the handler:

```python
    def fix_label(self):
        """A label's colour fix as the slot's next version (the page names
        it); the in-use file is never touched (colourfix.py)."""
        import colourfix
        import icc
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        source, target = folder / jobs.plain(r["file"]), folder / jobs.plain(r["newName"])
        if not source.is_file():
            raise JobError(f"no file {r['file']}")
        if target.exists():
            raise Conflict(f"{r['newName']} exists already")
        params, profile = r["params"], None
        if params.get("profile"):
            try:
                profile = icc.ensure(params["profile"])
            except icc.ProfileError:
                profile = None  # only RGB needs it; colourfix says so
        try:
            colourfix.fix_label(source, params, target, profile)
        except colourfix.FixError as error:
            raise JobError(str(error)) from None
        self.json({"name": r["newName"]})
```

- [ ] **Step 4: Run the tests**

Run: `uv run --project plant python -m unittest discover plant`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add plant/server.py plant/test_server.py
git commit -m "plant server: /api/fix/label writes a label's colour fix as the next version, never over a file"
```

---

### Task 5: Previews — 1600 px plus raw CMYK for the readout

**Files:**
- Modify: `plant/artwork.py` (`PREVIEW_PX`, `facts()`)
- Modify: `plant/checks.py` (`CHECKS_VERSION`)
- Test: `plant/test_artwork.py`

**Interfaces:**
- Produces: artwork facts gain:
  - `"cmyk": "<base>.cmyk"`: raw C, M, Y, K bytes, row by row, at preview size, with the same numbers the Ink row measures (unmanaged for CMYK/grey, MuPDF-managed for RGB);
  - `"previewPx": {"w", "h"}`.

  The preview PNG is now up to 1600 px on its long side.

- [ ] **Step 1: Write the failing test** (append to `MeasureTest` in `plant/test_artwork.py`)

```python
    def test_preview_is_retina_sized_with_raw_cmyk(self):
        path = self.dir / "p.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0.6, 0.4, 0.4, 1))])
        f = self.facts(path)
        self.assertEqual(f["previewPx"]["w"], 1600)
        data = (self.dir / f["cmyk"]).read_bytes()
        self.assertEqual(len(data), f["previewPx"]["w"] * f["previewPx"]["h"] * 4)
        self.assertEqual([round(v / 2.55) for v in data[:4]], [60, 40, 40, 100])
```

Before writing it, check how `self.facts` stores output (`grep -n "def facts" plant/test_artwork.py`). The `cmyk` file lies in the `out_dir` the helper passes. Use that directory in place of `self.dir` if it differs.

- [ ] **Step 2: Run it and check it fails**

Run: `uv run --project plant python -m unittest discover plant`
Expected: ERROR, `KeyError: 'previewPx'`.

- [ ] **Step 3: Implement** in `plant/artwork.py`:
- `PREVIEW_PX = 1600      # long side of the preview: sharp on Retina at the ≤ 800 CSS px it's shown`
- In `facts()`, replace the preview lines with:

```python
    preview, overlay, raw = base + ".png", base + ".overlay.png", base + ".cmyk"
    preview_dpi = PREVIEW_PX / max(page_mm["w"], page_mm["h"]) * 25.4
    shown = render(doc_page, clip, page_mm, preview_dpi, pymupdf.csRGB)
    shown.save(out_dir / preview)
    # The readout's numbers: the same CMYK the Ink row measures.
    numbers = render(doc_page, clip, page_mm, preview_dpi, pymupdf.csCMYK,
                     managed=parsed["colorMode"] not in ("CMYK", "Gray"))
    (out_dir / raw).write_bytes(numbers.samples)
```

- Add `"cmyk": raw, "previewPx": {"w": numbers.width, "h": numbers.height},` to the returned dict.

In `plant/checks.py`: `CHECKS_VERSION = 4  # …; 4: 1600 px previews with raw CMYK`. Keep the earlier notes.

- [ ] **Step 4: Run the tests**

Run: `uv run --project plant python -m unittest discover plant`
Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add plant/artwork.py plant/checks.py plant/test_artwork.py
git commit -m "plant previews: 1600 px for Retina, raw CMYK at preview size for the readout"
```

---

### Task 6: Page logic and rendering — fix button, comparison, readout data

**Files:**
- Modify: `src/lib/artwork-checks.js`
- Modify: `src/lib/plant-overview.js` (`artFileHtml`, `renderArtwork`)
- Test: `tests/artwork-checks.test.js`, `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `artworkRows(facts, params, printCheck)`, `jobFiles().slots` (`{name, index, others: [{name, newer}]}`).
- Produces:
  - `fixable(facts, params, printCheck) -> boolean`: a label (`params.part === "labels"`) whose Ink or Black row is `warn`.
  - `newerToCompare(slots, checkable) -> [{title, name, params, of}]`: per checkable slot, its newest version newer than the one in use, with the same params.
  - `renderArtwork(files, checkable, facts, printCheck, base, gaps, compare = [])`. A fixable in-use label gets `<button type="button" class="fix" data-slot="<index>">fix colours</button>`. Each compared version is drawn next to its in-use file inside `<div class="compare">`. Every `.art` div carries `data-cmyk="<url>" data-w="<w>" data-h="<h>"` when the facts have `cmyk`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/artwork-checks.test.js` (`FACTS`/`PARAMS`/`PRINT_CHECK` fixtures: read the top of the file and reuse them; the snippet builds its own minimal ones):

```js
import { fixable, newerToCompare } from "../src/lib/artwork-checks.js";

test("fixable: a label whose ink or black warns; never other parts", () => {
  const printCheck = {
    inkLimitPct: {labels: 220}, black: {kMinPct: 85, cmyMaxPct: 30}, sizeToleranceMm: 0.5, dpi: {min: 300, max: 1200},
    checks: {ink: {severity: "warn"}, black: {severity: "warn"}, bleed: {severity: "warn"}}
  };
  const facts = ink => ({kind: "pdf", parsed: null, ink: {maxPct: ink, overPct: ink > 220 ? 5 : 0},
    black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}});
  const params = part => ({part, inkLimitPct: 220, bleedMm: 3});
  assert.equal(fixable(facts(330), params("labels"), printCheck), true);
  assert.equal(fixable(facts(200), params("labels"), printCheck), false);
  assert.equal(fixable(facts(330), params("outerCover"), printCheck), false);
  assert.equal(fixable({error: "x"}, params("labels"), printCheck), false);
});

test("newerToCompare: the newest newer version of each checked slot, same params", () => {
  const slots = [{name: "X_labels_A_v1.pdf", others: [{name: "X_labels_A_v3.pdf", newer: true},
    {name: "X_labels_A_v2.pdf", newer: true}]}, {name: "X_cover_v2.pdf", others: [{name: "X_cover_v1.pdf", newer: false}]}];
  const checkable = [{title: "Label A", name: "X_labels_A_v1.pdf", params: {part: "labels"}},
    {title: "Cover", name: "X_cover_v2.pdf", params: {part: "outerCover"}}];
  assert.deepEqual(newerToCompare(slots, checkable),
    [{title: "Label A — X_labels_A_v3.pdf", name: "X_labels_A_v3.pdf", params: {part: "labels"}, of: "X_labels_A_v1.pdf"}]);
});
```

(If `fixable` hits a null `parsed` in `buildChecklistRows`, give the fixture the `parsed` object from `tests/plant-overview.test.js`'s artwork test.)

Append to `tests/plant-overview.test.js`:

```js
test("artwork: fix button on a warning label, comparison side by side, readout data", () => {
  const params = {part: "labels", targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, round: true,
    page: 1, inkLimitPct: 220, holeMm: 7.4, black: {kMinPct: 85, cmyMaxPct: 30}, toleranceMm: 0.5};
  const checkable = [{title: "Label A", name: "lab_a_v1.pdf", params}];
  const one = (ink, name) => ({kind: "pdf", parsed: {pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: null}, pageMm: {w: 106, h: 106}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: ink, overPct: ink > 220 ? 10 : 0}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: `${name}.png`, overlay: `${name}.overlay.png`, cmyk: `${name}.cmyk`, previewPx: {w: 1600, h: 1600}});
  const facts = {"lab_a_v1.pdf": one(330, "a1"), "lab_a_v2.pdf": one(220, "a2")};
  const compare = [{title: "Label A — lab_a_v2.pdf", name: "lab_a_v2.pdf", params, of: "lab_a_v1.pdf"}];
  const html = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", [], compare);
  assert.ok(html.includes('<button type="button" class="fix" data-slot="2">fix colours</button>'));
  assert.ok(html.includes('<div class="compare"><div class="art-file"><h3>Label A</h3>'));
  assert.ok(html.includes("<h3>Label A — lab_a_v2.pdf</h3>"));
  assert.ok(html.includes('data-cmyk="/jobs/j1/a1.cmyk" data-w="1600" data-h="1600"'));
});
```

(`files` in this test file comes from `jobFiles`, and its label slot index is 2: see the existing artwork test's `data-slot="2"`.)

- [ ] **Step 2: Run them and check they fail**

Run: `node --test tests/`
Expected: FAIL, missing exports.

- [ ] **Step 3: Implement**

In `src/lib/artwork-checks.js`, append:

```js
// A label the plant's colour fix can help: its ink or black row warns.
export function fixable(facts, params, printCheck){
  if(params.part !== "labels" || !facts || facts.error || !facts.ink) return false;
  return artworkRows(facts, params, printCheck).some(r => (r.feature === "Ink" || r.feature === "Black") && r.severity === "warn");
}

// Per checked slot, its newest version newer than the one in use — a
// colour fix or a hand-saved fix — to show and check next to it.
export function newerToCompare(slots, checkable){
  return checkable.flatMap(c => {
    const slot = slots.find(s => s.name === c.name);
    const newer = slot ? slot.others.filter(o => o.newer) : [];
    return newer.length ? [{title: `${c.title} — ${newer[0].name}`, name: newer[0].name, params: c.params, of: c.name}] : [];
  });
}
```

(`others` is already sorted newest first; see `jobFiles` in `src/lib/versions.js`.)

In `src/lib/plant-overview.js`:
- Import `fixable` from `./artwork-checks.js`, next to the existing imports.
- `artFileHtml` takes a fourth argument, `slotIndex` (null for compared versions). After the `<h3>`, if `slotIndex !== null && fixable(facts, params, printCheck)`, append:

  ```js
  `<button type="button" class="fix" data-slot="${slotIndex}">fix colours</button>`
  ```
- The `.art` div gets the readout data when `facts.cmyk`:

  ```js
  + `<div class="art" style="aspect-ratio:${facts.pageMm.w} / ${facts.pageMm.h}"`
  + (facts.cmyk ? ` data-cmyk="${url(facts.cmyk)}" data-w="${facts.previewPx.w}" data-h="${facts.previewPx.h}"` : "") + `>`
  ```
- `renderArtwork(files, checkable, facts, printCheck, base, gaps, compare = [])`. Replace the final file-block line with:

  ```js
  if(facts) body += checkable.map(c => {
    const slot = files.slots.find(s => s.name === c.name);
    const own = artFileHtml(c, facts[c.name] || {error: "not checked"}, printCheck, base, slot ? slot.index : null);
    const newer = compare.find(v => v.of === c.name);
    return newer ? `<div class="compare">${own}${artFileHtml(newer, facts[newer.name] || {error: "not checked"}, printCheck, base, null)}</div>` : own;
  }).join("");
  ```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/`
Expected: all pass, including the existing artwork tests (the default `compare = []` keeps them as they are).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artwork-checks.js src/lib/plant-overview.js tests/artwork-checks.test.js tests/plant-overview.test.js
git commit -m "plant view: fix colours on warning labels, newer version side by side, preview readout data"
```

---

### Task 7: Plant page wiring, readout, docs

**Files:**
- Modify: `src/plant/app.js`
- Modify: `src/plant/index.html` (tooltip element)
- Modify: `src/plant/structure.css`
- Modify: `CLAUDE.md`, `plant/CLAUDE.md`

**Interfaces:**
- Consumes: `fixable`, `newerToCompare` (Task 6); `nextVersionName`, `versionOf` (`src/lib/versions.js`); `/api/profiles` (Task 2); `/api/fix/label` (Task 4); `CONFIG.printProfiles`, `printCheck.fixDpi` (Task 1).

- [ ] **Step 1: Profiles on load.** At the end of `src/plant/app.js`'s start-up code (next to the first `route()` call), add:

```js
// The output profiles a colour fix may need; the server fetches missing ones.
postJson("/api/profiles", {profiles: CONFIG.printProfiles}).catch(() => {});
```

- [ ] **Step 2: Check and draw the newer versions too.** In `showJob`:
  - After `const checkable = …`, add `const compare = newerToCompare(files.slots, checkable);`.
  - Add the compared files to the artwork check:
    ```js
    artwork: Object.fromEntries([...checkable, ...compare].map(s => [s.name, s.params]))
    ```
  - Pass `compare` as the new last argument of both `renderArtwork(...)` calls.
  - Keep `checkable` on `view` (`view = {..., checkable}`) for the fix handler.
  - Import `newerToCompare` from `../lib/artwork-checks.js`, and `nextVersionName`, `versionOf` from `../lib/versions.js`.

- [ ] **Step 3: The fix button.** Extend the button handler's selector to `".use, #move, #rescan, .merge, #accept, .fix"`, and add a branch before `.merge`:

```js
    } else if(button.matches(".fix")){
      const slot = view.slots[Number(button.dataset.slot)];
      const check = view.checkable.find(c => c.name === slot.name);
      const format = getFormat(CONFIG, prepareProject(view.raw, CONFIG).format);
      const newName = nextVersionName(versionOf(slot.name).base, ".pdf", view.names);
      busy(`fixing colours of ${slot.name}`);
      await postJson("/api/fix/label", {job: view.job, file: slot.name, newName,
        params: {...check.params, fixDpi: format.printCheck.fixDpi, profile: CONFIG.printProfiles.labels || null}});
```

The branch then falls through to the existing `await route();`. The new version is listed, checked and shown side by side.

- [ ] **Step 4: The CMYK readout.** In `src/plant/index.html`, add `<div id="tip" hidden></div>` before the closing `</body>`. In `src/plant/structure.css`:

```css
/* CMYK readout over artwork previews. */
#tip{ position:fixed; pointer-events:none; background:#161616; color:#fff; padding:2px 6px;
      font:12px ui-monospace, monospace; white-space:pre; z-index:10; }
.compare{ display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start; }
.compare > .art-file{ flex:1 1 360px; }
```

In `src/plant/app.js`:

```js
// CMYK readout: the preview's own numbers under the pointer (artwork.py
// writes them next to the preview; fetched once per preview).
const tip = document.getElementById("tip");
const cmykData = new Map();
out.addEventListener("mousemove", e => {
  const art = e.target.closest(".art[data-cmyk]");
  if(!art){ tip.hidden = true; return; }
  const url = art.dataset.cmyk;
  if(!cmykData.has(url)){
    cmykData.set(url, null);
    fetch(url).then(r => r.arrayBuffer()).then(b => cmykData.set(url, new Uint8Array(b)));
  }
  const data = cmykData.get(url);
  if(!data) return;
  const box = art.getBoundingClientRect();
  const w = Number(art.dataset.w), h = Number(art.dataset.h);
  const x = Math.min(w - 1, Math.floor((e.clientX - box.left) / box.width * w));
  const y = Math.min(h - 1, Math.floor((e.clientY - box.top) / box.height * h));
  const v = [0, 1, 2, 3].map(i => Math.round(data[(y * w + x) * 4 + i] / 2.55));
  tip.textContent = `C ${v[0]}  M ${v[1]}  Y ${v[2]}  K ${v[3]}   total ${v[0] + v[1] + v[2] + v[3]} %`;
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
  tip.hidden = false;
});
```

- [ ] **Step 5: Docs.**
  - `plant/CLAUDE.md`, append:

    ```
    - `colourfix.py` — labels only (oven before pressing): the data area as
      one CMYK image at `printCheck.fixDpi`, K ≥ `black.kMinPct` → pure K,
      ink over `inkLimitPct.labels` → C, M, Y scaled with K kept; CMYK read
      as its own numbers, grey into K, RGB through `CONFIG.printProfiles`
      (`icc.py` downloads them into the gitignored `plant/icc/`). Written as
      the slot's next `_v<N>.pdf`; "use" decides. Spec:
      `docs/superpowers/specs/2026-10-01-label-colour-fix-design.md`.
    ```
  - `CLAUDE.md`, in the Architecture plant bullet after "Each fact is shown once.", add: "Artwork previews carry their raw CMYK, shown under the pointer; a warning label offers a colour fix, shown next to the version in use."

- [ ] **Step 6: Run everything**

Run: `node --test tests/ && uv run --project plant python -m unittest discover plant && node build/build.js && node --check src/plant/app.js`
Expected: all pass, and the build prints `built …`.

- [ ] **Step 7: Manual check** (the user, in the plant view):
1. Start the plant view and open a job with a rich-black label. `plant/icc/ISOcoated_v2_eci.icc` appears within a minute.
2. The label row shows "fix colours". Click it: a `_v2.pdf` is listed, checked, and shown next to the in-use file with max ink ≤ 220 % and rich black 0 %.
3. Moving over either preview shows CMYK values.
4. "use" switches the slot.

- [ ] **Step 8: Commit**

```bash
git add src/plant/app.js src/plant/index.html src/plant/structure.css CLAUDE.md plant/CLAUDE.md
git commit -m "plant view: colour fix button, fix compared with the label in use, CMYK readout under the pointer"
```
