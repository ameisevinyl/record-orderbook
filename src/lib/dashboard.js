// The plant view's dashboard: a row per order, a column per production line,
// grouped by stage. Pure, like plant-board.js: every value is escaped here.

import { prepareProject } from "./project.js";
import { lineState } from "./lines.js";
import { escapeHtml, stageLabel } from "./plant-overview.js";

// The archive holds zips (plant/archive.py), not jobs: its own view.
const ARCHIVE = "99_ARCHIVE";

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

// board: /api/board. Per stage that can hold jobs its rows; a card the
// server couldn't read, or a project the page refuses, is an error row.
export function dashboardRows(board, config){
  const names = Object.keys(config.lines);
  const grouping = new Set(board.stages.filter(s => board.stages.some(t => t.stage.startsWith(s.stage + "/"))).map(s => s.stage));
  return board.stages.filter(s => !grouping.has(s.stage) && s.stage !== ARCHIVE).map(({stage, jobs}) => ({stage, rows: jobs.map(card => {
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
  })}));
}

const cellHtml = c => `<td${c.cls ? ` class="${c.cls}"` : ""}${c.title ? ` title="${escapeHtml(c.title)}"` : ""}>${escapeHtml(c.text)}</td>`;

// The column presets: the current one bold, the others links (all = #/).
const viewLinks = (view, views) => `<p>Columns: ` + [["", "all"], ...views.map(v => [v, v])].map(([v, text]) =>
  v === view ? `<b>${escapeHtml(text)}</b>` : `<a href="${v ? `#/view/${v}` : "#/"}">${escapeHtml(text)}</a>`).join(" · ") + `</p>`;

// groups: dashboardRows(); lineNames: the columns (viewLines); view: the
// preset shown ("" = all); views: the presets' names.
export function renderDashboard(groups, lineNames, view, views){
  const shown = groups.filter(g => g.rows.length);
  const head = ["Order", ...lineNames].map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("");
  const body = shown.map(({stage, rows}) => `<tr class="stage"><th scope="rowgroup" colspan="${lineNames.length + 1}">`
    + `${escapeHtml(stageLabel(stage))} (${rows.length})</th></tr>`
    + rows.map(r => `<tr><td><a href="#/job/${encodeURIComponent(r.job)}">${escapeHtml(r.name)}</a></td>`
      + (r.error ? `<td colspan="${lineNames.length}" class="stop">${escapeHtml(r.error)}</td>`
        : lineNames.map(n => cellHtml(r.cells[n])).join("")) + `</tr>`).join("")).join("");
  return `<h2>Dashboard</h2>${viewLinks(view, views)}`
    + (shown.length ? `<table class="dashboard"><tr>${head}</tr>${body}</table>` : "<p>No orders.</p>");
}
