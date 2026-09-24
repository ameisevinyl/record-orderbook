import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { validateConfig } from "../src/lib/config-validation.js";

const copy = () => structuredClone(CONFIG);

test("validates and returns the committed CONFIG", () => {
  assert.equal(validateConfig(CONFIG), CONFIG);
});

test("requires unique format IDs and an enabled format", () => {
  const duplicate = copy();
  duplicate.formats[1].id = duplicate.formats[0].id;
  assert.throws(() => validateConfig(duplicate), /CONFIG\.formats contains duplicate ID/);

  const disabled = copy();
  disabled.formats.forEach(format => { format.enabled = false; });
  assert.throws(() => validateConfig(disabled), /at least one enabled format/);
});

test("validates format RPM, time limits, and center holes", () => {
  const rpm = copy();
  rpm.formats[0].rpm = 78;
  assert.throws(() => validateConfig(rpm), /rpm must be 33 or 45/);
  const recommendedRpm = copy();
  recommendedRpm.formats[0].recommendedRpm = 78;
  assert.throws(() => validateConfig(recommendedRpm), /recommendedRpm must be 33 or 45/);

  const limits = copy();
  limits.formats[0].timeLimits.normal.recommended[33] = 30;
  assert.throws(() => validateConfig(limits), /recommended must not exceed max at 33 RPM/);

  const hole = copy();
  hole.formats[0].centerHole.normal = 0;
  assert.throws(() => validateConfig(hole), /centerHole\.normal must be a positive number/);
});

test("validates every artwork severity", () => {
  const config = copy();
  config.formats[0].printCheck.checks.encryption.severity = "fatal";
  assert.throws(() => validateConfig(config), /encryption\.severity must be debug, info, warn, or error/);
});

test("validates fonts.requireEmbedded as a boolean without requiring true", () => {
  const retained = copy();
  retained.formats.forEach(format => { format.printCheck.checks.fonts.requireEmbedded = false; });
  assert.equal(validateConfig(retained), retained);

  const invalid = copy();
  invalid.formats[0].printCheck.checks.fonts.requireEmbedded = "yes";
  assert.throws(() => validateConfig(invalid), /fonts\.requireEmbedded must be a boolean/);
});

test("requires unique product IDs, supported kinds, and printed dimensions", () => {
  const duplicate = copy();
  const sleeves = duplicate.formats[0].printableParts.innerSleeve.products;
  sleeves[1].id = sleeves[0].id;
  assert.throws(() => validateConfig(duplicate), /innerSleeve\.products contains duplicate ID/);

  const kind = copy();
  kind.formats[0].printableParts.inlay.products[0].kind = "digital";
  assert.throws(() => validateConfig(kind), /kind must be printed or unprinted/);

  const dimensions = copy();
  dimensions.formats[0].printableParts.outerCover.products[0].trimMm.w = 0;
  assert.throws(() => validateConfig(dimensions), /trimMm\.w must be a positive number/);

  const emptySleeves = copy();
  emptySleeves.formats[0].printableParts.innerSleeve.products = [];
  assert.throws(() => validateConfig(emptySleeves), /innerSleeve\.products must contain at least one product/);

  const defaults = copy();
  defaults.formats[0].printableParts.innerSleeve.products[1].default = true;
  assert.throws(() => validateConfig(defaults), /innerSleeve\.products must contain exactly one default product/);

  const finalSize = copy();
  delete finalSize.formats[0].printableParts.innerSleeve.products[0].finalMm;
  assert.throws(() => validateConfig(finalSize), /finalMm must be an object/);
});

test("validates vinyl colour IDs and minimum quantities", () => {
  const duplicate = copy();
  duplicate.vinylColor.basicColors.push(duplicate.vinylColor.standardColor);
  assert.throws(() => validateConfig(duplicate), /duplicate colour ID/);

  const standard = copy();
  standard.vinylColor.standardColor = "random";
  assert.throws(() => validateConfig(standard), /reserved random ID/);

  const minimum = copy();
  minimum.vinylColor.minOrderQty.yellow = 2.5;
  assert.throws(() => validateConfig(minimum), /yellow must be a nonnegative integer/);
});

test("validates plant imprint and transfer shape", () => {
  const imprint = copy();
  delete imprint.plant.imprint.recipientName;
  assert.throws(() => validateConfig(imprint), /recipientName must be a non-empty string/);

  const transfer = copy();
  transfer.plant.transfer.uploadUrl = "";
  transfer.plant.transfer.uploadServiceUrl = "";
  assert.throws(() => validateConfig(transfer), /must provide uploadUrl or both uploadServiceUrl and uploadEmail/);
});

test("validates the audio master-file spec", () => {
  const emptyLabels = copy();
  emptyLabels.audioSpec.labels = [];
  assert.throws(() => validateConfig(emptyLabels), /audioSpec\.labels must not be empty/);

  const bitDepth = copy();
  bitDepth.audioSpec.minBitDepth = 0;
  assert.throws(() => validateConfig(bitDepth), /audioSpec\.minBitDepth must be a positive number/);

  const belowMinimum = copy();
  belowMinimum.audioSpec.recommendedBitDepth = 8;
  assert.throws(() => validateConfig(belowMinimum), /recommendedBitDepth must not be below minBitDepth/);

  const sampleRate = copy();
  sampleRate.audioSpec.minSampleRateHz = 0;
  assert.throws(() => validateConfig(sampleRate), /audioSpec\.minSampleRateHz must be a positive number/);
});

test("validates artwork file types, print spec, locale, and info text", () => {
  const accept = copy();
  accept.artworkFileTypes.accept = "";
  assert.throws(() => validateConfig(accept), /artworkFileTypes\.accept must be a non-empty string/);

  const labels = copy();
  labels.artworkFileTypes.labels = [];
  assert.throws(() => validateConfig(labels), /artworkFileTypes\.labels must not be empty/);

  const tracklistAccept = copy();
  tracklistAccept.tracklistFileTypes.accept = "";
  assert.throws(() => validateConfig(tracklistAccept), /tracklistFileTypes\.accept must be a non-empty string/);

  const tracklistLabels = copy();
  tracklistLabels.tracklistFileTypes.labels = [];
  assert.throws(() => validateConfig(tracklistLabels), /tracklistFileTypes\.labels must not be empty/);

  const profile = copy();
  profile.printSpec.colourProfile = "";
  assert.throws(() => validateConfig(profile), /printSpec\.colourProfile must be a non-empty string/);

  const blocking = copy();
  blocking.blockIncompleteArtworkOnSend = "yes";
  assert.throws(() => validateConfig(blocking), /blockIncompleteArtworkOnSend must be a boolean/);

  const locale = copy();
  locale.locale = "";
  assert.throws(() => validateConfig(locale), /CONFIG\.locale must be a non-empty string/);

  const info = copy();
  delete info.infoText.bigCenter.en;
  assert.throws(() => validateConfig(info), /infoText\.bigCenter\.en must be a non-empty string/);
});
