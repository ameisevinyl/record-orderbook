# Packaging product catalog — design

Status: approved, pending implementation plan

## Context

Inner sleeve, outer cover, and inlay are each currently one hardcoded
spec object per format (`CONFIG.formats[i].printableParts.{innerSleeve,
outerCover,inlay}`), with colour/cut-out/printed-vs-unprinted expressed
as separate, independently-toggleable controls in each module's UI
(radio buttons + a colour `<select>` + a cut-out checkbox). That model
has two problems the user identified:

- **Visual/logic inconsistency across categories.** Inner sleeve offers
  only `printed`/`unprinted` (no `none`, even though a sleeve is
  physically required). Outer cover offers four radio options
  (`printed`/`printed-inside-out`/`unprinted`/`none`) with `hasArtwork()`
  gymnastics to decide what's visible. Inlay uses a separate `include`
  checkbox instead of a mode at all. Three different interaction
  patterns for what is conceptually the same kind of choice.
- **A plant doesn't stock one spec per category — it stocks products.**
  A plant might offer several distinct unprinted inner sleeves (white
  with a cut-out on thin stock, black closed on heavier stock), several
  outer cover options (a standard printed case, a closed coloured
  paperbag, a heavy red paperbag with a cut-out), each with its own
  paper, colour, size, and weight. The current schema can't express
  that — colour and cut-out are UI toggles layered on top of one shared
  spec, not attributes of genuinely different physical products.

This restructures each category from **one spec object** to **a list of
named products**, and the UI from **mode radios + side controls** to
**one dropdown per category**, populated from config.

## Goals

- `CONFIG` gains a `products: [...]` array per category
  (`innerSleeve`, `outerCover`, `inlay`), each entry a fully
  self-contained product: its own name, printed/unprinted kind, size,
  bleed, paper weight, colour (when unprinted), cut-out diameter (when
  it has one), shipping weight (derived, as today).
- One `<select>` per category on the order form, built from that
  product list: `None` (not offered for inner sleeve — always required)
  + an "Unprinted" group + a "Printed" group.
- Selecting a product swaps in its own spec values in that category's
  Specifications panel, and shows/hides the artwork-upload block based
  on whether the product's kind is printed.
- Defaults: inner sleeve → the white/cut-out unprinted product; outer
  cover → `None`; inlay → `None`.
- Cover's "printed (inside out)" becomes its own catalog product
  (`kind:"printed"`, `insideOut:true`) rather than a modifier checkbox —
  same artwork slot as a normal printed cover, different assembly
  instruction shown in `order_summary.txt`.
- Center cut-out diameter becomes a stored spec value
  (`cutoutDiameterMm`) shown in the Specifications panel, not just an
  implicit yes/no.
- Independent CSS cleanup: remove the on-screen divider lines
  (`section`, `.track-row`, `.side-total`, `.labelwarnings th`,
  `.foot`) — spacing alone separates blocks from here on. The
  `@media print` underline styling on inputs stays; it's a deliberate
  "blank line to fill in on paper" convention, unrelated to this.

## Non-goals

- No migration path for previously-saved project zips. Their
  `coverSleeve.{cover,innerSleeve,inlay}.mode/color/cutout` fields don't
  exist in the new schema; on reload, each category simply falls back
  to its default (same category, same mechanism a missing artwork file
  already falls back to a "please re-select" placeholder for). This
  project doesn't carry backwards-compatibility shims (see CLAUDE.md);
  the last two restructuring passes (bleed self-containment, inner
  sleeve trim redefinition) made the same call.
- No exhaustive enumeration of every colour × cut-out combination as
  separate config products. The shipped example config gets a small,
  illustrative product list per category (matching what a real plant
  would actually stock), not a generated cartesian grid — same spirit
  as the existing `// not supplied yet — guessed by interpolation,
  replace with the real spec` comments already in `config.js`.
- No "wrapping" category (outer plastic bags/shrink wrap) yet — noted
  by the user as a future fourth category, explicitly deferred to keep
  this pass scoped to the three categories that already exist.
- File naming is unaffected: one artwork slot per category regardless
  of which specific printed product is selected (the plant needs "the
  cover artwork," not which paper stock it's printed on) — see
  `src/lib/package-naming.js`, unchanged.

## Data model

Each category's config entry changes from a single object to
`{ products: [...] }`. Every product:

| field | meaning | present on |
|---|---|---|
| `id` | stable string key, saved in project.json, matched back to config on reload | all |
| `name` | shown in the dropdown and in `order_summary.txt` | all |
| `kind` | `"printed"` or `"unprinted"` — drives whether the artwork-upload block shows | all |
| `trimMm` | finished, flat, unfolded spread size (`{w,h}`) | all |
| `finalMm` | folded/closed size the customer receives (inner sleeve only — cover already folds spine into `trimMm`, inlay doesn't fold) | innerSleeve |
| `spineMm` | folded-in spine width | outerCover |
| `bleedMm` | this product's own bleed | all |
| `paperGsm` | paper weight, feeds `partWeightG` | all |
| `color` | e.g. `"white"` | unprinted only |
| `cutoutDiameterMm` | present = has a center cut-out of this diameter; absent = closed | innerSleeve, outerCover (when applicable) |
| `insideOut` | assembly instruction: artwork prints facing inward | outerCover, printed only |
| `default` | this product pre-selects on load/format-change (inner sleeve needs exactly one; cover/inlay don't need this — they default to `None`) | innerSleeve |

`labelDataSizeMm`/`flatDataMm`/`partWeightG` (`src/lib/format-catalogue.js`)
are unchanged — they already take a self-contained part object, and a
product from the new array shape satisfies the same interface.

Two new pure, tested helpers in the same file:

```js
// Groups a category's products by kind, for building <optgroup>s.
// Returns { printed: [...], unprinted: [...] } — either array may be empty.
export function groupProductsByKind(products){ ... }

// Looks up one product by id, or undefined if id is null/not found.
export function productById(products, id){ ... }
```

## Example config shape (12" inner sleeve)

```js
innerSleeve: {
  products: [
    { id:"white-cutout", name:"white, center cut-out", kind:"unprinted",
      trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:80,
      color:"white", cutoutDiameterMm:80, default:true },
    { id:"black-closed", name:"black, closed", kind:"unprinted",
      trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
      color:"black" },
    { id:"printed", name:"printed", kind:"printed",
      trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135 }
  ]
}
```

Outer cover and inlay follow the same shape (`spineMm` added on
outerCover products, no `finalMm`/`spineMm` on inlay products). Outer
cover's example list: `printed`, `printed-inside-out`
(`insideOut:true`), plus one or two unprinted examples (e.g. a white
closed paperbag and the red-paperbag-with-cut-out example from the
brainstorm). Inlay's example list: a single `printed` product (inlay
never has an unprinted kind — printing is the entire point of an
inlay).

## UI changes (per module: `cover.js`, `inner-sleeve.js`, `inlay.js`)

Each module keeps its own copy of the artwork-slot scaffolding (per the
existing "each part owns its own copy on purpose" precedent from the
last restructure) but replaces its mode-radio/colour-select/cutout-
checkbox markup with one `<select id="{category}Product">`, built by a
small per-module `populateProductOptions()` that:

1. Reads the current format's product list.
2. Clears and rebuilds the `<select>`: a plain `<option value="">None</option>`
   first (skipped entirely for inner sleeve), then `<optgroup
   label="Printed">`/`<optgroup label="Unprinted">` from
   `groupProductsByKind`.
3. Selects the `default:true` product (inner sleeve) or leaves on
   `None` (cover, inlay).

Runs on `initX()` and on the format-change listener (replacing today's
`slot.clear()`-only reset, since the whole option list changes with
format). A `change` listener on the `<select>` calls the same
`updateXMode()`/spec-render functions that mode-radio `change` listeners
call today, just reading the selected product via `productById` instead
of a checked-radio id.

`XSpec()` (`coverSpec`/`innerSleeveSpec`/`inlaySpec`) becomes: look up
the selected product by id via `productById`, which returns `undefined`
when `None` is selected (or, for inner sleeve, never — `None` isn't a
valid selection there). Returns `undefined` as-is when there's no
product; callers that need derived fields (`dataMm` via `flatDataMm`,
weight via `partWeightG`) only call those when a product exists.

Specifications panel: same fields as today (End format, Data format,
Bleed, Paper weight, Shipping weight, Colour mode) plus a new **Center
cut-out** row (`{category}SpecCutout`) showing `⌀{cutoutDiameterMm}mm`
when present, `none` when absent — shown for inner sleeve and outer
cover, omitted for inlay (never applicable). `renderXSpecs()` guards on
`undefined` up front: when `None` is selected it writes `—` into every
field and returns immediately, without calling `flatDataMm`/
`partWeightG` (which require a real `trimMm`/`paperGsm` to read). The
artwork slot's `updateSizing()` is skipped the same way when there's no
product — the upload block is hidden in that state regardless, so its
size is moot.

## Save/load & order summary

`collectCover()`/`collectInnerSleeve()`/`collectInlay()` return
`{ productId, fileName, originalFileName }` (inlay keeps its existing
front/back nesting, `include` replaced by `productId !== null`).
`applyX(data, fileMap)` re-selects the dropdown by `productId` (falling
back to the category default if the id doesn't match any current
product — see Non-goals) instead of setting radio/checkbox/select
values individually.

`packagingSection()` in `tracklist.js` (currently branches on
`mode`/`color`/`cutout` strings) becomes:

```js
const product = productById(products, c.cover.productId);
out += !product
  ? `  Cover: none\n`
  : product.kind === "printed"
    ? `  Cover: ${product.name} — ${withOriginal(c.cover.fileName, c.cover.originalFileName)}\n`
    : `  Cover: ${product.name}\n`;
```

Same pattern for inner sleeve and inlay. This is strictly simpler than
today's mode-string branching.

## Testing

`format-catalogue.test.js` gets tests for `groupProductsByKind`
(splits correctly, empty-array cases) and `productById` (found,
not-found, null id). `partWeightG`/`flatDataMm`/`labelDataSizeMm`
tests already cover the "self-contained part object" interface a
product satisfies — no changes needed there. Module-level UI wiring
(dropdown population, spec-panel rendering, save/load round-trip)
isn't unit-testable (DOM-coupled, same as today) — verified by manual
browser check after implementation, per this project's existing
pattern.

## CSS cleanup

Remove `border-bottom`/`border-top` from: `section` (the main divider
between modules), `.track-row` (+ its now-redundant `:last-child`
override), `.side-total`, `.labelwarnings th`, `.foot`. Leave the
`@media print` input `border-bottom` rule untouched (print-only "fill
in the blank" convention, not a layout divider).
