import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFormat, enabledFormats, firstEnabledFormat,
  labelDataSizeMm, flatDataMm, partWeightG
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
// numbers, not just the arithmetic in isolation. Every part is fully
// self-contained (its own bleedMm), matching config.js's actual shape.
const printableParts12 = {
  label: { diameterMm: 100, bleedMm: 3 },
  outerCover: { trimMm: {w:633, h:318}, spineMm: 3, bleedMm: 5, paperGsm: 300 },
  innerSleeve: { trimMm: {w:608, h:309}, finalMm: {w:304, h:309}, bleedMm: 3, paperGsm: 135 },
  inlay: { trimMm: {w:297, h:297}, bleedMm: 3, paperGsm: 170 }
};

test("labelDataSizeMm adds the label's own bleed to the diameter", () => {
  assert.equal(labelDataSizeMm(printableParts12.label), 106);
});

test("flatDataMm uses a part's own bleedMm (outerCover, thicker than the others)", () => {
  assert.deepEqual(flatDataMm(printableParts12.outerCover), {w:643, h:328});
});

test("flatDataMm works the same way for inlay (a single flat sheet)", () => {
  assert.deepEqual(flatDataMm(printableParts12.inlay), {w:303, h:303});
});

test("flatDataMm works for inner sleeve too, now that its trimMm is the unfolded spread", () => {
  assert.deepEqual(flatDataMm(printableParts12.innerSleeve), {w:614, h:315});
});

test("partWeightG derives grams from trim area x paperGsm (outer cover)", () => {
  assert.equal(partWeightG(printableParts12.outerCover), 60.4);
});

test("partWeightG derives grams from trim area x paperGsm (inner sleeve, unfolded area)", () => {
  assert.equal(partWeightG(printableParts12.innerSleeve), 25.4);
});

test("partWeightG derives grams from trim area x paperGsm (inlay)", () => {
  assert.equal(partWeightG(printableParts12.inlay), 15);
});
