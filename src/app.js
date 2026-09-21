// Entry point. For now there's one module (tracklist); as labels/covers/
// shipping modules are added, this becomes a thin router — e.g. reading
// a #tabs element, or simply importing and initializing each module that
// has matching DOM present on the page.

import { initTracklist } from "./modules/tracklist.js";
import { initLabels } from "./modules/labels.js";
import { initCover } from "./modules/cover.js";
import { initInnerSleeve } from "./modules/inner-sleeve.js";
import { initInlay } from "./modules/inlay.js";
import { initVinylColor } from "./modules/vinyl-color.js";
import { initShippingBilling } from "./modules/shipping-billing.js";

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
  initTracklist();
  initLabels();
  initCover();
  initInnerSleeve();
  initInlay();
  initVinylColor();
  initShippingBilling();
  initDebugMode();
});
