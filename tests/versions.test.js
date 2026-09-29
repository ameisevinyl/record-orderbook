import test from "node:test";
import assert from "node:assert/strict";
import { versionOf, nextVersionName, assignedName, jobFiles, mergeResend } from "../src/lib/versions.js";

const project = labelA => ({
  catalogue: "X",
  sides: {A: {tracks: [{fileName: "X_A1_song_v1.wav"}]}, B: {tracks: []}},
  labels: {sides: {A: {fileName: labelA}, B: {fileName: null}}},
  coverSleeve: {cover: {fileName: null}},
  plant: {stage: "10_ORDERS/10_PREPRESS"},
  history: [{savedAt: "t", by: "plant", note: "earlier"}]
});

test("versionOf splits base, number and extension", () => {
  assert.deepEqual(versionOf("X_labels_A_v12.pdf"), {base: "X_labels_A", version: 12, ext: ".pdf"});
  assert.equal(versionOf("cover_final.pdf"), null);
});

test("nextVersionName counts every extension of the base", () => {
  assert.equal(nextVersionName("X_labels_A", ".tif", ["X_labels_A_v1.pdf", "X_labels_A_v3.pdf", "X_labels_B_v7.pdf"]),
    "X_labels_A_v4.tif");
  assert.equal(nextVersionName("X_cover", ".pdf", []), "X_cover_v1.pdf");
});

test("assignedName keeps a hand-saved version, renames anything else", () => {
  const names = ["X_labels_A_v1.pdf", "X_labels_A_v2.pdf", "fix.pdf"];
  assert.equal(assignedName("X_labels_A_v1.pdf", "X_labels_A_v2.pdf", names), "X_labels_A_v2.pdf");
  assert.equal(assignedName("X_labels_A_v1.pdf", "fix.pdf", names), "X_labels_A_v3.pdf");
});

test("jobFiles lists other versions per slot, newest first, and unassigned files", () => {
  const files = ["X_A1_song_v1.wav", "X_labels_A_v1.pdf", "X_labels_A_v2.pdf", "X_labels_A_v3.pdf",
    "cover_final.pdf", "order_summary.txt"].map(name => ({name, size: 1}));
  const {slots, unassigned} = jobFiles(project("X_labels_A_v2.pdf"), files);
  const label = slots.find(s => s.title === "Label A");
  assert.deepEqual(label.others, [{name: "X_labels_A_v3.pdf", newer: true}, {name: "X_labels_A_v1.pdf", newer: false}]);
  assert.equal(label.present, true);
  assert.deepEqual(slots.map(s => s.title), ["A1", "Label A"]);
  assert.deepEqual(unassigned, ["cover_final.pdf"]);
});

test("mergeResend keeps unchanged files and the staff's choice, adds changed ones as versions", () => {
  const old = project("X_labels_A_v2.pdf"); // v2: staff fix
  const oldFiles = [{name: "X_A1_song_v1.wav", sha256: "wav"}, {name: "X_labels_A_v1.pdf", sha256: "orig"},
    {name: "X_labels_A_v2.pdf", sha256: "fix"}];
  const resent = project("X_labels_A_v1.pdf");
  resent.albumTitle = "New title";
  delete resent.plant;
  resent.history = [];

  let r = mergeResend(old, oldFiles, resent,
    [{name: "X_A1_song_v1.wav", sha256: "wav"}, {name: "X_labels_A_v1.pdf", sha256: "orig"}], new Date(0));
  assert.deepEqual(r.copies, []);
  assert.equal(r.project.labels.sides.A.fileName, "X_labels_A_v2.pdf");
  assert.equal(r.project.albumTitle, "New title");
  assert.deepEqual(r.project.plant, {...old.plant, received: {}});
  assert.deepEqual(r.project.history.map(h => h.note), ["earlier", "resend: no file changes"]);

  r = mergeResend(old, oldFiles, resent,
    [{name: "X_A1_song_v1.wav", sha256: "wav"}, {name: "X_labels_A_v1.pdf", sha256: "new"}], new Date(0));
  assert.deepEqual(r.copies, [{from: "X_labels_A_v1.pdf", to: "X_labels_A_v3.pdf"}]);
  assert.equal(r.project.labels.sides.A.fileName, "X_labels_A_v3.pdf");
  assert.equal(r.project.history.at(-1).note, "resend: Label A → X_labels_A_v3.pdf");
  assert.equal(old.labels.sides.A.fileName, "X_labels_A_v2.pdf"); // inputs untouched
});

test("mergeResend keeps a fix saved over the received file under the same name", () => {
  const old = project("X_labels_A_v1.pdf");
  old.plant.received = {"X_labels_A_v1.pdf": "orig"};
  const oldFiles = [{name: "X_A1_song_v1.wav", sha256: "wav"}, {name: "X_labels_A_v1.pdf", sha256: "fixed"}];
  const again = [{name: "X_A1_song_v1.wav", sha256: "wav"}, {name: "X_labels_A_v1.pdf", sha256: "orig"}];
  let r = mergeResend(old, oldFiles, project("X_labels_A_v1.pdf"), again, new Date(0));
  assert.deepEqual(r.copies, []);
  assert.equal(r.project.labels.sides.A.fileName, "X_labels_A_v1.pdf");

  r = mergeResend(old, oldFiles, project("X_labels_A_v1.pdf"),
    [{name: "X_labels_A_v1.pdf", sha256: "customer v2"}], new Date(0));
  assert.deepEqual(r.copies, [{from: "X_labels_A_v1.pdf", to: "X_labels_A_v2.pdf"}]);
  assert.deepEqual(r.project.plant.received, {"X_labels_A_v1.pdf": "orig", "X_labels_A_v2.pdf": "customer v2"});
});
