// Plant view page: send a project zip to plant/server.py (which unpacks
// it to disk), show completeness and the overview, then the audio and
// artwork checks run on disk, with a prelisten per audio file and a
// preview per artwork file.
import { CONFIG } from "../config.js";
import { prepareProject } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { audioFindings } from "../lib/audio-checks.js";
import { artworkSlots } from "../lib/artwork-checks.js";
import { getFormat } from "../lib/format-catalogue.js";
import { renderHeader, renderGaps, renderOverview, renderAudio, renderArtwork } from "../lib/plant-overview.js";

const input = document.getElementById("zipInput");
const out = document.getElementById("out");
const error = document.getElementById("error");
const status = document.getElementById("status");

// Uploads can take a while; only the most recent open may render.
let latestOpen = 0;

async function openZip(file){
  const openId = ++latestOpen;
  out.innerHTML = "";
  resetPlayer();
  error.textContent = "";
  let step = "open";
  try{
    busy(`Opening ${file.name}…`);
    // Header values must be ASCII; the server unquotes it.
    const headers = {"X-Filename": encodeURIComponent(file.name)};
    const res = await fetch("/api/open", {method: "POST", headers, body: file});
    if(!res.ok) throw new Error(await res.text());
    const {name, project: raw, files} = await res.json();
    if(openId !== latestOpen) return;
    const project = prepareProject(raw, CONFIG);
    out.innerHTML = renderHeader(name, project)
      + renderGaps(projectGaps(project, CONFIG, files))
      + '<div id="audio"></div><div id="artwork"></div>'
      + renderOverview(project, CONFIG, files);

    // The server's check output folder: the zip's name without ".zip".
    const base = `/work/${encodeURIComponent(file.name.replace(/\.zip$/i, "") + ".checks")}/`;

    step = "check the audio of";
    busy("Checking audio… 0 %");
    const audioRes = await fetch("/api/check/audio", {method: "POST", headers});
    if(!audioRes.ok) throw new Error(await audioRes.text());
    const facts = await readStream(audioRes, pct => {
      if(openId === latestOpen) busy(`Checking audio… ${pct} %`);
    });
    if(openId !== latestOpen) return;
    document.getElementById("audio").innerHTML =
      renderAudio(project, facts, audioFindings(project, facts, CONFIG), base);

    step = "check the artwork of";
    busy("Checking artwork…");
    const slots = artworkSlots(project, CONFIG);
    const artworkRes = await fetch("/api/check/artwork", {method: "POST",
      headers: {...headers, "Content-Type": "application/json"},
      body: JSON.stringify({artwork: Object.fromEntries(slots.map(s => [s.name, s.params]))})});
    if(!artworkRes.ok) throw new Error(await artworkRes.text());
    const artworkFacts = await artworkRes.json();
    if(openId !== latestOpen) return;
    document.getElementById("artwork").innerHTML =
      renderArtwork(slots, artworkFacts, getFormat(CONFIG, project.format).printCheck, base);
  }catch(err){
    if(openId === latestOpen) error.textContent = `Couldn't ${step} ${file.name}: ${err.message}`;
  }finally{
    if(openId === latestOpen) busy("");
  }
}

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

document.getElementById("btnLoad").addEventListener("click", ()=> input.click());
input.addEventListener("change", ()=>{
  const file = input.files[0];
  input.value = "";
  if(file) openZip(file);
});
