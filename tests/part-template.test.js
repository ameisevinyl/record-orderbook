import { test } from "node:test";
import assert from "node:assert/strict";
import { labelTemplatePdf, partTemplatePdf, templateFileName } from "../src/lib/part-template.js";

// windows-1252 so the PDF's WinAnsi bytes (e.g. ø = 0xF8) decode 1:1.
const decoder = new TextDecoder("windows-1252");
const asText = bytes => decoder.decode(bytes);

const format = { id:"12", centerHole:{ normal:7.4, big:38 } };
const cover = {
  name:"printed", trimMm:{w:633,h:318}, finalMm:{w:315,h:318},
  spineMm:3, bleedMm:5, paperGsm:300
};

test("labelTemplatePdf page is the data square and has no TrimBox", () => {
  const pdf = asText(labelTemplatePdf({ format, label:{ diameterMm:100, bleedMm:3 } }));
  assert.match(pdf, /\/MediaBox \[0 0 300\.4724 300\.4724\]/); // 106mm
  assert.doesNotMatch(pdf, /\/TrimBox/);
});

test("labelTemplatePdf dots the trim and both center holes and prints the specs line", () => {
  const pdf = asText(labelTemplatePdf({ format, label:{ diameterMm:100, bleedMm:3 } }));
  assert.match(pdf, /\[2 3\] 0 d/);
  assert.match(pdf, /0 0 0 1 K/);
  assert.doesNotMatch(pdf, /(^|\s)rg(\s|$)|\bRG\b/);
  assert.match(pdf, /\(data 106x106mm, bleed 3mm\) Tj/);
  assert.match(pdf, /\(end format ø100mm\) Tj/);
  assert.match(pdf, /\(small center ø7\.4mm\) Tj/);
  assert.match(pdf, /\(big center ø38mm\) Tj/);
  assert.match(pdf, /\/F1 11 Tf/);
  assert.equal((pdf.match(/ h S/g) || []).length, 3); // trim + normal + big circles
});

test("labelTemplatePdf omits the big hole for formats without one", () => {
  const pdf = asText(labelTemplatePdf({
    format:{ id:"10", centerHole:{ normal:7.4 } },
    label:{ diameterMm:100, bleedMm:3 }
  }));
  assert.match(pdf, /\(small center ø7\.4mm\) Tj/);
  assert.doesNotMatch(pdf, /big/);
  assert.equal((pdf.match(/ h S/g) || []).length, 2); // trim + normal circles
});

test("partTemplatePdf page and TrimBox are dimensionally exact", () => {
  const pdf = asText(partTemplatePdf({ formatId:"12", part:cover }));
  assert.match(pdf, /\/MediaBox \[0 0 1822\.6772 929\.7638\]/); // 643×328mm
  assert.match(pdf, /\/TrimBox \[14\.1732 14\.1732 1808\.5039 915\.5906\]/); // 5mm bleed
});

test("partTemplatePdf draws dotted cuts, lighter dotted folds, and the specs line", () => {
  const pdf = asText(partTemplatePdf({ formatId:"12", part:cover }));
  assert.match(pdf, /\[2 3\] 0 d/);      // cut lines
  assert.match(pdf, /\[1 3\] 0 d/);      // fold lines
  assert.match(pdf, /0 0 0 0\.5 K/);     // folds are lighter
  assert.equal((pdf.match(/ l S/g) || []).length, 12); // 4 folds + 8 corner-mark segments
  assert.match(pdf, /\(data 643x328mm, end format 633x318mm, bleed 5mm, spine 3mm\) Tj/);
  assert.doesNotMatch(pdf, /\(fold\) Tj|\(trim\) Tj|\(cut-out dia/);
});

test("partTemplatePdf carries no bleed tint and uses the readable 11pt line", () => {
  const pdf = asText(partTemplatePdf({ formatId:"12", part:cover }));
  assert.doesNotMatch(pdf, /0 0 0 0\.1 k/);
  assert.doesNotMatch(pdf, /f\*/);
  assert.match(pdf, /\/F1 11 Tf/);
});

test("partTemplatePdf strokes the stepped back-half trim outline", () => {
  const pdf = asText(partTemplatePdf({ formatId:"12", part:cover }));
  assert.match(pdf, new RegExp(
    "14\\.1732 907\\.0866 m 907\\.0866 907\\.0866 l 907\\.0866 915\\.5906 l "
    + "1808\\.5039 915\\.5906 l 1808\\.5039 14\\.1732 l 907\\.0866 14\\.1732 l "
    + "907\\.0866 22\\.6772 l 14\\.1732 22\\.6772 l h S"
  ));
});

test("partTemplatePdf dots and cuts a center cut-out without labelling it", () => {
  const part = {
    name:"printed", trimMm:{w:608,h:309}, finalMm:{w:304,h:309},
    bleedMm:3, cutoutDiameterMm:85, paperGsm:135
  };
  const pdf = asText(partTemplatePdf({ formatId:"12", part }));
  assert.equal((pdf.match(/ h S/g) || []).length, 2); // trim outline + cut-out circle
  assert.equal((pdf.match(/ l S/g) || []).length, 9); // one center fold + 8 corner-mark segments
  assert.doesNotMatch(pdf, /cut-out dia/);
});

// Inked extents of the m/l path coordinates — what Photoshop's default
// "Crop To: Bounding Box" import uses.
function contentBounds(pdf){
  const body = pdf.slice(pdf.indexOf("stream\n") + 7, pdf.indexOf("endstream"));
  const xs = [], ys = [];
  for(const m of body.matchAll(/([\d.]+) ([\d.]+) (?:m|l)\b/g)){
    xs.push(Number(m[1]));
    ys.push(Number(m[2]));
  }
  return { minX:Math.min(...xs), maxX:Math.max(...xs), minY:Math.min(...ys), maxY:Math.max(...ys) };
}

test("corner marks make the inked content fill the page for Photoshop", () => {
  const coverBounds = contentBounds(asText(partTemplatePdf({ formatId:"12", part:cover })));
  assert.deepEqual(coverBounds, { minX:0, maxX:1822.6772, minY:0, maxY:929.7638 });

  const labelBounds = contentBounds(asText(labelTemplatePdf({ format, label:{ diameterMm:100, bleedMm:3 } })));
  assert.deepEqual(labelBounds, { minX:0, maxX:300.4724, minY:0, maxY:300.4724 });
});

test("spread templates mark BACK and FRONT in big light grey letters", () => {
  const pdf = asText(partTemplatePdf({ formatId:"12", part:cover }));
  assert.match(pdf, /0 0 0 0\.2 k/);
  assert.match(pdf, /\(BACK\) Tj/);
  assert.match(pdf, /\(FRONT\) Tj/);
  assert.match(pdf, /\/F1 1\d\d(\.\d+)? Tf/); // big: three-digit size on a 312mm panel
  const backX = Number(pdf.match(/Tf ([\d.]+) [\d.]+ Td \(BACK\)/)[1]);
  const frontX = Number(pdf.match(/Tf ([\d.]+) [\d.]+ Td \(FRONT\)/)[1]);
  assert.ok(backX < frontX, "BACK sits in the left panel, FRONT in the right");
});

test("folded sleeves get the same BACK/FRONT marks", () => {
  const part = {
    name:"printed", trimMm:{w:608,h:309}, finalMm:{w:304,h:309},
    bleedMm:3, paperGsm:135
  };
  const pdf = asText(partTemplatePdf({ formatId:"12", part }));
  assert.match(pdf, /\(BACK\) Tj/);
  assert.match(pdf, /\(FRONT\) Tj/);
});

test("single-sheet parts and labels get no BACK/FRONT marks", () => {
  const inlay = {
    name:"printed", trimMm:{w:297,h:297}, bleedMm:3, paperGsm:170
  };
  const pdf = asText(partTemplatePdf({ formatId:"12", part:inlay }));
  assert.doesNotMatch(pdf, /BACK|FRONT/);

  const label = asText(labelTemplatePdf({ format, label:{ diameterMm:100, bleedMm:3 } }));
  assert.doesNotMatch(label, /BACK|FRONT/);
});

test("templateFileName is human-readable and unique per product", () => {
  assert.equal(templateFileName({ formatId:"12", part:"labels" }), "12_labels_template_v1.pdf");
  assert.equal(
    templateFileName({ formatId:"12", part:"cover", productName:"printed (inside out)" }),
    "12_cover_printed_inside_out_template_v1.pdf"
  );
});
