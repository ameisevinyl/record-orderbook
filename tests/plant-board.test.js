import { test } from "node:test";
import assert from "node:assert/strict";
import { renderAttention, renderJobBar, renderInbox, renderArchive } from "../src/lib/plant-board.js";

const board = {stages: [
  {stage: "00_INBOX", jobs: [{job: "j1", catalogue: "X<1>", title: "T", artist: "A"}]},
  {stage: "10_ORDERS", jobs: [{job: "lost & #1", catalogue: "L", title: "", artist: ""}]},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [{job: "bad", error: "not valid JSON"}]},
  {stage: "10_ORDERS/20_PRESS", jobs: []},
  {stage: "20_DONE", jobs: []}
], inbox: ["new.zip", "Download"], problems: ["j is in more than one stage"]};

test("attention: problems and jobs in a grouping stage linked; nothing to say gives nothing", () => {
  const html = renderAttention(board);
  assert.ok(html.includes("<li>j is in more than one stage</li>"));
  assert.ok(html.includes('<a href="#/job/lost%20%26%20%231">lost &amp; #1</a> is in 10_ORDERS — move it to one of its sub-stages'));
  assert.equal(renderAttention({stages: [], inbox: [], problems: []}), "");
  const unreadable = renderAttention({stages: [], inbox: [], problems: []}, [{job: "b & d", text: "not <valid> JSON"}]);
  assert.ok(unreadable.includes('<li><a href="#/job/b%20%26%20d">b &amp; d</a> can\'t be read: not &lt;valid&gt; JSON</li>'));
});

test("job bar: a jump link per section of the open job", () => {
  const html = renderJobBar("j1");
  assert.ok(html.startsWith('<p class="jump"><a href="#/job/j1/basic">Basic</a>'));
  assert.ok(html.includes('<a href="#/job/j1/shipping">Shipping &amp; billing</a>'));
  assert.ok(renderJobBar("a b").includes('href="#/job/a%20b/basic"'));
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

test("archive: the zips with size and date; nothing archived", () => {
  const html = renderArchive([{name: "K_x_261001-1000.zip", size: 3 * 1048576, modified: "2026-10-01T12:00:00Z"},
    {name: "a<b>.zip", size: 100, modified: "2026-09-01T08:30:00Z"}]);
  assert.ok(html.includes("<h2>Archive</h2>"));
  assert.ok(html.includes("<tr><td>K_x_261001-1000</td><td>3.0 MB</td><td>2026-10-01 12:00</td></tr>"));
  assert.ok(html.includes("<td>a&lt;b&gt;</td><td>1 KB</td>"));
  assert.ok(renderArchive([]).includes("Nothing archived."));
});
