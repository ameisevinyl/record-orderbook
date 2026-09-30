# record-orderbook

An order page a record pressing plant hands to its customers (label
owners, artists) to assemble one release: tracklist and playing time per
side, printed parts (labels, inner sleeve, cover, inlay), vinyl colour and
quantity, billing and shipping. One self-contained HTML file — offline, no
install, no external requests, no runtime dependencies. Not tied to one
plant: a plant sets its own values in `CONFIG` (`src/config.js`).

The customer saves and resumes a project as one .zip (`project.json`, an
order summary, a tracklist for mastering, and their audio/artwork files
renamed to the plant's convention) and sends that zip to the plant.

At the plant, a local plant view (Python, stdlib server) works on a jobs
tree of stage folders: accepts incoming zips, versions files, and runs deep
audio and artwork checks.

## Why no framework, no dependencies

The page has to keep working for years with zero maintenance: open it, it
works. Every non-trivial piece (ZIP, WAV/AIFF, PDF/TIFF/JPEG parsing) is
hand-rolled rather than pulled from npm.

## Development

```
node --test tests/            # unit tests (Node 18+, zero npm installs)
node build/build.js           # inline src/ into dist/index.html
python3 -m http.server 8000   # serve src/ for local dev

brew install ffmpeg uv        # plant view needs ffprobe/ffmpeg; uv fetches the Python libs
uv run --project plant plant/server.py [--jobs <folder>]   # plant view on http://127.0.0.1:8765/
uv run --project plant python -m unittest discover plant   # plant tests
```

`dist/index.html` is the single file a plant hands out (CI also publishes
it to GitHub Pages). A plant's own identity (imprint, transfer target) goes
in the gitignored `src/plant.config.local.js`, copied from
`src/plant.config.local.example.js`.

## License

MIT — see [LICENSE](LICENSE).
