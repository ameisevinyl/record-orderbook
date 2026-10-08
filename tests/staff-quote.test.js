import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQuotePanel, staleReason } from "../src/lib/staff-quote.js";

const quote = {currency: "EUR", created: "2026-10-09", validUntil: "2026-12-31", net: 810, copies: 300, perCopy: 2.7, lines: [
  {key: "7/mastering/lacquerCut", name: "Lacquer cut <A>", qty: 2, unit: "order", price: 60, amount: 120},
  {key: "7/record/black", name: "Record, black", qty: 300, unit: 1000, price: 1500, amount: 450}],
  vat: {case: "plus-vat", rate: 19, amount: 153.9, gross: 963.9, note: "plus 19 % VAT", vatId: {id: "", status: "none", checked: ""}}};
const base = {saved: null, built: {ok: true, quote}, chosen: "", billingCountry: "FR", plantCountry: "DE",
  proposal: {case: "plus-vat", rate: 19, needsCheck: false}, vatId: {id: "", status: "none", name: "", checked: ""}};

test("a quote that can be made: lines for staff, the net, copies, price per copy, save", () => {
  const html = renderQuotePanel(base);
  assert.ok(html.includes("not quoted yet"));
  assert.ok(html.includes("<td>Lacquer cut &lt;A&gt;</td><td>2</td><td>60.00 EUR flat</td><td>120.00 EUR</td>"));
  assert.ok(html.includes("<td>Record, black</td><td>300</td><td>1,500.00 EUR /1000</td><td>450.00 EUR</td>"));
  assert.ok(html.includes("Net 810.00 EUR · 300 copies · 2.70 EUR per copy"));
  assert.ok(html.includes('<button type="button" data-staff data-act="saveQuote">Save quote</button>'));
});

test("a saved quote: its date and net, and the button updates it", () => {
  const html = renderQuotePanel({...base, saved: quote});
  assert.ok(html.includes("saved 2026-10-09: net 810.00 EUR, valid until 2026-12-31"));
  assert.ok(html.includes(">Update quote</button>"));
});

test("a quote that can't be made says why and can't be saved", () => {
  const none = renderQuotePanel({...base, built: {ok: false, reason: "no quantity", missing: []}});
  assert.ok(none.includes("can't be quoted: no quantity") && none.includes("data-act=\"saveQuote\" disabled"));
  const missing = renderQuotePanel({...base, built: {ok: false, reason: "prices missing", missing: ["7/record/setup", "7/label/<x>"]}});
  assert.ok(missing.includes("can't be quoted: prices missing: 7/record/setup, 7/label/&lt;x&gt;"));
});

test("VAT: the billing country, the ID and what VIES said, the proposal, the override menu", () => {
  const checked = renderQuotePanel({...base, vatId: {id: "FR123<4>", status: "valid", name: "Acme", checked: "2026-10-09"},
    proposal: {case: "reverse-charge", rate: 0, needsCheck: false}});
  assert.ok(checked.includes("FR123&lt;4&gt;") && checked.includes("valid on VIES (Acme, 2026-10-09)"));
  assert.ok(checked.includes("proposed: EU business — reverse charge") && !checked.includes("check this"));
  assert.ok(checked.includes('<option value="">as proposed</option>') && checked.includes('<option value="export">outside the EU — no VAT</option>'));
  const open = renderQuotePanel({...base, vatId: {id: "FR1234", status: "unchecked", name: "", checked: ""},
    proposal: {case: "plus-vat", rate: 19, needsCheck: true}});
  assert.ok(open.includes("not checked") && open.includes("check this"));
  assert.ok(open.includes('<button type="button" data-staff data-act="vatCheck">check on VIES</button>'));
  assert.ok(!renderQuotePanel(base).includes("data-act=\"vatCheck\""), "no ID, nothing to check");
  assert.ok(renderQuotePanel({...base, chosen: "export"}).includes('<option value="export" selected>'));
});

test("a pricelist that can't be read is the whole panel", () => {
  assert.equal(renderQuotePanel({error: "pricelist: <bad>"}), '<p class="manual">pricelist: &lt;bad&gt;</p>');
});

test("a quote built from an order or pricelist that has changed since is stale", () => {
  const then = {projectHash: "p1", listHash: "l1"};
  assert.equal(staleReason(then, {projectHash: "p1", listHash: "l1"}), "");
  assert.match(staleReason(then, {projectHash: "p2", listHash: "l1"}), /the order changed since this page loaded/);
  assert.match(staleReason(then, {projectHash: "p1", listHash: "l2"}), /the pricelist changed/);
  assert.match(staleReason(then, {projectHash: "p2", listHash: "l2"}), /the order and the pricelist changed/);
});
