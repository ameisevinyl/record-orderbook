import { test } from "node:test";
import assert from "node:assert/strict";
import { testpressNote } from "../src/lib/proofs.js";

const NOTE = "Testpresses are not recommended for small runs (<1000). If you want to check your mix and master, order a reference cut.";

test("testpressNote: a testpress for a run under the threshold gets the note", () => {
  assert.equal(testpressNote(3, 300, 1000), NOTE);
  assert.equal(testpressNote(1, 0, 1000), NOTE);
  assert.equal(testpressNote(3, 999, 1000), NOTE);
});

test("testpressNote: no note at or above the threshold, or without a testpress", () => {
  assert.equal(testpressNote(3, 1000, 1000), null);
  assert.equal(testpressNote(3, 5000, 1000), null);
  assert.equal(testpressNote(0, 300, 1000), null);
});

test("testpressNote: the threshold comes from the caller", () => {
  assert.match(testpressNote(3, 100, 500), /\(<500\)/);
});
