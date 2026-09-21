// Cover module — outer cover artwork (printed / plain colour / none),
// delivered as a single flat print file with front on the right and back
// on the left. Split out of the former cover-sleeve.js along with
// inner-sleeve.js and inlay.js (see the catalogue schema restructure
// design spec, Decision 8) — each owns its own copy of the artwork-slot
// scaffolding on purpose, so each part can diverge later without
// fighting a forced shared abstraction.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// Canvas render resolution in pixels-per-mm — named distinctly per
// printed-part module (see build/build.js's header comment: everything
// flattens into one shared top-level scope, so labels.js's PX_PER_MM and
// inner-sleeve.js's/inlay.js's own constants can't collide with this).
const COVER_PX_PER_MM = 4;

// On-screen preview cap, in px. A flat cover spread can be 600+mm wide —
// displaying that at true CSS-mm size would make the preview several
// times wider than a browser window. Canvas render resolution above is
// unaffected by this.
const COVER_PREVIEW_MAX_W = 640;

function coverCurrentFormat(){
  return document.getElementById("format").value;
}

function coverSpec(){
  return getFormat(CONFIG, coverCurrentFormat()).printableParts.outerCover;
}

function renderCoverWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

function createCoverArtworkSlot(){
  const input = document.getElementById("coverinput");
  const meta = document.getElementById("covermeta");
  const preview = document.getElementById("coverpreview");
  const wrap = document.getElementById("coverpreviewwrap");
  const canvas = document.getElementById("coversim");
  const warningsList = document.getElementById("coverwarnings");
  const simChk = document.getElementById("coversimprint");
  const caption = document.getElementById("covercaption");
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = coverSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * COVER_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * COVER_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = coverSpec();
    const inset = computeSpreadInsetPx(canvas.width, canvas.height, dataMm, trimMm);
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(inset.x, inset.y, canvas.width - 2*inset.x, canvas.height - 2*inset.y);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
  }

  async function handleFile(f){
    file = f;
    meta.classList.remove("empty");
    meta.textContent = "file: " + f.name + " — checking…";
    if(url) URL.revokeObjectURL(url);

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm } = coverSpec();
    const printCheck = getFormat(CONFIG, coverCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderCoverWarnings(warningsList, result);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&view=Fit"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    meta.textContent = "file: " + f.name;
    draw();
  }

  document.getElementById("coverpick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, getFile: ()=> file, setFile: handleFile };
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
  const printed = document.getElementById("cover-printed").checked;
  const unprinted = document.getElementById("cover-unprinted").checked;
  document.getElementById("coverPrintedBody").classList.toggle("hidden", !printed);
  document.getElementById("coverColorWrap").classList.toggle("hidden", !unprinted);
}

export function initCover(){
  coverSlot = createCoverArtworkSlot();
  coverSlot.updateSizing();
  coverSlot.draw();

  document.getElementById("format").addEventListener("change", ()=>{
    coverSlot.updateSizing();
    coverSlot.draw();
  });

  document.getElementById("cover-printed").addEventListener("change", updateCoverMode);
  document.getElementById("cover-unprinted").addEventListener("change", updateCoverMode);
  document.getElementById("cover-none").addEventListener("change", updateCoverMode);
  updateCoverMode();
}

function setCoverFileNamePlaceholder(name){
  const meta = document.getElementById("covermeta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "file: " + name + " — please re-select this file (not stored in the order file)";
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

// fileMap: canonical package name -> File, from a reopened project zip
// (see tracklist.js's loadProject). If the slot's stored name is in the
// map, the file gets re-attached directly; otherwise it falls back to
// the "please re-select" placeholder.
function applyCoverSlotFile(fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) coverSlot.setFile(file);
  else setCoverFileNamePlaceholder(fileName);
}

// Exported for the tracklist module's project save/load, same
// collect/apply pattern as vinyl-color.js/shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// collectCoverFiles below builds the exact same name for the actual
// file. A non-null fileName always means the file is actually in the
// package, which is what lets the tracklist/order-summary exports build
// their file manifest straight from this data, no DOM re-check needed.
export function collectCover(){
  const coverPrinted = document.getElementById("cover-printed").checked;
  const file = coverSlot.getFile();
  return {
    mode: coverPrinted ? "printed"
        : document.getElementById("cover-unprinted").checked ? "unprinted" : "none",
    color: document.getElementById("coverColor").value,
    simprint: document.getElementById("coversimprint").checked,
    fileName: (coverPrinted && file) ? coverSlotFileName(file) : null
  };
}

export function applyCover(data, fileMap){
  const c = data || {};
  document.getElementById("cover-printed").checked = c.mode === "printed";
  document.getElementById("cover-unprinted").checked = c.mode === "unprinted";
  document.getElementById("cover-none").checked = c.mode !== "printed" && c.mode !== "unprinted";
  document.getElementById("coverColor").value = c.color || "white";
  document.getElementById("coversimprint").checked = !!c.simprint;
  applyCoverSlotFile(c.fileName, fileMap);
  updateCoverMode();
  coverSlot.updateSizing();
  coverSlot.draw();
}

// Exported for the tracklist module's package export, same pattern as
// labels.js's collectLabelFiles — the only interface between modules.
export async function collectCoverFiles(){
  const files = [];
  if(document.getElementById("cover-printed").checked){
    const cover = await collectCoverSlotFile();
    if(cover) files.push(cover);
  }
  return files;
}
