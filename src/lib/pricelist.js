// Pricelist (src/pricelist.json): prices for every product CONFIG defines.
// Pure — the CLI in build/pricelist.js does the disk. Net prices only;
// `vat` is stored for later and not applied (see quote.js).
//
// Item keys: <format>/record/<black|colour|random>,
// <format>/<innerSleeve|outerCover|inlay>/<product id>,
// <format>/referenceCut, <format>/testpress and, for every format,
// <format>/mastering/<lacquerCut|plating1|plating2> (see MASTERING) and
// <format>/record/setup (the pressing machine, once per order).
// Item: { name, includes?, unit, tiers:[{from, price}], min? } — price per
// `unit` pieces (1000, or "order" = flat) from quantity `from` upwards;
// `min` is the lowest line total. price null = not filled in, 0 = included.

import { enabledFormats } from "./format-catalogue.js";

// Every release needs these, whatever the format: a lacquer cut and a
// plating (1-step father, or 2-step father & mother) per side. Flat
// prices, multiplied by the sides.
const MASTERING = [
  ["lacquerCut", "lacquer cut, per side"],
  ["plating1", "1-step plating (father), per side"],
  ["plating2", "2-step plating (father & mother), per side"]
];

const PART_TITLE = { innerSleeve: "inner sleeve", outerCover: "cover", inlay: "inlay" };

// What a freshly derived item starts with; the plant's real unit replaces it.
const unitOf = key =>
  /\/(referenceCut|mastering\/.+|record\/setup)$/.test(key) ? "order" : /\/testpress$/.test(key) ? 1 : 1000;

export function priceItems(config){
  const items = [];
  for(const format of enabledFormats(config)){
    const add = (key, name) => items.push({ key: `${format.id}/${key}`, name: `${format.label} ${name}` });
    // Prepress comes first.
    for(const [id, name] of MASTERING) add(`mastering/${id}`, name);
    const vinyl = config.vinylColor;
    add("record/setup", "pressing setup");
    add("record/black", `record, ${vinyl.standardColor}`);
    if(vinyl.basicColors.length) add("record/colour", "record, colour");
    add("record/random", "record, random colour");
    for(const [part, title] of Object.entries(PART_TITLE)){
      for(const product of format.printableParts[part].products) add(`${part}/${product.id}`, `${title}: ${product.name}`);
    }
    if(format.proofs.referenceCut) add("referenceCut", "reference cut");
    if(format.proofs.testpress) add("testpress", "testpress");
  }
  return items;
}

const pad = n => String(n).padStart(2, "0");

// A real calendar date, YYYY-MM-DD.
export function isDate(text){
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

// The last day of the quarter the date falls in: the default end of validity.
export function quarterEnd(date){
  const year = Number(date.slice(0, 4)), month = Math.ceil(Number(date.slice(5, 7)) / 3) * 3;
  return `${year}-${pad(month)}-${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

// Files from before `created`/`validUntil` carried a free-text `valid` label.
export function upgradePricelist(list, today){
  const { valid, ...rest } = list;
  const created = rest.created || today;
  return { ...rest, created, validUntil: rest.validUntil || quarterEnd(created) };
}

// Keeps what the plant filled in, adds what config gained, drops what it
// lost (returned as `orphans`, so the caller can say so).
export function mergePricelist(items, existing, today){
  const { items: old = {}, discounts, ...rest } = upgradePricelist(existing, today); // discounts: dropped for now
  const merged = {};
  for(const { key, name } of items){
    merged[key] = { name, unit: unitOf(key), tiers: [{ from: 1, price: null }], ...old[key], name };
  }
  return {
    list: {
      version: 1, currency: "EUR", created: rest.created, validUntil: rest.validUntil, vat: { country: "ES", rate: 21 },
      ...rest, items: merged
    },
    orphans: Object.keys(old).filter(key => !(key in merged))
  };
}

export const unpriced = list =>
  Object.entries(list.items).filter(([, item]) => item.tiers.some(t => t.price === null)).map(([key]) => key);

function fail(path, expected){
  throw new Error(`pricelist ${path} ${expected}`);
}

export function validatePricelist(list){
  if(!list || typeof list !== "object") fail("", "must be an object");
  if(list.version !== 1) fail("version", "must be 1");
  if(typeof list.currency !== "string" || !/^[A-Z]{3}$/.test(list.currency)) fail("currency", "must be an ISO 4217 code");
  if(!isDate(list.created)) fail("created", "must be a date, YYYY-MM-DD");
  if(!isDate(list.validUntil)) fail("validUntil", "must be a date, YYYY-MM-DD");
  if(list.validUntil < list.created) fail("validUntil", "must not be before created");
  const vat = list.vat || {};
  if(typeof vat.country !== "string" || !/^[A-Z]{2}$/.test(vat.country)) fail("vat.country", "must be an ISO 3166 code");
  if(vat.rate !== null && !(Number.isFinite(vat.rate) && vat.rate >= 0 && vat.rate <= 100)) fail("vat.rate", "must be null or a number from 0 to 100");

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

  return list;
}

// Pretty JSON, one tier per line — the file is edited by hand.
export const formatPricelist = list =>
  JSON.stringify(list, null, 2).replace(/\{\s+"from": (\d+),\s+"price": ([\d.]+|null)\s+\}/g, '{ "from": $1, "price": $2 }') + "\n";

// Editing views: the page shows € per piece, the file stores the price per `unit`.
const pieces = unit => unit === "order" ? 1 : unit;

export const perPiece = (price, unit) => price === null ? "" : String(Math.round(price / pieces(unit) * 1e4) / 1e4);

// "" -> null (not filled in), "1,22" -> 1220 per 1000, junk or negative -> NaN.
export function parsePrice(text, unit){
  if(!text.trim()) return null;
  const value = Number(text.replace(/[€\s]/g, "").replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * pieces(unit) * 100) / 100 : NaN;
}
