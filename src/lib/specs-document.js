// Builds the "Specs" button's reference document — every enabled
// format's label/printed-part/audio specs, baked into one self-
// contained HTML page. The browser's own Print-to-PDF gives an actual
// PDF if wanted; no hand-rolled PDF writer needed (see the packaging
// product catalog design spec for why this beats a bespoke binary
// format). Pure string-building — no DOM, testable like every other
// lib/ file.

import { enabledFormats, labelDataSizeMm, flatDataMm, partWeightG } from "./format-catalogue.js";

function esc(str){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function kvTable(rows){
  return `<table><tbody>${rows.map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
}

// One row per product, columns that don't apply to a given category
// (e.g. Spine for inner sleeve, Final size for inlay) just show "—" —
// same convention the live per-category Specifications box already
// uses for a field a selected product doesn't have.
function productTable(title, products){
  if(!products.length) return "";
  const rows = products.map(p=>{
    const dataMm = p.trimMm ? flatDataMm(p) : null;
    const cells = [
      esc(p.name), esc(p.kind),
      p.finalMm ? `${p.finalMm.w}×${p.finalMm.h}mm` : "—",
      p.trimMm ? `${p.trimMm.w}×${p.trimMm.h}mm` : "—",
      dataMm ? `${dataMm.w}×${dataMm.h}mm` : "—",
      p.trimMm ? `${p.bleedMm}mm` : "—",
      p.spineMm != null ? `${p.spineMm}mm` : "—",
      `${p.paperGsm}gsm`,
      p.cutoutDiameterMm ? `⌀${p.cutoutDiameterMm}mm` : "none",
      p.trimMm ? `${partWeightG(p)}g` : "—"
    ];
    return `<tr>${cells.map(c=>`<td>${c}</td>`).join("")}</tr>`;
  }).join("");
  return `<h3>${esc(title)}</h3>
    <table>
      <thead><tr><th>Product</th><th>Kind</th><th>Final size</th><th>End format</th><th>Data format</th><th>Bleed</th><th>Spine</th><th>Paper</th><th>Cut-out</th><th>Weight</th></tr></thead>
      <tbody>${rows}</tbody>
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

function formatSection(format){
  const label = format.printableParts.label;
  const parts = format.printableParts;
  return `<h2>${esc(format.label)}</h2>
    ${kvTable([["RPM (default)", format.rpm], ["Record weight", format.recordWeightG + "g"]])}
    <h3>Label</h3>
    <table>
      <thead><tr><th>Diameter</th><th>Bleed</th><th>Data size</th></tr></thead>
      <tbody><tr><td>⌀${label.diameterMm}mm</td><td>${label.bleedMm}mm</td><td>⌀${labelDataSizeMm(label)}mm</td></tr></tbody>
    </table>
    ${timeLimitsTable(format)}
    ${productTable("Inner Sleeve", parts.innerSleeve.products)}
    ${productTable("Outer Cover", parts.outerCover.products)}
    ${productTable("Inlay", parts.inlay.products)}`;
}

function audioSection(audioSpec){
  return `<h2>Audio Master Files</h2>
    ${kvTable([
      ["Allowed filetypes", audioSpec.labels.join(", ")],
      ["Bit depth", audioSpec.minBitDepth + "-bit min"],
      ["Sample rate", (audioSpec.minSampleRateHz/1000) + "kHz min"]
    ])}
    <h3>Mastering notes</h3>
    <ul>${audioSpec.advisory.map(a=>`<li>${esc(a)}</li>`).join("")}</ul>
    <p class="note">Normal cut — standard level, wider margins, longer max time, home/DJ playback.<br>
    Soundsystem cut — hotter/louder, club/PA playback, shorter max time, tighter grooves.</p>`;
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
  .note{font-size:11px;color:#5c5c59;}
  hr{border:none;border-top:1px solid #d6d6d3;margin:24px 0;}
  @media print{ body{margin:0;padding:0 10mm;} h2{break-before:page;} }
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
  ${formats.map(formatSection).join("<hr>")}
</body></html>`;
}
