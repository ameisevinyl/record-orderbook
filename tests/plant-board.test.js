import { test } from "node:test";
import assert from "node:assert/strict";
import { stageLabel, renderBoard, renderJobBar, renderFiles, renderInbox } from "../src/lib/plant-board.js";

test("stageLabel drops the sort numbers", () => {
  assert.equal(stageLabel("10_ORDERS/20_PRESS"), "ORDERS › PRESS");
});

test("board: a column per stage, empty parent hidden, inbox zips first, escaped", () => {
  const html = renderBoard({stages: [
    {stage: "00_INBOX", jobs: [{job: "j1", catalogue: "X<1>", title: "T", artist: "A"}]},
    {stage: "10_ORDERS", jobs: []},
    {stage: "10_ORDERS/10_PREPRESS", jobs: [{job: "bad", error: "not valid JSON"}]},
    {stage: "20_DONE", jobs: []}
  ], inbox: ["new.zip"], problems: ["j is in more than one stage"]});
  assert.ok(!html.includes("<h2>ORDERS <"), "empty parent stage hidden");
  assert.ok(html.includes("ORDERS › PREPRESS"));
  assert.ok(html.includes("X&lt;1&gt;"));
  assert.ok(html.indexOf("#/inbox/new.zip") < html.indexOf("#/job/j1"));
  assert.ok(html.includes("not valid JSON"));
  assert.ok(html.includes("more than one stage"));
});

test("job bar selects the current stage", () => {
  const html = renderJobBar("j", "20_DONE", ["00_INBOX", "20_DONE"]);
  assert.ok(html.includes('<option value="20_DONE" selected>DONE</option>'));
  assert.ok(html.includes("/api/zip?job=j"));
});

test("files: newer versions and unassigned files get a use button", () => {
  const html = renderFiles({slots: [{title: "Label A", name: "X_labels_A_v1.pdf", present: true,
    others: [{name: "X_labels_A_v2.pdf", newer: true}]}], unassigned: ["fix.pdf"]});
  assert.ok(html.includes('data-file="X_labels_A_v2.pdf" data-slot="0"'));
  assert.ok(html.includes('data-file="fix.pdf"'));
  assert.ok(html.includes("Not assigned"));
});

test("inbox: a merge per matching job, then accept as new", () => {
  const html = renderInbox("r.zip", {job: "j2", project: {catalogue: "X"}, files: []},
    [{job: "j1", stage: "20_DONE", changed: ["Label A → X_labels_A_v3.pdf"]}]);
  assert.ok(html.includes('data-job="j1"'));
  assert.ok(html.includes("Label A → X_labels_A_v3.pdf"));
  assert.ok(html.includes('id="accept"'));
});
