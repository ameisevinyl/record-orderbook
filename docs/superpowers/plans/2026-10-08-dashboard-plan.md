# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant view's home is a dashboard: a row per order from INBOX to DONE, a column per production line (labels, inner sleeves, covers, inlays, press, pack, ship) showing where that order stands; a menu of column presets; an archive view.

**Architecture:** `CONFIG.lines` grows from one line to seven; a line the order has no printed part for is `needed: false` and counts as done, so it never holds up the lines after it. Log-only lines (press, pack, ship) need no check results. A new pure lib `src/lib/dashboard.js` turns `/api/board` into rows and HTML (replacing `renderBoard`); `src/plant/app.js` only routes. The archive stage holds zips (written by `plant/archive.py`), so `/api/board` also lists them.

**Tech Stack:** plain ES modules, `node --test`; Python 3 stdlib + `unittest` for the archive listing.

**Spec:** `docs/superpowers/specs/2026-10-08-backend-structure-design.md` §2 (audio columns are v2, not in this plan; the `mastering` preset comes with them).

## Global Constraints

- No runtime dependencies; `src/lib/*.js` stay pure and DOM-free; new pure logic gets a test in `tests/`.
- Cells keep today's plain vocabulary: `✓`, `waiting`, `not checked`, the step name. The only colour is the existing `--danger` alarm for a step stopped by a check, and `--ink-dim` for waiting. No other colours.
- `plant/` Python does disk, the page decides; nothing about lines moves to Python.
- Line state stays derived on every scan from check results and `project.plant.lines`; nothing new is stored in `project.json`.
- `build/build.js` flattens modules into one scope for `dist/index.html`; `dashboard.js` is plant-view only (not in `FILES`), so no name-clash concern, but `config.js` is bundled: the new top-level name there (`PRINTED_STEPS`) must be unique.
- Tests: `node --test tests/` and `uv run --project plant python -m unittest discover plant`. Commit messages short, imperative, with the attribution line from the session reminder. Comments short, explain why.

## Review Focus

- An order with no printed part for a line (whitelabel on both sides, unprinted sleeves, no inlay) must show an empty cell and must not make press or pack wait (Task 2, Task 4).
- A printed part that is ordered but has no file yet must not read as "approve" (the five check steps pass vacuously on zero files): it stands at `size` with "no file uploaded yet" (Task 2).
- A job nobody opened yet (no cached check results) shows `not checked` for check lines, but press/pack/ship still work from the log (Task 2, Task 4).
- An unreadable `project.json` or a project that `prepareProject` refuses is one error row, never a broken dashboard (Task 4).
- Old bookmarks and typos: `#/board` and `#/view/nope` show the full dashboard; an empty or missing archive stage shows "Nothing archived." (Task 4 `viewFromHash`, Task 5).

---

### Task 1: Lines for every printed product and the shop floor; dashboard views in the config

**Files:**
- Modify: `src/config.js` (`lines`, new `dashboardViews`, a `PRINTED_STEPS` const), `src/lib/config-validation.js` (`validateLines`, a views check)
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces: `CONFIG.lines` with keys in column order `labels, innerSleeve, outerCover, inlay, press, pack, ship`; per line optional `stage` (string, a stage folder name); `CONFIG.dashboardViews: {[preset]: lineName[]}` = `{printed: ["labels","innerSleeve","outerCover","inlay"], pressing: ["press","pack","ship"]}`. Consumed by Tasks 2–6.

- [ ] **Step 1: Write the failing test** — append to `tests/config-validation.test.js`:

```js
test("validates line stages and dashboard views; the plant's lines and presets", () => {
  const stage = copy();
  stage.lines.labels.stage = 5;
  assert.throws(() => validateConfig(stage), /CONFIG\.lines\.labels\.stage must be a non-empty string/);

  const view = copy();
  view.dashboardViews.printed = ["labels", "polish"];
  assert.throws(() => validateConfig(view), /CONFIG\.dashboardViews\.printed\[1\] must name a line/);

  const missing = copy();
  delete missing.dashboardViews;
  assert.throws(() => validateConfig(missing), /CONFIG\.dashboardViews must be an object/);

  assert.deepEqual(Object.keys(CONFIG.lines), ["labels", "innerSleeve", "outerCover", "inlay", "press", "pack", "ship"]);
  assert.deepEqual(CONFIG.lines.press.after, ["labels"]);
  assert.deepEqual(CONFIG.lines.pack.after, ["press", "innerSleeve", "outerCover", "inlay"]);
  assert.deepEqual(CONFIG.dashboardViews, {
    printed: ["labels", "innerSleeve", "outerCover", "inlay"], pressing: ["press", "pack", "ship"]});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/config-validation.test.js`
Expected: FAIL (the new test; `CONFIG.dashboardViews` is undefined, the stage is not validated).

- [ ] **Step 3: Implement.** In `src/config.js`, right after the `ISO_COATED_V2` const add:

```js
// A printed part's line: the artwork checks, approval, then the printer.
const PRINTED_STEPS = ["size", "resolution", "pdf", "bleed", "colour", "approve", "send:printer", "back:printed"];
```

Replace the `// Production lines …` comment and the `lines: { … },` block with:

```js
  // Production lines (src/lib/lines.js), in dashboard column order: per
  // product its steps in order. Check steps (size, resolution, pdf, bleed,
  // colour) pass by the artwork checks; approve, send:<partners list> and
  // back:<what> are confirmed by staff. parts: the printed parts whose
  // files the line checks; an order without any of them printed doesn't
  // have the line, and none at all = a line of hand-confirmed steps for
  // every order. after: lines that must be through first. stage: the stage
  // folder the line belongs to (the job page suggests moving on when all
  // lines of its stage are through).
  lines: {
    labels:      { parts: ["labels"],      stage: "10_ORDERS/10_PREPRESS", steps: PRINTED_STEPS },
    innerSleeve: { parts: ["innerSleeve"], stage: "10_ORDERS/10_PREPRESS", steps: PRINTED_STEPS },
    outerCover:  { parts: ["outerCover"],  stage: "10_ORDERS/10_PREPRESS", steps: PRINTED_STEPS },
    inlay:       { parts: ["inlay"],       stage: "10_ORDERS/10_PREPRESS", steps: PRINTED_STEPS },
    press: { parts: [], stage: "10_ORDERS/20_PRESS", steps: ["approve", "back:pressed"], after: ["labels"] },
    pack:  { parts: [], stage: "10_ORDERS/20_PRESS", steps: ["back:packed"], after: ["press", "innerSleeve", "outerCover", "inlay"] },
    ship:  { parts: [], stage: "10_ORDERS/20_PRESS", steps: ["back:shipped"], after: ["pack"] }
  },
  // The dashboard's column presets (#/view/<name>): which lines show; the
  // default shows all of them. A mastering preset joins with the audio lines.
  dashboardViews: {
    printed: ["labels", "innerSleeve", "outerCover", "inlay"],
    pressing: ["press", "pack", "ship"]
  },
```

In `src/lib/config-validation.js`, inside `validateLines`'s `for(const [name, line] …)` loop, after the `parts` line add:

```js
    if(line.stage !== undefined) string(line.stage, `${path}.stage`);
```

and after the loop's closing brace (still inside `validateLines`, which receives `lines`), nothing more; add a new function below `validateLines`:

```js
function validateViews(views, lines){
  for(const [name, names] of Object.entries(object(views, "CONFIG.dashboardViews"))){
    array(names, `CONFIG.dashboardViews.${name}`).forEach((line, i) => {
      if(!lines[line]) fail(`CONFIG.dashboardViews.${name}[${i}]`, "must name a line");
    });
  }
}
```

and next to the existing `validateLines(config.lines, config.partners);` call add `validateViews(config.dashboardViews, config.lines);`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/`
Expected: all pass (existing `tests/lines.test.js` still green: the `labels` line is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/config-validation.test.js
git commit -m "config: lines for inner sleeves, covers, inlays, press, pack, ship; dashboard column presets"
```

---

### Task 2: `needed` lines, log-only lines without check results, `linesOfStage`, `stageReady`

**Files:**
- Modify: `src/lib/lines.js`
- Test: `tests/lines.test.js`

**Interfaces:**
- Consumes: `CONFIG.lines` / `dashboardViews` (Task 1), `productById` and `getFormat` from `./format-catalogue.js`.
- Produces: `lineNeeded(project, config, lineName) -> boolean`; `lineState(...)` additionally returns `needed: boolean` (an unneeded line: `{line, steps, step: null, why: "", ready: true, done: true, waiting: false, checking: false, needed: false}`); a line without check steps never reports `checking`; a needed line with check steps and no files stands at `size` with why `"no file uploaded yet"`; `linesOfStage(config, stage) -> string[]`; `stageReady(config, stage, states) -> boolean` (states: lineState results; false when the stage has no lines).

- [ ] **Step 1: Write the failing tests** — append to `tests/lines.test.js` (add `linesOfStage, stageReady, lineNeeded` to the existing import from `../src/lib/lines.js`):

```js
// An order: labels A/B printed by default; sleeve: the coverSleeve parts; log: project.plant.lines.
function order({labels, sleeve = {}, log = {}} = {}){
  return prepareProject({projectVersion: 1, format: "7", catalogue: "K",
    labels: {sides: labels || {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}},
    coverSleeve: sleeve, plant: {lines: log}}, CONFIG);
}
const white = {A: {whitelabel: true}, B: {whitelabel: true}};
const hand = (step, extra = {}) => ({step, by: "staff", at: "t", files: {}, ...extra});

test("a line is needed only for what the order has printed", () => {
  const plain = order({labels: white, sleeve: {innerSleeve: {productId: "sleeve-white-cutout"}}});
  assert.deepEqual(["labels", "innerSleeve", "outerCover", "inlay", "press", "pack", "ship"]
    .map(n => lineNeeded(plain, CONFIG, n)), [false, false, false, false, true, true, true]);
  const printed = order({sleeve: {innerSleeve: {productId: "sleeve-printed"}, cover: {productId: "cover-printed"},
    inlay: {productId: "inlay-printed"}}});
  assert.deepEqual(["labels", "innerSleeve", "outerCover", "inlay"].map(n => lineNeeded(printed, CONFIG, n)),
    [true, true, true, true]);
  const one = order({labels: {A: {whitelabel: true}, B: {fileName: "K_labels_B_v1.pdf"}}});
  assert.equal(lineNeeded(one, CONFIG, "labels"), true, "one printed side is enough");
  const s = lineState(plain, CONFIG, "labels", {});
  assert.deepEqual([s.needed, s.done, s.ready, s.waiting, s.checking, s.step], [false, true, true, false, false, null]);
});

test("a printed part that is ordered but not uploaded stands at size, not at approve", () => {
  const p = order({sleeve: {cover: {productId: "cover-printed"}}});
  const s = lineState(p, CONFIG, "outerCover", {});
  assert.deepEqual([s.needed, s.step], [true, "size"]);
  assert.match(s.why, /no file uploaded yet/);
});

test("log-only lines need no check results and wait for the lines they come after", () => {
  // Whitelabel, no printed sleeves: nothing to wait for but the log.
  const plain = order({labels: white});
  const press = lineState(plain, CONFIG, "press", null);
  assert.deepEqual([press.checking, press.waiting, press.step], [false, false, "approve"]);
  assert.equal(lineState(plain, CONFIG, "pack", null).waiting, true, "pack waits for press");
  const pressed = order({labels: white, log: {press: [hand("approve"), hand("back:pressed")]}});
  assert.equal(lineState(pressed, CONFIG, "press", null).done, true);
  const pack = lineState(pressed, CONFIG, "pack", null);
  assert.deepEqual([pack.waiting, pack.step], [false, "back:packed"]);
  // Printed labels not checked yet: press waits for them.
  const waiting = lineState(order(), CONFIG, "press", null);
  assert.deepEqual([waiting.checking, waiting.waiting], [false, true]);
});

test("lines of a stage, and when they are all ready to move on", () => {
  assert.deepEqual(linesOfStage(CONFIG, "10_ORDERS/10_PREPRESS"), ["labels", "innerSleeve", "outerCover", "inlay"]);
  assert.deepEqual(linesOfStage(CONFIG, "10_ORDERS/20_PRESS"), ["press", "pack", "ship"]);
  assert.deepEqual(linesOfStage(CONFIG, "20_DONE"), []);
  const ready = {ready: true}, notReady = {ready: false};
  assert.equal(stageReady(CONFIG, "10_ORDERS/10_PREPRESS", [{line: "labels", ...ready}, {line: "press", ...notReady}]), true,
    "a line of another stage doesn't count");
  assert.equal(stageReady(CONFIG, "10_ORDERS/10_PREPRESS", [{line: "labels", ...notReady}]), false);
  assert.equal(stageReady(CONFIG, "20_DONE", [{line: "labels", ...ready}]), false, "no lines in the stage, no hint");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/lines.test.js`
Expected: FAIL (`lineNeeded` is not exported, and the others).

- [ ] **Step 3: Implement in `src/lib/lines.js`.** Change the import line to `import { getFormat, productById } from "./format-catalogue.js";` and add, below `lineFiles`:

```js
// Whether the order has the part printed: a label side that isn't whitelabel,
// a sleeve, cover or inlay product of kind "printed".
function ordered(project, config, part){
  if(part === "labels") return ["A", "B"].some(side => !project.labels.sides[side].whitelabel);
  const sleeve = project.coverSleeve;
  const chosen = {innerSleeve: sleeve.innerSleeve, outerCover: sleeve.cover, inlay: sleeve.inlay}[part];
  const parts = getFormat(config, project.format).printableParts || {};
  const product = productById((parts[part] && parts[part].products) || [], chosen.productId);
  return !!product && product.kind === "printed";
}

// A line with no parts is every order's; one with parts only when an order has one of them printed.
export function lineNeeded(project, config, lineName){
  const {parts} = config.lines[lineName];
  return !parts.length || parts.some(part => ordered(project, config, part));
}

export const linesOfStage = (config, stage) => Object.keys(config.lines).filter(name => config.lines[name].stage === stage);

// All lines of the job's stage are ready (states: lineState results): move on? None in the stage, no hint.
export function stageReady(config, stage, states){
  const names = linesOfStage(config, stage);
  return names.length > 0 && states.filter(s => names.includes(s.line)).every(s => s.ready);
}
```

Replace the body of `lineState` from its first line through the `if(!checkResults) return …` line with:

```js
export function lineState(project, config, lineName, checkResults){
  const line = config.lines[lineName];
  const steps = line.steps.map(step => ({step, kind: kindOf(step), state: "ahead"}));
  // Not on this order: nothing to do, and nothing for later lines to wait for.
  if(!lineNeeded(project, config, lineName)){
    return {line: lineName, steps, step: null, why: "", ready: true, done: true, waiting: false, checking: false, needed: false};
  }
  const files = lineFiles(project, config, lineName);
  const waiting = (line.after || []).some(other => !lineState(project, config, other, checkResults).done);
  // Only check steps need the artwork check results; a line of hand-confirmed steps doesn't.
  if(!checkResults && steps.some(s => s.kind === "check")){
    return {line: lineName, steps, step: null, why: "checking", ready: false, done: false, waiting, checking: true, needed: true};
  }
  const results = checkResults || {};
```

In the rest of `lineState` replace every `checkResults[` / `checkResults)` use with `results`: `current` becomes `Object.fromEntries(files.map(f => [f.name, (results[f.name] || {}).sha256]))`; the check-step reasons become

```js
      const reasons = !files.length ? ["no file uploaded yet"]
        : files.map(f => results[f.name] ? failing(s.step, results[f.name], f.slot, printCheck)
          : `${f.slot.title}: not checked yet`).filter(Boolean);
```

and the final return gains `needed: true`:
`return {line: lineName, steps, step: at, why: at ? why : "", ready, done: at === null, waiting, checking: false, needed: true};`
(`printCheck` still comes from `getFormat(config, project.format).printCheck`.)

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/`
Expected: all pass, the earlier `lines.test.js` tests included (labels with files and results behave as before; a null result for `labels` still reports `checking: true`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lines.js tests/lines.test.js
git commit -m "lines: a line the order doesn't have is done, hand-confirmed lines need no check results, no file stands at size; stage helpers"
```

---

### Task 3: The job page shows only the order's lines and moves on per stage

**Files:**
- Modify: `src/lib/plant-overview.js` (`renderProduction`), `src/plant/app.js` (`showJob`)
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `lineState().needed`, `stageReady(config, stage, states)` (Task 2).
- Produces: `renderProduction(states, partners)` leaves out states with `needed === false`.

- [ ] **Step 1: Write the failing test** — append to `tests/plant-overview.test.js` (next to the existing production test; it already imports `renderProduction`):

```js
test("production: a line the order doesn't have isn't shown", () => {
  const html = renderProduction([
    {line: "inlay", steps: [], step: null, why: "", ready: true, done: true, waiting: false, checking: false, needed: false},
    {line: "press", steps: [{step: "approve", kind: "approve", state: "current"}], step: "approve", why: "", ready: false,
      done: false, waiting: false, checking: false, needed: true}
  ], {});
  assert.ok(html.includes("<h3>press</h3>"));
  assert.ok(!html.includes("inlay"));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/plant-overview.test.js` — Expected: FAIL (`inlay` is rendered as done).

- [ ] **Step 3: Implement.** In `src/lib/plant-overview.js`, `renderProduction`: change `return section("production", states.map(s => {` to `return section("production", states.filter(s => s.needed !== false).map(s => {` (fixtures without `needed` still render). In `src/plant/app.js`: add `stageReady` to the lines import (`import { lineState, logEntry, stageReady } from "../lib/lines.js";`) and replace

```js
    replace("basic", renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps,
      states.length > 0 && states.every(s => s.ready)));
```
with
```js
    replace("basic", renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps,
      stageReady(CONFIG, data.stage, states)));
```

- [ ] **Step 4: Run all tests** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js src/plant/app.js tests/plant-overview.test.js
git commit -m "job page: production shows only the order's lines; move-on hint looks at the lines of the job's stage"
```

---

### Task 4: The dashboard lib

**Files:**
- Create: `src/lib/dashboard.js`, `tests/dashboard.test.js`

**Interfaces:**
- Consumes: `lineState` (Task 2), `prepareProject`, `escapeHtml` / `stageLabel` from `./plant-overview.js`, `CONFIG.lines` / `dashboardViews` (Task 1).
- Produces:
  - `lineCell(state) -> {text, cls, title}` (`cls`: `""` | `"done"` | `"wait"` | `"stop"`).
  - `viewLines(config, view) -> string[]` (a known preset's lines, else all lines).
  - `viewFromHash(hash, views) -> string` (`"#/view/<name>"` with `name` in `views`, else `""`).
  - `dashboardRows(board, config) -> [{stage, rows: [{job, name, error?, cells: {[line]: lineCell}}]}]` (board: `/api/board`; grouping stages and `99_ARCHIVE` left out; empty stages kept).
  - `renderDashboard(groups, lineNames, view, views) -> html` (views: preset names; empty stages not shown).

- [ ] **Step 1: Write the failing tests** — `tests/dashboard.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { lineCell, viewLines, viewFromHash, dashboardRows, renderDashboard } from "../src/lib/dashboard.js";

const printed = {projectVersion: 1, format: "7", catalogue: "K",
  labels: {sides: {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}}};
const white = {projectVersion: 1, format: "7", catalogue: "W", labels: {sides: {A: {whitelabel: true}, B: {whitelabel: true}}}};
const board = {stages: [
  {stage: "00_INBOX", jobs: [{job: "K_x_261001-1000", catalogue: "K", title: "High <Riding>", project: printed, artwork: {}}]},
  {stage: "10_ORDERS", jobs: []},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [
    {job: "bad", error: "project.json is not valid JSON"},
    {job: "Z", catalogue: "Z", title: "", project: {projectVersion: 1, format: "99", catalogue: "Z"}, artwork: {}}]},
  {stage: "10_ORDERS/20_PRESS", jobs: [{job: "W_y_261001-1000", catalogue: "W", title: "", project: white, artwork: {}}]},
  {stage: "20_DONE", jobs: []},
  {stage: "99_ARCHIVE", jobs: []}
]};
const views = Object.keys(CONFIG.dashboardViews);

test("cells: plain words, empty when the order doesn't have the line, the alarm only for a stopped check", () => {
  const base = {needed: true, done: false, waiting: false, checking: false, step: "size", why: ""};
  assert.deepEqual(lineCell({...base, needed: false}), {text: "", cls: "", title: ""});
  assert.deepEqual(lineCell(undefined), {text: "", cls: "", title: ""});
  assert.deepEqual(lineCell({...base, done: true}), {text: "✓", cls: "done", title: ""});
  assert.deepEqual(lineCell({...base, waiting: true}), {text: "waiting", cls: "wait", title: ""});
  assert.deepEqual(lineCell({...base, checking: true}), {text: "not checked", cls: "wait", title: ""});
  assert.deepEqual(lineCell({...base, why: "Label A: 96×96mm, expected 98×98mm"}),
    {text: "size", cls: "stop", title: "Label A: 96×96mm, expected 98×98mm"});
  assert.deepEqual(lineCell({...base, step: "approve"}), {text: "approve", cls: "", title: ""});
});

test("view lines: a known preset, else every line; the hash picks the preset", () => {
  assert.deepEqual(viewLines(CONFIG, "printed"), ["labels", "innerSleeve", "outerCover", "inlay"]);
  assert.deepEqual(viewLines(CONFIG, "pressing"), ["press", "pack", "ship"]);
  for(const unknown of ["", "nope", "constructor"]) assert.deepEqual(viewLines(CONFIG, unknown), Object.keys(CONFIG.lines));
  assert.equal(viewFromHash("#/view/printed", views), "printed");
  for(const hash of ["#/", "#/board", "#/view/nope", "#/view/", "#/job/printed", ""]) assert.equal(viewFromHash(hash, views), "", hash);
});

test("rows: per stage that can hold jobs, not the grouping stage or the archive; errors as rows", () => {
  const groups = dashboardRows(board, CONFIG);
  assert.deepEqual(groups.map(g => g.stage), ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS", "20_DONE"]);
  const [k] = groups[0].rows;
  assert.equal(k.name, "K — High <Riding>");
  // Printed labels nobody checked yet; press, pack and ship wait behind them.
  assert.equal(k.cells.labels.text, "not checked");
  assert.equal(k.cells.innerSleeve.text, "", "no printed sleeve ordered");
  assert.deepEqual(["press", "pack", "ship"].map(n => k.cells[n].text), ["waiting", "waiting", "waiting"]);
  // Whitelabel: no labels line, the press is next.
  const [w] = groups[2].rows;
  assert.deepEqual([w.cells.labels.text, w.cells.press.text, w.cells.pack.text], ["", "approve", "waiting"]);
  const [bad, z] = groups[1].rows;
  assert.deepEqual([bad.error, bad.cells], ["project.json is not valid JSON", {}]);
  assert.match(z.error, /Unknown format ID "99"/);
});

test("render: a table per the chosen columns, stage rows with counts, empty stages left out, everything escaped", () => {
  const groups = dashboardRows(board, CONFIG);
  const all = renderDashboard(groups, viewLines(CONFIG, ""), "", views);
  assert.ok(all.includes('<a href="#/job/K_x_261001-1000">K — High &lt;Riding&gt;</a>'));
  assert.ok(all.includes("INBOX (1)") && all.includes("ORDERS › PREPRESS (2)") && all.includes("ORDERS › PRESS (1)"));
  assert.ok(!all.includes("DONE"), "an empty stage isn't listed");
  assert.ok(all.includes('<td class="wait">not checked</td>'));
  assert.ok(all.includes('<td colspan="7" class="stop">project.json is not valid JSON</td>'));
  assert.ok(all.includes("<b>all</b>") && all.includes('<a href="#/view/printed">printed</a>'));
  for(const line of Object.keys(CONFIG.lines)) assert.ok(all.includes(`<th scope="col">${line}</th>`), line);

  const some = renderDashboard(groups, viewLines(CONFIG, "printed"), "printed", views);
  assert.ok(some.includes("<b>printed</b>") && some.includes('<a href="#/">all</a>'));
  assert.ok(!some.includes('<th scope="col">press</th>'));
  assert.ok(some.includes('<td colspan="4" class="stop">'));
  assert.ok(renderDashboard([{stage: "20_DONE", rows: []}], ["labels"], "", views).includes("No orders."));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/dashboard.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/dashboard.js`:**

```js
// The plant view's dashboard: a row per order, a column per production line,
// grouped by stage. Pure, like plant-board.js: every value is escaped here.

import { prepareProject } from "./project.js";
import { lineState } from "./lines.js";
import { escapeHtml, stageLabel } from "./plant-overview.js";

// The archive holds zips (plant/archive.py), not jobs: its own view.
const ARCHIVE = "99_ARCHIVE";

// A line's state as a cell: plain words; the alarm colour only for a step stopped by a check.
export function lineCell(s){
  if(!s || !s.needed) return {text: "", cls: "", title: ""};
  if(s.done) return {text: "✓", cls: "done", title: ""};
  if(s.waiting) return {text: "waiting", cls: "wait", title: ""};
  if(s.checking) return {text: "not checked", cls: "wait", title: ""};
  return {text: s.step, cls: s.why ? "stop" : "", title: s.why};
}

// The lines a preset shows (CONFIG.dashboardViews); anything else shows all.
export function viewLines(config, view){
  return Object.hasOwn(config.dashboardViews, view) ? config.dashboardViews[view] : Object.keys(config.lines);
}

// "#/view/<preset>" → the preset's name, "" for everything else (the full dashboard).
export function viewFromHash(hash, views){
  const [, name] = /^#\/view\/(\w+)$/.exec(hash) || [];
  return views.includes(name) ? name : "";
}

// board: /api/board. Per stage that can hold jobs its rows; a card the
// server couldn't read, or a project the page refuses, is an error row.
export function dashboardRows(board, config){
  const names = Object.keys(config.lines);
  const grouping = new Set(board.stages.filter(s => board.stages.some(t => t.stage.startsWith(s.stage + "/"))).map(s => s.stage));
  return board.stages.filter(s => !grouping.has(s.stage) && s.stage !== ARCHIVE).map(({stage, jobs}) => ({stage, rows: jobs.map(card => {
    if(card.error) return {job: card.job, name: card.job, error: card.error, cells: {}};
    const name = [card.catalogue || card.job, card.title].filter(Boolean).join(" — ");
    try{
      const project = prepareProject(card.project, config);
      // A job nobody opened has no check results yet.
      const results = Object.keys(card.artwork || {}).length ? card.artwork : null;
      return {job: card.job, name, cells: Object.fromEntries(names.map(n => [n, lineCell(lineState(project, config, n, results))]))};
    }catch(error){
      return {job: card.job, name, error: error.message, cells: {}};
    }
  })}));
}

const cellHtml = c => `<td${c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${escapeHtml(c.title)}"` : ""}>${escapeHtml(c.text)}</td>`;

// The column presets: the current one bold, the others links (all = #/).
const viewLinks = (view, views) => `<p>Columns: ` + [["", "all"], ...views.map(v => [v, v])].map(([v, text]) =>
  v === view ? `<b>${escapeHtml(text)}</b>` : `<a href="${v ? `#/view/${v}` : "#/"}">${escapeHtml(text)}</a>`).join(" · ") + `</p>`;

// groups: dashboardRows(); lineNames: the columns (viewLines); view: the
// preset shown ("" = all); views: the presets' names.
export function renderDashboard(groups, lineNames, view, views){
  const shown = groups.filter(g => g.rows.length);
  const head = ["Order", ...lineNames].map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  const body = shown.map(({stage, rows}) => `<tr class="stage"><th scope="rowgroup" colspan="${lineNames.length + 1}">`
    + `${escapeHtml(stageLabel(stage))} (${rows.length})</th></tr>`
    + rows.map(r => `<tr><td><a href="#/job/${encodeURIComponent(r.job)}">${escapeHtml(r.name)}</a></td>`
      + (r.error ? `<td colspan="${lineNames.length}" class="stop">${escapeHtml(r.error)}</td>`
        : lineNames.map(n => cellHtml(r.cells[n])).join("")) + `</tr>`).join("")).join("");
  return `<h2>Dashboard</h2>${viewLinks(view, views)}`
    + (shown.length ? `<table class="dashboard"><tr>${head}</tr>${body}</table>` : "<p>No orders.</p>");
}
```

- [ ] **Step 4: Run to verify it passes** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard.js tests/dashboard.test.js
git commit -m "dashboard: rows per order and columns per line from the board, column presets, cells in plain words"
```

---

### Task 5: The archive listing

**Files:**
- Modify: `plant/jobs.py` (`ARCHIVE`, `iso`, `archived`, `board`), `plant/archive.py` (use `jobs.ARCHIVE`), `src/lib/plant-overview.js` (export `formatSize`, `when`), `src/lib/plant-board.js` (`renderArchive`)
- Test: `plant/test_jobs.py`, `plant/test_server.py`, `tests/plant-board.test.js`

**Interfaces:**
- Produces: `jobs.ARCHIVE = "99_ARCHIVE"`; `jobs.archived(root) -> [{name, size, modified}]` (the archive stage's `.zip` files, newest first; `[]` when the stage is missing); `jobs.board(root)` additionally carries `"archive": archived(root)`; JS `renderArchive(items) -> html`; `formatSize(bytes)` and `when(iso)` exported from `plant-overview.js`.

- [ ] **Step 1: Write the failing tests.** In `plant/test_jobs.py` add `import os` to the imports and, to `JobsTest`:

```python
    def test_archived_lists_the_archive_zips_newest_first(self):
        folder = self.root / "99_ARCHIVE"
        for name, data, when in (("old.zip", b"1", 1_000_000_000), ("new.zip", b"22", 1_700_000_000)):
            (folder / name).write_bytes(data)
            os.utime(folder / name, (when, when))
        (folder / ".new.zip.part").write_bytes(b"half")
        (folder / "notes.txt").write_text("x")
        listing = jobs.archived(self.root)
        self.assertEqual([(e["name"], e["size"]) for e in listing], [("new.zip", 2), ("old.zip", 1)])
        self.assertRegex(listing[0]["modified"], r"^2023-11-14T\d\d:\d\d:\d\dZ$")
        self.assertEqual(jobs.board(self.root)["archive"], listing)

    def test_archived_without_an_archive_stage_is_empty(self):
        (self.root / "99_ARCHIVE").rmdir()
        self.assertEqual(jobs.archived(self.root), [])
```

In `plant/test_server.py`, `HttpTest`, add:

```python
    def test_board_lists_the_archive(self):
        self.assertEqual(self.get("/api/board")[1]["archive"], [])
        (self.root / "99_ARCHIVE" / "j.zip").write_bytes(b"zip")
        self.assertEqual([e["name"] for e in self.get("/api/board")[1]["archive"]], ["j.zip"])
```

In `tests/plant-board.test.js` change the import to `import { renderNav, renderHome, renderInbox, renderArchive } from "../src/lib/plant-board.js";` (`renderBoard` is still exported until Task 6, so for now the import reads `{ renderNav, renderHome, renderInbox, renderBoard, renderArchive }`) and append:

```js
test("archive: the zips with size and date; nothing archived", () => {
  const html = renderArchive([{name: "K_x_261001-1000.zip", size: 3 * 1048576, modified: "2026-10-01T12:00:00Z"},
    {name: "a<b>.zip", size: 100, modified: "2026-09-01T08:30:00Z"}]);
  assert.ok(html.includes("<h2>Archive</h2>"));
  assert.ok(html.includes("<tr><td>K_x_261001-1000</td><td>3.0 MB</td><td>2026-10-01 12:00</td></tr>"));
  assert.ok(html.includes("<td>a&lt;b&gt;</td><td>1 KB</td>"));
  assert.ok(renderArchive([]).includes("Nothing archived."));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --project plant python -m unittest discover plant -p "test_jobs.py" -k archived` and `node --test tests/plant-board.test.js`
Expected: FAIL (`jobs.archived` missing; `renderArchive` not exported).

- [ ] **Step 3: Implement.** `plant/jobs.py`: next to `INBOX = "00_INBOX"` add `ARCHIVE = "99_ARCHIVE"`. Replace the time formatting in `files()` with a helper and use it in `archived()`:

```python
def iso(mtime):
    """A modification time as ISO, UTC."""
    return datetime.fromtimestamp(mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
```

and in `files()` use `"modified": iso(st.st_mtime)` (delete the local `modified = …` line). Add below `files()`:

```python
def archived(root):
    """The zips plant/archive.py wrote into the archive stage, newest first."""
    folder = root / ARCHIVE
    if not folder.is_dir():
        return []
    listing = []
    for p in folder.iterdir():
        if p.is_file() and p.suffix == ".zip" and not p.name.startswith("."):
            st = p.stat()
            listing.append({"name": p.name, "size": st.st_size, "modified": iso(st.st_mtime)})
    return sorted(listing, key=lambda e: e["modified"], reverse=True)
```

In `board()` change the return to `return {"stages": columns, "inbox": inbox(root), "problems": problems, "archive": archived(root)}`. In `plant/archive.py` replace `DONE, ARCHIVE = "20_DONE", "99_ARCHIVE"` with `DONE, ARCHIVE = "20_DONE", jobs.ARCHIVE`.

`src/lib/plant-overview.js`: change `const when = iso =>` to `export const when = iso =>` and `function formatSize(bytes){` to `export function formatSize(bytes){`. `src/lib/plant-board.js`: change the import to `import { escapeHtml, stageLabel, SECTIONS, listTable, formatSize, when } from "./plant-overview.js";` and append:

```js
// The archive stage: the zips archive.py wrote (name, size, when).
export function renderArchive(items){
  return `<h2>Archive</h2>` + (items.length
    ? listTable(["Archived job", "Size", "Archived"], items.map(i => [escapeHtml(i.name.replace(/\.zip$/i, "")), formatSize(i.size), when(i.modified)]))
    : "<p>Nothing archived.</p>");
}
```

- [ ] **Step 4: Run both suites**

Run: `uv run --project plant python -m unittest discover plant` and `node --test tests/`
Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add plant/jobs.py plant/archive.py plant/test_jobs.py plant/test_server.py src/lib/plant-overview.js src/lib/plant-board.js tests/plant-board.test.js
git commit -m "plant: /api/board lists the archive zips; archive view renderer"
```

---

### Task 6: The plant view shows the dashboard, the presets and the archive

**Files:**
- Modify: `src/plant/app.js` (routes), `src/lib/plant-board.js` (nav loses the Board link; `renderBoard` removed), `src/lib/menu.js` (Archive entry), `src/plant/theme.css`
- Test: `tests/plant-board.test.js`, `tests/menu.test.js`

**Interfaces:**
- Consumes: `dashboardRows`, `renderDashboard`, `viewLines`, `viewFromHash` (Task 4), `renderArchive` (Task 5), `board.archive`.
- Produces: routes `#/` (dashboard, then the attention list), `#/view/<preset>`, `#/archive`; a menu entry `["Archive", "/#/archive"]`.

- [ ] **Step 1: Update the tests first.** `tests/menu.test.js`: the expected hrefs become `["/", "/#/archive", "/src/pricelist.html", "/src/plant-config.html"]`. `tests/plant-board.test.js`: import `{ renderNav, renderHome, renderInbox, renderArchive }`; in the first nav test replace the `startsWith(...)` assertion with `assert.ok(html.startsWith("<h2>Jobs</h2>"));`; delete the tests `"board grid: …"` and `"nav: a Board link first"`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/menu.test.js tests/plant-board.test.js` — Expected: FAIL (menu hrefs, nav still starts with the Board link).

- [ ] **Step 3: Implement.**
  - `src/lib/menu.js`: the `MENU` list becomes `[["Plant view", "/"], ["Archive", "/#/archive"], ["Pricelist", "/src/pricelist.html"], ["Plant config", "/src/plant-config.html"]]`.
  - `src/lib/plant-board.js`: in `renderNav` the `let html = …` line starts `<h2>Jobs</h2><ul>…` (drop `<p><a href="#/board">Board</a></p>`); delete `renderBoard` and its comment.
  - `src/plant/app.js`: replace the import `import { renderNav, renderHome, renderInbox, renderBoard } from "../lib/plant-board.js";` with `import { renderNav, renderHome, renderInbox, renderArchive } from "../lib/plant-board.js";` and add `import { dashboardRows, renderDashboard, viewLines, viewFromHash } from "../lib/dashboard.js";`. Change the routes comment to `// --- Routes: #/ · #/view/<preset> · #/archive · #/inbox/<item> · #/job/<job>[/<section>]`. In `route()` replace the two lines

```js
    else if(location.hash === "#/board") out.innerHTML = boardHtml(board);
    else out.innerHTML = renderHome(board);
```
with
```js
    else if(location.hash === "#/archive") out.innerHTML = renderArchive(board.archive);
    else out.innerHTML = dashboardHtml(board) + renderHome(board);
```
and replace the whole `boardHtml` function (and its comment) with:

```js
// The dashboard: every order's lines, the columns of the preset in the hash.
function dashboardHtml(board){
  const view = viewFromHash(location.hash, Object.keys(CONFIG.dashboardViews));
  return renderDashboard(dashboardRows(board, CONFIG), viewLines(CONFIG, view), view, Object.keys(CONFIG.dashboardViews));
}
```
  The `prepareProject` import stays (used in `showJob`); `lineState` too.
  - `src/plant/theme.css`: after the `#menu` rules add:

```css
/* --- Dashboard: a row per order, a column per line; plain words, one alarm colour. --- */
table.dashboard td.wait{ color:var(--ink-dim); }
table.dashboard td.stop{ color:var(--danger); font-weight:700; }
table.dashboard tr.stage th{ text-align:left; background:var(--field); }
```

- [ ] **Step 4: Run all tests** — `node --test tests/` and `uv run --project plant python -m unittest discover plant` — Expected: both green (`tests/plant-page.test.js` still finds its skeleton; the theme test still finds `--ink`, `--danger`).

- [ ] **Step 5: Commit**

```bash
git add src/plant/app.js src/lib/plant-board.js src/lib/menu.js src/plant/theme.css tests/menu.test.js tests/plant-board.test.js
git commit -m "plant view: the dashboard is the home, column presets at #/view/<preset>, archive view; the old board is gone"
```

---

### Task 7: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (Architecture: the plant view bullet's production lines sentence), `docs/superpowers/specs/2026-10-02-production-lines-design.md` (the "later:" comment), `docs/superpowers/specs/2026-10-08-backend-structure-design.md` (§2)

- [ ] **Step 1: `CLAUDE.md`.** After the sentence that ends `… keeps an append-only log whose entries count while their files keep their sha256.` add: `Lines run per printed product (labels, innerSleeve, outerCover, inlay) and press, pack, ship (hand-confirmed steps only); a line the order has no printed part for is not on the order (\`needed: false\`) and counts as done, so it never holds up the lines after it. The dashboard (\`src/lib/dashboard.js\`, the plant view's home) shows a row per order and a column per line; \`CONFIG.dashboardViews\` are the column presets (\`#/view/<preset>\`); \`#/archive\` lists the zips \`plant/archive.py\` wrote.`

- [ ] **Step 2: Specs.** In `2026-10-02-production-lines-design.md` the `// later: master, innerSleeve, …` comment line: replace with `// innerSleeve, outerCover, inlay, press, pack, ship: see CONFIG.lines; audio (master, reference cut, plating) and invoice follow`. In `2026-10-08-backend-structure-design.md` §2 replace the sentence `- **Role presets** (mastering, pressing, printed) are a menu on the dashboard choosing which line columns show.` with `- **Role presets** are \`CONFIG.dashboardViews\` (printed, pressing; mastering joins with the audio lines), a link row on the dashboard (\`#/view/<preset>\`) choosing which line columns show.` and add the bullet `- The archive stage holds zips, not jobs: \`#/archive\` lists them from \`/api/board\` (\`archive\`).`

- [ ] **Step 3: Full run** — `node --test tests/` and `uv run --project plant python -m unittest discover plant` — Expected: both green.

- [ ] **Step 4: Live check on a second port** (the user's server on :8765 keeps its old code; do not touch it): `uv run --project plant plant/server.py --port 8766 --jobs <scratch folder>` in the background; put two jobs in (a `project.json` with printed labels in `00_INBOX/<job>/`, a whitelabel one in `10_ORDERS/20_PRESS/<job>/`; `plant/test_jobs.py` shows the minimal shape); `curl -s http://127.0.0.1:8766/api/board` carries `archive` and both cards; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8766/src/lib/dashboard.js` is 200; stop the server. Opening the dashboard in a browser is a manual check: ask the user first (token cost), then look for the stage rows, the cell words, the `Columns:` links, `#/archive`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-02-production-lines-design.md docs/superpowers/specs/2026-10-08-backend-structure-design.md
git commit -m "docs: dashboard, lines per product, archive view"
```

---

## Self-review

- **Spec coverage (§2):** row per order INBOX–DONE, archive separate → Tasks 4–6 (`dashboardRows` skips `99_ARCHIVE`; `renderArchive`); cells in today's plain vocabulary, no new colours but the alarm → Task 4 `lineCell`, Task 6 CSS; row click opens the order → the link in `renderDashboard`; v1 lines labels, inner sleeves, covers, inlays, plus log-only press/pack/ship; a column cell only for what the order orders → Tasks 1–2 (`needed`); `lineState`/`board()` artwork-only limitation → handled: log-only lines need no results (Task 2), audio left to v2 as the spec says; role presets as a column filter on the dashboard, one renderer, no extra routes beyond `#/view/<preset>` → Tasks 1, 4, 6; pure rendering in `src/lib`, tested like `plant-board.js` → Task 4. The open item "exact steps for press, pack, ship" is decided in Task 1 (`approve → back:pressed`, `back:packed`, `back:shipped`, `after` chains).
- **Placeholders:** none; every step has its code. Task 7 step 4's job fixtures point at `plant/test_jobs.py`'s helper shape rather than a literal file because they are scratch data for a manual check.
- **Type consistency:** `lineState` → `needed` (Task 2) is read by `renderProduction` (Task 3) and `lineCell` (Task 4); `viewLines(config, view)`, `viewFromHash(hash, views)`, `renderDashboard(groups, lineNames, view, views)`, `dashboardRows(board, config)` are used with these signatures in Task 6; `board.archive` (Task 5) feeds `renderArchive` (Task 6); `stageReady(config, stage, states)` (Task 2) is what `app.js` calls (Task 3).
