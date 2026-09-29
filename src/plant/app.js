// Plant view page: the board of job folders (plant/server.py, jobs.py),
// a zip or folder in the inbox (new job or resend), and a job: stage, file
// versions, completeness, overview, then the audio and artwork checks —
// the server re-reads only files that changed, the rules here run on
// every load. Reloading the page reloads the job from disk.
import { CONFIG } from "../config.js";
import { prepareProject, setAt, historyEntry } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { audioFindings } from "../lib/audio-checks.js";
import { artworkSlots } from "../lib/artwork-checks.js";
import { getFormat } from "../lib/format-catalogue.js";
import { jobFiles, assignedName, mergeResend } from "../lib/versions.js";
import { renderHeader, renderGaps, renderOverview, renderAudio, renderArtwork } from "../lib/plant-overview.js";
import { renderBoard, renderJobBar, renderFiles, renderInbox } from "../lib/plant-board.js";

const zipInput = document.getElementById("zipInput");
const folderInput = document.getElementById("folderInput");
const out = document.getElementById("out");
const error = document.getElementById("error");
const status = document.getElementById("status");

// Loads can take a while; only the most recent view may render.
let latest = 0;
// What the shown view's buttons act on.
let view = null;
// Rescan: the next job load checks every file by its content.
let rescan = false;

// body: JSON to post, or {raw, headers} for an upload.
async function api(path, body){
  const res = await fetch(path, body === undefined ? {} : body.raw ? {method: "POST", ...body, body: body.raw}
    : {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res;
}
const getJson = async path => (await api(path)).json();
const postJson = async (path, body) => (await api(path, body)).json();

async function route(){
  const id = ++latest;
  out.innerHTML = "";
  view = null;
  resetPlayer();
  error.textContent = "";
  const [, kind, name] = /^#\/(job|inbox)\/(.+)$/.exec(location.hash) || [];
  try{
    if(kind === "job") await showJob(decodeURIComponent(name), id);
    else if(kind === "inbox") await showInbox(decodeURIComponent(name), id);
    else await showBoard(id);
  }catch(err){
    if(id === latest) error.textContent = err.message;
  }finally{
    if(id === latest) busy("");
  }
}

async function showBoard(id){
  busy("Reading the jobs…");
  const board = await getJson("/api/board");
  if(id === latest) out.innerHTML = renderBoard(board);
}

async function showInbox(item, id){
  busy(`Reading ${item}…`);
  const info = await getJson(`/api/inbox?item=${encodeURIComponent(item)}`);
  if(id !== latest) return;
  const plans = info.matches.map(m => ({job: m.job, stage: m.stage, basedOn: m.projectHash,
    ...mergeResend(m.project, m.files, info.project, info.files)}));
  view = {item, plans};
  out.innerHTML = renderInbox(item, info, plans);
}

async function showJob(job, id){
  busy(`Opening ${job}…`);
  const data = await getJson(`/api/job?job=${encodeURIComponent(job)}`);
  if(id !== latest) return;
  const project = prepareProject(data.project, CONFIG);
  const files = jobFiles(project, data.files);
  view = {job, raw: data.project, hash: data.projectHash, stamp: data.stamp,
    names: data.files.map(f => f.name), slots: files.slots};
  const full = rescan;
  rescan = false;
  out.innerHTML = renderJobBar(job, data.stage, data.stages)
    + renderHeader(job, project)
    + renderGaps(projectGaps(project, CONFIG, data.files))
    + renderFiles(files, data.files)
    + '<div id="audio"></div><div id="artwork"></div>'
    + renderOverview(project, CONFIG, data.files);

  // The job's check output folder, served by the server.
  const base = `/jobs/${encodeURIComponent(job)}/`;
  let step = "check the audio of";
  try{
    busy("Checking audio… 0 %");
    const audioRes = await api("/api/check/audio", {job, rescan: full});
    const facts = await readStream(audioRes, pct => {
      if(id === latest) busy(`Checking audio… ${pct} %`);
    });
    if(id !== latest) return;
    document.getElementById("audio").innerHTML =
      renderAudio(project, facts, audioFindings(project, facts, CONFIG), base);

    step = "check the artwork of";
    busy("Checking artwork…");
    const slots = artworkSlots(project, CONFIG);
    const artworkFacts = await postJson("/api/check/artwork",
      {job, rescan: full, artwork: Object.fromEntries(slots.map(s => [s.name, s.params]))});
    if(id !== latest) return;
    document.getElementById("artwork").innerHTML =
      renderArtwork(slots, artworkFacts, getFormat(CONFIG, project.format).printCheck, base);
  }catch(err){
    throw new Error(`Couldn't ${step} ${job}: ${err.message}`);
  }
}

// Buttons of the job and inbox views; each ends by reloading from disk.
// A 409 (someone changed the job meanwhile) shows its message; the next
// reload shows their change.
out.addEventListener("click", async e => {
  const button = e.target.closest(".use, #move, #rescan, .merge, #accept");
  if(!button || !view || status.classList.contains("busy")) return;
  error.textContent = "";
  if(button.id === "rescan"){
    rescan = true;
    return route();
  }
  try{
    busy("Saving…");
    if(button.id === "move"){
      await postJson("/api/move", {job: view.job, to: document.getElementById("moveTo").value});
    } else if(button.matches(".use")){
      const slot = view.slots[Number(button.dataset.slot ?? button.parentElement.querySelector(".slot").value)];
      const file = button.dataset.file;
      const newName = assignedName(slot.name, file, view.names);
      const project = structuredClone(view.raw);
      setAt(project, slot.path, newName);
      project.history = [...(project.history || []),
        historyEntry(`${slot.title}: ${newName}${newName === file ? "" : ` (was ${file})`}`, new Date())];
      await postJson("/api/assign", {job: view.job, file, newName, project, basedOn: view.hash});
    } else if(button.matches(".merge")){
      const plan = view.plans.find(p => p.job === button.dataset.job);
      await postJson("/api/merge", {item: view.item, job: plan.job, copies: plan.copies,
        project: plan.project, basedOn: plan.basedOn});
      location.hash = `#/job/${encodeURIComponent(plan.job)}`;
      return;
    } else {
      const {job} = await postJson("/api/accept", {item: view.item});
      location.hash = `#/job/${encodeURIComponent(job)}`;
      return;
    }
    await route();
  }catch(err){
    busy("");
    error.textContent = `Couldn't ${button.textContent.toLowerCase()}: ${err.message}`;
  }
});

// Status line; while it has text, a spinner shows the page is working.
function busy(text){
  status.textContent = text;
  status.classList.toggle("busy", !!text);
}

// The audio check streams one JSON object per line: {"progress": percent}
// while the files are read, then {"result": facts} or {"error": message}.
async function readStream(res, onProgress){
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for(;;){
    const {done, value} = await reader.read();
    buffer += value || "";
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for(const line of lines.filter(Boolean)){
      const msg = JSON.parse(line);
      if("progress" in msg) onProgress(msg.progress);
      else if(msg.error) throw new Error(msg.error);
      else return msg.result;
    }
    if(done) throw new Error("the check ended without a result");
  }
}

// Prelisten: one shared <audio>. A preview is fetched once as a blob, so
// seeking works although the server doesn't answer Range requests.
const player = new Audio();
let blobUrls = new Map();
let playing = null; // the .wave the player is loaded with

const playButton = wave => wave.closest(".audio-file").querySelector(".play");

function resetPlayer(){
  player.pause();
  player.removeAttribute("src");
  playing = null;
  blobUrls.forEach(url => URL.revokeObjectURL(url));
  blobUrls = new Map();
}

async function load(wave){
  if(wave === playing) return;
  let url = blobUrls.get(wave.dataset.src);
  if(!url){
    const res = await fetch(wave.dataset.src);
    if(!res.ok) throw new Error(`preview: ${res.status}`);
    url = URL.createObjectURL(await res.blob());
    blobUrls.set(wave.dataset.src, url);
  }
  player.pause();
  // The pause event arrives after the switch, so reset the old button here.
  if(playing) playButton(playing).textContent = "play";
  playing = wave;
  player.src = url;
  // Seek only once the duration is known.
  await new Promise((resolve, reject)=>{
    player.addEventListener("loadedmetadata", resolve, {once: true});
    player.addEventListener("error", ()=> reject(new Error("preview can't be played")), {once: true});
  });
}

// Click on a waveform: seek there and play. Play button: toggle.
out.addEventListener("click", async e => {
  const button = e.target.closest(".play");
  const wave = button ? button.closest(".audio-file").querySelector(".wave") : e.target.closest(".wave");
  if(!wave) return;
  try{
    await load(wave);
    if(!button){
      const rect = wave.getBoundingClientRect();
      player.currentTime = (e.clientX - rect.left) / rect.width * Number(wave.dataset.duration);
      await player.play();
    } else if(player.paused) await player.play();
    else player.pause();
  }catch(err){
    error.textContent = `Couldn't play: ${err.message}`;
  }
});

// "problem areas" checkbox: show or hide that file's overlay.
out.addEventListener("change", e => {
  if(!e.target.matches(".show-overlay")) return;
  e.target.closest(".art-file").querySelector(".overlay").hidden = !e.target.checked;
});

player.addEventListener("timeupdate", ()=>{
  if(playing) playing.querySelector(".played").style.width = `${player.currentTime / Number(playing.dataset.duration) * 100}%`;
});
for(const [event, text] of [["play", "pause"], ["pause", "play"]]){
  player.addEventListener(event, ()=>{ if(playing) playButton(playing).textContent = text; });
}

// Load: a zip, or a folder (e.g. one Safari unzipped), goes to the inbox
// like one synced in; the browser uploads a copy, the original stays.
async function upload(label, send){
  error.textContent = "";
  try{
    busy(`Uploading ${label}…`);
    location.hash = `#/inbox/${encodeURIComponent(await send())}`;
  }catch(err){
    busy("");
    error.textContent = `Couldn't upload ${label}: ${err.message}`;
  }
}

document.getElementById("btnLoad").addEventListener("click", ()=> zipInput.click());
zipInput.addEventListener("change", ()=>{
  const file = zipInput.files[0];
  zipInput.value = "";
  // Header values must be ASCII; the server unquotes them.
  if(file) upload(file.name, async ()=> (await (await api("/api/upload",
    {raw: file, headers: {"X-Filename": encodeURIComponent(file.name)}})).json()).item);
});

document.getElementById("btnLoadFolder").addEventListener("click", ()=> folderInput.click());
folderInput.addEventListener("change", ()=>{
  // Dot names (.DS_Store) are the machine's, not the project's.
  const files = [...folderInput.files].filter(f => !f.webkitRelativePath.split("/").some(part => part.startsWith(".")));
  folderInput.value = "";
  if(!files.length) return;
  const folder = files[0].webkitRelativePath.split("/")[0];
  upload(folder, async ()=>{
    for(const [i, file] of files.entries()){
      busy(`Uploading ${folder}… ${i + 1}/${files.length}`);
      await api("/api/upload/file", {raw: file, headers: {"X-Folder": encodeURIComponent(folder),
        "X-Path": encodeURIComponent(file.webkitRelativePath.split("/").slice(1).join("/"))}});
    }
    return (await postJson("/api/upload/done", {folder})).item;
  });
});

// While a job is open, any save on disk (a fix over a file, a new
// version, a hand edit of project.json) reloads and re-checks it.
setInterval(async ()=>{
  if(!view || !view.stamp || status.classList.contains("busy") || document.hidden) return;
  try{
    const {stamp} = await getJson(`/api/job/stamp?job=${encodeURIComponent(view.job)}`);
    if(view && view.stamp && stamp !== view.stamp) route();
  }catch{
    // gone or moved: the next click shows why
  }
}, 3000);

window.addEventListener("hashchange", route);
route();
