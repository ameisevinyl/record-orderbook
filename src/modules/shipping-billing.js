// Billing / Shipping Address module — one billing address and one-or-
// more shipping addresses, both using the same standard carrier-
// compliant international address shape (UPU S42 / FedEx / UPS / DHL):
// recipient_name, optional attention line, address_line_1-3, city, an
// optional state_province (most countries don't have one), postal_code,
// a 2-letter country_code, an is_residential flag, and phone — plus
// email (required, not part of the carrier schema) and an optional VAT
// reg. # / EORI # on every address, not just billing. See
// REQUIRED_ADDRESS_FIELDS in ../lib/shipping.js for exactly what's
// required.
//
// Quantity: no total is entered here — each shipping address shows one
// qty field per ordered colour (from the vinyl-color module's colour
// breakdown, read via getColorBreakdown()), below the address's EORI
// number. Shipping address #1 is the default destination and, per
// colour, always gets whatever's left of that colour's total after
// every other shipping address's own qty (for that colour) is
// subtracted — see allocateQuantities() in ../lib/shipping.js, applied
// once per colour. Address #1 therefore isn't removable and its qty
// fields are read-only (computed, not entered). The set of colour rows
// shown is kept in sync with the current order (see syncColorRows())
// without destroying in-progress input in other fields when it hasn't
// changed.
//
// VAT/EORI here are front-end format checks only (see ../lib/shipping.js
// for why no per-country regex table) — actual VAT validity is confirmed
// by a human via the VIES link, since VIES has no browser-callable public
// endpoint this file could call without violating the no-external-
// requests-at-runtime rule. Country is a <select> built from the full
// ISO 3166-1 alpha-2 list in ../lib/countries.js, so its value is always
// either blank or a real code — no separate format check needed.

import { allocateQuantities, missingAddressFields, emailFormatValid, phoneFormatValid, vatIdFormatValid, eoriFormatValid } from "../lib/shipping.js";
import { COUNTRIES } from "../lib/countries.js";
import { colorLabel } from "../lib/vinyl-color.js";
import { getColorBreakdown, onColorChange } from "./vinyl-color.js";

const COUNTRY_OPTIONS_HTML = `<option value="">— select country —</option>`
  + COUNTRIES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join("");

// Text fields shared by every address (billing and each shipping
// address alike). is_residential is handled separately since it's a
// checkbox, not a text input.
const ADDRESS_TEXT_FIELDS = [
  "recipientName", "attention",
  "addressLine1", "addressLine2", "addressLine3",
  "city", "stateProvince", "postalCode", "countryCode",
  "phone", "email", "vat", "eori"
];
// "same as billing" mirrors the physical address, not the tax/customs
// identifiers — a shipping recipient's VAT/EORI can differ from the
// billing entity's even when the two addresses are identical.
const MIRROR_FIELDS = ADDRESS_TEXT_FIELDS.filter(f => f !== "vat" && f !== "eori");

function addressCoreFieldsHtml(){
  return `
    <div class="row">
      <div class="field"><label>Recipient Name <span class="req">*</span></label><input type="text" class="recipientName" maxlength="35" placeholder="person or company name"></div>
      <div class="field"><label>Attention <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="attention" maxlength="35" placeholder="department, c/o"></div>
    </div>
    <div class="row">
      <div class="field"><label>Address Line 1 <span class="req">*</span></label><input type="text" class="addressLine1" maxlength="35"></div>
    </div>
    <div class="row">
      <div class="field"><label>Address Line 2 <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="addressLine2" maxlength="35"></div>
      <div class="field"><label>Address Line 3 <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="addressLine3" maxlength="35"></div>
    </div>
    <div class="row">
      <div class="field"><label>City <span class="req">*</span></label><input type="text" class="city" maxlength="35"></div>
      <div class="field"><label>State / Province <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="stateProvince" maxlength="35"></div>
    </div>
    <div class="row">
      <div class="field" style="flex:0 0 130px;"><label>Postal Code <span class="req">*</span></label><input type="text" class="postalCode" maxlength="12"></div>
      <div class="field" style="flex:1 1 220px;"><label>Country <span class="req">*</span></label><select class="countryCode">${COUNTRY_OPTIONS_HTML}</select></div>
      <div class="field" style="flex:0 0 auto;">
        <label class="chk" style="margin-top:20px;"><input type="checkbox" class="isResidential"> residential address</label>
      </div>
    </div>
    <div class="row">
      <div class="field"><label>Email <span class="req">*</span></label><input type="text" class="email"></div>
      <div class="field"><label>Phone <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="phone" placeholder="+1 555 123 4567"></div>
    </div>
    <div class="row">
      <div class="field"><label>Int. VAT Reg. # <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="vat" placeholder="e.g. DE123456789"></div>
      <div class="field" style="flex:0 0 auto;">
        <label>&nbsp;</label>
        <a class="btn ghost no-print" href="https://ec.europa.eu/taxation_customs/vies/" target="_blank" rel="noopener">Verify on VIES ↗</a>
      </div>
      <div class="field"><label>EORI Number <span style="font-weight:400;text-transform:none;">(optional)</span></label><input type="text" class="eori"></div>
    </div>`;
}

function billingTemplate(){
  return `${addressCoreFieldsHtml()}<ul class="checklist billingWarnings"></ul>`;
}

function shipAddrTemplate(isPrimary){
  return `
  <div class="ship-addr">
    <div class="side-head">
      <h3 class="ship-addr-title"></h3>
      <div class="side-opts">
        ${isPrimary ? `<label class="chk"><input type="checkbox" class="sameAsBilling"> same as billing address</label>` : `<button type="button" class="rmbtn no-print shipRemove" title="Remove address">x</button>`}
      </div>
    </div>
    ${addressCoreFieldsHtml()}
    <div class="row ship-colour-qtys"></div>
    <div class="field"><label>Note <span style="font-weight:400;text-transform:none;">(optional)</span></label><textarea class="note"></textarea></div>
    <ul class="checklist shipWarnings"></ul>
  </div>`;
}

function colorQtyFieldHtml(color, label, isPrimary){
  return `<div class="field" style="flex:0 0 130px;"><label>${label}${isPrimary ? " (remaining)" : ""}</label><input type="number" class="colourQtyShip" data-color="${color}" min="0" step="1" ${isPrimary ? "readonly" : ""}></div>`;
}

// Adds/removes colour-qty inputs in an address card to match the current
// order's colours, without touching inputs for colours that are still
// present — a full re-render would blow away whatever the user was
// mid-typing in another address's field on every keystroke elsewhere.
// Colour keys always come from CONFIG.vinylColor (studio-controlled
// identifiers, not user text), so a plain attribute selector is safe.
function syncColorRows(el, breakdown, isPrimary){
  const container = el.querySelector(".ship-colour-qtys");
  const existing = Array.from(container.querySelectorAll(".colourQtyShip"));
  const wantedColors = breakdown.map(b => b.color);

  existing.forEach(inp=>{
    if(!wantedColors.includes(inp.dataset.color)) inp.closest(".field").remove();
  });

  const existingColors = existing.map(inp => inp.dataset.color);
  breakdown.forEach(({color, label})=>{
    if(existingColors.includes(color)) return;
    container.insertAdjacentHTML("beforeend", colorQtyFieldHtml(color, label, isPrimary));
    colorQtyInput(el, color).addEventListener("input", updateAll);
  });
}

function colorQtyInput(el, color){
  return el.querySelector(`.ship-colour-qtys .colourQtyShip[data-color="${color}"]`);
}

function shipAddrEls(){
  return Array.from(document.querySelectorAll("#shipAddrs .ship-addr"));
}

function renumberShipAddrs(){
  shipAddrEls().forEach((el, i)=>{
    el.querySelector(".ship-addr-title").textContent = "Shipping Address " + (i+1);
  });
}

function readAddress(scope){
  const addr = {};
  ADDRESS_TEXT_FIELDS.forEach(cls=>{
    addr[cls] = scope.querySelector("."+cls).value;
  });
  addr.isResidential = scope.querySelector(".isResidential").checked;
  return addr;
}

function writeAddress(scope, addr){
  ADDRESS_TEXT_FIELDS.forEach(cls=>{
    scope.querySelector("."+cls).value = (addr && addr[cls]) || "";
  });
  scope.querySelector(".isResidential").checked = !!(addr && addr.isResidential);
}

function renderWarningList(listEl, items){
  listEl.innerHTML = items.map(([ok, text])=>
    `<li class="${ok?'ok':'bad'}"><span class="mark">${ok?'✓':'!'}</span>${text}</li>`
  ).join("");
}

/* ============================================================
   Quantity allocation — one qty field per ordered colour, per address.
   Address #1 gets each colour's remainder after every other address's
   qty for that same colour is subtracted (see allocateQuantities()).
   ============================================================ */
function syncAllColorRows(){
  const breakdown = getColorBreakdown();
  shipAddrEls().forEach((el, i)=> syncColorRows(el, breakdown, i===0));
}

function recomputeColorQtys(){
  const els = shipAddrEls();
  if(els.length === 0) return;
  getColorBreakdown().forEach(({color, qty: total})=>{
    const extras = els.slice(1).map(el => colorQtyInput(el, color).value);
    const { firstQty, overAllocated } = allocateQuantities(total, extras);
    const primaryInput = colorQtyInput(els[0], color);
    primaryInput.value = firstQty;
    primaryInput.classList.toggle("warn-qty", overAllocated);
  });
}

/* ============================================================
   Checklist (required fields + best-effort format checks) — shared by
   billing and shipping cards, since both use the same address shape.
   ============================================================ */
// Matches the on-screen <label> text in addressCoreFieldsHtml — keep
// the two in sync if a required field's label ever changes.
const FIELD_LABELS = {
  recipientName: "Recipient Name",
  addressLine1: "Address Line 1",
  city: "City",
  postalCode: "Postal Code",
  countryCode: "Country",
  email: "Email"
};

function addressFormatWarnings(addr){
  const items = [];
  const missing = missingAddressFields(addr).map(key => FIELD_LABELS[key] || key);
  items.push([missing.length===0, missing.length===0 ? "Address complete" : `Missing: ${missing.join(", ")}`]);
  if(addr.email) items.push([emailFormatValid(addr.email), "Email looks valid"]);
  if(addr.phone) items.push([phoneFormatValid(addr.phone), "Phone looks valid (use + country code)"]);
  if(addr.vat) items.push([vatIdFormatValid(addr.vat), "VAT reg. # has a plausible shape — confirm on VIES"]);
  if(addr.eori) items.push([eoriFormatValid(addr.eori), "EORI # has a plausible shape"]);
  return items;
}

function shipAddrWarnings(el){
  const items = addressFormatWarnings(readAddress(el));
  const total = Array.from(el.querySelectorAll(".colourQtyShip")).reduce((sum, inp)=> sum + (Number(inp.value) || 0), 0);
  items.push([total > 0, total > 0 ? `Qty: ${total}` : "No quantity assigned yet"]);
  return items;
}

function updateChecklists(){
  renderWarningList(document.querySelector(".billingWarnings"), addressFormatWarnings(readAddress(document.getElementById("billingAddress"))));
  shipAddrEls().forEach(el=>{
    renderWarningList(el.querySelector(".shipWarnings"), shipAddrWarnings(el));
  });
}

function updateAll(){
  syncAllColorRows();
  recomputeColorQtys();
  updateChecklists();
}

/* ============================================================
   "Same as billing address"
   ============================================================ */
// Looks up the CURRENT primary shipping address fresh on every call,
// rather than closing over it at wire time — applyShippingBilling
// rebuilds #shipAddrs (and with it the primary element) on every
// project load, so a captured reference would go stale.
function mirrorBillingToPrimary(){
  const primary = shipAddrEls()[0];
  const billing = document.getElementById("billingAddress");
  MIRROR_FIELDS.forEach(cls=> primary.querySelector("."+cls).value = billing.querySelector("."+cls).value);
  primary.querySelector(".isResidential").checked = billing.querySelector(".isResidential").checked;
}

function setPrimaryReadonly(on){
  const primary = shipAddrEls()[0];
  // readOnly is a no-op on <select> (countryCode) — it needs disabled,
  // same as the isResidential checkbox, or the field stays editable
  // while the checkbox claims it matches billing.
  MIRROR_FIELDS.forEach(cls=>{
    const field = primary.querySelector("."+cls);
    if(field.tagName === "SELECT") field.disabled = on;
    else field.readOnly = on;
  });
  primary.querySelector(".isResidential").disabled = on;
}

// The primary shipping address's own "same as billing" checkbox — this
// element is fresh DOM every time applyShippingBilling rebuilds
// #shipAddrs, so it needs rewiring on every load (unlike
// wireBillingMirrorSource below, whose target DOM is built once).
function wireSameAsBillingCheckbox(){
  const chk = shipAddrEls()[0].querySelector(".sameAsBilling");
  chk.addEventListener("change", ()=>{
    setPrimaryReadonly(chk.checked);
    if(chk.checked) mirrorBillingToPrimary();
    updateAll();
  });
}

// The billing address's own fields, wired to re-mirror into the primary
// shipping address when edited — #billingAddress is built once
// (initShippingBilling) and never rebuilt, so unlike the primary
// shipping checkbox above, wiring this more than once would accumulate
// duplicate listeners across repeat project loads.
function wireBillingMirrorSource(){
  const billing = document.getElementById("billingAddress");
  const mirrorIfSame = ()=>{
    if(shipAddrEls()[0].querySelector(".sameAsBilling").checked){ mirrorBillingToPrimary(); updateAll(); }
  };
  MIRROR_FIELDS.forEach(cls=>{
    const field = billing.querySelector("."+cls);
    field.addEventListener(field.tagName === "SELECT" ? "change" : "input", mirrorIfSame);
  });
  billing.querySelector(".isResidential").addEventListener("change", mirrorIfSame);
}

/* ============================================================
   Add / remove shipping addresses
   ============================================================ */
function wireShipAddrEvents(el){
  el.querySelectorAll("input, textarea, select").forEach(input=>{
    input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", updateAll);
  });
  const rm = el.querySelector(".shipRemove");
  if(rm){
    rm.addEventListener("click", ()=>{
      el.remove();
      renumberShipAddrs();
      updateAll();
    });
  }
}

function addShipAddr(){
  const container = document.getElementById("shipAddrs");
  container.insertAdjacentHTML("beforeend", shipAddrTemplate(false));
  const el = shipAddrEls().at(-1);
  wireShipAddrEvents(el);
  renumberShipAddrs();
  updateAll();
}

export function initShippingBilling(){
  document.getElementById("billingAddress").innerHTML = billingTemplate();
  document.getElementById("billingAddress").querySelectorAll("input, textarea, select").forEach(input=>{
    input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", updateAll);
  });

  document.getElementById("shipAddrs").innerHTML = shipAddrTemplate(true);
  renumberShipAddrs();
  wireShipAddrEvents(shipAddrEls()[0]);
  wireSameAsBillingCheckbox();
  wireBillingMirrorSource();

  document.getElementById("addShipAddrBtn").addEventListener("click", addShipAddr);
  onColorChange(updateAll);

  updateAll();
}

/* ============================================================
   Cross-module interface — same pattern as labels.js /
   cover.js/inner-sleeve.js/inlay.js's collect*Files(), consumed by tracklist.js for
   project save/load and the printable order summary. Neither module
   reaches into the other's DOM directly.
   ============================================================ */
export function collectShippingBilling(){
  const billing = readAddress(document.getElementById("billingAddress"));

  const shipping = shipAddrEls().map(el => {
    const qtyByColor = {};
    el.querySelectorAll(".colourQtyShip").forEach(inp=>{ qtyByColor[inp.dataset.color] = inp.value; });
    return {
      ...readAddress(el),
      qtyByColor,
      note: el.querySelector(".note").value,
      sameAsBilling: el.querySelector(".sameAsBilling") ? el.querySelector(".sameAsBilling").checked : false
    };
  });

  return { billing, shipping };
}

export function applyShippingBilling(data){
  const d = data || {};

  writeAddress(document.getElementById("billingAddress"), d.billing || {});

  const container = document.getElementById("shipAddrs");
  container.innerHTML = "";
  const entries = (d.shipping && d.shipping.length) ? d.shipping : [{}];
  entries.forEach((entry, i)=>{
    container.insertAdjacentHTML("beforeend", shipAddrTemplate(i===0));
    const el = shipAddrEls().at(-1);
    writeAddress(el, entry);
    el.querySelector(".note").value = entry.note || "";
    wireShipAddrEvents(el);
  });
  renumberShipAddrs();
  wireSameAsBillingCheckbox();
  const primaryChk = shipAddrEls()[0].querySelector(".sameAsBilling");
  primaryChk.checked = !!(entries[0] && entries[0].sameAsBilling);
  primaryChk.dispatchEvent(new Event("change"));

  // Colour rows were just created blank by updateAll() (run inside the
  // checkbox's change event above); restore saved per-colour qty for
  // non-primary addresses now that the rows exist. Address #1 is always
  // computed, never restored directly.
  shipAddrEls().forEach((el, i)=>{
    if(i === 0) return;
    const qtyByColor = (entries[i] && entries[i].qtyByColor) || {};
    Object.keys(qtyByColor).forEach(color=>{
      const input = colorQtyInput(el, color);
      if(input) input.value = qtyByColor[color];
    });
  });

  updateAll();
}

// shippingBilling/vinylColor are project.shippingBilling/project.vinylColor
// — buildOrderSummaryText builds order_summary.txt from the project object
// alone (never the live DOM), so this must too.
export function buildShippingBillingSummary({billing, shipping}, vinylColor){
  const overallBreakdown = vinylColor
    .filter(r => Number(r.qty) > 0)
    .map(r => `${r.qty} ${colorLabel(r.color)}`)
    .join(", ");

  let out = "BILLING ADDRESS:\n";
  out += `  ${billing.recipientName}${billing.attention ? " — " + billing.attention : ""}\n`;
  out += `  ${billing.addressLine1}\n`;
  if(billing.addressLine2) out += `  ${billing.addressLine2}\n`;
  if(billing.addressLine3) out += `  ${billing.addressLine3}\n`;
  out += `  ${billing.postalCode} ${billing.city}${billing.stateProvince ? ", " + billing.stateProvince : ""}\n`;
  out += `  ${billing.countryCode}\n`;
  out += `  ${billing.email}${billing.phone ? "  " + billing.phone : ""}\n`;
  if(billing.vat) out += `  VAT: ${billing.vat}\n`;
  if(billing.eori) out += `  EORI: ${billing.eori}\n`;

  out += `\nSHIPPING${overallBreakdown ? " (pressed: " + overallBreakdown + ")" : ""}:\n`;
  shipping.forEach((s, i)=>{
    const parts = Object.entries(s.qtyByColor || {}).filter(([,q])=> Number(q) > 0).map(([color,q])=> `${q} ${color}`).join(", ");
    out += `  [${i+1}] ${parts || "no qty"} — ${s.recipientName}${s.attention ? " / " + s.attention : ""}\n`;
    out += `      ${s.addressLine1}${s.addressLine2 ? ", " + s.addressLine2 : ""}${s.addressLine3 ? ", " + s.addressLine3 : ""}\n`;
    out += `      ${s.postalCode} ${s.city}${s.stateProvince ? ", " + s.stateProvince : ""}, ${s.countryCode}${s.isResidential ? " (residential)" : ""}\n`;
    out += `      ${s.email}${s.phone ? "  " + s.phone : ""}${s.eori ? "  EORI: " + s.eori : ""}${s.vat ? "  VAT: " + s.vat : ""}\n`;
    if(s.note) out += `      note: ${s.note}\n`;
  });
  return out;
}
