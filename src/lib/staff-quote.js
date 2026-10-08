// The staff's Quote panel in the order view: the quote as it would be made
// now — every line, for staff only — and the VAT treatment with the
// customer's VAT ID. Pure; every value is escaped here. The page
// (src/staff.js) makes the state and handles the buttons.

import { escapeHtml, listTable } from "./plant-overview.js";
import { money } from "./pricing.js";
import { VAT_CASES } from "./vat-case.js";

const CASE_LABEL = {
  domestic: "domestic — plus VAT",
  "plus-vat": "EU private — plus VAT",
  "reverse-charge": "EU business — reverse charge",
  export: "outside the EU — no VAT",
  none: "no VAT logic"
};
const ID_STATUS = {valid: "valid on VIES", invalid: "not valid on VIES", unchecked: "not checked", none: "none given"};
const PER = {1000: " /1000", order: " flat"};

// s: {error} | {saved (the saved quote or null), built (buildPriceQuote's
// result), proposal (vatCase's), chosen ("" = as proposed), vatId ({id,
// status, name, checked}), billingCountry}.
export function renderQuotePanel(s){
  if(s.error) return `<p class="manual">${escapeHtml(s.error)}</p>`;
  const {saved, built, proposal, vatId} = s;
  let html = `<p>${saved ? `saved ${escapeHtml(saved.created)}: net ${escapeHtml(money(saved.net, saved.currency))}, valid until ${escapeHtml(saved.validUntil)}`
    : "not quoted yet"}</p>`;
  if(built.ok){
    const q = built.quote;
    html += listTable(["Item", "Qty", "Price", "Amount"], q.lines.map(l => [escapeHtml(l.name), escapeHtml(l.qty),
      escapeHtml(money(l.price, q.currency) + (PER[l.unit] || "")), escapeHtml(money(l.amount, q.currency))]));
    html += `<p>Net ${escapeHtml(money(q.net, q.currency))} · ${q.copies} copies · ${escapeHtml(money(q.perCopy, q.currency))} per copy</p>`;
  } else {
    html += `<p class="manual">can't be quoted: ${escapeHtml(built.reason)}${built.missing.length ? `: ${built.missing.map(escapeHtml).join(", ")}` : ""}</p>`;
  }

  const status = ID_STATUS[vatId.status] + (vatId.status === "valid" || vatId.status === "invalid"
    ? ` (${[vatId.name, vatId.checked].filter(Boolean).map(escapeHtml).join(", ")})` : "");
  const options = ['<option value="">as proposed</option>', ...VAT_CASES.map(kind =>
    `<option value="${kind}"${kind === s.chosen ? " selected" : ""}>${CASE_LABEL[kind]}</option>`)].join("");
  html += `<h3>VAT</h3><p>Billing country <b>${escapeHtml(s.billingCountry || "?")}</b> · VAT ID `
    + `${vatId.id ? `<b>${escapeHtml(vatId.id)}</b>: ${status}` : ID_STATUS.none}`
    + (vatId.id ? ` <button type="button" data-staff data-act="vatCheck">check on VIES</button>` : "") + `</p>`
    + `<p>proposed: ${CASE_LABEL[proposal.case]}${proposal.needsCheck ? " — check this" : ""}</p>`
    + `<p><label>Treatment <select data-staff data-act="vatCase">${options}</select></label></p>`;
  html += `<p><button type="button" data-staff data-act="saveQuote"${built.ok ? "" : " disabled"}>${saved ? "Update quote" : "Save quote"}</button></p>`;
  return html;
}

// Whether what a quote was built from (the order's and the pricelist's hashes
// when the page loaded) has changed since; "" if not, else why not to save.
export function staleReason(then, now){
  const changed = [then.projectHash !== now.projectHash && "order", then.listHash !== now.listHash && "pricelist"].filter(Boolean);
  return changed.length ? `the ${changed.join(" and the ")} changed since this page loaded — reload it` : "";
}
