import { test } from "node:test";
import assert from "node:assert/strict";
import { labelLayoutSvg, printedPartLayoutSvg, partGeometry, labelGeometry, PREVIEW_MAX } from "../src/lib/layout-preview.js";

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

test("partGeometry draws the box-spine wrap folds for a cover", () => {
  // 12" cover: trim 633×318, spine 3, bleed 5 → data 643×328. Front panel
  // is 312 tall (trim.h − 2·spine); the wrap bands fold over its top and
  // bottom edges, across the spine strip plus the front panel.
  const g = partGeometry({ trimMm:{w:633,h:318}, finalMm:{w:315,h:318}, spineMm:3, bleedMm:5 });
  assert.deepEqual(g.folds, [
    { x1:320, y1:8,   x2:320, y2:320 }, // back/spine fold
    { x1:323, y1:8,   x2:323, y2:320 }, // spine/front fold
    { x1:320, y1:8,   x2:638, y2:8 },   // top wrap fold
    { x1:320, y1:320, x2:638, y2:320 }  // bottom wrap fold
  ]);
});

test("partGeometry steps the trim outline down on the back half of a box-spine cover", () => {
  // Back panel (left of the back/spine fold) is trim.h − 2·spine tall,
  // inset one spine at top and bottom; spine strip + front half keep
  // full height.
  const g = partGeometry({ trimMm:{w:633,h:318}, finalMm:{w:315,h:318}, spineMm:3, bleedMm:5 });
  assert.deepEqual(g.trimOutline, [
    { x:5,   y:8 },   { x:320, y:8 },   { x:320, y:5 },   { x:638, y:5 },
    { x:638, y:323 }, { x:320, y:323 }, { x:320, y:320 }, { x:5,   y:320 }
  ]);
});

test("partGeometry keeps a plain rectangular trim outline for a flat sheet", () => {
  const g = partGeometry({ trimMm:{w:297,h:297}, bleedMm:3 });
  assert.deepEqual(g.trimOutline, [
    { x:3, y:3 }, { x:300, y:3 }, { x:300, y:300 }, { x:3, y:300 }
  ]);
});

test("printedPartLayoutSvg draws the four box-spine fold lines for a cover", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:633,h:318}, finalMm:{w:315,h:318}, spineMm:3, bleedMm:5 });
  assert.equal((svg.match(/class="fold"/g) || []).length, 4);
});

test("printedPartLayoutSvg draws one center fold for a folded sleeve", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3 });
  assert.equal((svg.match(/class="fold"/g) || []).length, 1);
});

test("partGeometry keeps a single full-height center fold for a folded sleeve", () => {
  const g = partGeometry({ trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3 });
  assert.deepEqual(g.folds, [{ x1:307, y1:3, x2:307, y2:312 }]);
});

test("labelGeometry is a square data sheet around the trim diameter", () => {
  assert.deepEqual(labelGeometry({ diameterMm:100, bleedMm:3 }), {
    dataMm:{ w:106, h:106 }, diameterMm:100, bleedMm:3
  });
});

test("printedPartLayoutSvg draws a cut-out circle when the product has one", () => {
  const svg = printedPartLayoutSvg({ trimMm:{w:608,h:309}, bleedMm:3, cutoutDiameterMm:85 });
  assert.match(svg, /class="cutout"/);
});

test("previews fit the visual box instead of true print size", () => {
  const cover = sizeOf(printedPartLayoutSvg({ trimMm:{w:633,h:318}, spineMm:3, bleedMm:5 }));
  assert.ok(cover.w <= PREVIEW_MAX.w && cover.h <= PREVIEW_MAX.h, `${cover.w}×${cover.h}`);
  assert.ok(cover.w > cover.h, "cover spread keeps its wide aspect ratio");

  const label = sizeOf(labelLayoutSvg({ diameterMm:100, bleedMm:3 }));
  assert.ok(label.w <= PREVIEW_MAX.w && label.h <= PREVIEW_MAX.h, `${label.w}×${label.h}`);
  assert.ok(Math.abs(label.w - label.h) < 0.01, "label preview stays square");
  assert.ok(label.w >= 180, "label preview is rendered large, not thumbnail-sized");
});
