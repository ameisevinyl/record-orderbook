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

document.addEventListener("DOMContentLoaded", () => {
  initTracklist();
  initLabels();
  initCover();
  initInnerSleeve();
  initInlay();
  initVinylColor();
  initShippingBilling();
});
