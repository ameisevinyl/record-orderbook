// Quote: an order priced from the pricelist (see pricelist.js), net — the
// pricelist's `vat` is deliberately not read yet. Pure; the date comes in.
//
// order: { format, colours:[{color, qty}], innerSleeve, outerCover, inlay
//          (product ids, none/"" = nothing), extras:[ids], referenceCut, testpress:qty }
// Sleeve, cover, inlay and extras are priced for the whole pressed quantity.
// An unpriced or unknown item lands in `missing`, never as a silent 0.

const cents = x => Math.round(x * 100) / 100;

function colourClass(color, vinyl){
  return color === vinyl.standardColor ? "black" : color === "random" ? "random" : "colour";
}

// The tier with the highest `from` the quantity reaches; below the first, the first.
function tierFor(item, qty){
  return item.tiers.filter(t => t.from <= qty).pop() || item.tiers[0];
}

export function quote(order, pricelist, config, { discounts = [], date } = {}){
  const lines = [];
  const missing = [];
  const price = (key, qty) => {
    const item = pricelist.items[key];
    const tier = item && tierFor(item, qty);
    if(!tier || tier.price === null) return missing.push(key);
    const flat = item.unit === "order";
    lines.push({
      key, name: item.name, qty: flat ? 1 : qty, unit: item.unit, price: tier.price,
      amount: cents(flat ? tier.price : Math.max(item.min || 0, qty / item.unit * tier.price))
    });
  };

  const byClass = {};
  for(const { color, qty } of order.colours){
    const cls = colourClass(color, config.vinylColor);
    if(qty > 0) byClass[cls] = (byClass[cls] || 0) + qty;
  }
  const total = Object.values(byClass).reduce((a, b) => a + b, 0);
  for(const [cls, qty] of Object.entries(byClass)) price(`${order.format}/record/${cls}`, qty);
  if(!total) return { lines, subtotal: 0, discounts: [], net: 0, missing };

  for(const part of ["innerSleeve", "outerCover", "inlay"]){
    if(order[part] && order[part] !== "none") price(`${order.format}/${part}/${order[part]}`, total);
  }
  for(const id of order.extras || []) price(`${order.format}/extra/${id}`, total);
  if(order.referenceCut) price(`${order.format}/referenceCut`, 1);
  if(order.testpress > 0) price(`${order.format}/testpress`, order.testpress);

  const subtotal = cents(lines.reduce((sum, l) => sum + l.amount, 0));
  const applied = discounts.map(id => {
    const d = (pricelist.discounts || []).find(x => x.id === id);
    if(!d) throw new Error(`quote: unknown discount "${id}"`);
    if((d.from || d.to) && (!date || (d.from && date < d.from) || (d.to && date > d.to))){
      throw new Error(`quote: discount "${id}" is not valid on ${date}`);
    }
    return { id, label: d.label, percent: d.percent, amount: -cents(subtotal * d.percent / 100) };
  });
  const net = cents(subtotal + applied.reduce((sum, d) => sum + d.amount, 0));
  return { lines, subtotal, discounts: applied, net, missing };
}
