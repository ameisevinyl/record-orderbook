// Duration reading — native <audio> metadata first; for WAV/AIFF files
// the browser can't read (24/32-bit float PCM, odd chunk order, very
// large files) fall back to a hand-rolled header parse. No library
// needed — both containers are simple enough to read directly, which
// also avoids a CDN dependency.
//
// The header-parsing functions (parseWavDuration, parseAiffDuration,
// readExtendedFloat80, compressionWarningForName) are pure — they take
// an ArrayBuffer/string and return a value, no DOM. Everything else in
// this file touches File/Blob/<audio> and is browser-only.

// ---- pure: WAV -------------------------------------------------------

// Walks a WAV file's RIFF chunks once — duration and the spec-checklist
// metadata (parseWavSpec, below) both read from this single parse, so
// the chunk-walking logic exists in exactly one place. Any field is
// null if its chunk wasn't found.
function parseWavChunks(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength < 12) return null;
  if(dv.getUint32(0, false) !== 0x52494646) return null; // "RIFF"
  if(dv.getUint32(8, false) !== 0x57415645) return null; // "WAVE"

  let offset = 12, sampleRate = null, channels = null, bitsPerSample = null, dataSize = null;
  while(offset + 8 <= dv.byteLength){
    const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
    const size = dv.getUint32(offset+4, true);
    if(id === "fmt "){
      channels = dv.getUint16(offset+10, true);
      sampleRate = dv.getUint32(offset+12, true);
      bitsPerSample = dv.getUint16(offset+22, true);
    } else if(id === "data"){
      // actual data chunk may extend beyond our slice — read its
      // declared size from the header, not from arrayBuffer.byteLength
      dataSize = size;
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
    if(sampleRate && dataSize !== null) break;
  }
  return { sampleRate, channels, bitsPerSample, dataSize };
}

export function parseWavDuration(arrayBuffer){
  const meta = parseWavChunks(arrayBuffer);
  if(!meta || !meta.sampleRate || !meta.channels || !meta.bitsPerSample || meta.dataSize === null) return null;
  const bytesPerSample = meta.bitsPerSample / 8;
  const duration = meta.dataSize / (meta.sampleRate * meta.channels * bytesPerSample);
  return isFinite(duration) && duration > 0 ? duration : null;
}

// Sample rate/channels/bit depth only — used by the audio Specifications
// checklist (audioSpecWarning, below), not by duration reading.
export function parseWavSpec(arrayBuffer){
  const meta = parseWavChunks(arrayBuffer);
  if(!meta || !meta.sampleRate || !meta.bitsPerSample) return null;
  return { sampleRate: meta.sampleRate, channels: meta.channels, bitsPerSample: meta.bitsPerSample };
}

// ---- pure: AIFF --------------------------------------------------------

// Reads an 80-bit IEEE-754 "extended" float (big-endian), as used for
// the sample rate in an AIFF COMM chunk.
export function readExtendedFloat80(dv, offset){
  const expSign = dv.getUint16(offset, false);
  const hi = dv.getUint32(offset+2, false);
  const lo = dv.getUint32(offset+6, false);
  const sign = (expSign & 0x8000) ? -1 : 1;
  const exponent = (expSign & 0x7FFF) - 16383;
  const mantissa = hi * Math.pow(2,32) + lo; // 64-bit integer part, MSB is the explicit integer bit
  if(exponent === -16383 && mantissa === 0) return 0;
  return sign * (mantissa / Math.pow(2,63)) * Math.pow(2, exponent);
}

// Walks an AIFF/AIFC file's chunks once — duration and the
// spec-checklist metadata (parseAiffSpec, below) both read from this
// single parse. COMM chunk data layout: channels(2) + numFrames(4) +
// bitsPerSample(2) + sampleRate(10, extended float80).
function parseAiffChunks(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength < 12) return null;
  if(dv.getUint32(0, false) !== 0x464F524D) return null; // "FORM"
  const formType = dv.getUint32(8, false);
  if(formType !== 0x41494646 && formType !== 0x41494643) return null; // "AIFF" / "AIFC"

  let offset = 12, sampleRate = null, numFrames = null, channels = null, bitsPerSample = null;
  while(offset + 8 <= dv.byteLength){
    const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
    const size = dv.getUint32(offset+4, false);
    if(id === "COMM"){
      channels = dv.getUint16(offset+8, false);
      numFrames = dv.getUint32(offset+10, false);
      bitsPerSample = dv.getUint16(offset+14, false);
      sampleRate = readExtendedFloat80(dv, offset+16);
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned (padded to even)
    if(sampleRate && numFrames !== null) break;
  }
  return { sampleRate, numFrames, channels, bitsPerSample };
}

export function parseAiffDuration(arrayBuffer){
  const meta = parseAiffChunks(arrayBuffer);
  if(!meta || !meta.sampleRate || meta.numFrames === null) return null;
  const duration = meta.numFrames / meta.sampleRate;
  return isFinite(duration) && duration > 0 ? duration : null;
}

// Sample rate/channels/bit depth only — used by the audio Specifications
// checklist (audioSpecWarning, below), not by duration reading.
export function parseAiffSpec(arrayBuffer){
  const meta = parseAiffChunks(arrayBuffer);
  if(!meta || !meta.sampleRate || !meta.bitsPerSample) return null;
  return { sampleRate: Math.round(meta.sampleRate), channels: meta.channels, bitsPerSample: meta.bitsPerSample };
}

// ---- pure: uncompressed-format check ------------------------------
// Customer service should only be handing off WAV/AIFF/BWF to the
// cutting engineer, never lossy or lossless-compressed containers.

export const UNCOMPRESSED_EXT = new Set(["wav","wave","bwf","aif","aiff","aifc"]);

export function compressionWarningForName(name){
  const m = name.match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : "";
  if(UNCOMPRESSED_EXT.has(ext)) return null;
  return `⚠ .${ext || "?"} looks compressed — please only send uncompressed audio files (WAV or AIFF).`;
}

// ---- pure: audio Specifications checklist -----------------------------

// Compares a parsed {sampleRate, bitsPerSample} (from parseWavSpec/
// parseAiffSpec) against CONFIG.audioSpec's minimums. Returns null when
// everything passes, or spec couldn't be read at all (nothing to warn
// about beyond what compressionWarning already flags) — else a short
// message for the same inline ⚠ slot compressionWarning uses.
// 44100 -> "44.1kHz", 48000 -> "48kHz", 22050 -> "22.05kHz" — up to two
// decimals, no trailing zeros.
function khz(hz){
  return (hz / 1000).toFixed(2).replace(/\.?0+$/, "") + "kHz";
}

export function audioSpecWarning(spec, audioSpec){
  if(!spec) return null;
  const below = [];
  if(spec.bitsPerSample && spec.bitsPerSample < audioSpec.minBitDepth){
    below.push(`${spec.bitsPerSample}-bit (min ${audioSpec.minBitDepth}-bit)`);
  }
  if(spec.sampleRate && spec.sampleRate < audioSpec.minSampleRateHz){
    below.push(`${khz(spec.sampleRate)} (min ${khz(audioSpec.minSampleRateHz)})`);
  }
  if(!below.length) return null;
  return `⚠ below spec: ${below.join(", ")}`;
}

// ---- browser-only: File I/O -----------------------------------------

export function compressionWarning(file){
  return compressionWarningForName(file.name);
}

// "wav" | "aiff" | null — shared by fallbackDuration (below) and
// readAudioSpec, so the extension dispatch lives in exactly one place.
function containerFromName(name){
  if(/\.wav$/i.test(name) || /\.wave$/i.test(name)) return "wav";
  if(/\.aiff?$/i.test(name) || /\.aifc$/i.test(name)) return "aiff";
  return null;
}

async function readHead(file){
  // RIFF/WAV and AIFF headers are small — the chunks these parsers need
  // are typically within the first ~1MB even for large recordings.
  return file.slice(0, Math.min(file.size, 1_000_000)).arrayBuffer();
}

async function fallbackToWav(file){
  try{ return parseWavDuration(await readHead(file)); }
  catch(e){ return null; }
}

async function fallbackToAiff(file){
  try{ return parseAiffDuration(await readHead(file)); }
  catch(e){ return null; }
}

function fallbackDuration(file){
  const container = containerFromName(file.name);
  if(container === "wav") return fallbackToWav(file);
  if(container === "aiff") return fallbackToAiff(file);
  return Promise.resolve(null);
}

// Always attempts a header parse (unlike readAudioDuration below, which
// only falls back to one when native <audio> metadata already failed) —
// bit depth/sample rate aren't exposed by <audio> at all, so this is the
// only way to get them. Returns null for a non-WAV/AIFF file or an
// unparseable header.
export async function readAudioSpec(file){
  const container = containerFromName(file.name);
  if(!container) return null;
  try{
    const head = await readHead(file);
    return container === "wav" ? parseWavSpec(head) : parseAiffSpec(head);
  }catch(e){
    return null;
  }
}

export function readAudioDuration(file){
  return new Promise((resolve)=>{
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const url = URL.createObjectURL(file);
    audio.src = url;
    const done = (dur)=>{ URL.revokeObjectURL(url); resolve(dur); };
    audio.addEventListener("loadedmetadata", ()=>{
      if(isFinite(audio.duration) && audio.duration > 0) done(audio.duration);
      else fallbackDuration(file).then(done);
    });
    audio.addEventListener("error", ()=> fallbackDuration(file).then(done));
  });
}
