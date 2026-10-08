// An order priced into a quote (price_quote.json): the order's input to
// quote(), the priced lines, the net, copies and price per copy, and the
// VAT treatment. Staff side; the customer's rows are in pricing.js. Pure.

import { quote as priceOrder } from "./quote.js";
import { parseQuantity } from "./shipping.js";
import { vatNote } from "./vat-case.js";

// The label products of CONFIG (printableParts.label.products), as the pricelist keys them.
const PRINTED_LABEL = "printed-cmyk", WHITE_LABEL = "whitelabel";

const cents = x => Math.round(x * 100) / 100;

// What quote() prices, from the project. Plating stays quote()'s default
// (1-step): the plant decides that, the order doesn't carry it.
export function orderFromProject(project){
  const sleeve = project.coverSleeve;
  const printed = ["A", "B"].some(side => !project.labels.sides[side].whitelabel);
  return {
    format: project.format,
    sides: project.sides.B.blank ? 1 : 2,
    colours: project.vinylColor.map(row => ({color: row.color, qty: parseQuantity(row.qty) || 0})),
    label: printed ? PRINTED_LABEL : WHITE_LABEL,
    innerSleeve: sleeve.innerSleeve.productId || "",
    outerCover: sleeve.cover.productId || "",
    inlay: sleeve.inlay.productId || "",
    referenceCut: !!project.proofs.referenceCut,
    testpress: project.proofs.testpresses
  };
}

// vat: {case, rate, vatId: {id, status, checked}} (vat-case.js, possibly
// overridden by staff). {ok: false, reason | missing} while it can't be priced.
export function buildPriceQuote({project, pricelist, config, today, vat}){
  const order = orderFromProject(project);
  const copies = order.colours.reduce((sum, c) => sum + c.qty, 0);
  if(!copies) return {ok: false, reason: "no quantity", missing: []};
  const result = priceOrder(order, pricelist, config);
  if(result.missing.length) return {ok: false, reason: "prices missing", missing: result.missing};
  const charged = vat.case === "domestic" || vat.case === "plus-vat";
  const amount = charged && vat.rate ? cents(result.net * vat.rate / 100) : 0;
  return {ok: true, quote: {
    version: 1, created: today, validUntil: pricelist.validUntil, currency: pricelist.currency,
    order, lines: result.lines, net: result.net, copies, perCopy: cents(result.net / copies),
    vat: {case: vat.case, rate: vat.rate, amount, gross: cents(result.net + amount), note: vatNote(vat.case, vat.rate), vatId: vat.vatId}
  }};
}
