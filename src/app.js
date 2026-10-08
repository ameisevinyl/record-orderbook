// Entry point and explicit module initialization order.

import { CONFIG } from "./config.js";
import { initTracklist } from "./modules/tracklist.js";
import { initLabels } from "./modules/labels.js";
import { initPrintedParts } from "./modules/printed-parts.js";
import { initVinylColor } from "./modules/vinyl-color.js";
import { initProofs } from "./modules/proofs.js";
import { initPricing } from "./modules/pricing.js";
import { initShippingBilling } from "./modules/shipping-billing.js";
import { validateConfig } from "./lib/config-validation.js";

// build/build.js overwrites this literal with the actual build timestamp
// when it produces dist/index.html — stays "dev" when running src/
// directly. Lets a customer/plant confirm in Safari (or anywhere) that
// the file they opened is the build they think it is: check the console,
// or add ?debug to the URL for an on-page banner.
const BUILD_STAMP = "dev";

function initDebugMode(){
  console.log("record-orderbook build:", BUILD_STAMP);
  if(!new URLSearchParams(location.search).has("debug")) return;
  const banner = document.createElement("div");
  banner.className = "debugbanner";
  banner.textContent = "build: " + BUILD_STAMP;
  document.body.append(banner);
}

document.addEventListener("DOMContentLoaded", () => {
  validateConfig(CONFIG);
  const refreshOrderStatus = initTracklist();
  initLabels(refreshOrderStatus);
  initPrintedParts(refreshOrderStatus);
  initVinylColor();
  initProofs(refreshOrderStatus);
  initPricing();
  initShippingBilling();
  refreshOrderStatus();
  initDebugMode();
});

// Print shows every panel; restore the folds afterwards.
let foldedPanels = [];
window.addEventListener("beforeprint", () => {
  foldedPanels = [...document.querySelectorAll("details.panel:not([open])")];
  foldedPanels.forEach(d => d.open = true);
});
window.addEventListener("afterprint", () => foldedPanels.forEach(d => d.open = false));

// A closed panel must not hide a warning: flag it from the warnings its
// modules already render. Observer-driven, so modules stay unaware.
const WARNING = "li.bad, tr.warn, tr.error, .filemeta.warn, .filemeta.compressed, .filemeta.underspec, .badge.danger, .badge.warn:not(:empty), .warn-qty";
let flagQueued = false;
function flagPanels(){
  flagQueued = false;
  document.querySelectorAll("details.panel").forEach(d => d.toggleAttribute("data-warn", !!d.querySelector(WARNING)));
}
new MutationObserver(() => {
  if(!flagQueued){ flagQueued = true; requestAnimationFrame(flagPanels); }
}).observe(document.querySelector(".sheet"), {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:["class"]});
flagPanels();
