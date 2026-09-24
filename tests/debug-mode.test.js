import { test } from "node:test";
import assert from "node:assert/strict";

// Each import gets its own query string so the module is evaluated
// fresh with the globals set just before it.
test("PLANT_VIEW is false unless the plant build sets the global", async () => {
  delete globalThis.PLANT_VIEW;
  const mod = await import("../src/lib/debug-mode.js?customer");
  assert.equal(mod.PLANT_VIEW, false);
});

test("PLANT_VIEW forces debug mode without touching location", async () => {
  globalThis.PLANT_VIEW = true;
  const mod = await import("../src/lib/debug-mode.js?plant");
  delete globalThis.PLANT_VIEW;
  assert.equal(mod.PLANT_VIEW, true);
  assert.equal(mod.isDebugMode(), true);
});
