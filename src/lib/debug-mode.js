// Shared by app.js (the debug build-stamp banner) and every artwork
// module (gating the checklist's genuinely-ambiguous "not detected"
// rows) — one function instead of each declaring its own identically-
// named one, which would collide once build.js flattens every module
// into its single shared top-level scope (see its header comment).
export function isDebugMode(){
  return new URLSearchParams(location.search).has("debug");
}
