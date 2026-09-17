// Minimal ZIP writer (store method — no compression), no dependencies.
// buildZipBytes() is pure (Uint8Array in, Uint8Array out); buildZip()
// wraps it in a Blob for browser download use.

const CRC_TABLE = (()=>{
  const t = new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c = n;
    for(let k=0;k<8;k++) c = (c & 1) ? (0xEDB88320 ^ (c>>>1)) : (c>>>1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes){
  let c = 0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function u16(n){ return new Uint8Array([n & 0xFF, (n>>>8) & 0xFF]); }
function u32(n){ return new Uint8Array([n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]); }

export function concatBytes(arrs){
  let len = 0; arrs.forEach(a=> len += a.length);
  const out = new Uint8Array(len);
  let o = 0; arrs.forEach(a=>{ out.set(a, o); o += a.length; });
  return out;
}

// files: [{name: string, data: ArrayBuffer}] -> Uint8Array (a complete .zip)
export function buildZipBytes(files){
  const parts = [];
  const central = [];
  let offset = 0;
  const enc = new TextEncoder();

  for(const f of files){
    const nameBytes = enc.encode(f.name);
    const data = new Uint8Array(f.data);
    const crc = crc32(data);
    const localHeader = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0)
    ]);
    parts.push(localHeader, nameBytes, data);

    const centralHeader = concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(offset)
    ]);
    central.push(centralHeader, nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  central.forEach(c=> centralSize += c.length);

  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart), u16(0)
  ]);

  return concatBytes([...parts, ...central, end]);
}

// Browser convenience wrapper — same input, returns a downloadable Blob.
export async function buildZip(files){
  return new Blob([buildZipBytes(files)], {type:"application/zip"});
}
