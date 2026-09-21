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

export function parseWavDuration(arrayBuffer){
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
  if(!sampleRate || !channels || !bitsPerSample || dataSize === null) return null;
  const bytesPerSample = bitsPerSample / 8;
  const duration = dataSize / (sampleRate * channels * bytesPerSample);
  return isFinite(duration) && duration > 0 ? duration : null;
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

export function parseAiffDuration(arrayBuffer){
  const dv = new DataView(arrayBuffer);
  if(dv.byteLength < 12) return null;
  if(dv.getUint32(0, false) !== 0x464F524D) return null; // "FORM"
  const formType = dv.getUint32(8, false);
  if(formType !== 0x41494646 && formType !== 0x41494643) return null; // "AIFF" / "AIFC"

  let offset = 12, sampleRate = null, numFrames = null;
  while(offset + 8 <= dv.byteLength){
    const id = String.fromCharCode(dv.getUint8(offset), dv.getUint8(offset+1), dv.getUint8(offset+2), dv.getUint8(offset+3));
    const size = dv.getUint32(offset+4, false);
    if(id === "COMM"){
      numFrames = dv.getUint32(offset+10, false);
      sampleRate = readExtendedFloat80(dv, offset+16);
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned (padded to even)
    if(sampleRate && numFrames !== null) break;
  }
  if(!sampleRate || numFrames === null) return null;
  const duration = numFrames / sampleRate;
  return isFinite(duration) && duration > 0 ? duration : null;
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

// ---- browser-only: File I/O -----------------------------------------

export function compressionWarning(file){
  return compressionWarningForName(file.name);
}

async function fallbackToWav(file){
  try{
    // RIFF/WAV headers are small — the fmt and data chunk sizes are
    // typically within the first ~1MB even for large recordings.
    const head = await file.slice(0, Math.min(file.size, 1_000_000)).arrayBuffer();
    return parseWavDuration(head);
  }catch(e){
    return null;
  }
}

async function fallbackToAiff(file){
  try{
    const head = await file.slice(0, Math.min(file.size, 1_000_000)).arrayBuffer();
    return parseAiffDuration(head);
  }catch(e){
    return null;
  }
}

function fallbackDuration(file){
  if(/\.wav$/i.test(file.name) || /\.wave$/i.test(file.name)) return fallbackToWav(file);
  if(/\.aiff?$/i.test(file.name) || /\.aifc$/i.test(file.name)) return fallbackToAiff(file);
  return Promise.resolve(null);
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
