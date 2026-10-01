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
- `colourfix.py` — labels only (oven before pressing): the data area as
  one CMYK image at `printCheck.fixDpi.labels`, K ≥ `black.kMinPct` → pure K,
  ink over `inkLimitPct.labels` → C, M, Y scaled with K kept; CMYK read
  as its own numbers, grey into K, RGB through `CONFIG.printProfiles`
  (`icc.py` downloads them into the gitignored `plant/icc/`). Written as
  the slot's next `_v<N>.pdf`; "use" decides. Spec:
  `docs/superpowers/specs/2026-10-01-label-colour-fix-design.md`.
