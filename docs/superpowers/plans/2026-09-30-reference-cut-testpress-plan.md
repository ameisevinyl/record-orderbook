# Reference cut and testpress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two more products on the customer form: a reference cut (one acetate, a checkbox) and a testpress (a quantity, default 3), each enabled per format, carried through project.json, the two text files and the plant view.

**Architecture:** Plant values go in `CONFIG` (per-format switches and plant-wide numbers), validated in `config-validation.js`. There is one pure rule (`src/lib/proofs.js`: the soft note) and one new DOM module (`src/modules/proofs.js`) with the usual `init`/`collect`/`apply`/issues exports that `tracklist.js` calls. project.json gets `proofs: {referenceCut, testpresses}`. It's normalised in `prepareProject` and read by `order-documents.js`, `plant-overview.js` and `completeness.js`.

**Tech Stack:** Plain ES modules and `node --test`; zero dependencies; `build/build.js` flattens `src/` into `dist/index.html`.

**Spec:** `docs/superpowers/specs/2026-09-30-reference-cut-testpress-design.md`

## Global Constraints

- No runtime dependencies. `dist/index.html` stays one self-contained file.
- Plant-specific values live only in `CONFIG` (`src/config.js`).
- Every file in `build/build.js` FILES shares one top-level scope. A new top-level name must not exist in any other built file (check: `grep -rn "function <name>\|const <name>" src/lib src/modules src/*.js`).
- Comments are short and say why, not what. Match the surrounding style (2-space indent, `function`, no semicolon-free style).
- Soft note text, verbatim: `Testpresses are not recommended for small runs (<${recommendedFromQty}). If you want to check your mix and master, order a reference cut.`
- Info texts (en), verbatim:
  - referenceCut: `A one-off acetate cut from your master, to hear the cut before the lacquers are made. Unsure about your mix or master? Order a reference cut.`
  - testpress: `The first records from the stamper, to check the pressing for real errors before the run — not for judging mix or master (that's the reference cut). Recommended for runs of 1,000 records or more.`
- Run `node --test tests/` before every commit. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Switching to a format that doesn't offer a product while it's ticked: it must be hidden, unticked and saved as none (`testpresses: 0`, `referenceCut: false`). Covered in Task 3 (`prepareProject` forces off) and Task 6 (form reset).
2. A project saved before this feature (no `proofs` key) must load and show none ordered. Covered in Task 3.
3. A testpress ticked with an empty or zero quantity must show an order-checklist issue before it's saved as `testpresses: 0`, so it isn't dropped silently. Covered in Task 6 (`proofIssues`).
4. The run total counts every colour row, and an invalid row counts as 0: 300 black + "abc" red = 300. Covered in Task 2 (the rule takes a number) and Task 6 (the total from `getColorBreakdown`, which already skips invalid rows).
5. A reference cut ordered for a side-B-blank release still appears in both text headers. Covered in Task 4.

---

### Task 1: Config, validation, spec note

**Files:**
- Modify: `src/config.js` (the three formats, plant-wide `proofs`, `infoText`)
- Modify: `src/lib/config-validation.js`
- Modify: `docs/superpowers/specs/2026-09-30-reference-cut-testpress-design.md` (note placement)
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces: `format.proofs = {referenceCut: boolean, testpress: boolean}` on every format. `CONFIG.proofs = {testpressDefaultQty: 3, testpressRecommendedFromQty: 1000}`. `CONFIG.infoText.referenceCut.en` and `CONFIG.infoText.testpress.en`.

- [ ] **Step 1: Write the failing test** (append to `tests/config-validation.test.js`)

```js
test("validates per-format proofs switches and the plant-wide testpress numbers", () => {
  const missing = copy();
  delete missing.formats[0].proofs;
  assert.throws(() => validateConfig(missing), /CONFIG\.formats\[0\]\.proofs must be an object/);

  const notBool = copy();
  notBool.formats[0].proofs.testpress = "yes";
  assert.throws(() => validateConfig(notBool), /CONFIG\.formats\[0\]\.proofs\.testpress must be a boolean/);

  const qty = copy();
  qty.proofs.testpressDefaultQty = 0;
  assert.throws(() => validateConfig(qty), /CONFIG\.proofs\.testpressDefaultQty must be a positive integer/);

  const threshold = copy();
  threshold.proofs.testpressRecommendedFromQty = -1;
  assert.throws(() => validateConfig(threshold), /CONFIG\.proofs\.testpressRecommendedFromQty must be a nonnegative integer/);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/config-validation.test.js`
Expected: the new test fails; `validateConfig` accepts every copy.

- [ ] **Step 3: Add the config**

In `src/config.js`, add one line after each format's `centerHole: …` line (three places: 12", 10", 7"):

```js
      proofs: { referenceCut: true, testpress: true },
```

After the `vinylColor: {…},` block, add:

```js
  // Reference cut (one acetate) and testpress (the first records off the
  // stamper), each offered per format in formats[i].proofs. A ticked
  // testpress starts at testpressDefaultQty; below
  // testpressRecommendedFromQty records in the run the form shows a
  // soft note pointing to the reference cut.
  proofs: {
    testpressDefaultQty: 3,
    testpressRecommendedFromQty: 1000
  },
```

In `infoText`, after `labelArtwork: {…}`, add:

```js
    referenceCut: {
      en: `A one-off acetate cut from your master, to hear the cut before the lacquers are made. Unsure about your mix or master? Order a reference cut.`
    },
    testpress: {
      en: `The first records from the stamper, to check the pressing for real errors before the run — not for judging mix or master (that's the reference cut). Recommended for runs of 1,000 records or more.`
    }
```

- [ ] **Step 4: Validate it** in `src/lib/config-validation.js`

Add after `validateVinylColor`:

```js
function integer(value, path, allowZero = false){
  if(!Number.isInteger(value) || (allowZero ? value < 0 : value <= 0)){
    fail(path, `must be a ${allowZero ? "nonnegative" : "positive"} integer`);
  }
}

function validateProofs(value){
  const proofs = object(value, "CONFIG.proofs");
  integer(proofs.testpressDefaultQty, "CONFIG.proofs.testpressDefaultQty");
  integer(proofs.testpressRecommendedFromQty, "CONFIG.proofs.testpressRecommendedFromQty", true);
}
```

In `validateConfig`'s `formats.forEach`, after the `validateProducts(…)` line:

```js
    const proofs = object(format.proofs, `${path}.proofs`);
    for(const name of ["referenceCut", "testpress"]){
      if(typeof proofs[name] !== "boolean") fail(`${path}.proofs.${name}`, "must be a boolean");
    }
```

And after `validateVinylColor(config.vinylColor);`:

```js
  validateProofs(config.proofs);
```

No other built file declares a top-level `integer` (checked when writing this plan).

- [ ] **Step 5: Run the tests and check they pass**

Run: `node --test tests/`
Expected: all pass, including "validates and returns the committed CONFIG".

- [ ] **Step 6: Note the placement in the spec**

In the spec, replace the Decisions bullet that starts "A testpress for a run under the threshold gives a soft, non-blocking note in the order checklist." with:

```
- A testpress for a run under the threshold shows a soft note in the
  Reference cut & Testpress section itself — not in the order
  checklist, whose flagged items trigger the "send anyway" warning.
```

In the "Form" section, replace "An empty field or one below 1 is an issue in the order checklist, like other quantities." with "An empty field or one below 1 is an issue in the order checklist, like other quantities. The soft note sits under the testpress row and follows the colour quantities."

- [ ] **Step 7: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/config-validation.test.js docs/superpowers/specs/2026-09-30-reference-cut-testpress-design.md
git commit -m "config: reference cut and testpress per format, testpress numbers, info texts"
```

---

### Task 2: The soft-note rule

**Files:**
- Create: `src/lib/proofs.js`
- Test: `tests/proofs.test.js`
- Modify: `build/build.js` (FILES)

**Interfaces:**
- Produces: `testpressNote(testpresses: number, totalQty: number, recommendedFromQty: number) -> string | null`

- [ ] **Step 1: Write the failing test** (`tests/proofs.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { testpressNote } from "../src/lib/proofs.js";

const NOTE = "Testpresses are not recommended for small runs (<1000). If you want to check your mix and master, order a reference cut.";

test("testpressNote: a testpress for a run under the threshold gets the note", () => {
  assert.equal(testpressNote(3, 300, 1000), NOTE);
  assert.equal(testpressNote(1, 0, 1000), NOTE);
  assert.equal(testpressNote(3, 999, 1000), NOTE);
});

test("testpressNote: no note at or above the threshold, or without a testpress", () => {
  assert.equal(testpressNote(3, 1000, 1000), null);
  assert.equal(testpressNote(3, 5000, 1000), null);
  assert.equal(testpressNote(0, 300, 1000), null);
});

test("testpressNote: the threshold comes from the caller", () => {
  assert.match(testpressNote(3, 100, 500), /\(<500\)/);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/proofs.test.js`
Expected: FAIL; the module can't be found.

- [ ] **Step 3: Implement** (`src/lib/proofs.js`)

```js
// Pure rules for the reference cut and testpress; no DOM.

// A testpress checks the pressing, and for a small run a reference cut
// is the better buy — the form says so, it doesn't block.
export function testpressNote(testpresses, totalQty, recommendedFromQty){
  if(!(testpresses > 0) || totalQty >= recommendedFromQty) return null;
  return `Testpresses are not recommended for small runs (<${recommendedFromQty}). If you want to check your mix and master, order a reference cut.`;
}
```

In `build/build.js` FILES, add `"src/lib/proofs.js",` after `"src/lib/vinyl-color.js",`.

- [ ] **Step 4: Run the tests and build**

Run: `node --test tests/ && node build/build.js`
Expected: all pass; the build prints `built …/dist/index.html`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proofs.js tests/proofs.test.js build/build.js
git commit -m "testpressNote: soft note for a testpress on a small run"
```

---

### Task 3: project.json `proofs`

**Files:**
- Modify: `src/lib/project.js` (`prepareProject`, after the `vinylColor` block)
- Test: `tests/project.test.js`

**Interfaces:**
- Consumes: `format.proofs` (Task 1).
- Produces: every prepared project has `project.proofs = {referenceCut: boolean, testpresses: integer >= 0}`. Anything the format doesn't offer is forced to `false`/`0`.

- [ ] **Step 1: Write the failing test** (append to `tests/project.test.js`)

The fixture `config` at the top of this file has no `proofs` on its formats. Add `proofs: {referenceCut: true, testpress: true}` to the `"12"` format and `proofs: {referenceCut: false, testpress: false}` to the `"10"` format, then append:

```js
test("prepareProject: proofs default to none, keep valid values, reject bad ones", () => {
  const none = prepareProject({projectVersion:1, format:"12"}, config);
  assert.deepEqual(none.proofs, {referenceCut:false, testpresses:0});

  const ordered = prepareProject({projectVersion:1, format:"12", proofs:{referenceCut:true, testpresses:3}}, config);
  assert.deepEqual(ordered.proofs, {referenceCut:true, testpresses:3});

  assert.throws(() => prepareProject({projectVersion:1, format:"12", proofs:{testpresses:-1}}, config),
    /project\.proofs\.testpresses must be a nonnegative integer/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", proofs:{testpresses:"3"}}, config),
    /project\.proofs\.testpresses must be a nonnegative integer/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", proofs:{referenceCut:"yes"}}, config),
    /project\.proofs\.referenceCut/);
});

test("prepareProject: a format without proofs drops them", () => {
  const project = prepareProject({projectVersion:1, format:"10", proofs:{referenceCut:true, testpresses:3}}, config);
  assert.deepEqual(project.proofs, {referenceCut:false, testpresses:0});
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/project.test.js`
Expected: the new tests fail; `none.proofs` is undefined.

- [ ] **Step 3: Implement** in `src/lib/project.js`, directly after the `project.vinylColor = project.vinylColor.map(…);` statement:

```js
  // A product the format doesn't offer is dropped, like a big center
  // hole on a format without one.
  const offered = format.proofs || {};
  project.proofs = objectOrEmpty(project.proofs, "project.proofs");
  project.proofs.referenceCut = !!offered.referenceCut
    && bool(project.proofs.referenceCut, "project.proofs.referenceCut");
  const testpresses = project.proofs.testpresses === undefined ? 0 : project.proofs.testpresses;
  if(!Number.isInteger(testpresses) || testpresses < 0){
    throw new Error("project.proofs.testpresses must be a nonnegative integer");
  }
  project.proofs.testpresses = offered.testpress ? testpresses : 0;
```

`bool` and `objectOrEmpty` already exist in this file. `bool` throws `<path> must be a boolean`, which the test's `/project\.proofs\.referenceCut/` matches.

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test tests/`
Expected: all pass. The fixtures in `completeness.test.js` and `plant-overview.test.js` use the real CONFIG, which has `proofs` since Task 1.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.js tests/project.test.js
git commit -m "project.json: proofs {referenceCut, testpresses}, dropped where the format has none"
```

---

### Task 4: Text files

**Files:**
- Modify: `src/lib/order-documents.js` (`documentHeader`, `shippingBillingSection`)
- Test: `tests/order-documents.test.js`

**Interfaces:**
- Consumes: `project.proofs` (Task 3). Tolerate a missing `proofs` the way this file tolerates other missing keys (`project.proofs || {}`).

- [ ] **Step 1: Write the failing test** (append to `tests/order-documents.test.js`)

```js
test("reference cut upfront in both documents, testpresses in the summary only", () => {
  const p = project({proofs:{referenceCut:true, testpresses:3}, sides:{A:side(), B:side({blank:true})}});
  const summary = buildOrderSummaryText(p, config, date);
  const tracklist = buildTracklistText(p, config, date);
  for(const doc of [summary, tracklist]){
    assert.match(doc, /\nCut: normal\nReference cut: yes\n/);
  }
  assert.match(summary, /Testpresses: 3/);
  assert.doesNotMatch(tracklist, /Testpress/);
});

test("no proofs lines when none are ordered", () => {
  for(const proofs of [undefined, {referenceCut:false, testpresses:0}]){
    const p = project({proofs});
    const text = buildOrderSummaryText(p, config, date) + buildTracklistText(p, config, date);
    assert.doesNotMatch(text, /Reference cut|Testpress/);
  }
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/order-documents.test.js`
Expected: the first new test fails on the missing `Reference cut: yes`.

- [ ] **Step 3: Implement**

In `documentHeader`, change the return to add the reference cut line after `Cut:`:

```js
  const proofs = project.proofs || {};
  const referenceCut = proofs.referenceCut ? "Reference cut: yes\n" : "";
  return `${label}\n${cat} - ${title} - ${artist} - ${humanDate(date)}\nFormat: ${project.format || "?"}\"\nCut: ${cut}\n${referenceCut}\n`;
```

In `shippingBillingSection`, put the testpresses on their own line before `BILLING ADDRESS:`, not in the shipping list (their shipping isn't part of the form). Change `let out = "BILLING ADDRESS:\n";` to:

```js
  const testpresses = (project.proofs || {}).testpresses;
  let out = testpresses > 0 ? `Testpresses: ${testpresses}\n\n` : "";
  out += "BILLING ADDRESS:\n";
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test tests/`
Expected: all pass, including the existing header tests (no proofs means no extra line).

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-documents.js tests/order-documents.test.js
git commit -m "text files: reference cut in both headers, testpresses in the order summary"
```

---

### Task 5: Plant view

**Files:**
- Modify: `src/lib/plant-overview.js` (`renderBasic`)
- Modify: `src/lib/completeness.js` (`projectGaps`)
- Test: `tests/plant-overview.test.js`, `tests/completeness.test.js`

**Interfaces:**
- Consumes: `project.proofs` (Task 3), `testpressNote` (Task 2), `CONFIG.proofs.testpressRecommendedFromQty` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `tests/plant-overview.test.js`:

```js
test("basic: reference cut and testpresses only when ordered", () => {
  assert.doesNotMatch(renderBasic(project, CONFIG, place, []), /Reference cut|Testpresses/);
  const ordered = {...project, proofs: {referenceCut: true, testpresses: 3}};
  const html = renderBasic(ordered, CONFIG, place, []);
  assert.ok(html.includes('<tr><th scope="row">Reference cut</th><td>yes</td></tr>'));
  assert.ok(html.includes('<tr><th scope="row">Testpresses</th><td>3</td></tr>'));
});
```

Append to `tests/completeness.test.js`:

```js
test("testpress on a run under the recommended size is a soft quantity note", () => {
  assert.deepEqual(gaps({proofs:{testpresses:3}}).filter(g => /Testpress/.test(g.text)),
    [{group:"Quantity", text:"Testpresses are not recommended for small runs (<1000). If you want to check your mix and master, order a reference cut."}]);
  assert.equal(gaps({proofs:{testpresses:3}, vinylColor:[{color:"black", qty:"1000"}],
    shippingBilling:{billing:{...address}, shipping:[{...address, qtyByColor:{black:"1000"}}]}})
    .filter(g => /Testpress/.test(g.text)).length, 0);
});
```

- [ ] **Step 2: Run them and check they fail**

Run: `node --test tests/plant-overview.test.js tests/completeness.test.js`
Expected: both new tests fail.

- [ ] **Step 3: Implement**

In `src/lib/plant-overview.js` `renderBasic`, in the `fieldTable([…])` list, after the `["Products", products],` row:

```js
    ...(project.proofs.referenceCut ? [["Reference cut", "yes"]] : []),
    ...(project.proofs.testpresses > 0 ? [["Testpresses", String(project.proofs.testpresses)]] : []),
```

In `src/lib/completeness.js`, import `testpressNote` from `"./proofs.js"`. In `projectGaps`, after the quantity loop (the one that ends with the `belowMinimum` branch), add:

```js
  const total = project.vinylColor.reduce((sum, row) => sum + (parseQuantity(row.qty) || 0), 0);
  const note = testpressNote(project.proofs.testpresses, total,
    (config.proofs && config.proofs.testpressRecommendedFromQty) || 0);
  if(note) add("Quantity", note);
```

The plant view serves `src/` unbuilt, so no build change is needed for this import. `completeness.js` isn't in the customer build.

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test tests/ && uv run --project plant python -m unittest discover plant`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js src/lib/completeness.js tests/plant-overview.test.js tests/completeness.test.js
git commit -m "plant view: reference cut and testpresses in Basic, testpress note as a quantity gap"
```

---

### Task 6: The form

**Files:**
- Create: `src/modules/proofs.js`
- Modify: `src/index.html` (a section after "Vinyl Colour & Quantity", one CSS line)
- Modify: `src/modules/tracklist.js` (checklist, collect, apply)
- Modify: `src/app.js` (init)
- Modify: `build/build.js` (FILES)
- Modify: `CLAUDE.md` (glossary)

**Interfaces:**
- Consumes: `testpressNote` (Task 2), `getColorBreakdown` and `onColorChange` from `src/modules/vinyl-color.js`, `infoText`/`renderInfoIcon` from `src/lib/info-text.js`, and `CONFIG.proofs` plus `format.proofs` (Task 1).
- Produces:
  - `initProofs(onStateChange)`
  - `collectProofs() -> {referenceCut: boolean, testpresses: integer}`
  - `applyProofs(data)`
  - `proofIssues() -> string[]`

- [ ] **Step 1: Markup.** In `src/index.html`, directly after the closing `</section>` of "VINYL COLOUR & QUANTITY":

```html
  <!-- ============ REFERENCE CUT & TESTPRESS ============ -->
  <section id="proofsSection">
    <h2>Reference cut &amp; Testpress</h2>
    <div class="row" id="referenceCutRow" style="align-items:center;">
      <label class="chk"><input type="checkbox" id="referenceCut"> Reference cut (one acetate)</label>
      <span id="referenceCutInfo"></span>
    </div>
    <div class="row" id="testpressRow" style="align-items:center;">
      <label class="chk"><input type="checkbox" id="testpress"> Testpress</label>
      <input type="number" id="testpressQty" class="hidden" min="1" step="1" style="width:80px;">
      <span id="testpressInfo"></span>
    </div>
    <p class="proof-note hidden" id="testpressNote"></p>
  </section>
```

Next to the `.pagepick` rules in the `<style>` block, add:

```css
  .proof-note{ font-size:12px; color:var(--ink-dim); margin:4px 0 0; }
```

- [ ] **Step 2: Module** (`src/modules/proofs.js`)

```js
// Reference cut & testpress — a reference cut is one acetate (a
// checkbox), a testpress takes a quantity. Each shows only where the
// format offers it (CONFIG.formats[i].proofs). The soft note for a
// testpress on a small run follows the colour quantities.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";
import { parseQuantity } from "../lib/shipping.js";
import { testpressNote } from "../lib/proofs.js";
import { getColorBreakdown, onColorChange } from "./vinyl-color.js";

let proofsOnStateChange = ()=>{};

function offeredProofs(){
  return getFormat(CONFIG, document.getElementById("format").value).proofs;
}

// null while ticked with an empty or invalid quantity, 0 when unticked.
function testpressCount(){
  if(!document.getElementById("testpress").checked) return 0;
  const qty = parseQuantity(document.getElementById("testpressQty").value);
  return qty > 0 ? qty : null;
}

function renderProofs(){
  const offered = offeredProofs();
  const referenceCut = document.getElementById("referenceCut");
  const testpress = document.getElementById("testpress");
  if(!offered.referenceCut) referenceCut.checked = false;
  if(!offered.testpress) testpress.checked = false;
  document.getElementById("referenceCutRow").classList.toggle("hidden", !offered.referenceCut);
  document.getElementById("testpressRow").classList.toggle("hidden", !offered.testpress);
  document.getElementById("proofsSection").classList.toggle("hidden", !offered.referenceCut && !offered.testpress);
  document.getElementById("testpressQty").classList.toggle("hidden", !testpress.checked);

  const total = getColorBreakdown().reduce((sum, c) => sum + c.qty, 0);
  const note = testpressNote(testpressCount() || 0, total, CONFIG.proofs.testpressRecommendedFromQty);
  const noteEl = document.getElementById("testpressNote");
  noteEl.textContent = note || "";
  noteEl.classList.toggle("hidden", !note);
}

export function initProofs(onStateChange = ()=>{}){
  proofsOnStateChange = onStateChange;
  document.getElementById("referenceCutInfo").innerHTML = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "referenceCut"));
  document.getElementById("testpressInfo").innerHTML = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "testpress"));
  const changed = ()=>{ renderProofs(); proofsOnStateChange(); };
  document.getElementById("testpress").addEventListener("change", e=>{
    if(e.target.checked) document.getElementById("testpressQty").value = CONFIG.proofs.testpressDefaultQty;
    changed();
  });
  for(const id of ["referenceCut", "format"]) document.getElementById(id).addEventListener("change", changed);
  document.getElementById("testpressQty").addEventListener("input", changed);
  onColorChange(renderProofs);
  renderProofs();
}

// An invalid quantity is saved as 0 (none); proofIssues flags it first.
export function collectProofs(){
  return {
    referenceCut: document.getElementById("referenceCut").checked,
    testpresses: testpressCount() || 0
  };
}

export function applyProofs(data){
  const d = data || {};
  document.getElementById("referenceCut").checked = !!d.referenceCut;
  document.getElementById("testpress").checked = d.testpresses > 0;
  document.getElementById("testpressQty").value = d.testpresses > 0 ? d.testpresses : "";
  renderProofs();
  proofsOnStateChange();
}

export function proofIssues(){
  return testpressCount() === null ? ["Testpress ticked but no valid quantity"] : [];
}
```

Before saving, check that none of `offeredProofs`, `testpressCount`, `renderProofs`, `proofsOnStateChange` or `changed` exists as a top-level name in another built file: `grep -rn "offeredProofs\|testpressCount\|renderProofs\|proofsOnStateChange" src`.

- [ ] **Step 3: Wire it**

`src/app.js`: `import { initProofs } from "./modules/proofs.js";`, then call `initProofs(refreshOrderStatus);` right after `initVinylColor();`.

`src/modules/tracklist.js`:
- Import: `import { collectProofs, applyProofs, proofIssues } from "./proofs.js";`
- In `updateChecklist`, after the `artworkIssues.forEach(…)` line: `proofIssues().forEach(text=> items.push([false, text]));`
- In the project object, after `vinylColor: collectVinylColor(),`: `proofs: collectProofs(),`
- In load, after `applyVinylColor(p.vinylColor);`: `applyProofs(p.proofs);`

`build/build.js` FILES: add `"src/modules/proofs.js",` after `"src/modules/vinyl-color.js",`.

`CLAUDE.md` Domain glossary, after the Whitelabel entry:

```
- **Reference cut** — a one-off acetate cut from the master so the
  customer hears the cut before lacquers are made; one per order.
- **Testpress** — the first records off the stamper, checking the
  pressing (not mix or master); a quantity, default 3, recommended
  from 1,000 records up (`CONFIG.proofs`).
```

- [ ] **Step 4: Tests and build**

Run: `node --test tests/ && node build/build.js`
Expected: all pass, and the build succeeds. Then check the flattened build for duplicate top-level names:

```bash
node -e 'const fs=require("fs");const src=fs.readFileSync("build/build.js","utf8");const files=[...src.matchAll(/^\s+"(src\/[^"]+\.js)",$/gm)].map(m=>m[1]);const seen={};for(const f of files)for(const m of fs.readFileSync(f,"utf8").matchAll(/^(?:export )?(?:async )?(?:function\*?|const|let|class)\s+([\w$]+)/gm))(seen[m[1]]??=[]).push(f);for(const [n,l] of Object.entries(seen))if(l.length>1)console.log("DUP",n,l)'
```

Expected: no output.

- [ ] **Step 5: Manual check** (the user runs this, or Chrome if they approve it)

Open `dist/index.html`:
1. On 12", both rows show. Tick Testpress: the quantity shows 3.
2. With a colour qty of 300, the note shows. Set it to 1000 and the note goes away.
3. Clear the quantity: the order checklist shows "Testpress ticked but no valid quantity".
4. Set `proofs.testpress: false` on 7" in `src/config.js` and rebuild. On 7" the testpress row is hidden and unticked.
5. Save the project and reopen the zip: the ticks and quantity come back. `project.json` has `"proofs"`, `tracklist.txt` has `Reference cut: yes`, and `order_summary.txt` has `Testpresses: 3`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/proofs.js src/index.html src/modules/tracklist.js src/app.js build/build.js CLAUDE.md
git commit -m "form: reference cut and testpress below the colour quantities"
```
