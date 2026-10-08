import { test } from "node:test";
import assert from "node:assert/strict";
import { vatCase, vatNote, VAT_CASES } from "../src/lib/vat-case.js";

// A plant in Germany (19 %), customers elsewhere.
const de = {plantCountry: "DE", plantRate: 19};
const pick = (billingCountry, vatId = "", vatIdStatus = "none") => {
  const {case: kind, rate, needsCheck} = vatCase({...de, billingCountry, vatId, vatIdStatus});
  return [kind, rate, needsCheck];
};

test("domestic: the plant's rate, whatever the VAT ID says", () => {
  assert.deepEqual(pick("DE"), ["domestic", 19, false]);
  assert.deepEqual(pick("DE", "DE123456789", "valid"), ["domestic", 19, false]);
});

test("another EU country: reverse charge only for a VAT ID that VIES found valid", () => {
  assert.deepEqual(pick("FR", "FR12345678901", "valid"), ["reverse-charge", 0, false]);
  assert.deepEqual(pick("AT", "ATU12345678", "valid"), ["reverse-charge", 0, false]);
  // The ID may belong to a third member state; it must not be the plant's own.
  assert.deepEqual(pick("AT", "NL123456789B01", "valid"), ["reverse-charge", 0, false]);
  assert.deepEqual(pick("AT", "DE123456789", "valid"), ["plus-vat", 19, true]);
  assert.deepEqual(pick("GR", "EL123456789", "valid"), ["reverse-charge", 0, false], "EL is Greece");
});

test("another EU country without a good VAT ID: plus VAT, and staff are told when there is something to look at", () => {
  assert.deepEqual(pick("FR"), ["plus-vat", 19, false], "private: no ID given");
  assert.deepEqual(pick("FR", "FR12345678901", "unchecked"), ["plus-vat", 19, true], "VIES unreachable: never reverse charge");
  assert.deepEqual(pick("FR", "FR12345678901", "invalid"), ["plus-vat", 19, true]);
  assert.deepEqual(pick("FR", "FR12345678901", undefined), ["plus-vat", 19, true]);
});

test("outside the EU: export, no VAT (also GB and CH)", () => {
  for(const country of ["US", "GB", "CH", "JP"]) assert.deepEqual(pick(country, "", "none"), ["export", 0, false], country);
  assert.deepEqual(pick("US", "US123", "invalid"), ["export", 0, false]);
});

test("no billing country yet: plus VAT, flagged; no rate known for the plant: flagged", () => {
  assert.deepEqual(pick(""), ["plus-vat", 19, true]);
  const unknownRate = vatCase({plantCountry: "DE", plantRate: null, billingCountry: "DE", vatId: "", vatIdStatus: "none"});
  assert.deepEqual([unknownRate.case, unknownRate.rate, unknownRate.needsCheck], ["domestic", null, true]);
});

test("a plant outside the EU, or none known: no VAT logic", () => {
  for(const plantCountry of ["JM", "US", "", undefined]){
    const result = vatCase({plantCountry, plantRate: null, billingCountry: "DE", vatId: "", vatIdStatus: "none"});
    assert.deepEqual([result.case, result.rate, result.needsCheck], ["none", null, false], String(plantCountry));
  }
});

test("the notes the quote carries", () => {
  assert.deepEqual(VAT_CASES, ["domestic", "plus-vat", "reverse-charge", "export", "none"]);
  assert.equal(vatNote("domestic", 19), "plus 19 % VAT");
  assert.equal(vatNote("plus-vat", 21), "plus 21 % VAT");
  assert.equal(vatNote("reverse-charge", 0), "no VAT — reverse charge, VAT due from the recipient");
  assert.equal(vatNote("export", 0), "no VAT — export outside the EU");
  assert.equal(vatNote("none", null), "VAT not applied");
});
