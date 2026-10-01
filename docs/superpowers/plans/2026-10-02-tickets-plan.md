# Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant view shows each job's work as tickets derived from config, files and check results: order complete; label size, bleed, colour and file fixes; artwork approval. People's decisions (done, approved, told, seen) are stored in `project.json`. The plant view also gets a move suggestion and a grid board.

**Architecture:**
- `src/lib/tickets.js` (pure) holds the ticket type registry and `deriveTickets(project, config, files, artworkFacts)`, which returns derived tickets merged with the decisions stored in `project.plant.tickets`.
- The page writes decisions by saving the whole `project.json` through a new generic `POST /api/project`, the same safe write "use" relies on.
- The checks add each file's sha256 to their results. Approvals compare against it.
- `/api/board` carries each job's project, files and cached artwork facts, so the board grid can derive tickets for every job.

**Tech Stack:** plain ES modules (`node --test`); Python stdlib server (`unittest`).

**Spec:** `docs/superpowers/specs/2026-10-02-tickets-design.md`

## Global Constraints

- **Derived, not stored:** tickets are derived on every scan. `project.json` stores only `plant.tickets[<id>]` decisions: `seen {at}`, `done {by, at, note}`, `approved {by, at, sha256}`, `notified {at}`, `assignee`, `priority`. `by` is `"staff"` or `"customer"`.
- **Ids:** `<type>:<subject>`. Subject is `labels.A`/`labels.B` (and later `innerSleeve`, `cover`, `inlay.front`, `inlay.back`) or `order`.
- **States:** `waiting` | `open` | `done`. `doneBy` is `"check"` | `"staff"` | `"customer"` | `null`.
- **Work order per label slot:** size → bleed → colour; `file` has no wait. Approval waits for all four.
- **Off switch:** a type absent from `CONFIG.workflow.tickets` is off. Artwork types apply only to the `parts` they list.
- **Stages stay manual.** A ticket decision doesn't rename the job folder: names renew only on merge and "use".
- **Tests and commits:** run `node --test tests/` and `uv run --project plant python -m unittest discover plant` before every commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Escaping:** the plant page files aren't in `build/build.js`. Every value in plant HTML goes through `escapeHtml`.

## Review Focus

1. **A hand-edited `plant.tickets` with junk:** a string, an array, or an unknown key must not crash. `prepareProject` normalises it, and unknown ids are ignored. Covered in Task 2 (`prepareProject` test) and Task 3 (orphan test).
2. **A file overwritten by hand under the same name after approval:** a new sha256 makes the approval stale, so the ticket is open again. Covered in Task 3.
3. **A job opened before its artwork check finished:** facts are `null`, so the tickets render as "checking", and nothing is written. Covered in Task 5 (`renderTickets(null)`) and Task 7 (`seen` is written only after the artwork facts arrive).
4. **Two people deciding at once:** the second save gets a 409 and reloads. Covered in Task 4.
5. **Whitelabel side or unprinted part:** no artwork tickets for it. Covered in Task 3.

---

### Task 1: Config `workflow` and its validation

**Files:**
- Modify: `src/config.js` (top-level `workflow`)
- Modify: `src/lib/config-validation.js`
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces: `CONFIG.workflow = {columns: string[], tickets: {[type]: {stage, column, title, assignee, priority, notify?, parts?}}}`.

- [ ] **Step 1: Write the failing test** (append)

```js
test("validates the workflow tickets", () => {
  const column = copy();
  column.workflow.tickets["artwork.size"].column = "nowhere";
  assert.throws(() => validateConfig(column), /CONFIG\.workflow\.tickets\.artwork\.size\.column must be one of the workflow columns/);

  const who = copy();
  who.workflow.tickets["approve.artwork"].assignee = "boss";
  assert.throws(() => validateConfig(who), /assignee must be staff or customer/);

  const prio = copy();
  prio.workflow.tickets["artwork.colour"].priority = 4;
  assert.throws(() => validateConfig(prio), /priority must be 1, 2 or 3/);

  const part = copy();
  part.workflow.tickets["artwork.bleed"].parts = ["sticker"];
  assert.throws(() => validateConfig(part), /parts\[0\] must be a printable part/);

  assert.deepEqual(CONFIG.workflow.columns, ["order", "label print"]);
});
```

- [ ] **Step 2: Run it and check it fails**

Run: `node --test tests/config-validation.test.js`
Expected: FAIL, a TypeError on `workflow`.

- [ ] **Step 3: Implement.** In `src/config.js`, after the `printProfiles: {…},` block:

```js
  // Plant tickets (src/lib/tickets.js): which kinds of work each order
  // gets, on which stage and board column, for whom, how urgent. A
  // ticket type left out is off; artwork types apply to the listed parts.
  workflow: {
    columns: ["order", "label print"],
    tickets: {
      "order.complete":  { stage: "00_INBOX", column: "order", title: "Order complete", assignee: "staff", priority: 1 },
      "artwork.check":   { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Check artwork", assignee: "staff", priority: 1, parts: ["labels"] },
      "artwork.size":    { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix size", assignee: "staff", priority: 1, parts: ["labels"] },
      "artwork.bleed":   { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix bleed", assignee: "staff", priority: 1, parts: ["labels"] },
      "artwork.colour":  { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix colours", assignee: "staff", priority: 2, parts: ["labels"] },
      "artwork.file":    { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Fix file", assignee: "staff", priority: 2, parts: ["labels"] },
      "approve.artwork": { stage: "10_ORDERS/10_PREPRESS", column: "label print", title: "Approve artwork", assignee: "customer", priority: 1, notify: true, parts: ["labels"] }
    }
  },
```

In `src/lib/config-validation.js`, add:

```js
const PRINTABLE_PARTS = ["labels", "innerSleeve", "outerCover", "inlay"];

function validateWorkflow(value){
  const workflow = object(value, "CONFIG.workflow");
  const columns = array(workflow.columns, "CONFIG.workflow.columns");
  columns.forEach((c, i) => string(c, `CONFIG.workflow.columns[${i}]`));
  for(const [type, t] of Object.entries(object(workflow.tickets, "CONFIG.workflow.tickets"))){
    const path = `CONFIG.workflow.tickets.${type}`;
    object(t, path);
    string(t.stage, `${path}.stage`);
    string(t.title, `${path}.title`);
    if(!columns.includes(t.column)) fail(`${path}.column`, "must be one of the workflow columns");
    if(t.assignee !== "staff" && t.assignee !== "customer") fail(`${path}.assignee`, "must be staff or customer");
    if(![1, 2, 3].includes(t.priority)) fail(`${path}.priority`, "must be 1, 2 or 3");
    if(t.notify !== undefined && typeof t.notify !== "boolean") fail(`${path}.notify`, "must be a boolean");
    if(t.parts !== undefined) array(t.parts, `${path}.parts`).forEach((p, i) => {
      if(!PRINTABLE_PARTS.includes(p)) fail(`${path}.parts[${i}]`, "must be a printable part");
    });
  }
}
```

Call `validateWorkflow(config.workflow);` after `validatePrintProfiles(config.printProfiles);`. If `PRINTABLE_PARTS` collides with a name in another built file (`grep -rn "PRINTABLE_PARTS" src`), name it `WORKFLOW_PARTS`.

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/config-validation.test.js
git commit -m "config: workflow — ticket types per stage, column, assignee, priority, parts"
```

---

### Task 2: Artwork slot subjects and `plant.tickets` in `prepareProject`

**Files:**
- Modify: `src/lib/artwork-checks.js` (`artworkSlots` adds `subject`)
- Modify: `src/lib/project.js` (`plant.tickets` normalised)
- Test: `tests/artwork-checks.test.js`, `tests/project.test.js`

**Interfaces:**
- Produces:
  - `artworkSlots()` entries gain `subject`: `"labels.A"`, `"labels.B"`, `"innerSleeve"`, `"cover"`, `"inlay.front"`, `"inlay.back"`.
  - A prepared project always has `plant.tickets`: an object whose values are objects; other values are dropped.

- [ ] **Step 1: Write the failing tests**

`tests/artwork-checks.test.js`, append:

```js
test("artworkSlots: a stable subject per slot", () => {
  const slots = artworkSlots(project({
    labels:{sides:{A:{fileName:"L_A.pdf"}, B:{fileName:"L_B.pdf"}}},
    coverSleeve:{cover:{productId: printed.id, fileName:"C.pdf"}}
  }), CONFIG);
  assert.deepEqual(slots.map(s => s.subject), ["labels.A", "labels.B", "cover"]);
});
```

`tests/project.test.js`, append:

```js
test("prepareProject: plant.tickets kept as an object of objects, junk dropped", () => {
  const ok = prepareProject({projectVersion:1, format:"12", plant:{tickets:{"artwork.size:labels.A":{done:{by:"staff"}}, bad:"x"}}}, config);
  assert.deepEqual(ok.plant.tickets, {"artwork.size:labels.A":{done:{by:"staff"}}});
  assert.deepEqual(prepareProject({projectVersion:1, format:"12", plant:{tickets:[1]}}, config).plant.tickets, {});
  assert.deepEqual(prepareProject({projectVersion:1, format:"12"}, config).plant.tickets, {});
});
```

- [ ] **Step 2: Run them and check they fail.** `node --test tests/`: two FAILs.

- [ ] **Step 3: Implement.**

In `artworkSlots` (`src/lib/artwork-checks.js`), give `add` a `subject` argument:
- `const add = (title, subject, slot, part, sizes) => { … slots.push({title, subject, name: slot.fileName, params: {…}}); };`
- Labels: `add(\`Label ${side}\`, \`labels.${side}\`, slot, "labels", …)`.
- Sleeve loop entries: `["Inner sleeve", "innerSleeve", sleeve.innerSleeve, "innerSleeve", …]`, `["Cover", "cover", …]`, `["Inlay front", "inlay.front", …]`, `["Inlay back", "inlay.back", …]`. Destructure the subject as the second element and pass it through.

In `src/lib/project.js`, change the plant line to:

```js
  const plant = objectOrEmpty(project.plant, "project.plant");
  const tickets = plant.tickets && typeof plant.tickets === "object" && !Array.isArray(plant.tickets) ? plant.tickets : {};
  project.plant = {...plant, stage: text(plant.stage, "project.plant.stage"),
    tickets: Object.fromEntries(Object.entries(tickets).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v)))};
```

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass. Check that the existing `artworkSlots` test still compares params only.

- [ ] **Step 5: Commit**

```bash
git add src/lib/artwork-checks.js src/lib/project.js tests/artwork-checks.test.js tests/project.test.js
git commit -m "artwork slots carry a stable subject; prepareProject keeps plant.tickets as decisions"
```

---

### Task 3: `src/lib/tickets.js` — derivation

**Files:**
- Create: `src/lib/tickets.js`
- Test: `tests/tickets.test.js`

**Interfaces:**
- Consumes: `artworkSlots`, `artworkRows` (`src/lib/artwork-checks.js`); `projectGaps` (`src/lib/completeness.js`); `getFormat` (`src/lib/format-catalogue.js`).
- Produces:
  - `deriveTickets(project, config, files, artworkFacts) -> Ticket[]`. `artworkFacts` is `{[fileName]: facts & {sha256}}`, or `null` while checking: then only `order.complete` is derived.
  - `stageDone(tickets, stage) -> boolean`: some tickets on that stage, and all done.
  - `newlySeen(tickets) -> string[]`: ids of open work tickets without a stored `seen`.
  - Ticket: `{id, type, subject, stage, column, title, why, kind, state, doneBy, waitsFor, assignee, priority, notify, told, decision}`.

- [ ] **Step 1: Write the failing tests** (`tests/tickets.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { deriveTickets, stageDone, newlySeen } from "../src/lib/tickets.js";

const address = {recipientName: "A", addressLine1: "B 1", city: "C", postalCode: "1", countryCode: "DE", email: "a@b.de"};
function job(over = {}, tickets = {}){
  return prepareProject({projectVersion: 1, format: "7", catalogue: "KMPN012",
    sides: {A: {rpm: "45", tracks: [{title: "T", length: "3:00", fileName: "a.wav"}]}, B: {blank: true}},
    labels: {sides: {A: {fileName: "KMPN012_labels_A_v1.pdf"}, B: {fileName: "KMPN012_labels_B_v1.pdf", page: 2}}},
    coverSleeve: {innerSleeve: {productId: "sleeve-white-cutout"}},
    vinylColor: [{color: "black", qty: "300"}],
    shippingBilling: {billing: {...address}, shipping: [{...address, qtyByColor: {black: "300"}}]},
    plant: {tickets}, ...over}, CONFIG);
}
const files = ["a.wav", "KMPN012_labels_A_v1.pdf", "KMPN012_labels_B_v1.pdf"].map(name => ({name, size: 1}));
// KMPN012 as checked: 96 mm instead of 98, no bleed, 316 % ink, rich black.
function facts(over = {}){
  return {kind: "pdf", sha256: "aaa", parsed: {pageSizeMm: {w: 96, h: 96}, imagePx: null, declaredDpi: null, colorMode: "CMYK",
    spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4",
    pageCount: 2, effectiveDpi: null}, pageMm: {w: 96, h: 96}, trimRectMm: {x: 2, y: 2, w: 92, h: 92},
    ink: {maxPct: 316, overPct: 5}, black: {richPct: 3.6}, bleed: {outerInkPct: null, innerInkPct: 100}, ...over};
}
const bad = () => ({"KMPN012_labels_A_v1.pdf": facts(), "KMPN012_labels_B_v1.pdf": facts({sha256: "bbb"})});
const byId = tickets => Object.fromEntries(tickets.map(t => [t.id, t]));

test("KMPN012: per label size open, bleed and colour waiting, approval waiting; order complete done by check", () => {
  const t = byId(deriveTickets(job(), CONFIG, files, bad()));
  assert.equal(t["artwork.size:labels.A"].state, "open");
  assert.equal(t["artwork.size:labels.A"].why, "96.0×96.0mm, expected 98×98mm");
  assert.equal(t["artwork.size:labels.A"].title, "Label A: Fix size");
  assert.equal(t["artwork.bleed:labels.A"].state, "waiting");
  assert.equal(t["artwork.colour:labels.B"].state, "waiting");
  assert.equal(t["approve.artwork:labels.B"].state, "waiting");
  assert.equal(t["approve.artwork:labels.B"].assignee, "customer");
  assert.equal(t["order.complete:order"], undefined, "no gaps, never seen: not listed");
});

test("done by a person, then the next waits no more; done by check once seen and fixed", () => {
  const decided = job({}, {"artwork.size:labels.A": {seen: {at: "t"}, done: {by: "staff", at: "t", note: "rescaled"}}});
  const t = byId(deriveTickets(decided, CONFIG, files, bad()));
  assert.deepEqual([t["artwork.size:labels.A"].state, t["artwork.size:labels.A"].doneBy], ["done", "staff"]);
  assert.equal(t["artwork.bleed:labels.A"].state, "open");
  const fixed = {...bad(), "KMPN012_labels_A_v1.pdf": facts({pageMm: {w: 98, h: 98}, parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}})};
  const seen = job({}, {"artwork.size:labels.A": {seen: {at: "t"}}});
  assert.deepEqual([byId(deriveTickets(seen, CONFIG, files, fixed))["artwork.size:labels.A"].state,
    byId(deriveTickets(seen, CONFIG, files, fixed))["artwork.size:labels.A"].doneBy], ["done", "check"]);
  assert.equal(byId(deriveTickets(job(), CONFIG, files, fixed))["artwork.size:labels.A"], undefined, "fixed, never seen: not listed");
});

test("approval: open once the work is done, done when approved for this file, stale when the file changed", () => {
  const work = ["size", "bleed", "colour"].map(k => [`artwork.${k}:labels.A`, {seen: {at: "t"}, done: {by: "staff", at: "t"}}]);
  const ready = job({}, Object.fromEntries(work));
  assert.equal(byId(deriveTickets(ready, CONFIG, files, bad()))["approve.artwork:labels.A"].state, "open");
  const approved = job({}, {...Object.fromEntries(work), "approve.artwork:labels.A": {approved: {by: "staff", at: "t", sha256: "aaa"}}});
  const t = byId(deriveTickets(approved, CONFIG, files, bad()))["approve.artwork:labels.A"];
  assert.deepEqual([t.state, t.doneBy, t.told], ["done", "staff", false]);
  const changed = {...bad(), "KMPN012_labels_A_v1.pdf": facts({sha256: "ccc"})};
  assert.equal(byId(deriveTickets(approved, CONFIG, files, changed))["approve.artwork:labels.A"].state, "open");
  const told = job({}, {...Object.fromEntries(work), "approve.artwork:labels.A": {approved: {by: "customer", at: "t", sha256: "aaa"}, notified: {at: "t"}}});
  assert.equal(byId(deriveTickets(told, CONFIG, files, bad()))["approve.artwork:labels.A"].told, true);
});

test("orphan and junk decisions are ignored; assignee and priority overrides apply", () => {
  const t = byId(deriveTickets(job({}, {"nope:x": {done: {}}, "artwork.size:labels.A": {assignee: "customer", priority: 3}}), CONFIG, files, bad()));
  assert.equal(t["nope:x"], undefined);
  assert.deepEqual([t["artwork.size:labels.A"].assignee, t["artwork.size:labels.A"].priority], ["customer", 3]);
});

test("no facts yet: only order tickets; a slot without facts: artwork.check only; whitelabel: nothing", () => {
  assert.ok(deriveTickets(job(), CONFIG, files, null).every(t => t.subject === "order"));
  const t = byId(deriveTickets(job(), CONFIG, files, {"KMPN012_labels_A_v1.pdf": facts()}));
  assert.equal(t["artwork.check:labels.B"].state, "open");
  assert.equal(t["artwork.size:labels.B"], undefined);
  const white = job({labels: {sides: {A: {fileName: "KMPN012_labels_A_v1.pdf"}, B: {whitelabel: true}}}});
  assert.ok(deriveTickets(white, CONFIG, files, bad()).every(t => !t.subject.endsWith("labels.B")));
});

test("order.complete opens with gaps; stageDone and newlySeen", () => {
  const gaps = byId(deriveTickets(job({catalogue: ""}), CONFIG, files, bad()));
  assert.equal(gaps["order.complete:order"].state, "open");
  assert.match(gaps["order.complete:order"].why, /no catalogue number/);
  const tickets = deriveTickets(job(), CONFIG, files, bad());
  assert.equal(stageDone(tickets, "10_ORDERS/10_PREPRESS"), false);
  assert.equal(stageDone(tickets, "20_DONE"), false, "no tickets on a stage: nothing to suggest");
  // Waiting work tickets count too: their cause exists, so a later fix must stay visible.
  assert.deepEqual(newlySeen(tickets).sort(), ["artwork.bleed:labels.A", "artwork.bleed:labels.B",
    "artwork.colour:labels.A", "artwork.colour:labels.B", "artwork.size:labels.A", "artwork.size:labels.B"]);
});
```

- [ ] **Step 2: Run them and check they fail.** `node --test tests/tickets.test.js`: module not found.

- [ ] **Step 3: Implement `src/lib/tickets.js`**

```js
// Plant tickets: the work an order needs, derived on every scan from
// CONFIG.workflow, project.json, its files and the cached check facts —
// never stored. project.plant.tickets[id] keeps only what people decided
// (seen, done, approved, notified, assignee, priority), so rebuilding is
// always safe. Spec: docs/superpowers/specs/2026-10-02-tickets-design.md.

import { getFormat } from "./format-catalogue.js";
import { artworkSlots, artworkRows } from "./artwork-checks.js";
import { projectGaps } from "./completeness.js";

const WARN = new Set(["warn", "error"]);
const ARTWORK_WORK = ["size", "bleed", "colour", "file"];
// Which checklist rows open which artwork ticket; "file" takes the rest.
const ROWS = {size: ["Size"], bleed: ["Bleed"], colour: ["Ink", "Black"]};
const WAITS = {size: [], bleed: ["size"], colour: ["bleed"], file: []};

function causeOf(kind, rows){
  const own = kind === "file" ? rows.filter(r => !Object.values(ROWS).flat().includes(r.feature)) : rows.filter(r => ROWS[kind].includes(r.feature));
  const hit = own.find(r => WARN.has(r.severity));
  return hit ? `${hit.detected}${hit.expected ? `, expected ${hit.expected}` : ""}` : null;
}

export function deriveTickets(project, config, files, artworkFacts){
  const types = config.workflow.tickets;
  const decisions = project.plant.tickets;
  const raw = [];
  const add = (type, subject, title, kind, cause, extra = {}) => {
    const t = types[type];
    if(!t) return;
    raw.push({id: `${type}:${subject}`, type, subject, title: title ? `${title}: ${t.title}` : t.title, kind, cause, ...extra});
  };

  const gaps = projectGaps(project, config, files);
  add("order.complete", "order", null, "work", gaps.length ? `${gaps[0].group}: ${gaps[0].text}${gaps.length > 1 ? ` (+${gaps.length - 1})` : ""}` : null);

  if(artworkFacts){
    const printCheck = getFormat(config, project.format).printCheck;
    for(const slot of artworkSlots(project, config)){
      const forPart = type => (types[type] && (types[type].parts || []).includes(slot.params.part));
      const facts = artworkFacts[slot.name];
      if(!facts){
        if(forPart("artwork.check")) add("artwork.check", slot.subject, slot.title, "work", "not checked yet");
        continue;
      }
      const rows = artworkRows(facts, slot.params, printCheck);
      for(const kind of ARTWORK_WORK){
        if(forPart(`artwork.${kind}`)) add(`artwork.${kind}`, slot.subject, slot.title, "work", causeOf(kind, rows),
          {waitsFor: WAITS[kind].map(k => `artwork.${k}:${slot.subject}`)});
      }
      if(forPart("approve.artwork")) add("approve.artwork", slot.subject, slot.title, "approval", null,
        {waitsFor: ARTWORK_WORK.map(k => `artwork.${k}:${slot.subject}`), sha256: facts.sha256 || null});
    }
  }

  // Work tickets: listed while their cause exists, or once seen.
  const listed = raw.filter(r => r.kind === "approval" || r.cause || (decisions[r.id] || {}).seen);
  const byId = new Map(listed.map(r => [r.id, r]));
  const state = new Map();
  const resolve = r => {
    if(state.has(r.id)) return state.get(r.id);
    const d = decisions[r.id] || {};
    const waiting = (r.waitsFor || []).some(id => byId.has(id) && resolve(byId.get(id)).state !== "done");
    let s;
    if(r.kind === "approval"){
      const ok = d.approved && d.approved.sha256 && d.approved.sha256 === r.sha256;
      s = ok ? {state: "done", doneBy: d.approved.by || "staff"} : {state: waiting ? "waiting" : "open", doneBy: null};
    } else if(d.done){
      s = {state: "done", doneBy: d.done.by || "staff"};
    } else if(!r.cause){
      s = {state: "done", doneBy: "check"};
    } else {
      s = {state: waiting ? "waiting" : "open", doneBy: null};
    }
    state.set(r.id, s);
    return s;
  };
  return listed.map(r => {
    const t = types[r.type], d = decisions[r.id] || {};
    const s = resolve(r);
    return {id: r.id, type: r.type, subject: r.subject, stage: t.stage, column: t.column, title: r.title,
      why: r.cause || "", kind: r.kind, state: s.state, doneBy: s.doneBy, waitsFor: (r.waitsFor || []).filter(id => byId.has(id)),
      assignee: d.assignee || t.assignee, priority: d.priority || t.priority, notify: !!t.notify,
      told: !!d.notified, sha256: r.sha256 || null, decision: d};
  });
}

// All of a stage's tickets done (and there are some): time to move on.
export function stageDone(tickets, stage){
  const own = tickets.filter(t => t.stage === stage);
  return own.length > 0 && own.every(t => t.state === "done");
}

// Open work tickets the plant view hasn't recorded as seen yet.
export function newlySeen(tickets){
  return tickets.filter(t => t.kind === "work" && t.state !== "done" && !t.decision.seen).map(t => t.id);
}
```

Notes for the implementer:
- `projectGaps(project, config, files)` takes the file list (`{name}` objects). Check its signature in `src/lib/completeness.js`.
- `newlySeen` counts `waiting` work tickets as well as `open` ones: a waiting ticket's cause exists too, so it must stay listed once fixed.
- The KMPN012 test asserts `order.complete:order` is absent. If `projectGaps` finds a gap in that fixture (e.g. something the fixture lacks), complete the fixture rather than loosening the assertion.

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tickets.js tests/tickets.test.js
git commit -m "tickets: derived from config, files and check facts; decisions merged; approvals tied to the file's sha256"
```

---

### Task 4: Server — sha256 in check results, board data, `POST /api/project`

**Files:**
- Modify: `plant/checks.py` (`check_artwork` result gets `sha256`)
- Modify: `plant/jobs.py` (`board` cards get `project`, `files`, `artwork`)
- Modify: `plant/server.py` (`POST /api/project`)
- Test: `plant/test_checks.py`, `plant/test_jobs.py`, `plant/test_server.py`

**Interfaces:**
- Produces:
  - Artwork check results `{name: {...facts, "sha256"}}`.
  - Board cards `{job, catalogue, title, artist, project, files, artwork}`, where `artwork` is `{name: {...facts, sha256}}` from `.checks/artwork.json`, or `{}`.
  - `POST /api/project {job, project, basedOn}` → `{projectHash}`; 409 when `project.json` changed.

- [ ] **Step 1: Write the failing tests**
  - `plant/test_server.py`, inside `HttpTest`:

    ```python
        def test_project_save_is_safe(self):
            folder = self.root / "20_DONE" / "X_a_261001-1432"
            folder.mkdir()
            (folder / "project.json").write_text('{"catalogue": "X"}')
            digest = self.get("/api/job?job=X_a_261001-1432")[1]["projectHash"]
            body = {"job": "X_a_261001-1432", "project": {"catalogue": "X", "plant": {"tickets": {"a:b": {"seen": {"at": "t"}}}}}, "basedOn": digest}
            status, reply = self.post("/api/project", body)
            self.assertEqual(status, 200)
            self.assertIn("projectHash", reply)
            self.assertEqual(self.post("/api/project", body)[0], 409)
            self.assertEqual(json.loads((folder / "project.json").read_text())["plant"]["tickets"], {"a:b": {"seen": {"at": "t"}}})
    ```

    Check that `json` is imported in `test_server.py`.
  - `plant/test_jobs.py`, in `JobsTest`:

    ```python
        def test_board_cards_carry_project_files_and_cached_artwork(self):
            folder = self.job("20_DONE", "X_a_261001-1432", {"catalogue": "X"})
            (folder / "L.pdf").write_bytes(b"%PDF")
            (folder / ".checks").mkdir()
            (folder / ".checks" / "artwork.json").write_text(json.dumps({"L.pdf": {"sha256": "abc", "facts": {"kind": "pdf"}}}))
            card = next(c for s in jobs.board(self.root)["stages"] for c in s["jobs"] if c["job"] == "X_a_261001-1432")
            self.assertEqual(card["project"]["catalogue"], "X")
            self.assertEqual([f["name"] for f in card["files"]], ["L.pdf"])
            self.assertEqual(card["artwork"], {"L.pdf": {"kind": "pdf", "sha256": "abc"}})
    ```
  - `plant/test_checks.py`: find the existing artwork check test (`grep -n "check_artwork" plant/test_checks.py`), and add `self.assertEqual(len(result[name]["sha256"]), 64)` for a checked file. If there's no such test, add one: a one-page PDF in a temp job, `checks.check_artwork(dir, dir / ".checks", {"a.pdf": LABEL_PARAMS})`, and assert the result's `sha256` length is 64. Reuse the params dict style of `plant/test_artwork.py`'s `LABEL`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement**
  - `plant/checks.py` `check_artwork`: before `result[name] = facts`, add the hash:

    ```python
            result[name] = {**facts, "sha256": cache.used[name]["sha256"]}
    ```

    `cache.get` and `cache.put` both fill `cache.used[name]`.
  - `plant/jobs.py` `board`: in the `try`, extend the card:

    ```python
                    project, _ = read_project(folder)
                    try:
                        cached = json.loads((folder / ".checks" / "artwork.json").read_text())
                    except (OSError, ValueError):
                        cached = {}
                    artwork = {name: {**entry.get("facts", {}), "sha256": entry.get("sha256")}
                               for name, entry in cached.items() if isinstance(entry, dict)}
                    cards.append({"job": job, "catalogue": project.get("catalogue", ""),
                                  "title": project.get("albumTitle", ""), "artist": project.get("albumArtist", ""),
                                  "project": project, "files": files(folder), "artwork": artwork})
    ```

    This replaces the existing `project = read_project(folder)[0]` and `cards.append(...)` lines.
  - `plant/server.py`: add `"/api/project": self.save_project,` to the `do_POST` dict, and:

    ```python
        def save_project(self):
            """project.json as the page decided it (ticket decisions); refused
            with 409 when it changed since the page read it."""
            r = self.body()
            folder = jobs.find(JOBS, r["job"])[1]
            if not isinstance(r.get("project"), dict):
                raise JobError("project must be an object")
            self.json({"projectHash": jobs.write_project(folder, r["project"], r["basedOn"])})
    ```

- [ ] **Step 4: Run both suites.** Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add plant/checks.py plant/jobs.py plant/server.py plant/test_checks.py plant/test_jobs.py plant/test_server.py
git commit -m "plant server: sha256 in artwork results, board cards with project, files and cached facts, /api/project"
```

---

### Task 5: Rendering — the Tickets section, move suggestion, board grid

**Files:**
- Modify: `src/lib/plant-overview.js` (`SECTIONS`, `renderTickets`, `renderBasic` move hint)
- Modify: `src/lib/plant-board.js` (`renderBoard`, nav link)
- Test: `tests/plant-overview.test.js`, `tests/plant-board.test.js`

**Interfaces:**
- Consumes: Ticket objects (Task 3), `stageDone` (Task 3).
- Produces:
  - `renderTickets(tickets | null) -> html`: `<section id="tickets">`. `null` reads "checking…".
  - `renderBasic(project, config, place, gaps, tickets = null)`: when `tickets && stageDone(tickets, place.stage)`, the Stage cell gets ` — all tickets done, move on?`.
  - `renderBoard(rows, columns) -> html`: `rows = [{job, catalogue, title, stage, tickets}]`.
  - `renderNav` gains a `<a href="#/board">Board</a>` link above "Jobs".

- [ ] **Step 1: Write the failing tests**

`tests/plant-overview.test.js`, append (import `renderTickets` too):

```js
test("tickets: a table with state, why, assignee and the buttons that apply", () => {
  const tk = (over) => ({id: "artwork.size:labels.A", type: "artwork.size", subject: "labels.A", stage: "10_ORDERS/10_PREPRESS",
    column: "label print", title: "Label A: Fix size", why: "96 mm <b>", kind: "work", state: "open", doneBy: null, waitsFor: [],
    assignee: "staff", priority: 1, notify: false, told: false, sha256: null, decision: {}, ...over});
  const html = renderTickets([tk(), tk({id: "approve.artwork:labels.A", kind: "approval", title: "Label A: Approve artwork",
    assignee: "customer", sha256: "aaa"}), tk({id: "artwork.bleed:labels.A", state: "waiting", title: "Label A: Fix bleed"}),
    tk({id: "x:y", kind: "approval", state: "done", doneBy: "customer", notify: true, told: false, title: "Done one"})]);
  assert.ok(html.startsWith('<section id="tickets">'));
  assert.ok(html.includes("96 mm &lt;b&gt;"));
  assert.ok(html.includes('<button type="button" class="ticket" data-id="artwork.size:labels.A" data-do="done">done</button>'));
  assert.ok(html.includes('<button type="button" class="ticket" data-id="approve.artwork:labels.A" data-do="approved">approve</button>'));
  assert.ok(!html.includes('data-id="artwork.bleed:labels.A" data-do'));
  assert.ok(html.includes('<button type="button" class="ticket" data-id="x:y" data-do="notified">told</button>'));
  assert.ok(renderTickets(null).includes("checking"));
});

test("basic: suggests moving on when the stage's tickets are all done", () => {
  const done = [{stage: place.stage, state: "done"}];
  assert.ok(renderBasic(project, CONFIG, place, [], done).includes("all tickets done — move on?"));
  assert.ok(!renderBasic(project, CONFIG, place, [], []).includes("move on?"));
});
```

`tests/plant-board.test.js`, append (import `renderBoard` as well):

```js
test("board grid: a row per job, Inbox | columns | Done, marks per ticket state", () => {
  const rows = [{job: "KMPN012_x_261001-2006", catalogue: "KMPN012", title: "High <Riding>", stage: "00_INBOX", tickets: [
    {column: "label print", state: "open", title: "Label A: Fix size"},
    {column: "label print", state: "waiting", title: "Label A: Fix bleed"},
    {column: "order", state: "done", title: "Order complete"}]}];
  const html = renderBoard(rows, ["order", "label print"]);
  assert.ok(html.includes('<th scope="col">Inbox</th><th scope="col">order</th><th scope="col">label print</th><th scope="col">Done</th>'));
  assert.ok(html.includes('<a href="#/job/KMPN012_x_261001-2006">KMPN012 — High &lt;Riding&gt;</a>'));
  assert.ok(html.includes('<span title="Label A: Fix size">●</span><span title="Label A: Fix bleed">○</span>'));
  assert.ok(html.includes('<span title="Order complete">✓</span>'));
  assert.ok(html.includes("<td>●</td><td>"), "Inbox marked for an inbox job");
});
```

(Read `listTable` in `plant-overview.js` first. If it renders the header differently from `<th scope="col">`, align the assertions with it; the tests elsewhere in this file show its exact output.)

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement**

In `src/lib/plant-overview.js`:
- `SECTIONS` gets `["tickets", "Tickets"]` after `["basic", "Basic"]`.
- Import `stageDone` from `./tickets.js`.
- `renderBasic(project, config, place, gaps, tickets = null)`: after the stage `<select>`/buttons, before the zip link, insert
  ```js
  (tickets && stageDone(tickets, place.stage) ? " — all tickets done, move on?" : "")
  ```
  Keep the existing cell otherwise.
- Add:

```js
// --- Tickets ---------------------------------------------------------

const TICKET_ACTION = t =>
  t.state === "open" && t.kind === "work" ? ["done", "done"]
  : t.state === "open" && t.kind === "approval" ? ["approved", "approve"]
  : t.state === "done" && t.notify && !t.told ? ["notified", "told"] : null;

// tickets: deriveTickets(), or null while the checks run.
export function renderTickets(tickets){
  if(!tickets) return section("tickets", "<p>checking…</p>");
  if(!tickets.length) return section("tickets", "<p>No tickets.</p>");
  return section("tickets", listTable(["Ticket", "State", "Why", "For", "Prio", ""], tickets.map(t => {
    const action = TICKET_ACTION(t);
    const state = t.state === "done" ? `done (${t.doneBy})` : t.state;
    return [escapeHtml(t.title), escapeHtml(state), escapeHtml(t.why), escapeHtml(t.assignee), String(t.priority),
      action ? `<button type="button" class="ticket" data-id="${escapeHtml(t.id)}" data-do="${action[0]}">${action[1]}</button>` : ""];
  })));
}
```

(`section(id, body)` already exists in this file and writes the `<section id>` with its heading from `SECTIONS`. If its output starts with something other than `<section id="tickets">`, adjust the test's `startsWith` to it.)

In `src/lib/plant-board.js`:
- `renderNav`: prefix the html with `<p><a href="#/board">Board</a></p>`.
- Add:

```js
const MARK = {open: "●", waiting: "○", done: "✓"};

// The board grid: a row per job, Inbox | the workflow columns | Done.
// rows: [{job, catalogue, title, stage, tickets}].
export function renderBoard(rows, columns){
  const cell = (tickets, column) => tickets.filter(t => t.column === column)
    .map(t => `<span title="${escapeHtml(t.title)}">${MARK[t.state]}</span>`).join("");
  return `<h2>Board</h2>` + listTable(["Job", "Inbox", ...columns, "Done"], rows.map(r => [
    `<a href="${jobLink(r.job)}">${escapeHtml([r.catalogue || r.job, r.title].filter(Boolean).join(" — "))}</a>`,
    r.stage === "00_INBOX" ? "●" : "",
    ...columns.map(c => cell(r.tickets, c)),
    /^20_DONE|^99_ARCHIVE/.test(r.stage) ? "✓" : ""]));
}
```

(The test header lists `Inbox` first. Make it match whatever `listTable` emits for this column list, including the `Job` column.)

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js src/lib/plant-board.js tests/plant-overview.test.js tests/plant-board.test.js
git commit -m "plant view: Tickets section with done/approve/told, move suggestion, board grid"
```

---

### Task 6: Spec note

**Files:**
- Modify: `docs/superpowers/specs/2026-10-02-tickets-design.md`

- [ ] **Step 1:** Replace the "Server" section's `POST /api/ticket …` bullet with:

```
- `POST /api/project` `{job, project, basedOn}`: the page applies the decision to
  `project.plant.tickets` (with `by: "staff"`, `at`, and for an approval the file's
  sha256 from the check results) and saves the whole `project.json` through
  `write_project` (409 when it changed). One generic save, like "use" relies on.
- Artwork check results carry each file's `sha256` (from the checks cache).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-02-tickets-design.md
git commit -m "spec: tickets saved through one generic /api/project; check results carry sha256"
```

---

### Task 7: Plant page wiring

**Files:**
- Modify: `src/plant/app.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `deriveTickets`, `newlySeen` (Task 3); `renderTickets`, `renderBasic(…, tickets)`, `renderBoard` (Task 5); `/api/project`, board cards (Task 4).

- [ ] **Step 1: The job page.** In `showJob`:
  - Import `deriveTickets` and `newlySeen` from `../lib/tickets.js`; `renderTickets` from `../lib/plant-overview.js`; `historyEntry` is already imported.
  - Initial render: `renderBasic(…, gaps, null)` + `renderTickets(null)` right after Basic.
  - After `artworkFacts` arrive:
    ```js
    const tickets = deriveTickets(project, CONFIG, data.files, artworkFacts);
    view.tickets = tickets;
    replace("tickets", renderTickets(tickets));
    replace("basic", renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps, tickets));
    ```
  - Then record new ones as seen, once:
    ```js
    const fresh = newlySeen(tickets);
    if(fresh.length){
      const raw = structuredClone(view.raw);
      raw.plant = raw.plant || {};
      raw.plant.tickets = raw.plant.tickets || {};
      const at = new Date().toISOString();
      for(const id of fresh) raw.plant.tickets[id] = {...(raw.plant.tickets[id] || {}), seen: {at}};
      raw.history = [...(raw.history || []), historyEntry(`tickets: ${fresh.length} opened`, new Date())];
      await postJson("/api/project", {job, project: raw, basedOn: view.hash});
    }
    ```

    The stamp poll reloads the page after this save. On that reload nothing is newly seen, so it doesn't loop.
  - Check that `renderBasic`'s section id is `basic`, so `replace("basic", …)` finds it.

- [ ] **Step 2: The ticket buttons.** Extend the click selector with `.ticket`, and add a branch:

```js
    } else if(button.matches(".ticket")){
      const t = view.tickets.find(x => x.id === button.dataset.id);
      const raw = structuredClone(view.raw);
      raw.plant = raw.plant || {};
      raw.plant.tickets = raw.plant.tickets || {};
      const at = new Date().toISOString();
      const what = button.dataset.do;
      const decision = what === "approved" ? {by: "staff", at, sha256: t.sha256}
        : what === "done" ? {by: "staff", at, note: ""} : {at};
      raw.plant.tickets[t.id] = {...(raw.plant.tickets[t.id] || {}), [what]: decision};
      raw.history = [...(raw.history || []), historyEntry(`${t.title}: ${button.textContent}`, new Date())];
      await postJson("/api/project", {job: view.job, project: raw, basedOn: view.hash});
```

The branch then falls through to the existing `await route();`.

- [ ] **Step 3: The board route.** In `route()`, handle `#/board`:
  - Fetch `/api/board`, the same data the nav already loads.
  - For each card without `error`, in every stage:
    ```js
    tickets = deriveTickets(prepareProject(card.project, CONFIG), CONFIG, card.files, card.artwork)
    ```
    A card whose `project` fails `prepareProject` gets `tickets: []`.
  - Build `rows = [{job, catalogue, title, stage, tickets}]` and render `renderBoard(rows, CONFIG.workflow.columns)` into `out`.
  - Read the existing `route()` hash parsing first (`/^#\/(job|inbox)\/…/`), and add `board` before the overview fallback.

- [ ] **Step 4: Docs.** In `CLAUDE.md`'s Architecture plant bullet, after "shown next to the version in use.", add:

  "Tickets (`src/lib/tickets.js`) are derived from `CONFIG.workflow`, the files and the check facts on every scan; `project.json`'s `plant.tickets` keeps only decisions (seen, done, approved with the file's sha256, notified, assignee, priority), saved through `/api/project`. Spec: `docs/superpowers/specs/2026-10-02-tickets-design.md`."

- [ ] **Step 5: Run everything**

Run: `node --test tests/ && uv run --project plant python -m unittest discover plant && node build/build.js && node --check src/plant/app.js`
Expected: all pass.

- [ ] **Step 6: Manual check** (the user):
1. Open KMPN012. The Tickets section lists size open per label, bleed and colour waiting, and approval waiting.
2. The history shows "tickets: N opened".
3. "done" on size makes bleed open.
4. Once all work is done, approve; replacing the file reopens it.
5. The Board link shows the KMPN012 row.

- [ ] **Step 7: Commit**

```bash
git add src/plant/app.js CLAUDE.md
git commit -m "plant view: tickets on the job page (seen, done, approve, told) and the board grid"
```
