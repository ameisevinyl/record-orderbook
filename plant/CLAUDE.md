# plant/ — deep checks on disk

- `checks.py` — piece 1 (audio): ffprobe facts, AIFF `MARK` markers,
  MP3 + waveform PNG per file, written to the job's hidden `.checks/`
  with a per-file cache (size+mtime, else sha256; Rescan: sha256 always;
  bump `CHECKS_VERSION` when fact-reading changes). Preview names carry
  the content hash, so a fix saved over a file never shows a stale image.
  The open job page polls `/api/job/stamp` and reloads on any save in the
  job folder. Rules: `src/lib/audio-checks.js`. Spec:
  `docs/superpowers/specs/2026-09-24-audio-checks-design.md`.
- `spectrum.py` — a spectrogram per audio file for the mastering engineer
  in `<job>/spectrum/`, started in the background by the page after all
  its checks (`/api/spectrum`), not shown in the plant view. Job files
  are top level only, so `spectrum/` stays out of listings and zips.
- `artwork.py` — piece 2 (artwork): PyMuPDF/Pillow/numpy facts,
  ink/black/bleed measurements (CMYK/grey files read as their own
  numbers, colour management off — see `render`; the cut is the part's
  trim size centred in the data area, the file's TrimBox only
  information — exports often set it to the page), preview + overlay
  PNG. Rules: `src/lib/artwork-checks.js`. Spec:
  `docs/superpowers/specs/2026-09-25-artwork-checks-design.md`.
- `colourfix.py` — the colour step, every printed part: the data area
  as one CMYK image at `printCheck.fixDpi[part]`, K ≥ `black.kMinPct` →
  pure K, neutral greys (C, M, Y within `black.neutralTolPct`) → K only
  at the same L* through the part's profile, ink over
  `inkLimitPct[part]` → C, M, Y scaled with K kept; CMYK read as its own
  numbers, grey into K, RGB through `CONFIG.printProfiles[part]`
  (`icc.py` downloads them into the gitignored `plant/icc/`). Written
  PDF/X-1a (`artwork.pdfx`); `assign` only marks a file PDF/X-1a. Specs:
  `docs/superpowers/specs/2026-10-01-label-colour-fix-design.md`,
  `docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md`.
- `geomfix.py` — the size and pdf steps: the fix the page's flow
  (`src/lib/fix-flow.js`) hands it — scale, crop/mirror 1:1, rebuild
  the bleed, or rasterize — the source in its own colours at
  `fixDpi[part]` (rasters resampled with Lanczos), kept region as is,
  the rest mirrored (`numpy.pad` symmetric; radial for labels), one
  raster PDF 1.3. Spec:
  `docs/superpowers/specs/2026-10-01-artwork-geometry-fix-design.md`.
- Fix flow (`src/lib/fix-flow.js`, spec
  `docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md`): per
  slot size → pdf → colour, one proposal per load (`/api/fix`, the
  slot's next `_v<N>.pdf`), accept = use, dismiss = `/api/trash` into
  the job's `.trash/`; log `plant.fixes`.
- `proof.py` — the customer proof, once a slot's flow is through: the
  finished file (CMYK PDF/X, OutputIntent kept) with trim and centre
  hole drawn on in CMYK, as `<cat>_proof_…` (`proofFileName`) in the
  job folder via `/api/proof`; the customer's viewer converts for the
  screen. Spec: `docs/superpowers/specs/2026-10-02-customer-proof-design.md`.
