// Print artwork — pure parsing/validation, no DOM. Shared by every
// artifact that takes a customer-supplied print file (labels, outer
// cover, inner sleeve, inlay). Reads just enough of each file format's
// header structure to check what actually matters for print: physical
// size, resolution, and CMYK vs RGB. Never decodes pixel data — this is
// a front-end sanity check, not the real gate. The studio's backend
// preprocessor does the authoritative validation on upload and rejects
// anything faulty; this only saves customer service a round trip on
// the obvious mistakes.
//
// All three parsers return the same shape (or null if unreadable):
//   { pageSizeMm, imagePx, declaredDpi, colorMode }
// - pageSizeMm  — {w,h} in mm, from a PDF's /MediaBox. null for JPEG/TIFF,
//                 which have no page concept independent of their pixels.
// - imagePx     — {w,h} in pixels, from image dimensions. null for a
//                 vector-only PDF with no raster content found.
// - declaredDpi — {x,y}, only when the file itself states a resolution
//                 (JFIF density, TIFF X/YResolution). PDFs never carry
//                 this — resolution is implied by pixels-vs-page-size.
// - colorMode   — "CMYK" | "RGB" | "Gray" | "unknown"

// ---- format sniffing (magic bytes, not file extension) ----------------

export function sniffFileKind(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength >= 4 &&
     dv.getUint8(0)===0x25 && dv.getUint8(1)===0x50 && dv.getUint8(2)===0x44 && dv.getUint8(3)===0x46){
    return "pdf"; // "%PDF"
  }
  if(dv.byteLength >= 2 && dv.getUint8(0)===0xFF && dv.getUint8(1)===0xD8){
    return "jpeg"; // SOI
  }
  if(dv.byteLength >= 4){
    const b0=dv.getUint8(0), b1=dv.getUint8(1), b2=dv.getUint8(2), b3=dv.getUint8(3);
    if(b0===0x49 && b1===0x49 && b2===0x2A && b3===0x00) return "tiff"; // "II*\0" little-endian
    if(b0===0x4D && b1===0x4D && b2===0x00 && b3===0x2A) return "tiff"; // "MM\0*" big-endian
  }
  return "unknown";
}

// ---- JPEG: walk markers up to the first scan header --------------------
// Only the segments before Start-of-Scan carry what we need (dimensions,
// component count, JFIF density, Adobe color-transform marker) — the
// entropy-coded data after SOS is irrelevant here, so we stop there.

export function parseJpegArtwork(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength < 4 || dv.getUint8(0) !== 0xFF || dv.getUint8(1) !== 0xD8) return null;

  let offset = 2;
  let widthPx = null, heightPx = null, components = null;
  let dpi = null;

  while(offset + 4 <= dv.byteLength){
    if(dv.getUint8(offset) !== 0xFF){ offset++; continue; }
    const marker = dv.getUint8(offset+1);
    if(marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)){ offset += 2; continue; }
    if(marker === 0xD9) break; // EOI

    const segLen = dv.getUint16(offset+2, false);

    const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if(isSof && offset + 9 < dv.byteLength){
      heightPx = dv.getUint16(offset+5, false);
      widthPx  = dv.getUint16(offset+7, false);
      components = dv.getUint8(offset+9);
    } else if(marker === 0xE0 && segLen >= 14){
      const id = String.fromCharCode(
        dv.getUint8(offset+4), dv.getUint8(offset+5), dv.getUint8(offset+6), dv.getUint8(offset+7));
      if(id === "JFIF"){
        const units = dv.getUint8(offset+11); // 0 = aspect ratio only (not absolute), 1 = inch, 2 = cm
        const xd = dv.getUint16(offset+12, false);
        const yd = dv.getUint16(offset+14, false);
        if(units === 1) dpi = {x:xd, y:yd};
        else if(units === 2) dpi = {x:xd*2.54, y:yd*2.54};
      }
    }

    offset += 2 + segLen;
    if(marker === 0xDA) break; // start of scan — no more header info follows
  }

  if(!widthPx || !heightPx) return null;

  let colorMode = "unknown";
  if(components === 1) colorMode = "Gray";
  else if(components === 3) colorMode = "RGB";
  else if(components === 4) colorMode = "CMYK"; // Adobe CMYK/YCCK JPEG — plain baseline JPEG has no 4th channel

  return { pageSizeMm: null, imagePx: {w:widthPx, h:heightPx}, declaredDpi: dpi, colorMode };
}

// ---- TIFF: read the IFD tag directory -----------------------------------
// Tags are readable regardless of how the pixel strips are compressed,
// so this works for every TIFF variant — we just never decode pixels.

const TIFF_TAG = {
  WIDTH: 256, HEIGHT: 257, PHOTOMETRIC: 262, SAMPLES_PER_PIXEL: 277,
  XRESOLUTION: 282, YRESOLUTION: 283, RESOLUTION_UNIT: 296
};

export function parseTiffArtwork(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength < 8) return null;
  const b0 = dv.getUint8(0), b1 = dv.getUint8(1);
  let little;
  if(b0===0x49 && b1===0x49) little = true;
  else if(b0===0x4D && b1===0x4D) little = false;
  else return null;

  const g16 = (o)=> dv.getUint16(o, little);
  const g32 = (o)=> dv.getUint32(o, little);
  const ifdOffset = g32(4);
  if(ifdOffset + 2 > dv.byteLength) return null;

  const count = g16(ifdOffset);
  const tags = {};
  for(let i=0; i<count; i++){
    const entryOff = ifdOffset + 2 + i*12;
    if(entryOff + 12 > dv.byteLength) break;
    tags[g16(entryOff)] = { type: g16(entryOff+2), valueOff: entryOff+8 };
  }

  function tagInt(tagId){
    const t = tags[tagId];
    if(!t) return null;
    if(t.type === 3) return g16(t.valueOff); // SHORT, inline
    if(t.type === 4) return g32(t.valueOff); // LONG, inline
    return null;
  }
  function tagRational(tagId){
    const t = tags[tagId];
    if(!t || t.type !== 5) return null;
    const off = g32(t.valueOff); // RATIONAL is always stored by reference
    if(off + 8 > dv.byteLength) return null;
    const num = g32(off), den = g32(off+4);
    return den ? num/den : null;
  }

  const widthPx = tagInt(TIFF_TAG.WIDTH);
  const heightPx = tagInt(TIFF_TAG.HEIGHT);
  if(!widthPx || !heightPx) return null;

  const photometric = tagInt(TIFF_TAG.PHOTOMETRIC);
  const resUnit = tagInt(TIFF_TAG.RESOLUTION_UNIT) || 2; // default: inch
  let xres = tagRational(TIFF_TAG.XRESOLUTION);
  let yres = tagRational(TIFF_TAG.YRESOLUTION);
  if(resUnit === 3){ // cm -> inch
    if(xres) xres *= 2.54;
    if(yres) yres *= 2.54;
  }

  let colorMode = "unknown";
  if(photometric === 5) colorMode = "CMYK";       // "Separated"
  else if(photometric === 2 || photometric === 6) colorMode = "RGB";
  else if(photometric === 0 || photometric === 1) colorMode = "Gray";

  return {
    pageSizeMm: null,
    imagePx: {w:widthPx, h:heightPx},
    declaredDpi: (xres && yres) ? {x:xres, y:yres} : null,
    colorMode
  };
}

// ---- PDF: brute-force object scan, no decompression ---------------------
// A proper PDF parser needs a cross-reference table (classic or, in
// modern files, a Flate-compressed xref stream) just to find objects,
// then filters to read stream data. We don't need any of that for the
// numbers we actually want: /MediaBox and an image XObject's /Width,
// /Height, /ColorSpace are structural dictionary entries, which press-
// ready PDF/X files (what a pressing plant requires) always keep
// uncompressed for compatibility with older RIPs — so a plain text
// scan for these keys finds them reliably without touching stream
// filters or pixel data at all.
//
// This intentionally never decodes an image's actual pixels — the
// backend preprocessor is the real gate; this only reads dictionary
// keys sitting in the plaintext part of the file.

// Returns the PDF dictionary "<< ... >>" enclosing textIndex, tracking
// << >> nesting depth so a nested subdictionary (e.g. /DecodeParms)
// doesn't get mistaken for the outer dict's closing delimiter.
function dictAround(text, textIndex){
  const start = text.lastIndexOf("<<", textIndex);
  if(start === -1) return null;
  const tokenRe = /<<|>>/g;
  tokenRe.lastIndex = start;
  let depth = 0, m;
  while((m = tokenRe.exec(text)) !== null){
    depth += m[0] === "<<" ? 1 : -1;
    if(depth === 0) return text.slice(start, tokenRe.lastIndex);
  }
  return null; // unbalanced — malformed or truncated file
}

export function parsePdfArtwork(arrayBuffer){
  const bytes = new Uint8Array(arrayBuffer);
  // Latin-1, not UTF-8: PDF structure is always single-byte ASCII even
  // when a stream's binary content isn't, and this keeps string index
  // === byte offset, which the regexes below rely on implicitly.
  let text = "";
  for(let i=0; i<bytes.length; i++) text += String.fromCharCode(bytes[i]);

  const mediaBoxMatch = text.match(/\/MediaBox\s*\[\s*([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s+([\d.+-]+)\s*\]/);
  let pageSizeMm = null;
  if(mediaBoxMatch){
    const x0 = parseFloat(mediaBoxMatch[1]), y0 = parseFloat(mediaBoxMatch[2]);
    const x1 = parseFloat(mediaBoxMatch[3]), y1 = parseFloat(mediaBoxMatch[4]);
    pageSizeMm = { w: Math.abs(x1-x0) * 25.4/72, h: Math.abs(y1-y0) * 25.4/72 };
  }

  // Scan every image XObject dict, not just the first — a real prepress
  // PDF often carries more than one (a soft mask alongside the main
  // artwork, for instance). Keep the largest by pixel area: that's
  // reliably the actual artwork rather than a mask or thumbnail, and
  // picking the wrong one here is exactly what would let a genuinely
  // too-small file slip through unflagged.
  //
  // Each match is scoped to its own enclosing dictionary (nesting-aware,
  // via dictAround below) rather than a fixed-size window around it —
  // a fixed window bleeds into a neighboring image's dict when two sit
  // close together, which would silently read the wrong image's size.
  let imagePx = null;
  let colorMode = "unknown";
  const imageTag = /\/Subtype\s*\/Image/g;
  let match;
  while((match = imageTag.exec(text)) !== null){
    const chunk = dictAround(text, match.index);
    if(!chunk) continue;
    const wMatch = chunk.match(/\/Width\s+(\d+)/);
    const hMatch = chunk.match(/\/Height\s+(\d+)/);
    if(!wMatch || !hMatch) continue;
    const w = parseInt(wMatch[1],10), h = parseInt(hMatch[1],10);
    if(imagePx && w*h <= imagePx.w*imagePx.h) continue;

    imagePx = { w, h };
    if(/\/DeviceCMYK/.test(chunk)) colorMode = "CMYK";
    else if(/\/DeviceRGB/.test(chunk)) colorMode = "RGB";
    else if(/\/DeviceGray/.test(chunk)) colorMode = "Gray";
    else{
      const nMatch = chunk.match(/\/N\s+(\d)/); // ICCBased component count
      const n = nMatch ? parseInt(nMatch[1], 10) : null;
      colorMode = n===4 ? "CMYK" : n===3 ? "RGB" : n===1 ? "Gray" : "unknown";
    }
  }

  if(!pageSizeMm && !imagePx) return null; // nothing usable found — treat as unreadable

  return { pageSizeMm, imagePx, declaredDpi: null, colorMode };
}

// ---- validation ----------------------------------------------------------
// targetMm is {w,h} — labels happen to be square (w===h) but covers,
// sleeves and inlays generally aren't, so this always takes both.

export function validateArtwork(parsed, targetMm, toleranceMm, dpiMin, dpiMax){
  const errors = [];
  const warnings = [];

  if(!parsed){
    errors.push("could not read this file — please check it is a valid PDF, JPG, or TIFF");
    return { errors, warnings, impliedDpi:null, checkedSizeMm:null };
  }

  let impliedDpi = null;
  let checkedSizeMm = null;

  if(parsed.pageSizeMm){
    // PDF: the page itself is the physical artwork canvas.
    checkedSizeMm = parsed.pageSizeMm;
    if(parsed.imagePx && parsed.pageSizeMm.w > 0){
      impliedDpi = parsed.imagePx.w / (parsed.pageSizeMm.w / 25.4);
    }
  } else if(parsed.imagePx){
    // Raster file: the only question that actually matters for print is
    // "does this pixel count support the target size at a usable DPI" —
    // computed from pixel count vs. the target, not from (possibly
    // absent, possibly wrong) embedded metadata.
    impliedDpi = parsed.imagePx.w / (targetMm.w / 25.4);
    if(parsed.declaredDpi){
      // Independent second signal: what physical size the file *claims*
      // to be, from its own declared resolution.
      checkedSizeMm = {
        w: parsed.imagePx.w / parsed.declaredDpi.x * 25.4,
        h: parsed.imagePx.h / parsed.declaredDpi.y * 25.4
      };
    }
  }

  if(checkedSizeMm){
    const dw = Math.abs(checkedSizeMm.w - targetMm.w);
    const dh = Math.abs(checkedSizeMm.h - targetMm.h);
    if(dw > toleranceMm || dh > toleranceMm){
      warnings.push(
        `wrong size: ${checkedSizeMm.w.toFixed(1)}×${checkedSizeMm.h.toFixed(1)}mm, expected ${targetMm.w}×${targetMm.h}mm`);
    }
  } else{
    warnings.push("could not independently verify physical size (no resolution metadata found) — checked by implied resolution only");
  }

  if(impliedDpi != null){
    // Compare the rounded value, not the raw float: a genuine 300dpi
    // file naturally produces pixel counts like 1157px for a 98mm label
    // (98/25.4*300 = 1157.48), which computes back to 299.84dpi — a
    // rounding artifact of integer pixels, not an actually low-res file.
    const rounded = Math.round(impliedDpi);
    if(rounded < dpiMin) warnings.push(`resolution too low for a ${targetMm.w}×${targetMm.h}mm print: ~${rounded} dpi, need at least ${dpiMin}`);
    else if(rounded > dpiMax) warnings.push(`resolution far exceeds requirement: ~${rounded} dpi (max recommended ${dpiMax})`);
  } else{
    warnings.push("vector content — resolution check not applicable");
  }

  if(parsed.colorMode === "unknown") warnings.push("could not determine color mode automatically — please verify CMYK manually");
  else if(parsed.colorMode !== "CMYK") warnings.push(`file appears to be ${parsed.colorMode}, not CMYK`);

  return { errors, warnings, impliedDpi, checkedSizeMm };
}

// ---- print-simulation geometry -------------------------------------------
// Pure geometry only — actual canvas drawing (fillRect/arc/etc.) is DOM
// work and lives in the module.

// Labels: circular trim + centerhole. canvasSizePx is square, matching
// the square data size every label format uses.
export function computePrintSimGeometry(canvasSizePx, dataSizeMm, diameterMm, centerHoleMm){
  const scale = canvasSizePx / dataSizeMm; // px per mm
  return {
    center: canvasSizePx / 2,
    trimRadiusPx: (diameterMm/2) * scale,
    centerHoleRadiusPx: (centerHoleMm/2) * scale
  };
}

// Covers/sleeves/inlay: a plain rectangular trim inset within the flat
// data sheet, centered (bleed is assumed even on every edge, which is
// the standard convention and matches every figure supplied so far —
// including the 7" cover's asymmetric "box" spine, since trim and data
// are both given directly rather than derived from a bleed constant).
export function computeSpreadInsetPx(canvasWidthPx, canvasHeightPx, dataMm, trimMm){
  return {
    x: (canvasWidthPx / dataMm.w) * (dataMm.w - trimMm.w) / 2,
    y: (canvasHeightPx / dataMm.h) * (dataMm.h - trimMm.h) / 2
  };
}
