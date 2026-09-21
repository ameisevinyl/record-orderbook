import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafari } from "../src/lib/browser.js";

const SAFARI_MACOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const SAFARI_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_MACOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_MACOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:127.0) Gecko/20100101 Firefox/127.0";

test("isSafari is true for real Safari on macOS and iOS", () => {
  assert.equal(isSafari(SAFARI_MACOS), true);
  assert.equal(isSafari(SAFARI_IOS), true);
});

test("isSafari is false for Chrome, even on iOS where its UA also contains 'Safari'", () => {
  assert.equal(isSafari(CHROME_MACOS), false);
  assert.equal(isSafari(CHROME_IOS), false);
});

test("isSafari is false for Edge and Firefox", () => {
  assert.equal(isSafari(EDGE_WINDOWS), false);
  assert.equal(isSafari(FIREFOX_MACOS), false);
});
