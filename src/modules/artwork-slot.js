// One artwork upload slot — file pick, parse, checklist, preview, PDF
// page picker, reload re-attach — shared by labels.js and
// printed-parts.js. It only touches the elements the caller names:
// id(role) returns the caller's element for a role (input, pick, meta,
// preview, warnings, pagewrap, page, pagecount). size() returns
// {targetMm, trimMm, printCheck} at the moment of checking.
//
// Parsing/validation is pure, from ../lib/print-artwork.js.

import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON, pdfPreviewSrc, pageOptionsHtml, pdfSinglePageView } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { reselectNote } from "../lib/staff-mode.js";

function blankSlotState(){
  return {
    file: null, originalFileName: null, storedFileName: null,
    pending: false, rows: [], error: null,
    url: null, previewFile: null, previewUrl: null,
    page: 1, pageCount: 1, parsed: null, kind: null, viewUrl: null
  };
}

export function createArtworkSlot(id, {size, onChange}){
  const input = id("input"), meta = id("meta"), preview = id("preview"), warnings = id("warnings");
  const pageWrap = id("pagewrap"), pageSelect = id("page");
  const state = {...blankSlotState(), revision: 0};

  function revokeUrls(){
    for(const url of [state.url, state.previewUrl, state.viewUrl]) if(url) URL.revokeObjectURL(url);
  }

  // "file: <name>", plus "was: <original>" when a reload re-attached the
  // file by its convention name. DOM nodes, not innerHTML: file names are
  // the customer's own, untrusted strings.
  function renderMeta(name, originalName, status){
    meta.classList.remove("empty");
    meta.textContent = "";
    meta.append(status ? `file: ${name} — ${status}` : `file: ${name}`);
    if(originalName && originalName !== name){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  }

  // row.feature/row.detected can echo text read out of the file itself
  // (e.g. an ICC profile's description) — textContent, never innerHTML.
  function renderChecklist(parsed, kind, page){
    const {targetMm, trimMm, printCheck} = size();
    const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode(), page);
    warnings.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
    const tbody = document.createElement("tbody");
    for(const row of rows){
      const tr = document.createElement("tr");
      tr.className = row.severity;
      for(const text of [CHECKLIST_ICON[row.severity], row.feature, row.detected, row.expected || ""]){
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    warnings.appendChild(tbody);
    return rows;
  }

  // Checklist, preview and page picker for the attached file and its
  // chosen page; rerun when the page changes.
  function renderArtwork(){
    state.rows = renderChecklist(state.parsed, state.kind, state.page);
    const {kind, parsed} = state;
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}). Safari's
      // built-in PDF viewer draws its own margin inside the page — not
      // reachable from the host page (a CSS-transform-scale attempt scaled
      // that margin along with it) — so Safari shows a grey margin here.
      if(state.pageCount > 1){
        preview.innerHTML = `<div class="label-placeholder">page ${state.page}…</div>`;
        showPageView();
      } else preview.innerHTML = `<iframe src="${pdfPreviewSrc(state.url)}"></iframe>`;
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
    id("pagecount").textContent = `of ${state.pageCount}`;
  }

  // Multi-page PDF: preview a one-page copy of the chosen page (see
  // pdfSinglePageView), or the file as it is when that isn't possible. A
  // newer file or page, or a plant preview image, wins over a late result.
  async function showPageView(){
    const {file, page, revision} = state;
    const view = await pdfSinglePageView(await file.arrayBuffer(), page);
    if(state.revision !== revision || state.page !== page || state.previewFile) return;
    if(state.viewUrl) URL.revokeObjectURL(state.viewUrl);
    state.viewUrl = view ? URL.createObjectURL(new Blob([view], {type: "application/pdf"})) : null;
    preview.innerHTML = `<iframe src="${pdfPreviewSrc(state.viewUrl || state.url)}"></iframe>`;
  }

  // A plant-generated preview image, shown over the live-rendered file;
  // only a reload has one (see applyFile).
  function showPreviewImage(img){
    if(!state.file) return;
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewFile = img;
    state.previewUrl = URL.createObjectURL(img);
    preview.innerHTML = `<img src="${state.previewUrl}" alt="plant preview">`;
    renderMeta(state.file.name, state.originalFileName, "plant preview");
  }

  // Resolves false when a newer file replaced this one meanwhile.
  async function setFile(f, originalName = f.name, page = 1){
    const revision = ++state.revision;
    renderMeta(f.name, originalName, "checking…");
    revokeUrls();
    Object.assign(state, blankSlotState(), {file: f, originalFileName: originalName, pending: true});
    onChange();

    let kind = null;
    try{
      const buf = await f.arrayBuffer();
      if(state.revision !== revision) return false;
      kind = sniffFileKind(buf);
      let parsed = null;
      if(kind === "pdf") parsed = await parsePdfArtwork(buf);
      else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
      else if(kind === "tiff") parsed = parseTiffArtwork(buf);
      if(state.revision !== revision) return false;
      state.parsed = parsed;
      state.kind = kind;
      state.pageCount = (parsed && parsed.pageCount) || 1;
      state.page = Math.min(page, state.pageCount);
      state.url = URL.createObjectURL(f);
      renderArtwork();
      state.error = null;
    } catch(error){
      if(state.revision !== revision) return false;
      state.rows = renderChecklist(null, kind);
      state.error = error;
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    state.pending = false;
    renderMeta(f.name, originalName, null);
    onChange();
    return true;
  }

  // A file is sized for one format/product — switching either drops it.
  function clear(){
    ++state.revision;
    revokeUrls();
    Object.assign(state, blankSlotState());
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warnings.innerHTML = "";
    pageWrap.classList.add("hidden");
  }

  // fileMap: package name -> File from a reopened project zip (see
  // tracklist.js's loadProject). The file named in project.json is
  // re-attached, with the plant's preview image if the zip has one; a
  // name missing from the map asks the customer to re-select it.
  async function applyFile(fileName, originalFileName, fileMap, previewName, page){
    const file = fileMap && fileName && fileMap.get(fileName);
    if(file){
      if(await setFile(file, originalFileName || fileName, page || 1)){
        const img = fileMap.get(previewName);
        if(img) showPreviewImage(img);
      }
      return;
    }
    clear();
    state.storedFileName = fileName || null;
    if(fileName) renderMeta(fileName, originalFileName, reselectNote() || null);
  }

  // The package entries for this slot: the file under nameOf(file), and
  // the plant preview image when there is one.
  function files(nameOf, previewName){
    if(!state.file) return [];
    const out = [{name: nameOf(state.file), data: state.file}];
    if(state.previewFile) out.push({name: previewName, data: state.previewFile});
    return out;
  }

  id("pick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    input.value = ""; // re-picking the same file must fire change again
    if(f) setFile(f);
  });
  pageSelect.addEventListener("change", ()=>{
    state.page = Number(pageSelect.value);
    // A plant preview shows the old page; it must not be saved for the new one.
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewFile = state.previewUrl = null;
    renderMeta(state.file.name, state.originalFileName, null);
    renderArtwork();
    onChange();
  });

  return {state, setFile, clear, applyFile, files};
}

// A multi-page PDF in the first slot while the second is still open:
// button offers its page 2 for the second. Returns the update function.
export function pairSlots(first, second, button, hidden = ()=> false){
  button.addEventListener("click", ()=> second.setFile(first.state.file, first.state.originalFileName, 2));
  return ()=> button.classList.toggle("hidden", first.state.pageCount < 2
    || !!second.state.file || !!second.state.storedFileName || hidden());
}
