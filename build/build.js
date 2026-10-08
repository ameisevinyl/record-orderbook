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
import { dirname, join, relative, resolve, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Dependencies before dependents. Plant identity comes from
// src/plant.config.local.js (gitignored, a real plant's data) when
// present, else the committed sample in plant.config.local.example.js —
// either one is bundled ahead of config.js, which reads PLANT_CONFIG.
// CI (the public GitHub Pages demo) never sees the gitignored file, so
// it always ships the sample.
const LOCAL_PLANT_CONFIG = "src/plant.config.local.js";
const hasLocalPlantConfig = existsSync(join(ROOT, LOCAL_PLANT_CONFIG));
const PLANT_CONFIG = hasLocalPlantConfig ? LOCAL_PLANT_CONFIG : "src/plant.config.local.example.js";

// A real plant identity must never reach a public artifact. CI (GitHub
// Actions sets CI=true) builds the Pages preview, which must ship the
// sample — abort if a gitignored local config is present in the
// checkout anyway.
if(process.env.CI && hasLocalPlantConfig){
  throw new Error(`build.js: refusing to build under CI with ${LOCAL_PLANT_CONFIG} present`);
}

const FILES = [
  PLANT_CONFIG,
  "src/config.js",
  "src/lib/time.js",
  "src/lib/zip.js",
  "src/lib/audio-duration.js",
  "src/lib/playing-time.js",
  "src/lib/print-artwork.js",
  "src/lib/debug-mode.js",
  "src/lib/shipping.js",
  "src/lib/countries.js",
  "src/lib/vinyl-color.js",
  "src/lib/proofs.js",
  "src/lib/info-text.js",
  "src/lib/package-naming.js",
  "src/lib/text-table.js",
  "src/lib/matrix.js",
  "src/lib/format-catalogue.js",
  "src/lib/transfer.js",
  "src/lib/pdf.js",
  "src/lib/layout-preview.js",
  "src/lib/part-template.js",
  "src/lib/specs-document.js",
  "src/lib/project.js",
  "src/lib/order-documents.js",
  "src/lib/file-issues.js",
  "src/lib/config-validation.js",
  "src/modules/artwork-slot.js",
  "src/modules/labels.js",
  "src/modules/printed-parts.js",
  "src/modules/vinyl-color.js",
  "src/modules/proofs.js",
  "src/modules/shipping-billing.js",
  "src/modules/tracklist.js",
  "src/app.js",
];

const PRICELIST_FILES = ["src/lib/format-catalogue.js", "src/lib/pricelist.js", "src/pricelist-page.js"];

const IMPORT_STATEMENT = /^import\s[\s\S]*?;\s*$/gm;

function importsIn(source, filePath){
  const pattern = new RegExp(IMPORT_STATEMENT.source, IMPORT_STATEMENT.flags);
  return [...source.matchAll(pattern)].map(match => {
    const specifier = match[0].match(/\bfrom\s+["']([^"']+)["']/) || match[0].match(/^import\s+["']([^"']+)["']/);
    if(!specifier) throw new Error(`${filePath}: couldn't parse import statement: ${match[0].trim()}`);
    return specifier[1];
  });
}

function validateFileOrder(sources, files = FILES){
  if(new Set(files).size !== files.length) throw new Error("build.js: FILES contains a duplicate path");
  const positions = new Map(files.map((file, i) => [file, i]));
  for(let i=0;i<files.length;i++){
    const file = files[i];
    for(const specifier of importsIn(sources.get(file), file)){
      if(!specifier.startsWith(".")) throw new Error(`${file}: unlisted non-local import ${JSON.stringify(specifier)}`);
      let dependency = relative(ROOT, resolve(dirname(join(ROOT, file)), specifier)).split(sep).join("/");
      // config.js points at the committed fallback so src/ works directly;
      // the build deliberately substitutes the local plant config when present.
      if(file === "src/config.js" && dependency === "src/plant.config.local.example.js") dependency = PLANT_CONFIG;
      const dependencyPosition = positions.get(dependency);
      if(dependencyPosition === undefined) throw new Error(`${file}: imported file is not listed in FILES: ${dependency}`);
      if(dependencyPosition >= i) throw new Error(`${file}: dependency must be listed first in FILES: ${dependency}`);
    }
  }
}

function stripModuleSyntax(source, filePath){
  const stripped = source
    // [\s\S]*? (not .*?) so a multi-line import (braces spanning several
    // lines) still gets stripped in full, not left half-stripped as a
    // dangling `import` keyword that breaks the flattened, module-less
    // script this produces.
    .replace(IMPORT_STATEMENT, "")
    .replace(/^export\s+(?=(function|async function|const|let|class))/gm, "")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "\n");
  if(/^\s*(import|export)\b/m.test(stripped)) throw new Error(`${filePath}: unsupported module syntax remains after flattening`);
  return stripped;
}

// app.js declares `const BUILD_STAMP = "dev";` as its own fallback for
// running src/ directly; this is the one place that literal gets replaced
// with the real build time, so dist/index.html can prove which build it is
// (see app.js's initDebugMode, ?debug on the URL).
const BUILD_STAMP_MARKER = 'const BUILD_STAMP = "dev";';

function buildBundle(files = FILES){
  const sources = new Map(files.map(rel => [rel, readFileSync(join(ROOT, rel), "utf8")]));
  validateFileOrder(sources, files);
  const sections = files.map(rel => {
    const raw = sources.get(rel);
    const stripped = stripModuleSyntax(raw, rel);
    return `// ---- ${rel} ----\n${stripped}`;
  });
  const bundle = sections.join("\n");
  if(files !== FILES) return checked(bundle);
  if(bundle.split(BUILD_STAMP_MARKER).length !== 2) throw new Error(`build.js: expected exactly one BUILD_STAMP marker in app.js`);
  // Europe/Berlin, not UTC or the build machine's own zone — the plant
  // is in Hamburg, so a stamp they read should match their wall clock.
  const stamp = new Date().toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "medium" }) + " (Berlin time)";
  return checked(bundle.replace(BUILD_STAMP_MARKER, `const BUILD_STAMP = ${JSON.stringify(stamp)};`));
}

function checked(stamped){
  try{
    Function(stamped);
  }catch(error){
    throw new Error(`build.js: flattened script does not compile: ${error.message}`);
  }
  // A literal </script> in the bundle would close the inline script tag in
  // dist/index.html early and spill the rest of the code onto the page —
  // escape it as <\/script> at the source.
  if(/<\/script/i.test(stamped)) throw new Error("build.js: bundle contains a literal </script>, which would close the inline script tag early");
  return stamped;
}

function buildHtml(bundleJs, shellFile = "src/index.html", script = "app.js"){
  const shellPath = join(ROOT, shellFile);
  const shell = readFileSync(shellPath, "utf8");
  const marker = new RegExp(`<script type="module" src="${script.replace(".", "\\.")}"></script>`);
  const matches = shell.match(new RegExp(marker.source, "g")) || [];
  if(matches.length !== 1) throw new Error(`${shellFile}: expected exactly one ${script} module script tag to replace, found ${matches.length}`);
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
  buildPricelistPage(outDir);
}

// The staff pricelist editor: its own page, the example list embedded as the
// starting point (build-time marker, like BUILD_STAMP above).
const TEMPLATE_MARKER = "const TEMPLATE = null;";
function buildPricelistPage(outDir){
  const js = buildBundle(PRICELIST_FILES);
  if(js.split(TEMPLATE_MARKER).length !== 2) throw new Error("build.js: expected exactly one TEMPLATE marker in pricelist-page.js");
  const example = readFileSync(join(ROOT, "src/pricelist.example.json"), "utf8");
  const html = buildHtml(js.replace(TEMPLATE_MARKER, `const TEMPLATE = ${example.trim().replace(/<\//g, "<\\/")};`), "src/pricelist.html", "pricelist-page.js");
  const outPath = join(outDir, "pricelist.html");
  writeFileSync(outPath, html, "utf8");
  console.log(`built ${outPath} (${(Buffer.byteLength(html, "utf8") / 1024).toFixed(1)} KB)`);
}

main();
