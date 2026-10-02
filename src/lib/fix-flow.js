// The plant's fix flow per printed part: the checks decide the first
// failing step (size → pdf → colour), each step has one fix, proposed as
// the slot's next version and accepted or dismissed by staff; the log is
// project.plant.fixes. Spec: docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md.

import { artworkRows, bleedTrimmed } from "./artwork-checks.js";

export const FIX_STEPS = ["size", "pdf", "colour"];
const BAD = new Set(["warn", "error"]);

// The size step's one fix by rule: within the bleed crop or mirror 1:1
// (the design stays where it is against the cut), beyond it scale, right
// size with an empty bleed rebuild it. A wrong ratio only a person fixes.
function sizeFix(facts, params){
  const S = facts.pageMm, T = params.targetMm, tol = params.toleranceMm, bleed = params.bleedMm;
  const dpi = facts.parsed.effectiveDpi || facts.parsed.declaredDpi;
  const detail = scale => dpi ? ` · detail ${Math.round(Math.min(dpi.x, dpi.y) / scale)} dpi` : "";
  if(Math.abs(S.w - T.w) <= tol && Math.abs(S.h - T.h) <= tol){
    return {candidate: {scale: 1, keep: "trim", fill: "mirror"}, detail: `rebuilt the ${bleed} mm bleed by mirroring`};
  }
  const k = Math.max(T.w / S.w, T.h / S.h);
  if(Math.abs(S.w * k - T.w) > tol || Math.abs(S.h * k - T.h) > tol){
    return {manual: `aspect ratio ${S.w.toFixed(1)}×${S.h.toFixed(1)} mm vs ${T.w}×${T.h} mm — needs correction by hand`};
  }
  const dw = (T.w - S.w) / 2;
  if(Math.abs(dw) <= bleed && Math.abs((T.h - S.h) / 2) <= bleed){
    const what = dw >= 0 ? `mirror ${dw.toFixed(1)} mm` : `crop ${(-dw).toFixed(1)} mm`;
    return {candidate: {scale: 1, keep: "file", fill: "mirror"}, detail: `crop/add bleed 1:1, ${what}${detail(1)}`};
  }
  return {candidate: {scale: k, keep: "file", fill: null}, detail: `scaled ×${k.toFixed(3)}${detail(k)}`};
}

// The first failing step of a checked file that isn't closed (dismissed)
// for its content, with its fix or why only a person can fix it; null
// when every step passes or the file isn't checked yet.
export function fixStep(facts, params, printCheck, closed = []){
  if(!facts) return null;
  if(facts.error) return {step: "pdf", manual: facts.error};
  if(!facts.pageMm) return {step: "pdf", manual: "encrypted PDF — needs the file without a password"};
  const rows = artworkRows(facts, params, printCheck);
  const bad = names => rows.some(r => names.includes(r.feature) && BAD.has(r.severity));
  const fails = {
    size: bad(["Size"]) || bleedTrimmed(facts),
    pdf: facts.kind !== "pdf" || facts.parsed.pdfVersion !== "1.3",
    colour: bad(["Colour mode", "Ink", "Black", "Output intent"])
  };
  const step = FIX_STEPS.find(s => fails[s] && !closed.includes(s));
  if(!step) return null;
  if(step === "size"){
    const fix = sizeFix(facts, params);
    return fix.manual ? {step, manual: fix.manual} : {step, fix: {kind: "geometry", ...fix}};
  }
  if(step === "pdf"){
    return {step, fix: {kind: "geometry", candidate: {scale: 1, keep: "file", fill: null},
      detail: `rasterized at ${params.fixDpi} dpi, PDF 1.3`}};
  }
  return {step, fix: bad(["Colour mode", "Ink", "Black"])
    ? {kind: "colour", detail: "colour fix"}
    : {kind: "assign", detail: `assigned ${params.profile.name}, colours unchanged`}};
}

// A slot's place in the flow from the fixes log (entries of this file
// content only): the current step, and the pending proposal — proposed,
// its file still there, not dismissed since. A refused fix stops the flow.
export function slotFlow(log, facts, params, printCheck, names){
  const mine = facts ? log.filter(e => e.sha256 === facts.sha256) : [];
  const last = step => mine.filter(e => e.step === step).at(-1);
  const closed = FIX_STEPS.filter(s => (last(s) || {}).result === "dismissed");
  const current = fixStep(facts, params, printCheck, closed);
  if(!current || current.manual) return {current, proposal: null};
  const entry = last(current.step);
  if(entry && entry.result === "refused") return {current: {step: current.step, manual: `fix refused — ${entry.error}`}, proposal: null};
  return {current, proposal: entry && entry.result === "proposed" && names.includes(entry.to) ? entry : null};
}
