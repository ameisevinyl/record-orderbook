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

// Label data size: the print file's diameter, bleed included —
// symmetric, so one number (like diameterMm itself), not {w,h}. Takes
// the label part directly (it carries its own bleedMm — every part is
// fully self-contained, see config.js).
export function labelDataSizeMm(label){
  return label.diameterMm + 2 * label.bleedMm;
}

// Every non-label printable part's trimMm is already the full flat,
// unfolded print-file footprint (outerCover's already has its spine
// folded in; innerSleeve's is front+back opened flat side by side, not
// the folded pocket size — see its separate finalMm; inlay is a single
// flat sheet). Data size is trim plus the part's own symmetric bleed
// on every edge.
export function flatDataMm(part){
  return { w: part.trimMm.w + 2*part.bleedMm, h: part.trimMm.h + 2*part.bleedMm };
}

// Paper weight in grams: trim area (the finished, shipped size — bleed
// gets trimmed away, it doesn't ship) times the part's paperGsm
// (grams/m²), converted mm² -> m². One decimal place — these are
// small enough (single-digit to double-digit grams) that whole-gram
// rounding would lose real precision.
export function partWeightG(part){
  const areaM2 = (part.trimMm.w * part.trimMm.h) / 1_000_000;
  return Math.round(areaM2 * part.paperGsm * 10) / 10;
}

// Splits a category's product list by kind, for building <optgroup>s in
// the category's dropdown. Either array may be empty — e.g. inlay's
// product list never has an "unprinted" entry.
export function groupProductsByKind(products){
  return {
    printed: products.filter(p => p.kind === "printed"),
    unprinted: products.filter(p => p.kind === "unprinted")
  };
}

// Looks up one product by id. undefined for a null id (the "None"
// selection) or an id with no match (e.g. a stale id from a project
// saved against a different/older product list).
export function productById(products, id){
  return id == null ? undefined : products.find(p => p.id === id);
}

// The artwork file's expected size for one printed part: labels from the
// format's label, flat parts from their product. null for an unprinted
// product or none — no artwork file then.
export function artworkSize(format, part, product){
  if(part === "labels"){
    const label = format.printableParts.label;
    const data = labelDataSizeMm(label);
    return {targetMm: {w: data, h: data}, trimMm: {w: label.diameterMm, h: label.diameterMm},
      bleedMm: label.bleedMm, round: true};
  }
  if(!product || product.kind !== "printed") return null;
  return {targetMm: flatDataMm(product), trimMm: product.trimMm, bleedMm: product.bleedMm, round: false};
}

// Specifications panel of a flat part's product as [label, value] rows;
// a row shows only when the product has that value. File rows only for
// a printed product (they describe the artwork file).
export function partSpecRows(product, {fileTypes, colorMode, debug}){
  if(!product) return [];
  const mm = s => `${s.w}×${s.h}mm`;
  const printed = product.kind === "printed";
  const rows = [];
  if(printed) rows.push(["Allowed filetypes", fileTypes], ["Colour mode", colorMode]);
  if(product.finalMm) rows.push(["Final size", mm(product.finalMm)]);
  if(product.trimMm) rows.push(["End format", mm(product.trimMm)]);
  if(printed) rows.push(["Data format", mm(flatDataMm(product))], ["Bleed", `${product.bleedMm}mm`]);
  if(product.spineMm != null) rows.push(["Spine", `${product.spineMm}mm`]);
  rows.push(["Paper weight", `${product.paperGsm}gsm`]);
  if(product.cutoutDiameterMm) rows.push(["Center cut-out", `⌀${product.cutoutDiameterMm}mm`]);
  if(debug && product.trimMm) rows.push(["Shipping weight", `${partWeightG(product)}g`]);
  return rows;
}
