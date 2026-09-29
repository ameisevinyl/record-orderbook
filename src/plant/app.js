// Plant view page: a two-column page — the jobs tree and the open job's
// section links in <nav>, the chosen view in <main> — under one CLI
// status line. Views: the overview (what needs attention), a zip or
// folder in the inbox (new job or resend), a job in five sections. A job
// is checked on every load (the server re-reads only changed files, the
// rules here always run), then its spectrograms are made in the
// background.
import { CONFIG } from "../config.js";
import { prepareProject, setAt, historyEntry } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { audioFindings } from "../lib/audio-checks.js";
import { artworkSlots } from "../lib/artwork-checks.js";
import { getFormat } from "../lib/format-catalogue.js";
import { jobFiles, assignedName, mergeResend } from "../lib/versions.js";
import { renderBasic, renderArtwork, renderAudio, renderShipping, renderHistory } from "../lib/plant-overview.js";
import { renderNav, renderHome, renderInbox } from "../lib/plant-board.js";

const zipInput = document.getElementById("zipInput");
const folderInput = document.getElementById("folderInput");
const nav = document.getElementById("nav");
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

// --- Status line: what the page does, else what the server does in the
// background (spectrograms), else "idle"; a CLI spinner while anything
// runs. Text only.
const SPINNER = "|/-\\";
let task = "", background = "", spin = 0, spinner = null;

function show(){
  const text = task || background;
  if(text && !spinner) spinner = setInterval(show, 150);
  if(!text && spinner){
    clearInterval(spinner);
    spinner = null;
  }
  status.textContent = text ? `${text}  ${SPINNER[spin++ % SPINNER.length]}` : "idle";
}

function busy(text){
  task = text;
  show();
}

// One step of a check: "checking audio     A1.wav  2/3  47 %".
function stepText({step, file, index, count, progress}){
  return `${step.padEnd(18)}${file}  ${index}/${count}` + (progress === undefined ? "" : `  ${progress} %`);
}

// A check streams one JSON object per line: its steps, then
// {"result": …} or {"error": …}.
async function readStream(res, onStep){
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for(;;){
    const {done, value} = await reader.read();
    buffer += value || "";
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for(const line of lines.filter(Boolean)){
      const msg = JSON.parse(line);
      if("result" in msg) return msg.result;
      if(msg.error) throw new Error(msg.error);
      onStep(msg);
    }
    if(done) throw new Error("the check ended without a result");
  }
}

// --- Routes: #/ · #/inbox/<item> · #/job/<job>[/<section>]

function parseHash(){
  const [, kind, name, section] = /^#\/(job|inbox)\/([^/]+)(?:\/(\w+))?$/.exec(location.hash) || [];
  return {kind, name: name && decodeURIComponent(name), section};
}

function scrollToSection(section){
  const target = section && document.getElementById(section);
  if(target) target.scrollIntoView();
}

// reload false: a link click — a section link of the job already shown
// only scrolls, it doesn't load and check the job again.
async function route(reload = true){
  const {kind, name, section} = parseHash();
  if(!reload && kind === "job" && view && view.job === name){
    scrollToSection(section);
    return;
  }
  const id = ++latest;
  out.innerHTML = "";
  view = null;
  background = "";
  resetPlayer();
  error.textContent = "";
  try{
    busy("reading the jobs");
    const board = await getJson("/api/board");
    if(id !== latest) return;
    nav.innerHTML = renderNav(board, kind === "job" ? name : null);
    if(kind === "job") await showJob(name, section, id);
    else if(kind === "inbox") await showInbox(name, id);
    else out.innerHTML = renderHome(board);
  }catch(err){
    if(id === latest) error.textContent = err.message;
  }finally{
    if(id === latest) busy("");
  }
}

async function showInbox(item, id){
  busy(`reading ${item}`);
  const info = await getJson(`/api/inbox?item=${encodeURIComponent(item)}`);
  if(id !== latest) return;
  const plans = info.matches.map(m => ({job: m.job, stage: m.stage, basedOn: m.projectHash,
    ...mergeResend(m.project, m.files, info.project, info.files)}));
  view = {item, plans};
  out.innerHTML = renderInbox(item, info, plans);
}

async function showJob(job, section, id){
  busy(`opening ${job}`);
  const data = await getJson(`/api/job?job=${encodeURIComponent(job)}`);
  if(id !== latest) return;
  const project = prepareProject(data.project, CONFIG);
  const files = jobFiles(project, data.files);
  const gaps = projectGaps(project, CONFIG, data.files);
  const checkable = artworkSlots(project, CONFIG);
  const printCheck = getFormat(CONFIG, project.format).printCheck;
  // The job's check output and spectrum/ folder, served by the server.
  const base = `/jobs/${encodeURIComponent(job)}/`;
  view = {job, raw: data.project, hash: data.projectHash, stamp: data.stamp,
    names: data.files.map(f => f.name), slots: files.slots};
  const full = rescan;
  rescan = false;
  out.innerHTML = renderBasic(project, CONFIG, {job, stage: data.stage, stages: data.stages}, gaps)
    + renderArtwork(files, checkable, null, printCheck, base, gaps)
    + renderAudio(project, files, null, [], base, gaps)
    + renderShipping(project, gaps)
    + renderHistory(project);
  scrollToSection(section);
  const replace = (sectionId, html) => { document.getElementById(sectionId).outerHTML = html; };
  const onStep = msg => { if(id === latest && msg.step) busy(stepText(msg)); };
  let what = "check the audio of";
  try{
    busy("checking audio");
    const facts = await readStream(await api("/api/check/audio", {job, rescan: full}), onStep);
    if(id !== latest) return;
    replace("audio", renderAudio(project, files, facts, audioFindings(project, facts, CONFIG), base, gaps));

    what = "check the artwork of";
    busy("checking artwork");
    const artworkFacts = await readStream(await api("/api/check/artwork",
      {job, rescan: full, artwork: Object.fromEntries(checkable.map(s => [s.name, s.params]))}), onStep);
    if(id !== latest) return;
    replace("artwork", renderArtwork(files, checkable, artworkFacts, printCheck, base, gaps));
    // Last: the mastering engineer's spectrograms, in the background; the
    // change poll below shows their progress.
    await postJson("/api/spectrum", {job});
  }catch(err){
    throw new Error(`Couldn't ${what} ${job}: ${err.message}`);
  }
}

// Buttons of the job and inbox views; each ends by reloading from disk.
// A 409 (someone changed the job meanwhile) shows its message; the next
// reload shows their change.
out.addEventListener("click", async e => {
  const button = e.target.closest(".use, #move, #rescan, .merge, #accept");
  if(!button || !view || task) return;
  error.textContent = "";
  if(button.id === "rescan"){
    rescan = true;
    return route();
  }
  try{
    busy("saving");
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

// --- Prelisten: one shared <audio>. A preview is fetched once as a blob,
// so seeking works although the server doesn't answer Range requests.
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

// --- Load: a zip, or a folder (e.g. one Safari unzipped), goes to the
// inbox like one synced in; the browser uploads a copy, the original stays.
async function upload(label, send){
  error.textContent = "";
  try{
    busy(`uploading ${label}`);
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
      busy(`uploading ${folder}  ${i + 1}/${files.length}`);
      await api("/api/upload/file", {raw: file, headers: {"X-Folder": encodeURIComponent(folder),
        "X-Path": encodeURIComponent(file.webkitRelativePath.split("/").slice(1).join("/"))}});
    }
    return (await postJson("/api/upload/done", {folder})).item;
  });
});

// --- While a job is open: any save on disk (a fix over a file, a new
// version, a hand edit of project.json) reloads and re-checks it, and the
// background spectrum's progress goes to the status line.
setInterval(async ()=>{
  if(!view || !view.stamp || task || document.hidden) return;
  try{
    const {stamp, spectrum} = await getJson(`/api/job/stamp?job=${encodeURIComponent(view.job)}`);
    background = spectrum ? stepText({step: "plotting spectrum", ...spectrum}) : "";
    show();
    if(view && view.stamp && stamp !== view.stamp) route();
  }catch{
    // gone or moved: the next click shows why
  }
}, 3000);

window.addEventListener("hashchange", ()=> route(false));
route();
