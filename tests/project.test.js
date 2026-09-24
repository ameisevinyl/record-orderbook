import { test } from "node:test";
import assert from "node:assert/strict";
import { PROJECT_VERSION, includeSideFile, prepareProject, referencedProjectFiles, assertProjectFiles, historyEntry } from "../src/lib/project.js";

const config = {
  formats: [
    {
      id: "12", enabled: true, rpm: 33,
      printableParts: {
        outerCover: {products:[{id:"cover-print"}]},
        innerSleeve: {products:[{id:"sleeve-white"}]},
        inlay: {products:[{id:"inlay-print"}]}
      }
    },
    {
      id: "10", enabled: false, rpm: 33,
      printableParts: {
        outerCover: {products:[]}, innerSleeve: {products:[]}, inlay: {products:[]}
      }
    }
  ],
  vinylColor: {standardColor:"black", basicColors:["red"]}
};

test("includeSideFile preserves drafts in saves and only active audio in sends", () => {
  for(const blank of [false, true]){
    for(const continuous of [false, true]){
      assert.equal(includeSideFile({forSend:false, blank, continuous, kind:"continuous"}), true);
      assert.equal(includeSideFile({forSend:false, blank, continuous, kind:"track"}), true);
      assert.equal(includeSideFile({forSend:true, blank, continuous, kind:"continuous"}), !blank && continuous);
      assert.equal(includeSideFile({forSend:true, blank, continuous, kind:"track"}), !blank && !continuous);
    }
  }
});

test("prepareProject accepts and normalizes a current project", () => {
  const project = prepareProject({projectVersion:1, format:"12", catalogue:"CAT-1"}, config);
  assert.equal(PROJECT_VERSION, 1);
  assert.equal(project.projectVersion, 1);
  assert.equal(project.catalogue, "CAT-1");
  assert.deepEqual(project.sides.A.tracks, []);
  assert.equal(project.sides.A.rpm, "33");
  assert.equal(project.sides.B.blank, false);
  assert.equal(project.sides.A.continuousFileName, null);
  assert.equal(project.sides.A.tracklistFileName, null);
  assert.equal(project.labels.bigCenter, false);
  assert.equal(project.labels.sides.A.whitelabel, false);
  assert.equal(project.coverSleeve.cover.fileName, null);
  assert.equal(project.coverSleeve.inlay.front.fileName, null);
  assert.deepEqual(project.vinylColor, []);
  assert.equal(project.shippingBilling.billing.email, "");
  assert.deepEqual(project.shippingBilling.shipping, []);
});

test("prepareProject migrates an unversioned project without mutating or losing fields", () => {
  const raw = {
    format: "12", albumTitle: "Known title",
    sides: {A:{tracks:[{title:"Track", fileName:"CAT_A1_track_v1.wav"}]}},
    labels: {bigCenter:true},
    coverSleeve: {cover:{productId:"cover-print", note:"keep"}},
    vinylColor: [{color:"red", qty:"100"}],
    shippingBilling: {billing:{email:"buyer@example.com"}}
  };
  const project = prepareProject(raw, config);

  assert.equal(raw.projectVersion, undefined);
  assert.equal(project.projectVersion, 1);
  assert.equal(project.albumTitle, "Known title");
  assert.equal(project.sides.A.tracks[0].title, "Track");
  assert.equal(project.labels.bigCenter, false);
  assert.equal(project.coverSleeve.cover.note, "keep");
  assert.notEqual(project.sides, raw.sides);
});

test("prepareProject rejects malformed roots and arrays", () => {
  assert.throws(() => prepareProject(null, config), /Project must be an object/);
  assert.throws(() => prepareProject([], config), /Project must be an object/);
  assert.throws(() => prepareProject({format:"12", sides:{A:{tracks:{}}}}, config), /project\.sides\.A\.tracks must be an array/);
  assert.throws(() => prepareProject({format:"12", vinylColor:{}}, config), /project\.vinylColor must be an array/);
  assert.throws(() => prepareProject({format:"12", shippingBilling:{shipping:{}}}, config), /project\.shippingBilling\.shipping must be an array/);
  assert.throws(() => prepareProject({format:"12", sides:{A:{rpm:"78"}}}, config), /rpm must be 33 or 45/);
  assert.throws(() => prepareProject({format:"12", sides:{A:{matrixInscription:{}}}}, config), /matrixInscription must be text/);
  assert.throws(() => prepareProject({format:"12", sides:{A:{tracks:[{title:[]}]}}}, config), /tracks\[0\]\.title must be text/);
});

test("prepareProject rejects invalid and future versions", () => {
  assert.throws(() => prepareProject({projectVersion:"1", format:"12"}, config), /Invalid project version/);
  assert.throws(() => prepareProject({projectVersion:2, format:"12"}, config), /Unsupported project version: 2/);
});

test("prepareProject accepts disabled configured formats and rejects unknown formats", () => {
  assert.equal(prepareProject({projectVersion:1, format:"10"}, config).format, "10");
  assert.throws(() => prepareProject({projectVersion:1, format:"7"}, config), /Unknown format ID "7"/);
});

test("prepareProject rejects unknown product and colour IDs with the affected field named", () => {
  const cases = [
    [{coverSleeve:{cover:{productId:"old-cover"}}}, /Unknown cover product ID "old-cover"/],
    [{coverSleeve:{innerSleeve:{productId:"old-sleeve"}}}, /Unknown inner sleeve product ID "old-sleeve"/],
    [{coverSleeve:{inlay:{productId:"old-inlay"}}}, /Unknown inlay product ID "old-inlay"/],
    [{vinylColor:[{color:"purple"}]}, /Unknown vinyl colour ID "purple"/],
    [{shippingBilling:{shipping:[{qtyByColor:{purple:"10"}}]}}, /Unknown shipping vinyl colour ID "purple"/]
  ];
  for(const [fields, error] of cases){
    assert.throws(() => prepareProject({projectVersion:1, format:"12", ...fields}, config), error);
  }
});

test("prepareProject clears a big-center choice for formats that do not offer one", () => {
  const project = prepareProject({format:"12", labels:{bigCenter:true}}, config);
  assert.equal(project.labels.bigCenter, false);
});

test("referencedProjectFiles lists canonical audio and artwork names", () => {
  const project = prepareProject({
    projectVersion:1, format:"12",
    sides:{A:{continuousFileName:"side.wav", tracklistFileName:"cues.txt", tracks:[{fileName:"track.wav"}]}},
    labels:{sides:{A:{fileName:"label.pdf"}}},
    coverSleeve:{
      cover:{productId:"cover-print", fileName:"cover.pdf"},
      innerSleeve:{productId:"sleeve-white", fileName:"sleeve.pdf"},
      inlay:{productId:"inlay-print", front:{fileName:"front.pdf"}, back:{fileName:"back.pdf"}}
    }
  }, config);
  assert.deepEqual(referencedProjectFiles(project), [
    "side.wav", "cues.txt", "track.wav", "label.pdf", "cover.pdf", "sleeve.pdf", "front.pdf", "back.pdf"
  ]);
});

test("assertProjectFiles rejects a missing referenced file but allows extras", () => {
  const project = prepareProject({projectVersion:1, format:"12", sides:{A:{tracks:[{fileName:"audio.wav"}]}}}, config);
  assert.throws(
    () => assertProjectFiles(project, [{name:"order/project.json"}, {name:"order/preview.png"}]),
    /Missing referenced project file: audio\.wav/
  );
  assert.doesNotThrow(() => assertProjectFiles(project, [
    {name:"order/audio.wav"}, {name:"order/project.json"}, {name:"order/preview.png"}
  ]));
});

test("assertProjectFiles rejects duplicate canonical entry names", () => {
  const project = prepareProject({projectVersion:1, format:"12"}, config);
  assert.throws(
    () => assertProjectFiles(project, [{name:"order/audio.wav"}, {name:"order/audio.wav"}]),
    /Duplicate project entry name: order\/audio\.wav/
  );
  assert.throws(
    () => assertProjectFiles(project, [{name:"one/audio.wav"}, {name:"two/audio.wav"}]),
    /Duplicate project entry name: audio\.wav/
  );
});

test("prepareProject defaults history to an empty array", () => {
  const project = prepareProject({projectVersion:1, format:"12"}, config);
  assert.deepEqual(project.history, []);
});

test("prepareProject keeps history entries and rejects malformed ones", () => {
  const history = [{savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300 → 500"}];
  const project = prepareProject({projectVersion:1, format:"12", history}, config);
  assert.deepEqual(project.history, history);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:{}}, config), /project\.history must be an array/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:["x"]}, config), /project\.history\[0\] must be an object/);
  assert.throws(() => prepareProject({projectVersion:1, format:"12", history:[{note:true}]}, config), /project\.history\[0\]\.note must be text/);
});

test("historyEntry stamps a trimmed plant note", () => {
  const entry = historyEntry("  qty 300 → 500 ", new Date("2026-09-24T12:00:00Z"));
  assert.deepEqual(entry, {savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300 → 500"});
});

test("prepareProject defaults artwork page to 1 and keeps a valid page", () => {
  const project = prepareProject({format:"12", labels:{sides:{B:{fileName:"CAT_labels_B_v1.pdf", page:2}}}}, config);
  assert.equal(project.labels.sides.A.page, 1);
  assert.equal(project.labels.sides.B.page, 2);
  assert.equal(project.coverSleeve.cover.page, 1);
  assert.equal(project.coverSleeve.innerSleeve.page, 1);
  assert.equal(project.coverSleeve.inlay.front.page, 1);
  assert.equal(project.coverSleeve.inlay.back.page, 1);
});

test("prepareProject rejects a page that isn't a positive integer", () => {
  for(const page of [0, -1, 2.5, "2", null]){
    assert.throws(() => prepareProject({format:"12", coverSleeve:{cover:{page}}}, config), /page must be a positive integer/);
  }
});
