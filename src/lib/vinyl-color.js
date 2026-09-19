// Pure vinyl-colour logic — no DOM. Builds the selectable colour list
// from CONFIG.vinylColor, and checks a quantity against that colour's
// configured minimum order.

function capitalize(s){
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Standard colour first, then the configurable basic-colours list, then
// "random" (mixed/recycled colour vinyl) last — it isn't a specific
// colour, so it doesn't belong in the editable list.
export function buildColorOptions(vinylColorConfig){
  const opts = [{ value: vinylColorConfig.standardColor, label: capitalize(vinylColorConfig.standardColor) }];
  vinylColorConfig.basicColors.forEach(c => opts.push({ value: c, label: capitalize(c) }));
  opts.push({ value: "random", label: "Random colour" });
  return opts;
}

// A blank/zero quantity isn't "below minimum" — it just means that
// colour row hasn't been filled in yet.
export function belowMinimum(color, qty, minOrderQty){
  const min = minOrderQty[color] || 0;
  const q = Number(qty) || 0;
  return q > 0 && q < min;
}
