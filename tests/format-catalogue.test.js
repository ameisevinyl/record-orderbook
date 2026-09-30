import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFormat, enabledFormats, firstEnabledFormat,
  labelDataSizeMm, flatDataMm, partWeightG,
  groupProductsByKind, productById, artworkSize, partSpecRows
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

const innerSleeveProducts12 = [
  { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135,
    color:"white", cutoutDiameterMm:85, default:true },
  { id:"sleeve-black-closed", name:"black, closed", kind:"unprinted",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:170,
    color:"black" },
  { id:"sleeve-printed", name:"printed", kind:"printed",
    trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135 }
];

test("groupProductsByKind splits printed and unprinted products", () => {
  const { printed, unprinted } = groupProductsByKind(innerSleeveProducts12);
  assert.deepEqual(printed.map(p=>p.id), ["sleeve-printed"]);
  assert.deepEqual(unprinted.map(p=>p.id), ["sleeve-white-cutout", "sleeve-black-closed"]);
});

test("groupProductsByKind returns an empty array for a kind with no products", () => {
  const { unprinted } = groupProductsByKind([innerSleeveProducts12[2]]);
  assert.deepEqual(unprinted, []);
});

test("productById finds a product by id", () => {
  assert.equal(productById(innerSleeveProducts12, "sleeve-black-closed").color, "black");
});

test("productById returns undefined for an unknown id", () => {
  assert.equal(productById(innerSleeveProducts12, "nope"), undefined);
});

test("productById returns undefined for a null id (the None selection)", () => {
  assert.equal(productById(innerSleeveProducts12, null), undefined);
});

const cover = { kind: "printed", trimMm: {w: 633, h: 318}, finalMm: {w: 315, h: 318}, spineMm: 3, bleedMm: 5, paperGsm: 300 };
const opts = { fileTypes: "PDF, TIFF", colorMode: "CMYK", debug: false };

test("artworkSize: labels are a bled square with a round trim", () => {
  const format = { printableParts: { label: { diameterMm: 100, bleedMm: 3 } } };
  assert.deepEqual(artworkSize(format, "labels"),
    { targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, round: true });
});

test("artworkSize: a printed flat part is trim plus bleed; unprinted or none has no artwork", () => {
  assert.deepEqual(artworkSize({}, "outerCover", cover),
    { targetMm: {w: 643, h: 328}, trimMm: {w: 633, h: 318}, bleedMm: 5, round: false });
  assert.equal(artworkSize({}, "innerSleeve", { kind: "unprinted", paperGsm: 135 }), null);
  assert.equal(artworkSize({}, "inlay", undefined), null);
});

test("partSpecRows: printed cover lists file, size and spine rows", () => {
  assert.deepEqual(partSpecRows(cover, opts), [
    ["Allowed filetypes", "PDF, TIFF"], ["Colour mode", "CMYK"],
    ["Final size", "315×318mm"], ["End format", "633×318mm"],
    ["Data format", "643×328mm"], ["Bleed", "5mm"], ["Spine", "3mm"], ["Paper weight", "300gsm"]
  ]);
});

test("partSpecRows: unprinted sleeve has no file rows, shows its cut-out", () => {
  const sleeve = { kind: "unprinted", finalMm: {w: 304, h: 309}, paperGsm: 135, cutoutDiameterMm: 85 };
  assert.deepEqual(partSpecRows(sleeve, opts),
    [["Final size", "304×309mm"], ["Paper weight", "135gsm"], ["Center cut-out", "⌀85mm"]]);
});

test("partSpecRows: inlay, shipping weight only in debug, none selected is empty", () => {
  const inlay = { kind: "printed", trimMm: {w: 297, h: 297}, bleedMm: 3, paperGsm: 170 };
  const rows = partSpecRows(inlay, { ...opts, debug: true });
  assert.deepEqual(rows.map(r => r[0]),
    ["Allowed filetypes", "Colour mode", "End format", "Data format", "Bleed", "Paper weight", "Shipping weight"]);
  assert.deepEqual(partSpecRows(undefined, opts), []);
});
