import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

execFileSync(process.execPath, ["build/build.js"]);
const customer = readFileSync("dist/index.html", "utf8");
const plant = readFileSync("dist/plant.html", "utf8");

test("plant build sets the flag and includes plant code and styles", () => {
  assert.ok(plant.includes("globalThis.PLANT_VIEW = true;"));
  assert.ok(plant.includes("// ---- src/plant.js ----"));
  assert.ok(plant.includes("Plant view (dist/plant.html only): dense"));
});

test("customer build has no plant flag, code or styles, and an unlocked form", () => {
  assert.ok(!customer.includes("globalThis.PLANT_VIEW = true;"));
  assert.ok(!customer.includes("// ---- src/plant.js ----"));
  assert.ok(!customer.includes("Plant view (dist/plant.html only)"));
  assert.match(customer, /<fieldset id="orderForm">/);
});
