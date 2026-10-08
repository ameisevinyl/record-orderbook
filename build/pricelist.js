#!/usr/bin/env node
// Pricelist helper. Works on src/pricelist.json (gitignored, the plant's
// real prices), else on the committed template src/pricelist.example.json.
//   extract           list the item keys CONFIG defines
//   generate          add new items, drop removed ones, keep filled prices
//                     (--example: the template instead of the local list)
//   check             validate; list unpriced items and orphans, exit 1 on any
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { CONFIG } from "../src/config.js";
import { priceItems, mergePricelist, unpriced, validatePricelist, formatPricelist } from "../src/lib/pricelist.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const LOCAL = join(SRC, "pricelist.json");
const EXAMPLE = join(SRC, "pricelist.example.json");
const read = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;

const [command, flag] = process.argv.slice(2);
const items = priceItems(CONFIG);
const today = new Date().toLocaleDateString("sv");

if(command === "extract"){
  items.forEach(({ key, name }) => console.log(`${key}\t${name}`));
}else if(command === "generate"){
  const target = flag === "--example" ? EXAMPLE : LOCAL;
  const { list, orphans } = mergePricelist(items, read(target) || {}, today);
  writeFileSync(target, formatPricelist(list));
  console.log(`wrote ${target}: ${items.length} items, ${unpriced(list).length} unpriced`);
  if(orphans.length) console.log(`dropped (no longer in config): ${orphans.join(", ")}`);
}else if(command === "check"){
  const path = existsSync(LOCAL) ? LOCAL : EXAMPLE;
  const list = validatePricelist(read(path));
  const { list: merged, orphans } = mergePricelist(items, list, today);
  const missing = items.filter(({ key }) => !(key in list.items)).map(i => i.key);
  const open = unpriced(merged).filter(key => !missing.includes(key));
  console.log(`${path}: ${items.length} items`);
  if(missing.length) console.log(`not in the list (run generate): ${missing.join(", ")}`);
  if(open.length) console.log(`unpriced: ${open.join(", ")}`);
  if(orphans.length) console.log(`not in config (run generate): ${orphans.join(", ")}`);
  process.exitCode = missing.length + open.length + orphans.length ? 1 : 0;
}else{
  console.error("usage: node build/pricelist.js extract | generate [--example] | check");
  process.exitCode = 2;
}
