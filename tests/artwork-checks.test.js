import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { artworkSlots, artworkRows, artworkVerdict, fixable, newerToCompare, geometryFixes } from "../src/lib/artwork-checks.js";

const printCheck = getFormat(CONFIG, "12").printCheck;
const printed = getFormat(CONFIG, "12").printableParts.outerCover.products.find(p => p.kind === "printed");

function project(over){
  return prepareProject({format:"12", ...over}, CONFIG);
}

test("artworkSlots: labels unless whitelabel, printed parts only, page and limits", () => {
  const slots = artworkSlots(project({
    labels:{sides:{A:{fileName:"L_A.pdf"}, B:{fileName:"L_B.pdf", page:2, whitelabel:true}}},
    coverSleeve:{cover:{productId: printed.id, fileName:"C.pdf"}}
  }), CONFIG);
  assert.deepEqual(slots.map(s => [s.title, s.name]), [["Label A", "L_A.pdf"], ["Cover", "C.pdf"]]);
  const label = getFormat(CONFIG, "12").printableParts.label;
  assert.deepEqual(slots[0].params, {
    part: "labels", round: true, page: 1, bleedMm: label.bleedMm,
    targetMm: {w: label.diameterMm + 2 * label.bleedMm, h: label.diameterMm + 2 * label.bleedMm},
    trimMm: {w: label.diameterMm, h: label.diameterMm},
    inkLimitPct: 220, black: printCheck.black, toleranceMm: printCheck.sizeToleranceMm,
    holeMm: getFormat(CONFIG, "12").centerHole.normal
  });
  assert.equal(slots[1].params.inkLimitPct, 300);
  assert.equal(slots[1].params.round, false);
});

const clean = {
  kind: "pdf",
  parsed: { pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: "ISO Coated v2 300% (ECI)", trimBoxMm: {w: 100, h: 100}, encrypted: false,
    hasUnembeddedFonts: false, pdfVersion: "1.4", pageCount: 1, effectiveDpi: null },
  ink: {maxPct: 180, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 95, innerInkPct: 97}
};
const params = { targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100}, bleedMm: 3, page: 1, inkLimitPct: 220 };

function row(facts, feature){
  return artworkRows(facts, params, printCheck).find(r => r.feature === feature);
}

test("artworkRows: clean file passes Ink, Black, Bleed", () => {
  assert.equal(row(clean, "Ink").severity, "info");
  assert.equal(row(clean, "Black").severity, "info");
  assert.equal(row(clean, "Bleed").severity, "info");
  assert.equal(artworkVerdict(artworkRows(clean, params, printCheck)), "ok");
});

test("artworkRows: ink over limit and rich black", () => {
  const ink = row({...clean, ink: {maxPct: 330, overPct: 12.5}}, "Ink");
  assert.deepEqual(ink, {feature: "Ink", severity: "warn", detected: "max 330 %, 12.5 % of the area over", expected: "≤ 220 %"});
  assert.equal(row({...clean, ink: {maxPct: 400, overPct: 0.4}}, "Ink").severity, "info");
  const black = row({...clean, black: {richPct: 3}}, "Black");
  assert.deepEqual(black, {feature: "Black", severity: "warn", detected: "rich black on 3.0 % of the area", expected: "100 % K"});
});

test("artworkRows: trimmed artwork and no bleed in the file", () => {
  assert.deepEqual(row({...clean, bleed: {outerInkPct: 1, innerInkPct: 90}}, "Bleed"),
    {feature: "Bleed", severity: "warn", detected: "empty — artwork looks trimmed", expected: "artwork into the 3 mm bleed"});
  assert.deepEqual(row({...clean, bleed: {outerInkPct: null, innerInkPct: 90}}, "Bleed"),
    {feature: "Bleed", severity: "warn", detected: "no bleed in the file", expected: "3 mm bleed"});
  // a light design with a white edge on purpose: little ink inside either
  assert.equal(row({...clean, bleed: {outerInkPct: 0, innerInkPct: 5}}, "Bleed").severity, "info");
});

test("artworkRows: errors and verdicts", () => {
  assert.deepEqual(artworkRows({error: "page 3 of 2"}, params, printCheck),
    [{feature: "File", severity: "error", detected: "page 3 of 2", expected: null}]);
  assert.equal(artworkVerdict([{severity: "info"}, {severity: "warn"}]), "review");
  assert.equal(artworkVerdict([{severity: "warn"}, {severity: "error"}]), "customer");
});

test("artworkRows: encrypted file without pixel facts", () => {
  const rows = artworkRows({kind: "pdf", parsed: {...clean.parsed, encrypted: true}}, params, printCheck);
  assert.equal(rows.find(r => r.feature === "Encryption").severity, "error");
  assert.ok(!rows.some(r => r.feature === "Ink"));
});

test("artworkSlots: a big center hole where the format has one", () => {
  const seven = getFormat(CONFIG, "7");
  const slots = artworkSlots(prepareProject({format:"7", labels:{bigCenter:true, sides:{A:{fileName:"L.pdf"}}}}, CONFIG), CONFIG);
  assert.equal(slots[0].params.holeMm, seven.centerHole.big || seven.centerHole.normal);
});

test("fixable: a label whose ink or black warns; never other parts", () => {
  const facts = ink => ({kind: "pdf", parsed: null, ink: {maxPct: ink, overPct: ink > 220 ? 5 : 0},
    black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}});
  const params = part => ({part, inkLimitPct: 220, bleedMm: 3});
  assert.equal(fixable(facts(330), params("labels"), printCheck), true);
  assert.equal(fixable(facts(200), params("labels"), printCheck), false);
  assert.equal(fixable(facts(330), params("outerCover"), printCheck), false);
  assert.equal(fixable({error: "x"}, params("labels"), printCheck), false);
});

test("newerToCompare: the newest newer version of each checked slot, same params", () => {
  const slots = [{name: "X_labels_A_v1.pdf", others: [{name: "X_labels_A_v3.pdf", newer: true},
    {name: "X_labels_A_v2.pdf", newer: true}]}, {name: "X_cover_v2.pdf", others: [{name: "X_cover_v1.pdf", newer: false}]}];
  const checkable = [{title: "Label A", name: "X_labels_A_v1.pdf", params: {part: "labels"}},
    {title: "Cover", name: "X_cover_v2.pdf", params: {part: "outerCover"}}];
  assert.deepEqual(newerToCompare(slots, checkable),
    [{title: "Label A — X_labels_A_v3.pdf", name: "X_labels_A_v3.pdf", params: {part: "labels", page: 1}, of: "X_labels_A_v1.pdf"}]);
});

const geo = (pageMm, over = {}) => ({kind: "pdf", parsed: {...clean.parsed, effectiveDpi: null, ...over.parsed},
  pageMm, ink: clean.ink, black: clean.black, bleed: {outerInkPct: 95, innerInkPct: 97, ...over.bleed}});
const rect = {...params, toleranceMm: 0.5};
const label7 = {targetMm: {w: 98, h: 98}, trimMm: {w: 92, h: 92}, bleedMm: 3, toleranceMm: 0.5, round: true};

test("geometryFixes: a 96 mm label for 92 + 3 — scale to fit or keep 1:1 and mirror", () => {
  const fixes = geometryFixes(geo({w: 96.012, h: 96.012}, {parsed: {effectiveDpi: {x: 300, y: 300}}}), label7);
  assert.deepEqual(fixes.map(f => [f.id, f.title, f.keep, f.fill, f.dpiAfter]), [
    ["fit", "Scale to fit · ×1.021", "file", null, 294],
    ["keep", "Keep 1:1 · mirror 1.0 mm", "file", "mirror", 300]]);
  assert.ok(Math.abs(fixes[0].scale - 98 / 96.012) < 1e-9);
  assert.equal(fixes[1].scale, 1);
});

test("geometryFixes: right size, empty bleed — rebuild or zoom", () => {
  const fixes = geometryFixes(geo({w: 106, h: 106}, {bleed: {outerInkPct: 1, innerInkPct: 90}}), rect);
  assert.deepEqual(fixes.map(f => [f.id, f.title, f.scale, f.keep, f.fill, f.dpiAfter]), [
    ["rebuild", "Trim + rebuild bleed · mirror 3.0 mm", 1, "trim", "mirror", null],
    ["zoom", "Zoom into bleed · ×1.060", 1.06, "file", null, null]]);
});

test("geometryFixes: smaller than the trim — only scale to fit", () => {
  assert.deepEqual(geometryFixes(geo({w: 90, h: 90}), rect).map(f => f.id), ["fit"]);
});

test("geometryFixes: other aspect — cover and crop centred", () => {
  const fixes = geometryFixes(geo({w: 212, h: 106}), rect);
  assert.deepEqual(fixes.map(f => f.title), ["Scale to fit · ×1.000 · crops 53.0 mm", "Keep 1:1 · crops 53.0 mm"]);
});

test("geometryFixes: a 72 dpi tag on print pixels — fit shows the real detail", () => {
  const fixes = geometryFixes(geo({w: 1158 / 72 * 25.4, h: 1158 / 72 * 25.4}, {parsed: {declaredDpi: {x: 72, y: 72}}}), label7);
  assert.deepEqual(fixes.map(f => [f.id, f.dpiAfter]), [["fit", 300], ["keep", 72]]);
});

test("geometryFixes: nothing for a passing, broken or unmeasured file", () => {
  assert.deepEqual(geometryFixes(geo({w: 106, h: 106}), rect), []);
  assert.deepEqual(geometryFixes({error: "can't read"}, rect), []);
  assert.deepEqual(geometryFixes({kind: "pdf", parsed: clean.parsed}, rect), []);
  assert.deepEqual(geometryFixes(undefined, rect), []);
});
