// Pricelist (src/pricelist.json): prices for every product CONFIG defines.
// Pure — the CLI in build/pricelist.js does the disk. Net prices only;
// `vat` is stored for later and not applied (see quote.js).
//
// Item keys: <format>/record/<black|colour|random>,
// <format>/<innerSleeve|outerCover|inlay>/<product id>,
// <format>/referenceCut, <format>/testpress, <format>/extra/<id>.
// Item: { name, includes?, unit, tiers:[{from, price}], min? } — price per
// `unit` pieces (1000, or "order" = flat) from quantity `from` upwards;
// `min` is the lowest line total. price null = not filled in, 0 = included.

import { enabledFormats } from "./format-catalogue.js";

const PART_TITLE = { innerSleeve: "inner sleeve", outerCover: "cover", inlay: "inlay" };

// What a freshly derived item starts with; the plant's real unit replaces it.
const unitOf = key =>
  /\/(referenceCut|extra\/master-stamper)$/.test(key) ? "order" : /\/testpress$/.test(key) ? 1 : 1000;

export function priceItems(config){
  const items = [];
  for(const format of enabledFormats(config)){
    const add = (key, name) => items.push({ key: `${format.id}/${key}`, name: `${format.label} ${name}` });
    const vinyl = config.vinylColor;
    add("record/black", `record, ${vinyl.standardColor}`);
    if(vinyl.basicColors.length) add("record/colour", "record, colour");
    add("record/random", "record, random colour");
    for(const [part, title] of Object.entries(PART_TITLE)){
      for(const product of format.printableParts[part].products) add(`${part}/${product.id}`, `${title}: ${product.name}`);
    }
    if(format.proofs.referenceCut) add("referenceCut", "reference cut");
    if(format.proofs.testpress) add("testpress", "testpress");
    for(const extra of format.extras) add(`extra/${extra.id}`, extra.name);
  }
  return items;
}

// Keeps what the plant filled in, adds what config gained, drops what it
// lost (returned as `orphans`, so the caller can say so).
export function mergePricelist(items, existing = {}){
  const old = existing.items || {};
  const merged = {};
  for(const { key, name } of items){
    merged[key] = { name, unit: unitOf(key), tiers: [{ from: 1, price: null }], ...old[key], name };
  }
  return {
    list: {
      version: 1, currency: "EUR", valid: "", vat: { country: "ES", rate: 21 }, discounts: [],
      ...existing, items: merged
    },
    orphans: Object.keys(old).filter(key => !(key in merged))
  };
}

export const unpriced = list =>
  Object.entries(list.items).filter(([, item]) => item.tiers.some(t => t.price === null)).map(([key]) => key);

function fail(path, expected){
  throw new Error(`pricelist ${path} ${expected}`);
}

const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);

export function validatePricelist(list){
  if(!list || typeof list !== "object") fail("", "must be an object");
  if(list.version !== 1) fail("version", "must be 1");
  if(typeof list.currency !== "string" || !/^[A-Z]{3}$/.test(list.currency)) fail("currency", "must be an ISO 4217 code");
  const vat = list.vat || {};
  if(typeof vat.country !== "string" || !/^[A-Z]{2}$/.test(vat.country)) fail("vat.country", "must be an ISO 3166 code");
  if(!Number.isFinite(vat.rate) || vat.rate < 0 || vat.rate > 100) fail("vat.rate", "must be a number from 0 to 100");

  for(const [key, item] of Object.entries(list.items || {})){
    const path = `items["${key}"]`;
    if(item.unit !== "order" && !(Number.isFinite(item.unit) && item.unit > 0)) fail(`${path}.unit`, 'must be a positive number or "order"');
    if(!Array.isArray(item.tiers) || !item.tiers.length) fail(`${path}.tiers`, "must not be empty");
    item.tiers.forEach((tier, i) => {
      if(!Number.isInteger(tier.from) || tier.from < 1) fail(`${path}.tiers[${i}].from`, "must be a positive integer");
      if(i && tier.from <= item.tiers[i - 1].from) fail(`${path}.tiers`, "must ascend by from");
      if(tier.price !== null && !(Number.isFinite(tier.price) && tier.price >= 0)) fail(`${path}.tiers[${i}].price`, "must be null or a nonnegative number");
    });
    if(item.min !== undefined && !(Number.isFinite(item.min) && item.min >= 0)) fail(`${path}.min`, "must be a nonnegative number");
  }

  const ids = new Set();
  for(const [i, discount] of (list.discounts || []).entries()){
    const path = `discounts[${i}]`;
    if(typeof discount.id !== "string" || !discount.id || ids.has(discount.id)) fail(`${path}.id`, "must be a unique non-empty string");
    ids.add(discount.id);
    if(!Number.isFinite(discount.percent) || discount.percent < 0 || discount.percent > 100) fail(`${path}.percent`, "must be a number from 0 to 100");
    for(const name of ["from", "to"]){
      if(discount[name] !== undefined && !isDate(discount[name])) fail(`${path}.${name}`, "must be YYYY-MM-DD");
    }
  }
  return list;
}

// Pretty JSON, one tier per line — the file is edited by hand.
export const formatPricelist = list =>
  JSON.stringify(list, null, 2).replace(/\{\s+"from": (\d+),\s+"price": ([\d.]+|null)\s+\}/g, '{ "from": $1, "price": $2 }') + "\n";
