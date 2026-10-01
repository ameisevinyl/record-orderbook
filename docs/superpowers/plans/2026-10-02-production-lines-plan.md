# Production Lines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each job's labels run through a production line: checks (with the colour fixer running by itself), approve, send to a printer, back fine. Where the line stands is derived on every scan. People and fixers append to a log in `project.json`, and each entry is tied to file hashes. Shown on the job page and on a board.

**Architecture:**
- `src/lib/lines.js` (pure) holds the step table and `lineState(...)`.
- The page appends log entries by saving the whole `project.json`: either through the new generic `POST /api/project`, or through the existing `/api/assign` when a fixer's file becomes the slot's file.
- Artwork check results carry each file's sha256.
- `/api/board` carries what the board needs to derive every job's lines.

**Tech Stack:** plain ES modules (`node --test`); Python stdlib server (`unittest`).

**Spec:** `docs/superpowers/specs/2026-10-02-production-lines-design.md`

## Global Constraints

- **Labels steps:** `["size", "resolution", "pdf", "bleed", "colour", "approve", "send:printer", "back:printed"]`, with `parts: ["labels"]`.
- **Step → checklist rows (fixed in code):**
  - `size`: Size
  - `resolution`: Resolution
  - `pdf`: File, Pages, PDF version, Encryption, Fonts, Colour profile, TrimBox
  - `bleed`: Bleed
  - `colour`: Colour mode, Ink, Black

  A check step passes when none of its rows is `warn`/`error`, for every file of the line. Spot colours appear inside the Colour mode row (`print-artwork.js`), so `colour` covers them. "File" and "Pages" belong to `pdf` because an unreadable file has no other home.
- **Log entries:** `{step, by: "staff"|"customer"|"fixer", at, note?, to?, from?, files?}`.
  - An entry counts while every file in its `files` exists in the line with that sha256. An entry without `files` always counts.
  - Done entries:
    - check steps: `accept`, an entry with `step` = the check's name, by staff;
    - `approve`: by staff or customer;
    - `send:*`: needs `to`;
    - `back:*`: confirmed by staff.
  - Fixer entries (`by: "fixer"`) never complete a step.
- **A line's files:** the artwork slots whose `params.part` is in the line's `parts`, never a whitelabel side.
- **Stages stay manual.** Log entries don't rename the job, but a fixer's "use" goes through `/api/assign`, which renews the name as today.
- **Tests and commits:** run `node --test tests/` and `uv run --project plant python -m unittest discover plant` before every commit. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Plant page HTML escapes every value.

## Review Focus

1. **A label file replaced by hand under the same name after "send:printer":** the sha256 changes, so the line rewinds to its first unpassed step. Covered in Task 3 (`rewinds when a file changes`).
2. **The fixer's own output failing colour again:** it must not run again on its output. Covered in Task 3 (`fixerTargets` excludes `to` files and already-tried sources).
3. **Junk in `plant.lines`:** a string, null entries or a missing `step` must not crash. Covered in Task 2 (normalise) and Task 3 (ignored).
4. **A job before its artwork check finished:** the line shows "checking", no fixer runs and nothing is written. Covered in Task 3 (`checkResults` null) and Task 6.
5. **Two staff acting at once:** the second save gets a 409. Covered in Task 4.

---

### Task 1: Config — `lines` and `partners`, validated

**Files:**
- Modify: `src/config.js`
- Modify: `src/lib/config-validation.js`
- Test: `tests/config-validation.test.js`

**Interfaces:**
- Produces:
  - `CONFIG.lines = {labels: {parts: ["labels"], steps: [...]}}`. An optional `after: string[]` names other lines.
  - `CONFIG.partners = {printer: ["in-house", "external"]}`.

- [ ] **Step 1: Write the failing test** (append)

```js
test("validates production lines and partners", () => {
  const kind = copy();
  kind.lines.labels.steps = ["size", "polish"];
  assert.throws(() => validateConfig(kind), /CONFIG\.lines\.labels\.steps\[1\] must be a known step/);

  const partner = copy();
  partner.lines.labels.steps = ["send:courier"];
  assert.throws(() => validateConfig(partner), /send:courier needs CONFIG\.partners\.courier/);

  const after = copy();
  after.lines.labels.after = ["press"];
  assert.throws(() => validateConfig(after), /CONFIG\.lines\.labels\.after\[0\] must name a line/);

  assert.deepEqual(CONFIG.lines.labels.steps.at(-1), "back:printed");
});
```

- [ ] **Step 2: Run it and check it fails.** `node --test tests/config-validation.test.js` fails with a TypeError on `lines`.

- [ ] **Step 3: Implement.** In `src/config.js`, after `printProfiles: {…},`:

```js
  // Production lines (src/lib/lines.js): per product, its steps in order.
  // Check steps (size, resolution, pdf, bleed, colour) pass by the
  // artwork checks; approve, send:<partners list> and back:<what> are
  // confirmed by staff. after: lines that must be through first.
  lines: {
    labels: { parts: ["labels"], steps: ["size", "resolution", "pdf", "bleed", "colour", "approve", "send:printer", "back:printed"] }
  },
  // Who a send step can go to; a plant lists its named suppliers here.
  partners: {
    printer: ["in-house", "external"]
  },
```

In `src/lib/config-validation.js`:

```js
const CHECK_STEPS = ["size", "resolution", "pdf", "bleed", "colour"];

function validateLines(lines, partners){
  object(partners, "CONFIG.partners");
  for(const [list, names] of Object.entries(partners)){
    array(names, `CONFIG.partners.${list}`).forEach((n, i) => string(n, `CONFIG.partners.${list}[${i}]`));
  }
  for(const [name, line] of Object.entries(object(lines, "CONFIG.lines"))){
    const path = `CONFIG.lines.${name}`;
    object(line, path);
    array(line.parts, `${path}.parts`).forEach((p, i) => string(p, `${path}.parts[${i}]`));
    array(line.steps, `${path}.steps`).forEach((step, i) => {
      const [kind, arg] = String(step).split(":");
      if(!(CHECK_STEPS.includes(step) || step === "approve" || (kind === "back" && arg) || (kind === "send" && arg))){
        fail(`${path}.steps[${i}]`, "must be a known step");
      }
      if(kind === "send" && !Array.isArray(partners[arg])) fail(`${path}.steps[${i}]`, `${step} needs CONFIG.partners.${arg}`);
    });
    (line.after || []).forEach((other, i) => { if(!lines[other] || other === name) fail(`${path}.after[${i}]`, "must name a line"); });
  }
}
```

Two fixes to that sketch:
- `fail(path, expected)` builds `${path} ${expected}`, so the "send:courier needs" assertion matches the message body. Adjust the regex if the path prefix gets in the way.
- If `CHECK_STEPS` collides with a name in another built file (`grep -rn "CHECK_STEPS" src`), name it `LINE_CHECK_STEPS`.

Call `validateLines(config.lines, config.partners);` after `validatePrintProfiles(...)`.

- [ ] **Step 4: Run** `node --test tests/`. Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/lib/config-validation.js tests/config-validation.test.js
git commit -m "config: production lines (labels) and partners"
```

---

### Task 2: `plant.lines` in `prepareProject`

**Files:**
- Modify: `src/lib/project.js`
- Test: `tests/project.test.js`

**Interfaces:**
- Produces: a prepared project always has `plant.lines`: `{[line]: entry[]}`, where an entry is an object with a string `step`. Everything else is dropped.

- [ ] **Step 1: Failing test** (append)

```js
test("prepareProject: plant.lines kept as logs of entries, junk dropped", () => {
  const p = prepareProject({projectVersion:1, format:"12", plant:{lines:{labels:[{step:"approve", by:"staff"}, null, "x", {by:"staff"}], bad:"x"}}}, config);
  assert.deepEqual(p.plant.lines, {labels:[{step:"approve", by:"staff"}]});
  assert.deepEqual(prepareProject({projectVersion:1, format:"12"}, config).plant.lines, {});
});
```

- [ ] **Step 2: Run it, check it fails.**

- [ ] **Step 3: Implement** in `src/lib/project.js`, replacing the plant line:

```js
  const plant = objectOrEmpty(project.plant, "project.plant");
  const rawLines = plant.lines && typeof plant.lines === "object" && !Array.isArray(plant.lines) ? plant.lines : {};
  const lines = Object.fromEntries(Object.entries(rawLines).filter(([, log]) => Array.isArray(log))
    .map(([name, log]) => [name, log.filter(e => e && typeof e === "object" && !Array.isArray(e) && typeof e.step === "string")]));
  project.plant = {...plant, stage: text(plant.stage, "project.plant.stage"), lines};
```

- [ ] **Step 4: Run** `node --test tests/`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.js tests/project.test.js
git commit -m "prepareProject keeps plant.lines, the production logs"
```

---

### Task 3: `src/lib/lines.js`

**Files:**
- Create: `src/lib/lines.js`
- Test: `tests/lines.test.js`

**Interfaces:**
- Consumes: `artworkSlots`, `artworkRows` (`src/lib/artwork-checks.js`), `getFormat`.
- Produces:
  - `lineFiles(project, config, lineName) -> [{name, slot}]`: `slot` is the `artworkSlots` entry, plus `path` (`["labels", "sides", "A", "fileName"]` etc.) taken from `fileSlots`.
  - `lineState(project, config, lineName, checkResults) -> {line, steps: [{step, kind, state: "done"|"current"|"ahead"}], step, why, ready, done, waiting, checking}`. `checkResults` is `{[name]: facts & {sha256}}`, or `null` while checking.
  - `logEntry(project, config, lineName, checkResults, fields) -> entry`: `{...fields, at, files: {name: sha256}}` over the line's current files.
  - `fixerTargets(project, config, lineName, checkResults) -> [name]`: files whose `colour` step fails, when the line stands at `colour`, minus files a fixer already tried at this hash or produced.
  - `allThrough(project, config, checkResults, stageLines) -> boolean`: every listed line done (or ready, for lines whose next step is a `send:`).

- [ ] **Step 1: Write the failing tests** (`tests/lines.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { lineState, logEntry, fixerTargets } from "../src/lib/lines.js";

function job(log = [], labels = {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}){
  return prepareProject({projectVersion: 1, format: "7", catalogue: "K", labels: {sides: labels},
    plant: {lines: {labels: log}}}, CONFIG);
}
// KMPN012 as checked: 96 mm, no bleed, 316 % ink, rich black.
function facts(over = {}){
  return {kind: "pdf", sha256: "a1", parsed: {pageSizeMm: {w: 96, h: 96}, imagePx: null, declaredDpi: null, colorMode: "CMYK",
    spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4",
    pageCount: 1, effectiveDpi: null}, pageMm: {w: 96, h: 96}, trimRectMm: {x: 2, y: 2, w: 92, h: 92},
    ink: {maxPct: 316, overPct: 5}, black: {richPct: 3.6}, bleed: {outerInkPct: null, innerInkPct: 100}, ...over};
}
const good = sha => facts({sha256: sha, parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}, pageMm: {w: 98, h: 98},
  trimRectMm: {x: 3, y: 3, w: 92, h: 92}, ink: {maxPct: 200, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}});
const kmpn = () => ({"K_labels_A_v1.pdf": facts(), "K_labels_B_v1.pdf": facts({sha256: "b1"})});
const both = () => ({"K_labels_A_v1.pdf": good("a1"), "K_labels_B_v1.pdf": good("b1")});
const files = {"K_labels_A_v1.pdf": "a1", "K_labels_B_v1.pdf": "b1"};

test("KMPN012: the labels line stands at size, with why", () => {
  const s = lineState(job(), CONFIG, "labels", kmpn());
  assert.equal(s.step, "size");
  assert.match(s.why, /96\.0×96\.0mm, expected 98×98mm/);
  assert.deepEqual(s.steps.slice(0, 2).map(x => x.state), ["current", "ahead"]);
  assert.equal(s.ready, false);
});

test("check steps pass live; then approve, send, back by log; ready before send, done at the end", () => {
  assert.equal(lineState(job(), CONFIG, "labels", both()).step, "approve");
  const log = [{step: "approve", by: "customer", at: "t", files}];
  const s = lineState(job(log), CONFIG, "labels", both());
  assert.deepEqual([s.step, s.ready], ["send:printer", true]);
  const sent = [...log, {step: "send:printer", by: "staff", at: "t", to: "external", files}, {step: "back:printed", by: "staff", at: "t", files}];
  assert.deepEqual([lineState(job(sent), CONFIG, "labels", both()).done, lineState(job(sent), CONFIG, "labels", both()).step], [true, null]);
});

test("accept by hand passes a failing check until the file changes; a changed file rewinds the line", () => {
  const accepted = [{step: "size", by: "staff", at: "t", note: "ok", files: {"K_labels_A_v1.pdf": "a1", "K_labels_B_v1.pdf": "b1"}}];
  assert.equal(lineState(job(accepted), CONFIG, "labels", kmpn()).step, "bleed"); // size accepted, resolution/pdf pass
  const changed = {...kmpn(), "K_labels_A_v1.pdf": facts({sha256: "a2"})};
  assert.equal(lineState(job(accepted), CONFIG, "labels", changed).step, "size");
  const sent = [{step: "approve", by: "staff", at: "t", files}, {step: "send:printer", by: "staff", at: "t", to: "x", files}];
  assert.equal(lineState(job(sent), CONFIG, "labels", {...both(), "K_labels_B_v1.pdf": good("b9")}).step, "approve");
});

test("fixer entries never complete a step; fixerTargets skips tried sources and fixer outputs", () => {
  const atColour = {"K_labels_A_v1.pdf": facts({parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}, pageMm: {w: 98, h: 98},
    bleed: {outerInkPct: 90, innerInkPct: 90}}), "K_labels_B_v1.pdf": good("b1")};
  assert.equal(lineState(job(), CONFIG, "labels", atColour).step, "colour");
  assert.deepEqual(fixerTargets(job(), CONFIG, "labels", atColour), ["K_labels_A_v1.pdf"]);
  const tried = [{step: "colour", by: "fixer", at: "t", from: {"K_labels_A_v1.pdf": "a1"}, to: "K_labels_A_v2.pdf"}];
  assert.equal(lineState(job(tried), CONFIG, "labels", atColour).step, "colour");
  assert.deepEqual(fixerTargets(job(tried), CONFIG, "labels", atColour), []);
  const onOutput = job(tried, {A: {fileName: "K_labels_A_v2.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}});
  assert.deepEqual(fixerTargets(onOutput, CONFIG, "labels", {"K_labels_A_v2.pdf": atColour["K_labels_A_v1.pdf"], "K_labels_B_v1.pdf": good("b1")}), []);
  assert.deepEqual(fixerTargets(job(), CONFIG, "labels", kmpn()), [], "not at colour yet");
});

test("whitelabel side left out; checking while there are no results; logEntry carries the files", () => {
  const white = job([], {A: {fileName: "K_labels_A_v1.pdf"}, B: {whitelabel: true}});
  assert.equal(lineState(white, CONFIG, "labels", {"K_labels_A_v1.pdf": good("a1")}).step, "approve");
  assert.equal(lineState(job(), CONFIG, "labels", null).checking, true);
  const e = logEntry(job(), CONFIG, "labels", both(), {step: "approve", by: "staff"});
  assert.deepEqual([e.step, e.by, e.files], ["approve", "staff", files]);
  assert.match(e.at, /^\d{4}-\d\d-\d\dT/);
});
```

- [ ] **Step 2: Run them, check they fail** (module not found).

- [ ] **Step 3: Implement `src/lib/lines.js`**

```js
// Production lines: per product, steps in order (CONFIG.lines). Where a
// line stands is derived on every scan: check steps from the current
// check results, the others from the line's log in project.plant.lines,
// whose entries count while their files keep their sha256. Spec:
// docs/superpowers/specs/2026-10-02-production-lines-design.md.

import { getFormat } from "./format-catalogue.js";
import { artworkSlots, artworkRows } from "./artwork-checks.js";
import { fileSlots } from "./project.js";

const ROWS = {
  size: ["Size"], resolution: ["Resolution"],
  pdf: ["File", "Pages", "PDF version", "Encryption", "Fonts", "Colour profile", "TrimBox"],
  bleed: ["Bleed"], colour: ["Colour mode", "Ink", "Black"]
};
const BAD = new Set(["warn", "error"]);
const kindOf = step => ROWS[step] ? "check" : step === "approve" ? "approve" : step.split(":")[0];

export function lineFiles(project, config, lineName){
  const parts = config.lines[lineName].parts;
  const paths = new Map(fileSlots(project).filter(s => s.name).map(s => [s.name, s.path]));
  return artworkSlots(project, config).filter(s => parts.includes(s.params.part))
    .map(slot => ({name: slot.name, slot: {...slot, path: paths.get(slot.name)}}));
}

// A failing row of a check step for one file, as "why" text; null when it passes.
function failing(step, facts, slot, printCheck){
  const row = artworkRows(facts, slot.params, printCheck).find(r => ROWS[step].includes(r.feature) && BAD.has(r.severity));
  return row ? `${slot.title}: ${row.detected}${row.expected ? `, expected ${row.expected}` : ""}` : null;
}

function counts(entry, current){
  return !entry.files || Object.entries(entry.files).every(([name, sha]) => current[name] === sha);
}

export function lineState(project, config, lineName, checkResults){
  const line = config.lines[lineName];
  const files = lineFiles(project, config, lineName);
  const steps = line.steps.map(step => ({step, kind: kindOf(step), state: "ahead"}));
  const waiting = (line.after || []).some(other => !lineState(project, config, other, checkResults).done);
  if(!checkResults) return {line: lineName, steps, step: null, why: "checking", ready: false, done: false, waiting, checking: true};
  const printCheck = getFormat(config, project.format).printCheck;
  const current = Object.fromEntries(files.map(f => [f.name, (checkResults[f.name] || {}).sha256]));
  const log = (project.plant.lines[lineName] || []).filter(e => e.by !== "fixer" && counts(e, current));
  const logged = step => log.some(e => e.step === step && (!step.startsWith("send:") || e.to));
  let at = null, why = "";
  for(const s of steps){
    let done;
    if(s.kind === "check"){
      const reasons = files.map(f => checkResults[f.name] ? failing(s.step, checkResults[f.name], f.slot, printCheck)
        : `${f.slot.title}: not checked yet`).filter(Boolean);
      done = !reasons.length || logged(s.step);
      if(!done && at === null) why = reasons[0];
    } else {
      done = logged(s.step);
    }
    if(at === null && !done){ at = s.step; s.state = "current"; }
    else if(at === null) s.state = "done";
  }
  const firstSend = line.steps.findIndex(step => step.startsWith("send:"));
  const ready = at === null || (firstSend !== -1 && line.steps.indexOf(at) >= firstSend);
  return {line: lineName, steps, step: at, why: at ? why : "", ready, done: at === null, waiting, checking: false};
}

export function logEntry(project, config, lineName, checkResults, fields){
  const files = Object.fromEntries(lineFiles(project, config, lineName)
    .map(f => [f.name, (checkResults[f.name] || {}).sha256 || null]));
  return {...fields, at: new Date().toISOString(), files};
}

// Files the colour fixer should run on now: the line stands at colour,
// the file fails it, no fixer tried this file at this hash, and the
// file isn't itself a fixer's output.
export function fixerTargets(project, config, lineName, checkResults){
  const state = lineState(project, config, lineName, checkResults);
  if(state.step !== "colour" || !checkResults) return [];
  const printCheck = getFormat(config, project.format).printCheck;
  const fixer = (project.plant.lines[lineName] || []).filter(e => e.by === "fixer");
  return lineFiles(project, config, lineName).filter(f => {
    const facts = checkResults[f.name];
    if(!facts || !failing("colour", facts, f.slot, printCheck)) return false;
    return !fixer.some(e => (e.from && e.from[f.name] === facts.sha256) || e.to === f.name);
  }).map(f => f.name);
}

// Every listed line through: done, or ready when its next step is a send.
export function allThrough(project, config, checkResults, stageLines){
  return stageLines.every(name => lineState(project, config, name, checkResults).ready);
}
```

Notes for the implementer:
- The "accept by hand" test expects `bleed`. With `kmpn()`, Resolution reads n/a (vector) and passes, `pdf` passes, and bleed fails, so the line lands on `bleed`.
- `logEntry` and the `rewinds` test rely on the sha256 values in `checkResults`.
- Check `fileSlots(project)`'s path for label sides (`["labels", "sides", "A", "fileName"]`) in `src/lib/project.js`.

- [ ] **Step 4: Run** `node --test tests/`. Expected: pass. If a check in the fixture fails differently than the test expects (e.g. resolution), complete the fixture's facts rather than loosening the assertion, and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add src/lib/lines.js tests/lines.test.js
git commit -m "lines: where a production line stands — checks live, approve/send/back by log, entries tied to file hashes"
```

---

### Task 4: Server — sha256 in results, `POST /api/project`, board data

**Files:**
- Modify: `plant/checks.py`, `plant/jobs.py`, `plant/server.py`
- Test: `plant/test_checks.py`, `plant/test_jobs.py`, `plant/test_server.py`

**Interfaces:**
- Produces:
  - artwork results `{name: {...facts, "sha256"}}`;
  - `POST /api/project {job, project, basedOn}` → `{projectHash}`, with 409 on change;
  - board cards with `project`, `files` and `artwork` (cached `{name: {...facts, sha256}}`).

- [ ] **Step 1: Failing tests**

`plant/test_server.py`, in `HttpTest`:

```python
    def test_project_save_is_safe(self):
        folder = self.root / "20_DONE" / "X_a_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        digest = self.get("/api/job?job=X_a_261001-1432")[1]["projectHash"]
        body = {"job": "X_a_261001-1432", "project": {"catalogue": "X", "plant": {"lines": {"labels": [{"step": "approve"}]}}}, "basedOn": digest}
        status, reply = self.post("/api/project", body)
        self.assertEqual(status, 200)
        self.assertIn("projectHash", reply)
        self.assertEqual(self.post("/api/project", body)[0], 409)
        self.assertEqual(self.post("/api/project", {**body, "project": [], "basedOn": reply["projectHash"]})[0], 400)
```

`plant/test_jobs.py`, in `JobsTest` (check that `json` is imported):

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

`plant/test_checks.py`: next to the existing `check_artwork` test (`grep -n "check_artwork" plant/test_checks.py`), assert the result for a checked file has a 64-character `sha256`. If no such test exists, add one with a one-page PDF and `plant/test_artwork.py`'s `LABEL`-style params.

- [ ] **Step 2: Run them, check they fail.**

- [ ] **Step 3: Implement**
  - `plant/checks.py` `check_artwork`: `result[name] = {**facts, "sha256": cache.used[name]["sha256"]}`. Both `get` and `put` fill `used`.
  - `plant/jobs.py` `board`: replace the card's `project = read_project(folder)[0]` / `cards.append(...)` with:

    ```python
                    project = read_project(folder)[0]
                    try:
                        cached = json.loads((folder / ".checks" / "artwork.json").read_text())
                    except (OSError, ValueError):
                        cached = {}
                    artwork = {name: {**e.get("facts", {}), "sha256": e.get("sha256")}
                               for name, e in cached.items() if isinstance(e, dict)}
                    cards.append({"job": job, "catalogue": project.get("catalogue", ""),
                                  "title": project.get("albumTitle", ""), "artist": project.get("albumArtist", ""),
                                  "project": project, "files": files(folder), "artwork": artwork})
    ```
  - `plant/server.py`: add `"/api/project": self.save_project,` to `do_POST`, and:

    ```python
        def save_project(self):
            """project.json as the page decided it (a production log entry);
            refused with 409 when it changed since the page read it."""
            r = self.body()
            folder = jobs.find(JOBS, r["job"])[1]
            if not isinstance(r.get("project"), dict):
                raise JobError("project must be an object")
            self.json({"projectHash": jobs.write_project(folder, r["project"], r["basedOn"])})
    ```

- [ ] **Step 4: Run both suites.** Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add plant/checks.py plant/jobs.py plant/server.py plant/test_checks.py plant/test_jobs.py plant/test_server.py
git commit -m "plant server: sha256 in artwork results, /api/project, board cards with project, files and cached facts"
```

---

### Task 5: Rendering — Production section, board grid, move hint

**Files:**
- Modify: `src/lib/plant-overview.js`, `src/lib/plant-board.js`
- Test: `tests/plant-overview.test.js`, `tests/plant-board.test.js`

**Interfaces:**
- Consumes: `lineState` results (Task 3), `CONFIG.partners`.
- Produces:
  - `renderProduction(states, partners) -> html`, a `<section id="production">`. `states` is a `lineState()[]`.
  - `renderBasic(project, config, place, gaps, through = false)`: the Stage cell gets ` — lines through, move on?` when `through`.
  - `renderBoard(rows, lineNames) -> html`: `rows = [{job, catalogue, title, states: {[line]: lineState}}]`.
  - `renderNav` starts with `<p><a href="#/board">Board</a></p>`.

- [ ] **Step 1: Failing tests**

`tests/plant-overview.test.js` (import `renderProduction`):

```js
test("production: steps ticked, the current one with why and its action", () => {
  const st = (step, kind, extra = {}) => ({line: "labels", steps: [{step: "size", kind: "check", state: "done"},
    {step, kind, state: "current"}], step, why: "Label A: 96 <mm>", ready: false, done: false, waiting: false, checking: false, ...extra});
  const partners = {printer: ["in-house", "Druck & Co"]};
  const check = renderProduction([st("bleed", "check")], partners);
  assert.ok(check.startsWith('<section id="production">'));
  assert.ok(check.includes("✓ size"));
  assert.ok(check.includes("Label A: 96 &lt;mm&gt;"));
  assert.ok(check.includes('<button type="button" class="line-act" data-line="labels" data-step="bleed" data-by="staff">accept</button>'));
  const approve = renderProduction([st("approve", "approve")], partners);
  assert.ok(approve.includes('data-step="approve" data-by="customer">approved by customer</button>'));
  assert.ok(approve.includes('data-step="approve" data-by="staff">approved by staff</button>'));
  const send = renderProduction([st("send:printer", "send")], partners);
  assert.ok(send.includes('<select class="partner"><option>in-house</option><option>Druck &amp; Co</option></select>'));
  assert.ok(send.includes('data-step="send:printer" data-by="staff">sent</button>'));
  assert.ok(renderProduction([st("back:printed", "back")], partners).includes(">back, fine</button>"));
  assert.ok(renderProduction([{line: "labels", steps: [], checking: true}], partners).includes("checking"));
});

test("basic: suggests moving on when the lines are through", () => {
  assert.ok(renderBasic(project, CONFIG, place, [], true).includes("lines through — move on?"));
  assert.ok(!renderBasic(project, CONFIG, place, [], false).includes("move on?"));
});
```

`tests/plant-board.test.js` (import `renderBoard`):

```js
test("board grid: a row per job, a column per line, the current step or ✓", () => {
  const rows = [{job: "K_x_261001-2006", catalogue: "K", title: "High <Riding>",
    states: {labels: {step: "size", done: false, waiting: false, checking: false}}},
    {job: "L_y_261001-2006", catalogue: "L", title: "", states: {labels: {step: null, done: true, waiting: false, checking: false}}}];
  const html = renderBoard(rows, ["labels"]);
  assert.ok(html.includes('<a href="#/job/K_x_261001-2006">K — High &lt;Riding&gt;</a>'));
  assert.ok(html.includes("<td>size</td>"));
  assert.ok(html.includes("<td>✓</td>"));
});
```

(Read `listTable` and `section` in `plant-overview.js` first, and align the exact `<td>` and `<section>` strings with their output, as the existing tests in these files do.)

- [ ] **Step 2: Run them, check they fail.**

- [ ] **Step 3: Implement**

`src/lib/plant-overview.js`:
- `SECTIONS` gets `["production", "Production"]` after Basic.
- `renderBasic(…, gaps, through = false)`: append `(through ? " — lines through, move on?" : "")` after the move/rescan buttons.
- Add:

```js
// --- Production ------------------------------------------------------

const ACTIONS = {
  check: () => [["staff", "accept"]],
  approve: () => [["customer", "approved by customer"], ["staff", "approved by staff"]],
  send: () => [["staff", "sent"]],
  back: () => [["staff", "back, fine"]]
};

// states: lineState() per line; partners: CONFIG.partners (send steps pick from them).
export function renderProduction(states, partners){
  return section("production", states.map(s => {
    if(s.checking) return `<h3>${escapeHtml(s.line)}</h3><p>checking…</p>`;
    const steps = s.steps.map(x => x.state === "done" ? `✓ ${escapeHtml(x.step)}` : x.state === "current"
      ? `<b>${escapeHtml(x.step)}</b>` : escapeHtml(x.step)).join(" → ");
    let body = `<h3>${escapeHtml(s.line)}${s.done ? " ✓" : s.waiting ? " (waiting)" : ""}</h3><p>${steps}</p>`;
    if(s.step){
      const current = s.steps.find(x => x.step === s.step);
      if(s.why) body += `<p>${escapeHtml(s.why)}</p>`;
      if(current.kind === "send"){
        const list = partners[s.step.split(":")[1]] || [];
        body += `<select class="partner">${list.map(p => `<option>${escapeHtml(p)}</option>`).join("")}</select> `;
      }
      body += ACTIONS[current.kind]().map(([by, label]) => `<button type="button" class="line-act" data-line="${escapeHtml(s.line)}"`
        + ` data-step="${escapeHtml(s.step)}" data-by="${by}">${label}</button>`).join(" ");
    }
    return body;
  }).join(""));
}
```

`src/lib/plant-board.js`:
- `renderNav`: prefix `<p><a href="#/board">Board</a></p>`.
- Add:

```js
// The board: a row per job, a column per production line with where it stands.
export function renderBoard(rows, lineNames){
  const cell = s => !s ? "" : s.done ? "✓" : s.waiting ? "waiting" : s.checking ? "not checked" : escapeHtml(s.step);
  return `<h2>Board</h2>` + listTable(["Job", ...lineNames], rows.map(r => [
    `<a href="${jobLink(r.job)}">${escapeHtml([r.catalogue || r.job, r.title].filter(Boolean).join(" — "))}</a>`,
    ...lineNames.map(n => cell(r.states[n]))]));
}
```

- [ ] **Step 4: Run** `node --test tests/`. Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js src/lib/plant-board.js tests/plant-overview.test.js tests/plant-board.test.js
git commit -m "plant view: Production section with one action per step, move hint, board grid"
```

---

### Task 6: Plant page wiring — actions, automatic colour fixer, board; docs

**Files:**
- Modify: `src/plant/app.js`, `CLAUDE.md`

**Interfaces:**
- Consumes:
  - `lineState`, `logEntry`, `fixerTargets` (Task 3); `renderProduction`, `renderBasic(…, through)`, `renderBoard` (Task 5);
  - `/api/project`, board cards (Task 4);
  - existing `/api/fix/label`, `/api/assign`, `useVersion`, `nextVersionName`, `versionOf`, `jobName`.

- [ ] **Step 1: The job page.** In `showJob`, import what's listed above.
  - **Initial render:** after Basic, add
    ```js
    renderProduction(Object.keys(CONFIG.lines).map(n => lineState(project, CONFIG, n, null)), CONFIG.partners)
    ```
  - **After `artworkFacts` arrive:**
    ```js
    const states = Object.keys(CONFIG.lines).map(n => lineState(project, CONFIG, n, artworkFacts));
    Object.assign(view, {artworkFacts, project});
    replace("production", renderProduction(states, CONFIG.partners));
    replace("basic", renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps,
      states.length > 0 && states.every(s => s.ready)));
    ```
  - **The automatic colour fixer**, at most one file per load. The reload after the save runs the next file:
    ```js
    for(const name of Object.keys(CONFIG.lines)){
      const [target] = fixerTargets(project, CONFIG, name, artworkFacts);
      if(!target) continue;
      const slot = files.slots.find(s => s.name === target);
      const check = checkable.find(c => c.name === target);
      const newName = nextVersionName(versionOf(target).base, ".pdf", view.names);
      busy(`fixing colours of ${target}`);
      await postJson("/api/fix/label", {job, file: target, newName,
        params: {...check.params, fixDpi: getFormat(CONFIG, project.format).printCheck.fixDpi, profile: CONFIG.printProfiles.labels || null}});
      const raw = structuredClone(view.raw);
      useVersion(raw, slot.path, newName);
      raw.plant = raw.plant || {};
      raw.plant.lines = raw.plant.lines || {};
      raw.plant.lines[name] = [...(raw.plant.lines[name] || []),
        {step: "colour", by: "fixer", at: new Date().toISOString(), from: {[target]: artworkFacts[target].sha256}, to: newName}];
      raw.history = [...(raw.history || []), historyEntry(`${name}: colour fixed, ${target} → ${newName}`, new Date())];
      const {job: renamed} = await postJson("/api/assign", {job, file: newName, newName, project: raw, basedOn: view.hash, name: jobName(raw)});
      location.hash = `#/job/${encodeURIComponent(renamed)}`;
      return;
    }
    ```
    - If `/api/fix/label` refuses (e.g. RGB without profile), the error shows as today. The line stays at `colour` for staff, and no fixer entry is written, so the next load tries again.
    - Accepted risk: a refusing fixer retries on every load. Record it as a ruling.
  - **Check:** `/api/assign` with `file === newName` saves the project without renaming the file (`jobs.assign` skips the rename when the names are equal).

- [ ] **Step 2: The actions.** Extend the click selector with `.line-act`, and add a branch:

```js
    } else if(button.matches(".line-act")){
      const {line, step, by} = button.dataset;
      const raw = structuredClone(view.raw);
      raw.plant = raw.plant || {};
      raw.plant.lines = raw.plant.lines || {};
      const partner = button.parentElement.querySelector(".partner");
      const fields = {step, by, ...(step.startsWith("send:") ? {to: partner ? partner.value : ""} : {})};
      raw.plant.lines[line] = [...(raw.plant.lines[line] || []), logEntry(view.project, CONFIG, line, view.artworkFacts, fields)];
      raw.history = [...(raw.history || []), historyEntry(`${line}: ${step} — ${button.textContent}${fields.to ? ` (${fields.to})` : ""}`, new Date())];
      await postJson("/api/project", {job: view.job, project: raw, basedOn: view.hash});
```

The branch falls through to `await route();`. A check step's "accept" uses `step` = the check's name, which `lineState` treats as done.

- [ ] **Step 3: The board route.** In `route()`, handle `#/board`:
  - Fetch `/api/board`.
  - For each card without `error`, in all stages:
    ```js
    let states = {};
    try{
      const p = prepareProject(card.project, CONFIG);
      states = Object.fromEntries(Object.keys(CONFIG.lines).map(n =>
        [n, lineState(p, CONFIG, n, Object.keys(card.artwork).length ? card.artwork : null)]));
    }catch{ /* unreadable project: empty row */ }
    ```
  - Rows `{job, catalogue, title, states}`.
  - `out.innerHTML = renderBoard(rows, Object.keys(CONFIG.lines))`.
  - Add `board` before the overview fallback in the hash parsing.

- [ ] **Step 4: Docs.** In `CLAUDE.md`'s plant bullet, after "shown next to the version in use.", add:

  "Production lines (`src/lib/lines.js`, `CONFIG.lines`): per product its steps — checks (live from the check results; the colour fixer runs by itself), approve, send to a partner, back — where a line stands is derived on every scan; `project.json`'s `plant.lines` keeps an append-only log whose entries count while their files keep their sha256. Spec: `docs/superpowers/specs/2026-10-02-production-lines-design.md`."

- [ ] **Step 5: Run everything**

Run: `node --test tests/ && uv run --project plant python -m unittest discover plant && node build/build.js && node --check src/plant/app.js`
Expected: all pass.

- [ ] **Step 6: Manual check** (the user, KMPN012):
1. Labels stand at `size`. Click "accept": the line moves to `bleed`; accept again to reach `colour`.
2. The fixer runs by itself: a `_v2.pdf` is used, and the line moves to `approve`.
3. "approved by customer" → `send:printer`. Pick a printer and click "sent" → `back:printed`. Then "back, fine": ✓.
4. Board: the row shows the step.
5. Replace a label file: the line rewinds.

- [ ] **Step 7: Commit**

```bash
git add src/plant/app.js CLAUDE.md
git commit -m "plant view: production lines on the job page (accept, approve, send, back), automatic colour fixer, board"
```
