# Server shell and helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plant server serves the pricelist and plant-config editors and lets them read and write the real files on disk; the staff pages share a small menu; load zip/folder stays in the plant view's menu bar.

**Architecture:** Python reads and writes the two files (`plant/staff_files.py`, same hash-and-409 rule as `project.json`); the pages keep parsing, validating and formatting. A page asks the server for its file on start: if answered it is in *server mode* (Save writes to disk, Open is hidden, menu shown), else it works as before on downloads (the `dist/` files). One menu list (`src/lib/menu.js`) serves the plant view and both sheet pages.

**Tech Stack:** Python 3 stdlib + `unittest`; plain ES modules, `node --test`; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-08-backend-structure-design.md` §1.

## Global Constraints

- No runtime dependencies; `dist/pricelist.html` and `dist/plant-config.html` stay single self-contained files that work offline (opened as files they must behave exactly as today).
- Tests run on `node --test tests/` and `uv run --project plant python -m unittest discover plant`; no linter, no npm installs.
- Python does disk, the page decides: the server only refuses content that is plainly not the file; validation stays in `src/lib/pricelist.js` / `config-validation.js`.
- Writes: temp file + `os.replace` under `jobs.LOCK`, refused with 409 (`Conflict`) when the file changed since the page read it.
- `tests/sheet-pages.test.js` runs `node build/build.js` (writes the gitignored `dist/`) and executes the built pages in a stub DOM; it must pass without `src/pricelist.json` or `src/plant.config.local.js` present.
- Real files `src/pricelist.json` and `src/plant.config.local.js` are gitignored; never commit them, never read them in tests.
- POST endpoints need `Content-Type: application/json` (the existing 415 guard; it keeps other websites from posting).
- Comments short, explain why; commit messages short, imperative, with the attribution line from the session reminder.
- **Spec amendment:** the spec says `GET/PUT`; this plan uses `GET` + `POST /api/staff-file` (one parametrized route, and POST already has the JSON-only guard). Task 6 edits the spec to say so.

## Review Focus

- The pricelist or plant config does not exist yet (fresh checkout): GET answers the committed example with `exists: false`, `hash: ""`; the first save creates the file; a second page holding the stale `""` is refused (409).
- Two browser tabs save the same file: the second gets 409 and its text, the page keeps the user's edits and shows the message (nothing lost, nothing overwritten).
- Garbage posted: unknown `name`, non-string `text`, a pricelist that is not a JSON object, a plant config without `PLANT_CONFIG` → 400 and the file is untouched.
- The page is opened as a file or from GitHub Pages (`/api/staff-file` is 404 or HTML): server mode stays off, Open/Save-as-download behave as today, no menu.
- A file on disk that is not valid UTF-8 (saved as Latin-1 by some editor): GET answers 400 with a message instead of dropping the connection (`UnicodeDecodeError` is a `ValueError`, which `answer()` does not catch).
- A file on disk that does not parse (hand-edited plant config): server mode must not be a dead end, Open and drop stay enabled so a good file can be loaded and saved over it.
- A tmp file left behind after a failed write must not shadow the real file (`.pricelist.json.tmp` is replaced, never read).

---

### Task 1: `plant/staff_files.py`

**Files:**
- Create: `plant/staff_files.py`
- Test: `plant/test_staff_files.py`

**Interfaces:**
- Consumes: `jobs.LOCK`, `jobs.Conflict`, `jobs.JobError`.
- Produces: `read(path, example) -> {"text": str, "hash": str, "exists": bool}`; `write(path, text, based_on) -> str` (new hash; raises `Conflict`, `JobError`); `check(name, text)` (raises `JobError`); `digest(bytes) -> hex str`.

- [ ] **Step 1: Write the failing tests** — `plant/test_staff_files.py`:

```python
import tempfile
import unittest
from pathlib import Path

import staff_files
from jobs import Conflict, JobError


class StaffFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.path = self.dir / "pricelist.json"
        self.example = self.dir / "pricelist.example.json"
        self.example.write_text('{"example": true}')

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_missing_file_gives_the_example_without_a_hash(self):
        self.assertEqual(staff_files.read(self.path, self.example),
                         {"text": '{"example": true}', "hash": "", "exists": False})

    def test_read_refuses_a_file_that_is_not_utf8(self):
        self.path.write_bytes("Preis €".encode("latin-1", "replace") + b"\xe4")
        with self.assertRaises(JobError):
            staff_files.read(self.path, self.example)

    def test_read_existing_file_gives_its_text_and_hash(self):
        self.path.write_text('{"a": 1}')
        got = staff_files.read(self.path, self.example)
        self.assertEqual((got["text"], got["exists"]), ('{"a": 1}', True))
        self.assertEqual(got["hash"], staff_files.digest(b'{"a": 1}'))

    def test_write_creates_a_missing_file_for_an_empty_basis(self):
        new = staff_files.write(self.path, '{"a": 1}', "")
        self.assertEqual(self.path.read_text(), '{"a": 1}')
        self.assertEqual(new, staff_files.digest(b'{"a": 1}'))
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name.endswith(".tmp")], [])

    def test_write_replaces_when_the_basis_is_current(self):
        self.path.write_text("old")
        staff_files.write(self.path, "new", staff_files.digest(b"old"))
        self.assertEqual(self.path.read_text(), "new")

    def test_write_refuses_a_stale_basis_and_keeps_the_file(self):
        self.path.write_text("theirs")
        with self.assertRaises(Conflict):
            staff_files.write(self.path, "mine", staff_files.digest(b"old"))
        self.assertEqual(self.path.read_text(), "theirs")

    def test_write_refuses_an_empty_basis_when_the_file_exists(self):
        self.path.write_text("theirs")
        with self.assertRaises(Conflict):
            staff_files.write(self.path, "mine", "")

    def test_write_refuses_non_text(self):
        with self.assertRaises(JobError):
            staff_files.write(self.path, {"a": 1}, "")

    def test_check_pricelist_must_be_a_json_object(self):
        staff_files.check("pricelist", '{"a": 1}')
        for bad in ("nonsense", "[1]", "3"):
            with self.assertRaises(JobError, msg=bad):
                staff_files.check("pricelist", bad)

    def test_check_plant_config_must_export_the_config(self):
        staff_files.check("plant-config", "export const PLANT_CONFIG = {};\n")
        with self.assertRaises(JobError):
            staff_files.check("plant-config", "const x = 1;")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --project plant python -m unittest discover plant -p "test_staff_files.py"`
Expected: FAIL / ERROR `ModuleNotFoundError: No module named 'staff_files'`.

- [ ] **Step 3: Write `plant/staff_files.py`**

```python
"""The two staff editors' files (src/pricelist.json, src/plant.config.local.js):
read for the page, written back only when unchanged since the page read
them. The page validates the content; this refuses only what is plainly
not the file."""
import hashlib
import json
import os

from jobs import LOCK, Conflict, JobError


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path, example):
    """{text, hash, exists}. Before the plant has the file, the committed
    example with hash "": writing it back then needs the basis "" (the
    file must still not exist)."""
    try:
        data, exists = path.read_bytes(), True
    except FileNotFoundError:
        data, exists = example.read_bytes(), False
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise JobError(f"{(path if exists else example).name} is not UTF-8") from None
    return {"text": text, "hash": digest(data) if exists else "", "exists": exists}


def check(name, text):
    if name == "pricelist":
        try:
            ok = isinstance(json.loads(text), dict)
        except ValueError:
            ok = False
        if not ok:
            raise JobError("pricelist.json must be a JSON object")
    elif "export const PLANT_CONFIG" not in text:
        raise JobError("plant.config.local.js must export PLANT_CONFIG")


def write(path, text, based_on):
    """Replaces the file unless it changed since the reader saw based_on.
    Temp file + rename: never half-written. Returns the new hash."""
    if not isinstance(text, str) or not isinstance(based_on, str):
        raise JobError("text and basedOn must be text")
    data = text.encode("utf-8")
    with LOCK:
        try:
            now = digest(path.read_bytes())
        except FileNotFoundError:
            now = ""
        if now != based_on:
            raise Conflict(f"{path.name} changed meanwhile — reload and try again")
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return digest(data)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --project plant python -m unittest discover plant -p "test_staff_files.py"`
Expected: `OK` (10 tests).

- [ ] **Step 5: Commit**

```bash
git add plant/staff_files.py plant/test_staff_files.py
git commit -m "plant: staff_files — read/write the pricelist and plant config on disk, refused when changed meanwhile"
```

---

### Task 2: `/api/staff-file` in the server

**Files:**
- Modify: `plant/server.py` (imports, a `STAFF_FILES` constant after `INDEX`, `do_GET`/`do_POST` route tables, two handler methods)
- Test: `plant/test_server.py` (inside `HttpTest`)

**Interfaces:**
- Consumes: `staff_files.read/check/write` (Task 1).
- Produces: `GET /api/staff-file?name=<pricelist|plant-config>` → `{text, hash, exists}`; `POST /api/staff-file` body `{name, text, basedOn}` → `{hash}`; 400 unknown name / bad content, 409 stale basis, 415 non-JSON. `server.STAFF_FILES = {name: (path, example_path)}`.

- [ ] **Step 1: Write the failing tests** — in `plant/test_server.py` add `from unittest import mock` to the imports and these two methods to `HttpTest`:

```python
    def staff_files(self, tmp):
        tmp = Path(tmp)
        (tmp / "pricelist.example.json").write_text('{"version": 1}')
        (tmp / "plant.config.local.example.js").write_text("export const PLANT_CONFIG = {};\n")
        return mock.patch.object(server, "STAFF_FILES", {
            "pricelist": (tmp / "pricelist.json", tmp / "pricelist.example.json"),
            "plant-config": (tmp / "plant.config.local.js", tmp / "plant.config.local.example.js")})

    def test_staff_file_read_write_and_conflict(self):
        with tempfile.TemporaryDirectory() as tmp, self.staff_files(tmp):
            self.assertEqual(self.get("/api/staff-file?name=pricelist"),
                             (200, {"text": '{"version": 1}', "hash": "", "exists": False}))
            body = {"name": "pricelist", "text": '{"a": 1}', "basedOn": ""}
            status, saved = self.post("/api/staff-file", body)
            self.assertEqual(status, 200)
            self.assertEqual((Path(tmp) / "pricelist.json").read_text(), '{"a": 1}')
            # A second page still holding the example is stale now.
            self.assertEqual(self.post("/api/staff-file", body)[0], 409)
            self.assertEqual(self.get("/api/staff-file?name=pricelist"),
                             (200, {"text": '{"a": 1}', "hash": saved["hash"], "exists": True}))
            self.assertEqual(self.post("/api/staff-file", {**body, "text": '{"a": 2}', "basedOn": saved["hash"]})[0], 200)
            self.assertEqual(self.post("/api/staff-file", {**body, "text": '{"a": 3}', "basedOn": saved["hash"]})[0], 409)
            self.assertEqual((Path(tmp) / "pricelist.json").read_text(), '{"a": 2}')

    def test_staff_file_refuses_what_is_not_the_file(self):
        with tempfile.TemporaryDirectory() as tmp, self.staff_files(tmp):
            self.assertEqual(self.get("/api/staff-file?name=jobs")[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "../x", "text": "{}", "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "pricelist", "text": "[1]", "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "pricelist", "text": 5, "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "plant-config", "text": "x = 1", "basedOn": ""})[0], 400)
            self.assertEqual(self.request("POST", "/api/staff-file", b"{}")[0], 415)
            self.assertFalse((Path(tmp) / "pricelist.json").exists())
            self.assertFalse((Path(tmp) / "plant.config.local.js").exists())
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run --project plant python -m unittest discover plant -p "test_server.py" -k staff_file`
Expected: FAIL — `AttributeError: ... has no attribute 'STAFF_FILES'`.

- [ ] **Step 3: Implement** in `plant/server.py`:

After `import jobs` add `import staff_files`. After `INDEX = SRC / "plant" / "index.html"` add:

```python
# The staff editors' files: name -> (the plant's own file, the committed example).
STAFF_FILES = {
    "pricelist": (SRC / "pricelist.json", SRC / "pricelist.example.json"),
    "plant-config": (SRC / "plant.config.local.js", SRC / "plant.config.local.example.js"),
}
```

In `do_GET`'s route dict add `"/api/staff-file": self.get_staff_file`; in `do_POST`'s add `"/api/staff-file": self.save_staff_file`. Add next to `save_project`:

```python
    def staff_file(self, name):
        if name not in STAFF_FILES:
            raise JobError(f"no staff file {name!r}")
        return STAFF_FILES[name]

    def get_staff_file(self):
        path, example = self.staff_file(self.query("name"))
        self.json(staff_files.read(path, example))

    def save_staff_file(self):
        """The pricelist or plant config as the editor decided it; refused
        with 409 when the file changed since the page read it."""
        r = self.body()
        path = self.staff_file(r["name"])[0]
        staff_files.check(r["name"], r["text"])
        self.json({"hash": staff_files.write(path, r["text"], r["basedOn"])})
```

(`name` may be a non-string JSON value: `name not in STAFF_FILES` on an unhashable list raises `TypeError`, which `answer()` already maps to 400.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run --project plant python -m unittest discover plant`
Expected: `OK`, whole plant suite green.

- [ ] **Step 5: Commit**

```bash
git add plant/server.py plant/test_server.py
git commit -m "plant server: /api/staff-file reads and writes the pricelist and plant config, 409 when changed meanwhile"
```

---

### Task 3: The menu (`src/lib/menu.js`) and the plant view's menu bar

**Files:**
- Create: `src/lib/menu.js`, `tests/menu.test.js`
- Modify: `src/plant/index.html` (header), `src/plant/app.js` (fill the menu), `src/plant/theme.css` (scope the `nav` rules to `#nav`, style `#menu`)
- Test: `tests/menu.test.js`, `tests/plant-page.test.js` (existing, must stay green)

**Interfaces:**
- Produces: `MENU: [text, href][]`; `menuHtml(current?: string) -> string` (links; the one whose `href === current` carries `aria-current="page"`). Consumed by Task 4 (`sheet.js`) and `src/plant/app.js`.

- [ ] **Step 1: Write the failing test** — `tests/menu.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU, menuHtml } from "../src/lib/menu.js";

test("menu: absolute, unique hrefs; staff pages are served from src/", () => {
  const hrefs = MENU.map(([, href]) => href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(hrefs.every(h => h.startsWith("/")));
  assert.deepEqual(hrefs, ["/", "/src/pricelist.html", "/src/plant-config.html"]);
});

test("menuHtml: one link per entry, only the current one marked", () => {
  const html = menuHtml("/src/pricelist.html");
  assert.equal(html.match(/<a /g).length, MENU.length);
  assert.equal(html.match(/aria-current/g).length, 1);
  assert.ok(html.includes('<a href="/src/pricelist.html" aria-current="page">Pricelist</a>'));
  assert.ok(!menuHtml().includes("aria-current"));
});
```

- [ ] **Step 2: Run** `node --test tests/menu.test.js` — Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/lib/menu.js`**

```js
// The staff app's menu, shared by the plant view and the staff editors.
export const MENU = [
  ["Plant view", "/"],
  ["Pricelist", "/src/pricelist.html"],
  ["Plant config", "/src/plant-config.html"]
];

// current: the href of the page shown, its link is marked.
export function menuHtml(current){
  return MENU.map(([text, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${text}</a>`).join("");
}
```

- [ ] **Step 4: Plant view header.** In `src/plant/index.html` put `<nav id="menu"></nav>` right after the `<h1>` line (inside `<header>`; keep the load buttons, `<pre id="status">idle</pre>`, `<p id="error">` as they are). In `src/plant/app.js` add `import { menuHtml } from "../lib/menu.js";` with the other lib imports and, next to the other `document.getElementById` constants at the top, `document.getElementById("menu").innerHTML = menuHtml("/");`.

In `src/plant/theme.css` the bare `nav`, `nav h2`, `nav h2:first-child`, `nav ul`, `nav li`, `nav a`, `nav a:hover` rules (lines ~43–53) would also hit the menu: change each selector's leading `nav` to `#nav`, and add after them:

```css
/* --- Menu: the staff app's pages, in the header beside the title. --- */
#menu{ display:flex; gap:14px; font-size:12px; }
#menu a{ color:var(--ink-dim); }
#menu a[aria-current]{ color:var(--ink); font-weight:600; text-decoration:none; }
```

- [ ] **Step 5: Run all JS tests** — `node --test tests/` — Expected: all pass (`tests/plant-page.test.js` still finds `<nav id="nav">`, `<header>`, `<pre id="status">idle</pre>`, no inline style).

- [ ] **Step 6: Commit**

```bash
git add src/lib/menu.js tests/menu.test.js src/plant/index.html src/plant/app.js src/plant/theme.css
git commit -m "plant view: menu bar (plant view, pricelist, plant config) from one list shared with the staff editors"
```

---

### Task 4: Server mode in `sheet.js` and the plant-config page

**Files:**
- Create: `tests/sheet-pages.test.js`
- Modify: `src/sheet.js` (imports, `serverFile`, `saveServerFile`, `installMenu`), `src/sheet.css` (`#menu`), `build/build.js` (`SHEET_FILES`), `src/plant-config-page.js`
- Test: `tests/sheet-pages.test.js` (builds `dist/`, which is gitignored, and runs each built page's script in a stub DOM — the page-glue test the repo lacked)

**Interfaces:**
- Consumes: `menuHtml` (Task 3), `/api/staff-file` (Task 2).
- Produces (all exported from `src/sheet.js`): `serverFile(name) -> Promise<{text, hash, exists} | null>` (null when there is no plant server behind the page); `saveServerFile(name, text, basedOn) -> Promise<string>` (new hash; throws `Error(message)` on a refusal, 409 included); `installMenu(current)`. The test helper `run(page, answers)` in `tests/sheet-pages.test.js`, reused by Task 5.

- [ ] **Step 1: Write the failing tests** — `tests/sheet-pages.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
execFileSync(process.execPath, ["build/build.js"], { cwd: ROOT, stdio: "ignore" });
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// A built page's script in a stub DOM. answers: what the plant server says per
// staff file name ({text, hash, exists}); none = no server (fetch is absent or refused).
async function run(page, answers){
  const js = read(`dist/${page}.html`).match(/<script>\n([\s\S]*)\n<\/script>/)[1];
  const els = new Map(), menu = [];
  const mk = id => {
    const el = { id, dataset: {}, style: {}, added: [], textContent: "", className: "", value: "", files: [],
      classList: { add: c => el.added.push(c), toggle(){}, remove(){} },
      addEventListener(){}, querySelectorAll: () => [], click(){},
      set innerHTML(v){ el._h = v; }, get innerHTML(){ return el._h || ""; } };
    return el;
  };
  const document = {
    getElementById: id => els.get(id) || (els.set(id, mk(id)), els.get(id)),
    querySelector: () => ({ insertAdjacentHTML: (_, html) => menu.push(html) }),
    addEventListener(){}, querySelectorAll: () => [],
    body: { classList: { add(){}, remove(){} } }, createElement: () => ({ click(){} })
  };
  const fetch = answers && (async url => {
    const answer = answers[new URL(url, "http://x").searchParams.get("name")];
    return answer ? { ok: true, json: async () => answer } : { ok: false };
  });
  vm.runInNewContext(js, { document, fetch, window: { addEventListener(){} }, console, structuredClone, Blob, URL, Event: class {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  return { els, menu };
}

const example = { text: read("src/plant.config.local.example.js"), hash: "", exists: false };

test("plant config page: no plant server — works on downloads, no menu", async () => {
  for(const answers of [undefined, {}]){
    const { els, menu } = await run("plant-config", answers);
    assert.ok(els.get("editor").innerHTML.includes("Imprint"));
    assert.deepEqual(menu, []);
  }
});

test("plant config page: on the plant server — the file on disk, with the menu", async () => {
  const { els, menu } = await run("plant-config", { "plant-config": example });
  assert.equal(els.get("file").textContent, "src/plant.config.local.js (new, from the example)");
  assert.ok(els.get("editor").innerHTML.includes("Saved to src/plant.config.local.js"));
  assert.equal(menu.length, 1);
  assert.ok(menu[0].includes('aria-current="page">Plant config</a>'));
});

test("plant config page: a file on disk that doesn't parse is no dead end", async () => {
  const { els } = await run("plant-config", { "plant-config": { text: "garbage", hash: "h", exists: true } });
  assert.equal(els.get("status").className, "err");
  assert.ok(els.get("editor").innerHTML.includes("Open a plant.config.local.js"));
  assert.ok(!els.get("btnOpen").added.includes("hidden"));
});

test("pricelist page: no plant server — the embedded template, no menu", async () => {
  const { els, menu } = await run("pricelist", undefined);
  assert.equal(els.get("file").textContent, "pricelist.json");
  assert.deepEqual(menu, []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/sheet-pages.test.js`
Expected: the plant-config server-mode tests FAIL (no menu, wrong file label); the standalone tests pass.

- [ ] **Step 3: `src/sheet.js`.** Add at the top, after the header comment:

```js
import { menuHtml } from "./lib/menu.js";
```

and after `download`:

```js
// Served by the plant server, the editors work on the files on disk
// (/api/staff-file). Opened as a file, or from dist/ (GitHub Pages answers
// 404), there is no server: null, and the page keeps working on downloads.
export async function serverFile(name){
  try{
    const res = await fetch(`/api/staff-file?name=${name}`);
    return res.ok ? await res.json() : null;
  }catch{ return null; }
}

// The new hash; a refusal (409: changed on disk meanwhile) throws its message.
export async function saveServerFile(name, text, basedOn){
  const res = await fetch("/api/staff-file", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text, basedOn }) });
  if(!res.ok) throw new Error(await res.text());
  return (await res.json()).hash;
}

// The staff app's menu above the sheet, only where the server is.
export function installMenu(current){
  document.querySelector(".sheet").insertAdjacentHTML("afterbegin", `<nav id="menu">${menuHtml(current)}</nav>`);
}
```

- [ ] **Step 4: `src/sheet.css`** — append near `header.top`:

```css
  #menu{ display:flex; gap:14px; margin-bottom:12px; font-size:12px; }
  #menu a{ color:var(--ink-dim); }
  #menu a[aria-current]{ color:var(--ink); font-weight:600; text-decoration:none; }
```

- [ ] **Step 5: `build/build.js`** — `SHEET_FILES` becomes `["src/lib/config-validation.js", "src/lib/plant-config.js", "src/lib/menu.js", "src/sheet.js"]` (menu before its importer).

- [ ] **Step 6: `src/plant-config-page.js`.**
  - Import line: `import { $, esc, download, onDropFile, installSheetKeys, serverFile, saveServerFile, installMenu } from "./sheet.js";`
  - After `let dirty = false;` add:

```js
const DISK = "src/plant.config.local.js";
let remote = null;   // {hash} while the plant server holds the file
```
  - In `renderPlant`, replace the last `<p class="note">…</p>` of the template with `<p class="note">${remote ? `Saved to ${DISK}; run node build/build.js for the order form.` : "Save, put the file at src/plant.config.local.js and run node build/build.js for the order form."}</p>`
  - `loadPlant(text, name)` becomes `loadPlant(text, name, fromDisk = false)`, and its `plantName = name;` becomes `plantName = remote && !fromDisk ? `${name} → ${DISK}` : name;` (an opened or dropped file is shown as going to the disk file on Save). Open and drop stay enabled in server mode: they are how a broken file on disk is repaired.
  - Replace the `btnSave` handler with:

```js
$("btnSave").addEventListener("click", async () => {
  const text = formatPlantConfig(plant);
  if(remote){
    try{
      remote.hash = await saveServerFile("plant-config", text, remote.hash);
    }catch(error){
      $("status").className = "err";
      $("status").textContent = `couldn't save: ${error.message}`;
      return;
    }
  }else download(text, "plant.config.local.js", "text/javascript");
  dirty = false;
  plantStatus();
  if(remote) $("status").textContent = "saved to disk";
});
```
  - Replace the file's tail (from `if(PLANT_TEMPLATE){` to the end) with:

```js
async function start(){
  const disk = await serverFile("plant-config");
  if(disk){
    remote = { hash: disk.hash };
    installMenu("/src/plant-config.html");
    renderPlant();   // the "open a file" placeholder, if the file on disk doesn't parse
    loadPlant(disk.text, disk.exists ? DISK : `${DISK} (new, from the example)`, true);
    return;
  }
  if(PLANT_TEMPLATE){
    try{
      validatePlant(PLANT_TEMPLATE);
      plant = structuredClone(PLANT_TEMPLATE);
    }catch(error){ console.error(error); }
  }
  renderPlant();
  plantStatus();
}
start();
```

- [ ] **Step 7: Run the tests** — `node --test tests/` — Expected: all pass, including the four new ones.

- [ ] **Step 8: Commit**

```bash
git add tests/sheet-pages.test.js src/sheet.js src/sheet.css build/build.js src/plant-config-page.js
git commit -m "plant config editor: on the plant server it reads and saves src/plant.config.local.js; menu; downloads stay for dist; page test for the staff editors"
```

---

### Task 5: Server mode in the pricelist page

**Files:**
- Modify: `src/pricelist-page.js`, `tests/sheet-pages.test.js`
- Test: `tests/sheet-pages.test.js` (the `run` helper from Task 4)

**Interfaces:**
- Consumes: `serverFile`, `saveServerFile`, `installMenu` (Task 4); `/api/staff-file` for both `pricelist` and `plant-config` (the VAT country/rate come from the *live* plant config file; "open another…" stays for trying another one).

- [ ] **Step 1: Write the failing tests** — append to `tests/sheet-pages.test.js`:

```js
test("pricelist page: on the plant server — the file on disk, VAT from the live plant config, menu", async () => {
  const pricelist = { text: read("src/pricelist.example.json"), hash: "", exists: false };
  const { els, menu } = await run("pricelist", { pricelist, "plant-config": example });
  assert.equal(els.get("file").textContent, "src/pricelist.json (new, from the example)");
  const editor = els.get("editor").innerHTML;
  assert.ok(editor.includes("src/plant.config.local.js (Tuff Gong International, JM)"));
  assert.ok(editor.includes('data-m="vatCountry" value="JM"'));   // the example list says ES
  assert.ok(els.get("status").textContent.includes("no standard VAT rate for JM"));
  assert.equal(menu.length, 1);
  assert.ok(menu[0].includes('aria-current="page">Pricelist</a>'));
});

test("pricelist page: a pricelist on disk that doesn't parse is no dead end", async () => {
  const { els } = await run("pricelist", { pricelist: { text: "garbage", hash: "h", exists: true }, "plant-config": example });
  assert.equal(els.get("status").className, "err");
  assert.ok(els.get("editor").innerHTML.includes("Open a pricelist.json"));
  assert.ok(!els.get("btnOpen").added.includes("hidden"));
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test tests/sheet-pages.test.js` — Expected: the two new tests FAIL.

- [ ] **Step 3: Edit `src/pricelist-page.js`.**
  - Import line: add `serverFile, saveServerFile, installMenu` to the `./sheet.js` import.
  - After `let plantName = "plant.config.local.js";` add `let remote = null;   // {hash} while the plant server holds the pricelist`
  - `load(text, name)` becomes `load(text, name, fromDisk = false)`, and its `fileName = name;` becomes `fileName = remote && !fromDisk ? `${name} → src/pricelist.json` : name;`. Open and drop stay enabled in server mode (the repair path); `plantLineHtml` and `onDropFile` stay as they are.
  - The `btnSave` handler becomes:

```js
$("btnSave").addEventListener("click", async () => {
  list.created = today();
  status();
  render();
  if($("btnSave").disabled) return;
  const text = formatPricelist(list);
  if(remote){
    try{
      remote.hash = await saveServerFile("pricelist", text, remote.hash);
    }catch(error){
      $("status").className = "err";
      $("status").textContent = `couldn't save: ${error.message}`;
      return;
    }
  }else download(text, fileName, "application/json");
  dirty = false;
  status();
  if(remote) $("status").textContent = "saved to disk";
});
```
  - Replace the file's tail (from `if(PLANT_TEMPLATE){` to the end) with:

```js
async function start(){
  const [disk, plantDisk] = await Promise.all([serverFile("pricelist"), serverFile("plant-config")]);
  if(disk){
    remote = { hash: disk.hash };
    installMenu("/src/pricelist.html");
    if(plantDisk){
      try{
        plant = parsePlantConfig(plantDisk.text);
        plantName = "src/plant.config.local.js";
      }catch(error){ console.error(error); }
    }
    render();   // the "open a file" placeholder, if the file on disk doesn't parse
    // load() leaves "unsaved changes" on when the VAT followed the plant config.
    load(disk.text, disk.exists ? "src/pricelist.json" : "src/pricelist.json (new, from the example)", true);
    return;
  }
  if(PLANT_TEMPLATE){
    try{
      validatePlant(PLANT_TEMPLATE);
      plant = structuredClone(PLANT_TEMPLATE);
    }catch(error){ console.error(error); }
  }
  if(TEMPLATE) load(JSON.stringify(TEMPLATE), "pricelist.json");
  else render();
  dirty = false;
  status();
}
start();
```

- [ ] **Step 4: Run all tests** — `node --test tests/` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/pricelist-page.js tests/sheet-pages.test.js
git commit -m "pricelist editor: on the plant server it reads and saves src/pricelist.json, VAT from the live plant config; downloads stay for dist"
```

---

### Task 6: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (Architecture, the *Prices* bullet), `plant/CLAUDE.md` (a `staff_files.py` bullet), `docs/superpowers/specs/2026-10-08-backend-structure-design.md` (§1)

- [ ] **Step 1: `CLAUDE.md`.** In the *Prices* bullet append: `Served by the plant server (/src/pricelist.html, /src/plant-config.html) the two editors read and write the real files on disk (/api/staff-file, plant/staff_files.py, 409 when changed meanwhile); the dist/ files keep open/save as downloads.`

- [ ] **Step 2: `plant/CLAUDE.md`.** Add: `- staff_files.py — the pricelist and plant config for the two staff editors: read (the committed example before the plant has its own), write by hash like project.json (409 when changed meanwhile). Spec: docs/superpowers/specs/2026-10-08-backend-structure-design.md §1.`

- [ ] **Step 3: Spec §1.** Replace the first bullet's `GET/PUT /api/pricelist` and `/api/plant-config` with `GET` and `POST /api/staff-file?name=pricelist|plant-config` (POST so the JSON-only guard applies), and the menu bullet with: `Menu bar: Plant view, Pricelist, Plant config (one list, src/lib/menu.js) beside the load zip / load folder buttons. Archive and Fixers join with their parts.`

- [ ] **Step 4: Full run** — `node --test tests/` and `uv run --project plant python -m unittest discover plant` — Expected: both green.

- [ ] **Step 5: Live check against the real server** (the dev server on :8765 holds the old code, so ask the user before restarting it): restart it, then `curl -s "http://127.0.0.1:8765/api/staff-file?name=pricelist" | head -c 200` returns the user's real `src/pricelist.json` with `"exists":true`; `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/src/pricelist.html` is 200. Opening the pages in the browser is a manual check — ask the user first (token cost): menu shows, Save writes `src/pricelist.json` / `src/plant.config.local.js`, a second tab saving the same stale file shows "changed meanwhile".

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md plant/CLAUDE.md docs/superpowers/specs/2026-10-08-backend-structure-design.md
git commit -m "docs: staff files served by the plant server"
```

---

## Self-review

- **Spec coverage (§1):** menu → Task 3; `GET`/save with 409 → Tasks 1–2 (POST instead of PUT, amended in Task 6); pages served by the server on live `src/` files → already true via `static_target`, used in Tasks 4–5; Open/Save-as-download stays → standalone branch in both pages; load zip/folder in the menu bar → unchanged buttons beside the new `#menu` (Task 3). Dist pages unchanged when opened as files → `serverFile` returns null.
- **Placeholders:** none; all code is spelled out, the page test is committed (`tests/sheet-pages.test.js`, builds the gitignored `dist/` itself).
- **Type consistency:** `read → {text, hash, exists}`, `write(path, text, based_on) → hash`, JSON `basedOn` ↔ Python `based_on` mapped in `save_staff_file`, `serverFile`/`saveServerFile` names identical in sheet.js and both pages, `STAFF_FILES` used identically in server and tests.
