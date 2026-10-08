import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU, menuHtml, dropdownHtml } from "../src/lib/menu.js";

test("menu: absolute, unique hrefs; staff pages are served from src/", () => {
  const hrefs = MENU.map(([, href]) => href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(hrefs.every(h => h.startsWith("/")));
  assert.deepEqual(hrefs, ["/", "/#/archive", "/src/pricelist.html", "/src/plant-config.html"]);
});

test("menuHtml: one link per entry, only the current one marked", () => {
  const html = menuHtml("/src/pricelist.html");
  assert.equal(html.match(/<a /g).length, MENU.length);
  assert.equal(html.match(/aria-current/g).length, 1);
  assert.ok(html.includes('<a href="/src/pricelist.html" aria-current="page">Pricelist</a>'));
  assert.ok(!menuHtml().includes("aria-current"));
});

test("dropdown: load first, then the pages, the settings last; no link to the page it is on", () => {
  const html = dropdownHtml();
  assert.ok(html.startsWith('<li><button type="button" id="btnLoad">Load project zip…</button></li>'
    + '<li><button type="button" id="btnLoadFolder">Load project folder…</button></li>'));
  assert.ok(html.indexOf("Archive") < html.indexOf("Settings") && html.indexOf("Settings") < html.indexOf("Pricelist"));
  assert.ok(html.includes('<li><a href="/#/archive">Archive</a></li>'));
  assert.ok(html.includes('<li><a href="/src/plant-config.html">Plant config</a></li>'));
  assert.ok(!html.includes('href="/"'));
});
