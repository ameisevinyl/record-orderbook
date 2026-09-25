import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { renderOverview, renderGaps, renderHeader, renderAudio, renderArtwork, escapeHtml } from "../src/lib/plant-overview.js";
import { getFormat } from "../src/lib/format-catalogue.js";

const project = prepareProject({
  projectVersion:1, format:"12", catalogue:"PNKRCK007", albumTitle:"<b>Loud</b>", albumArtist:"Band",
  sides:{A:{rpm:"33", tracks:[{title:"One", length:"3:00", fileName:"A1.wav"}, {title:"Two", length:"2:00", fileName:"A2.wav"}]}, B:{blank:true}},
  vinylColor:[{color:"black", qty:"300"}],
  history:[{savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300"}]
}, CONFIG);

test("overview shows values in form order, escaped", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("PNKRCK007"));
  assert.ok(html.includes("&lt;b&gt;Loud&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Loud"));
  const order = ["Release", "Side A", "Side B", "Labels", "Inner sleeve", "Cover", "Inlay", "Vinyl colour", "Billing", "Shipping", "History"]
    .map(h => html.indexOf(`<h2>${h}`));
  assert.ok(order.every(i => i >= 0), "every group present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("files show size or are marked missing; side total shown", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("A1.wav (50.0 MB)"));
  assert.match(html, /A2\.wav <span class="missing">missing<\/span>/);
  assert.ok(html.includes("Total 5:02 — 33 rpm</p>"), "normal cut goes unnamed");
  const loud = prepareProject({format:"12", soundsystem:true, sides:{A:{rpm:"33"}}}, CONFIG);
  assert.ok(renderOverview(loud, CONFIG, []).includes("Total 0:00 — 33 rpm, soundsystem cut</p>"));
  assert.ok(renderOverview(loud, CONFIG, []).includes("<dt>Cut</dt><dd>soundsystem</dd>"));
  assert.ok(!html.includes("<dt>Cut</dt>"), "no Cut row for a normal cut");
  assert.ok(!html.includes("recommended"), "limits are specs, not part of the order");
  assert.ok(html.includes("Blank"));
});

test("an older, minimal project renders without throwing", () => {
  const minimal = prepareProject({format:"7"}, CONFIG);
  assert.ok(renderOverview(minimal, CONFIG, []).includes("<h2>Release"));
});

test("gaps list and header", () => {
  assert.equal(renderGaps([]), '<p class="complete">Complete — ready for checks</p>');
  assert.equal(renderGaps([{group:"Release", text:"no <x>"}]),
    '<ul class="gaps"><li><b>Release</b> no &lt;x&gt;</li></ul>');
  assert.ok(renderHeader("260924_X.zip", project).includes("260924_X.zip"));
  assert.equal(escapeHtml(`a&"'`), "a&amp;&quot;&#39;");
});

function wavFacts(duration, more = {}){
  return {codec:"pcm_s24le", sampleRate:44100, bitsPerSample:24, channels:2, duration,
    software:["WaveLab 11"], title:"", artist:"", comment:"", markers:[],
    preview:"A1 x.wav.mp3", waveform:"A1 x.wav.png", ...more};
}

test("audio: facts, findings and a waveform per file", () => {
  const facts = {files:{"A1.wav": wavFacts(180, {title:"<One>"}), "A2.wav": {error:"Invalid data"}}};
  const html = renderAudio(project, facts, [{group:"Side A", text:"A1.wav is 3:02"}], "/work/p.checks/");
  assert.ok(html.startsWith("<section><h2>Audio"));
  assert.ok(html.includes("<b>Side A</b> A1.wav is 3:02"));
  assert.ok(html.includes("pcm_s24le, 44.1 kHz, 24 bit, 2 ch"));
  assert.ok(html.includes("<dd>WaveLab 11</dd>"));
  assert.ok(html.includes("&lt;One&gt;"));
  assert.ok(html.includes('data-src="/work/p.checks/A1%20x.wav.mp3" data-duration="180"'));
  assert.ok(html.includes('<img src="/work/p.checks/A1%20x.wav.png"'));
  assert.match(html, /<b>A2<\/b>.*Invalid data/);
});

test("audio: continuous side shows file markers and the form's track starts", () => {
  // gap "2" is ignored: a continuous side's pauses are in the file
  const side = prepareProject({format:"12", sides:{A:{rpm:"33", continuous:true, continuousFileName:"A.wav",
    tracks:[{title:"One", length:"1:00"}, {title:"Two", length:"1:00", gap:"2"}]}, B:{blank:true}}}, CONFIG);
  const facts = {files:{"A.wav": wavFacts(200, {markers:[{seconds:50, label:"Two"}]})}};
  const html = renderAudio(side, facts, [], "/work/p.checks/");
  assert.ok(html.includes("No audio findings"));
  assert.ok(html.includes("<b>Side file</b>"));
  assert.ok(html.includes('class="mark file" style="left:25.000%"'));
  assert.ok(html.includes('class="mark form" style="left:30.000%" title="1:00 A2"'));
});

test("audio: form track starts stop at the first empty length", () => {
  const side = prepareProject({format:"12", sides:{A:{rpm:"33", continuous:true, continuousFileName:"A.wav",
    tracks:[{title:"One", length:"1:00"}, {title:"Two", length:""}, {title:"Three", length:"1:00"}]}, B:{blank:true}}}, CONFIG);
  const html = renderAudio(side, {files:{"A.wav": wavFacts(200)}}, [], "/w/");
  assert.ok(html.includes('title="1:00 A2"'));
  assert.ok(!html.includes("A3"));
});


test("artwork files show their page when it isn't 1", () => {
  const p = prepareProject({format:"12", labels:{sides:{A:{fileName:"L.pdf"}, B:{fileName:"L2.pdf", page:2}}}}, CONFIG);
  const html = renderOverview(p, CONFIG, [{name:"L.pdf", size:1024}, {name:"L2.pdf", size:1024}]);
  assert.ok(html.includes("L2.pdf (1 KB), page 2"));
  assert.ok(!html.includes("L.pdf (1 KB), page"));
});

test("artwork: verdict, preview with trim/bleed lines, overlay, rows", () => {
  const slots = [{title: "Label A", name: "L <A>.pdf", params: {targetMm: {w: 106, h: 106}, trimMm: {w: 100, h: 100},
    bleedMm: 3, round: true, page: 1, inkLimitPct: 220, holeMm: 7.4}}];
  const facts = {"L <A>.pdf": {kind: "pdf", parsed: {pageSizeMm: {w: 106, h: 106}, imagePx: null, declaredDpi: null,
    colorMode: "CMYK", spotColors: [], iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false,
    pdfVersion: "1.4", pageCount: 1, effectiveDpi: null}, pageMm: {w: 106, h: 106}, trimRectMm: {x: 3, y: 3, w: 100, h: 100},
    ink: {maxPct: 330, overPct: 10}, black: {richPct: 0}, bleed: {outerInkPct: 90, innerInkPct: 90},
    preview: "L <A>.pdf.png", overlay: "L <A>.pdf.overlay.png"}};
  const html = renderArtwork(slots, facts, getFormat(CONFIG, "12").printCheck, "/work/p.checks/");
  assert.ok(html.startsWith("<section><h2>Artwork"));
  assert.ok(html.includes("L &lt;A&gt;.pdf"));
  assert.ok(html.includes('class="verdict review">review'));
  assert.ok(html.includes('src="/work/p.checks/L%20%3CA%3E.pdf.png"'));
  assert.ok(html.includes('viewBox="0 0 106 106"'));
  assert.ok(html.includes('<circle class="trim" cx="53" cy="53" r="50"'));
  assert.ok(html.includes('<circle class="bleed" cx="53" cy="53" r="53"'));
  assert.ok(html.includes('<circle class="hole" cx="53" cy="53" r="3.7"'));
  // every line lies on a white line at the same place, so its gaps show white
  assert.ok(html.includes('<circle class="under" cx="53" cy="53" r="50"/><circle class="trim" cx="53" cy="53" r="50"/>'));
  assert.ok(html.includes('<circle class="under" cx="53" cy="53" r="3.7"/><circle class="hole"'));
  assert.ok(html.includes("max 330 %"));
});

test("artwork: nothing to show without slots", () => {
  const printCheck = getFormat(CONFIG, "12").printCheck;
  assert.equal(renderArtwork([], {}, printCheck, "/w/"), "");
});
