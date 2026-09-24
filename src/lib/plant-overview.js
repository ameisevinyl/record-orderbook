// Plain HTML overview of a prepareProject() result for the plant view:
// every value in customer-form order, no specs or controls. Pure — the
// page (src/plant/app.js) only assigns the string to innerHTML, so every
// project value goes through escapeHtml here.

import { formatTime } from "./time.js";
import { computeStatus } from "./playing-time.js";
import { getFormat, productById } from "./format-catalogue.js";
import { colorLabel } from "./vinyl-color.js";
import { sideTiming, ADDRESS_FIELD_LABELS } from "./completeness.js";

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

function sideHtml(project, format, sideId, sizes){
  const side = project.sides[sideId];
  if(side.blank) return group(`Side ${sideId}`, "<p>Blank</p>");
  const mode = project.soundsystem ? "soundsystem" : "normal";
  const {seconds} = sideTiming(side);
  const status = computeStatus(format.timeLimits, Number(side.rpm), mode, seconds);
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
  body += `<p>Total ${formatTime(seconds)} — ${escapeHtml(side.rpm)} rpm, ${mode} cut, ideal ${status.idealMin} min, max ${status.maxMin} min</p>`;
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

export function renderGaps(gaps){
  if(!gaps.length) return '<p class="complete">Complete — ready for checks</p>';
  return `<ul class="gaps">${gaps.map(g => `<li><b>${escapeHtml(g.group)}</b> ${escapeHtml(g.text)}</li>`).join("")}</ul>`;
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
      ["Cut", project.soundsystem ? "soundsystem" : "normal"],
      ["Big center hole", labels.bigCenter ? "yes" : ""]
    ])),
    sideHtml(project, format, "A", sizes),
    sideHtml(project, format, "B", sizes),
    group("Notes", project.notes.trim() ? `<pre>${escapeHtml(project.notes)}</pre>` : "<p>—</p>"),
    group("Labels", rows(["A", "B"].map(side => [
      `Side ${side}`, labels.sides[side].whitelabel ? "whitelabel" : (fileHtml(labels.sides[side].fileName, sizes) || "none")
    ]))),
    group("Inner sleeve", rows([
      ["Product", productName(parts, "innerSleeve", sleeve.innerSleeve.productId)],
      ["Artwork", fileHtml(sleeve.innerSleeve.fileName, sizes)]
    ])),
    group("Cover", rows([
      ["Product", productName(parts, "outerCover", sleeve.cover.productId)],
      ["Artwork", fileHtml(sleeve.cover.fileName, sizes)]
    ])),
    group("Inlay", rows([
      ["Product", productName(parts, "inlay", sleeve.inlay.productId)],
      ["Front", fileHtml(sleeve.inlay.front.fileName, sizes)],
      ["Back", fileHtml(sleeve.inlay.back.fileName, sizes)]
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
