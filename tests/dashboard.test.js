import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { laneOpen, placeCards, dashboardStats, renderBoard } from "../src/lib/dashboard.js";

const hand = (step, extra = {}) => ({step, by: "staff", at: "t", files: {}, ...extra});
const labels = {A: {fileName: "x_labels_A_v1.pdf"}, B: {fileName: "x_labels_B_v1.pdf"}};
const white = {A: {whitelabel: true}, B: {whitelabel: true}};
const project = (catalogue, over = {}) => ({projectVersion: 1, format: "7", catalogue, labels: {sides: labels}, ...over});
const job = (name, p, extra = {}) => ({job: name, catalogue: p.catalogue, title: "", artist: "", project: p, artwork: {}, files: [], ...extra});
const stamper = {mastering: [hand("approve"), hand("back:cut")], plating: [hand("send:plater", {to: "external"}), hand("back:stampers")]};
const everything = {...stamper, press: [hand("approve"), hand("back:pressed")], pack: [hand("back:packed")],
  invoice: [hand("back:invoiced")], ship: [hand("back:shipped")]};

const board = {stages: [
  {stage: "00_INBOX", jobs: [job("XYZ001", project("XYZ001")), job("XYZ002", project("XYZ002"), {files: [{name: "price_quote.json"}]})]},
  {stage: "10_ORDERS", jobs: []},
  {stage: "10_ORDERS/10_PREPRESS", jobs: [
    job("KLM001", project("KLM001"), {title: "High <Riding>", artist: "The Band"}),
    {job: "bad", error: "project.json is not valid JSON"},
    job("Z", {projectVersion: 1, format: "99", catalogue: "Z"})]},
  {stage: "10_ORDERS/20_PRESS", jobs: [
    job("KLM003", project("KLM003", {labels: {sides: white}, plant: {lines: stamper}})),
    job("ALL001", project("ALL001", {labels: {sides: white}, plant: {lines: everything}})),
    job("TP001", project("TP001", {labels: {sides: white}, proofs: {testpresses: 3}, plant: {lines: stamper}}))]},
  {stage: "20_DONE", jobs: [job("FCK006", project("FCK006"))]},
  {stage: "99_ARCHIVE", jobs: []}
], inbox: ["r.zip", "Folder"]};

const cards = (columns, title) => columns.flatMap(c => c.lanes).find(l => l.title === title).cards.map(c => c.name);

test("a lane is open for an order that has the line, hasn't finished it and isn't held up", () => {
  assert.equal(laneOpen({needed: true, done: false, waiting: false}), true);
  assert.equal(laneOpen({needed: false, done: true, waiting: false}), false);
  assert.equal(laneOpen({needed: true, done: true, waiting: false}), false);
  assert.equal(laneOpen({needed: true, done: false, waiting: true}), false);
});

test("columns come from CONFIG.board: stage columns are single lanes, groups hold the lines' lanes", () => {
  const {columns} = placeCards(board, CONFIG);
  assert.deepEqual(columns.map(c => [c.title, c.single]), [["INBOX", true], ["QUOTES", true], ["PREPRESS", false], ["PRESS", false], ["DONE", true]]);
  assert.deepEqual(columns[2].lanes.map(l => l.title), ["MASTERING", "PLATING", "LABELS", "SLEEVES", "COVERS", "INLAYS"]);
  assert.deepEqual(columns[3].lanes.map(l => l.title), ["TESTPRESS", "PRESS", "PACK", "INVOICE", "SHIP"]);
});

test("cards: inbox and quotes by their stage folder and quote file, received items after the jobs", () => {
  const {columns} = placeCards(board, CONFIG);
  assert.deepEqual(cards(columns, "INBOX"), ["XYZ001", "r.zip", "Folder"]);
  assert.deepEqual(cards(columns, "QUOTES"), ["XYZ002"]);
  const received = columns[0].lanes[0].cards[1];
  assert.deepEqual([received.href, received.cls], ["#/inbox/r.zip", " new"]);
});

test("cards: a production order sits in every lane that is open for it; waiting lanes stay empty", () => {
  const {columns} = placeCards(board, CONFIG);
  // KLM001: printed labels nobody checked, nothing done: mastering, labels and the invoice are open.
  assert.deepEqual(["MASTERING", "PLATING", "LABELS", "SLEEVES", "PRESS", "PACK", "INVOICE", "SHIP"]
    .map(t => cards(columns, t).includes("KLM001")), [true, false, true, false, false, false, true, false]);
  // KLM003: whitelabel with the stampers done: pressing, and the invoice.
  assert.deepEqual(["MASTERING", "LABELS", "PRESS", "PACK", "INVOICE", "SHIP"].map(t => cards(columns, t).includes("KLM003")),
    [false, false, true, false, true, false]);
  assert.deepEqual(cards(columns, "INVOICE"), ["KLM001", "KLM003", "TP001"]);
  // TP001 asked for testpresses: they come before the press, which waits for their approval.
  assert.deepEqual([cards(columns, "TESTPRESS"), cards(columns, "PRESS")], [["TP001"], ["KLM003"]]);
  const klm = columns[2].lanes[0].cards[0];
  assert.deepEqual([klm.href, klm.title], ["/order/KLM001", "KLM001 — High <Riding> — The Band"]);
});

test("cards: an order through every line waits in the last stage column, after the ones moved there", () => {
  const {columns} = placeCards(board, CONFIG);
  assert.deepEqual(cards(columns, "DONE"), ["FCK006", "ALL001"]);
  const ready = columns[4].lanes[0].cards[1];
  assert.equal(ready.cls, " ready");
  assert.match(ready.title, /all lines through, move to DONE/);
  assert.ok(!["TESTPRESS", "PRESS", "PACK", "INVOICE", "SHIP"].some(t => cards(columns, t).includes("ALL001")));
});

test("unreadable: a job the server couldn't read or the page refuses is listed, not a card", () => {
  const {columns, unreadable} = placeCards(board, CONFIG);
  assert.deepEqual(unreadable.map(u => u.job), ["bad", "Z"]);
  assert.equal(unreadable[0].text, "project.json is not valid JSON");
  assert.match(unreadable[1].text, /Unknown format ID "99"/);
  assert.ok(!columns.flatMap(c => c.lanes).some(l => l.cards.some(c => c.name === "bad" || c.name === "Z")));
  assert.equal(placeCards({stages: board.stages.slice(0, 1)}, CONFIG).columns[0].lanes[0].cards.length, 1, "a board without inbox items");
});

test("render: two header rows (groups, lanes), a row per card of the longest lane, everything escaped", () => {
  const html = renderBoard(placeCards(board, CONFIG).columns);
  // The counters stand behind the titles: cards per lane, orders per group.
  assert.ok(html.includes('<thead><tr><th scope="col" rowspan="2">INBOX (3)</th><th scope="col" rowspan="2">QUOTES (1)</th>'
    + '<th scope="colgroup" colspan="6">PREPRESS (1)</th><th scope="colgroup" colspan="5">PRESS (3)</th><th scope="col" rowspan="2">DONE (2)</th></tr>'
    + '<tr><th scope="col">MASTERING (1)</th>'));
  assert.ok(html.includes('<th scope="col">SLEEVES (0)</th>') && html.includes('<th scope="col">INVOICE (3)</th>') && html.includes('<th scope="col">TESTPRESS (1)</th>'));
  assert.ok(html.includes('<a class="card" href="/order/KLM001" title="KLM001 — High &lt;Riding&gt; — The Band">KLM001</a>'));
  assert.ok(html.includes('<a class="card new" href="#/inbox/r.zip" title="received, not yet an order">r.zip</a>'));
  assert.equal(html.match(/<tr>/g).length - 2, 3, "three rows for the three cards of INBOX");
  assert.ok(html.includes("<td></td>"));
  const odd = renderBoard([{title: "X", single: true, lanes: [{title: "X", cards: [{name: "A<b>", href: "#/job/A%3Cb%3E", title: "t", cls: ""}]}]}]);
  assert.ok(odd.includes(">A&lt;b&gt;</a>"));
});

test("stats: orders and how many are in production (the stage counts are in the headers)", () => {
  assert.equal(dashboardStats(board), "9 orders · 6 in production");
  assert.equal(dashboardStats({stages: [{stage: "00_INBOX", jobs: [{job: "a"}]}], inbox: []}), "1 order · 0 in production");
});
