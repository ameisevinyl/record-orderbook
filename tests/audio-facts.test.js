import { test } from "node:test";
import assert from "node:assert/strict";
import { audioFactsText } from "../src/lib/audio-facts.js";

test("duration and format, as far as the facts have them", () => {
  assert.equal(audioFactsText({codec: "pcm_s24le", sampleRate: 48000, bitsPerSample: 24, duration: 192}), "3:12 · pcm_s24le 48 kHz 24 bit");
  assert.equal(audioFactsText({codec: "mp3", sampleRate: 44100, duration: 61}), "1:01 · mp3 44.1 kHz");
  assert.equal(audioFactsText({duration: 0}), "");
});

test("a file that could not be read says why", () => {
  assert.equal(audioFactsText({error: "ffprobe: not an audio file"}), "ffprobe: not an audio file");
});
