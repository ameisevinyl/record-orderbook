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
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// See cover.js's identical comment — flattened build, must stay unique.
const INNER_SLEEVE_PX_PER_MM = 4;
const INNER_SLEEVE_PREVIEW_MAX_W = 640;

function innerSleeveCurrentFormat(){
  return document.getElementById("format").value;
}

function innerSleeveSpec(){
  return getFormat(CONFIG, innerSleeveCurrentFormat()).printableParts.innerSleeve;
}

function renderInnerSleeveWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

function createInnerSleeveArtworkSlot(){
  const input = document.getElementById("innersleeveinput");
  const meta = document.getElementById("innersleevemeta");
  const preview = document.getElementById("innersleevepreview");
  const wrap = document.getElementById("innersleevepreviewwrap");
  const canvas = document.getElementById("innersleevesim");
  const warningsList = document.getElementById("innersleevewarnings");
  const simChk = document.getElementById("innersleevesimprint");
  const caption = document.getElementById("innersleevecaption");
  let file = null, url = null, originalFileName = null;

  function updateSizing(){
    const { dataMm } = innerSleeveSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * INNER_SLEEVE_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * INNER_SLEEVE_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = innerSleeveSpec();
    const inset = computeSpreadInsetPx(canvas.width, canvas.height, dataMm, trimMm);
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(inset.x, inset.y, canvas.width - 2*inset.x, canvas.height - 2*inset.y);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
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

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm } = innerSleeveSpec();
    const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderInnerSleeveWarnings(warningsList, result);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      // No view=Fit — Safari's PDF viewer handles the Acrobat open-
      // parameters fragment inconsistently and can render smaller than
      // the iframe with it present; Chrome/Firefox already fill
      // correctly via the CSS width/height:100% on .label-preview
      // iframe regardless of this fragment, so dropping it is safe.
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
    draw();
  }

  // A file picked for one format is sized for that format's dataMm —
  // switching format invalidates it outright (see initInnerSleeve's
  // format change listener), rather than leaving a now-wrong-size file
  // attached.
  function clear(){
    if(url) URL.revokeObjectURL(url);
    file = null; url = null; originalFileName = null;
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
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, clear, getFile: ()=> file, getOriginalFileName: ()=> originalFileName, setFile: handleFile };
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

export function initInnerSleeve(){
  innerSleeveSlot = createInnerSleeveArtworkSlot();
  innerSleeveSlot.updateSizing();
  innerSleeveSlot.draw();

  document.getElementById("format").addEventListener("change", ()=>{
    innerSleeveSlot.clear();
    innerSleeveSlot.updateSizing();
    innerSleeveSlot.draw();
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

function applyInnerSleeveSlotFile(fileName, originalFileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) innerSleeveSlot.setFile(file, originalFileName || fileName);
  else setInnerSleeveFileNamePlaceholder(fileName, originalFileName);
}

export function collectInnerSleeve(){
  const innerSleevePrinted = document.getElementById("innersleeve-printed").checked;
  const file = innerSleeveSlot.getFile();
  return {
    mode: innerSleevePrinted ? "printed" : "unprinted",
    color: document.getElementById("innersleeveColor").value,
    cutout: document.getElementById("innersleeveCutout").checked,
    simprint: document.getElementById("innersleevesimprint").checked,
    fileName: (innerSleevePrinted && file) ? innerSleeveSlotFileName(file) : null,
    originalFileName: (innerSleevePrinted && file) ? innerSleeveSlot.getOriginalFileName() : null
  };
}

export function applyInnerSleeve(data, fileMap){
  const is = data || {};
  document.getElementById("innersleeve-printed").checked = is.mode === "printed";
  document.getElementById("innersleeve-unprinted").checked = is.mode !== "printed";
  document.getElementById("innersleeveColor").value = is.color || "white";
  document.getElementById("innersleeveCutout").checked = is.cutout !== false;
  document.getElementById("innersleevesimprint").checked = !!is.simprint;
  applyInnerSleeveSlotFile(is.fileName, is.originalFileName, fileMap);
  updateInnerSleeveMode();
  innerSleeveSlot.updateSizing();
  innerSleeveSlot.draw();
}

export async function collectInnerSleeveFiles(){
  const files = [];
  if(document.getElementById("innersleeve-printed").checked){
    const sleeve = await collectInnerSleeveSlotFile();
    if(sleeve) files.push(sleeve);
  }
  return files;
}
