# Audio checks (deep checks, piece 1) — design

Status: approved in conversation, pending written-spec review.

## Context

The plant view shows what a project zip supplies and whether it is
complete (`2026-09-24-plant-view-design.md`). Deep checks on the files
on disk come in five pieces: 1 audio, 2 artwork checks, 3 print output,
4 previews, 5 helpers. This is piece 1.

Piece 1 relies only on the supplied audio files: read what's in them,
cross-check them against the form's tracklist, and give staff a
prelisten with a clickable waveform. The facts collected here later feed
a mastering engineer view.

Out of scope, later nice-to-haves: parsing the customer's tracklist file
(HOFA PDFs, studio text sheets; samples in `tests/fixtures/`), gap and
silence detection, loudness/RMS, cutting simulation.

## Architecture

Python reads facts, JS applies the rules — the same split as
completeness (`src/lib/completeness.js`), so no rule exists twice.
Python stays standard library only; the one external tool is ffmpeg
(`ffprobe` + `ffmpeg`, via `subprocess`).

- **`plant/checks.py`** — `run(project_dir, out_dir)` → facts dict, also
  written to `out_dir/facts.json`. CLI:
  `python3 plant/checks.py plant/work/<stem>`.
- **`plant/server.py`**
  - `POST /api/check`, header `X-Filename` (same as `/api/open`): runs
    the checks on `plant/work/<stem>/` and returns the facts JSON.
  - Generated files go to `plant/work/<stem>.checks/` — beside the
    unpacked zip, never inside it, so they can't appear in
    `/api/open`'s file list or a re-saved zip. `unpack` removes it with
    the work folder.
  - `GET /work/<stem>.checks/<file>` serves previews (`.mp3`, `.png`),
    behind the same resolve + `is_relative_to` guard as `src/`.
- **`src/lib/audio-checks.js`** — pure `audioFindings(project, facts,
  config)` → `[{group, text}]`, the shape `projectGaps` returns.
- **`src/lib/plant-overview.js`** — `renderAudio(project, facts, findings)`:
  facts table, findings and waveform per side.
- **`src/plant/app.js`** — after the overview renders, calls
  `/api/check` ("checking audio…"), appends the audio section, drives
  the player.

## Facts

From `ffprobe -show_format -show_streams -show_chapters -of json`
(verified on ffmpeg 9.0.2):

| fact | source |
|---|---|
| container, codec | `format_name`, `codec_name` |
| sample rate, bit depth, channels, duration | stream `sample_rate`, `bits_per_sample`, `channels`, format `duration` |
| software | tags `encoder` (WAV INFO `ISFT`), `encoded_by` (BWF `bext` originator), `coding_history` (BWF) |
| title, artist, comment | tags |
| markers, WAV | chapters (`cue ` offsets + `LIST/adtl/labl` titles) |
| markers, AIFF | own reader: `MARK` chunk (marker id, position in sample frames, pstring name) — ffprobe ignores it |

Per file (name relative to the `project.json` folder):

```
{ container, codec, sampleRate, bitsPerSample, channels, duration,
  software: [..], title, artist, comment,
  markers: [{seconds, label}],
  spec: {encoding, encodingSupported, bitsPerSample, sampleRate},
  preview: "<n>.mp3", waveform: "<n>.png", error }
```

`spec` has the shape `audioSpecWarning` (`src/lib/audio-duration.js`)
already takes, so the customer tool's rule is reused. Every audio file
in the folder is probed, not only referenced ones. A file ffprobe
can't read gets `error`; the run goes on. Without ffmpeg on the PATH
the whole result is `{error: "needs ffmpeg"}` and the page says so.

## Rules (`audioFindings`)

- audio file in the zip that the project doesn't reference
- file unreadable
- format / below spec: `compressionWarningForName`, `audioSpecWarning`
- duration differs from the form length by more than 1 s — the track's
  `length`, or `continuousLength` on a continuous side. The browser
  fills the length from the file, so usually a browser-vs-disk sanity
  check; a typed length makes it a real one.
- continuous side: marker count ≠ track count; no markers → a note
  "no markers in side file"
- mixed sample rate or bit depth within a side

## Prelisten

- Server makes per file a 128 kbps stereo MP3 and a waveform PNG
  (`showwavespic`, 1600×120, mono, `--ink-dim` colour).
- Page: the PNG at full width; a translucent overlay marks the played
  part; markers from the file and — on a continuous side — the form's
  track boundaries (cumulative lengths + gaps) as thin lines in percent.
- Click seeks (`x / width × duration`) and plays; clicking the playing
  waveform pauses. One shared `<audio>` element. The MP3 is fetched as
  a blob on first play, so seeking works without HTTP Range support.
- Plain, dense, no hover effects — like the rest of the plant view.

## Tests

- `plant/test_checks.py` — AIFF `MARK` reader (pad bytes, pstrings);
  ffprobe mapping on synthetic WAV/AIFF with INFO/`bext`/`cue `
  (skipped without ffprobe); preview files written to `out_dir`.
- `plant/test_server.py` — `.checks` removed on unpack, served with
  the traversal guard, `/api/check` round trip.
- `tests/audio-checks.test.js` — each rule with hand-made facts.
