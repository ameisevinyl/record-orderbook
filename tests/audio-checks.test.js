import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { audioFindings } from "../src/lib/audio-checks.js";

function project(sideA, sideB = {blank:true}){
  return prepareProject({projectVersion:1, format:"12", sides:{A:sideA, B:sideB}}, CONFIG);
}

function wav(duration, more = {}){
  return {codec:"pcm_s24le", sampleRate:44100, bitsPerSample:24, duration, markers:[],
    spec:{encoding:"PCM", encodingSupported:true, bitsPerSample:24, sampleRate:44100}, ...more};
}

const twoTracks = {rpm:"33", tracks:[
  {title:"One", length:"3:00", fileName:"A1.wav"},
  {title:"Two", length:"2:30", fileName:"A2.wav"}
]};

function texts(p, files){
  return audioFindings(p, {files}, CONFIG).map(f => `${f.group}: ${f.text}`);
}

test("matching files give no findings", ()=>{
  assert.deepEqual(texts(project(twoTracks), {"A1.wav": wav(180.4), "A2.wav": wav(149.6)}), []);
});

test("ffmpeg missing is the only finding", ()=>{
  assert.deepEqual(audioFindings(project(twoTracks), {error:"needs ffmpeg"}, CONFIG),
    [{group:"Audio", text:"needs ffmpeg"}]);
});

test("duration differing from the form by more than 1 s", ()=>{
  assert.deepEqual(texts(project(twoTracks), {"A1.wav": wav(182), "A2.wav": wav(150)}),
    ["Side A: A1.wav is 3:02, form says 3:00"]);
});

test("empty form length is not compared", ()=>{
  const side = {rpm:"33", tracks:[{title:"One", length:"", fileName:"A1.wav"}]};
  assert.deepEqual(texts(project(side), {"A1.wav": wav(99)}), []);
});

test("unreadable file, encoding and below-spec files", ()=>{
  const files = {
    "A1.wav": {error:"Invalid data found"},
    "A2.wav": wav(150, {spec:{encoding:"MP3", encodingSupported:false, bitsPerSample:null, sampleRate:44100}})
  };
  assert.deepEqual(texts(project(twoTracks), files), [
    "Side A: A1.wav can't be read: Invalid data found",
    "Side A: A2.wav unsupported audio encoding: MP3"
  ]);
  const low = {"A1.wav": wav(180, {spec:{encoding:"PCM", encodingSupported:true, bitsPerSample:8, sampleRate:44100}}),
    "A2.wav": wav(150)};
  assert.match(texts(project(twoTracks), low)[0], /^Side A: A1.wav below spec: 8-bit/);
});

test("mixed sample rate and bit depth within a side", ()=>{
  const files = {"A1.wav": wav(180), "A2.wav": wav(150, {sampleRate:48000, bitsPerSample:16})};
  assert.deepEqual(texts(project(twoTracks), files), [
    "Side A: mixed sample rates: 44100, 48000 Hz",
    "Side A: mixed bit depths: 24, 16 bit"
  ]);
});

test("audio file the project doesn't reference", ()=>{
  const files = {"A1.wav": wav(180), "A2.wav": wav(150), "extra.wav": wav(10)};
  assert.deepEqual(texts(project(twoTracks), files), ["Audio: extra.wav is not in the tracklist"]);
});

const continuous = {rpm:"33", continuous:true, continuousLength:"5:32", continuousFileName:"A.wav",
  tracks:[{title:"One", length:"3:00"}, {title:"Two", length:"2:30"}]};

test("continuous side: markers matching the tracks", ()=>{
  const atStarts = [{seconds:0, label:"One"}, {seconds:182, label:"Two"}];
  assert.deepEqual(texts(project(continuous), {"A.wav": wav(332, {markers:atStarts})}), []);
  // a first track starting at 0 often has no marker of its own
  assert.deepEqual(texts(project(continuous), {"A.wav": wav(332, {markers:[atStarts[1]]})}), []);
});

test("continuous side: no markers, wrong count, wrong length", ()=>{
  assert.deepEqual(texts(project(continuous), {"A.wav": wav(332)}), ["Side A: no markers in the side file"]);
  const three = [{seconds:0}, {seconds:100}, {seconds:200}];
  assert.deepEqual(texts(project(continuous), {"A.wav": wav(340, {markers:three})}), [
    "Side A: A.wav is 5:40, form says 5:32",
    "Side A: side file marks 3 tracks, form has 2"
  ]);
});
