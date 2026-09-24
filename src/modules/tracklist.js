// Tracklist module — catalogue number, format/RPM, side A/B track
// listing, playing-time warnings, printable order sheet, ZIP package
// export, plant handoff (Send panel).
//
// DOM-coupled by design (this is UI wiring, not a pure lib) — pure
// logic (time parsing, ZIP writer, WAV/AIFF duration, threshold rules)
// lives in src/lib/ and is imported below.

import { CONFIG } from "../config.js";
import { formatTime, parseTime, trackGapSeconds } from "../lib/time.js";
import { readAudioDuration, readAudioSpec, compressionWarning, audioSpecWarning } from "../lib/audio-duration.js";
import { buildZip, parseZipBytes } from "../lib/zip.js";
import { computeStatus, timeLimitRows } from "../lib/playing-time.js";
import { getFormat, enabledFormats, firstEnabledFormat } from "../lib/format-catalogue.js";
import { trackFileName, continuousSideFileName, tracklistFileName, projectFileName, fileExt, mimeType, humanDate, slug } from "../lib/package-naming.js";
import { defaultMatrix } from "../lib/matrix.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { transferLink, transferInstructions } from "../lib/transfer.js";
import { buildSpecsHtml } from "../lib/specs-document.js";
import { PROJECT_VERSION, includeSideFile, prepareProject, assertProjectFiles } from "../lib/project.js";
import { buildOrderSummaryText, buildTracklistText } from "../lib/order-documents.js";
import { collectLabelFiles, collectLabels, applyLabels, labelIssues } from "./labels.js";
import { collectCoverFiles, collectCover, applyCover, coverIssues } from "./cover.js";
import { collectInnerSleeveFiles, collectInnerSleeve, applyInnerSleeve, innerSleeveIssues } from "./inner-sleeve.js";
import { collectInlayFiles, collectInlay, applyInlay, inlayIssues } from "./inlay.js";
import { collectVinylColor, applyVinylColor } from "./vinyl-color.js";
import { collectShippingBilling, applyShippingBilling } from "./shipping-billing.js";

// Renders "file: <current name> — <status>", plus a tight second line
// with the original filename when it differs from the current one —
// only true after a project reload re-attaches a file by its renamed
// (convention) name; a fresh manual pick has nothing to show there.
// Built with DOM nodes rather than innerHTML since file names are
// untrusted strings (the customer's own upload).
function renderFileMeta(el, currentName, originalName, statusText){
  el.textContent = "";
  el.append(statusText ? `file: ${currentName} — ${statusText}` : `file: ${currentName}`);
  if(originalName && originalName !== currentName){
    el.append(document.createElement("br"));
    const orig = document.createElement("span");
    orig.className = "filemeta-orig";
    orig.textContent = "was: " + originalName;
    el.append(orig);
  }
}

// Shared by the manual file-input handler and loadProject's zip
// re-attach path, so both go through the same duration-reading/warning
// logic. originalFileName defaults to the file's own name (a fresh
// manual pick); loadProject passes the name recorded before renaming,
// so renderFileMeta can show it as the "was:" line. fillLength is false
// only on a project reload that already restored a saved, possibly
// manual, length — the read then only reports the file's duration
// instead of overwriting the field.
function attachTrackFile(row, f, originalFileName = f.name, fillLength = true){
  const revision = (row._analysisRevision || 0) + 1;
  row._analysisRevision = revision;
  row._file = f;
  row._originalFileName = originalFileName;
  row._analysisPending = true;
  row._analysisError = null;
  const pickbtn = row.querySelector(".pickbtn");
  const meta = row.querySelector(".filemeta");
  const lengthInput = row.querySelector(".length");
  pickbtn.classList.add("has-file");
  renderFileMeta(meta, f.name, originalFileName, "reading duration…");
  meta.classList.remove("empty");
  meta.classList.remove("warn", "compressed", "underspec");
  const compressionWarn = compressionWarning(f);
  recompute();
  row._analysisPromise = Promise.all([readAudioDuration(f), readAudioSpec(f)]).then(([dur, spec])=>{
    if(row._analysisRevision !== revision || row._file !== f) return;
    const durText = (isFinite(dur) && dur > 0)
      ? (()=>{ if(fillLength) lengthInput.value = formatTime(dur); recompute();
               return formatTime(dur) + (fillLength ? " (auto)" : " (from file)"); })()
      : "could not read duration, enter length manually";
    const specWarn = audioSpecWarning(spec, CONFIG.audioSpec);
    const warning = [compressionWarn, specWarn].filter(Boolean).join("  ");
    renderFileMeta(meta, f.name, originalFileName, durText + (warning ? "  " + warning : ""));
    meta.classList.toggle("warn", !!warning);
    meta.classList.toggle("compressed", !!compressionWarn);
    meta.classList.toggle("underspec", !!specWarn);
    row._analysisPending = false;
    recompute();
  }).catch(error=>{
    if(row._analysisRevision !== revision || row._file !== f) return;
    row._analysisPending = false;
    row._analysisError = error;
    renderFileMeta(meta, f.name, originalFileName, "could not inspect file, enter length manually");
    recompute();
  });
}

function createTrackRow(side){
  const row = document.createElement("div");
  row.className = "track-row";
  row.innerHTML = `
    <div class="pos">--</div>
    <button type="button" class="pickbtn no-print" title="Choose audio file">↑</button>
    <div class="field" style="margin:0;"><input type="text" class="title" placeholder="track title (optional)"></div>
    <div class="field artist-field" style="margin:0;">
      <input type="text" class="artist" placeholder="artist (optional)" readonly>
      <button type="button" class="artist-change no-print">change</button>
      <button type="button" class="artist-revert no-print hidden">revert</button>
    </div>
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
    <button type="button" class="rmbtn no-print" title="Remove track">x</button>
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

  // Most releases are single-artist — a new track starts "linked": its
  // artist field is read-only and mirrors Album Artist live (see
  // syncAlbumArtistToLinkedTracks), so nobody has to retype it on every
  // row and it can never drift out of sync while typing. "change"
  // unlocks it into an ordinary input for the various-artists case —
  // from then on it's this track's own value, no longer linked. "revert"
  // undoes that: re-links the field and snaps it back to Album Artist.
  row.querySelector(".artist").value = document.getElementById("albumArtist").value;
  row.querySelector(".artist-change").addEventListener("click", ()=>{
    setArtistLinked(row, false);
    const artistInput = row.querySelector(".artist");
    artistInput.focus();
    artistInput.select();
  });
  row.querySelector(".artist-revert").addEventListener("click", ()=>{
    setArtistLinked(row, true);
  });

  pickbtn.addEventListener("click", ()=> fileInput.click());
  fileInput.addEventListener("change", ()=>{
    const f = fileInput.files[0];
    // Clear before the async read so re-picking the same file (e.g.
    // after re-exporting it) fires "change" again.
    fileInput.value = "";
    if(f) attachTrackFile(row, f);
  });

  lengthInput.addEventListener("input", recompute);
  gapSel.addEventListener("change", ()=>{
    gapWrap.classList.toggle("custom", gapSel.value === "custom");
    recompute();
  });
  gapCustom.addEventListener("input", recompute);
  row.querySelector(".rmbtn").addEventListener("click", ()=>{
    row._analysisRevision = (row._analysisRevision || 0) + 1;
    row.remove(); renumber(side); recompute();
  });

  return row;
}

// Single place that flips a track's artist field between linked
// (read-only, mirrors Album Artist) and its own value — used by
// "change", "revert", and project reload, so the readOnly flag, the
// change/revert link visibility, and the value stay consistent no
// matter which of those three sets the state.
function setArtistLinked(row, linked){
  const artistInput = row.querySelector(".artist");
  artistInput.readOnly = linked;
  row.querySelector(".artist-change").classList.toggle("hidden", !linked);
  row.querySelector(".artist-revert").classList.toggle("hidden", linked);
  if(linked) artistInput.value = document.getElementById("albumArtist").value;
}

// A track's artist is the album artist for as long as it stays
// "linked" (read-only, no "change" click yet) — mirrored live on every
// keystroke, never a one-time copy, so it can't go stale or truncate
// mid-typing. A track past "change" is read-only:false and skipped.
function syncAlbumArtistToLinkedTracks(){
  const albumArtist = document.getElementById("albumArtist").value;
  document.querySelectorAll(".track-row .artist[readonly]").forEach(input=>{
    input.value = albumArtist;
  });
}

function rowGapSeconds(row, isFirst){
  return trackGapSeconds({
    gap: row.querySelector(".gap").value,
    gapCustom: row.querySelector(".gapcustom").value
  }, isFirst);
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
function attachContinuousFile(side, f, originalFileName = f.name){
  const contWrap = document.getElementById("contfile-"+side);
  const contMeta = document.getElementById("contfilemeta-"+side);
  const contOverride = document.getElementById("contoverride-"+side);
  const revision = (contWrap._analysisRevision || 0) + 1;
  contWrap._analysisRevision = revision;
  contWrap._file = f;
  contWrap._originalFileName = originalFileName;
  contWrap._analysisPending = true;
  contWrap._analysisError = null;
  renderFileMeta(contMeta, f.name, originalFileName, "reading duration…");
  contMeta.classList.remove("warn", "compressed", "underspec");
  const compressionWarn = compressionWarning(f);
  recompute();
  contWrap._analysisPromise = Promise.all([readAudioDuration(f), readAudioSpec(f)]).then(([dur, spec])=>{
    if(contWrap._analysisRevision !== revision || contWrap._file !== f) return;
    // The read length lands in the field itself (contoverride), not
    // restated here next to the filename — unlike attachTrackFile,
    // which has no separate always-visible length field of its own to
    // put it in.
    let statusText = "";
    if(isFinite(dur) && dur > 0){
      contOverride.value = formatTime(dur);
    } else {
      statusText = "could not read duration, enter length manually";
    }
    const specWarn = audioSpecWarning(spec, CONFIG.audioSpec);
    const warning = [compressionWarn, specWarn].filter(Boolean).join("  ");
    if(warning) statusText += (statusText ? "  " : "") + warning;
    renderFileMeta(contMeta, f.name, originalFileName, statusText);
    contMeta.classList.toggle("warn", !!warning);
    contMeta.classList.toggle("compressed", !!compressionWarn);
    contMeta.classList.toggle("underspec", !!specWarn);
    contWrap._analysisPending = false;
    recompute();
  }).catch(error=>{
    if(contWrap._analysisRevision !== revision || contWrap._file !== f) return;
    contWrap._analysisPending = false;
    contWrap._analysisError = error;
    renderFileMeta(contMeta, f.name, originalFileName, "could not inspect file, enter length manually");
    recompute();
  });
}

function clearContinuousFile(side){
  const wrap = document.getElementById("contfile-"+side);
  wrap._analysisRevision = (wrap._analysisRevision || 0) + 1;
  wrap._file = null;
  wrap._originalFileName = null;
  wrap._analysisPending = false;
  wrap._analysisError = null;
  wrap._analysisPromise = null;
  document.getElementById("contfileinput-"+side).value = "";
  const meta = document.getElementById("contfilemeta-"+side);
  meta.classList.remove("warn", "compressed", "underspec");
  meta.innerHTML = `file: <span class="filemeta-placeholder">please select</span>`;
}

/* ============================================================
   Per-side tracklist / cuesheet upload
   Offered only in continuous ("all tracks in one file per side") mode —
   see #tracklistfile-<side> in sideTemplate. The file is attached to the
   package verbatim; never parsed. State lives on the wrapper element,
   same as the continuous audio file's.
   ============================================================ */

function renderTracklistMeta(side, currentName, originalName){
  const meta = document.getElementById("tracklistmeta-"+side);
  meta.textContent = "";
  meta.append(`file: ${currentName}`);
  if(originalName && originalName !== currentName){
    meta.append(document.createElement("br"));
    const orig = document.createElement("span");
    orig.className = "filemeta-orig";
    orig.textContent = "was: " + originalName;
    meta.append(orig);
  }
  meta.classList.remove("empty");
}

function attachTracklistFile(side, f, originalFileName = f.name){
  const wrap = document.getElementById("tracklistfile-"+side);
  wrap._file = f;
  wrap._originalFileName = originalFileName;
  document.getElementById("tracklistremove-"+side).classList.remove("hidden");
  renderTracklistMeta(side, f.name, originalFileName);
}

function clearTracklistFile(side){
  const wrap = document.getElementById("tracklistfile-"+side);
  wrap._file = null;
  wrap._originalFileName = null;
  document.getElementById("tracklistinput-"+side).value = "";
  document.getElementById("tracklistremove-"+side).classList.add("hidden");
  const meta = document.getElementById("tracklistmeta-"+side);
  meta.textContent = "";
  meta.classList.add("empty");
}

// Visual side-effects of the "all tracks in one file per side" mode:
// reveal the continuous-file block and disable the now-irrelevant
// per-track file/gap controls. Kept separate from the change handler so
// loadProject can apply a saved state without triggering a cross-side
// sync.
function applyContinuousState(side, on){
  document.getElementById("contfile-"+side).classList.toggle("hidden", !on);
  const tracksWrap = document.getElementById("trackswrap-"+side);
  tracksWrap.querySelectorAll(".gap-wrap select, .pickbtn").forEach(el=>{
    el.disabled = on;
  });
  tracksWrap.querySelectorAll(".gap-wrap").forEach(el=> el.style.opacity = on ? .4 : 1);
}

// One "all tracks in one file per side" mode for the whole release: the
// two sides' checkboxes mirror each other. Set directly, not via a
// dispatched change, so the two change handlers can't ping-pong.
function setContinuous(side, on){
  const other = side === "A" ? "B" : "A";
  document.getElementById("cont-"+side).checked = on;
  document.getElementById("cont-"+other).checked = on;
  applyContinuousState(side, on);
  applyContinuousState(other, on);
  recompute();
}

function wireSideOptions(side){
  const contChk = document.getElementById("cont-"+side);
  const addBtn = document.getElementById("addbtn-"+side);
  const blankChk = side === "B" ? document.getElementById("blankB") : null;
  const sideBody = document.getElementById("body-"+side);

  contChk.addEventListener("change", ()=> setContinuous(side, contChk.checked));

  const contFileInput = document.getElementById("contfileinput-"+side);
  const contOverride = document.getElementById("contoverride-"+side);
  document.getElementById("contpick-"+side).addEventListener("click", ()=> contFileInput.click());
  contFileInput.addEventListener("change", ()=>{
    const f = contFileInput.files[0];
    contFileInput.value = ""; // re-picking the same file must fire change again
    if(f) attachContinuousFile(side, f);
  });
  contOverride.addEventListener("input", recompute);

  const tracklistInput = document.getElementById("tracklistinput-"+side);
  document.getElementById("tracklistpick-"+side).addEventListener("click", ()=> tracklistInput.click());
  tracklistInput.addEventListener("change", ()=>{
    const f = tracklistInput.files[0];
    tracklistInput.value = ""; // re-picking the same file must fire change again
    if(f) attachTracklistFile(side, f);
  });
  document.getElementById("tracklistremove-"+side).addEventListener("click", ()=> clearTracklistFile(side));

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
  const format = document.getElementById("format").value;
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
  return computeStatus(getFormat(CONFIG, format).timeLimits, rpm, mode, seconds);
}

function recompute(){
  ["A","B"].forEach(side=>{
    const seconds = computeSideSeconds(side);
    const {level} = statusFor(seconds, side);
    const totalFig = document.getElementById("total-"+side);
    const badge = document.getElementById("badge-"+side);

    totalFig.textContent = formatTime(seconds);
    badge.className = "badge " + level;
    badge.textContent = level === "ok" ? "within recommendation"
                       : level === "warn" ? "approaching limit"
                       : "exceeds recommendation";
  });
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
  const hasSideA = contA ? (parseTime(document.getElementById("contoverride-A").value) || 0) > 0
                          : Array.from(rowsA).some(r=> (parseTime(r.querySelector(".length").value) || 0) > 0);
  items.push([hasSideA, hasSideA ? "Side A has timed content" : "Side A has no timed tracks yet"]);

  const blankB = document.getElementById("blankB").checked;
  if(!blankB){
    const rowsB = document.querySelectorAll("#tracks-B .track-row");
    const contB = document.getElementById("cont-B").checked;
    const hasSideB = contB ? (parseTime(document.getElementById("contoverride-B").value) || 0) > 0
                            : Array.from(rowsB).some(r=> (parseTime(r.querySelector(".length").value) || 0) > 0);
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

  let invalidTimes = 0;
  let invalidGaps = 0;
  let pendingAudio = 0;
  ["A","B"].forEach(side=>{
    if(side === "B" && document.getElementById("blankB").checked) return;
    const continuous = document.getElementById("cont-"+side).checked;
    if(continuous){
      const raw = document.getElementById("contoverride-"+side).value.trim();
      if(raw && parseTime(raw) === null) invalidTimes++;
      if(document.getElementById("contfile-"+side)._analysisPending) pendingAudio++;
      return;
    }
    document.querySelectorAll("#tracks-"+side+" .track-row").forEach(row=>{
      const raw = row.querySelector(".length").value.trim();
      if(raw && parseTime(raw) === null) invalidTimes++;
      if(row.querySelector(".gap").value === "custom"){
        const gap = row.querySelector(".gapcustom").value.trim();
        if(!/^\d+(?:\.\d+)?$/.test(gap) || !Number.isFinite(Number(gap))) invalidGaps++;
      }
      if(row._analysisPending) pendingAudio++;
    });
  });
  if(invalidTimes) items.push([false, `${invalidTimes} track/side length value(s) are invalid`]);
  if(invalidGaps) items.push([false, `${invalidGaps} custom gap value(s) are invalid`]);
  if(pendingAudio) items.push([false, `${pendingAudio} audio file inspection(s) still pending`, true, true]);

  // Separate classes, not the shared .filemeta.warn: a compressed-format
  // warning and a below-spec (bit depth/sample rate) warning are
  // different problems with different fixes — see attachTrackFile.
  const compressedCount = document.querySelectorAll(".filemeta.compressed").length;
  if(compressedCount > 0){
    items.push([false, `${compressedCount} compressed file(s) attached — replace with WAV/AIFF`]);
  }
  const underspecCount = document.querySelectorAll(".filemeta.underspec").length;
  if(underspecCount > 0){
    items.push([false, `${underspecCount} file(s) below audio spec — check bit depth / sample rate`]);
  }

  const artworkIssues = [
    ...labelIssues(), ...coverIssues(), ...innerSleeveIssues(), ...inlayIssues()
  ];
  artworkIssues.forEach(issue=> items.push([false, issue.text, issue.blocking, issue.pending]));

  // Satisfied (ok) items are hidden outside debug mode — this is a
  // status block a customer checks before sending, not a running log of
  // everything that's already fine; a still-blank form filling up with
  // green checkmarks (or red "not yet attached" warnings for parts they
  // haven't reached yet) is noise, not signal. Nothing queries
  // ".checklist li.ok" anywhere (confirmIncompleteSend/printOrder only
  // ever look at li.bad), so omitting ok rows from the DOM entirely is
  // safe — it doesn't affect Send/Print gating.
  const visibleItems = isDebugMode() ? items : items.filter(([ok]) => !ok);
  list.innerHTML = visibleItems.map(([ok, text, blocking, pending])=>
    `<li class="${ok?'ok':'bad'}${blocking?' blocking':''}${pending?' pending':''}"><span class="mark">${ok?'✓':'!'}</span>${text}</li>`
  ).join("");
}

/* ============================================================
   Side template
   ============================================================ */

// Audio Master Files spec box — sits at the top of Side A, directly
// under its heading: it describes the per-side audio files the customer
// is about to attach to the tracklist below it.
const AUDIO_SPECS_HTML = `
      <details class="specs no-print">
        <summary>Specifications</summary>
        <div class="specs-body">
          <div><span>Allowed filetypes</span><span id="audioSpecFiletypes"></span></div>
          <div><span>Bit depth</span><span id="audioSpecBitDepth"></span></div>
          <div><span>Sample rate</span><span id="audioSpecSampleRate"></span></div>
          <div><span>Playing time per side</span><span>ideal / max</span></div>
          <div class="specs-rows" id="timeLimitSpecs"></div>
        </div>
      </details>`;

function sideTemplate(side){
  const isB = side === "B";
  return `
  <div id="sidebox-${side}">
    <div class="side-head">
      <h2>Side ${side}</h2>
      ${isB ? `<div class="side-opts"><label class="chk"><input type="checkbox" id="blankB"> blank / not used</label></div>` : ""}
    </div>

    <div id="body-${side}">
      ${side === "A" ? AUDIO_SPECS_HTML : ""}
      <div class="row" style="align-items:center;">
        <label class="chk">RPM
          <select id="rpm-${side}" class="rpm-select">
            <option value="33">33⅓</option>
            <option value="45">45</option>
          </select>
        </label>
        <label class="chk"><input type="checkbox" id="cont-${side}"> all tracks in one file per side</label>
      </div>

      <div class="hidden" id="contfile-${side}">
        <div class="row" style="align-items:center;">
          <button type="button" class="pickbtn no-print" id="contpick-${side}" title="Choose side file">↑</button>
          <div class="filemeta" id="contfilemeta-${side}" style="margin:0; font-size:13.5px;">file: <span class="filemeta-placeholder">please select</span></div>
          <div class="len-wrap" style="flex:0 0 84px;">
            <input type="text" id="contoverride-${side}" placeholder="m:ss" title="Side length (auto from file, or enter manually)" style="text-align:left;">
          </div>
        </div>
        <input type="file" id="contfileinput-${side}" accept="audio/*" class="hidden">

        <div class="field" id="tracklistfile-${side}" style="margin:10px 0 0;">
          <label class="hint">Create tracklist below, or upload as file (.txt/.pdf)</label>
          <div class="row" style="align-items:center; flex-wrap:nowrap;">
            <button type="button" class="pickbtn no-print" id="tracklistpick-${side}" title="Choose tracklist / cuesheet file">↑</button>
            <div class="filemeta empty" id="tracklistmeta-${side}" style="margin:0; font-size:13.5px;"></div>
            <button type="button" class="rmbtn no-print hidden" id="tracklistremove-${side}" title="Remove tracklist file">x</button>
          </div>
          <input type="file" id="tracklistinput-${side}" accept="${CONFIG.tracklistFileTypes.accept}" class="hidden">
        </div>
      </div>

      <div id="trackswrap-${side}">
        <div class="grid-head">
          <div></div><div></div><div></div><div></div><div></div><div>gap</div><div></div>
        </div>
        <div id="tracks-${side}"></div>
      </div>
      <button type="button" class="addbtn no-print" id="addbtn-${side}">+ add track</button>

      <div class="side-total">
        <div>total playing time: <span class="total-fig" id="total-${side}">0:00</span></div>
        <span class="badge ok" id="badge-${side}">within recommendation</span>
      </div>

      <div class="field" style="max-width:260px; margin-top:12px;">
        <label>Matrix / Runout Inscription</label>
        <input type="text" id="matrix-${side}" maxlength="60">
      </div>
    </div>
  </div>`;
}

/* ============================================================
   Init
   ============================================================ */

// The dropdown's option list is driven by CONFIG.formats rather than
// hardcoded in index.html, so disabling a format is a one-line config
// change that takes effect on the next build.
function populateFormatOptions(){
  firstEnabledFormat(CONFIG); // throws early if the config disabled every format
  const select = document.getElementById("format");
  select.innerHTML = enabledFormats(CONFIG)
    .map(f => `<option value="${f.id}">${f.label}</option>`)
    .join("");
}

function ensureFormatOption(formatId){
  const select = document.getElementById("format");
  if(Array.from(select.options).some(option => option.value === formatId)) return;
  const format = getFormat(CONFIG, formatId);
  const option = document.createElement("option");
  option.value = format.id;
  option.textContent = `${format.label} (disabled for new orders)`;
  option.disabled = true;
  select.appendChild(option);
}

function applyDefaultRpm(){
  const format = document.getElementById("format").value;
  const def = getFormat(CONFIG, format).rpm;
  document.getElementById("rpm-A").value = def;
  document.getElementById("rpm-B").value = def;
  recompute();
}

// Matrix/runout inscription defaults to "<catalogue> <side>" and tracks
// the catalogue number until the customer types their own — same
// explicit-state idea as a track's artist field above (readonly until
// "change"), so a deliberate edit is never silently overwritten and
// nothing relies on guessing intent from an emptiness check. Here the
// flag is input._auto (false once the field has been typed into)
// rather than a DOM attribute, because a touched matrix field is never
// actually empty — it starts pre-filled. Whether a project was saved
// with the field still on "auto" is itself persisted (see
// serializeSide/loadProject) so that state survives a save/reload
// round-trip and doesn't refreeze on a stale value.
function applyDefaultMatrix(){
  const catalogue = document.getElementById("catalogue").value;
  ["A","B"].forEach(side=>{
    const input = document.getElementById("matrix-"+side);
    if(input._auto === false) return;
    input.value = defaultMatrix(catalogue, side).toUpperCase();
  });
}

// All modules render the same checklist item shape. Refuse to print while
// any module still reports an issue, so an incomplete form cannot look final.
function printOrder(){
  // Force a fresh check rather than trusting whatever last triggered
  // updateChecklist() — artwork state (a file attached, a mode toggled)
  // lives in other modules' DOM and doesn't reactively re-run this.
  updateChecklist();
  const missing = document.querySelectorAll(".checklist li.bad");
  if(missing.length > 0){
    missing[0].scrollIntoView({behavior:"smooth", block:"center"});
    alert(`Can't print yet — ${missing.length} item${missing.length===1?"":"s"} still need attention (marked "!"), starting with:\n\n${missing[0].textContent.trim()}`);
    return;
  }
  window.print();
}

// EU/German legal imprint requirement (Impressum) — kept small in the
// page footer, sourced from CONFIG.plant.imprint (sample/placeholder
// unless overridden by plant.config.local.js at build time — see
// config.js). A reasonable general field set, not legal advice.
function renderImprint(){
  const p = CONFIG.plant.imprint;
  const addressLine = [p.recipientName, p.addressLine1, p.addressLine2, p.addressLine3].filter(Boolean).join(", ");
  const cityLine = [[p.postalCode, p.city].filter(Boolean).join(" "), p.countryCode].filter(Boolean).join(", ");
  const parts = [addressLine, cityLine, p.email, p.phone, p.vat && `VAT ${p.vat}`].filter(Boolean);
  document.getElementById("imprint").textContent = parts.join(" · ");
}

// Populates the Audio Master Files Specifications disclosure from
// CONFIG.audioSpec — never hand-typed. Format-agnostic (same regardless
// of 7"/10"/12"), so this only needs to run once, not on format change.
function renderAudioSpecs(){
  const a = CONFIG.audioSpec;
  document.getElementById("audioSpecFiletypes").textContent = a.labels.join(", ");
  document.getElementById("audioSpecBitDepth").textContent = `>=${a.minBitDepth}-bit (${a.recommendedBitDepth}-bit recommended)`;
  document.getElementById("audioSpecSampleRate").textContent = `>=${a.minSampleRateHz/1000}kHz`;
}

// The selected format's playing-time limits for every cut and rpm — a
// reference, deliberately apart from the cut the customer picks below.
function renderTimeLimitSpecs(){
  const rows = timeLimitRows(getFormat(CONFIG, document.getElementById("format").value).timeLimits);
  document.getElementById("timeLimitSpecs").innerHTML =
    rows.map(row => `<div><span>${row.label}</span><span>${row.text}</span></div>`).join("");
}

export function initTracklist(){
  renderImprint();
  populateFormatOptions();
  document.getElementById("sides").innerHTML = sideTemplate("A") + sideTemplate("B");
  renderAudioSpecs();
  renderTimeLimitSpecs();
  ["A","B"].forEach(side=>{
    addTrack(side);
    wireSideOptions(side);
    document.getElementById("rpm-"+side).addEventListener("change", recompute);
    document.getElementById("matrix-"+side).addEventListener("input", (e)=>{
      e.target._auto = false;
      // Etched into the runout groove exactly as typed — force the
      // actual value uppercase (not just a CSS display trick), so
      // project.json/order_summary.txt carry what really gets cut.
      // Uppercasing never changes string length, so the cursor position
      // stays put.
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase();
      e.target.setSelectionRange(pos, pos);
    });
  });

  document.getElementById("format").addEventListener("change", applyDefaultRpm);
  document.getElementById("format").addEventListener("change", renderTimeLimitSpecs);
  document.getElementById("soundsystem").addEventListener("change", recompute);
  document.getElementById("catalogue").addEventListener("input", ()=>{
    document.getElementById("stamp").textContent =
      (document.getElementById("catalogue").value.trim() || "— unsaved —");
    applyDefaultMatrix();
    updateChecklist();
  });
  document.getElementById("albumTitle").addEventListener("input", updateChecklist);
  document.getElementById("albumArtist").addEventListener("input", syncAlbumArtistToLinkedTracks);

  // Native changes cover tracklist, quantity, and address controls.
  // Artwork modules also receive updateChecklist as an explicit callback
  // for asynchronous inspection completion.
  document.addEventListener("change", updateChecklist);

  applyDefaultRpm();
  applyDefaultMatrix();
  recompute();

  document.getElementById("btnPrint").addEventListener("click", printOrder);
  document.getElementById("btnDownloadSpecs").addEventListener("click", openSpecs);
  document.getElementById("btnSaveProject").addEventListener("click", ()=> runProjectAction(saveProject, "Couldn't save project"));
  document.getElementById("btnOpenProject").addEventListener("click", ()=> document.getElementById("openProjectInput").click());
  document.getElementById("openProjectInput").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    if(file) runProjectAction(()=> loadProject(file), "Couldn't open project");
  });
  document.getElementById("btnSend").addEventListener("click", ()=> runProjectAction(sendToPlant, "Couldn't prepare project package"));
  document.getElementById("btnResendZip").addEventListener("click", ()=>{
    if(!lastSentZip) return;
    downloadBlob(lastSentZip.blob, lastSentZip.fileName);
  });
  document.getElementById("btnCopyInstructions").addEventListener("click", ()=>{
    if(!lastSentZip) return;
    const steps = transferInstructions(CONFIG.plant.transfer, lastSentZip.fileName);
    copyToClipboard(steps.join("\n"));
  });
  return updateChecklist;
}

function serializeSide(side, forSend = false){
  const catalogue = document.getElementById("catalogue").value;
  const blankChk = side==="B" ? document.getElementById("blankB") : null;
  const blank = blankChk ? blankChk.checked : false;
  const cont = document.getElementById("cont-"+side).checked;
  const contWrap = document.getElementById("contfile-"+side);
  const contFile = contWrap._file;
  const includeContinuous = contFile && includeSideFile({forSend, blank, continuous:cont, kind:"continuous"});
  const tracklistWrap = document.getElementById("tracklistfile-"+side);
  const tracklistFile = tracklistWrap._file;
  const includeTracklist = tracklistFile && includeSideFile({forSend, blank, continuous:cont, kind:"continuous"});
  const matrixInput = document.getElementById("matrix-"+side);
  const data = {
    blank,
    rpm: document.getElementById("rpm-"+side).value,
    matrixInscription: matrixInput.value,
    matrixInscriptionAuto: matrixInput._auto !== false,
    continuous: cont,
    continuousLength: document.getElementById("contoverride-"+side).value,
    continuousFileName: includeContinuous ? continuousSideFileName({catalogue, side, ext: fileExt(contFile.name)}) : null,
    continuousOriginalFileName: includeContinuous ? (contWrap._originalFileName || contFile.name) : null,
    tracklistFileName: includeTracklist ? tracklistFileName({catalogue, side, ext: fileExt(tracklistFile.name)}) : null,
    tracklistOriginalFileName: includeTracklist ? (tracklistWrap._originalFileName || tracklistFile.name) : null,
    tracks: []
  };
  document.querySelectorAll("#tracks-"+side+" .track-row").forEach((row, i)=>{
    const title = row.querySelector(".title").value;
    const artistInput = row.querySelector(".artist");
    const artist = artistInput.value;
    data.tracks.push({
      title, artist,
      artistLinked: artistInput.readOnly,
      length: row.querySelector(".length").value,
      gap: row.querySelector(".gap").value,
      gapCustom: row.querySelector(".gapcustom").value,
      fileName: row._file && includeSideFile({forSend, blank, continuous:cont, kind:"track"})
        ? trackFileName({catalogue, side, index: i+1, title, artist, ext: fileExt(row._file.name)}) : null,
      originalFileName: row._file && includeSideFile({forSend, blank, continuous:cont, kind:"track"})
        ? (row._originalFileName || row._file.name) : null
    });
  });
  return data;
}

// Plant edit notes (see project.json history). No field shows them; they
// ride along from the loaded project.json to the next save.
let projectHistory = [];

function buildProjectObject(forSend = false){
  return {
    projectVersion: PROJECT_VERSION,
    catalogue: document.getElementById("catalogue").value,
    format: document.getElementById("format").value,
    soundsystem: document.getElementById("soundsystem").checked,
    albumTitle: document.getElementById("albumTitle").value,
    albumArtist: document.getElementById("albumArtist").value,
    notes: document.getElementById("notes").value,
    sides: { A: serializeSide("A", forSend), B: serializeSide("B", forSend) },
    vinylColor: collectVinylColor(),
    shippingBilling: collectShippingBilling(),
    labels: collectLabels(forSend),
    coverSleeve: { cover: collectCover(), innerSleeve: collectInnerSleeve(), inlay: collectInlay() },
    history: projectHistory
  };
}

function downloadBlob(blob, fileName){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  // a.click() only *starts* the download — Safari/Firefox stream it
  // asynchronously, so revoking the object URL on the very next line can
  // abort large downloads (a multi-hundred-MB project zip is exactly the
  // case that hits this). Deferred, not immediate.
  setTimeout(()=> URL.revokeObjectURL(a.href), 30000);
}

// "Specs" button — a standalone reference document (every enabled
// format's label/printed-part/audio specs), independent of the current
// order (works with no catalogue number entered at all). Opens in a new
// tab: all of this is synchronous, so window.open() still runs inside
// the click's user gesture and isn't popup-blocked (unlike sendToPlant's
// async zip build). A browser that blocks it anyway falls back to a
// download.
//
// The tab is opened at a blob URL instead of an about:blank document
// written into: that gives it a real same-origin URL, which Safari needs
// to treat its template PDF links as same-origin downloads rather than
// navigating the tab away.
function openSpecs(){
  const html = buildSpecsHtml(CONFIG);
  const url = URL.createObjectURL(new Blob([html], {type:"text/html"}));
  const w = window.open(url, "_blank");
  if(!w){
    URL.revokeObjectURL(url);
    const name = slug(CONFIG.plant.imprint.recipientName) || "specifications";
    downloadBlob(new Blob([html], {type:"text/html"}), `${name}_specifications.html`);
    return;
  }
  // Deliberately not revoked: the tab may be reloaded or bookmarked, and
  // the document is a few tens of KB.
  try{ w.opener = null; }catch(e){ /* opener already unreachable — fine */ }
}

// The project's canonical file name, used both as the zip's own file
// name and as the single folder nested inside it (unzipping then drops
// one tidy folder rather than scattering files loose).
function currentProjectFileName(project, date){
  const customerEmail = project.shippingBilling && project.shippingBilling.billing
    ? project.shippingBilling.billing.email : null;
  return projectFileName({catalogue: project.catalogue, customerEmail, date});
}

async function waitForAudioInspections(forSend){
  const pending = [];
  for(const side of ["A", "B"]){
    const blank = side === "B" && document.getElementById("blankB").checked;
    const continuous = document.getElementById("cont-"+side).checked;
    const sideWrap = document.getElementById("contfile-"+side);
    if(sideWrap._analysisPromise && includeSideFile({forSend, blank, continuous, kind:"continuous"})){
      pending.push(sideWrap._analysisPromise);
    }
    document.querySelectorAll("#tracks-"+side+" .track-row").forEach(row=>{
      if(row._analysisPromise && includeSideFile({forSend, blank, continuous, kind:"track"})) pending.push(row._analysisPromise);
    });
  }
  await Promise.all(pending);
}

// A project is always a .zip — see CLAUDE.md's Workflow. Builds it fresh
// from the current form state every time, so it's never stale.
// forSend: true for the package handed to the plant (sendToPlant),
// false for a customer-facing save (saveProject). Saves retain inactive
// draft audio and whitelabel artwork; send packages contain only files
// used by the production choices in project.json.
async function buildProjectZip(forSend = false){
  await waitForAudioInspections(forSend);
  const date = new Date();
  const project = buildProjectObject(forSend);
  const files = collectPackageFiles(forSend);
  assertProjectFiles(project, files);
  files.push({name:"order_summary.txt", data: new TextEncoder().encode(buildOrderSummaryText(project, CONFIG, date))});
  files.push({name:"tracklist.txt", data: new TextEncoder().encode(buildTracklistText(project, CONFIG, date))});
  files.push({name:"project.json", data: new TextEncoder().encode(JSON.stringify(project, null, 2)).buffer});

  const baseName = currentProjectFileName(project, date);
  const foldered = files.map(f => ({name: baseName + "/" + f.name, data: f.data}));
  const blob = await buildZip(foldered);
  return {blob, fileName: baseName + ".zip"};
}

// Local clock time, HH:MM — humanDate() (package-naming.js) already
// gives the date half; this just adds hours/minutes for the header
// stamp, which is the only place a save needs to show a time as well.
function stampSaved(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  document.getElementById("stamp").textContent = `Last saved ${humanDate(d)} ${hh}:${min}`;
}

let projectActionRunning = false;
async function runProjectAction(action, errorMessage){
  if(projectActionRunning) return;
  projectActionRunning = true;
  const sheet = document.querySelector(".sheet");
  sheet.inert = true;
  sheet.setAttribute("aria-busy", "true");
  const controls = ["btnSaveProject", "btnOpenProject", "btnSend"].map(id => document.getElementById(id));
  controls.forEach(control => { control.disabled = true; });
  try{
    await action();
  }catch(error){
    alert(`${errorMessage}: ${error.message || error}`);
  }finally{
    controls.forEach(control => { control.disabled = false; });
    sheet.inert = false;
    sheet.removeAttribute("aria-busy");
    projectActionRunning = false;
  }
}

async function saveProject(){
  const {blob, fileName} = await buildProjectZip();
  downloadBlob(blob, fileName);
  stampSaved();
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
    entries = await parseZipBytes(new Uint8Array(await file.arrayBuffer()));
  } catch(err){
    alert("Not a valid project file (" + err.message + ").");
    return;
  }
  const jsonEntries = entries.filter(e => baseEntryName(e.name) === "project.json");
  if(jsonEntries.length !== 1){
    alert(jsonEntries.length ? "More than one project.json found inside this zip." : "No project.json found inside this zip.");
    return;
  }
  const jsonEntry = jsonEntries[0];

  let p;
  try{ p = JSON.parse(new TextDecoder().decode(jsonEntry.data)); }
  catch(err){ alert("project.json inside the zip isn't valid JSON."); return; }
  try{ p = prepareProject(p, CONFIG); }
  catch(err){ alert("This project can't be opened: " + err.message); return; }

  // Canonical package name -> File, for auto re-attaching audio/artwork
  // that was renamed to our convention when this zip was built — see
  // trackFileName/printedPartFileName. A project.json loaded stand-alone
  // (not inside one of our zips) simply won't find any matches here.
  const fileMap = new Map();
  const root = jsonEntry.name.slice(0, -"project.json".length);
  for(const e of entries){
    if(!e.name.startsWith(root)) continue;
    const name = e.name.slice(root.length);
    if(!name || name.includes("/")) continue;
    if(name === "project.json" || name === "order_summary.txt" || name === "tracklist.txt") continue;
    if(fileMap.has(name)){
      alert(`This project can't be opened: duplicate filename inside project zip: ${name}`);
      return;
    }
    fileMap.set(name, new File([e.data], name, {type: mimeType(fileExt(name))}));
  }

  projectHistory = p.history;
  document.getElementById("catalogue").value = p.catalogue || "";
  ensureFormatOption(p.format);
  document.getElementById("format").value = p.format;
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
  await applyLabels(p.labels, fileMap);
  const cs = p.coverSleeve || {};
  await applyCover(cs.cover, fileMap);
  await applyInnerSleeve(cs.innerSleeve, fileMap);
  await applyInlay(cs.inlay, fileMap);

  ["A","B"].forEach(side=>{
    const s = (p.sides && p.sides[side]) || {tracks:[]};
    clearContinuousFile(side);
    clearTracklistFile(side);
    document.getElementById("tracks-"+side).innerHTML = "";
    (s.tracks || []).forEach(t=>{
      addTrack(side);
      const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
      const r = rows[rows.length-1];
      r.querySelector(".title").value = t.title || "";
      // Older project files predate the linked/changed distinction —
      // leave those tracks linked (the common case) rather than
      // silently freezing every saved artist as a one-off override.
      r.querySelector(".artist").value = t.artist || "";
      setArtistLinked(r, t.artistLinked !== false);
      r.querySelector(".length").value = t.length || "";
      r.querySelector(".gap").value = t.gap || "2";
      r.querySelector(".gapcustom").value = t.gapCustom || "2";
      r.querySelector(".gap-wrap").classList.toggle("custom", (t.gap||"2")==="custom");
      const trackFile = t.fileName && fileMap.get(t.fileName);
      if(trackFile){
        // A saved length is the source of truth (it may have been typed
        // by hand); only derive one from the file when the project had
        // none.
        attachTrackFile(r, trackFile, t.originalFileName || t.fileName, !String(t.length || "").trim());
      } else if(t.fileName){
        const m = r.querySelector(".filemeta");
        m.classList.remove("empty");
        m.textContent = "file: " + t.fileName + " — please re-select this file (not stored in the order file)";
      }
    });
    if(!s.tracks || !s.tracks.length) addTrack(side);
    document.getElementById("rpm-"+side).value = s.rpm || getFormat(CONFIG, document.getElementById("format").value).rpm;
    // Older project files predate this field — leave those sides on the
    // "auto" default (filled in below) rather than blanking them. When
    // the field is present, matrixInscriptionAuto (persisted by
    // serializeSide) says whether it was still tracking the catalogue
    // number at save time — restoring that, rather than always treating
    // a saved value as final, is what lets editing the catalogue later
    // keep updating an untouched matrix field after a reload.
    const matrixInput = document.getElementById("matrix-"+side);
    if(s.matrixInscription != null){
      matrixInput.value = s.matrixInscription.toUpperCase();
      matrixInput._auto = s.matrixInscriptionAuto === false ? false : true;
    } else {
      matrixInput._auto = true;
    }
    const contOn = !!s.continuous;
    document.getElementById("cont-"+side).checked = contOn;
    applyContinuousState(side, contOn);
    document.getElementById("contoverride-"+side).value = s.continuousLength || "";
    const contFile = s.continuousFileName && fileMap.get(s.continuousFileName);
    if(contFile){
      attachContinuousFile(side, contFile, s.continuousOriginalFileName || s.continuousFileName);
    } else if(s.continuousFileName){
      document.getElementById("contfilemeta-"+side).textContent =
        "file: " + s.continuousFileName + " — please re-select this file (not stored in the order file)";
    }
    const tracklistFile = s.tracklistFileName && fileMap.get(s.tracklistFileName);
    if(tracklistFile){
      attachTracklistFile(side, tracklistFile, s.tracklistOriginalFileName || s.tracklistFileName);
    } else if(s.tracklistFileName){
      const meta = document.getElementById("tracklistmeta-"+side);
      meta.classList.remove("empty");
      meta.textContent = "file: " + s.tracklistFileName + " — please re-select this file (not stored in the order file)";
    }
    if(side === "B"){
      document.getElementById("blankB").checked = !!s.blank;
      document.getElementById("blankB").dispatchEvent(new Event("change"));
    }
    renumber(side);
  });

  applyDefaultMatrix();
  syncAlbumArtistToLinkedTracks();
  document.getElementById("stamp").textContent = document.getElementById("catalogue").value || "— unsaved —";
  recompute();
}

function collectPackageFiles(forSend = false){
  const catalogue = document.getElementById("catalogue").value;
  const files = [];
  for(const side of ["A","B"]){
    const blankChk = side==="B" ? document.getElementById("blankB") : null;
    const blank = blankChk && blankChk.checked;
    const continuous = document.getElementById("cont-"+side).checked;
    const sideFile = document.getElementById("contfile-"+side)._file;
    if(sideFile && includeSideFile({forSend, blank, continuous, kind:"continuous"})){
      files.push({
        name: continuousSideFileName({catalogue, side, ext: fileExt(sideFile.name)}),
        data: sideFile
      });
    }
    const tracklistFile = document.getElementById("tracklistfile-"+side)._file;
    if(tracklistFile && includeSideFile({forSend, blank, continuous, kind:"continuous"})){
      files.push({
        name: tracklistFileName({catalogue, side, ext: fileExt(tracklistFile.name)}),
        data: tracklistFile
      });
    }
    const rows = document.querySelectorAll("#tracks-"+side+" .track-row");
    let i=1;
    for(const row of rows){
      if(row._file && includeSideFile({forSend, blank, continuous, kind:"track"})){
        const title = row.querySelector(".title").value;
        const artist = row.querySelector(".artist").value;
        const name = trackFileName({catalogue, side, index:i, title, artist, ext: fileExt(row._file.name)});
        files.push({name, data:row._file});
      }
      i++;
    }
  }
  files.push(...collectLabelFiles(forSend));
  files.push(...collectCoverFiles());
  files.push(...collectInnerSleeveFiles());
  files.push(...collectInlayFiles());
  return files;
}

// Same completeness scan printOrder uses (every module's checklist, at
// once), but as a dismissible warning rather than a hard block — the
// plant can still receive and fix an incomplete order if the customer
// chooses to send it anyway. See CLAUDE.md's Workflow, step 4.
function confirmIncompleteSend(){
  // Same reasoning as printOrder() — force a fresh check before gating.
  updateChecklist();

  const pending = document.querySelectorAll(".checklist li.bad.pending");
  if(pending.length > 0){
    pending[0].scrollIntoView({behavior:"smooth", block:"center"});
    alert(`Can't send yet — file inspection is still pending:\n\n${pending[0].textContent.trim()}`);
    return false;
  }

  // Missing/unreadable required artwork can't be sent at all — unlike
  // every other checklist item, there's no "send anyway" here. Gated by
  // CONFIG.blockIncompleteArtworkOnSend so a plant that wants the old
  // fully-dismissible behavior back gets it with one setting. Save
  // Project never calls this function, so it's never affected.
  if(CONFIG.blockIncompleteArtworkOnSend){
    const blocking = document.querySelectorAll(".checklist li.bad.blocking");
    if(blocking.length > 0){
      blocking[0].scrollIntoView({behavior:"smooth", block:"center"});
      alert(`Can't send yet — ${blocking.length} required item${blocking.length===1?"":"s"} still missing or unreadable, starting with:\n\n${blocking[0].textContent.trim()}`);
      return false;
    }
  }

  const missing = document.querySelectorAll(".checklist li.bad");
  if(missing.length === 0) return true;
  return confirm(
    `${missing.length} item${missing.length===1?"":"s"} still need attention (marked "!"), starting with:\n\n`
    + `${missing[0].textContent.trim()}\n\nSend to the plant anyway?`
  );
}

/* ============================================================
   Send to Plant — no public browser-callable upload API exists for
   the transfer services this targets, so this stays a handoff:
   download the package, then show an inline panel with the steps to
   finish it manually (see src/lib/transfer.js for the instructions
   logic). An earlier version opened a generated instruction page via
   window.open() after the async zip build — popup blockers routinely
   killed that in Safari/Firefox, since by the time window.open() ran
   it was no longer considered a direct response to the click. An
   inline panel has no such risk.
   ============================================================ */

// {blob, fileName} from the most recent successful Send — lets "Save
// .zip again"/"Copy instructions" reuse the exact file/name that was
// actually sent, rather than rebuilding (which could differ if the
// customer edited the form afterward).
let lastSentZip = null;

async function sendToPlant(){
  if(!confirmIncompleteSend()) return;
  const {blob, fileName} = await buildProjectZip(true);
  downloadBlob(blob, fileName);
  lastSentZip = {blob, fileName};
  showSendPanel(fileName);
}

function showSendPanel(fileName){
  const steps = transferInstructions(CONFIG.plant.transfer, fileName);
  const list = document.getElementById("sendPanelSteps");
  list.innerHTML = "";
  steps.forEach(text=>{
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  document.getElementById("sendPanelOpenLink").href = transferLink(CONFIG.plant.transfer);
  const panel = document.getElementById("sendPanel");
  panel.classList.remove("hidden");
  panel.scrollIntoView({behavior:"smooth", block:"nearest"});
}

// navigator.clipboard needs a secure context — unavailable when this
// page is opened via file://, which is how most customers actually run
// it (see CLAUDE.md's Workflow). Falls back to the legacy
// execCommand("copy") path, which still works everywhere this tool
// needs to run.
function copyToClipboard(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).catch(()=> copyViaTextarea(text));
  } else {
    copyViaTextarea(text);
  }
}

function copyViaTextarea(text){
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try{ document.execCommand("copy"); } catch(e){ /* best effort */ }
  document.body.removeChild(ta);
}
