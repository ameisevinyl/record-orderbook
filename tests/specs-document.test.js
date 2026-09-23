import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSpecsHtml } from "../src/lib/specs-document.js";

const config = {
  plant: { imprint: { recipientName: "Test & <Plant>" } },
  audioSpec: {
    labels: ["WAV", "AIFF"],
    minBitDepth: 16,
    minSampleRateHz: 44100,
    advisory: ["no sub-bass junk (<15-20Hz)", "use a de-esser on sharp transients (e.g. vocals)"]
  },
  formats: [
    {
      id: "12", label: '12" LP', enabled: true, rpm: 33, recordWeightG: 140,
      timeLimits: {
        normal:      { ideal:{45:12,  33:20}, max:{45:15,  33:27} },
        soundsystem: { ideal:{45:10,  33:15}, max:{45:10,  33:16} }
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
      timeLimits: {
        normal:      { ideal:{45:8,  33:12}, max:{45:8,  33:14} },
        soundsystem: { ideal:{45:4.5, 33:7}, max:{45:6, 33:9} }
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
  assert.match(html, /16-bit min/);
  assert.match(html, /44\.1kHz min/);
  assert.match(html, /use a de-esser on sharp transients/);
});

test("buildSpecsHtml includes each product's name and derived data size", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /white, center cut-out/);
  assert.match(html, /643×328mm/); // outerCover printed: trim 633x318 + 2*5mm bleed
});

test("buildSpecsHtml escapes the plant name (HTML-unsafe characters)", () => {
  const html = buildSpecsHtml(config);
  assert.match(html, /Test &amp; &lt;Plant&gt;/);
  assert.doesNotMatch(html, /Test & <Plant>/);
});

test("buildSpecsHtml shows '—' for fields an unprinted product doesn't have", () => {
  const html = buildSpecsHtml(config);
  // The unprinted sleeve product's row: End format/Data format/Bleed cells are "—"
  assert.match(html, /<td>white, center cut-out<\/td><td>unprinted<\/td><td>304×309mm<\/td><td>—<\/td><td>—<\/td><td>—<\/td>/);
});
