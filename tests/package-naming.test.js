import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slug, fileExt, sanitizeFileName, mimeType, trackFileName, continuousSideFileName,
  printedPartFileName, previewFileName, dateStamp, humanDate, projectFileName
} from "../src/lib/package-naming.js";

test("slug lowercases and collapses non-alnum runs to single underscores", () => {
  assert.equal(slug("My Way (Radio Edit)!!"), "my_way_radio_edit");
  assert.equal(slug("  leading/trailing  "), "leading_trailing");
  assert.equal(slug(""), "");
});

test("slug transliterates German umlauts and ß instead of dropping them", () => {
  assert.equal(slug("Ein schöner Tag"), "ein_schoener_tag");
  assert.equal(slug("Mädchen"), "maedchen");
  assert.equal(slug("Grüße"), "gruesse");
  assert.equal(slug("groß"), "gross");
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

test("mimeType maps known extensions case-insensitively, else empty", () => {
  assert.equal(mimeType(".PDF"), "application/pdf");
  assert.equal(mimeType(".jpg"), "image/jpeg");
  assert.equal(mimeType(".wav"), "audio/wav");
  assert.equal(mimeType(".xyz"), "");
  assert.equal(mimeType(""), "");
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

test("previewFileName builds catalogue/part/variant with a forced _preview.jpg suffix", () => {
  assert.equal(
    previewFileName({catalogue:"PNKRCK007", part:"labels", variant:"A"}),
    "PNKRCK007_labels_A_v1_preview.jpg"
  );
  assert.equal(
    previewFileName({catalogue:"PNKRCK007", part:"cover"}),
    "PNKRCK007_cover_v1_preview.jpg"
  );
});

test("dateStamp formats as YYMMDD", () => {
  assert.equal(dateStamp(new Date(2026, 8, 19)), "260919");
});

test("humanDate formats as yyyy-mm-dd", () => {
  assert.equal(humanDate(new Date(2026, 8, 19)), "2026-09-19");
  assert.equal(humanDate(new Date(2026, 0, 5)), "2026-01-05");
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
