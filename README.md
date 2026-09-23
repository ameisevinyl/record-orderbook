# record-orderbook

Self-contained, offline-capable order/production tools for vinyl record
manufacturing. Runs entirely in the browser — no server, no build step
required to *use* it, no external requests, no runtime dependencies.

Currently included, all sharing one release record per catalogue number:

- **Tracklist / Cutting Order Generator** — catalogue number, format/RPM,
  side A/B track listing with per-track audio file duration reading
  (native `<audio>` + hand-rolled WAV/AIFF header fallback), playing-time
  warnings, printable order sheet.
- **Labels** — per-side artwork upload with whitelabel (blank) toggle,
  best-effort physical size/resolution/colour-mode validation.
- **Cover, inner sleeve, and inlay** — printed/unprinted modes, artwork
  upload with the same validation, orientation previews.
- **Vinyl colour & quantity** — one or more colours with per-colour
  quantities.
- **Shipping / billing** — one billing address, one or more shipping
  addresses, quantities allocated per address per colour.
- **Project package** — ZIP export (all files + JSON + human-readable
  summary text), reopenable to resume or edit an order, SwissTransfer
  handoff to the plant.

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
