// Plant view page: send a project zip to plant/server.py (which unpacks
// it to disk), show completeness and the overview, then the audio
// checks run on disk, with a prelisten per file.
import { CONFIG } from "../config.js";
import { prepareProject } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { audioFindings } from "../lib/audio-checks.js";
import { renderHeader, renderGaps, renderOverview, renderAudio } from "../lib/plant-overview.js";

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
    status.textContent = `Opening ${file.name}…`;
    // Header values must be ASCII; the server unquotes it.
    const headers = {"X-Filename": encodeURIComponent(file.name)};
    const res = await fetch("/api/open", {method: "POST", headers, body: file});
    if(!res.ok) throw new Error(await res.text());
    const {name, project: raw, files} = await res.json();
    if(openId !== latestOpen) return;
    const project = prepareProject(raw, CONFIG);
    out.innerHTML = renderHeader(name, project)
      + renderGaps(projectGaps(project, CONFIG, files))
      + '<div id="audio"></div>'
      + renderOverview(project, CONFIG, files);

    step = "check audio of";
    status.textContent = "Checking audio…";
    const checked = await fetch("/api/check", {method: "POST", headers});
    if(!checked.ok) throw new Error(await checked.text());
    const facts = await checked.json();
    if(openId !== latestOpen) return;
    // The server's check output folder: the zip's name without ".zip".
    const base = `/work/${encodeURIComponent(file.name.replace(/\.zip$/i, "") + ".checks")}/`;
    document.getElementById("audio").innerHTML =
      renderAudio(project, facts, audioFindings(project, facts, CONFIG), base);
  }catch(err){
    if(openId === latestOpen) error.textContent = `Couldn't ${step} ${file.name}: ${err.message}`;
  }finally{
    if(openId === latestOpen) status.textContent = "";
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
