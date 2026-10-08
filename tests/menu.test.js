import { test } from "node:test";
import assert from "node:assert/strict";
import { MENU, menuHtml } from "../src/lib/menu.js";

test("menu: absolute, unique hrefs; staff pages are served from src/", () => {
  const hrefs = MENU.map(([, href]) => href);
  assert.equal(new Set(hrefs).size, hrefs.length);
  assert.ok(hrefs.every(h => h.startsWith("/")));
  assert.deepEqual(hrefs, ["/", "/src/pricelist.html", "/src/plant-config.html"]);
});

test("menuHtml: one link per entry, only the current one marked", () => {
  const html = menuHtml("/src/pricelist.html");
  assert.equal(html.match(/<a /g).length, MENU.length);
  assert.equal(html.match(/aria-current/g).length, 1);
  assert.ok(html.includes('<a href="/src/pricelist.html" aria-current="page">Pricelist</a>'));
  assert.ok(!menuHtml().includes("aria-current"));
});
