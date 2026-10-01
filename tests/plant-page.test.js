import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/plant/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/plant/structure.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/plant/theme.css", import.meta.url), "utf8");

test("page: plain HTML5 skeleton, no inline style", () => {
  assert.ok(!/<style/i.test(html) && !/\sstyle=/i.test(html));
  assert.ok(html.includes('<link rel="stylesheet" href="/src/plant/structure.css">'));
  for(const part of ["<header>", '<pre id="status">idle</pre>', '<nav id="nav">', '<main id="out">']) assert.ok(html.includes(part), part);
});

test("structure.css: structure only — no fonts, spacing, animation, hex or rgb colours", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/\b(font|margin|padding|animation)[\w-]*\s*:/i.test(rules));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(rules));
  assert.ok(/grid-template-columns/.test(rules));
});

test("theme.css: linked after structure.css, carries the design tokens", () => {
  assert.ok(html.indexOf("/src/plant/structure.css") < html.indexOf("/src/plant/theme.css"));
  assert.ok(/--ink\s*:/.test(theme) && /--danger\s*:/.test(theme));
  assert.ok(/font:.*var\(--sans\)/.test(theme));
});
