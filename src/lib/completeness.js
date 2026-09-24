// Pure completeness rules for the plant view: what a supplied project
// still lacks before deep checks make sense. Reads a prepareProject()
// result plus the files actually present in the zip; no DOM.

import { parseTime, formatTime, trackGapSeconds } from "./time.js";
import { computeStatus } from "./playing-time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { parseQuantity, allocateQuantities, missingAddressFields, emailFormatValid } from "./shipping.js";
import { belowMinimum, colorLabel } from "./vinyl-color.js";

export const ADDRESS_FIELD_LABELS = {
  recipientName: "name", attention: "attention", addressLine1: "address line 1",
  addressLine2: "address line 2", addressLine3: "address line 3", postalCode: "postal code",
  city: "city", stateProvince: "state/province", countryCode: "country", email: "email",
  phone: "phone", vat: "VAT", eori: "EORI"
};

// Same sum as the customer tool's side total: track lengths plus the
// gap before every track but the first. A continuous side's length may
// be empty (read from the file later), which is not invalid.
export function sideTiming(side){
  if(side.blank) return {seconds: 0, invalid: false};
  if(side.continuous){
    const raw = side.continuousLength.trim();
    const seconds = parseTime(raw);
    return {seconds: seconds || 0, invalid: raw !== "" && seconds === null};
  }
  const seconds = side.tracks.reduce((sum, track, i) =>
    sum + (parseTime(track.length) || 0) + trackGapSeconds(track, i === 0), 0);
  return {seconds, invalid: false};
}

function isPrinted(parts, category, id){
  const product = productById((parts[category] && parts[category].products) || [], id);
  return !!product && product.kind === "printed";
}

export function projectGaps(project, config, files){
  const gaps = [];
  const add = (group, text) => gaps.push({group, text});
  const present = new Set(files.map(file => file.name));
  const inZip = (group, name, what) => {
    if(name && !present.has(name)) add(group, `${what} ${name} is not in the zip`);
  };
  const format = getFormat(config, project.format);

  if(!project.catalogue.trim()) add("Release", "no catalogue number");

  const mode = project.soundsystem ? "soundsystem" : "normal";
  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    const group = `Side ${sideId}`;
    if(side.blank) continue;
    if(side.continuous){
      if(!side.continuousFileName) add(group, "no audio file for the side");
      inZip(group, side.continuousFileName, "audio file");
      inZip(group, side.tracklistFileName, "tracklist file");
    } else {
      if(!side.tracks.length) add(group, "no tracks");
      side.tracks.forEach((track, i) => {
        const pos = `${sideId}${i + 1}`;
        if(!track.fileName) add(group, `${pos} has no audio file`);
        inZip(group, track.fileName, `${pos} audio file`);
        if(parseTime(track.length) === null) add(group, `${pos} length missing or invalid`);
      });
    }
    const {seconds, invalid} = sideTiming(side);
    if(invalid) add(group, "side length invalid");
    const status = computeStatus(format.timeLimits, Number(side.rpm), mode, seconds);
    if(status.level === "danger") add(group, `playing time ${formatTime(seconds)} over the ${status.maxMin} min maximum`);
  }

  for(const sideId of ["A", "B"]){
    const label = project.labels.sides[sideId];
    if(label.whitelabel) continue;
    if(!label.fileName) add("Labels", `label ${sideId} has no artwork`);
    inZip("Labels", label.fileName, `label ${sideId} artwork`);
  }

  const parts = format.printableParts || {};
  const sleeve = project.coverSleeve;
  for(const [group, category, part] of [
    ["Inner sleeve", "innerSleeve", sleeve.innerSleeve],
    ["Cover", "outerCover", sleeve.cover]
  ]){
    if(!isPrinted(parts, category, part.productId)) continue;
    if(!part.fileName) add(group, "printed but no artwork");
    inZip(group, part.fileName, "artwork");
  }
  if(isPrinted(parts, "inlay", sleeve.inlay.productId)){
    for(const face of ["front", "back"]){
      const name = sleeve.inlay[face].fileName;
      if(!name) add("Inlay", `${face} has no artwork`);
      inZip("Inlay", name, `${face} artwork`);
    }
  }

  const minOrderQty = (config.vinylColor && config.vinylColor.minOrderQty) || {};
  if(!project.vinylColor.some(row => parseQuantity(row.qty) > 0)) add("Quantity", "no quantity");
  for(const row of project.vinylColor){
    if(!row.qty.trim()) continue;
    if(parseQuantity(row.qty) === null) add("Quantity", `${colorLabel(row.color)}: invalid quantity "${row.qty}"`);
    else if(belowMinimum(row.color, row.qty, minOrderQty)){
      add("Quantity", `${colorLabel(row.color)}: ${row.qty} is below the minimum of ${minOrderQty[row.color]}`);
    }
  }

  const {billing, shipping} = project.shippingBilling;
  for(const field of missingAddressFields(billing)) add("Billing", `${ADDRESS_FIELD_LABELS[field]} missing`);
  if(billing.email.trim() && !emailFormatValid(billing.email)) add("Billing", "email looks malformed");

  if(!shipping.length) add("Shipping", "no shipping address");
  shipping.forEach((address, i) => {
    for(const field of missingAddressFields(address)) add(`Shipping ${i + 1}`, `${ADDRESS_FIELD_LABELS[field]} missing`);
  });
  // The first address takes whatever the others leave, so only invalid
  // or excess quantities on the others are gaps.
  for(const row of project.vinylColor){
    if(parseQuantity(row.qty) === null) continue;
    const extras = shipping.slice(1).map(address => address.qtyByColor[row.color] ?? "");
    if(extras.some(qty => qty.trim() && parseQuantity(qty) === null)){
      add("Shipping", `${colorLabel(row.color)}: invalid shipping quantity`);
    } else if(allocateQuantities(row.qty, extras).overAllocated){
      add("Shipping", `${colorLabel(row.color)}: more shipped than pressed`);
    }
  }
  return gaps;
}
