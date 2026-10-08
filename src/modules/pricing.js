// The Pricing panel: the plant's quote for this order, shown when the
// project zip the plant sent back holds a price_quote.json (and in the
// staff's order view). A complete net price, the price per copy and the VAT
// line — never the product lines (lib/pricing.js).

import { customerPricing } from "../lib/pricing.js";

// quote: the parsed price_quote.json, or null to hide the panel. A file that
// isn't a quote hides it as well.
export function showPricing(quote){
  const panel = document.getElementById("pricingPanel");
  const table = document.getElementById("pricingTable");
  table.replaceChildren();
  let rows = [];
  try{
    rows = quote ? customerPricing(quote) : [];
  }catch{
    rows = [];
  }
  panel.classList.toggle("hidden", !rows.length);
  for(const [label, value] of rows){
    const tr = table.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = label;
    tr.append(th);
    tr.insertCell().textContent = value;
  }
}

// The quote was priced for the order as the plant had it: an edit takes the
// panel away rather than leave a price that no longer fits.
export function initPricing(){
  const sheet = document.querySelector(".sheet");
  for(const type of ["input", "change"]) sheet.addEventListener(type, () => showPricing(null));
}
