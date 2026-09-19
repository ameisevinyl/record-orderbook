import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, buildZipBytes, parseZipBytes } from "../src/lib/zip.js";

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

test("parseZipBytes round-trips names and contents written by buildZipBytes", () => {
  const files = [
    { name: "one.txt", data: new TextEncoder().encode("first file").buffer },
    { name: "folder/two.bin", data: new Uint8Array([0, 1, 2, 255, 254]).buffer },
  ];
  const zip = buildZipBytes(files);
  const parsed = parseZipBytes(zip);

  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].name, "one.txt");
  assert.equal(new TextDecoder().decode(parsed[0].data), "first file");
  assert.equal(parsed[1].name, "folder/two.bin");
  assert.deepEqual([...new Uint8Array(parsed[1].data)], [0, 1, 2, 255, 254]);
});

test("parseZipBytes rejects a non-zip buffer", () => {
  assert.throws(() => parseZipBytes(new TextEncoder().encode("not a zip")));
});
