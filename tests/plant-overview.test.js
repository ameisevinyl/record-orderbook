import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { jobFiles } from "../src/lib/versions.js";
import { artworkSlots } from "../src/lib/artwork-checks.js";
import { getFormat } from "../src/lib/format-catalogue.js";
import { escapeHtml, stageLabel, gapSection, renderBasic, renderArtwork, renderAudio, renderShipping, renderHistory }
  from "../src/lib/plant-overview.js";

const project = prepareProject({
  projectVersion: 1, format: "12", catalogue: "PNKRCK007", albumTitle: "<b>Loud</b>", albumArtist: "Band",
  notes: "call first",
  sides: {A: {rpm: "33", tracks: [{title: "One", length: "3:00", fileName: "one_v1.wav"},
    {title: "Two", length: "2:00", fileName: "two_v1.wav"}]}, B: {blank: true}},
  labels: {sides: {A: {fileName: "lab_a_v1.pdf"}, B: {whitelabel: true}}},
  vinylColor: [{color: "black", qty: "300"}],
  shippingBilling: {billing: {recipientName: "Ann", email: "ann@example.com", city: "Berlin"},
    shipping: [{recipientName: "Bob", city: "Hamburg", qtyByColor: {black: "300"}}]},
  history: [{savedAt: "2026-09-24T12:00:00.000Z", by: "plant", note: "qty 300"}]
}, CONFIG);
const fileList = [{name: "one_v1.wav", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "two_v1.wav", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "lab_a_v1.pdf", size: 1, modified: "2026-09-24T10:00:00Z"},
  {name: "lab_a_v2.pdf", size: 1, modified: "2026-09-25T10:00:00Z"}];
const files = jobFiles(project, fileList);
const printCheck = getFormat(CONFIG, "12").printCheck;
const place = {job: "j1", stage: "10_ORDERS/10_PREPRESS", stages: ["00_INBOX", "10_ORDERS/10_PREPRESS", "20_DONE"]};

function wavFacts(duration, more = {}){
  return {codec: "pcm_s24le", sampleRate: 44100, bitsPerSample: 24, channels: 2, duration,
    software: ["WaveLab 11"], title: "", artist: "", comment: "", markers: [],
    preview: "one.mp3", waveform: "one.png", ...more};
}

function whole(facts = null){
  const checkable = artworkSlots(project, CONFIG);
  return renderBasic(project, CONFIG, place, [])
    + renderArtwork(files, checkable, null, printCheck, "/jobs/j1/", [])
    + renderAudio(project, files, facts, [], "/jobs/j1/", [])
    + renderShipping(project, []) + renderHistory(project);
}

// How often text shows on the page: tags and attributes don't count.
const count = (html, text) => html.replace(/<[^>]*>/g, " ").split(text).length - 1;

test("five sections in order, each an id'd section with its heading", () => {
  const html = whole();
  const order = ["basic", "artwork", "audio", "shipping", "history"].map(id => html.indexOf(`<section id="${id}">`));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("each fact once: catalogue number, file names", () => {
  const html = whole({files: {"one_v1.wav": wavFacts(180), "two_v1.wav": wavFacts(120)}});
  assert.equal(count(html, "PNKRCK007"), 1);
  for(const name of ["one_v1.wav", "two_v1.wav", "lab_a_v1.pdf", "lab_a_v2.pdf"]) assert.equal(count(html, name), 1, name);
  assert.ok(!html.includes("<dl"), "labels are table rows, not definition lists");
});

test("basic: field rows, quantity total, customer, products, stage controls, last change, notes", () => {
  const html = renderBasic(project, CONFIG, place, [{group: "Quantity", text: "below <min>"}, {group: "Billing", text: "x"}]);
  assert.ok(html.includes('<tr><th scope="row">Catalogue #</th><td>PNKRCK007</td></tr>'));
  assert.ok(html.includes("&lt;b&gt;Loud&lt;/b&gt;"));
  assert.ok(html.includes("300 Black — total 300"));
  assert.ok(html.includes("Ann, ann@example.com"));
  assert.ok(html.includes("labels: A printed, B whitelabel"));
  assert.ok(html.includes('<option value="10_ORDERS/10_PREPRESS" selected>ORDERS › PREPRESS</option>'));
  assert.ok(html.includes('id="move"') && html.includes('id="rescan"') && html.includes('href="/api/zip?job=j1"'));
  assert.ok(html.includes("2026-09-24 12:00 plant"));
  assert.ok(html.includes("<pre>call first</pre>"));
  assert.ok(html.includes("<li>Quantity: below &lt;min&gt;</li>"));
  assert.ok(!html.includes("Billing: x"), "a billing gap belongs to Shipping & billing");
});

test("gaps go to their section by group", () => {
  assert.deepEqual(["Release", "Quantity", "Side A", "Labels", "Inner sleeve", "Cover", "Inlay", "Billing", "Shipping 2"]
    .map(gapSection), ["basic", "basic", "audio", "artwork", "artwork", "artwork", "artwork", "shipping", "shipping"]);
});

test("artwork: a row per slot with file, versions and use, verdict while checking", () => {
  const html = renderArtwork(files, artworkSlots(project, CONFIG), null, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes('<th scope="col">Slot</th><th scope="col">File</th><th scope="col">Other versions</th><th scope="col">Verdict</th>'));
  assert.ok(html.includes("lab_a_v1.pdf (2026-09-24 10:00)"));
  assert.ok(html.includes('lab_a_v2.pdf (newer) <button type="button" class="use" data-file="lab_a_v2.pdf" data-slot="2">use</button>'));
  assert.ok(html.includes("<td>checking</td>"));
});

test("artwork: after the check, verdict and a preview block per checked slot", () => {
  const checkable = [{title: "Label A", name: "lab_a_v1.pdf", params: {targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100},
    bleedMm: 3, round: true, page: 1, inkLimitPct: 220, holeMm: 7.4}}];
  const facts = {"lab_a_v1.pdf": {kind: "pdf", parsed: {pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: null}, pageMm: {w: 106, h: 106}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: 330, overPct: 10}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: "lab <a>.png", overlay: "lab <a>.overlay.png"}};
  const html = renderArtwork(files, checkable, facts, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes("<td>review</td>"));
  assert.ok(html.includes('<div class="art-file"><h3>Label A</h3>'));
  assert.ok(html.includes('src="/jobs/j1/lab%20%3Ca%3E.png"'));
  assert.ok(html.includes('<circle class="trim" cx="53" cy="53" r="50"'));
  assert.ok(html.includes("max 330 %"));
});

test("not assigned: a select of the section's slots, or none when it has no slots", () => {
  const loose = {slots: files.slots, unassigned: {artwork: ["stray.tif"], audio: []}};
  const html = renderArtwork(loose, [], null, printCheck, "/jobs/j1/", []);
  assert.ok(html.includes('<option value="2">Label A</option>'));
  const none = renderArtwork({slots: [], unassigned: {artwork: ["stray.tif"], audio: []}}, [], null, printCheck, "/w/", []);
  assert.ok(none.includes("stray.tif") && none.includes("no slot to use it for") && !none.includes("<select"));
});

test("audio: side table, track table with files and spectrum links, a block per file", () => {
  const facts = {files: {"one_v1.wav": wavFacts(180, {title: "<One>"}), "two_v1.wav": {error: "Invalid data"}}};
  const html = renderAudio(project, files, facts, [{group: "Side A", text: "one is short"}], "/jobs/j1/", []);
  assert.ok(html.includes('<tr><th scope="row">RPM</th><td>33</td></tr>'));
  assert.ok(html.includes('<tr><th scope="row">Total</th><td>5:02</td></tr>'));
  assert.ok(html.includes("<li>Side A: one is short</li>"));
  assert.ok(html.includes('<a href="/jobs/j1/spectrum/one_v1.wav.png" target="_blank">spectrum</a>'));
  assert.ok(!html.includes("spectrum/two_v1.wav.png"), "no spectrum for a file that can't be read");
  assert.ok(html.includes('<div class="audio-file"><h3>A1</h3>'));
  assert.ok(html.includes("pcm_s24le, 44.1 kHz, 24 bit, 2 ch"));
  assert.ok(html.includes("&lt;One&gt;"));
  assert.ok(html.includes('data-src="/jobs/j1/one.mp3" data-duration="180"'));
  assert.ok(html.includes("<h3>Side B</h3><p>Blank</p>"));
});

test("audio: while checking, no file blocks yet; continuous side lists its side file", () => {
  const side = prepareProject({format: "12", sides: {A: {rpm: "33", continuous: true, continuousFileName: "side_v1.wav",
    tracks: [{title: "One", length: "1:00"}, {title: "Two", length: "1:00"}]}, B: {blank: true}}}, CONFIG);
  const sideFiles = jobFiles(side, [{name: "side_v1.wav", modified: "t"}]);
  let html = renderAudio(side, sideFiles, null, [], "/w/", []);
  assert.ok(!html.includes("audio-file"));
  assert.ok(html.includes('<th scope="row">Side file</th><td>side_v1.wav (t)'));
  html = renderAudio(side, sideFiles, {files: {"side_v1.wav": wavFacts(200, {markers: [{seconds: 50, label: "Two"}]})}}, [], "/w/", []);
  assert.ok(html.includes('class="mark file" style="left:25.000%"'));
  assert.ok(html.includes('class="mark form" style="left:30.000%" title="1:00 A2"'));
});

test("shipping & billing: the complete billing address, shipping with quantities", () => {
  const html = renderShipping(project, [{group: "Shipping 1", text: "postal code missing"}]);
  assert.ok(html.includes("<li>Shipping 1: postal code missing</li>"));
  assert.ok(html.includes('<tr><th scope="row">city</th><td>Berlin</td></tr>'));
  // Name and email also stand in Basic: here too, to copy the address whole.
  assert.ok(html.includes('<tr><th scope="row">name</th><td>Ann</td></tr>'));
  assert.ok(html.includes('<tr><th scope="row">email</th><td>ann@example.com</td></tr>'));
  assert.ok(html.includes("<h3>Shipping 1</h3>") && html.includes("Bob") && html.includes("300 Black"));
});

test("history: a table, oldest first", () => {
  assert.ok(renderHistory(project).includes('<tr><td>2026-09-24 12:00</td><td>plant</td><td>qty 300</td></tr>'));
});

test("helpers", () => {
  assert.equal(stageLabel("10_ORDERS/20_PRESS"), "ORDERS › PRESS");
  assert.equal(escapeHtml(`a&"'`), "a&amp;&quot;&#39;");
});
