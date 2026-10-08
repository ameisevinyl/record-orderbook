// Plant view HTML around the jobs: what needs attention, the open job's
// section links, a zip or folder in the inbox, the archive. Pure, like
// plant-overview.js: every value is escaped here.

import { escapeHtml, stageLabel, SECTIONS, listTable, formatSize, when } from "./plant-overview.js";
import { productionTitle } from "./project.js";

const jobLink = job => `#/job/${encodeURIComponent(job)}`;

// Stages that only group sub-stages (10_ORDERS); no job belongs in them.
const groupingStages = stages => stages.filter(s => stages.some(t => t.stage.startsWith(s.stage + "/")));

// What needs a person's look: problems the server found, and jobs put by
// hand into a grouping stage (linked: the board doesn't list them), and
// the jobs that can't be read (placeCards' unreadable: {job, text}).
// Nothing to say gives "".
export function renderAttention({stages, problems}, unreadable = []){
  const items = problems.map(p => `<li>${escapeHtml(p)}</li>`).concat(groupingStages(stages).flatMap(({stage, jobs}) =>
    jobs.map(job => `<li><a href="${jobLink(job.job)}">${escapeHtml(job.job)}</a> is in ${escapeHtml(stage)}`
      + ` — move it to one of its sub-stages</li>`)),
    unreadable.map(({job, text}) => `<li><a href="${jobLink(job)}">${escapeHtml(job)}</a> can't be read: ${escapeHtml(text)}</li>`));
  return items.length ? `<ul>${items.join("")}</ul>` : "";
}

// The open job's section links, one row above its sections.
export function renderJobBar(job){
  return `<p class="jump">` + SECTIONS.map(([id, title]) =>
    `<a href="${jobLink(job)}/${id}">${escapeHtml(title)}</a>`).join(" · ") + `</p>`;
}

// A zip or folder in the inbox: what it holds, and per job with the same
// catalogue number what a merge would copy in (mergeResend's plan).
export function renderInbox(item, info, plans){
  const p = info.project;
  let html = `<h2>Received</h2>` + listTable(["Item", "Catalogue #", "Title", "Artist", "Files"],
    [[escapeHtml(item), escapeHtml(p.catalogue), escapeHtml(productionTitle(p)), escapeHtml(p.albumArtist), String(info.files.length)]]);
  html += plans.map(({job, stage, changed}) => `<h2>Resend of ${escapeHtml(job)} (${escapeHtml(stageLabel(stage))})</h2>`
    + (changed.length ? `<ul>${changed.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
      : "<p>No file changes; form fields are taken over.</p>")
    + `<p><button type="button" class="merge" data-job="${escapeHtml(job)}">Merge</button></p>`).join("");
  return html + `<h2>New job ${escapeHtml(info.job)}</h2><p><button type="button" id="accept">Accept as new job</button></p>`;
}

// The archive stage: the zips archive.py wrote (name, size, when).
export function renderArchive(items){
  return `<h2>Archive</h2>` + (items.length
    ? listTable(["Archived job", "Size", "Archived"], items.map(i => [escapeHtml(i.name.replace(/\.zip$/i, "")), formatSize(i.size), when(i.modified)]))
    : "<p>Nothing archived.</p>");
}
