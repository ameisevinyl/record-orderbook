import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, parseTime, trackGapSeconds } from "../src/lib/time.js";

test("formatTime pads seconds and floors negatives/NaN to 0:00", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(-5), "0:00");
  assert.equal(formatTime(NaN), "0:00");
});

test("parseTime reads m:ss and bare-seconds forms", () => {
  assert.equal(parseTime("3:45"), 225);
  assert.equal(parseTime("0:05"), 5);
  assert.equal(parseTime("1:02.5"), 62.5);
  assert.equal(parseTime("12:00"), 720);
  assert.equal(parseTime("200"), 200);
  assert.equal(parseTime("3.5"), 3.5);
  assert.equal(parseTime("3,5"), 3.5);
});

test("parseTime returns null for empty/unreadable input", () => {
  assert.equal(parseTime(""), null);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime("abc"), null);
});

test("parseTime rejects partial, negative, non-finite, and out-of-range forms", () => {
  assert.equal(parseTime("12 seconds"), null);
  assert.equal(parseTime("12.5x"), null);
  assert.equal(parseTime("-1"), null);
  assert.equal(parseTime("Infinity"), null);
  assert.equal(parseTime("NaN"), null);
  assert.equal(parseTime("1e2"), null);
  assert.equal(parseTime("1."), null);
  assert.equal(parseTime("1:60"), null);
  assert.equal(parseTime("1:02x"), null);
});

test("trackGapSeconds is 0 for the first track regardless of gap fields", () => {
  assert.equal(trackGapSeconds({gap: "2", gapCustom: ""}, true), 0);
});

test("trackGapSeconds reads the 0/2 presets and falls back to gapCustom", () => {
  assert.equal(trackGapSeconds({gap: "0", gapCustom: ""}, false), 0);
  assert.equal(trackGapSeconds({gap: "2", gapCustom: ""}, false), 2);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "3.5"}, false), 3.5);
});

test("trackGapSeconds treats an unparsable gapCustom as 0", () => {
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: ""}, false), 0);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "abc"}, false), 0);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "3.5 seconds"}, false), 0);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "-1"}, false), 0);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "Infinity"}, false), 0);
  assert.equal(trackGapSeconds({gap: "custom", gapCustom: "NaN"}, false), 0);
});
