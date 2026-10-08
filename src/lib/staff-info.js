// What the staff's order view adds to the customer page: the bar above it,
// the plant's status list, the production lines. Pure; every value is
// escaped here.

import { escapeHtml, stageLabel, listTable } from "./plant-overview.js";

export function renderStaffBar(job, stage){
  return `<nav class="staffbar"><a href="/">← orderbook</a> · <b>${escapeHtml(job)}</b> · ${escapeHtml(stageLabel(stage))}`
    + ` · <a href="/#/job/${encodeURIComponent(job)}">files &amp; fixes</a> <span id="staffTask"></span></nav>`;
}

const VERDICT_WORDS = {review: "review", customer: "needs customer"};

// What is open: completeness gaps, audio findings, artwork that needs a look.
export function openItems({gaps, findings, artwork}){
  return [...gaps.map(g => `${g.group}: ${g.text}`), ...findings.map(f => `${f.group}: ${f.text}`),
    ...artwork.filter(a => a.verdict !== "ok").map(a => `${a.title}: ${VERDICT_WORDS[a.verdict]}`)];
}

// In the markup of the customer page's checklist (.checklist li.ok / li.bad).
export function renderStaffStatus(items){
  if(!items.length) return `<li class="ok"><span class="mark">✓</span>nothing open</li>`;
  return items.map(text => `<li class="bad"><span class="mark">!</span>${escapeHtml(text)}</li>`).join("");
}

// The order's production lines, read-only (states: lineState results).
export function renderLineStatus(states){
  const now = s => s.done ? "✓" : s.waiting ? "waiting" : s.checking ? "not checked" : s.step + (s.why ? ` — ${s.why}` : "");
  return `<h3>Production</h3>` + listTable(["Line", "Now"], states.filter(s => s.needed).map(s => [escapeHtml(s.line), escapeHtml(now(s))]));
}
