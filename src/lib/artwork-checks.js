// Pure artwork rules for the plant view: which files to measure (with
// the part's parameters, sent to plant/checks.py) and how to judge the
// facts it returns — the customer page's checklist on exact values plus
// Ink, Black and Bleed. No DOM.

import { getFormat, artworkSize, productById } from "./format-catalogue.js";
import { buildChecklistRows, resolveSeverity } from "./print-artwork.js";

// Share of the page area (%) a problem may cover before it counts —
// single stray pixels don't.
const AREA_PCT = 0.5;
// Bleed: ink right inside the cut but hardly any in the bleed means the
// artwork was trimmed to the finished size.
const EDGE_INKED_PCT = 20, BLEED_EMPTY_PCT = 5;

export function artworkSlots(project, config){
  const format = getFormat(config, project.format);
  const {printCheck, printableParts: parts} = format;
  const slots = [];
  const add = (title, slot, part, sizes) => {
    if(!slot.fileName) return;
    slots.push({title, name: slot.fileName, params: {
      part, ...sizes, page: slot.page, inkLimitPct: printCheck.inkLimitPct[part],
      black: printCheck.black, toleranceMm: printCheck.sizeToleranceMm
    }});
  };

  const holeMm = format.centerHole[project.labels.bigCenter ? "big" : "normal"];
  for(const side of ["A", "B"]){
    const slot = project.labels.sides[side];
    if(slot.whitelabel) continue;
    add(`Label ${side}`, slot, "labels", {...artworkSize(format, "labels"), holeMm});
  }

  const sleeve = project.coverSleeve;
  for(const [title, slot, part, productId] of [
    ["Inner sleeve", sleeve.innerSleeve, "innerSleeve", sleeve.innerSleeve.productId],
    ["Cover", sleeve.cover, "outerCover", sleeve.cover.productId],
    ["Inlay front", sleeve.inlay.front, "inlay", sleeve.inlay.productId],
    ["Inlay back", sleeve.inlay.back, "inlay", sleeve.inlay.productId]
  ]){
    const size = artworkSize(format, part, productById((parts[part] && parts[part].products) || [], productId));
    if(size) add(title, slot, part, size);
  }
  return slots;
}

// Ink right inside the cut but hardly any in the bleed: the artwork was
// trimmed to the finished size.
function bleedTrimmed(facts){
  const {outerInkPct: outer, innerInkPct: inner} = facts.bleed;
  return outer !== null && inner >= EDGE_INKED_PCT && outer < BLEED_EMPTY_PCT;
}

function measuredRows(facts, params, checks){
  const rows = [];
  const inkOk = facts.ink.overPct <= AREA_PCT;
  rows.push({feature: "Ink", severity: resolveSeverity(checks.ink.severity, inkOk),
    detected: `max ${Math.round(facts.ink.maxPct)} %` + (inkOk ? "" : `, ${facts.ink.overPct.toFixed(1)} % of the area over`),
    expected: inkOk ? null : `≤ ${params.inkLimitPct} %`});

  const blackOk = facts.black.richPct <= AREA_PCT;
  rows.push({feature: "Black", severity: resolveSeverity(checks.black.severity, blackOk),
    detected: blackOk ? "no rich black" : `rich black on ${facts.black.richPct.toFixed(1)} % of the area`,
    expected: blackOk ? null : "100 % K"});

  const noBleed = facts.bleed.outerInkPct === null;
  const trimmed = bleedTrimmed(facts);
  rows.push({feature: "Bleed", severity: resolveSeverity(checks.bleed.severity, !noBleed && !trimmed),
    detected: noBleed ? "no bleed in the file" : trimmed ? "empty — artwork looks trimmed" : "ok",
    expected: noBleed ? `${params.bleedMm} mm bleed` : trimmed ? `artwork into the ${params.bleedMm} mm bleed` : null});
  return rows;
}

export function artworkRows(facts, params, printCheck){
  if(facts.error) return [{feature: "File", severity: "error", detected: facts.error, expected: null}];
  const rows = buildChecklistRows(facts.parsed, facts.kind, params.targetMm, params.trimMm, printCheck, true, params.page);
  return facts.ink ? rows.concat(measuredRows(facts, params, printCheck.checks)) : rows;
}

export function artworkVerdict(rows){
  if(rows.some(row => row.severity === "error")) return "customer";
  if(rows.some(row => row.severity === "warn")) return "review";
  return "ok";
}

// A label the plant's colour fix can help: its ink or black row warns.
export function fixable(facts, params, printCheck){
  if(params.part !== "labels" || !facts || facts.error || !facts.ink) return false;
  return artworkRows(facts, params, printCheck).some(r => (r.feature === "Ink" || r.feature === "Black") && r.severity === "warn");
}

// Size and bleed fixes for a checked file, rendered by plant/geomfix.py:
// the source scaled by `scale` and centred on the data size, `keep` (the
// whole "file" or the "trim") kept, the rest mirrored from its edge when
// `fill` is set. dpiAfter: the detail the file really has afterwards —
// the fix is written at fixDpi regardless.
export function geometryFixes(facts, params){
  if(!facts || facts.error || !facts.pageMm || !facts.bleed) return [];
  const S = facts.pageMm, T = params.targetMm, trim = params.trimMm, tol = params.toleranceMm;
  const dpi = facts.parsed.effectiveDpi || facts.parsed.declaredDpi;
  const make = (id, title, scale, keep, fill) => ({id, title, scale, keep, fill,
    dpiAfter: dpi ? Math.round(Math.min(dpi.x, dpi.y) / scale) : null});
  const mm = v => `${v.toFixed(1)} mm`;
  // Per side and axis: cropped (> 0) or missing (< 0) after scaling.
  const over = scale => ({w: (S.w * scale - T.w) / 2, h: (S.h * scale - T.h) / 2});
  const crop = o => Math.max(o.w, o.h) > tol ? ` · crops ${mm(Math.max(o.w, o.h))}` : "";
  if(Math.abs(S.w - T.w) > tol || Math.abs(S.h - T.h) > tol){
    const fit = Math.max(T.w / S.w, T.h / S.h);
    const fixes = [make("fit", `Scale to fit · ×${fit.toFixed(3)}${crop(over(fit))}`, fit, "file", null)];
    // Mirroring a file smaller than the trim would reach inside the cut;
    // cropping more than the bleed is no longer the same layout (and an
    // oversized file at fixDpi would take gigabytes) — fit does that.
    const o = over(1);
    if(S.w >= trim.w && S.h >= trim.h && Math.max(o.w, o.h) <= params.bleedMm){
      const mirror = Math.max(0, -o.w, -o.h);
      fixes.push(make("keep", `Keep 1:1${mirror > 0 ? ` · mirror ${mm(mirror)}` : ""}${crop(o)}`, 1, "file", "mirror"));
    }
    return fixes;
  }
  if(!bleedTrimmed(facts)) return [];
  const zoom = Math.max(T.w / trim.w, T.h / trim.h);
  return [make("rebuild", `Trim + rebuild bleed · mirror ${mm(params.bleedMm)}`, 1, "trim", "mirror"),
    make("zoom", `Zoom into bleed · ×${zoom.toFixed(3)}`, zoom, "file", null)];
}

// Per checked slot, its newest version newer than the one in use — a
// colour fix or a hand-saved fix — to show and check next to it.
export function newerToCompare(slots, checkable){
  return checkable.flatMap(c => {
    const slot = slots.find(s => s.name === c.name);
    const newer = slot ? slot.others.filter(o => o.newer) : [];
    // A newer file is checked on its first page: the slot's page choice
    // was for the file in use.
    return newer.length ? [{title: `${c.title} — ${newer[0].name}`, name: newer[0].name, params: {...c.params, page: 1}, of: c.name}] : [];
  });
}
