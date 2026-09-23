// Pure lookups over CONFIG.formats — no DOM, no CONFIG import (the
// caller passes CONFIG in, so this stays testable independently of
// where CONFIG lives). `formats` is an array, each entry a fully
// self-contained description of one physical format; array order is
// display order.

export function getFormat(config, id){
  return config.formats.find(f => f.id === id);
}

export function enabledFormats(config){
  return config.formats.filter(f => f.enabled);
}

export function firstEnabledFormat(config){
  const first = enabledFormats(config)[0];
  if(!first) throw new Error("CONFIG.formats: at least one format must be enabled");
  return first.id;
}

// Bleed for one printable part: its own override if set, else the
// format's printableParts.bleedMm default (outerCover overrides this —
// its bleed runs thicker than label/innerSleeve/inlay). Exported since
// every module's Specifications panel needs to show this same value.
export function bleedFor(part, printableParts){
  return part.bleedMm ?? printableParts.bleedMm;
}

// Label data size: the print file's diameter, bleed included —
// symmetric, so one number (like diameterMm itself), not {w,h}.
export function labelDataSizeMm(printableParts){
  return printableParts.label.diameterMm + 2 * bleedFor(printableParts.label, printableParts);
}

// A part whose trimMm is already the full flat print-file footprint —
// outerCover (spine already folded into trimMm, see config.js) and
// inlay (a single flat sheet). Data size is trim plus symmetric bleed
// on every edge.
export function flatDataMm(part, printableParts){
  const bleed = bleedFor(part, printableParts);
  return { w: part.trimMm.w + 2*bleed, h: part.trimMm.h + 2*bleed };
}

// Inner sleeve's trimMm is ONE folded pocket's finished size — the
// print file is front+back opened flat side by side (double width),
// plus symmetric bleed on every edge.
export function foldedDataMm(part, printableParts){
  const bleed = bleedFor(part, printableParts);
  return { w: part.trimMm.w*2 + 2*bleed, h: part.trimMm.h + 2*bleed };
}
