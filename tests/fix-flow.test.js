import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { fixStep, slotFlow } from "../src/lib/fix-flow.js";

const printCheck = getFormat(CONFIG, "7").printCheck;
const profile = CONFIG.printProfiles.labels;
const params = {part: "labels", targetMm: {w: 98, h: 98}, trimMm: {w: 92, h: 92}, bleedMm: 3, round: true, page: 1,
  inkLimitPct: 220, black: printCheck.black, toleranceMm: 0.5, fixDpi: 1200, profile};
const f = (over = {}) => ({kind: "pdf", sha256: "s1", pageMm: {w: 98, h: 98}, ink: {maxPct: 200, overPct: 0},
  black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}, ...over,
  parsed: {pageSizeMm: {w: 98, h: 98}, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: profile.name, outputIntent: profile.name, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.3", pageCount: 1, effectiveDpi: {x: 300, y: 300}, ...over.parsed}});
const sized = (w, h, over = {}) => f({...over, pageMm: {w, h}, parsed: {pageSizeMm: {w, h}, ...over.parsed}});

test("fixStep: all pass → null; unreadable or encrypted → manual", () => {
  assert.equal(fixStep(f(), params, printCheck), null);
  assert.equal(fixStep(undefined, params, printCheck), null);
  assert.deepEqual(fixStep({error: "can't read"}, params, printCheck), {step: "pdf", manual: "can't read"});
  assert.match(fixStep({kind: "pdf", parsed: f().parsed}, params, printCheck).manual, /encrypted/);
});

test("fixStep size: within the bleed crop/mirror 1:1, beyond scale, right size rebuild, wrong ratio manual", () => {
  assert.deepEqual(fixStep(sized(96.012, 96.012), params, printCheck),
    {step: "size", fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: "mirror"},
      detail: "crop/add bleed 1:1, mirror 1.0 mm · detail 300 dpi"}});
  const big = fixStep(sized(408.5, 408.5, {parsed: {effectiveDpi: {x: 72, y: 72}}}), params, printCheck);
  assert.equal(big.fix.candidate.keep, "file");
  assert.equal(big.fix.detail, "scaled ×0.240 · detail 300 dpi");
  assert.deepEqual(fixStep(f({bleed: {outerInkPct: 1, innerInkPct: 90}}), params, printCheck).fix,
    {kind: "geometry", candidate: {scale: 1, keep: "trim", fill: "mirror"}, detail: "rebuilt the 3 mm bleed by mirroring"});
  assert.match(fixStep(sized(196, 98), params, printCheck).manual, /aspect ratio 196\.0×98\.0 mm vs 98×98 mm/);
});

test("fixStep order: size before pdf before colour; closed steps skipped", () => {
  const jpg = sized(96.012, 96.012, {kind: "jpeg", parsed: {pdfVersion: null, outputIntent: null}});
  assert.equal(fixStep(jpg, params, printCheck).step, "size");
  assert.deepEqual(fixStep(jpg, params, printCheck, ["size"]),
    {step: "pdf", fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: null}, detail: "rasterized at 1200 dpi, PDF 1.3"}});
  assert.equal(fixStep(jpg, params, printCheck, ["size", "pdf"]).step, "colour");
});

test("fixStep colour: only the profile → assign; ink, black or mode → colour fix", () => {
  assert.deepEqual(fixStep(f({parsed: {outputIntent: null}}), params, printCheck),
    {step: "colour", fix: {kind: "assign", detail: `assigned ${profile.name}, colours unchanged`}});
  assert.equal(fixStep(f({ink: {maxPct: 330, overPct: 10}}), params, printCheck).fix.kind, "colour");
  assert.equal(fixStep(f({parsed: {colorMode: "RGB"}}), params, printCheck).fix.kind, "colour");
});

test("slotFlow: pending proposal, dismissed step skipped, refused shown as manual, other content ignored", () => {
  const kmpn = sized(96.012, 96.012);
  const proposed = {step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v2.pdf", at: "t", result: "proposed", detail: "x"};
  assert.equal(slotFlow([proposed], "K_labels_A_v1.pdf", kmpn, params, printCheck, ["K_labels_A_v2.pdf"]).proposal, proposed);
  assert.equal(slotFlow([proposed], "K_labels_A_v1.pdf", kmpn, params, printCheck, []).proposal, null, "proposal file trashed by hand");
  const dismissed = [proposed, {...proposed, result: "dismissed"}];
  assert.equal(slotFlow(dismissed, "K_labels_A_v1.pdf", kmpn, params, printCheck, []).current, null, "size dismissed, pdf and colour pass");
  const refused = [{step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", at: "t", result: "refused", error: "boom"}];
  assert.deepEqual(slotFlow(refused, "K_labels_A_v1.pdf", kmpn, params, printCheck, []).current, {step: "size", manual: "fix refused — boom"});
  assert.equal(slotFlow([{...proposed, sha256: "other"}], "K_labels_A_v1.pdf", kmpn, params, printCheck, ["K_labels_A_v2.pdf"]).proposal, null);
});

test("slotFlow: two slots with the same content keep their own log", () => {
  const kmpn = f({pageMm: {w: 96.012, h: 96.012}, parsed: {pageSizeMm: {w: 96.012, h: 96.012}}});
  const forA = {step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v2.pdf", at: "t", result: "proposed", detail: "x"};
  assert.equal(slotFlow([forA], "K_labels_B_v1.pdf", kmpn, params, printCheck, ["K_labels_A_v2.pdf"]).proposal, null);
  assert.equal(slotFlow([{...forA, result: "dismissed"}], "K_labels_B_v1.pdf", kmpn, params, printCheck, []).current.step, "size");
});

test("slotFlow: a dismissed step stays closed after a later fix was accepted", () => {
  const trimmed = f({sha256: "s2", parsed: {outputIntent: null}, bleed: {outerInkPct: 1, innerInkPct: 90}});
  const log = [
    {step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v2.pdf", at: "t", result: "proposed", detail: "x"},
    {step: "size", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v2.pdf", at: "t", result: "dismissed"},
    {step: "colour", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v3.pdf", at: "t", result: "proposed", detail: "y"},
    {step: "colour", file: "K_labels_A_v1.pdf", sha256: "s1", to: "K_labels_A_v3.pdf", at: "t", result: "accepted"}];
  // v3 (sha s2) still has the empty bleed: size stays dismissed, colour (profile) comes next
  assert.equal(slotFlow(log, "K_labels_A_v3.pdf", trimmed, params, printCheck, []).current.step, "colour");
});
