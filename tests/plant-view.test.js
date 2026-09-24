import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlantEdit, plantIdentity } from "../src/lib/plant-view.js";

function event(type, {isTrusted = true, button = false} = {}){
  return {type, isTrusted, target:{closest: sel => sel === "button" && button ? {} : null}};
}

test("isPlantEdit counts trusted input, change and button clicks while unlocked", () => {
  assert.equal(isPlantEdit(event("input"), false), true);
  assert.equal(isPlantEdit(event("change"), false), true);
  // Removing a track or a shipping address is a button click with no change event.
  assert.equal(isPlantEdit(event("click", {button:true}), false), true);
});

test("isPlantEdit ignores locked forms, synthetic events and plain clicks", () => {
  assert.equal(isPlantEdit(event("change"), true), false);
  assert.equal(isPlantEdit(event("change", {isTrusted:false}), false), false);
  assert.equal(isPlantEdit(event("click"), false), false);
});

test("plantIdentity shows catalogue, customer email and the zip name", () => {
  const project = {catalogue:"PNKRCK007", shippingBilling:{billing:{email:"a@b.de"}}};
  assert.equal(plantIdentity(project, "260924_PNKRCK007_a@b.de.zip"), "PNKRCK007 · a@b.de · 260924_PNKRCK007_a@b.de.zip");
  assert.equal(plantIdentity({shippingBilling:{billing:{}}}, "x.zip"), "(no catalogue #) · (no email) · x.zip");
});
