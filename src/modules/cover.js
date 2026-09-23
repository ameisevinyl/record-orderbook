// Cover module — outer cover artwork (printed / printed inside out /
// plain colour / none), delivered as a single flat print file with
// front on the right and back on the left. "Printed inside out" is the
// same artwork file and dimensions as "printed" — it's an assembly
// instruction to the plant (print faces inward once folded), not a
// different layout, so it reuses the exact same artwork slot. Split out
// of the former cover-sleeve.js along with inner-sleeve.js and inlay.js
// (see the catalogue schema restructure design spec, Decision 8) — each
// owns its own copy of the artwork-slot scaffolding on purpose, so each
// part can diverge later without fighting a forced shared abstraction.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

// On-screen preview cap, in px. A flat cover spread can be 600+mm wide —
// displaying that at true CSS-mm size would make the preview several
// times wider than a browser window.
const COVER_PREVIEW_MAX_W = 640;

function coverCurrentFormat(){
  return document.getElementById("format").value;
}

function coverPrintableParts(){
  return getFormat(CONFIG, coverCurrentFormat()).printableParts;
}

// dataMm is derived (trim + bleed — spine's already folded into
// trimMm, see config.js), not a stored field, so it can't drift out
// of sync with trimMm/spineMm/bleedMm.
function coverSpec(){
  const part = coverPrintableParts().outerCover;
  return { ...part, dataMm: flatDataMm(part) };
}

function coverHasArtwork(){
  return document.getElementById("cover-printed").checked
      || document.getElementById("cover-printed-inside-out").checked;
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderCoverChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode());
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
}

function createCoverArtworkSlot(){
  const input = document.getElementById("coverinput");
  const meta = document.getElementById("covermeta");
  const preview = document.getElementById("coverpreview");
  const wrap = document.getElementById("coverpreviewwrap");
  const warningsList = document.getElementById("coverwarnings");
  const caption = document.getElementById("covercaption");
  let file = null, url = null, originalFileName = null;
  let previewFile = null, previewUrl = null;

  function updateSizing(){
    const { dataMm } = coverSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderCoverFileMeta(currentName, originalName, statusText){
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

  // Swaps the preview box to a plant-generated preview image, taking
  // priority over the live-rendered original — see applyCoverSlotFile
  // below, the only caller (a fresh manual pick never has one to show
  // yet). Reuses the existing file-meta status-text slot instead of
  // adding new markup/CSS for a separate caption.
  function showPreviewImage(previewImgFile){
    previewFile = previewImgFile;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${previewUrl}" alt="plant preview">`;
    renderCoverFileMeta(file.name, originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyCoverSlotFile passes the name recorded before renaming, on a
  // project reload, so renderCoverFileMeta can show it as the "was:" line.
  async function handleFile(f, origName = f.name){
    file = f;
    originalFileName = origName;
    meta.classList.remove("empty");
    renderCoverFileMeta(f.name, origName, "checking…");
    if(url) URL.revokeObjectURL(url);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null;
    previewUrl = null;

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = await parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm, trimMm } = coverSpec();
    const printCheck = getFormat(CONFIG, coverCurrentFormat()).printCheck;
    renderCoverChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}). Safari's
      // built-in PDF viewer renders its own margin inside the page content
      // itself — not reachable or fixable from the host page (verified: a
      // CSS-transform-scale attempt scaled that margin right along with
      // it) — so Safari shows a grey margin around the artwork here;
      // Chrome/Firefox fill exactly.
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    renderCoverFileMeta(f.name, origName, null);
  }

  // A file picked for one format is sized for that format's dataMm —
  // switching format invalidates it outright (see initCover's format
  // change listener), rather than leaving a now-wrong-size file attached.
  function clear(){
    if(url) URL.revokeObjectURL(url);
    file = null; url = null; originalFileName = null;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewFile = null; previewUrl = null;
    input.value = "";
    meta.classList.add("empty");
    meta.textContent = "";
    preview.innerHTML = `<div class="label-placeholder">no artwork selected</div>`;
    warningsList.innerHTML = "";
  }

  document.getElementById("coverpick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> previewFile
  };
}

function coverSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"cover", ext: fileExt(file.name)});
}

async function collectCoverSlotFile(){
  const file = coverSlot.getFile();
  if(!file) return null;
  return { name: coverSlotFileName(file), data: await file.arrayBuffer() };
}

let coverSlot;

function updateCoverMode(){
  const unprinted = document.getElementById("cover-unprinted").checked;
  document.getElementById("coverPrintedBody").classList.toggle("hidden", !coverHasArtwork());
  document.getElementById("coverColorWrap").classList.toggle("hidden", !unprinted);
}

// Populates the Specifications disclosure from CONFIG — never
// hand-typed, so it can't drift from the format's actual values.
function renderCoverSpecs(){
  const part = coverSpec();
  const { trimMm, spineMm, bleedMm, paperGsm, dataMm } = part;
  const colorMode = getFormat(CONFIG, coverCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
  document.getElementById("coverSpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
  document.getElementById("coverSpecColorMode").textContent = colorMode;
  document.getElementById("coverSpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
  document.getElementById("coverSpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
  document.getElementById("coverSpecBleed").textContent = `${bleedMm}mm`;
  document.getElementById("coverSpecSpine").textContent = `${spineMm}mm`;
  document.getElementById("coverSpecPaperGsm").textContent = `${paperGsm}gsm`;
  // Shipping weight — plant/?debug eyes only, not customer-facing yet.
  document.getElementById("coverSpecWeightRow").classList.toggle("hidden", !isDebugMode());
  document.getElementById("coverSpecWeight").textContent = `${partWeightG(part)}g`;
}

export function initCover(){
  coverSlot = createCoverArtworkSlot();
  coverSlot.updateSizing();
  document.getElementById("coverinput").accept = CONFIG.artworkFileTypes.accept;
  renderCoverSpecs();

  document.getElementById("format").addEventListener("change", ()=>{
    coverSlot.clear();
    coverSlot.updateSizing();
    renderCoverSpecs();
  });

  document.getElementById("cover-printed").addEventListener("change", updateCoverMode);
  document.getElementById("cover-printed-inside-out").addEventListener("change", updateCoverMode);
  document.getElementById("cover-unprinted").addEventListener("change", updateCoverMode);
  document.getElementById("cover-none").addEventListener("change", updateCoverMode);
  updateCoverMode();
}

function setCoverFileNamePlaceholder(name, originalName){
  const meta = document.getElementById("covermeta");
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

// fileMap: canonical package name -> File, from a reopened project zip
// (see tracklist.js's loadProject). If the slot's stored name is in the
// map, the file gets re-attached directly; otherwise it falls back to
// the "please re-select" placeholder.
async function applyCoverSlotFile(fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    await coverSlot.setFile(file, originalFileName || fileName);
    const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"cover"});
    const previewImg = fileMap && fileMap.get(previewName);
    if(previewImg) coverSlot.setPreviewImage(previewImg);
  } else {
    setCoverFileNamePlaceholder(fileName, originalFileName);
  }
}

// Exported for the tracklist module's project save/load, same
// collect/apply pattern as vinyl-color.js/shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// collectCoverFiles below builds the exact same name for the actual
// file. A non-null fileName always means the file is actually in the
// package, which is what lets the tracklist/order-summary exports build
// their file manifest straight from this data, no DOM re-check needed.
export function collectCover(){
  const hasArtwork = coverHasArtwork();
  const file = coverSlot.getFile();
  return {
    mode: document.getElementById("cover-printed").checked ? "printed"
        : document.getElementById("cover-printed-inside-out").checked ? "printed-inside-out"
        : document.getElementById("cover-unprinted").checked ? "unprinted" : "none",
    color: document.getElementById("coverColor").value,
    fileName: (hasArtwork && file) ? coverSlotFileName(file) : null,
    originalFileName: (hasArtwork && file) ? coverSlot.getOriginalFileName() : null
  };
}

export async function applyCover(data, fileMap){
  const c = data || {};
  document.getElementById("cover-printed").checked = c.mode === "printed";
  document.getElementById("cover-printed-inside-out").checked = c.mode === "printed-inside-out";
  document.getElementById("cover-unprinted").checked = c.mode === "unprinted";
  document.getElementById("cover-none").checked = c.mode !== "printed" && c.mode !== "printed-inside-out" && c.mode !== "unprinted";
  document.getElementById("coverColor").value = c.color || "white";
  await applyCoverSlotFile(c.fileName, c.originalFileName, fileMap);
  updateCoverMode();
  coverSlot.updateSizing();
}

// Exported for the tracklist module's package export, same pattern as
// labels.js's collectLabelFiles — the only interface between modules.
export async function collectCoverFiles(){
  const files = [];
  if(coverHasArtwork()){
    const cover = await collectCoverSlotFile();
    if(cover) files.push(cover);
    const previewImg = coverSlot.getPreviewFile();
    if(previewImg){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"cover"});
      files.push({name, data: await previewImg.arrayBuffer()});
    }
  }
  return files;
}
