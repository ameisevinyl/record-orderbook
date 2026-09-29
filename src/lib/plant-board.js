// Plant view HTML for the jobs tree: the board (stage folders as
// columns), a job's stage bar and file versions, and a zip waiting in
// the inbox. Pure, like plant-overview.js: every value is escaped here.

import { escapeHtml } from "./plant-overview.js";

// "10_ORDERS/20_PRESS" → "ORDERS › PRESS"
export function stageLabel(stage){
  return stage.split("/").map(part => part.replace(/^\d\d_/, "")).join(" › ");
}

const jobLink = job => `#/job/${encodeURIComponent(job)}`;

// A parent stage whose sub-stages hold the jobs (10_ORDERS) shows only
// when a job sits in it directly.
export function renderBoard({stages, inbox, problems}){
  const parents = new Set(stages.map(s => s.stage.split("/")[0]).filter((p, i, all) => all.indexOf(p) !== i));
  const columns = stages.filter(s => s.jobs.length || !parents.has(s.stage)).map(({stage, jobs}) => {
    const zips = stage === "00_INBOX" ? inbox.map(zip =>
      `<li><a href="#/inbox/${encodeURIComponent(zip)}">${escapeHtml(zip)}</a> <span class="ident">new zip</span></li>`) : [];
    const cards = jobs.map(job => `<li><a href="${jobLink(job.job)}">`
      + (job.error ? `${escapeHtml(job.job)}</a> <span class="missing">${escapeHtml(job.error)}</span>`
        : `<b>${escapeHtml(job.catalogue || job.job)}</b></a> ${escapeHtml([job.title, job.artist].filter(Boolean).join(" — "))}`)
      + `</li>`);
    const items = zips.concat(cards);
    return `<section class="column"><h2>${escapeHtml(stageLabel(stage))} <span class="ident">${items.length}</span></h2>`
      + (items.length ? `<ul>${items.join("")}</ul>` : "<p>—</p>") + `</section>`;
  });
  const warn = problems.length ? `<ul class="gaps">${problems.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>` : "";
  return warn + `<div class="board">${columns.join("")}</div>`;
}

// Stage, a move select and the zip download for the job view.
export function renderJobBar(job, stage, stages){
  const options = stages.map(s => `<option value="${escapeHtml(s)}"${s === stage ? " selected" : ""}>${escapeHtml(stageLabel(s))}</option>`);
  return `<p class="jobbar"><a href="#/">← Board</a> · <b>${escapeHtml(stageLabel(stage))}</b> · `
    + `move to <select id="moveTo">${options.join("")}</select> <button type="button" id="move">Move</button> · `
    + `<a href="/api/zip?job=${encodeURIComponent(job)}" download>Download zip</a></p>`;
}

// jobFiles() result: per slot its current file and other versions (a
// newer one can be made current); unassigned files get a slot select.
export function renderFiles({slots, unassigned}){
  const slotOptions = slots.map((slot, i) => `<option value="${i}">${escapeHtml(slot.title)}</option>`).join("");
  const use = (name, slot) => `<button type="button" class="use" data-file="${escapeHtml(name)}" data-slot="${slot}">use</button>`;
  let body = `<table><tr><th>Slot</th><th>File</th><th>Other versions</th></tr>`
    + slots.map((slot, i) => `<tr><td>${escapeHtml(slot.title)}</td><td class="ident">${escapeHtml(slot.name)}`
      + (slot.present ? "" : ` <span class="missing">missing</span>`) + `</td><td>`
      + slot.others.map(o => `<span class="ident">${escapeHtml(o.name)}</span>`
        + (o.newer ? ` <b>newer</b> ${use(o.name, i)}` : "")).join("<br>")
      + `</td></tr>`).join("") + `</table>`;
  if(unassigned.length){
    body += `<h3>Not assigned</h3><table>` + unassigned.map(name =>
      `<tr><td class="ident">${escapeHtml(name)}</td><td>for <select class="slot">${slotOptions}</select> `
      + `<button type="button" class="use" data-file="${escapeHtml(name)}">use</button></td></tr>`).join("") + `</table>`;
  }
  return `<section><h2>Files</h2>${body}</section>`;
}

// A zip in the inbox: its release, and per job with the same catalogue
// number what a merge would copy in (mergeResend's plan).
export function renderInbox(zip, info, plans){
  const p = info.project;
  let body = `<p><a href="#/">← Board</a></p><h2>${escapeHtml(zip)}</h2>`
    + `<p><b>${escapeHtml(p.catalogue)}</b> ${escapeHtml([p.albumTitle, p.albumArtist].filter(Boolean).join(" — "))}`
    + ` · ${info.files.length} files</p>`;
  body += plans.map(({job, stage, changed}) => `<section><h2>Resend of ${escapeHtml(job)} `
    + `<span class="ident">${escapeHtml(stageLabel(stage))}</span></h2>`
    + (changed.length ? `<ul>${changed.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : "<p>No file changes; form fields are taken over.</p>")
    + `<button type="button" class="merge" data-job="${escapeHtml(job)}">Merge into ${escapeHtml(job)}</button></section>`).join("");
  return body + `<section><h2>New job ${escapeHtml(info.job)}</h2>`
    + `<button type="button" id="accept">Accept as new job</button></section>`;
}
