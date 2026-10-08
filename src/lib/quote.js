// Quote: an order priced from the pricelist (see pricelist.js), net — the
// pricelist's `vat` is deliberately not read yet. Pure.
//
// order: { format, sides (1|2), plating ("1step" default | "2step"),
//          colours:[{color, qty}], innerSleeve, outerCover, inlay
//          (product ids, none/"" = nothing), referenceCut, testpress:qty }
// Sleeve, cover and inlay are priced for the whole pressed quantity;
// mastering (lacquer cut and plating per side) and the pressing setup (once) are on top.
// An unpriced or unknown item lands in `missing`, never as a silent 0.

const cents = x => Math.round(x * 100) / 100;

function colourClass(color, vinyl){
  return color === vinyl.standardColor ? "black" : color === "random" ? "random" : "colour";
}

// The tier with the highest `from` the quantity reaches; below the first, the first.
function tierFor(item, qty){
  return item.tiers.filter(t => t.from <= qty).pop() || item.tiers[0];
}

export function quote(order, pricelist, config){
  const lines = [];
  const missing = [];
  const price = (key, qty) => {
    const item = pricelist.items[key];
    const tier = item && tierFor(item, qty);
    if(!tier || tier.price === null) return missing.push(key);
    const flat = item.unit === "order";
    lines.push({
      key, name: item.name, qty, unit: item.unit, price: tier.price,
      amount: cents(Math.max(item.min || 0, flat ? qty * tier.price : qty / item.unit * tier.price))
    });
  };

  const byClass = {};
  for(const { color, qty } of order.colours){
    const cls = colourClass(color, config.vinylColor);
    if(qty > 0) byClass[cls] = (byClass[cls] || 0) + qty;
  }
  const total = Object.values(byClass).reduce((a, b) => a + b, 0);
  if(!total) return { lines, net: 0, missing };

  // Prepress first, as in the pricelist.
  const platings = { "1step": "plating1", "2step": "plating2" };
  const plating = platings[order.plating || "1step"];
  if(![1, 2].includes(order.sides) || !plating) throw new Error("quote: sides must be 1 or 2, plating 1step or 2step");
  price(`${order.format}/mastering/lacquerCut`, order.sides);
  price(`${order.format}/mastering/${plating}`, order.sides);
  price(`${order.format}/record/setup`, 1);
  for(const [cls, qty] of Object.entries(byClass)) price(`${order.format}/record/${cls}`, qty);
  for(const part of ["innerSleeve", "outerCover", "inlay"]){
    if(order[part] && order[part] !== "none") price(`${order.format}/${part}/${order[part]}`, total);
  }
  if(order.referenceCut) price(`${order.format}/referenceCut`, 1);
  if(order.testpress > 0) price(`${order.format}/testpress`, order.testpress);

  return { lines, net: cents(lines.reduce((sum, l) => sum + l.amount, 0)), missing };
}
