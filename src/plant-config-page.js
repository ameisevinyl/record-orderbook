// Plant config editor: open src/plant.config.local.js, edit imprint and
// transfer in a sheet, save it again (a download — put it at
// src/plant.config.local.js and run node build/build.js for the order form).
import { validatePlant } from "./lib/config-validation.js";
import { parsePlantConfig, formatPlantConfig } from "./lib/plant-config.js";
import { COUNTRIES } from "./lib/countries.js";
import { $, esc, download, onDropFile, installSheetKeys } from "./sheet.js";

// build/build.js embeds the plant config the order form is built with here.
const PLANT_TEMPLATE = null;

let plant = null;
let plantName = "plant.config.local.js";
let dirty = false;

const IMPRINT = [
  ["recipientName", "Name"], ["addressLine1", "Address line 1"], ["addressLine2", "Address line 2"],
  ["addressLine3", "Address line 3"], ["postalCode", "Postal code"], ["city", "City"],
  ["stateProvince", "State / province"], ["countryCode", "Country"], ["phone", "Phone"],
  ["email", "Email"], ["vat", "VAT ID"]
];

function renderPlant(){
  if(!plant){
    $("editor").innerHTML = "<p>Open a plant.config.local.js.</p>";
    return;
  }
  const code = plant.imprint.countryCode;
  const countries = `<select data-p="imprint.countryCode"><option value=""></option>`
    + (COUNTRIES.some(([c]) => c === code) || !code ? "" : `<option value="${esc(code)}" selected>${esc(code)}</option>`)
    + COUNTRIES.map(([c, name]) => `<option value="${c}"${c === code ? " selected" : ""}>${esc(name)} (${c})</option>`).join("") + "</select>";
  const kv = IMPRINT.map(([key, label]) =>
    `<tr><th>${label}</th><td>${key === "countryCode" ? countries : `<input type="text" data-p="imprint.${key}" value="${esc(plant.imprint[key])}">`}</td></tr>`).join("");
  const services = plant.transfer.services.map((sv, i) => `<tr>
      <td><input type="text" class="n" data-s="${i}" data-f="name" value="${esc(sv.name)}"></td>
      <td><input type="text" class="u" data-s="${i}" data-f="url" value="${esc(sv.url)}"></td>
      <td class="chk"><input type="checkbox" data-s="${i}" data-f="direct"${sv.direct ? " checked" : ""}></td>
      <td><button class="x" data-act="rmService" data-s="${i}" title="Remove service">x</button></td></tr>`).join("");
  $("editor").innerHTML = `
    <table class="kv"><thead><tr><th colspan="2">Imprint</th></tr></thead><tbody>${kv}</tbody></table>
    <table class="kv"><thead><tr><th colspan="2">Transfer</th></tr></thead><tbody>
      <tr><th>Upload link</th><td><input type="text" data-p="transfer.uploadUrl" value="${esc(plant.transfer.uploadUrl)}"></td></tr>
      <tr><th>Recipient email</th><td><input type="text" data-p="transfer.uploadEmail" value="${esc(plant.transfer.uploadEmail)}"></td></tr></tbody></table>
    <table class="sv"><thead><tr><th>Transfer service</th><th>URL</th><th>Direct</th><th class="add"><button class="x" data-act="addService" title="Add service">+</button></th></tr></thead><tbody>${services}</tbody></table>
    <p class="note">Save, put the file at src/plant.config.local.js and run node build/build.js for the order form.</p>`;
}

function plantStatus(){
  let error = "";
  if(plant){
    try{
      validatePlant(plant);
      if(!/^[A-Z]{2}$/.test(plant.imprint.countryCode)) throw new Error("country code must be two capital letters");
    }catch(e){ error = e.message; }
  }
  $("status").className = error ? "err" : "";
  $("status").textContent = error || (dirty ? "unsaved changes" : "");
  $("btnSave").disabled = !plant || !!error;
  $("file").textContent = plant ? plantName : "";
}

function plantEdited(){
  dirty = true;
  plantStatus();
}

$("editor").addEventListener("input", e => {
  const { p, s, f } = e.target.dataset;
  if(p){
    const [section, key] = p.split(".");
    plant[section][key] = key === "countryCode" ? e.target.value.trim().toUpperCase() : e.target.value.trim();
  }else if(s !== undefined && f !== "direct") plant.transfer.services[s][f] = e.target.value.trim();
  else return;
  plantEdited();
});
$("editor").addEventListener("change", e => {
  const { s, f } = e.target.dataset;
  if(f !== "direct") return;
  if(e.target.checked) plant.transfer.services[s].direct = true;
  else delete plant.transfer.services[s].direct;
  plantEdited();
});
$("editor").addEventListener("click", e => {
  const { act, s } = e.target.dataset;
  if(act === "addService") plant.transfer.services.push({ name: "", url: "" });
  else if(act === "rmService") plant.transfer.services.splice(s, 1);
  else return;
  renderPlant();
  plantEdited();
});

function loadPlant(text, name){
  try{
    plant = parsePlantConfig(text);
  }catch(error){
    $("status").className = "err";
    $("status").textContent = `${name}: ${error.message}`;
    return;
  }
  plantName = name;
  dirty = false;
  renderPlant();
  plantStatus();
}

$("btnOpen").addEventListener("click", () => $("input").click());
$("input").addEventListener("change", async () => {
  const file = $("input").files[0];
  if(file) loadPlant(await file.text(), file.name);
  $("input").value = "";
});
$("btnSave").addEventListener("click", () => {
  download(formatPlantConfig(plant), "plant.config.local.js", "text/javascript");
  dirty = false;
  plantStatus();
});


onDropFile(loadPlant);
window.addEventListener("beforeunload", e => { if(dirty) e.preventDefault(); });
installSheetKeys();

if(PLANT_TEMPLATE){
  try{
    validatePlant(PLANT_TEMPLATE);
    plant = structuredClone(PLANT_TEMPLATE);
  }catch(error){ console.error(error); }
}
renderPlant();
plantStatus();
