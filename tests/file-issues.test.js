import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredFileIssue } from "../src/lib/file-issues.js";

const file = {};

test("requiredFileIssue reports one strongest issue per slot", () => {
  assert.deepEqual(requiredFileIssue("Cover", {file:null, pending:false, error:null, rows:[]}), {
    text:"Cover artwork file is missing.", blocking:true
  });
  assert.deepEqual(requiredFileIssue("Cover", {file, pending:true, error:null, rows:[]}), {
    text:"Cover artwork inspection is still pending.", blocking:true, pending:true
  });
  assert.deepEqual(requiredFileIssue("Cover", {file, pending:false, error:new Error("bad"), rows:[]}), {
    text:"Cover artwork could not be read.", blocking:true
  });
  assert.equal(requiredFileIssue("Cover", {file, pending:false, error:null, rows:[{severity:"info"}]}), null);
});

test("requiredFileIssue collapses checklist rows to the strongest severity", () => {
  assert.deepEqual(requiredFileIssue("Label A", {
    file, pending:false, error:null, rows:[{severity:"warn"}, {severity:"error"}]
  }), {text:"Label A artwork has checklist errors.", blocking:true});
  assert.deepEqual(requiredFileIssue("Label A", {
    file, pending:false, error:null, rows:[{severity:"info"}, {severity:"warn"}]
  }), {text:"Label A artwork has checklist warnings.", blocking:false});
});
