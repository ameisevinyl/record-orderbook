// Plant view (dist/plant.html only): locked order, god-mode toggle,
// edit note on save. Built after app.js — see build/build.js.

import { addHistoryEntry } from "./modules/tracklist.js";
import { historyEntry } from "./lib/project.js";

const plantForm = document.getElementById("orderForm");
let plantDirty = false;

function plantSetLocked(locked){
  plantForm.disabled = locked;
  document.getElementById("godBanner").classList.toggle("hidden", locked);
  document.getElementById("btnGodMode").textContent = locked ? "Edit (god mode)" : "Lock";
}

function plantInitToolbar(){
  const bar = document.createElement("div");
  bar.className = "plantbar no-print";
  bar.innerHTML = `
    <span id="plantIdentity">— no order open —</span>
    <button type="button" class="btn" id="btnGodMode"></button>
    <div id="godBanner" class="hidden">Editing — changes alter the customer's order</div>`;
  // The existing buttons keep their tracklist.js handlers; they only move.
  bar.append(document.getElementById("btnOpenProject"), document.getElementById("btnSaveProject"));
  const sheet = document.querySelector(".sheet");
  sheet.prepend(bar);
  // Status checklist first, right under the toolbar.
  bar.after(document.getElementById("checklist").closest("section"));
  document.getElementById("btnGodMode").addEventListener("click", ()=> plantSetLocked(!plantForm.disabled));
}

// Capture phase on document: runs before tracklist.js's own listeners on
// the buttons/input, so a cancelled prompt can stop the action.
function plantInitGuards(){
  document.addEventListener("click", (e)=>{
    if(e.target.closest("#btnOpenProject") && plantDirty && !confirm("Discard unsaved edits?")){
      e.stopPropagation();
      return;
    }
    if(e.target.closest("#btnSaveProject") && plantDirty){
      const note = (prompt("What was changed? (saved in the order history)") || "").trim();
      if(!note){ e.stopPropagation(); return; }
      addHistoryEntry(historyEntry(note, new Date()));
      // Recorded now, so a failed save retried later doesn't add it twice.
      plantDirty = false;
    }
  }, true);
  document.addEventListener("change", (e)=>{
    if(e.target.id !== "openProjectInput" || !e.target.files[0]) return;
    // The zip's own name is <YYMMDD>_<catalogue#>_<customer-email>.zip.
    document.getElementById("plantIdentity").textContent = e.target.files[0].name.replace(/\.zip$/i, "");
    plantDirty = false;
    plantSetLocked(true);
  }, true);
  // Only real user input counts — loadProject dispatches synthetic change
  // events while filling the form.
  for(const type of ["input", "change"]){
    plantForm.addEventListener(type, (e)=>{ if(e.isTrusted && !plantForm.disabled) plantDirty = true; });
  }
  addEventListener("beforeunload", (e)=>{ if(plantDirty){ e.preventDefault(); e.returnValue = ""; } });
}

// Spec boxes as plain always-open rows; previews open full size on click.
function plantInitLayout(){
  document.querySelectorAll("details.specs").forEach(d => { d.open = true; });
  document.addEventListener("click", (e)=>{
    const preview = e.target.closest(".label-preview");
    const media = preview && preview.querySelector("img, iframe");
    if(media && media.src) open(media.src, "_blank", "noopener");
  });
}

plantInitToolbar();
plantInitGuards();
plantInitLayout();
plantSetLocked(true);
