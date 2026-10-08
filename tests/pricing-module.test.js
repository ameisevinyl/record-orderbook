import { test } from "node:test";
import assert from "node:assert/strict";
import { showPricing } from "../src/modules/pricing.js";

// Just enough DOM for the panel: a table that collects its rows.
function stubDom(){
  const rows = [];
  const hidden = {value: true};
  const cell = () => ({textContent: ""});
  const table = {
    replaceChildren(){ rows.length = 0; },
    insertRow(){
      const row = {th: null, td: cell(), append(th){ row.th = th; }, insertCell(){ return row.td; }};
      rows.push(row);
      return row;
    }
  };
  const panel = {classList: {toggle: (name, on) => { if(name === "hidden") hidden.value = on; }}};
  globalThis.document = {
    getElementById: id => id === "pricingTable" ? table : panel,
    createElement: () => ({scope: "", textContent: ""})
  };
  return {rows, hidden};
}

const quote = {currency: "EUR", net: 810, perCopy: 2.7, validUntil: "2026-12-31",
  vat: {case: "reverse-charge", rate: 0, amount: 0, gross: 810, note: "no VAT — reverse charge, VAT due from the recipient"}};

test("a quote shows its rows (as text) and the panel; none, or junk, hides it", () => {
  const {rows, hidden} = stubDom();
  try{
    showPricing(quote);
    assert.equal(hidden.value, false);
    assert.deepEqual(rows.map(r => [r.th.textContent, r.td.textContent]), [["Net price", "810.00 EUR"], ["Net price per copy", "2.70 EUR"],
      ["VAT", "no VAT — reverse charge, VAT due from the recipient"], ["Valid until", "2026-12-31"]]);
    showPricing(null);
    assert.deepEqual([hidden.value, rows.length], [true, 0]);
    showPricing({unrelated: true});
    assert.deepEqual([hidden.value, rows.length], [true, 0]);
  }finally{
    delete globalThis.document;
  }
});
