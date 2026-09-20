import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTable } from "../src/lib/text-table.js";

test("renderTable sizes columns to the longer of header/data and draws box-drawing borders", () => {
  const out = renderTable(["A", "BB"], [["x", "yyyy"]]);
  assert.equal(out, [
    "┌───┬──────┐",
    "│ A │ BB   │",
    "├───┼──────┤",
    "│ x │ yyyy │",
    "└───┴──────┘",
  ].join("\n"));
});

test("renderTable handles multiple rows with independently-sized columns", () => {
  const out = renderTable(["Pos.", "Title"], [["A1", "My Way"], ["A2", "Hi"]]);
  assert.equal(out, [
    "┌──────┬────────┐",
    "│ Pos. │ Title  │",
    "├──────┼────────┤",
    "│ A1   │ My Way │",
    "│ A2   │ Hi     │",
    "└──────┴────────┘",
  ].join("\n"));
});

test("renderTable with no rows still draws header and top/bottom rules", () => {
  const out = renderTable(["X"], []);
  assert.equal(out, ["┌───┐", "│ X │", "├───┤", "└───┘"].join("\n"));
});

test("renderTable coerces non-string cells and treats null/undefined as empty", () => {
  const out = renderTable(["N"], [[5], [null]]);
  assert.equal(out, [
    "┌───┐",
    "│ N │",
    "├───┤",
    "│ 5 │",
    "│   │",
    "└───┘",
  ].join("\n"));
});
