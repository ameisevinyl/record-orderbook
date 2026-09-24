# Plant View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `dist/plant.html` — the same order form, opened from a project zip, locked by default, with a god-mode edit toggle, a dense layout, every check visible, and an edit-history note on save.

**Architecture:** `build/build.js` emits a second output from the same `src/index.html` and module list, prefixed with `globalThis.PLANT_VIEW = true;`, plus `src/plant.css` and `src/plant.js`. The form content is wrapped in one `<fieldset id="orderForm">` that `plant.js` disables/enables. `PLANT_VIEW` forces `isDebugMode()` on, which already surfaces every plant-only check. A `history` array rides along in `project.json` and prints at the end of `order_summary.txt`.

**Tech Stack:** Plain ES2020 browser JS, CSS, Node ≥18 `node --test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-24-plant-view-design.md`

## Global Constraints

- No runtime dependencies; `dist/index.html` and `dist/plant.html` are each a single self-contained file with no external requests.
- Build stays plain Node `fs` string concatenation; no bundler. Every file lands in one shared top-level scope — no two files may declare the same top-level name.
- `dist/index.html` must behave exactly as before (the customer view). `PLANT_VIEW` is false there.
- Tests: `node --test tests/`. New pure logic needs a test.
- Comments short, explain *why*. Match surrounding style (2-space indent, `function` declarations, no semicolon-free style changes).
- Commit messages: short, imperative, precise; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before any browser verification with Claude-in-Chrome, ask the user first (token-expensive); otherwise list the manual check for the user.

## Review Focus

1. **Loading into a locked form** — `loadProject` runs while `<fieldset disabled>` is set; values, synthetic `change` dispatches and file re-attach must still work (Task 6 manual check with a zip containing audio + artwork).
2. **Customer view regression from the fieldset** — default fieldset border/padding/`min-width` would shift or overflow the customer layout; the wrapper must be visually invisible and never disabled in `index.html` (Task 4 CSS reset + Task 5 build test asserts no `disabled` on `orderForm` in `index.html`).
3. **Synthetic events marking the order dirty** — `loadProject` dispatches `change`; only `isTrusted` events count, else every opened order would demand a note (Task 6 code + manual check).
4. **Note prompt cancelled/empty** — must abort the save, not save silently without a note (Task 6 code + manual check).
5. **Faded locked controls** — the customer CSS sets `:disabled{opacity:.4}`; plant view must render locked controls at full opacity (Task 7 CSS + manual check).

---

## File map

- Modify `src/lib/debug-mode.js` — `PLANT_VIEW` flag; `isDebugMode()` honours it.
- Modify `src/lib/project.js` — `history` normalization in `prepareProject`; `historyEntry(note, date)`.
- Modify `src/lib/order-documents.js` — History block in `buildOrderSummaryText`.
- Modify `src/modules/tracklist.js` — keep `history` across load/save; export `addHistoryEntry`.
- Modify `src/index.html` — `<fieldset id="orderForm">` wrapper + CSS reset.
- Modify `build/build.js` — second output `dist/plant.html`.
- Create `src/plant.js` — toolbar, lock/unlock, dirty tracking, save note, layout DOM tweaks.
- Create `src/plant.css` — dense layout.
- Create `tests/debug-mode.test.js`, `tests/build.test.js`; modify `tests/project.test.js`, `tests/order-documents.test.js`.
- Modify `CLAUDE.md` — mention `dist/plant.html`.

---

### Task 1: `PLANT_VIEW` flag in debug mode

**Files:**
- Modify: `src/lib/debug-mode.js`
- Test: `tests/debug-mode.test.js` (create)

**Interfaces:**
- Produces: `export const PLANT_VIEW: boolean` and `export function isDebugMode(): boolean` (true when `PLANT_VIEW`, else `?debug` in the URL).

- [ ] **Step 1: Write the failing test**

`tests/debug-mode.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Each import gets its own query string so the module is evaluated
// fresh with the globals set just before it.
test("PLANT_VIEW is false unless the plant build sets the global", async () => {
  delete globalThis.PLANT_VIEW;
  const mod = await import("../src/lib/debug-mode.js?customer");
  assert.equal(mod.PLANT_VIEW, false);
});

test("PLANT_VIEW forces debug mode without touching location", async () => {
  globalThis.PLANT_VIEW = true;
  const mod = await import("../src/lib/debug-mode.js?plant");
  delete globalThis.PLANT_VIEW;
  assert.equal(mod.PLANT_VIEW, true);
  assert.equal(mod.isDebugMode(), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debug-mode.test.js`
Expected: FAIL — `mod.PLANT_VIEW` is `undefined`, and `isDebugMode()` throws `ReferenceError: location is not defined`.

- [ ] **Step 3: Implement**

Replace the body of `src/lib/debug-mode.js` below its header comment with:
```js
// Set by build/build.js at the top of dist/plant.html only; the one
// declaration of the name, so the flattened bundle has no collision.
export const PLANT_VIEW = globalThis.PLANT_VIEW === true;

// Plant staff always see the plant-only checklist rows.
export function isDebugMode(){
  return PLANT_VIEW || new URLSearchParams(location.search).has("debug");
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/debug-mode.js tests/debug-mode.test.js
git commit -m "debug-mode: PLANT_VIEW flag forces plant-only checks"
```

---

### Task 2: `history` in project data

**Files:**
- Modify: `src/lib/project.js` (end of `prepareProject`, before the `referencedProjectFiles` loop; new export after it)
- Test: `tests/project.test.js`

**Interfaces:**
- Produces:
  - `prepareProject(raw, config).history: Array<{savedAt: string, by: string, note: string}>` (always an array; `[]` when absent).
  - `export function historyEntry(note: string, date: Date): {savedAt: string, by: "plant", note: string}` — `savedAt` is `date.toISOString()`, `note` trimmed.

- [ ] **Step 1: Write the failing tests**

Append to `tests/project.test.js` (and add `historyEntry` to its import from `../src/lib/project.js`):
```js
test("prepareProject defaults history to an empty array", () => {
  const project = prepareProject({projectVersion:1, format:"12"}, config);
  assert.deepEqual(project.history, []);
});

test("prepareProject keeps history entries and rejects malformed ones", () => {
  const history = [{savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300 → 500"}];
  const project = prepareProject({projectVersion:1, format:"12", history}, config);
  assert.deepEqual(project.history, history);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:{}}, config), /project\.history must be an array/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:["x"]}, config), /project\.history\[0\] must be an object/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:[{note:true}]}, config), /project\.history\[0\]\.note must be text/);
});

test("historyEntry stamps a trimmed plant note", () => {
  const entry = historyEntry("  qty 300 → 500 ", new Date("2026-09-24T12:00:00Z"));
  assert.deepEqual(entry, {savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300 → 500"});
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/project.test.js`
Expected: FAIL — `historyEntry` is not exported; `project.history` is `undefined`.

- [ ] **Step 3: Implement**

In `prepareProject`, directly before `for(const name of referencedProjectFiles(project)){`:
```js
  // Plant edit notes (see src/plant.js); no form field shows them, the
  // tool just carries them through load/save.
  project.history = arrayOrEmpty(project.history, "project.history").map((entry, i) => {
    const path = `project.history[${i}]`;
    entry = objectOrEmpty(entry, path);
    return {
      savedAt: text(entry.savedAt, `${path}.savedAt`),
      by: text(entry.by, `${path}.by`),
      note: text(entry.note, `${path}.note`)
    };
  });
```
After `prepareProject`, add:
```js
export function historyEntry(note, date){
  return {savedAt: date.toISOString(), by: "plant", note: note.trim()};
}
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.js tests/project.test.js
git commit -m "project: carry an edit history through prepareProject"
```

---

### Task 3: History block in `order_summary.txt`

**Files:**
- Modify: `src/lib/order-documents.js` (new `historySection`, used in `buildOrderSummaryText`)
- Test: `tests/order-documents.test.js`

**Interfaces:**
- Consumes: `project.history` from Task 2.
- Produces: `buildOrderSummaryText` output ends with `\nHISTORY:\n  <savedAt> <by>: <note>\n…` when history is non-empty; unchanged otherwise. `buildTracklistText` unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `tests/order-documents.test.js` (it already defines `project(overrides)`, `config`, `date`):
```js
test("order summary ends with the edit history when present", () => {
  const text = buildOrderSummaryText(project({history:[
    {savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300 → 500"}
  ]}), config, date);
  assert.ok(text.endsWith("\nHISTORY:\n  2026-09-24T12:00:00.000Z plant: qty 300 → 500\n"));
});

test("order summary and tracklist have no history block without history", () => {
  assert.ok(!buildOrderSummaryText(project(), config, date).includes("HISTORY:"));
  assert.ok(!buildTracklistText(project({history:[
    {savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"x"}
  ]}), config, date).includes("HISTORY:"));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/order-documents.test.js`
Expected: first new test FAILS (no HISTORY block); second passes.

- [ ] **Step 3: Implement**

In `src/lib/order-documents.js`, after `shippingBillingSection`:
```js
function historySection(project){
  const history = project.history || [];
  if(!history.length) return "";
  return "\nHISTORY:\n" + history.map(h => `  ${h.savedAt} ${h.by}: ${h.note}\n`).join("");
}
```
and change `buildOrderSummaryText`'s last line to:
```js
    + "\n" + shippingBillingSection(project)
    + historySection(project);
```

- [ ] **Step 4: Run tests**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/order-documents.js tests/order-documents.test.js
git commit -m "order summary: print the edit history"
```

---

### Task 4: Form wrapper and history carry-through in the customer page

**Files:**
- Modify: `src/index.html` (wrap lines from `<!-- ============ RELEASE INFO ============ -->` through the end of the SHIPPING ADDRESS(ES) `</section>`, i.e. everything before `<!-- ============ STATUS ============ -->`; add CSS)
- Modify: `src/modules/tracklist.js` (`buildProjectObject` ~line 815, `loadProject` ~line 963, new export near `buildProjectObject`)

**Interfaces:**
- Consumes: `prepareProject(...).history` (Task 2).
- Produces:
  - DOM: `<fieldset id="orderForm">` containing every order input; STATUS, ACTIONS, sendPanel, footer stay outside.
  - `export function addHistoryEntry(entry)` in `tracklist.js` — appends to the history saved with the next `buildProjectObject`.

- [ ] **Step 1: Wrap the form**

In `src/index.html`, insert directly before `  <!-- ============ RELEASE INFO ============ -->`:
```html
  <!-- One wrapper so the plant view (plant.js) can lock every order
       input at once with the native disabled attribute. -->
  <fieldset id="orderForm">
```
and directly before `  <!-- ============ STATUS ============ -->`:
```html
  </fieldset>
```
In the `<style>` block, next to `section{ margin-bottom:20px; }` (line ~66), add:
```css
  /* Invisible wrapper — see #orderForm in the markup. */
  #orderForm{ border:0; padding:0; margin:0; min-width:0; }
```

- [ ] **Step 2: Carry history through load/save**

In `src/modules/tracklist.js`, directly above `function buildProjectObject`:
```js
// Plant edit notes (see src/plant.js). No field shows them; they ride
// along from the loaded project.json to the next save.
let projectHistory = [];

export function addHistoryEntry(entry){
  projectHistory = [...projectHistory, entry];
}
```
In `buildProjectObject`, add after the `coverSleeve:` line (add a comma to that line):
```js
    history: projectHistory
```
In `loadProject`, directly after `catch(err){ alert("This project can't be opened: " + err.message); return; }`:
```js
  projectHistory = p.history;
```

- [ ] **Step 3: Run tests and build**

Run: `node --test tests/ && node build/build.js`
Expected: all PASS; `built …/dist/index.html`.

- [ ] **Step 4: Manual check (customer view unchanged)**

Open `dist/index.html` in a browser. Expected: layout identical to before (no border or indent around the form); fill a few fields, Save, Load the zip back — fields restore; the zip's `project.json` has `"history": []`.

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/modules/tracklist.js
git commit -m "form: fieldset wrapper; keep project history across load/save"
```

---

### Task 5: Build `dist/plant.html`

**Files:**
- Modify: `build/build.js`
- Create: `src/plant.js`, `src/plant.css` (stubs here; filled in Tasks 6–7)
- Test: `tests/build.test.js` (create)

**Interfaces:**
- Consumes: `PLANT_VIEW` (Task 1), `#orderForm` (Task 4).
- Produces: `dist/plant.html` = customer shell + `<style>` with `src/plant.css` before `</head>` + script prefixed with `globalThis.PLANT_VIEW = true;` and ending with `src/plant.js`. `dist/index.html` unchanged.

- [ ] **Step 1: Create stubs**

`src/plant.js`:
```js
// Plant view (dist/plant.html only): locked order, god-mode toggle,
// edit note on save. Built after app.js — see build/build.js.
```
`src/plant.css`:
```css
/* Plant view (dist/plant.html only): dense, plain layout. */
```

- [ ] **Step 2: Write the failing test**

`tests/build.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

execFileSync(process.execPath, ["build/build.js"]);
const customer = readFileSync("dist/index.html", "utf8");
const plant = readFileSync("dist/plant.html", "utf8");

test("plant build sets the flag and includes plant code and styles", () => {
  assert.ok(plant.includes("globalThis.PLANT_VIEW = true;"));
  assert.ok(plant.includes("// ---- src/plant.js ----"));
  assert.ok(plant.includes("Plant view (dist/plant.html only): dense"));
});

test("customer build has no plant flag, code or styles, and an unlocked form", () => {
  assert.ok(!customer.includes("globalThis.PLANT_VIEW = true;"));
  assert.ok(!customer.includes("src/plant.js"));
  assert.ok(!customer.includes("Plant view (dist/plant.html only)"));
  assert.match(customer, /<fieldset id="orderForm">/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test tests/build.test.js`
Expected: FAIL — `ENOENT … dist/plant.html` (or the plant assertions).

- [ ] **Step 4: Implement in `build/build.js`**

1. Update the header comment's first line to: `// Builds dist/index.html (customer) and dist/plant.html (plant staff):` and keep the rest.
2. After `const FILES = [...]`, add:
```js
// The plant view is the same app plus plant.js on top.
const PLANT_FILES = [...FILES, "src/plant.js"];
```
3. Change `function validateFileOrder(sources)` to `function validateFileOrder(files, sources)` and replace every `FILES` inside it with `files`.
4. Change `buildBundle` to take the file list and a prefix:
```js
function buildBundle(files, prefix = ""){
  const sources = new Map(files.map(rel => [rel, readFileSync(join(ROOT, rel), "utf8")]));
  validateFileOrder(files, sources);
  const sections = files.map(rel => {
```
and `const bundle = prefix + sections.join("\n");` (rest unchanged).
5. Change `buildHtml` to accept extra CSS:
```js
function buildHtml(bundleJs, extraCss = ""){
```
and replace its `return` with:
```js
  let html = shell.replace(marker, `<script>\n${bundleJs}\n</script>`);
  if(extraCss){
    if(html.split("</head>").length !== 2) throw new Error("src/index.html: expected exactly one </head>");
    html = html.replace("</head>", `<style>\n${extraCss}</style>\n</head>`);
  }
  return html;
```
6. Replace `main` with:
```js
function writeOutput(name, html){
  const outDir = join(ROOT, "dist");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, name);
  writeFileSync(outPath, html, "utf8");
  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  console.log(`built ${outPath} (${kb} KB)`);
}

function main(){
  writeOutput("index.html", buildHtml(buildBundle(FILES)));
  const plantCss = readFileSync(join(ROOT, "src/plant.css"), "utf8");
  writeOutput("plant.html", buildHtml(buildBundle(PLANT_FILES, "globalThis.PLANT_VIEW = true;\n"), plantCss));
}
```

- [ ] **Step 5: Run tests**

Run: `node --test tests/`
Expected: all PASS; build prints two `built …` lines.

- [ ] **Step 6: Commit**

```bash
git add build/build.js src/plant.js src/plant.css tests/build.test.js
git commit -m "build: second output dist/plant.html"
```

---

### Task 6: `plant.js` — toolbar, lock, god mode, save note

**Files:**
- Modify: `src/plant.js`

**Interfaces:**
- Consumes: `addHistoryEntry(entry)` (Task 4, `tracklist.js`), `historyEntry(note, date)` (Task 2, `project.js`), DOM ids `orderForm`, `btnOpenProject`, `btnSaveProject`, `openProjectInput`, `checklist`.
- Produces: DOM `.plantbar` (toolbar), `#plantIdentity`, `#btnGodMode`, `#godBanner`, used by Task 7's CSS.

Top-level names must be unique across the whole bundle — prefix helpers with `plant`.

- [ ] **Step 1: Implement**

`src/plant.js` (keep the header comment from Task 5):
```js
import { addHistoryEntry } from "./modules/tracklist.js";
import { historyEntry } from "./lib/project.js";

const plantForm = document.getElementById("orderForm");
let plantDirty = false;

function plantSetLocked(locked){
  plantForm.disabled = locked;
  document.getElementById("godBanner").classList.toggle("hidden", locked);
  document.getElementById("btnGodMode").textContent = locked ? "Edit (god mode)" : "Lock";
}

function plantInitToolbar(){
  const bar = document.createElement("div");
  bar.className = "plantbar no-print";
  bar.innerHTML = `
    <span id="plantIdentity">— no order open —</span>
    <button type="button" class="btn" id="btnGodMode"></button>
    <div id="godBanner" class="hidden">Editing — changes alter the customer's order</div>`;
  // The existing buttons keep their tracklist.js handlers; they only move.
  bar.append(document.getElementById("btnOpenProject"), document.getElementById("btnSaveProject"));
  const sheet = document.querySelector(".sheet");
  sheet.prepend(bar);
  // Status checklist first, right under the toolbar.
  bar.after(document.getElementById("checklist").closest("section"));
  document.getElementById("btnGodMode").addEventListener("click", ()=> plantSetLocked(!plantForm.disabled));
}

// Capture phase on document: runs before tracklist.js's own listeners on
// the buttons/input, so a cancelled prompt can stop the action.
function plantInitGuards(){
  document.addEventListener("click", (e)=>{
    if(e.target.closest("#btnOpenProject") && plantDirty && !confirm("Discard unsaved edits?")){
      e.stopPropagation();
      return;
    }
    if(e.target.closest("#btnSaveProject") && plantDirty){
      const note = (prompt("What was changed? (saved in the order history)") || "").trim();
      if(!note){ e.stopPropagation(); return; }
      addHistoryEntry(historyEntry(note, new Date()));
      // Recorded now, so a failed save retried later doesn't add it twice.
      plantDirty = false;
    }
  }, true);
  document.addEventListener("change", (e)=>{
    if(e.target.id !== "openProjectInput" || !e.target.files[0]) return;
    // The zip's own name is <YYMMDD>_<catalogue#>_<customer-email>.zip.
    document.getElementById("plantIdentity").textContent = e.target.files[0].name.replace(/\.zip$/i, "");
    plantDirty = false;
    plantSetLocked(true);
  }, true);
  // Only real user input counts — loadProject dispatches synthetic change
  // events while filling the form.
  for(const type of ["input", "change"]){
    plantForm.addEventListener(type, (e)=>{ if(e.isTrusted && !plantForm.disabled) plantDirty = true; });
  }
  addEventListener("beforeunload", (e)=>{ if(plantDirty){ e.preventDefault(); e.returnValue = ""; } });
}

// Spec boxes as plain always-open rows; previews open full size on click.
function plantInitLayout(){
  document.querySelectorAll("details.specs").forEach(d => { d.open = true; });
  document.addEventListener("click", (e)=>{
    const preview = e.target.closest(".label-preview");
    const media = preview && preview.querySelector("img, iframe");
    if(media && media.src) open(media.src, "_blank", "noopener");
  });
}

plantInitToolbar();
plantInitGuards();
plantInitLayout();
plantSetLocked(true);
```

Note: `details.specs` for the Side A audio specs is created by `initTracklist` (runs in `app.js` before this file), so it exists when `plantInitLayout` runs. Iframe previews swallow clicks inside the frame; clicking the preview's border area / wrapper still works — acceptable, see Task 7 which puts `pointer-events:none` on preview media so the click reaches `.label-preview`.

- [ ] **Step 2: Build and run tests**

Run: `node build/build.js && node --test tests/`
Expected: two `built …` lines, all PASS (the build's `Function()` compile check catches name collisions).

- [ ] **Step 3: Manual check** (ask the user before using Claude-in-Chrome)

Open `dist/plant.html`:
1. Load a project zip with audio + artwork (save one from `dist/index.html` first). Expected: toolbar shows the zip name; every field and file restored; artwork checklists show debug rows; status list shows ✓ items; all inputs disabled; no prompt about edits.
2. Click Save without editing. Expected: zip downloads, no note prompt.
3. Edit (god mode) → banner appears → change a quantity → Save → prompt. Cancel: nothing downloads. Save again, enter "qty test" → zip downloads; its `project.json` has one `history` entry, `order_summary.txt` ends with `HISTORY:`.
4. Edit again, change a field, click Load → "Discard unsaved edits?" → Cancel keeps the form; OK opens the picker. After loading, form is locked again.
5. With unsaved edits, close the tab → browser asks to leave.

- [ ] **Step 4: Commit**

```bash
git add src/plant.js
git commit -m "plant view: lock, god mode, edit note on save"
```

---

### Task 7: `plant.css` — dense layout

**Files:**
- Modify: `src/plant.css`

**Interfaces:**
- Consumes: `.plantbar`, `#plantIdentity`, `#godBanner` (Task 6); existing classes `details.info`, `details.specs`, `.spread-caption`, `.label-preview-wrap`, `.label-preview`, `.foot`, `header.top`, `#btnSend`, `#btnPrint`, `#btnDownloadSpecs`, `#sendPanel`.

- [ ] **Step 1: Implement**

`src/plant.css` (keep the header comment):
```css
body{ font-size:13px; }
section{ margin-bottom:8px; }
.sheet{ max-width:none; padding:8px 12px; }

.plantbar{
  position:sticky; top:0; z-index:10; display:flex; flex-wrap:wrap; align-items:center; gap:8px;
  background:var(--bg); border-bottom:1px solid var(--edge); padding:6px 0; margin-bottom:8px;
}
#plantIdentity{ font-family:var(--mono); margin-right:auto; }
#godBanner{ flex-basis:100%; background:var(--danger); color:#fff; padding:4px 8px; font-weight:600; }

/* Customer-only chrome. */
header.top, .foot, details.info, .spread-caption, .hint,
#btnSend, #btnPrint, #btnDownloadSpecs, #sendPanel{ display:none !important; }
::placeholder{ color:transparent; }

/* Spec boxes stay open (plant.js); no toggle. */
details.specs > summary{ display:none; }

/* The customer sheet dims :disabled to .4 — locked is not unavailable. */
#orderForm:disabled :disabled{ opacity:1; cursor:default; }

/* Thumbnails; the modules size previews with inline styles, hence !important. */
.label-preview-wrap{ height:160px !important; width:auto !important; max-width:100%; margin:4px 0 !important; }
#labelSides .label-preview-wrap{ width:160px !important; }
.label-preview{ cursor:zoom-in; }
.label-preview img, .label-preview iframe{ pointer-events:none; }

/* Sections flow in columns on wide screens, same order as the form. */
@media (min-width: 1400px){
  #orderForm{ columns:2 640px; column-gap:16px; }
  #orderForm > section, #orderForm > .cols2{ break-inside:avoid; }
}
```

- [ ] **Step 2: Build and run tests**

Run: `node build/build.js && node --test tests/`
Expected: all PASS.

- [ ] **Step 3: Manual check** (ask the user before using Claude-in-Chrome)

Open `dist/plant.html` with a loaded order: no header/footer/info icons/Send/Print/Specs; spec boxes are open rows without a toggle; locked controls are full-contrast; previews ~160px tall, spreads keep their aspect ratio, labels are square; clicking a preview opens it full size in a new tab; on a wide window sections flow in two columns without splitting a section; `dist/index.html` looks exactly as before.

- [ ] **Step 4: Commit**

```bash
git add src/plant.css
git commit -m "plant view: dense layout"
```

---

### Task 8: Document the plant view

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Edit**

In `## Commands`, change the build line's comment to `# build dist/index.html + dist/plant.html from src/`.
In `## Architecture`, add a bullet:
```markdown
- `src/plant.js` + `src/plant.css` — only in `dist/plant.html` (plant
  staff): same form, locked in a `<fieldset id="orderForm">` until
  "Edit (god mode)"; edits require a note, saved to `project.json`
  `history`. The build sets `globalThis.PLANT_VIEW`, which forces
  `isDebugMode()` on.
```

- [ ] **Step 2: Run tests**

Run: `node --test tests/`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: plant view"
```
