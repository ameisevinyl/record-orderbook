// The VAT treatment of a sale, for a plant in the EU, by the billing
// address and the customer's VAT ID. Pure. Standard rates and the usual
// cases only — no OSS destination rates, no per-shipment splits; the plant
// confirms the proposal (the quote can override it).

import { EU_COUNTRIES, vatIdCountry } from "./vat-rates.js";

export const VAT_CASES = ["domestic", "plus-vat", "reverse-charge", "export", "none"];

// plantRate: the plant's standard rate (%), null when unknown.
// vatIdStatus: valid | invalid | unchecked | none (what VIES said).
// Returns {case, rate, needsCheck}: needsCheck = a person should look
// before this goes out (an ID that isn't confirmed, no country, no rate).
export function vatCase({plantCountry, plantRate, billingCountry, vatId, vatIdStatus}){
  if(!EU_COUNTRIES.includes(plantCountry)) return {case: "none", rate: null, needsCheck: false};
  const charged = kind => ({case: kind, rate: plantRate, needsCheck: plantRate === null || plantRate === undefined});
  if(!billingCountry) return {...charged("plus-vat"), needsCheck: true};
  if(billingCountry === plantCountry) return charged("domestic");
  if(!EU_COUNTRIES.includes(billingCountry)) return {case: "export", rate: 0, needsCheck: false};

  // Another member state. Reverse charge needs a VAT ID that VIES found
  // valid, from a member state other than the plant's own.
  const idCountry = vatIdCountry(vatId);
  const hasId = String(vatId ?? "").trim() !== "";
  if(vatIdStatus === "valid" && EU_COUNTRIES.includes(idCountry) && idCountry !== plantCountry){
    return {case: "reverse-charge", rate: 0, needsCheck: false};
  }
  return {...charged("plus-vat"), needsCheck: hasId || plantRate === null || plantRate === undefined};
}

// The line the quote carries (and the customer reads) for a case.
export function vatNote(kind, rate){
  if(kind === "domestic" || kind === "plus-vat") return `plus ${rate} % VAT`;
  if(kind === "reverse-charge") return "no VAT — reverse charge, VAT due from the recipient";
  if(kind === "export") return "no VAT — export outside the EU";
  return "VAT not applied";
}
