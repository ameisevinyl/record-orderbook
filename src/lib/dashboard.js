// The plant view's dashboard: a row per order, a column per production line,
// grouped by stage. Pure, like plant-board.js: every value is escaped here.

import { prepareProject } from "./project.js";
import { lineState } from "./lines.js";
import { escapeHtml, stageLabel, ownName } from "./plant-overview.js";

// The archive holds zips (plant/archive.py), not jobs: its own view.
const INBOX = "00_INBOX", ARCHIVE = "99_ARCHIVE";

// A line's state as a cell: plain words; the alarm colour only for a step stopped by a check.
export function lineCell(s){
  if(!s || !s.needed) return {text: "", cls: "", title: ""};
  if(s.done) return {text: "✓", cls: "done", title: ""};
  if(s.waiting) return {text: "waiting", cls: "wait", title: ""};
  if(s.checking) return {text: "not checked", cls: "wait", title: ""};
  return {text: s.step, cls: s.why ? "stop" : "", title: s.why};
}

// The lines a preset shows (CONFIG.dashboardViews); anything else shows all.
export function viewLines(config, view){
  return Object.hasOwn(config.dashboardViews, view) ? config.dashboardViews[view] : Object.keys(config.lines);
}

// "#/view/<preset>" → the preset's name, "" for everything else (the full dashboard).
export function viewFromHash(hash, views){
  const [, name] = /^#\/view\/(\w+)$/.exec(hash) || [];
  return views.includes(name) ? name : "";
}

// The stages that can hold jobs: not a grouping stage (ORDERS), not the archive.
function shownStages(board){
  const grouping = new Set(board.stages.filter(s => board.stages.some(t => t.stage.startsWith(s.stage + "/"))).map(s => s.stage));
  return board.stages.filter(s => !grouping.has(s.stage) && s.stage !== ARCHIVE);
}

// board: /api/board. Per stage that can hold jobs its rows; a card the
// server couldn't read, or a project the page refuses, is an error row. The
// inbox ends with what came in and isn't a job yet (board.inbox).
export function dashboardRows(board, config){
  const names = Object.keys(config.lines);
  return shownStages(board).map(({stage, jobs}) => {
    const rows = jobs.map(card => {
      if(card.error) return {job: card.job, name: card.job, error: card.error, cells: {}};
      const name = [card.catalogue || card.job, card.title].filter(Boolean).join(" — ");
      try{
        const project = prepareProject(card.project, config);
        // A job nobody opened has no check results yet.
        const results = Object.keys(card.artwork || {}).length ? card.artwork : null;
        return {job: card.job, name, cells: Object.fromEntries(names.map(n => [n, lineCell(lineState(project, config, n, results))]))};
      }catch(error){
        return {job: card.job, name, error: error.message, cells: {}};
      }
    });
    if(stage === INBOX){
      for(const item of board.inbox || []) rows.push({received: item, name: item, note: /\.zip$/i.test(item) ? "new zip" : "new folder", cells: {}});
    }
    return {stage, rows};
  });
}

// The stats field: orders, how many are in production (in a sub-stage of a
// grouping stage such as ORDERS), per stage, and what came in unaccepted.
export function dashboardStats(board){
  const stages = shownStages(board);
  const total = stages.reduce((sum, s) => sum + s.jobs.length, 0);
  const production = stages.filter(s => s.stage.includes("/")).reduce((sum, s) => sum + s.jobs.length, 0);
  const received = (board.inbox || []).length;
  return [`${total} order${total === 1 ? "" : "s"}`, `${production} in production`,
    ...stages.map(s => `${ownName(s.stage)} ${s.jobs.length}`), ...(received ? [`${received} received`] : [])].join(" · ");
}

const cellHtml = c => `<td${c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${escapeHtml(c.title)}"` : ""}>${escapeHtml(c.text)}</td>`;

// groups: dashboardRows(); lineNames: the columns (viewLines). One table,
// every stage with its count, empty ones too; the header row stays on top
// (theme/structure css).
export function renderDashboard(groups, lineNames){
  const head = ["Order", ...lineNames].map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  const span = lineNames.length;
  const row = r => `<tr><td><a href="${r.received ? `#/inbox/${encodeURIComponent(r.received)}` : `#/job/${encodeURIComponent(r.job)}`}">`
    + `${escapeHtml(r.name)}</a></td>`
    + (r.error ? `<td colspan="${span}" class="stop">${escapeHtml(r.error)}</td>`
      : r.received ? `<td colspan="${span}" class="wait">${escapeHtml(r.note)} — not yet an order</td>`
      : lineNames.map(n => cellHtml(r.cells[n])).join("")) + `</tr>`;
  const body = groups.map(({stage, rows}) => `<tr class="stage"><th scope="rowgroup" colspan="${span + 1}">`
    + `${escapeHtml(stageLabel(stage))} (${rows.length})</th></tr>` + rows.map(row).join("")).join("");
  return `<table class="dashboard"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
