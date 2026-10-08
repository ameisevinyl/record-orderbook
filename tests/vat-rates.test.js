import { test } from "node:test";
import assert from "node:assert/strict";
import { EU_COUNTRIES, vatIdCountry, standardVatRate } from "../src/lib/vat-rates.js";

test("the EU-27 by ISO code (Greece is GR); GB and CH are not in it, though they have rates", () => {
  assert.equal(EU_COUNTRIES.length, 27);
  assert.equal(new Set(EU_COUNTRIES).size, 27);
  assert.ok(EU_COUNTRIES.includes("GR") && !EU_COUNTRIES.includes("EL"));
  assert.ok(!EU_COUNTRIES.includes("GB") && !EU_COUNTRIES.includes("CH"));
  assert.ok(EU_COUNTRIES.every(code => standardVatRate(code) !== undefined), "every member has a standard rate");
});

test("the country a VAT ID belongs to: its prefix, EL read as GR", () => {
  assert.equal(vatIdCountry("DE 123456789"), "DE");
  assert.equal(vatIdCountry("el.123-456 789"), "GR");
  assert.equal(vatIdCountry("fr12345678901"), "FR");
  assert.equal(vatIdCountry("XI123456789"), "XI");
  for(const none of ["", "123456789", "D1", null, undefined]) assert.equal(vatIdCountry(none), null, String(none));
});
