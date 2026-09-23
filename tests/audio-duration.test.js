import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWavDuration,
  parseAiffDuration,
  parseWavSpec,
  parseAiffSpec,
  audioSpecWarning,
  compressionWarningForName,
  readAudioSpec,
} from "../src/lib/audio-duration.js";

// ---- helpers to build synthetic headers for the tests below ----

function buildWavHeader({ sampleRate, channels, bitsPerSample, durationSeconds, formatTag = 1, extensibleSubtype = 1 }) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.round(sampleRate * channels * bytesPerSample * durationSeconds);
  const fmtSize = formatTag === 0xFFFE ? 40 : 16;
  const dataOffset = 20 + fmtSize;
  const buf = new ArrayBuffer(dataOffset + 8);
  const dv = new DataView(buf);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, "RIFF");
  dv.setUint32(4, dataOffset + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, fmtSize, true);
  dv.setUint16(20, formatTag, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  dv.setUint16(32, channels * bytesPerSample, true); // block align
  dv.setUint16(34, bitsPerSample, true);
  if (formatTag === 0xFFFE) {
    dv.setUint16(36, 22, true); // extension size
    dv.setUint16(38, bitsPerSample, true); // valid bits
    dv.setUint32(40, 0, true); // channel mask
    dv.setUint32(44, extensibleSubtype, true);
    new Uint8Array(buf, 48, 12).set([0x00,0x00,0x10,0x00,0x80,0x00,0x00,0xAA,0x00,0x38,0x9B,0x71]);
  }
  writeStr(dataOffset, "data");
  dv.setUint32(dataOffset + 4, dataSize, true);
  // note: the actual dataSize bytes of audio aren't present — the parser
  // only reads the declared size from the header, never the buffer tail.
  return buf;
}

function encodeExtended80(value) {
  const buf = new ArrayBuffer(10);
  const dv = new DataView(buf);
  const exponent = Math.floor(Math.log2(value));
  const biased = exponent + 16383;
  const mantissaFrac = value / Math.pow(2, exponent); // in [1,2)
  const mantissaBig = BigInt(Math.round(mantissaFrac * Number(1n << 63n)));
  dv.setUint16(0, biased, false);
  dv.setUint32(2, Number((mantissaBig >> 32n) & 0xffffffffn), false);
  dv.setUint32(6, Number(mantissaBig & 0xffffffffn), false);
  return buf;
}

function buildAiffHeader({ sampleRate, numSampleFrames, channels = 2, bitsPerSample = 16, compressionType = null }) {
  const commData = new ArrayBuffer(compressionType ? 22 : 18); // AIFC appends a 4-byte compression type
  const commDv = new DataView(commData);
  commDv.setUint16(0, channels, false);
  commDv.setUint32(2, numSampleFrames, false);
  commDv.setUint16(6, bitsPerSample, false);
  new Uint8Array(commData, 8, 10).set(new Uint8Array(encodeExtended80(sampleRate)));
  if (compressionType) {
    for (let i = 0; i < 4; i++) commDv.setUint8(18 + i, compressionType.charCodeAt(i));
  }

  const buf = new ArrayBuffer(12 + 8 + commData.byteLength);
  const dv = new DataView(buf);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, "FORM");
  dv.setUint32(4, buf.byteLength - 8, false);
  writeStr(8, compressionType ? "AIFC" : "AIFF");
  writeStr(12, "COMM");
  dv.setUint32(16, commData.byteLength, false);
  new Uint8Array(buf, 20, commData.byteLength).set(new Uint8Array(commData));
  return buf;
}

// ---- tests ----

test("parseWavDuration reads a canonical 44-byte WAV header", () => {
  const buf = buildWavHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16, durationSeconds: 2 });
  assert.equal(parseWavDuration(buf), 2);
});

test("parseWavDuration returns null for a non-RIFF buffer", () => {
  const buf = new ArrayBuffer(20);
  assert.equal(parseWavDuration(buf), null);
});

test("WAV parsing returns null rather than throwing for a truncated fmt chunk", () => {
  const full = buildWavHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16, durationSeconds: 1 });
  const truncated = full.slice(0, 24);
  assert.doesNotThrow(() => parseWavDuration(truncated));
  assert.equal(parseWavDuration(truncated), null);
  assert.equal(parseWavSpec(truncated), null);
});

test("parseAiffDuration reads a synthetic FORM/AIFF/COMM header", () => {
  const buf = buildAiffHeader({ sampleRate: 44100, numSampleFrames: 88200 });
  const duration = parseAiffDuration(buf);
  assert.ok(duration !== null);
  assert.ok(Math.abs(duration - 2) < 0.001, `expected ~2s, got ${duration}`);
});

test("parseAiffDuration returns null for a non-FORM buffer", () => {
  const buf = new ArrayBuffer(20);
  assert.equal(parseAiffDuration(buf), null);
});

test("AIFF parsing returns null rather than throwing for a truncated COMM chunk", () => {
  const full = buildAiffHeader({ sampleRate: 44100, numSampleFrames: 44100 });
  const truncated = full.slice(0, 25);
  assert.doesNotThrow(() => parseAiffDuration(truncated));
  assert.equal(parseAiffDuration(truncated), null);
  assert.equal(parseAiffSpec(truncated), null);
});

test("compressionWarningForName flags lossy/compressed extensions", () => {
  assert.equal(compressionWarningForName("track.wav"), null);
  assert.equal(compressionWarningForName("track.aiff"), null);
  assert.equal(compressionWarningForName("track.WAV"), null); // case-insensitive
  assert.match(compressionWarningForName("track.mp3"), /uncompressed/);
  assert.match(compressionWarningForName("track.flac"), /uncompressed/);
});

test("parseWavSpec reads sample rate/channels/bit depth from a canonical header", () => {
  const buf = buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 24, durationSeconds: 1 });
  assert.deepEqual(parseWavSpec(buf), {
    sampleRate: 48000, channels: 2, bitsPerSample: 24,
    encoding: "PCM", encodingSupported: true,
  });
});

test("parseWavSpec accepts IEEE float and extensible PCM/float subtypes", () => {
  const float = parseWavSpec(buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 32, durationSeconds: 1, formatTag: 3 }));
  assert.equal(float.encoding, "IEEE float");
  assert.equal(float.encodingSupported, true);

  const pcmExt = parseWavSpec(buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 24, durationSeconds: 1, formatTag: 0xFFFE, extensibleSubtype: 1 }));
  assert.equal(pcmExt.encoding, "PCM (extensible)");
  assert.equal(pcmExt.encodingSupported, true);

  const floatExt = parseWavSpec(buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 32, durationSeconds: 1, formatTag: 0xFFFE, extensibleSubtype: 3 }));
  assert.equal(floatExt.encoding, "IEEE float (extensible)");
  assert.equal(floatExt.encodingSupported, true);
});

test("audioSpecWarning flags a compressed WAV format stored in a WAV container", () => {
  const spec = parseWavSpec(buildWavHeader({ sampleRate: 44100, channels: 2, bitsPerSample: 16, durationSeconds: 1, formatTag: 0x0055 }));
  assert.equal(spec.encodingSupported, false);
  assert.match(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), /unsupported audio encoding.*0x0055/i);
});

test("parseWavSpec returns null for a non-RIFF buffer", () => {
  assert.equal(parseWavSpec(new ArrayBuffer(20)), null);
});

test("parseAiffSpec reads sample rate/channels/bit depth from a synthetic COMM chunk", () => {
  const buf = buildAiffHeader({ sampleRate: 44100, numSampleFrames: 44100, channels: 1, bitsPerSample: 24 });
  const spec = parseAiffSpec(buf);
  assert.equal(spec.channels, 1);
  assert.equal(spec.bitsPerSample, 24);
  assert.equal(Math.round(spec.sampleRate), 44100);
  assert.equal(spec.encoding, "PCM");
  assert.equal(spec.encodingSupported, true);
});

test("parseAiffSpec accepts common uncompressed AIFC PCM and float variants", () => {
  for (const compressionType of ["NONE", "sowt", "twos", "raw ", "in24", "in32", "fl32", "FL64"]) {
    const spec = parseAiffSpec(buildAiffHeader({ sampleRate: 48000, numSampleFrames: 48000, bitsPerSample: 32, compressionType }));
    assert.equal(spec.encodingSupported, true, compressionType);
  }
});

test("audioSpecWarning flags a compressed AIFC encoding", () => {
  const spec = parseAiffSpec(buildAiffHeader({ sampleRate: 44100, numSampleFrames: 44100, compressionType: "ima4" }));
  assert.equal(spec.encodingSupported, false);
  assert.match(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), /unsupported audio encoding.*ima4/i);
});

test("readAudioSpec dispatches .bwf files through the WAV parser", async () => {
  const buf = buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 24, durationSeconds: 1 });
  const blob = new Blob([buf]);
  const file = { name: "master.BWF", size: blob.size, slice: blob.slice.bind(blob) };
  const spec = await readAudioSpec(file);
  assert.equal(spec.sampleRate, 48000);
  assert.equal(spec.encoding, "PCM");
});

test("parseAiffSpec returns null for a non-FORM buffer", () => {
  assert.equal(parseAiffSpec(new ArrayBuffer(20)), null);
});

test("audioSpecWarning passes a file that meets both minimums", () => {
  const spec = { sampleRate: 44100, channels: 2, bitsPerSample: 16 };
  assert.equal(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), null);
});

test("audioSpecWarning flags a bit depth below the configured minimum", () => {
  const spec = { sampleRate: 44100, channels: 2, bitsPerSample: 8 };
  assert.match(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), /8-bit.*16-bit/);
});

test("audioSpecWarning flags a sample rate below the configured minimum", () => {
  const spec = { sampleRate: 22050, channels: 2, bitsPerSample: 16 };
  assert.match(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), /22\.05kHz.*44\.1kHz/);
});

test("audioSpecWarning flags both when both are below minimum", () => {
  const spec = { sampleRate: 22050, channels: 2, bitsPerSample: 8 };
  const msg = audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 });
  assert.match(msg, /8-bit/);
  assert.match(msg, /22\.05kHz/);
});

test("audioSpecWarning returns null when spec couldn't be read at all", () => {
  assert.equal(audioSpecWarning(null, { minBitDepth: 16, minSampleRateHz: 44100 }), null);
});
