import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { lineCell, viewLines, viewFromHash, dashboardRows, renderDashboard } from "../src/lib/dashboard.js";

const printed = {projectVersion: 1, format: "7", catalogue: "K",
  labels: {sides: {A: {fileName: "K_labels_A_v1.pdf"}, B: {fileName: "K_labels_B_v1.pdf"}}}};
const white = {projectVersion: 1, format: "7", catalogue: "W", labels: {sides: {A: {whitelabel: true}, B: {whitelabel: true}}}};
const board = {stages: [
  {stage: "00_INBOX", jobs: [{job: "K_x_261001-1000", catalogue: "K", title: "High <Riding>", project: printed, artwork: {}}]},
  {stage: "10_ORDERS", jobs: []},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [
    {job: "bad", error: "project.json is not valid JSON"},
    {job: "Z", catalogue: "Z", title: "", project: {projectVersion: 1, format: "99", catalogue: "Z"}, artwork: {}}]},
  {stage: "10_ORDERS/20_PRESS", jobs: [{job: "W_y_261001-1000", catalogue: "W", title: "", project: white, artwork: {}}]},
  {stage: "20_DONE", jobs: []},
  {stage: "99_ARCHIVE", jobs: []}
]};
const views = Object.keys(CONFIG.dashboardViews);

test("cells: plain words, empty when the order doesn't have the line, the alarm only for a stopped check", () => {
  const base = {needed: true, done: false, waiting: false, checking: false, step: "size", why: ""};
  assert.deepEqual(lineCell({...base, needed: false}), {text: "", cls: "", title: ""});
  assert.deepEqual(lineCell(undefined), {text: "", cls: "", title: ""});
  assert.deepEqual(lineCell({...base, done: true}), {text: "✓", cls: "done", title: ""});
  assert.deepEqual(lineCell({...base, waiting: true}), {text: "waiting", cls: "wait", title: ""});
  assert.deepEqual(lineCell({...base, checking: true}), {text: "not checked", cls: "wait", title: ""});
  assert.deepEqual(lineCell({...base, why: "Label A: 96×96mm, expected 98×98mm"}),
    {text: "size", cls: "stop", title: "Label A: 96×96mm, expected 98×98mm"});
  assert.deepEqual(lineCell({...base, step: "approve"}), {text: "approve", cls: "", title: ""});
});

test("view lines: a known preset, else every line; the hash picks the preset", () => {
  assert.deepEqual(viewLines(CONFIG, "printed"), ["labels", "innerSleeve", "outerCover", "inlay"]);
  assert.deepEqual(viewLines(CONFIG, "pressing"), ["press", "pack", "ship"]);
  for(const unknown of ["", "nope", "constructor"]) assert.deepEqual(viewLines(CONFIG, unknown), Object.keys(CONFIG.lines));
  assert.equal(viewFromHash("#/view/printed", views), "printed");
  for(const hash of ["#/", "#/board", "#/view/nope", "#/view/", "#/job/printed", ""]) assert.equal(viewFromHash(hash, views), "", hash);
});

test("rows: per stage that can hold jobs, not the grouping stage or the archive; errors as rows", () => {
  const groups = dashboardRows(board, CONFIG);
  assert.deepEqual(groups.map(g => g.stage), ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS", "20_DONE"]);
  const [k] = groups[0].rows;
  assert.equal(k.name, "K — High <Riding>");
  // Printed labels nobody checked yet; press, pack and ship wait behind them.
  assert.equal(k.cells.labels.text, "not checked");
  assert.equal(k.cells.innerSleeve.text, "", "no printed sleeve ordered");
  assert.deepEqual(["press", "pack", "ship"].map(n => k.cells[n].text), ["waiting", "waiting", "waiting"]);
  // Whitelabel: no labels line, the press is next.
  const [w] = groups[2].rows;
  assert.deepEqual([w.cells.labels.text, w.cells.press.text, w.cells.pack.text], ["", "approve", "waiting"]);
  const [bad, z] = groups[1].rows;
  assert.deepEqual([bad.error, bad.cells], ["project.json is not valid JSON", {}]);
  assert.match(z.error, /Unknown format ID "99"/);
});

test("render: a table per the chosen columns, stage rows with counts, empty stages left out, everything escaped", () => {
  const groups = dashboardRows(board, CONFIG);
  const all = renderDashboard(groups, viewLines(CONFIG, ""), "", views);
  assert.ok(all.includes('<a href="#/job/K_x_261001-1000">K — High &lt;Riding&gt;</a>'));
  assert.ok(all.includes("INBOX (1)") && all.includes("ORDERS › PREPRESS (2)") && all.includes("ORDERS › PRESS (1)"));
  assert.ok(!all.includes("DONE"), "an empty stage isn't listed");
  assert.ok(all.includes('<td class="wait">not checked</td>'));
  assert.ok(all.includes('<td colspan="7" class="stop">project.json is not valid JSON</td>'));
  assert.ok(all.includes("<b>all</b>") && all.includes('<a href="#/view/printed">printed</a>'));
  for(const line of Object.keys(CONFIG.lines)) assert.ok(all.includes(`<th scope="col">${line}</th>`), line);

  const some = renderDashboard(groups, viewLines(CONFIG, "printed"), "printed", views);
  assert.ok(some.includes("<b>printed</b>") && some.includes('<a href="#/">all</a>'));
  assert.ok(!some.includes('<th scope="col">press</th>'));
  assert.ok(some.includes('<td colspan="4" class="stop">'));
  assert.ok(renderDashboard([{stage: "20_DONE", rows: []}], ["labels"], "", views).includes("No orders."));
});
