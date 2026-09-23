import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseQuantity, allocateQuantities, missingAddressFields,
  emailFormatValid, phoneFormatValid, vatIdFormatValid, eoriFormatValid
} from "../src/lib/shipping.js";

test("parseQuantity accepts complete nonnegative integers", () => {
  assert.equal(parseQuantity(0), 0);
  assert.equal(parseQuantity("150"), 150);
  assert.equal(parseQuantity(" 150 "), 150);
});

test("parseQuantity rejects blanks and invalid quantities", () => {
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("-1"), null);
  assert.equal(parseQuantity("1.5"), null);
  assert.equal(parseQuantity("12 copies"), null);
  assert.equal(parseQuantity(Infinity), null);
  assert.equal(parseQuantity(NaN), null);
  assert.equal(parseQuantity(Number.MAX_SAFE_INTEGER + 1), null);
});

test("allocateQuantities gives address #1 the remainder", () => {
  const r = allocateQuantities(1000, [50, 150]);
  assert.equal(r.firstQty, 800);
  assert.equal(r.overAllocated, false);
});

test("allocateQuantities flags over-allocation without clamping", () => {
  const r = allocateQuantities(100, [60, 60]);
  assert.equal(r.firstQty, -20);
  assert.equal(r.overAllocated, true);
});

test("allocateQuantities recovers correctly after a removal", () => {
  // simulates: add #2 (qty 50), add #3 (qty 30), then remove #2
  const withBoth = allocateQuantities(1000, [50, 30]);
  assert.equal(withBoth.firstQty, 920);
  const afterRemove = allocateQuantities(1000, [30]);
  assert.equal(afterRemove.firstQty, 970);
});

test("allocateQuantities treats blanks as zero and flags malformed extras", () => {
  const r = allocateQuantities(500, ["", "abc", 100]);
  assert.equal(r.firstQty, 400);
  assert.equal(r.invalidQuantity, true);
  assert.equal(r.overAllocated, true);
});

test("allocateQuantities flags negative, fractional, and non-finite quantities", () => {
  for(const invalid of [-1, 1.5, Infinity, NaN]){
    const r = allocateQuantities(500, [invalid]);
    assert.equal(r.firstQty, 500);
    assert.equal(r.invalidQuantity, true);
    assert.equal(r.overAllocated, true);
  }
});

test("missingAddressFields lists only the blank required fields", () => {
  const missing = missingAddressFields({
    recipientName: "Acme Records", addressLine1: "1 Main St",
    city: "", postalCode: "62704", countryCode: "US",
    email: "a@b.com", phone: "+15551234567"
  });
  assert.deepEqual(missing, ["city"]);
});

test("missingAddressFields returns empty when everything is filled", () => {
  const addr = {};
  for (const k of ["recipientName","addressLine1","city","postalCode","countryCode","email"]) addr[k] = "x";
  assert.deepEqual(missingAddressFields(addr), []);
});

test("missingAddressFields doesn't flag optional fields (state, address lines 2/3, phone)", () => {
  const missing = missingAddressFields({
    recipientName: "Acme Records", addressLine1: "1 Main St",
    city: "Springfield", postalCode: "62704", countryCode: "US", email: "a@b.com"
    // stateProvince, addressLine2/3, attention, phone, vat, eori all omitted
  });
  assert.deepEqual(missing, []);
});

test("emailFormatValid accepts a normal address and rejects garbage", () => {
  assert.equal(emailFormatValid("a@b.com"), true);
  assert.equal(emailFormatValid("not-an-email"), false);
  assert.equal(emailFormatValid(""), false);
});

test("phoneFormatValid accepts E.164-ish numbers with punctuation stripped", () => {
  assert.equal(phoneFormatValid("+1 (555) 123-4567"), true);
  assert.equal(phoneFormatValid("+49 30 1234567"), true);
  assert.equal(phoneFormatValid("123"), false);
  assert.equal(phoneFormatValid(""), false);
});

test("vatIdFormatValid accepts generic EU-shaped IDs and rejects obvious junk", () => {
  assert.equal(vatIdFormatValid("DE123456789"), true);
  assert.equal(vatIdFormatValid("de 123456789"), true);
  assert.equal(vatIdFormatValid("12345"), false);
  assert.equal(vatIdFormatValid(""), false);
});

test("eoriFormatValid accepts generic country-prefixed IDs", () => {
  assert.equal(eoriFormatValid("DE123456789012345"), true);
  assert.equal(eoriFormatValid("12345"), false);
});
