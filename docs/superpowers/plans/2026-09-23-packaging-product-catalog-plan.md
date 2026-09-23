# Packaging Product Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-spec-per-category model for inner sleeve/
outer cover/inlay with a per-category product list, and the mode-radio
+ side-control UI with one dropdown per category, populated from
`CONFIG`.

**Architecture:** `CONFIG.formats[i].printableParts.{innerSleeve,
outerCover,inlay}` changes from one spec object to `{ products: [...] }`.
Two new pure helpers (`groupProductsByKind`, `productById`) in
`src/lib/format-catalogue.js` back a `<select>` per category in each of
`cover.js`/`inner-sleeve.js`/`inlay.js`, replacing their mode radios +
colour select + cut-out checkbox. `tracklist.js`'s `packagingSection`
reads the selected product's `name` instead of branching on mode
strings. An independent CSS pass removes the on-screen divider lines.

**Tech Stack:** Plain ES2020+ JS modules, `node --test` (built-in),
`node build/build.js` (plain `fs` concatenation) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-23-packaging-product-catalog-design.md`

## Global Constraints

- No runtime dependencies, no npm packages shipped to the browser (CLAUDE.md).
- `dist/index.html` stays a single self-contained file — built via `node build/build.js`, never hand-edited.
- No migration path for old saved project zips — an unrecognized/missing `productId` on reload falls back to the category default, same mechanism a missing artwork file already falls back to a placeholder for (spec, Non-goals).
- No exhaustive colour × cut-out cartesian product in the example config data — a small, illustrative product list per category, clearly commented as example/placeholder stock (spec, Non-goals).
- File naming is unaffected — one artwork slot per category regardless of which specific printed product is selected (spec, Non-goals; `src/lib/package-naming.js` is not touched).
- No "wrapping" category yet — three categories only: innerSleeve, outerCover, inlay (spec, Non-goals).
- Run `node --test tests/` before considering any task done (CLAUDE.md).
- Deviation from spec: the `insideOut` boolean field described in the spec's data-model table is dropped — nothing reads it, the product's `name` string ("printed (inside out)") is the only place that distinction needs to show up (order_summary.txt), so a separate flag would be dead data (YAGNI, CLAUDE.md).

---

### Task 1: Pure catalog helpers — `groupProductsByKind` / `productById`

**Files:**
- Modify: `src/lib/format-catalogue.js`
- Test: `tests/format-catalogue.test.js`

**Interfaces:**
- Produces: `groupProductsByKind(products: Product[]) -> { printed: Product[], unprinted: Product[] }` and `productById(products: Product[], id: string|null) -> Product|undefined`, both exported from `src/lib/format-catalogue.js`. `Product` here is any object with at least `{ id, kind }` — these two functions don't touch any other field, so they work against today's test fixtures unchanged and against the real config shape from Task 2 onward.

- [ ] **Step 1: Write the failing tests**

Append to `tests/format-catalogue.test.js` (after the existing `partWeightG` tests, before the final blank line):

```js
const innerSleeveProducts12 = [
  { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
    color:"white", cutoutDiameterMm:85, default:true },
  { id:"sleeve-black-closed", name:"black, closed", kind:"unprinted",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:170,
    color:"black" },
  { id:"sleeve-printed", name:"printed", kind:"printed",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135 }
];

test("groupProductsByKind splits printed and unprinted products", () => {
  const { printed, unprinted } = groupProductsByKind(innerSleeveProducts12);
  assert.deepEqual(printed.map(p=>p.id), ["sleeve-printed"]);
  assert.deepEqual(unprinted.map(p=>p.id), ["sleeve-white-cutout", "sleeve-black-closed"]);
});

test("groupProductsByKind returns an empty array for a kind with no products", () => {
  const { unprinted } = groupProductsByKind([innerSleeveProducts12[2]]);
  assert.deepEqual(unprinted, []);
});

test("productById finds a product by id", () => {
  assert.equal(productById(innerSleeveProducts12, "sleeve-black-closed").color, "black");
});

test("productById returns undefined for an unknown id", () => {
  assert.equal(productById(innerSleeveProducts12, "nope"), undefined);
});

test("productById returns undefined for a null id (the None selection)", () => {
  assert.equal(productById(innerSleeveProducts12, null), undefined);
});
```

Also update the import line at the top of the same file to:

```js
import {
  getFormat, enabledFormats, firstEnabledFormat,
  labelDataSizeMm, flatDataMm, partWeightG,
  groupProductsByKind, productById
} from "../src/lib/format-catalogue.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/format-catalogue.test.js`
Expected: FAIL — `groupProductsByKind is not defined` / `productById is not defined` (they don't exist in `format-catalogue.js` yet).

- [ ] **Step 3: Implement the two helpers**

Append to `src/lib/format-catalogue.js` (after `partWeightG`):

```js

// Splits a category's product list by kind, for building <optgroup>s in
// the category's dropdown. Either array may be empty — e.g. inlay's
// product list never has an "unprinted" entry.
export function groupProductsByKind(products){
  return {
    printed: products.filter(p => p.kind === "printed"),
    unprinted: products.filter(p => p.kind === "unprinted")
  };
}

// Looks up one product by id. undefined for a null id (the "None"
// selection) or an id with no match (e.g. a stale id from a project
// saved against a different/older product list).
export function productById(products, id){
  return id == null ? undefined : products.find(p => p.id === id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/format-catalogue.test.js`
Expected: PASS, all tests including the 5 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-catalogue.js tests/format-catalogue.test.js
git commit -m "add groupProductsByKind/productById catalog helpers"
```

---

### Task 2: CONFIG schema — product lists for all three formats

**Files:**
- Modify: `src/config.js`

**Interfaces:**
- Consumes: nothing new (plain data).
- Produces: `CONFIG.formats[i].printableParts.{innerSleeve,outerCover,inlay}.products` — an array of product objects per category per format, each satisfying the shape `groupProductsByKind`/`productById`/`flatDataMm`/`partWeightG` expect (`id`, `name`, `kind`, `trimMm:{w,h}`, `bleedMm`, `paperGsm`, plus category-specific fields below). Tasks 3–5 read this shape directly.

Per-product fields by category:
- `innerSleeve`: `id, name, kind, trimMm, finalMm, bleedMm, paperGsm`, plus `color` + optional `cutoutDiameterMm` when `kind:"unprinted"`.
- `outerCover`: `id, name, kind, trimMm, spineMm, bleedMm, paperGsm`, plus `color` + optional `cutoutDiameterMm` when `kind:"unprinted"`.
- `inlay`: `id, name, kind, trimMm, bleedMm, paperGsm` (never has `color`/`cutoutDiameterMm` — inlay has no unprinted kind).

- [ ] **Step 1: Replace the 12" format's `printableParts` block**

In `src/config.js`, replace the entire `printableParts: { ... }` block for the **12" LP** format entry (the one right after the `recordWeightG: 140,`/`printCheck` block, ending just before the 10" format entry starts) — including its introductory comment — with:

```js
      // Every packaging category below (innerSleeve/outerCover/inlay) is
      // a *product catalog*, not a single spec — a plant stocks
      // distinct products (different paper, colour, size, cut-out), not
      // one spec per category. Each product is fully self-contained:
      // its own bleedMm, trim/final size, paper weight, colour when
      // unprinted, cutoutDiameterMm when it has a center cut-out
      // (absent = closed). `kind` is "printed" or "unprinted" — printed
      // products get an artwork-upload slot on the order form,
      // unprinted ones don't. `default:true` marks the product that's
      // pre-selected on load — only inner sleeve needs one (it's always
      // required, never "none"); outer cover and inlay default to
      // "none" (nothing pre-selected). Data sizes are never
      // hand-entered — see labelDataSizeMm/flatDataMm in
      // lib/format-catalogue.js, which derive them from trim/diameter +
      // bleed (+ spine for the cover), so they can't drift out of sync.
      // Printed-part weight (partWeightG, same file) is likewise
      // derived from trimMm + paperGsm, not stored here. This is
      // example/placeholder stock — add, remove, or reprice products to
      // match what this plant actually offers.
      printableParts: {
        // diameterMm is the trim size (the physical label after
        // cutting) — data size (with bleed) is derived, see above.
        label: { diameterMm: 100, bleedMm: 3 },
        innerSleeve: {
          products: [
            { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
              trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
              color:"white", cutoutDiameterMm:85, default:true },
            { id:"sleeve-black-cutout", name:"black, center cut-out", kind:"unprinted",
              trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
              color:"black", cutoutDiameterMm:85 },
            { id:"sleeve-brown-cutout", name:"brown, center cut-out", kind:"unprinted",
              trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
              color:"brown", cutoutDiameterMm:85 },
            // Heavier stock example, no cut-out — shows a category can
            // mix paper weights and cut-out/closed freely, not just colour.
            { id:"sleeve-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:170,
              color:"black" },
            { id:"sleeve-printed", name:"printed", kind:"printed",
              trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135 }
          ]
        },
        // trimMm — the finished, flat-opened, unfolded spread size,
        // front on the right and back on the left; already includes
        // the spine (panel + spineMm + panel width-wise, spineMm added
        // top and bottom of panel height-wise — a "box"-style spine
        // wraps slightly around all three of those edges). Data size
        // (trim + bleed) is derived, see above.
        outerCover: {
          products: [
            { id:"cover-printed", name:"printed", kind:"printed",
              trimMm:{w:633,h:318}, spineMm:3, bleedMm:5, paperGsm:300 },
            // Same artwork file and dimensions as "printed" — the name
            // alone carries the assembly instruction (faces inward once
            // folded); see this plan's Global Constraints for why there's
            // no separate insideOut flag.
            { id:"cover-printed-inside-out", name:"printed (inside out)", kind:"printed",
              trimMm:{w:633,h:318}, spineMm:3, bleedMm:5, paperGsm:300 },
            { id:"cover-white-closed", name:"white, closed", kind:"unprinted",
              trimMm:{w:633,h:318}, spineMm:3, bleedMm:5, paperGsm:300, color:"white" },
            { id:"cover-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:633,h:318}, spineMm:3, bleedMm:5, paperGsm:300, color:"black" },
            { id:"cover-brown-closed", name:"brown, closed", kind:"unprinted",
              trimMm:{w:633,h:318}, spineMm:3, bleedMm:5, paperGsm:300, color:"brown" },
            // Open-top bag, not a folded case — spineMm:0 (nothing folds in).
            { id:"cover-red-paperbag-cutout", name:"red paperbag, center cut-out, heavy stock", kind:"unprinted",
              trimMm:{w:633,h:318}, spineMm:0, bleedMm:5, paperGsm:400, color:"red", cutoutDiameterMm:85 }
          ]
        },
        inlay: {
          products: [
            { id:"inlay-printed", name:"printed", kind:"printed",
              trimMm:{w:297,h:297}, bleedMm:3, paperGsm:170 }
          ]
        }
      }
```

- [ ] **Step 2: Replace the 10" format's `printableParts` block**

Same location pattern, for the **10" EP** format entry:

```js
      printableParts: {
        label: { diameterMm: 100, bleedMm: 3 },
        innerSleeve: {
          products: [
            { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
              trimMm:{w:510,h:255}, finalMm:{w:255,h:255}, bleedMm:3, paperGsm:135,
              color:"white", cutoutDiameterMm:85, default:true },
            { id:"sleeve-black-cutout", name:"black, center cut-out", kind:"unprinted",
              trimMm:{w:510,h:255}, finalMm:{w:255,h:255}, bleedMm:3, paperGsm:135,
              color:"black", cutoutDiameterMm:85 },
            { id:"sleeve-brown-cutout", name:"brown, center cut-out", kind:"unprinted",
              trimMm:{w:510,h:255}, finalMm:{w:255,h:255}, bleedMm:3, paperGsm:135,
              color:"brown", cutoutDiameterMm:85 },
            { id:"sleeve-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:510,h:255}, finalMm:{w:255,h:255}, bleedMm:3, paperGsm:170,
              color:"black" },
            { id:"sleeve-printed", name:"printed", kind:"printed",
              trimMm:{w:510,h:255}, finalMm:{w:255,h:255}, bleedMm:3, paperGsm:135 }
          ]
        },
        outerCover: {
          products: [
            { id:"cover-printed", name:"printed", kind:"printed",
              trimMm:{w:523,h:266}, spineMm:3, bleedMm:5, paperGsm:300 },
            { id:"cover-printed-inside-out", name:"printed (inside out)", kind:"printed",
              trimMm:{w:523,h:266}, spineMm:3, bleedMm:5, paperGsm:300 },
            { id:"cover-white-closed", name:"white, closed", kind:"unprinted",
              trimMm:{w:523,h:266}, spineMm:3, bleedMm:5, paperGsm:300, color:"white" },
            { id:"cover-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:523,h:266}, spineMm:3, bleedMm:5, paperGsm:300, color:"black" },
            { id:"cover-brown-closed", name:"brown, closed", kind:"unprinted",
              trimMm:{w:523,h:266}, spineMm:3, bleedMm:5, paperGsm:300, color:"brown" },
            { id:"cover-red-paperbag-cutout", name:"red paperbag, center cut-out, heavy stock", kind:"unprinted",
              trimMm:{w:523,h:266}, spineMm:0, bleedMm:5, paperGsm:400, color:"red", cutoutDiameterMm:85 }
          ]
        },
        // Not supplied yet — guessed by interpolation, replace with the
        // real spec.
        inlay: {
          products: [
            { id:"inlay-printed", name:"printed", kind:"printed",
              trimMm:{w:250,h:250}, bleedMm:3, paperGsm:170 }
          ]
        }
      }
```

- [ ] **Step 3: Replace the 7" format's `printableParts` block**

Same location pattern, for the **7" SP** format entry (keep its existing `label: { diameterMm: 92, bleedMm: 3 }` and the `// "box" style, 3mm spine.` comment above `outerCover`):

```js
      printableParts: {
        label: { diameterMm: 92, bleedMm: 3 },
        innerSleeve: {
          products: [
            { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
              trimMm:{w:360,h:180}, finalMm:{w:180,h:180}, bleedMm:3, paperGsm:135,
              color:"white", cutoutDiameterMm:55, default:true },
            { id:"sleeve-black-cutout", name:"black, center cut-out", kind:"unprinted",
              trimMm:{w:360,h:180}, finalMm:{w:180,h:180}, bleedMm:3, paperGsm:135,
              color:"black", cutoutDiameterMm:55 },
            { id:"sleeve-brown-cutout", name:"brown, center cut-out", kind:"unprinted",
              trimMm:{w:360,h:180}, finalMm:{w:180,h:180}, bleedMm:3, paperGsm:135,
              color:"brown", cutoutDiameterMm:55 },
            { id:"sleeve-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:360,h:180}, finalMm:{w:180,h:180}, bleedMm:3, paperGsm:170,
              color:"black" },
            { id:"sleeve-printed", name:"printed", kind:"printed",
              trimMm:{w:360,h:180}, finalMm:{w:180,h:180}, bleedMm:3, paperGsm:135 }
          ]
        },
        // "box" style, 3mm spine.
        outerCover: {
          products: [
            { id:"cover-printed", name:"printed", kind:"printed",
              trimMm:{w:373,h:191}, spineMm:3, bleedMm:5, paperGsm:300 },
            { id:"cover-printed-inside-out", name:"printed (inside out)", kind:"printed",
              trimMm:{w:373,h:191}, spineMm:3, bleedMm:5, paperGsm:300 },
            { id:"cover-white-closed", name:"white, closed", kind:"unprinted",
              trimMm:{w:373,h:191}, spineMm:3, bleedMm:5, paperGsm:300, color:"white" },
            { id:"cover-black-closed", name:"black, closed", kind:"unprinted",
              trimMm:{w:373,h:191}, spineMm:3, bleedMm:5, paperGsm:300, color:"black" },
            { id:"cover-brown-closed", name:"brown, closed", kind:"unprinted",
              trimMm:{w:373,h:191}, spineMm:3, bleedMm:5, paperGsm:300, color:"brown" },
            { id:"cover-red-paperbag-cutout", name:"red paperbag, center cut-out, heavy stock", kind:"unprinted",
              trimMm:{w:373,h:191}, spineMm:0, bleedMm:5, paperGsm:400, color:"red", cutoutDiameterMm:55 }
          ]
        },
        inlay: {
          products: [
            { id:"inlay-printed", name:"printed", kind:"printed",
              trimMm:{w:181,h:181}, bleedMm:3, paperGsm:170 }
          ]
        }
      }
```

- [ ] **Step 4: Syntax-check**

Run: `node --check src/config.js`
Expected: no output (valid syntax).

- [ ] **Step 5: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143 (138 existing + 5 from Task 1) — `config.js` isn't imported by any test file, so this is a sanity check that nothing else broke, not a direct test of the new data.

- [ ] **Step 6: Commit**

```bash
git add src/config.js
git commit -m "restructure printableParts into per-category product catalogs"
```

---

### Task 3: Inner Sleeve module — product dropdown

**Files:**
- Modify: `src/modules/inner-sleeve.js`
- Modify: `src/index.html:452-510` (Inner Sleeve section)

**Interfaces:**
- Consumes: `getFormat`, `flatDataMm`, `partWeightG`, `groupProductsByKind`, `productById` from `src/lib/format-catalogue.js` (Task 1); `CONFIG.formats[i].printableParts.innerSleeve.products` shape (Task 2).
- Produces: `collectInnerSleeve() -> { productId: string, fileName: string|null, originalFileName: string|null }` and `applyInnerSleeve(data, fileMap) -> Promise<void>`, both still exported with the same names/call signature `tracklist.js` already uses — only the internal data shape changes (Task 6 reads `productId` instead of `mode`/`color`/`cutout`).

- [ ] **Step 1: Replace the markup**

In `src/index.html`, replace the block from `<!-- ============ INNER SLEEVE ============ -->`'s `<div class="row">` (the radios/colour-select/cutout-checkbox row, currently lines ~467–491) up to but not including `<div id="innersleevePrintedBody">`, and also insert a new spec row. The full section becomes:

```html
  <!-- ============ INNER SLEEVE ============ -->
  <section>
    <h2>Inner Sleeve</h2>
    <details class="specs no-print">
      <summary>Specifications</summary>
      <div class="specs-body">
        <div><span>Allowed filetypes</span><span id="innersleeveSpecFiletypes"></span></div>
        <div><span>Colour mode</span><span id="innersleeveSpecColorMode"></span></div>
        <div><span>Final size</span><span id="innersleeveSpecFinalSize"></span></div>
        <div><span>End format</span><span id="innersleeveSpecEndFormat"></span></div>
        <div><span>Data format</span><span id="innersleeveSpecDataFormat"></span></div>
        <div><span>Bleed</span><span id="innersleeveSpecBleed"></span></div>
        <div><span>Paper weight</span><span id="innersleeveSpecPaperGsm"></span></div>
        <div><span>Center cut-out</span><span id="innersleeveSpecCutout"></span></div>
        <div id="innersleeveSpecWeightRow" class="hidden"><span>Shipping weight</span><span id="innersleeveSpecWeight"></span></div>
      </div>
    </details>
    <div class="row">
      <div class="field" style="flex:0 0 auto;">
        <label>Product</label>
        <select id="innersleeveProduct"></select>
      </div>
    </div>

    <div id="innersleevePrintedBody">
      <div class="row" style="align-items:end;">
        <div class="field" style="flex:0 0 auto;">
          <label>&nbsp;</label>
          <button type="button" class="pickbtn no-print" id="innersleevepick" title="Choose inner sleeve artwork">↑</button>
        </div>
        <div class="field">
          <div class="filemeta empty" id="innersleevemeta"></div>
        </div>
      </div>
      <input type="file" id="innersleeveinput" class="hidden">
      <div class="label-preview-wrap" id="innersleevepreviewwrap">
        <div class="label-preview" id="innersleevepreview"><div class="label-placeholder">no artwork selected</div></div>
      </div>
      <div class="spread-caption" id="innersleevecaption"><span>back</span><span>front</span></div>
      <table class="labelwarnings" id="innersleevewarnings"></table>
    </div>
  </section>
```

- [ ] **Step 2: Replace the module logic**

Replace the full contents of `src/modules/inner-sleeve.js` with:

```js
// Inner Sleeve module — one product per selection from the plant's
// inner-sleeve catalog (printed, or a specific unprinted colour/paper/
// cut-out combination) — see CONFIG.formats[i].printableParts.
// innerSleeve.products and the packaging product catalog design spec.
// Always required (never "none") — a sleeve protects the record, so
// the dropdown never offers that option, unlike cover/inlay. Delivered
// as a single flat print file with front on the right and back on the
// left, when the selected product is printed. Split out of the former
// cover-sleeve.js along with cover.js and inlay.js (see the catalogue
// schema restructure design spec, Decision 8) — each owns its own copy
// of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

const INNER_SLEEVE_PREVIEW_MAX_W = 640;

function innerSleeveCurrentFormat(){
  return document.getElementById("format").value;
}

function innerSleeveProducts(){
  return getFormat(CONFIG, innerSleeveCurrentFormat()).printableParts.innerSleeve.products;
}

function selectedInnerSleeveProduct(){
  return productById(innerSleeveProducts(), document.getElementById("innersleeveProduct").value || null);
}

// dataMm is derived (trim + bleed — trimMm is already the flat-opened,
// unfolded spread; finalMm, separately, is the folded pocket size the
// customer actually receives), not a stored field.
function innerSleeveSpec(){
  const part = selectedInnerSleeveProduct();
  return part && { ...part, dataMm: flatDataMm(part) };
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderInnerSleeveChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode());
  tableEl.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for(const row of rows){
    const tr = document.createElement("tr");
    tr.className = row.severity;
    for(const text of [CHECKLIST_ICON[row.severity], row.feature, row.detected, row.expected || ""]){
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
}

function createInnerSleeveArtworkSlot(){
  const input = document.getElementById("innersleeveinput");
  const meta = document.getElementById("innersleevemeta");
  const preview = document.getElementById("innersleevepreview");
  const wrap = document.getElementById("innersleevepreviewwrap");
  const warningsList = document.getElementById("innersleevewarnings");
  const caption = document.getElementById("innersleevecaption");
  let file = null, url = null, originalFileName = null;
  let previewFile = null, previewUrl = null;

  // No-op when nothing is selected — only possible transiently, since
  // inner sleeve always has a default product once populateInnerSleeveProducts
  // has run.
  function updateSizing(){
    const spec = innerSleeveSpec();
    if(!spec) return;
    const { dataMm } = spec;
    wrap.style.width = "100%";
    wrap.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderInnerSleeveFileMeta(currentName, originalName, statusText){
    meta.textContent = "";
    meta.append(statusText ? `file: ${currentName} — ${statusText}` : `file: ${currentName}`);
    if(originalName && originalName !== currentName){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  }

  // Swaps the preview box to a plant-generated preview image, taking
  // priority over the live-rendered original — see
  // applyInnerSleeveSlotFile below, the only caller (a fresh manual pick
  // never has one to show yet). Reuses the existing file-meta
  // status-text slot instead of adding new markup/CSS for a separate
  // caption.
  function showPreviewImage(previewImgFile){
    previewFile = previewImgFile;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${previewUrl}" alt="plant preview">`;
    renderInnerSleeveFileMeta(file.name, originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyInnerSleeveSlotFile passes the name recorded before renaming, on
  // a project reload, so renderInnerSleeveFileMeta can show it as the
  // "was:" line.
  async function handleFile(f, origName = f.name){
    file = f;
    originalFileName = origName;
    meta.classList.remove("empty");
    renderInnerSleeveFileMeta(f.name, origName, "checking…");
    if(url) URL.revokeObjectURL(url);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null;
    previewUrl = null;

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = await parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm, trimMm } = innerSleeveSpec();
    const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
    renderInnerSleeveChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    renderInnerSleeveFileMeta(f.name, origName, null);
  }

  // A file picked for one product is sized for that product's dataMm —
  // switching product or format invalidates it outright (see
  // initInnerSleeve's listeners), rather than leaving a now-wrong-size
  // file attached.
  function clear(){
    if(url) URL.revokeObjectURL(url);
    file = null; url = null; originalFileName = null;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null; previewUrl = null;
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warningsList.innerHTML = "";
  }

  document.getElementById("innersleevepick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> previewFile
  };
}

function innerSleeveSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve", ext: fileExt(file.name)});
}

async function collectInnerSleeveSlotFile(){
  const file = innerSleeveSlot.getFile();
  if(!file) return null;
  return { name: innerSleeveSlotFileName(file), data: await file.arrayBuffer() };
}

let innerSleeveSlot;

function innerSleeveHasArtwork(){
  const product = selectedInnerSleeveProduct();
  return !!product && product.kind === "printed";
}

function updateInnerSleeveMode(){
  document.getElementById("innersleevePrintedBody").classList.toggle("hidden", !innerSleeveHasArtwork());
}

// Rebuilds the product dropdown from CONFIG for the current format —
// options grouped by kind (Printed/Unprinted), no "None" entry (a
// sleeve is always required). Pre-selects the product flagged
// default:true.
function populateInnerSleeveProducts(){
  const select = document.getElementById("innersleeveProduct");
  const products = innerSleeveProducts();
  const { printed, unprinted } = groupProductsByKind(products);
  select.innerHTML = "";
  const addGroup = (label, list) => {
    if(!list.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for(const p of list){
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  };
  addGroup("Printed", printed);
  addGroup("Unprinted", unprinted);
  const defaultProduct = products.find(p => p.default) || products[0];
  select.value = defaultProduct.id;
}

// Populates the Specifications disclosure from the selected product —
// never hand-typed, so it can't drift from the format's actual values.
function renderInnerSleeveSpecs(){
  const part = innerSleeveSpec();
  const { trimMm, finalMm, bleedMm, paperGsm, cutoutDiameterMm, dataMm } = part;
  const colorMode = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
  document.getElementById("innersleeveSpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
  document.getElementById("innersleeveSpecColorMode").textContent = colorMode;
  document.getElementById("innersleeveSpecFinalSize").textContent = `${finalMm.w}×${finalMm.h}mm`;
  document.getElementById("innersleeveSpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
  document.getElementById("innersleeveSpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
  document.getElementById("innersleeveSpecBleed").textContent = `${bleedMm}mm`;
  document.getElementById("innersleeveSpecPaperGsm").textContent = `${paperGsm}gsm`;
  document.getElementById("innersleeveSpecCutout").textContent = cutoutDiameterMm ? `⌀${cutoutDiameterMm}mm` : "none";
  // Shipping weight — plant/?debug eyes only, not customer-facing yet.
  document.getElementById("innersleeveSpecWeightRow").classList.toggle("hidden", !isDebugMode());
  document.getElementById("innersleeveSpecWeight").textContent = `${partWeightG(part)}g`;
}

export function initInnerSleeve(){
  innerSleeveSlot = createInnerSleeveArtworkSlot();
  populateInnerSleeveProducts();
  innerSleeveSlot.updateSizing();
  document.getElementById("innersleeveinput").accept = CONFIG.artworkFileTypes.accept;
  renderInnerSleeveSpecs();
  updateInnerSleeveMode();

  document.getElementById("format").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    populateInnerSleeveProducts();
    innerSleeveSlot.updateSizing();
    renderInnerSleeveSpecs();
    updateInnerSleeveMode();
  });

  document.getElementById("innersleeveProduct").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    innerSleeveSlot.updateSizing();
    renderInnerSleeveSpecs();
    updateInnerSleeveMode();
  });
}

function setInnerSleeveFileNamePlaceholder(name, originalName){
  const meta = document.getElementById("innersleevemeta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "";
    meta.append(`file: ${name} — please re-select this file (not stored in the order file)`);
    if(originalName && originalName !== name){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

async function applyInnerSleeveSlotFile(fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    await innerSleeveSlot.setFile(file, originalFileName || fileName);
    const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
    const previewImg = fileMap && fileMap.get(previewName);
    if(previewImg) innerSleeveSlot.setPreviewImage(previewImg);
  } else {
    setInnerSleeveFileNamePlaceholder(fileName, originalFileName);
  }
}

export function collectInnerSleeve(){
  const product = selectedInnerSleeveProduct();
  const file = innerSleeveSlot.getFile();
  const printed = !!product && product.kind === "printed";
  return {
    productId: product ? product.id : null,
    fileName: (printed && file) ? innerSleeveSlotFileName(file) : null,
    originalFileName: (printed && file) ? innerSleeveSlot.getOriginalFileName() : null
  };
}

export async function applyInnerSleeve(data, fileMap){
  const is = data || {};
  const products = innerSleeveProducts();
  const match = productById(products, is.productId);
  const fallback = products.find(p => p.default) || products[0];
  document.getElementById("innersleeveProduct").value = (match || fallback).id;
  await applyInnerSleeveSlotFile(is.fileName, is.originalFileName, fileMap);
  updateInnerSleeveMode();
  innerSleeveSlot.updateSizing();
  renderInnerSleeveSpecs();
}

export async function collectInnerSleeveFiles(){
  const files = [];
  if(innerSleeveHasArtwork()){
    const sleeve = await collectInnerSleeveSlotFile();
    if(sleeve) files.push(sleeve);
    const previewImg = innerSleeveSlot.getPreviewFile();
    if(previewImg){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
      files.push({name, data: await previewImg.arrayBuffer()});
    }
  }
  return files;
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/modules/inner-sleeve.js`
Expected: no output.

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143 — `inner-sleeve.js` is DOM-coupled, not unit-tested directly; this confirms nothing in `src/lib` regressed.

- [ ] **Step 5: Commit**

```bash
git add src/modules/inner-sleeve.js src/index.html
git commit -m "inner sleeve: replace mode/colour/cut-out controls with a product dropdown"
```

---

### Task 4: Outer Cover module — product dropdown

**Files:**
- Modify: `src/modules/cover.js`
- Modify: `src/index.html:513-577` (Outer Cover section)

**Interfaces:**
- Consumes: same helpers as Task 3, plus `CONFIG.formats[i].printableParts.outerCover.products` (Task 2).
- Produces: `collectCover() -> { productId: string|null, fileName, originalFileName }`, `applyCover(data, fileMap) -> Promise<void>` — same exported names/signatures as before.

- [ ] **Step 1: Replace the markup**

Replace the Outer Cover section's `<details class="specs no-print">` block and the mode/colour `<div class="row">` (currently lines ~516–558) with:

```html
    <details class="specs no-print">
      <summary>Specifications</summary>
      <div class="specs-body">
        <div><span>Allowed filetypes</span><span id="coverSpecFiletypes"></span></div>
        <div><span>Colour mode</span><span id="coverSpecColorMode"></span></div>
        <div><span>End format</span><span id="coverSpecEndFormat"></span></div>
        <div><span>Data format</span><span id="coverSpecDataFormat"></span></div>
        <div><span>Bleed</span><span id="coverSpecBleed"></span></div>
        <div><span>Spine</span><span id="coverSpecSpine"></span></div>
        <div><span>Paper weight</span><span id="coverSpecPaperGsm"></span></div>
        <div><span>Center cut-out</span><span id="coverSpecCutout"></span></div>
        <div id="coverSpecWeightRow" class="hidden"><span>Shipping weight</span><span id="coverSpecWeight"></span></div>
      </div>
    </details>
    <div class="row">
      <div class="field" style="flex:0 0 auto;">
        <label>Product</label>
        <select id="coverProduct"></select>
      </div>
    </div>
```

(The `<div id="coverPrintedBody">...</div>` block right after it, and the `</section>` closing it, are untouched.)

- [ ] **Step 2: Replace the module logic**

Replace the full contents of `src/modules/cover.js` with:

```js
// Cover module — one product per selection from the plant's outer-cover
// catalog (printed, printed inside out, or a specific unprinted
// colour/paper/cut-out combination) — see CONFIG.formats[i].
// printableParts.outerCover.products and the packaging product catalog
// design spec. "Printed (inside out)" is its own catalog product, same
// artwork file and dimensions as "printed" — the difference is purely
// an assembly instruction to the plant (print faces inward once
// folded), carried by the product's name alone. Delivered as a single
// flat print file with front on the right and back on the left, when
// the selected product is printed. Split out of the former
// cover-sleeve.js along with inner-sleeve.js and inlay.js (see the
// catalogue schema restructure design spec, Decision 8) — each owns
// its own copy of the artwork-slot scaffolding on purpose, so each
// part can diverge later without fighting a forced shared abstraction.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

// On-screen preview cap, in px. A flat cover spread can be 600+mm wide —
// displaying that at true CSS-mm size would make the preview several
// times wider than a browser window.
const COVER_PREVIEW_MAX_W = 640;

function coverCurrentFormat(){
  return document.getElementById("format").value;
}

function coverProducts(){
  return getFormat(CONFIG, coverCurrentFormat()).printableParts.outerCover.products;
}

function selectedCoverProduct(){
  return productById(coverProducts(), document.getElementById("coverProduct").value || null);
}

function coverHasArtwork(){
  const product = selectedCoverProduct();
  return !!product && product.kind === "printed";
}

// dataMm is derived (trim + bleed — spine's already folded into
// trimMm, see config.js), not a stored field, so it can't drift out of
// sync with trimMm/spineMm/bleedMm. undefined when "None" is selected.
function coverSpec(){
  const part = selectedCoverProduct();
  return part && { ...part, dataMm: flatDataMm(part) };
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderCoverChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode());
  tableEl.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for(const row of rows){
    const tr = document.createElement("tr");
    tr.className = row.severity;
    for(const text of [CHECKLIST_ICON[row.severity], row.feature, row.detected, row.expected || ""]){
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
}

function createCoverArtworkSlot(){
  const input = document.getElementById("coverinput");
  const meta = document.getElementById("covermeta");
  const preview = document.getElementById("coverpreview");
  const wrap = document.getElementById("coverpreviewwrap");
  const warningsList = document.getElementById("coverwarnings");
  const caption = document.getElementById("covercaption");
  let file = null, url = null, originalFileName = null;
  let previewFile = null, previewUrl = null;

  // No-op when nothing is selected ("None", or no printed product) —
  // the upload block is hidden in that state regardless.
  function updateSizing(){
    const spec = coverSpec();
    if(!spec) return;
    const { dataMm } = spec;
    wrap.style.width = "100%";
    wrap.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderCoverFileMeta(currentName, originalName, statusText){
    meta.textContent = "";
    meta.append(statusText ? `file: ${currentName} — ${statusText}` : `file: ${currentName}`);
    if(originalName && originalName !== currentName){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  }

  // Swaps the preview box to a plant-generated preview image, taking
  // priority over the live-rendered original — see applyCoverSlotFile
  // below, the only caller (a fresh manual pick never has one to show
  // yet). Reuses the existing file-meta status-text slot instead of
  // adding new markup/CSS for a separate caption.
  function showPreviewImage(previewImgFile){
    previewFile = previewImgFile;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${previewUrl}" alt="plant preview">`;
    renderCoverFileMeta(file.name, originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyCoverSlotFile passes the name recorded before renaming, on a
  // project reload, so renderCoverFileMeta can show it as the "was:" line.
  async function handleFile(f, origName = f.name){
    file = f;
    originalFileName = origName;
    meta.classList.remove("empty");
    renderCoverFileMeta(f.name, origName, "checking…");
    if(url) URL.revokeObjectURL(url);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null;
    previewUrl = null;

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = await parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm, trimMm } = coverSpec();
    const printCheck = getFormat(CONFIG, coverCurrentFormat()).printCheck;
    renderCoverChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}). Safari's
      // built-in PDF viewer renders its own margin inside the page content
      // itself — not reachable or fixable from the host page (verified: a
      // CSS-transform-scale attempt scaled that margin right along with
      // it) — so Safari shows a grey margin around the artwork here;
      // Chrome/Firefox fill exactly.
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    renderCoverFileMeta(f.name, origName, null);
  }

  // A file picked for one product is sized for that product's dataMm —
  // switching product or format invalidates it outright (see
  // initCover's listeners), rather than leaving a now-wrong-size file
  // attached.
  function clear(){
    if(url) URL.revokeObjectURL(url);
    file = null; url = null; originalFileName = null;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null; previewUrl = null;
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warningsList.innerHTML = "";
  }

  document.getElementById("coverpick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> previewFile
  };
}

function coverSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"cover", ext: fileExt(file.name)});
}

async function collectCoverSlotFile(){
  const file = coverSlot.getFile();
  if(!file) return null;
  return { name: coverSlotFileName(file), data: await file.arrayBuffer() };
}

let coverSlot;

function updateCoverMode(){
  document.getElementById("coverPrintedBody").classList.toggle("hidden", !coverHasArtwork());
}

// Rebuilds the product dropdown from CONFIG for the current format —
// a plain "None" option first, then options grouped by kind
// (Printed/Unprinted). Resets to "None" on every rebuild.
function populateCoverProducts(){
  const select = document.getElementById("coverProduct");
  const products = coverProducts();
  const { printed, unprinted } = groupProductsByKind(products);
  select.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "None";
  select.appendChild(noneOpt);
  const addGroup = (label, list) => {
    if(!list.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for(const p of list){
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  };
  addGroup("Printed", printed);
  addGroup("Unprinted", unprinted);
  select.value = "";
}

// Populates the Specifications disclosure from the selected product —
// shows "—" in every field when "None" is selected, since there's no
// product to read values from.
function renderCoverSpecs(){
  const part = coverSpec();
  const colorMode = getFormat(CONFIG, coverCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
  document.getElementById("coverSpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
  document.getElementById("coverSpecColorMode").textContent = colorMode;
  document.getElementById("coverSpecWeightRow").classList.toggle("hidden", !isDebugMode() || !part);
  if(!part){
    document.getElementById("coverSpecEndFormat").textContent = "—";
    document.getElementById("coverSpecDataFormat").textContent = "—";
    document.getElementById("coverSpecBleed").textContent = "—";
    document.getElementById("coverSpecSpine").textContent = "—";
    document.getElementById("coverSpecPaperGsm").textContent = "—";
    document.getElementById("coverSpecCutout").textContent = "—";
    document.getElementById("coverSpecWeight").textContent = "—";
    return;
  }
  const { trimMm, spineMm, bleedMm, paperGsm, cutoutDiameterMm, dataMm } = part;
  document.getElementById("coverSpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
  document.getElementById("coverSpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
  document.getElementById("coverSpecBleed").textContent = `${bleedMm}mm`;
  document.getElementById("coverSpecSpine").textContent = `${spineMm}mm`;
  document.getElementById("coverSpecPaperGsm").textContent = `${paperGsm}gsm`;
  document.getElementById("coverSpecCutout").textContent = cutoutDiameterMm ? `⌀${cutoutDiameterMm}mm` : "none";
  // Shipping weight — plant/?debug eyes only, not customer-facing yet.
  document.getElementById("coverSpecWeight").textContent = `${partWeightG(part)}g`;
}

export function initCover(){
  coverSlot = createCoverArtworkSlot();
  populateCoverProducts();
  coverSlot.updateSizing();
  document.getElementById("coverinput").accept = CONFIG.artworkFileTypes.accept;
  renderCoverSpecs();
  updateCoverMode();

  document.getElementById("format").addEventListener("change", ()=>{
    coverSlot.clear();
    populateCoverProducts();
    coverSlot.updateSizing();
    renderCoverSpecs();
    updateCoverMode();
  });

  document.getElementById("coverProduct").addEventListener("change", ()=>{
    coverSlot.clear();
    coverSlot.updateSizing();
    renderCoverSpecs();
    updateCoverMode();
  });
}

function setCoverFileNamePlaceholder(name, originalName){
  const meta = document.getElementById("covermeta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "";
    meta.append(`file: ${name} — please re-select this file (not stored in the order file)`);
    if(originalName && originalName !== name){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

// fileMap: canonical package name -> File, from a reopened project zip
// (see tracklist.js's loadProject). If the slot's stored name is in the
// map, the file gets re-attached directly; otherwise it falls back to
// the "please re-select" placeholder.
async function applyCoverSlotFile(fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    await coverSlot.setFile(file, originalFileName || fileName);
    const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"cover"});
    const previewImg = fileMap && fileMap.get(previewName);
    if(previewImg) coverSlot.setPreviewImage(previewImg);
  } else {
    setCoverFileNamePlaceholder(fileName, originalFileName);
  }
}

// Exported for the tracklist module's project save/load, same
// collect/apply pattern as vinyl-color.js/shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// collectCoverFiles below builds the exact same name for the actual
// file. A non-null fileName always means the file is actually in the
// package, which is what lets the tracklist/order-summary exports build
// their file manifest straight from this data, no DOM re-check needed.
export function collectCover(){
  const product = selectedCoverProduct();
  const file = coverSlot.getFile();
  const printed = !!product && product.kind === "printed";
  return {
    productId: product ? product.id : null,
    fileName: (printed && file) ? coverSlotFileName(file) : null,
    originalFileName: (printed && file) ? coverSlot.getOriginalFileName() : null
  };
}

export async function applyCover(data, fileMap){
  const c = data || {};
  const match = productById(coverProducts(), c.productId);
  document.getElementById("coverProduct").value = match ? match.id : "";
  await applyCoverSlotFile(c.fileName, c.originalFileName, fileMap);
  updateCoverMode();
  coverSlot.updateSizing();
  renderCoverSpecs();
}

// Exported for the tracklist module's package export, same pattern as
// labels.js's collectLabelFiles — the only interface between modules.
export async function collectCoverFiles(){
  const files = [];
  if(coverHasArtwork()){
    const cover = await collectCoverSlotFile();
    if(cover) files.push(cover);
    const previewImg = coverSlot.getPreviewFile();
    if(previewImg){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"cover"});
      files.push({name, data: await previewImg.arrayBuffer()});
    }
  }
  return files;
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/modules/cover.js`
Expected: no output.

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cover.js src/index.html
git commit -m "cover: replace mode/colour controls with a product dropdown"
```

---

### Task 5: Inlay module — product dropdown

**Files:**
- Modify: `src/modules/inlay.js`
- Modify: `src/index.html:580-642` (Inlay section)

**Interfaces:**
- Consumes: same helpers as Tasks 3–4, plus `CONFIG.formats[i].printableParts.inlay.products` (Task 2, always `kind:"printed"` entries only).
- Produces: `collectInlay() -> { productId, front: {fileName, originalFileName}, back: {fileName, originalFileName} }`, `applyInlay(data, fileMap) -> Promise<void>` — same exported names/signatures as before, `include` replaced by `productId !== null`.

- [ ] **Step 1: Replace the markup**

Replace the Inlay section's heading, Specifications block, and the `include inlay` checkbox row (currently lines ~581–599) with:

```html
  <!-- ============ INLAY ============ -->
  <section>
    <h2>Inlay</h2>
    <details class="specs no-print">
      <summary>Specifications</summary>
      <div class="specs-body">
        <div><span>Allowed filetypes</span><span id="inlaySpecFiletypes"></span></div>
        <div><span>Colour mode</span><span id="inlaySpecColorMode"></span></div>
        <div><span>End format</span><span id="inlaySpecEndFormat"></span></div>
        <div><span>Data format</span><span id="inlaySpecDataFormat"></span></div>
        <div><span>Bleed</span><span id="inlaySpecBleed"></span></div>
        <div><span>Paper weight</span><span id="inlaySpecPaperGsm"></span></div>
        <div id="inlaySpecWeightRow" class="hidden"><span>Shipping weight</span><span id="inlaySpecWeight"></span></div>
      </div>
    </details>
    <div class="row">
      <div class="field" style="flex:0 0 auto;">
        <label>Product</label>
        <select id="inlayProduct"></select>
      </div>
    </div>
```

(The `<div id="inlayBody" class="hidden">...</div>` block right after it, and the `</section>` closing it, are untouched.)

- [ ] **Step 2: Replace the module logic**

Replace the full contents of `src/modules/inlay.js` with:

```js
// Inlay module — one product per selection from the plant's inlay
// catalog (currently just "printed" — inlay never has an unprinted
// kind, since printing is the entire point of an inlay) — see
// CONFIG.formats[i].printableParts.inlay.products and the packaging
// product catalog design spec. Delivered as two separate square pages
// (unlike cover.js/inner-sleeve.js's single flat spread, since an inlay
// is printed on both sides of one physical sheet). No page count/
// booklet support — explicitly deferred, see the catalogue schema
// restructure design spec. Split out of the former cover-sleeve.js
// along with cover.js and inner-sleeve.js (Decision 8) — each owns its
// own copy of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

const INLAY_PREVIEW_MAX_W = 640;

function inlayCurrentFormat(){
  return document.getElementById("format").value;
}

function inlayProducts(){
  return getFormat(CONFIG, inlayCurrentFormat()).printableParts.inlay.products;
}

function selectedInlayProduct(){
  return productById(inlayProducts(), document.getElementById("inlayProduct").value || null);
}

function inlayIncluded(){
  return !!selectedInlayProduct();
}

// dataMm is derived (trim + bleed — a single flat sheet, no spine/
// folding), not a stored field. undefined when "None" is selected.
function inlaySpec(){
  const part = selectedInlayProduct();
  return part && { ...part, dataMm: flatDataMm(part) };
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderInlayChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode());
  tableEl.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
  const tbody = document.createElement("tbody");
  for(const row of rows){
    const tr = document.createElement("tr");
    tr.className = row.severity;
    for(const text of [CHECKLIST_ICON[row.severity], row.feature, row.detected, row.expected || ""]){
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  tableEl.appendChild(tbody);
}

// prefix is "inlayfront" or "inlayback" — the two sides share this
// scaffolding (unlike cover.js/inner-sleeve.js, which each have exactly
// one slot), since front/back are otherwise identical.
function createInlayArtworkSlot(prefix){
  const input = document.getElementById(prefix+"input");
  const meta = document.getElementById(prefix+"meta");
  const preview = document.getElementById(prefix+"preview");
  const wrap = document.getElementById(prefix+"previewwrap");
  const warningsList = document.getElementById(prefix+"warnings");
  let file = null, url = null, originalFileName = null;
  let previewFile = null, previewUrl = null;

  // No-op when nothing is selected ("None") — the upload block is
  // hidden in that state regardless.
  function updateSizing(){
    const spec = inlaySpec();
    if(!spec) return;
    const { dataMm } = spec;
    wrap.style.width = "100%";
    wrap.style.maxWidth = INLAY_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderInlayFileMeta(currentName, originalName, statusText){
    meta.textContent = "";
    meta.append(statusText ? `file: ${currentName} — ${statusText}` : `file: ${currentName}`);
    if(originalName && originalName !== currentName){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  }

  // Swaps the preview box to a plant-generated preview image, taking
  // priority over the live-rendered original — see applyInlaySlotFile
  // below, the only caller (a fresh manual pick never has one to show
  // yet). Reuses the existing file-meta status-text slot instead of
  // adding new markup/CSS for a separate caption. Shared by both the
  // front and back slots (this factory is called once per side).
  function showPreviewImage(previewImgFile){
    previewFile = previewImgFile;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${previewUrl}" alt="plant preview">`;
    renderInlayFileMeta(file.name, originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyInlaySlotFile passes the name recorded before renaming, on a
  // project reload, so renderInlayFileMeta can show it as the "was:" line.
  async function handleFile(f, origName = f.name){
    file = f;
    originalFileName = origName;
    meta.classList.remove("empty");
    renderInlayFileMeta(f.name, origName, "checking…");
    if(url) URL.revokeObjectURL(url);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null;
    previewUrl = null;

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = await parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm, trimMm } = inlaySpec();
    const printCheck = getFormat(CONFIG, inlayCurrentFormat()).printCheck;
    renderInlayChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    renderInlayFileMeta(f.name, origName, null);
  }

  // A file picked for one product is sized for that product's dataMm —
  // switching product or format invalidates it outright (see
  // initInlay's listeners), rather than leaving a now-wrong-size file
  // attached.
  function clear(){
    if(url) URL.revokeObjectURL(url);
    file = null; url = null; originalFileName = null;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null; previewUrl = null;
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warningsList.innerHTML = "";
  }

  document.getElementById(prefix+"pick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> previewFile
  };
}

function inlaySlotFileName(variant, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant, ext: fileExt(file.name)});
}

async function collectInlaySlotFile(slot, variant){
  const file = slot.getFile();
  if(!file) return null;
  return { name: inlaySlotFileName(variant, file), data: await file.arrayBuffer() };
}

let inlayFrontSlot, inlayBackSlot;

function updateInlayVisibility(){
  document.getElementById("inlayBody").classList.toggle("hidden", !inlayIncluded());
}

// Rebuilds the product dropdown from CONFIG for the current format —
// a plain "None" option first, then options grouped by kind (the
// "Unprinted" group is always empty for inlay, so addGroup skips it).
function populateInlayProducts(){
  const select = document.getElementById("inlayProduct");
  const products = inlayProducts();
  const { printed, unprinted } = groupProductsByKind(products);
  select.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "None";
  select.appendChild(noneOpt);
  const addGroup = (label, list) => {
    if(!list.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for(const p of list){
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  };
  addGroup("Printed", printed);
  addGroup("Unprinted", unprinted);
  select.value = "";
}

// Populates the Specifications disclosure from the selected product —
// shows "—" in every field when "None" is selected.
function renderInlaySpecs(){
  const part = inlaySpec();
  const colorMode = getFormat(CONFIG, inlayCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
  document.getElementById("inlaySpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
  document.getElementById("inlaySpecColorMode").textContent = colorMode;
  document.getElementById("inlaySpecWeightRow").classList.toggle("hidden", !isDebugMode() || !part);
  if(!part){
    document.getElementById("inlaySpecEndFormat").textContent = "—";
    document.getElementById("inlaySpecDataFormat").textContent = "—";
    document.getElementById("inlaySpecBleed").textContent = "—";
    document.getElementById("inlaySpecPaperGsm").textContent = "—";
    document.getElementById("inlaySpecWeight").textContent = "—";
    return;
  }
  const { trimMm, bleedMm, paperGsm, dataMm } = part;
  document.getElementById("inlaySpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
  document.getElementById("inlaySpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
  document.getElementById("inlaySpecBleed").textContent = `${bleedMm}mm`;
  document.getElementById("inlaySpecPaperGsm").textContent = `${paperGsm}gsm`;
  // Shipping weight — plant/?debug eyes only, not customer-facing yet.
  document.getElementById("inlaySpecWeight").textContent = `${partWeightG(part)}g`;
}

export function initInlay(){
  inlayFrontSlot = createInlayArtworkSlot("inlayfront");
  inlayBackSlot = createInlayArtworkSlot("inlayback");
  populateInlayProducts();
  [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
  document.getElementById("inlayfrontinput").accept = CONFIG.artworkFileTypes.accept;
  document.getElementById("inlaybackinput").accept = CONFIG.artworkFileTypes.accept;
  renderInlaySpecs();
  updateInlayVisibility();

  document.getElementById("format").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=> s.clear());
    populateInlayProducts();
    [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
    renderInlaySpecs();
    updateInlayVisibility();
  });

  document.getElementById("inlayProduct").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.clear(); s.updateSizing(); });
    renderInlaySpecs();
    updateInlayVisibility();
  });
}

function setInlayFileNamePlaceholder(prefix, name, originalName){
  const meta = document.getElementById(prefix+"meta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "";
    meta.append(`file: ${name} — please re-select this file (not stored in the order file)`);
    if(originalName && originalName !== name){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

async function applyInlaySlotFile(slot, prefix, variant, fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    await slot.setFile(file, originalFileName || fileName);
    const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant});
    const previewImg = fileMap && fileMap.get(previewName);
    if(previewImg) slot.setPreviewImage(previewImg);
  } else {
    setInlayFileNamePlaceholder(prefix, fileName, originalFileName);
  }
}

export function collectInlay(){
  const product = selectedInlayProduct();
  const nameFor = (slot, variant) => {
    if(!product) return null;
    const file = slot.getFile();
    return file ? inlaySlotFileName(variant, file) : null;
  };
  const originalNameFor = (slot) => product && slot.getFile() ? slot.getOriginalFileName() : null;
  return {
    productId: product ? product.id : null,
    front: {
      fileName: nameFor(inlayFrontSlot, "front"),
      originalFileName: originalNameFor(inlayFrontSlot)
    },
    back: {
      fileName: nameFor(inlayBackSlot, "back"),
      originalFileName: originalNameFor(inlayBackSlot)
    }
  };
}

export async function applyInlay(data, fileMap){
  const inlay = data || {};
  const match = productById(inlayProducts(), inlay.productId);
  document.getElementById("inlayProduct").value = match ? match.id : "";
  await applyInlaySlotFile(inlayFrontSlot, "inlayfront", "front", inlay.front && inlay.front.fileName, inlay.front && inlay.front.originalFileName, fileMap);
  await applyInlaySlotFile(inlayBackSlot, "inlayback", "back", inlay.back && inlay.back.fileName, inlay.back && inlay.back.originalFileName, fileMap);
  updateInlayVisibility();
  [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
  renderInlaySpecs();
}

export async function collectInlayFiles(){
  const files = [];
  if(inlayIncluded()){
    const front = await collectInlaySlotFile(inlayFrontSlot, "front");
    if(front) files.push(front);
    const frontPreview = inlayFrontSlot.getPreviewFile();
    if(frontPreview){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant:"front"});
      files.push({name, data: await frontPreview.arrayBuffer()});
    }
    const back = await collectInlaySlotFile(inlayBackSlot, "back");
    if(back) files.push(back);
    const backPreview = inlayBackSlot.getPreviewFile();
    if(backPreview){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant:"back"});
      files.push({name, data: await backPreview.arrayBuffer()});
    }
  }
  return files;
}
```

- [ ] **Step 3: Syntax-check**

Run: `node --check src/modules/inlay.js`
Expected: no output.

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143.

- [ ] **Step 5: Commit**

```bash
git add src/modules/inlay.js src/index.html
git commit -m "inlay: replace include checkbox with a product dropdown"
```

---

### Task 6: `tracklist.js` — order summary reads product names

**Files:**
- Modify: `src/modules/tracklist.js:14` (import line)
- Modify: `src/modules/tracklist.js` — `packagingSection` function (currently ~lines 888–911)

**Interfaces:**
- Consumes: `productById` from `src/lib/format-catalogue.js` (Task 1); `project.coverSleeve.{cover,innerSleeve,inlay}.productId` as produced by Tasks 3–5's `collectCover`/`collectInnerSleeve`/`collectInlay`; `getFormat(CONFIG, project.format).printableParts.{outerCover,innerSleeve,inlay}.products` (Task 2).
- Produces: `packagingSection(project)` — same signature, called from the same place, now reading product names instead of mode/colour strings.

- [ ] **Step 1: Update the import line**

Change line 14 of `src/modules/tracklist.js` from:

```js
import { getFormat, enabledFormats, firstEnabledFormat } from "../lib/format-catalogue.js";
```

to:

```js
import { getFormat, enabledFormats, firstEnabledFormat, productById } from "../lib/format-catalogue.js";
```

- [ ] **Step 2: Replace `packagingSection`**

Replace the full `packagingSection` function with:

```js
// Full packaging spec — what each selected product actually IS (its
// name, plus filename + the customer's original filename when
// printed), not just its bare name (filesManifestSection above is a
// flat file list for a quick zip cross-check; this reads like a
// production instruction). order_summary.txt only, same reasoning as
// filesManifestSection above — the mastering engineer and graphics
// department already have the files, they don't need them described
// back to them either.
function packagingSection(project){
  const c = project.coverSleeve;
  const parts = getFormat(CONFIG, project.format).printableParts;
  const withOriginal = (fileName, originalFileName) =>
    (fileName || "(no file)") + (originalFileName && originalFileName !== fileName ? ` (was: ${originalFileName})` : "");

  let out = "PACKAGING:\n";

  const coverProduct = productById(parts.outerCover.products, c.cover.productId);
  out += !coverProduct
    ? `  Cover: none\n`
    : coverProduct.kind === "printed"
      ? `  Cover: ${coverProduct.name} — ${withOriginal(c.cover.fileName, c.cover.originalFileName)}\n`
      : `  Cover: ${coverProduct.name}\n`;

  const sleeveProduct = productById(parts.innerSleeve.products, c.innerSleeve.productId);
  out += !sleeveProduct
    ? `  Inner sleeve: (unrecognized product)\n`
    : sleeveProduct.kind === "printed"
      ? `  Inner sleeve: ${sleeveProduct.name} — ${withOriginal(c.innerSleeve.fileName, c.innerSleeve.originalFileName)}\n`
      : `  Inner sleeve: ${sleeveProduct.name}\n`;

  const inlayProduct = productById(parts.inlay.products, c.inlay.productId);
  out += inlayProduct
    ? `  Inlay: front — ${withOriginal(c.inlay.front.fileName, c.inlay.front.originalFileName)}\n`
      + `         back  — ${withOriginal(c.inlay.back.fileName, c.inlay.back.originalFileName)}\n`
    : `  Inlay: none\n`;

  return out + "\n";
}
```

(`filesManifestSection`, right above it, is unchanged — it only reads `.fileName` fields, whose meaning hasn't changed.)

- [ ] **Step 3: Syntax-check**

Run: `node --check src/modules/tracklist.js`
Expected: no output.

- [ ] **Step 4: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tracklist.js
git commit -m "order summary: read packaging product names instead of mode/colour strings"
```

---

### Task 7: CSS cleanup — remove on-screen divider lines

**Files:**
- Modify: `src/index.html` (the `<style>` block, top of file)

**Interfaces:** none (pure CSS, no id/class removed that any JS reads — `.hidden`, `.track-row`, `.side-total`, `.labelwarnings`, `.foot`, `section` all keep their class names, only their border rules change).

- [ ] **Step 1: Remove `section`'s divider**

Change:

```css
  section{ border-bottom:1px solid var(--edge); margin-bottom:20px; }
```

to:

```css
  section{ margin-bottom:20px; }
```

- [ ] **Step 2: Remove `.track-row`'s divider and its now-dead override**

Change:

```css
  .track-row{
    display:grid;
    grid-template-columns: 42px 26px 1fr 1fr 84px 150px 24px;
    gap:6px; align-items:center;
    padding:6px 4px; border-bottom:1px solid var(--edge);
  }
  .track-row:last-child{ border-bottom:none; }
```

to:

```css
  .track-row{
    display:grid;
    grid-template-columns: 42px 26px 1fr 1fr 84px 150px 24px;
    gap:6px; align-items:center;
    padding:6px 4px;
  }
```

(The `.track-row:last-child` rule only existed to cancel the border-bottom being removed here, so it's deleted outright, not left as a no-op.)

- [ ] **Step 3: Remove `.side-total`'s divider**

Change:

```css
  .side-total{
    margin-top:12px; padding-bottom:10px; border-bottom:1px solid var(--edge);
    display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;
  }
```

to:

```css
  .side-total{
    margin-top:12px; padding-bottom:10px;
    display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;
  }
```

- [ ] **Step 4: Remove `.labelwarnings th`'s divider**

Change:

```css
  .labelwarnings th{ text-align:left; font-weight:600; color:var(--ink-dim); padding:2px 8px 2px 0; border-bottom:1px solid var(--edge); }
```

to:

```css
  .labelwarnings th{ text-align:left; font-weight:600; color:var(--ink-dim); padding:2px 8px 2px 0; }
```

- [ ] **Step 5: Remove `.foot`'s divider**

Change:

```css
  .foot{
    margin-top:24px; padding-top:12px; border-top:1px solid var(--edge);
    font-size:10px; color:var(--ink-dim); letter-spacing:.03em;
  }
```

to:

```css
  .foot{
    margin-top:24px; padding-top:12px;
    font-size:10px; color:var(--ink-dim); letter-spacing:.03em;
  }
```

(Leave the `@media print` block's `input[type=text], input[type=number], select, textarea{ ...border-bottom:1px solid var(--edge)... }` rule untouched — it's the deliberate "blank line to fill in on the printed sheet" convention, not a layout divider, and out of scope per the spec.)

- [ ] **Step 6: Run the full test suite**

Run: `node --test tests/`
Expected: PASS, 143/143 (pure CSS, but confirms nothing else broke in the same commit).

- [ ] **Step 7: Commit**

```bash
git add src/index.html
git commit -m "remove on-screen divider lines; spacing alone separates blocks now"
```

---

### Task 8: Build and final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite one more time**

Run: `node --test tests/`
Expected: PASS, 143/143.

- [ ] **Step 2: Build**

Run: `node build/build.js`
Expected: `built .../dist/index.html (NN.N KB)` with no errors.

- [ ] **Step 3: Grep for leftover references to removed identifiers**

Run: `grep -rn "innersleeveColor\|innersleeveCutout\|coverColor\|inlayInclude\|cover-printed\b\|cover-unprinted\|cover-none\|innersleeve-printed\|innersleeve-unprinted\|unprintedColors\|centerCutoutDefault" src/`
Expected: no matches — these are the old mode-radio/colour-select/cutout-checkbox ids and the old config fields (`unprintedColors`, `centerCutoutDefault`) that Task 2 removed from `config.js`.

- [ ] **Step 4: Manual browser check**

Per this project's established practice (ask before using Claude-in-Chrome for live verification — see project memory), ask the user to confirm before doing any automated browser verification. Otherwise, report the change is ready for the user's own manual check: open `dist/index.html`, and for each of Inner Sleeve / Outer Cover / Inlay confirm (a) the dropdown lists the expected products grouped Printed/Unprinted, (b) selecting a printed product shows the artwork upload block and the other kind hides it, (c) the Specifications panel updates per selection (and shows `—` for cover/inlay's `None`), (d) Save Project → Load Project round-trips the selected product per category, (e) `order_summary.txt` inside the saved zip shows the expected `PACKAGING:` lines.

- [ ] **Step 5: Report to the user**

Summarize: files changed, test count, build output, and that manual browser verification is the user's to run (per this project's practice) before considering the change fully done.
