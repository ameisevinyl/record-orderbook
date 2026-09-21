# Artwork preview pipeline — design

Status: approved, not yet implemented

## Context

The customer-facing artwork preview ("simulate print" — a canvas overlay
drawn on top of a live-rendered PDF/JPEG/TIFF, showing where the trim
cut will fall) is a browser-side approximation. Investigation this
session found it can't be made accurate everywhere: Safari's built-in
PDF viewer renders artwork with an unremovable internal margin (baked
into the plugin's own output, not reachable from the host page), which
throws the overlay out of alignment with the artwork underneath. The
feature gives false confidence — it looks like a real print simulation
but isn't backed by the plant's actual production pipeline.

Rather than patch around a fundamentally unreliable simulation, this
spec removes it and lays the groundwork for the real thing: once the
plant's (separate, not-yet-built) backend renders an accurate preview
image from the actual submitted file, this tool picks it up automatically
on the next project reload and displays it. A real "simulate print v2"
— the same trim/bleed overlay, now drawn on top of an accurate image —
becomes a small, low-risk follow-up once that exists; it is explicitly
out of scope here.

This also introduces a real distinction, at Send-to-Plant time only,
between "can't be sent at all" (missing artwork, unrecognized file
format) and "flagged but sendable anyway" (wrong size, low DPI, wrong
color mode) — closing a gap where an order could currently be sent to
the plant with a required artwork file entirely absent.

## Goals

- Remove the simulate-print UI (checkboxes, canvas overlays, per-module
  draw logic) and the Safari-specific warning it required.
- Keep the pure trim/bleed inset math (`computeSpreadInsetPx`,
  `computePrintSimGeometry`) — dormant, unwired, ready for reuse.
- At **Send to Plant** only: hard-block (no override) when required
  artwork is missing or unreadable/unrecognized; keep today's
  dismissible warning behavior for everything else (size, DPI, color
  mode, playing time, catalogue number, compressed audio, etc.).
- **Save Project** stays warning-only, exactly as today — a customer
  mid-assembly must be able to checkpoint an incomplete project.
- Define a preview-image file naming convention and have every artwork
  module recognize and display one automatically when present in a
  reopened project zip, taking priority over the module's own live
  rendering of the original file, regardless of file type.
- A preview image survives an untouched save/reload round trip; it is
  dropped the instant the customer replaces the artwork file it was
  generated from.
- Make the new hard-block behavior a single plant-wide config toggle.

## Non-goals

- The plant-side backend that validates uploads, renders preview
  images, calculates price, and returns a download/review link. Not
  designed or built here — this spec only fixes the file-naming
  contract the frontend watches for.
- "Online reviewing" (a hosted web view of the order). Out of scope;
  this tool remains a static, offline, zero-backend HTML file. The
  round trip this spec supports is: plant sends back an updated zip,
  customer reopens it in the same tool, exactly like today's existing
  save/load flow.
- Simulate-print v2 (the overlay redrawn on top of an accurate preview
  image). The math it needs stays in place, but no UI for it ships now.
- Per-artifact-type or per-check-kind config granularity for the hard
  block (single on/off switch only, per the approved design).

## Design

### A) Send-to-Plant hard block

`validateArtwork()` (`src/lib/print-artwork.js`) already splits results
into `errors` (unreadable/unrecognized file) and `warnings` (size, DPI,
color mode) — no new severity taxonomy needed. `updateChecklist()`
(`src/modules/tracklist.js`) already tallies these as two distinct,
separately-countable checklist items:

- `missingArtwork` — `.filemeta.empty[id]` not under a `.hidden`
  ancestor (a required artwork slot with no file attached)
- `erroredArtwork` — `.labelwarnings li.err` count (unreadable or
  unrecognized-format file)

`printOrder()` already demonstrates the target hard-block UX: it
refuses outright via `alert()` + scroll-to-first-issue when **anything**
is flagged, no dismiss option. `sendToPlant()`/`confirmIncompleteSend()`
gets a scoped version of that same pattern:

1. `confirmIncompleteSend()` first checks specifically for
   `missingArtwork`/`erroredArtwork` conditions, marked with a dedicated
   `li.bad.blocking` class (distinct from other `li.bad` items) added in
   `updateChecklist()`. If `CONFIG.blockIncompleteArtworkOnSend`
   is true and any exist: `alert()` + scroll to the first one, return
   `false` — sending is refused, no confirm dialog offered at all.
2. Only once step 1 passes does it fall through to today's existing
   `confirm()` dialog over the remaining (non-blocking) `li.bad` items,
   unchanged.

`printOrder()` itself is untouched — it already blocks on everything,
which is stricter than the new Send-to-Plant rule and was never in
scope to loosen.

### B) Simulate-print removal

Removed entirely:

- `simprint*` checkboxes (`labels.js`'s per-side template, and the four
  static checkboxes in `index.html` for cover/inner-sleeve/inlay-front/
  inlay-back)
- `<canvas class="label-simcanvas">` elements and their CSS
- Each module's `draw()`/`drawSimGuides()` function and the `change`
  listener wiring that calls it
- `app.js`'s `warnSafariSimulatePrint()`, `src/lib/browser.js`'s
  `isSafari()`, `tests/browser.test.js`, and the `.safari-warn` CSS —
  all exist only to caveat a feature that no longer exists

Kept, dormant: `computeSpreadInsetPx` and `computePrintSimGeometry` in
`print-artwork.js`, untested-removed, unwired to any UI. This is the
trim/bleed inset math simulate-print v2 will need later — pure and
already unit-tested, no reason to throw it away and rederive it.

### C) Preview-file naming and recognition

New pure function in `package-naming.js`:

```js
// PNKRCK007_labels_A_v1_preview.jpg — same base name as
// printedPartFileName, forced to a .jpg preview. Generated by the
// plant's backend (not this tool) once it reviews the real file;
// recognized automatically on the next project reload via the
// existing fileMap-by-exact-name mechanism in loadProject.
export function previewFileName({catalogue, part, variant}){
  const parts = [sanitizeFileName(catalogue), part];
  if(variant) parts.push(variant);
  return parts.join("_") + "_v1_preview.jpg";
}
```

`loadProject`'s `fileMap` already contains every file found in the
zip's project folder by exact name, unfiltered — no change needed there.
Each of `applyLabels`/`applyCover`/`applyInnerSleeve`/`applyInlay`
additionally looks up `fileMap.get(previewFileName(...))` after
attaching the real file. If found:

- Display that image in the preview box instead of the live-rendered
  original — same priority for every file kind (PDF/JPEG/TIFF), no
  special-casing.
- Show a small caption marking it as plant-confirmed (same visual
  pattern as the existing "was: `<original filename>`" caption).
- Hold the preview `File` in the slot's closure (alongside the existing
  `file`/`url`/`originalFileName` state), so it round-trips through a
  subsequent save without the customer having to do anything.

Lifecycle rules:

- **Set only by `applyX()`** (the reload path, from `fileMap`) — never
  by `handleFile()` (the user-interaction file-pick path).
- **Cleared by `handleFile()`** unconditionally — picking a new file for
  a slot always drops any held preview reference. Falls back to the
  slot's own live-rendered preview until the plant reviews the new file
  and sends back a fresh one. Never shows a stale image.
- **Persists through an untouched save.** `collectLabelFiles`/
  `collectCoverFiles`/`collectInnerSleeveFiles`/`collectInlayFiles`
  additionally push the held preview file (if any), keyed by the same
  `previewFileName(...)`, into the returned file list — same shape as
  the primary artwork file they already push. `collectPackageFiles()`
  needs no change; it already spreads each module's collect-files
  result into the zip's file list.

### D) Config

One new top-level flag in `config.js`, alongside `studioEmail`/`locale`:

```js
blockIncompleteArtworkOnSend: true
```

`true` (default): Send-to-Plant hard-blocks per (A). `false`: those two
checklist items fall back to today's fully-dismissible behavior — a
plant that wants the old lenient flow back gets it with one setting.

## Files touched

- `src/config.js` — new `blockIncompleteArtworkOnSend` flag
- `src/lib/package-naming.js` — new `previewFileName()`; test additions
- `src/lib/print-artwork.js` — no functional change; `computeSpreadInsetPx`/
  `computePrintSimGeometry` stay, now unused by any module until v2
- `src/modules/labels.js`, `cover.js`, `inner-sleeve.js`, `inlay.js` —
  remove simulate-print UI/wiring; add preview-image lookup/display/
  lifecycle to each slot; extend each `collect*Files()`
- `src/modules/tracklist.js` — `updateChecklist()` marks blocking items;
  `confirmIncompleteSend()` gains the hard-block step
- `src/app.js` — remove `warnSafariSimulatePrint()`
- `src/lib/browser.js`, `tests/browser.test.js` — deleted (Safari
  detection existed only for the removed warning)
- `src/index.html` — remove simprint checkboxes/canvas markup/CSS,
  `.safari-warn` CSS; add small "plant preview" caption styling
- `build/build.js` — remove `browser.js` from `FILES`

## Open questions for implementation (not blocking this spec)

- Exact caption wording/placement for "plant preview" (small design
  detail, not architectural — implementer's judgment, matching the
  existing "was: `<name>`" caption pattern).
- Whether `li.bad.blocking` needs its own checklist visual treatment
  (e.g. distinct icon) or reuses today's "!" mark. Cosmetic; doesn't
  change behavior.
