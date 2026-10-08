import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { quote } from "../src/lib/quote.js";

const item = (name, unit, tiers, min) => ({ name, unit, tiers, ...(min === undefined ? {} : { min }) });
const list = {
  version: 1, currency: "EUR", vat: { country: "ES", rate: 21 },
  items: {
    "7/record/black": item("black", 1000, [{ from: 100, price: 1220 }, { from: 500, price: 1100 }]),
    "7/record/colour": item("colour", 1000, [{ from: 100, price: 2220 }]),
    "7/label/printed-cmyk": item("labels", 1000, [{ from: 100, price: 150 }]),
    "7/record/random": item("random", 1000, [{ from: 50, price: 1720 }]),
    "7/outerCover/cover-printed": item("cover", 1000, [{ from: 1, price: 1150 }], 50),
    "7/innerSleeve/sleeve-black-cutout": item("sleeve", 1000, [{ from: 1, price: null }]),
    "7/mastering/lacquerCut": item("lacquer", "order", [{ from: 1, price: 100 }]),
    "7/mastering/plating1": item("plating1", "order", [{ from: 1, price: 150 }]),
    "7/mastering/plating2": item("plating2", "order", [{ from: 1, price: 250 }]),
    "7/record/setup": item("setup", "order", [{ from: 1, price: 50 }]),
    "7/testpress": item("testpress", 1, [{ from: 1, price: 3 }])
  }
};
const order = (o = {}) => ({ format: "7", sides: 2, colours: [{ color: "black", qty: 200 }], ...o });
const q = o => quote(order(o), list, CONFIG);
const line = (r, key) => r.lines.find(l => l.key === key);

test("200 records + 200 covers + mastering for two sides", () => {
  const r = q({ outerCover: "cover-printed" });
  assert.deepEqual(r.lines.map(l => l.amount), [200, 300, 50, 244, 230]);
  assert.equal(r.net, 1024);
  assert.deepEqual(r.missing, []);
});

test("tier by quantity: below the first uses it, highest reached wins", () => {
  assert.equal(line(q({ colours: [{ color: "black", qty: 50 }] }), "7/record/black").price, 1220);
  assert.equal(line(q({ colours: [{ color: "black", qty: 499 }] }), "7/record/black").price, 1220);
  assert.equal(line(q({ colours: [{ color: "black", qty: 500 }] }), "7/record/black").price, 1100);
});

test("colours of one class share a tier; random and black stay apart", () => {
  const r = q({ colours: [{ color: "red", qty: 60 }, { color: "blue", qty: 60 }, { color: "random", qty: 50 }, { color: "black", qty: 0 }] });
  assert.deepEqual(r.lines.filter(l => l.key.includes("/record/") && !l.key.endsWith("/setup")).map(l => [l.key, l.qty]), [["7/record/colour", 120], ["7/record/random", 50]]);
});

test("minimum line total", () => {
  assert.equal(line(q({ colours: [{ color: "black", qty: 10 }], outerCover: "cover-printed" }), "7/outerCover/cover-printed").amount, 50);
});

test("unpriced and unknown items are reported, not zero", () => {
  const r = q({ innerSleeve: "sleeve-black-cutout", inlay: "inlay-printed" });
  assert.deepEqual(r.missing, ["7/innerSleeve/sleeve-black-cutout", "7/inlay/inlay-printed"]);
  assert.equal(r.net, 794);
});

test("mastering: per side, one side, 2-step plating, bad input", () => {
  assert.deepEqual(q({ sides: 1 }).lines.slice(0, 3).map(l => l.amount), [100, 150, 50]);
  const two = q({ plating: "2step" }).lines;
  assert.deepEqual(two.map(l => l.key).slice(0, 3), ["7/mastering/lacquerCut", "7/mastering/plating2", "7/record/setup"]);
  assert.equal(two[1].amount, 500);
  assert.throws(() => q({ sides: 3 }), /sides/);
  assert.throws(() => q({ plating: "3step" }), /plating/);
});

test("per-piece unit and no quantity", () => {
  assert.equal(q({ testpress: 3 }).lines.find(l => l.key === "7/testpress").amount, 9);
  assert.equal(q({ colours: [] }).net, 0);
});

test("printed labels: priced per record on top of the blank record", () => {
  const r = q({ label: "printed-cmyk" });
  assert.deepEqual(r.lines.slice(3, 5).map(l => [l.key, l.amount]), [["7/record/black", 244], ["7/label/printed-cmyk", 30]]);
  assert.equal(r.net, 200 + 300 + 50 + 244 + 30);
  assert.ok(!q({ label: "none" }).lines.some(l => l.key.includes("/label/")));
});
