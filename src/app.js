// Entry point. For now there's one module (tracklist); as labels/covers/
// shipping modules are added, this becomes a thin router — e.g. reading
// a #tabs element, or simply importing and initializing each module that
// has matching DOM present on the page.

import { initTracklist } from "./modules/tracklist.js";
import { initLabels } from "./modules/labels.js";
import { initCoverSleeve } from "./modules/cover-sleeve.js";
import { initVinylColor } from "./modules/vinyl-color.js";
import { initShippingBilling } from "./modules/shipping-billing.js";

document.addEventListener("DOMContentLoaded", () => {
  initTracklist();
  initLabels();
  initCoverSleeve();
  initVinylColor();
  initShippingBilling();
});
