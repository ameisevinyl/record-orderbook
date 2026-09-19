# CLAUDE.md

Project brief for Claude Code. Read this before making changes.

## What this is

Browser-based, self-contained production tooling for a music record
pressing plant. So called "vinyl". Each tool covers one artifact of a release: the tracklist and playing time for each side, choosing tracks and assembling each side for the mastering studio. printed parts of the production: Labels, innersleeves (printed or plain), covers (usually printed), inlays, billing address and shipping address (can be multiple destinations), vinyl colours (default: black).
All sharing the same release record (catalogue number, format, title, artist).

The end users are customers who want to submit their production info and files for ordering and quoting to the pressing plant (not made for one individual plant can be reused by others). 

the page let's the user download a json file with all the chosen infos. and they can load projects back in the forms from that json file.

The maintainer is a programmer, preferring minimalistic, simple, low-level style. Use modern solution when these are simple and widely accepted. Comments are short and assume everybody can read the code. don't repeat yourself. be short and precise. 

## Hard constraints — do not relax these without asking

- **No runtime dependencies.** No CDN scripts, no npm packages shipped to
  the browser. If something needs a capability (ZIP writing, WAV/AIFF
  header parsing, graphic file format checks (PDF or TIFF) etc.), implement it directly — see `src/lib/zip.js` and
  `src/lib/audio-duration.js` for the existing style.
- **`dist/index.html` must remain a single, self-contained file.** No
  external requests at runtime (fonts, scripts, images). It has to work
  offline and keep working with no maintenance.
- **Dev tooling may use Node, but zero npm installs.** Tests run on
  `node --test` (built into Node ≥18). The build script is plain Node
  `fs` string-concatenation — no bundler, no transpiler.
- **KISS.** Prefer the boring, obvious solution. No premature abstraction.
  Don't introduce a framework, state library, or build tool to solve a
  problem that a plain function solves.

## Commands

```
node --test tests/            # run all unit tests
node build/build.js           # build dist/index.html from src/
```

Run tests before considering any change done. There is no linter/formatter
configured on purpose — keep it that way unless asked.

## Architecture

- `src/index.html` — page shell, loads `src/app.js` as an ES module.
- `src/app.js` — DOM wiring / UI logic for the current module in view.
- `src/lib/*.js` — pure, DOM-free functions: time parsing/formatting, the
  ZIP writer, WAV/AIFF duration parsing, playing-time threshold logic.
  Anything here should be unit-testable without a browser.
- `src/modules/*.js` — one file per artifact type (tracklist, labels,
  cover-sleeve, shipping-billing once built). Each module owns its own
  DOM template and reads/writes fields on the shared release object; it
  should not reach into another module's DOM.
- `tests/*.test.js` — mirrors `src/lib/`. New pure logic needs a test.
- `build/build.js` — concatenates `src/lib` + `src/modules` + `src/app.js`
  into `src/index.html`'s `<script type="module">`, inlines CSS, and
  writes the result to `dist/index.html`. No external tools.

## Domain glossary (so you don't have to ask)

- **Catalogue number** — the release's unique order ID; required on every
  artifact type. Example: PNKRCK007
- **Side A / Side B** — vinyl has two playable sides; B may be blank.
  Tracks are numbered A1, A2… / B1, B2… in play order. 
- **RPM** — 33⅓ or 45. Default by format: 7"→45, 10"→33, 12"→33.
- **Format** — 7" single, 10" EP, 12" LP — physical disc diameter.
- **Soundsystem cut** — a hotter, louder cutting style (club/soundsystem
  pressings); shortens the recommended max playing time per side.
- **Lacquer / cutting** — the mastering engineer cuts a lacquer disc from
  the audio; playing time and groove pitch trade off against each other,
  hence the per-side time warnings in the tracklist tool.
- **Gap / mark** — the pause inserted before a track during cutting: none,
  2s, or a custom value. Distinct from the always-present locating groove
  marker.
- **Whitelabel** — a test/promo pressing with a blank or minimal label,
  as opposed to the final printed label.
- **Studio email** (`CONFIG.studioEmail`) — where finished packages get
  sent (e.g. via SwissTransfer) for the cutting engineer to pick up.
- see also: https://www.sst-ffm.de/en/frequently-given-answers for record mastering insights
- see also https://www.randmuzik.de/en/specifications/ for record specific printed parts

## Conventions

- Plain, modern JS (ES2020+ features are fine — target is current
  evergreen browsers, not legacy IE-era compatibility).
- plant specific values (playing-time thresholds, default RPM, studio
  email, printing specs) live in a single `CONFIG` object — never hardcode them elsewhere.
- Comments explain *why*, not *what*, especially around anything
  reverse-engineered from a file format spec (WAV/AIFF chunks, ZIP
  headers) — cite the chunk/field being read.
- Commit messages: short, imperative, no ceremony, scientific, precise, DRY
