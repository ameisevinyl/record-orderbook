import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANT_CONFIG } from "../src/plant.config.local.example.js";
import { parsePlantConfig, formatPlantConfig } from "../src/lib/plant-config.js";
import { standardVatRate } from "../src/lib/vat-rates.js";

const sample = readFileSync(new URL("../src/plant.config.local.example.js", import.meta.url), "utf8");

test("parses the real sample file, comments included", () => {
  assert.deepEqual(parsePlantConfig(sample), PLANT_CONFIG);
});

test("format and parse round-trip, services on one line each", () => {
  const text = formatPlantConfig(PLANT_CONFIG);
  assert.deepEqual(parsePlantConfig(text), PLANT_CONFIG);
  assert.match(text, /\{ name: "FilePizza", url: "https:\/\/file\.pizza\/", direct: true \}/);
  assert.match(text, /^\s+city: "Kingston 11",$/m);
});

test("rejects what is not a plant config", () => {
  assert.throws(() => parsePlantConfig("const x = 1;"), /PLANT_CONFIG/);
  const broken = structuredClone(PLANT_CONFIG);
  broken.imprint.recipientName = "";
  assert.throws(() => parsePlantConfig(formatPlantConfig(broken)), /recipientName/);
});

test("standard VAT rate by country", () => {
  assert.equal(standardVatRate("ES"), 21);
  assert.equal(standardVatRate("DE"), 19);
  assert.equal(standardVatRate("JM"), undefined);
});
