// Pure audio rules for the plant view: judges the facts plant/checks.py
// read from the files on disk against a prepareProject() result. Same
// finding shape as projectGaps ({group, text}); no DOM.

import { parseTime, formatTime } from "./time.js";
import { audioSpecWarning } from "./audio-duration.js";

// Form lengths are whole seconds (m:ss), so allow the rounding and a bit.
const LENGTH_TOLERANCE = 1;

// The audio files a side references, each with its position label and
// the form length to match.
export function sideAudio(side, sideId){
  if(side.blank) return [];
  if(side.continuous){
    return side.continuousFileName ? [{name: side.continuousFileName, label: "Side file", length: side.continuousLength}] : [];
  }
  return side.tracks.map((track, i) => ({name: track.fileName, label: `${sideId}${i + 1}`, length: track.length}))
    .filter(file => file.name);
}

export function audioFindings(project, facts, config){
  const findings = [];
  const add = (group, text) => findings.push({group, text});
  if(facts.error){
    add("Audio", facts.error);
    return findings;
  }
  const referenced = new Set();

  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    const group = `Side ${sideId}`;
    const rates = new Set(), bits = new Set();
    for(const {name, length} of sideAudio(side, sideId)){
      referenced.add(name);
      const file = facts.files[name];
      if(!file) continue; // a missing file is already a completeness gap
      if(file.error){
        add(group, `${name} can't be read: ${file.error}`);
        continue;
      }
      const spec = audioSpecWarning(file.spec, config.audioSpec);
      if(spec) add(group, `${name} ${spec.replace(/^⚠ /, "")}`);
      const expected = parseTime(length);
      if(expected !== null && Math.abs(file.duration - expected) > LENGTH_TOLERANCE){
        add(group, `${name} is ${formatTime(file.duration)}, form says ${length.trim()}`);
      }
      if(file.sampleRate) rates.add(file.sampleRate);
      if(file.bitsPerSample) bits.add(file.bitsPerSample);
      if(side.continuous){
        // Each marker starts a track; the first track needs none at 0.
        const marks = file.markers;
        const tracks = marks.length && marks[0].seconds > LENGTH_TOLERANCE ? marks.length + 1 : marks.length;
        if(!marks.length) add(group, "no markers in the side file");
        else if(tracks !== side.tracks.length) add(group, `side file marks ${tracks} tracks, form has ${side.tracks.length}`);
      }
    }
    if(rates.size > 1) add(group, `mixed sample rates: ${[...rates].join(", ")} Hz`);
    if(bits.size > 1) add(group, `mixed bit depths: ${[...bits].join(", ")} bit`);
  }

  for(const name of Object.keys(facts.files)){
    if(!referenced.has(name)) add("Audio", `${name} is not in the tracklist`);
  }
  return findings;
}
