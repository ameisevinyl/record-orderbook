import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { lineState, logEntry, fixerTargets } from "../src/lib/lines.js";

function job(log = [], labels = {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}){
  return prepareProject({projectVersion: 1, format: "7", catalogue: "K", labels: {sides: labels},
    plant: {lines: {labels: log}}}, CONFIG);
}
// KMPN012 as checked: 96 mm, no bleed, 316 % ink, rich black.
function facts(over = {}){
  return {kind: "pdf", sha256: "a1", parsed: {pageSizeMm: {w: 96, h: 96}, imagePx: null, declaredDpi: null, colorMode: "CMYK",
    spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4",
    pageCount: 1, effectiveDpi: null}, pageMm: {w: 96, h: 96}, trimRectMm: {x: 2, y: 2, w: 92, h: 92},
    ink: {maxPct: 316, overPct: 5}, black: {richPct: 3.6}, bleed: {outerInkPct: null, innerInkPct: 100}, ...over};
}
const good = sha => facts({sha256: sha, parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}, pageMm: {w: 98, h: 98},
  trimRectMm: {x: 3, y: 3, w: 92, h: 92}, ink: {maxPct: 200, overPct: 0}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90}});
const kmpn = () => ({"K_labels_A_v1.pdf": facts(), "K_labels_B_v1.pdf": facts({sha256: "b1"})});
const both = () => ({"K_labels_A_v1.pdf": good("a1"), "K_labels_B_v1.pdf": good("b1")});
const files = {"K_labels_A_v1.pdf": "a1", "K_labels_B_v1.pdf": "b1"};

test("KMPN012: the labels line stands at size, with why", () => {
  const s = lineState(job(), CONFIG, "labels", kmpn());
  assert.equal(s.step, "size");
  assert.match(s.why, /96\.0×96\.0mm, expected 98×98mm/);
  assert.deepEqual(s.steps.slice(0, 2).map(x => x.state), ["current", "ahead"]);
  assert.equal(s.ready, false);
});

test("check steps pass live; then approve, send, back by log; ready before send, done at the end", () => {
  assert.equal(lineState(job(), CONFIG, "labels", both()).step, "approve");
  const log = [{step: "approve", by: "customer", at: "t", files}];
  const s = lineState(job(log), CONFIG, "labels", both());
  assert.deepEqual([s.step, s.ready], ["send:printer", true]);
  const sent = [...log, {step: "send:printer", by: "staff", at: "t", to: "external", files}, {step: "back:printed", by: "staff", at: "t", files}];
  assert.deepEqual([lineState(job(sent), CONFIG, "labels", both()).done, lineState(job(sent), CONFIG, "labels", both()).step], [true, null]);
});

test("accept by hand passes a failing check until the file changes; a changed file rewinds the line", () => {
  const accepted = [{step: "size", by: "staff", at: "t", note: "ok", files: {"K_labels_A_v1.pdf": "a1", "K_labels_B_v1.pdf": "b1"}}];
  assert.equal(lineState(job(accepted), CONFIG, "labels", kmpn()).step, "bleed"); // size accepted, resolution/pdf pass
  const changed = {...kmpn(), "K_labels_A_v1.pdf": facts({sha256: "a2"})};
  assert.equal(lineState(job(accepted), CONFIG, "labels", changed).step, "size");
  const sent = [{step: "approve", by: "staff", at: "t", files}, {step: "send:printer", by: "staff", at: "t", to: "x", files}];
  assert.equal(lineState(job(sent), CONFIG, "labels", {...both(), "K_labels_B_v1.pdf": good("b9")}).step, "approve");
});

test("fixer entries never complete a step; fixerTargets skips tried sources and fixer outputs", () => {
  const atColour = {"K_labels_A_v1.pdf": facts({parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}, pageMm: {w: 98, h: 98},
    bleed: {outerInkPct: 90, innerInkPct: 90}}), "K_labels_B_v1.pdf": good("b1")};
  assert.equal(lineState(job(), CONFIG, "labels", atColour).step, "colour");
  assert.deepEqual(fixerTargets(job(), CONFIG, "labels", atColour), ["K_labels_A_v1.pdf"]);
  const tried = [{step: "colour", by: "fixer", at: "t", from: {"K_labels_A_v1.pdf": "a1"}, to: "K_labels_A_v2.pdf"}];
  assert.equal(lineState(job(tried), CONFIG, "labels", atColour).step, "colour");
  assert.deepEqual(fixerTargets(job(tried), CONFIG, "labels", atColour), []);
  const onOutput = job(tried, {A: {fileName: "K_labels_A_v2.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}});
  assert.deepEqual(fixerTargets(onOutput, CONFIG, "labels", {"K_labels_A_v2.pdf": atColour["K_labels_A_v1.pdf"], "K_labels_B_v1.pdf": good("b1")}), []);
  assert.deepEqual(fixerTargets(job(), CONFIG, "labels", kmpn()), [], "not at colour yet");
});

test("whitelabel side left out; checking while there are no results; logEntry carries the files", () => {
  const white = job([], {A: {fileName: "K_labels_A_v1.pdf"}, B: {whitelabel: true}});
  assert.equal(lineState(white, CONFIG, "labels", {"K_labels_A_v1.pdf": good("a1")}).step, "approve");
  assert.equal(lineState(job(), CONFIG, "labels", null).checking, true);
  const e = logEntry(job(), CONFIG, "labels", both(), {step: "approve", by: "staff"});
  assert.deepEqual([e.step, e.by, e.files], ["approve", "staff", files]);
  assert.match(e.at, /^\d{4}-\d\d-\d\dT/);
});
