# Label colour fix — design

Status: approved in conversation 2026-10-01 (after a spike on 8 real labels), pending
written-spec review. Deep checks piece 3, restarted from scratch; the earlier quickfix
attempt (profile building with ArgyllCMS, PDF/X-1a, auto bleed) was deleted.

## Context

Labels are baked in the oven before pressing. Rich black and too much ink don't dry and
spoil the pressing. Today staff fix such files by hand in Photoshop:
- **Black and white:** all channels go into K, then levels until the darkest point is 100% K.
- **Colour:** selective colour on the blacks, CMY down to 0–10%, K to 100%.

This feature does the same, exactly and repeatably, as a suggestion staff accept with the
existing "use" button.

The spike ran these rules on 8 real labels: CMYK at 252–344% ink, RGB PDFs/JPEGs, a CMYK
JPEG with 35% rich black, and a clean pure-K label. Every result came out at max ink
220%, 0% rich black, the clean label untouched, and colours judged fine by the user.

## Decisions

- **Scope:** labels only. Covers, sleeves and the inlay are offset-printed and don't go
  through the oven.
- **Raster:** a fixed label is one CMYK raster at `printCheck.fixDpi` (1200), in a PDF.
- **Rules:**
  - every pixel with K ≥ `black.kMinPct` (85) becomes 0/0/0/100;
  - every other pixel whose total ink exceeds `inkLimitPct.labels` (220) gets C, M and Y
    scaled by `(limit − K) / (C+M+Y)`, with K kept. K above the limit stays as it is; only
    C, M and Y are reduced, to 0 at most.
- **Input colour:**
  - CMYK is read as the file's own numbers (no colour management, as the checks do);
  - greyscale goes into K only (K = 100% − grey);
  - RGB is converted with LittleCMS (Pillow `ImageCms`, perceptual intent) into the part's
    CMYK profile from `CONFIG.printProfiles`, then the rules apply.
- **No ArgyllCMS, no PDF/X, no bleed generation.**
- **Never overwrite:** the fix is written as the label slot's next version, and the
  original stays. Nothing is applied without "use".

## Config (`src/config.js`)

- Per format: `printCheck.fixDpi: 1200`.
- Top level:

  ```js
  printProfiles: {
    // Output profile per printed part, for converting RGB artwork.
    // Downloaded by the plant server into plant/icc/ when missing;
    // never committed.
    labels: { name: "ISO Coated v2 (ECI)", url: "https://eci.org/_media/downloads/icc_profiles_from_eci/eci_offset_2009.zip",
              file: "ISOcoated_v2_eci.icc" }
  }
  ```

  `file` is the profile inside the zip, or the file name for a direct `.icc` URL. Verify
  the exact name in the ECI zip when implementing.
- `src/lib/config-validation.js` checks `fixDpi` (a positive integer) and each profile
  entry (`name`, `url` with `https://`, `file` ending `.icc`, no `/`).

## Plant server

- **`plant/icc/`** is gitignored and holds the profiles.
- **`POST /api/profiles`** `{profiles: {part: {name, url, file}}}` is sent by the page once
  on load. For each missing `plant/icc/<file>`, the server downloads it in the background:
  - it takes the `.icc` straight, or extracts `file` from a `.zip`;
  - it writes to a temp file and renames, so a profile is never half-written;
  - a failure is logged and retried on the next request.
- **`POST /api/fix/label`** `{job, file, newName, params}`, where `params` holds trim,
  target, page, `inkLimitPct`, `kMinPct`, `fixDpi` and `profile`:
  - It refuses (`JobError`) when the label's size is off: the data area must match `targetMm`
    within `toleranceMm`, the same rule as the Size check (e.g. a label on an A4 page).
  - It refuses RGB input when the profile is missing and can't be downloaded, naming the
    profile. CMYK and greyscale input don't need one.
  - It writes `newName`. The page names it with `nextVersionName`, always `.pdf`. An
    existing name is a `Conflict`.
  - It returns `{name}`. The job's stamp changes, so the open page reloads and lists the
    new version.

## `plant/colourfix.py`

- `fix_pixels(cmyk_uint8, ink_limit, k_min)`: the two rules on a numpy array. Pure and
  tested with exact values.
- `label_raster(path, params, profile_path)`: the data area at `fixDpi`, using
  `artwork.data_box` and the rotation as the checks do, then CMYK, grey→K, or RGB→profile.
- `write_pdf(cmyk, page_mm, trim_mm, out)`: a PyMuPDF page of the data size with one
  lossless (Flate) CMYK image, BleedBox = page, TrimBox = the trim centred. Written to a
  temp file, then renamed.

## Previews and CMYK readout (all artwork, not only fixes)

- **Sharper previews:** `PREVIEW_PX` goes from 800 to 1600, so previews are sharp on Retina
  at the displayed size of up to 800 CSS px.
- **CMYK data:** each checked file also writes `<preview base>.cmyk`: raw CMYK bytes at
  preview size: the same CMYK numbers the Ink check measures (CMYK/grey as the file's own,
  RGB as MuPDF separates it), so readout and checks never disagree.
- **Cache:** bump `CHECKS_VERSION`.
- **Readout:** in the plant view, moving over an artwork preview shows `C M Y K` and the
  total at the pointer (`src/plant/app.js`, data fetched once per preview).

## Plant view (Artwork section)

- **Button:** a label slot whose Ink or Black row is `warn` gets **"fix colours"**.
  - It posts the fix, then the page reloads.
  - The new version is listed and checked like any version, so the facts show its numbers.
- **Comparison:** while a label slot has a newer version than the one in use, its row shows
  the in-use file and the newest version side by side: previews plus max ink and rich
  black. "use" switches as today.
- **Pure logic:** which slots get the button, and the comparison data, go in
  `src/lib/artwork-checks.js` / `plant-overview.js`, tested.

## Tests

- `plant/test_colourfix.py`:
  - `fix_pixels` on fixed values (rich black, a plain colour over the limit, high K plus CMY
    over the limit, white, a clean pure K);
  - greyscale → K;
  - an RGB file → CMYK via a test profile (macOS Generic CMYK in tests, skipped where
    absent);
  - the output PDF: size, boxes, one CMYK image at `fixDpi`;
  - the refusals.
- `plant/test_server.py`:
  - `/api/fix/label` writes the version and refuses existing names;
  - `/api/profiles` with a local file URL, downloaded once.
- `tests/config-validation.test.js`: `fixDpi` and `printProfiles`.
- `tests/plant-overview.test.js` / `tests/artwork-checks.test.js`: the button only on
  warning label slots; the side-by-side for a newer version.
- **Manual:** fix a rich-black label in the plant view, compare, and "use" it; hover shows
  real numbers.
