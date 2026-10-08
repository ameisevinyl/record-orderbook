import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNav, renderHome, renderInbox, renderBoard, renderArchive } from "../src/lib/plant-board.js";

const board = {stages: [
  {stage: "00_INBOX", jobs: [{job: "j1", catalogue: "X<1>", title: "T", artist: "A"}]},
  {stage: "10_ORDERS", jobs: [{job: "lost & #1", catalogue: "L", title: "", artist: ""}]},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [{job: "bad", error: "not valid JSON"}]},
  {stage: "10_ORDERS/20_PRESS", jobs: []},
  {stage: "20_DONE", jobs: []}
], inbox: ["new.zip", "Download"], problems: ["j is in more than one stage"]};

test("nav: stages nested under their grouping stage, counts, each job once, inbox items", () => {
  const html = renderNav(board, null);
  assert.ok(html.startsWith('<p><a href="#/board">Board</a></p><h2>Jobs</h2>'));
  assert.ok(html.includes("<li>ORDERS<ul><li>PREPRESS (1)"), "grouping stage is a heading, no count, no jobs");
  assert.ok(!html.includes("lost"), "a job put into a grouping stage isn't listed in the nav");
  assert.ok(html.includes("<li>INBOX (3)"));
  assert.ok(html.includes('<a href="#/inbox/new.zip">new.zip</a> (new zip)'));
  assert.ok(html.includes('<a href="#/inbox/Download">Download</a> (new folder)'));
  assert.equal(html.split("X&lt;1&gt;").length - 1, 1);
  assert.ok(html.includes('<a href="#/job/bad">bad (unreadable)</a>'));
  assert.ok(html.includes("<li>DONE (0)</li>"));
  assert.ok(!html.includes("Sections"));
});

test("nav: the open job is marked and its section links follow", () => {
  const html = renderNav(board, "j1");
  assert.ok(html.includes('<a href="#/job/j1" aria-current="page"><b>X&lt;1&gt; — T</b></a>'));
  assert.ok(html.includes('<h2>Sections</h2><ul><li><a href="#/job/j1/basic">Basic</a></li>'));
  assert.ok(html.includes('<a href="#/job/j1/shipping">Shipping &amp; billing</a>'));
});

test("home: problems, jobs in a grouping stage linked, the inbox count", () => {
  const html = renderHome(board);
  assert.ok(html.includes("<li>j is in more than one stage</li>"));
  assert.ok(html.includes('<a href="#/job/lost%20%26%20%231">lost &amp; #1</a> is in 10_ORDERS — move it to one of its sub-stages'));
  assert.ok(html.includes("2 new in the inbox."));
  assert.ok(!html.includes("X&lt;1&gt;"), "catalogue numbers are in the nav only");
  assert.ok(renderHome({stages: [], inbox: [], problems: []}).includes("Nothing needs attention."));
});

test("inbox: the item as a table row, a merge per matching job, then accept", () => {
  const html = renderInbox("r.zip", {job: "j2", project: {catalogue: "X", albumTitle: "T", albumArtist: "A"}, files: [{}, {}]},
    [{job: "j1", stage: "20_DONE", changed: ["Label A → X_labels_A_v3.pdf"]}]);
  assert.ok(html.includes("<tr><td>r.zip</td><td>X</td><td>T</td><td>A</td><td>2</td></tr>"));
  assert.ok(html.includes("<h2>Resend of j1 (DONE)</h2>"));
  assert.ok(html.includes("Label A → X_labels_A_v3.pdf"));
  assert.ok(html.includes('class="merge" data-job="j1"'));
  assert.ok(html.includes('id="accept"'));
});

test("board grid: a row per job, a column per line, the current step or ✓", () => {
  const rows = [{job: "K_x_261001-2006", catalogue: "K", title: "High <Riding>",
    states: {labels: {step: "size", done: false, waiting: false, checking: false}}},
    {job: "L_y_261001-2006", catalogue: "L", title: "", states: {labels: {step: null, done: true, waiting: false, checking: false}}}];
  const html = renderBoard(rows, ["labels"]);
  assert.ok(html.includes('<a href="#/job/K_x_261001-2006">K — High &lt;Riding&gt;</a>'));
  assert.ok(html.includes("<td>size</td>"));
  assert.ok(html.includes("<td>✓</td>"));
});

test("nav: a Board link first", () => {
  assert.ok(renderNav({stages: [], inbox: []}, null).startsWith('<p><a href="#/board">Board</a></p>'));
});

test("archive: the zips with size and date; nothing archived", () => {
  const html = renderArchive([{name: "K_x_261001-1000.zip", size: 3 * 1048576, modified: "2026-10-01T12:00:00Z"},
    {name: "a<b>.zip", size: 100, modified: "2026-09-01T08:30:00Z"}]);
  assert.ok(html.includes("<h2>Archive</h2>"));
  assert.ok(html.includes("<tr><td>K_x_261001-1000</td><td>3.0 MB</td><td>2026-10-01 12:00</td></tr>"));
  assert.ok(html.includes("<td>a&lt;b&gt;</td><td>1 KB</td>"));
  assert.ok(renderArchive([]).includes("Nothing archived."));
});
