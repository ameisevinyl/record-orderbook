// Pure artwork rules for the plant view: which files to measure (with
// the part's parameters, sent to plant/checks.py) and how to judge the
// facts it returns — the customer page's checklist on exact values plus
// Ink, Black and Bleed. No DOM.

import { getFormat, labelDataSizeMm, flatDataMm, productById } from "./format-catalogue.js";
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

  const label = parts.label;
  const data = labelDataSizeMm(label);
  for(const side of ["A", "B"]){
    const slot = project.labels.sides[side];
    if(slot.whitelabel) continue;
    add(`Label ${side}`, slot, "labels", {targetMm: {w: data, h: data},
      trimMm: {w: label.diameterMm, h: label.diameterMm}, bleedMm: label.bleedMm, round: true,
      holeMm: format.centerHole[project.labels.bigCenter ? "big" : "normal"]});
  }

  const sleeve = project.coverSleeve;
  for(const [title, slot, part, productId] of [
    ["Inner sleeve", sleeve.innerSleeve, "innerSleeve", sleeve.innerSleeve.productId],
    ["Cover", sleeve.cover, "outerCover", sleeve.cover.productId],
    ["Inlay front", sleeve.inlay.front, "inlay", sleeve.inlay.productId],
    ["Inlay back", sleeve.inlay.back, "inlay", sleeve.inlay.productId]
  ]){
    const product = productById((parts[part] && parts[part].products) || [], productId);
    if(!product || product.kind !== "printed") continue;
    add(title, slot, part, {targetMm: flatDataMm(product), trimMm: product.trimMm,
      bleedMm: product.bleedMm, round: false});
  }
  return slots;
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

  const {outerInkPct: outer, innerInkPct: inner} = facts.bleed;
  const noBleed = outer === null;
  const trimmed = !noBleed && inner >= EDGE_INKED_PCT && outer < BLEED_EMPTY_PCT;
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
