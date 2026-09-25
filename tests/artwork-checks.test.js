import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { artworkSlots, artworkRows, artworkVerdict } from "../src/lib/artwork-checks.js";

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
