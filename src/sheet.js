// Shared by the staff editors (pricelist.html, plant-config.html).

import { menuHtml } from "./lib/menu.js";

export const $ = id => document.getElementById(id);
export const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function download(text, name, type){
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

// Served by the plant server, the editors work on the files on disk
// (/api/staff-file). Opened as a file, or from dist/ (GitHub Pages answers
// 404), there is no server: null, and the page keeps working on downloads.
export async function serverFile(name){
  try{
    const res = await fetch(`/api/staff-file?name=${name}`);
    return res.ok ? await res.json() : null;
  }catch{ return null; }
}

// The new hash; a refusal (409: changed on disk meanwhile) throws its message.
export async function saveServerFile(name, text, basedOn){
  const res = await fetch("/api/staff-file", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text, basedOn }) });
  if(!res.ok) throw new Error(await res.text());
  return (await res.json()).hash;
}

// The staff app's menu above the sheet, only where the server is.
export function installMenu(current){
  document.querySelector(".sheet").insertAdjacentHTML("afterbegin", `<nav id="menu">${menuHtml(current)}</nav>`);
}

// A file dropped anywhere on the page.
export function onDropFile(handler){
  document.addEventListener("dragover", e => { e.preventDefault(); document.body.classList.add("drag"); });
  document.addEventListener("dragleave", () => document.body.classList.remove("drag"));
  document.addEventListener("drop", async e => {
    e.preventDefault();
    document.body.classList.remove("drag");
    const file = e.dataTransfer.files[0];
    if(file) handler(await file.text(), file.name);
  });
}

// Arrow keys and Enter move between cells (Left/Right only once the caret is at
// the edge of the text); a cell entered that way is selected, so copy, cut and
// typing act on the whole value as in a spreadsheet. Pasting several values
// (tab/newline separated, e.g. from Excel) fills the cells from the current one.

const fieldIn = td => td && td.querySelector("input[type=text], input[type=checkbox], select");

// The next cell with a field from `el`, one row or one column away.
function neighbour(el, dRow, dCol){
  const td = el.closest("td, th"), tr = td.parentElement;
  if(dCol){
    for(let n = dCol > 0 ? td.nextElementSibling : td.previousElementSibling; n; n = dCol > 0 ? n.nextElementSibling : n.previousElementSibling){
      if(fieldIn(n)) return fieldIn(n);
    }
    return null;
  }
  const rows = [...tr.closest("table").rows];
  for(let i = rows.indexOf(tr) + dRow; rows[i]; i += dRow){
    if(fieldIn(rows[i].cells[td.cellIndex])) return fieldIn(rows[i].cells[td.cellIndex]);
  }
  return null;
}

function setCell(el, value){
  if(el.type === "checkbox") return;
  el.value = value.trim();
  if(el.tagName === "SELECT" && el.value !== value.trim()) return;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function installSheetKeys(){
  document.addEventListener("keydown", e => {
    const el = e.target;
    if(!el.matches || !el.matches("td input, th input, td select") || e.metaKey || e.ctrlKey || e.altKey) return;
    const text = el.type === "text", select = el.tagName === "SELECT";
    let to;
    if((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !select) to = neighbour(el, e.key === "ArrowDown" ? 1 : -1, 0);
    else if(e.key === "Enter" && !select) to = neighbour(el, e.shiftKey ? -1 : 1, 0);
    else if(e.key === "ArrowRight" && !e.shiftKey && !(text && el.selectionEnd !== el.value.length)) to = neighbour(el, 0, 1);
    else if(e.key === "ArrowLeft" && !e.shiftKey && !(text && el.selectionStart !== 0)) to = neighbour(el, 0, -1);
    else return;
    e.preventDefault();
    if(to){
      to.focus();
      if(to.select) to.select();
    }
  });

  document.addEventListener("paste", e => {
    const el = e.target;
    if(!el.matches || !el.matches("tbody td input[type=text], tbody td select")) return;
    const text = e.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n+$/, "");
    if(!/[\t\n]/.test(text)) return;   // one value: the browser pastes it
    e.preventDefault();
    let start = el;
    for(const line of text.split("\n")){
      for(let cell = start, i = 0, values = line.split("\t"); cell && i < values.length; cell = neighbour(cell, 0, 1), i++){
        setCell(cell, values[i]);
      }
      start = neighbour(start, 1, 0);
      if(!start) break;
    }
  });
}
