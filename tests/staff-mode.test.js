import { test } from "node:test";
import assert from "node:assert/strict";
import { orderUrl, staffJob, reselectNote, storedFileText } from "../src/lib/staff-mode.js";

test("the order view's address and the job in it", () => {
  assert.equal(orderUrl("a b/c"), "/order/a%20b%2Fc");
  assert.equal(staffJob("/order/a%20b%2Fc"), "a b/c");
  for(const other of ["/", "/index.html", "/order/", "/order/a/b", "/src/index.html", "/order/%E0%A4%A"]) assert.equal(staffJob(other), null, other);
});

test("a slot without its file: customers re-select it, staff just read the name", () => {
  assert.equal(reselectNote(true), "");
  assert.equal(reselectNote(false), "please re-select this file (not stored in the order file)");
  assert.equal(storedFileText("A1.wav", true), "file: A1.wav");
  assert.equal(storedFileText("A1.wav", false), "file: A1.wav — please re-select this file (not stored in the order file)");
});

test("the page decides, not the address: staff mode is the body class staff.js sets", () => {
  // No document here: the customer's page, whatever its address.
  assert.equal(reselectNote(), "please re-select this file (not stored in the order file)");
  globalThis.document = {body: {classList: {contains: name => name === "staff"}}};
  try{
    assert.equal(reselectNote(), "");
    assert.equal(storedFileText("A1.wav"), "file: A1.wav");
  }finally{
    delete globalThis.document;
  }
});
