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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Dependencies before dependents. src/plant.config.local.js (gitignored
// real plant identity — see src/plant.config.local.example.js) is
// spliced in right after config.js only when present, overwriting its
// sample CONFIG.plant. A build run without it (e.g. CI building the
// public GitHub Pages demo, which never sees a gitignored file) just
// keeps config.js's safe sample data.
const LOCAL_PLANT_CONFIG = "src/plant.config.local.js";
const hasLocalPlantConfig = existsSync(join(ROOT, LOCAL_PLANT_CONFIG));

// A real plant identity must never reach a public artifact. CI (GitHub
// Actions sets CI=true) builds the Pages preview, which must keep
// config.js's sample CONFIG.plant — abort if a gitignored local config is
// present in the checkout anyway.
if(process.env.CI && hasLocalPlantConfig){
  throw new Error(`build.js: refusing to build under CI with ${LOCAL_PLANT_CONFIG} present`);
}

const FILES = [
  "src/config.js",
  ...(hasLocalPlantConfig ? [LOCAL_PLANT_CONFIG] : []),
  "src/lib/time.js",
  "src/lib/zip.js",
  "src/lib/audio-duration.js",
  "src/lib/playing-time.js",
  "src/lib/print-artwork.js",
  "src/lib/debug-mode.js",
  "src/lib/shipping.js",
  "src/lib/countries.js",
  "src/lib/vinyl-color.js",
  "src/lib/info-text.js",
  "src/lib/package-naming.js",
  "src/lib/text-table.js",
  "src/lib/matrix.js",
  "src/lib/format-catalogue.js",
  "src/lib/transfer.js",
  "src/modules/labels.js",
  "src/modules/cover.js",
  "src/modules/inner-sleeve.js",
  "src/modules/inlay.js",
  "src/modules/vinyl-color.js",
  "src/modules/shipping-billing.js",
  "src/modules/tracklist.js",
  "src/app.js",
];

function stripModuleSyntax(source, filePath){
  return source
    // [\s\S]*? (not .*?) so a multi-line import (braces spanning several
    // lines) still gets stripped in full, not left half-stripped as a
    // dangling `import` keyword that breaks the flattened, module-less
    // script this produces.
    .replace(/^import\s[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+(?=(function|async function|const|let|class))/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
}

// app.js declares `const BUILD_STAMP = "dev";` as its own fallback for
// running src/ directly; this is the one place that literal gets replaced
// with the real build time, so dist/index.html can prove which build it is
// (see app.js's initDebugMode, ?debug on the URL).
const BUILD_STAMP_MARKER = 'const BUILD_STAMP = "dev";';

function buildBundle(){
  const sections = FILES.map(rel => {
    const full = join(ROOT, rel);
    const raw = readFileSync(full, "utf8");
    const stripped = stripModuleSyntax(raw, rel);
    return `// ---- ${rel} ----\n${stripped}`;
  });
  const bundle = sections.join("\n");
  if(!bundle.includes(BUILD_STAMP_MARKER)){
    throw new Error(`build.js: couldn't find the BUILD_STAMP marker in app.js to stamp`);
  }
  // Europe/Berlin, not UTC or the build machine's own zone — the plant
  // is in Hamburg, so a stamp they read should match their wall clock.
  const stamp = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "medium" }) + " (Berlin time)";
  return bundle.replace(BUILD_STAMP_MARKER, `const BUILD_STAMP = ${JSON.stringify(stamp)};`);
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
