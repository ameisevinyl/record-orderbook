// Money, and the customer's view of a saved quote (price_quote.json): a
// complete net price, the price per copy and the VAT line — never a
// product line. Pure; the quote itself is made by price-quote.js.

export function money(amount, currency){
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  return `${amount < 0 ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents} ${currency}`;
}

// [label, value] rows, to be escaped by whoever shows them.
export function customerPricing(quote){
  const {vat, currency} = quote;
  const rows = [["Net price", money(quote.net, currency)], ["Net price per copy", money(quote.perCopy, currency)], ["VAT", vat.note]];
  if(vat.amount > 0) rows.push(["VAT amount", money(vat.amount, currency)], ["Total incl. VAT", money(vat.gross, currency)]);
  rows.push(["Valid until", quote.validUntil]);
  return rows;
}
