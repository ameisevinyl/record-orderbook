// Shared by app.js (the debug build-stamp banner) and every artwork
// module (gating the checklist's genuinely-ambiguous "not detected"
// rows) — one function instead of each declaring its own identically-
// named one, which would collide once build.js flattens every module
// into its single shared top-level scope (see its header comment).
// Set by build/build.js at the top of dist/plant.html only; the one
// declaration of the name, so the flattened bundle has no collision.
export const PLANT_VIEW = globalThis.PLANT_VIEW === true;

// Plant staff always see the plant-only checklist rows.
export function isDebugMode(){
  return PLANT_VIEW || new URLSearchParams(location.search).has("debug");
}
