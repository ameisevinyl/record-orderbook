import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { prepareProject } from "../src/lib/project.js";
import { renderOverview, renderGaps, renderHeader, escapeHtml } from "../src/lib/plant-overview.js";

const project = prepareProject({
  projectVersion:1, format:"12", catalogue:"PNKRCK007", albumTitle:"<b>Loud</b>", albumArtist:"Band",
  sides:{A:{rpm:"33", tracks:[{title:"One", length:"3:00", fileName:"A1.wav"}, {title:"Two", length:"2:00", fileName:"A2.wav"}]}, B:{blank:true}},
  vinylColor:[{color:"black", qty:"300"}],
  history:[{savedAt:"2026-09-24T12:00:00.000Z", by:"plant", note:"qty 300"}]
}, CONFIG);

test("overview shows values in form order, escaped", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("PNKRCK007"));
  assert.ok(html.includes("&lt;b&gt;Loud&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Loud"));
  const order = ["Release", "Side A", "Side B", "Labels", "Inner sleeve", "Cover", "Inlay", "Vinyl colour", "Billing", "Shipping", "History"]
    .map(h => html.indexOf(`<h2>${h}`));
  assert.ok(order.every(i => i >= 0), "every group present");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("files show size or are marked missing; side total shown", () => {
  const html = renderOverview(project, CONFIG, [{name:"A1.wav", size:52428800}]);
  assert.ok(html.includes("A1.wav (50.0 MB)"));
  assert.match(html, /A2\.wav <span class="missing">missing<\/span>/);
  assert.ok(html.includes("Total 5:02 — 33 rpm, normal cut</p>"));
  assert.ok(!html.includes("ideal"), "limits are specs, not part of the order");
  assert.ok(html.includes("Blank"));
});

test("an older, minimal project renders without throwing", () => {
  const minimal = prepareProject({format:"7"}, CONFIG);
  assert.ok(renderOverview(minimal, CONFIG, []).includes("<h2>Release"));
});

test("gaps list and header", () => {
  assert.equal(renderGaps([]), '<p class="complete">Complete — ready for checks</p>');
  assert.equal(renderGaps([{group:"Release", text:"no <x>"}]),
    '<ul class="gaps"><li><b>Release</b> no &lt;x&gt;</li></ul>');
  assert.ok(renderHeader("260924_X.zip", project).includes("260924_X.zip"));
  assert.equal(escapeHtml(`a&"'`), "a&amp;&quot;&#39;");
});
