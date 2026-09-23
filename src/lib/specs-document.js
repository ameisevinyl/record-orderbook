// Builds the "Specs" button's reference document — every enabled
// format's label/printed-part/audio specs, baked into one self-
// contained HTML page. The browser's own Print-to-PDF gives an actual
// PDF if wanted; no hand-rolled PDF writer needed. Pure string-building
// — no DOM, testable like every other lib/ file.

import { enabledFormats, labelDataSizeMm, flatDataMm, partWeightG } from "./format-catalogue.js";

function esc(str){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function kvTable(rows){
  return `<table><tbody>${rows.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

// One row per PRINTED product — unprinted stock has no artwork file, so
// its print spec is nothing but noise in this document. Columns that
// don't apply to any of a category's printed products (e.g. Spine on
// inner sleeve, Final size on inlay) are dropped rather than shown as a
// full column of "—", same "only what applies" rule the live
// Specifications box follows for a selected product.
function productTable(title, products){
  const printed = products.filter(p => p.kind === "printed");
  if(!printed.length) return "";

  const dataSize = p => { const d = flatDataMm(p); return `${d.w}×${d.h}mm`; };
  const columns = [
    ["Product",     p => esc(p.name)],
    ["Final size",  p => p.finalMm ? `${p.finalMm.w}×${p.finalMm.h}mm` : "—"],
    ["End format",  p => p.trimMm ? `${p.trimMm.w}×${p.trimMm.h}mm` : "—"],
    ["Data format", p => p.trimMm ? dataSize(p) : "—"],
    ["Bleed",       p => p.trimMm ? `${p.bleedMm}mm` : "—"],
    ["Spine",       p => p.spineMm != null ? `${p.spineMm}mm` : "—"],
    ["Paper",       p => `${p.paperGsm}gsm`],
    ["Cut-out",     p => p.cutoutDiameterMm ? `⌀${p.cutoutDiameterMm}mm` : "—"],
    ["Weight",      p => p.trimMm ? `${partWeightG(p)}g` : "—"]
  ].filter(([, valueOf]) => printed.some(p => valueOf(p) !== "—"));

  const head = columns.map(([h]) => `<th>${esc(h)}</th>`).join("");
  const body = printed.map(p => `<tr>${columns.map(([, valueOf]) => `<td>${valueOf(p)}</td>`).join("")}</tr>`).join("");
  return `<h3>${esc(title)}</h3>
    <table>
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function timeLimitsTable(format){
  const cutRow = (key, label) => {
    const t = format.timeLimits[key];
    return `<tr><td>${esc(label)}</td><td>${t.ideal[33]}min</td><td>${t.max[33]}min</td><td>${t.ideal[45]}min</td><td>${t.max[45]}min</td></tr>`;
  };
  return `<h3>Playing time limits</h3>
    <table>
      <thead><tr><th>Cut</th><th>33⅓ ideal</th><th>33⅓ max</th><th>45 ideal</th><th>45 max</th></tr></thead>
      <tbody>${cutRow("normal","normal")}${cutRow("soundsystem","soundsystem")}</tbody>
    </table>`;
}

function printFilesTable(format, artworkFileTypes, printSpec){
  const { checks, dpi } = format.printCheck;
  return `<h3>Print files</h3>
    ${kvTable([
      ["Allowed filetypes", artworkFileTypes.labels.join(", ")],
      ["Colour mode", checks.colorMode.accepted.join("/")],
      ["Colour profile", printSpec.colourProfile],
      ["Spot colours", checks.spotColors.accepted ? "allowed" : "not allowed"],
      ["Resolution", `${dpi.min}–${dpi.max} dpi`]
    ])}`;
}

function centerHoleLabel(centerHole){
  return Object.entries(centerHole).map(([kind, mm]) => `${kind} ${mm}mm`).join(" · ");
}

function formatSection(format, artworkFileTypes, printSpec){
  const label = format.printableParts.label;
  const parts = format.printableParts;
  return `<section class="format">
    <h2>${esc(format.label)}</h2>
    ${kvTable([
      ["RPM (default)", format.rpm],
      ["Center hole", centerHoleLabel(format.centerHole)],
      ["Record weight", format.recordWeightG + "g"]
    ])}
    ${timeLimitsTable(format)}
    ${printFilesTable(format, artworkFileTypes, printSpec)}
    <h3>Label</h3>
    <table>
      <thead><tr><th>End format</th><th>Bleed</th><th>Data format</th></tr></thead>
      <tbody><tr><td>⌀${label.diameterMm}mm</td><td>${label.bleedMm}mm</td><td>${labelDataSizeMm(label)}×${labelDataSizeMm(label)}mm</td></tr></tbody>
    </table>
    ${productTable("Inner Sleeve", parts.innerSleeve.products)}
    ${productTable("Outer Cover", parts.outerCover.products)}
    ${productTable("Inlay", parts.inlay.products)}
  </section>`;
}

function audioSection(audioSpec){
  return `<h2>Audio Master Files</h2>
    ${kvTable([
      ["Allowed filetypes", audioSpec.labels.join(", ")],
      ["Bit depth", `${audioSpec.minBitDepth}-bit min (${audioSpec.recommendedBitDepth}-bit recommended)`],
      ["Sample rate", (audioSpec.minSampleRateHz/1000) + "kHz min"]
    ])}`;
}

const SPECS_CSS = `
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
       color:#161616;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.5;}
  h1{font-size:18px;margin-bottom:4px;}
  h2{font-size:15px;margin-top:32px;border-bottom:1px solid #d6d6d3;padding-bottom:6px;}
  h3{font-size:13px;margin-top:18px;color:#5c5c59;}
  .meta{color:#5c5c59;font-size:12px;margin-top:0;}
  table{border-collapse:collapse;width:100%;font-size:12px;margin-top:6px;}
  th,td{border:1px solid #d6d6d3;padding:4px 8px;text-align:left;}
  th{background:#f6f6f5;font-weight:600;}
  ul{font-size:12px;padding-left:18px;}
  @page{ margin:12mm; }
  /* Each format starts on its own page — but not the audio section, so
     page 1 isn't just the title (an h2-wide break-before did exactly
     that). */
  @media print{ body{margin:0;max-width:none;padding:0;} .format{break-before:page;} }
`;

export function buildSpecsHtml(CONFIG){
  const formats = enabledFormats(CONFIG);
  const generated = new Date().toLocaleString("de-DE", { dateStyle:"medium", timeStyle:"short" });
  const plantName = CONFIG.plant.imprint.recipientName;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Specifications — ${esc(plantName)}</title>
<style>${SPECS_CSS}</style>
</head><body>
  <h1>${esc(plantName)} — Specifications</h1>
  <p class="meta">Generated ${esc(generated)}</p>
  ${audioSection(CONFIG.audioSpec)}
  ${formats.map(f => formatSection(f, CONFIG.artworkFileTypes, CONFIG.printSpec)).join("")}
</body></html>`;
}
