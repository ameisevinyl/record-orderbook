import { test } from "node:test";
import assert from "node:assert/strict";
import { mmToPt, buildPdf, bytesToBase64 } from "../src/lib/pdf.js";

const decoder = new TextDecoder();
const asText = bytes => decoder.decode(bytes);

test("mmToPt converts mm to PDF points", () => {
  assert.ok(Math.abs(mmToPt(25.4) - 72) < 1e-9);
  assert.ok(Math.abs(mmToPt(100) - 283.4645669) < 1e-6);
});

test("buildPdf writes a classic PDF whose xref offsets point at each object", () => {
  const bytes = buildPdf({
    title: "Test template",
    pages: [{ widthMm: 106, heightMm: 106, content: "0 0 0 1 K\n" }]
  });
  const text = asText(bytes);
  assert.ok(text.startsWith("%PDF-1.3\n"));
  assert.ok(text.endsWith("%%EOF\n"));

  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), "xref");

  const header = text.match(/xref\n0 (\d+)\n/);
  const count = Number(header[1]);
  const tableStart = startxref + header[0].length;
  for(let i = 1; i < count; i++){
    const entry = text.slice(tableStart + i * 20, tableStart + (i + 1) * 20);
    const offset = Number(entry.slice(0, 10));
    assert.equal(text.slice(offset, offset + `${i} 0 obj`.length), `${i} 0 obj`, `object ${i} offset`);
  }
});

test("buildPdf sets page boxes in points and the info title", () => {
  const bytes = buildPdf({
    title: "Cover template",
    pages: [{ widthMm: 643, heightMm: 328, content: "", trimBoxPt: [5, 5, 638, 323] }]
  });
  const text = asText(bytes);
  assert.match(text, /\/MediaBox \[0 0 1822\.6772 929\.7638\]/);
  assert.match(text, /\/CropBox \[0 0 1822\.6772 929\.7638\]/);
  assert.match(text, /\/BleedBox \[0 0 1822\.6772 929\.7638\]/);
  assert.match(text, /\/TrimBox \[5 5 638 323\]/);
  assert.match(text, /\/Title \(Cover template\)/);
});

test("buildPdf escapes PDF string specials and hex-encodes non-ASCII titles", () => {
  const ascii = asText(buildPdf({ title: "A (B) \\ C", pages: [{ widthMm: 10, heightMm: 10, content: "" }] }));
  assert.match(ascii, /\/Title \(A \\\(B\\\) \\\\ C\)/);

  const unicode = asText(buildPdf({ title: "Schöne Größe", pages: [{ widthMm: 10, heightMm: 10, content: "" }] }));
  assert.match(unicode, /\/Title <FEFF/);
});

test("bytesToBase64 matches Node's base64", () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 65]);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
});
