// Plant view (dist/plant.html only): locked order, god-mode toggle,
// edit note on save. Built after app.js — see build/build.js.

import { addHistoryEntry } from "./modules/tracklist.js";
import { historyEntry } from "./lib/project.js";
import { isPlantEdit, plantIdentity } from "./lib/plant-view.js";

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
  // tracklist.js clears the input right after reading it; capture the
  // name first, apply it only once loadProject reports success.
  let pendingZipName = "";
  document.addEventListener("change", (e)=>{
    if(e.target.id === "openProjectInput" && e.target.files[0]) pendingZipName = e.target.files[0].name;
  }, true);
  document.addEventListener("projectloaded", (e)=>{
    document.getElementById("plantIdentity").textContent = plantIdentity(e.detail, pendingZipName);
    plantDirty = false;
    plantSetLocked(true);
  });
  for(const type of ["input", "change", "click"]){
    plantForm.addEventListener(type, (e)=>{ if(isPlantEdit(e, plantForm.disabled)) plantDirty = true; });
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
