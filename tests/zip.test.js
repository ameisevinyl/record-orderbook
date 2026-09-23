import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, concatBytes, buildZip, buildZipBytes, parseZipBytes } from "../src/lib/zip.js";

// Builds a single-entry zip with method 8 (DEFLATE) — buildZipBytes only
// ever writes method 0 (store), so this mimics what a plant employee's
// OS re-zipping a project with Finder/Explorer/7-Zip actually produces,
// to test parseZipBytes's decompression path against something it
// didn't write itself.
function u16(n){ return new Uint8Array([n & 0xFF, (n>>>8) & 0xFF]); }
function u32(n){ return new Uint8Array([n&0xFF,(n>>>8)&0xFF,(n>>>16)&0xFF,(n>>>24)&0xFF]); }

async function deflateRaw(bytes){
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function buildDeflateZipBytes(name, plainBytes){
  const nameBytes = new TextEncoder().encode(name);
  const crc = crc32(plainBytes);
  const compressed = await deflateRaw(plainBytes);
  const utf8 = 0x0800;

  const localHeader = concatBytes([
    u32(0x04034b50), u16(20), u16(utf8), u16(8), u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(plainBytes.length),
    u16(nameBytes.length), u16(0)
  ]);
  const centralHeader = concatBytes([
    u32(0x02014b50), u16(20), u16(20), u16(utf8), u16(8), u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(plainBytes.length),
    u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
    u32(0), u32(0)
  ]);
  const centralStart = localHeader.length + nameBytes.length + compressed.length;
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(centralHeader.length + nameBytes.length), u32(centralStart), u16(0)
  ]);
  return concatBytes([localHeader, nameBytes, compressed, centralHeader, nameBytes, end]);
}

function zipOffsets(zip){
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  return {dv, eocd, central:dv.getUint32(eocd + 16, true)};
}

test("crc32 matches the well-known reference value for 'hello'", () => {
  const bytes = new TextEncoder().encode("hello");
  assert.equal(crc32(bytes), 0x3610a686);
});

test("buildZipBytes produces a local file header + EOCD signature", () => {
  const data = new TextEncoder().encode("hi").buffer;
  const zip = buildZipBytes([{ name: "a.txt", data }]);

  // local file header signature "PK\x03\x04"
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  // end-of-central-directory signature "PK\x05\x06" must appear
  // exactly once, at the very end of the archive
  const eocdSig = [0x50, 0x4b, 0x05, 0x06];
  const tail = [...zip.slice(zip.length - 22, zip.length - 18)];
  assert.deepEqual(tail, eocdSig);
});

test("buildZipBytes sets UTF-8 flags and round-trips a UTF-8 name", async () => {
  const zip = buildZipBytes([{name:"München/größe.txt", data:new Uint8Array([1, 2, 3])}]);
  const {dv, central} = zipOffsets(zip);

  assert.equal(dv.getUint16(6, true), 0x0800);
  assert.equal(dv.getUint16(central + 8, true), 0x0800);
  const parsed = await parseZipBytes(zip);
  assert.equal(parsed[0].name, "München/größe.txt");
});

test("parseZipBytes decodes an unflagged filename as CP437", async () => {
  const nameBytes = new Uint8Array([0x6d, 0x81, 0x6e, 0x63, 0x68, 0x65, 0x6e, 0x2e, 0x74, 0x78, 0x74]);
  const zip = buildZipBytes([{name:"x".repeat(nameBytes.length), data:new Uint8Array()}]);
  const {dv, central} = zipOffsets(zip);
  dv.setUint16(6, 0, true);
  dv.setUint16(central + 8, 0, true);
  zip.set(nameBytes, 30);
  zip.set(nameBytes, central + 46);

  const parsed = await parseZipBytes(zip);
  assert.equal(parsed[0].name, "münchen.txt");
});

test("parseZipBytes strictly rejects invalid UTF-8 in a flagged filename", async () => {
  const zip = buildZipBytes([{name:"x.txt", data:new Uint8Array()}]);
  const {central} = zipOffsets(zip);
  zip[30] = 0xff;
  zip[central + 46] = 0xff;

  await assert.rejects(() => parseZipBytes(zip), /invalid UTF-8 name/);
});

test("buildZipBytes handles multiple files without overlapping offsets", () => {
  const files = [
    { name: "one.txt", data: new TextEncoder().encode("first file").buffer },
    { name: "two.txt", data: new TextEncoder().encode("second file, longer").buffer },
  ];
  const zip = buildZipBytes(files);
  assert.ok(zip.length > 0);
  // record count in the EOCD (bytes 10-11 of the 22-byte trailer) must be 2
  const eocdOffset = zip.length - 22;
  const dv = new DataView(zip.buffer, zip.byteOffset + eocdOffset, 22);
  assert.equal(dv.getUint16(10, true), 2);
});

test("parseZipBytes round-trips names and contents written by buildZipBytes", async () => {
  const files = [
    { name: "one.txt", data: new TextEncoder().encode("first file").buffer },
    { name: "folder/two.bin", data: new Uint8Array([0, 1, 2, 255, 254]).buffer },
  ];
  const zip = buildZipBytes(files);
  const parsed = await parseZipBytes(zip);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "one.txt");
  assert.equal(new TextDecoder().decode(parsed[0].data), "first file");
  assert.equal(parsed[1].name, "folder/two.bin");
  assert.deepEqual([...new Uint8Array(parsed[1].data)], [0, 1, 2, 255, 254]);
});

test("buildZip accepts Blob data without changing the byte-oriented API", async () => {
  const blob = await buildZip([{name:"blob.txt", data:new Blob(["blob contents"])}]);
  const parsed = await parseZipBytes(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(new TextDecoder().decode(parsed[0].data), "blob contents");
});

test("parseZipBytes rejects a non-zip buffer", async () => {
  await assert.rejects(() => parseZipBytes(new TextEncoder().encode("not a zip")));
});

test("parseZipBytes rejects truncated records and entry data", async () => {
  const original = buildZipBytes([{name:"file.txt", data:new TextEncoder().encode("contents")}]);
  const {central} = zipOffsets(original);
  const cuts = [0, 3, 21, 29, central - 1, central + 20, original.length - 1];
  for(const length of cuts){
    await assert.rejects(() => parseZipBytes(original.slice(0, length)), `accepted truncation at ${length}`);
  }

  const badLength = original.slice();
  const offsets = zipOffsets(badLength);
  offsets.dv.setUint16(offsets.central + 28, 0xFFFF, true);
  await assert.rejects(() => parseZipBytes(badLength), /truncated central directory entry|exceeds the directory bounds/);
});

test("parseZipBytes verifies CRC-32 after reading entry data", async () => {
  const zip = buildZipBytes([{name:"file.txt", data:new TextEncoder().encode("contents")}]);
  const {dv, central} = zipOffsets(zip);
  dv.setUint32(14, 0, true);
  dv.setUint32(central + 16, 0, true);
  await assert.rejects(() => parseZipBytes(zip), /CRC-32 does not match/);
});

test("parseZipBytes verifies the decompressed size", async () => {
  const zip = buildZipBytes([{name:"file.txt", data:new TextEncoder().encode("contents")}]);
  const {dv, central} = zipOffsets(zip);
  dv.setUint32(22, 7, true);
  dv.setUint32(central + 24, 7, true);
  await assert.rejects(() => parseZipBytes(zip), /decompressed size does not match/);
});

test("ZIP writers and readers reject duplicate entry names", async () => {
  const data = new Uint8Array();
  assert.throws(() => buildZipBytes([{name:"same", data}, {name:"same", data}]), /duplicate zip entry name/);

  const zip = buildZipBytes([{name:"a.txt", data}, {name:"b.txt", data}]);
  const {dv, central} = zipOffsets(zip);
  const secondCentral = central + 46 + dv.getUint16(central + 28, true);
  const secondLocal = dv.getUint32(secondCentral + 42, true);
  zip[secondCentral + 46] = "a".charCodeAt(0);
  zip[secondLocal + 30] = "a".charCodeAt(0);
  await assert.rejects(() => parseZipBytes(zip), /duplicate zip entry name: a.txt/);
});

test("buildZipBytes rejects classic-ZIP count and name limits before truncating", () => {
  const empty = new Uint8Array();
  const tooMany = Array.from({length:0x10000}, (_, i) => ({name:String(i), data:empty}));
  assert.throws(() => buildZipBytes(tooMany), /entry count exceeds the classic ZIP limit/);
  assert.throws(() => buildZipBytes([{name:"x".repeat(0x10000), data:empty}]), /name exceeds the classic ZIP limit/);
});

test("parseZipBytes rejects unsupported flags, multi-disk records, and ZIP64", async () => {
  const source = buildZipBytes([{name:"file.txt", data:new Uint8Array()}]);

  const flagged = source.slice();
  let offsets = zipOffsets(flagged);
  offsets.dv.setUint16(6, 0x0801, true);
  offsets.dv.setUint16(offsets.central + 8, 0x0801, true);
  await assert.rejects(() => parseZipBytes(flagged), /unsupported zip flags/);

  const multiDisk = source.slice();
  offsets = zipOffsets(multiDisk);
  offsets.dv.setUint16(offsets.eocd + 4, 1, true);
  await assert.rejects(() => parseZipBytes(multiDisk), /multi-disk ZIP archives are not supported/);

  const zip64 = source.slice();
  offsets = zipOffsets(zip64);
  offsets.dv.setUint16(offsets.central + 6, 45, true);
  await assert.rejects(() => parseZipBytes(zip64), /ZIP64 is not supported/);
});

test("parseZipBytes decompresses a DEFLATE (method 8) entry, e.g. a re-zipped project", async () => {
  const plain = new TextEncoder().encode("project.json contents ".repeat(30));
  const zip = await buildDeflateZipBytes("project.json", plain);
  const parsed = await parseZipBytes(zip);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].name, "project.json");
  assert.equal(new TextDecoder().decode(parsed[0].data), new TextDecoder().decode(plain));
});

test("parseZipBytes rejects an unsupported compression method", async () => {
  // Method 12 (BZIP2) — exotic, never produced by Finder/Explorer/7-Zip's
  // defaults, so an explicit error beats silently misreading the bytes.
  const nameBytes = new TextEncoder().encode("x.txt");
  const data = new TextEncoder().encode("hi");
  const crc = crc32(data);
  const localHeader = concatBytes([
    u32(0x04034b50), u16(20), u16(0), u16(12), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0)
  ]);
  const centralHeader = concatBytes([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(12), u16(0), u16(0),
    u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length),
    u16(0), u16(0), u16(0), u16(0), u32(0), u32(0)
  ]);
  const centralStart = localHeader.length + nameBytes.length + data.length;
  const end = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(centralHeader.length + nameBytes.length), u32(centralStart), u16(0)
  ]);
  const zip = concatBytes([localHeader, nameBytes, data, centralHeader, nameBytes, end]);
  await assert.rejects(() => parseZipBytes(zip), /unsupported zip compression method 12/);
});
