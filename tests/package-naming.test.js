import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slug, fileExt, sanitizeFileName, mimeType, trackFileName, continuousSideFileName,
  tracklistFileName, printedPartFileName, previewFileName, timeStamp, humanDate, projectFileName
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
  assert.equal(mimeType(".txt"), "text/plain");
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

test("tracklistFileName builds catalogue/tracklist/side/version", () => {
  assert.equal(
    tracklistFileName({catalogue:"PNKRCK007", side:"A", ext:".txt"}),
    "PNKRCK007_tracklist_A_v1.txt"
  );
  assert.equal(
    tracklistFileName({catalogue:"PNKRCK007", side:"B", ext:".pdf"}),
    "PNKRCK007_tracklist_B_v1.pdf"
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

test("timeStamp is YYMMDD-HHMM in local time", () => {
  // Built from local fields, so the stamp must give them back whatever the time zone.
  assert.equal(timeStamp(new Date(2026, 9, 1, 14, 32)), "261001-1432");
  assert.equal(timeStamp(new Date(2026, 0, 5, 3, 7)), "260105-0307");
});

test("humanDate formats as yyyy-mm-dd", () => {
  assert.equal(humanDate(new Date(2026, 8, 19)), "2026-09-19");
  assert.equal(humanDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("projectFileName: catalogue, artist, title, local timestamp; no email", () => {
  const date = new Date(2026, 9, 1, 14, 32);
  assert.equal(projectFileName({catalogue:"PNKRCK007", artist:"The Band", title:"Loud Record", date}),
    "PNKRCK007_the_band_loud_record_261001-1432");
  assert.equal(projectFileName({catalogue:"PNKRCK007", date}), "PNKRCK007_261001-1432");
  assert.equal(projectFileName({catalogue:"PNKRCK007", artist:"Böse Söhne", title:"", date}),
    "PNKRCK007_boese_soehne_261001-1432");
  assert.equal(projectFileName({catalogue:"", date}), "untitled-release_261001-1432");
});

test("projectFileName caps artist and title at 32 characters", () => {
  const name = projectFileName({catalogue:"X1", artist:"a".repeat(40), title:"b ".repeat(30), date:new Date(2026, 9, 1, 0, 0)});
  assert.equal(name, `X1_${"a".repeat(32)}_${"b_".repeat(16).slice(0, 31)}_261001-0000`);
});
