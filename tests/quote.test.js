import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { quote } from "../src/lib/quote.js";

const item = (name, unit, tiers, min) => ({ name, unit, tiers, ...(min === undefined ? {} : { min }) });
const list = {
  version: 1, currency: "EUR", vat: { country: "ES", rate: 21 },
  discounts: [
    { id: "q1", label: "Q1", percent: 10, from: "2026-01-01", to: "2026-03-31" },
    { id: "friend", label: "Friend", percent: 5 }
  ],
  items: {
    "7/record/black": item("black", 1000, [{ from: 100, price: 1220 }, { from: 500, price: 1100 }]),
    "7/record/colour": item("colour", 1000, [{ from: 100, price: 2220 }]),
    "7/record/random": item("random", 1000, [{ from: 50, price: 1720 }]),
    "7/outerCover/cover-printed": item("cover", 1000, [{ from: 1, price: 1150 }], 50),
    "7/innerSleeve/sleeve-black-cutout": item("sleeve", 1000, [{ from: 1, price: null }]),
    "7/extra/master-stamper": item("stamper", "order", [{ from: 1, price: 400 }]),
    "7/testpress": item("testpress", 1, [{ from: 1, price: 3 }])
  }
};
const order = (o = {}) => ({ format: "7", colours: [{ color: "black", qty: 200 }], extras: ["master-stamper"], ...o });
const q = (o, opts) => quote(order(o), list, CONFIG, opts);

test("the plant's example: stamper + 200 records + 200 covers = 874", () => {
  const r = q({ outerCover: "cover-printed" });
  assert.deepEqual(r.lines.map(l => l.amount), [244, 230, 400]);
  assert.equal(r.net, 874);
  assert.deepEqual(r.missing, []);
});

test("tier by quantity: below the first uses it, highest reached wins", () => {
  assert.equal(q({ colours: [{ color: "black", qty: 50 }], extras: [] }).lines[0].price, 1220);
  assert.equal(q({ colours: [{ color: "black", qty: 499 }], extras: [] }).lines[0].price, 1220);
  assert.equal(q({ colours: [{ color: "black", qty: 500 }], extras: [] }).lines[0].price, 1100);
});

test("colours of one class share a tier; random and black stay apart", () => {
  const r = q({ colours: [{ color: "red", qty: 60 }, { color: "blue", qty: 60 }, { color: "random", qty: 50 }, { color: "black", qty: 0 }], extras: [] });
  assert.deepEqual(r.lines.map(l => [l.key, l.qty]), [["7/record/colour", 120], ["7/record/random", 50]]);
});

test("minimum line total", () => {
  assert.equal(q({ colours: [{ color: "black", qty: 10 }], outerCover: "cover-printed", extras: [] }).lines[1].amount, 50);
});

test("unpriced and unknown items are reported, not zero", () => {
  const r = q({ innerSleeve: "sleeve-black-cutout", inlay: "inlay-printed", extras: [] });
  assert.deepEqual(r.missing, ["7/innerSleeve/sleeve-black-cutout", "7/inlay/inlay-printed"]);
  assert.equal(r.net, 244);
});

test("per-piece unit and no quantity", () => {
  assert.equal(q({ testpress: 3, extras: [] }).lines[1].amount, 9);
  assert.equal(q({ colours: [] }).net, 0);
});

test("discounts: percent of the subtotal, date window enforced", () => {
  const r = q({ outerCover: "cover-printed" }, { discounts: ["q1", "friend"], date: "2026-02-01" });
  assert.deepEqual(r.discounts.map(d => d.amount), [-87.4, -43.7]);
  assert.equal(r.net, 742.9);
  assert.throws(() => q({}, { discounts: ["q1"], date: "2026-05-01" }), /not valid/);
  assert.throws(() => q({}, { discounts: ["q1"] }), /not valid/);
  assert.throws(() => q({}, { discounts: ["nope"] }), /unknown discount/);
  assert.equal(q({}, { discounts: ["friend"] }).discounts[0].percent, 5);
});
