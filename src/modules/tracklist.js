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
import { computeStatus } from "../lib/playing-time.js";
import { getFormat, enabledFormats, firstEnabledFormat, productById } from "../lib/format-catalogue.js";
import { trackFileName, continuousSideFileName, projectFileName, fileExt, mimeType, humanDate, slug } from "../lib/package-naming.js";
import { renderTable } from "../lib/text-table.js";
import { defaultMatrix } from "../lib/matrix.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { transferLink, transferInstructions } from "../lib/transfer.js";
import { buildSpecsHtml } from "../lib/specs-document.js";
import { collectLabelFiles, collectLabels, applyLabels } from "./labels.js";
import { collectCoverFiles, collectCover, applyCover } from "./cover.js";
import { collectInnerSleeveFiles, collectInnerSleeve, applyInnerSleeve } from "./inner-sleeve.js";
import { collectInlayFiles, collectInlay, applyInlay } from "./inlay.js";
import { collectVinylColor, applyVinylColor } from "./vinyl-color.js";
import { collectShippingBilling, applyShippingBilling, buildShippingBillingSummary } from "./shipping-billing.js";

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
// so renderFileMeta can show it as the "was:" line.
function attachTrackFile(row, f, originalFileName = f.name){
  row._file = f;
  row._originalFileName = originalFileName;
  const pickbtn = row.querySelector(".pickbtn");
  const meta = row.querySelector(".filemeta");
  const lengthInput = row.querySelector(".length");
  pickbtn.classList.add("has-file");
  renderFileMeta(meta, f.name, originalFileName, "reading duration…");
  meta.classList.remove("empty");
  meta.classList.remove("warn", "compressed", "underspec");
  const compressionWarn = compressionWarning(f);
  Promise.all([readAudioDuration(f), readAudioSpec(f)]).then(([dur, spec])=>{
    const durText = (isFinite(dur) && dur > 0)
      ? (()=>{ lengthInput.value = formatTime(dur); recompute();
               return formatTime(dur) + " (auto)"; })()
      : "could not read duration, enter length manually";
    const specWarn = audioSpecWarning(spec, CONFIG.audioSpec);
    const warning = [compressionWarn, specWarn].filter(Boolean).join("  ");
    renderFileMeta(meta, f.name, originalFileName, durText + (warning ? "  " + warning : ""));
    meta.classList.toggle("warn", !!warning);
    meta.classList.toggle("compressed", !!compressionWarn);
    meta.classList.toggle("underspec", !!specWarn);
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
    if(f) attachTrackFile(row, f);
  });

  lengthInput.addEventListener("input", recompute);
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
  contWrap._file = f;
  contWrap._originalFileName = originalFileName;
  renderFileMeta(contMeta, f.name, originalFileName, "reading duration…");
  contMeta.classList.remove("warn", "compressed", "underspec");
  const compressionWarn = compressionWarning(f);
  Promise.all([readAudioDuration(f), readAudioSpec(f)]).then(([dur, spec])=>{
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
    const {level, maxMin, idealMin} = statusFor(seconds, side);
    const totalFig = document.getElementById("total-"+side);
    const badge = document.getElementById("badge-"+side);
    const note = document.getElementById("limitsnote-"+side);
    const {format, rpm, mode} = sideMeta(side);

    totalFig.textContent = formatTime(seconds);
    badge.className = "badge " + level;
    badge.textContent = level === "ok" ? "within recommendation"
                       : level === "warn" ? "approaching limit"
                       : "exceeds recommendation";
    note.textContent = `${format}", ${rpm} RPM${mode==="soundsystem"?" · soundsystem cut":""} — ideal up to ${idealMin} min, max ${maxMin} min`;
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

  // Every printed-part module (labels/cover/inner-sleeve/inlay) hides its
  // file-picker body entirely when that part doesn't need a file
  // (whitelabel, unprinted, none, or inlay not included — see each
  // module's own mode toggle), so a still-empty artwork .filemeta whose
  // section isn't hidden means a file the order still needs is missing.
  // [id] excludes the per-track .filemeta (tracklist.js's own row
  // template) — those are unlabelled by design and already covered by
  // the "has timed tracks" check above; .filemeta.empty is always
  // display:none itself (a separate, cosmetic CSS rule — see
  // src/index.html), so applicability has to come from an ancestor's
  // .hidden class, not this element's own visibility.
  const missingArtwork = Array.from(document.querySelectorAll(".filemeta.empty[id]"))
    .filter(el => !el.closest(".hidden")).length;
  if(missingArtwork > 0){
    items.push([false, `${missingArtwork} artwork file(s) not yet attached`, true]);
  }

  // Errors from label/cover/inner-sleeve/inlay's own checklist rows (see
  // each module's render*Checklist, buildChecklistRows in
  // print-artwork.js) — e.g. an unreadable file, or any check a plant
  // configured with severity:"error" (CONFIG.printCheck.checks) — not
  // merely a dismissible "warn" row.
  const erroredArtwork = Array.from(document.querySelectorAll(".labelwarnings .error"))
    .filter(el => !el.closest(".hidden")).length;
  if(erroredArtwork > 0){
    items.push([false, `${erroredArtwork} artwork file(s) have errors — check labels/cover/inner sleeve/inlay`, true]);
  }

  // The third, optional element marks a checklist item as "blocking" —
  // Send to Plant refuses outright on these (see confirmIncompleteSend
  // below), unlike every other item here, which stays a dismissible
  // warning. Only missingArtwork/erroredArtwork set it; every earlier
  // items.push(...) in this function omits it, so it's undefined/falsy
  // there — see CONFIG.blockIncompleteArtworkOnSend for the on/off switch.
  //
  // Satisfied (ok) items are hidden outside debug mode — this is a
  // status block a customer checks before sending, not a running log of
  // everything that's already fine; a still-blank form filling up with
  // green checkmarks (or red "not yet attached" warnings for parts they
  // haven't reached yet) is noise, not signal. Nothing queries
  // ".checklist li.ok" anywhere (confirmIncompleteSend/printOrder only
  // ever look at li.bad), so omitting ok rows from the DOM entirely is
  // safe — it doesn't affect Send/Print gating.
  const visibleItems = isDebugMode() ? items : items.filter(([ok]) => !ok);
  list.innerHTML = visibleItems.map(([ok, text, blocking])=>
    `<li class="${ok?'ok':'bad'}${blocking?' blocking':''}"><span class="mark">${ok?'✓':'!'}</span>${text}</li>`
  ).join("");
}

/* ============================================================
   Side template
   ============================================================ */

function sideTemplate(side){
  const isB = side === "B";
  return `
  <div id="sidebox-${side}">
    <div class="side-head">
      <h2>Side ${side}</h2>
      ${isB ? `<div class="side-opts"><label class="chk"><input type="checkbox" id="blankB"> blank / not used</label></div>` : ""}
    </div>

    <div id="body-${side}">
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
      </div>

      <div id="trackswrap-${side}">
        <div class="grid-head">
          <div></div><div></div><div></div><div></div><div></div><div>gap</div><div></div>
        </div>
        <div id="tracks-${side}"></div>
      </div>
      <button type="button" class="addbtn no-print" id="addbtn-${side}">+ add track</button>

      <div class="field" style="max-width:260px; margin-top:12px;">
        <label>Matrix / Runout Inscription</label>
        <input type="text" id="matrix-${side}" maxlength="60">
      </div>

      <div class="side-total">
        <div>
          <div class="total-fig" id="total-${side}">0:00</div>
          <div class="limits-note" id="limitsnote-${side}"></div>
        </div>
        <span class="badge ok" id="badge-${side}">within recommendation</span>
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
    input.value = defaultMatrix(catalogue, side);
  });
}

// The querySelectorAll(".checklist li.bad") below aggregates every
// <ul class="checklist"> on the page at once, by shared class rather
// than per-module import: tracklist's own #checklist (this function),
// shipping-billing's billing/each-shipping-address checklist, and
// vinyl-color's #colourChecklist all render the same <li class="ok"|
// "bad"> shape independently. labels/cover/inner-sleeve/inlay never
// render their own checklist — updateChecklist() folds their state in
// directly instead, via the .filemeta/.labelwarnings classes they do
// share. Refuses to print while anything is flagged, so a half-filled
// order can't go out as a finished-looking PDF.
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
  document.getElementById("audioSpecBitDepth").textContent = `${a.minBitDepth}-bit min (${a.recommendedBitDepth}-bit recommended)`;
  document.getElementById("audioSpecSampleRate").textContent = `${a.minSampleRateHz/1000}kHz min`;
}

export function initTracklist(){
  renderImprint();
  renderAudioSpecs();
  populateFormatOptions();
  document.getElementById("sides").innerHTML = sideTemplate("A") + sideTemplate("B");
  ["A","B"].forEach(side=>{
    addTrack(side);
    wireSideOptions(side);
    document.getElementById("rpm-"+side).addEventListener("change", recompute);
    document.getElementById("matrix-"+side).addEventListener("input", (e)=>{ e.target._auto = false; });
  });

  document.getElementById("format").addEventListener("change", applyDefaultRpm);
  document.getElementById("soundsystem").addEventListener("change", recompute);
  document.getElementById("catalogue").addEventListener("input", ()=>{
    document.getElementById("stamp").textContent =
      (document.getElementById("catalogue").value.trim() || "— unsaved —");
    applyDefaultMatrix();
    updateChecklist();
  });
  document.getElementById("albumTitle").addEventListener("input", updateChecklist);
  document.getElementById("albumArtist").addEventListener("input", syncAlbumArtistToLinkedTracks);

  // Delegated, page-wide: every checkbox/radio/select/file-input's native
  // "change" event bubbles to document, including ones in modules whose
  // DOM doesn't exist yet at this point (labels/cover/inner-sleeve/inlay
  // init after this) — so a file attach or a mode toggle there refreshes
  // the checklist live, not just at print/send time (updateChecklist()
  // is cheap and idempotent; printOrder()/confirmIncompleteSend() already
  // force a final fresh call regardless of this).
  document.addEventListener("change", updateChecklist);

  applyDefaultRpm();
  applyDefaultMatrix();
  recompute();

  document.getElementById("btnPrint").addEventListener("click", printOrder);
  document.getElementById("btnDownloadSpecs").addEventListener("click", openSpecs);
  document.getElementById("btnSaveProject").addEventListener("click", saveProject);
  document.getElementById("btnOpenProject").addEventListener("click", ()=> document.getElementById("openProjectInput").click());
  document.getElementById("openProjectInput").addEventListener("change", (e)=>{
    const file = e.target.files[0];
    e.target.value = "";
    if(file) loadProject(file);
  });
  document.getElementById("btnSend").addEventListener("click", sendToPlant);
  document.getElementById("btnResendZip").addEventListener("click", ()=>{
    if(!lastSentZip) return;
    downloadBlob(lastSentZip.blob, lastSentZip.fileName);
  });
  document.getElementById("btnCopyInstructions").addEventListener("click", ()=>{
    if(!lastSentZip) return;
    const steps = transferInstructions(CONFIG.plant.transfer, lastSentZip.fileName);
    copyToClipboard(steps.join("\n"));
  });
}

function serializeSide(side){
  const catalogue = document.getElementById("catalogue").value;
  const blankChk = side==="B" ? document.getElementById("blankB") : null;
  const cont = document.getElementById("cont-"+side).checked;
  const contWrap = document.getElementById("contfile-"+side);
  const contFile = contWrap._file;
  const matrixInput = document.getElementById("matrix-"+side);
  const data = {
    blank: blankChk ? blankChk.checked : false,
    rpm: document.getElementById("rpm-"+side).value,
    matrixInscription: matrixInput.value,
    matrixInscriptionAuto: matrixInput._auto !== false,
    continuous: cont,
    continuousLength: document.getElementById("contoverride-"+side).value,
    continuousFileName: contFile ? continuousSideFileName({catalogue, side, ext: fileExt(contFile.name)}) : null,
    continuousOriginalFileName: contFile ? (contWrap._originalFileName || contFile.name) : null,
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
      fileName: row._file ? trackFileName({catalogue, side, index: i+1, title, artist, ext: fileExt(row._file.name)}) : null,
      originalFileName: row._file ? (row._originalFileName || row._file.name) : null
    });
  });
  return data;
}

function buildProjectObject(forSend = false){
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
    labels: collectLabels(forSend),
    coverSleeve: { cover: collectCover(), innerSleeve: collectInnerSleeve(), inlay: collectInlay() }
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
// tab: buildSpecsHtml is synchronous, so window.open() still runs inside
// the click's user gesture and isn't popup-blocked (unlike sendToPlant's
// async zip build). A browser that blocks it anyway falls back to a
// download.
function openSpecs(){
  const html = buildSpecsHtml(CONFIG);
  const w = window.open("", "_blank");
  if(!w){
    const name = slug(CONFIG.plant.imprint.recipientName) || "specifications";
    downloadBlob(new Blob([html], {type:"text/html"}), `${name}_specifications.html`);
    return;
  }
  w.opener = null;
  w.document.open();
  w.document.write(html);
  w.document.close();
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
// forSend: true for the package handed to the plant (sendToPlant),
// false for a customer-facing save (saveProject) — the only
// difference it makes is whitelabel label sides: their file is kept
// for a save (so re-opening it later doesn't lose work) but left out
// of what's actually sent, since the plant doesn't need it. See
// collectLabels/collectLabelFiles in labels.js.
async function buildProjectZip(forSend = false){
  const project = buildProjectObject(forSend);
  const files = await collectPackageFiles(forSend);
  files.push({name:"order_summary.txt", data: new TextEncoder().encode(buildOrderSummaryText(project)).buffer});
  files.push({name:"tracklist.txt", data: new TextEncoder().encode(buildTracklistText(project)).buffer});
  files.push({name:"project.json", data: new TextEncoder().encode(JSON.stringify(project, null, 2)).buffer});

  const baseName = currentProjectFileName(project);
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
  document.getElementById("stamp").textContent = `Saved ${humanDate(d)} ${hh}:${min}`;
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
    if(name === "project.json" || name === "order_summary.txt" || name === "tracklist.txt") return;
    fileMap.set(name, new File([e.data], name, {type: mimeType(fileExt(name))}));
  });

  document.getElementById("catalogue").value = p.catalogue || "";
  document.getElementById("format").value = p.format || firstEnabledFormat(CONFIG);
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
        attachTrackFile(r, trackFile, t.originalFileName || t.fileName);
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
      matrixInput.value = s.matrixInscription;
      matrixInput._auto = s.matrixInscriptionAuto === false ? false : true;
    } else {
      matrixInput._auto = true;
    }
    document.getElementById("cont-"+side).checked = !!s.continuous;
    document.getElementById("cont-"+side).dispatchEvent(new Event("change"));
    document.getElementById("contoverride-"+side).value = s.continuousLength || "";
    const contFile = s.continuousFileName && fileMap.get(s.continuousFileName);
    if(contFile){
      attachContinuousFile(side, contFile, s.continuousOriginalFileName || s.continuousFileName);
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

  applyDefaultMatrix();
  syncAlbumArtistToLinkedTracks();
  document.getElementById("stamp").textContent = document.getElementById("catalogue").value || "— unsaved —";
  recompute();
}

async function collectPackageFiles(forSend = false){
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
  files.push(...await collectLabelFiles(forSend));
  files.push(...await collectCoverFiles());
  files.push(...await collectInnerSleeveFiles());
  files.push(...await collectInlayFiles());
  return files;
}

// Only worth a column when some track's artist actually differs from
// the album artist (a various-artists release) — otherwise it's
// redundant with the artist already shown once in the header above.
// order_summary.txt and tracklist.txt are always built from the project
// object (the same one that becomes project.json), never read back out
// of the DOM directly — that's what guarantees the filenames printed in
// these documents (already-renamed, catalogue#-prefixed) are exactly
// the ones actually in the zip, with no separate re-derivation to drift
// out of sync.

function tracksNeedArtistColumn(project){
  return ["A","B"].some(side =>
    project.sides[side].tracks.some(t => t.artist && t.artist !== project.albumArtist)
  );
}

function documentHeader(project, label){
  const cat = project.catalogue || "(no catalogue number)";
  const title = project.albumTitle || "(no title)";
  const artist = project.albumArtist || "(no artist)";
  return `${label}\n${cat} - ${title} - ${artist} - ${humanDate()}\nFormat: ${project.format}"\n\n`;
}

// Printed-part filenames only — tracks/continuous-side files are already
// listed in the per-side tables below, so repeating them here would be
// redundant. A null fileName means "not actually included in THIS
// package" (unprinted, inlay not included, no file attached, or — for
// a whitelabel label side — deliberately left out of what's sent to
// the plant even though it's still kept in a customer's own saved
// project; see collectLabels/collectLabelFiles's forSend parameter) —
// see also collectCover/collectInnerSleeve/collectInlay. order_summary.txt
// only — the mastering engineer and graphics department (tracklist.txt)
// don't need a manifest of the artwork files, they already have the
// files themselves.
function filesManifestSection(project){
  const l = project.labels, c = project.coverSleeve;
  const packageFiles = [
    l.sides.A.fileName, l.sides.B.fileName,
    c.innerSleeve.fileName, c.cover.fileName,
    c.inlay.front.fileName, c.inlay.back.fileName
  ].filter(Boolean);
  if(!packageFiles.length) return "";
  return "Files:\n" + packageFiles.map(f => `  ${f}`).join("\n") + "\n\n";
}

// Full packaging spec — what each printed part actually IS (mode,
// colour when unprinted, filename + the customer's original filename
// when printed), not just its bare name (filesManifestSection above is
// a flat file list for a quick zip cross-check; this reads like a
// production instruction). order_summary.txt only, same reasoning as
// filesManifestSection above — the mastering engineer and graphics
// department already have the files, they don't need them described
// back to them either.
function packagingSection(project){
  const c = project.coverSleeve;
  const parts = getFormat(CONFIG, project.format).printableParts;
  const withOriginal = (fileName, originalFileName) =>
    (fileName || "(no file)") + (originalFileName && originalFileName !== fileName ? ` (was: ${originalFileName})` : "");

  let out = "PACKAGING:\n";

  const coverProduct = productById(parts.outerCover.products, c.cover.productId);
  out += !coverProduct
    ? `  Cover: none\n`
    : coverProduct.kind === "printed"
      ? `  Cover: ${coverProduct.name} — ${withOriginal(c.cover.fileName, c.cover.originalFileName)}\n`
      : `  Cover: ${coverProduct.name}\n`;

  const sleeveProduct = productById(parts.innerSleeve.products, c.innerSleeve.productId);
  out += !sleeveProduct
    ? `  Inner sleeve: (unrecognized product)\n`
    : sleeveProduct.kind === "printed"
      ? `  Inner sleeve: ${sleeveProduct.name} — ${withOriginal(c.innerSleeve.fileName, c.innerSleeve.originalFileName)}\n`
      : `  Inner sleeve: ${sleeveProduct.name}\n`;

  const inlayProduct = productById(parts.inlay.products, c.inlay.productId);
  out += inlayProduct
    ? `  Inlay: front — ${withOriginal(c.inlay.front.fileName, c.inlay.front.originalFileName)}\n`
      + `         back  — ${withOriginal(c.inlay.back.fileName, c.inlay.back.originalFileName)}\n`
    : `  Inlay: none\n`;

  return out + "\n";
}

// The tracklist body (per-side track tables) — shared by order_summary.txt
// (the complete order, for customer service / production management) and
// tracklist.txt (audio filenames and notes only, no billing/shipping or
// artwork manifest — this one goes to the mastering engineer and graphics
// department, who don't need to see the customer's order details).
function tracklistBody(project){
  const showArtist = tracksNeedArtistColumn(project);
  let out = "";

  ["A","B"].forEach(side=>{
    const s = project.sides[side];
    if(s.blank){ out += `SIDE ${side} — blank\n\n`; return; }

    if(s.continuous){
      const total = parseTime(s.continuousLength) || 0;
      out += `SIDE ${side} — ${s.rpm} RPM — total ${formatTime(total)}\n`;
      out += `  matrix: ${s.matrixInscription || "(none)"}\n`;
      out += `  continuous file: ${s.continuousFileName || "(none selected)"}\n\n`;
      return;
    }

    const headers = ["Pos.", "Pregap", "Start", "Length", "Title"];
    if(showArtist) headers.push("Artist");
    headers.push("filename");

    // Running start time within the side: silence (pregap) plays first,
    // then the track, so pregap accumulates before start and the
    // track's own length accumulates after it.
    let cursor = 0;
    const rows = s.tracks.map((t, i)=>{
      const gap = trackGapSeconds(t, i===0);
      cursor += gap;
      const cells = [side+(i+1), formatTime(gap), formatTime(cursor), t.length || "?:??", t.title || "(untitled)"];
      if(showArtist) cells.push(t.artist || "");
      cells.push(t.fileName || "(no file — manual entry)");
      cursor += parseTime(t.length) || 0;
      return cells;
    });

    out += `SIDE ${side} — ${s.rpm} RPM — total ${formatTime(cursor)}\n`;
    out += `  matrix: ${s.matrixInscription || "(none)"}\n`;
    out += renderTable(headers, rows) + "\n\n";
  });
  return out;
}

function notesSection(project){
  return project.notes.trim() ? `NOTES TO CUTTING ENGINEER:\n${project.notes.trim()}\n` : "";
}

// The complete order in human-readable form — release info, package file
// manifest, tracklist, notes, and the customer's billing/shipping details.
// Goes to customer service / production management.
function buildOrderSummaryText(project){
  return documentHeader(project, "ORDER SUMMARY")
    + filesManifestSection(project)
    + packagingSection(project)
    + tracklistBody(project)
    + notesSection(project)
    + "\n" + buildShippingBillingSummary(project.shippingBilling, project.vinylColor);
}

// Same tracklist as above, minus the customer's billing/shipping details
// and the artwork file manifest — this one goes to the mastering engineer
// and graphics department, who don't need to see the rest of the order or
// a listing of files they already have.
function buildTracklistText(project){
  return documentHeader(project, "TRACKLIST")
    + tracklistBody(project)
    + notesSection(project);
}

// Same completeness scan printOrder uses (every module's checklist, at
// once), but as a dismissible warning rather than a hard block — the
// plant can still receive and fix an incomplete order if the customer
// chooses to send it anyway. See CLAUDE.md's Workflow, step 4.
function confirmIncompleteSend(){
  // Same reasoning as printOrder() — force a fresh check before gating.
  updateChecklist();

  // Missing/unreadable required artwork can't be sent at all — unlike
  // every other checklist item, there's no "send anyway" here. Gated by
  // CONFIG.blockIncompleteArtworkOnSend so a plant that wants the old
  // fully-dismissible behavior back gets it with one setting. Save
  // Project never calls this function, so it's never affected.
  if(CONFIG.blockIncompleteArtworkOnSend){
    const blocking = document.querySelectorAll(".checklist li.bad.blocking");
    if(blocking.length > 0){
      blocking[0].scrollIntoView({behavior:"smooth", block:"center"});
      alert(`Can't send yet — ${blocking.length} artwork item${blocking.length===1?"":"s"} still missing or unreadable, starting with:\n\n${blocking[0].textContent.trim()}`);
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

