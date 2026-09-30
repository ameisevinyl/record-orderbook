// Reference cut & testpress — a reference cut is one acetate (a
// checkbox), a testpress takes a quantity. Each shows only where the
// format offers it (CONFIG.formats[i].proofs). The soft note for a
// testpress on a small run follows the colour quantities.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { infoText, renderInfoIcon } from "../lib/info-text.js";
import { parseQuantity } from "../lib/shipping.js";
import { testpressNote } from "../lib/proofs.js";
import { getColorBreakdown, onColorChange } from "./vinyl-color.js";

let proofsOnStateChange = ()=>{};

function offeredProofs(){
  return getFormat(CONFIG, document.getElementById("format").value).proofs;
}

// null while ticked with an empty or invalid quantity, 0 when unticked.
function testpressCount(){
  if(!document.getElementById("testpress").checked) return 0;
  const qty = parseQuantity(document.getElementById("testpressQty").value);
  return qty > 0 ? qty : null;
}

function renderProofs(){
  const offered = offeredProofs();
  const referenceCut = document.getElementById("referenceCut");
  const testpress = document.getElementById("testpress");
  if(!offered.referenceCut) referenceCut.checked = false;
  if(!offered.testpress) testpress.checked = false;
  document.getElementById("referenceCutRow").classList.toggle("hidden", !offered.referenceCut);
  document.getElementById("testpressRow").classList.toggle("hidden", !offered.testpress);
  document.getElementById("proofsSection").classList.toggle("hidden", !offered.referenceCut && !offered.testpress);
  document.getElementById("testpressQty").classList.toggle("hidden", !testpress.checked);

  const total = getColorBreakdown().reduce((sum, c) => sum + c.qty, 0);
  const note = testpressNote(testpressCount() || 0, total, CONFIG.proofs.testpressRecommendedFromQty);
  const noteEl = document.getElementById("testpressNote");
  noteEl.textContent = note || "";
  noteEl.classList.toggle("hidden", !note);
}

export function initProofs(onStateChange = ()=>{}){
  proofsOnStateChange = onStateChange;
  document.getElementById("referenceCutInfo").innerHTML = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "referenceCut"));
  document.getElementById("testpressInfo").innerHTML = renderInfoIcon(infoText(CONFIG.infoText, CONFIG.locale, "testpress"));
  const changed = ()=>{ renderProofs(); proofsOnStateChange(); };
  document.getElementById("testpress").addEventListener("change", e=>{
    if(e.target.checked) document.getElementById("testpressQty").value = CONFIG.proofs.testpressDefaultQty;
    changed();
  });
  for(const id of ["referenceCut", "format"]) document.getElementById(id).addEventListener("change", changed);
  document.getElementById("testpressQty").addEventListener("input", changed);
  onColorChange(renderProofs);
  renderProofs();
}

// An invalid quantity is saved as 0 (none); proofIssues flags it first.
export function collectProofs(){
  return {
    referenceCut: document.getElementById("referenceCut").checked,
    testpresses: testpressCount() || 0
  };
}

export function applyProofs(data){
  const d = data || {};
  document.getElementById("referenceCut").checked = !!d.referenceCut;
  document.getElementById("testpress").checked = d.testpresses > 0;
  document.getElementById("testpressQty").value = d.testpresses > 0 ? d.testpresses : "";
  renderProofs();
  proofsOnStateChange();
}

export function proofIssues(){
  return testpressCount() === null ? ["Testpress ticked but no valid quantity"] : [];
}
