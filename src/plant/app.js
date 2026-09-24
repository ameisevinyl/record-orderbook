// Plant view page: send a project zip to plant/server.py (which unpacks
// it to disk), then show completeness and the overview.
import { CONFIG } from "../config.js";
import { prepareProject } from "../lib/project.js";
import { projectGaps } from "../lib/completeness.js";
import { renderHeader, renderGaps, renderOverview } from "../lib/plant-overview.js";

const input = document.getElementById("zipInput");
const out = document.getElementById("out");
const error = document.getElementById("error");

async function openZip(file){
  out.innerHTML = "";
  error.textContent = "";
  try{
    const res = await fetch("/api/open", {
      method: "POST",
      // Header values must be ASCII; the server unquotes it.
      headers: {"X-Filename": encodeURIComponent(file.name)},
      body: file
    });
    if(!res.ok) throw new Error(await res.text());
    const {name, project: raw, files} = await res.json();
    const project = prepareProject(raw, CONFIG);
    out.innerHTML = renderHeader(name, project)
      + renderGaps(projectGaps(project, CONFIG, files))
      + renderOverview(project, CONFIG, files);
  }catch(err){
    error.textContent = `Couldn't open ${file.name}: ${err.message}`;
  }
}

document.getElementById("btnLoad").addEventListener("click", ()=> input.click());
input.addEventListener("change", ()=>{
  const file = input.files[0];
  input.value = "";
  if(file) openZip(file);
});
