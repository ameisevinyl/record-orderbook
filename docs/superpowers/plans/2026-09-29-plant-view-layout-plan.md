# Plant View Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the plant view as plain HTML5 — a jobs tree and section links on the left, the job in five table sections on the right, one CLI status line on top — with every fact shown once.

**Architecture:** The page stays a set of pure string renderers (`src/lib/plant-overview.js` for the job's sections, `src/lib/plant-board.js` for nav, overview and inbox) assembled by `src/plant/app.js`. The server keeps doing disk work; it gains step reporting (file, n/total, step) in the audio and artwork check streams and the spectrum's progress in the change poll. One structure-only stylesheet replaces the `<style>` block.

**Tech Stack:** Plain ES modules (no build), `node --test`; Python 3 stdlib server + `unittest` via `uv run --project plant`.

**Spec:** `docs/superpowers/specs/2026-09-29-plant-view-layout-design.md`

## Global Constraints

- Plain HTML5 elements only: `header`, `nav`, `main`, `section`, `h1`–`h3`, `table`, `ul`, `pre`, `button`, `select`, `a`, `img`.
- Every labelled field is a table row: label in `<th scope="row">`, value in `<td>`; lists are tables with `<th scope="col">` header cells.
- A catalogue number appears once in the nav and once in a job's view (Basic); a file name once in a job's view (its slot's row); the job folder name is not shown in the job view.
- `src/plant/index.html`: no `<style>`, no `style=` attributes; `style=` only in renderer output for waveform marker positions and the artwork preview's aspect ratio.
- `src/plant/structure.css`: no `font`, `margin`, `padding`, `animation`; colours only as HTML named colours (black, white, gray) and only in picture overlay rules; no hex or rgb values.
- Grouping stages (a stage with sub-stages, e.g. `10_ORDERS`) hold no jobs: not offered as move target, refused by `jobs.move`.
- Status line: one `<pre id="status">`, spinner `| / - \` stepped every 150 ms by script, no CSS animation, no images; "idle" when nothing runs.
- No new dependencies. Run `node --test tests/` and `uv run --project plant python -m unittest discover plant` before every commit.
- Commit messages: short, imperative, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A job put by hand into `10_ORDERS`: the nav doesn't list it (grouping stage), so the overview must link it or it's unreachable — Task 5's `renderHome` test pins the link.
- A section link clicked while that job's checks still run: must scroll only, not start a second load (Task 6 `route(false)` path) — manual step in Task 6.
- An artwork or audio file dropped by hand with no slot in its section (e.g. a WAV on a job without tracks): "Not assigned" with no slot to choose must not render a broken select — Task 4 test.
- A job whose name holds characters like `&`, `<`, `#`: nav links, section links and `data-` attributes must escape/encode — Task 5 test uses such a name.
- The spectrum finishing between two polls: the status line must fall back to "idle", not keep the last "plotting spectrum" text — Task 6 poll sets `background` from every answer.

---

### Task 1: Grouping stages hold no jobs

**Files:**
- Modify: `plant/jobs.py` (add `grouping`, `places`; change `move`)
- Modify: `plant/server.py` (`get_job` returns `places`)
- Test: `plant/test_jobs.py`, `plant/test_server.py`

**Interfaces:**
- Produces: `jobs.grouping(root) -> set[str]`, `jobs.places(root) -> list[str]` (stage paths a job may sit in, sorted); `/api/job` field `stages` is now `places`.

- [ ] **Step 1: Write the failing tests** — append to class `JobsTest` in `plant/test_jobs.py`:

```python
    def test_a_grouping_stage_takes_no_jobs(self):
        self.assertEqual(jobs.grouping(self.root), {"10_ORDERS"})
        self.assertEqual(jobs.places(self.root), ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS",
                                                  "20_DONE", "99_ARCHIVE"])
        self.job("10_ORDERS/10_PREPRESS", "j")
        with self.assertRaisesRegex(JobError, "only groups"):
            jobs.move(self.root, "j", "10_ORDERS")
        self.job("10_ORDERS", "k")  # put there by hand: still found, so it can be moved out
        self.assertEqual(jobs.find(self.root, "k")[0], "10_ORDERS")
        jobs.move(self.root, "k", "10_ORDERS/20_PRESS")
```

And in `plant/test_server.py`, class `HttpTest`, in `test_upload_accept_move_and_board` after the `status, job = self.get("/api/job?job=p")` line add:

```python
        self.assertNotIn("10_ORDERS", job["stages"])
```

- [ ] **Step 2: Run to verify they fail**

Run: `uv run --project plant python -m unittest plant.test_jobs plant.test_server 2>&1 | tail -5` (from the repo root; if module paths fail, `cd plant && uv run --project . python -m unittest test_jobs test_server`)
Expected: FAIL — `AttributeError: module 'jobs' has no attribute 'grouping'`

- [ ] **Step 3: Implement** — in `plant/jobs.py` after `def stages(root)`:

```python
def grouping(root):
    """Stages that only group sub-stages (10_ORDERS): no job belongs in them."""
    all_ = stages(root)
    return {s for s in all_ if any(t.startswith(s + "/") for t in all_)}


def places(root):
    """The stages a job may sit in: all but the grouping ones."""
    group = grouping(root)
    return [s for s in stages(root) if s not in group]
```

Replace the check in `move`:

```python
        if to not in stages(root):
            raise JobError(f"no stage {to}")
```

with:

```python
        if to not in places(root):
            raise JobError(f"{to} only groups its sub-stages" if to in stages(root) else f"no stage {to}")
```

In `plant/server.py` `get_job`, change `"stages": jobs.stages(JOBS)` to `"stages": jobs.places(JOBS)`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd plant && uv run --project . python -m unittest discover . 2>&1 | grep -E "^Ran|^OK|FAILED"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add plant/jobs.py plant/server.py plant/test_jobs.py plant/test_server.py
git commit -m "plant jobs: a stage with sub-stages only groups them, no job moves into it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Checks and spectrum report their steps

**Files:**
- Modify: `plant/checks.py` (`audio`, `check_artwork` take `step`)
- Modify: `plant/spectrum.py` (`PROGRESS`, `job` records it)
- Modify: `plant/server.py` (`stream` helper; audio lines carry step; artwork streamed; stamp returns spectrum)
- Test: `plant/test_checks.py`, `plant/test_spectrum.py`, `plant/test_server.py`

**Interfaces:**
- Produces:
  - `checks.audio(project_dir, out_dir, progress=…, rescan=False, step=lambda file, index, count, what: None)`; steps `"checking audio"`, `"creating waveform"`; `index` 1-based.
  - `checks.check_artwork(project_dir, out_dir, params_by_name, rescan=False, step=…)`; step `"checking artwork"`.
  - `spectrum.PROGRESS: dict[Path, {"file", "index", "count"}]` while plotting.
  - `/api/check/audio` NDJSON lines `{"file", "index", "count", "step", "progress"}`, then `{"result"}`/`{"error"}`.
  - `/api/check/artwork` NDJSON lines `{"file", "index", "count", "step"}`, then `{"result"}`/`{"error"}`.
  - `/api/job/stamp` → `{"stamp": str, "spectrum": {"file", "index", "count"} | null}`.

- [ ] **Step 1: Write the failing tests**

In `plant/test_checks.py`, class `AudioProgressTest`, add:

```python
    def test_steps_name_each_file(self):
        from checks import audio
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "p"
            project.mkdir()
            for name in ("A.wav", "B.wav"):
                ffmpeg("-f", "lavfi", "-i", "sine=d=1", "-c:a", "pcm_s16le", str(project / name))
            steps = []
            audio(project, Path(tmp), step=lambda *a: steps.append(a))
        self.assertEqual(steps, [("A.wav", 1, 2, "checking audio"), ("A.wav", 1, 2, "creating waveform"),
                                 ("B.wav", 2, 2, "checking audio"), ("B.wav", 2, 2, "creating waveform")])
```

In class `CacheTest` add:

```python
    def test_artwork_steps_name_each_file(self):
        steps = []
        self.checks.check_artwork(self.job, self.out, {"L.pdf": {"page": 1}}, step=lambda *a: steps.append(a))
        self.assertEqual(steps, [("L.pdf", 1, 1, "checking artwork")])
```

In `plant/test_spectrum.py`, class `SpectrumTest`, add:

```python
    def test_job_reports_the_file_it_plots(self):
        for name in ("A1.wav", "A2.wav"):
            tone(self.dir / name, 1)
        seen = []
        saved = spectrum.render
        spectrum.render = lambda path, out: seen.append(dict(spectrum.PROGRESS[self.dir]))
        try:
            spectrum.job(self.dir)
        finally:
            spectrum.render = saved
        self.assertEqual(seen, [{"file": "A1.wav", "index": 1, "count": 2}, {"file": "A2.wav", "index": 2, "count": 2}])
        self.assertNotIn(self.dir, spectrum.PROGRESS)
```

In `plant/test_server.py`, class `HttpTest`:
- in `test_upload_accept_move_and_board` replace `self.assertEqual(self.get("/api/job/stamp?job=p")[1], {"stamp": job["stamp"]})` with
  `self.assertEqual(self.get("/api/job/stamp?job=p")[1], {"stamp": job["stamp"], "spectrum": None})`
- in `test_artwork_check_body_must_be_a_json_object` replace the last line with:

```python
        status, data = self.request("POST", "/api/check/artwork", b'{"job": "p"}', JSON)
        self.assertEqual((status, [json.loads(line) for line in data.decode().splitlines()]), (200, [{"result": {}}]))
```

- in `test_audio_check_streams_progress_then_the_result` after `self.assertEqual(progress[-1], 100)` add:

```python
        self.assertEqual({line["step"] for line in lines[:-1]}, {"checking audio", "creating waveform"})
        self.assertTrue(all(line["file"] == "A1.wav" and line["count"] == 1 for line in lines[:-1]))
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd plant && uv run --project . python -m unittest discover . 2>&1 | grep -E "^(FAIL|ERROR):|^Ran|FAILED"`
Expected: FAIL/ERROR in the five tests above (`unexpected keyword argument 'step'`, `no attribute 'PROGRESS'`, stamp/stream mismatches).

- [ ] **Step 3: Implement `plant/checks.py`**

Change `audio`'s signature and loop:

```python
def audio(project_dir, out_dir, progress=lambda fraction: None, rescan=False,
          step=lambda file, index, count, what: None):
    """Facts for every audio file under project_dir, keyed by its name
    relative to it; previews go to out_dir. progress(fraction) follows
    the bytes read, across all files; step(file, index, count, what)
    names each file and what is done with it."""
```

and replace `for path in paths:` … up to `files[name] = facts` with:

```python
    for index, path in enumerate(paths, 1):
        name = path.relative_to(project_dir).as_posix()
        step(name, index, len(paths), "checking audio")
        facts = cache.get(path, name)
        if facts is not None:
            read(path.stat().st_size)
        else:
            digest = sha256(path)
            facts = probe_facts(path)
            if "error" not in facts:
                step(name, index, len(paths), "creating waveform")
                try:
                    facts["preview"], facts["waveform"] = render_previews(path, out_dir, preview_base(name, digest), read)
                except subprocess.CalledProcessError as error:
                    facts["previewError"] = error.stderr.decode(errors="replace").strip() or "ffmpeg failed"
            cache.put(path, name, None, facts, digest)
        files[name] = facts
```

Change `check_artwork`:

```python
def check_artwork(project_dir, out_dir, params_by_name, rescan=False,
                  step=lambda file, index, count, what: None):
    """Facts per artwork file the page asked for, with its part's params;
    step(file, index, count, what) names each file as it starts."""
    cache = Cache(out_dir, "artwork", rescan)
    result = {}
    for index, (name, params) in enumerate(params_by_name.items(), 1):
        step(name, index, len(params_by_name), "checking artwork")
```

(the rest of the loop body unchanged).

- [ ] **Step 4: Implement `plant/spectrum.py`**

Above `def job(folder)` add:

```python
# Job folder → {"file", "index", "count"} while its spectrograms are
# plotted; the page's change poll shows it (/api/job/stamp).
PROGRESS = {}
```

Replace the render loop in `job`:

```python
    for png, path in wanted.items():
        if not png.exists() or png.stat().st_mtime < max(path.stat().st_mtime, code):
            try:
                render(path, png)
            except (ValueError, OSError) as error:
                print(f"spectrum {path.name}: {error}", file=sys.stderr)
```

with:

```python
    todo = [(png, path) for png, path in wanted.items()
            if not png.exists() or png.stat().st_mtime < max(path.stat().st_mtime, code)]
    try:
        for index, (png, path) in enumerate(todo, 1):
            PROGRESS[folder] = {"file": path.name, "index": index, "count": len(todo)}
            try:
                render(path, png)
            except (ValueError, OSError) as error:
                print(f"spectrum {path.name}: {error}", file=sys.stderr)
    finally:
        PROGRESS.pop(folder, None)
```

- [ ] **Step 5: Implement `plant/server.py`**

Add to class `Handler` (before `check_audio`):

```python
    def stream(self):
        """Starts an NDJSON reply; returns line(obj), which sends one line."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()  # no length: HTTP/1.0 ends the body by closing

        def line(obj):
            self.wfile.write((json.dumps(obj) + "\n").encode())
            self.wfile.flush()
        return line
```

Replace `check_audio` with:

```python
    def check_audio(self):
        """Streams one JSON object per line: {"file", "index", "count",
        "step", "progress"} while the files are read, then {"result":
        facts} (or {"error": …})."""
        import checks  # needs the libraries main() verified
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        out = folder / ".checks"
        out.mkdir(exist_ok=True)
        line = self.stream()
        shown, state = -1, {}

        def step(file, index, count, what):
            state.update(file=file, index=index, count=count, step=what)
            line({**state, "progress": max(shown, 0)})

        def progress(fraction):
            nonlocal shown
            if int(fraction * 100) != shown:
                shown = int(fraction * 100)
                line({**state, "progress": shown})
        try:
            line({"result": checks.audio(folder, out, progress, bool(r.get("rescan")), step)})
        except OSError as error:
            line({"error": f"couldn't check audio: {error}"})
```

Replace `check_artwork` with:

```python
    def check_artwork(self):
        """Streams {"file", "index", "count", "step"} as each file starts,
        then {"result": facts} (or {"error": …})."""
        import checks  # needs the libraries main() verified
        r = self.body()
        if not isinstance(r.get("artwork", {}), dict):
            raise JobError("artwork must be an object")
        folder = jobs.find(JOBS, r["job"])[1]
        out = folder / ".checks"
        out.mkdir(exist_ok=True)
        line = self.stream()

        def step(file, index, count, what):
            line({"file": file, "index": index, "count": count, "step": what})
        try:
            line({"result": checks.check_artwork(folder, out, r.get("artwork", {}), bool(r.get("rescan")), step)})
        except OSError as error:
            line({"error": f"couldn't check artwork: {error}"})
```

Replace `get_stamp` with:

```python
    def get_stamp(self):
        """Changes when any file of the job does; also what the background
        spectrum is plotting. The open page polls it."""
        import spectrum  # needs the libraries main() verified
        folder = jobs.find(JOBS, self.query("job"))[1]
        self.json({"stamp": jobs.stamp(folder), "spectrum": spectrum.PROGRESS.get(folder)})
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd plant && uv run --project . python -m unittest discover . 2>&1 | grep -E "^(FAIL|ERROR):|^Ran|^OK|FAILED"`
Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add plant/checks.py plant/spectrum.py plant/server.py plant/test_checks.py plant/test_spectrum.py plant/test_server.py
git commit -m "plant: checks stream file and step, artwork check streamed, stamp reports spectrum progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: jobFiles knows each slot's section

**Files:**
- Modify: `src/lib/versions.js` (`jobFiles`)
- Test: `tests/versions.test.js`

**Interfaces:**
- Produces: `jobFiles(project, files)` → `{slots: [{path, title, name, index, section: "artwork"|"audio", present, modified: string|null, others: [{name, newer}]}], unassigned: {artwork: string[], audio: string[]}}`. `index` is the slot's position in `slots` (the page's `view.slots[index]`). `files`: `[{name, size, modified}]` from `/api/job`.

- [ ] **Step 1: Write the failing test** — in `tests/versions.test.js`, change the existing `jobFiles` test's last assertion from `assert.deepEqual(unassigned, ["cover_final.pdf"]);` to `assert.deepEqual(unassigned, {artwork: ["cover_final.pdf"], audio: []});`, and add:

```js
test("jobFiles: section, index and modification time per slot; unassigned split by kind", () => {
  const files = [{name: "X_A1_song_v1.wav", modified: "2026-09-29T10:00:00Z"}, {name: "X_labels_A_v2.pdf", modified: "t2"},
    {name: "stray.aif"}, {name: "stray.tif"}];
  const {slots, unassigned} = jobFiles(project("X_labels_A_v2.pdf"), files);
  assert.deepEqual(slots.map(s => [s.title, s.index, s.section, s.modified]),
    [["A1", 0, "audio", "2026-09-29T10:00:00Z"], ["Label A", 1, "artwork", "t2"]]);
  assert.deepEqual(unassigned, {artwork: ["stray.tif"], audio: ["stray.aif"]});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/versions.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 2`

- [ ] **Step 3: Implement** — in `src/lib/versions.js` above `jobFiles`:

```js
// Same list as AUDIO_EXT in plant/checks.py: files no slot knows go to
// the Audio section by it, all others to Artwork.
const AUDIO_EXT = [".wav", ".wave", ".bwf", ".aif", ".aiff", ".aifc", ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus"];
```

Replace `jobFiles` with:

```js
// Per filled slot: its section (tracks and side files → audio, printed
// parts → artwork), its position, other versions in the folder (newer
// ones marked) and modification time; plus the files no slot knows
// (hand-dropped, sync conflict copies), split by kind.
export function jobFiles(project, files){
  const names = files.map(f => f.name);
  const modified = new Map(files.map(f => [f.name, f.modified || null]));
  const slots = fileSlots(project).filter(slot => slot.name);
  const bases = new Set(slots.map(slot => (versionOf(slot.name) || {}).base).filter(Boolean));
  const referenced = new Set(slots.map(slot => slot.name));
  const loose = names.filter(n => !referenced.has(n) && !TEXT_FILES.includes(n) && !bases.has((versionOf(n) || {}).base));
  const isAudio = name => AUDIO_EXT.includes(fileExt(name).toLowerCase());
  return {
    slots: slots.map((slot, index) => {
      const own = versionOf(slot.name);
      const others = own ? names.filter(n => n !== slot.name && (versionOf(n) || {}).base === own.base) : [];
      return {...slot, index, section: slot.path[0] === "sides" ? "audio" : "artwork",
        present: names.includes(slot.name), modified: modified.get(slot.name) ?? null,
        others: others.map(name => ({name, newer: versionOf(name).version > own.version}))
          .sort((a, b) => versionOf(b.name).version - versionOf(a.name).version)};
    }),
    unassigned: {artwork: loose.filter(n => !isAudio(n)), audio: loose.filter(isAudio)}
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/versions.test.js 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/lib/versions.js tests/versions.test.js
git commit -m "versions: jobFiles gives each slot its section, index and time; unassigned split by kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`src/plant/app.js` and `plant-board.js` still read the old shape until Tasks 5–6; the page is broken between commits 3 and 6 — acceptable, nothing ships in between.)

---

### Task 4: The job's five sections

**Files:**
- Rewrite: `src/lib/plant-overview.js`
- Rewrite: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `jobFiles()` shape from Task 3; `artworkSlots(project, config)` → `[{title, name, params, preview}]` (`src/lib/artwork-checks.js`); `sideAudio(side, sideId)` → `[{name, label, length}]`; `projectGaps()` → `[{group, text}]`.
- Produces (all return HTML strings):
  - `SECTIONS: [["basic","Basic"],["artwork","Artwork"],["audio","Audio"],["shipping","Shipping & billing"],["history","History"]]`
  - `escapeHtml(value)`, `stageLabel(stage)`, `gapSection(group) -> "basic"|"artwork"|"audio"|"shipping"`
  - `fieldTable(pairs: [label, html][])`, `listTable(head: string[], rows: html[][])`
  - `renderBasic(project, config, place: {job, stage, stages}, gaps)`
  - `renderArtwork(files, checkable, facts|null, printCheck, base, gaps)`
  - `renderAudio(project, files, facts|null, findings, base, gaps)`
  - `renderShipping(project, gaps)`, `renderHistory(project)`
  - Each section is `<section id="<key>"><h2>Title</h2>…</section>`; buttons keep the ids/classes app.js uses: `#moveTo`, `#move`, `#rescan`, `.use[data-file][data-slot]`, `.slot`, `.audio-file .play .wave .played`, `.art-file .show-overlay .overlay`.

- [ ] **Step 1: Write the failing tests** — replace `tests/plant-overview.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { jobFiles } from "../src/lib/versions.js";
import { artworkSlots } from "../src/lib/artwork-checks.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { escapeHtml, stageLabel, gapSection, renderBasic, renderArtwork, renderAudio, renderShipping, renderHistory }
  from "../src/lib/plant-overview.js";

const project = prepareProject({
  projectVersion: 1, format: "12", catalogue: "PNKRCK007", albumTitle: "<b>Loud</b>", albumArtist: "Band",
  notes: "call first",
  sides: {A: {rpm: "33", tracks: [{title: "One", length: "3:00", fileName: "one_v1.wav"},
    {title: "Two", length: "2:00", fileName: "two_v1.wav"}]}, B: {blank: true}},
  labels: {sides: {A: {fileName: "lab_a_v1.pdf"}, B: {whitelabel: true}}},
  vinylColor: [{color: "black", qty: "300"}],
  shippingBilling: {billing: {recipientName: "Ann", email: "ann@example.com", city: "Berlin"},
    shipping: [{recipientName: "Bob", city: "Hamburg", qtyByColor: {black: "300"}}]},
  history: [{savedAt: "2026-09-24T12:00:00.000Z", by: "plant", note: "qty 300"}]
}, CONFIG);
const fileList = [{name: "one_v1.wav", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "two_v1.wav", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "lab_a_v1.pdf", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "lab_a_v2.pdf", size: 1, modified: "2026-09-25T10:00:00Z"}];
const files = jobFiles(project, fileList);
const printCheck = getFormat(CONFIG, "12").printCheck;
const place = {job: "j1", stage: "10_ORDERS/10_PREPRESS", stages: ["00_INBOX", "10_ORDERS/10_PREPRESS", "20_DONE"]};

function wavFacts(duration, more = {}){
  return {codec: "pcm_s24le", sampleRate: 44100, bitsPerSample: 24, channels: 2, duration,
    software: ["WaveLab 11"], title: "", artist: "", comment: "", markers: [],
    preview: "one.mp3", waveform: "one.png", ...more};
}

function whole(facts = null){
  const checkable = artworkSlots(project, CONFIG);
  return renderBasic(project, CONFIG, place, [])
    + renderArtwork(files, checkable, null, printCheck, "/jobs/j1/", [])
    + renderAudio(project, files, facts, [], "/jobs/j1/", [])
    + renderShipping(project, []) + renderHistory(project);
}

// How often text shows on the page: tags and attributes don't count.
const count = (html, text) => html.replace(/<[^>]*>/g, " ").split(text).length - 1;

test("five sections in order, each an id'd section with its heading", () => {
  const html = whole();
  const order = ["basic", "artwork", "audio", "shipping", "history"].map(id => html.indexOf(`<section id="${id}">`));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("each fact once: catalogue number, file names", () => {
  const html = whole({files: {"one_v1.wav": wavFacts(180), "two_v1.wav": wavFacts(120)}});
  assert.equal(count(html, "PNKRCK007"), 1);
  for(const name of ["one_v1.wav", "two_v1.wav", "lab_a_v1.pdf", "lab_a_v2.pdf"]) assert.equal(count(html, name), 1, name);
  assert.ok(!html.includes("<dl"), "labels are table rows, not definition lists");
});

test("basic: field rows, quantity total, customer, products, stage controls, last change, notes", () => {
  const html = renderBasic(project, CONFIG, place, [{group: "Quantity", text: "below <min>"}, {group: "Billing", text: "x"}]);
  assert.ok(html.includes('<tr><th scope="row">Catalogue #</th><td>PNKRCK007</td></tr>'));
  assert.ok(html.includes("&lt;b&gt;Loud&lt;/b&gt;"));
  assert.ok(html.includes("300 Black — total 300"));
  assert.ok(html.includes("Ann, ann@example.com"));
  assert.ok(html.includes("labels: A printed, B whitelabel"));
  assert.ok(html.includes('<option value="10_ORDERS/10_PREPRESS" selected>ORDERS › PREPRESS</option>'));
  assert.ok(html.includes('id="move"') && html.includes('id="rescan"') && html.includes('href="/api/zip?job=j1"'));
  assert.ok(html.includes("2026-09-24 12:00 plant"));
  assert.ok(html.includes("<pre>call first</pre>"));
  assert.ok(html.includes("<li>Quantity: below &lt;min&gt;</li>"));
  assert.ok(!html.includes("Billing: x"), "a billing gap belongs to Shipping & billing");
});

test("gaps go to their section by group", () => {
  assert.deepEqual(["Release", "Quantity", "Side A", "Labels", "Inner sleeve", "Cover", "Inlay", "Billing", "Shipping 2"]
    .map(gapSection), ["basic", "basic", "audio", "artwork", "artwork", "artwork", "artwork", "shipping", "shipping"]);
});

test("artwork: a row per slot with file, versions and use, verdict while checking", () => {
  const html = renderArtwork(files, artworkSlots(project, CONFIG), null, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes('<th scope="col">Slot</th><th scope="col">File</th><th scope="col">Other versions</th><th scope="col">Verdict</th>'));
  assert.ok(html.includes("lab_a_v1.pdf (2026-09-24 10:00)"));
  assert.ok(html.includes('lab_a_v2.pdf (newer) <button type="button" class="use" data-file="lab_a_v2.pdf" data-slot="2">use</button>'));
  assert.ok(html.includes("<td>checking</td>"));
});

test("artwork: after the check, verdict and a preview block per checked slot", () => {
  const checkable = [{title: "Label A", name: "lab_a_v1.pdf", params: {targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100},
    bleedMm: 3, round: true, page: 1, inkLimitPct: 220, holeMm: 7.4}}];
  const facts = {"lab_a_v1.pdf": {kind: "pdf", parsed: {pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: null}, pageMm: {w: 106, h: 106}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: 330, overPct: 10}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: "lab <a>.png", overlay: "lab <a>.overlay.png"}};
  const html = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes("<td>review</td>"));
  assert.ok(html.includes('<div class="art-file"><h3>Label A</h3>'));
  assert.ok(html.includes('src="/jobs/j1/lab%20%3Ca%3E.png"'));
  assert.ok(html.includes('<circle class="trim" cx="53" cy="53" r="50"'));
  assert.ok(html.includes("max 330 %"));
});

test("not assigned: a select of the section's slots, or none when it has no slots", () => {
  const loose = {slots: files.slots, unassigned: {artwork: ["stray.tif"], audio: []}};
  const html = renderArtwork(loose, [], null, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes('<option value="2">Label A</option>'));
  const none = renderArtwork({slots: [], unassigned: {artwork: ["stray.tif"], audio: []}}, [], null, printCheck, "/w/", []);
  assert.ok(none.includes("stray.tif") && none.includes("no slot to use it for") && !none.includes("<select"));
});

test("audio: side table, track table with files and spectrum links, a block per file", () => {
  const facts = {files: {"one_v1.wav": wavFacts(180, {title: "<One>"}), "two_v1.wav": {error: "Invalid data"}}};
  const html = renderAudio(project, files, facts, [{group: "Side A", text: "one is short"}], "/jobs/j1/", []);
  assert.ok(html.includes('<tr><th scope="row">RPM</th><td>33</td></tr>'));
  assert.ok(html.includes('<tr><th scope="row">Total</th><td>5:02</td></tr>'));
  assert.ok(html.includes("<li>Side A: one is short</li>"));
  assert.ok(html.includes('<a href="/jobs/j1/spectrum/one_v1.wav.png" target="_blank">spectrum</a>'));
  assert.ok(!html.includes("spectrum/two_v1.wav.png"), "no spectrum for a file that can't be read");
  assert.ok(html.includes('<div class="audio-file"><h3>A1</h3>'));
  assert.ok(html.includes("pcm_s24le, 44.1 kHz, 24 bit, 2 ch"));
  assert.ok(html.includes("&lt;One&gt;"));
  assert.ok(html.includes('data-src="/jobs/j1/one.mp3" data-duration="180"'));
  assert.ok(html.includes("<h3>Side B</h3><p>Blank</p>"));
});

test("audio: while checking, no file blocks yet; continuous side lists its side file", () => {
  const side = prepareProject({format: "12", sides: {A: {rpm: "33", continuous: true, continuousFileName: "side_v1.wav",
    tracks: [{title: "One", length: "1:00"}, {title: "Two", length: "1:00"}]}, B: {blank: true}}}, CONFIG);
  const sideFiles = jobFiles(side, [{name: "side_v1.wav", modified: "t"}]);
  let html = renderAudio(side, sideFiles, null, [], "/w/", []);
  assert.ok(!html.includes("audio-file"));
  assert.ok(html.includes('<th scope="row">Side file</th><td>side_v1.wav (t)'));
  html = renderAudio(side, sideFiles, {files: {"side_v1.wav": wavFacts(200, {markers: [{seconds: 50, label: "Two"}]})}}, [], "/w/", []);
  assert.ok(html.includes('class="mark file" style="left:25.000%"'));
  assert.ok(html.includes('class="mark form" style="left:30.000%" title="1:00 A2"'));
});

test("shipping & billing: billing without name and email (they're in Basic), shipping with quantities", () => {
  const html = renderShipping(project, [{group: "Shipping 1", text: "postal code missing"}]);
  assert.ok(html.includes("<li>Shipping 1: postal code missing</li>"));
  assert.ok(html.includes('<tr><th scope="row">city</th><td>Berlin</td></tr>'));
  assert.ok(!html.includes("Ann") && !html.includes("ann@example.com"));
  assert.ok(html.includes("<h3>Shipping 1</h3>") && html.includes("Bob") && html.includes("300 Black"));
});

test("history: a table, oldest first", () => {
  assert.ok(renderHistory(project).includes('<tr><td>2026-09-24 12:00</td><td>plant</td><td>qty 300</td></tr>'));
});

test("helpers", () => {
  assert.equal(stageLabel("10_ORDERS/20_PRESS"), "ORDERS › PRESS");
  assert.equal(escapeHtml(`a&"'`), "a&amp;&quot;&#39;");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/plant-overview.test.js 2>&1 | grep -E "^ℹ (pass|fail)|SyntaxError"`
Expected: FAIL — `does not provide an export named 'gapSection'`

- [ ] **Step 3: Implement** — replace `src/lib/plant-overview.js` with:

```js
// The plant view's job page in five sections — Basic, Artwork, Audio,
// Shipping & billing, History — as plain HTML tables, each fact once:
// a file shows in its slot's row only, the catalogue number in Basic
// only. Pure: the page (src/plant/app.js) assigns the strings to
// innerHTML, so every value goes through escapeHtml here.

import { formatTime, parseTime } from "./time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { parseQuantity } from "./shipping.js";
import { sideTiming, ADDRESS_FIELD_LABELS } from "./completeness.js";
import { sideAudio } from "./audio-checks.js";
import { artworkRows, artworkVerdict } from "./artwork-checks.js";
import { CHECKLIST_ICON } from "./print-artwork.js";

export const SECTIONS = [["basic", "Basic"], ["artwork", "Artwork"], ["audio", "Audio"],
  ["shipping", "Shipping & billing"], ["history", "History"]];

export function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
}

// "10_ORDERS/20_PRESS" → "ORDERS › PRESS"
export function stageLabel(stage){
  return stage.split("/").map(part => part.replace(/^\d\d_/, "")).join(" › ");
}

// "2026-09-24T12:00:00.000Z" → "2026-09-24 12:00" (UTC, as stored)
const when = iso => escapeHtml((iso || "").slice(0, 16).replace("T", " "));

function section(id, body){
  const [, title] = SECTIONS.find(([key]) => key === id);
  return `<section id="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

// pairs: [label, html]; html arrives escaped, empty values drop.
export function fieldTable(pairs){
  return `<table>${pairs.filter(([, html]) => html !== "")
    .map(([label, html]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${html}</td></tr>`).join("")}</table>`;
}

// head: column labels; rows: arrays of html cells.
export function listTable(head, rows){
  return `<table><tr>${head.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr>`
    + rows.map(cells => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") + `</table>`;
}

// The section a completeness gap (projectGaps) belongs to, by its group.
export function gapSection(group){
  if(group === "Release" || group === "Quantity") return "basic";
  if(group.startsWith("Side ")) return "audio";
  if(group === "Billing" || group.startsWith("Shipping")) return "shipping";
  return "artwork";
}

function listHtml(items){
  return items.length ? `<ul>${items.map(f => `<li>${escapeHtml(f.group)}: ${escapeHtml(f.text)}</li>`).join("")}</ul>` : "";
}

const gapsHtml = (gaps, id) => listHtml(gaps.filter(g => gapSection(g.group) === id));

// A slot's file: its name and time, or "missing" when not in the folder.
function fileCell(slot){
  if(!slot) return "";
  return escapeHtml(slot.name) + (slot.present ? ` (${when(slot.modified)})` : " — missing");
}

// A slot's other versions, each with "use" (newer ones marked).
function versionsCell(slot){
  if(!slot) return "";
  return slot.others.map(o => `${escapeHtml(o.name)}${o.newer ? " (newer)" : ""} `
    + `<button type="button" class="use" data-file="${escapeHtml(o.name)}" data-slot="${slot.index}">use</button>`).join("<br>");
}

// Files no slot knows, each with a select of the section's slots.
function unassignedHtml(names, slots){
  if(!names.length) return "";
  const options = slots.map(s => `<option value="${s.index}">${escapeHtml(s.title)}</option>`).join("");
  return `<h3>Not assigned</h3>` + listTable(["File", "Use for"], names.map(name => [escapeHtml(name), options
    ? `<select class="slot">${options}</select> <button type="button" class="use" data-file="${escapeHtml(name)}">use</button>`
    : "no slot to use it for"]));
}

// --- 1 Basic ---------------------------------------------------------

// place: {job, stage, stages} — the job's folder name, its stage and the
// stages it may move to.
export function renderBasic(project, config, place, gaps){
  const format = getFormat(config, project.format);
  const parts = format.printableParts || {};
  const productName = (category, id) => {
    const product = productById((parts[category] && parts[category].products) || [], id);
    return product ? product.name : "";
  };
  const {labels, coverSleeve: sleeve} = project;
  const products = [
    ["labels", ["A", "B"].map(s => `${s} ${labels.sides[s].whitelabel ? "whitelabel" : "printed"}`).join(", ")
      + (labels.bigCenter ? ", big hole" : "")],
    ["inner sleeve", productName("innerSleeve", sleeve.innerSleeve.productId)],
    ["cover", productName("outerCover", sleeve.cover.productId)],
    ["inlay", productName("inlay", sleeve.inlay.productId)]
  ].filter(([, name]) => name).map(([what, name]) => `${what}: ${escapeHtml(name)}`).join("<br>");
  const qty = project.vinylColor.filter(row => row.qty.trim());
  const total = qty.reduce((sum, row) => sum + (parseQuantity(row.qty) || 0), 0);
  const billing = project.shippingBilling.billing;
  const options = place.stages.map(s =>
    `<option value="${escapeHtml(s)}"${s === place.stage ? " selected" : ""}>${escapeHtml(stageLabel(s))}</option>`).join("");
  const last = project.history.at(-1);
  return section("basic", fieldTable([
    ["Catalogue #", escapeHtml(project.catalogue)],
    ["Title", escapeHtml(project.albumTitle)],
    ["Artist", escapeHtml(project.albumArtist)],
    ["Format", escapeHtml(format.label)],
    ["Quantity", qty.length ? qty.map(row => `${escapeHtml(row.qty)} ${escapeHtml(colorLabel(row.color))}`).join(", ")
      + ` — total ${total}` : ""],
    ["Customer", escapeHtml([billing.recipientName, billing.email].filter(v => v && v.trim()).join(", "))],
    ["Products", products],
    ["Stage", `${escapeHtml(stageLabel(place.stage))} <select id="moveTo">${options}</select> `
      + `<button type="button" id="move">Move</button> <button type="button" id="rescan">Rescan</button> `
      + `<a href="/api/zip?job=${encodeURIComponent(place.job)}" download>Download zip</a>`],
    // Date and who only: the note is in History.
    ["Last change", last ? `${when(last.savedAt)} ${escapeHtml(last.by)}` : ""],
    ["Notes", project.notes.trim() ? `<pre>${escapeHtml(project.notes)}</pre>` : ""]
  ]) + gapsHtml(gaps, "basic"));
}

// --- 2 Artwork -------------------------------------------------------

const VERDICT = {ok: "OK", review: "review", customer: "needs customer"};

// Trim and a label's center hole (dashed) and bleed (dotted) in page
// millimetres; the SVG stretches over the preview, so the lines sit
// where the cut and the punch will be. Each line lies on a white line
// of the same width, so it reads on dark and light designs alike.
function cutLinesSvg(page, trim, bleedMm, round, holeMm){
  const n = v => Math.round(v * 100) / 100;
  const cx = n(trim.x + trim.w / 2), cy = n(trim.y + trim.h / 2);
  const shape = grow => round
    ? `cx="${cx}" cy="${cy}" r="${n(trim.w / 2 + grow)}"`
    : `x="${n(trim.x - grow)}" y="${n(trim.y - grow)}" width="${n(trim.w + 2 * grow)}" height="${n(trim.h + 2 * grow)}"`;
  const tag = round ? "circle" : "rect";
  const line = (cls, el, attrs) => `<${el} class="under" ${attrs}/><${el} class="${cls}" ${attrs}/>`;
  return `<svg viewBox="0 0 ${n(page.w)} ${n(page.h)}" preserveAspectRatio="none">`
    + line("trim", tag, shape(0)) + line("bleed", tag, shape(bleedMm))
    + (holeMm ? line("hole", "circle", `cx="${cx}" cy="${cy}" r="${n(holeMm / 2)}"`) : "")
    + `</svg>`;
}

// A checked file: preview with cut lines and switchable problem areas,
// then the checklist.
function artFileHtml({title, params}, facts, printCheck, base){
  let body = `<h3>${escapeHtml(title)}</h3>`;
  if(facts.preview){
    const url = file => escapeHtml(base + encodeURIComponent(file));
    body += `<label><input type="checkbox" class="show-overlay"> problem areas</label>`
      + `<div class="art" style="aspect-ratio:${facts.pageMm.w} / ${facts.pageMm.h}">`
      + `<img src="${url(facts.preview)}" alt=""><img class="overlay" hidden src="${url(facts.overlay)}" alt="">`
      + cutLinesSvg(facts.pageMm, facts.trimRectMm, params.bleedMm, params.round, params.holeMm) + `</div>`;
  }
  const rows = artworkRows(facts, params, printCheck);
  return `<div class="art-file">${body}` + listTable(["", "Check", "Found", "Expected"], rows.map(r =>
    [CHECKLIST_ICON[r.severity], escapeHtml(r.feature), escapeHtml(r.detected), escapeHtml(r.expected || "")])) + `</div>`;
}

// files: jobFiles(); checkable: artworkSlots() (printed parts with their
// check params); facts: the artwork check's result, or null while it
// runs. base: URL folder of the job's check output.
export function renderArtwork(files, checkable, facts, printCheck, base, gaps){
  const slots = files.slots.filter(s => s.section === "artwork");
  const params = new Map(checkable.map(c => [c.name, c.params]));
  const verdict = slot => !params.has(slot.name) ? "" : !facts ? "checking"
    : VERDICT[artworkVerdict(artworkRows(facts[slot.name] || {error: "not checked"}, params.get(slot.name), printCheck))];
  const page = slot => params.has(slot.name) && params.get(slot.name).page > 1 ? `, page ${params.get(slot.name).page}` : "";
  let body = gapsHtml(gaps, "artwork");
  if(slots.length) body += listTable(["Slot", "File", "Other versions", "Verdict"],
    slots.map(s => [escapeHtml(s.title) + page(s), fileCell(s), versionsCell(s), verdict(s)]));
  if(facts) body += checkable.map(c => artFileHtml(c, facts[c.name] || {error: "not checked"}, printCheck, base)).join("");
  body += unassignedHtml(files.unassigned.artwork, slots);
  return section("artwork", body || "<p>No artwork.</p>");
}

// --- 3 Audio ---------------------------------------------------------

// A line at `seconds` on a waveform `duration` long; kind "file" for
// the file's own markers, "form" for the tracklist's track starts.
function markHtml(seconds, duration, label, kind){
  const left = Math.min(100, seconds / duration * 100).toFixed(3);
  return `<i class="mark ${kind}" style="left:${left}%" title="${escapeHtml(formatTime(seconds))} ${escapeHtml(label)}">`
    + `<span>${escapeHtml(label)}</span></i>`;
}

// Where the form puts each track after the first on a continuous side:
// the sum of the lengths before it. No gaps — on a continuous side the
// pauses are part of the file. Stops at the first empty length.
function formTrackStarts(side, sideId){
  const starts = [];
  let at = 0;
  for(const [i, track] of side.tracks.entries()){
    if(i) starts.push([at, `${sideId}${i + 1}`]);
    const length = parseTime(track.length);
    if(length === null) break;
    at += length;
  }
  return starts;
}

// A checked audio file: its facts, play button and waveform.
function audioFileHtml(file, label, formStarts, base){
  if(!file) return "";
  let body = `<h3>${escapeHtml(label)}</h3>`;
  if(file.error) return `<div class="audio-file">${body}<p>${escapeHtml(file.error)}</p></div>`;
  const khz = file.sampleRate ? `${file.sampleRate / 1000} kHz` : "";
  body += fieldTable([
    ["Format", escapeHtml([file.codec, khz, file.bitsPerSample && `${file.bitsPerSample} bit`,
      file.channels && `${file.channels} ch`].filter(Boolean).join(", "))],
    ["Duration", escapeHtml(formatTime(file.duration))],
    ["Software", escapeHtml(file.software.join(" · "))],
    ["Title tag", escapeHtml(file.title)],
    ["Artist tag", escapeHtml(file.artist)],
    ["Comment tag", escapeHtml(file.comment)]
  ]);
  if(file.preview && file.duration > 0){
    const marks = file.markers.map(m => markHtml(m.seconds, file.duration, m.label, "file"))
      .concat(formStarts.map(([seconds, pos]) => markHtml(seconds, file.duration, pos, "form")));
    body += `<p><button type="button" class="play">play</button></p>`
      + `<div class="wave" data-src="${escapeHtml(base + encodeURIComponent(file.preview))}" data-duration="${file.duration}">`
      + `<img src="${escapeHtml(base + encodeURIComponent(file.waveform))}" alt=""><div class="played"></div>${marks.join("")}</div>`;
  }
  return `<div class="audio-file">${body}</div>`;
}

// files: jobFiles(); facts: the audio check's result, or null while it
// runs; findings: audioFindings(). base: URL folder of the job's check
// output; its spectrum/ holds the spectrograms (plant/spectrum.py).
export function renderAudio(project, files, facts, findings, base, gaps){
  const bySlot = new Map(files.slots.map(s => [s.name, s]));
  const slots = files.slots.filter(s => s.section === "audio");
  const spectrum = name => name && facts && facts.files[name] && !facts.files[name].error
    ? `<a href="${escapeHtml(base + "spectrum/" + encodeURIComponent(name + ".png"))}" target="_blank">spectrum</a>` : "";
  const sideFile = name => name ? [fileCell(bySlot.get(name)), versionsCell(bySlot.get(name)), spectrum(name)]
    .filter(Boolean).join(" ") : "";
  let body = gapsHtml(gaps, "audio") + listHtml(findings);
  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    body += `<h3>Side ${sideId}</h3>`;
    if(side.blank){
      body += "<p>Blank</p>";
      continue;
    }
    body += fieldTable([
      ["RPM", escapeHtml(side.rpm)],
      ["Matrix", escapeHtml(side.matrixInscription)],
      ["Total", `${formatTime(sideTiming(side).seconds)}${project.soundsystem ? ", soundsystem cut" : ""}`],
      ["Side file", side.continuous ? sideFile(side.continuousFileName) : ""],
      ["Tracklist file", side.continuous ? sideFile(side.tracklistFileName) : ""]
    ]);
    const head = ["Pos", "Title", "Artist", "Length"].concat(side.continuous ? [] : ["Gap", "File", "Other versions", "Spectrum"]);
    body += listTable(head, side.tracks.map((track, i) => {
      const cells = [`${sideId}${i + 1}`, escapeHtml(track.title), escapeHtml(track.artist), escapeHtml(track.length)];
      if(side.continuous) return cells;
      const gap = i === 0 ? "" : track.gap === "custom" ? `${track.gapCustom}s` : `${track.gap}s`;
      const slot = bySlot.get(track.fileName);
      return cells.concat([escapeHtml(gap), fileCell(slot), versionsCell(slot), spectrum(track.fileName)]);
    }));
    if(facts){
      const formStarts = side.continuous ? formTrackStarts(side, sideId) : [];
      body += sideAudio(side, sideId).map(({name, label}) => audioFileHtml(facts.files[name], label, formStarts, base)).join("");
    }
  }
  body += unassignedHtml(files.unassigned.audio, slots);
  return section("audio", body);
}

// --- 4 Shipping & billing --------------------------------------------

const ADDRESS_FIELDS = ["recipientName", "attention", "addressLine1", "addressLine2", "addressLine3",
  "postalCode", "city", "stateProvince", "countryCode", "email", "phone", "vat", "eori"];

const addressRows = (address, skip = []) => ADDRESS_FIELDS.filter(f => !skip.includes(f))
  .map(f => [ADDRESS_FIELD_LABELS[f], escapeHtml(address[f])]);

// Billing name and email are Basic's "Customer" row, so not here again.
export function renderShipping(project, gaps){
  const {billing, shipping} = project.shippingBilling;
  return section("shipping", gapsHtml(gaps, "shipping")
    + `<h3>Billing</h3>` + fieldTable(addressRows(billing, ["recipientName", "email"]))
    + shipping.map((address, i) => `<h3>Shipping ${i + 1}</h3>` + fieldTable(addressRows(address).concat([
      ["quantities", escapeHtml(Object.entries(address.qtyByColor).filter(([, q]) => q.trim())
        .map(([color, q]) => `${q} ${colorLabel(color)}`).join(", "))],
      ["residential", address.isResidential ? "yes" : ""],
      ["note", escapeHtml(address.note)]
    ]))).join(""));
}

// --- 5 History -------------------------------------------------------

export function renderHistory(project){
  return section("history", project.history.length
    ? listTable(["Date", "By", "Note"], project.history.map(h => [when(h.savedAt), escapeHtml(h.by), escapeHtml(h.note)]))
    : "<p>No entries.</p>");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/plant-overview.test.js 2>&1 | grep -E "^ℹ (pass|fail)|not ok"`
Expected: `ℹ fail 0`. If the "each fact once" test counts a name twice, find the second place in the output (`console.log(html)`) and remove it there, not in the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js tests/plant-overview.test.js
git commit -m "plant view: job in five table sections — Basic, Artwork, Audio, Shipping & billing, History — each fact once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Nav, overview and inbox

**Files:**
- Rewrite: `src/lib/plant-board.js`
- Rewrite: `tests/plant-board.test.js`

**Interfaces:**
- Consumes: `escapeHtml`, `stageLabel`, `SECTIONS`, `listTable` from `src/lib/plant-overview.js` (Task 4); `/api/board` → `{stages: [{stage, jobs: [{job, catalogue, title, artist} | {job, error}]}], inbox: string[], problems: string[]}`.
- Produces: `renderNav(board, openJob: string|null)`, `renderHome(board)`, `renderInbox(item, info, plans)` — HTML strings. `renderBoard`, `renderJobBar`, `renderFiles`, `stageLabel` (moved) are removed from this module.

- [ ] **Step 1: Write the failing tests** — replace `tests/plant-board.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNav, renderHome, renderInbox } from "../src/lib/plant-board.js";

const board = {stages: [
  {stage: "00_INBOX", jobs: [{job: "j1", catalogue: "X<1>", title: "T", artist: "A"}]},
  {stage: "10_ORDERS", jobs: [{job: "lost & #1", catalogue: "L", title: "", artist: ""}]},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [{job: "bad", error: "not valid JSON"}]},
  {stage: "10_ORDERS/20_PRESS", jobs: []},
  {stage: "20_DONE", jobs: []}
], inbox: ["new.zip", "Download"], problems: ["j is in more than one stage"]};

test("nav: stages nested under their grouping stage, counts, each job once, inbox items", () => {
  const html = renderNav(board, null);
  assert.ok(html.startsWith("<h2>Jobs</h2>"));
  assert.ok(html.includes("<li>ORDERS<ul><li>PREPRESS (1)"), "grouping stage is a heading, no count, no jobs");
  assert.ok(!html.includes("lost"), "a job put into a grouping stage isn't listed in the nav");
  assert.ok(html.includes("<li>INBOX (3)"));
  assert.ok(html.includes('<a href="#/inbox/new.zip">new.zip</a> (new zip)'));
  assert.ok(html.includes('<a href="#/inbox/Download">Download</a> (new folder)'));
  assert.equal(html.split("X&lt;1&gt;").length - 1, 1);
  assert.ok(html.includes('<a href="#/job/bad">bad (unreadable)</a>'));
  assert.ok(html.includes("<li>DONE (0)</li>"));
  assert.ok(!html.includes("Sections"));
});

test("nav: the open job is marked and its section links follow", () => {
  const html = renderNav(board, "j1");
  assert.ok(html.includes('<a href="#/job/j1" aria-current="page"><b>X&lt;1&gt; — T</b></a>'));
  assert.ok(html.includes('<h2>Sections</h2><ul><li><a href="#/job/j1/basic">Basic</a></li>'));
  assert.ok(html.includes('<a href="#/job/j1/shipping">Shipping &amp; billing</a>'));
});

test("home: problems, jobs in a grouping stage linked, the inbox count", () => {
  const html = renderHome(board);
  assert.ok(html.includes("<li>j is in more than one stage</li>"));
  assert.ok(html.includes('<a href="#/job/lost%20%26%20%231">lost &amp; #1</a> is in 10_ORDERS — move it to one of its sub-stages'));
  assert.ok(html.includes("2 new in the inbox."));
  assert.ok(!html.includes("X&lt;1&gt;"), "catalogue numbers are in the nav only");
  assert.ok(renderHome({stages: [], inbox: [], problems: []}).includes("Nothing needs attention."));
});

test("inbox: the item as a table row, a merge per matching job, then accept", () => {
  const html = renderInbox("r.zip", {job: "j2", project: {catalogue: "X", albumTitle: "T", albumArtist: "A"}, files: [{}, {}]},
    [{job: "j1", stage: "20_DONE", changed: ["Label A → X_labels_A_v3.pdf"]}]);
  assert.ok(html.includes("<tr><td>r.zip</td><td>X</td><td>T</td><td>A</td><td>2</td></tr>"));
  assert.ok(html.includes("<h2>Resend of j1 (DONE)</h2>"));
  assert.ok(html.includes("Label A → X_labels_A_v3.pdf"));
  assert.ok(html.includes('class="merge" data-job="j1"'));
  assert.ok(html.includes('id="accept"'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/plant-board.test.js 2>&1 | grep -E "^ℹ (pass|fail)|SyntaxError"`
Expected: FAIL — `does not provide an export named 'renderNav'`

- [ ] **Step 3: Implement** — replace `src/lib/plant-board.js` with:

```js
// Plant view HTML around the jobs: the nav (the jobs tree — the
// overview — and the open job's section links), the overview's main
// (what needs attention) and a zip or folder in the inbox. Pure, like
// plant-overview.js: every value is escaped here.

import { escapeHtml, stageLabel, SECTIONS, listTable } from "./plant-overview.js";

const jobLink = job => `#/job/${encodeURIComponent(job)}`;

// A stage's own name: "10_ORDERS/20_PRESS" → "PRESS".
const ownName = stage => stage.split("/").at(-1).replace(/^\d\d_/, "");

// Stages that only group sub-stages (10_ORDERS); no job belongs in them.
const groupingStages = stages => stages.filter(s => stages.some(t => t.stage.startsWith(s.stage + "/")));

// board: /api/board; openJob: the job shown, or null. Sub-stages nest
// under their grouping stage, which lists no jobs of its own (one put
// there by hand is on the overview's list, linked).
export function renderNav({stages, inbox}, openJob){
  const grouping = new Set(groupingStages(stages).map(s => s.stage));
  const jobItem = job => {
    const text = job.error ? `${escapeHtml(job.job)} (unreadable)`
      : escapeHtml([job.catalogue || job.job, job.title].filter(Boolean).join(" — "));
    return job.job === openJob
      ? `<li><a href="${jobLink(job.job)}" aria-current="page"><b>${text}</b></a></li>`
      : `<li><a href="${jobLink(job.job)}">${text}</a></li>`;
  };
  const stageItem = ({stage, jobs}) => {
    if(grouping.has(stage)){
      return `<li>${escapeHtml(ownName(stage))}<ul>`
        + stages.filter(s => s.stage.startsWith(stage + "/")).map(stageItem).join("") + `</ul></li>`;
    }
    const received = stage === "00_INBOX" ? inbox.map(item => `<li><a href="#/inbox/${encodeURIComponent(item)}">`
      + `${escapeHtml(item)}</a> (new ${/\.zip$/i.test(item) ? "zip" : "folder"})</li>`) : [];
    const items = received.concat(jobs.map(jobItem));
    return `<li>${escapeHtml(ownName(stage))} (${items.length})${items.length ? `<ul>${items.join("")}</ul>` : ""}</li>`;
  };
  let html = `<h2>Jobs</h2><ul>${stages.filter(s => !s.stage.includes("/")).map(stageItem).join("")}</ul>`;
  if(openJob){
    html += `<h2>Sections</h2><ul>` + SECTIONS.map(([id, title]) =>
      `<li><a href="${jobLink(openJob)}/${id}">${escapeHtml(title)}</a></li>`).join("") + `</ul>`;
  }
  return html;
}

// The overview's main: what needs attention — problems the server found,
// jobs put by hand into a grouping stage (linked: the nav doesn't list
// them), and how many items wait in the inbox. The jobs are in the nav.
export function renderHome({stages, inbox, problems}){
  const items = problems.map(p => `<li>${escapeHtml(p)}</li>`).concat(groupingStages(stages).flatMap(({stage, jobs}) =>
    jobs.map(job => `<li><a href="${jobLink(job.job)}">${escapeHtml(job.job)}</a> is in ${escapeHtml(stage)}`
      + ` — move it to one of its sub-stages</li>`)));
  return `<h2>Attention</h2>` + (items.length ? `<ul>${items.join("")}</ul>` : "<p>Nothing needs attention.</p>")
    + `<p>${inbox.length} new in the inbox.</p>`;
}

// A zip or folder in the inbox: what it holds, and per job with the same
// catalogue number what a merge would copy in (mergeResend's plan).
export function renderInbox(item, info, plans){
  const p = info.project;
  let html = `<h2>Received</h2>` + listTable(["Item", "Catalogue #", "Title", "Artist", "Files"],
    [[escapeHtml(item), escapeHtml(p.catalogue), escapeHtml(p.albumTitle), escapeHtml(p.albumArtist), String(info.files.length)]]);
  html += plans.map(({job, stage, changed}) => `<h2>Resend of ${escapeHtml(job)} (${escapeHtml(stageLabel(stage))})</h2>`
    + (changed.length ? `<ul>${changed.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
      : "<p>No file changes; form fields are taken over.</p>")
    + `<p><button type="button" class="merge" data-job="${escapeHtml(job)}">Merge</button></p>`).join("");
  return html + `<h2>New job ${escapeHtml(info.job)}</h2><p><button type="button" id="accept">Accept as new job</button></p>`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/plant-board.test.js 2>&1 | grep -E "^ℹ (pass|fail)|not ok"`
Expected: `ℹ fail 0`

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-board.js tests/plant-board.test.js
git commit -m "plant view: nav is the jobs tree and the job's sections; overview lists what needs attention

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Page skeleton, structure stylesheet, CLI status line

**Files:**
- Rewrite: `src/plant/index.html`
- Create: `src/plant/structure.css`
- Rewrite: `src/plant/app.js`
- Create: `tests/plant-page.test.js`

**Interfaces:**
- Consumes: Tasks 2–5 (stream lines, stamp's `spectrum`, `jobFiles`, renderers).
- Produces: routes `#/`, `#/inbox/<item>`, `#/job/<job>[/<section>]`; `<nav id="nav">`, `<main id="out">`, `<pre id="status">`.

- [ ] **Step 1: Write the failing test** — create `tests/plant-page.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/plant/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/plant/structure.css", import.meta.url), "utf8");

test("page: plain HTML5 skeleton, no inline style", () => {
  assert.ok(!/<style/i.test(html) && !/\sstyle=/i.test(html));
  assert.ok(html.includes('<link rel="stylesheet" href="/src/plant/structure.css">'));
  for(const part of ["<header>", '<pre id="status">idle</pre>', '<nav id="nav">', '<main id="out">']) assert.ok(html.includes(part), part);
});

test("structure.css: structure only — no fonts, spacing, animation, hex or rgb colours", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\b(font|margin|padding|animation)[\w-]*\s*:/i.test(rules));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(rules));
  assert.ok(/grid-template-columns/.test(rules));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/plant-page.test.js 2>&1 | grep -E "^ℹ (pass|fail)|ENOENT"`
Expected: FAIL — `ENOENT … structure.css`

- [ ] **Step 3: Write `src/plant/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Plant view</title>
<link rel="stylesheet" href="/src/plant/structure.css">
</head>
<body>
<header>
  <h1><a href="#/">Plant view</a></h1>
  <button type="button" id="btnLoad">Load project zip</button>
  <button type="button" id="btnLoadFolder">Load project folder</button>
  <input type="file" id="zipInput" accept=".zip,application/zip" hidden>
  <input type="file" id="folderInput" webkitdirectory hidden>
  <pre id="status">idle</pre>
  <p id="error"></p>
</header>
<nav id="nav"></nav>
<main id="out"></main>
<script type="module" src="/src/plant/app.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write `src/plant/structure.css`**

```css
/* Structure only: the two columns, and how the pictures stack. No
   fonts, spacing or colours of the page's own — a plant's theme or a
   CSS reset goes on top of this later. Lines on the pictures use HTML's
   named colours. */

body{ display:grid; grid-template-columns:max-content 1fr; }
header{ grid-column:1 / -1; }

/* Waveform: the played part and the markers lie on the picture. */
.wave{ position:relative; }
.wave img{ display:block; width:100%; }
.played{ position:absolute; top:0; bottom:0; left:0; width:0; background:gray; opacity:.3; pointer-events:none; }
.mark{ position:absolute; top:0; bottom:0; border-left:1px solid black; pointer-events:none; }
.mark span{ position:absolute; left:2px; top:0; white-space:nowrap; }
.mark.form{ border-left-style:dashed; }
.mark.form span{ top:auto; bottom:0; }

/* Artwork: the problem-area overlay and the cut lines lie on the preview. */
.art{ position:relative; max-width:420px; }
.art img{ display:block; width:100%; height:100%; }
.art img[hidden]{ display:none; }
.art .overlay, .art svg{ position:absolute; top:0; left:0; width:100%; height:100%; }
.art svg *{ fill:none; stroke-width:1.5; vector-effect:non-scaling-stroke; }
.art .under{ stroke:white; }
.art .trim, .art .hole{ stroke:black; stroke-dasharray:5 4; }
.art .bleed{ stroke:black; stroke-dasharray:1.5 3; }
```

- [ ] **Step 5: Write `src/plant/app.js`**

```js
// Plant view page: a two-column page — the jobs tree and the open job's
// section links in <nav>, the chosen view in <main> — under one CLI
// status line. Views: the overview (what needs attention), a zip or
// folder in the inbox (new job or resend), a job in five sections. A job
// is checked on every load (the server re-reads only changed files, the
// rules here always run), then its spectrograms are made in the
// background.
import { CONFIG } from "../config.js";
import { prepareProject, setAt, historyEntry } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { audioFindings } from "../lib/audio-checks.js";
import { artworkSlots } from "../lib/artwork-checks.js";
import { getFormat } from "../lib/format-catalogue.js";
import { jobFiles, assignedName, mergeResend } from "../lib/versions.js";
import { renderBasic, renderArtwork, renderAudio, renderShipping, renderHistory } from "../lib/plant-overview.js";
import { renderNav, renderHome, renderInbox } from "../lib/plant-board.js";

const zipInput = document.getElementById("zipInput");
const folderInput = document.getElementById("folderInput");
const nav = document.getElementById("nav");
const out = document.getElementById("out");
const error = document.getElementById("error");
const status = document.getElementById("status");

// Loads can take a while; only the most recent view may render.
let latest = 0;
// What the shown view's buttons act on.
let view = null;
// Rescan: the next job load checks every file by its content.
let rescan = false;

// body: JSON to post, or {raw, headers} for an upload.
async function api(path, body){
  const res = await fetch(path, body === undefined ? {} : body.raw ? {method: "POST", ...body, body: body.raw}
    : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res;
}
const getJson = async path => (await api(path)).json();
const postJson = async (path, body) => (await api(path, body)).json();

// --- Status line: what the page does, else what the server does in the
// background (spectrograms), else "idle"; a CLI spinner while anything
// runs. Text only.
const SPINNER = "|/-\\";
let task = "", background = "", spin = 0, spinner = null;

function show(){
  const text = task || background;
  if(text && !spinner) spinner = setInterval(show, 150);
  if(!text && spinner){
    clearInterval(spinner);
    spinner = null;
  }
  status.textContent = text ? `${text}  ${SPINNER[spin++ % SPINNER.length]}` : "idle";
}

function busy(text){
  task = text;
  show();
}

// One step of a check: "checking audio     A1.wav  2/3  47 %".
function stepText({step, file, index, count, progress}){
  return `${step.padEnd(18)}${file}  ${index}/${count}` + (progress === undefined ? "" : `  ${progress} %`);
}

// A check streams one JSON object per line: its steps, then
// {"result": …} or {"error": …}.
async function readStream(res, onStep){
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

// --- Routes: #/ · #/inbox/<item> · #/job/<job>[/<section>]

function parseHash(){
  const [, kind, name, section] = /^#\/(job|inbox)\/([^/]+)(?:\/(\w+))?$/.exec(location.hash) || [];
  return {kind, name: name && decodeURIComponent(name), section};
}

function scrollToSection(section){
  const target = section && document.getElementById(section);
  if(target) target.scrollIntoView();
}

// reload false: a link click — a section link of the job already shown
// only scrolls, it doesn't load and check the job again.
async function route(reload = true){
  const {kind, name, section} = parseHash();
  if(!reload && kind === "job" && view && view.job === name){
    scrollToSection(section);
    return;
  }
  const id = ++latest;
  out.innerHTML = "";
  view = null;
  background = "";
  resetPlayer();
  error.textContent = "";
  try{
    busy("reading the jobs");
    const board = await getJson("/api/board");
    if(id !== latest) return;
    nav.innerHTML = renderNav(board, kind === "job" ? name : null);
    if(kind === "job") await showJob(name, section, id);
    else if(kind === "inbox") await showInbox(name, id);
    else out.innerHTML = renderHome(board);
  }catch(err){
    if(id === latest) error.textContent = err.message;
  }finally{
    if(id === latest) busy("");
  }
}

async function showInbox(item, id){
  busy(`reading ${item}`);
  const info = await getJson(`/api/inbox?item=${encodeURIComponent(item)}`);
  if(id !== latest) return;
  const plans = info.matches.map(m => ({job: m.job, stage: m.stage, basedOn: m.projectHash,
    ...mergeResend(m.project, m.files, info.project, info.files)}));
  view = {item, plans};
  out.innerHTML = renderInbox(item, info, plans);
}

async function showJob(job, section, id){
  busy(`opening ${job}`);
  const data = await getJson(`/api/job?job=${encodeURIComponent(job)}`);
  if(id !== latest) return;
  const project = prepareProject(data.project, CONFIG);
  const files = jobFiles(project, data.files);
  const gaps = projectGaps(project, CONFIG, data.files);
  const checkable = artworkSlots(project, CONFIG);
  const printCheck = getFormat(CONFIG, project.format).printCheck;
  // The job's check output and spectrum/ folder, served by the server.
  const base = `/jobs/${encodeURIComponent(job)}/`;
  view = {job, raw: data.project, hash: data.projectHash, stamp: data.stamp,
    names: data.files.map(f => f.name), slots: files.slots};
  const full = rescan;
  rescan = false;
  out.innerHTML = renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps)
    + renderArtwork(files, checkable, null, printCheck, base, gaps)
    + renderAudio(project, files, null, [], base, gaps)
    + renderShipping(project, gaps)
    + renderHistory(project);
  scrollToSection(section);
  const replace = (sectionId, html) => { document.getElementById(sectionId).outerHTML = html; };
  const onStep = msg => { if(id === latest) busy(stepText(msg)); };
  let what = "check the audio of";
  try{
    busy("checking audio");
    const facts = await readStream(await api("/api/check/audio", {job, rescan: full}), onStep);
    if(id !== latest) return;
    replace("audio", renderAudio(project, files, facts, audioFindings(project, facts, CONFIG), base, gaps));

    what = "check the artwork of";
    busy("checking artwork");
    const artworkFacts = await readStream(await api("/api/check/artwork",
      {job, rescan: full, artwork: Object.fromEntries(checkable.map(s => [s.name, s.params]))}), onStep);
    if(id !== latest) return;
    replace("artwork", renderArtwork(files, checkable, artworkFacts, printCheck, base, gaps));
    // Last: the mastering engineer's spectrograms, in the background; the
    // change poll below shows their progress.
    await postJson("/api/spectrum", {job});
  }catch(err){
    throw new Error(`Couldn't ${what} ${job}: ${err.message}`);
  }
}

// Buttons of the job and inbox views; each ends by reloading from disk.
// A 409 (someone changed the job meanwhile) shows its message; the next
// reload shows their change.
out.addEventListener("click", async e => {
  const button = e.target.closest(".use, #move, #rescan, .merge, #accept");
  if(!button || !view || task) return;
  error.textContent = "";
  if(button.id === "rescan"){
    rescan = true;
    return route();
  }
  try{
    busy("saving");
    if(button.id === "move"){
      await postJson("/api/move", {job: view.job, to: document.getElementById("moveTo").value});
    } else if(button.matches(".use")){
      const slot = view.slots[Number(button.dataset.slot ?? button.parentElement.querySelector(".slot").value)];
      const file = button.dataset.file;
      const newName = assignedName(slot.name, file, view.names);
      const project = structuredClone(view.raw);
      setAt(project, slot.path, newName);
      project.history = [...(project.history || []),
        historyEntry(`${slot.title}: ${newName}${newName === file ? "" : ` (was ${file})`}`, new Date())];
      await postJson("/api/assign", {job: view.job, file, newName, project, basedOn: view.hash});
    } else if(button.matches(".merge")){
      const plan = view.plans.find(p => p.job === button.dataset.job);
      await postJson("/api/merge", {item: view.item, job: plan.job, copies: plan.copies,
        project: plan.project, basedOn: plan.basedOn});
      location.hash = `#/job/${encodeURIComponent(plan.job)}`;
      return;
    } else {
      const {job} = await postJson("/api/accept", {item: view.item});
      location.hash = `#/job/${encodeURIComponent(job)}`;
      return;
    }
    await route();
  }catch(err){
    busy("");
    error.textContent = `Couldn't ${button.textContent.toLowerCase()}: ${err.message}`;
  }
});

// --- Prelisten: one shared <audio>. A preview is fetched once as a blob,
// so seeking works although the server doesn't answer Range requests.
const player = new Audio();
let blobUrls = new Map();
let playing = null; // the .wave the player is loaded with

const playButton = wave => wave.closest(".audio-file").querySelector(".play");

function resetPlayer(){
  player.pause();
  player.removeAttribute("src");
  playing = null;
  blobUrls.forEach(url => URL.revokeObjectURL(url));
  blobUrls = new Map();
}

async function load(wave){
  if(wave === playing) return;
  let url = blobUrls.get(wave.dataset.src);
  if(!url){
    const res = await fetch(wave.dataset.src);
    if(!res.ok) throw new Error(`preview: ${res.status}`);
    url = URL.createObjectURL(await res.blob());
    blobUrls.set(wave.dataset.src, url);
  }
  player.pause();
  // The pause event arrives after the switch, so reset the old button here.
  if(playing) playButton(playing).textContent = "play";
  playing = wave;
  player.src = url;
  // Seek only once the duration is known.
  await new Promise((resolve, reject)=>{
    player.addEventListener("loadedmetadata", resolve, {once: true});
    player.addEventListener("error", ()=> reject(new Error("preview can't be played")), {once: true});
  });
}

// Click on a waveform: seek there and play. Play button: toggle.
out.addEventListener("click", async e => {
  const button = e.target.closest(".play");
  const wave = button ? button.closest(".audio-file").querySelector(".wave") : e.target.closest(".wave");
  if(!wave) return;
  try{
    await load(wave);
    if(!button){
      const rect = wave.getBoundingClientRect();
      player.currentTime = (e.clientX - rect.left) / rect.width * Number(wave.dataset.duration);
      await player.play();
    } else if(player.paused) await player.play();
    else player.pause();
  }catch(err){
    error.textContent = `Couldn't play: ${err.message}`;
  }
});

// "problem areas" checkbox: show or hide that file's overlay.
out.addEventListener("change", e => {
  if(!e.target.matches(".show-overlay")) return;
  e.target.closest(".art-file").querySelector(".overlay").hidden = !e.target.checked;
});

player.addEventListener("timeupdate", ()=>{
  if(playing) playing.querySelector(".played").style.width = `${player.currentTime / Number(playing.dataset.duration) * 100}%`;
});
for(const [event, text] of [["play", "pause"], ["pause", "play"]]){
  player.addEventListener(event, ()=>{ if(playing) playButton(playing).textContent = text; });
}

// --- Load: a zip, or a folder (e.g. one Safari unzipped), goes to the
// inbox like one synced in; the browser uploads a copy, the original stays.
async function upload(label, send){
  error.textContent = "";
  try{
    busy(`uploading ${label}`);
    location.hash = `#/inbox/${encodeURIComponent(await send())}`;
  }catch(err){
    busy("");
    error.textContent = `Couldn't upload ${label}: ${err.message}`;
  }
}

document.getElementById("btnLoad").addEventListener("click", ()=> zipInput.click());
zipInput.addEventListener("change", ()=>{
  const file = zipInput.files[0];
  zipInput.value = "";
  // Header values must be ASCII; the server unquotes them.
  if(file) upload(file.name, async ()=> (await (await api("/api/upload",
    {raw: file, headers: {"X-Filename": encodeURIComponent(file.name)}})).json()).item);
});

document.getElementById("btnLoadFolder").addEventListener("click", ()=> folderInput.click());
folderInput.addEventListener("change", ()=>{
  // Dot names (.DS_Store) are the machine's, not the project's.
  const files = [...folderInput.files].filter(f => !f.webkitRelativePath.split("/").some(part => part.startsWith(".")));
  folderInput.value = "";
  if(!files.length) return;
  const folder = files[0].webkitRelativePath.split("/")[0];
  upload(folder, async ()=>{
    for(const [i, file] of files.entries()){
      busy(`uploading ${folder}  ${i + 1}/${files.length}`);
      await api("/api/upload/file", {raw: file, headers: {"X-Folder": encodeURIComponent(folder),
        "X-Path": encodeURIComponent(file.webkitRelativePath.split("/").slice(1).join("/"))}});
    }
    return (await postJson("/api/upload/done", {folder})).item;
  });
});

// --- While a job is open: any save on disk (a fix over a file, a new
// version, a hand edit of project.json) reloads and re-checks it, and the
// background spectrum's progress goes to the status line.
setInterval(async ()=>{
  if(!view || !view.stamp || task || document.hidden) return;
  try{
    const {stamp, spectrum} = await getJson(`/api/job/stamp?job=${encodeURIComponent(view.job)}`);
    background = spectrum ? stepText({step: "plotting spectrum", ...spectrum}) : "";
    show();
    if(view && view.stamp && stamp !== view.stamp) route();
  }catch{
    // gone or moved: the next click shows why
  }
}, 3000);

window.addEventListener("hashchange", ()=> route(false));
route();
```

- [ ] **Step 6: Run all tests**

Run: `node --test tests/ 2>&1 | grep -E "^ℹ (pass|fail)|not ok"` and `cd plant && uv run --project . python -m unittest discover . 2>&1 | grep -E "^Ran|^OK|FAILED"`
Expected: `ℹ fail 0`; `OK`

- [ ] **Step 7: Syntax check the page script** (it can't run in node: DOM)

Run: `cp src/plant/app.js /tmp/app.mjs && node --check /tmp/app.mjs && echo ok` (use the session scratchpad instead of /tmp if one is given)
Expected: `ok`

- [ ] **Step 8: Manual check in the browser** (ask the user before driving Chrome; otherwise hand these steps to them)

Start: `cd <repo> && uv run --project plant plant/server.py`, open http://127.0.0.1:8765/.
- Overview: nav tree left (ORDERS with PREPRESS/PRESS nested), "Attention" right.
- Open a job: Basic on top; status line walks `checking audio … creating waveform … checking artwork …`, then `plotting spectrum …`, then `idle`.
- Click "Audio" in Sections while checks run: page scrolls, the status line keeps its step (no restart).
- Reload the browser on `#/job/<job>/audio`: loads and lands on Audio.
- Move select has no "ORDERS" entry.

- [ ] **Step 9: Commit**

```bash
git add src/plant/index.html src/plant/structure.css src/plant/app.js tests/plant-page.test.js
git commit -m "plant view: plain HTML5 page — nav and main, structure-only CSS, CLI status line with steps and spectrum progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Docs

**Files:**
- Modify: `CLAUDE.md` (Architecture: plant view bullet)
- Modify: `docs/superpowers/specs/2026-09-29-plant-view-layout-design.md` (Status line)

- [ ] **Step 1: Update `CLAUDE.md`** — in the `plant/server.py` + `src/plant/` bullet, replace the sentence starting "The page renders the board and `project.json` itself" through "not the customer form." with:

```
  The page is plain HTML5 (`src/plant/index.html`, structure-only
  `src/plant/structure.css` — a plant's theme goes on top later): the
  jobs tree and the open job's section links in `<nav>`
  (`src/lib/plant-board.js`), the job in five table sections — Basic,
  Artwork, Audio, Shipping & billing, History — each fact once
  (`src/lib/plant-overview.js`), one CLI status line fed by the checks'
  step streams and the spectrum progress in `/api/job/stamp`. Grouping
  stages (10_ORDERS) hold no jobs. Spec:
  `docs/superpowers/specs/2026-09-29-plant-view-layout-design.md`.
```

- [ ] **Step 2: Mark the spec built** — change its `Status:` line to `Status: approved 2026-09-29, built.`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-09-29-plant-view-layout-design.md
git commit -m "docs: plant view layout in CLAUDE.md, spec built

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
