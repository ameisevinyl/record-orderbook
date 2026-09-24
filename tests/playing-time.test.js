import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, timeLimitRows, rpmRecommendation, PLAYING_TIME_NOTE } from "../src/lib/playing-time.js";

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

test("timeLimitRows lists every cut and rpm, 33 before 45", () => {
  const limits = {
    normal:      { recommended: { 45: 12, 33: 20 }, max: { 45: 15, 33: 27 } },
    soundsystem: { recommended: { 45: 10, 33: 15 }, max: { 45: 10, 33: 16 } }
  };
  assert.deepEqual(timeLimitRows(limits), [
    { label: "normal, 33 RPM", text: "below 20 min / 27 min" },
    { label: "normal, 45 RPM", text: "below 12 min / 15 min" },
    { label: "soundsystem, 33 RPM", text: "below 15 min / 16 min" },
    { label: "soundsystem, 45 RPM", text: "below 10 min / 10 min" }
  ]);
});

test("rpmRecommendation names a format's recommended speed, if any", () => {
  assert.equal(rpmRecommendation({recommendedRpm: 45}), "45 RPM strongly recommended");
  assert.equal(rpmRecommendation({}), "");
});

test("the playing-time note says the values depend on the music", () => {
  assert.match(PLAYING_TIME_NOTE, /Guide values only/);
  assert.match(PLAYING_TIME_NOTE, /the more bass, the shorter the side/);
});
