# PDF Page Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the customer choose which page of a multi-page PDF each artwork slot uses, with a one-click "use page 2" for the label A/B and inlay front/back pairs.

**Architecture:** `parsePdfArtwork` learns the page count (including page trees inside compressed object streams). `buildChecklistRows` adds an info row for multi-page files. Each artwork module (labels, cover, inner sleeve, inlay) keeps its own slot scaffolding and gains a page `<select>`, a page-aware preview and a `page` field in its collect/apply pair. `prepareProject` validates `page`.

**Tech Stack:** Plain ES modules, `node --test`, no dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-pdf-page-choice-design.md`

## Global Constraints

- No runtime dependencies; `dist/index.html` stays one self-contained file.
- Pure logic in `src/lib/` with tests in `tests/`; modules own their DOM.
- `page` is an integer ≥ 1, default 1; older projects without it load as page 1.
- Each slot keeps its own file under its own name; the same PDF may be in the zip twice.
- Pair offer only from the first slot of a pair: label A → "Use page 2 for side B", inlay front → "Use page 2 for back".
- Build with `node build/build.js` after source changes; run `node --test tests/` before each commit.
- Commit messages: short, imperative; end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A PDF whose page tree sits in a Flate object stream (modern InDesign) must still report its real page count, not 1 — tested in Task 1.
- A PDF with an outline (`/Outlines … /Count -3`) must not be mistaken for a page count — tested in Task 1.
- A saved project with `page: 2` beyond a replaced single-page file must clamp to page 1, not show page 2 of 1 — `Math.min` in each module's handleFile (Tasks 3–5).
- `page: 0`, `"2"` or `2.5` in a hand-edited project.json must be rejected by `prepareProject` — tested in Task 2.
- Switching format or product clears the slot; the page picker and pair offer must hide with it — each module's `clear` (Tasks 3–5).

---

### Task 1: Page count, Pages row, preview src, page options (pure)

**Files:**
- Modify: `src/lib/print-artwork.js`
- Test: `tests/print-artwork.test.js`

**Interfaces:**
- Produces:
  - `parsePdfArtwork(buf)` result gains `pageCount: number` (≥ 1); `parseJpegArtwork` / `parseTiffArtwork` results gain `pageCount: 1`.
  - `buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, debugMode, page = 1)` — adds a first row `{feature: "Pages", severity: "info", detected: "N pages — page P used; exact checks at the plant", expected: null}` when `parsed.pageCount > 1`.
  - `pdfPreviewSrc(url, page)` → `` `${url}#toolbar=0&navpanes=0&page=${page}` ``.
  - `pageOptionsHtml(count, page)` → `<option>` HTML for 1…count, `page` selected.

- [ ] **Step 1: Write the failing tests**

Append to `tests/print-artwork.test.js` (add `pdfPreviewSrc, pageOptionsHtml` to the import list at the top, and `import { buildPdf } from "../src/lib/pdf.js";`):

```js
// ---- page count ----

function pages(n){
  return Array.from({length: n}, () => ({ widthMm: 100, heightMm: 100, content: "0 0 0 1 k\n" }));
}

test("parsePdfArtwork counts pages of a plain page tree", async () => {
  for(const n of [1, 2, 3]){
    const bytes = buildPdf({ title: "t", pages: pages(n) });
    const info = await parsePdfArtwork(bytes.buffer);
    assert.equal(info.pageCount, n);
  }
});

test("parsePdfArtwork counts pages whose tree sits in a Flate object stream", async () => {
  // PDF 1.5 object stream: "objnum offset" header pairs, then the objects.
  const objs = "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> << /Type /Page /Parent 2 0 R >> << /Type /Page /Parent 2 0 R >>";
  const header = "2 0 3 49 4 83 ";
  const packed = deflateSync(Buffer.from(header + objs, "latin1"));
  const pdf = concatBytes([
    `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`
    + `5 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    new Uint8Array(packed),
    "\nendstream\nendobj\n%%EOF\n"
  ]);
  const info = await parsePdfArtwork(pdf);
  assert.equal(info.pageCount, 2);
});

test("parsePdfArtwork ignores outline /Count and defaults to 1", async () => {
  const pdf = vectorPdfBuffer({ content: "0 0 0 1 k", extraObjects: "3 0 obj\n<< /Type /Outlines /Count -3 >>\nendobj\n" });
  const info = await parsePdfArtwork(pdf);
  assert.equal(info.pageCount, 1);
});

test("buildChecklistRows adds a Pages row only for multi-page files", () => {
  const parsed = { pageSizeMm: TARGET, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4", pageCount: 2 };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false, 2);
  assert.deepEqual(rows[0], { feature: "Pages", severity: "info", detected: "2 pages — page 2 used; exact checks at the plant", expected: null });
  const single = buildChecklistRows({ ...parsed, pageCount: 1 }, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.ok(!single.some(row => row.feature === "Pages"));
});

test("pdfPreviewSrc and pageOptionsHtml", () => {
  assert.equal(pdfPreviewSrc("blob:x", 2), "blob:x#toolbar=0&navpanes=0&page=2");
  assert.equal(pageOptionsHtml(3, 2), '<option value="1">1</option><option value="2" selected>2</option><option value="3">3</option>');
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `node --test tests/print-artwork.test.js`
Expected: FAIL — `pdfPreviewSrc` is not exported; `pageCount` undefined.

- [ ] **Step 3: Implement**

In `src/lib/print-artwork.js`:

1. Generalise `findFlateStreamCandidates` so object streams can be found with the same framing logic. Replace the function with:

```js
// Every Flate-compressed stream whose dictionary passes keep(dictText).
function flateStreams(text, keep){
  const candidates = [];
  const streamOpenRe = /(>>)\s*stream\r?\n/g;
  let m;
  while((m = streamOpenRe.exec(text)) !== null){
    const dictText = dictBefore(text, m.index + 2);
    if(!dictText || !/\/FlateDecode\b/.test(dictText) || !keep(dictText)) continue;

    const dataStart = streamOpenRe.lastIndex;
    let dataEnd = text.indexOf("endstream", dataStart);
    if(dataEnd === -1) continue;
    // A single EOL conventionally separates the stream data from the
    // "endstream" keyword (PDF spec) — part of the file's framing, not
    // part of the compressed payload, so left in it trips zlib's
    // trailing-data check on an otherwise perfectly valid stream.
    if(text[dataEnd-1] === "\n"){ dataEnd--; if(text[dataEnd-1] === "\r") dataEnd--; }
    candidates.push({ start: dataStart, end: dataEnd });
  }
  return candidates;
}

// Content-like streams: not image pixel data, not a compressed object
// stream, cross-reference stream or metadata — the shared candidate
// pool detectVectorColorMode and detectIccProfileName both draw from.
function findFlateStreamCandidates(text){
  return flateStreams(text, dict => !/\/Subtype\s*\/Image/.test(dict)
    && !/\/Type\s*\/(ObjStm|XRef|Metadata)\b/.test(dict));
}
```

2. Add the page count, above `parsePdfArtwork`:

```js
// The root page tree's /Count is the largest /Count of any /Type /Pages
// dict (inner nodes count only their subtree; an outline's /Count sits
// in a /Type /Outlines dict and never matches). Modern exports pack
// these dicts into compressed object streams (/Type /ObjStm), so those
// are inflated and searched too. [^<>] keeps a match inside one dict.
const PAGES_COUNT = /\/Type\s*\/Pages\b[^<>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^<>]*?\/Type\s*\/Pages\b/g;

async function pdfPageCount(text, bytes){
  const texts = [text];
  for(const {start, end} of flateStreams(text, dict => /\/Type\s*\/ObjStm\b/.test(dict))){
    try{ texts.push(await inflateFlateDecodeText(bytes.slice(start, end))); }
    catch{ /* unreadable stream: count what's readable */ }
  }
  let count = 0;
  for(const t of texts){
    for(const m of t.matchAll(PAGES_COUNT)) count = Math.max(count, Number(m[1] ?? m[2]));
  }
  return count || 1;
}
```

3. In `parsePdfArtwork`, before the `return`, add `const pageCount = await pdfPageCount(text, bytes);` and add `pageCount` to the returned object. Update the shape comment at the top of the file: add `pageCount` to the field list and a line `// - pageCount   — pages in the PDF (1 for JPEG/TIFF).`

4. In `parseJpegArtwork` and `parseTiffArtwork`, add `pageCount: 1` to each returned object.

5. `buildChecklistRows`: change the signature to `(parsed, kind, targetMm, trimMm, printCheck, debugMode, page = 1)`, and directly after `const rows = [];` add:

```js
  // The browser reads the PDF as a whole; only the plant checks one page.
  if(parsed.pageCount > 1){
    rows.push({ feature: "Pages", severity: "info",
      detected: `${parsed.pageCount} pages — page ${page} used; exact checks at the plant`, expected: null });
  }
```

6. Add the two helpers at the end of the file:

```js
// The browser's own PDF viewer opens at #page=N (Chrome, Firefox;
// Safari ignores it and shows page 1).
export function pdfPreviewSrc(url, page){
  return `${url}#toolbar=0&navpanes=0&page=${page}`;
}

export function pageOptionsHtml(count, page){
  let html = "";
  for(let i = 1; i <= count; i++) html += `<option value="${i}"${i === page ? " selected" : ""}>${i}</option>`;
  return html;
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test tests/`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print-artwork.js tests/print-artwork.test.js
git commit -m "print artwork: PDF page count (incl. object streams), Pages row, page-aware preview src

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `page` in project.json

**Files:**
- Modify: `src/lib/project.js`
- Test: `tests/project.test.js`

**Interfaces:**
- Produces: after `prepareProject`, `labels.sides.A|B.page`, `coverSleeve.cover.page`, `coverSleeve.innerSleeve.page`, `coverSleeve.inlay.front|back.page` are integers ≥ 1 (default 1).

- [ ] **Step 1: Write the failing tests**

Append to `tests/project.test.js`:

```js
test("prepareProject defaults artwork page to 1 and keeps a valid page", () => {
  const project = prepareProject({format:"12", labels:{sides:{B:{fileName:"CAT_labels_B_v1.pdf", page:2}}}}, config);
  assert.equal(project.labels.sides.A.page, 1);
  assert.equal(project.labels.sides.B.page, 2);
  assert.equal(project.coverSleeve.cover.page, 1);
  assert.equal(project.coverSleeve.innerSleeve.page, 1);
  assert.equal(project.coverSleeve.inlay.front.page, 1);
  assert.equal(project.coverSleeve.inlay.back.page, 1);
});

test("prepareProject rejects a page that isn't a positive integer", () => {
  for(const page of [0, -1, 2.5, "2", null]){
    assert.throws(() => prepareProject({format:"12", coverSleeve:{cover:{page}}}, config), /page must be a positive integer/);
  }
});
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test tests/project.test.js`
Expected: FAIL — `page` undefined.

- [ ] **Step 3: Implement**

In `src/lib/project.js`, next to `fileName(...)`:

```js
function pageNumber(value, path){
  if(value === undefined) return 1;
  if(!Number.isInteger(value) || value < 1) throw new TypeError(`${path} must be a positive integer`);
  return value;
}
```

Then, wherever an artwork slot's `originalFileName` is validated, add the page on the next line:
- in the labels loop: `label.page = pageNumber(label.page, `${path}.page`);`
- in the cover/inner sleeve loop: `part.page = pageNumber(part.page, `${path}.page`);`
- in the inlay front/back loop: `part.page = pageNumber(part.page, `${path}.page`);`

(`null` is rejected: `pageNumber` only defaults `undefined`; collect writes `1` when a slot has no file.)

- [ ] **Step 4: Run the tests**

Run: `node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/project.js tests/project.test.js
git commit -m "project: artwork page per slot, default 1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Labels — picker, preview, pair offer, save/load

**Files:**
- Modify: `src/modules/labels.js`
- Modify: `src/index.html` (CSS only)

**Interfaces:**
- Consumes: `pdfPreviewSrc`, `pageOptionsHtml`, `buildChecklistRows(…, page)` (Task 1); `labels.sides.X.page` (Task 2).
- Produces: `collectLabels()` sides carry `page`; `applyLabels` restores it.

DOM modules have no unit tests in this repo; verification is the build plus a manual browser check in Task 6.

- [ ] **Step 1: Template** — in `labelSideTemplate`, after the `<div class="filemeta empty" id="labelmeta-${side}" …></div>` line add:

```js
      <label class="pagepick hidden no-print" id="labelpagewrap-${side}">page
        <select id="labelpage-${side}"></select> <span id="labelpagecount-${side}"></span></label>
      ${side === "A" ? `<button type="button" class="pairbtn hidden no-print" id="labelpair-A">Use page 2 for side B</button>` : ""}
```

- [ ] **Step 2: State** — `newLabelState()` returns additionally `page: 1, pageCount: 1, parsed: null, kind: null`. Import `pdfPreviewSrc, pageOptionsHtml` from `../lib/print-artwork.js`. `renderChecklist(side, parsed, kind, targetMm, trimMm, printCheck, page)` passes `page` on to `buildChecklistRows(…, isDebugMode(), page)`.

- [ ] **Step 3: One renderer for rows, preview and picker** — add above `handleFile`:

```js
// Checklist, preview and page picker for the attached file and its
// chosen page; rerun when the page changes.
function renderLabelArtwork(side){
  const state = labelStates[side];
  const spec = formatSpec();
  const dataSizeMm = labelDataSizeMm(spec);
  const printCheck = getFormat(CONFIG, currentFormat()).printCheck;
  state.rows = renderChecklist(side, state.parsed, state.kind, {w:dataSizeMm, h:dataSizeMm},
    {w:spec.diameterMm, h:spec.diameterMm}, printCheck, state.page);
  const {kind, parsed} = state;
  if(kind === "pdf"){
    // Fills via CSS (.label-preview iframe{width/height:100%}) — see
    // cover.js's identical comment on Safari's PDF viewer margin.
    setPreview(side, `<iframe src="${pdfPreviewSrc(state.url, state.page)}"></iframe>`);
  } else if(kind === "jpeg"){
    setPreview(side, `<img src="${state.url}" alt="label ${side} artwork">`);
  } else if(kind === "tiff"){
    const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
    setPreview(side, `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`);
  } else{
    setPreview(side, `<div class="label-placeholder">preview not available</div>`);
  }
  document.getElementById("labelpagewrap-"+side).classList.toggle("hidden", state.pageCount < 2);
  document.getElementById("labelpage-"+side).innerHTML = pageOptionsHtml(state.pageCount, state.page);
  document.getElementById("labelpagecount-"+side).textContent = `of ${state.pageCount}`;
  updateLabelPairOffer();
}

// A multi-page PDF on side A while B is still open: offer its page 2 for B.
function updateLabelPairOffer(){
  const a = labelStates.A, b = labelStates.B;
  const show = a.pageCount > 1 && !b.file && !b.storedFileName
    && !document.getElementById("whitelabel-B").checked;
  document.getElementById("labelpair-A").classList.toggle("hidden", !show);
}
```

- [ ] **Step 4: handleFile** — signature `handleFile(side, file, originalFileName = file.name, page = 1)`. In its first `Object.assign(state, {…})` add `page: 1, pageCount: 1, parsed: null, kind: null`. In the `try` branch replace everything from `const spec = formatSpec();` through the end of the preview `if/else` chain with:

```js
    state.parsed = parsed;
    state.kind = kind;
    state.pageCount = (parsed && parsed.pageCount) || 1;
    state.page = Math.min(page, state.pageCount);
    state.url = URL.createObjectURL(file);
    renderLabelArtwork(side);
    state.pending = false;
    state.error = null;
```

(keep the following `renderLabelFileMeta(side, file.name, originalFileName, null);`). The `catch` branch stays as is.

- [ ] **Step 5: clear, whitelabel, wiring** — in `clearLabelArtwork` add `page: 1, pageCount: 1, parsed: null, kind: null` to its `Object.assign`, then after `…warnings….innerHTML = "";` add:

```js
  document.getElementById("labelpagewrap-"+side).classList.add("hidden");
  updateLabelPairOffer();
```

In `wireLabelSide(side)` add:

```js
  document.getElementById("labelpage-"+side).addEventListener("change", e=>{
    labelStates[side].page = Number(e.target.value);
    renderLabelArtwork(side);
    labelsOnStateChange();
  });
```

and in its whitelabel `change` handler, before `labelsOnStateChange();`, call `updateLabelPairOffer();`. In `initLabels`, after `SIDES.forEach(wireLabelSide);` add:

```js
  document.getElementById("labelpair-A").addEventListener("click", ()=>{
    const a = labelStates.A;
    handleFile("B", a.file, a.originalFileName, 2);
  });
```

- [ ] **Step 6: Save/load** — in `collectLabels`, add `page: included ? state.page : 1` to each side object. In `applyLabels`, call `handleFile(side, file, s.originalFileName || s.fileName, s.page || 1)`.

- [ ] **Step 7: CSS** — in `src/index.html`, next to the existing `.filemeta` rules, add:

```css
.pagepick{ font-size:12px; white-space:nowrap; }
.pairbtn{ font:inherit; font-size:12px; }
```

- [ ] **Step 8: Build and run tests**

Run: `node build/build.js && node --test tests/`
Expected: build succeeds, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/labels.js src/index.html
git commit -m "labels: page picker for multi-page PDFs, 'use page 2 for side B'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Inlay — picker per slot, "use page 2 for back"

**Files:**
- Modify: `src/modules/inlay.js`
- Modify: `src/index.html` (inlay front/back markup)

**Interfaces:**
- Consumes: Task 1 helpers; `coverSleeve.inlay.front|back.page` (Task 2).
- Produces: `collectInlay()` front/back carry `page`; slot object gains `getPage()`.

- [ ] **Step 1: Markup** — in `src/index.html`, after `<div class="filemeta empty" id="inlayfrontmeta"></div>` add:

```html
              <label class="pagepick hidden no-print" id="inlayfrontpagewrap">page <select id="inlayfrontpage"></select> <span id="inlayfrontpagecount"></span></label>
              <button type="button" class="pairbtn hidden no-print" id="inlaypair">Use page 2 for back</button>
```

and after `<div class="filemeta empty" id="inlaybackmeta"></div>`:

```html
              <label class="pagepick hidden no-print" id="inlaybackpagewrap">page <select id="inlaybackpage"></select> <span id="inlaybackpagecount"></span></label>
```

- [ ] **Step 2: Slot factory** — in `createInlayArtworkSlot(prefix, onStateChange)`:
  - import `pdfPreviewSrc, pageOptionsHtml`; `renderInlayChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck, page)` passes `page` to `buildChecklistRows(…, isDebugMode(), page)`.
  - state gets `page: 1, pageCount: 1, parsed: null, kind: null`.
  - add inside the factory, after `renderInlayFileMeta`:

```js
  const pageWrap = document.getElementById(prefix+"pagewrap");
  const pageSelect = document.getElementById(prefix+"page");

  // Checklist, preview and page picker for the attached file and its
  // chosen page; rerun when the page changes.
  function renderArtwork(){
    const { dataMm, trimMm } = inlaySpec();
    const printCheck = getFormat(CONFIG, inlayCurrentFormat()).printCheck;
    state.rows = renderInlayChecklist(warningsList, state.parsed, state.kind, dataMm, trimMm, printCheck, state.page);
    const {kind, parsed} = state;
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      preview.innerHTML = `<iframe src="${pdfPreviewSrc(state.url, state.page)}"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${state.url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    pageWrap.classList.toggle("hidden", state.pageCount < 2);
    pageSelect.innerHTML = pageOptionsHtml(state.pageCount, state.page);
    document.getElementById(prefix+"pagecount").textContent = `of ${state.pageCount}`;
  }

  pageSelect.addEventListener("change", ()=>{
    state.page = Number(pageSelect.value);
    renderArtwork();
    onStateChange();
  });
```

  - `handleFile(f, origName = f.name, page = 1)`: first `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; in the `try` branch replace from `const { dataMm, trimMm } = inlaySpec();` through the end of the preview `if/else` chain with:

```js
      state.parsed = parsed;
      state.kind = kind;
      state.pageCount = (parsed && parsed.pageCount) || 1;
      state.page = Math.min(page, state.pageCount);
      state.url = URL.createObjectURL(f);
      renderArtwork();
      state.pending = false;
      state.error = null;
```

  - `clear()`: `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; append `pageWrap.classList.add("hidden");`.
  - returned object adds `getPage: ()=> state.page`.

- [ ] **Step 3: Pair offer** — add below `createInlayArtworkSlot`:

```js
// A multi-page PDF on the front while the back is still open: offer
// its page 2 for the back.
function updateInlayPairOffer(){
  const front = inlayFrontSlot.getState(), back = inlayBackSlot.getState();
  const show = front.pageCount > 1 && !back.file && !back.storedFileName;
  document.getElementById("inlaypair").classList.toggle("hidden", !show);
}
```

In `initInlay`, create both slots with `()=>{ updateInlayPairOffer(); inlayOnStateChange(); }` as their `onStateChange`, and add:

```js
  document.getElementById("inlaypair").addEventListener("click", ()=>{
    const front = inlayFrontSlot.getState();
    inlayBackSlot.setFile(front.file, front.originalFileName, 2);
  });
```

In both `format` and `inlayProduct` change listeners, call `updateInlayPairOffer();` after the slots are cleared.

- [ ] **Step 4: Save/load** — `collectInlay`: front/back objects add `page: product && slot.getFile() ? slot.getPage() : 1` (with the matching slot). `applyInlaySlotFile(slot, prefix, variant, fileName, originalFileName, fileMap, page)` calls `slot.setFile(file, originalFileName || fileName, page || 1)`; `applyInlay` passes `inlay.front && inlay.front.page` and `inlay.back && inlay.back.page`.

- [ ] **Step 5: Build and run tests**

Run: `node build/build.js && node --test tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/inlay.js src/index.html
git commit -m "inlay: page picker per slot, 'use page 2 for back'

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cover and inner sleeve — picker

**Files:**
- Modify: `src/modules/cover.js`, `src/modules/inner-sleeve.js`
- Modify: `src/index.html` (cover and inner sleeve markup)

**Interfaces:**
- Consumes: Task 1 helpers; `coverSleeve.cover.page`, `coverSleeve.innerSleeve.page` (Task 2).
- Produces: `collectCover()` / `collectInnerSleeve()` carry `page`.

- [ ] **Step 1: Markup** — in `src/index.html`, after `<div class="filemeta empty" id="covermeta"></div>` add

```html
          <label class="pagepick hidden no-print" id="coverpagewrap">page <select id="coverpage"></select> <span id="coverpagecount"></span></label>
```

and after `<div class="filemeta empty" id="innersleevemeta"></div>` add

```html
          <label class="pagepick hidden no-print" id="innersleevepagewrap">page <select id="innersleevepage"></select> <span id="innersleevepagecount"></span></label>
```

- [ ] **Step 2: cover.js** — in `createCoverArtworkSlot(onStateChange)`:
  - import `pdfPreviewSrc, pageOptionsHtml`; `renderCoverChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck, page)` passes `page` to `buildChecklistRows(…, isDebugMode(), page)`.
  - state gets `page: 1, pageCount: 1, parsed: null, kind: null`.
  - add, after `renderCoverFileMeta`:

```js
  const pageWrap = document.getElementById("coverpagewrap");
  const pageSelect = document.getElementById("coverpage");

  // Checklist, preview and page picker for the attached file and its
  // chosen page; rerun when the page changes.
  function renderArtwork(){
    const { dataMm, trimMm } = coverSpec();
    const printCheck = getFormat(CONFIG, coverCurrentFormat()).printCheck;
    state.rows = renderCoverChecklist(warningsList, state.parsed, state.kind, dataMm, trimMm, printCheck, state.page);
    const {kind, parsed} = state;
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}). Safari's
      // built-in PDF viewer renders its own margin inside the page content
      // itself — not reachable or fixable from the host page (verified: a
      // CSS-transform-scale attempt scaled that margin right along with
      // it) — so Safari shows a grey margin around the artwork here;
      // Chrome/Firefox fill exactly.
      preview.innerHTML = `<iframe src="${pdfPreviewSrc(state.url, state.page)}"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${state.url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    pageWrap.classList.toggle("hidden", state.pageCount < 2);
    pageSelect.innerHTML = pageOptionsHtml(state.pageCount, state.page);
    document.getElementById("coverpagecount").textContent = `of ${state.pageCount}`;
  }

  pageSelect.addEventListener("change", ()=>{
    state.page = Number(pageSelect.value);
    renderArtwork();
    onStateChange();
  });
```

  - `handleFile(f, origName = f.name, page = 1)`: first `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; in the `try` branch replace from `const { dataMm, trimMm } = coverSpec();` through the end of the preview `if/else` chain with:

```js
      state.parsed = parsed;
      state.kind = kind;
      state.pageCount = (parsed && parsed.pageCount) || 1;
      state.page = Math.min(page, state.pageCount);
      state.url = URL.createObjectURL(f);
      renderArtwork();
      state.pending = false;
      state.error = null;
```

  - `clear()`: `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; append `pageWrap.classList.add("hidden");`.
  - returned object adds `getPage: ()=> state.page`.
  - `collectCover` adds `page: (printed && file) ? coverSlot.getPage() : 1`.
  - `applyCoverSlotFile(fileName, originalFileName, fileMap, page)` calls `coverSlot.setFile(file, originalFileName || fileName, page || 1)`; `applyCover` passes `c.page`.

- [ ] **Step 3: inner-sleeve.js** — in `createInnerSleeveArtworkSlot(onStateChange)`:
  - import `pdfPreviewSrc, pageOptionsHtml`; `renderInnerSleeveChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck, page)` passes `page` to `buildChecklistRows(…, isDebugMode(), page)`.
  - state gets `page: 1, pageCount: 1, parsed: null, kind: null`.
  - add, after `renderInnerSleeveFileMeta`:

```js
  const pageWrap = document.getElementById("innersleevepagewrap");
  const pageSelect = document.getElementById("innersleevepage");

  // Checklist, preview and page picker for the attached file and its
  // chosen page; rerun when the page changes.
  function renderArtwork(){
    const { dataMm, trimMm } = innerSleeveSpec();
    const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
    state.rows = renderInnerSleeveChecklist(warningsList, state.parsed, state.kind, dataMm, trimMm, printCheck, state.page);
    const {kind, parsed} = state;
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      preview.innerHTML = `<iframe src="${pdfPreviewSrc(state.url, state.page)}"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${state.url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    pageWrap.classList.toggle("hidden", state.pageCount < 2);
    pageSelect.innerHTML = pageOptionsHtml(state.pageCount, state.page);
    document.getElementById("innersleevepagecount").textContent = `of ${state.pageCount}`;
  }

  pageSelect.addEventListener("change", ()=>{
    state.page = Number(pageSelect.value);
    renderArtwork();
    onStateChange();
  });
```

  - `handleFile(f, origName = f.name, page = 1)`: first `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; in the `try` branch replace from `const { dataMm, trimMm } = innerSleeveSpec();` through the end of the preview `if/else` chain with:

```js
      state.parsed = parsed;
      state.kind = kind;
      state.pageCount = (parsed && parsed.pageCount) || 1;
      state.page = Math.min(page, state.pageCount);
      state.url = URL.createObjectURL(f);
      renderArtwork();
      state.pending = false;
      state.error = null;
```

  - `clear()`: `Object.assign` adds `page: 1, pageCount: 1, parsed: null, kind: null`; append `pageWrap.classList.add("hidden");`.
  - returned object adds `getPage: ()=> state.page`.
  - `collectInnerSleeve` adds `page: (printed && file) ? innerSleeveSlot.getPage() : 1`.
  - `applyInnerSleeveSlotFile(fileName, originalFileName, fileMap, page)` calls `innerSleeveSlot.setFile(file, originalFileName || fileName, page || 1)`; `applyInnerSleeve` passes the slot data's `page`.

- [ ] **Step 4: Build and run tests**

Run: `node build/build.js && node --test tests/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cover.js src/modules/inner-sleeve.js src/index.html
git commit -m "cover, inner sleeve: page picker for multi-page PDFs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Plant overview shows the page; manual check

**Files:**
- Modify: `src/lib/plant-overview.js`
- Test: `tests/plant-overview.test.js`

**Interfaces:**
- Consumes: `page` fields (Task 2).

- [ ] **Step 1: Failing test** — append to `tests/plant-overview.test.js`:

```js
test("artwork files show their page when it isn't 1", () => {
  const p = prepareProject({format:"12", labels:{sides:{A:{fileName:"L.pdf"}, B:{fileName:"L2.pdf", page:2}}}}, CONFIG);
  const html = renderOverview(p, CONFIG, [{name:"L.pdf", size:1024}, {name:"L2.pdf", size:1024}]);
  assert.ok(html.includes("L2.pdf (1 KB), page 2"));
  assert.ok(!html.includes("L.pdf (1 KB), page"));
});
```

- [ ] **Step 2: Run to see it fail**

Run: `node --test tests/plant-overview.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/lib/plant-overview.js` add

```js
function artworkHtml(slot, sizes){
  const file = fileHtml(slot.fileName, sizes);
  return file && slot.page > 1 ? `${file}, page ${slot.page}` : file;
}
```

and use `artworkHtml(slot, sizes)` instead of `fileHtml(x.fileName, sizes)` for labels (`labels.sides[side]`), inner sleeve (`sleeve.innerSleeve`), cover (`sleeve.cover`) and inlay front/back (`sleeve.inlay.front|back`).

- [ ] **Step 4: Run all tests and build**

Run: `node --test tests/ && node build/build.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/plant-overview.js tests/plant-overview.test.js
git commit -m "plant overview: show the chosen artwork page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Manual check (ask the user before using Chrome)** — open `dist/index.html`, attach a 2-page PDF to label A: picker "page 1 of 2" and "Use page 2 for side B" appear; click it: side B shows page 2 in Chrome/Firefox, the offer disappears; switch A to page 2: preview and Pages row follow; save the project, reload it: pages restored. Same for inlay front/back; cover shows the picker, no pair offer.
