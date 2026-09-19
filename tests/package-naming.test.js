import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slug, fileExt, sanitizeFileName, trackFileName, continuousSideFileName,
  printedPartFileName, dateStamp, projectFileName
} from "../src/lib/package-naming.js";

test("slug lowercases and collapses non-alnum runs to single underscores", () => {
  assert.equal(slug("My Way (Radio Edit)!!"), "my_way_radio_edit");
  assert.equal(slug("  leading/trailing  "), "leading_trailing");
  assert.equal(slug(""), "");
});

test("fileExt extracts the extension with its dot, or empty string", () => {
  assert.equal(fileExt("track.WAV"), ".WAV");
  assert.equal(fileExt("noext"), "");
  assert.equal(fileExt("a.b.c"), ".c");
});

test("sanitizeFileName strips reserved characters but keeps case", () => {
  assert.equal(sanitizeFileName("PNKRCK007"), "PNKRCK007");
  assert.equal(sanitizeFileName('a/b:c*d?e"f<g>h|i'), "a-b-c-d-e-f-g-h-i");
  assert.equal(sanitizeFileName(""), "untitled-release");
});

test("trackFileName builds catalogue/side/index/title/artist/version", () => {
  assert.equal(
    trackFileName({catalogue:"PNKRCK007", side:"A", index:1, title:"My Way", artist:"The Band", ext:".wav"}),
    "PNKRCK007_A1_my_way_the_band_v1.wav"
  );
  assert.equal(
    trackFileName({catalogue:"PNKRCK007", side:"B", index:2, title:"", artist:"", ext:".aiff"}),
    "PNKRCK007_B2_untitled_v1.aiff"
  );
});

test("continuousSideFileName", () => {
  assert.equal(
    continuousSideFileName({catalogue:"PNKRCK007", side:"A", ext:".wav"}),
    "PNKRCK007_A_side_v1.wav"
  );
});

test("printedPartFileName builds catalogue/part/variant/version", () => {
  assert.equal(
    printedPartFileName({catalogue:"PNKRCK007", part:"labels", variant:"A", ext:".pdf"}),
    "PNKRCK007_labels_A_v1.pdf"
  );
  assert.equal(
    printedPartFileName({catalogue:"PNKRCK007", part:"cover", ext:".pdf"}),
    "PNKRCK007_cover_v1.pdf"
  );
});

test("dateStamp formats as YYMMDD", () => {
  assert.equal(dateStamp(new Date(2026, 8, 19)), "260919");
});

test("projectFileName combines date, catalogue and customer email", () => {
  assert.equal(
    projectFileName({catalogue:"PNKRCK007", customerEmail:"a@b.com", date:new Date(2026, 8, 19)}),
    "260919_PNKRCK007_a_b_com"
  );
  assert.equal(
    projectFileName({catalogue:"PNKRCK007", date:new Date(2026, 8, 19)}),
    "260919_PNKRCK007"
  );
});
