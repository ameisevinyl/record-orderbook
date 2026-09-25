// Plain HTML overview of a prepareProject() result for the plant view:
// every value in customer-form order, no specs or controls. Pure — the
// page (src/plant/app.js) only assigns the string to innerHTML, so every
// project value goes through escapeHtml here.

import { formatTime, parseTime } from "./time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { sideTiming, ADDRESS_FIELD_LABELS } from "./completeness.js";
import { sideAudio } from "./audio-checks.js";
import { artworkRows, artworkVerdict } from "./artwork-checks.js";
import { CHECKLIST_ICON } from "./print-artwork.js";

export function escapeHtml(value){
  return String(value ?? "").replace(/[&<>"']/g, c =>
    ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
}

function group(title, body){
  return `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

// pairs: [label, html] — values arrive already escaped; empty ones drop.
function rows(pairs){
  const kept = pairs.filter(([, html]) => html !== "");
  return kept.length
    ? `<dl>${kept.map(([label, html]) => `<dt>${escapeHtml(label)}</dt><dd>${html}</dd>`).join("")}</dl>`
    : "<p>—</p>";
}

function formatSize(bytes){
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function fileHtml(name, sizes){
  if(!name) return "";
  return sizes.has(name)
    ? `${escapeHtml(name)} (${formatSize(sizes.get(name))})`
    : `${escapeHtml(name)} <span class="missing">missing</span>`;
}

function artworkHtml(slot, sizes){
  const file = fileHtml(slot.fileName, sizes);
  return file && slot.page > 1 ? `${file}, page ${slot.page}` : file;
}

function sideHtml(project, format, sideId, sizes){
  const side = project.sides[sideId];
  if(side.blank) return group(`Side ${sideId}`, "<p>Blank</p>");
  const {seconds} = sideTiming(side);
  let body = rows([
    ["RPM", escapeHtml(side.rpm)],
    ["Matrix", escapeHtml(side.matrixInscription)],
    ["Side file", side.continuous ? fileHtml(side.continuousFileName, sizes) : ""],
    ["Tracklist file", side.continuous ? fileHtml(side.tracklistFileName, sizes) : ""]
  ]);
  if(!side.continuous){
    body += `<table><tr><th>Pos</th><th>Title</th><th>Artist</th><th>Length</th><th>Gap</th><th>File</th></tr>`
      + side.tracks.map((track, i) => {
        const gap = i === 0 ? "" : track.gap === "custom" ? `${track.gapCustom}s` : `${track.gap}s`;
        return `<tr><td>${sideId}${i + 1}</td><td>${escapeHtml(track.title)}</td><td>${escapeHtml(track.artist)}</td>`
          + `<td>${escapeHtml(track.length)}</td><td>${escapeHtml(gap)}</td><td>${fileHtml(track.fileName, sizes)}</td></tr>`;
      }).join("")
      + `</table>`;
  }
  // Normal is the default, so only the soundsystem cut gets named.
  body += `<p>Total ${formatTime(seconds)} — ${escapeHtml(side.rpm)} rpm${project.soundsystem ? ", soundsystem cut" : ""}</p>`;
  return group(`Side ${sideId}`, body);
}

function productName(parts, category, id){
  const product = productById((parts[category] && parts[category].products) || [], id);
  return product ? escapeHtml(product.name) : "none";
}

function addressHtml(address){
  const fields = ["recipientName", "attention", "addressLine1", "addressLine2", "addressLine3",
    "postalCode", "city", "stateProvince", "countryCode", "email", "phone", "vat", "eori"];
  return rows(fields.map(field => [ADDRESS_FIELD_LABELS[field], escapeHtml(address[field])]));
}

export function renderHeader(zipName, project){
  return `<p class="ident">${escapeHtml(zipName)}</p>`
    + `<p class="title">${escapeHtml(project.catalogue || "(no catalogue #)")} — ${escapeHtml(project.albumTitle || "(no title)")} — ${escapeHtml(project.albumArtist || "(no artist)")}</p>`;
}

function findingsHtml(findings){
  return `<ul class="gaps">${findings.map(f => `<li><b>${escapeHtml(f.group)}</b> ${escapeHtml(f.text)}</li>`).join("")}</ul>`;
}

export function renderGaps(gaps){
  if(!gaps.length) return '<p class="complete">Complete — ready for checks</p>';
  return findingsHtml(gaps);
}

// A line at `seconds` on a waveform `duration` long; kind "file" for
// the file's own markers, "form" for the tracklist's track starts.
function markHtml(seconds, duration, label, kind){
  const left = Math.min(100, seconds / duration * 100).toFixed(3);
  return `<i class="mark ${kind}" style="left:${left}%" title="${escapeHtml(formatTime(seconds))} ${escapeHtml(label)}">`
    + `<span>${escapeHtml(label)}</span></i>`;
}

// Where the form puts each track after the first on a continuous side:
// the sum of the lengths before it. No gaps — on a continuous side the
// pauses are part of the file, the form disables the gap fields. Stops
// at the first empty length: the starts after it are unknown.
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

function audioFileHtml(file, name, label, formStarts, base){
  return `<div class="audio-file"><p><b>${escapeHtml(label)}</b> <span class="ident">${escapeHtml(name)}</span></p>`
    + audioFactsHtml(file, formStarts, base) + "</div>";
}

function audioFactsHtml(file, formStarts, base){
  if(!file) return "";
  if(file.error) return `<p class="missing">${escapeHtml(file.error)}</p>`;
  const khz = file.sampleRate ? `${file.sampleRate / 1000} kHz` : "";
  const facts = rows([
    ["Format", escapeHtml([file.codec, khz, file.bitsPerSample && `${file.bitsPerSample} bit`,
      file.channels && `${file.channels} ch`].filter(Boolean).join(", "))],
    ["Duration", escapeHtml(formatTime(file.duration))],
    ["Software", escapeHtml(file.software.join(" · "))],
    ["Title", escapeHtml(file.title)],
    ["Artist", escapeHtml(file.artist)],
    ["Comment", escapeHtml(file.comment)]
  ]);
  if(!file.preview || !(file.duration > 0)) return facts;
  const marks = file.markers.map(m => markHtml(m.seconds, file.duration, m.label, "file"))
    .concat(formStarts.map(([seconds, pos]) => markHtml(seconds, file.duration, pos, "form")));
  return facts
    + `<p><button type="button" class="play">play</button></p>`
    + `<div class="wave" data-src="${escapeHtml(base + encodeURIComponent(file.preview))}" data-duration="${file.duration}">`
    + `<img src="${escapeHtml(base + encodeURIComponent(file.waveform))}" alt=""><div class="played"></div>${marks.join("")}</div>`;
}

// Audio facts, findings and prelisten per side. base: URL folder of the
// check output (previews), e.g. "/work/<stem>.checks/".
export function renderAudio(project, facts, findings, base){
  let body = findings.length ? findingsHtml(findings) : '<p class="complete">No audio findings</p>';
  for(const sideId of ["A", "B"]){
    const side = project.sides[sideId];
    const audio = sideAudio(side, sideId);
    if(!audio.length) continue;
    const formStarts = side.continuous ? formTrackStarts(side, sideId) : [];
    body += `<h3>Side ${sideId}</h3>`
      + audio.map(({name, label}) => audioFileHtml(facts.files[name], name, label, formStarts, base)).join("");
  }
  return group("Audio", body);
}

export function renderOverview(project, config, files){
  const sizes = new Map(files.map(file => [file.name, file.size]));
  const format = getFormat(config, project.format);
  const parts = format.printableParts || {};
  const sleeve = project.coverSleeve;
  const labels = project.labels;

  return [
    group("Release", rows([
      ["Catalogue #", escapeHtml(project.catalogue)],
      ["Format", escapeHtml(format.label)],
      ["Title", escapeHtml(project.albumTitle)],
      ["Artist", escapeHtml(project.albumArtist)],
      ["Cut", project.soundsystem ? "soundsystem" : ""],
      ["Big center hole", labels.bigCenter ? "yes" : ""]
    ])),
    sideHtml(project, format, "A", sizes),
    sideHtml(project, format, "B", sizes),
    group("Notes", project.notes.trim() ? `<pre>${escapeHtml(project.notes)}</pre>` : "<p>—</p>"),
    group("Labels", rows(["A", "B"].map(side => [
      `Side ${side}`, labels.sides[side].whitelabel ? "whitelabel" : (artworkHtml(labels.sides[side], sizes) || "none")
    ]))),
    group("Inner sleeve", rows([
      ["Product", productName(parts, "innerSleeve", sleeve.innerSleeve.productId)],
      ["Artwork", artworkHtml(sleeve.innerSleeve, sizes)]
    ])),
    group("Cover", rows([
      ["Product", productName(parts, "outerCover", sleeve.cover.productId)],
      ["Artwork", artworkHtml(sleeve.cover, sizes)]
    ])),
    group("Inlay", rows([
      ["Product", productName(parts, "inlay", sleeve.inlay.productId)],
      ["Front", artworkHtml(sleeve.inlay.front, sizes)],
      ["Back", artworkHtml(sleeve.inlay.back, sizes)]
    ])),
    group("Vinyl colour & quantity", rows(project.vinylColor.map(row => [colorLabel(row.color), escapeHtml(row.qty)]))),
    group("Billing", addressHtml(project.shippingBilling.billing)),
    group("Shipping", project.shippingBilling.shipping.map((address, i) =>
      `<h3>Address ${i + 1}</h3>` + addressHtml(address)
      + rows([
        ["Quantities", escapeHtml(Object.entries(address.qtyByColor).filter(([, qty]) => qty.trim())
          .map(([color, qty]) => `${qty} ${colorLabel(color)}`).join(", "))],
        ["Residential", address.isResidential ? "yes" : ""],
        ["Note", escapeHtml(address.note)]
      ])).join("") || "<p>—</p>"),
    project.history.length ? group("History", rows(project.history.map(h =>
      [h.savedAt, `${escapeHtml(h.by)}: ${escapeHtml(h.note)}`]))) : ""
  ].join("");
}

const VERDICT = {ok: "OK", review: "review", customer: "needs customer"};

// Trim and a label's center hole (dashed) and bleed (dotted) in page
// millimetres; the SVG stretches over the preview, so the lines sit
// where the cut and the punch will be. Black dashes on a white line of
// the same width read on dark and light designs alike.
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

function checklistHtml(rows){
  return `<table>${rows.map(r => `<tr class="${r.severity}"><td>${CHECKLIST_ICON[r.severity]}</td>`
    + `<td>${escapeHtml(r.feature)}</td><td>${escapeHtml(r.detected)}</td><td>${escapeHtml(r.expected || "")}</td></tr>`).join("")}</table>`;
}

// One block per artwork file: verdict, preview with cut lines and a
// switchable problem-area overlay, the checklist. base: URL folder of
// the check output.
export function renderArtwork(slots, artworkFacts, printCheck, base){
  if(!slots.length) return "";
  return group("Artwork", slots.map(({title, name, params}) => {
    const facts = artworkFacts[name] || {error: "not checked"};
    const rows = artworkRows(facts, params, printCheck);
    const verdict = artworkVerdict(rows);
    let body = `<p><b>${escapeHtml(title)}</b> <span class="ident">${escapeHtml(name)}</span> `
      + `<span class="verdict ${verdict}">${VERDICT[verdict]}</span></p>`;
    if(facts.preview){
      const url = file => escapeHtml(base + encodeURIComponent(file));
      body += `<label class="chk"><input type="checkbox" class="show-overlay"> problem areas</label>`
        + `<div class="art" style="aspect-ratio:${facts.pageMm.w} / ${facts.pageMm.h}">`
        + `<img src="${url(facts.preview)}" alt=""><img class="overlay" hidden src="${url(facts.overlay)}" alt="">`
        + cutLinesSvg(facts.pageMm, facts.trimRectMm, params.bleedMm, params.round, params.holeMm) + `</div>`;
    }
    return `<div class="art-file">${body}${checklistHtml(rows)}</div>`;
  }).join(""));
}
