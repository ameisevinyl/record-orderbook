import { test } from "node:test";
import assert from "node:assert/strict";
import { buildColorOptions, belowMinimum, colorLabel } from "../src/lib/vinyl-color.js";

const vinylColorConfig = {
  standardColor: "black",
  basicColors: ["yellow", "red"],
  minOrderQty: { black: 0, yellow: 300, red: 300, random: 300 }
};

test("colorLabel capitalizes a colour and special-cases random", () => {
  assert.equal(colorLabel("black"), "Black");
  assert.equal(colorLabel("transparent"), "Transparent");
  assert.equal(colorLabel("random"), "Random colour");
});

test("buildColorOptions puts standard first, basics in order, random last", () => {
  const opts = buildColorOptions(vinylColorConfig);
  assert.deepEqual(opts.map(o => o.value), ["black", "yellow", "red", "random"]);
  assert.equal(opts[0].label, "Black");
  assert.equal(opts[3].label, "Random colour");
});

test("belowMinimum is false for a blank/zero quantity", () => {
  assert.equal(belowMinimum("yellow", 0, vinylColorConfig.minOrderQty), false);
  assert.equal(belowMinimum("yellow", "", vinylColorConfig.minOrderQty), false);
});

test("belowMinimum flags a quantity under the configured minimum", () => {
  assert.equal(belowMinimum("yellow", 100, vinylColorConfig.minOrderQty), true);
  assert.equal(belowMinimum("yellow", 300, vinylColorConfig.minOrderQty), false);
  assert.equal(belowMinimum("yellow", 301, vinylColorConfig.minOrderQty), false);
});

test("belowMinimum flags invalid nonblank quantities", () => {
  assert.equal(belowMinimum("yellow", -1, vinylColorConfig.minOrderQty), true);
  assert.equal(belowMinimum("yellow", 300.5, vinylColorConfig.minOrderQty), true);
  assert.equal(belowMinimum("yellow", Infinity, vinylColorConfig.minOrderQty), true);
  assert.equal(belowMinimum("yellow", NaN, vinylColorConfig.minOrderQty), true);
  assert.equal(belowMinimum("yellow", "300 copies", vinylColorConfig.minOrderQty), true);
});

test("belowMinimum defaults to 0 (no minimum) for an unlisted colour", () => {
  assert.equal(belowMinimum("black", 1, vinylColorConfig.minOrderQty), false);
  assert.equal(belowMinimum("unknown", 1, vinylColorConfig.minOrderQty), false);
});
