// Plant view HTML around the jobs: the nav (the jobs tree — the
// overview — and the open job's section links), the overview's main
// (what needs attention) and a zip or folder in the inbox. Pure, like
// plant-overview.js: every value is escaped here.

import { escapeHtml, stageLabel, SECTIONS, listTable } from "./plant-overview.js";

const jobLink = job => `#/job/${encodeURIComponent(job)}`;

// A stage's own name: "10_ORDERS/20_PRESS" → "PRESS".
const ownName = stage => stage.split("/").at(-1).replace(/^\d\d_/, "");

// Stages that only group sub-stages (10_ORDERS); no job belongs in them.
const groupingStages = stages => stages.filter(s => stages.some(t => t.stage.startsWith(s.stage + "/")));

// board: /api/board; openJob: the job shown, or null. Sub-stages nest
// under their grouping stage, which lists no jobs of its own (one put
// there by hand is on the overview's list, linked).
export function renderNav({stages, inbox}, openJob){
  const grouping = new Set(groupingStages(stages).map(s => s.stage));
  const jobItem = job => {
    const text = job.error ? `${escapeHtml(job.job)} (unreadable)`
      : escapeHtml([job.catalogue || job.job, job.title].filter(Boolean).join(" — "));
    return job.job === openJob
      ? `<li><a href="${jobLink(job.job)}" aria-current="page"><b>${text}</b></a></li>`
      : `<li><a href="${jobLink(job.job)}">${text}</a></li>`;
  };
  const stageItem = ({stage, jobs}) => {
    if(grouping.has(stage)){
      return `<li>${escapeHtml(ownName(stage))}<ul>`
        + stages.filter(s => s.stage.startsWith(stage + "/")).map(stageItem).join("") + `</ul></li>`;
    }
    const received = stage === "00_INBOX" ? inbox.map(item => `<li><a href="#/inbox/${encodeURIComponent(item)}">`
      + `${escapeHtml(item)}</a> (new ${/\.zip$/i.test(item) ? "zip" : "folder"})</li>`) : [];
    const items = received.concat(jobs.map(jobItem));
    return `<li>${escapeHtml(ownName(stage))} (${items.length})${items.length ? `<ul>${items.join("")}</ul>` : ""}</li>`;
  };
  let html = `<p><a href="#/board">Board</a></p><h2>Jobs</h2><ul>${stages.filter(s => !s.stage.includes("/")).map(stageItem).join("")}</ul>`;
  if(openJob){
    html += `<h2>Sections</h2><ul>` + SECTIONS.map(([id, title]) =>
      `<li><a href="${jobLink(openJob)}/${id}">${escapeHtml(title)}</a></li>`).join("") + `</ul>`;
  }
  return html;
}

// The overview's main: what needs attention — problems the server found,
// jobs put by hand into a grouping stage (linked: the nav doesn't list
// them), and how many items wait in the inbox. The jobs are in the nav.
export function renderHome({stages, inbox, problems}){
  const items = problems.map(p => `<li>${escapeHtml(p)}</li>`).concat(groupingStages(stages).flatMap(({stage, jobs}) =>
    jobs.map(job => `<li><a href="${jobLink(job.job)}">${escapeHtml(job.job)}</a> is in ${escapeHtml(stage)}`
      + ` — move it to one of its sub-stages</li>`)));
  return `<h2>Attention</h2>` + (items.length ? `<ul>${items.join("")}</ul>` : "<p>Nothing needs attention.</p>")
    + `<p>${inbox.length} new in the inbox.</p>`;
}

// A zip or folder in the inbox: what it holds, and per job with the same
// catalogue number what a merge would copy in (mergeResend's plan).
export function renderInbox(item, info, plans){
  const p = info.project;
  let html = `<h2>Received</h2>` + listTable(["Item", "Catalogue #", "Title", "Artist", "Files"],
    [[escapeHtml(item), escapeHtml(p.catalogue), escapeHtml(p.albumTitle), escapeHtml(p.albumArtist), String(info.files.length)]]);
  html += plans.map(({job, stage, changed}) => `<h2>Resend of ${escapeHtml(job)} (${escapeHtml(stageLabel(stage))})</h2>`
    + (changed.length ? `<ul>${changed.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
      : "<p>No file changes; form fields are taken over.</p>")
    + `<p><button type="button" class="merge" data-job="${escapeHtml(job)}">Merge</button></p>`).join("");
  return html + `<h2>New job ${escapeHtml(info.job)}</h2><p><button type="button" id="accept">Accept as new job</button></p>`;
}

// The board: a row per job, a column per production line with where it
// stands. rows: [{job, catalogue, title, states: {[line]: lineState()}}].
export function renderBoard(rows, lineNames){
  const cell = s => !s ? "" : s.done ? "✓" : s.waiting ? "waiting" : s.checking ? "not checked" : escapeHtml(s.step);
  return `<h2>Board</h2>` + listTable(["Job", ...lineNames], rows.map(r => [
    `<a href="${jobLink(r.job)}">${escapeHtml([r.catalogue || r.job, r.title].filter(Boolean).join(" — "))}</a>`,
    ...lineNames.map(n => cell(r.states[n]))]));
}
