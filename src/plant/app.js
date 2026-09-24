// Plant view page: send a project zip to plant/server.py (which unpacks
// it to disk), then show completeness and the overview.
import { CONFIG } from "../config.js";
import { prepareProject } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { renderHeader, renderGaps, renderOverview } from "../lib/plant-overview.js";

const input = document.getElementById("zipInput");
const out = document.getElementById("out");
const error = document.getElementById("error");
const status = document.getElementById("status");

// Uploads can take a while; only the most recent open may render.
let latestOpen = 0;

async function openZip(file){
  const openId = ++latestOpen;
  out.innerHTML = "";
  error.textContent = "";
  status.textContent = `Opening ${file.name}…`;
  try{
    const res = await fetch("/api/open", {
      method: "POST",
      // Header values must be ASCII; the server unquotes it.
      headers: {"X-Filename": encodeURIComponent(file.name)},
      body: file
    });
    if(!res.ok) throw new Error(await res.text());
    const {name, project: raw, files} = await res.json();
    if(openId !== latestOpen) return;
    const project = prepareProject(raw, CONFIG);
    out.innerHTML = renderHeader(name, project)
      + renderGaps(projectGaps(project, CONFIG, files))
      + renderOverview(project, CONFIG, files);
  }catch(err){
    if(openId === latestOpen) error.textContent = `Couldn't open ${file.name}: ${err.message}`;
  }finally{
    if(openId === latestOpen) status.textContent = "";
  }
}

document.getElementById("btnLoad").addEventListener("click", ()=> input.click());
input.addEventListener("change", ()=>{
  const file = input.files[0];
  input.value = "";
  if(file) openZip(file);
});
