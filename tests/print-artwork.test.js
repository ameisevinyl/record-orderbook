import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffFileKind,
  parseJpegArtwork,
  parseTiffArtwork,
  parsePdfArtwork,
  validateArtwork,
  computePrintSimGeometry,
  computeSpreadInsetPx,
} from "../src/lib/print-artwork.js";

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

// ---- parsePdfArtwork ----

test("parsePdfArtwork reads MediaBox in points and converts to mm", () => {
  // 98mm x 98mm = 277.795... x 277.795... pt
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 277.8 277.8] >>\nendobj\n";
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 98) < 0.05);
  assert.ok(Math.abs(info.pageSizeMm.h - 98) < 0.05);
});

test("parsePdfArtwork prefers BleedBox over TrimBox and MediaBox — targetMm is always the bleed-inclusive dataSizeMm/dataMm, not the trim size", () => {
  // MediaBox is the full sheet with crop marks (~120mm); TrimBox is the
  // cut size WITHOUT bleed (98mm); BleedBox is the cut size WITH bleed
  // (104mm) — the one every caller's targetMm actually matches.
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 340.2 340.2] /TrimBox [21.2 21.2 299 299] /BleedBox [12.8 12.8 307.603 307.603] >>\nendobj\n";
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 104) < 0.05, info.pageSizeMm.w);
  assert.ok(Math.abs(info.pageSizeMm.h - 104) < 0.05, info.pageSizeMm.h);
});

test("parsePdfArtwork falls back to TrimBox over MediaBox when there's no BleedBox", () => {
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 340.2 340.2] /TrimBox [21.2 21.2 299 299] >>\nendobj\n";
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(info.pageSizeMm.w - 98) < 0.05, info.pageSizeMm.w);
});

test("parsePdfArtwork + validateArtwork: a correctly-bled prepress export doesn't false-flag as wrong size", () => {
  // Regression case: MediaBox 120mm (crop marks), BleedBox 106mm
  // (matches a 12\" label's dataSizeMm exactly), TrimBox 100mm (matches
  // its diameterMm) — BleedBox must win, or this reads as 100mm and
  // wrongly warns against the 106mm target.
  const pt = mm => mm / 25.4 * 72;
  const pdf = `%PDF-1.4\n1 0 obj\n<< /Type /Page /MediaBox [0 0 ${pt(120)} ${pt(120)}] /BleedBox [${pt(7)} ${pt(7)} ${pt(113)} ${pt(113)}] /TrimBox [${pt(10)} ${pt(10)} ${pt(110)} ${pt(110)}] >>\nendobj\n`;
  const parsed = parsePdfArtwork(pdfBuffer(pdf));
  assert.ok(Math.abs(parsed.pageSizeMm.w - 106) < 0.05, parsed.pageSizeMm.w);
  const result = validateArtwork(parsed, { w: 106, h: 106 }, 0.5, 300, 1200);
  assert.ok(!result.warnings.some(w => w.includes("wrong size")), result.warnings.join("; "));
});

test("parsePdfArtwork finds an embedded image XObject's size and CMYK colorspace", () => {
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
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork detects RGB via /DeviceRGB", () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceRGB >>`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.equal(info.colorMode, "RGB");
});

test("parsePdfArtwork returns null when neither MediaBox nor an image is found", () => {
  assert.equal(parsePdfArtwork(pdfBuffer("%PDF-1.4\nnothing useful here\n")), null);
});

test("parsePdfArtwork picks the largest image when a PDF has more than one (e.g. a soft mask)", () => {
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
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.imagePx, { w: 1157, h: 1157 });
  assert.equal(info.colorMode, "CMYK");
});

test("parsePdfArtwork detects a spot colour on an image (Separation over DeviceCMYK), decoding its hex-escaped name", () => {
  // #20 is a hex-escaped space — PDF Name objects escape anything outside
  // the regular-character set this way, so "PANTONE#20186#20C" is the
  // literal on-disk form of "PANTONE 186 C".
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/Separation /PANTONE#20186#20C /DeviceCMYK 12 0 R] >>`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  // The alternate space is still what colorMode reports — a spot ink is
  // normally defined over a CMYK fallback, and that's still a separate,
  // useful fact from "this file also uses a spot colour".
  assert.equal(info.colorMode, "CMYK");
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

test("parsePdfArtwork collects every name from a DeviceN spot colourant array", () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/DeviceN [/PANTONE#20186#20C /PANTONE#20Reflex#20Blue#20C] /DeviceCMYK 12 0 R] >>`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C", "PANTONE Reflex Blue C"]);
});

test("parsePdfArtwork reports an empty spotColors array for a plain process-colour file", () => {
  const pdf = `<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace /DeviceCMYK >>`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, []);
});

test("parsePdfArtwork finds a spot colour declared in /Resources even when no image uses it (a vector fill)", () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] /Resources << /ColorSpace << /CS0 [/Separation /PANTONE#20186#20C /DeviceCMYK 5 0 R] >> >> >>
endobj`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

test("parsePdfArtwork dedupes the same spot colour found both on an image and in /Resources", () => {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Page /MediaBox [0 0 277.8 277.8] /Resources << /ColorSpace << /CS0 [/Separation /PANTONE#20186#20C /DeviceCMYK 5 0 R] >> >> >>
endobj
2 0 obj
<< /Type /XObject /Subtype /Image /Width 500 /Height 500 /ColorSpace [/Separation /PANTONE#20186#20C /DeviceCMYK 12 0 R] >>
endobj`;
  const info = parsePdfArtwork(pdfBuffer(pdf));
  assert.deepEqual(info.spotColors, ["PANTONE 186 C"]);
});

// ---- validateArtwork ----

const TARGET = {w:98, h:98}, TOL = 0.5, DPI_MIN = 300, DPI_MAX = 1200;

test("validateArtwork accepts a correctly sized, correctly resolved CMYK raster file", () => {
  const parsed = {
    pageSizeMm: null,
    imagePx: { w: 1158, h: 1158 }, // ~98mm @ 300dpi (98/25.4*300 = 1157.48, rounded up)
    declaredDpi: { x: 300, y: 300 },
    colorMode: "CMYK",
  };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test("validateArtwork flags a size mismatch from declared DPI", () => {
  const parsed = {
    pageSizeMm: null,
    imagePx: { w: 900, h: 900 },
    declaredDpi: { x: 300, y: 300 }, // -> ~76mm, not 98mm
    colorMode: "CMYK",
  };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("wrong size")));
});

test("validateArtwork does not false-positive on a genuine ~300dpi file (integer-pixel rounding)", () => {
  // 98mm @ 300dpi = 1157.48px -> a real export rounds this down to 1157,
  // which computes back to 299.84dpi. That must not read as "too low".
  const parsed = { pageSizeMm: null, imagePx: { w: 1157, h: 1157 }, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(!result.warnings.some((w) => w.includes("too low")), result.warnings.join("; "));
});

test("validateArtwork flags resolution below the configured minimum", () => {
  const parsed = {
    pageSizeMm: null,
    imagePx: { w: 500, h: 500 }, // implied dpi for 98mm target is well under 300
    declaredDpi: null,
    colorMode: "CMYK",
  };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("too low")));
});

test("validateArtwork flags resolution above the configured maximum", () => {
  const parsed = {
    pageSizeMm: null,
    imagePx: { w: 6000, h: 6000 },
    declaredDpi: null,
    colorMode: "CMYK",
  };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("exceeds")));
});

test("validateArtwork warns on RGB instead of CMYK", () => {
  const parsed = { pageSizeMm: null, imagePx: { w: 1157, h: 1157 }, declaredDpi: { x: 300, y: 300 }, colorMode: "RGB" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("RGB")));
});

test("validateArtwork warns about spot colours, naming them, when spotColors is non-empty", () => {
  const parsed = { pageSizeMm: null, imagePx: { w: 1157, h: 1157 }, declaredDpi: { x: 300, y: 300 }, colorMode: "CMYK", spotColors: ["PANTONE 186 C"] };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  const w = result.warnings.find((w) => w.includes("spot colour"));
  assert.ok(w, result.warnings.join("; "));
  assert.ok(w.includes("PANTONE 186 C"));
});

test("validateArtwork doesn't warn about spot colours for a plain process-colour file (spotColors absent or empty)", () => {
  const withoutField = { pageSizeMm: null, imagePx: { w: 1157, h: 1157 }, declaredDpi: { x: 300, y: 300 }, colorMode: "CMYK" };
  const withEmptyArray = { ...withoutField, spotColors: [] };
  for (const parsed of [withoutField, withEmptyArray]) {
    const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
    assert.ok(!result.warnings.some((w) => w.includes("spot colour")), result.warnings.join("; "));
  }
});

test("validateArtwork treats vector PDFs (page size, no image) as resolution n/a", () => {
  const parsed = { pageSizeMm: { w: 98, h: 98 }, imagePx: null, declaredDpi: null, colorMode: "unknown" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("not applicable")));
  assert.ok(result.warnings.some((w) => w.includes("verify CMYK manually")));
  assert.equal(result.checkedSizeMm.w, 98);
});

test("validateArtwork flags an unreadable file as an error", () => {
  const result = validateArtwork(null, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.errors.some((e) => e.includes("could not read")));
});

test("validateArtwork supports a non-square (rectangular) target, e.g. a cover flat spread", () => {
  // 7" cover data size, from a PDF whose MediaBox matches exactly.
  const targetMm = { w: 383, h: 201 };
  const parsed = { pageSizeMm: { w: 383, h: 201 }, imagePx: null, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, targetMm, TOL, DPI_MIN, DPI_MAX);
  assert.ok(!result.warnings.some((w) => w.includes("wrong size")), result.warnings.join("; "));
});

test("validateArtwork flags a non-square vector PDF for a square (label) target", () => {
  // MediaBox readable, but not square — a genuine crop mistake.
  const parsed = { pageSizeMm: { w: 98, h: 90 }, imagePx: null, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("not square")), result.warnings.join("; "));
});

test("validateArtwork does not flag a square vector PDF even when absolute size can't be verified", () => {
  // Same shape as "validateArtwork treats vector PDFs... as resolution n/a"
  // above (pageSizeMm read successfully and square) — ratio check must
  // stay silent, size is trusted from shape alone.
  const parsed = { pageSizeMm: { w: 98, h: 98 }, imagePx: null, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(!result.warnings.some((w) => w.includes("not square")), result.warnings.join("; "));
});

test("validateArtwork's ratio check falls back to imagePx when a PDF's page size couldn't be read (e.g. MediaBox in a compressed object stream)", () => {
  const parsed = { pageSizeMm: null, imagePx: { w: 1000, h: 800 }, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, TARGET, TOL, DPI_MIN, DPI_MAX);
  assert.ok(result.warnings.some((w) => w.includes("not square")), result.warnings.join("; "));
});

test("validateArtwork's ratio check never fires for a non-square target (covers/sleeves/inlays)", () => {
  const targetMm = { w: 383, h: 201 };
  const parsed = { pageSizeMm: { w: 383, h: 201 }, imagePx: null, declaredDpi: null, colorMode: "CMYK" };
  const result = validateArtwork(parsed, targetMm, TOL, DPI_MIN, DPI_MAX);
  assert.ok(!result.warnings.some((w) => w.includes("not square")), result.warnings.join("; "));
});

// ---- computePrintSimGeometry ----

test("computePrintSimGeometry scales mm measurements into canvas pixels", () => {
  const geo = computePrintSimGeometry(220, 98, 92, 7.4);
  assert.equal(geo.center, 110);
  // 220px / 98mm = ~2.2449 px/mm
  assert.ok(Math.abs(geo.trimRadiusPx - (46 * (220/98))) < 1e-9);
  assert.ok(Math.abs(geo.centerHoleRadiusPx - (3.7 * (220/98))) < 1e-9);
});

// ---- computeSpreadInsetPx ----

test("computeSpreadInsetPx centers a square trim within a square data sheet", () => {
  // 7" inlay: data 187x187, trim 181x181 -> 3mm bleed each side.
  const inset = computeSpreadInsetPx(374, 374, { w: 187, h: 187 }, { w: 181, h: 181 });
  assert.ok(Math.abs(inset.x - 6) < 1e-9); // 3mm * (374/187 px-per-mm = 2) = 6px
  assert.ok(Math.abs(inset.y - 6) < 1e-9);
});

test("computeSpreadInsetPx handles a non-square flat spread (cover with spine)", () => {
  // 7" cover: data 383x201, trim 185x185 (the "box" spine skews width vs height differently).
  const dataMm = { w: 383, h: 201 }, trimMm = { w: 185, h: 185 };
  const inset = computeSpreadInsetPx(383, 201, dataMm, trimMm); // 1 canvas px per mm, for easy arithmetic
  assert.ok(Math.abs(inset.x - (383-185)/2) < 1e-9);
  assert.ok(Math.abs(inset.y - (201-185)/2) < 1e-9);
});
