// Minimal classic-ZIP writer (store method -- no compression), no dependencies.
// buildZipBytes() is pure (Uint8Array in, Uint8Array out); buildZip() builds a
// Blob from parts so the complete package is not copied into another byte array.

const CRC_TABLE = (()=>{
  const t = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c = n;
    for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    t[n] = c >>> 0;
  }
  return t;
})();

const ZIP_UTF8 = 0x0800;
const ZIP_DATA_DESCRIPTOR = 0x0008;
const ZIP_MAX_U16 = 0xFFFF;
const ZIP_MAX_U32 = 0xFFFFFFFF;
const ZIP_MAX_CLASSIC_U32 = 0xFFFFFFFE; // 0xFFFFFFFF is the ZIP64 sentinel.
const CP437_HIGH =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌" +
  "█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

function crc32Update(c, bytes){
  for(let i=0;i<bytes.length;i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return c;
}

export function crc32(bytes){
  return (crc32Update(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;
}

function u16(n){ return new Uint8Array([n & 0xFF, (n>>>8) & 0xFF]); }
function u32(n){ return new Uint8Array([n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]); }

export function concatBytes(arrs){
  let len = 0;
  arrs.forEach(a => {
    len += a.length;
    if(!Number.isSafeInteger(len)) throw new Error("byte array is too large");
  });
  const out = new Uint8Array(len);
  let o = 0; arrs.forEach(a=>{ out.set(a, o); o += a.length; });
  return out;
}

function dataBytes(data){
  if(data instanceof ArrayBuffer) return new Uint8Array(data);
  if(ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError("zip entry data must be an ArrayBuffer or typed array");
}

function checkedSize(n, max, what){
  if(!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error(`${what} exceeds the classic ZIP limit`);
  return n;
}

function prepareEntries(files, sizeOf){
  if(!Array.isArray(files)) throw new TypeError("zip files must be an array");
  checkedSize(files.length, ZIP_MAX_U16, "zip entry count");
  const enc = new TextEncoder();
  const names = new Set();
  const entries = files.map((file, i) => {
    if(!file || typeof file.name !== "string") throw new TypeError(`zip entry ${i + 1} has no valid name`);
    if(names.has(file.name)) throw new Error(`duplicate zip entry name: ${file.name}`);
    names.add(file.name);
    const nameBytes = enc.encode(file.name);
    checkedSize(nameBytes.length, ZIP_MAX_U16, `${file.name || `zip entry ${i + 1}`} name`);
    return {file, nameBytes, size: checkedSize(sizeOf(file.data), ZIP_MAX_CLASSIC_U32, `${file.name} data`), offset: 0};
  });

  let offset = 0;
  let centralSize = 0;
  for(const entry of entries){
    entry.offset = offset;
    offset = checkedSize(offset + 30 + entry.nameBytes.length + entry.size, ZIP_MAX_CLASSIC_U32, "central directory offset");
    centralSize = checkedSize(centralSize + 46 + entry.nameBytes.length, ZIP_MAX_CLASSIC_U32, "central directory size");
  }
  return {entries, centralStart: offset, centralSize};
}

function localHeader(entry, crc){
  return concatBytes([
    u32(0x04034b50), u16(20), u16(ZIP_UTF8), u16(0), u16(0), u16(0),
    u32(crc), u32(entry.size), u32(entry.size),
    u16(entry.nameBytes.length), u16(0)
  ]);
}

function centralHeader(entry, crc){
  return concatBytes([
    u32(0x02014b50), u16(20), u16(20), u16(ZIP_UTF8), u16(0), u16(0), u16(0),
    u32(crc), u32(entry.size), u32(entry.size),
    u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0),
    u32(0), u32(entry.offset)
  ]);
}

function endRecord(count, centralSize, centralStart){
  return concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(count), u16(count),
    u32(centralSize), u32(centralStart), u16(0)
  ]);
}

// files: [{name: string, data: ArrayBuffer}] -> Uint8Array (a complete .zip)
export function buildZipBytes(files){
  const {entries, centralStart, centralSize} = prepareEntries(files, data => dataBytes(data).byteLength);
  const parts = [];
  const central = [];
  for(const entry of entries){
    const data = dataBytes(entry.file.data);
    const crc = crc32(data);
    parts.push(localHeader(entry, crc), entry.nameBytes, data);
    central.push(centralHeader(entry, crc), entry.nameBytes);
  }
  return concatBytes([...parts, ...central, endRecord(entries.length, centralSize, centralStart)]);
}

async function crc32Blob(blob){
  const reader = blob.stream().getReader();
  let c = 0xFFFFFFFF;
  while(true){
    const {done, value} = await reader.read();
    if(done) return (c ^ 0xFFFFFFFF) >>> 0;
    c = crc32Update(c, value);
  }
}

function blobDataSize(data){
  if(typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return dataBytes(data).byteLength;
}

// Browser convenience wrapper. ArrayBuffers, typed arrays, Blobs, and Files
// are accepted; Blob parts avoid a final package-sized Uint8Array copy.
export async function buildZip(files){
  const {entries, centralStart, centralSize} = prepareEntries(files, blobDataSize);
  const parts = [];
  const central = [];
  for(const entry of entries){
    const source = entry.file.data;
    const isBlob = typeof Blob !== "undefined" && source instanceof Blob;
    const crc = isBlob ? await crc32Blob(source) : crc32(dataBytes(source));
    parts.push(localHeader(entry, crc), entry.nameBytes, source);
    central.push(centralHeader(entry, crc), entry.nameBytes);
  }
  return new Blob([...parts, ...central, endRecord(entries.length, centralSize, centralStart)], {type:"application/zip"});
}

// DecompressionStream("deflate-raw") is a native browser/Node API (no
// external library, Chrome 80+/Firefox 113+/Safari 16.4+/Node 18+) for
// raw DEFLATE -- exactly zip method 8, no zlib/gzip wrapper.
async function inflateRaw(bytes, expectedSize, name){
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try{
    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      total += value.length;
      if(total > expectedSize){
        await reader.cancel();
        throw new Error(`${name}: decompressed size does not match the ZIP directory`);
      }
      chunks.push(value);
    }
  }catch(error){
    if(error instanceof Error && error.message.startsWith(`${name}:`)) throw error;
    throw new Error(`${name}: invalid deflate data`);
  }
  if(total !== expectedSize) throw new Error(`${name}: decompressed size does not match the ZIP directory`);
  return concatBytes(chunks);
}

function requireRange(bytes, offset, length, what){
  if(!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset > bytes.length || length > bytes.length - offset){
    throw new Error(`corrupt zip: truncated ${what}`);
  }
}

function findEocd(bytes, dv){
  const first = Math.max(0, bytes.length - 22 - ZIP_MAX_U16);
  for(let p = bytes.length - 22; p >= first; p--){
    if(dv.getUint32(p, true) === 0x06054b50){
      const commentLength = dv.getUint16(p + 20, true);
      if(p + 22 + commentLength === bytes.length) return p;
    }
  }
  throw new Error("not a zip file this tool can read (missing end-of-central-directory record)");
}

function validateFlags(flags, method, name){
  const allowed = ZIP_UTF8 | ZIP_DATA_DESCRIPTOR | (method === 8 ? 0x0006 : 0);
  const unsupported = flags & ~allowed;
  if(unsupported) throw new Error(`${name}: unsupported zip flags 0x${unsupported.toString(16).padStart(4, "0")}`);
}

function validateExtra(bytes, dv, offset, length, name){
  requireRange(bytes, offset, length, `${name} extra field`);
  const end = offset + length;
  let p = offset;
  while(p < end){
    if(end - p < 4) throw new Error(`corrupt zip: truncated ${name} extra field`);
    const id = dv.getUint16(p, true);
    const size = dv.getUint16(p + 2, true);
    p += 4;
    if(size > end - p) throw new Error(`corrupt zip: truncated ${name} extra field`);
    if(id === 0x0001) throw new Error(`${name}: ZIP64 is not supported`);
    p += size;
  }
}

function equalBytes(a, b){
  if(a.length !== b.length) return false;
  for(let i=0;i<a.length;i++) if(a[i] !== b[i]) return false;
  return true;
}

function decodeName(bytes, utf8, entryNumber){
  if(!utf8){
    let name = "";
    for(const byte of bytes) name += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80];
    return name;
  }
  try{
    return new TextDecoder("utf-8", {fatal:true}).decode(bytes);
  }catch{
    throw new Error(`zip entry ${entryNumber}: invalid UTF-8 name`);
  }
}

// Reads STORE (method 0) and DEFLATE (method 8) entries from a classic,
// single-disk ZIP. ZIP64, encryption, and other unsupported flags are
// rejected rather than partially interpreted.
export async function parseZipBytes(input){
  const bytes = input instanceof Uint8Array ? input : dataBytes(input);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if(bytes.length < 22) throw new Error("not a zip file this tool can read (missing end-of-central-directory record)");
  const eocdOffset = findEocd(bytes, dv);

  if(eocdOffset >= 20 && dv.getUint32(eocdOffset - 20, true) === 0x07064b50) throw new Error("ZIP64 is not supported");
  const disk = dv.getUint16(eocdOffset + 4, true);
  const centralDisk = dv.getUint16(eocdOffset + 6, true);
  const diskCount = dv.getUint16(eocdOffset + 8, true);
  const count = dv.getUint16(eocdOffset + 10, true);
  const centralSize = dv.getUint32(eocdOffset + 12, true);
  const centralStart = dv.getUint32(eocdOffset + 16, true);
  if(disk !== 0 || centralDisk !== 0 || diskCount !== count) throw new Error("multi-disk ZIP archives are not supported");
  if(centralSize === ZIP_MAX_U32 || centralStart === ZIP_MAX_U32) throw new Error("ZIP64 is not supported");
  if(count * 46 > centralSize) throw new Error("corrupt zip: central directory is too small for its entry count");
  requireRange(bytes, centralStart, centralSize, "central directory");
  if(centralStart + centralSize !== eocdOffset) throw new Error("corrupt zip: central directory size or offset is inconsistent");

  const records = [];
  const names = new Set();
  let p = centralStart;
  const centralEnd = centralStart + centralSize;
  for(let i=0;i<count;i++){
    requireRange(bytes, p, 46, "central directory entry");
    if(p + 46 > centralEnd || dv.getUint32(p, true) !== 0x02014b50) throw new Error("corrupt zip: bad central directory entry");
    const versionNeeded = dv.getUint16(p + 6, true);
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const startDisk = dv.getUint16(p + 34, true);
    const localOffset = dv.getUint32(p + 42, true);
    const recordLength = 46 + nameLen + extraLen + commentLen;
    if(versionNeeded >= 45 || compSize === ZIP_MAX_U32 || size === ZIP_MAX_U32 || localOffset === ZIP_MAX_U32) throw new Error("ZIP64 is not supported");
    if(startDisk !== 0) throw new Error("multi-disk ZIP archives are not supported");
    if(method !== 0 && method !== 8) throw new Error(`zip entry ${i + 1}: unsupported zip compression method ${method} (only store/deflate)`);
    validateFlags(flags, method, `zip entry ${i + 1}`);
    requireRange(bytes, p, recordLength, "central directory entry");
    if(p + recordLength > centralEnd) throw new Error("corrupt zip: central directory entry exceeds the directory bounds");
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = decodeName(nameBytes, Boolean(flags & ZIP_UTF8), i + 1);
    if(names.has(name)) throw new Error(`duplicate zip entry name: ${name}`);
    names.add(name);
    validateExtra(bytes, dv, p + 46 + nameLen, extraLen, name || `zip entry ${i + 1}`);
    records.push({name, nameBytes, versionNeeded, flags, method, crc, compSize, size, localOffset});
    p += recordLength;
  }
  if(p !== centralEnd) throw new Error("corrupt zip: central directory entry count does not match its size");

  const ranges = [];
  for(const record of records){
    const {name, nameBytes, flags, method, crc, compSize, size, localOffset} = record;
    requireRange(bytes, localOffset, 30, `${name} local file header`);
    if(localOffset >= centralStart || dv.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`corrupt zip: bad local file header for ${name}`);
    const localVersion = dv.getUint16(localOffset + 4, true);
    const localFlags = dv.getUint16(localOffset + 6, true);
    const localMethod = dv.getUint16(localOffset + 8, true);
    const localCrc = dv.getUint32(localOffset + 14, true);
    const localCompSize = dv.getUint32(localOffset + 18, true);
    const localSize = dv.getUint32(localOffset + 22, true);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    if(localVersion >= 45 || localCompSize === ZIP_MAX_U32 || localSize === ZIP_MAX_U32) throw new Error(`${name}: ZIP64 is not supported`);
    validateFlags(localFlags, localMethod, name);
    if(localFlags !== flags || localMethod !== method) throw new Error(`${name}: local header does not match the central directory`);
    const localVariableLength = localNameLen + localExtraLen;
    requireRange(bytes, localOffset + 30, localVariableLength, `${name} local file header`);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen);
    if(!equalBytes(localName, nameBytes)) throw new Error(`${name}: local header name does not match the central directory`);
    validateExtra(bytes, dv, localOffset + 30 + localNameLen, localExtraLen, name);
    if(!(flags & ZIP_DATA_DESCRIPTOR) && (localCrc !== crc || localCompSize !== compSize || localSize !== size)){
      throw new Error(`${name}: local header sizes or CRC do not match the central directory`);
    }
    const dataStart = localOffset + 30 + localVariableLength;
    requireRange(bytes, dataStart, compSize, `${name} file data`);
    if(dataStart + compSize > centralStart) throw new Error(`${name}: file data overlaps the central directory`);
    ranges.push({start:localOffset, end:dataStart + compSize, name});
  }
  ranges.sort((a, b) => a.start - b.start);
  for(let i=1;i<ranges.length;i++){
    if(ranges[i].start < ranges[i - 1].end) throw new Error(`${ranges[i].name}: local file records overlap`);
  }

  const files = [];
  for(const record of records){
    const {name, method, crc, compSize, size, localOffset} = record;
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const raw = bytes.slice(dataStart, dataStart + compSize);
    const data = method === 8 ? await inflateRaw(raw, size, name) : raw;
    if(data.length !== size) throw new Error(`${name}: decompressed size does not match the ZIP directory`);
    if(crc32(data) !== crc) throw new Error(`${name}: CRC-32 does not match the ZIP directory`);
    files.push({name, data:data.buffer});
  }
  return files;
}

// Browser convenience wrapper -- same output, takes a File/Blob.
export async function parseZip(blob){
  return parseZipBytes(new Uint8Array(await blob.arrayBuffer()));
}
