# record-orderbook

Self-contained, offline-capable order/production tools for vinyl record
manufacturing. Runs entirely in the browser — no server, no build step
required to *use* it, no external requests, no runtime dependencies.

Currently included:

- **Tracklist / Cutting Order Generator** — catalogue number, format/RPM,
  side A/B track listing with per-track audio file duration reading
  (native `<audio>` + hand-rolled WAV/AIFF header fallback), playing-time
  warnings, printable order sheet, ZIP package export (audio + JSON +
  summary text), SwissTransfer handoff.

Planned:

- Label / whitelabel specification
- Cover & sleeve specification
- Shipping / billing address block
- A shared "release" record so all of the above draw from one source of
  truth per catalogue number

## Why no framework, no bundler dependency

The people using this (customer service, cutting engineer) need a file
that still works in ten years with zero maintenance: open it, it works.
Every non-trivial piece of logic (ZIP writer, WAV/AIFF parsing) is
hand-rolled rather than pulled from npm, for the same reason.

## Development

```
node --test tests/            # run unit tests (zero dependencies, Node 18+)
node build/build.js           # inline src/ into dist/index.html
python3 -m http.server 8000   # serve src/ for local dev (any static server works)
```

Open `src/index.html` directly in a browser during development (native
ES modules work over `file://` in some browsers, but a local static
server avoids CORS surprises — hence the `http.server` line above).
`dist/index.html` is the single-file artifact you actually hand to
customer service / the cutting engineer / GitHub Pages.

## License

MIT — see [LICENSE](LICENSE).
