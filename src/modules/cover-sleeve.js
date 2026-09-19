// Cover / Inner Sleeve / Inlay module — outer cover artwork, inner
// sleeve (printed or plain-colour with a center cut-out), and an
// optional double-sided inlay. All are delivered as a single flat
// print file, opened out with front on the right and back on the
// left (the inlay's front/back are two separate square pages instead,
// since it's printed on both sides of one physical sheet).
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js. Print simulation here is simpler than a
// record label's circular trim: just crop the bleed off a rectangle.

import { CONFIG } from "../config.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// Canvas render resolution in pixels-per-mm (see labels.js for the same
// idea) — named distinctly to avoid colliding with labels.js's own
// PX_PER_MM once both files are flattened into one script by the build.
const CS_PX_PER_MM = 4;

// On-screen preview cap, in px. Unlike labels.js's small circular labels
// (shown near true print size), a cover/sleeve flat spread can be 600+mm
// wide — displaying that at true CSS-mm size would make the preview
// several times wider than a browser window. Cap it and let it shrink
// further via width:100% inside narrower layouts (the inlay's two-column
// row). Canvas render resolution above is unaffected by this.
const CS_PREVIEW_MAX_W = 640;

function csCurrentFormat(){
  return parseInt(document.getElementById("format").value, 10);
}

function csRenderWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

// One reusable file-upload+preview+validate+bleed-simulate unit. Used
// for the cover, the printed inner sleeve, and each inlay side — they
// all follow the same shape, just against a different {dataMm,trimMm}.
function createArtworkSlot(prefix, getSpec){
  const input = document.getElementById(prefix+"input");
  const meta = document.getElementById(prefix+"meta");
  const preview = document.getElementById(prefix+"preview");
  const wrap = document.getElementById(prefix+"previewwrap");
  const canvas = document.getElementById(prefix+"sim");
  const warningsList = document.getElementById(prefix+"warnings");
  const simChk = document.getElementById(prefix+"simprint");
  const caption = document.getElementById(prefix+"caption"); // cover/inner sleeve only — inlay has none
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = getSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = CS_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * CS_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * CS_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    if(caption){ caption.style.width = "100%"; caption.style.maxWidth = CS_PREVIEW_MAX_W+"px"; }
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = getSpec();
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

    const { dataMm } = getSpec();
    const result = validateArtwork(
      parsed, dataMm, CONFIG.coverSleeve.sizeToleranceMm, CONFIG.coverSleeve.dpi.min, CONFIG.coverSleeve.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    csRenderWarnings(warningsList, result);

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

  return {
    updateSizing, draw,
    getFile: ()=> file,
    setFile: handleFile
  };
}

function slotFileName(part, variant, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part, variant, ext: fileExt(file.name)});
}

async function collectSlotFile(slot, part, variant){
  const file = slot.getFile();
  if(!file) return null;
  return { name: slotFileName(part, variant, file), data: await file.arrayBuffer() };
}

let coverSlot, innerSleeveSlot, inlayFrontSlot, inlayBackSlot;

function updateInnerSleeveMode(){
  const unprinted = document.getElementById("innersleeve-unprinted").checked;
  document.getElementById("innersleevePrintedBody").classList.toggle("hidden", unprinted);
  document.getElementById("innersleeveColorWrap").classList.toggle("hidden", !unprinted);
}

function updateCoverMode(){
  const printed = document.getElementById("cover-printed").checked;
  const unprinted = document.getElementById("cover-unprinted").checked;
  document.getElementById("coverPrintedBody").classList.toggle("hidden", !printed);
  document.getElementById("coverColorWrap").classList.toggle("hidden", !unprinted);
}

function updateInlayVisibility(){
  document.getElementById("inlayBody").classList.toggle("hidden", !document.getElementById("inlayInclude").checked);
}

export function initCoverSleeve(){
  coverSlot = createArtworkSlot("cover", ()=> CONFIG.coverSleeve.outerCover.formats[csCurrentFormat()]);
  innerSleeveSlot = createArtworkSlot("innersleeve", ()=> CONFIG.coverSleeve.innerSleeve.formats[csCurrentFormat()]);
  inlayFrontSlot = createArtworkSlot("inlayfront", ()=> CONFIG.coverSleeve.inlay.formats[csCurrentFormat()]);
  inlayBackSlot = createArtworkSlot("inlayback", ()=> CONFIG.coverSleeve.inlay.formats[csCurrentFormat()]);

  const allSlots = [coverSlot, innerSleeveSlot, inlayFrontSlot, inlayBackSlot];
  allSlots.forEach(s=>{ s.updateSizing(); s.draw(); });

  document.getElementById("format").addEventListener("change", ()=>{
    allSlots.forEach(s=>{ s.updateSizing(); s.draw(); });
  });

  document.getElementById("innersleeve-printed").addEventListener("change", updateInnerSleeveMode);
  document.getElementById("innersleeve-unprinted").addEventListener("change", updateInnerSleeveMode);
  updateInnerSleeveMode();

  document.getElementById("cover-printed").addEventListener("change", updateCoverMode);
  document.getElementById("cover-unprinted").addEventListener("change", updateCoverMode);
  document.getElementById("cover-none").addEventListener("change", updateCoverMode);
  updateCoverMode();

  document.getElementById("inlayInclude").addEventListener("change", updateInlayVisibility);
  updateInlayVisibility();
}

function setFileNamePlaceholder(prefix, name){
  const meta = document.getElementById(prefix+"meta");
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
function applySlotFile(slot, prefix, fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) slot.setFile(file);
  else setFileNamePlaceholder(prefix, fileName);
}

// Exported for the tracklist module's project save/load, same
// collect/apply pattern as vinyl-color.js and shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// collectCoverSleeveFiles below builds the exact same name for the
// actual file.
export function collectCoverSleeve(){
  const nameFor = (slot, part, variant) => {
    const file = slot.getFile();
    return file ? slotFileName(part, variant, file) : null;
  };
  return {
    innerSleeve: {
      mode: document.getElementById("innersleeve-printed").checked ? "printed" : "unprinted",
      color: document.getElementById("innersleeveColor").value,
      cutout: document.getElementById("innersleeveCutout").checked,
      simprint: document.getElementById("innersleevesimprint").checked,
      fileName: nameFor(innerSleeveSlot, "innersleeve")
    },
    cover: {
      mode: document.getElementById("cover-printed").checked ? "printed"
          : document.getElementById("cover-unprinted").checked ? "unprinted" : "none",
      color: document.getElementById("coverColor").value,
      simprint: document.getElementById("coversimprint").checked,
      fileName: nameFor(coverSlot, "cover")
    },
    inlay: {
      include: document.getElementById("inlayInclude").checked,
      front: {
        simprint: document.getElementById("inlayfrontsimprint").checked,
        fileName: nameFor(inlayFrontSlot, "inlay", "front")
      },
      back: {
        simprint: document.getElementById("inlaybacksimprint").checked,
        fileName: nameFor(inlayBackSlot, "inlay", "back")
      }
    }
  };
}

export function applyCoverSleeve(data, fileMap){
  const d = data || {};

  const is = d.innerSleeve || {};
  document.getElementById("innersleeve-printed").checked = is.mode === "printed";
  document.getElementById("innersleeve-unprinted").checked = is.mode !== "printed";
  document.getElementById("innersleeveColor").value = is.color || "white";
  document.getElementById("innersleeveCutout").checked = is.cutout !== false;
  document.getElementById("innersleevesimprint").checked = !!is.simprint;
  applySlotFile(innerSleeveSlot, "innersleeve", is.fileName, fileMap);
  updateInnerSleeveMode();

  const c = d.cover || {};
  document.getElementById("cover-printed").checked = c.mode === "printed";
  document.getElementById("cover-unprinted").checked = c.mode === "unprinted";
  document.getElementById("cover-none").checked = c.mode !== "printed" && c.mode !== "unprinted";
  document.getElementById("coverColor").value = c.color || "white";
  document.getElementById("coversimprint").checked = !!c.simprint;
  applySlotFile(coverSlot, "cover", c.fileName, fileMap);
  updateCoverMode();

  const inlay = d.inlay || {};
  document.getElementById("inlayInclude").checked = !!inlay.include;
  document.getElementById("inlayfrontsimprint").checked = !!(inlay.front && inlay.front.simprint);
  applySlotFile(inlayFrontSlot, "inlayfront", inlay.front && inlay.front.fileName, fileMap);
  document.getElementById("inlaybacksimprint").checked = !!(inlay.back && inlay.back.simprint);
  applySlotFile(inlayBackSlot, "inlayback", inlay.back && inlay.back.fileName, fileMap);
  updateInlayVisibility();

  [coverSlot, innerSleeveSlot, inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });
}

// Exported for the tracklist module's package export, same pattern as
// labels.js's collectLabelFiles — the only interface between modules.
export async function collectCoverSleeveFiles(){
  const files = [];
  if(document.getElementById("cover-printed").checked){
    const cover = await collectSlotFile(coverSlot, "cover");
    if(cover) files.push(cover);
  }

  if(document.getElementById("innersleeve-printed").checked){
    const sleeve = await collectSlotFile(innerSleeveSlot, "innersleeve");
    if(sleeve) files.push(sleeve);
  }

  if(document.getElementById("inlayInclude").checked){
    const front = await collectSlotFile(inlayFrontSlot, "inlay", "front");
    if(front) files.push(front);
    const back = await collectSlotFile(inlayBackSlot, "inlay", "back");
    if(back) files.push(back);
  }

  return files;
}
