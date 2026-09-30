// Labels module — per-side artwork upload (the shared artwork slot, see
// artwork-slot.js), whitelabel toggle, big centre hole. The checks are
// pure, in ../lib/print-artwork.js.
//
// This is a front-end sanity check, not the real gate — the plant checks
// every file again. Catching the obvious mistakes here just saves
// customer service a round trip.

import { CONFIG } from "../config.js";
import { getFormat, artworkSize } from "../lib/format-catalogue.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";
import { requiredFileIssue } from "../lib/file-issues.js";
import { createArtworkSlot, pairSlots } from "./artwork-slot.js";

const SIDES = ["A", "B"];
let labelSlots = null;
let updateLabelPair = ()=>{};
let labelsOnStateChange = ()=>{};

function currentFormat(){
  return document.getElementById("format").value;
}

function labelSize(){
  const format = getFormat(CONFIG, currentFormat());
  return {...artworkSize(format, "labels"), label: format.printableParts.label};
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
      <label class="pagepick hidden no-print" id="labelpagewrap-${side}">page
        <select id="labelpage-${side}"></select> <span id="labelpagecount-${side}"></span></label>
      ${side === "A" ? `<button type="button" class="pairbtn hidden no-print" id="labelpair-A">Use page 2 for side B</button>` : ""}
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

function whitelabel(side){
  return document.getElementById("whitelabel-"+side).checked;
}

// Sizes the preview box to the label's data size in mm, close to true
// print size — as close as the browser's mm maps to the real display.
// The blank-whitelabel disc sits at the trim circle inside it.
function updatePreviewSizing(){
  const {targetMm, label} = labelSize();
  const mmStr = targetMm.w + "mm";
  const insetPct = ((targetMm.w - label.diameterMm) / (2 * targetMm.w) * 100) + "%";
  SIDES.forEach(side=>{
    for(const id of ["labelpreviewwrap-", "labelpreview-"]){
      const el = document.getElementById(id+side);
      el.style.width = el.style.height = mmStr;
    }
    document.getElementById("labelblankdisc-"+side).style.inset = insetPct;
  });
}

// Expert-reference text only (ink coverage, colour profile), from
// CONFIG.infoText; sizes are in the Specifications disclosure.
function updateLabelInfo(){
  const html = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "labelArtwork"));
  SIDES.forEach(side=> document.getElementById("labelinfo-"+side).innerHTML = html);
}

function renderLabelSpecs(){
  const {targetMm, bleedMm, label} = labelSize();
  const colorMode = getFormat(CONFIG, currentFormat()).printCheck.checks.colorMode.accepted.join("/");
  SIDES.forEach(side=>{
    document.getElementById("labelSpecFiletypes-"+side).textContent = CONFIG.artworkFileTypes.labels.join(", ");
    document.getElementById("labelSpecColorMode-"+side).textContent = colorMode;
    document.getElementById("labelSpecEndFormat-"+side).textContent = `⌀${label.diameterMm}mm`;
    document.getElementById("labelSpecDataFormat-"+side).textContent = `${targetMm.w}×${targetMm.h}mm`;
    document.getElementById("labelSpecBleed-"+side).textContent = `${bleedMm}mm`;
  });
}

// The blank disc covers only the trim circle — whatever is rendered
// underneath is hidden entirely, or it would show around the disc.
function showWhitelabel(side){
  const blank = whitelabel(side);
  document.getElementById("labelblankdisc-"+side).classList.toggle("hidden", !blank);
  document.getElementById("labelpreview-"+side).classList.toggle("blanked", blank);
  document.getElementById("labelwarnings-"+side).classList.toggle("hidden", blank);
  document.getElementById("labelblanknote-"+side).classList.toggle("hidden", !blank);
}

export function initLabels(onStateChange = ()=>{}){
  labelsOnStateChange = onStateChange;
  document.getElementById("labelSides").innerHTML = SIDES.map(labelSideTemplate).join("");
  labelSlots = Object.fromEntries(SIDES.map(side => [side, createArtworkSlot(
    role => document.getElementById("label"+role+"-"+side),
    {size: ()=> ({...labelSize(), printCheck: getFormat(CONFIG, currentFormat()).printCheck}),
     onChange: ()=>{ updateLabelPair(); labelsOnStateChange(); }}
  )]));
  updateLabelPair = pairSlots(labelSlots.A, labelSlots.B, document.getElementById("labelpair-A"), ()=> whitelabel("B"));
  updatePreviewSizing();
  updateLabelInfo();
  renderLabelSpecs();
  SIDES.forEach(side=> document.getElementById("whitelabel-"+side).addEventListener("change", ()=>{
    showWhitelabel(side);
    updateLabelPair();
    labelsOnStateChange();
  }));

  const bigCenterWrap = document.getElementById("bigCenterWrap");
  bigCenterWrap.insertAdjacentHTML("beforeend",
    renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "bigCenter")));
  const updateBigCenterVisibility = ()=>{
    const supported = !!getFormat(CONFIG, currentFormat()).centerHole.big;
    bigCenterWrap.classList.toggle("hidden", !supported);
    if(!supported) document.getElementById("bigCenter").checked = false;
  };
  // A file is sized for one format — a format change drops it.
  document.getElementById("format").addEventListener("change", ()=>{
    SIDES.forEach(side=> labelSlots[side].clear());
    updateLabelPair();
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

function labelPreviewName(side){
  return previewFileName({catalogue: document.getElementById("catalogue").value, part:"labels", variant:side});
}

// Exported for the tracklist module's project save/load. Only the
// file's package name goes into the JSON; collectLabelFiles builds the
// same name, so a reopened zip re-attaches it by exact match.
//
// forSend (sendToPlant) leaves whitelabel sides' files out — the plant
// isn't printing them — while Save Project keeps them, so no work is
// lost. Either way fileName is null exactly when collectLabelFiles
// (same forSend) leaves the file out of the package.
function labelIncluded(side, forSend){
  return !!labelSlots[side].state.file && !(forSend && whitelabel(side));
}

export function collectLabels(forSend = false){
  return {
    bigCenter: document.getElementById("bigCenter").checked,
    sides: Object.fromEntries(SIDES.map(side => {
      const {file, originalFileName, page} = labelSlots[side].state;
      const included = labelIncluded(side, forSend);
      return [side, {
        whitelabel: whitelabel(side),
        fileName: included ? labelFileName(side, file) : null,
        originalFileName: included ? originalFileName : null,
        page: included ? page : 1
      }];
    }))
  };
}

// fileMap: package name -> File from a reopened project zip.
export async function applyLabels(data, fileMap){
  const d = data || {};
  const bigCenter = document.getElementById("bigCenter");
  bigCenter.checked = !!d.bigCenter && !!getFormat(CONFIG, currentFormat()).centerHole.big;
  bigCenter.dispatchEvent(new Event("change"));

  await Promise.all(SIDES.map(side => {
    const s = (d.sides && d.sides[side]) || {};
    document.getElementById("whitelabel-"+side).checked = !!s.whitelabel;
    showWhitelabel(side);
    return labelSlots[side].applyFile(s.fileName, s.originalFileName, fileMap, labelPreviewName(side), s.page);
  }));
  updateLabelPair();
  labelsOnStateChange();
}

export function labelIssues(){
  if(!labelSlots) return [];
  return SIDES.filter(side => !whitelabel(side))
    .map(side => requiredFileIssue(`Label ${side}`, labelSlots[side].state))
    .filter(Boolean);
}

// Exported for the tracklist module's package export — the only
// interface between the two. forSend: see collectLabels.
export function collectLabelFiles(forSend = false){
  return SIDES.filter(side => labelIncluded(side, forSend))
    .flatMap(side => labelSlots[side].files(file => labelFileName(side, file), labelPreviewName(side)));
}
