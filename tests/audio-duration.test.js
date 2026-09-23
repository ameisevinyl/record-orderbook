import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseWavDuration,
  parseAiffDuration,
  parseWavSpec,
  parseAiffSpec,
  audioSpecWarning,
  compressionWarningForName,
} from "../src/lib/audio-duration.js";

// ---- helpers to build synthetic headers for the tests below ----

function buildWavHeader({ sampleRate, channels, bitsPerSample, durationSeconds }) {
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = Math.round(sampleRate * channels * bytesPerSample * durationSeconds);
  const buf = new ArrayBuffer(44); // canonical minimal WAV header size
  const dv = new DataView(buf);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, "RIFF");
  dv.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * bytesPerSample, true); // byte rate
  dv.setUint16(32, channels * bytesPerSample, true); // block align
  dv.setUint16(34, bitsPerSample, true);
  writeStr(36, "data");
  dv.setUint32(40, dataSize, true);
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

function buildAiffHeader({ sampleRate, numSampleFrames, channels = 2, bitsPerSample = 16 }) {
  const commData = new ArrayBuffer(18); // channels(2) + frames(4) + sampleSize(2) + rate(10)
  const commDv = new DataView(commData);
  commDv.setUint16(0, channels, false);
  commDv.setUint32(2, numSampleFrames, false);
  commDv.setUint16(6, bitsPerSample, false);
  new Uint8Array(commData, 8, 10).set(new Uint8Array(encodeExtended80(sampleRate)));

  const buf = new ArrayBuffer(12 + 8 + commData.byteLength);
  const dv = new DataView(buf);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) dv.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, "FORM");
  dv.setUint32(4, buf.byteLength - 8, false);
  writeStr(8, "AIFF");
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

test("compressionWarningForName flags lossy/compressed extensions", () => {
  assert.equal(compressionWarningForName("track.wav"), null);
  assert.equal(compressionWarningForName("track.aiff"), null);
  assert.equal(compressionWarningForName("track.WAV"), null); // case-insensitive
  assert.match(compressionWarningForName("track.mp3"), /uncompressed/);
  assert.match(compressionWarningForName("track.flac"), /uncompressed/);
});

test("parseWavSpec reads sample rate/channels/bit depth from a canonical header", () => {
  const buf = buildWavHeader({ sampleRate: 48000, channels: 2, bitsPerSample: 24, durationSeconds: 1 });
  assert.deepEqual(parseWavSpec(buf), { sampleRate: 48000, channels: 2, bitsPerSample: 24 });
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
  assert.match(audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 }), /22050Hz.*44100Hz/);
});

test("audioSpecWarning flags both when both are below minimum", () => {
  const spec = { sampleRate: 22050, channels: 2, bitsPerSample: 8 };
  const msg = audioSpecWarning(spec, { minBitDepth: 16, minSampleRateHz: 44100 });
  assert.match(msg, /8-bit/);
  assert.match(msg, /22050Hz/);
});

test("audioSpecWarning returns null when spec couldn't be read at all", () => {
  assert.equal(audioSpecWarning(null, { minBitDepth: 16, minSampleRateHz: 44100 }), null);
});
