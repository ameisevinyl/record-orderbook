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
