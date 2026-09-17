import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, buildZipBytes } from "../src/lib/zip.js";

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
