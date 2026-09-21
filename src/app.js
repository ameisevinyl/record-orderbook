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

// Safari's own PDF viewer renders artwork previews with an unremovable
// margin (see print-artwork module comments), which throws off the
// "simulate print" cutout overlay drawn on top of it — the overlay
// still matches the target trim size, but the artwork underneath no
// longer lines up with it. Only relevant once the checkbox is actually
// on, so the note tracks its checked state instead of always showing.
// Placed right after each artifact's own .labelwarnings list (below the
// preview), alongside the other artwork warnings, rather than next to
// the checkbox — that list's innerHTML gets fully rebuilt on every file
// pick/clear (see e.g. renderCoverWarnings), so a note living inside it
// wouldn't survive; each checkbox names its list via data-warnfor
// instead of relying on brittle DOM-structure guessing (labels.js's ids
// don't follow the same prefix pattern as cover/inner-sleeve/inlay's).
// Runs once, after every module has built its DOM (including labels.js's
// per-side checkboxes, generated at initLabels).
function warnSafariSimulatePrint(){
  if(!isSafari(navigator.userAgent)) return;
  document.querySelectorAll('input[id*="simprint"]').forEach(checkbox=>{
    const warningsList = document.getElementById(checkbox.dataset.warnfor);
    if(!warningsList) return;
    warningsList.insertAdjacentHTML("afterend",
      `<div class="safari-warn hidden">⚠ simulate print is unreliable in Safari — you'll get an accurate proof from us after upload</div>`);
    const warn = warningsList.nextElementSibling;
    const sync = () => warn.classList.toggle("hidden", !checkbox.checked);
    checkbox.addEventListener("change", sync);
    sync();
  });
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
  warnSafariSimulatePrint();
});
