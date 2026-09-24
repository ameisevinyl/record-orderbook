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
//   { pageSizeMm, imagePx, declaredDpi, colorMode, spotColors, iccProfileName,
//     trimBoxMm, encrypted, hasUnembeddedFonts, pdfVersion }
// - pageSizeMm  — {w,h} in mm, from a PDF's /BleedBox, /TrimBox, or
//                 /MediaBox (first one present, in that priority order —
//                 see parsePdfArtwork). null for JPEG/TIFF, which have no
//                 page concept independent of their pixels.
// - imagePx     — {w,h} in pixels, from image dimensions. null for a
//                 vector-only PDF with no raster content found.
// - declaredDpi — {x,y}, only when the file itself states a resolution
//                 (JFIF density, TIFF X/YResolution). PDFs never carry
//                 this — resolution is implied by pixels-vs-page-size.
// - colorMode   — "CMYK" | "RGB" | "Gray" | "unknown". For a PDF using a
//                 spot colour (/Separation, /DeviceN), this is still the
//                 declared *alternate* space (normally CMYK) — a separate,
//                 still-useful fact from "this file also uses a spot ink".
// - spotColors  — string[] of decoded spot/Pantone colourant names found
//                 in the file, [] if none. Always [] for JPEG/TIFF, which
//                 have no colour-space concept beyond their raw pixels.
// - iccProfileName — the embedded ICC profile's description (e.g. "ISO
//                 Coated v2 (ECI)"), a generic fallback string when a
//                 profile is found but its name can't be parsed, or
//                 null when there's no profile at all. Always null for
//                 JPEG/TIFF — this file never reads their (much rarer)
//                 embedded-profile markers, only a PDF's /ICCBased.
// - encrypted   — a PDF/X-3 proxy check (see parsePdfArtwork), true/false
//                 for a PDF. null for JPEG/TIFF, which have no PDF/X
//                 concept at all — not false, so buildChecklistRows never
//                 wrongly flags a flat raster upload for something that
//                 was never applicable to begin with.
// - trimBoxMm   — {w,h} in mm, the PDF's own /TrimBox rectangle (the
//                 finished, cut size — see the comment on pageSizeMm's
//                 box priority below), or null when the page declares
//                 no TrimBox at all. Always null for JPEG/TIFF.
// - hasUnembeddedFonts — true when the file uses text but embeds no
//                 font program at all (a heuristic, not a precise
//                 per-font check — see parsePdfArtwork). null for
//                 JPEG/TIFF, same reasoning as the PDF/X checks above.
// - pdfVersion  — the literal "%PDF-X.Y" header version string (e.g.
//                 "1.4"), or null for JPEG/TIFF/an unreadable file.

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
    if(segLen < 2) return null;
    const segmentEnd = offset + 2 + segLen;
    if(segmentEnd > dv.byteLength) return null;

    const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if(isSof && segLen >= 8){
      heightPx = dv.getUint16(offset+5, false);
      widthPx  = dv.getUint16(offset+7, false);
      components = dv.getUint8(offset+9);
      if(segLen < 8 + components * 3) return null;
    } else if(marker === 0xE0 && segLen >= 16){
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

    offset = segmentEnd;
    if(marker === 0xDA) break; // start of scan — no more header info follows
  }

  if(!widthPx || !heightPx) return null;

  let colorMode = "unknown";
  if(components === 1) colorMode = "Gray";
  else if(components === 3) colorMode = "RGB";
  else if(components === 4) colorMode = "CMYK"; // Adobe CMYK/YCCK JPEG — plain baseline JPEG has no 4th channel

  return {
    pageSizeMm: null, imagePx: {w:widthPx, h:heightPx}, declaredDpi: dpi, colorMode, spotColors: [],
    iccProfileName: null, trimBoxMm: null, encrypted: null, hasUnembeddedFonts: null,
    pdfVersion: null
  };
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
  if(g16(2) !== 42) return null;
  const ifdOffset = g32(4);
  if(ifdOffset + 2 > dv.byteLength) return null;

  const count = g16(ifdOffset);
  if(ifdOffset + 2 + count * 12 + 4 > dv.byteLength) return null;
  const tags = {};
  for(let i=0; i<count; i++){
    const entryOff = ifdOffset + 2 + i*12;
    tags[g16(entryOff)] = { type: g16(entryOff+2), count: g32(entryOff+4), valueOff: entryOff+8 };
  }

  function tagInt(tagId){
    const t = tags[tagId];
    if(!t || t.count !== 1) return null;
    if(t.type === 3) return g16(t.valueOff); // SHORT, inline
    if(t.type === 4) return g32(t.valueOff); // LONG, inline
    return null;
  }
  function tagRational(tagId){
    const t = tags[tagId];
    if(!t || t.type !== 5 || t.count !== 1) return null;
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
    colorMode,
    spotColors: [],
    iccProfileName: null,
    trimBoxMm: null,
    encrypted: null,
    hasUnembeddedFonts: null,
    pdfVersion: null
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

// PDF Name objects escape any character outside the regular set as
// #XX (two hex digits) — e.g. a space is #20, so "PANTONE#20186#20C"
// on disk is the name "PANTONE 186 C". Names otherwise read literally.
function decodePdfName(raw){
  return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Finds every /Separation and /DeviceN spot-colourant declaration in a
// chunk of PDF text and returns their decoded names. Both forms are
// colour-space arrays: /Separation carries one name, /DeviceN an array
// of names (a single ink channel can stand in for several colourants).
// Matches anywhere the array is written out inline — same "no cross-
// reference table, no indirect objects" limitation as the rest of this
// file (see its header comment): a /ColorSpace that's only an indirect
// reference (`/ColorSpace 15 0 R`) isn't followed.
const NAME_TOKEN = "\\/([^\\s\\/\\[\\]()<>]+)";
function extractSpotNames(chunk){
  const names = [];
  const sepRe = new RegExp(`\\/Separation\\s+${NAME_TOKEN}`, "g");
  let m;
  while((m = sepRe.exec(chunk)) !== null) names.push(decodePdfName(m[1]));

  const devNRe = new RegExp(`\\/DeviceN\\s*\\[\\s*((?:${NAME_TOKEN}\\s*)+)\\]`, "g");
  while((m = devNRe.exec(chunk)) !== null){
    const nameRe = new RegExp(NAME_TOKEN, "g");
    let nm;
    while((nm = nameRe.exec(m[1])) !== null) names.push(decodePdfName(nm[1]));
  }
  return names;
}

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

// The mirror image of dictAround: given the index of the ">>" that
// closes some dictionary, walks backward token-by-token (depth-
// tracking, same as dictAround) to find the "<<" it matches. Needed to
// find the dict immediately preceding a "stream" keyword — a plain
// text.lastIndexOf("<<", ...) would instead find an already-closed
// nested subdictionary's opener whenever the object contains one
// anywhere earlier (e.g. a /DecodeParms dict), returning just that
// subdictionary's bounds instead of the whole object's.
function dictBefore(text, closeEndIndex){
  const tokenRe = /<<|>>/g;
  const tokens = [];
  let m;
  while((m = tokenRe.exec(text)) !== null){
    if(m.index >= closeEndIndex) break;
    tokens.push({ tok: m[0], index: m.index });
  }
  let depth = 0;
  for(let i = tokens.length - 1; i >= 0; i--){
    depth += tokens[i].tok === ">>" ? 1 : -1;
    if(depth === 0) return text.slice(tokens[i].index, closeEndIndex);
  }
  return null; // unbalanced — malformed or truncated file
}

// PDF's /FlateDecode is zlib-wrapped deflate (RFC 1950) — a zlib header
// plus an Adler-32 trailer around the raw deflate data — unlike a zip
// entry's raw DEFLATE (RFC 1951, see zip.js's inflateRaw), so this
// needs the "deflate" format, not "deflate-raw".
async function inflateFlateDecodeBytes(bytes){
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while(true){
    const { done, value } = await reader.read();
    if(done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  chunks.forEach(c => { out.set(c, o); o += c.length; });
  return out;
}

async function inflateFlateDecodeText(bytes){
  return new TextDecoder("latin1").decode(await inflateFlateDecodeBytes(bytes));
}

// Every Flate-compressed stream in the document that isn't image pixel
// data or another internal PDF structure (a compressed object stream,
// cross-reference stream, or metadata stream) — the shared candidate
// pool detectVectorColorMode and detectIccProfileName both draw from,
// each applying its own policy for how many candidates it trusts.
function findFlateStreamCandidates(text){
  const candidates = [];
  const streamOpenRe = /(>>)\s*stream\r?\n/g;
  let m;
  while((m = streamOpenRe.exec(text)) !== null){
    const dictText = dictBefore(text, m.index + 2);
    if(!dictText) continue;
    if(!/\/FlateDecode\b/.test(dictText)) continue;
    if(/\/Subtype\s*\/Image/.test(dictText)) continue;
    if(/\/Type\s*\/(ObjStm|XRef|Metadata)\b/.test(dictText)) continue;

    const dataStart = streamOpenRe.lastIndex;
    let dataEnd = text.indexOf("endstream", dataStart);
    if(dataEnd === -1) continue;
    // A single EOL conventionally separates the stream data from the
    // "endstream" keyword (PDF spec) — part of the file's framing, not
    // part of the compressed payload, so left in it trips zlib's
    // trailing-data check on an otherwise perfectly valid stream.
    if(text[dataEnd-1] === "\n"){ dataEnd--; if(text[dataEnd-1] === "\r") dataEnd--; }
    candidates.push({ start: dataStart, end: dataEnd });
  }
  return candidates;
}

// True when a bare content-stream operator token appears preceded by a
// number (its last operand) and followed by whitespace/end — e.g. "0 k"
// for a CMYK fill. Content streams are strictly postfix (operands then
// operator), so this is specific enough to trust without a full
// tokenizer, for the single-operator names this file cares about.
function hasContentOperator(content, op){
  return new RegExp(`[\\d.]\\s+${op}(?=[\\s]|$)`, "m").test(content);
}

// Resource-free colour operators only — k/K (CMYK fill/stroke), rg/RG
// (RGB), g/G (Gray). Deliberately not cs/scn with a named resource
// colourspace: resolving one of those means following an indirect
// object reference, exactly the kind of full parsing this file avoids
// everywhere else — and a named colourspace's spot/Pantone use is
// already caught by extractSpotNames above regardless of whether it's
// ever actually painted. CMYK wins if present at all (professional
// tools commonly draw plain black text as "0 g" even in an otherwise
// CMYK-targeted file, so Gray-only doesn't mean "not CMYK" the way it
// would for a raster file).
function vectorColorModeFromOperators(content){
  if(hasContentOperator(content, "k") || hasContentOperator(content, "K")) return "CMYK";
  if(hasContentOperator(content, "rg") || hasContentOperator(content, "RG")) return "RGB";
  if(hasContentOperator(content, "g") || hasContentOperator(content, "G")) return "Gray";
  return "unknown";
}

// Only called when no image XObject was found at all — a pure-vector
// file's colour only shows up as operators inside its (usually
// compressed) page content stream, which this file otherwise never
// touches (see its header comment on avoiding a real object parser).
// Trusted only when the document has exactly one Flate-compressed,
// non-image candidate stream: the common case for simple vector
// artwork. Anything more structurally ambiguous — multiple candidates,
// none at all, a candidate that turns out not to be valid deflate data
// — stays "unknown" rather than risk guessing wrong, which would be
// worse than today's honest "can't tell".
async function detectVectorColorMode(text, bytes){
  const candidates = findFlateStreamCandidates(text);
  if(candidates.length !== 1) return "unknown";

  try{
    const content = await inflateFlateDecodeText(bytes.slice(candidates[0].start, candidates[0].end));
    return vectorColorModeFromOperators(content);
  } catch{
    return "unknown"; // not actually valid deflate data — stay honest, don't guess
  }
}

// Every valid ICC profile carries this ASCII signature ("acsp") at a
// fixed byte offset in its own header (ICC.1:2010 §7.2.15) — checking
// it is what lets this find an embedded profile without resolving the
// /ICCBased N 0 R reference to it, the same indirect-object problem
// this file avoids everywhere else. Unlike detectVectorColorMode, a
// false match here is self-excluding (no signature, no profile — no
// risk of a wrong colour-mode guess), so this doesn't need to stay
// conservative about how many candidate streams exist.
function isIccProfile(bytes){
  return bytes.length >= 132
    && bytes[36]===0x61 && bytes[37]===0x63 && bytes[38]===0x73 && bytes[39]===0x70; // "acsp"
}

function readUint32BE(bytes, offset){
  return (bytes[offset]<<24 | bytes[offset+1]<<16 | bytes[offset+2]<<8 | bytes[offset+3]) >>> 0;
}

// Reads the profile's 'desc' tag and decodes it as a v2 profile's
// textDescriptionType (ICC.1:2001-04 §6.5.17) — an ASCII-count-prefixed
// string, the format the overwhelming majority of real-world print and
// display profiles use (ISO Coated v2, PSO Coated, U.S. Web Coated
// SWOP, sRGB, Adobe RGB...). Returns null — not an error — for anything
// this doesn't recognize: a v4 profile whose 'desc' tag instead uses
// multiLocalizedUnicodeType, a missing tag, or malformed/truncated data.
function iccProfileDescription(bytes){
  if(bytes.length < 132) return null;
  const tagCount = readUint32BE(bytes, 128);
  for(let i=0; i<tagCount; i++){
    const entryOff = 132 + i*12;
    if(entryOff + 12 > bytes.length) break;
    const sig = String.fromCharCode(bytes[entryOff], bytes[entryOff+1], bytes[entryOff+2], bytes[entryOff+3]);
    if(sig !== "desc") continue;

    const dataOff = readUint32BE(bytes, entryOff+4);
    const dataSize = readUint32BE(bytes, entryOff+8);
    if(dataOff + 12 > bytes.length || dataOff + dataSize > bytes.length) return null;

    const typeSig = String.fromCharCode(bytes[dataOff], bytes[dataOff+1], bytes[dataOff+2], bytes[dataOff+3]);
    if(typeSig !== "desc") return null; // e.g. a v4 profile's multiLocalizedUnicodeType — not handled

    const asciiCount = readUint32BE(bytes, dataOff+8); // includes the trailing NUL
    const strStart = dataOff + 12;
    if(asciiCount === 0 || strStart + asciiCount > bytes.length) return null;

    let str = "";
    for(let j=0; j<asciiCount-1; j++) str += String.fromCharCode(bytes[strStart+j]);
    return str.trim() || null;
  }
  return null;
}

// Only bothers scanning at all when /ICCBased appears somewhere in the
// document — cheap enough to always check first, and skips the
// decompress-and-inspect work entirely for the common case of a file
// with no embedded profile at all. Checks every Flate-stream candidate
// (not just one, unlike detectVectorColorMode — see isIccProfile's
// comment on why that's safe here) and keeps the first genuine profile
// found; a print file normally embeds at most one.
async function detectIccProfileName(text, bytes){
  if(!/\/ICCBased\b/.test(text)) return null;

  for(const {start, end} of findFlateStreamCandidates(text)){
    let raw;
    try{ raw = await inflateFlateDecodeBytes(bytes.slice(start, end)); }
    catch{ continue; }
    if(!isIccProfile(raw)) continue;
    return iccProfileDescription(raw) || "embedded ICC profile (name unavailable)";
  }
  return null;
}

export async function parsePdfArtwork(arrayBuffer){
  const bytes = new Uint8Array(arrayBuffer);
  // Latin-1, not UTF-8: PDF structure is always single-byte ASCII even
  // when a stream's binary content isn't, and this keeps string index
  // === byte offset, which the regexes below rely on implicitly. A
  // byte-by-byte fromCharCode loop is orders of magnitude slower (and
  // allocation-heavy) than TextDecoder on a real multi-MB print PDF —
  // WHATWG's "latin1" label actually decodes as windows-1252, which
  // differs from true Latin-1 only in the 0x80-0x9F range (unused C1
  // control codes there, never part of PDF dictionary/keyword syntax)
  // and still preserves the 1-byte-in, 1-code-unit-out mapping this
  // file's index math depends on.
  const text = new TextDecoder("latin1").decode(bytes);

  // A prepress PDF/X export (InDesign/Illustrator with printer marks)
  // sets /MediaBox to the full sheet — slug area and crop marks included.
  // /TrimBox is the cut size WITHOUT bleed; /BleedBox is the cut size
  // WITH bleed. Every caller's targetMm here is dataSizeMm/dataMm —
  // "the full print file size including bleed" (see CLAUDE.md's file
  // naming convention) — so /BleedBox is the correct match, not /TrimBox
  // (which would be smaller than the bleed-inclusive target by exactly
  // the bleed margin on every otherwise-correct professional export).
  // /TrimBox only outranks /MediaBox as a fallback for files that omit
  // /BleedBox — a closer approximation than the full marked-up sheet,
  // even though it'll still read a bit undersized against the target.
  const boxMatch = key => text.match(new RegExp(`\\/${key}\\s*\\[\\s*([\\d.+-]+)\\s+([\\d.+-]+)\\s+([\\d.+-]+)\\s+([\\d.+-]+)\\s*\\]`));
  const pageBoxMatch = boxMatch("BleedBox") || boxMatch("TrimBox") || boxMatch("MediaBox");
  let pageSizeMm = null;
  if(pageBoxMatch){
    const x0 = parseFloat(pageBoxMatch[1]), y0 = parseFloat(pageBoxMatch[2]);
    const x1 = parseFloat(pageBoxMatch[3]), y1 = parseFloat(pageBoxMatch[4]);
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

  // One scan of the whole document, not just the winning image's dict —
  // this is what also catches a spot colour declared for a vector fill
  // via /Resources /ColorSpace, with no image involved at all. Resource
  // dictionaries are always plain, uncompressed objects (unlike page
  // content streams), so this needs no stream decompression either.
  const spotColors = Array.from(new Set(extractSpotNames(text)));

  // No image at all means colorMode is still "unknown" at this point —
  // the only other place colour information can come from is the page
  // content stream itself (vector fills), which does need decompression.
  if(imagePx === null && colorMode === "unknown"){
    colorMode = await detectVectorColorMode(text, bytes);
  }

  const iccProfileName = await detectIccProfileName(text, bytes);

  // PDF/X (what a pressing plant requires — ISO 15930-3:2002, based on
  // PDF 1.4) mandates a TrimBox on every page and no encryption. These
  // are proxy checks, not full conformance validation (see this file's
  // header comment on scope) — a plain presence/rectangle check in the
  // same plaintext structure everything else here already scans, cheap
  // enough to always run.
  const encrypted = /\/Encrypt\b/.test(text);

  // The TrimBox is the finished, cut size (no bleed) — checked against
  // each printable part's own trim size (CONFIG's trimMm/diameterMm),
  // independently of pageSizeMm above (which prefers BleedBox, the
  // bleed-inclusive data size). Same rectangle-parsing regex as
  // pageBoxMatch, just always keyed to /TrimBox specifically rather than
  // whichever box wins that fallback chain.
  const trimBoxRectMatch = boxMatch("TrimBox");
  let trimBoxMm = null;
  if(trimBoxRectMatch){
    const x0 = parseFloat(trimBoxRectMatch[1]), y0 = parseFloat(trimBoxRectMatch[2]);
    const x1 = parseFloat(trimBoxRectMatch[3]), y1 = parseFloat(trimBoxRectMatch[4]);
    trimBoxMm = { w: Math.abs(x1-x0) * 25.4/72, h: Math.abs(y1-y0) * 25.4/72 };
  }

  // A missing font, resolved precisely, would mean following a /Font
  // resource to its /FontDescriptor to its /FontFile* — the same
  // indirect-reference chain this file avoids everywhere else. Counting
  // /BaseFont against /FontFile* occurrences instead is tempting but
  // wrong: a composite/CID font (the default shape for virtually any
  // modern OpenType export) legitimately repeats /BaseFont twice — once
  // on the /Type0 wrapper, once on its descendant CIDFont — for exactly
  // one embedded font program, which would false-positive on the
  // majority of correctly-embedded real-world files. The reliable
  // signal instead: does this document use any font at all, and does
  // it embed *any* font program anywhere? True only when it uses fonts
  // but embeds none whatsoever — coarser (won't catch "3 of 5 fonts
  // embedded"), but doesn't cry wolf on a fine file.
  const usesFonts = /\/BaseFont\b/.test(text);
  const embedsAnyFont = /\/FontFile[0-9]?\b/.test(text);
  const hasUnembeddedFonts = usesFonts && !embedsAnyFont;

  // The literal header bytes every PDF starts with — "%PDF-1.4" etc. —
  // no ambiguity, no indirect reference to resolve.
  const versionMatch = text.match(/%PDF-(\d\.\d)/);
  const pdfVersion = versionMatch ? versionMatch[1] : null;

  return {
    pageSizeMm, imagePx, declaredDpi: null, colorMode, spotColors, iccProfileName,
    trimBoxMm, encrypted, hasUnembeddedFonts, pdfVersion
  };
}

// ---- per-artwork-slot checklist rows (for each module's UI table) -------
// One row per check — Size, Resolution, Colour mode, Colour profile, PDF
// version, TrimBox, Encryption, Fonts — each row reporting
// {feature, severity, detected, expected}: `detected` is always the
// actual value found (or a status word like "present"/"missing"),
// `expected` is only filled in when the row isn't "info" (nothing to
// show past what's already wrong). Spot/Pantone colourants fold into
// the Colour mode row's `detected` text rather than getting a row of
// their own. PDF-only checks (Colour profile, PDF version, TrimBox,
// Encryption, Fonts) are omitted entirely for a JPEG/TIFF upload —
// never shown as "n/a", since that's one more row a customer has to
// read past for no reason.
//
// `targetMm` is the data/bleed size (what Size checks against);
// `trimMm` is the finished cut size (what TrimBox checks against) —
// distinct targets, see package-naming's dataMm-vs-trimMm distinction.
// `printCheck` is a format's CONFIG.printCheck (sizeToleranceMm, dpi,
// and a `checks` map giving each check's accepted values and severity —
// see config.js). Every check is fully specified there; this file never
// defaults a missing config field, matching CLAUDE.md's "trust internal
// code" guidance for data only this codebase ever produces.
//
// Severity is one flat, config-driven vocabulary — "debug" | "info" |
// "warn" | "error" — no separate visibility flag. `resolveSeverity`
// below is the single rule: a check configured "debug" stays "debug"
// regardless of pass/fail (the whole check is plant-technical, never a
// customer's business, win or lose); everything else resolves to "info"
// on pass or to its own configured severity on fail — so a plant can
// turn a check from invisible ("debug") to customer-visible-and-
// dismissible ("warn") to customer-visible-and-blocking ("error") just
// by editing CONFIG, no code change. `pushRow` is what actually keeps a
// "debug" row out of a production customer's checklist: it's the same
// mechanism (still) used for a row with no real pass/fail to report —
// ambiguous detection (size/colour mode/colour profile — we genuinely
// can't tell) or a confidently-absent-but-optional check (TrimBox/
// colour profile when not `required`) — both get severity "debug"
// directly, independent of what the check's own configured severity is.
export const CHECKLIST_ICON = { debug: "?", info: "✓", warn: "⚠", error: "✗" };

function colourModeLabel(mode){
  return mode === "Gray" ? "Greyscale" : mode; // "CMYK"/"RGB" read fine as-is
}

// configSeverity: a check's CONFIG.printCheck.checks.<name>.severity.
// passed: whether this particular row's check succeeded.
function resolveSeverity(configSeverity, passed){
  if(configSeverity === "debug") return "debug";
  return passed ? "info" : configSeverity;
}

const SEVERITY_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

// Only pushes a "debug" row when debugMode is on — this is the sole
// place production visibility is enforced, so every row (regardless of
// why it ended up "debug") goes through it.
function pushRow(rows, debugMode, row){
  if(row.severity === "debug" && !debugMode) return;
  rows.push(row);
}

export function buildChecklistRows(parsed, kind, targetMm, trimMm, printCheck, debugMode){
  if(kind === "unknown"){
    return [{ feature: "File", severity: "error", detected: "unrecognized file — expected PDF, JPG, or TIFF", expected: null }];
  }
  if(!parsed){
    return [{ feature: "File", severity: "error", detected: "could not read this file", expected: null }];
  }

  const rows = [];
  const checks = printCheck.checks;
  const isPdf = parsed.encrypted !== null; // set (true/false) only by parsePdfArtwork

  // ---- Size + implied DPI (from page size for a PDF, from pixel count
  // vs. target for a raster file — see parsePdfArtwork/parseJpegArtwork/
  // parseTiffArtwork's shape comment) ----
  let impliedDpi = null;
  let checkedSizeMm = null;
  if(parsed.pageSizeMm){
    checkedSizeMm = parsed.pageSizeMm;
    if(parsed.imagePx && parsed.pageSizeMm.w > 0 && parsed.pageSizeMm.h > 0){
      impliedDpi = {
        x: parsed.imagePx.w / (parsed.pageSizeMm.w / 25.4),
        y: parsed.imagePx.h / (parsed.pageSizeMm.h / 25.4)
      };
    }
  } else if(parsed.imagePx){
    impliedDpi = {
      x: parsed.imagePx.w / (targetMm.w / 25.4),
      y: parsed.imagePx.h / (targetMm.h / 25.4)
    };
    if(parsed.declaredDpi){
      checkedSizeMm = {
        w: parsed.imagePx.w / parsed.declaredDpi.x * 25.4,
        h: parsed.imagePx.h / parsed.declaredDpi.y * 25.4
      };
    }
  }

  if(checkedSizeMm){
    const passed = Math.abs(checkedSizeMm.w - targetMm.w) <= printCheck.sizeToleranceMm
      && Math.abs(checkedSizeMm.h - targetMm.h) <= printCheck.sizeToleranceMm;
    pushRow(rows, debugMode, {
      feature: "Size", severity: resolveSeverity(checks.size.severity, passed),
      detected: `${checkedSizeMm.w.toFixed(1)}×${checkedSizeMm.h.toFixed(1)}mm`,
      expected: passed ? null : `${targetMm.w}×${targetMm.h}mm`
    });
  } else{
    pushRow(rows, debugMode, { feature: "Size", severity: "debug", detected: "not detected", expected: null });
  }

  if(impliedDpi != null){
    // Compare the rounded value, not the raw float: a genuine 300dpi
    // file naturally produces pixel counts like 1157px for a 98mm label
    // (98/25.4*300 = 1157.48), which computes back to 299.84dpi — a
    // rounding artifact of integer pixels, not an actually low-res file.
    const rounded = Math.round(Math.min(impliedDpi.x, impliedDpi.y));
    const { min, max } = printCheck.dpi;
    const passed = rounded >= min && rounded <= max;
    pushRow(rows, debugMode, {
      feature: "Resolution", severity: resolveSeverity(checks.resolution.severity, passed),
      detected: `~${rounded}dpi`,
      expected: passed ? null : (rounded < min ? `≥${min}dpi` : `≤${max}dpi`)
    });
  } else{
    // Vector content genuinely has no pixel resolution to check — a
    // known, always-relevant fact, not a pass/fail outcome, so this is
    // never gated by config or debugMode.
    rows.push({ feature: "Resolution", severity: "info", detected: "n/a (vector)", expected: null });
  }

  if(parsed.colorMode === "unknown"){
    pushRow(rows, debugMode, { feature: "Colour mode", severity: "debug", detected: "not detected", expected: null });
  } else{
    const modeOk = checks.colorMode.accepted.includes(parsed.colorMode);
    const spotPresent = !!(parsed.spotColors && parsed.spotColors.length);
    const spotOk = checks.spotColors.accepted || !spotPresent;
    const passed = modeOk && spotOk;
    let detected = colourModeLabel(parsed.colorMode);
    if(spotPresent) detected += ` + Spot Colour (${parsed.spotColors.join(", ")})`;
    let expected = null, severity;
    if(passed){
      severity = resolveSeverity(checks.colorMode.severity, true);
    } else{
      const parts = [];
      if(!modeOk) parts.push(checks.colorMode.accepted.join("/"));
      if(!spotOk) parts.push("no spot colour");
      expected = parts.join(", ");
      const failedSeverities = [];
      if(!modeOk) failedSeverities.push(checks.colorMode.severity);
      if(!spotOk) failedSeverities.push(checks.spotColors.severity);
      severity = failedSeverities.reduce((strongest, value) =>
        SEVERITY_RANK[value] > SEVERITY_RANK[strongest] ? value : strongest);
    }
    pushRow(rows, debugMode, { feature: "Colour mode", severity, detected, expected });
  }

  if(isPdf){
    if(parsed.iccProfileName){
      pushRow(rows, debugMode, { feature: "Colour profile", severity: resolveSeverity(checks.colorProfile.severity, true), detected: parsed.iccProfileName, expected: null });
    } else if(checks.colorProfile.required){
      pushRow(rows, debugMode, { feature: "Colour profile", severity: checks.colorProfile.severity, detected: "none", expected: "required" });
    } else{
      // Could be genuinely absent, or an indirect /ICCBased reference
      // the no-object-resolution scan didn't follow — see
      // detectIccProfileName's comment. No way to tell which, and it
      // isn't required anyway, so there's nothing worth a customer's
      // attention either way.
      pushRow(rows, debugMode, { feature: "Colour profile", severity: "debug", detected: "not detected", expected: null });
    }
  }

  // PDF version is always reliably readable (the literal header bytes)
  // for anything that got this far — no ambiguous case here; whether it
  // ever reaches a customer is purely down to checks.pdfVersion.severity.
  if(parsed.pdfVersion){
    const passed = checks.pdfVersion.accepted.includes(parsed.pdfVersion);
    pushRow(rows, debugMode, {
      feature: "PDF version", severity: resolveSeverity(checks.pdfVersion.severity, passed),
      detected: parsed.pdfVersion, expected: passed ? null : checks.pdfVersion.accepted.join("/")
    });
  }

  // TrimBox is a size check against the part's finished trim size, not
  // a mere presence check — a missing TrimBox isn't itself a problem
  // (an "extra", not a requirement, unless a plant opts in via
  // checks.trimBox.required), so it stays "debug" (hidden in
  // production) when absent rather than warning like a real failure.
  if(isPdf){
    if(parsed.trimBoxMm){
      const passed = Math.abs(parsed.trimBoxMm.w - trimMm.w) <= printCheck.sizeToleranceMm
        && Math.abs(parsed.trimBoxMm.h - trimMm.h) <= printCheck.sizeToleranceMm;
      pushRow(rows, debugMode, {
        feature: "TrimBox", severity: resolveSeverity(checks.trimBox.severity, passed),
        detected: `${parsed.trimBoxMm.w.toFixed(1)}×${parsed.trimBoxMm.h.toFixed(1)}mm`,
        expected: passed ? null : `${trimMm.w}×${trimMm.h}mm`
      });
    } else if(checks.trimBox.required){
      pushRow(rows, debugMode, { feature: "TrimBox", severity: checks.trimBox.severity, detected: "missing", expected: "present" });
    } else{
      pushRow(rows, debugMode, { feature: "TrimBox", severity: "debug", detected: "not present", expected: null });
    }
  }

  // Whether an encrypted file blocks sending is controlled by the
  // configured severity consumed by each artwork module's issue status.
  if(isPdf){
    const passed = !parsed.encrypted;
    pushRow(rows, debugMode, {
      feature: "Encryption", severity: resolveSeverity(checks.encryption.severity, passed),
      detected: parsed.encrypted ? "encrypted" : "none", expected: passed ? null : "none"
    });
  }

  if(checks.fonts.requireEmbedded && parsed.hasUnembeddedFonts !== null){
    const passed = !parsed.hasUnembeddedFonts;
    pushRow(rows, debugMode, {
      feature: "Fonts", severity: resolveSeverity(checks.fonts.severity, passed),
      detected: passed ? "embedded" : "not embedded", expected: passed ? null : "embedded"
    });
  }

  return rows;
}

