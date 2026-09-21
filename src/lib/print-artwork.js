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
//   { pageSizeMm, imagePx, declaredDpi, colorMode, spotColors, iccProfileName }
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

  return { pageSizeMm: null, imagePx: {w:widthPx, h:heightPx}, declaredDpi: dpi, colorMode, spotColors: [], iccProfileName: null };
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
    colorMode,
    spotColors: [],
    iccProfileName: null
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

  return { pageSizeMm, imagePx, declaredDpi: null, colorMode, spotColors, iccProfileName };
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

  // Independent of the CMYK check above — a file can be perfectly valid
  // CMYK and still carry a spot ink, which the plant typically charges
  // extra for (an additional printing plate/pass per spot colour).
  if(parsed.spotColors && parsed.spotColors.length){
    warnings.push(`uses spot colour(s): ${parsed.spotColors.join(", ")} — may incur additional cost, please confirm with the plant`);
  }

  // A label's target is always square (w===h; covers/sleeves/inlays aren't,
  // so this never fires for them). Ratio needs no mm/px/pt conversion —
  // whichever raw dimension pair we have (a vector PDF's MediaBox, or a
  // raster's pixel count) is enough, which matters because a vector PDF's
  // exact physical size is sometimes unreadable (e.g. MediaBox inside a
  // compressed object stream) even though its shape still is. A square
  // result is trusted as correctly sized even when the absolute size
  // above couldn't be independently verified.
  if(targetMm.w === targetMm.h){
    const dims = parsed.pageSizeMm || parsed.imagePx;
    if(dims && dims.h > 0){
      const ratio = dims.w / dims.h;
      if(Math.abs(ratio - 1) > 0.01){
        warnings.push(`not square: ${dims.w.toFixed(1)}×${dims.h.toFixed(1)} (ratio ${ratio.toFixed(2)}:1) — this print needs a 1:1 width:height ratio`);
      }
    }
  }

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
