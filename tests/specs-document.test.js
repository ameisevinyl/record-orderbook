import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpecsHtml } from "../src/lib/specs-document.js";

const config = {
  plant: { imprint: { recipientName: "Test & <Plant>" } },
  artworkFileTypes: { labels: ["PDF", "JPG", "TIFF"] },
  printSpec: { colourProfile: "ISO ECI v2 300" },
  audioSpec: {
    labels: ["WAV", "AIFF"],
    minBitDepth: 16,
    recommendedBitDepth: 24,
    minSampleRateHz: 44100
  },
  formats: [
    {
      id: "12", label: '12" LP', enabled: true, rpm: 33, recordWeightG: 140,
      centerHole: { normal: 7.4 },
      timeLimits: {
        normal:      { ideal:{45:12,  33:20}, max:{45:15,  33:27} },
        soundsystem: { ideal:{45:10,  33:15}, max:{45:10,  33:16} }
      },
      printCheck: {
        dpi: { min: 300, max: 1200 },
        checks: { colorMode: { accepted: ["CMYK"] }, spotColors: { accepted: true } }
      },
      printableParts: {
        label: { diameterMm: 100, bleedMm: 3 },
        innerSleeve: { products: [
          { id:"sleeve-white-cutout", name:"white, center cut-out", kind:"unprinted",
            finalMm:{w:304,h:309}, paperGsm:135, color:"white", cutoutDiameterMm:85 },
          { id:"sleeve-printed", name:"printed", kind:"printed",
            trimMm:{w:608,h:309}, finalMm:{w:304,h:309}, bleedMm:3, paperGsm:135 }
        ]},
        outerCover: { products: [
          { id:"cover-printed", name:"printed", kind:"printed",
            trimMm:{w:633,h:318}, finalMm:{w:315,h:318}, spineMm:3, bleedMm:5, paperGsm:300 }
        ]},
        inlay: { products: [
          { id:"inlay-printed", name:"printed", kind:"printed", trimMm:{w:297,h:297}, bleedMm:3, paperGsm:170 }
        ]}
      }
    },
    {
      id: "10", label: '10" EP', enabled: false, rpm: 33, recordWeightG: 100,
      centerHole: { normal: 7.4 },
      timeLimits: {
        normal:      { ideal:{45:8,  33:12}, max:{45:8,  33:14} },
        soundsystem: { ideal:{45:4.5, 33:7}, max:{45:6, 33:9} }
      },
      printCheck: {
        dpi: { min: 300, max: 1200 },
        checks: { colorMode: { accepted: ["CMYK"] }, spotColors: { accepted: true } }
      },
      printableParts: {
        label: { diameterMm: 100, bleedMm: 3 },
        innerSleeve: { products: [] },
        outerCover: { products: [] },
        inlay: { products: [] }
      }
    }
  ]
};

test("buildSpecsHtml includes only enabled formats", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /12&quot; LP/); // format label text is HTML-escaped, so " becomes &quot;
  assert.doesNotMatch(html, /10&quot; EP/);
});

test("buildSpecsHtml includes the audio spec figures", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /WAV, AIFF/);
  assert.match(html, /&gt;=16-bit \(24-bit recommended\)/);
  assert.match(html, /&gt;=44\.1kHz/);
});

test("buildSpecsHtml includes the print-file specs", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /PDF, JPG, TIFF/);
  assert.match(html, /CMYK/);
  assert.match(html, /ISO ECI v2 300/);
  assert.match(html, /300–1200 dpi/);
  assert.match(html, /normal 7\.4mm/);
});

test("buildSpecsHtml puts the print-file specs above the label section", () => {
  const html = buildSpecsHtml(config);
  assert.ok(html.indexOf("<h3>Print files</h3>") < html.indexOf("<h3>Label</h3>"));
});

test("buildSpecsHtml omits unprinted products", () => {
  const html = buildSpecsHtml(config);
  assert.doesNotMatch(html, /white, center cut-out/);
  assert.doesNotMatch(html, /unprinted/);
});

test("buildSpecsHtml includes each printed product's derived data size", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /643×328mm/); // outer cover: trim 633x318 + 2*5mm bleed
  assert.match(html, /614×315mm/); // inner sleeve: trim 608x309 + 2*3mm bleed
});

test("buildSpecsHtml shows the label's data format as a square, not a diameter", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /⌀100mm<\/td><td>3mm<\/td><td>106×106mm/);
  assert.doesNotMatch(html, /⌀106mm/);
});

test("buildSpecsHtml starts each format on its own page", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /<section class="format">/);
  assert.match(html, /\.format\{break-before:page;\}/);
});

test("buildSpecsHtml escapes the plant name (HTML-unsafe characters)", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /Test &amp; &lt;Plant&gt;/);
  assert.doesNotMatch(html, /Test & <Plant>/);
});
