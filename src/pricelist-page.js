// Pricelist editor: open a pricelist.json, edit prices in a table, save it
// again. Rows are items, columns the quantities (plus "fixed" for a flat
// price per order); a price applies from its column's quantity up. Shown per
// piece, the file keeps the price per unit (see lib/pricelist.js). Adding or
// removing items is `build/pricelist.js generate`'s job — the list comes from config.
import { validatePricelist, formatPricelist, perPiece, parsePrice, unpriced } from "./lib/pricelist.js";

// build/build.js embeds src/pricelist.example.json here.
const TEMPLATE = null;

const $ = id => document.getElementById(id);
const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const KIND = { record: "records", innerSleeve: "inner sleeves", outerCover: "covers", inlay: "inlays", referenceCut: "proofs", testpress: "proofs", extra: "extras" };

let list = null;
let cols = [];   // the quantity columns, ascending
let fileName = "pricelist.json";
let dirty = false;

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
      <td><input type="text" class="vat" data-m="vatCountry" value="${esc(list.vat.country)}"></td>
      <td><input type="text" class="num vat" data-m="vatRate" value="${list.vat.rate}"></td>
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
  $("status").textContent = error || (list ? `${unpriced(list).length} unpriced${dirty ? " · unsaved changes" : ""}` : "");
  $("btnSave").disabled = !list || !!error;
  $("file").textContent = list ? fileName : "";
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
  if(file) load(await file.text(), file.name);
});

$("btnSave").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([formatPricelist(list)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
  dirty = false;
  status();
});
window.addEventListener("beforeunload", e => { if(dirty) e.preventDefault(); });

if(TEMPLATE) load(JSON.stringify(TEMPLATE), "pricelist.json");
else render();
status();
