// Inner Sleeve module — printed or plain-colour inner sleeve, optional
// center cut-out. Delivered as a single flat print file with front on
// the right and back on the left. Split out of the former
// cover-sleeve.js along with cover.js and inlay.js (see the catalogue
// schema restructure design spec, Decision 8) — each owns its own copy
// of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, foldedDataMm, bleedFor } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

const INNER_SLEEVE_PREVIEW_MAX_W = 640;

function innerSleeveCurrentFormat(){
  return document.getElementById("format").value;
}

function innerSleevePrintableParts(){
  return getFormat(CONFIG, innerSleeveCurrentFormat()).printableParts;
}

// dataMm is derived (trimMm is ONE folded pocket's size — foldedDataMm
// doubles the width for the flat-opened print file), not a stored
// field.
function innerSleeveSpec(){
  const parts = innerSleevePrintableParts();
  return { ...parts.innerSleeve, dataMm: foldedDataMm(parts.innerSleeve, parts) };
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderInnerSleeveChecklist(tableEl, parsed, kind, targetMm, trimMm, printCheck){
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

function createInnerSleeveArtworkSlot(){
  const input = document.getElementById("innersleeveinput");
  const meta = document.getElementById("innersleevemeta");
  const preview = document.getElementById("innersleevepreview");
  const wrap = document.getElementById("innersleevepreviewwrap");
  const warningsList = document.getElementById("innersleevewarnings");
  const caption = document.getElementById("innersleevecaption");
  let file = null, url = null, originalFileName = null;
  let previewFile = null, previewUrl = null;

  function updateSizing(){
    const { dataMm } = innerSleeveSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
  }

  // "file: <current name>", plus a tight second line with the original
  // filename when it differs — only true after a project reload
  // re-attaches a file by its renamed (convention) name; a fresh manual
  // pick has nothing to show there. Built with DOM nodes rather than
  // innerHTML since file names are untrusted strings (the customer's
  // own upload) — see tracklist.js's renderFileMeta for the same idea.
  function renderInnerSleeveFileMeta(currentName, originalName, statusText){
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
  // priority over the live-rendered original — see
  // applyInnerSleeveSlotFile below, the only caller (a fresh manual pick
  // never has one to show yet). Reuses the existing file-meta
  // status-text slot instead of adding new markup/CSS for a separate
  // caption.
  function showPreviewImage(previewImgFile){
    previewFile = previewImgFile;
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${previewUrl}" alt="plant preview">`;
    renderInnerSleeveFileMeta(file.name, originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyInnerSleeveSlotFile passes the name recorded before renaming, on
  // a project reload, so renderInnerSleeveFileMeta can show it as the
  // "was:" line.
  async function handleFile(f, origName = f.name){
    file = f;
    originalFileName = origName;
    meta.classList.remove("empty");
    renderInnerSleeveFileMeta(f.name, origName, "checking…");
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

    const { dataMm, trimMm } = innerSleeveSpec();
    const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
    renderInnerSleeveChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    renderInnerSleeveFileMeta(f.name, origName, null);
  }

  // A file picked for one format is sized for that format's dataMm —
  // switching format invalidates it outright (see initInnerSleeve's
  // format change listener), rather than leaving a now-wrong-size file
  // attached.
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

  document.getElementById("innersleevepick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });

  return {
    updateSizing, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> previewFile
  };
}

function innerSleeveSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve", ext: fileExt(file.name)});
}

async function collectInnerSleeveSlotFile(){
  const file = innerSleeveSlot.getFile();
  if(!file) return null;
  return { name: innerSleeveSlotFileName(file), data: await file.arrayBuffer() };
}

let innerSleeveSlot;

function updateInnerSleeveMode(){
  const unprinted = document.getElementById("innersleeve-unprinted").checked;
  document.getElementById("innersleevePrintedBody").classList.toggle("hidden", unprinted);
  document.getElementById("innersleeveColorWrap").classList.toggle("hidden", !unprinted);
}

// Populates the Specifications disclosure from CONFIG — never
// hand-typed, so it can't drift from the format's actual values.
function renderInnerSleeveSpecs(){
  const parts = innerSleevePrintableParts();
  const { trimMm, dataMm } = innerSleeveSpec();
  const bleedMm = bleedFor(parts.innerSleeve, parts);
  const colorMode = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
  document.getElementById("innersleeveSpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
  document.getElementById("innersleeveSpecColorMode").textContent = colorMode;
  document.getElementById("innersleeveSpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
  document.getElementById("innersleeveSpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
  document.getElementById("innersleeveSpecBleed").textContent = `${bleedMm}mm`;
}

export function initInnerSleeve(){
  innerSleeveSlot = createInnerSleeveArtworkSlot();
  innerSleeveSlot.updateSizing();
  document.getElementById("innersleeveinput").accept = CONFIG.artworkFileTypes.accept;
  renderInnerSleeveSpecs();

  document.getElementById("format").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    innerSleeveSlot.updateSizing();
    renderInnerSleeveSpecs();
  });

  document.getElementById("innersleeve-printed").addEventListener("change", updateInnerSleeveMode);
  document.getElementById("innersleeve-unprinted").addEventListener("change", updateInnerSleeveMode);
  updateInnerSleeveMode();
}

function setInnerSleeveFileNamePlaceholder(name, originalName){
  const meta = document.getElementById("innersleevemeta");
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

async function applyInnerSleeveSlotFile(fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file){
    await innerSleeveSlot.setFile(file, originalFileName || fileName);
    const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
    const previewImg = fileMap && fileMap.get(previewName);
    if(previewImg) innerSleeveSlot.setPreviewImage(previewImg);
  } else {
    setInnerSleeveFileNamePlaceholder(fileName, originalFileName);
  }
}

export function collectInnerSleeve(){
  const innerSleevePrinted = document.getElementById("innersleeve-printed").checked;
  const file = innerSleeveSlot.getFile();
  return {
    mode: innerSleevePrinted ? "printed" : "unprinted",
    color: document.getElementById("innersleeveColor").value,
    cutout: document.getElementById("innersleeveCutout").checked,
    fileName: (innerSleevePrinted && file) ? innerSleeveSlotFileName(file) : null,
    originalFileName: (innerSleevePrinted && file) ? innerSleeveSlot.getOriginalFileName() : null
  };
}

export async function applyInnerSleeve(data, fileMap){
  const is = data || {};
  document.getElementById("innersleeve-printed").checked = is.mode === "printed";
  document.getElementById("innersleeve-unprinted").checked = is.mode !== "printed";
  document.getElementById("innersleeveColor").value = is.color || "white";
  document.getElementById("innersleeveCutout").checked = is.cutout !== false;
  await applyInnerSleeveSlotFile(is.fileName, is.originalFileName, fileMap);
  updateInnerSleeveMode();
  innerSleeveSlot.updateSizing();
}

export async function collectInnerSleeveFiles(){
  const files = [];
  if(document.getElementById("innersleeve-printed").checked){
    const sleeve = await collectInnerSleeveSlotFile();
    if(sleeve) files.push(sleeve);
    const previewImg = innerSleeveSlot.getPreviewFile();
    if(previewImg){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
      files.push({name, data: await previewImg.arrayBuffer()});
    }
  }
  return files;
}
