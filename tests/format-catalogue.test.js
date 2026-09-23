import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFormat, enabledFormats, firstEnabledFormat,
  labelDataSizeMm, flatDataMm, foldedDataMm
} from "../src/lib/format-catalogue.js";

const config = {
  formats: [
    { id: "12", label: '12" LP', enabled: true },
    { id: "10", label: '10" EP', enabled: false },
    { id: "7",  label: '7" SP',  enabled: true }
  ]
};

test("getFormat returns the format matching id", () => {
  assert.deepEqual(getFormat(config, "7"), { id: "7", label: '7" SP', enabled: true });
});

test("getFormat returns undefined for an unknown id", () => {
  assert.equal(getFormat(config, "9"), undefined);
});

test("enabledFormats filters to enabled:true, keeping array order", () => {
  const result = enabledFormats(config);
  assert.deepEqual(result.map(f => f.id), ["12", "7"]);
});

test("firstEnabledFormat returns the first enabled format's id", () => {
  assert.equal(firstEnabledFormat(config), "12");
});

test("firstEnabledFormat throws when no format is enabled", () => {
  const allDisabled = { formats: [{ id: "7", label: '7" SP', enabled: false }] };
  assert.throws(() => firstEnabledFormat(allDisabled), /at least one format must be enabled/);
});

// Real 12" printableParts (see config.js) — pins the actual production
// numbers, not just the arithmetic in isolation.
const printableParts12 = {
  bleedMm: 3,
  label: { diameterMm: 100 },
  outerCover: { trimMm: {w:633, h:318}, spineMm: 3, bleedMm: 5 },
  innerSleeve: { trimMm: {w:304, h:309} },
  inlay: { trimMm: {w:297, h:297} }
};

test("labelDataSizeMm adds symmetric default bleed to the diameter", () => {
  assert.equal(labelDataSizeMm(printableParts12), 106);
});

test("flatDataMm uses a part's own bleedMm override (outerCover)", () => {
  assert.deepEqual(flatDataMm(printableParts12.outerCover, printableParts12), {w:643, h:328});
});

test("flatDataMm falls back to printableParts.bleedMm when a part has no override (inlay)", () => {
  assert.deepEqual(flatDataMm(printableParts12.inlay, printableParts12), {w:303, h:303});
});

test("foldedDataMm doubles trim width (front+back opened flat) before adding bleed", () => {
  assert.deepEqual(foldedDataMm(printableParts12.innerSleeve, printableParts12), {w:614, h:315});
});
