// Pure builders for the two human-readable documents included in a project.

import { formatTime, parseTime, trackGapSeconds } from "./time.js";
import { renderTable } from "./text-table.js";
import { humanDate } from "./package-naming.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { parseQuantity } from "./shipping.js";

function documentHeader(project, label, date){
  const cat = project.catalogue || "(no catalogue number)";
  const title = project.albumTitle || "(no title)";
  const artist = project.albumArtist || "(no artist)";
  const cut = project.soundsystem ? "soundsystem" : "normal";
  return `${label}\n${cat} - ${title} - ${artist} - ${humanDate(date)}\nFormat: ${project.format || "?"}\"\nCut: ${cut}\n\n`;
}

function tracksNeedArtistColumn(project){
  return ["A", "B"].some(side =>
    ((project.sides && project.sides[side] && project.sides[side].tracks) || [])
      .some(t => t && t.artist && t.artist !== project.albumArtist)
  );
}

function trackRows(side, tracks, showArtist, includeFileName){
  let cursor = 0;
  const rows = tracks.map((track, i)=>{
    const t = track || {};
    const gap = trackGapSeconds(t, i === 0);
    cursor += gap;
    const cells = [side+(i+1), formatTime(gap), formatTime(cursor), t.length || "?:??", t.title || "(untitled)"];
    if(showArtist) cells.push(t.artist || "");
    if(includeFileName) cells.push(t.fileName || "(no file — manual entry)");
    cursor += parseTime(t.length) || 0;
    return cells;
  });
  return {rows, total:cursor};
}

function tracklistBody(project){
  const showArtist = tracksNeedArtistColumn(project);
  let out = "";

  for(const side of ["A", "B"]){
    const s = (project.sides && project.sides[side]) || {};
    const tracks = s.tracks || [];
    if(s.blank){
      out += `SIDE ${side} — blank\n\n`;
      continue;
    }

    if(s.continuous){
      const total = parseTime(s.continuousLength) || 0;
      out += `SIDE ${side} — ${s.rpm || "?"} RPM — total ${formatTime(total)}\n`;
      out += `  matrix: ${s.matrixInscription || "(none)"}\n`;
      out += `  continuous file (authoritative): ${s.continuousFileName || "(none selected)"}\n`;
      if(s.tracklistFileName) out += `  tracklist/cuesheet: ${withOriginal(s.tracklistFileName, s.tracklistOriginalFileName)}\n`;
      if(tracks.length){
        const headers = ["Pos.", "Pregap", "Start", "Length", "Title"];
        if(showArtist) headers.push("Artist");
        const {rows} = trackRows(side, tracks, showArtist, false);
        out += "  saved cue/sequence list:\n" + renderTable(headers, rows) + "\n";
      }
      out += "\n";
      continue;
    }

    const headers = ["Pos.", "Pregap", "Start", "Length", "Title"];
    if(showArtist) headers.push("Artist");
    headers.push("filename");
    const {rows, total} = trackRows(side, tracks, showArtist, true);

    out += `SIDE ${side} — ${s.rpm || "?"} RPM — total ${formatTime(total)}\n`;
    out += `  matrix: ${s.matrixInscription || "(none)"}\n`;
    out += renderTable(headers, rows) + "\n\n";
  }
  return out;
}

function withOriginal(fileName, originalFileName){
  const name = fileName || "(no file)";
  return name + (fileName && originalFileName && originalFileName !== fileName ? ` (was: ${originalFileName})` : "");
}

function filesManifestSection(project){
  const labels = project.labels || {};
  const labelSides = labels.sides || {};
  const coverSleeve = project.coverSleeve || {};
  const cover = coverSleeve.cover || {};
  const innerSleeve = coverSleeve.innerSleeve || {};
  const inlay = coverSleeve.inlay || {};
  const front = inlay.front || {};
  const back = inlay.back || {};
  const sides = project.sides || {};
  const packageFiles = [
    (sides.A || {}).tracklistFileName, (sides.B || {}).tracklistFileName,
    (labelSides.A || {}).fileName, (labelSides.B || {}).fileName,
    innerSleeve.fileName, cover.fileName, front.fileName, back.fileName
  ].filter(Boolean);
  if(!packageFiles.length) return "";
  return "Files:\n" + packageFiles.map(file => `  ${file}`).join("\n") + "\n\n";
}

function packagingSection(project, config){
  const format = getFormat(config, project.format);
  const parts = (format && format.printableParts) || {};
  const labels = project.labels || {};
  const labelSides = labels.sides || {};
  const coverSleeve = project.coverSleeve || {};
  const cover = coverSleeve.cover || {};
  const innerSleeve = coverSleeve.innerSleeve || {};
  const inlay = coverSleeve.inlay || {};
  const front = inlay.front || {};
  const back = inlay.back || {};

  const centerKey = labels.bigCenter ? "big" : "normal";
  const centerName = labels.bigCenter ? "big" : "standard";
  const centerDiameter = format && format.centerHole && format.centerHole[centerKey];
  let out = "PACKAGING:\n";
  out += `  Center hole: ${centerName}${centerDiameter ? ` (${centerDiameter}mm)` : ""}\n`;

  for(const side of ["A", "B"]){
    const label = labelSides[side] || {};
    out += label.whitelabel
      ? `  Label ${side}: whitelabel\n`
      : `  Label ${side}: printed — ${withOriginal(label.fileName, label.originalFileName)}\n`;
  }

  const coverProduct = productById((parts.outerCover && parts.outerCover.products) || [], cover.productId);
  out += !coverProduct
    ? "  Cover: none\n"
    : coverProduct.kind === "printed"
      ? `  Cover: ${coverProduct.name} — ${withOriginal(cover.fileName, cover.originalFileName)}\n`
      : `  Cover: ${coverProduct.name}\n`;

  const sleeveProduct = productById((parts.innerSleeve && parts.innerSleeve.products) || [], innerSleeve.productId);
  out += !sleeveProduct
    ? "  Inner sleeve: (unrecognized product)\n"
    : sleeveProduct.kind === "printed"
      ? `  Inner sleeve: ${sleeveProduct.name} — ${withOriginal(innerSleeve.fileName, innerSleeve.originalFileName)}\n`
      : `  Inner sleeve: ${sleeveProduct.name}\n`;

  const inlayProduct = productById((parts.inlay && parts.inlay.products) || [], inlay.productId);
  out += inlayProduct
    ? `  Inlay: front — ${withOriginal(front.fileName, front.originalFileName)}\n`
      + `         back  — ${withOriginal(back.fileName, back.originalFileName)}\n`
    : "  Inlay: none\n";

  return out + "\n";
}

function notesSection(project){
  const notes = String(project.notes || "").trim();
  return notes ? `NOTES TO CUTTING ENGINEER:\n${notes}\n` : "";
}

function shippingBillingSection(project){
  const shippingBilling = project.shippingBilling || {};
  const billing = shippingBilling.billing || {};
  const shipping = shippingBilling.shipping || [];
  const vinylColor = project.vinylColor || [];
  const overallBreakdown = vinylColor
    .map(row => ({row:row || {}, quantity:parseQuantity(row && row.qty)}))
    .filter(({row, quantity}) => quantity > 0 || (String(row.qty || "").trim() && quantity === null))
    .map(({row, quantity}) => quantity === null
      ? `INVALID qty "${row.qty}" ${colorLabel(row.color || "")}`
      : `${quantity} ${colorLabel(row.color || "")}`)
    .join(", ");

  let out = "BILLING ADDRESS:\n";
  out += `  ${billing.recipientName || ""}${billing.attention ? " — " + billing.attention : ""}\n`;
  out += `  ${billing.addressLine1 || ""}\n`;
  if(billing.addressLine2) out += `  ${billing.addressLine2}\n`;
  if(billing.addressLine3) out += `  ${billing.addressLine3}\n`;
  out += `  ${billing.postalCode || ""} ${billing.city || ""}${billing.stateProvince ? ", " + billing.stateProvince : ""}\n`;
  out += `  ${billing.countryCode || ""}\n`;
  out += `  ${billing.email || ""}${billing.phone ? "  " + billing.phone : ""}\n`;
  if(billing.vat) out += `  VAT: ${billing.vat}\n`;
  if(billing.eori) out += `  EORI: ${billing.eori}\n`;

  out += `\nSHIPPING${overallBreakdown ? " (pressed: " + overallBreakdown + ")" : ""}:\n`;
  shipping.forEach((entry, i)=>{
    const s = entry || {};
    const quantities = Object.entries(s.qtyByColor || {})
      .map(([color, qty]) => ({color, raw:qty, quantity:parseQuantity(qty)}))
      .filter(({raw, quantity}) => quantity > 0 || (String(raw || "").trim() && quantity === null))
      .map(({color, raw, quantity}) => quantity === null ? `INVALID qty "${raw}" ${color}` : `${quantity} ${color}`)
      .join(", ");
    out += `  [${i+1}] ${quantities || "no qty"} — ${s.recipientName || ""}${s.attention ? " / " + s.attention : ""}\n`;
    out += `      ${s.addressLine1 || ""}${s.addressLine2 ? ", " + s.addressLine2 : ""}${s.addressLine3 ? ", " + s.addressLine3 : ""}\n`;
    out += `      ${s.postalCode || ""} ${s.city || ""}${s.stateProvince ? ", " + s.stateProvince : ""}, ${s.countryCode || ""}${s.isResidential ? " (residential)" : ""}\n`;
    out += `      ${s.email || ""}${s.phone ? "  " + s.phone : ""}${s.eori ? "  EORI: " + s.eori : ""}${s.vat ? "  VAT: " + s.vat : ""}\n`;
    if(s.note) out += `      note: ${s.note}\n`;
  });
  return out;
}

function historySection(project){
  const history = project.history || [];
  if(!history.length) return "";
  return "\nHISTORY:\n" + history.map(h => `  ${h.savedAt} ${h.by}: ${h.note}\n`).join("");
}

export function buildOrderSummaryText(project, config, date){
  return documentHeader(project, "ORDER SUMMARY", date)
    + filesManifestSection(project)
    + packagingSection(project, config)
    + tracklistBody(project)
    + notesSection(project)
    + "\n" + shippingBillingSection(project)
    + historySection(project);
}

export function buildTracklistText(project, config, date){
  // Keep config in the public signature alongside buildOrderSummaryText;
  // this document currently needs no format-specific packaging data.
  void config;
  return documentHeader(project, "TRACKLIST", date)
    + tracklistBody(project)
    + notesSection(project);
}
