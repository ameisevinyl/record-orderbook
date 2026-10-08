// Production lines: per product, steps in order (CONFIG.lines). Where a
// line stands is derived on every scan: check steps from the current
// check results, the others from the line's log in project.plant.lines,
// whose entries count while their files keep their sha256. Spec:
// docs/superpowers/specs/2026-10-02-production-lines-design.md.

import { getFormat, productById } from "./format-catalogue.js";
import { artworkSlots, artworkRows } from "./artwork-checks.js";
import { fileSlots } from "./project.js";

// Which checklist rows decide a check step. Spot colours are part of the
// Colour mode row; an unreadable file (File) has no other home than pdf.
const ROWS = {
  size: ["Size"], resolution: ["Resolution"],
  pdf: ["File", "Pages", "PDF version", "Encryption", "Fonts", "Colour profile", "TrimBox"],
  bleed: ["Bleed"], colour: ["Colour mode", "Ink", "Black", "Output intent"]
};
const BAD = new Set(["warn", "error"]);
const kindOf = step => ROWS[step] ? "check" : step === "approve" ? "approve" : step.split(":")[0];

export function lineFiles(project, config, lineName){
  const parts = config.lines[lineName].parts;
  const paths = new Map(fileSlots(project).filter(s => s.name).map(s => [s.name, s.path]));
  return artworkSlots(project, config).filter(s => parts.includes(s.params.part))
    .map(slot => ({name: slot.name, slot: {...slot, path: paths.get(slot.name)}}));
}

// Whether the order has the part printed: a label side that isn't whitelabel,
// a sleeve, cover or inlay product of kind "printed".
function ordered(project, config, part){
  if(part === "labels") return ["A", "B"].some(side => !project.labels.sides[side].whitelabel);
  const sleeve = project.coverSleeve;
  const chosen = {innerSleeve: sleeve.innerSleeve, outerCover: sleeve.cover, inlay: sleeve.inlay}[part];
  const parts = getFormat(config, project.format).printableParts || {};
  const product = productById((parts[part] && parts[part].products) || [], chosen.productId);
  return !!product && product.kind === "printed";
}

// The slots the order has printed but nobody filled yet, as titles: what artworkSlots
// can't show, since it lists only slots with a file (the same slots completeness.js asks for).
function emptySlots(project, config, lineName){
  const sleeve = project.coverSleeve;
  return config.lines[lineName].parts.filter(part => ordered(project, config, part)).flatMap(part => ({
    labels: () => ["A", "B"].filter(side => !project.labels.sides[side].whitelabel && !project.labels.sides[side].fileName)
      .map(side => `Label ${side}`),
    innerSleeve: () => sleeve.innerSleeve.fileName ? [] : ["Inner sleeve"],
    outerCover: () => sleeve.cover.fileName ? [] : ["Cover"],
    inlay: () => ["front", "back"].filter(face => !sleeve.inlay[face].fileName).map(face => `Inlay ${face}`)
  }[part]()));
}

// A line with no parts is every order's; one with parts only when an order has one of them printed.
export function lineNeeded(project, config, lineName){
  const {parts} = config.lines[lineName];
  return !parts.length || parts.some(part => ordered(project, config, part));
}

export const linesOfStage = (config, stage) => Object.keys(config.lines).filter(name => config.lines[name].stage === stage);

// All lines of the job's stage are ready (states: lineState results): move on? None in the stage, no hint.
export function stageReady(config, stage, states){
  const names = linesOfStage(config, stage);
  return names.length > 0 && states.filter(s => names.includes(s.line)).every(s => s.ready);
}

// A failing row of a check step for one file, as "why" text; null when it passes.
function failing(step, facts, slot, printCheck){
  const row = artworkRows(facts, slot.params, printCheck).find(r => ROWS[step].includes(r.feature) && BAD.has(r.severity));
  return row ? `${slot.title}: ${row.detected}${row.expected ? `, expected ${row.expected}` : ""}` : null;
}

// A file without a hash (missing, unreadable) is null on both sides.
function counts(entry, current){
  return !entry.files || Object.entries(entry.files).every(([name, sha]) => (current[name] ?? null) === sha);
}

export function lineState(project, config, lineName, checkResults){
  const line = config.lines[lineName];
  const steps = line.steps.map(step => ({step, kind: kindOf(step), state: "ahead"}));
  // Not on this order: nothing to do, and nothing for later lines to wait for.
  if(!lineNeeded(project, config, lineName)){
    return {line: lineName, steps, step: null, why: "", ready: true, done: true, waiting: false, checking: false, needed: false};
  }
  const files = lineFiles(project, config, lineName);
  const empty = emptySlots(project, config, lineName);
  const waiting = (line.after || []).some(other => !lineState(project, config, other, checkResults).done);
  // Only check steps need the artwork check results; a line of hand-confirmed steps doesn't.
  if(!checkResults && files.length && steps.some(s => s.kind === "check")){
    return {line: lineName, steps, step: null, why: "checking", ready: false, done: false, waiting, checking: true, needed: true};
  }
  const results = checkResults || {};
  const printCheck = getFormat(config, project.format).printCheck;
  const current = Object.fromEntries(files.map(f => [f.name, (results[f.name] || {}).sha256]));
  const log = (project.plant.lines[lineName] || []).filter(e => e.by !== "fixer" && counts(e, current));
  const logged = step => log.some(e => e.step === step && (!step.startsWith("send:") || e.to));
  let at = null, why = "";
  for(const s of steps){
    let done;
    if(s.kind === "check"){
      const reasons = [...empty.map(title => `${title}: no file uploaded yet`),
        ...files.map(f => results[f.name] ? failing(s.step, results[f.name], f.slot, printCheck)
          : `${f.slot.title}: not checked yet`).filter(Boolean)];
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
  return {line: lineName, steps, step: at, why: at ? why : "", ready, done: at === null, waiting, checking: false, needed: true};
}

export function logEntry(project, config, lineName, checkResults, fields){
  const files = Object.fromEntries(lineFiles(project, config, lineName)
    .map(f => [f.name, (checkResults[f.name] || {}).sha256 || null]));
  return {...fields, at: new Date().toISOString(), files};
}

// Every listed line through: done, or ready when its next step is a send.
export function allThrough(project, config, checkResults, stageLines){
  return stageLines.every(name => lineState(project, config, name, checkResults).ready);
}
