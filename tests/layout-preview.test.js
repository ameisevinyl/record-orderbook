import { test } from "node:test";
import assert from "node:assert/strict";
import { labelLayoutSvg, printedPartLayoutSvg } from "../src/lib/layout-preview.js";

function sizeOf(svg){
  const m = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  return { w:Number(m[1]), h:Number(m[2]) };
}

test("labelLayoutSvg draws a square data outline and a round end format", () => {
  const svg = labelLayoutSvg({ diameterMm:100, bleedMm:3 });
  const rect = svg.match(/class="bleed" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/);
  assert.equal(rect[3], rect[4]);
  assert.match(svg, /class="trim"/);
  assert.match(svg, /aria-label="data 106×106mm · end ⌀100mm"/);
});

test("printedPartLayoutSvg draws data and trim outlines with no folds for a flat sheet", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:297,h:297}, bleedMm:3 });
  assert.match(svg, /class="bleed"/);
  assert.match(svg, /class="trim"/);
  assert.doesNotMatch(svg, /class="fold"/);
  assert.doesNotMatch(svg, /class="cutout"/);
});

test("printedPartLayoutSvg draws two spine fold lines for a cover", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:633,h:318}, finalMm:{w:315,h:318}, spineMm:3, bleedMm:5 });
  assert.equal((svg.match(/class="fold"/g) || []).length, 2);
});

test("printedPartLayoutSvg draws one center fold for a folded sleeve", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3 });
  assert.equal((svg.match(/class="fold"/g) || []).length, 1);
});

test("printedPartLayoutSvg draws a cut-out circle when the product has one", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:608,h:309}, bleedMm:3, cutoutDiameterMm:85 });
  assert.match(svg, /class="cutout"/);
});

test("previews fit the visual box instead of true print size", () => {
  const cover = sizeOf(printedPartLayoutSvg({ trimMm:{w:633,h:318}, spineMm:3, bleedMm:5 }));
  assert.ok(cover.w <= 132 && cover.h <= 96, `${cover.w}×${cover.h}`);
  assert.ok(cover.w > cover.h, "cover spread keeps its wide aspect ratio");

  const label = sizeOf(labelLayoutSvg({ diameterMm:100, bleedMm:3 }));
  assert.ok(label.w <= 132 && label.h <= 96, `${label.w}×${label.h}`);
  assert.ok(Math.abs(label.w - label.h) < 0.01, "label preview stays square");
});
