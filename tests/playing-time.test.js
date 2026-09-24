import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, timeLimitTable, rpmRecommendation, rpmWarning, PLAYING_TIME_NOTE } from "../src/lib/playing-time.js";

const timeLimits = {
  normal: { recommended: { 33: 18, 45: 10 }, max: { 33: 24, 45: 14 } },
};

test("computeStatus returns ok under the recommended threshold", () => {
  const r = computeStatus(timeLimits, 33, "normal", 17 * 60);
  assert.equal(r.level, "ok");
});

test("computeStatus returns warn between recommended and max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 19 * 60);
  assert.equal(r.level, "warn");
});

test("computeStatus returns danger past max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 25 * 60);
  assert.equal(r.level, "danger");
});

test("timeLimitTable: one row per cut, recommended/max per rpm, 33 before 45", () => {
  const limits = {
    normal:      { recommended: { 45: 12, 33: 20 }, max: { 45: 15, 33: 27 } },
    soundsystem: { recommended: { 45: 10, 33: 15 }, max: { 45: 10, 33: 16 } }
  };
  assert.deepEqual(timeLimitTable(limits), {
    head: ["Cut", "33 RPM recommended", "33 RPM max", "45 RPM recommended", "45 RPM max"],
    rows: [
      ["normal", "< 20 min", "27 min", "< 12 min", "15 min"],
      ["soundsystem", "< 15 min", "16 min", "< 10 min", "10 min"]
    ]
  });
});

test("rpmRecommendation names a format's recommended speed, if any", () => {
  assert.equal(rpmRecommendation({recommendedRpm: 45}), "45 RPM strongly recommended");
  assert.equal(rpmRecommendation({}), "");
});

test("the playing-time note says the values depend on the music", () => {
  assert.equal(PLAYING_TIME_NOTE, "Varies by style: more bass = less space");
});

test("rpmWarning only when a side runs at the other speed", () => {
  assert.equal(rpmWarning({recommendedRpm: 45}, 33), "45 RPM strongly recommended");
  assert.equal(rpmWarning({recommendedRpm: 45}, 45), "");
  assert.equal(rpmWarning({}, 33), "");
});
