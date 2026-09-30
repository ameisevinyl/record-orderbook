// Pure rules for the reference cut and testpress; no DOM.

// A testpress checks the pressing, and for a small run a reference cut
// is the better buy — the form says so, it doesn't block.
export function testpressNote(testpresses, totalQty, recommendedFromQty){
  if(!(testpresses > 0) || totalQty >= recommendedFromQty) return null;
  return `Testpresses are not recommended for small runs (<${recommendedFromQty}). If you want to check your mix and master, order a reference cut.`;
}
