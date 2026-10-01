// Production lines: per product, steps in order (CONFIG.lines). Where a
// line stands is derived on every scan: check steps from the current
// check results, the others from the line's log in project.plant.lines,
// whose entries count while their files keep their sha256. Spec:
// docs/superpowers/specs/2026-10-02-production-lines-design.md.

import { getFormat } from "./format-catalogue.js";
import { artworkSlots, artworkRows } from "./artwork-checks.js";
import { fileSlots } from "./project.js";

// Which checklist rows decide a check step. Spot colours are part of the
// Colour mode row; an unreadable file (File) has no other home than pdf.
const ROWS = {
  size: ["Size"], resolution: ["Resolution"],
  pdf: ["File", "Pages", "PDF version", "Encryption", "Fonts", "Colour profile", "TrimBox"],
  bleed: ["Bleed"], colour: ["Colour mode", "Ink", "Black"]
};
const BAD = new Set(["warn", "error"]);
const kindOf = step => ROWS[step] ? "check" : step === "approve" ? "approve" : step.split(":")[0];

export function lineFiles(project, config, lineName){
  const parts = config.lines[lineName].parts;
  const paths = new Map(fileSlots(project).filter(s => s.name).map(s => [s.name, s.path]));
  return artworkSlots(project, config).filter(s => parts.includes(s.params.part))
    .map(slot => ({name: slot.name, slot: {...slot, path: paths.get(slot.name)}}));
}

// A failing row of a check step for one file, as "why" text; null when it passes.
function failing(step, facts, slot, printCheck){
  const row = artworkRows(facts, slot.params, printCheck).find(r => ROWS[step].includes(r.feature) && BAD.has(r.severity));
  return row ? `${slot.title}: ${row.detected}${row.expected ? `, expected ${row.expected}` : ""}` : null;
}

function counts(entry, current){
  return !entry.files || Object.entries(entry.files).every(([name, sha]) => current[name] === sha);
}

export function lineState(project, config, lineName, checkResults){
  const line = config.lines[lineName];
  const files = lineFiles(project, config, lineName);
  const steps = line.steps.map(step => ({step, kind: kindOf(step), state: "ahead"}));
  const waiting = (line.after || []).some(other => !lineState(project, config, other, checkResults).done);
  if(!checkResults) return {line: lineName, steps, step: null, why: "checking", ready: false, done: false, waiting, checking: true};
  const printCheck = getFormat(config, project.format).printCheck;
  const current = Object.fromEntries(files.map(f => [f.name, (checkResults[f.name] || {}).sha256]));
  const log = (project.plant.lines[lineName] || []).filter(e => e.by !== "fixer" && counts(e, current));
  const logged = step => log.some(e => e.step === step && (!step.startsWith("send:") || e.to));
  let at = null, why = "";
  for(const s of steps){
    let done;
    if(s.kind === "check"){
      const reasons = files.map(f => checkResults[f.name] ? failing(s.step, checkResults[f.name], f.slot, printCheck)
        : `${f.slot.title}: not checked yet`).filter(Boolean);
      done = !reasons.length || logged(s.step);
      if(!done && at === null) why = reasons[0];
    } else {
      done = logged(s.step);
    }
    if(at === null && !done){ at = s.step; s.state = "current"; }
    else if(at === null) s.state = "done";
  }
  const firstSend = line.steps.findIndex(step => step.startsWith("send:"));
  const ready = at === null || (firstSend !== -1 && line.steps.indexOf(at) >= firstSend);
  return {line: lineName, steps, step: at, why: at ? why : "", ready, done: at === null, waiting, checking: false};
}

export function logEntry(project, config, lineName, checkResults, fields){
  const files = Object.fromEntries(lineFiles(project, config, lineName)
    .map(f => [f.name, (checkResults[f.name] || {}).sha256 || null]));
  return {...fields, at: new Date().toISOString(), files};
}

// Files the colour fixer should run on now: the line stands at colour,
// the file fails it, no fixer tried this file at this hash, and the
// file isn't itself a fixer's output.
export function fixerTargets(project, config, lineName, checkResults){
  const state = lineState(project, config, lineName, checkResults);
  if(state.step !== "colour" || !checkResults) return [];
  const printCheck = getFormat(config, project.format).printCheck;
  const fixer = (project.plant.lines[lineName] || []).filter(e => e.by === "fixer");
  return lineFiles(project, config, lineName).filter(f => {
    const facts = checkResults[f.name];
    if(!facts || !failing("colour", facts, f.slot, printCheck)) return false;
    return !fixer.some(e => (e.from && e.from[f.name] === facts.sha256) || e.to === f.name);
  }).map(f => f.name);
}

// Every listed line through: done, or ready when its next step is a send.
export function allThrough(project, config, checkResults, stageLines){
  return stageLines.every(name => lineState(project, config, name, checkResults).ready);
}
