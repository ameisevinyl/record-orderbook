#!/usr/bin/env node
// Builds dist/index.html: a single, self-contained file with no external
// requests, from the ES-module sources under src/.
//
// This is deliberately not a real bundler — no dependency resolution,
// no scope isolation. It concatenates a fixed, manually-maintained file
// order (see FILES below) and strips `import ...;` / `export ` syntax
// with a couple of regexes. That's enough because the source tree is
// small and the dependency order rarely changes; if a new lib or module
// is added, add its path to FILES in the right position (dependencies
// before dependents) below.
//
// Consequence worth knowing: everything ends up in one shared top-level
// scope, so two files can't declare the same top-level name even if in
// real ES modules they'd never collide (see src/lib/playing-time.js's
// `computeStatus` — it used to be named `statusFor` like the DOM-facing
// function in tracklist.js, which was fine under real per-file module
// scope but would collide once flattened here).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Dependencies before dependents.
const FILES = [
  "src/config.js",
  "src/lib/time.js",
  "src/lib/zip.js",
  "src/lib/audio-duration.js",
  "src/lib/playing-time.js",
  "src/lib/print-artwork.js",
  "src/lib/shipping.js",
  "src/lib/countries.js",
  "src/lib/vinyl-color.js",
  "src/lib/info-text.js",
  "src/lib/package-naming.js",
  "src/modules/labels.js",
  "src/modules/cover-sleeve.js",
  "src/modules/vinyl-color.js",
  "src/modules/shipping-billing.js",
  "src/modules/tracklist.js",
  "src/app.js",
];

function stripModuleSyntax(source, filePath){
  return source
    .replace(/^import\s.*?;\s*$/gm, "")
    .replace(/^export\s+(?=(function|async function|const|let|class))/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
}

function buildBundle(){
  const sections = FILES.map(rel => {
    const full = join(ROOT, rel);
    const raw = readFileSync(full, "utf8");
    const stripped = stripModuleSyntax(raw, rel);
    return `// ---- ${rel} ----\n${stripped}`;
  });
  return sections.join("\n");
}

function buildHtml(bundleJs){
  const shellPath = join(ROOT, "src/index.html");
  const shell = readFileSync(shellPath, "utf8");
  const marker = /<script type="module" src="app\.js"><\/script>/;
  if(!marker.test(shell)){
    throw new Error(`src/index.html: couldn't find the app.js module script tag to replace`);
  }
  return shell.replace(marker, `<script>\n${bundleJs}\n</script>`);
}

function main(){
  const bundleJs = buildBundle();
  const html = buildHtml(bundleJs);
  const outDir = join(ROOT, "dist");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "index.html");
  writeFileSync(outPath, html, "utf8");
  const kb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
  console.log(`built ${outPath} (${kb} KB)`);
}

main();
