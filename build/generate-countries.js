#!/usr/bin/env node
// Regenerates the country list in src/lib/countries.js from Node's built-in
// ICU (Intl.DisplayNames) — dev-time only, per CLAUDE.md's "Node is fine for
// dev tooling, zero npm installs" rule. The committed src/lib/countries.js
// is a static array; nothing in the shipped app calls Intl.DisplayNames at
// runtime (region names would then vary by browser/version on a printed
// shipping document).
//
// Usage: node build/generate-countries.js
// Prints the array body (JS source) to stdout for review/diffing against
// src/lib/countries.js — this does not overwrite that file automatically,
// since a count drift here should be investigated, not silently applied.

const dn = new Intl.DisplayNames(["en"], { type: "region" });
const raw = [];
for (let a = 65; a <= 90; a++) {
  for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    const name = dn.of(code);
    if (name !== code) raw.push([code, name]);
  }
}

// See the comment in src/lib/countries.js for what each group is and why.
const EXCLUDE = new Set([
  "XA", "XB", "ZZ",
  "EU", "EZ", "UN", "QO",
  "UK",
  "AC", "CP", "DG", "EA", "IC", "TA", "CQ",
  "XK",
  "AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "VD", "YD", "YU", "ZR"
]);

const filtered = raw.filter(([code]) => !EXCLUDE.has(code));
filtered.sort((a, b) => a[1].localeCompare(b[1], "en"));

if (filtered.length !== 249) {
  console.error(`expected 249 ISO 3166-1 alpha-2 codes, got ${filtered.length} — investigate the diff, don't just adjust EXCLUDE`);
  process.exit(1);
}

for (const [code, name] of filtered) {
  console.log(`  ["${code}", ${JSON.stringify(name)}],`);
}
