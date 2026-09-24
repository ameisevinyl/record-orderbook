import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import {
  sniffFileKind,
  parseJpegArtwork,
  parseTiffArtwork,
  parsePdfArtwork,
  buildChecklistRows,
  pdfPreviewSrc,
  pageOptionsHtml,
} from "../src/lib/print-artwork.js";
import { buildPdf } from "../src/lib/pdf.js";

// A format's CONFIG.printCheck shape (see config.js) — reused across the
// buildChecklistRows tests below, and by one parsePdfArtwork regression
// test that needs to check its size result through the real row builder
// rather than duplicating its tolerance logic.
const TARGET = { w: 98, h: 98 }; // data/bleed size
const TRIM = { w: 92, h: 92 };   // finished trim size
const TOL = 0.5, DPI_MIN = 300, DPI_MAX = 1200;
const PRINT_CHECK = {
  sizeToleranceMm: TOL, dpi: { min: DPI_MIN, max: DPI_MAX },
  checks: {
    size:         { severity: "warn" },
    resolution:   { severity: "warn" },
    colorMode:    { accepted: ["CMYK"], severity: "warn" },
    spotColors:   { accepted: true,     severity: "warn" },
    colorProfile: { required: false,    severity: "warn" },
    pdfVersion:   { accepted: ["1.4"],  severity: "debug" },
    trimBox:      { required: false,    severity: "warn" },
    encryption:   { severity: "error" },
    fonts:        { requireEmbedded: true, severity: "debug" }
  }
};

// ---- helpers to build synthetic file headers ----

function buildJpegHeader({ width, height, components, jfifUnits, jfifX, jfifY }) {
  const bytes = [];
  const u16 = (n) => bytes.push((n >> 8) & 0xFF, n & 0xFF);
  const u8 = (n) => bytes.push(n & 0xFF);
  const str = (s) => { for (const c of s) u8(c.charCodeAt(0)); };

  u8(0xFF); u8(0xD8); // SOI

  if (jfifUnits !== undefined) {
    u8(0xFF); u8(0xE0); // APP0
    u16(16); // length incl. these 2 bytes
    str("JFIF"); u8(0);
    u8(1); u8(1); // version 1.1
    u8(jfifUnits);
    u16(jfifX); u16(jfifY);
    u8(0); u8(0); // no thumbnail
  }

  u8(0xFF); u8(0xC0); // SOF0
  u16(2 + 1 + 2 + 2 + 1 + components * 3);
  u8(8); // precision
  u16(height);
  u16(width);
  u8(components);
  for (let i = 0; i < components; i++) { u8(i + 1); u8(0x11); u8(0); }

  u8(0xFF); u8(0xDA); // SOS
  u16(2 + 1 + components * 2 + 3);
  u8(components);
  for (let i = 0; i < components; i++) { u8(i + 1); u8(0); }
  u8(0); u8(63); u8(0);

  return new Uint8Array(bytes).buffer;
}

function buildTiffHeader({ width, height, photometric, samplesPerPixel = 1, xres, yres, resUnit = 2 }) {
  const tagDefs = [
    { tag: 256, type: 4, value: width },
    { tag: 257, type: 4, value: height },
    { tag: 259, type: 3, value: 1 },
    { tag: 262, type: 3, value: photometric },
    { tag: 277, type: 3, value: samplesPerPixel },
    ...(xres ? [{ tag: 282, type: 5, rational: xres }] : []),
    ...(yres ? [{ tag: 283, type: 5, rational: yres }] : []),
    { tag: 296, type: 3, value: resUnit },
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + tagDefs.length * 12 + 4;
  let dataOffset = ifdOffset + ifdSize;
  const rationalOffsets = tagDefs.map((def) => {
    if (def.type !== 5) return null;
    const off = dataOffset;
    dataOffset += 8;
    return off;
  });

  const buf = new ArrayBuffer(dataOffset);
  const dv = new DataView(buf);
  dv.setUint8(0, 0x49); dv.setUint8(1, 0x49); // "II" little-endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, tagDefs.length, true);

  tagDefs.forEach((def, i) => {
    const entryOff = ifdOffset + 2 + i * 12;
    dv.setUint16(entryOff, def.tag, true);
    dv.setUint16(entryOff + 2, def.type, true);
    dv.setUint32(entryOff + 4, 1, true);
    if (def.type === 3) dv.setUint16(entryOff + 8, def.value, true);
    else if (def.type === 4) dv.setUint32(entryOff + 8, def.value, true);
    else if (def.type === 5) {
      const off = rationalOffsets[i];
      dv.setUint32(entryOff + 8, off, true);
      dv.setUint32(off, def.rational[0], true);
      dv.setUint32(off + 4, def.rational[1], true);
    }
  });
  dv.setUint32(ifdOffset + 2 + tagDefs.length * 12, 0, true); // next IFD = none

  return buf;
}

function pdfBuffer(str) {
  return new TextEncoder().encode(str).buffer;
}

// Concatenates ASCII text chunks (encoded 1 char = 1 byte, matching
// this codebase's latin1-index-equals-byte-offset assumption) with raw
// binary chunks (e.g. real deflate output) into one ArrayBuffer — for
// building a synthetic PDF whose content stream is genuinely
// Flate-compressed, not just a string that happens to say "FlateDecode".
function concatBytes(parts) {
  const chunks = parts.map(p =>
    typeof p === "string" ? Uint8Array.from(p, c => c.charCodeAt(0)) : p);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  chunks.forEach(c => { out.set(c, o); o += c.length; });
  return out.buffer;
}

// A minimal one-page vector PDF: a real page object (no image XObject
// at all) whose /Contents stream is genuinely Flate-compressed, so
// parsePdfArtwork's vector-colour detection has real deflate bytes to
// decompress, not a stub.
function vectorPdfBuffer({ mediaBoxPt = [0, 0, 283.5, 283.5], content, extraObjects = "" }) {
  const compressed = deflateSync(Buffer.from(content, "latin1"));
  const pre = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [${mediaBoxPt.join(" ")}] /Contents 2 0 R >>
endobj
2 0 obj
<< /Length ${compressed.length} /Filter /FlateDecode >>
stream
`;
  const post = `
endstream
endobj
${extraObjects}`;
  return concatBytes([pre, new Uint8Array(compressed), post]);
}

// A minimal but structurally real ICC profile: the "acsp" signature at
// its fixed header offset (all real ICC readers key off this, not a
// well-formed header otherwise — nothing else here reads any other
// header field) plus a one-entry tag table pointing at a v2
// textDescriptionType 'desc' tag containing the given name.
function buildIccProfileBytes(name, { descTypeSig = "desc" } = {}) {
  const nameBytes = Uint8Array.from(name, c => c.charCodeAt(0));
  const asciiCount = nameBytes.length + 1; // includes the trailing NUL
  const tagDataOffset = 132 + 12; // right after a 1-entry tag table
  const tagDataSize = 12 + asciiCount; // type sig + reserved + count + string+NUL
  const buf = new Uint8Array(tagDataOffset + tagDataSize);
  const dv = new DataView(buf.buffer);
  const setSig = (offset, sig) => { for (let i = 0; i < 4; i++) buf[offset + i] = sig.charCodeAt(i); };

  setSig(36, "acsp");
  dv.setUint32(128, 1, false); // tag count

  setSig(132, "desc"); // tag id
  dv.setUint32(136, tagDataOffset, false); // tag data offset
  dv.setUint32(140, tagDataSize, false); // tag data size

  setSig(tagDataOffset, descTypeSig); // tag data's own type signature
  dv.setUint32(tagDataOffset + 4, 0, false); // reserved
  dv.setUint32(tagDataOffset + 8, asciiCount, false);
  buf.set(nameBytes, tagDataOffset + 12);
  // buf[tagDataOffset + 12 + nameBytes.length] is already 0 (NUL) — Uint8Array starts zeroed.

  return buf;
}

// Wraps a (possibly fake) ICC profile as an indirectly-referenced
// /ICCBased colourspace resource — this codebase never actually
// resolves that "2 0 R" reference (see detectIccProfileName's
// comment), it just needs /ICCBased present somewhere and a
// Flate-compressed non-image stream to check for the "acsp" signature.
function iccProfilePdfBuffer(profileBytes, { mediaBoxPt = [0, 0, 283.5, 283.5] } = {}) {
  const compressed = deflateSync(Buffer.from(profileBytes));
  const pre = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [${mediaBoxPt.join(" ")}] /Resources << /ColorSpace << /CS0 [/ICCBased 2 0 R] >> >> >>
endobj
2 0 obj
<< /N 4 /Length ${compressed.length} /Filter /FlateDecode >>
stream
`;
  const post = `
endstream
endobj`;
  return concatBytes([pre, new Uint8Array(compressed), post]);
}

// ---- sniffFileKind ----

test("sniffFileKind detects PDF, JPEG, TIFF, and unknown", () => {
  assert.equal(sniffFileKind(pdfBuffer("%PDF-1.4\n...")), "pdf");
  assert.equal(sniffFileKind(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer), "jpeg");
  assert.equal(sniffFileKind(new Uint8Array([0x49, 0x49, 0x2A, 0x00]).buffer), "tiff");
  assert.equal(sniffFileKind(new Uint8Array([0x4D, 0x4D, 0x00, 0x2A]).buffer), "tiff");
  assert.equal(sniffFileKind(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer), "unknown");
});

// ---- parseJpegArtwork ----

test("parseJpegArtwork reads dimensions, CMYK component count, and JFIF density", () => {
  const buf = buildJpegHeader({ width: 1157, height: 1157, components: 4, jfifUnits: 1, jfifX: 300, jfifY: 300 });
  const info = parseJpegArtwork(buf);
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
  assert.deepEqual(info.declaredDpi, { x: 300, y: 300 });
});

test("parseJpegArtwork treats a 3-component file as RGB and units=0 as no usable DPI", () => {
  const buf = buildJpegHeader({ width: 800, height: 800, components: 3, jfifUnits: 0, jfifX: 1, jfifY: 1 });
  const info = parseJpegArtwork(buf);
  assert.equal(info.colorMode, "RGB");
  assert.equal(info.declaredDpi, null);
});

test("parseJpegArtwork returns null for non-JPEG bytes", () => {
  assert.equal(parseJpegArtwork(new Uint8Array([1, 2, 3, 4]).buffer), null);
});

test("parseJpegArtwork returns null rather than throwing for a truncated segment", () => {
  const truncated = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A]).buffer;
  assert.doesNotThrow(() => parseJpegArtwork(truncated));
  assert.equal(parseJpegArtwork(truncated), null);
});

test("parseJpegArtwork reports the PDF/X-3 proxy checks as not applicable (null), not false", () => {
  // A raster upload has no PDF/X concept at all — false would wrongly
  // suggest buildChecklistRows should flag a missing TrimBox on a plain
  // JPEG, which was never applicable to begin with.
  const buf = buildJpegHeader({ width: 500, height: 500, components: 3, jfifUnits: 1, jfifX: 300, jfifY: 300 });
  const info = parseJpegArtwork(buf);
  assert.equal(info.trimBoxMm, null);
  assert.equal(info.encrypted, null);
  assert.equal(info.hasUnembeddedFonts, null);
});

// ---- parseTiffArtwork ----

test("parseTiffArtwork reads dimensions, resolution, and CMYK photometric interpretation", () => {
  const buf = buildTiffHeader({
    width: 1157, height: 1157, photometric: 5, samplesPerPixel: 4,
    xres: [300, 1], yres: [300, 1], resUnit: 2,
  });
  const info = parseTiffArtwork(buf);
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
  assert.deepEqual(info.declaredDpi, { x: 300, y: 300 });
});

test("parseTiffArtwork converts resolution unit cm to inch-equivalent dpi", () => {
  const buf = buildTiffHeader({
    width: 500, height: 500, photometric: 2, samplesPerPixel: 3,
    xres: [100, 1], yres: [100, 1], resUnit: 3, // 100 px/cm
  });
  const info = parseTiffArtwork(buf);
  assert.equal(info.colorMode, "RGB");
  assert.ok(Math.abs(info.declaredDpi.x - 254) < 0.01);
});

test("parseTiffArtwork returns null for non-TIFF bytes", () => {
  assert.equal(parseTiffArtwork(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer), null);
});

test("parseTiffArtwork returns null rather than accepting a truncated IFD", () => {
  const full = buildTiffHeader({ width: 1157, height: 1157, photometric: 5 });
  const truncated = full.slice(0, 8 + 2 + 2 * 12);
  assert.doesNotThrow(() => parseTiffArtwork(truncated));
  assert.equal(parseTiffArtwork(truncated), null);
});

test("parseTiffArtwork reports the PDF/X-3 proxy checks as not applicable (null), not false", () => {
  const buf = buildTiffHeader({
    width: 500, height: 500, photometric: 5, samplesPerPixel: 4,
    xres: [300, 1], yres: [300, 1], resUnit: 2,
  });
  const info = parseTiffArtwork(buf);
  assert.equal(info.trimBoxMm, null);
  assert.equal(info.encrypted, null);
  assert.equal(info.hasUnembeddedFonts, null);
});

// ---- parsePdfArtwork ----

test("parsePdfArtwork reads MediaBox in points and converts to mm", async () => {
  // 98mm x 98mm = 277.795... x 277.795... pt
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 277.8 277.8] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 98) < 0.05);
  assert.ok(Math.abs(info.pageSizeMm.h - 98) < 0.05);
});

test("parsePdfArtwork prefers BleedBox over TrimBox and MediaBox — targetMm is always the bleed-inclusive dataSizeMm/dataMm, not the trim size", async () => {
  // MediaBox is the full sheet with crop marks (~120mm); TrimBox is the
  // cut size WITHOUT bleed (98mm); BleedBox is the cut size WITH bleed
  // (104mm) — the one every caller's targetMm actually matches.
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 340.2 340.2] /TrimBox [21.2 21.2 299 299] /BleedBox [12.8 12.8 307.603 307.603] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 104) < 0.05, info.pageSizeMm.w);
  assert.ok(Math.abs(info.pageSizeMm.h - 104) < 0.05, info.pageSizeMm.h);
});

test("parsePdfArtwork falls back to TrimBox over MediaBox when there's no BleedBox", async () => {
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 340.2 340.2] /TrimBox [21.2 21.2 299 299] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 98) < 0.05, info.pageSizeMm.w);
});

test("parsePdfArtwork + buildChecklistRows: a correctly-bled prepress export doesn't false-flag as wrong size", async () => {
  // Regression case: MediaBox 120mm (crop marks), BleedBox 106mm
  // (matches a 12\" label's dataSizeMm exactly), TrimBox 100mm (matches
  // its diameterMm) — BleedBox must win, or this reads as 100mm and
  // wrongly flags against the 106mm target.
  const pt = mm => mm / 25.4 * 72;
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 ${pt(120)} ${pt(120)}] /BleedBox [${pt(7)} ${pt(7)} ${pt(113)} ${pt(113)}] /TrimBox [${pt(10)} ${pt(10)} ${pt(110)} ${pt(110)}] >>\nendobj\n`;
  const parsed = await parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(parsed.pageSizeMm.w - 106) < 0.05, parsed.pageSizeMm.w);
  const rows = buildChecklistRows(parsed, "pdf", { w: 106, h: 106 }, { w: 100, h: 100 }, PRINT_CHECK, false);
  assert.equal(rows.find(r => r.feature === "Size").severity, "info", JSON.stringify(rows));
});

test("parsePdfArtwork finds an embedded image XObject's size and CMYK colorspace", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] >>
endobj
2 0 obj
<< /Type /XObject /Subtype /Image /Width 1157 /Height 1157 /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /Length 12345 >>
stream
...
endstream
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork detects RGB via /DeviceRGB", async () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceRGB >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.colorMode, "RGB");
});

test("parsePdfArtwork returns null when neither MediaBox nor an image is found", async () => {
  assert.equal(await parsePdfArtwork(pdfBuffer("%PDF-1.4\nnothing useful here\n")), null);
});

test("parsePdfArtwork picks the largest image when a PDF has more than one (e.g. a soft mask)", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] >>
endobj
2 0 obj
<< /Type /XObject /Subtype /Image /Width 64 /Height 64 /ColorSpace /DeviceGray /BitsPerComponent 8 >>
endobj
3 0 obj
<< /Type /XObject /Subtype /Image /Width 1157 /Height 1157 /ColorSpace /DeviceCMYK /BitsPerComponent 8 >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork detects a spot colour on an image (Separation over DeviceCMYK), decoding its hex-escaped name", async () => {
  // #20 is a hex-escaped space — PDF Name objects escape anything outside
  // the regular-character set this way, so "PANTONE#20186#20C" is the
  // literal on-disk form of "PANTONE 186 C".
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/Separation /PANTONE#20186#20C /DeviceCMYK 12 0 R] >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  // The alternate space is still what colorMode reports — a spot ink is
  // normally defined over a CMYK fallback, and that's still a separate,
  // useful fact from "this file also uses a spot colour".
  assert.equal(info.colorMode, "CMYK");
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

test("parsePdfArtwork collects every name from a DeviceN spot colourant array", async () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/DeviceN [/PANTONE#20186#20C /PANTONE#20Reflex#20Blue#20C] /DeviceCMYK 12 0 R] >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C", "PANTONE Reflex Blue C"]);
});

test("parsePdfArtwork reports an empty spotColors array for a plain process-colour file", async () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceCMYK >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, []);
});

test("parsePdfArtwork finds a spot colour declared in /Resources even when no image uses it (a vector fill)", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] /Resources << /ColorSpace << /CS0 [/Separation /PANTONE#20186#20C /DeviceCMYK 5 0 R] >> >> >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

test("parsePdfArtwork dedupes the same spot colour found both on an image and in /Resources", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] /Resources << /ColorSpace << /CS0 [/Separation /PANTONE#20186#20C /DeviceCMYK 5 0 R] >> >> >>
endobj
2 0 obj
<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/Separation /PANTONE#20186#20C /DeviceCMYK 12 0 R] >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

// ---- parsePdfArtwork: vector colour-mode detection (no image XObject at all) ----

test("parsePdfArtwork detects CMYK from a real Flate-compressed vector content stream", async () => {
  const buf = vectorPdfBuffer({ content: "0 0.55 0.86 0 k\n0 0 200 200 re f" });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork detects RGB from vector fill operators", async () => {
  const buf = vectorPdfBuffer({ content: "1 0 0 rg\n0 0 200 200 re f" });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "RGB");
});

test("parsePdfArtwork detects Gray from vector fill operators when no CMYK/RGB operator is present", async () => {
  const buf = vectorPdfBuffer({ content: "0 g\n0 0 200 200 re f" });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "Gray");
});

test("parsePdfArtwork prefers CMYK over Gray when both appear (e.g. black text alongside a CMYK-filled shape)", async () => {
  const buf = vectorPdfBuffer({ content: "0 g\n0 0.55 0.86 0 k\n0 0 200 200 re f" });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork stays 'unknown' rather than guess when more than one candidate content stream exists", async () => {
  const extra = `3 0 obj
<< /Length 4 /Filter /FlateDecode >>
stream
junk
endstream
endobj`;
  const buf = vectorPdfBuffer({ content: "0 0.55 0.86 0 k\n0 0 200 200 re f", extraObjects: extra });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "unknown");
});

test("parsePdfArtwork stays 'unknown' rather than throw when the sole candidate stream isn't valid deflate data", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 283.5 283.5] /Contents 2 0 R >>
endobj
2 0 obj
<< /Length 11 /Filter /FlateDecode >>
stream
not-deflate!
endstream
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.colorMode, "unknown");
});

test("parsePdfArtwork trusts an already-found image's colour mode over vector content operators", async () => {
  const buf = vectorPdfBuffer({
    content: "0 0.55 0.86 0 k\n0 0 50 50 re f", // CMYK vector fill — should be ignored
    extraObjects: `3 0 obj
<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceRGB >>
endobj`
  });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.colorMode, "RGB");
});

// ---- parsePdfArtwork: ICC profile name extraction ----

test("parsePdfArtwork extracts an ICC profile's description from a v2 textDescriptionType 'desc' tag", async () => {
  const profile = buildIccProfileBytes("ISO Coated v2 (ECI)");
  const buf = iccProfilePdfBuffer(profile);
  const info = await parsePdfArtwork(buf);
  assert.equal(info.iccProfileName, "ISO Coated v2 (ECI)");
});

test("parsePdfArtwork reports no ICC profile when the file never references one", async () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceCMYK >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.iccProfileName, null);
});

test("parsePdfArtwork falls back to a generic message when a profile is found but its 'desc' tag isn't the recognized v2 textDescriptionType", async () => {
  // A v4 profile would typically use 'mluc' (multiLocalizedUnicodeType)
  // here instead — not attempted, per the agreed scope.
  const profile = buildIccProfileBytes("Some Name", { descTypeSig: "mluc" });
  const buf = iccProfilePdfBuffer(profile);
  const info = await parsePdfArtwork(buf);
  assert.equal(info.iccProfileName, "embedded ICC profile (name unavailable)");
});

test("parsePdfArtwork's ICC detection doesn't crash on a Flate stream that isn't actually a valid profile", async () => {
  // /ICCBased is mentioned (so the cheap prefilter doesn't skip this),
  // but the only Flate-compressed non-image stream in the file is a
  // page content stream, not real ICC data — no "acsp" signature.
  const buf = vectorPdfBuffer({
    content: "0 0.55 0.86 0 k\n0 0 50 50 re f",
    extraObjects: `3 0 obj
<< /Type /Page /Resources << /ColorSpace << /CS0 [/ICCBased 9 0 R] >> >> >>
endobj`
  });
  const info = await parsePdfArtwork(buf);
  assert.equal(info.iccProfileName, null);
});

// ---- parsePdfArtwork: PDF/X-3 proxy checks (TrimBox, encryption) ----

test("parsePdfArtwork parses the TrimBox rectangle when present", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 300 300] /TrimBox [10 10 290 290] >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  // TrimBox is 280pt x 280pt -> 280 * 25.4/72 mm.
  assert.ok(Math.abs(info.trimBoxMm.w - (280 * 25.4 / 72)) < 0.01, info.trimBoxMm.w);
  assert.ok(Math.abs(info.trimBoxMm.h - (280 * 25.4 / 72)) < 0.01, info.trimBoxMm.h);
  assert.equal(info.encrypted, false);
});

test("parsePdfArtwork reports no TrimBox when none is present", async () => {
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 300 300] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.trimBoxMm, null);
});

test("parsePdfArtwork's TrimBox rectangle is independent of BleedBox — pageSizeMm prefers BleedBox, trimBoxMm always reads /TrimBox itself", async () => {
  const pt = mm => mm / 25.4 * 72;
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 ${pt(120)} ${pt(120)}] /BleedBox [${pt(7)} ${pt(7)} ${pt(113)} ${pt(113)}] /TrimBox [${pt(10)} ${pt(10)} ${pt(110)} ${pt(110)}] >>\nendobj\n`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 106) < 0.05, info.pageSizeMm.w); // BleedBox
  assert.ok(Math.abs(info.trimBoxMm.w - 100) < 0.05, info.trimBoxMm.w);   // TrimBox itself
});

test("parsePdfArtwork detects encryption via /Encrypt in the trailer", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 300 300] >>
endobj
trailer
<< /Root 1 0 R /Encrypt 5 0 R >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.encrypted, true);
});

// ---- parsePdfArtwork: font-embedding check ----

test("parsePdfArtwork reports no unembedded-font problem when a used font is embedded", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 300 300] >>
endobj
2 0 obj
<< /Type /Font /Subtype /TrueType /BaseFont /ABCDEF+MyFont /FontDescriptor 3 0 R >>
endobj
3 0 obj
<< /Type /FontDescriptor /FontFile2 4 0 R >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.hasUnembeddedFonts, false);
});

test("parsePdfArtwork flags a font used with no embedded font program anywhere in the file", async () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 300 300] >>
endobj
2 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.hasUnembeddedFonts, true);
});

test("parsePdfArtwork reports no font problem for a file with no text at all (nothing to embed)", async () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceCMYK >>`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.hasUnembeddedFonts, false);
});

test("parsePdfArtwork doesn't false-positive on a composite/CID font, whose BaseFont legitimately appears twice for one embedded font program", async () => {
  // A Type0 wrapper and its CIDFontType2 descendant both carry the same
  // /BaseFont value per spec — the normal shape for any modern OpenType
  // export — but there's still only ONE actual embedded font program.
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 300 300] >>
endobj
2 0 obj
<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+MyFont /DescendantFonts [3 0 R] /Encoding /Identity-H >>
endobj
3 0 obj
<< /Type /Font /Subtype /CIDFontType2 /BaseFont /ABCDEF+MyFont /FontDescriptor 4 0 R >>
endobj
4 0 obj
<< /Type /FontDescriptor /FontFile2 5 0 R >>
endobj`;
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.hasUnembeddedFonts, false);
});

// ---- parsePdfArtwork: PDF version ----

test("parsePdfArtwork reads the literal %PDF-X.Y header version", async () => {
  const pdf = "%PDF-1.6\n1 0 obj\n<< /Type /Page /MediaBox [0 0 300 300] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.pdfVersion, "1.6");
});

test("parsePdfArtwork reads PDF/X-3's target version (1.4) the same way", async () => {
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 300 300] >>\nendobj\n";
  const info = await parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.pdfVersion, "1.4");
});

// ---- buildChecklistRows ----
// (parsed, kind, targetMm, trimMm, printCheck, debugMode) — see PRINT_CHECK
// above for the CONFIG.printCheck shape this reads its accepted
// values/severities from.

const CLEAN_PDF_PARSED = {
  pageSizeMm: null, imagePx: { w: 1158, h: 1158 }, declaredDpi: { x: 300, y: 300 }, colorMode: "CMYK",
  spotColors: [], iccProfileName: "ISO Coated v2 (ECI)", pdfVersion: "1.4",
  trimBoxMm: { w: 92, h: 92 }, encrypted: false, hasUnembeddedFonts: false,
};

test("buildChecklistRows shows a single 'File' row for an unreadable file, skipping every check", () => {
  const rows = buildChecklistRows(null, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.deepEqual(rows.map((r) => r.feature), ["File"]);
  assert.equal(rows[0].severity, "error");
  assert.ok(rows[0].detected.includes("could not read"));
  assert.equal(rows[0].expected, null);
});

test("buildChecklistRows shows a distinct message for an unrecognized file kind", () => {
  const rows = buildChecklistRows(null, "unknown", TARGET, TRIM, PRINT_CHECK, false);
  assert.equal(rows[0].severity, "error");
  assert.equal(rows[0].detected, "unrecognized file — expected PDF, JPG, or TIFF");
});

test("buildChecklistRows shows six rows as 'info' for a clean PDF in production — PDF version/Fonts stay hidden (severity 'debug' in PRINT_CHECK)", () => {
  const rows = buildChecklistRows(CLEAN_PDF_PARSED, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.deepEqual(rows.map((r) => r.feature), [
    "Size", "Resolution", "Colour mode", "Colour profile", "TrimBox", "Encryption",
  ]);
  assert.ok(rows.every((r) => r.severity === "info"), JSON.stringify(rows));
  assert.ok(rows.every((r) => r.expected === null), JSON.stringify(rows));
  assert.equal(rows.find((r) => r.feature === "Colour mode").detected, "CMYK");
  assert.equal(rows.find((r) => r.feature === "Colour profile").detected, "ISO Coated v2 (ECI)");
  assert.equal(rows.find((r) => r.feature === "TrimBox").detected, "92.0×92.0mm");
  assert.equal(rows.find((r) => r.feature === "Encryption").detected, "none");
  assert.ok(rows.find((r) => r.feature === "Size").detected.includes("mm"));
  assert.ok(rows.find((r) => r.feature === "Resolution").detected.includes("dpi"));
});

test("buildChecklistRows shows PDF version/Fonts with debugMode, but always as severity 'debug' — text carries the real pass/fail story, not colour", () => {
  const passing = buildChecklistRows(CLEAN_PDF_PARSED, "pdf", TARGET, TRIM, PRINT_CHECK, true);
  assert.deepEqual(passing.find((r) => r.feature === "PDF version"), { feature: "PDF version", severity: "debug", detected: "1.4", expected: null });
  assert.deepEqual(passing.find((r) => r.feature === "Fonts"), { feature: "Fonts", severity: "debug", detected: "embedded", expected: null });

  const failing = { ...CLEAN_PDF_PARSED, pdfVersion: "1.6", hasUnembeddedFonts: true };
  const failingRows = buildChecklistRows(failing, "pdf", TARGET, TRIM, PRINT_CHECK, true);
  assert.deepEqual(failingRows.find((r) => r.feature === "PDF version"), { feature: "PDF version", severity: "debug", detected: "1.6", expected: "1.4" });
  assert.deepEqual(failingRows.find((r) => r.feature === "Fonts"), { feature: "Fonts", severity: "debug", detected: "not embedded", expected: "embedded" });
});

test("buildChecklistRows folds spot colours into the Colour mode row instead of a row of their own", () => {
  const parsed = { ...CLEAN_PDF_PARSED, spotColors: ["PANTONE 186 C"] };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.ok(!rows.some((r) => r.feature.toLowerCase().includes("spot")), rows.map((r) => r.feature).join(","));
  const cm = rows.find((r) => r.feature === "Colour mode");
  assert.equal(cm.detected, "CMYK + Spot Colour (PANTONE 186 C)");
  assert.equal(cm.severity, "info"); // PRINT_CHECK.checks.spotColors.accepted: true
});

test("buildChecklistRows flags spot colours as a warning when the config's spotColors.accepted is false", () => {
  const parsed = { ...CLEAN_PDF_PARSED, spotColors: ["PANTONE 186 C"] };
  const printCheck = { ...PRINT_CHECK, checks: { ...PRINT_CHECK.checks, spotColors: { accepted: false, severity: "warn" } } };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  const cm = rows.find((r) => r.feature === "Colour mode");
  assert.equal(cm.severity, "warn");
  assert.equal(cm.expected, "no spot colour");
});

test("buildChecklistRows uses the strongest severity when colour mode and spot colour both fail", () => {
  const parsed = { ...CLEAN_PDF_PARSED, colorMode: "RGB", spotColors: ["PANTONE 186 C"] };
  const printCheck = {
    ...PRINT_CHECK,
    checks: {
      ...PRINT_CHECK.checks,
      colorMode: { accepted: ["CMYK"], severity: "warn" },
      spotColors: { accepted: false, severity: "error" },
    },
  };
  const row = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false)
    .find((r) => r.feature === "Colour mode");
  assert.equal(row.severity, "error");
  assert.equal(row.expected, "CMYK, no spot colour");
});

test("buildChecklistRows shows a Detected/Expected pair for confirmed problems, using each check's own severity", () => {
  const parsed = {
    ...CLEAN_PDF_PARSED,
    colorMode: "RGB", trimBoxMm: { w: 80, h: 80 }, encrypted: true,
  };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  const byFeature = (f) => rows.find((r) => r.feature === f);

  assert.deepEqual(byFeature("Colour mode"), { feature: "Colour mode", severity: "warn", detected: "RGB", expected: "CMYK" });
  assert.deepEqual(byFeature("TrimBox"), { feature: "TrimBox", severity: "warn", detected: "80.0×80.0mm", expected: "92×92mm" });
  // Encryption is "error" (not "warn") per PRINT_CHECK.checks.encryption —
  // a hard-block row, visible to the customer so they know why sending
  // is blocked (unlike PDF version/Fonts, whose severity is "debug" —
  // see the dedicated debugMode test above for what that means).
  assert.deepEqual(byFeature("Encryption"), { feature: "Encryption", severity: "error", detected: "encrypted", expected: "none" });
});

test("buildChecklistRows uses the config's per-check severity, not a fixed one, for a failing check", () => {
  const parsed = { ...CLEAN_PDF_PARSED, colorMode: "RGB" };
  const printCheck = { ...PRINT_CHECK, checks: { ...PRINT_CHECK.checks, colorMode: { accepted: ["CMYK"], severity: "error" } } };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  assert.equal(rows.find((r) => r.feature === "Colour mode").severity, "error");
});

test("buildChecklistRows hides a check entirely from production — pass or fail — when its config severity is 'debug', and reveals it with debugMode", () => {
  const parsed = { ...CLEAN_PDF_PARSED, encrypted: true }; // encryption fails here, but let's debug-gate it via config
  const printCheck = { ...PRINT_CHECK, checks: { ...PRINT_CHECK.checks, encryption: { severity: "debug" } } };

  const prodRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  assert.ok(!prodRows.some((r) => r.feature === "Encryption"), prodRows.map((r) => r.feature).join(","));

  const debugRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, true);
  assert.deepEqual(debugRows.find((r) => r.feature === "Encryption"), { feature: "Encryption", severity: "debug", detected: "encrypted", expected: "none" });
});

test("buildChecklistRows omits every PDF-only row for JPEG/TIFF (no PDF/X concept applies) — not shown as 'n/a'", () => {
  const parsed = { pageSizeMm: null, imagePx: { w: 1158, h: 1158 }, declaredDpi: { x: 300, y: 300 }, colorMode: "CMYK", spotColors: [], iccProfileName: null, pdfVersion: null, trimBoxMm: null, encrypted: null, hasUnembeddedFonts: null };
  const rows = buildChecklistRows(parsed, "jpeg", TARGET, TRIM, PRINT_CHECK, false);
  assert.deepEqual(rows.map((r) => r.feature), ["Size", "Resolution", "Colour mode"]);
});

test("buildChecklistRows hides genuinely-ambiguous 'not detected' rows in production, shows them with debugMode", () => {
  const parsed = { pageSizeMm: null, imagePx: { w: 1157, h: 1157 }, declaredDpi: null, colorMode: "unknown", spotColors: [], iccProfileName: null, pdfVersion: null, trimBoxMm: null, encrypted: true, hasUnembeddedFonts: false };

  const prodRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.ok(!prodRows.some((r) => r.feature === "Size"), prodRows.map((r) => r.feature).join(","));
  assert.ok(!prodRows.some((r) => r.feature === "Colour mode"), prodRows.map((r) => r.feature).join(","));
  assert.ok(!prodRows.some((r) => r.feature === "Colour profile"), prodRows.map((r) => r.feature).join(","));

  const debugRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, true);
  assert.equal(debugRows.find((r) => r.feature === "Size").severity, "debug");
  assert.equal(debugRows.find((r) => r.feature === "Colour mode").severity, "debug");
  assert.equal(debugRows.find((r) => r.feature === "Colour profile").severity, "debug");
});

test("buildChecklistRows hides a confidently-absent optional TrimBox in production, shows it as 'debug' with debugMode", () => {
  const parsed = { ...CLEAN_PDF_PARSED, trimBoxMm: null };
  const prodRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.ok(!prodRows.some((r) => r.feature === "TrimBox"), prodRows.map((r) => r.feature).join(","));

  const debugRows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, true);
  const trimBox = debugRows.find((r) => r.feature === "TrimBox");
  assert.equal(trimBox.severity, "debug");
  assert.equal(trimBox.detected, "not present");
});

test("buildChecklistRows always flags a missing TrimBox when the config marks it required", () => {
  const parsed = { ...CLEAN_PDF_PARSED, trimBoxMm: null };
  const printCheck = { ...PRINT_CHECK, checks: { ...PRINT_CHECK.checks, trimBox: { required: true, severity: "warn" } } };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  assert.deepEqual(rows.find((r) => r.feature === "TrimBox"), { feature: "TrimBox", severity: "warn", detected: "missing", expected: "present" });
});

test("buildChecklistRows flags a missing colour profile only when the config marks it required", () => {
  const parsed = { ...CLEAN_PDF_PARSED, iccProfileName: null };
  const printCheck = { ...PRINT_CHECK, checks: { ...PRINT_CHECK.checks, colorProfile: { required: true, severity: "warn" } } };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  assert.deepEqual(rows.find((r) => r.feature === "Colour profile"), { feature: "Colour profile", severity: "warn", detected: "none", expected: "required" });
});

test("buildChecklistRows omits the font check when embedding is not required", () => {
  const parsed = { ...CLEAN_PDF_PARSED, hasUnembeddedFonts: true };
  const printCheck = {
    ...PRINT_CHECK,
    checks: {
      ...PRINT_CHECK.checks,
      fonts: { requireEmbedded: false, severity: "warn" },
    },
  };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, printCheck, false);
  assert.equal(rows.some(row => row.feature === "Fonts"), false);
});

test("buildChecklistRows shows resolution as 'n/a (vector)' unconditionally — a known fact, not an uncertainty", () => {
  const parsed = { ...CLEAN_PDF_PARSED, imagePx: null, pageSizeMm: { w: 98, h: 98 } };
  for (const debugMode of [false, true]) {
    const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, debugMode);
    const resolution = rows.find((r) => r.feature === "Resolution");
    assert.equal(resolution.severity, "info");
    assert.equal(resolution.detected, "n/a (vector)");
    assert.equal(resolution.expected, null);
  }
});

test("buildChecklistRows reports and fails the lower Y-axis effective DPI", () => {
  const parsed = {
    ...CLEAN_PDF_PARSED,
    pageSizeMm: null,
    imagePx: { w: 1158, h: 772 },
    declaredDpi: null,
    encrypted: null,
    trimBoxMm: null,
    hasUnembeddedFonts: null,
  };
  const row = buildChecklistRows(parsed, "jpeg", TARGET, TRIM, PRINT_CHECK, false)
    .find((r) => r.feature === "Resolution");
  assert.equal(row.severity, "warn");
  assert.equal(row.detected, "~200dpi");
  assert.equal(row.expected, "≥300dpi");
});

test("buildChecklistRows reports and fails the lower X-axis effective DPI", () => {
  const parsed = {
    ...CLEAN_PDF_PARSED,
    pageSizeMm: { w: 98, h: 98 },
    imagePx: { w: 772, h: 1158 },
  };
  const row = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false)
    .find((r) => r.feature === "Resolution");
  assert.equal(row.severity, "warn");
  assert.equal(row.detected, "~200dpi");
  assert.equal(row.expected, "≥300dpi");
});


// ---- page count ----

function pages(n){
  return Array.from({length: n}, () => ({ widthMm: 100, heightMm: 100, content: "0 0 0 1 k\n" }));
}

test("parsePdfArtwork counts pages of a plain page tree", async () => {
  for(const n of [1, 2, 3]){
    const bytes = buildPdf({ title: "t", pages: pages(n) });
    const info = await parsePdfArtwork(bytes.buffer);
    assert.equal(info.pageCount, n);
  }
});

test("parsePdfArtwork counts pages whose tree sits in a Flate object stream", async () => {
  // PDF 1.5 object stream: "objnum offset" header pairs, then the objects.
  const objs = "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> << /Type /Page /Parent 2 0 R /MediaBox [0 0 283.46 283.46] >> << /Type /Page /Parent 2 0 R >>";
  const header = "2 0 3 49 4 83 ";
  const packed = deflateSync(Buffer.from(header + objs, "latin1"));
  const pdf = concatBytes([
    `%PDF-1.5\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`
    + `5 0 obj\n<< /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length ${packed.length} >>\nstream\n`,
    new Uint8Array(packed),
    "\nendstream\nendobj\n%%EOF\n"
  ]);
  const info = await parsePdfArtwork(pdf);
  assert.equal(info.pageCount, 2);
  assert.equal(Math.round(info.pageSizeMm.w), 100); // page boxes live in the object stream too
});

test("parsePdfArtwork ignores outline /Count and defaults to 1", async () => {
  const pdf = vectorPdfBuffer({ content: "0 0 0 1 k", extraObjects: "3 0 obj\n<< /Type /Outlines /Count -3 >>\nendobj\n" });
  const info = await parsePdfArtwork(pdf);
  assert.equal(info.pageCount, 1);
});

test("buildChecklistRows adds a Pages row only for multi-page files", () => {
  const parsed = { pageSizeMm: TARGET, imagePx: null, declaredDpi: null, colorMode: "CMYK", spotColors: [],
    iccProfileName: null, trimBoxMm: null, encrypted: false, hasUnembeddedFonts: false, pdfVersion: "1.4", pageCount: 2 };
  const rows = buildChecklistRows(parsed, "pdf", TARGET, TRIM, PRINT_CHECK, false, 2);
  assert.deepEqual(rows[0], { feature: "Pages", severity: "info", detected: "2 pages — page 2 used; exact checks at the plant", expected: null });
  const single = buildChecklistRows({ ...parsed, pageCount: 1 }, "pdf", TARGET, TRIM, PRINT_CHECK, false);
  assert.ok(!single.some(row => row.feature === "Pages"));
});

test("pdfPreviewSrc and pageOptionsHtml", () => {
  assert.equal(pdfPreviewSrc("blob:x", 2), "blob:x#toolbar=0&navpanes=0&page=2");
  assert.equal(pageOptionsHtml(3, 2), '<option value="1">1</option><option value="2" selected>2</option><option value="3">3</option>');
});
