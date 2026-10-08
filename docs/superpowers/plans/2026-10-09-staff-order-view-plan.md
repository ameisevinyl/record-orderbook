# Staff Order View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking an order on the board opens the customer page, filled from the job folder and read-only, with the plant's own checks (artwork and audio, from the backend) where the browser's checks run for the customer, and what only the plant knows (status, production lines, history, files outside the order).

**Architecture:** The plant server serves `src/index.html` at `/order/<job>` with the staff script and style added. `src/staff.js` fetches `/api/job`, fills the form with a new exported `applyProject` (the second half of `loadProject`, split off), locks every control, and replaces the form's file checks with the backend's results (`/api/check/audio`, `/api/check/artwork`). It shows; it changes nothing. No file bytes are fetched: slots show the file's name, the previews and facts come from the plant's check output.

**Tech Stack:** plain ES modules, `node --test`; Python 3 stdlib + `unittest` for the one route.

**Spec:** `docs/superpowers/specs/2026-10-08-backend-structure-design.md` §3 (revised by the user in conversation: info only, no move logic, no fixing; Task 9 updates the spec).

## Global Constraints

- No runtime dependencies; `dist/index.html` stays one self-contained file and works exactly as before for customers. Staff code (`src/staff.js`, `staff.css`) is not in `build/build.js`'s `FILES`.
- `src/lib/*.js` stay pure and DOM-free with tests; DOM glue (modules, `staff.js`) is checked by hand in the browser at the end, which needs the user's go-ahead (memory: ask before using Chrome).
- The staff view never writes: no `/api/project`, no move, no fix, no god mode (deferred), no price section (deferred to part 4, see Review Focus).
- Comments short, explain why. Commit messages short, imperative, with the attribution line from the session reminder.
- Tests: `node --test tests/` and `uv run --project plant python -m unittest discover plant`.

## Review Focus

- The customer page must behave exactly as before after the `loadProject` split (Open project in `src/index.html` and `dist/index.html`), including the "please re-select this file" text on slots without files (Task 4 step 6, by hand).
- A job whose `project.json` the page refuses (`prepareProject` throws) or whose checks fail: the staff view says so in its bar and still shows what it has, instead of a blank page (Task 8).
- Slot file names with markup (`<b>` in a name) must not become HTML in the form or the status list (Tasks 5, 7: DOM text nodes / `escapeHtml`).
- The form's own "Status" checklist would list every file as missing (nothing is attached): it must be hidden in the staff view and replaced by the plant's list (Task 8, `staff.css`).
- Controls the page creates later (a new track row, a re-rendered address) must be locked too (Task 8, the observer).

---

### Task 1: One reader for the check streams

**Files:**
- Create: `src/lib/stream.js`, `tests/stream.test.js`
- Modify: `src/plant/app.js` (use it instead of its own `readStream`)

**Interfaces:**
- Produces: `readStream(res: Response, onStep: (msg) => void) -> Promise<any>` — reads the server's newline-delimited JSON, calls `onStep` for each step line, returns the `result`, throws the `error` text, or throws "the check ended without a result".

- [ ] **Step 1: Write the failing test** — `tests/stream.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readStream } from "../src/lib/stream.js";

const lines = (...objects) => new Response(objects.map(o => JSON.stringify(o) + "\n").join(""));

test("steps go to the callback, the result is returned", async () => {
  const steps = [];
  const result = await readStream(lines({step: "a", index: 1}, {step: "b", index: 2}, {result: {n: 5}}), s => steps.push(s.step));
  assert.deepEqual([steps, result], [["a", "b"], {n: 5}]);
});

test("an error line throws its message", async () => {
  await assert.rejects(readStream(lines({step: "a"}, {error: "boom"}), () => {}), /boom/);
});

test("a stream that ends without a result throws", async () => {
  await assert.rejects(readStream(lines({step: "a"}), () => {}), /ended without a result/);
});

test("a line split across chunks is read whole", async () => {
  const body = new ReadableStream({start(controller){
    const encode = text => new TextEncoder().encode(text);
    controller.enqueue(encode('{"step":"a"}\n{"res'));
    controller.enqueue(encode('ult":1}\n'));
    controller.close();
  }});
  assert.equal(await readStream(new Response(body), () => {}), 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/stream.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/stream.js`** (the function as it is in `src/plant/app.js` today, moved):

```js
// A check streams one JSON object per line: its steps, then
// {"result": …} or {"error": …}.
export async function readStream(res, onStep){
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for(;;){
    const {done, value} = await reader.read();
    buffer += value || "";
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for(const line of lines.filter(Boolean)){
      const msg = JSON.parse(line);
      if("result" in msg) return msg.result;
      if(msg.error) throw new Error(msg.error);
      onStep(msg);
    }
    if(done) throw new Error("the check ended without a result");
  }
}
```

In `src/plant/app.js` delete the local `readStream` function and its comment block (from `// A check streams one JSON object per line` to the closing `}`), and add `import { readStream } from "../lib/stream.js";` with the other lib imports.

- [ ] **Step 4: Run all JS tests** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stream.js tests/stream.test.js src/plant/app.js
git commit -m "readStream as a lib: the plant view and the staff order view read the check streams the same way"
```

---

### Task 2: The staff mode lib and the board's links

**Files:**
- Create: `src/lib/staff-mode.js`, `tests/staff-mode.test.js`
- Modify: `src/lib/dashboard.js` (card links), `tests/dashboard.test.js`

**Interfaces:**
- Produces:
  - `orderUrl(job) -> string` — `/order/<encoded job>`.
  - `staffJob(pathname = location.pathname) -> string | null` — the job of an `/order/<job>` path, else null (also for a malformed escape).
  - `reselectNote(staff = staffJob() !== null) -> string` — `""` for staff, else `"please re-select this file (not stored in the order file)"`.
  - `storedFileText(name, staff = staffJob() !== null) -> string` — `file: <name>` plus ` — <reselectNote>` when there is one.

- [ ] **Step 1: Write the failing tests** — `tests/staff-mode.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderUrl, staffJob, reselectNote, storedFileText } from "../src/lib/staff-mode.js";

test("the order view's address and the job in it", () => {
  assert.equal(orderUrl("a b/c"), "/order/a%20b%2Fc");
  assert.equal(staffJob("/order/a%20b%2Fc"), "a b/c");
  for(const other of ["/", "/index.html", "/order/", "/order/a/b", "/src/index.html", "/order/%E0%A4%A"]) assert.equal(staffJob(other), null, other);
});

test("a slot without its file: customers re-select it, staff just read the name", () => {
  assert.equal(reselectNote(true), "");
  assert.equal(reselectNote(false), "please re-select this file (not stored in the order file)");
  assert.equal(storedFileText("A1.wav", true), "file: A1.wav");
  assert.equal(storedFileText("A1.wav", false), "file: A1.wav — please re-select this file (not stored in the order file)");
});
```

In `tests/dashboard.test.js`: the expectations `"#/job/KLM001"` (in the cards test: `assert.deepEqual([klm.href, klm.title], ["#/job/KLM001", …])`) become `"/order/KLM001"`, and in the render test `href="#/job/KLM001"` becomes `href="/order/KLM001"`.

- [ ] **Step 2: Run to verify they fail** — `node --test tests/staff-mode.test.js tests/dashboard.test.js` — Expected: FAIL (module missing; hrefs differ).

- [ ] **Step 3: Implement.** `src/lib/staff-mode.js`:

```js
// The staff's order view is the customer page served at /order/<job>
// (plant/server.py); src/staff.js fills it from the job folder.

export const orderUrl = job => `/order/${encodeURIComponent(job)}`;

// The job of an /order/<job> path, else null (the customer's own page).
export function staffJob(pathname = location.pathname){
  const [, job] = /^\/order\/([^/]+)$/.exec(pathname) || [];
  if(!job) return null;
  try{
    return decodeURIComponent(job);
  }catch{
    return null;
  }
}

const RESELECT = "please re-select this file (not stored in the order file)";

// The customer reopens a project without its files and picks them again;
// the plant reads the names, its files are in the job folder.
export const reselectNote = (staff = staffJob() !== null) => staff ? "" : RESELECT;

export const storedFileText = (name, staff = staffJob() !== null) => `file: ${name}` + (staff ? "" : ` — ${RESELECT}`);
```

`src/lib/dashboard.js`: add `import { orderUrl } from "./staff-mode.js";` and in `cardOf` change `href: \`#/job/${encodeURIComponent(card.job)}\`` to `href: orderUrl(card.job)`.

- [ ] **Step 4: Run all JS tests** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff-mode.js tests/staff-mode.test.js src/lib/dashboard.js tests/dashboard.test.js
git commit -m "board cards open the order view (/order/<job>); staff-mode lib"
```

---

### Task 3: The server serves the order view

**Files:**
- Modify: `plant/server.py` (`do_GET`, `get_order`), `plant/test_server.py`

**Interfaces:**
- Consumes: `jobs.find(JOBS, name)`.
- Produces: `GET /order/<job>` → the customer page (`src/index.html`) with its script path made absolute and `/src/staff.css` + `/src/staff.js` added; 404 for an unknown or invalid job name. Files `src/staff.js` / `staff.css` come in Task 8.

- [ ] **Step 1: Write the failing test** — in `plant/test_server.py`, `HttpTest`:

```python
    def test_order_page_is_the_customer_page_with_the_staff_script(self):
        folder = self.root / "10_ORDERS" / "10_PREPRESS" / "j"
        folder.mkdir(parents=True)
        (folder / "project.json").write_text('{"catalogue": "X"}')
        status, data = self.request("GET", "/order/j")
        self.assertEqual(status, 200)
        html = data.decode()
        self.assertIn("Record Orderbook", html)
        self.assertIn('<script type="module" src="/src/app.js"></script>', html)
        self.assertIn('<script type="module" src="/src/staff.js"></script>', html)
        self.assertIn('<link rel="stylesheet" href="/src/staff.css">', html)
        self.assertNotIn('src="app.js"', html)
        self.assertEqual(self.request("GET", "/order/nope")[0], 404)
        self.assertEqual(self.request("GET", "/order/..%2Fx")[0], 404)
```

- [ ] **Step 2: Run to verify it fails** — `uv run --project plant python -m unittest discover plant -p "test_server.py" -k order_page` — Expected: FAIL (404 for `/order/j`).

- [ ] **Step 3: Implement** in `plant/server.py`. After `INDEX = …` add `CUSTOMER_PAGE = SRC / "index.html"`. In `do_GET`, right after the `host_ok` check and `route = …` line add:

```python
        if route.startswith("/order/"):
            return self.answer(self.get_order)
```

and add the method next to `get_zip`:

```python
    def get_order(self):
        """The customer page as the staff's order view: its script by absolute
        path (the page isn't under /src/ here), then the staff's script and style."""
        name = unquote(urlsplit(self.path).path.removeprefix("/order/"))
        try:
            jobs.find(JOBS, name)
        except JobError:
            return self.reply(404, "no such job")
        page = CUSTOMER_PAGE.read_text()
        marker = '<script type="module" src="app.js"></script>'
        if marker not in page:
            raise OSError("src/index.html has changed: the order view can't be built from it")
        self.reply(200, page.replace(marker, '<link rel="stylesheet" href="/src/staff.css">\n'
                                     '<script type="module" src="/src/app.js"></script>\n'
                                     '<script type="module" src="/src/staff.js"></script>'), TYPES[".html"])
```

- [ ] **Step 4: Run to verify it passes** — `uv run --project plant python -m unittest discover plant` — Expected: OK.

- [ ] **Step 5: Commit**

```bash
git add plant/server.py plant/test_server.py
git commit -m "plant server: /order/<job> serves the customer page with the staff script"
```

---

### Task 4: Split `loadProject` and say what staff mean by a missing file

**Files:**
- Modify: `src/modules/tracklist.js` (`loadProject` → `loadProject` + exported `applyProject`; three "please re-select" texts), `src/modules/artwork-slot.js` (`applyFile`), `build/build.js` (`FILES`)
- Test: `node build/build.js`, the existing suite, and a by-hand check of Open project (step 6)

**Interfaces:**
- Consumes: `storedFileText`, `reselectNote` (Task 2).
- Produces: `export async function applyProject(p, fileMap)` in `tracklist.js` — fills the form from a `prepareProject` result and a `Map<string, File>` (may be empty). Each audio `.filemeta` element left without a file carries `data-stored="<file name>"` (Task 6 reads it).

- [ ] **Step 1: Split the function.** In `src/modules/tracklist.js` replace

```js
    fileMap.set(name, new File([e.data], name, {type: mimeType(fileExt(name))}));
  }

  projectHistory = p.history;
```

with

```js
    fileMap.set(name, new File([e.data], name, {type: mimeType(fileExt(name))}));
  }
  await applyProject(p, fileMap);
}

// Fills the form from a prepared project (prepareProject) and the files by
// package name. The staff's order view (src/staff.js) calls it with no files.
export async function applyProject(p, fileMap){
  projectHistory = p.history;
```

- [ ] **Step 2: Check the second half uses only `p` and `fileMap`** — run `node --check src/modules/tracklist.js` and:

```bash
awk '/^export async function applyProject/,/^function collectPackageFiles/' src/modules/tracklist.js | grep -nE "jsonEntry|entries|\broot\b|\bfile\b\)" || echo "only p and fileMap"
```
Expected: `only p and fileMap` (if something prints, that variable came from the first half: pass it in).

- [ ] **Step 3: The texts.** In `src/modules/tracklist.js` add `import { storedFileText } from "../lib/staff-mode.js";` and replace the three messages:
  - track: `m.textContent = "file: " + t.fileName + " — please re-select this file (not stored in the order file)";` → `m.textContent = storedFileText(t.fileName);\n        m.dataset.stored = t.fileName;`
  - continuous: `document.getElementById("contfilemeta-"+side).textContent =\n        "file: " + s.continuousFileName + " — please re-select this file (not stored in the order file)";` → `const contMeta = document.getElementById("contfilemeta-"+side);\n      contMeta.textContent = storedFileText(s.continuousFileName);\n      contMeta.dataset.stored = s.continuousFileName;`
  - tracklist file: `meta.textContent = "file: " + s.tracklistFileName + " — please re-select this file (not stored in the order file)";` → `meta.textContent = storedFileText(s.tracklistFileName);`

  In `src/modules/artwork-slot.js` add `import { reselectNote } from "../lib/staff-mode.js";` and in `applyFile` replace `renderMeta(fileName, originalFileName, "please re-select this file (not stored in the order file)");` with `renderMeta(fileName, originalFileName, reselectNote() || null);`.

- [ ] **Step 4: The bundle.** In `build/build.js` `FILES`, add `"src/lib/staff-mode.js",` right after `"src/lib/time.js",` (before the modules that import it).

- [ ] **Step 5: Build and test** — `node build/build.js && node --test tests/` — Expected: builds without a duplicate-name or order error; all tests pass.

- [ ] **Step 6: By hand (ask the user first — browser use is theirs to allow):** open `dist/index.html`, add a track with an audio file, a label, Save, reload, Load that zip, then remove its audio file from the zip's folder and Load again — the slot must still say "file: … — please re-select this file (not stored in the order file)"; a normal Load must attach the files as before.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tracklist.js src/modules/artwork-slot.js build/build.js
git commit -m "loadProject split: applyProject fills the form from a project and its files; missing-file text via staff-mode"
```

---

### Task 5: Artwork slots show the plant's checks

**Files:**
- Modify: `src/modules/artwork-slot.js`, `src/modules/labels.js`, `src/modules/printed-parts.js`, `src/lib/plant-overview.js` (export `VERDICT`)
- Test: build + suite; checked by hand in Task 9

**Interfaces:**
- Produces:
  - `createArtworkSlot(...)` returns an extra `showChecks({rows, preview, status})`: fills the checklist table with `rows` (`{feature, severity, detected, expected}`), shows `preview` (a URL or null) as the slot's picture, and the stored file's name with `status` in the meta line.
  - `labels.js`: `export function showLabelChecks(byName)`; `printed-parts.js`: `export function showPartChecks(byName)` — `byName: Map<stored file name, {rows, preview, status}>`; each slot whose `state.storedFileName` is in the map gets `showChecks`.
  - `plant-overview.js`: `export const VERDICT = {ok: "OK", review: "review", customer: "needs customer"}`.

- [ ] **Step 1: `artwork-slot.js`.** Split the table building out of `renderChecklist` and add `showChecks`. Replace

```js
  function renderChecklist(parsed, kind, page){
    const {targetMm, trimMm, printCheck} = size();
    const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode(), page);
    warnings.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
```

with

```js
  function renderChecklist(parsed, kind, page){
    const {targetMm, trimMm, printCheck} = size();
    const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode(), page);
    fillChecklist(rows);
    return rows;
  }

  function fillChecklist(rows){
    warnings.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
```

and delete the old `return rows;` that ended the original function (the one after `warnings.appendChild(tbody);`), so `fillChecklist` ends with `warnings.appendChild(tbody);\n  }`. Then add before `// The package entries for this slot`:

```js
  // The plant's checks for the stored file (the staff's order view): its
  // rows in place of the browser's own, the plant's preview image (a URL).
  function showChecks({rows, preview: src, status}){
    fillChecklist(rows);
    if(src){
      const img = document.createElement("img");
      img.src = src;
      img.alt = "plant preview";
      preview.replaceChildren(img);
    } else preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    if(state.storedFileName) renderMeta(state.storedFileName, null, status);
  }
```

and return it: `return {state, setFile, clear, applyFile, files, showChecks};`.

- [ ] **Step 2: `labels.js`** — append:

```js
// The plant's checks in the place of the browser's own (the staff's order
// view): byName maps a stored file name to {rows, preview, status}.
export function showLabelChecks(byName){
  for(const side of SIDES){
    const hit = byName.get(labelSlots[side].state.storedFileName);
    if(hit) labelSlots[side].showChecks(hit);
  }
}
```

`printed-parts.js` — append:

```js
// Same for the sleeve, cover and inlay slots.
export function showPartChecks(byName){
  for(const part of PRINTED_PARTS){
    for(const variant of part.variants){
      const slot = part.slots[variant];
      const hit = byName.get(slot.state.storedFileName);
      if(hit) slot.showChecks(hit);
    }
  }
}
```

- [ ] **Step 3: `plant-overview.js`** — change `const VERDICT = {ok: "OK", review: "review", customer: "needs customer"};` to `export const VERDICT = …` (same value).

- [ ] **Step 4: Build and test** — `node build/build.js && node --test tests/` — Expected: builds; all pass (the customer slot behaviour is unchanged: `renderChecklist` still returns its rows).

- [ ] **Step 5: Commit**

```bash
git add src/modules/artwork-slot.js src/modules/labels.js src/modules/printed-parts.js src/lib/plant-overview.js
git commit -m "artwork slots can show the plant's checks and preview instead of the browser's own"
```

---

### Task 6: Audio file lines show the plant's facts

**Files:**
- Create: `src/lib/audio-facts.js`, `tests/audio-facts.test.js`
- Modify: `src/modules/tracklist.js`, `build/build.js` (`FILES`)

**Interfaces:**
- Produces: `audioFactsText(file) -> string` — one audio file's facts (the audio check's `facts.files[name]`) as the form's file line text: `3:12 · pcm_s24le 48 kHz 24 bit`, or the error. `tracklist.js`: `export function showAudioChecks(facts)` — for each `.filemeta[data-stored]` whose name is in `facts.files`, the line becomes `file: <name> — <audioFactsText>`, class `warn` when the file could not be read.

- [ ] **Step 1: Write the failing test** — `tests/audio-facts.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFactsText } from "../src/lib/audio-facts.js";

test("duration and format, as far as the facts have them", () => {
  assert.equal(audioFactsText({codec: "pcm_s24le", sampleRate: 48000, bitsPerSample: 24, duration: 192}), "3:12 · pcm_s24le 48 kHz 24 bit");
  assert.equal(audioFactsText({codec: "mp3", sampleRate: 44100, duration: 61}), "1:01 · mp3 44.1 kHz");
  assert.equal(audioFactsText({duration: 0}), "");
});

test("a file that could not be read says why", () => {
  assert.equal(audioFactsText({error: "ffprobe: not an audio file"}), "ffprobe: not an audio file");
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/audio-facts.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** `src/lib/audio-facts.js`:

```js
// One audio file's facts, as the plant's check read them (plant/checks.py),
// in the words of the form's file line.
import { formatTime } from "./time.js";

export function audioFactsText(file){
  if(file.error) return file.error;
  const khz = file.sampleRate ? `${file.sampleRate / 1000} kHz` : "";
  const format = [file.codec, khz, file.bitsPerSample && `${file.bitsPerSample} bit`].filter(Boolean).join(" ");
  return [file.duration > 0 ? formatTime(file.duration) : "", format].filter(Boolean).join(" · ");
}
```

`build/build.js` `FILES`: add `"src/lib/audio-facts.js",` after `"src/lib/staff-mode.js",`. In `src/modules/tracklist.js` add `import { audioFactsText } from "../lib/audio-facts.js";` and, below `applyProject`'s function (before `function collectPackageFiles`), add:

```js
// The plant's audio facts in the file lines of the staff's order view
// (applyProject marked the lines of files it did not attach).
export function showAudioChecks(facts){
  for(const line of document.querySelectorAll(".filemeta[data-stored]")){
    const file = facts.files[line.dataset.stored];
    if(!file) continue;
    renderFileMeta(line, line.dataset.stored, null, audioFactsText(file));
    line.classList.toggle("warn", !!file.error);
  }
}
```

(The continuous-side line is `#contfilemeta-X`, a `.filemeta` too; its `data-stored` was set in Task 4. If it is not a `.filemeta`, give it that class in `index.html`'s markup instead of changing this selector.)

- [ ] **Step 4: Run** — `node build/build.js && node --test tests/` — Expected: builds, all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-facts.js tests/audio-facts.test.js src/modules/tracklist.js build/build.js
git commit -m "audio file lines can show the plant's facts (duration, format, errors)"
```

---

### Task 7: What the plant adds — pure renderers

**Files:**
- Create: `src/lib/staff-info.js`, `tests/staff-info.test.js`

**Interfaces:**
- Consumes: `escapeHtml`, `stageLabel`, `listTable` from `./plant-overview.js`.
- Produces:
  - `renderStaffBar(job, stage) -> html` — `<nav class="staffbar">`: back to the board, the job name, its stage, a link to the old job page (`/#/job/<job>`), and `<span id="staffTask">` for what the page is doing.
  - `openItems({gaps, findings, artwork}) -> string[]` — gaps (`{group, text}`), audio findings (same shape) and artwork `{title, verdict}` with a verdict other than `ok`.
  - `renderStaffStatus(items) -> html` — `<li>`s in the customer checklist's markup (`bad` with `!`, or one `ok`).
  - `renderLineStatus(states) -> html` — the order's production lines (states from `lineState`, only the `needed` ones) as a read-only table.

- [ ] **Step 1: Write the failing tests** — `tests/staff-info.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStaffBar, openItems, renderStaffStatus, renderLineStatus } from "../src/lib/staff-info.js";

test("bar: back to the board, the job, its stage, the job page, escaped", () => {
  const html = renderStaffBar("K<1>_x", "10_ORDERS/10_PREPRESS");
  assert.ok(html.startsWith('<nav class="staffbar"><a href="/">← orderbook</a> · <b>K&lt;1&gt;_x</b> · ORDERS › PREPRESS'));
  assert.ok(html.includes('<a href="/#/job/K%3C1%3E_x">files &amp; fixes</a>'));
  assert.ok(html.includes('<span id="staffTask"></span>'));
});

test("open items: gaps, audio findings and artwork that needs a look; ok artwork is left out", () => {
  const items = openItems({
    gaps: [{group: "Labels", text: "label B has no artwork"}],
    findings: [{group: "Side A", text: "sample rates differ"}],
    artwork: [{title: "Label A", verdict: "ok"}, {title: "Cover", verdict: "review"}, {title: "Inlay front", verdict: "customer"}]
  });
  assert.deepEqual(items, ["Labels: label B has no artwork", "Side A: sample rates differ", "Cover: review", "Inlay front: needs customer"]);
});

test("status list: the customer checklist's markup, escaped; nothing open is one ok line", () => {
  assert.equal(renderStaffStatus(["a <b>"]), '<li class="bad"><span class="mark">!</span>a &lt;b&gt;</li>');
  assert.equal(renderStaffStatus([]), '<li class="ok"><span class="mark">✓</span>nothing open</li>');
});

test("line status: only the lines of the order, what each stands at", () => {
  const html = renderLineStatus([
    {line: "inlay", needed: false, done: true},
    {line: "labels", needed: true, done: false, waiting: false, checking: false, step: "size", why: "Label A: 96×96mm, expected 98×98mm"},
    {line: "press", needed: true, done: false, waiting: true},
    {line: "mastering", needed: true, done: true},
    {line: "pack", needed: true, done: false, waiting: false, checking: true}
  ]);
  assert.ok(!html.includes("inlay"));
  assert.ok(html.includes("<td>labels</td><td>size — Label A: 96×96mm, expected 98×98mm</td>"));
  assert.ok(html.includes("<td>press</td><td>waiting</td>") && html.includes("<td>mastering</td><td>✓</td>"));
  assert.ok(html.includes("<td>pack</td><td>not checked</td>"));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/staff-info.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/staff-info.js`:**

```js
// What the staff's order view adds to the customer page: the bar above it,
// the plant's status list, the production lines. Pure; every value is
// escaped here.

import { escapeHtml, stageLabel, listTable } from "./plant-overview.js";

export function renderStaffBar(job, stage){
  return `<nav class="staffbar"><a href="/">← orderbook</a> · <b>${escapeHtml(job)}</b> · ${escapeHtml(stageLabel(stage))}`
    + ` · <a href="/#/job/${encodeURIComponent(job)}">files &amp; fixes</a> <span id="staffTask"></span></nav>`;
}

const VERDICT_WORDS = {review: "review", customer: "needs customer"};

// What is open: completeness gaps, audio findings, artwork that needs a look.
export function openItems({gaps, findings, artwork}){
  return [...gaps.map(g => `${g.group}: ${g.text}`), ...findings.map(f => `${f.group}: ${f.text}`),
    ...artwork.filter(a => a.verdict !== "ok").map(a => `${a.title}: ${VERDICT_WORDS[a.verdict]}`)];
}

// In the markup of the customer page's checklist (.checklist li.ok / li.bad).
export function renderStaffStatus(items){
  if(!items.length) return `<li class="ok"><span class="mark">✓</span>nothing open</li>`;
  return items.map(text => `<li class="bad"><span class="mark">!</span>${escapeHtml(text)}</li>`).join("");
}

// The order's production lines, read-only (states: lineState results).
export function renderLineStatus(states){
  const now = s => s.done ? "✓" : s.waiting ? "waiting" : s.checking ? "not checked" : s.step + (s.why ? ` — ${s.why}` : "");
  return `<h3>Production</h3>` + listTable(["Line", "Now"], states.filter(s => s.needed).map(s => [escapeHtml(s.line), escapeHtml(now(s))]));
}
```

- [ ] **Step 4: Run all JS tests** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/staff-info.js tests/staff-info.test.js
git commit -m "staff info: the order view's bar, status list and production lines (pure)"
```

---

### Task 8: `staff.js` and `staff.css`

**Files:**
- Create: `src/staff.js`, `src/staff.css`

**Interfaces:**
- Consumes: everything above; `/api/job?job=`, `POST /api/check/audio` `{job, rescan, files}`, `POST /api/check/artwork` `{job, rescan, artwork}` (both stream, see `src/plant/app.js` `showJob`), `/jobs/<job>/<preview>`.
- Produces: the page behaviour at `/order/<job>`. Not unit-tested (DOM glue); the by-hand check is Task 9.

- [ ] **Step 1: Write `src/staff.css`:**

```css
/* The staff's order view (src/staff.js): the customer page, read-only, with
   the plant's bar on top. Tokens are the customer page's. */
.staffbar{ font-size:12px; color:var(--ink-dim); margin:0 0 12px; }
.staffbar b{ color:var(--ink); }
.staffbar a{ color:inherit; }
#staffTask{ margin-left:8px; font-family:var(--mono); }
#staffTask.err{ color:var(--danger); font-weight:700; }
/* Nothing is attached here, so the page's own checklist and its actions don't apply. */
body.staff .actions, body.staff #sendPanel, body.staff #checklist{ display:none; }
/* Locked fields stay readable. */
body.staff .sheet input:disabled, body.staff .sheet select:disabled, body.staff .sheet textarea:disabled{
  opacity:1; color:var(--ink); cursor:default;
}
```

- [ ] **Step 2: Write `src/staff.js`:**

```js
// The staff's order view: the customer page (served at /order/<job> by
// plant/server.py) filled from the job folder, locked, with the plant's own
// checks where the browser's checks run for the customer, and what only the
// plant knows. It shows; it changes nothing.
import { CONFIG } from "./config.js";
import { prepareProject } from "./lib/project.js";
import { projectGaps } from "./lib/completeness.js";
import { sideAudio, audioFindings } from "./lib/audio-checks.js";
import { artworkSlots, artworkRows, artworkVerdict } from "./lib/artwork-checks.js";
import { getFormat } from "./lib/format-catalogue.js";
import { lineState } from "./lib/lines.js";
import { jobFiles } from "./lib/versions.js";
import { staffJob } from "./lib/staff-mode.js";
import { readStream } from "./lib/stream.js";
import { VERDICT, renderUnmanaged, renderHistory } from "./lib/plant-overview.js";
import { renderStaffBar, renderStaffStatus, openItems, renderLineStatus } from "./lib/staff-info.js";
import { applyProject, showAudioChecks } from "./modules/tracklist.js";
import { showLabelChecks } from "./modules/labels.js";
import { showPartChecks } from "./modules/printed-parts.js";

const job = staffJob();
const query = encodeURIComponent(job);

async function getJson(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path, body){
  const res = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res;
}

// What the page is doing, in the bar; an error stays there in red.
function task(text, error = false){
  const el = document.getElementById("staffTask");
  if(!el) return;
  el.textContent = text;
  el.classList.toggle("err", error);
}

// Every control but the folding stays off — also the ones the page makes later.
function lock(){
  for(const el of document.querySelectorAll(".sheet input, .sheet select, .sheet textarea, .sheet button")) el.disabled = true;
}

async function start(){
  document.body.classList.add("staff");
  const sheet = document.querySelector(".sheet");
  const data = await getJson(`/api/job?job=${query}`);
  sheet.insertAdjacentHTML("afterbegin", renderStaffBar(job, data.stage));
  const project = prepareProject(data.project, CONFIG);
  await applyProject(project, new Map());
  document.getElementById("stamp").textContent = job;

  // The page's own status list counts every file as missing (none is
  // attached): the plant's list takes its place.
  const status = document.getElementById("checklist");
  status.closest("section").querySelector("h2").textContent = "Status — plant checks";
  status.insertAdjacentHTML("afterend", '<ul class="checklist" id="staffChecklist"></ul>');
  const first = status.closest("section");
  first.insertAdjacentHTML("beforebegin", '<details class="panel" open><summary>Plant</summary><div id="staffPanel"></div></details>');
  lock();
  new MutationObserver(lock).observe(sheet, {childList: true, subtree: true});

  const files = jobFiles(project, data.files);
  const gaps = projectGaps(project, CONFIG, data.files);
  const printCheck = getFormat(CONFIG, project.format).printCheck;
  const checkable = artworkSlots(project, CONFIG);
  const audioNames = ["A", "B"].flatMap(side => sideAudio(project.sides[side], side).map(f => f.name));
  const draw = (artworkFacts, findings, artwork) => {
    const states = Object.keys(CONFIG.lines).map(name => lineState(project, CONFIG, name, artworkFacts));
    document.getElementById("staffPanel").innerHTML = renderLineStatus(states) + renderHistory(project) + renderUnmanaged(files);
    document.getElementById("staffChecklist").innerHTML = renderStaffStatus(openItems({gaps, findings, artwork}));
  };
  draw(null, [], []);

  try{
    const step = what => msg => task(`checking ${what}  ${msg.file || ""} ${msg.index || ""}/${msg.count || ""}`);
    task("checking audio");
    const audio = await readStream(await post("/api/check/audio", {job, rescan: false, files: audioNames}), step("audio"));
    showAudioChecks(audio);
    const findings = audioFindings(project, audio, CONFIG);
    draw(null, findings, []);

    task("checking artwork");
    const facts = await readStream(await post("/api/check/artwork",
      {job, rescan: false, artwork: Object.fromEntries(checkable.map(c => [c.name, c.params]))}), step("artwork"));
    const hits = new Map(), artwork = [];
    for(const c of checkable){
      const one = facts[c.name] || {error: "not checked"};
      const rows = artworkRows(one, c.params, printCheck);
      const verdict = artworkVerdict(rows);
      hits.set(c.name, {rows, preview: one.preview ? `/jobs/${query}/${encodeURIComponent(one.preview)}` : null, status: VERDICT[verdict]});
      artwork.push({title: c.title, verdict});
    }
    showLabelChecks(hits);
    showPartChecks(hits);
    draw(facts, findings, artwork);
    task("");
  }catch(error){
    task(`couldn't check: ${error.message}`, true);
  }
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

// The customer page's own init runs first (its listener is registered first).
document.addEventListener("DOMContentLoaded", () => {
  start().catch(error => {
    document.querySelector(".sheet").insertAdjacentHTML("afterbegin",
      `<nav class="staffbar"><a href="/">← orderbook</a> · <span class="err">${esc(job)} can't be shown: ${esc(error.message)}</span></nav>`);
  });
});
```

(The failure handler builds its bar by hand because `start` failed before the real one was made; `job` comes from the address, so it goes through `esc` too.)

- [ ] **Step 3: Check the module graph loads** — `node --check src/staff.js` and, to catch a wrong import name early: `node -e "import('./src/lib/staff-info.js').then(()=>console.log('ok'))"`. Then `node --test tests/` — Expected: all pass (staff.js itself isn't imported by a test).

- [ ] **Step 4: Commit**

```bash
git add src/staff.js src/staff.css
git commit -m "staff order view: the customer page from the job folder, locked, with the plant's checks and status"
```

---

### Task 9: Docs, the live check, the look in the browser

**Files:**
- Modify: `CLAUDE.md` (Architecture: the plant view bullet), `docs/superpowers/specs/2026-10-08-backend-structure-design.md` (§3)

- [ ] **Step 1: `CLAUDE.md`.** In the dashboard sentence, after "the settings pages, the status line, statistics);" add: `a card opens the order view: the customer page at \`/order/<job>\` (\`src/staff.js\`, \`staff.css\`, served by \`plant/server.py\`), filled by \`applyProject\`, locked, with the plant's artwork and audio checks in place of the browser's and the plant's status list; it shows and changes nothing.`

- [ ] **Step 2: Spec §3.** Replace the section with the built scope: info only (no move, no fixing, no god mode yet), data from `/api/job`, `applyProject` split off `loadProject`, names only for files (no bytes), backend checks replace the browser's (`showChecks` per slot, `showAudioChecks`), the plant panel (production lines, history, files outside the order), the page's own checklist hidden for the plant's list, the board cards open it, the old job page stays reachable ("files & fixes") until its parts have moved. List what comes later: god mode (the history diff helper `projectDiff`), the price section (part 4: the quote needs the plating choice, which the order doesn't carry yet), fixes in the order view.

- [ ] **Step 3: Full run** — `node --test tests/`, `node build/build.js`, `uv run --project plant python -m unittest discover plant` — Expected: all green.

- [ ] **Step 4: Live check on a second port** (the user's server on :8765 keeps its code; do not touch it): start `plant/server.py --port 8766 --jobs <scratch folder>` with one job in `10_ORDERS/10_PREPRESS/` (a `project.json` with a catalogue number and a title); `curl -s http://127.0.0.1:8766/order/<job>` returns the page with `/src/staff.js`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8766/src/staff.js` and `/src/staff.css` are 200; `curl -s http://127.0.0.1:8766/api/job?job=<job>` carries `project`, `stage`, `files`. Stop the server (TaskStop).

- [ ] **Step 5: By hand (ask the user first):** open a card from the board on :8765 (restart it for the new Python): the page is the customer form, filled and locked, folding still works; a job with artwork shows the plant's checklist and preview in each slot, audio lines show duration/format; the bar shows stage and links; the "Plant" panel shows production lines, history; "Status — plant checks" lists what is open. Also repeat Task 4 step 6 on `dist/index.html`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-10-08-backend-structure-design.md docs/superpowers/plans/2026-10-09-staff-order-view-plan.md
git commit -m "docs: the staff order view"
```

---

## Self-review

- **Spec coverage (§3, as revised by the user):** served at `/order/<job>` → Task 3; data from `/api/job`, loader split into parse/apply with one apply path → Tasks 4, 8; lock → Task 8 (`disabled` instead of `inert`, because `inert` would also stop the panels folding); backend checks in place of the browser's → Tasks 5, 6, 8; "show everything we have, more than the customer sees" → Tasks 7, 8 (stage, production lines, history, unmanaged files, plant status); no move/fix logic → none of it is in `staff.js`; the old job page stays linked until its parts move; god mode and the diff helper are deferred; the price section is deferred (the quote's `plating` input is not in the order data).
- **Placeholders:** none; every step has its code or its exact edit.
- **Type consistency:** `readStream` (T1) used in T8; `orderUrl/staffJob/reselectNote/storedFileText` (T2) used in T3 (`dashboard`), T4, T8; `applyProject` (T4) and `data-stored` (T4) read by `showAudioChecks` (T6) and `showChecks` hits keyed by stored name (T5, T8); `VERDICT` exported (T5) used in T8; `renderStaffBar/openItems/renderStaffStatus/renderLineStatus` (T7) used in T8.
