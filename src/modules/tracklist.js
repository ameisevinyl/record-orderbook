// Tracklist / Cutting Order module — catalogue number, format/RPM,
// side A/B track listing, playing-time warnings, printable order sheet,
// ZIP package export, SwissTransfer handoff.
//
// DOM-coupled by design (this is UI wiring, not a pure lib) — pure
// logic (time parsing, ZIP writer, WAV/AIFF duration, threshold rules)
// lives in src/lib/ and is imported below.

import { CONFIG } from "../config.js";
import { formatTime, parseTime } from "../lib/time.js";
import { readAudioDuration, compressionWarning } from "../lib/audio-duration.js";
import { buildZip, parseZipBytes } from "../lib/zip.js";
import { computeStatus } from "../lib/playing-time.js";
import { trackFileName, continuousSideFileName, projectFileName, fileExt, mimeType } from "../lib/package-naming.js";
import { collectLabelFiles, collectLabels, applyLabels } from "./labels.js";
import { collectCoverSleeveFiles, collectCoverSleeve, applyCoverSleeve } from "./cover-sleeve.js";
import { collectVinylColor, applyVinylColor } from "./vinyl-color.js";
import { collectShippingBilling, applyShippingBilling, buildShippingBillingSummary } from "./shipping-billing.js";

// Shared by the manual file-input handler and loadProject's zip
// re-attach path, so both go through the same duration-reading/warning
// logic.
function attachTrackFile(row, f){
  row._file = f;
  const pickbtn = row.querySelector(".pickbtn");
  const meta = row.querySelector(".filemeta");
  const lengthInput = row.querySelector(".length");
  pickbtn.classList.add("has-file");
  meta.textContent = "file: " + f.name + " — reading duration…";
  meta.classList.remove("empty");
  meta.classList.remove("warn");
  const warning = compressionWarning(f);
  readAudioDuration(f).then(dur=>{
    const durText = (isFinite(dur) && dur > 0)
      ? (()=>{ lengthInput.value = formatTime(dur); row._autoLength = true; recompute();
               return formatTime(dur) + " (auto)"; })()
      : "could not read duration, enter length manually";
    meta.textContent = "file: " + f.name + " — " + durText + (warning ? "  " + warning : "");
    meta.classList.toggle("warn", !!warning);
    recompute();
  });
}

function createTrackRow(side){
  const row = document.createElement("div");
  row.className = "track-row";
  row.innerHTML = `
    <div class="pos">--</div>
    <button type="button" class="pickbtn no-print" title="Choose audio file">⏏</button>
    <div class="field" style="margin:0;"><input type="text" class="title" placeholder="track title (optional)"></div>
    <div class="field" style="margin:0;"><input type="text" class="artist" placeholder="artist (optional)"></div>
    <div class="len-wrap">
      <input type="text" class="length" placeholder="m:ss">
    </div>
    <div class="gap-wrap">
      <select class="gap">
        <option value="0">no pause</option>
        <option value="2" selected>2s</option>
        <option value="custom">custom</option>
      </select>
      <input type="number" class="gapcustom" min="0" step="0.5" value="2">
    </div>
    <button type="button" class="rmbtn no-print" title="Remove track">✕</button>
    <div class="filemeta empty"></div>
  `;
  const fileInput = document.createElement("input");
  fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.className = "hidden fileInput";
  row.appendChild(fileInput);

  const pickbtn = row.querySelector(".pickbtn");
  const meta = row.querySelector(".filemeta");
  const lengthInput = row.querySelector(".length");
  const gapSel = row.querySelector(".gap");
  const gapWrap = row.querySelector(".gap-wrap");
  const gapCustom = row.querySelector(".gapcustom");

  pickbtn.addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", ()=>{
    const f = fileInput.files[0];
    if(f) attachTrackFile(row, f);
  });

  lengthInput.addEventListener("input", ()=>{ row._autoLength = false; recompute(); });
  gapSel.addEventListener("change", ()=>{
    gapWrap.classList.toggle("custom", gapSel.value === "custom");
    recompute();
  });
  gapCustom.addEventListener("input", recompute);
  row.querySelector(".rmbtn").addEventListener("click", ()=>{
    row.remove(); renumber(side); recompute();
  });

  return row;
}

function rowGapSeconds(row, isFirst){
  if(isFirst) return 0;
  const sel = row.querySelector(".gap").value;
  if(sel === "0") return 0;
  if(sel === "2") return 2;
  const v = parseFloat(row.querySelector(".gapcustom").value);
  return isFinite(v) ? v : 0;
}

function renumber(side){
  const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
  rows.forEach((row,i)=>{
    row.querySelector(".pos").textContent = side + (i+1);
    const gapCell = row.querySelector(".gap-wrap");
    gapCell.style.visibility = i===0 ? "hidden" : "visible";
  });
}

function addTrack(side){
  const container = document.getElementById("tracks-"+side);
  container.appendChild(createTrackRow(side));
  renumber(side);
}

/* ============================================================
   Side-level continuous-file mode
   ============================================================ */

// Shared by the manual file-input handler and loadProject's zip
// re-attach path — see attachTrackFile above for the per-track version.
function attachContinuousFile(side, f){
  const contWrap = document.getElementById("contfile-"+side);
  const contMeta = document.getElementById("contfilemeta-"+side);
  const contOverride = document.getElementById("contoverride-"+side);
  contWrap._file = f;
  contMeta.textContent = "file: " + f.name + " — reading duration…";
  contMeta.classList.remove("warn");
  const warning = compressionWarning(f);
  readAudioDuration(f).then(dur=>{
    const durText = (isFinite(dur) && dur > 0)
      ? (()=>{ contOverride.value = formatTime(dur); return formatTime(dur) + " (auto)"; })()
      : "could not read duration, enter length manually";
    contMeta.textContent = "file: " + f.name + " — " + durText + (warning ? "  " + warning : "");
    contMeta.classList.toggle("warn", !!warning);
    recompute();
  });
}

function wireSideOptions(side){
  const contChk = document.getElementById("cont-"+side);
  const contWrap = document.getElementById("contfile-"+side);
  const tracksWrap = document.getElementById("trackswrap-"+side);
  const addBtn = document.getElementById("addbtn-"+side);
  const blankChk = side === "B" ? document.getElementById("blankB") : null;
  const sideBody = document.getElementById("body-"+side);

  contChk.addEventListener("change", ()=>{
    const on = contChk.checked;
    contWrap.classList.toggle("hidden", !on);
    tracksWrap.querySelectorAll(".gap-wrap select, .pickbtn").forEach(el=>{
      el.disabled = on;
    });
    tracksWrap.querySelectorAll(".gap-wrap").forEach(el=> el.style.opacity = on ? .4 : 1);
    if(on){
      document.querySelectorAll("#tracks-"+side+" .gap").forEach(s=> s.value = "0");
    }
    recompute();
  });

  const contFileInput = document.getElementById("contfileinput-"+side);
  const contOverride = document.getElementById("contoverride-"+side);
  document.getElementById("contpick-"+side).addEventListener("click", ()=> contFileInput.click());
  contFileInput.addEventListener("change", ()=>{
    const f = contFileInput.files[0];
    if(f) attachContinuousFile(side, f);
  });
  contOverride.addEventListener("input", recompute);

  if(blankChk){
    blankChk.addEventListener("change", ()=>{
      sideBody.classList.toggle("hidden", blankChk.checked);
      recompute();
    });
  }

  addBtn.addEventListener("click", ()=> addTrack(side));
}

/* ============================================================
   Compute totals + warnings
   ============================================================ */

function sideMeta(side){
  const format = parseInt(document.getElementById("format").value, 10);
  const rpm = parseInt(document.getElementById("rpm-"+side).value, 10);
  const mode = document.getElementById("soundsystem").checked ? "soundsystem" : "normal";
  return {format, rpm, mode};
}

function computeSideSeconds(side){
  const blankChk = side === "B" ? document.getElementById("blankB") : null;
  if(blankChk && blankChk.checked) return 0;

  const contChk = document.getElementById("cont-"+side);
  if(contChk.checked){
    const v = parseTime(document.getElementById("contoverride-"+side).value);
    return v || 0;
  }
  const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
  let total = 0;
  rows.forEach((row,i)=>{
    const len = parseTime(row.querySelector(".length").value) || 0;
    total += len + rowGapSeconds(row, i===0);
  });
  return total;
}

function statusFor(seconds, side){
  const {format, rpm, mode} = sideMeta(side);
  return computeStatus(CONFIG.timeLimits, format, rpm, mode, seconds);
}

function recompute(){
  let recordTotal = 0;
  ["A","B"].forEach(side=>{
    const seconds = computeSideSeconds(side);
    recordTotal += seconds;
    const {level, maxMin, idealMin} = statusFor(seconds, side);
    const totalFig = document.getElementById("total-"+side);
    const badge = document.getElementById("badge-"+side);
    const meter = document.getElementById("meter-"+side);
    const meterFill = document.getElementById("meterfill-"+side);
    const note = document.getElementById("limitsnote-"+side);
    const {format, rpm, mode} = sideMeta(side);

    totalFig.textContent = formatTime(seconds);
    badge.className = "badge " + level;
    badge.textContent = level === "ok" ? "within recommendation"
                       : level === "warn" ? "approaching limit"
                       : "exceeds recommendation";
    meter.className = "meter " + (level==="ok"?"":level);
    const pct = Math.min(100, (seconds/60) / maxMin * 100);
    meterFill.style.width = pct + "%";
    note.textContent = `${format}", ${rpm} RPM${mode==="soundsystem"?" · soundsystem cut":""} — ideal up to ${idealMin} min, max ${maxMin} min`;
  });
  document.getElementById("recordTotal").textContent = formatTime(recordTotal);
  updateChecklist();
}

/* ============================================================
   Checklist
   ============================================================ */
function updateChecklist(){
  const list = document.getElementById("checklist");
  const items = [];
  const cat = document.getElementById("catalogue").value.trim();
  items.push([!!cat, cat ? "Catalogue number set" : "Catalogue number missing"]);

  const rowsA = document.querySelectorAll("#tracks-A .track-row");
  const contA = document.getElementById("cont-A").checked;
  const hasSideA = contA ? !!document.getElementById("contoverride-A").value
                          : Array.from(rowsA).some(r=> r.querySelector(".length").value.trim());
  items.push([hasSideA, hasSideA ? "Side A has timed content" : "Side A has no timed tracks yet"]);

  const blankB = document.getElementById("blankB").checked;
  if(!blankB){
    const rowsB = document.querySelectorAll("#tracks-B .track-row");
    const contB = document.getElementById("cont-B").checked;
    const hasSideB = contB ? !!document.getElementById("contoverride-B").value
                            : Array.from(rowsB).some(r=> r.querySelector(".length").value.trim());
    items.push([hasSideB, hasSideB ? "Side B has timed content" : "Side B has no timed tracks yet (or mark it blank)"]);
  } else {
    items.push([true, "Side B marked blank"]);
  }

  ["A","B"].forEach(side=>{
    const blankChk = side==="B" ? document.getElementById("blankB") : null;
    if(blankChk && blankChk.checked) return;
    const seconds = computeSideSeconds(side);
    const {level, maxMin} = statusFor(seconds, side);
    items.push([level !== "danger", level === "danger"
      ? `Side ${side} exceeds ${maxMin} min recommended max`
      : `Side ${side} within playing-time recommendation`]);
  });

  const compressedCount = document.querySelectorAll(".filemeta.warn").length;
  if(compressedCount > 0){
    items.push([false, `${compressedCount} compressed file(s) attached — replace with WAV/AIFF`]);
  }

  list.innerHTML = items.map(([ok, text])=>
    `<li class="${ok?'ok':'bad'}"><span class="mark">${ok?'✓':'!'}</span>${text}</li>`
  ).join("");
}

/* ============================================================
   Side template
   ============================================================ */

function sideTemplate(side){
  const isB = side === "B";
  return `
  <div class="side-box" id="sidebox-${side}">
    <div class="side-head">
      <h2>Side ${side}</h2>
      <div class="side-opts">
        ${isB ? `<label class="chk"><input type="checkbox" id="blankB"> blank / not used</label>` : ""}
        <label class="chk">RPM
          <select id="rpm-${side}" class="rpm-select">
            <option value="33">33⅓</option>
            <option value="45">45</option>
          </select>
        </label>
        <label class="chk"><input type="checkbox" id="cont-${side}"> one continuous file for this side</label>
      </div>
    </div>

    <div id="body-${side}">
      <div class="hidden" id="contfile-${side}">
        <div class="row" style="align-items:end;">
          <div class="field" style="flex:0 0 auto;">
            <label>&nbsp;</label>
            <button type="button" class="pickbtn no-print" id="contpick-${side}" title="Choose side file">⏏</button>
          </div>
          <div class="field">
            <label>Side length (auto from file, or enter manually)</label>
            <input type="text" id="contoverride-${side}" placeholder="m:ss">
          </div>
        </div>
        <div class="filemeta" id="contfilemeta-${side}"></div>
        <input type="file" id="contfileinput-${side}" accept="audio/*" class="hidden">
      </div>

      <div id="trackswrap-${side}">
        <div class="grid-head">
          <div>pos</div><div></div><div>title</div><div>artist</div><div>length</div><div>gap before</div><div></div>
        </div>
        <div id="tracks-${side}"></div>
      </div>
      <button type="button" class="addbtn no-print" id="addbtn-${side}">+ add track</button>

      <div class="side-total">
        <div>
          <div class="total-fig" id="total-${side}">0:00</div>
          <div class="limits-note" id="limitsnote-${side}"></div>
          <div class="meter" id="meter-${side}"><span id="meterfill-${side}" style="width:0%"></span></div>
        </div>
        <span class="badge ok" id="badge-${side}">within recommendation</span>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   Init
   ============================================================ */

// The dropdown's option list is driven by CONFIG.formatCatalogue rather
// than hardcoded in index.html, so disabling a format is a one-line
// config change that takes effect on the next build.
function firstEnabledFormat(){
  const { order, enabled } = CONFIG.formatCatalogue;
  const first = order.find(f => enabled[f]);
  if(first === undefined) throw new Error("CONFIG.formatCatalogue: at least one format must be enabled");
  return first;
}

function populateFormatOptions(){
  firstEnabledFormat(); // throws early if the config disabled every format
  const { order, labels, enabled } = CONFIG.formatCatalogue;
  const select = document.getElementById("format");
  select.innerHTML = order
    .filter(f => enabled[f])
    .map(f => `<option value="${f}">${labels[f]}</option>`)
    .join("");
}

function applyDefaultRpm(){
  const format = parseInt(document.getElementById("format").value, 10);
  const def = CONFIG.defaultRpm[format];
  document.getElementById("rpm-A").value = def;
  document.getElementById("rpm-B").value = def;
  recompute();
}

// Every module renders its own checklist the same way (<ul class="checklist">
// with <li class="ok"|"bad">) — tracklist.js, as the page's thin router,
// checks all of them at once rather than importing each module's own
// completeness check. Refuses to print while anything is flagged, so a
// half-filled order can't go out as a finished-looking PDF.
function printOrder(){
  const missing = document.querySelectorAll(".checklist li.bad");
  if(missing.length > 0){
    missing[0].scrollIntoView({behavior:"smooth", block:"center"});
    alert(`Can't print yet — ${missing.length} item${missing.length===1?"":"s"} still need attention (marked "!"), starting with:\n\n${missing[0].textContent.trim()}`);
    return;
  }
  window.print();
}

export function initTracklist(){
  document.getElementById("copyYear").textContent = new Date().getFullYear();
  populateFormatOptions();
  document.getElementById("sides").innerHTML = sideTemplate("A") + sideTemplate("B");
  ["A","B"].forEach(side=>{
    addTrack(side);
    wireSideOptions(side);
    document.getElementById("rpm-"+side).addEventListener("change", recompute);
  });

  document.getElementById("format").addEventListener("change", applyDefaultRpm);
  document.getElementById("soundsystem").addEventListener("change", recompute);
  document.getElementById("catalogue").addEventListener("input", ()=>{
    document.getElementById("stamp").textContent =
      (document.getElementById("catalogue").value.trim() || "— unsaved —");
    updateChecklist();
  });
  document.getElementById("albumTitle").addEventListener("input", updateChecklist);

  applyDefaultRpm();
  recompute();

  document.getElementById("btnPrint").addEventListener("click", printOrder);
  document.getElementById("btnSaveProject").addEventListener("click", saveProject);
  document.getElementById("btnOpenProject").addEventListener("click", ()=> document.getElementById("openProjectInput").click());
  document.getElementById("openProjectInput").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    if(file) loadProject(file);
  });
  document.getElementById("btnSwissTransfer").addEventListener("click", sendToPlant);
}

function serializeSide(side){
  const catalogue = document.getElementById("catalogue").value;
  const blankChk = side==="B" ? document.getElementById("blankB") : null;
  const cont = document.getElementById("cont-"+side).checked;
  const contFile = document.getElementById("contfile-"+side)._file;
  const data = {
    blank: blankChk ? blankChk.checked : false,
    rpm: document.getElementById("rpm-"+side).value,
    continuous: cont,
    continuousLength: document.getElementById("contoverride-"+side).value,
    continuousFileName: contFile ? continuousSideFileName({catalogue, side, ext: fileExt(contFile.name)}) : null,
    tracks: []
  };
  document.querySelectorAll("#tracks-"+side+" .track-row").forEach((row, i)=>{
    const title = row.querySelector(".title").value;
    const artist = row.querySelector(".artist").value;
    data.tracks.push({
      title, artist,
      length: row.querySelector(".length").value,
      gap: row.querySelector(".gap").value,
      gapCustom: row.querySelector(".gapcustom").value,
      fileName: row._file ? trackFileName({catalogue, side, index: i+1, title, artist, ext: fileExt(row._file.name)}) : null
    });
  });
  return data;
}

function buildProjectObject(){
  return {
    catalogue: document.getElementById("catalogue").value,
    format: document.getElementById("format").value,
    soundsystem: document.getElementById("soundsystem").checked,
    albumTitle: document.getElementById("albumTitle").value,
    albumArtist: document.getElementById("albumArtist").value,
    notes: document.getElementById("notes").value,
    sides: { A: serializeSide("A"), B: serializeSide("B") },
    vinylColor: collectVinylColor(),
    shippingBilling: collectShippingBilling(),
    labels: collectLabels(),
    coverSleeve: collectCoverSleeve()
  };
}

function downloadBlob(blob, fileName){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}

// The project's canonical file name, used both as the zip's own file
// name and as the single folder nested inside it (unzipping then drops
// one tidy folder rather than scattering files loose).
function currentProjectFileName(project){
  const customerEmail = project.shippingBilling && project.shippingBilling.billing
    ? project.shippingBilling.billing.email : null;
  return projectFileName({catalogue: project.catalogue, customerEmail});
}

// A project is always a .zip — see CLAUDE.md's Workflow. Builds it fresh
// from the current form state every time, so it's never stale.
async function buildProjectZip(){
  const project = buildProjectObject();
  const files = await collectPackageFiles();
  files.push({name:"order-summary.txt", data: new TextEncoder().encode(buildSummaryText()).buffer});
  files.push({name:"project.json", data: new TextEncoder().encode(JSON.stringify(project, null, 2)).buffer});

  const baseName = currentProjectFileName(project);
  const foldered = files.map(f => ({name: baseName + "/" + f.name, data: f.data}));
  const blob = await buildZip(foldered);
  return {blob, fileName: baseName + ".zip"};
}

async function saveProject(){
  const {blob, fileName} = await buildProjectZip();
  downloadBlob(blob, fileName);
}

// Strips a zip entry's leading folder ("<project>/A1_..._v1.wav" ->
// "A1_..._v1.wav"), so re-attaching files works whatever the folder was
// named when the zip was built (older exports, or a renamed download).
function baseEntryName(name){
  const i = name.lastIndexOf("/");
  return i === -1 ? name : name.slice(i+1);
}

async function loadProject(file){
  let entries;
  try{
    entries = parseZipBytes(new Uint8Array(await file.arrayBuffer()));
  } catch(err){
    alert("Not a valid project file (" + err.message + ").");
    return;
  }
  const jsonEntry = entries.find(e => baseEntryName(e.name) === "project.json");
  if(!jsonEntry){ alert("No project.json found inside this zip."); return; }

  let p;
  try{ p = JSON.parse(new TextDecoder().decode(jsonEntry.data)); }
  catch(err){ alert("project.json inside the zip isn't valid JSON."); return; }

  // Canonical package name -> File, for auto re-attaching audio/artwork
  // that was renamed to our convention when this zip was built — see
  // trackFileName/printedPartFileName. A project.json loaded stand-alone
  // (not inside one of our zips) simply won't find any matches here.
  const fileMap = new Map();
  entries.forEach(e=>{
    const name = baseEntryName(e.name);
    if(name === "project.json" || name === "order-summary.txt") return;
    fileMap.set(name, new File([e.data], name, {type: mimeType(fileExt(name))}));
  });

  document.getElementById("catalogue").value = p.catalogue || "";
  document.getElementById("format").value = p.format || String(firstEnabledFormat());
  // Formats drive label/cover-sleeve sizing and visibility (big center
  // hole options, preview dimensions) — dispatch so those modules'
  // format-change handlers run before we apply their saved state below.
  document.getElementById("format").dispatchEvent(new Event("change"));
  document.getElementById("soundsystem").checked = !!p.soundsystem;
  document.getElementById("albumTitle").value = p.albumTitle || "";
  document.getElementById("albumArtist").value = p.albumArtist || "";
  document.getElementById("notes").value = p.notes || "";
  applyVinylColor(p.vinylColor);
  applyShippingBilling(p.shippingBilling);
  applyLabels(p.labels, fileMap);
  applyCoverSleeve(p.coverSleeve, fileMap);

  ["A","B"].forEach(side=>{
    const s = (p.sides && p.sides[side]) || {tracks:[]};
    document.getElementById("tracks-"+side).innerHTML = "";
    (s.tracks || []).forEach(t=>{
      addTrack(side);
      const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
      const r = rows[rows.length-1];
      r.querySelector(".title").value = t.title || "";
      r.querySelector(".artist").value = t.artist || "";
      r.querySelector(".length").value = t.length || "";
      r.querySelector(".gap").value = t.gap || "2";
      r.querySelector(".gapcustom").value = t.gapCustom || "2";
      r.querySelector(".gap-wrap").classList.toggle("custom", (t.gap||"2")==="custom");
      const trackFile = t.fileName && fileMap.get(t.fileName);
      if(trackFile){
        attachTrackFile(r, trackFile);
      } else if(t.fileName){
        const m = r.querySelector(".filemeta");
        m.classList.remove("empty");
        m.textContent = "file: " + t.fileName + " — please re-select this file (not stored in the order file)";
      }
    });
    if(!s.tracks || !s.tracks.length) addTrack(side);
    document.getElementById("rpm-"+side).value = s.rpm || CONFIG.defaultRpm[document.getElementById("format").value];
    document.getElementById("cont-"+side).checked = !!s.continuous;
    document.getElementById("cont-"+side).dispatchEvent(new Event("change"));
    document.getElementById("contoverride-"+side).value = s.continuousLength || "";
    const contFile = s.continuousFileName && fileMap.get(s.continuousFileName);
    if(contFile){
      attachContinuousFile(side, contFile);
    } else if(s.continuousFileName){
      document.getElementById("contfilemeta-"+side).textContent =
        "file: " + s.continuousFileName + " — please re-select this file (not stored in the order file)";
    }
    if(side === "B"){
      document.getElementById("blankB").checked = !!s.blank;
      document.getElementById("blankB").dispatchEvent(new Event("change"));
    }
    renumber(side);
  });

  document.getElementById("stamp").textContent = document.getElementById("catalogue").value || "— unsaved —";
  recompute();
}

async function collectPackageFiles(){
  const catalogue = document.getElementById("catalogue").value;
  const files = [];
  for(const side of ["A","B"]){
    const blankChk = side==="B" ? document.getElementById("blankB") : null;
    if(blankChk && blankChk.checked) continue;
    if(document.getElementById("cont-"+side).checked){
      const f = document.getElementById("contfile-"+side)._file;
      if(f) files.push({name: continuousSideFileName({catalogue, side, ext: fileExt(f.name)}), data: await f.arrayBuffer()});
    } else {
      const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
      let i=1;
      for(const row of rows){
        if(row._file){
          const title = row.querySelector(".title").value;
          const artist = row.querySelector(".artist").value;
          const name = trackFileName({catalogue, side, index:i, title, artist, ext: fileExt(row._file.name)});
          files.push({name, data: await row._file.arrayBuffer()});
        }
        i++;
      }
    }
  }
  files.push(...await collectLabelFiles());
  files.push(...await collectCoverSleeveFiles());
  return files;
}

function buildSummaryText(){
  const cat = document.getElementById("catalogue").value || "(no catalogue number)";
  const title = document.getElementById("albumTitle").value;
  const artist = document.getElementById("albumArtist").value;
  const format = document.getElementById("format").value;
  let out = `CUTTING ORDER — ${cat}\n${artist ? artist + " — " : ""}${title || ""}\nFormat: ${format}"\n\n`;
  ["A","B"].forEach(side=>{
    const blankChk = side==="B" ? document.getElementById("blankB") : null;
    out += `SIDE ${side}`;
    if(blankChk && blankChk.checked){ out += " — blank\n\n"; return; }
    out += ` — ${document.getElementById("rpm-"+side).value} RPM — total ${document.getElementById("total-"+side).textContent}\n`;
    if(document.getElementById("cont-"+side).checked){
      const f = document.getElementById("contfile-"+side)._file;
      out += `  continuous file: ${f ? f.name : "(none selected)"}\n`;
    } else {
      document.querySelectorAll("#tracks-"+side+" .track-row").forEach((row,i)=>{
        const t = row.querySelector(".title").value || "(untitled)";
        const a = row.querySelector(".artist").value;
        const len = row.querySelector(".length").value || "?:??";
        const file = row._file ? row._file.name : "(no file — manual entry)";
        if(i > 0){
          const gap = rowGapSeconds(row, false);
          out += `  ${gap === 0 ? "no pause" : gap + "s pause"}\n`;
        }
        out += `  ${side}${i+1}  ${len}  ${t}${a ? " / " + a : ""}  [${file}]\n`;
      });
    }
    out += "\n";
  });
  const notes = document.getElementById("notes").value.trim();
  if(notes) out += `NOTES TO CUTTING ENGINEER:\n${notes}\n`;
  out += "\n" + buildShippingBillingSummary();
  return out;
}

// Same completeness scan printOrder uses (every module's checklist, at
// once), but as a dismissible warning rather than a hard block — the
// plant can still receive and fix an incomplete order if the customer
// chooses to send it anyway. See CLAUDE.md's Workflow, step 4.
function confirmIncompleteSend(){
  const missing = document.querySelectorAll(".checklist li.bad");
  if(missing.length === 0) return true;
  return confirm(
    `${missing.length} item${missing.length===1?"":"s"} still need attention (marked "!"), starting with:\n\n`
    + `${missing[0].textContent.trim()}\n\nSend to the plant anyway?`
  );
}

/* ============================================================
   SwissTransfer — no public browser-callable upload API exists,
   so this stays a two-step handoff: download the package, then
   open a short instruction page telling the person which file to
   upload and where to send it.
   ============================================================ */
async function sendToPlant(){
  if(!confirmIncompleteSend()) return;
  const {blob, fileName} = await buildProjectZip();
  downloadBlob(blob, fileName);

  const cat = document.getElementById("catalogue").value.trim() || "(no catalogue number)";
  const page = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Send via SwissTransfer</title>
<style>
  body{font-family:ui-monospace,"JetBrains Mono","IBM Plex Mono",Consolas,monospace;
       background:#eeece3;color:#1c1b18;max-width:520px;margin:60px auto;padding:0 20px;line-height:1.6;}
  h1{font-size:16px;letter-spacing:.04em;}
  .box{border:1px solid #bdb7a4;border-radius:2px;padding:16px 18px;margin:18px 0;background:#fff;}
  .label{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5c584e;}
  .val{font-size:15px;font-weight:700;margin-top:2px;}
  a.btn{display:inline-block;margin-top:14px;padding:9px 16px;background:#1c1b18;color:#eeece3;
        text-decoration:none;border-radius:2px;font-size:12px;}
  a.btn:hover{background:#d1470f;}
</style></head>
<body>
  <h1>Send via SwissTransfer — ${cat}</h1>
  <div class="box">
    <div class="label">Upload this file</div>
    <div class="val">${fileName}</div>
  </div>
  <div class="box">
    <div class="label">Send to</div>
    <div class="val">${CONFIG.studioEmail}</div>
  </div>
  <p>Open SwissTransfer, add the file above, enter the address above as the recipient, and send.</p>
  <a class="btn" href="https://www.swisstransfer.com/" target="_blank" rel="noopener">Open swisstransfer.com</a>
</body></html>`;
  const pageBlob = new Blob([page], {type:"text/html"});
  window.open(URL.createObjectURL(pageBlob), "_blank");
}

