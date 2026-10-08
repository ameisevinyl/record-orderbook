// The staff's order view: the customer page (served at /order/<job> by
// plant/server.py) filled from the job folder, locked, with the plant's own
// checks where the browser's checks run for the customer, and what only the
// plant knows. It shows; it changes nothing.
import { CONFIG } from "./config.js";
import { prepareProject } from "./lib/project.js";
import { projectGaps } from "./lib/completeness.js";
import { sideAudio, audioFindings } from "./lib/audio-checks.js";
import { artworkSlots, artworkRows, artworkVerdict } from "./lib/artwork-checks.js";
import { getFormat } from "./lib/format-catalogue.js";
import { lineState } from "./lib/lines.js";
import { jobFiles } from "./lib/versions.js";
import { staffJob } from "./lib/staff-mode.js";
import { readStream } from "./lib/stream.js";
import { VERDICT, renderUnmanaged, renderHistory } from "./lib/plant-overview.js";
import { renderStaffBar, renderStaffStatus, openItems, renderLineStatus } from "./lib/staff-info.js";
import { applyProject, showAudioChecks } from "./modules/tracklist.js";
import { showLabelChecks } from "./modules/labels.js";
import { showPartChecks } from "./modules/printed-parts.js";

const job = staffJob();
const query = encodeURIComponent(job);

async function getJson(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path, body){
  const res = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res;
}

// What the page is doing, in the bar; an error stays there in red.
function task(text, error = false){
  const el = document.getElementById("staffTask");
  if(!el) return;
  el.textContent = text;
  el.classList.toggle("err", error);
}

// Every control but the folding stays off — also the ones the page makes later.
function lock(){
  for(const el of document.querySelectorAll(".sheet input, .sheet select, .sheet textarea, .sheet button")) el.disabled = true;
}

async function start(){
  document.body.classList.add("staff");
  const sheet = document.querySelector(".sheet");
  const data = await getJson(`/api/job?job=${query}`);
  sheet.insertAdjacentHTML("afterbegin", renderStaffBar(job, data.stage));
  const project = prepareProject(data.project, CONFIG);
  await applyProject(project, new Map());
  document.getElementById("stamp").textContent = job;

  // The page's own status list counts every file as missing (none is
  // attached): the plant's list takes its place.
  const status = document.getElementById("checklist");
  status.closest("section").querySelector("h2").textContent = "Status — plant checks";
  status.insertAdjacentHTML("afterend", '<ul class="checklist" id="staffChecklist"></ul>');
  const first = status.closest("section");
  first.insertAdjacentHTML("beforebegin", '<details class="panel" open><summary>Plant</summary><div id="staffPanel"></div></details>');
  lock();
  new MutationObserver(lock).observe(sheet, {childList: true, subtree: true});

  const files = jobFiles(project, data.files);
  const gaps = projectGaps(project, CONFIG, data.files);
  const printCheck = getFormat(CONFIG, project.format).printCheck;
  const checkable = artworkSlots(project, CONFIG);
  const audioNames = ["A", "B"].flatMap(side => sideAudio(project.sides[side], side).map(f => f.name));
  const draw = (artworkFacts, findings, artwork) => {
    const states = Object.keys(CONFIG.lines).map(name => lineState(project, CONFIG, name, artworkFacts));
    document.getElementById("staffPanel").innerHTML = renderLineStatus(states) + renderHistory(project) + renderUnmanaged(files);
    document.getElementById("staffChecklist").innerHTML = renderStaffStatus(openItems({gaps, findings, artwork}));
  };
  draw(null, [], []);

  try{
    const step = what => msg => task(`checking ${what}  ${msg.file || ""} ${msg.index || ""}/${msg.count || ""}`);
    task("checking audio");
    const audio = await readStream(await post("/api/check/audio", {job, rescan: false, files: audioNames}), step("audio"));
    showAudioChecks(audio);
    const findings = audioFindings(project, audio, CONFIG);
    draw(null, findings, []);

    task("checking artwork");
    const facts = await readStream(await post("/api/check/artwork",
      {job, rescan: false, artwork: Object.fromEntries(checkable.map(c => [c.name, c.params]))}), step("artwork"));
    const hits = new Map(), artwork = [];
    for(const c of checkable){
      const one = facts[c.name] || {error: "not checked"};
      const rows = artworkRows(one, c.params, printCheck);
      const verdict = artworkVerdict(rows);
      hits.set(c.name, {rows, preview: one.preview ? `/jobs/${query}/${encodeURIComponent(one.preview)}` : null, status: VERDICT[verdict]});
      artwork.push({title: c.title, verdict});
    }
    showLabelChecks(hits);
    showPartChecks(hits);
    draw(facts, findings, artwork);
    task("");
  }catch(error){
    task(`couldn't check: ${error.message}`, true);
  }
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

// The customer page's own init runs first (its listener is registered first).
document.addEventListener("DOMContentLoaded", () => {
  start().catch(error => {
    document.querySelector(".sheet").insertAdjacentHTML("afterbegin",
      `<nav class="staffbar"><a href="/">← orderbook</a> · <span class="err">${esc(job)} can't be shown: ${esc(error.message)}</span></nav>`);
  });
});
