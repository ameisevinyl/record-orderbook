import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { orderFromProject, buildPriceQuote } from "../src/lib/price-quote.js";
import { money, customerPricing } from "../src/lib/pricing.js";

const black = CONFIG.vinylColor.standardColor;
const project = (over = {}) => prepareProject({projectVersion: 2, format: "7", catalogue: "K",
  vinylColor: [{color: black, qty: "300"}],
  labels: {sides: {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}}, ...over}, CONFIG);
const pricelist = () => ({version: 1, currency: "EUR", created: "2026-10-01", validUntil: "2026-12-31", vat: {country: "DE", rate: 19}, items: {
  "7/mastering/lacquerCut": {name: "Lacquer cut", unit: "order", tiers: [{from: 1, price: 60}]},
  "7/mastering/plating1": {name: "Plating", unit: "order", tiers: [{from: 1, price: 40}]},
  "7/record/setup": {name: "Pressing setup", unit: "order", tiers: [{from: 1, price: 100}]},
  "7/record/black": {name: "Record, black", unit: 1000, tiers: [{from: 100, price: 1500}]},
  "7/label/printed-cmyk": {name: "Label, printed", unit: 1000, tiers: [{from: 1, price: 200}]}
}});
const vat = (kind, rate, status = "none") => ({case: kind, rate, vatId: {id: "", status, checked: ""}});
const build = (v, p = project(), list = pricelist()) => buildPriceQuote({project: p, pricelist: list, config: CONFIG, today: "2026-10-09", vat: v});

test("the order the quote prices, from the project", () => {
  assert.deepEqual(orderFromProject(project()), {format: "7", sides: 2, colours: [{color: black, qty: 300}],
    label: "printed-cmyk", innerSleeve: "", outerCover: "", inlay: "", referenceCut: false, testpress: 0});
  const odd = orderFromProject(project({sides: {B: {blank: true}}, vinylColor: [{color: black, qty: "100"}, {color: "random", qty: " "}, {color: "red", qty: "abc"}],
    labels: {sides: {A: {whitelabel: true}, B: {whitelabel: true}}}, proofs: {referenceCut: true, testpresses: 3},
    coverSleeve: {innerSleeve: {productId: "sleeve-printed"}, cover: {productId: "cover-printed"}}}));
  assert.deepEqual([odd.sides, odd.label, odd.innerSleeve, odd.outerCover, odd.referenceCut, odd.testpress],
    [1, "whitelabel", "sleeve-printed", "cover-printed", true, 3]);
  assert.deepEqual(odd.colours.map(c => c.qty), [100, 0, 0], "an empty or invalid quantity is nothing");
  assert.equal(orderFromProject(project({labels: {sides: {A: {whitelabel: true}, B: {fileName: "x.pdf"}}}})).label, "printed-cmyk", "one printed side prices the printed label");
});

test("the quote: net from the lines, copies, price per copy, VAT on top", () => {
  const {ok, quote} = build(vat("domestic", 19));
  assert.equal(ok, true);
  // lacquer 2×60 + plating 2×40 + setup 100 + 300 records at 1500/1000 + 300 labels at 200/1000
  assert.equal(quote.net, 810);
  assert.deepEqual([quote.copies, quote.perCopy], [300, 2.7]);
  assert.deepEqual([quote.created, quote.validUntil, quote.currency, quote.version], ["2026-10-09", "2026-12-31", "EUR", 1]);
  assert.deepEqual(quote.lines.map(l => [l.key, l.amount]), [["7/mastering/lacquerCut", 120], ["7/mastering/plating1", 80],
    ["7/record/setup", 100], ["7/record/black", 450], ["7/label/printed-cmyk", 60]]);
  assert.deepEqual([quote.vat.case, quote.vat.rate, quote.vat.amount, quote.vat.gross, quote.vat.note], ["domestic", 19, 153.9, 963.9, "plus 19 % VAT"]);
  assert.equal(quote.order.format, "7");
});

test("VAT amounts: none for reverse charge, export or no logic", () => {
  for(const [kind, rate] of [["reverse-charge", 0], ["export", 0], ["none", null]]){
    const {quote} = build(vat(kind, rate, kind === "reverse-charge" ? "valid" : "none"));
    assert.deepEqual([quote.vat.amount, quote.vat.gross], [0, 810], kind);
  }
  assert.equal(build(vat("reverse-charge", 0, "valid")).quote.vat.vatId.status, "valid");
});

test("no quote while prices are missing or there is no quantity", () => {
  const list = pricelist();
  delete list.items["7/label/printed-cmyk"];
  list.items["7/record/setup"].tiers = [{from: 1, price: null}];
  const missing = build(vat("domestic", 19), project(), list);
  assert.deepEqual([missing.ok, missing.missing], [false, ["7/record/setup", "7/label/printed-cmyk"]]);
  const none = build(vat("domestic", 19), project({vinylColor: [{color: black, qty: ""}]}));
  assert.deepEqual([none.ok, none.reason], [false, "no quantity"]);
});

test("money: two decimals, thousands separated, the currency behind", () => {
  assert.equal(money(1234.5, "EUR"), "1,234.50 EUR");
  assert.equal(money(0.5, "EUR"), "0.50 EUR");
  assert.equal(money(1234567.891, "USD"), "1,234,567.89 USD");
});

test("what the customer reads: net, per copy, the VAT line — never a product line", () => {
  const {quote} = build(vat("domestic", 19));
  assert.deepEqual(customerPricing(quote), [["Net price", "810.00 EUR"], ["Net price per copy", "2.70 EUR"], ["VAT", "plus 19 % VAT"],
    ["VAT amount", "153.90 EUR"], ["Total incl. VAT", "963.90 EUR"], ["Valid until", "2026-12-31"]]);
  const reverse = customerPricing(build(vat("reverse-charge", 0, "valid")).quote);
  assert.deepEqual(reverse.map(r => r[0]), ["Net price", "Net price per copy", "VAT", "Valid until"]);
  assert.equal(reverse[2][1], "no VAT — reverse charge, VAT due from the recipient");
  assert.ok(!JSON.stringify(customerPricing(quote)).match(/Lacquer|Plating|setup|Record|Label/i));
});
