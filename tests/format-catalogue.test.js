import { test } from "node:test";
import assert from "node:assert/strict";
import { getFormat, enabledFormats, firstEnabledFormat } from "../src/lib/format-catalogue.js";

const config = {
  formats: [
    { id: "12", label: '12" LP', enabled: true },
    { id: "10", label: '10" EP', enabled: false },
    { id: "7",  label: '7" SP',  enabled: true }
  ]
};

test("getFormat returns the format matching id", () => {
  assert.deepEqual(getFormat(config, "7"), { id: "7", label: '7" SP', enabled: true });
});

test("getFormat returns undefined for an unknown id", () => {
  assert.equal(getFormat(config, "9"), undefined);
});

test("enabledFormats filters to enabled:true, keeping array order", () => {
  const result = enabledFormats(config);
  assert.deepEqual(result.map(f => f.id), ["12", "7"]);
});

test("firstEnabledFormat returns the first enabled format's id", () => {
  assert.equal(firstEnabledFormat(config), "12");
});

test("firstEnabledFormat throws when no format is enabled", () => {
  const allDisabled = { formats: [{ id: "7", label: '7" SP', enabled: false }] };
  assert.throws(() => firstEnabledFormat(allDisabled), /at least one format must be enabled/);
});
