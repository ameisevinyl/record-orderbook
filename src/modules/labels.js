// Labels module — per-side artwork upload, best-effort validation
// (physical size, resolution, CMYK). All the parsing/validation logic
// is pure and lives in ../lib/label-artwork.js; this file is DOM
// wiring only.
//
// This is a front-end sanity check, not the real gate — the studio's
// backend preprocessor does the authoritative validation on upload and
// rejects faulty files. Catching the obvious mistakes here just saves
// customer service a round trip.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork } from "../lib/print-artwork.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";

const SIDES = ["A", "B"];

function currentFormat(){
  return document.getElementById("format").value;
}

function formatSpec(){
  return getFormat(CONFIG, currentFormat()).printableParts.label;
}

function labelSideTemplate(side){
  return `
  <div class="side-box" id="labelbox-${side}">
    <div class="side-head">
      <h2>Label ${side}</h2>
      <div class="side-opts">
        <label class="chk"><input type="checkbox" id="whitelabel-${side}"> whitelabel (blank)</label>
      </div>
    </div>

    <div id="labelbody-${side}">
      <div class="row" style="align-items:end;">
        <div class="field" style="flex:0 0 auto;">
          <label>&nbsp;</label>
          <button type="button" class="pickbtn no-print" id="labelpick-${side}" title="Choose label artwork">⏏</button>
        </div>
        <div class="field">
          <label style="display:flex;align-items:center;gap:6px;">Artwork file <span id="labelinfo-${side}"></span></label>
          <div class="filemeta empty" id="labelmeta-${side}"></div>
        </div>
      </div>
      <input type="file" id="labelinput-${side}" accept=".pdf,.jpg,.jpeg,.tiff,.tif" class="hidden">

      <div class="label-preview-wrap" id="labelpreviewwrap-${side}">
        <div class="label-preview" id="labelpreview-${side}">
          <div class="label-placeholder">no artwork selected</div>
        </div>
      </div>

      <ul class="labelwarnings" id="labelwarnings-${side}"></ul>
    </div>
    <div class="hidden blank-note" id="labelblanknote-${side}">Whitelabel — blank, no artwork required.</div>
  </div>`;
}

function setPreview(side, html){
  document.getElementById("labelpreview-"+side).innerHTML = html;
}

// Swaps the preview box to a plant-generated preview image, taking
// priority over the live-rendered original — see applyLabels below,
// which is the only caller (a fresh manual pick never has one to show
// yet). Reuses the existing "file: <name> — <status>" meta line instead
// of adding new markup/CSS for a separate caption.
function showPreviewImage(side, previewImgFile){
  const box = document.getElementById("labelbox-"+side);
  const meta = document.getElementById("labelmeta-"+side);
  if(box._previewUrl) URL.revokeObjectURL(box._previewUrl);
  box._previewFile = previewImgFile;
  box._previewUrl = URL.createObjectURL(previewImgFile);
  setPreview(side, `<img src="${box._previewUrl}" alt="plant preview">`);
  meta.textContent = "file: " + box._file.name + " — plant preview";
}

// Sizes the preview box to the format's actual data size in mm, so the
// on-screen preview is close to true print size rather than an
// arbitrary fixed box — "close to" because CSS absolute units (mm) are
// only as accurate as the browser's mapping to the real display, which
// isn't perfectly calibrated on every device.
function updatePreviewSizing(){
  const mm = formatSpec().dataSizeMm;
  SIDES.forEach(side=>{
    const mmStr = mm + "mm";
    document.getElementById("labelpreviewwrap-"+side).style.width = mmStr;
    document.getElementById("labelpreviewwrap-"+side).style.height = mmStr;
    document.getElementById("labelpreview-"+side).style.width = mmStr;
    document.getElementById("labelpreview-"+side).style.height = mmStr;
  });
}

// End/data format come from getFormat (they vary by format,
// same numbers the preview above sizes itself to) rather than being
// duplicated as static text in CONFIG.infoText.
function updateLabelInfo(){
  const spec = formatSpec();
  const text = `End format ⌀${spec.diameterMm}mm · Data format ⌀${spec.dataSizeMm}mm (incl. bleed). `
    + infoText(CONFIG.infoText, CONFIG.locale, "labelArtwork");
  const html = renderInfoIcon(text);
  SIDES.forEach(side=> document.getElementById("labelinfo-"+side).innerHTML = html);
}

function renderWarnings(side, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  document.getElementById("labelwarnings-"+side).innerHTML = items.join("");
}

async function handleFile(side, file){
  const box = document.getElementById("labelbox-"+side);
  const meta = document.getElementById("labelmeta-"+side);
  meta.classList.remove("empty");
  meta.textContent = "file: " + file.name + " — checking…";

  if(box._url) URL.revokeObjectURL(box._url);
  box._file = file;
  if(box._previewUrl) URL.revokeObjectURL(box._previewUrl);
  box._previewFile = null;
  box._previewUrl = null;

  const buf = await file.arrayBuffer();
  const kind = sniffFileKind(buf);

  let parsed = null;
  if(kind === "pdf") parsed = await parsePdfArtwork(buf);
  else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
  else if(kind === "tiff") parsed = parseTiffArtwork(buf);

  const spec = formatSpec();
  const printCheck = getFormat(CONFIG, currentFormat()).printCheck;
  const result = validateArtwork(
    parsed, {w:spec.dataSizeMm, h:spec.dataSizeMm}, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
  if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
  renderWarnings(side, result);

  const url = URL.createObjectURL(file);
  box._url = url;
  if(kind === "pdf"){
    // Fills via CSS (.label-preview iframe{width/height:100%}) — see
    // cover.js's identical comment on Safari's PDF viewer margin.
    setPreview(side, `<iframe src="${url}#toolbar=0&navpanes=0"></iframe>`);
  } else if(kind === "jpeg"){
    setPreview(side, `<img src="${url}" alt="label ${side} artwork">`);
  } else if(kind === "tiff"){
    const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
    setPreview(side, `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`);
  } else{
    setPreview(side, `<div class="label-placeholder">preview not available</div>`);
  }

  meta.textContent = "file: " + file.name;
}

// A file picked for one format is sized for that format's dataSizeMm —
// switching format invalidates it outright (see initLabels's format
// change listener), rather than leaving a now-wrong-size file attached.
function clearLabelArtwork(side){
  const box = document.getElementById("labelbox-"+side);
  if(box._url) URL.revokeObjectURL(box._url);
  box._file = null;
  box._url = null;
  if(box._previewUrl) URL.revokeObjectURL(box._previewUrl);
  box._previewFile = null;
  box._previewUrl = null;
  document.getElementById("labelinput-"+side).value = "";
  const meta = document.getElementById("labelmeta-"+side);
  meta.classList.add("empty");
  meta.textContent = "";
  setPreview(side, `<div class="label-placeholder">no artwork selected</div>`);
  document.getElementById("labelwarnings-"+side).innerHTML = "";
}

function wireLabelSide(side){
  const input = document.getElementById("labelinput-"+side);
  document.getElementById("labelpick-"+side).addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(side, f);
  });

  document.getElementById("whitelabel-"+side).addEventListener("change", (e)=>{
    document.getElementById("labelbody-"+side).classList.toggle("hidden", e.target.checked);
    document.getElementById("labelblanknote-"+side).classList.toggle("hidden", !e.target.checked);
  });
}

export function initLabels(){
  document.getElementById("labelSides").innerHTML = SIDES.map(labelSideTemplate).join("");
  updatePreviewSizing();
  updateLabelInfo();
  SIDES.forEach(wireLabelSide);

  const bigCenterWrap = document.getElementById("bigCenterWrap");
  bigCenterWrap.insertAdjacentHTML("beforeend",
    renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "bigCenter")));
  const updateBigCenterVisibility = ()=>{
    bigCenterWrap.classList.toggle("hidden", !getFormat(CONFIG, currentFormat()).centerHole.big);
  };
  document.getElementById("format").addEventListener("change", ()=>{
    SIDES.forEach(clearLabelArtwork);
    updateBigCenterVisibility();
    updatePreviewSizing();
    updateLabelInfo();
  });
  updateBigCenterVisibility();
}

function labelFileName(side, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side, ext: fileExt(file.name)});
}

// Exported for the tracklist module's project save/load — same
// collect/apply pattern as vinyl-color.js and shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// tracklist.js's collectLabelFiles below builds the exact same name for
// the actual file, so a reopened project zip can re-attach it by an
// exact name match. fileName is null whenever whitelabel makes the file
// inapplicable (same condition collectLabelFiles uses to skip it) — a
// non-null fileName here always means the file is actually in the
// package, which is what lets the tracklist/order-summary exports build
// their file manifest straight from this data, no DOM re-check needed.
export function collectLabels(){
  return {
    bigCenter: document.getElementById("bigCenter").checked,
    sides: Object.fromEntries(SIDES.map(side => {
      const whitelabel = document.getElementById("whitelabel-"+side).checked;
      const file = document.getElementById("labelbox-"+side)._file;
      return [side, {
        whitelabel,
        fileName: (!whitelabel && file) ? labelFileName(side, file) : null
      }];
    }))
  };
}

// fileMap: canonical package name -> File, from a reopened project zip
// (see tracklist.js's loadProject). Omitted for a plain-JSON load, where
// there's nothing to re-attach.
export async function applyLabels(data, fileMap){
  const d = data || {};
  const bigCenter = document.getElementById("bigCenter");
  bigCenter.checked = !!d.bigCenter;
  bigCenter.dispatchEvent(new Event("change"));

  for(const side of SIDES){
    const s = (d.sides && d.sides[side]) || {};
    const whitelabel = document.getElementById("whitelabel-"+side);
    whitelabel.checked = !!s.whitelabel;
    whitelabel.dispatchEvent(new Event("change"));

    const meta = document.getElementById("labelmeta-"+side);
    const file = fileMap && s.fileName && fileMap.get(s.fileName);
    if(file){
      await handleFile(side, file);
      const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side});
      const previewImg = fileMap && fileMap.get(previewName);
      if(previewImg) showPreviewImage(side, previewImg);
    } else if(s.fileName){
      meta.classList.remove("empty");
      meta.textContent = "file: " + s.fileName + " — please re-select this file (not stored in the order file)";
    } else {
      meta.classList.add("empty");
      meta.textContent = "";
    }
  }
}

// Exported for the tracklist module's package export — labels doesn't
// reach into tracklist's DOM, and tracklist doesn't reach into this
// module's DOM either; this function is the only interface between them.
export async function collectLabelFiles(){
  const files = [];
  for(const side of SIDES){
    if(document.getElementById("whitelabel-"+side).checked) continue;
    const box = document.getElementById("labelbox-"+side);
    const file = box._file;
    if(!file) continue;
    files.push({ name: labelFileName(side, file), data: await file.arrayBuffer() });
    if(box._previewFile){
      const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side});
      files.push({ name: previewName, data: await box._previewFile.arrayBuffer() });
    }
  }
  return files;
}
