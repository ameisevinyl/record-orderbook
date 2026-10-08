import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config.js";
import { priceItems, mergePricelist, unpriced, validatePricelist, formatPricelist, perPiece, parsePrice } from "../src/lib/pricelist.js";

const example = JSON.parse(readFileSync(new URL("../src/pricelist.example.json", import.meta.url), "utf8"));

test("derives one unique item per product of every enabled format", () => {
  const keys = priceItems(CONFIG).map(i => i.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("7/record/colour"));
  assert.ok(keys.includes("7/innerSleeve/sleeve-printed"));
  assert.ok(keys.includes("7/mastering/plating2"));
  assert.ok(keys.includes("12/record/setup"));
  assert.ok(!keys.some(k => k.startsWith("10/")), "disabled format");
});

test("the committed template validates and is complete", () => {
  validatePricelist(example);
  const { list, orphans } = mergePricelist(priceItems(CONFIG), example);
  assert.deepEqual(orphans, []);
  assert.deepEqual(unpriced(list), []);
  assert.deepEqual(example.vat, { country: "ES", rate: 21 });
});

test("merge keeps filled prices, adds new items unpriced, drops orphans", () => {
  const items = [{ key: "7/record/black", name: "a" }, { key: "7/testpress", name: "b" }];
  const existing = {
    currency: "USD",
    items: {
      "7/record/black": { name: "old", unit: 1000, tiers: [{ from: 100, price: 1220 }] },
      "7/gone": { name: "x", unit: 1000, tiers: [{ from: 1, price: 1 }] }
    }
  };
  const { list, orphans } = mergePricelist(items, existing);
  assert.equal(list.currency, "USD");
  assert.equal(list.items["7/record/black"].name, "a");
  assert.equal(list.items["7/record/black"].tiers[0].price, 1220);
  assert.deepEqual(list.items["7/testpress"].tiers, [{ from: 1, price: null }]);
  assert.deepEqual(orphans, ["7/gone"]);
  assert.deepEqual(unpriced(list), ["7/testpress"]);
});

test("validation rejects malformed lists", () => {
  const bad = f => { const l = structuredClone(example); f(l); return () => validatePricelist(l); };
  assert.throws(bad(l => { l.vat.rate = 120; }), /vat\.rate/);
  assert.doesNotThrow(bad(l => { l.vat.rate = null; }));
  assert.throws(bad(l => { l.vat.country = "es"; }), /vat\.country/);
  assert.throws(bad(l => { l.items["7/record/black"].unit = 0; }), /unit/);
  assert.throws(bad(l => { l.items["7/record/black"].tiers = []; }), /tiers/);
  assert.throws(bad(l => { l.items["7/record/black"].tiers = [{ from: 500, price: 1 }, { from: 100, price: 2 }]; }), /ascend/);
  assert.throws(bad(l => { l.items["7/record/black"].tiers[0].price = -1; }), /price/);
});

test("formatPricelist keeps one tier per line and round-trips", () => {
  const text = formatPricelist(example);
  assert.match(text, /\{ "from": 100, "price": \d+ \}/);
  assert.deepEqual(JSON.parse(text), example);
});

test("prices are shown per piece and stored per unit", () => {
  assert.equal(perPiece(1220, 1000), "1.22");
  assert.equal(perPiece(400, "order"), "400");
  assert.equal(perPiece(null, 1000), "");
  assert.equal(parsePrice("1,22", 1000), 1220);
  assert.equal(parsePrice("1.15", 1000), 1150);
  assert.equal(parsePrice(" 400 ", "order"), 400);
  assert.equal(parsePrice("1,22 €", 1000), 1220);
  assert.equal(parsePrice("", 1000), null);
  assert.ok(Number.isNaN(parsePrice("abc", 1000)));
  assert.ok(Number.isNaN(parsePrice("-1", 1000)));
});
