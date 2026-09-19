import { test } from "node:test";
import assert from "node:assert/strict";
import { infoText, renderInfoIcon } from "../src/lib/info-text.js";

const infoConfig = {
  bigCenter: { en: "English text", de: "Deutscher Text" }
};

test("infoText returns the requested locale's text", () => {
  assert.equal(infoText(infoConfig, "de", "bigCenter"), "Deutscher Text");
});

test("infoText falls back to English when the locale has no entry yet", () => {
  assert.equal(infoText(infoConfig, "es", "bigCenter"), "English text");
});

test("infoText returns empty string for an unknown key", () => {
  assert.equal(infoText(infoConfig, "en", "unknownKey"), "");
});

test("renderInfoIcon returns empty string for empty/missing text", () => {
  assert.equal(renderInfoIcon(""), "");
  assert.equal(renderInfoIcon(null), "");
});

test("renderInfoIcon wraps the text in a collapsed <details>", () => {
  const html = renderInfoIcon("hello there");
  assert.match(html, /^<details class="info no-print">/);
  assert.match(html, /<summary/);
  assert.match(html, /hello there/);
  assert.ok(!html.includes(" open"), "should not render with the open attribute");
});
