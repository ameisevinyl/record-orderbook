import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStaffBar, openItems, renderStaffStatus, renderLineStatus } from "../src/lib/staff-info.js";

test("bar: back to the board, the job, its stage, the job page, escaped", () => {
  const html = renderStaffBar("K<1>_x", "10_ORDERS/10_PREPRESS");
  assert.ok(html.startsWith('<nav class="staffbar"><a href="/">← orderbook</a> · <b>K&lt;1&gt;_x</b> · ORDERS › PREPRESS'));
  assert.ok(html.includes('<a href="/#/job/K%3C1%3E_x">files &amp; fixes</a>'));
  assert.ok(html.includes('<span id="staffTask"></span>'));
});

test("open items: gaps, audio findings and artwork that needs a look; ok artwork is left out", () => {
  const items = openItems({
    gaps: [{group: "Labels", text: "label B has no artwork"}],
    findings: [{group: "Side A", text: "sample rates differ"}],
    artwork: [{title: "Label A", verdict: "ok"}, {title: "Cover", verdict: "review"}, {title: "Inlay front", verdict: "customer"}]
  });
  assert.deepEqual(items, ["Labels: label B has no artwork", "Side A: sample rates differ", "Cover: review", "Inlay front: needs customer"]);
});

test("status list: the customer checklist's markup, escaped; nothing open is one ok line", () => {
  assert.equal(renderStaffStatus(["a <b>"]), '<li class="bad"><span class="mark">!</span>a &lt;b&gt;</li>');
  assert.equal(renderStaffStatus([]), '<li class="ok"><span class="mark">✓</span>nothing open</li>');
});

test("line status: only the lines of the order, what each stands at", () => {
  const html = renderLineStatus([
    {line: "inlay", needed: false, done: true},
    {line: "labels", needed: true, done: false, waiting: false, checking: false, step: "size", why: "Label A: 96×96mm, expected 98×98mm"},
    {line: "press", needed: true, done: false, waiting: true},
    {line: "mastering", needed: true, done: true},
    {line: "pack", needed: true, done: false, waiting: false, checking: true}
  ]);
  assert.ok(!html.includes("inlay"));
  assert.ok(html.includes("<td>labels</td><td>size — Label A: 96×96mm, expected 98×98mm</td>"));
  assert.ok(html.includes("<td>press</td><td>waiting</td>") && html.includes("<td>mastering</td><td>✓</td>"));
  assert.ok(html.includes("<td>pack</td><td>not checked</td>"));
});
