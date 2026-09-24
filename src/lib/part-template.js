// Builds the dimension-true DeviceCMYK PDF templates offered in the
// Specs document — one per label format and per printed product. Pure:
// returns PDF bytes, no DOM. Geometry comes from layout-preview.js so
// the schematic preview and the real template can't drift.
//
// Templates carry no instructions — only the dimension line. Cut lines
// (trim, cut-outs, center holes) are black dotted; fold lines are a
// lighter grey dotted, so they read as secondary.

import { mmToPt, buildPdf } from "./pdf.js";
import { labelGeometry, partGeometry } from "./layout-preview.js";
import { slug, sanitizeFileName } from "./package-naming.js";

const FONT_PT = 11;
const LINE_HEIGHT_MM = FONT_PT * 1.35 / 72 * 25.4;
const CUT_PT = 0.5;
const FOLD_PT = 0.25;
const CUT_DASH = [2, 3];
const FOLD_DASH = [1, 3];

function fmt(n){
  return String(Math.round(n * 10000) / 10000);
}

function escPdf(str){
  return String(str).replace(/([\\()])/g, "\\$1");
}

// Rough Helvetica advance widths (em fractions), good enough for
// centering the little text this writer lays out.
function textWidthMm(str, fontPt){
  const em = fontPt / 72 * 25.4;
  let width = 0;
  for(const ch of String(str)){
    if(ch >= "A" && ch <= "Z") width += 0.72 * em;
    else if(ch >= "0" && ch <= "9") width += 0.556 * em;
    else if(ch === " ") width += 0.28 * em;
    else width += 0.5 * em;
  }
  return width;
}

// Content stream builder in data-sheet mm coordinates (top-left origin),
// emitted in PDF points (bottom-left origin).
function contentBuilder(dataW, dataH){
  const pageH = mmToPt(dataH);
  const X = mm => fmt(mmToPt(mm));
  const Y = mm => fmt(pageH - mmToPt(mm));
  const ops = ["0 0 0 1 K", "0 0 0 1 k", "0 J", "0 j"];

  function circlePath(cx, cy, r){
    const x = mmToPt(cx), y = pageH - mmToPt(cy), rr = mmToPt(r), k = rr * 0.5522847498;
    return [
      `${fmt(x + rr)} ${fmt(y)} m`,
      `${fmt(x + rr)} ${fmt(y + k)} ${fmt(x + k)} ${fmt(y + rr)} ${fmt(x)} ${fmt(y + rr)} c`,
      `${fmt(x - k)} ${fmt(y + rr)} ${fmt(x - rr)} ${fmt(y + k)} ${fmt(x - rr)} ${fmt(y)} c`,
      `${fmt(x - rr)} ${fmt(y - k)} ${fmt(x - k)} ${fmt(y - rr)} ${fmt(x)} ${fmt(y - rr)} c`,
      `${fmt(x + k)} ${fmt(y - rr)} ${fmt(x + rr)} ${fmt(y - k)} ${fmt(x + rr)} ${fmt(y)} c`
    ].join(" ");
  }

  const b = {
    cutInk(){ ops.push("0 0 0 1 K"); },
    foldInk(){ ops.push("0 0 0 0.5 K"); },
    cutWidth(){ ops.push(`${CUT_PT} w`); },
    foldWidth(){ ops.push(`${FOLD_PT} w`); },
    dash(on, off){ ops.push(`[${fmt(on)} ${fmt(off)}] 0 d`); },
    solid(){ ops.push("[] 0 d"); },
    line(x1, y1, x2, y2){
      ops.push(`${X(x1)} ${Y(y1)} m ${X(x2)} ${Y(y2)} l S`);
    },
    polygon(points){
      ops.push(points.map((p, i) => `${X(p.x)} ${Y(p.y)} ${i === 0 ? "m" : "l"}`).join(" ") + " h S");
    },
    circle(cx, cy, r){ ops.push(circlePath(cx, cy, r) + " h S"); },
    textSized(x, y, str, fontPt){
      ops.push(`BT /F1 ${fmt(fontPt)} Tf ${X(x)} ${Y(y)} Td (${escPdf(str)}) Tj ET`);
    },
    text(x, y, str){ b.textSized(x, y, str, FONT_PT); },
    textCentered(cx, y, str, fontPt = FONT_PT){
      b.textSized(cx - textWidthMm(str, fontPt) / 2, y, str, fontPt);
    },
    // Big light-grey panel mark, optically centred in a panel.
    panelLabel(cx, cy, str, fontPt){
      const capMm = fontPt * 0.72 / 72 * 25.4;
      ops.push("0 0 0 0.2 k");
      b.textCentered(cx, cy + capMm / 2, str, fontPt);
      ops.push("0 0 0 1 k");
    },
    toString(){ return ops.join("\n") + "\n"; }
  };
  return b;
}

export function templateFileName({ formatId, part, productName }){
  const parts = [sanitizeFileName(formatId), part];
  if(productName) parts.push(slug(productName) || "printed");
  return parts.join("_") + "_template_v1.pdf";
}

// Short L-marks along the four page edges. They make the inked bounding
// box fill the page, which is what Photoshop's default PDF import
// ("Crop To: Bounding Box") uses — without them it crops to the drawn
// artwork (the trim), not the data/bleed sheet.
function drawCornerMarks(c, dataWmm, dataHmm, lenMm){
  const corners = [
    [0, 0, 1, 1],
    [dataWmm, 0, -1, 1],
    [0, dataHmm, 1, -1],
    [dataWmm, dataHmm, -1, -1]
  ];
  for(const [x, y, sx, sy] of corners){
    c.line(x, y, x + sx * lenMm, y);
    c.line(x, y, x, y + sy * lenMm);
  }
}

// Label: data square (page edge), dotted trim circle, both center-hole
// variants, and the dimensions line kept clear inside the circle.
export function labelTemplatePdf({ format, label }){
  const { dataMm, diameterMm, bleedMm } = labelGeometry(label);
  const { normal, big } = format.centerHole;
  const c = contentBuilder(dataMm.w, dataMm.h);
  const cx = dataMm.w / 2, cy = dataMm.h / 2;

  c.cutInk(); c.cutWidth(); c.solid();
  drawCornerMarks(c, dataMm.w, dataMm.h, bleedMm);

  c.dash(...CUT_DASH);
  c.circle(cx, cy, diameterMm / 2);
  c.circle(cx, cy, normal / 2);
  if(big) c.circle(cx, cy, big / 2);
  c.solid();

  // Short lines stacked under the center hole instead of one long line,
  // so the text stays inside the round trim at 11pt. Both center-hole
  // variants are listed where the format offers them. "ø" (U+00F8) not
  // the ⌀ diameter sign: Helvetica/WinAnsiEncoding can't encode U+2300.
  const holeR = Math.max(normal, big || 0) / 2;
  const y = cy + holeR + 4;
  c.textCentered(cx, y, `data ${dataMm.w}x${dataMm.h}mm, bleed ${bleedMm}mm`);
  c.textCentered(cx, y + LINE_HEIGHT_MM, `end format ø${diameterMm}mm`);
  c.textCentered(cx, y + LINE_HEIGHT_MM * 2, `standard center ø${normal}mm`);
  if(big) c.textCentered(cx, y + LINE_HEIGHT_MM * 3, `big center ø${big}mm`);

  return buildPdf({
    title: `${format.id} label template`,
    pages: [{ widthMm: dataMm.w, heightMm: dataMm.h, content: c.toString() }]
  });
}

// Panel marks for a folded spread: back on the left, front on the right
// (see config.js). Empty for a single flat sheet like the inlay.
function spreadPanels(part, bleedMm){
  const { trimMm } = part;
  const spine = part.spineMm || 0;
  let back, front;

  if(spine > 0){
    const xBack = (trimMm.w - spine) / 2;
    const xFront = (trimMm.w + spine) / 2;
    const y1 = bleedMm + spine, y2 = bleedMm + trimMm.h - spine;
    back = { x1:bleedMm, y1, x2:bleedMm + xBack, y2 };
    front = { x1:bleedMm + xFront, y1, x2:bleedMm + trimMm.w, y2 };
  } else if(part.finalMm && part.finalMm.w < trimMm.w){
    const mid = bleedMm + trimMm.w / 2;
    back = { x1:bleedMm, y1:bleedMm, x2:mid, y2:bleedMm + trimMm.h };
    front = { x1:mid, y1:bleedMm, x2:bleedMm + trimMm.w, y2:bleedMm + trimMm.h };
  } else{
    return [];
  }

  return [["BACK", back], ["FRONT", front]].map(([label, panel]) => ({
    label,
    cx: (panel.x1 + panel.x2) / 2,
    cy: (panel.y1 + panel.y2) / 2,
    fontPt: Math.min(panel.x2 - panel.x1, panel.y2 - panel.y1) * 0.16 * 72 / 25.4
  }));
}

// Flat printed part: dotted stepped trim outline, lighter dotted folds,
// dotted cut-out, and the dimensions line in the clear top-left corner.
export function partTemplatePdf({ formatId, part }){
  const { dataMm, trimMm, bleedMm, folds, trimOutline, cutout } = partGeometry(part);
  const c = contentBuilder(dataMm.w, dataMm.h);

  c.cutInk(); c.cutWidth(); c.solid();
  drawCornerMarks(c, dataMm.w, dataMm.h, bleedMm);

  c.dash(...CUT_DASH);
  c.polygon(trimOutline);

  c.foldInk(); c.foldWidth(); c.dash(...FOLD_DASH);
  for(const fold of folds) c.line(fold.x1, fold.y1, fold.x2, fold.y2);

  if(cutout){
    c.cutInk(); c.cutWidth(); c.dash(...CUT_DASH);
    c.circle(cutout.cx, cutout.cy, cutout.r);
  }
  c.solid();

  const spine = part.spineMm || 0;
  const line = `data ${dataMm.w}x${dataMm.h}mm, end format ${trimMm.w}x${trimMm.h}mm, bleed ${bleedMm}mm`
    + (spine > 0 ? `, spine ${spine}mm` : "");
  c.text(bleedMm + 3, bleedMm + spine + 6, line);

  // A folded spread (box spine, or a center-folded sleeve) has a back
  // panel on the left and a front panel on the right — mark them with
  // big light-grey letters so artwork can't be placed on the wrong half.
  for(const panel of spreadPanels(part, bleedMm)) c.panelLabel(panel.cx, panel.cy, panel.label, panel.fontPt);

  return buildPdf({
    title: `${formatId} ${part.name} template`,
    pages: [{
      widthMm: dataMm.w,
      heightMm: dataMm.h,
      content: c.toString(),
      trimBoxPt: [mmToPt(bleedMm), mmToPt(bleedMm), mmToPt(bleedMm + trimMm.w), mmToPt(bleedMm + trimMm.h)]
    }]
  });
}
