import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES } from "../src/lib/countries.js";

test("COUNTRIES has exactly the 249 currently-assigned ISO 3166-1 alpha-2 codes", () => {
  assert.equal(COUNTRIES.length, 249);
});

test("COUNTRIES has no duplicate codes", () => {
  const codes = COUNTRIES.map(([c]) => c);
  assert.equal(new Set(codes).size, codes.length);
});

test("COUNTRIES entries are [2-letter code, name] pairs", () => {
  for (const [code, name] of COUNTRIES) {
    assert.match(code, /^[A-Z]{2}$/);
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0);
  }
});

