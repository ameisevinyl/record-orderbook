// Labels module — per-side artwork upload, best-effort validation
// (physical size, resolution, CMYK). All the parsing/validation logic
// is pure and lives in ../lib/print-artwork.js; this file is DOM
// wiring only.
//
// This is a front-end sanity check, not the real gate — the studio's
// backend preprocessor does the authoritative validation on upload and
// rejects faulty files. Catching the obvious mistakes here just saves
// customer service a round trip.

import { CONFIG } from "../config.js";
import { getFormat, labelDataSizeMm } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, buildChecklistRows, CHECKLIST_ICON } from "../lib/print-artwork.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";
import { requiredFileIssue } from "../lib/file-issues.js";

const SIDES = ["A", "B"];
let labelStates = null;
let labelsOnStateChange = ()=>{};

function newLabelState(){
  return {
    file: null, originalFileName: null, storedFileName: null,
    pending: false, rows: [], error: null, revision: 0,
    url: null, previewFile: null, previewUrl: null
  };
}

function currentFormat(){
  return document.getElementById("format").value;
}

function printableParts(){
  return getFormat(CONFIG, currentFormat()).printableParts;
}

function formatSpec(){
  return printableParts().label;
}

function labelSideTemplate(side){
  return `
  <div id="labelbox-${side}">
    <div class="side-head">
      <h3>Label ${side}</h3>
    </div>

    <details class="specs no-print">
      <summary>Specifications</summary>
      <div class="specs-body">
        <div><span>Allowed filetypes</span><span id="labelSpecFiletypes-${side}"></span></div>
        <div><span>Colour mode</span><span id="labelSpecColorMode-${side}"></span></div>
        <div><span>End format</span><span id="labelSpecEndFormat-${side}"></span></div>
        <div><span>Data format</span><span id="labelSpecDataFormat-${side}"></span></div>
        <div><span>Bleed</span><span id="labelSpecBleed-${side}"></span></div>
      </div>
    </details>

    <div class="row" style="align-items:center;">
      <button type="button" class="pickbtn no-print" id="labelpick-${side}" title="Choose label artwork">↑</button>
      <label class="chk"><input type="checkbox" id="whitelabel-${side}"> whitelabel (blank)</label>
      <div class="filemeta empty" id="labelmeta-${side}" style="margin:0;"></div>
      <span id="labelinfo-${side}" style="margin-left:auto;"></span>
    </div>
    <input type="file" id="labelinput-${side}" accept="${CONFIG.artworkFileTypes.accept}" class="hidden">

    <div id="labelbody-${side}">
      <div class="label-preview-wrap" id="labelpreviewwrap-${side}">
        <div class="label-preview" id="labelpreview-${side}">
          <div class="label-placeholder">no artwork selected</div>
        </div>
        <div class="label-blank-disc hidden" id="labelblankdisc-${side}"></div>
      </div>

      <table class="labelwarnings" id="labelwarnings-${side}"></table>
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
  const state = labelStates[side];
  if(!state.file) return;
  if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewFile = previewImgFile;
  state.previewUrl = URL.createObjectURL(previewImgFile);
  setPreview(side, `<img src="${state.previewUrl}" alt="plant preview">`);
  renderLabelFileMeta(side, state.file.name, state.originalFileName, "plant preview");
}

function renderLabelFileMeta(side, currentName, originalName, statusText){
  const meta = document.getElementById("labelmeta-"+side);
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

// Sizes the preview box to the format's actual data size in mm, so the
// on-screen preview is close to true print size rather than an
// arbitrary fixed box — "close to" because CSS absolute units (mm) are
// only as accurate as the browser's mapping to the real display, which
// isn't perfectly calibrated on every device.
function updatePreviewSizing(){
  const spec = formatSpec();
  const { diameterMm } = spec;
  const dataSizeMm = labelDataSizeMm(spec);
  const mmStr = dataSizeMm + "mm";
  // Inset the blank-whitelabel disc from the full data square by the
  // same margin a real label file's trim circle would sit at, so it
  // reads as "this side's actual label, just blank" rather than an
  // arbitrary placeholder circle.
  const insetPct = ((dataSizeMm - diameterMm) / (2 * dataSizeMm) * 100) + "%";
  SIDES.forEach(side=>{
    document.getElementById("labelpreviewwrap-"+side).style.width = mmStr;
    document.getElementById("labelpreviewwrap-"+side).style.height = mmStr;
    document.getElementById("labelpreview-"+side).style.width = mmStr;
    document.getElementById("labelpreview-"+side).style.height = mmStr;
    document.getElementById("labelblankdisc-"+side).style.inset = insetPct;
  });
}

// End/data format now live in the Specifications disclosure
// (renderLabelSpecs below), not duplicated here — this stays expert-
// reference text only (ink coverage, colour profile), from CONFIG.infoText.
function updateLabelInfo(){
  const html = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "labelArtwork"));
  SIDES.forEach(side=> document.getElementById("labelinfo-"+side).innerHTML = html);
}

// Populates the Specifications disclosure from CONFIG — never
// hand-typed, so it can't drift from the format's actual values.
function renderLabelSpecs(){
  const { diameterMm, bleedMm } = formatSpec();
  const dataSizeMm = labelDataSizeMm(formatSpec());
  const colorMode = getFormat(CONFIG, currentFormat()).printCheck.checks.colorMode.accepted.join("/");
  SIDES.forEach(side=>{
    document.getElementById("labelSpecFiletypes-"+side).textContent = CONFIG.artworkFileTypes.labels.join(", ");
    document.getElementById("labelSpecColorMode-"+side).textContent = colorMode;
    document.getElementById("labelSpecEndFormat-"+side).textContent = `⌀${diameterMm}mm`;
    document.getElementById("labelSpecDataFormat-"+side).textContent = `${dataSizeMm}×${dataSizeMm}mm`;
    document.getElementById("labelSpecBleed-"+side).textContent = `${bleedMm}mm`;
  });
}

// row.detected/row.feature can echo untrusted text read out of the
// uploaded file itself (e.g. an ICC profile's description tag) — built
// as DOM nodes via textContent, never innerHTML, so a crafted file
// can't inject markup/script into this page.
function renderChecklist(side, parsed, kind, targetMm, trimMm, printCheck){
  const rows = buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, isDebugMode());
  const table = document.getElementById("labelwarnings-"+side);
  table.innerHTML = "<thead><tr><th></th><th>Check</th><th>Detected</th><th>Expected</th></tr></thead>";
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
  table.appendChild(tbody);
  return rows;
}

async function handleFile(side, file, originalFileName = file.name){
  const state = labelStates[side];
  const revision = ++state.revision;
  const meta = document.getElementById("labelmeta-"+side);
  meta.classList.remove("empty");
  renderLabelFileMeta(side, file.name, originalFileName, "checking…");

  if(state.url) URL.revokeObjectURL(state.url);
  if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  Object.assign(state, {
    file, originalFileName, storedFileName: null, pending: true,
    rows: [], error: null, url: null, previewFile: null, previewUrl: null
  });
  labelsOnStateChange();

  let kind = null;
  try{
    const buf = await file.arrayBuffer();
    if(state.revision !== revision || state.file !== file) return false;
    kind = sniffFileKind(buf);

    let parsed = null;
    if(kind === "pdf") parsed = await parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);
    if(state.revision !== revision || state.file !== file) return false;

    const spec = formatSpec();
    const printCheck = getFormat(CONFIG, currentFormat()).printCheck;
    const dataSizeMm = labelDataSizeMm(spec);
    const targetMm = {w:dataSizeMm, h:dataSizeMm};
    const trimMm = {w:spec.diameterMm, h:spec.diameterMm};
    state.rows = renderChecklist(side, parsed, kind, targetMm, trimMm, printCheck);
    state.pending = false;
    state.error = null;

    state.url = URL.createObjectURL(file);
    if(kind === "pdf"){
      // Fills via CSS (.label-preview iframe{width/height:100%}) — see
      // cover.js's identical comment on Safari's PDF viewer margin.
      setPreview(side, `<iframe src="${state.url}#toolbar=0&navpanes=0"></iframe>`);
    } else if(kind === "jpeg"){
      setPreview(side, `<img src="${state.url}" alt="label ${side} artwork">`);
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      setPreview(side, `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`);
    } else{
      setPreview(side, `<div class="label-placeholder">preview not available</div>`);
    }
    renderLabelFileMeta(side, file.name, originalFileName, null);
  } catch(error){
    if(state.revision !== revision || state.file !== file) return false;
    const spec = formatSpec();
    const printCheck = getFormat(CONFIG, currentFormat()).printCheck;
    const dataSizeMm = labelDataSizeMm(spec);
    state.rows = renderChecklist(side, null, kind, {w:dataSizeMm, h:dataSizeMm}, {w:spec.diameterMm, h:spec.diameterMm}, printCheck);
    state.pending = false;
    state.error = error;
    setPreview(side, `<div class="label-placeholder">preview not available</div>`);
    renderLabelFileMeta(side, file.name, originalFileName, null);
  }
  labelsOnStateChange();
  return true;
}

// A file picked for one format is sized for that format's dataSizeMm —
// switching format invalidates it outright (see initLabels's format
// change listener), rather than leaving a now-wrong-size file attached.
function clearLabelArtwork(side){
  const state = labelStates[side];
  ++state.revision;
  if(state.url) URL.revokeObjectURL(state.url);
  if(state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  Object.assign(state, {
    file: null, originalFileName: null, storedFileName: null,
    pending: false, rows: [], error: null,
    url: null, previewFile: null, previewUrl: null
  });
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
    document.getElementById("labelblankdisc-"+side).classList.toggle("hidden", !e.target.checked);
    // The disc only covers a circle inset from the box's edges (the
    // real label's trim margin) — hide whatever's rendered underneath
    // (iframe/img/placeholder) entirely, or the real preview would
    // still show through around the disc.
    document.getElementById("labelpreview-"+side).classList.toggle("blanked", e.target.checked);
    document.getElementById("labelwarnings-"+side).classList.toggle("hidden", e.target.checked);
    document.getElementById("labelblanknote-"+side).classList.toggle("hidden", !e.target.checked);
    labelsOnStateChange();
  });
}

export function initLabels(onStateChange = ()=>{}){
  labelsOnStateChange = onStateChange;
  document.getElementById("labelSides").innerHTML = SIDES.map(labelSideTemplate).join("");
  labelStates = Object.fromEntries(SIDES.map(side => [side, newLabelState()]));
  updatePreviewSizing();
  updateLabelInfo();
  renderLabelSpecs();
  SIDES.forEach(wireLabelSide);

  const bigCenterWrap = document.getElementById("bigCenterWrap");
  bigCenterWrap.insertAdjacentHTML("beforeend",
    renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "bigCenter")));
  const updateBigCenterVisibility = ()=>{
    const supported = !!getFormat(CONFIG, currentFormat()).centerHole.big;
    bigCenterWrap.classList.toggle("hidden", !supported);
    if(!supported) document.getElementById("bigCenter").checked = false;
  };
  document.getElementById("format").addEventListener("change", ()=>{
    SIDES.forEach(clearLabelArtwork);
    updateBigCenterVisibility();
    updatePreviewSizing();
    updateLabelInfo();
    renderLabelSpecs();
    labelsOnStateChange();
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
// exact name match.
//
// forSend (true for sendToPlant, false/omitted for saveProject) governs
// whitelabel sides specifically: the plant doesn't need a file for a
// side it's not printing, so it's left out of what's actually sent —
// but Save Project must never lose work, so a saved project keeps the
// reference regardless of whitelabel. Whichever way, fileName here is
// null exactly when collectLabelFiles (same forSend) leaves the file
// out of the package, which is what lets the tracklist/order-summary
// exports build their file manifest straight from this data, no DOM
// re-check needed.
export function collectLabels(forSend = false){
  return {
    bigCenter: document.getElementById("bigCenter").checked,
    sides: Object.fromEntries(SIDES.map(side => {
      const whitelabel = document.getElementById("whitelabel-"+side).checked;
      const state = labelStates[side];
      const file = state.file;
      const included = file && !(forSend && whitelabel);
      return [side, {
        whitelabel,
        fileName: included ? labelFileName(side, file) : null,
        originalFileName: included ? state.originalFileName : null
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
  bigCenter.checked = !!d.bigCenter && !!getFormat(CONFIG, currentFormat()).centerHole.big;
  bigCenter.dispatchEvent(new Event("change"));

  await Promise.all(SIDES.map(async side => {
    const s = (d.sides && d.sides[side]) || {};
    const whitelabel = document.getElementById("whitelabel-"+side);
    whitelabel.checked = !!s.whitelabel;
    document.getElementById("labelblankdisc-"+side).classList.toggle("hidden", !whitelabel.checked);
    document.getElementById("labelpreview-"+side).classList.toggle("blanked", whitelabel.checked);
    document.getElementById("labelwarnings-"+side).classList.toggle("hidden", whitelabel.checked);
    document.getElementById("labelblanknote-"+side).classList.toggle("hidden", !whitelabel.checked);

    const meta = document.getElementById("labelmeta-"+side);
    const file = fileMap && s.fileName && fileMap.get(s.fileName);
    if(file){
      const current = await handleFile(side, file, s.originalFileName || s.fileName);
      if(current){
        const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side});
        const previewImg = fileMap && fileMap.get(previewName);
        if(previewImg) showPreviewImage(side, previewImg);
      }
    } else if(s.fileName){
      clearLabelArtwork(side);
      labelStates[side].storedFileName = s.fileName;
      meta.classList.remove("empty");
      renderLabelFileMeta(side, s.fileName, s.originalFileName, "please re-select this file (not stored in the order file)");
    } else {
      clearLabelArtwork(side);
    }
  }));
  labelsOnStateChange();
}

export function labelIssues(){
  if(!labelStates || !document.getElementById("whitelabel-A")) return [];
  const issues = [];
  for(const side of SIDES){
    if(document.getElementById("whitelabel-"+side).checked) continue;
    const state = labelStates[side];
    const issue = requiredFileIssue(`Label ${side}`, state);
    if(issue) issues.push(issue);
  }
  return issues;
}

// Exported for the tracklist module's package export — labels doesn't
// reach into tracklist's DOM, and tracklist doesn't reach into this
// module's DOM either; this function is the only interface between them.
// forSend: see collectLabels above — same condition, kept in sync so a
// side's fileName in project.json always matches whether its bytes are
// actually in this same package.
export function collectLabelFiles(forSend = false){
  const files = [];
  for(const side of SIDES){
    const state = labelStates[side];
    const file = state.file;
    const whitelabel = document.getElementById("whitelabel-"+side).checked;
    if(!file || (forSend && whitelabel)) continue;
    files.push({ name: labelFileName(side, file), data: file });
    if(state.previewFile){
      const previewName = previewFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side});
      files.push({ name: previewName, data: state.previewFile });
    }
  }
  return files;
}
