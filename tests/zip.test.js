import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, concatBytes, buildZipBytes, parseZipBytes } from "../src/lib/zip.js";

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

  const localHeader = concatBytes([
    u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(plainBytes.length),
    u16(nameBytes.length), u16(0)
  ]);
  const centralHeader = concatBytes([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
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

test("parseZipBytes rejects a non-zip buffer", async () => {
  await assert.rejects(() => parseZipBytes(new TextEncoder().encode("not a zip")));
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
