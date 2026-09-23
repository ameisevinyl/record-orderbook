// Inner Sleeve module — one product per selection from the plant's
// inner-sleeve catalog (printed, or a specific unprinted colour/paper/
// cut-out combination) — see CONFIG.formats[i].printableParts.
// innerSleeve.products and the packaging product catalog design spec.
// Always required (never "none") — a sleeve protects the record, so
// the dropdown never offers that option, unlike cover/inlay. Delivered
// as a single flat print file with front on the right and back on the
// left, when the selected product is printed. Split out of the former
// cover-sleeve.js along with cover.js and inlay.js (see the catalogue
// schema restructure design spec, Decision 8) — each owns its own copy
// of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat, flatDataMm, partWeightG, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";
import { requiredFileIssue } from "../lib/file-issues.js";

const INNER_SLEEVE_PREVIEW_MAX_W = 640;

function innerSleeveCurrentFormat(){
  return document.getElementById("format").value;
}

function innerSleeveProducts(){
  return getFormat(CONFIG, innerSleeveCurrentFormat()).printableParts.innerSleeve.products;
}

function selectedInnerSleeveProduct(){
  return productById(innerSleeveProducts(), document.getElementById("innersleeveProduct").value || null);
}

// dataMm is derived (trim + bleed — trimMm is already the flat-opened,
// unfolded spread; finalMm, separately, is the folded pocket size the
// customer actually receives), not a stored field. Only a printed
// product carries trimMm/bleedMm at all (they describe the artwork
// file) — dataMm is undefined for an unprinted product, which has none.
function innerSleeveSpec(){
  const part = selectedInnerSleeveProduct();
  return part && { ...part, dataMm: part.trimMm ? flatDataMm(part) : undefined };
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
  return rows;
}

function createInnerSleeveArtworkSlot(onStateChange){
  const input = document.getElementById("innersleeveinput");
  const meta = document.getElementById("innersleevemeta");
  const preview = document.getElementById("innersleevepreview");
  const wrap = document.getElementById("innersleevepreviewwrap");
  const warningsList = document.getElementById("innersleevewarnings");
  const caption = document.getElementById("innersleevecaption");
  const state = {
    file: null, originalFileName: null, storedFileName: null,
    pending: false, rows: [], error: null, revision: 0,
    url: null, previewFile: null, previewUrl: null
  };

  // No-op when there's no dataMm to size against — either nothing is
  // selected (only possible transiently, since inner sleeve always has
  // a default product once populateInnerSleeveProducts has run), or the
  // selected product is unprinted (no artwork file, so no data size);
  // the upload block is hidden in the latter case regardless.
  function updateSizing(){
    const spec = innerSleeveSpec();
    if(!spec || !spec.dataMm) return;
    const { dataMm } = spec;
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
    if(!state.file) return;
    state.previewFile = previewImgFile;
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(previewImgFile);
    preview.innerHTML = `<img src="${state.previewUrl}" alt="plant preview">`;
    renderInnerSleeveFileMeta(state.file.name, state.originalFileName, "plant preview");
  }

  // origName defaults to the file's own name (a fresh manual pick);
  // applyInnerSleeveSlotFile passes the name recorded before renaming, on
  // a project reload, so renderInnerSleeveFileMeta can show it as the
  // "was:" line.
  async function handleFile(f, origName = f.name){
    const revision = ++state.revision;
    meta.classList.remove("empty");
    renderInnerSleeveFileMeta(f.name, origName, "checking…");
    if(state.url) URL.revokeObjectURL(state.url);
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, {
      file: f, originalFileName: origName, storedFileName: null,
      pending: true, rows: [], error: null,
      url: null, previewFile: null, previewUrl: null
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

      const { dataMm, trimMm } = innerSleeveSpec();
      const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
      state.rows = renderInnerSleeveChecklist(warningsList, parsed, kind, dataMm, trimMm, printCheck);
      state.pending = false;
      state.error = null;

      state.url = URL.createObjectURL(f);
      if(kind === "pdf"){
        // Fills via CSS (.label-preview iframe{width/height:100%}) — see
        // cover.js's identical comment on Safari's PDF viewer margin.
        preview.innerHTML = `<iframe src="${state.url}#toolbar=0&navpanes=0"></iframe>`;
      } else if(kind === "jpeg"){
        preview.innerHTML = `<img src="${state.url}" alt="artwork">`;
      } else if(kind === "tiff"){
        const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
        preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
      } else{
        preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
      }
      renderInnerSleeveFileMeta(f.name, origName, null);
    } catch(error){
      if(state.revision !== revision || state.file !== f) return false;
      const { dataMm, trimMm } = innerSleeveSpec();
      const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
      state.rows = renderInnerSleeveChecklist(warningsList, null, kind, dataMm, trimMm, printCheck);
      state.pending = false;
      state.error = error;
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
      renderInnerSleeveFileMeta(f.name, origName, null);
    }
    onStateChange();
    return true;
  }

  // A file picked for one product is sized for that product's dataMm —
  // switching product or format invalidates it outright (see
  // initInnerSleeve's listeners), rather than leaving a now-wrong-size
  // file attached.
  function clear(){
    ++state.revision;
    if(state.url) URL.revokeObjectURL(state.url);
    if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    Object.assign(state, {
      file: null, originalFileName: null, storedFileName: null,
      pending: false, rows: [], error: null,
      url: null, previewFile: null, previewUrl: null
    });
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
    updateSizing, clear, getFile: ()=> state.file, getOriginalFileName: ()=> state.originalFileName,
    setFile: handleFile, setPreviewImage: showPreviewImage, getPreviewFile: ()=> state.previewFile,
    getState: ()=> state
  };
}

function innerSleeveSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve", ext: fileExt(file.name)});
}

function collectInnerSleeveSlotFile(){
  const file = innerSleeveSlot.getFile();
  if(!file) return null;
  return { name: innerSleeveSlotFileName(file), data: file };
}

let innerSleeveSlot;
let innerSleeveOnStateChange = ()=>{};

function innerSleeveHasArtwork(){
  const product = selectedInnerSleeveProduct();
  return !!product && product.kind === "printed";
}

function updateInnerSleeveMode(){
  document.getElementById("innersleevePrintedBody").classList.toggle("hidden", !innerSleeveHasArtwork());
}

// Rebuilds the product dropdown from CONFIG for the current format —
// options grouped by kind (Printed/Unprinted), no "None" entry (a
// sleeve is always required). Pre-selects the product flagged
// default:true.
function populateInnerSleeveProducts(){
  const select = document.getElementById("innersleeveProduct");
  const products = innerSleeveProducts();
  const { printed, unprinted } = groupProductsByKind(products);
  select.innerHTML = "";
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
  const defaultProduct = products.find(p => p.default) || products[0];
  select.value = defaultProduct.id;
}

// Populates the Specifications disclosure from the selected product —
// never hand-typed, so it can't drift from the format's actual values.
// Allowed filetypes/Colour mode/Data format/Bleed only mean anything
// for a printed product (they describe the artwork FILE, and an
// unprinted product has none) — hidden entirely for an unprinted
// selection, not just left blank. End format/Shipping weight need
// trimMm too (End format IS trimMm; weight is derived from its area) —
// an unprinted product without one hides those the same way. Final
// size (finalMm) stays unconditional — it's the folded/closed size the
// customer receives, unrelated to whether there's an artwork file.
function renderInnerSleeveSpecs(){
  const part = innerSleeveSpec();
  const { finalMm, trimMm, bleedMm, paperGsm, cutoutDiameterMm, dataMm, kind } = part;
  const printed = kind === "printed";
  const hasSize = !!trimMm;
  document.getElementById("innersleeveSpecFiletypesRow").classList.toggle("hidden", !printed);
  document.getElementById("innersleeveSpecColorModeRow").classList.toggle("hidden", !printed);
  document.getElementById("innersleeveSpecDataFormatRow").classList.toggle("hidden", !printed);
  document.getElementById("innersleeveSpecBleedRow").classList.toggle("hidden", !printed);
  document.getElementById("innersleeveSpecEndFormatRow").classList.toggle("hidden", !hasSize);
  document.getElementById("innersleeveSpecWeightRow").classList.toggle("hidden", !isDebugMode() || !hasSize);
  if(printed){
    const colorMode = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck.checks.colorMode.accepted.join("/");
    document.getElementById("innersleeveSpecFiletypes").textContent = CONFIG.artworkFileTypes.labels.join(", ");
    document.getElementById("innersleeveSpecColorMode").textContent = colorMode;
    document.getElementById("innersleeveSpecDataFormat").textContent = `${dataMm.w}×${dataMm.h}mm`;
    document.getElementById("innersleeveSpecBleed").textContent = `${bleedMm}mm`;
  }
  document.getElementById("innersleeveSpecFinalSize").textContent = `${finalMm.w}×${finalMm.h}mm`;
  if(hasSize){
    document.getElementById("innersleeveSpecEndFormat").textContent = `${trimMm.w}×${trimMm.h}mm`;
    document.getElementById("innersleeveSpecWeight").textContent = `${partWeightG(part)}g`;
  }
  document.getElementById("innersleeveSpecPaperGsm").textContent = `${paperGsm}gsm`;
  document.getElementById("innersleeveSpecCutout").textContent = cutoutDiameterMm ? `⌀${cutoutDiameterMm}mm` : "none";
}

export function initInnerSleeve(onStateChange = ()=>{}){
  innerSleeveOnStateChange = onStateChange;
  innerSleeveSlot = createInnerSleeveArtworkSlot(()=> innerSleeveOnStateChange());
  populateInnerSleeveProducts();
  innerSleeveSlot.updateSizing();
  document.getElementById("innersleeveinput").accept = CONFIG.artworkFileTypes.accept;
  renderInnerSleeveSpecs();
  updateInnerSleeveMode();

  document.getElementById("format").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    populateInnerSleeveProducts();
    innerSleeveSlot.updateSizing();
    renderInnerSleeveSpecs();
    updateInnerSleeveMode();
    innerSleeveOnStateChange();
  });

  document.getElementById("innersleeveProduct").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    innerSleeveSlot.updateSizing();
    renderInnerSleeveSpecs();
    updateInnerSleeveMode();
    innerSleeveOnStateChange();
  });
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
    const current = await innerSleeveSlot.setFile(file, originalFileName || fileName);
    if(current){
      const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
      const previewImg = fileMap && fileMap.get(previewName);
      if(previewImg) innerSleeveSlot.setPreviewImage(previewImg);
    }
  } else {
    innerSleeveSlot.clear();
    innerSleeveSlot.getState().storedFileName = fileName || null;
    setInnerSleeveFileNamePlaceholder(fileName, originalFileName);
  }
}

export function collectInnerSleeve(){
  const product = selectedInnerSleeveProduct();
  const file = innerSleeveSlot.getFile();
  const printed = !!product && product.kind === "printed";
  return {
    productId: product ? product.id : null,
    fileName: (printed && file) ? innerSleeveSlotFileName(file) : null,
    originalFileName: (printed && file) ? innerSleeveSlot.getOriginalFileName() : null
  };
}

export async function applyInnerSleeve(data, fileMap){
  const is = data || {};
  const products = innerSleeveProducts();
  const match = productById(products, is.productId);
  const fallback = products.find(p => p.default) || products[0];
  document.getElementById("innersleeveProduct").value = (match || fallback).id;
  await applyInnerSleeveSlotFile(is.fileName, is.originalFileName, fileMap);
  updateInnerSleeveMode();
  innerSleeveSlot.updateSizing();
  renderInnerSleeveSpecs();
  innerSleeveOnStateChange();
}

export function innerSleeveIssues(){
  if(!innerSleeveSlot || !innerSleeveHasArtwork()) return [];
  const issue = requiredFileIssue("Inner sleeve", innerSleeveSlot.getState());
  return issue ? [issue] : [];
}

export function collectInnerSleeveFiles(){
  const files = [];
  if(innerSleeveHasArtwork()){
    const sleeve = collectInnerSleeveSlotFile();
    if(sleeve) files.push(sleeve);
    const previewImg = innerSleeveSlot.getPreviewFile();
    if(previewImg){
      const name = previewFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve"});
      files.push({name, data: previewImg});
    }
  }
  return files;
}
