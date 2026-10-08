import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { lineState, logEntry, lineNeeded, linesOfStage, stageReady } from "../src/lib/lines.js";

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

test("old fixer entries never complete a step", () => {
  const atColour = {"K_labels_A_v1.pdf": facts({parsed: {...facts().parsed, pageSizeMm: {w: 98, h: 98}}, pageMm: {w: 98, h: 98},
    bleed: {outerInkPct: 90, innerInkPct: 90}}), "K_labels_B_v1.pdf": good("b1")};
  assert.equal(lineState(job(), CONFIG, "labels", atColour).step, "colour");
  const tried = [{step: "colour", by: "fixer", at: "t", from: {"K_labels_A_v1.pdf": "a1"}, to: "K_labels_A_v2.pdf"}];
  assert.equal(lineState(job(tried), CONFIG, "labels", atColour).step, "colour");
});

test("whitelabel side left out; checking while there are no results; logEntry carries the files", () => {
  const white = job([], {A: {fileName: "K_labels_A_v1.pdf"}, B: {whitelabel: true}});
  assert.equal(lineState(white, CONFIG, "labels", {"K_labels_A_v1.pdf": good("a1")}).step, "approve");
  assert.equal(lineState(job(), CONFIG, "labels", null).checking, true);
  const e = logEntry(job(), CONFIG, "labels", both(), {step: "approve", by: "staff"});
  assert.deepEqual([e.step, e.by, e.files], ["approve", "staff", files]);
  assert.match(e.at, /^\d{4}-\d\d-\d\dT/);
});

test("review: an accept on a file without hash counts", () => {
  const missing = {"K_labels_A_v1.pdf": {error: "not in the job"}, "K_labels_B_v1.pdf": good("b1")};
  const e = logEntry(job(), CONFIG, "labels", missing, {step: "pdf", by: "staff"});
  assert.equal(e.files["K_labels_A_v1.pdf"], null);
  assert.notEqual(lineState(job([e]), CONFIG, "labels", missing).step, "pdf");
});

// An order: labels A/B printed by default; sleeve: the coverSleeve parts; log: project.plant.lines.
function order({labels, sleeve = {}, log = {}, proofs = {}} = {}){
  return prepareProject({projectVersion: 1, format: "7", catalogue: "K",
    labels: {sides: labels || {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}},
    coverSleeve: sleeve, proofs, plant: {lines: log}}, CONFIG);
}
const white = {A: {whitelabel: true}, B: {whitelabel: true}};
const hand = (step, extra = {}) => ({step, by: "staff", at: "t", files: {}, ...extra});

test("a line is needed only for what the order has printed", () => {
  const plain = order({labels: white, sleeve: {innerSleeve: {productId: "sleeve-white-cutout"}}});
  assert.deepEqual(["labels", "innerSleeve", "outerCover", "inlay", "press", "pack", "ship"]
    .map(n => lineNeeded(plain, CONFIG, n)), [false, false, false, false, true, true, true]);
  const printed = order({sleeve: {innerSleeve: {productId: "sleeve-printed"}, cover: {productId: "cover-printed"},
    inlay: {productId: "inlay-printed"}}});
  assert.deepEqual(["labels", "innerSleeve", "outerCover", "inlay"].map(n => lineNeeded(printed, CONFIG, n)),
    [true, true, true, true]);
  const one = order({labels: {A: {whitelabel: true}, B: {fileName: "K_labels_B_v1.pdf"}}});
  assert.equal(lineNeeded(one, CONFIG, "labels"), true, "one printed side is enough");
  const s = lineState(plain, CONFIG, "labels", {});
  assert.deepEqual([s.needed, s.done, s.ready, s.waiting, s.checking, s.step], [false, true, true, false, false, null]);
});

test("a printed part that is ordered but not uploaded stands at size, not at approve", () => {
  const p = order({sleeve: {cover: {productId: "cover-printed"}}});
  const s = lineState(p, CONFIG, "outerCover", {});
  assert.deepEqual([s.needed, s.step], [true, "size"]);
  assert.match(s.why, /no file uploaded yet/);
});

test("hand-confirmed lines need no check results and wait for the lines they come after", () => {
  // Whitelabel, no printed sleeves: nothing to wait for but the log.
  const plain = order({labels: white});
  const mastering = lineState(plain, CONFIG, "mastering", null);
  assert.deepEqual([mastering.checking, mastering.waiting, mastering.step], [false, false, "approve"]);
  assert.equal(lineState(plain, CONFIG, "plating", null).waiting, true, "plating waits for mastering");
  assert.equal(lineState(plain, CONFIG, "press", null).waiting, true, "press waits for plating");
  const invoice = lineState(plain, CONFIG, "invoice", null);
  assert.deepEqual([invoice.waiting, invoice.step], [false, "back:invoiced"], "the invoice is open from the start");
  const stampers = {mastering: [hand("approve"), hand("back:cut")],
    plating: [hand("send:plater", {to: "external"}), hand("back:stampers")]};
  const press = lineState(order({labels: white, log: stampers}), CONFIG, "press", null);
  assert.deepEqual([press.waiting, press.step], [false, "approve"]);
  const pressed = order({labels: white, log: {...stampers, press: [hand("approve"), hand("back:pressed")]}});
  assert.equal(lineState(pressed, CONFIG, "press", null).done, true);
  const pack = lineState(pressed, CONFIG, "pack", null);
  assert.deepEqual([pack.waiting, pack.step], [false, "back:packed"]);
  // Printed labels not checked yet: press waits for them as well.
  const waiting = lineState(order({log: stampers}), CONFIG, "press", null);
  assert.deepEqual([waiting.checking, waiting.waiting], [false, true]);
});

test("lines of a stage, and when they are all ready to move on", () => {
  assert.deepEqual(linesOfStage(CONFIG, "10_ORDERS/10_PREPRESS"), ["mastering", "plating", "labels", "innerSleeve", "outerCover", "inlay"]);
  assert.deepEqual(linesOfStage(CONFIG, "10_ORDERS/20_PRESS"), ["testpress", "press", "pack", "invoice", "ship"]);
  assert.deepEqual(linesOfStage(CONFIG, "20_DONE"), []);
  const ready = {ready: true}, notReady = {ready: false};
  assert.equal(stageReady(CONFIG, "10_ORDERS/10_PREPRESS", [{line: "labels", ...ready}, {line: "press", ...notReady}]), true,
    "a line of another stage doesn't count");
  assert.equal(stageReady(CONFIG, "10_ORDERS/10_PREPRESS", [{line: "labels", ...notReady}]), false);
  assert.equal(stageReady(CONFIG, "20_DONE", [{line: "labels", ...ready}]), false, "no lines in the stage, no hint");
});

test("a printed part with a slot still empty stops the line at size, with and without results", () => {
  const half = order({labels: {A: {fileName: "K_labels_A_v1.pdf"}, B: {}}});
  const s = lineState(half, CONFIG, "labels", {"K_labels_A_v1.pdf": good("a1")});
  assert.deepEqual([s.step, s.why], ["size", "Label B: no file uploaded yet"]);
  const inlay = order({sleeve: {inlay: {productId: "inlay-printed", front: {fileName: "K_inlay_front_v1.pdf"}}}});
  assert.equal(lineState(inlay, CONFIG, "inlay", {}).why, "Inlay back: no file uploaded yet");
  // Nothing uploaded at all needs no check results to say so.
  const none = lineState(order({sleeve: {cover: {productId: "cover-printed"}}}), CONFIG, "outerCover", null);
  assert.deepEqual([none.checking, none.step, none.why], [false, "size", "Cover: no file uploaded yet"]);
  // Files there but unchecked: still waiting for the check.
  assert.equal(lineState(order(), CONFIG, "labels", null).checking, true);
});

test("the testpress line is on the order only when testpresses were ordered, and the press waits for it", () => {
  const stampers = {mastering: [hand("approve"), hand("back:cut")], plating: [hand("send:plater", {to: "external"}), hand("back:stampers")]};
  const none = order({labels: white, log: stampers});
  assert.equal(lineNeeded(none, CONFIG, "testpress"), false);
  assert.equal(lineState(none, CONFIG, "press", null).waiting, false);
  const asked = order({labels: white, log: stampers, proofs: {testpresses: 3}});
  const tp = lineState(asked, CONFIG, "testpress", null);
  assert.deepEqual([tp.needed, tp.waiting, tp.step], [true, false, "back:pressed"]);
  assert.equal(lineState(asked, CONFIG, "press", null).waiting, true, "press waits for the testpresses");
  assert.equal(lineState(order({labels: white, proofs: {testpresses: 3}}), CONFIG, "testpress", null).waiting, true, "testpresses need the stampers");
  const approved = order({labels: white, proofs: {testpresses: 3},
    log: {...stampers, testpress: [hand("back:pressed"), hand("approve")]}});
  assert.equal(lineState(approved, CONFIG, "press", null).waiting, false);
});
