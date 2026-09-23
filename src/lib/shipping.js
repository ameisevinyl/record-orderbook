// Pure shipping/billing logic — no DOM. Quantity allocation, required-field
// checks, and best-effort format checks for VAT / EORI / email / phone.
//
// Format checks here are front-end sanity only, same spirit as
// print-artwork.js's checklist: catch obvious typos, don't pretend to be
// the authority. In particular this deliberately does not
// ship a per-country VAT regex table (27+ formats, easy to get wrong and
// reject a real customer's VAT ID) — it checks the generic EU shape
// (2-letter country prefix + alphanumeric body) and nothing more. Actual
// validity is confirmed by a human via the VIES link, since VIES has no
// public browser-callable (CORS-enabled) endpoint to check automatically.

// Field set follows the standard carrier-compliant international address
// shape (UPU S42 / FedEx / UPS / DHL): a single recipient_name rather than
// separate company/first/last name, address_line_1-3, city, an optional
// state_province (most countries don't have one), postal_code, and a
// 2-letter country_code — plus email (required here, not in the carrier
// schema) and optional VAT/EORI on every address, not just billing.
export const REQUIRED_ADDRESS_FIELDS = [
  "recipientName", "addressLine1", "city", "postalCode", "countryCode", "email"
];

// Quantity split: shipping address #1 always gets whatever's left after
// every additional address's qty is subtracted from the total pressed.
// Recomputed fresh from (total, extras) rather than mutated in place, so
// it stays correct through add / edit / remove alike.
export function parseQuantity(value){
  const raw = String(value ?? "").trim();
  if(!/^\d+$/.test(raw)) return null;
  const quantity = Number(raw);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

export function allocateQuantities(total, extraQtys){
  let invalidQuantity = false;
  const read = value => {
    if(String(value ?? "").trim() === "") return 0;
    const quantity = parseQuantity(value);
    if(quantity !== null) return quantity;
    invalidQuantity = true;
    return 0;
  };
  const totalNum = read(total);
  const extras = extraQtys.map(read);
  const extraSum = extras.reduce((a, b) => a + b, 0);
  return {
    firstQty: totalNum - extraSum,
    overAllocated: invalidQuantity || extraSum > totalNum,
    invalidQuantity
  };
}

export function missingAddressFields(addr){
  return REQUIRED_ADDRESS_FIELDS.filter(key => !String(addr[key] || "").trim());
}

export function emailFormatValid(raw){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw || "").trim());
}

// E.164-ish: country code + subscriber number, punctuation stripped first
// since that's how phone numbers are actually typed (spaces, dashes,
// parens). This is the standard shipping-label phone format (UPS/FedEx
// forms require it in +<countrycode><number> shape).
export function phoneFormatValid(raw){
  const cleaned = String(raw || "").replace(/[\s\-().]/g, "");
  return /^\+?[1-9]\d{6,14}$/.test(cleaned);
}

// Generic EU VAT ID shape: 2-letter country prefix + 2-13 alphanumerics.
export function vatIdFormatValid(raw){
  const cleaned = String(raw || "").replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(cleaned);
}

// EORI shape: 2-letter country prefix + up to 15 alphanumerics.
export function eoriFormatValid(raw){
  const cleaned = String(raw || "").replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{1,15}$/.test(cleaned);
}
