// Pure vinyl-colour logic — no DOM. Builds the selectable colour list
// from CONFIG.vinylColor, and checks a quantity against that colour's
// configured minimum order.

import { parseQuantity } from "./shipping.js";

function capitalize(s){
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "random" (mixed/recycled colour vinyl) isn't a specific colour, so it
// gets its own label rather than a capitalized "Random".
export function colorLabel(color){
  return color === "random" ? "Random colour" : capitalize(color);
}

// Standard colour first, then the configurable basic-colours list, then
// "random" last — it isn't a specific colour, so it doesn't belong in
// the editable list.
export function buildColorOptions(vinylColorConfig){
  const opts = [{ value: vinylColorConfig.standardColor, label: colorLabel(vinylColorConfig.standardColor) }];
  vinylColorConfig.basicColors.forEach(c => opts.push({ value: c, label: colorLabel(c) }));
  opts.push({ value: "random", label: colorLabel("random") });
  return opts;
}

// A blank/zero quantity isn't "below minimum" — it just means that
// colour row hasn't been filled in yet.
export function belowMinimum(color, qty, minOrderQty){
  const min = minOrderQty[color] || 0;
  if(String(qty ?? "").trim() === "") return false;
  const q = parseQuantity(qty);
  if(q === null) return true;
  return q > 0 && q < min;
}
