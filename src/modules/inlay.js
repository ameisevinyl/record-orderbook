// Inlay module — one product per selection from the plant's inlay
// catalog (currently just "printed" — inlay never has an unprinted
// kind, since printing is the entire point of an inlay) — see
// CONFIG.formats[i].printableParts.inlay.products and the packaging
// product catalog design spec. Delivered as two separate square pages
// (unlike cover.js/inner-sleeve.js's single flat spread, since an inlay
// is printed on both sides of one physical sheet). No page count/
// booklet support — explicitly deferred, see the catalogue schema
// restructure design spec. Split out of the former cover-sleeve.js
// along with cover.js and inner-sleeve.js (Decision 8) — each owns its
// own copy of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON, pdfPreviewSrc, pageOptionsHtml } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";
import { requiredFileIssue } from "../lib/file-issues.js";

const INLAY_PREVIEW_MAX_W = 640;

function inlayCurrentFormat(){
  return document.getElementById("format").value;
}

function inlayProducts(){
  return getFormat(CONFIG, inlayCurrentFormat()).printableParts.inlay.products;
}

function selectedInlayProduct(){
  return productById(inlayProducts(), document.getElementById("inlayProduct").value || null);
}

function inlayIncluded(){
  return !!selectedInlayProduct();
}

// dataMm is derived (trim + bleed — a single flat sheet, no spine/
// folding), not a stored field. undefined when "None" is selected (or,
// in principle, for a product with no trimMm — inlay never has an
// unprinted product today, but this stays defensive either way).
function inlaySpec(){
  const part = selectedInlayProduct();
  return part && { ...part, dataMm: part.trimMm ? flatDataMm(part) : undefined };
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderInlayChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck, page){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode(), page);
  tableEl.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
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
  tableEl.appendChild(tbody);
  return rows;
}

// prefix is "inlayfront" or "inlayback" — the two sides share this
// scaffolding (unlike cover.js/inner-sleeve.js, which each have exactly
// one slot), since front/back are otherwise identical.
function createInlayArtworkSlot(prefix, onStateChange){
  const input = document.getElementById(prefix+"input");
  const meta = document.getElementById(prefix+"meta");
  const preview = document.getElementById(prefix+"preview");
  const wrap = document.getElementById(prefix+"previewwrap");
  const warningsList = document.getElementById(prefix+"warnings");
  const state = {
    file: null, originalFileName: null, storedFileName: null,
    pending: false, rows: [], error: null, revision: 0,
    url: null, previewFile: null, previewUrl: null,
    page: 1, pageCount: 1, parsed: null, kind: null
  };

  // No-op when there's no dataMm to size against ("None" selected) —
  // the upload block is hidden in that state regardless.
  function updateSizing(){
    const spec = inlaySpec();
    if(!spec || !spec.dataMm) return;
    const { dataMm } = spec;
    wrap.style.width = "100%";
    wrap.style.maxWidth = INLAY_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderInlayFileMeta(currentName, originalName, statusText){
    meta.textContent = "";
    meta.append(statusText ? `file: ${currentName} — ${statusText}` : `file: ${currentName}`);
    if(originalName && originalName !== currentName){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  }

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
    // A plant preview shows the old page; it must not be saved for the new one.
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewFile = state.previewUrl = null;
    renderInlayFileMeta(state.file.name, state.originalFileName, null);
    renderArtwork();
    onStateChange();
  });

  // Swaps the preview box to a plant-generated preview image, taking
  // priority over the live-rendered original — see applyInlaySlotFile
  // below, the only caller (a fresh manual pick never has one to show
  // yet). Reuses the existing file-meta status-text slot instead of
  // adding new markup/CSS for a separate caption. Shared by both the
  // front and back slots (this factory is called once per side).
  function showPreviewImage(previewImgFile){
    if(!state.file) return;
    state.previewFile = previewImgFile;
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${state.previewUrl}" alt="plant preview">`;
    renderInlayFileMeta(state.file.name, state.originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyInlaySlotFile passes the name recorded before renaming, on a
  // project reload, so renderInlayFileMeta can show it as the "was:" line.
  async function handleFile(f, origName = f.name, page = 1){
    const revision = ++state.revision;
    meta.classList.remove("empty");
    renderInlayFileMeta(f.name, origName, "checking…");
    if(state.url) URL.revokeObjectURL(state.url);
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, {
      file: f, originalFileName: origName, storedFileName: null,
      pending: true, rows: [], error: null,
      url: null, previewFile: null, previewUrl: null,
      page: 1, pageCount: 1, parsed: null, kind: null
    });
    onStateChange();

    let kind = null;
    try{
      const buf = await f.arrayBuffer();
      if(state.revision !== revision || state.file !== f) return false;
      kind = sniffFileKind(buf);
      let parsed = null;
      if(kind === "pdf") parsed = await parsePdfArtwork(buf);
      else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
      else if(kind === "tiff") parsed = parseTiffArtwork(buf);
      if(state.revision !== revision || state.file !== f) return false;

      state.parsed = parsed;
      state.kind = kind;
      state.pageCount = (parsed && parsed.pageCount) || 1;
      state.page = Math.min(page, state.pageCount);
      state.url = URL.createObjectURL(f);
      renderArtwork();
      state.pending = false;
      state.error = null;
      renderInlayFileMeta(f.name, origName, null);
    } catch(error){
      if(state.revision !== revision || state.file !== f) return false;
      const { dataMm, trimMm } = inlaySpec();
      const printCheck = getFormat(CONFIG, inlayCurrentFormat()).printCheck;
      state.rows = renderInlayChecklist(warningsList, null, kind, dataMm, trimMm, printCheck);
      state.pending = false;
      state.error = error;
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
      renderInlayFileMeta(f.name, origName, null);
    }
    onStateChange();
    return true;
  }

  // A file picked for one product is sized for that product's dataMm —
  // switching product or format invalidates it outright (see
  // initInlay's listeners), rather than leaving a now-wrong-size file
  // attached.
  function clear(){
    ++state.revision;
    if(state.url) URL.revokeObjectURL(state.url);
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, {
      file: null, originalFileName: null, storedFileName: null,
      pending: false, rows: [], error: null,
      url: null, previewFile: null, previewUrl: null,
      page: 1, pageCount: 1, parsed: null, kind: null
    });
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warningsList.innerHTML = "";
    pageWrap.classList.add("hidden");
  }

  document.getElementById(prefix+"pick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    input.value = ""; // re-picking the same file must fire change again
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> state.file, getOriginalFileName: ()=> state.originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> state.previewFile,
    getState: ()=> state, getPage: ()=> state.page
  };
}

// A multi-page PDF on the front while the back is still open: offer
// its page 2 for the back.
function updateInlayPairOffer(){
  const front = inlayFrontSlot.getState(), back = inlayBackSlot.getState();
  const show = front.pageCount > 1 && !back.file && !back.storedFileName;
  document.getElementById("inlaypair").classList.toggle("hidden", !show);
}

function inlaySlotFileName(variant, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant, ext: fileExt(file.name)});
}

function collectInlaySlotFile(slot, variant){
  const file = slot.getFile();
  if(!file) return null;
  return { name: inlaySlotFileName(variant, file), data: file };
}

let inlayFrontSlot, inlayBackSlot;
let inlayOnStateChange = ()=>{};

function updateInlayVisibility(){
  document.getElementById("inlayBody").classList.toggle("hidden", !inlayIncluded());
}

// Rebuilds the product dropdown from CONFIG for the current format —
// a plain "None" option first, then options grouped by kind (the
// "Unprinted" group is always empty for inlay, so addGroup skips it).
function populateInlayProducts(){
  const select = document.getElementById("inlayProduct");
  const products = inlayProducts();
  const { printed, unprinted } = groupProductsByKind(products);
  select.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "None";
  select.appendChild(noneOpt);
  const addGroup = (label, list) => {
    if(!list.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    for(const p of list){
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      group.appendChild(opt);
    }
    select.appendChild(group);
  };
  addGroup("Printed", printed);
  addGroup("Unprinted", unprinted);
  select.value = "";
}

// Populates the Specifications disclosure from the selected product —
// shows "—" in Paper weight when "None" is selected. Allowed
// filetypes/Colour mode/Data format/Bleed only mean anything for a
// printed product (they describe the artwork FILE) — hidden entirely
// for "None" (inlay never has an unprinted product, so there's no
// other case where these would need hiding). End format/Shipping
// weight need trimMm too (End format IS trimMm; weight is derived
// from its area) — hidden the same way, rather than a dash, for any
// selection that doesn't have one.
function renderInlaySpecs(){
  const part = inlaySpec();
  const printed = !!part && part.kind === "printed";
  const hasSize = !!part && !!part.trimMm;
  document.getElementById("inlaySpecFiletypesRow").classList.toggle("hidden", !printed);
  document.getElementById("inlaySpecColorModeRow").classList.toggle("hidden", !printed);
  document.getElementById("inlaySpecDataFormatRow").classList.toggle("hidden", !printed);
  document.getElementById("inlaySpecBleedRow").classList.toggle("hidden", !printed);
  document.getElementById("inlaySpecEndFormatRow").classList.toggle("hidden", !hasSize);
  document.getElementById("inlaySpecWeightRow").classList.toggle("hidden", !isDebugMode() || !hasSize);
  if(printed){
    const colorMode = getFormat(CONFIG, inlayCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
    document.getElementById("inlaySpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
    document.getElementById("inlaySpecColorMode").textContent = colorMode;
    document.getElementById("inlaySpecDataFormat").textContent = `${part.dataMm.w}×${part.dataMm.h}mm`;
    document.getElementById("inlaySpecBleed").textContent = `${part.bleedMm}mm`;
  }
  if(hasSize){
    document.getElementById("inlaySpecEndFormat").textContent = `${part.trimMm.w}×${part.trimMm.h}mm`;
    document.getElementById("inlaySpecWeight").textContent = `${partWeightG(part)}g`;
  }
  document.getElementById("inlaySpecPaperGsm").textContent = part ? `${part.paperGsm}gsm` : "—";
}

export function initInlay(onStateChange = ()=>{}){
  inlayOnStateChange = onStateChange;
  const onSlotChange = ()=>{ updateInlayPairOffer(); inlayOnStateChange(); };
  inlayFrontSlot = createInlayArtworkSlot("inlayfront", onSlotChange);
  inlayBackSlot = createInlayArtworkSlot("inlayback", onSlotChange);
  document.getElementById("inlaypair").addEventListener("click", ()=>{
    const front = inlayFrontSlot.getState();
    inlayBackSlot.setFile(front.file, front.originalFileName, 2);
  });
  populateInlayProducts();
  [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
  document.getElementById("inlayfrontinput").accept = CONFIG.artworkFileTypes.accept;
  document.getElementById("inlaybackinput").accept = CONFIG.artworkFileTypes.accept;
  renderInlaySpecs();
  updateInlayVisibility();

  document.getElementById("format").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=> s.clear());
    updateInlayPairOffer();
    populateInlayProducts();
    [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
    renderInlaySpecs();
    updateInlayVisibility();
    inlayOnStateChange();
  });

  document.getElementById("inlayProduct").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.clear(); s.updateSizing(); });
    updateInlayPairOffer();
    renderInlaySpecs();
    updateInlayVisibility();
    inlayOnStateChange();
  });
}

function setInlayFileNamePlaceholder(prefix, name, originalName){
  const meta = document.getElementById(prefix+"meta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "";
    meta.append(`file: ${name} — please re-select this file (not stored in the order file)`);
    if(originalName && originalName !== name){
      meta.append(document.createElement("br"));
      const orig = document.createElement("span");
      orig.className = "filemeta-orig";
      orig.textContent = "was: " + originalName;
      meta.append(orig);
    }
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

async function applyInlaySlotFile(slot, prefix, variant, fileName, originalFileName, fileMap, page){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    const current = await slot.setFile(file, originalFileName || fileName, page || 1);
    if(current){
      const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant});
      const previewImg = fileMap && fileMap.get(previewName);
      if(previewImg) slot.setPreviewImage(previewImg);
    }
  } else {
    slot.clear();
    slot.getState().storedFileName = fileName || null;
    setInlayFileNamePlaceholder(prefix, fileName, originalFileName);
  }
}

export function collectInlay(){
  const product = selectedInlayProduct();
  const nameFor = (slot, variant) => {
    if(!product) return null;
    const file = slot.getFile();
    return file ? inlaySlotFileName(variant, file) : null;
  };
  const originalNameFor = (slot) => product && slot.getFile() ? slot.getOriginalFileName() : null;
  return {
    productId: product ? product.id : null,
    front: {
      fileName: nameFor(inlayFrontSlot, "front"),
      originalFileName: originalNameFor(inlayFrontSlot),
      page: product && inlayFrontSlot.getFile() ? inlayFrontSlot.getPage() : 1
    },
    back: {
      fileName: nameFor(inlayBackSlot, "back"),
      originalFileName: originalNameFor(inlayBackSlot),
      page: product && inlayBackSlot.getFile() ? inlayBackSlot.getPage() : 1
    }
  };
}

export async function applyInlay(data, fileMap){
  const inlay = data || {};
  const match = productById(inlayProducts(), inlay.productId);
  document.getElementById("inlayProduct").value = match ? match.id : "";
  await Promise.all([
    applyInlaySlotFile(inlayFrontSlot, "inlayfront", "front", inlay.front && inlay.front.fileName, inlay.front && inlay.front.originalFileName, fileMap, inlay.front && inlay.front.page),
    applyInlaySlotFile(inlayBackSlot, "inlayback", "back", inlay.back && inlay.back.fileName, inlay.back && inlay.back.originalFileName, fileMap, inlay.back && inlay.back.page)
  ]);
  updateInlayVisibility();
  [inlayFrontSlot, inlayBackSlot].forEach(s=> s.updateSizing());
  renderInlaySpecs();
  updateInlayPairOffer();
  inlayOnStateChange();
}

export function inlayIssues(){
  if(!inlayFrontSlot || !inlayBackSlot || !inlayIncluded()) return [];
  const issues = [];
  for(const [name, slot] of [["front", inlayFrontSlot], ["back", inlayBackSlot]]){
    const issue = requiredFileIssue(`Inlay ${name}`, slot.getState());
    if(issue) issues.push(issue);
  }
  return issues;
}

export function collectInlayFiles(){
  const files = [];
  if(inlayIncluded()){
    const front = collectInlaySlotFile(inlayFrontSlot, "front");
    if(front) files.push(front);
    const frontPreview = inlayFrontSlot.getPreviewFile();
    if(frontPreview){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant:"front"});
      files.push({name, data: frontPreview});
    }
    const back = collectInlaySlotFile(inlayBackSlot, "back");
    if(back) files.push(back);
    const backPreview = inlayBackSlot.getPreviewFile();
    if(backPreview){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant:"back"});
      files.push({name, data: backPreview});
    }
  }
  return files;
}
