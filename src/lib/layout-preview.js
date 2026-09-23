// Pure SVG line-art previews of printed-part layouts for the Specs
// document. Each drawing is scaled into a small fixed visual box — a
// schematic, not a true-size proof. Every coordinate is computed in px
// so stroke dashes stay independent of the mm-based geometry.

import { flatDataMm } from "./format-catalogue.js";

const PAD = 4; // room for the stroke on the outermost outline

// Visual box the drawings are scaled into — a schematic size, not true
// print size. Exported so tests can assert the box is respected.
export const PREVIEW_MAX = { w: 240, h: 200 };

function esc(str){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

// Fits a dataW×dataH mm drawing into the box. Geometry is written in mm,
// emitted in px: x()/y() place a point, len() sizes a span.
function frame(dataW, dataH){
  const scale = Math.min((PREVIEW_MAX.w - PAD * 2) / dataW, (PREVIEW_MAX.h - PAD * 2) / dataH);
  const width = dataW * scale + PAD * 2;
  const height = dataH * scale + PAD * 2;
  const place = mm => (PAD + mm * scale).toFixed(2);
  const len = mm => (mm * scale).toFixed(2);
  return { width, height, place, len };
}

function svg(f, title, body){
  const width = f.width.toFixed(2), height = f.height.toFixed(2);
  return `<svg class="layout" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`
    + `<title>${esc(title)}</title>${body}</svg>`;
}

// Label: the square data format (trim diameter + bleed) with the round
// end format centered in it.
export function labelLayoutSvg({ diameterMm, bleedMm }){
  const data = diameterMm + bleedMm * 2;
  const f = frame(data, data);
  const title = `data ${data}×${data}mm · end ⌀${diameterMm}mm`;
  const rect = `<rect class="bleed" x="${f.place(0)}" y="${f.place(0)}" width="${f.len(data)}" height="${f.len(data)}"/>`;
  const circle = `<circle class="trim" cx="${f.place(data / 2)}" cy="${f.place(data / 2)}" r="${f.len(diameterMm / 2)}"/>`;
  return svg(f, title, rect + circle);
}

// Flat printed part: data rect (bleed outline), trim rect (end format),
// fold lines for a spine or a center fold, and an optional center cut-out.
export function printedPartLayoutSvg(part){
  const { w: dataW, h: dataH } = flatDataMm(part);
  const { trimMm, bleedMm } = part;
  const f = frame(dataW, dataH);
  const title = `data ${dataW}×${dataH}mm · end ${trimMm.w}×${trimMm.h}mm`;

  const rects = `<rect class="bleed" x="${f.place(0)}" y="${f.place(0)}" width="${f.len(dataW)}" height="${f.len(dataH)}"/>`
    + `<rect class="trim" x="${f.place(bleedMm)}" y="${f.place(bleedMm)}" width="${f.len(trimMm.w)}" height="${f.len(trimMm.h)}"/>`;

  const foldPositions = part.spineMm > 0
    ? [(trimMm.w - part.spineMm) / 2, (trimMm.w + part.spineMm) / 2]
    : part.finalMm && part.finalMm.w < trimMm.w ? [trimMm.w / 2] : [];
  const folds = foldPositions.map(x =>
    `<line class="fold" x1="${f.place(bleedMm + x)}" y1="${f.place(bleedMm)}" x2="${f.place(bleedMm + x)}" y2="${f.place(bleedMm + trimMm.h)}"/>`
  ).join("");

  const cutout = part.cutoutDiameterMm
    ? `<circle class="cutout" cx="${f.place(dataW / 2)}" cy="${f.place(dataH / 2)}" r="${f.len(part.cutoutDiameterMm / 2)}"/>`
    : "";

  return svg(f, title, rects + folds + cutout);
}
