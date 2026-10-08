// Pricelist editor: open a pricelist.json, edit prices in a table, save it
// again. Rows are items, columns the quantities (plus "fixed" for a flat
// price per order); a price applies from its column's quantity up. Shown per
// piece, the file keeps the price per unit (see lib/pricelist.js). Adding or
// removing items is `build/pricelist.js generate`'s job — the list comes from config.
import { validatePricelist, formatPricelist, perPiece, parsePrice, unpriced } from "./lib/pricelist.js";
import { validatePlant } from "./lib/config-validation.js";
import { parsePlantConfig, formatPlantConfig } from "./lib/plant-config.js";
import { standardVatRate } from "./lib/vat-rates.js";
import { COUNTRIES } from "./lib/countries.js";

// build/build.js embeds src/pricelist.example.json and the plant config here.
const TEMPLATE = null;
const PLANT_TEMPLATE = null;

const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const KIND = { record: "records", innerSleeve: "inner sleeves", outerCover: "covers", inlay: "inlays", referenceCut: "proofs", testpress: "proofs", extra: "extras" };

let list = null;
let cols = [];   // the quantity columns, ascending
let fileName = "pricelist.json";
let dirty = false;
let plant = null;   // the plant config being edited
let plantDirty = false;

const priced = item => item.tiers.filter(t => t.price !== null);
const flat = item => item.unit === "order";
// An item without a price keeps one empty tier, so the file stays valid.
const ensureTier = item => { if(!item.tiers.length) item.tiers.push({ from: 1, price: null }); };

function groupOf(key){
  const [format, kind] = key.split("/");
  return `${format} · ${KIND[kind] || kind}`;
}

function cell(item, key, col){
  const value = col === "fixed"
    ? (flat(item) ? perPiece(item.tiers[0].price, "order") : "")
    : (flat(item) ? "" : perPiece((priced(item).find(t => t.from === col) || { price: null }).price, item.unit));
  return `<td class="p"><input type="text" class="num p" data-k="${esc(key)}" data-c="${col}" value="${value}"></td>`;
}

function render(){
  if(!list){
    $("editor").innerHTML = "<p>Open a pricelist.json.</p>";
    return;
  }
  let group = "";
  const width = cols.length + 4;
  const rows = Object.entries(list.items).map(([key, item]) => {
    const head = groupOf(key) !== group ? `<tr class="grp"><td colspan="${width}">${esc(group = groupOf(key))}</td></tr>` : "";
    return head + `<tr class="item" data-k="${esc(key)}">
      <td class="name">${esc(item.name)}${item.includes ? `<small>incl. ${esc(item.includes)}</small>` : ""}</td>
      ${["fixed", ...cols].map(c => cell(item, key, c)).join("")}
      <td></td>
      <td class="min"><input type="text" class="num min" data-k="${esc(key)}" data-f="min" value="${item.min || ""}"></td>
    </tr>`;
  }).join("");
  const heads = cols.map(c => `<th class="qty"><div class="wrap"><input type="text" class="q" data-col="${c}" value="${c}"><button class="x" data-act="rmCol" data-col="${c}" title="Remove column">x</button></div></th>`).join("");
  $("editor").innerHTML = `
    <table class="meta"><thead><tr><th>valid</th><th>currency</th><th>VAT country</th><th>VAT %</th></tr></thead><tbody><tr>
      <td><input type="text" class="valid" data-m="valid" value="${esc(list.valid || "")}"></td>
      <td><input type="text" class="cur" data-m="currency" value="${esc(list.currency)}"></td>
      <td><input type="text" class="vat${plant ? " ro" : ""}" data-m="vatCountry" value="${esc(list.vat.country)}"${plant ? " readonly" : ""}></td>
      <td><input type="text" class="num vat${vatDerived() ? " ro" : ""}" data-m="vatRate" value="${list.vat.rate}"${vatDerived() ? " readonly" : ""}></td>
    </tr></tbody></table>
    <p class="note">Net prices in € per piece; fixed = flat price per order. A price applies from its column's quantity up. Min = lowest line total.</p>
    <table><thead><tr><th>Item</th><th class="fixed">fixed</th>${heads}<th class="add"><button class="x" data-act="addCol" title="Add quantity column">+</button></th><th>Min total</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function status(){
  const bad = document.querySelectorAll("input.bad").length;
  let error = bad ? "fix the marked fields" : "";
  if(list && !error){
    try{ validatePricelist(list); }catch(e){ error = e.message; }
  }
  $("status").className = error ? "err" : "";
  const noRate = plant && standardVatRate(plant.imprint.countryCode) === undefined ? ` · no standard VAT rate for ${plant.imprint.countryCode}, check VAT %` : "";
  $("status").textContent = error || (list ? `${unpriced(list).length} unpriced${noRate}${dirty ? " · unsaved changes" : ""}` : "");
  $("btnSave").disabled = !list || !!error;
  $("file").textContent = list ? fileName : "";
}

/* ---------------- plant config ---------------- */

const IMPRINT = [
  ["recipientName", "Name"], ["addressLine1", "Address line 1"], ["addressLine2", "Address line 2"],
  ["addressLine3", "Address line 3"], ["postalCode", "Postal code"], ["city", "City"],
  ["stateProvince", "State / province"], ["countryCode", "Country"], ["phone", "Phone"],
  ["email", "Email"], ["vat", "VAT ID"]
];

// The pricelist's VAT country and rate come from the plant config.
const vatDerived = () => plant && standardVatRate(plant.imprint.countryCode) !== undefined;
function syncVat(){
  if(!plant || !list) return;
  const country = plant.imprint.countryCode, rate = standardVatRate(country);
  if(list.vat.country !== country || (rate !== undefined && list.vat.rate !== rate)){
    list.vat.country = country;
    if(rate !== undefined) list.vat.rate = rate;
    return true;
  }
}

function renderPlant(){
  if(!plant){
    $("plant").innerHTML = "<p>Open a plant.config.local.js.</p>";
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
  $("plant").innerHTML = `
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
  $("plantStatus").className = error ? "err" : "";
  $("plantStatus").textContent = error || (plantDirty ? "unsaved changes" : "");
  $("btnSavePlant").disabled = !plant || !!error;
  $("plantFile").textContent = plant ? plantName : "";
}

let plantName = "plant.config.local.js";

function plantEdited(){
  plantDirty = true;
  if(syncVat()){
    dirty = true;
    render();
  }
  plantStatus();
  status();
}

$("plant").addEventListener("input", e => {
  const { p, s, f } = e.target.dataset;
  if(p){
    const [section, key] = p.split(".");
    plant[section][key] = key === "countryCode" ? e.target.value.trim().toUpperCase() : e.target.value.trim();
  }else if(s !== undefined && f !== "direct") plant.transfer.services[s][f] = e.target.value.trim();
  else return;
  plantEdited();
});
$("plant").addEventListener("change", e => {
  const { s, f } = e.target.dataset;
  if(f !== "direct") return;
  if(e.target.checked) plant.transfer.services[s].direct = true;
  else delete plant.transfer.services[s].direct;
  plantEdited();
});
$("plant").addEventListener("click", e => {
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
    $("plantStatus").className = "err";
    $("plantStatus").textContent = `${name}: ${error.message}`;
    return;
  }
  plantName = name;
  plantDirty = false;
  syncVat();
  renderPlant();
  plantStatus();
  render();
  status();
}

$("btnOpenPlant").addEventListener("click", () => $("inputPlant").click());
$("inputPlant").addEventListener("change", async () => {
  const file = $("inputPlant").files[0];
  if(file) loadPlant(await file.text(), file.name);
  $("inputPlant").value = "";
});
$("btnSavePlant").addEventListener("click", () => {
  download(formatPlantConfig(plant), "plant.config.local.js", "text/javascript");
  plantDirty = false;
  plantStatus();
});

function download(text, name, type){
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

function edit(){
  dirty = true;
  status();
}

// Marks the field when its text isn't valid; returns validity.
function setField(el, ok){
  el.classList.toggle("bad", !ok);
  return ok;
}

// A price typed into the fixed column makes the item flat, one into a
// quantity column makes it per piece; the other kind of price goes.
function setPrice(item, col, text){
  const unit = col === "fixed" ? "order" : (flat(item) ? 1000 : item.unit);
  const price = parsePrice(text, unit);
  if(Number.isNaN(price)) return false;
  if(col === "fixed"){
    item.unit = "order";
    item.tiers = [{ from: 1, price }];
    return true;
  }
  if(flat(item)){
    item.unit = unit;
    item.tiers = [];
  }
  item.tiers = priced(item).filter(t => t.from !== col);
  if(price !== null) item.tiers.push({ from: col, price });
  item.tiers.sort((a, b) => a.from - b.from);
  ensureTier(item);
  return true;
}

$("editor").addEventListener("input", e => {
  const el = e.target, { k, c, f, m } = el.dataset;
  if(m){
    if(m === "vatRate"){
      const rate = Number(el.value.replace(",", "."));
      if(setField(el, el.value.trim() !== "" && Number.isFinite(rate))) list.vat.rate = rate;
    }else if(m === "vatCountry") list.vat.country = el.value.trim().toUpperCase();
    else list[m] = el.value.trim();
  }else if(c !== undefined){
    const item = list.items[k];
    if(setField(el, setPrice(item, c === "fixed" ? c : Number(c), el.value))){
      // The row's other kind of price just went: show that.
      el.closest("tr").querySelectorAll("input.p").forEach(other => {
        if(other !== el) other.value = cell(item, k, other.dataset.c === "fixed" ? "fixed" : Number(other.dataset.c)).match(/value="([^"]*)"/)[1];
      });
    }
  }else if(f === "min"){
    const item = list.items[k];
    const min = el.value.trim() ? Number(el.value.replace(",", ".")) : 0;
    if(setField(el, Number.isFinite(min) && min >= 0)){
      if(min) item.min = min;
      else delete item.min;
    }
  }
  edit();
});

// A column's quantity changes once the field is left.
$("editor").addEventListener("change", e => {
  const el = e.target;
  if(el.dataset.col === undefined) return;
  const from = Number(el.dataset.col), to = Number(el.value);
  if(!setField(el, Number.isInteger(to) && to > 0 && (to === from || !cols.includes(to)))) return status();
  for(const item of Object.values(list.items)){
    priced(item).filter(t => t.from === from && !flat(item)).forEach(t => { t.from = to; });
    item.tiers.sort((a, b) => a.from - b.from);
  }
  cols = cols.map(c => c === from ? to : c).sort((a, b) => a - b);
  render();
  edit();
});

$("editor").addEventListener("click", e => {
  const { act, col } = e.target.dataset;
  if(act === "addCol"){
    let next = (cols[cols.length - 1] || 0) + 100;
    while(cols.includes(next)) next++;
    cols.push(next);
  }else if(act === "rmCol"){
    cols = cols.filter(c => c !== Number(col));
    for(const item of Object.values(list.items)){
      if(flat(item)) continue;
      item.tiers = priced(item).filter(t => t.from !== Number(col));
      ensureTier(item);
    }
  }else return;
  render();
  edit();
});

function load(text, name){
  try{
    list = validatePricelist(JSON.parse(text));
  }catch(error){
    $("status").className = "err";
    $("status").textContent = `${name}: ${error.message}`;
    return;
  }
  cols = [...new Set(Object.values(list.items).filter(i => !flat(i)).flatMap(i => priced(i).map(t => t.from)))].sort((a, b) => a - b);
  fileName = name;
  dirty = false;
  render();
  status();
}

$("btnOpen").addEventListener("click", () => $("input").click());
$("input").addEventListener("change", async () => {
  const file = $("input").files[0];
  if(file) load(await file.text(), file.name);
  $("input").value = "";
});
document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("drag"); });
document.addEventListener("dragleave", () => document.body.classList.remove("drag"));
document.addEventListener("drop", async e => {
  e.preventDefault();
  document.body.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if(!file) return;
  if(file.name.endsWith(".js")) loadPlant(await file.text(), file.name);
  else load(await file.text(), file.name);
});

$("btnSave").addEventListener("click", () => {
  download(formatPricelist(list), fileName, "application/json");
  dirty = false;
  status();
});
window.addEventListener("beforeunload", e => { if(dirty || plantDirty) e.preventDefault(); });

if(PLANT_TEMPLATE){
  try{
    validatePlant(PLANT_TEMPLATE);
    plant = structuredClone(PLANT_TEMPLATE);
  }catch(error){ console.error(error); }
}
if(TEMPLATE) load(JSON.stringify(TEMPLATE), "pricelist.json");
else render();
syncVat();
renderPlant();
plantStatus();
status();
