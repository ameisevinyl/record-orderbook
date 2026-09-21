# Catalogue schema restructure — design

Status: implemented
Sub-project A of 4 (see "Related work" below)

## Context

`src/config.js`'s `CONFIG` object grew feature-by-feature: each new
printed part or capability added its own top-level key with its own
format-keyed map (`formatCatalogue.order`/`.labels`/`.enabled` as three
parallel maps, `timeLimits[format]`, `label.formats[format]`,
`coverSleeve.outerCover.formats[format]`, etc.). Nothing is wrong per se,
but the format is the wrong axis to be secondary — every module has to
reach across 2-3 config domains to answer "what does a 7\" release look
like," and adding a new format means touching every domain's map.

This is the first of four related sub-projects (see below); this spec
covers only this one. Explicitly out of scope: price/expense data,
inlay page counts/booklets, any schema-validation layer.

## Decisions

These were settled through discussion before this design was written;
recorded here so the rationale isn't lost.

1. **Format is the primary axis.** `CONFIG.formats` is an array; each
   entry is a fully self-contained description of one format —
   metadata, RPM, time limits, center hole, print tolerance, and every
   printable part it offers. Release-level data that doesn't vary by
   format (studio email, locale, info text, vinyl colour) stays as
   siblings of `formats`, not nested under it.
2. **Array, not a keyed object.** `formats: [{id, ...}]` instead of
   `formats: {"7": {...}}`. Array order *is* display order, which
   removes the need for today's separate `order` map. Standard JSON
   collection shape, trivial to `.find()`/`.filter()`/`.map()`.
3. **`centerHole` moves to format-level**, out from under `label`. It's
   a property of the physical disc, not of label printing. A format
   without a big-center option simply omits the `big` key — no separate
   `bigCenterFormats` list to keep in sync.
4. **`printCheck` (size tolerance + DPI range) is one shared value per
   format**, not duplicated per printable part. Matches today's actual
   values (label and cover/sleeve/inlay already use the same numbers).
   No per-part override mechanism — YAGNI; add one later if a real case
   needs it.
5. **Each format's `printableParts` entries are fully self-contained**
   — `outerCover.unprintedColors`, `innerSleeve.centerCutoutDefault`,
   `inlay.paperGsm` are duplicated onto every format that offers them,
   even though today's values happen to be identical across formats.
   Keeps every format object readable in isolation; the minor
   duplication is an accepted tradeoff, not an oversight.
6. **Inlay stays 2-sided (front/back), no page count/booklet support.**
   Explicitly deferred — flagged during discussion, intentionally not
   designed here.
7. **Price/expense data is absent from this schema entirely.** It's
   sub-project C's concern (`pricelist.json`, a separate, per-release,
   plant-generated, never-publicly-shipped artifact). Keeping it out of
   `config.js` is itself the point: this file ships inside
   `dist/index.html`, readable by anyone with the page.
8. **`cover-sleeve.js` splits into three fully independent module
   files** — `cover.js`, `inner-sleeve.js`, `inlay.js` — matching the
   one-file-per-artifact-type pattern `tracklist.js`/`labels.js`
   already follow. Each owns its own DOM template and its own copy of
   the artwork-slot scaffolding (file pick/preview/validate/bleed-sim).
   Explicit choice: duplication over a shared DOM-touching helper file,
   "to be ready for the future" — each part is expected to diverge
   (e.g. inlay's eventual page count) and a forced shared abstraction
   would resist that.
9. **Format `id` is a string, matching `<select>.value`.** Every
   module currently does `parseInt(document.getElementById("format").value, 10)`
   before indexing into CONFIG — a leftover from when formats were
   bare-number object keys (JS coerces those either way, so it never
   mattered). `getFormat()` does a strict `Array.find(f => f.id ===
   id)`, so the `parseInt` calls (4 today: `cover-sleeve.js:30`,
   `labels.js:22`, `tracklist.js:267`, `tracklist.js:457`) are dropped
   entirely — pass the raw `<select>` string value straight through.
   Net simplification, not just a type fix.
10. **`project.json`'s saved shape is unaffected by the module split.**
   The single `coverSleeve: {cover, innerSleeve, inlay}` key is
   preserved for backward compatibility with already-saved customer
   zips — the three new modules' `collect*`/`apply*` functions are
   orchestrated by `tracklist.js` into/out of that one JSON key, the
   same way `collectCoverSleeve()` does today. Nothing about the
   project file format changes; only the JS module boundaries do.

## Schema

```jsonc
{
  // ---- release-level: identical across every format ----
  "studioEmail": "cutting@example.com",
  "locale": "en",
  "vinylColor": {
    "standardColor": "black",
    "basicColors": ["yellow", "red", "pink", "blue", "green", "transparent", "white"],
    "minOrderQty": { "yellow": 300, "red": 300, "pink": 300, "blue": 300, "green": 300, "transparent": 300, "white": 300, "black": 0, "random": 300 }
  },
  "infoText": {
    "bigCenter": { "en": "38mm center hole, jukebox style. First choice for 7\" pressings running 45 RPM — needs a center adapter for playback." },
    "labelArtwork": { "en": "Accepted files: PDF, JPG, TIFF. Colour mode: CMYK. Max. ink coverage: 200%. Colour profile: ISO ECI v2 300." }
  },

  // ---- one self-contained object per offered format, array order = display order ----
  "formats": [
    {
      "id": "7",
      "label": "7\" SP",
      "enabled": true,
      "rpm": 45,
      "centerHole": { "normal": 7.4, "big": 38 },
      "timeLimits": {
        "normal":      { "ideal": 4.5, "max": 6.0 },
        "soundsystem": { "ideal": 3.5, "max": 4.5 }
      },
      "printCheck": { "sizeToleranceMm": 0.5, "dpi": { "min": 300, "max": 1200 } },
      "printableParts": {
        "label":       { "diameterMm": 92, "dataSizeMm": 98 },
        "outerCover":  { "trimMm": {"w": 373, "h": 185}, "dataMm": {"w": 383,   "h": 201}, "unprintedColors": ["black", "brown", "white"] },
        "innerSleeve": { "trimMm": {"w": 180, "h": 180}, "dataMm": {"w": 366,   "h": 186}, "unprintedColors": ["black", "brown", "white"], "centerCutoutDefault": true },
        "inlay":       { "trimMm": {"w": 181, "h": 181}, "dataMm": {"w": 187,   "h": 187}, "paperGsm": 170 }
      }
    },
    {
      "id": "10",
      "label": "10\" EP",
      "enabled": false,
      "rpm": 33,
      "centerHole": { "normal": 7.4 },
      "timeLimits": {
        "normal":      { "ideal": 12, "max": 14 },
        "soundsystem": { "ideal": 7,  "max": 9 }
      },
      "printCheck": { "sizeToleranceMm": 0.5, "dpi": { "min": 300, "max": 1200 } },
      "printableParts": {
        "label":       { "diameterMm": 100, "dataSizeMm": 106 },
        "outerCover":  { "trimMm": {"w": 523, "h": 260}, "dataMm": {"w": 533, "h": 276}, "unprintedColors": ["black", "brown", "white"] },
        "innerSleeve": { "trimMm": {"w": 255, "h": 255}, "dataMm": {"w": 516, "h": 261}, "unprintedColors": ["black", "brown", "white"], "centerCutoutDefault": true },
        "inlay":       { "trimMm": {"w": 250, "h": 250}, "dataMm": {"w": 256, "h": 256}, "paperGsm": 170 } // guessed by interpolation — config.js today flags this as not-yet-supplied; carry the same code comment over, don't treat as authoritative
      }
    },
    {
      "id": "12",
      "label": "12\" LP",
      "enabled": true,
      "rpm": 33,
      "centerHole": { "normal": 7.4 },
      "timeLimits": {
        "normal":      { "ideal": 20, "max": 27 },
        "soundsystem": { "ideal": 15, "max": 16 }
      },
      "printCheck": { "sizeToleranceMm": 0.5, "dpi": { "min": 300, "max": 1200 } },
      "printableParts": {
        "label":       { "diameterMm": 100, "dataSizeMm": 106 },
        "outerCover":  { "trimMm": {"w": 633, "h": 312}, "dataMm": {"w": 638.5, "h": 324}, "unprintedColors": ["black", "brown", "white"] },
        "innerSleeve": { "trimMm": {"w": 304, "h": 309}, "dataMm": {"w": 614,   "h": 315}, "unprintedColors": ["black", "brown", "white"], "centerCutoutDefault": true },
        "inlay":       { "trimMm": {"w": 297, "h": 297}, "dataMm": {"w": 303,   "h": 303}, "paperGsm": 170 }
      }
    }
  ]
}
```

Note on `timeLimits`: today's shape is keyed a third level deep by RPM
(`{45: x, 33: y}`), which was redundant once a format's RPM is fixed at
one value — collapsed to a flat number here.

Note: 33⅓ RPM is written as the number `33` (matching today's
convention in `config.js`); actual playback speed is 33⅓, kept as an
integer key/value for simplicity, unchanged from today's behavior.

## Code changes

### New: `src/lib/format-catalogue.js`
Pure, DOM-free (fits the `src/lib/*.js` convention, unit-tested in
`tests/format-catalogue.test.js`):

- `getFormat(config, id)` — returns the format object matching `id`, or
  `undefined`.
- `enabledFormats(config)` — returns `config.formats` filtered to
  `enabled: true`, in array order.
- `firstEnabledFormat(config)` — returns the first enabled format's
  `id`, or throws if none are enabled (replaces today's
  `firstEnabledFormat()` in `tracklist.js`, which reads
  `CONFIG.formatCatalogue`).

### `src/config.js`
Rewritten into the shape above. No other exports change — still a
single `CONFIG` object, same import path (`import { CONFIG } from
"../config.js"`).

### `src/modules/tracklist.js`
- Format dropdown population (today reads `CONFIG.formatCatalogue.order/labels/enabled`) rewritten to iterate `CONFIG.formats` directly.
- `firstEnabledFormat()` call replaced with `firstEnabledFormat(CONFIG)` from the new lib.
- Time-limit status lookup (`computeStatus(CONFIG.timeLimits, format, rpm, mode, seconds)`) rewritten to pull `getFormat(CONFIG, format).timeLimits` — `computeStatus`'s own signature/logic in `src/lib/` is unaffected, only the caller's lookup path changes.
- Default RPM lookup (`CONFIG.defaultRpm[format]`, two call sites) replaced with `getFormat(CONFIG, format).rpm`.
- Import line changes from `import { collectCoverSleeveFiles, collectCoverSleeve, applyCoverSleeve } from "./cover-sleeve.js"` to three imports from `./cover.js`, `./inner-sleeve.js`, `./inlay.js`; the three call sites (project save collect, project load apply, package file collect) each now call three functions instead of one and assemble/split the single `coverSleeve` JSON key by hand (see Decision 9).

### `src/modules/labels.js`
- `CONFIG.label.formats[currentFormat()]` → `getFormat(CONFIG, currentFormat()).printableParts.label`.
- `CONFIG.label.bigCenterFormats.includes(currentFormat())` → `!!getFormat(CONFIG, currentFormat()).centerHole.big`.
- `CONFIG.label.centerHoleMm.big`/`.normal` → `getFormat(CONFIG, currentFormat()).centerHole.big`/`.normal`.
- `CONFIG.label.sizeToleranceMm`, `.dpi.min/max` → `getFormat(CONFIG, currentFormat()).printCheck.sizeToleranceMm`/`.dpi.min/max`.

### `src/modules/cover-sleeve.js` → split
Three new files, each structured like `labels.js` (template + init/collect/apply exports), each with its own copy of `createArtworkSlot`/`slotFileName`/`collectSlotFile`/`csRenderWarnings`-equivalent logic:

- **`src/modules/cover.js`** — `initCover()`, `collectCover()`, `applyCover(data, fileMap)`, `collectCoverFiles()`. Owns today's cover-only DOM (`cover-printed`/`cover-unprinted`/`cover-none`, `coverColor`, the cover artwork slot) and reads `getFormat(CONFIG, format).printableParts.outerCover`.
- **`src/modules/inner-sleeve.js`** — `initInnerSleeve()`, `collectInnerSleeve()`, `applyInnerSleeve(data, fileMap)`, `collectInnerSleeveFiles()`. Reads `.printableParts.innerSleeve`.
- **`src/modules/inlay.js`** — `initInlay()`, `collectInlay()`, `applyInlay(data, fileMap)`, `collectInlayFiles()`. Owns both front/back slots. Reads `.printableParts.inlay`.

`src/lib/print-artwork.js` (parsing/validation/bleed-sim math) and `src/lib/package-naming.js` (`printedPartFileName`) are imported by all three exactly as `cover-sleeve.js` imports them today — unaffected.

### `src/modules/vinyl-color.js`
Unchanged — vinyl colour is release-level, not per-format.

### `src/app.js`
`import { initCoverSleeve } from "./modules/cover-sleeve.js"` → three imports (`initCover`, `initInnerSleeve`, `initInlay`), three calls in place of one.

### `build/build.js`
`FILES` array: remove `src/modules/cover-sleeve.js`; add `src/lib/format-catalogue.js` (with the other `src/lib/*` entries, before any module that imports it), `src/modules/cover.js`, `src/modules/inner-sleeve.js`, `src/modules/inlay.js` (in place of the one removed entry, same relative position).

### `src/index.html`
The DOM template currently emitted by `cover-sleeve.js`'s `initCoverSleeve` doesn't move — HTML structure for cover/inner-sleeve/inlay sections is unaffected by this refactor; only which `.js` file wires listeners to it changes.

## Testing

- New `tests/format-catalogue.test.js`: `getFormat` found/not-found, `enabledFormats` filtering + order, `firstEnabledFormat` normal case + throws-when-none-enabled case.
- Existing tests that construct a `CONFIG`-shaped fixture (time-limit status computation, format-dependent size checks) get their fixtures updated to the new schema — logic under test (`src/lib/*` pure functions like `computeStatus`, `validateArtwork`) is unchanged, only the fixture shape.
- Manual/browser verification after implementation: full save → reload round trip with a project saved under the *old* `config.js` shape's project.json — confirms Decision 9 (project.json format itself didn't change) holds, i.e. an already-saved customer zip still reopens correctly after this refactor ships.

## Risks / non-goals

- **Not a data migration.** `project.json`'s shape is untouched by this spec (Decision 9) — no customer-facing save file needs migrating. Only `config.js` (plant-editable, not customer data) and the module boundaries around it change.
- **No schema validation added.** A plant hand-edits `config.js` directly; a malformed entry surfaces as a runtime error when that format/part is used, same failure mode as today. Adding structural validation is explicitly deferred (YAGNI for a single hand-edited file).
- **Duplication accepted, not hidden.** Decisions 5 and 8 both accept repeated values/logic in exchange for every format/part being self-contained and independently editable. This is a deliberate tradeoff, not an oversight to "clean up" later.

## Related work (not in this spec)

Decomposed during brainstorming into four sub-projects; this spec is (A) only:

- **(B) Plant-internal price scheme** — lives entirely outside this repo, by design (see Decision 7).
- **(C) `pricelist.json`** — per-release quote artifact returned inside a reopened project zip, with an expiry window. Depends on this spec's schema being settled but not yet designed.
- **(D) Plant-reviewed return files** — post-prepress artwork previews and a prelistening MP3 (playable in-tool, unlike a customer's raw master — resolves an earlier "skip the play button" call, scoped specifically to plant-generated MP3s). Not yet designed.
