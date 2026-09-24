import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { projectGaps, sideTiming } from "../src/lib/completeness.js";

const address = {
  recipientName:"Punk Rock Ltd", addressLine1:"Hauptstr. 1", city:"Hamburg",
  postalCode:"20095", countryCode:"DE", email:"label@example.com"
};

function raw(overrides = {}){
  return {
    projectVersion:1, format:"12", catalogue:"PNKRCK007",
    sides:{
      A:{rpm:"33", tracks:[{title:"My Way", length:"3:00", fileName:"A1.wav"}]},
      B:{blank:true}
    },
    labels:{sides:{A:{fileName:"labA.pdf"}, B:{fileName:"labB.pdf"}}},
    coverSleeve:{innerSleeve:{productId:"sleeve-white-cutout"}},
    vinylColor:[{color:"black", qty:"300"}],
    shippingBilling:{billing:{...address}, shipping:[{...address, qtyByColor:{black:"300"}}]},
    ...overrides
  };
}

const allFiles = [{name:"A1.wav", size:1}, {name:"labA.pdf", size:1}, {name:"labB.pdf", size:1}];

function gaps(overrides, files = allFiles){
  return projectGaps(prepareProject(raw(overrides), CONFIG), CONFIG, files);
}

function texts(list){
  return list.map(g => `${g.group}: ${g.text}`);
}

test("a complete project has no gaps", () => {
  assert.deepEqual(gaps({}), []);
});

test("missing catalogue number", () => {
  assert.deepEqual(texts(gaps({catalogue:" "})), ["Release: no catalogue number"]);
});

test("track without audio file or length", () => {
  const sides = {A:{rpm:"33", tracks:[{title:"x", length:""}]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: A1 has no audio file", "Side A: A1 length missing or invalid"]);
});

test("side without tracks", () => {
  const sides = {A:{rpm:"33", tracks:[]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: no tracks"]);
});

test("continuous side: file needed, empty length fine, bad length flagged", () => {
  const ok = {A:{rpm:"33", continuous:true, continuousFileName:"A.wav", continuousLength:""}, B:{blank:true}};
  assert.deepEqual(gaps({sides:ok}, [...allFiles, {name:"A.wav", size:1}]), []);
  const bad = {A:{rpm:"33", continuous:true, continuousLength:"abc"}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides:bad})), ["Side A: no audio file for the side", "Side A: side length invalid"]);
});

test("playing time over the format maximum", () => {
  const sides = {A:{rpm:"33", tracks:[{title:"x", length:"28:00", fileName:"A1.wav"}]}, B:{blank:true}};
  assert.deepEqual(texts(gaps({sides})), ["Side A: playing time 28:00 over the 27 min maximum"]);
  assert.deepEqual(sideTiming(prepareProject(raw({sides}), CONFIG).sides.A), {seconds:1680, invalid:false});
});

test("file named in project.json but not in the zip", () => {
  assert.deepEqual(texts(gaps({}, allFiles.filter(f => f.name !== "A1.wav"))), ["Side A: A1 audio file A1.wav is not in the zip"]);
});

test("labels: missing artwork unless whitelabel; blank side B still needs a label", () => {
  const labels = {sides:{A:{fileName:"labA.pdf"}, B:{}}};
  assert.deepEqual(texts(gaps({labels})), ["Labels: label B has no artwork"]);
  assert.deepEqual(gaps({labels:{sides:{A:{fileName:"labA.pdf"}, B:{whitelabel:true}}}}), []);
});

test("printed parts need their artwork, inlay front and back", () => {
  const coverSleeve = {
    innerSleeve:{productId:"sleeve-printed"},
    cover:{productId:"cover-printed"},
    inlay:{productId:"inlay-printed", front:{fileName:"inf.pdf"}}
  };
  assert.deepEqual(texts(gaps({coverSleeve}, [...allFiles, {name:"inf.pdf", size:1}])), [
    "Inner sleeve: printed but no artwork",
    "Cover: printed but no artwork",
    "Inlay: back has no artwork"
  ]);
});

test("quantities: none, invalid, below minimum", () => {
  const shipping = [{...address, qtyByColor:{}}];
  assert.deepEqual(texts(gaps({vinylColor:[], shippingBilling:{billing:{...address}, shipping}})), ["Quantity: no quantity"]);
  assert.deepEqual(texts(gaps({vinylColor:[{color:"black", qty:"30x"}], shippingBilling:{billing:{...address}, shipping}})),
    ["Quantity: no quantity", 'Quantity: Black: invalid quantity "30x"']);
  const red = {vinylColor:[{color:"black", qty:"300"}, {color:"red", qty:"50"}],
    shippingBilling:{billing:{...address}, shipping:[{...address, qtyByColor:{black:"300", red:"50"}}]}};
  assert.deepEqual(texts(gaps(red)), ["Quantity: Red: 50 is below the minimum of 100"]);
});

test("billing: missing fields and malformed email", () => {
  const billing = {...address, city:"", email:"nope"};
  assert.deepEqual(texts(gaps({shippingBilling:{billing, shipping:[{...address, qtyByColor:{black:"300"}}]}})),
    ["Billing: city missing", "Billing: email looks malformed"]);
});

test("shipping: no address, missing fields, over-allocated or invalid extra quantities", () => {
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:[]}})), ["Shipping: no shipping address"]);
  const over = [{...address, qtyByColor:{black:"100"}}, {...address, postalCode:"", qtyByColor:{black:"400"}}];
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:over}})),
    ["Shipping 2: postal code missing", "Shipping: Black: more shipped than pressed"]);
  const invalid = [{...address, qtyByColor:{black:"100"}}, {...address, qtyByColor:{black:"x"}}];
  assert.deepEqual(texts(gaps({shippingBilling:{billing:{...address}, shipping:invalid}})),
    ["Shipping: Black: invalid shipping quantity"]);
});
