// Pure SVG line-art previews of printed-part layouts for the Specs
// document, plus the shared mm geometry the PDF templates draw from.
// Each drawing is scaled into a small fixed visual box — a schematic,
// not a true-size proof. Every coordinate is computed in px so stroke
// dashes stay independent of the mm-based geometry.

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

// Label geometry: the square data sheet (trim diameter + bleed) with the
// round end format centered in it.
export function labelGeometry({ diameterMm, bleedMm }){
  const data = diameterMm + bleedMm * 2;
  return { dataMm: { w:data, h:data }, diameterMm, bleedMm };
}

// Flat printed-part geometry, in data-sheet coordinates (mm from the data
// sheet's top-left) — the single source for the SVG preview and the PDF
// template, so the schematic and the real template can't drift.
//
// A box-spine cover (spineMm > 0): the front half (spine strip + front
// panel) carries the wrap bands and keeps full trim height; the back
// panel has no spine, so it is trim.h − 2·spine tall and inset one spine
// at top and bottom — the die-cut outline steps at the back/spine fold.
// The horizontal wrap folds run across the spine strip plus the front
// panel only.
export function partGeometry(part){
  const { w: dataW, h: dataH } = flatDataMm(part);
  const { trimMm, bleedMm } = part;
  const s = part.spineMm || 0;
  const folds = [];
  let trimOutline;

  if(s > 0){
    const xBack = (trimMm.w - s) / 2;
    const xFront = (trimMm.w + s) / 2;
    const yTop = s, yBottom = trimMm.h - s;
    folds.push(
      { x1:xBack,  y1:yTop,    x2:xBack,    y2:yBottom },
      { x1:xFront, y1:yTop,    x2:xFront,   y2:yBottom },
      { x1:xBack,  y1:yTop,    x2:trimMm.w, y2:yTop },
      { x1:xBack,  y1:yBottom, x2:trimMm.w, y2:yBottom }
    );
    trimOutline = [
      { x:0,         y:yTop },    { x:xBack,     y:yTop },
      { x:xBack,     y:0 },       { x:trimMm.w,  y:0 },
      { x:trimMm.w,  y:trimMm.h },{ x:xBack,     y:trimMm.h },
      { x:xBack,     y:yBottom }, { x:0,         y:yBottom }
    ];
  } else{
    if(part.finalMm && part.finalMm.w < trimMm.w){
      folds.push({ x1:trimMm.w / 2, y1:0, x2:trimMm.w / 2, y2:trimMm.h });
    }
    trimOutline = [
      { x:0, y:0 }, { x:trimMm.w, y:0 }, { x:trimMm.w, y:trimMm.h }, { x:0, y:trimMm.h }
    ];
  }

  const toData = ({x, y}) => ({ x:x+bleedMm, y:y+bleedMm });
  return {
    dataMm: { w:dataW, h:dataH },
    trimMm,
    bleedMm,
    folds: folds.map(f => ({ x1:f.x1+bleedMm, y1:f.y1+bleedMm, x2:f.x2+bleedMm, y2:f.y2+bleedMm })),
    trimOutline: trimOutline.map(toData),
    cutout: part.cutoutDiameterMm
      ? { cx:dataW / 2, cy:dataH / 2, r:part.cutoutDiameterMm / 2 }
      : null
  };
}

// Label: the square data format (trim diameter + bleed) with the round
// end format centered in it.
export function labelLayoutSvg({ diameterMm, bleedMm }){
  const { dataMm } = labelGeometry({ diameterMm, bleedMm });
  const data = dataMm.w;
  const f = frame(data, data);
  const title = `data ${data}×${data}mm · end ⌀${diameterMm}mm`;
  const rect = `<rect class="bleed" x="${f.place(0)}" y="${f.place(0)}" width="${f.len(data)}" height="${f.len(data)}"/>`;
  const circle = `<circle class="trim" cx="${f.place(data / 2)}" cy="${f.place(data / 2)}" r="${f.len(diameterMm / 2)}"/>`;
  return svg(f, title, rect + circle);
}

// Flat printed part: data rect (bleed outline), stepped trim outline
// (end format), fold lines for a spine or a center fold, and an optional
// center cut-out.
export function printedPartLayoutSvg(part){
  const { dataMm, trimMm, folds, trimOutline, cutout } = partGeometry(part);
  const f = frame(dataMm.w, dataMm.h);
  const title = `data ${dataMm.w}×${dataMm.h}mm · end ${trimMm.w}×${trimMm.h}mm`;

  const rects = `<rect class="bleed" x="${f.place(0)}" y="${f.place(0)}" width="${f.len(dataMm.w)}" height="${f.len(dataMm.h)}"/>`
    + `<polygon class="trim" points="${trimOutline.map(p => `${f.place(p.x)},${f.place(p.y)}`).join(" ")}"/>`;

  const lines = folds.map(fold =>
    `<line class="fold" x1="${f.place(fold.x1)}" y1="${f.place(fold.y1)}" x2="${f.place(fold.x2)}" y2="${f.place(fold.y2)}"/>`
  ).join("");

  const circle = cutout
    ? `<circle class="cutout" cx="${f.place(cutout.cx)}" cy="${f.place(cutout.cy)}" r="${f.len(cutout.r)}"/>`
    : "";

  return svg(f, title, rects + lines + circle);
}
