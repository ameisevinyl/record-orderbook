// Pure helpers for src/plant.js (dist/plant.html only).

// Real user input while unlocked. Buttons count too: removing a track or
// a shipping address changes the order without any change event.
// loadProject's own synthetic events are untrusted and never count.
export function isPlantEdit(event, locked){
  if(locked || !event.isTrusted) return false;
  if(event.type === "input" || event.type === "change") return true;
  return event.type === "click" && !!event.target.closest("button");
}

// Toolbar identity from the loaded data, plus the zip it came from.
export function plantIdentity(project, zipName){
  const billing = (project.shippingBilling && project.shippingBilling.billing) || {};
  return [project.catalogue || "(no catalogue #)", billing.email || "(no email)", zipName].join(" · ");
}
