// The plant view's board: a kanban of lanes (CONFIG.board), the orders as
// cards in the lanes where they have work open. Pure, like plant-board.js:
// every value is escaped here.

import { prepareProject } from "./project.js";
import { lineState } from "./lines.js";
import { escapeHtml } from "./plant-overview.js";
import { orderUrl } from "./staff-mode.js";

// The archive holds zips (plant/archive.py), not jobs: its own view.
const INBOX = "00_INBOX", ARCHIVE = "99_ARCHIVE";

// An order has work open in a lane: the line is on the order, not done, and
// not held up by an earlier one.
export const laneOpen = s => s.needed && !s.done && !s.waiting;

// The stages that can hold jobs: not a grouping stage (ORDERS), not the archive.
function shownStages(board){
  const grouping = new Set(board.stages.filter(s => board.stages.some(t => t.stage.startsWith(s.stage + "/"))).map(s => s.stage));
  return board.stages.filter(s => !grouping.has(s.stage) && s.stage !== ARCHIVE);
}

// The quote is a file in the job's folder (the board carries the file list).
const hasQuote = card => (card.files || []).some(f => f.name === "price_quote.json");

const cardOf = (card, extra = {}) => ({name: card.catalogue || card.job, href: orderUrl(card.job),
  title: [card.catalogue || card.job, card.title, card.artist].filter(Boolean).join(" — "), cls: "", ...extra});

// board: /api/board. Returns {columns, unreadable}: per CONFIG.board column
// its lanes with their cards ({name, href, title, cls}), and the jobs the
// server couldn't read or the page refuses ({job, text}).
export function placeCards(board, config){
  const names = Object.keys(config.lines);
  const open = new Map();
  const through = [];
  const unreadable = [];
  for(const {stage, jobs} of shownStages(board)){
    for(const card of jobs){
      if(card.error){
        unreadable.push({job: card.job, text: card.error});
        continue;
      }
      // Only orders in production have lanes; the others are in their stage's column.
      if(!stage.includes("/")) continue;
      let lanes;
      try{
        const project = prepareProject(card.project, config);
        // A job nobody opened has no check results yet.
        const results = Object.keys(card.artwork || {}).length ? card.artwork : null;
        lanes = names.filter(n => laneOpen(lineState(project, config, n, results)));
      }catch(error){
        unreadable.push({job: card.job, text: error.message});
        continue;
      }
      if(!lanes.length) through.push(card);
      for(const n of lanes) open.set(n, [...(open.get(n) || []), cardOf(card)]);
    }
  }
  const columns = config.board.map(column => {
    if(column.lines){
      return {title: column.title, single: false,
        lanes: column.lines.map(n => ({title: config.lines[n].title || n, cards: open.get(n) || []}))};
    }
    const cards = shownStages(board).filter(s => s.stage === column.stage).flatMap(s => s.jobs)
      .filter(card => !card.error && (column.quote === undefined || hasQuote(card) === column.quote)).map(card => cardOf(card));
    if(column.stage === INBOX && column.quote !== true){
      for(const item of board.inbox || []) {
        cards.push({name: item, href: `#/inbox/${encodeURIComponent(item)}`, title: "received, not yet an order", cls: " new"});
      }
    }
    return {title: column.title, single: true, lanes: [{title: column.title, cards}]};
  });
  // Through every line but not moved yet: in the last stage column, marked.
  const last = columns.findLastIndex(c => c.single);
  if(last !== -1){
    columns[last].lanes[0].cards.push(...through.map(card => cardOf(card, {cls: " ready",
      title: `${card.catalogue || card.job} — all lines through, move to ${columns[last].title}`})));
  }
  return {columns, unreadable};
}

// The stats field: orders, and how many are in production (in a sub-stage
// of a grouping stage such as ORDERS). The counts per column are in the
// board's headers.
export function dashboardStats(board){
  const stages = shownStages(board);
  const total = stages.reduce((sum, s) => sum + s.jobs.length, 0);
  const production = stages.filter(s => s.stage.includes("/")).reduce((sum, s) => sum + s.jobs.length, 0);
  return `${total} order${total === 1 ? "" : "s"} · ${production} in production`;
}

const cardHtml = c => c ? `<a class="card${c.cls}" href="${escapeHtml(c.href)}" title="${escapeHtml(c.title)}">${escapeHtml(c.name)}</a>` : "";

// columns: placeCards().columns. Two header rows (a stage column spans both),
// each title with its count behind it: the cards of a lane, the orders of a
// group (one order can sit in several of its lanes). Then a row per card of
// the longest lane; the header stays on top (css).
export function renderBoard(columns){
  const lanes = columns.flatMap(c => c.lanes);
  const titled = (title, count) => escapeHtml(`${title} (${count})`);
  const orders = c => new Set(c.lanes.flatMap(l => l.cards.map(card => card.href))).size;
  const group = columns.map(c => c.single ? `<th scope="col" rowspan="2">${titled(c.title, c.lanes[0].cards.length)}</th>`
    : `<th scope="colgroup" colspan="${c.lanes.length}">${titled(c.title, orders(c))}</th>`).join("");
  const sub = columns.filter(c => !c.single).flatMap(c => c.lanes).map(l => `<th scope="col">${titled(l.title, l.cards.length)}</th>`).join("");
  const count = Math.max(1, ...lanes.map(l => l.cards.length));
  const rows = Array.from({length: count}, (_, i) => `<tr>${lanes.map(l => `<td>${cardHtml(l.cards[i])}</td>`).join("")}</tr>`).join("");
  return `<table class="board"><thead><tr>${group}</tr><tr>${sub}</tr></thead><tbody>${rows}</tbody></table>`;
}
