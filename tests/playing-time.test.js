import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, timeLimitRows } from "../src/lib/playing-time.js";

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

test("timeLimitRows lists every cut and rpm, 33 before 45", () => {
  const limits = {
    normal:      { ideal: { 45: 12, 33: 20 }, max: { 45: 15, 33: 27 } },
    soundsystem: { ideal: { 45: 10, 33: 15 }, max: { 45: 10, 33: 16 } }
  };
  assert.deepEqual(timeLimitRows(limits), [
    { label: "normal, 33 RPM", text: "20 / 27 min" },
    { label: "normal, 45 RPM", text: "12 / 15 min" },
    { label: "soundsystem, 33 RPM", text: "15 / 16 min" },
    { label: "soundsystem, 45 RPM", text: "10 / 10 min" }
  ]);
});
