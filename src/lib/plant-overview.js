// The plant view's job page in six sections — Basic, Artwork, Audio,
// Shipping & billing, Unmanaged files, History — as plain HTML tables,
// each fact once: a file shows in its slot's row only, the catalogue
// number in Basic only. Pure: the page (src/plant/app.js) assigns the
// strings to innerHTML, so every value goes through escapeHtml here.

import { formatTime, parseTime } from "./time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { parseQuantity } from "./shipping.js";
import { sideTiming, ADDRESS_FIELD_LABELS } from "./completeness.js";
import { sideAudio } from "./audio-checks.js";
import { artworkRows, artworkVerdict } from "./artwork-checks.js";
import { CHECKLIST_ICON } from "./print-artwork.js";

export const SECTIONS = [["basic", "Basic"], ["artwork", "Artwork"], ["audio", "Audio"],
  ["shipping", "Shipping & billing"], ["unmanaged", "Unmanaged files"], ["history", "History"]];

export function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
}

// "10_ORDERS/20_PRESS" → "ORDERS › PRESS"
export function stageLabel(stage){
  return stage.split("/").map(part => part.replace(/^\d\d_/, "")).join(" › ");
}

// "2026-09-24T12:00:00.000Z" → "2026-09-24 12:00" (UTC, as stored)
const when = iso => escapeHtml((iso || "").slice(0, 16).replace("T", " "));

function section(id, body){
  const [, title] = SECTIONS.find(([key]) => key === id);
  return `<section id="${id}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

// pairs: [label, html]; html arrives escaped, empty values drop.
export function fieldTable(pairs){
  return `<table>${pairs.filter(([, html]) => html !== "")
    .map(([label, html]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${html}</td></tr>`).join("")}</table>`;
}

// head: column labels; rows: arrays of html cells.
export function listTable(head, rows){
  return `<table><tr>${head.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr>`
    + rows.map(cells => `<tr>${cells.map(c => `<td>${c}</td>`).join("")}</tr>`).join("") + `</table>`;
}

// The section a completeness gap (projectGaps) belongs to, by its group.
export function gapSection(group){
  if(group === "Release" || group === "Quantity") return "basic";
  if(group.startsWith("Side ")) return "audio";
  if(group === "Billing" || group.startsWith("Shipping")) return "shipping";
  return "artwork";
}

function listHtml(items){
  return items.length ? `<ul>${items.map(f => `<li>${escapeHtml(f.group)}: ${escapeHtml(f.text)}</li>`).join("")}</ul>` : "";
}

const gapsHtml = (gaps, id) => listHtml(gaps.filter(g => gapSection(g.group) === id));

// A slot's file: its name and time, or "missing" when not in the folder.
function fileCell(slot){
  if(!slot) return "";
  return escapeHtml(slot.name) + (slot.present ? ` (${when(slot.modified)})` : " — missing");
}

// A slot's other versions, each with "use" (newer ones marked).
function versionsCell(slot){
  if(!slot) return "";
  return slot.others.map(o => `${escapeHtml(o.name)}${o.newer ? " (newer)" : ""} `
    + `<button type="button" class="use" data-file="${escapeHtml(o.name)}" data-slot="${slot.index}">use</button>`).join("<br>");
}

// --- 1 Basic ---------------------------------------------------------

// place: {job, stage, stages} — the job's folder name, its stage and the
// stages it may move to.
export function renderBasic(project, config, place, gaps){
  const format = getFormat(config, project.format);
  const parts = format.printableParts || {};
  const productName = (category, id) => {
    const product = productById((parts[category] && parts[category].products) || [], id);
    return product ? product.name : "";
  };
  const {labels, coverSleeve: sleeve} = project;
  const products = [
    ["labels", ["A", "B"].map(s => `${s} ${labels.sides[s].whitelabel ? "whitelabel" : "printed"}`).join(", ")
      + (labels.bigCenter ? ", big hole" : "")],
    ["inner sleeve", productName("innerSleeve", sleeve.innerSleeve.productId)],
    ["cover", productName("outerCover", sleeve.cover.productId)],
    ["inlay", productName("inlay", sleeve.inlay.productId)]
  ].filter(([, name]) => name).map(([what, name]) => `${what}: ${escapeHtml(name)}`).join("<br>");
  const qty = project.vinylColor.filter(row => row.qty.trim());
  const total = qty.reduce((sum, row) => sum + (parseQuantity(row.qty) || 0), 0);
  const billing = project.shippingBilling.billing;
  const options = place.stages.map(s =>
    `<option value="${escapeHtml(s)}"${s === place.stage ? " selected" : ""}>${escapeHtml(stageLabel(s))}</option>`).join("");
  const last = project.history.at(-1);
  return section("basic", fieldTable([
    ["Catalogue #", escapeHtml(project.catalogue)],
    ["Title", escapeHtml(project.albumTitle)],
    ["Artist", escapeHtml(project.albumArtist)],
    ["Format", escapeHtml(format.label)],
    ["Quantity", qty.length ? qty.map(row => `${escapeHtml(row.qty)} ${escapeHtml(colorLabel(row.color))}`).join(", ")
      + ` — total ${total}` : ""],
    ["Customer", escapeHtml([billing.recipientName, billing.email].filter(v => v && v.trim()).join(", "))],
    ["Products", products],
    ...(project.proofs.referenceCut ? [["Reference cut", "yes"]] : []),
    ...(project.proofs.testpresses > 0 ? [["Testpresses", String(project.proofs.testpresses)]] : []),
    ["Stage", `${escapeHtml(stageLabel(place.stage))} <select id="moveTo">${options}</select> `
      + `<button type="button" id="move">Move</button> <button type="button" id="rescan">Rescan</button> `
      + `<a href="/api/zip?job=${encodeURIComponent(place.job)}" download>Download zip</a>`],
    // Date and who only: the note is in History.
    ["Last change", last ? `${when(last.savedAt)} ${escapeHtml(last.by)}` : ""]
  ]) + gapsHtml(gaps, "basic"));
}

// --- 2 Artwork -------------------------------------------------------

const VERDICT = {ok: "OK", review: "review", customer: "needs customer"};

// Trim and a label's center hole (dashed) and bleed (dotted) in page
// millimetres; the SVG stretches over the preview, so the lines sit
// where the cut and the punch will be. Each line lies on a white line
// of the same width, so it reads on dark and light designs alike.
function cutLinesSvg(page, trim, bleedMm, round, holeMm){
  const n = v => Math.round(v * 100) / 100;
  const cx = n(trim.x + trim.w / 2), cy = n(trim.y + trim.h / 2);
  const shape = grow => round
    ? `cx="${cx}" cy="${cy}" r="${n(trim.w / 2 + grow)}"`
    : `x="${n(trim.x - grow)}" y="${n(trim.y - grow)}" width="${n(trim.w + 2 * grow)}" height="${n(trim.h + 2 * grow)}"`;
  const tag = round ? "circle" : "rect";
  const line = (cls, el, attrs) => `<${el} class="under" ${attrs}/><${el} class="${cls}" ${attrs}/>`;
  return `<svg viewBox="0 0 ${n(page.w)} ${n(page.h)}" preserveAspectRatio="none">`
    + line("trim", tag, shape(0)) + line("bleed", tag, shape(bleedMm))
    + (holeMm ? line("hole", "circle", `cx="${cx}" cy="${cy}" r="${n(holeMm / 2)}"`) : "")
    + `</svg>`;
}

// A checked file: preview with cut lines and switchable problem areas,
// then the checklist.
function artFileHtml({title, params}, facts, printCheck, base){
  let body = `<h3>${escapeHtml(title)}</h3>`;
  if(facts.preview){
    const url = file => escapeHtml(base + encodeURIComponent(file));
    body += `<label><input type="checkbox" class="show-overlay"> problem areas</label>`
      + `<div class="art" style="aspect-ratio:${facts.pageMm.w} / ${facts.pageMm.h}">`
      + `<img src="${url(facts.preview)}" alt=""><img class="overlay" hidden src="${url(facts.overlay)}" alt="">`
      + cutLinesSvg(facts.pageMm, facts.trimRectMm, params.bleedMm, params.round, params.holeMm) + `</div>`;
  }
  const rows = artworkRows(facts, params, printCheck);
  return `<div class="art-file">${body}` + listTable(["", "Check", "Found", "Expected"], rows.map(r =>
    [CHECKLIST_ICON[r.severity], escapeHtml(r.feature), escapeHtml(r.detected), escapeHtml(r.expected || "")])) + `</div>`;
}

// files: jobFiles(); checkable: artworkSlots() (printed parts with their
// check params); facts: the artwork check's result, or null while it
// runs. base: URL folder of the job's check output.
export function renderArtwork(files, checkable, facts, printCheck, base, gaps){
  const slots = files.slots.filter(s => s.section === "artwork");
  const params = new Map(checkable.map(c => [c.name, c.params]));
  const verdict = slot => !params.has(slot.name) ? "" : !facts ? "checking"
    : VERDICT[artworkVerdict(artworkRows(facts[slot.name] || {error: "not checked"}, params.get(slot.name), printCheck))];
  const page = slot => params.has(slot.name) && params.get(slot.name).page > 1 ? `, page ${params.get(slot.name).page}` : "";
  let body = gapsHtml(gaps, "artwork");
  if(slots.length) body += listTable(["Slot", "File", "Other versions", "Verdict"],
    slots.map(s => [escapeHtml(s.title) + page(s), fileCell(s), versionsCell(s), verdict(s)]));
  if(facts) body += checkable.map(c => artFileHtml(c, facts[c.name] || {error: "not checked"}, printCheck, base)).join("");
  return section("artwork", body || "<p>No artwork.</p>");
}

// --- 3 Audio ---------------------------------------------------------

// A line at `seconds` on a waveform `duration` long; kind "file" for
// the file's own markers, "form" for the tracklist's track starts.
function markHtml(seconds, duration, label, kind){
  const left = Math.min(100, seconds / duration * 100).toFixed(3);
  return `<i class="mark ${kind}" style="left:${left}%" title="${escapeHtml(formatTime(seconds))} ${escapeHtml(label)}">`
    + `<span>${escapeHtml(label)}</span></i>`;
}

// Where the form puts each track after the first on a continuous side:
// the sum of the lengths before it. No gaps — on a continuous side the
// pauses are part of the file. Stops at the first empty length.
function formTrackStarts(side, sideId){
  const starts = [];
  let at = 0;
  for(const [i, track] of side.tracks.entries()){
    if(i) starts.push([at, `${sideId}${i + 1}`]);
    const length = parseTime(track.length);
    if(length === null) break;
    at += length;
  }
  return starts;
}

// A checked audio file: its facts, play button and waveform.
function audioFileHtml(file, label, formStarts, base){
  if(!file) return "";
  let body = `<h3>${escapeHtml(label)}</h3>`;
  if(file.error) return `<div class="audio-file">${body}<p>${escapeHtml(file.error)}</p></div>`;
  const khz = file.sampleRate ? `${file.sampleRate / 1000} kHz` : "";
  body += fieldTable([
    ["Format", escapeHtml([file.codec, khz, file.bitsPerSample && `${file.bitsPerSample} bit`,
      file.channels && `${file.channels} ch`].filter(Boolean).join(", "))],
    ["Duration", escapeHtml(formatTime(file.duration))],
    ["Software", escapeHtml(file.software.join(" · "))],
    ["Title tag", escapeHtml(file.title)],
    ["Artist tag", escapeHtml(file.artist)],
    ["Comment tag", escapeHtml(file.comment)]
  ]);
  if(file.preview && file.duration > 0){
    const marks = file.markers.map(m => markHtml(m.seconds, file.duration, m.label, "file"))
      .concat(formStarts.map(([seconds, pos]) => markHtml(seconds, file.duration, pos, "form")));
    body += `<p><button type="button" class="play">play</button></p>`
      + `<div class="wave" data-src="${escapeHtml(base + encodeURIComponent(file.preview))}" data-duration="${file.duration}">`
      + `<img src="${escapeHtml(base + encodeURIComponent(file.waveform))}" alt=""><div class="played"></div>${marks.join("")}</div>`;
  }
  return `<div class="audio-file">${body}</div>`;
}

// Both sides' tracklists, the customer's notes to the mastering engineer
// below them, then each file's check. files: jobFiles(); facts: the
// audio check's result, or null while it runs; findings:
// audioFindings(). base: URL folder of the job's check output; its
// spectrum/ holds the spectrograms (plant/spectrum.py).
export function renderAudio(project, files, facts, findings, base, gaps){
  const bySlot = new Map(files.slots.map(s => [s.name, s]));
  const spectrum = name => name && facts && facts.files[name] && !facts.files[name].error
    ? `<a href="${escapeHtml(base + "spectrum/" + encodeURIComponent(name + ".png"))}" target="_blank">spectrum</a>` : "";
  const sideFile = name => name ? [fileCell(bySlot.get(name)), versionsCell(bySlot.get(name)), spectrum(name)]
    .filter(Boolean).join(" ") : "";
  let body = gapsHtml(gaps, "audio") + listHtml(findings);
  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    body += `<h3>Side ${sideId}</h3>`;
    if(side.blank){
      body += "<p>Blank</p>";
      continue;
    }
    body += fieldTable([
      ["RPM", escapeHtml(side.rpm)],
      ["Matrix", escapeHtml(side.matrixInscription)],
      ["Total", `${formatTime(sideTiming(side).seconds)}${project.soundsystem ? ", soundsystem cut" : ""}`],
      ["Side file", side.continuous ? sideFile(side.continuousFileName) : ""],
      ["Tracklist file", side.continuous ? sideFile(side.tracklistFileName) : ""]
    ]);
    const head = ["Pos", "Title", "Artist", "Length"].concat(side.continuous ? [] : ["Gap", "File", "Other versions", "Spectrum"]);
    body += listTable(head, side.tracks.map((track, i) => {
      const cells = [`${sideId}${i + 1}`, escapeHtml(track.title), escapeHtml(track.artist), escapeHtml(track.length)];
      if(side.continuous) return cells;
      const gap = i === 0 ? "" : track.gap === "custom" ? `${track.gapCustom}s` : `${track.gap}s`;
      const slot = bySlot.get(track.fileName);
      return cells.concat([escapeHtml(gap), fileCell(slot), versionsCell(slot), spectrum(track.fileName)]);
    }));
  }
  // A paragraph with the customer's line breaks: <pre> would switch to a
  // monospaced font and not wrap.
  if(project.notes.trim()){
    body += `<h3>Notes to the mastering engineer</h3><p>${escapeHtml(project.notes.trim()).replace(/\r?\n/g, "<br>")}</p>`;
  }
  for(const sideId of facts ? ["A", "B"] : []){
    const side = project.sides[sideId];
    const formStarts = side.continuous ? formTrackStarts(side, sideId) : [];
    // "Side file" alone: out of its side's table here, so name the side.
    body += sideAudio(side, sideId).map(({name, label}) =>
      audioFileHtml(facts.files[name], side.continuous ? `Side ${sideId} file` : label, formStarts, base)).join("");
  }
  return section("audio", body);
}

// --- 4 Shipping & billing --------------------------------------------

const ADDRESS_FIELDS = ["recipientName", "attention", "addressLine1", "addressLine2", "addressLine3",
  "postalCode", "city", "stateProvince", "countryCode", "email", "phone", "vat", "eori"];

const addressRows = address => ADDRESS_FIELDS.map(f => [ADDRESS_FIELD_LABELS[f], escapeHtml(address[f])]);

// The billing address is complete here although name and email also
// stand in Basic's Customer row: staff copy the address as a whole.
export function renderShipping(project, gaps){
  const {billing, shipping} = project.shippingBilling;
  return section("shipping", gapsHtml(gaps, "shipping")
    + `<h3>Billing</h3>` + fieldTable(addressRows(billing))
    + shipping.map((address, i) => `<h3>Shipping ${i + 1}</h3>` + fieldTable(addressRows(address).concat([
      ["quantities", escapeHtml(Object.entries(address.qtyByColor).filter(([, q]) => q.trim())
        .map(([color, q]) => `${q} ${colorLabel(color)}`).join(", "))],
      ["residential", address.isResidential ? "yes" : ""],
      ["note", escapeHtml(address.note)]
    ]))).join(""));
}

// --- 5 Unmanaged files ------------------------------------------------

function formatSize(bytes){
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

// Files off the naming convention (jobFiles().unmanaged): part of the job
// folder, but project.json doesn't know them — listed only, never
// renamed into a slot or checked.
export function renderUnmanaged(files){
  return section("unmanaged", files.unmanaged.length
    ? listTable(["File", "Size", "Modified"], files.unmanaged.map(f =>
      [escapeHtml(f.name), f.size == null ? "" : formatSize(f.size), when(f.modified)]))
    : "<p>None.</p>");
}

// --- 6 History -------------------------------------------------------

export function renderHistory(project){
  return section("history", project.history.length
    ? listTable(["Date", "By", "Note"], project.history.map(h => [when(h.savedAt), escapeHtml(h.by), escapeHtml(h.note)]))
    : "<p>No entries.</p>");
}
