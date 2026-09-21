import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMatrix } from "../src/lib/matrix.js";

test("defaultMatrix joins catalogue and side", () => {
  assert.equal(defaultMatrix("PNKRCK007", "A"), "PNKRCK007 A");
  assert.equal(defaultMatrix("PNKRCK007", "B"), "PNKRCK007 B");
});

test("defaultMatrix omits the leading space when catalogue is empty", () => {
  assert.equal(defaultMatrix("", "A"), "A");
  assert.equal(defaultMatrix(undefined, "A"), "A");
});
