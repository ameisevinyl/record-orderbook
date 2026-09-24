# Plant View Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local plant view: `python3 plant/server.py` serves a page that loads a customer project zip, unpacks it to disk, and shows a completeness list plus a plain overview of `project.json`.

**Architecture:** A thin stdlib Python server (`plant/server.py`) serves `src/plant/` and the repo's `src/` ES modules unbuilt, and unpacks posted zips into `plant/work/<zip stem>/`. The page (`src/plant/app.js`) normalizes the project with `prepareProject` and renders with two new pure modules: `src/lib/completeness.js` (gaps) and `src/lib/plant-overview.js` (HTML). The earlier locked-form plant view on this branch is reverted first.

**Tech Stack:** Python ≥3.10 stdlib (`http.server`, `zipfile`, `json`, `pathlib`, `unittest`); browser ES2020 modules; Node ≥18 `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-24-plant-view-design.md`

## Global Constraints

- Python: standard library only, no pip installs. Server binds `127.0.0.1` only; default port 8765, `--port` to change.
- Browser code: no dependencies; the plant page is served from `src/` unbuilt (no build step).
- Customer tool (`dist/index.html`) behaviour unchanged, except that `history` stays carried through load/save.
- The plant page shows no specs, previews, form controls or toggles; all project text HTML-escaped.
- Tests: `node --test tests/` and `python3 -m unittest discover plant`. New pure logic needs a test.
- Comments short, explain *why*; match surrounding style (2-space indent JS, `function` declarations; 4-space PEP 8 Python).
- Commit messages short, imperative; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Ask the user before any Claude-in-Chrome verification.

## Review Focus

1. **Large zips** — a several-hundred-MB project must not be read into memory at once on the server (Task 5 streams the body to a temp file; manual check with a big zip).
2. **Static path traversal** — `GET /src/../plant/server.py` or `%2e%2e` must not serve files outside `src/` (Task 5 `static_target` test).
3. **Zip whose files sit at the root vs. in the usual `<project>/` folder** — both must list files relative to `project.json` (Task 5 test for a root-level zip).
4. **Project from an older customer tool** (missing `history`, missing optional fields) — must render without throwing, since `prepareProject` fills defaults (Task 3 test with a minimal project).
5. **Non-ASCII zip names** (e.g. `ö`, `@` in the email part) — the `X-Filename` header must round-trip (Task 4 page encodes with `encodeURIComponent`, server `unquote`s; Task 5 test).

---

## File map

- Revert (Task 1): `src/index.html`, `src/lib/debug-mode.js`, `build/build.js`, `CLAUDE.md` to `main`; delete `src/plant.js`, `src/plant.css`, `src/lib/plant-view.js`, `tests/plant-view.test.js`, `tests/build.test.js`, `tests/debug-mode.test.js`, `docs/superpowers/plans/2026-09-24-plant-view-plan.md`; trim `src/modules/tracklist.js`.
- Create `src/lib/completeness.js`, `tests/completeness.test.js` (Task 2).
- Create `src/lib/plant-overview.js`, `tests/plant-overview.test.js` (Task 3).
- Create `src/plant/index.html`, `src/plant/app.js` (Task 4).
- Create `plant/server.py`, `plant/test_server.py`; modify `.gitignore` (Task 5).
- Modify `CLAUDE.md` (Task 6).

---

### Task 1: Revert the locked-form plant view

**Files:**
- Revert to `main`: `src/index.html`, `src/lib/debug-mode.js`, `build/build.js`, `CLAUDE.md`
- Delete: `src/plant.js`, `src/plant.css`, `src/lib/plant-view.js`, `tests/plant-view.test.js`, `tests/build.test.js`, `tests/debug-mode.test.js`, `docs/superpowers/plans/2026-09-24-plant-view-plan.md`
- Modify: `src/modules/tracklist.js`

**Interfaces:**
- Keeps: `prepareProject(...).history`, `historyEntry(note, date)` (`src/lib/project.js`), HISTORY block in `buildOrderSummaryText`, `projectHistory` carried through customer load/save in `tracklist.js`.

- [ ] **Step 1: Revert and delete**

```bash
git checkout main -- src/index.html src/lib/debug-mode.js build/build.js CLAUDE.md
git rm -q src/plant.js src/plant.css src/lib/plant-view.js tests/plant-view.test.js tests/build.test.js tests/debug-mode.test.js docs/superpowers/plans/2026-09-24-plant-view-plan.md
rm -f dist/plant.html
```

- [ ] **Step 2: Trim `tracklist.js`**

Remove the `addHistoryEntry` export (nothing uses it now) — the block directly above `function buildProjectObject` becomes:
```js
// Plant edit notes (see project.json history). No field shows them; they
// ride along from the loaded project.json to the next save.
let projectHistory = [];
```
At the end of `loadProject`, remove these two lines:
```js
  // Fired only on success — plant.js must not treat a rejected zip as opened.
  document.dispatchEvent(new CustomEvent("projectloaded", {detail: p}));
```

- [ ] **Step 3: Verify**

Run: `node --test tests/ && node build/build.js && git diff main --stat -- src build CLAUDE.md`
Expected: all tests PASS; one `built …/dist/index.html` line; the diff against main lists only `src/lib/order-documents.js`, `src/lib/project.js`, `src/modules/tracklist.js`.

- [ ] **Step 4: Commit**

```bash
git add -A src build tests CLAUDE.md docs
git commit -m "plant view: revert the locked customer-form approach; keep project history"
```

---

### Task 2: `completeness.js`

**Files:**
- Create: `src/lib/completeness.js`
- Test: `tests/completeness.test.js`

**Interfaces:**
- Consumes: `prepareProject` output shape; `parseTime`, `formatTime`, `trackGapSeconds` (`time.js`); `computeStatus` (`playing-time.js`); `getFormat`, `productById` (`format-catalogue.js`); `parseQuantity`, `allocateQuantities`, `missingAddressFields`, `emailFormatValid` (`shipping.js`); `belowMinimum`, `colorLabel` (`vinyl-color.js`).
- Produces:
  - `export function sideTiming(side): {seconds: number, invalid: boolean}` — playing time of one prepared side (0 for blank); `invalid` when a continuous length is non-empty but unparseable.
  - `export function projectGaps(project, config, files): Array<{group: string, text: string}>` — `files` is `[{name, size}]` from the server.
  - `export const ADDRESS_FIELD_LABELS: {[field]: string}`.

- [ ] **Step 1: Write the failing tests**

`tests/completeness.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { projectGaps, sideTiming } from "../src/lib/completeness.js";

const address = {
  recipientName:"Punk Rock Ltd", addressLine1:"Hauptstr. 1", city:"Hamburg",
  postalCode:"20095", countryCode:"DE", email:"label@example.com"
};

function raw(overrides = {}){
  return {
    projectVersion:1, format:"12", catalogue:"PNKRCK007",
    sides:{
      A:{rpm:"33", tracks:[{title:"My Way", length:"3:00", fileName:"A1.wav"}]},
      B:{blank:true}
    },
    labels:{sides:{A:{fileName:"labA.pdf"}, B:{fileName:"labB.pdf"}}},
    coverSleeve:{innerSleeve:{productId:"sleeve-white-cutout"}},
    vinylColor:[{color:"black", qty:"300"}],
    shippingBilling:{billing:{...address}, shipping:[{...address, qtyByColor:{black:"300"}}]},
    ...overrides
  };
}

const allFiles = [{name:"A1.wav", size:1}, {name:"labA.pdf", size:1}, {name:"labB.pdf", size:1}];

function gaps(overrides, files = allFiles){
  return projectGaps(prepareProject(raw(overrides), CONFIG), CONFIG, files);
}

function texts(list){
  return list.map(g => `${g.group}: ${g.text}`);
}

test("a complete project has no gaps", () => {
  assert.deepEqual(gaps({}), []);
});

test("missing catalogue number", () => {
  assert.deepEqual(texts(gaps({catalogue:" "})), ["Release: no catalogue number"]);
});

test("track without audio file or length", () => {
  const sides = {A:{rpm:"33", tracks:[{title:"x", length:""}]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: A1 has no audio file", "Side A: A1 length missing or invalid"]);
});

test("side without tracks", () => {
  const sides = {A:{rpm:"33", tracks:[]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: no tracks"]);
});

test("continuous side: file needed, empty length fine, bad length flagged", () => {
  const ok = {A:{rpm:"33", continuous:true, continuousFileName:"A.wav", continuousLength:""}, B:{blank:true}};
  assert.deepEqual(gaps({sides:ok}, [...allFiles, {name:"A.wav", size:1}]), []);
  const bad = {A:{rpm:"33", continuous:true, continuousLength:"abc"}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides:bad})), ["Side A: no audio file for the side", "Side A: side length invalid"]);
});

test("playing time over the format maximum", () => {
  const sides = {A:{rpm:"33", tracks:[{title:"x", length:"28:00", fileName:"A1.wav"}]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: playing time 28:00 over the 27 min maximum"]);
  assert.deepEqual(sideTiming(prepareProject(raw({sides}), CONFIG).sides.A), {seconds:1680, invalid:false});
});

test("file named in project.json but not in the zip", () => {
  assert.deepEqual(texts(gaps({}, allFiles.filter(f => f.name !== "A1.wav"))), ["Side A: A1 audio file A1.wav is not in the zip"]);
});

test("labels: missing artwork unless whitelabel; blank side B still needs a label", () => {
  const labels = {sides:{A:{fileName:"labA.pdf"}, B:{}}};
  assert.deepEqual(texts(gaps({labels})), ["Labels: label B has no artwork"]);
  assert.deepEqual(gaps({labels:{sides:{A:{fileName:"labA.pdf"}, B:{whitelabel:true}}}}), []);
});

test("printed parts need their artwork, inlay front and back", () => {
  const coverSleeve = {
    innerSleeve:{productId:"sleeve-printed"},
    cover:{productId:"cover-printed"},
    inlay:{productId:"inlay-printed", front:{fileName:"inf.pdf"}}
  };
  assert.deepEqual(texts(gaps({coverSleeve}, [...allFiles, {name:"inf.pdf", size:1}])), [
    "Inner sleeve: printed but no artwork",
    "Cover: printed but no artwork",
    "Inlay: back has no artwork"
  ]);
});

test("quantities: none, invalid, below minimum", () => {
  const shipping = [{...address, qtyByColor:{}}];
  assert.deepEqual(texts(gaps({vinylColor:[], shippingBilling:{billing:{...address}, shipping}})), ["Quantity: no quantity"]);
  assert.deepEqual(texts(gaps({vinylColor:[{color:"black", qty:"30x"}], shippingBilling:{billing:{...address}, shipping}})),
    ["Quantity: no quantity", 'Quantity: Black: invalid quantity "30x"']);
  const red = {vinylColor:[{color:"black", qty:"300"}, {color:"red", qty:"50"}],
    shippingBilling:{billing:{...address}, shipping:[{...address, qtyByColor:{black:"300", red:"50"}}]}};
  assert.deepEqual(texts(gaps(red)), ["Quantity: Red: 50 is below the minimum of 100"]);
});

test("billing: missing fields and malformed email", () => {
  const billing = {...address, city:"", email:"nope"};
  assert.deepEqual(texts(gaps({shippingBilling:{billing, shipping:[{...address, qtyByColor:{black:"300"}}]}})),
    ["Billing: city missing", "Billing: email looks malformed"]);
});

test("shipping: no address, missing fields, over-allocated or invalid extra quantities", () => {
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:[]}})), ["Shipping: no shipping address"]);
  const over = [{...address, qtyByColor:{black:"100"}}, {...address, postalCode:"", qtyByColor:{black:"400"}}];
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:over}})),
    ["Shipping 2: postal code missing", "Shipping: Black: more shipped than pressed"]);
  const invalid = [{...address, qtyByColor:{black:"100"}}, {...address, qtyByColor:{black:"x"}}];
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:invalid}})),
    ["Shipping: Black: invalid shipping quantity"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/completeness.test.js`
Expected: FAIL — `Cannot find module …/src/lib/completeness.js`.

- [ ] **Step 3: Implement**

`src/lib/completeness.js`:
```js
// Pure completeness rules for the plant view: what a supplied project
// still lacks before deep checks make sense. Reads a prepareProject()
// result plus the files actually present in the zip; no DOM.

import { parseTime, formatTime, trackGapSeconds } from "./time.js";
import { computeStatus } from "./playing-time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { parseQuantity, allocateQuantities, missingAddressFields, emailFormatValid } from "./shipping.js";
import { belowMinimum, colorLabel } from "./vinyl-color.js";

export const ADDRESS_FIELD_LABELS = {
  recipientName: "name", attention: "attention", addressLine1: "address line 1",
  addressLine2: "address line 2", addressLine3: "address line 3", postalCode: "postal code",
  city: "city", stateProvince: "state/province", countryCode: "country", email: "email",
  phone: "phone", vat: "VAT", eori: "EORI"
};

// Same sum as the customer tool's side total: track lengths plus the
// gap before every track but the first. A continuous side's length may
// be empty (read from the file later), which is not invalid.
export function sideTiming(side){
  if(side.blank) return {seconds: 0, invalid: false};
  if(side.continuous){
    const raw = side.continuousLength.trim();
    const seconds = parseTime(raw);
    return {seconds: seconds || 0, invalid: raw !== "" && seconds === null};
  }
  const seconds = side.tracks.reduce((sum, track, i) =>
    sum + (parseTime(track.length) || 0) + trackGapSeconds(track, i === 0), 0);
  return {seconds, invalid: false};
}

function isPrinted(parts, category, id){
  const product = productById((parts[category] && parts[category].products) || [], id);
  return !!product && product.kind === "printed";
}

export function projectGaps(project, config, files){
  const gaps = [];
  const add = (group, text) => gaps.push({group, text});
  const present = new Set(files.map(file => file.name));
  const inZip = (group, name, what) => {
    if(name && !present.has(name)) add(group, `${what} ${name} is not in the zip`);
  };
  const format = getFormat(config, project.format);

  if(!project.catalogue.trim()) add("Release", "no catalogue number");

  const mode = project.soundsystem ? "soundsystem" : "normal";
  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    const group = `Side ${sideId}`;
    if(side.blank) continue;
    if(side.continuous){
      if(!side.continuousFileName) add(group, "no audio file for the side");
      inZip(group, side.continuousFileName, "audio file");
      inZip(group, side.tracklistFileName, "tracklist file");
    } else {
      if(!side.tracks.length) add(group, "no tracks");
      side.tracks.forEach((track, i) => {
        const pos = `${sideId}${i + 1}`;
        if(!track.fileName) add(group, `${pos} has no audio file`);
        inZip(group, track.fileName, `${pos} audio file`);
        if(parseTime(track.length) === null) add(group, `${pos} length missing or invalid`);
      });
    }
    const {seconds, invalid} = sideTiming(side);
    if(invalid) add(group, "side length invalid");
    const status = computeStatus(format.timeLimits, Number(side.rpm), mode, seconds);
    if(status.level === "danger") add(group, `playing time ${formatTime(seconds)} over the ${status.maxMin} min maximum`);
  }

  for(const sideId of ["A", "B"]){
    const label = project.labels.sides[sideId];
    if(label.whitelabel) continue;
    if(!label.fileName) add("Labels", `label ${sideId} has no artwork`);
    inZip("Labels", label.fileName, `label ${sideId} artwork`);
  }

  const parts = format.printableParts || {};
  const sleeve = project.coverSleeve;
  for(const [group, category, part] of [
    ["Inner sleeve", "innerSleeve", sleeve.innerSleeve],
    ["Cover", "outerCover", sleeve.cover]
  ]){
    if(!isPrinted(parts, category, part.productId)) continue;
    if(!part.fileName) add(group, "printed but no artwork");
    inZip(group, part.fileName, "artwork");
  }
  if(isPrinted(parts, "inlay", sleeve.inlay.productId)){
    for(const face of ["front", "back"]){
      const name = sleeve.inlay[face].fileName;
      if(!name) add("Inlay", `${face} has no artwork`);
      inZip("Inlay", name, `${face} artwork`);
    }
  }

  const minOrderQty = (config.vinylColor && config.vinylColor.minOrderQty) || {};
  if(!project.vinylColor.some(row => parseQuantity(row.qty) > 0)) add("Quantity", "no quantity");
  for(const row of project.vinylColor){
    if(!row.qty.trim()) continue;
    if(parseQuantity(row.qty) === null) add("Quantity", `${colorLabel(row.color)}: invalid quantity "${row.qty}"`);
    else if(belowMinimum(row.color, row.qty, minOrderQty)){
      add("Quantity", `${colorLabel(row.color)}: ${row.qty} is below the minimum of ${minOrderQty[row.color]}`);
    }
  }

  const {billing, shipping} = project.shippingBilling;
  for(const field of missingAddressFields(billing)) add("Billing", `${ADDRESS_FIELD_LABELS[field]} missing`);
  if(billing.email.trim() && !emailFormatValid(billing.email)) add("Billing", "email looks malformed");

  if(!shipping.length) add("Shipping", "no shipping address");
  shipping.forEach((address, i) => {
    for(const field of missingAddressFields(address)) add(`Shipping ${i + 1}`, `${ADDRESS_FIELD_LABELS[field]} missing`);
  });
  // The first address takes whatever the others leave, so only invalid
  // or excess quantities on the others are gaps.
  for(const row of project.vinylColor){
    if(parseQuantity(row.qty) === null) continue;
    const extras = shipping.slice(1).map(address => address.qtyByColor[row.color] ?? "");
    if(extras.some(qty => qty.trim() && parseQuantity(qty) === null)){
      add("Shipping", `${colorLabel(row.color)}: invalid shipping quantity`);
    } else if(allocateQuantities(row.qty, extras).overAllocated){
      add("Shipping", `${colorLabel(row.color)}: more shipped than pressed`);
    }
  }
  return gaps;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all PASS. If an expectation fails because the real `CONFIG` differs (e.g. the 12" 33 rpm normal max is not 27, black `minOrderQty` not 1, red not 100), fix the test fixture to match `src/config.js`, not the code.

- [ ] **Step 5: Commit**

```bash
git add src/lib/completeness.js tests/completeness.test.js
git commit -m "completeness: gaps in a supplied project for the plant view"
```

---

### Task 3: `plant-overview.js`

**Files:**
- Create: `src/lib/plant-overview.js`
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `sideTiming`, `ADDRESS_FIELD_LABELS` (Task 2); `formatTime`; `computeStatus`; `getFormat`, `productById`; `colorLabel`.
- Produces:
  - `export function escapeHtml(value): string`
  - `export function renderHeader(zipName, project): string`
  - `export function renderGaps(gaps): string`
  - `export function renderOverview(project, config, files): string`

- [ ] **Step 1: Write the failing tests**

`tests/plant-overview.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { renderOverview, renderGaps, renderHeader, escapeHtml } from "../src/lib/plant-overview.js";

const project = prepareProject({
  projectVersion:1, format:"12", catalogue:"PNKRCK007", albumTitle:"<b>Loud</b>", albumArtist:"Band",
  sides:{A:{rpm:"33", tracks:[{title:"One", length:"3:00", fileName:"A1.wav"}, {title:"Two", length:"2:00", fileName:"A2.wav"}]}, B:{blank:true}},
  vinylColor:[{color:"black", qty:"300"}],
  history:[{savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300"}]
}, CONFIG);

test("overview shows values in form order, escaped", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("PNKRCK007"));
  assert.ok(html.includes("&lt;b&gt;Loud&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Loud"));
  const order = ["Release", "Side A", "Side B", "Labels", "Inner sleeve", "Cover", "Inlay", "Vinyl colour", "Billing", "Shipping", "History"]
    .map(h => html.indexOf(`<h2>${h}`));
  assert.ok(order.every(i => i >= 0), "every group present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("files show size or are marked missing; side total shown", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("A1.wav (50.0 MB)"));
  assert.match(html, /A2\.wav <span class="missing">missing<\/span>/);
  assert.ok(html.includes("Total 5:02"));
  assert.ok(html.includes("Blank"));
});

test("an older, minimal project renders without throwing", () => {
  const minimal = prepareProject({format:"7"}, CONFIG);
  assert.ok(renderOverview(minimal, CONFIG, []).includes("<h2>Release"));
});

test("gaps list and header", () => {
  assert.equal(renderGaps([]), '<p class="complete">Complete — ready for checks</p>');
  assert.equal(renderGaps([{group:"Release", text:"no <x>"}]),
    '<ul class="gaps"><li><b>Release</b> no &lt;x&gt;</li></ul>');
  assert.ok(renderHeader("260924_X.zip", project).includes("260924_X.zip"));
  assert.equal(escapeHtml(`a&"'`), "a&amp;&quot;&#39;");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/plant-overview.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/plant-overview.js`:
```js
// Plain HTML overview of a prepareProject() result for the plant view:
// every value in customer-form order, no specs or controls. Pure — the
// page (src/plant/app.js) only assigns the string to innerHTML, so every
// project value goes through escapeHtml here.

import { formatTime } from "./time.js";
import { computeStatus } from "./playing-time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { sideTiming, ADDRESS_FIELD_LABELS } from "./completeness.js";

export function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
}

function group(title, body){
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

// pairs: [label, html] — values arrive already escaped; empty ones drop.
function rows(pairs){
  const kept = pairs.filter(([, html]) => html !== "");
  return kept.length
    ? `<dl>${kept.map(([label, html]) => `<dt>${escapeHtml(label)}</dt><dd>${html}</dd>`).join("")}</dl>`
    : "<p>—</p>";
}

function formatSize(bytes){
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function fileHtml(name, sizes){
  if(!name) return "";
  return sizes.has(name)
    ? `${escapeHtml(name)} (${formatSize(sizes.get(name))})`
    : `${escapeHtml(name)} <span class="missing">missing</span>`;
}

function sideHtml(project, format, sideId, sizes){
  const side = project.sides[sideId];
  if(side.blank) return group(`Side ${sideId}`, "<p>Blank</p>");
  const mode = project.soundsystem ? "soundsystem" : "normal";
  const {seconds} = sideTiming(side);
  const status = computeStatus(format.timeLimits, Number(side.rpm), mode, seconds);
  let body = rows([
    ["RPM", escapeHtml(side.rpm)],
    ["Matrix", escapeHtml(side.matrixInscription)],
    ["Side file", side.continuous ? fileHtml(side.continuousFileName, sizes) : ""],
    ["Tracklist file", side.continuous ? fileHtml(side.tracklistFileName, sizes) : ""]
  ]);
  if(!side.continuous){
    body += `<table><tr><th>Pos</th><th>Title</th><th>Artist</th><th>Length</th><th>Gap</th><th>File</th></tr>`
      + side.tracks.map((track, i) => {
        const gap = i === 0 ? "" : track.gap === "custom" ? `${track.gapCustom}s` : `${track.gap}s`;
        return `<tr><td>${sideId}${i + 1}</td><td>${escapeHtml(track.title)}</td><td>${escapeHtml(track.artist)}</td>`
          + `<td>${escapeHtml(track.length)}</td><td>${escapeHtml(gap)}</td><td>${fileHtml(track.fileName, sizes)}</td></tr>`;
      }).join("")
      + `</table>`;
  }
  body += `<p>Total ${formatTime(seconds)} — ${escapeHtml(side.rpm)} rpm, ${mode} cut, ideal ${status.idealMin} min, max ${status.maxMin} min</p>`;
  return group(`Side ${sideId}`, body);
}

function productName(parts, category, id){
  const product = productById((parts[category] && parts[category].products) || [], id);
  return product ? escapeHtml(product.name) : "none";
}

function addressHtml(address){
  const fields = ["recipientName", "attention", "addressLine1", "addressLine2", "addressLine3",
    "postalCode", "city", "stateProvince", "countryCode", "email", "phone", "vat", "eori"];
  return rows(fields.map(field => [ADDRESS_FIELD_LABELS[field], escapeHtml(address[field])]));
}

export function renderHeader(zipName, project){
  return `<p class="ident">${escapeHtml(zipName)}</p>`
    + `<p class="title">${escapeHtml(project.catalogue || "(no catalogue #)")} — ${escapeHtml(project.albumTitle || "(no title)")} — ${escapeHtml(project.albumArtist || "(no artist)")}</p>`;
}

export function renderGaps(gaps){
  if(!gaps.length) return '<p class="complete">Complete — ready for checks</p>';
  return `<ul class="gaps">${gaps.map(g => `<li><b>${escapeHtml(g.group)}</b> ${escapeHtml(g.text)}</li>`).join("")}</ul>`;
}

export function renderOverview(project, config, files){
  const sizes = new Map(files.map(file => [file.name, file.size]));
  const format = getFormat(config, project.format);
  const parts = format.printableParts || {};
  const sleeve = project.coverSleeve;
  const labels = project.labels;

  return [
    group("Release", rows([
      ["Catalogue #", escapeHtml(project.catalogue)],
      ["Format", escapeHtml(format.label)],
      ["Title", escapeHtml(project.albumTitle)],
      ["Artist", escapeHtml(project.albumArtist)],
      ["Cut", project.soundsystem ? "soundsystem" : "normal"],
      ["Big center hole", labels.bigCenter ? "yes" : ""]
    ])),
    sideHtml(project, format, "A", sizes),
    sideHtml(project, format, "B", sizes),
    group("Notes", project.notes.trim() ? `<pre>${escapeHtml(project.notes)}</pre>` : "<p>—</p>"),
    group("Labels", rows(["A", "B"].map(side => [
      `Side ${side}`, labels.sides[side].whitelabel ? "whitelabel" : (fileHtml(labels.sides[side].fileName, sizes) || "none")
    ]))),
    group("Inner sleeve", rows([
      ["Product", productName(parts, "innerSleeve", sleeve.innerSleeve.productId)],
      ["Artwork", fileHtml(sleeve.innerSleeve.fileName, sizes)]
    ])),
    group("Cover", rows([
      ["Product", productName(parts, "outerCover", sleeve.cover.productId)],
      ["Artwork", fileHtml(sleeve.cover.fileName, sizes)]
    ])),
    group("Inlay", rows([
      ["Product", productName(parts, "inlay", sleeve.inlay.productId)],
      ["Front", fileHtml(sleeve.inlay.front.fileName, sizes)],
      ["Back", fileHtml(sleeve.inlay.back.fileName, sizes)]
    ])),
    group("Vinyl colour & quantity", rows(project.vinylColor.map(row => [colorLabel(row.color), escapeHtml(row.qty)]))),
    group("Billing", addressHtml(project.shippingBilling.billing)),
    group("Shipping", project.shippingBilling.shipping.map((address, i) =>
      `<h3>Address ${i + 1}</h3>` + addressHtml(address)
      + rows([
        ["Quantities", escapeHtml(Object.entries(address.qtyByColor).filter(([, qty]) => qty.trim())
          .map(([color, qty]) => `${qty} ${colorLabel(color)}`).join(", "))],
        ["Residential", address.isResidential ? "yes" : ""],
        ["Note", escapeHtml(address.note)]
      ])).join("") || "<p>—</p>"),
    project.history.length ? group("History", rows(project.history.map(h =>
      [h.savedAt, `${escapeHtml(h.by)}: ${escapeHtml(h.note)}`]))) : ""
  ].join("");
}
```

The test's heading-order check matches `<h2>Vinyl colour` against `<h2>Vinyl colour &amp; quantity` (`escapeHtml` turns `&` into `&amp;`) — `indexOf` on the prefix `<h2>Vinyl colour` still finds it.

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js tests/plant-overview.test.js
git commit -m "plant overview: plain HTML rendering of a project"
```

---

### Task 4: Plant page

**Files:**
- Create: `src/plant/index.html`, `src/plant/app.js`

**Interfaces:**
- Consumes: `CONFIG` (`src/config.js`), `prepareProject` (`src/lib/project.js`), `projectGaps` (Task 2), `renderHeader`, `renderGaps`, `renderOverview` (Task 3), `POST /api/open` (served in Task 5).

- [ ] **Step 1: Write `src/plant/index.html`**

Font and colour variables are copied from `src/index.html`'s `:root` (check they match the current values there).
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant view</title>
<style>
  /* Same type and colours as the customer sheet (src/index.html); no
     decoration beyond group frames. */
  :root{
    --bg:#ffffff; --field:#f6f6f5; --edge:#d6d6d3; --ink:#161616; --ink-dim:#5c5c59; --danger:#b3261e;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "JetBrains Mono", "IBM Plex Mono", "Cascadia Code",
            "Fira Code", "SF Mono", Consolas, "Roboto Mono", monospace;
  }
  *{ box-sizing:border-box; }
  body{ margin:0; padding:12px 16px 40px; background:var(--bg); color:var(--ink); font:13.5px/1.45 var(--sans); }
  main{ max-width:1000px; }
  h1{ font-size:18px; margin:0 0 8px; }
  h2{ font-size:14px; margin:0 0 4px; }
  h3{ font-size:13.5px; margin:6px 0 2px; }
  button{ font:inherit; padding:2px 12px; border:1px solid var(--ink); background:var(--bg); color:var(--ink); border-radius:0; cursor:pointer; }
  section{ border:1px solid var(--edge); padding:6px 10px; margin:0 0 6px; }
  dl{ display:grid; grid-template-columns:max-content 1fr; gap:0 16px; margin:0; }
  dt{ color:var(--ink-dim); }
  dd{ margin:0; }
  table{ border-collapse:collapse; margin:4px 0; }
  th{ text-align:left; color:var(--ink-dim); font-weight:600; }
  th, td{ padding:0 12px 0 0; vertical-align:top; }
  pre{ font:inherit; white-space:pre-wrap; margin:0; }
  p{ margin:4px 0; }
  .ident{ font-family:var(--mono); color:var(--ink-dim); }
  .title{ font-weight:700; }
  .missing, #error, .gaps{ color:var(--danger); }
  .gaps{ margin:6px 0; padding-left:18px; }
  .complete{ font-weight:700; }
  #error:empty{ display:none; }
</style>
</head>
<body>
<main>
  <h1>Plant view</h1>
  <button type="button" id="btnLoad">Load project</button>
  <input type="file" id="zipInput" accept=".zip,application/zip" hidden>
  <p id="error"></p>
  <div id="out"></div>
</main>
<script type="module" src="/src/plant/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `src/plant/app.js`**

```js
// Plant view page: send a project zip to plant/server.py (which unpacks
// it to disk), then show completeness and the overview.
import { CONFIG } from "../config.js";
import { prepareProject } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { renderHeader, renderGaps, renderOverview } from "../lib/plant-overview.js";

const input = document.getElementById("zipInput");
const out = document.getElementById("out");
const error = document.getElementById("error");

async function openZip(file){
  out.innerHTML = "";
  error.textContent = "";
  try{
    const res = await fetch("/api/open", {
      method: "POST",
      // Header values must be ASCII; the server unquotes it.
      headers: {"X-Filename": encodeURIComponent(file.name)},
      body: file
    });
    if(!res.ok) throw new Error(await res.text());
    const {name, project: raw, files} = await res.json();
    const project = prepareProject(raw, CONFIG);
    out.innerHTML = renderHeader(name, project)
      + renderGaps(projectGaps(project, CONFIG, files))
      + renderOverview(project, CONFIG, files);
  }catch(err){
    error.textContent = `Couldn't open ${file.name}: ${err.message}`;
  }
}

document.getElementById("btnLoad").addEventListener("click", ()=> input.click());
input.addEventListener("change", ()=>{
  const file = input.files[0];
  input.value = "";
  if(file) openZip(file);
});
```

- [ ] **Step 3: Run tests**

Run: `node --test tests/`
Expected: all PASS (the page itself is checked by hand in Task 5).

- [ ] **Step 4: Commit**

```bash
git add src/plant/index.html src/plant/app.js
git commit -m "plant page: load a project zip, show completeness and overview"
```

---

### Task 5: `plant/server.py`

**Files:**
- Create: `plant/server.py`, `plant/test_server.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces (HTTP): `GET /` → `src/plant/index.html`; `GET /src/<path>` → file under `src/`; `POST /api/open` (body: zip bytes, header `X-Filename`: `encodeURIComponent(name)`) → `200 {"name", "project", "files": [{"name", "size"}]}` or `400` plain text.
- Produces (Python, for tests): `unpack(zip_file, dest) -> (project: dict, files: list)`, `OpenError`, `static_target(url_path) -> Path | None`, `zip_stem(header_value) -> str`.

- [ ] **Step 1: Write the failing tests**

`plant/test_server.py`:
```python
import io
import stat
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from server import OpenError, ROOT, static_target, unpack, zip_stem


def make_zip(entries):
    """entries: (name, data) pairs or (ZipInfo, data) pairs."""
    buf = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # duplicate-name warning
        with zipfile.ZipFile(buf, "w") as zf:
            for name, data in entries:
                zf.writestr(name, data)
    buf.seek(0)
    return buf


class UnpackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name) / "work" / "p"

    def tearDown(self):
        self.tmp.cleanup()

    def test_foldered_zip_lists_files_relative_to_project_json(self):
        z = make_zip([("p/project.json", b'{"catalogue": "X"}'), ("p/A1.wav", b"12345")])
        project, files = unpack(z, self.dest)
        self.assertEqual(project, {"catalogue": "X"})
        self.assertEqual(files, [{"name": "A1.wav", "size": 5}])
        self.assertTrue((self.dest / "p" / "A1.wav").is_file())

    def test_root_level_zip(self):
        z = make_zip([("project.json", b"{}"), ("labA.pdf", b"1")])
        self.assertEqual(unpack(z, self.dest)[1], [{"name": "labA.pdf", "size": 1}])

    def test_replaces_existing_work_folder(self):
        self.dest.mkdir(parents=True)
        (self.dest / "stale.txt").write_text("old")
        unpack(make_zip([("project.json", b"{}")]), self.dest)
        self.assertFalse((self.dest / "stale.txt").exists())

    def test_rejects_unsafe_and_invalid_zips(self):
        link = zipfile.ZipInfo("p/link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        cases = {
            "not a zip file": io.BytesIO(b"nope"),
            "unsafe path": make_zip([("project.json", b"{}"), ("../x", b"1")]),
            "unsafe path ": make_zip([("project.json", b"{}"), ("/abs", b"1")]),
            "symlink": make_zip([("project.json", b"{}"), (link, b"target")]),
            "duplicate filename": make_zip([("project.json", b"{}"), ("a", b"1"), ("a", b"2")]),
            "no project.json": make_zip([("a", b"1")]),
            "more than one project.json": make_zip([("a/project.json", b"{}"), ("b/project.json", b"{}")]),
            "not valid JSON": make_zip([("project.json", b"{")]),
        }
        for message, z in cases.items():
            with self.subTest(message):
                with self.assertRaisesRegex(OpenError, message.strip()):
                    unpack(z, self.dest)


class HelpersTest(unittest.TestCase):
    def test_static_target_stays_inside_src(self):
        self.assertEqual(static_target("/"), ROOT / "src" / "plant" / "index.html")
        self.assertEqual(static_target("/src/config.js?x=1"), ROOT / "src" / "config.js")
        self.assertIsNone(static_target("/src/../plant/server.py"))
        self.assertIsNone(static_target("/src/%2e%2e/plant/server.py"))
        self.assertIsNone(static_target("/plant/server.py"))
        self.assertIsNone(static_target("/src/nope.js"))

    def test_zip_stem_decodes_and_strips_folders(self):
        self.assertEqual(zip_stem("260924_X_a%40b%C3%B6.de.zip"), "260924_X_a@bö.de")
        self.assertEqual(zip_stem("..%2F..%2Fevil.zip"), "evil")
        with self.assertRaises(OpenError):
            zip_stem("..")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m unittest discover plant`
Expected: ERROR — `ModuleNotFoundError: No module named 'server'`.

- [ ] **Step 3: Implement**

`plant/server.py`:
```python
"""Plant view server: serves src/plant/ (and the src/ modules it imports,
unbuilt) and unpacks posted project zips into plant/work/<zip stem>/.

Standard library only; binds 127.0.0.1. Run: python3 plant/server.py
"""
import argparse
import json
import shutil
import stat
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
WORK = ROOT / "plant" / "work"
INDEX = SRC / "plant" / "index.html"
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}
CHUNK = 1 << 20


class OpenError(Exception):
    """A zip the plant view refuses; the message goes to the page as-is."""


def safe_names(zf):
    names = []
    for info in zf.infolist():
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
            raise OpenError(f"unsafe path in zip: {info.filename}")
        # Unix mode lives in the high 16 bits of external_attr.
        if stat.S_ISLNK(info.external_attr >> 16):
            raise OpenError(f"symlink in zip: {info.filename}")
        if not info.is_dir():
            names.append(info.filename)
    if len(names) != len(set(names)):
        raise OpenError("duplicate filename in zip")
    return names


def unpack(zip_file, dest):
    """Unpack a project zip into dest (replaced). Returns (project, files):
    the parsed project.json and every other file, named relative to the
    folder that holds project.json."""
    try:
        zf = zipfile.ZipFile(zip_file)
    except zipfile.BadZipFile:
        raise OpenError("not a zip file") from None
    with zf:
        names = safe_names(zf)
        jsons = [n for n in names if PurePosixPath(n).name == "project.json"]
        if not jsons:
            raise OpenError("no project.json in zip")
        if len(jsons) > 1:
            raise OpenError("more than one project.json in zip")
        try:
            project = json.loads(zf.read(jsons[0]))
        except ValueError:
            raise OpenError("project.json is not valid JSON") from None
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        zf.extractall(dest)
    base = dest / PurePosixPath(jsons[0]).parent
    files = [{"name": p.relative_to(base).as_posix(), "size": p.stat().st_size}
             for p in sorted(base.rglob("*")) if p.is_file() and p != base / "project.json"]
    return project, files


def static_target(url_path):
    """File under src/ for a GET path, or None."""
    path = unquote(urlsplit(url_path).path)
    target = INDEX if path in ("/", "/index.html") else (ROOT / path.lstrip("/")).resolve()
    return target if target.is_relative_to(SRC) and target.is_file() else None


def zip_stem(header_value):
    """Work-folder name from the X-Filename header (encodeURIComponent'd)."""
    name = PurePosixPath(unquote(header_value).replace("\\", "/")).name
    stem = name[:-4] if name.lower().endswith(".zip") else name
    if stem in ("", ".", ".."):
        raise OpenError("invalid file name")
    return stem


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        target = static_target(self.path)
        if target is None:
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        self.reply(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self):
        if self.path != "/api/open":
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        try:
            raw_name = self.headers.get("X-Filename", "")
            stem = zip_stem(raw_name)
            # Project zips can be hundreds of MB: stream to disk, not memory.
            with tempfile.TemporaryFile() as tmp:
                remaining = int(self.headers.get("Content-Length", 0))
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, CHUNK))
                    if not chunk:
                        break
                    tmp.write(chunk)
                    remaining -= len(chunk)
                tmp.seek(0)
                project, files = unpack(tmp, WORK / stem)
        except OpenError as error:
            return self.reply(400, str(error), "text/plain; charset=utf-8")
        name = PurePosixPath(unquote(raw_name)).name
        self.reply(200, json.dumps({"name": name, "project": project, "files": files}),
                   "application/json; charset=utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    port = parser.parse_args().port
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"plant view: http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
```

Append to `.gitignore`:
```
# Plant view working copies of opened project zips, and Python caches.
/plant/work/
__pycache__/
```

- [ ] **Step 4: Run tests**

Run: `python3 -m unittest discover plant -v`
Expected: all PASS.

- [ ] **Step 5: Manual check** (the user, or Claude-in-Chrome only after asking)

1. `python3 plant/server.py`, open `http://127.0.0.1:8765/` → only the heading and Load project.
2. Save a project from `dist/index.html` (with audio + a label) and load it → header line, completeness list (or "Complete — ready for checks"), overview groups in form order; files with sizes; `plant/work/<zip name>/` exists on disk.
3. Load a zip without a project.json (any other zip) → one red error line, no overview.
4. Load a project with a missing file (delete one from the zip) → that file is marked missing and listed as a gap.

- [ ] **Step 6: Commit**

```bash
git add plant/server.py plant/test_server.py .gitignore
git commit -m "plant server: serve the plant page, unpack project zips to plant/work"
```

---

### Task 6: Document the plant view

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit**

In `## Commands`, add after the build line:
```
python3 plant/server.py       # plant view on http://127.0.0.1:8765/
python3 -m unittest discover plant   # plant server tests
```
In `## Architecture`, add a bullet after the `tests/*.test.js` bullet:
```markdown
- `plant/server.py` + `src/plant/` — the plant (staff) view: a stdlib
  Python server on 127.0.0.1 that serves `src/plant/` and `src/`
  unbuilt and unpacks opened project zips into `plant/work/`
  (gitignored). The page renders `project.json` itself
  (`src/lib/plant-overview.js`, `src/lib/completeness.js`) — it never
  reuses the customer form.
```

- [ ] **Step 2: Run all tests**

Run: `node --test tests/ && python3 -m unittest discover plant`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: plant view server"
```
