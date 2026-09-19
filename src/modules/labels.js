// Labels module — per-side artwork upload, best-effort validation
// (physical size, resolution, CMYK) and print simulation. All the
// parsing/validation logic is pure and lives in ../lib/label-artwork.js;
// this file is DOM wiring only.
//
// This is a front-end sanity check, not the real gate — the studio's
// backend preprocessor does the authoritative validation on upload and
// rejects faulty files. Catching the obvious mistakes here just saves
// customer service a round trip.

import { CONFIG } from "../config.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computePrintSimGeometry } from "../lib/print-artwork.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";

const SIDES = ["A", "B"];
// Canvas render resolution in pixels-per-mm — plenty crisp at the
// on-screen (CSS mm) display size, independent of it.
const PX_PER_MM = 4;

function currentFormat(){
  return parseInt(document.getElementById("format").value, 10);
}

function formatSpec(){
  return CONFIG.label.formats[currentFormat()];
}

function centerHoleMm(){
  const big = CONFIG.label.bigCenterFormats.includes(currentFormat())
    && document.getElementById("bigCenter").checked;
  return big ? CONFIG.label.centerHoleMm.big : CONFIG.label.centerHoleMm.normal;
}

function labelSideTemplate(side){
  return `
  <div class="side-box" id="labelbox-${side}">
    <div class="side-head">
      <h2>Label ${side}</h2>
      <div class="side-opts">
        <label class="chk"><input type="checkbox" id="whitelabel-${side}"> whitelabel (blank)</label>
        <label class="chk"><input type="checkbox" id="simprint-${side}"> simulate print</label>
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
        <canvas class="label-simcanvas" id="labelsim-${side}"></canvas>
      </div>

      <ul class="labelwarnings" id="labelwarnings-${side}"></ul>
    </div>
    <div class="hidden blank-note" id="labelblanknote-${side}">Whitelabel — blank, no artwork required.</div>
  </div>`;
}

function setPreview(side, html){
  document.getElementById("labelpreview-"+side).innerHTML = html;
}

// Sizes the preview box and its overlay canvas to the format's actual
// data size in mm, so the on-screen preview is close to true print
// size rather than an arbitrary fixed box — "close to" because CSS
// absolute units (mm) are only as accurate as the browser's mapping to
// the real display, which isn't perfectly calibrated on every device.
function updatePreviewSizing(){
  const mm = formatSpec().dataSizeMm;
  const px = Math.round(mm * PX_PER_MM);
  SIDES.forEach(side=>{
    const mmStr = mm + "mm";
    document.getElementById("labelpreviewwrap-"+side).style.width = mmStr;
    document.getElementById("labelpreviewwrap-"+side).style.height = mmStr;
    document.getElementById("labelpreview-"+side).style.width = mmStr;
    document.getElementById("labelpreview-"+side).style.height = mmStr;
    const canvas = document.getElementById("labelsim-"+side);
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = mmStr;
    canvas.style.height = mmStr;
  });
}

// End/data format come from CONFIG.label.formats (they vary by format,
// same numbers the preview above sizes itself to) rather than being
// duplicated as static text in CONFIG.infoText.
function updateLabelInfo(){
  const spec = formatSpec();
  const text = `End format ⌀${spec.diameterMm}mm · Data format ⌀${spec.dataSizeMm}mm (incl. bleed). `
    + infoText(CONFIG.infoText, CONFIG.locale, "labelArtwork");
  const html = renderInfoIcon(text);
  SIDES.forEach(side=> document.getElementById("labelinfo-"+side).innerHTML = html);
}

function drawSimGuides(side){
  const canvas = document.getElementById("labelsim-"+side);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if(!document.getElementById("simprint-"+side).checked) return;

  const spec = formatSpec();
  const geo = computePrintSimGeometry(canvas.width, spec.dataSizeMm, spec.diameterMm, centerHoleMm());

  // Black out everything outside the trim circle (the bleed that gets
  // cut away) using an even-odd fill between the canvas rect and the
  // circle subpath.
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(geo.center, geo.center, geo.trimRadiusPx, 0, Math.PI*2, true);
  ctx.fillStyle = "#000";
  ctx.fill("evenodd");

  // Punched spindle hole.
  ctx.beginPath();
  ctx.arc(geo.center, geo.center, geo.centerHoleRadiusPx, 0, Math.PI*2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#000";
  ctx.stroke();
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

  const buf = await file.arrayBuffer();
  const kind = sniffFileKind(buf);

  let parsed = null;
  if(kind === "pdf") parsed = parsePdfArtwork(buf);
  else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
  else if(kind === "tiff") parsed = parseTiffArtwork(buf);

  const spec = formatSpec();
  const result = validateArtwork(
    parsed, {w:spec.dataSizeMm, h:spec.dataSizeMm}, CONFIG.label.sizeToleranceMm, CONFIG.label.dpi.min, CONFIG.label.dpi.max);
  if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
  renderWarnings(side, result);

  const url = URL.createObjectURL(file);
  box._url = url;
  if(kind === "pdf"){
    setPreview(side, `<iframe src="${url}#toolbar=0&navpanes=0&view=Fit"></iframe>`);
  } else if(kind === "jpeg"){
    setPreview(side, `<img src="${url}" alt="label ${side} artwork">`);
  } else if(kind === "tiff"){
    const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
    setPreview(side, `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`);
  } else{
    setPreview(side, `<div class="label-placeholder">preview not available</div>`);
  }

  meta.textContent = "file: " + file.name;
  drawSimGuides(side);
}

function wireLabelSide(side){
  const input = document.getElementById("labelinput-"+side);
  document.getElementById("labelpick-"+side).addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(side, f);
  });

  document.getElementById("simprint-"+side).addEventListener("change", ()=> drawSimGuides(side));

  document.getElementById("whitelabel-"+side).addEventListener("change", (e)=>{
    document.getElementById("labelbody-"+side).classList.toggle("hidden", e.target.checked);
    document.getElementById("labelblanknote-"+side).classList.toggle("hidden", !e.target.checked);
  });
}

export function initLabels(){
  document.getElementById("labelSides").innerHTML = SIDES.map(labelSideTemplate).join("");
  updatePreviewSizing();
  updateLabelInfo();
  SIDES.forEach(side=>{
    wireLabelSide(side);
    drawSimGuides(side);
  });

  const bigCenterWrap = document.getElementById("bigCenterWrap");
  bigCenterWrap.insertAdjacentHTML("beforeend",
    renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "bigCenter")));
  const updateBigCenterVisibility = ()=>{
    bigCenterWrap.classList.toggle("hidden", !CONFIG.label.bigCenterFormats.includes(currentFormat()));
  };
  document.getElementById("bigCenter").addEventListener("change", ()=> SIDES.forEach(drawSimGuides));
  document.getElementById("format").addEventListener("change", ()=>{
    updateBigCenterVisibility();
    updatePreviewSizing();
    updateLabelInfo();
    SIDES.forEach(drawSimGuides);
  });
  updateBigCenterVisibility();
}

// Exported for the tracklist module's JSON save/load — same
// collect/apply pattern as vinyl-color.js and shipping-billing.js.
// File contents aren't stored in the JSON, only the name (for the
// "please re-select" hint on load).
export function collectLabels(){
  return {
    bigCenter: document.getElementById("bigCenter").checked,
    sides: Object.fromEntries(SIDES.map(side => [side, {
      whitelabel: document.getElementById("whitelabel-"+side).checked,
      simprint: document.getElementById("simprint-"+side).checked,
      fileName: (document.getElementById("labelbox-"+side)._file || {}).name || null
    }]))
  };
}

export function applyLabels(data){
  const d = data || {};
  const bigCenter = document.getElementById("bigCenter");
  bigCenter.checked = !!d.bigCenter;
  bigCenter.dispatchEvent(new Event("change"));

  SIDES.forEach(side=>{
    const s = (d.sides && d.sides[side]) || {};
    const whitelabel = document.getElementById("whitelabel-"+side);
    whitelabel.checked = !!s.whitelabel;
    whitelabel.dispatchEvent(new Event("change"));
    document.getElementById("simprint-"+side).checked = !!s.simprint;

    const meta = document.getElementById("labelmeta-"+side);
    if(s.fileName){
      meta.classList.remove("empty");
      meta.textContent = "file: " + s.fileName + " — please re-select this file (not stored in the order file)";
    } else {
      meta.classList.add("empty");
      meta.textContent = "";
    }
    drawSimGuides(side);
  });
}

// Exported for the tracklist module's package export — labels doesn't
// reach into tracklist's DOM, and tracklist doesn't reach into this
// module's DOM either; this function is the only interface between them.
export async function collectLabelFiles(){
  const files = [];
  for(const side of SIDES){
    if(document.getElementById("whitelabel-"+side).checked) continue;
    const file = document.getElementById("labelbox-"+side)._file;
    if(!file) continue;
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
    files.push({ name: `label_${side}${ext}`, data: await file.arrayBuffer() });
  }
  return files;
}
