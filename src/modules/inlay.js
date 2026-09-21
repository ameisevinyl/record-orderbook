// Inlay module — optional double-sided inlay (front + back), delivered
// as two separate square pages (unlike cover.js/inner-sleeve.js's single
// flat spread, since an inlay is printed on both sides of one physical
// sheet). No page count/booklet support — explicitly deferred, see the
// catalogue schema restructure design spec. Split out of the former
// cover-sleeve.js along with cover.js and inner-sleeve.js (Decision 8) —
// each owns its own copy of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// See cover.js's identical comment — flattened build, must stay unique.
const INLAY_PX_PER_MM = 4;
const INLAY_PREVIEW_MAX_W = 640;

function inlayCurrentFormat(){
  return document.getElementById("format").value;
}

function inlaySpec(){
  return getFormat(CONFIG, inlayCurrentFormat()).printableParts.inlay;
}

function renderInlayWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

// prefix is "inlayfront" or "inlayback" — the two sides share this
// scaffolding (unlike cover.js/inner-sleeve.js, which each have exactly
// one slot), since front/back are otherwise identical.
function createInlayArtworkSlot(prefix){
  const input = document.getElementById(prefix+"input");
  const meta = document.getElementById(prefix+"meta");
  const preview = document.getElementById(prefix+"preview");
  const wrap = document.getElementById(prefix+"previewwrap");
  const canvas = document.getElementById(prefix+"sim");
  const warningsList = document.getElementById(prefix+"warnings");
  const simChk = document.getElementById(prefix+"simprint");
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = inlaySpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = INLAY_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * INLAY_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * INLAY_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = inlaySpec();
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

    const { dataMm } = inlaySpec();
    const printCheck = getFormat(CONFIG, inlayCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderInlayWarnings(warningsList, result);

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

  document.getElementById(prefix+"pick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, getFile: ()=> file, setFile: handleFile };
}

function inlaySlotFileName(variant, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant, ext: fileExt(file.name)});
}

async function collectInlaySlotFile(slot, variant){
  const file = slot.getFile();
  if(!file) return null;
  return { name: inlaySlotFileName(variant, file), data: await file.arrayBuffer() };
}

let inlayFrontSlot, inlayBackSlot;

function updateInlayVisibility(){
  document.getElementById("inlayBody").classList.toggle("hidden", !document.getElementById("inlayInclude").checked);
}

export function initInlay(){
  inlayFrontSlot = createInlayArtworkSlot("inlayfront");
  inlayBackSlot = createInlayArtworkSlot("inlayback");
  [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });

  document.getElementById("format").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });
  });

  document.getElementById("inlayInclude").addEventListener("change", updateInlayVisibility);
  updateInlayVisibility();
}

function setInlayFileNamePlaceholder(prefix, name){
  const meta = document.getElementById(prefix+"meta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "file: " + name + " — please re-select this file (not stored in the order file)";
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

function applyInlaySlotFile(slot, prefix, fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) slot.setFile(file);
  else setInlayFileNamePlaceholder(prefix, fileName);
}

export function collectInlay(){
  const inlayInclude = document.getElementById("inlayInclude").checked;
  const nameFor = (slot, variant) => {
    if(!inlayInclude) return null;
    const file = slot.getFile();
    return file ? inlaySlotFileName(variant, file) : null;
  };
  return {
    include: inlayInclude,
    front: {
      simprint: document.getElementById("inlayfrontsimprint").checked,
      fileName: nameFor(inlayFrontSlot, "front")
    },
    back: {
      simprint: document.getElementById("inlaybacksimprint").checked,
      fileName: nameFor(inlayBackSlot, "back")
    }
  };
}

export function applyInlay(data, fileMap){
  const inlay = data || {};
  document.getElementById("inlayInclude").checked = !!inlay.include;
  document.getElementById("inlayfrontsimprint").checked = !!(inlay.front && inlay.front.simprint);
  applyInlaySlotFile(inlayFrontSlot, "inlayfront", inlay.front && inlay.front.fileName, fileMap);
  document.getElementById("inlaybacksimprint").checked = !!(inlay.back && inlay.back.simprint);
  applyInlaySlotFile(inlayBackSlot, "inlayback", inlay.back && inlay.back.fileName, fileMap);
  updateInlayVisibility();
  [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });
}

export async function collectInlayFiles(){
  const files = [];
  if(document.getElementById("inlayInclude").checked){
    const front = await collectInlaySlotFile(inlayFrontSlot, "front");
    if(front) files.push(front);
    const back = await collectInlaySlotFile(inlayBackSlot, "back");
    if(back) files.push(back);
  }
  return files;
}
