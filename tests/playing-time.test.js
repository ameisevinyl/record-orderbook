import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus } from "../src/lib/playing-time.js";

const timeLimits = {
  normal: { ideal: { 33: 18, 45: 10 }, max: { 33: 24, 45: 14 } },
};

test("computeStatus returns ok under the ideal threshold", () => {
  const r = computeStatus(timeLimits, 33, "normal", 17 * 60);
  assert.equal(r.level, "ok");
});

test("computeStatus returns warn between ideal and max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 19 * 60);
  assert.equal(r.level, "warn");
});

test("computeStatus returns danger past max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 25 * 60);
  assert.equal(r.level, "danger");
});
