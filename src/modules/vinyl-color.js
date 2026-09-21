// Vinyl Colour & Quantity module — one or more colour rows (standard
// black, a configurable list of solid colours, or "random"/mixed
// colour), each with its own quantity and minimum-order check. The
// per-colour quantities are read by the shipping-billing module via
// getColorBreakdown() below, which allocates each colour's qty across
// shipping addresses instead of taking a manually-typed total.

import { CONFIG } from "../config.js";
import { buildColorOptions, belowMinimum } from "../lib/vinyl-color.js";

function colorRowTemplate(){
  const options = buildColorOptions(CONFIG.vinylColor)
    .map(o => `<option value="${o.value}">${o.label}</option>`).join("");
  return `
  <div class="row colour-row">
    <div class="field" style="flex:0 0 200px;">
      <label>Colour</label>
      <select class="colour">${options}</select>
    </div>
    <div class="field" style="flex:0 0 120px;">
      <label>Qty</label>
      <input type="number" class="colourQty" min="0" step="1">
    </div>
    <div class="field" style="flex:0 0 auto;">
      <label>&nbsp;</label>
      <button type="button" class="rmbtn no-print colourRemove" title="Remove colour">✕</button>
    </div>
  </div>`;
}

function colorRowEls(){
  return Array.from(document.querySelectorAll("#colourRows .colour-row"));
}

function updateRemoveButtons(){
  const rows = colorRowEls();
  rows.forEach(row=>{
    row.querySelector(".colourRemove").classList.toggle("hidden", rows.length <= 1);
  });
}

// Other modules (shipping-billing.js) need to know when a colour row's
// selection, quantity, or count changes, without reaching into this
// module's DOM directly — they register via onColorChange() instead.
const changeListeners = [];
export function onColorChange(cb){
  changeListeners.push(cb);
}

function updateColorChecklist(){
  const list = document.getElementById("colourChecklist");
  const items = [];
  colorRowEls().forEach(row=>{
    const color = row.querySelector(".colour").value;
    const label = row.querySelector(".colour option:checked").textContent;
    const qty = row.querySelector(".colourQty").value;
    if(!Number(qty)) return; // blank/zero row — nothing to check yet
    const under = belowMinimum(color, qty, CONFIG.vinylColor.minOrderQty);
    const min = CONFIG.vinylColor.minOrderQty[color] || 0;
    items.push([!under, under ? `${label}: qty ${qty} is below the minimum order of ${min}` : `${label}: qty ${qty}`]);
  });
  list.innerHTML = items.map(([ok, text])=>
    `<li class="${ok?'ok':'bad'}"><span class="mark">${ok?'✓':'!'}</span>${text}</li>`
  ).join("");
  changeListeners.forEach(cb=> cb());
}

function wireRow(row){
  row.querySelectorAll("select, input").forEach(el=>{
    el.addEventListener("input", updateColorChecklist);
    el.addEventListener("change", updateColorChecklist);
  });
  row.querySelector(".colourRemove").addEventListener("click", ()=>{
    if(colorRowEls().length <= 1) return;
    row.remove();
    updateRemoveButtons();
    updateColorChecklist();
  });
}

function addColorRow(){
  document.getElementById("colourRows").insertAdjacentHTML("beforeend", colorRowTemplate());
  wireRow(colorRowEls().at(-1));
  updateRemoveButtons();
  updateColorChecklist();
}

export function initVinylColor(){
  document.getElementById("colourRows").innerHTML = colorRowTemplate();
  colorRowEls().forEach(wireRow);
  updateRemoveButtons();
  updateColorChecklist();

  document.getElementById("addColourBtn").addEventListener("click", addColorRow);
}

/* ============================================================
   Cross-module interface, same pattern as labels.js/cover.js's
   collect*Files() — shipping-billing.js reads these instead of a
   manually-entered total, tracklist.js uses collect/apply for JSON
   save/load.
   ============================================================ */
export function getColorBreakdown(){
  return colorRowEls()
    .map(row => ({
      color: row.querySelector(".colour").value,
      label: row.querySelector(".colour option:checked").textContent,
      qty: Number(row.querySelector(".colourQty").value) || 0
    }))
    .filter(r => r.qty > 0);
}

export function collectVinylColor(){
  return colorRowEls().map(row => ({
    color: row.querySelector(".colour").value,
    qty: row.querySelector(".colourQty").value
  }));
}

export function applyVinylColor(rows){
  const container = document.getElementById("colourRows");
  container.innerHTML = "";
  const entries = (rows && rows.length) ? rows : [{}];
  entries.forEach(entry=>{
    container.insertAdjacentHTML("beforeend", colorRowTemplate());
    const row = colorRowEls().at(-1);
    if(entry.color) row.querySelector(".colour").value = entry.color;
    row.querySelector(".colourQty").value = entry.qty || "";
    wireRow(row);
  });
  updateRemoveButtons();
  updateColorChecklist();
}
