// Cover, inner sleeve and inlay: one product each from the format's
// catalog (CONFIG.formats[i].printableParts.<key>.products). A printed
// product gets an artwork slot per variant — one flat spread (back left,
// front right) for cover and inner sleeve, a front and a back page for
// the inlay. The inner sleeve is always required: no "None", the product
// flagged default:true is preselected. "Printed (inside out)" is its own
// cover product; its name alone carries the assembly instruction.

import { CONFIG } from "../config.js";
import { getFormat, artworkSize, partSpecRows, groupProductsByKind, productById } from "../lib/format-catalogue.js";
import { isDebugMode } from "../lib/debug-mode.js";
import { printedPartFileName, previewFileName, fileExt } from "../lib/package-naming.js";
import { requiredFileIssue } from "../lib/file-issues.js";
import { createArtworkSlot, pairSlots } from "./artwork-slot.js";

// On-screen preview cap: a flat cover spread is 600+mm wide.
const PART_PREVIEW_MAX_W = 640;

// key: project.json / printableParts name; prefix: element ids; file:
// the part in package file names.
const PRINTED_PARTS = [
  {key: "cover", catalog: "outerCover", prefix: "cover", file: "cover", title: "Cover", none: true, variants: [null]},
  {key: "innerSleeve", catalog: "innerSleeve", prefix: "innersleeve", file: "innersleeve", title: "Inner sleeve", none: false, variants: [null]},
  {key: "inlay", catalog: "inlay", prefix: "inlay", file: "inlay", title: "Inlay", none: true, variants: ["front", "back"]}
];

let partsOnStateChange = ()=>{};

function partFormat(){
  return getFormat(CONFIG, document.getElementById("format").value);
}

function partProducts(part){
  return partFormat().printableParts[part.catalog].products;
}

function selectedProduct(part){
  return productById(partProducts(part), document.getElementById(part.prefix+"Product").value || null);
}

function partPrinted(part){
  const product = selectedProduct(part);
  return !!product && product.kind === "printed";
}

function defaultProduct(products){
  return products.find(p => p.default) || products[0];
}

function catalogueValue(){
  return document.getElementById("catalogue").value;
}

function partFileName(part, variant, file){
  return printedPartFileName({catalogue: catalogueValue(), part: part.file, variant, ext: fileExt(file.name)});
}

function partPreviewName(part, variant){
  return previewFileName({catalogue: catalogueValue(), part: part.file, variant});
}

// Rebuilt from CONFIG on every format change: "None" (unless required),
// then the products grouped Printed/Unprinted.
function populateProducts(part){
  const select = document.getElementById(part.prefix+"Product");
  const products = partProducts(part);
  select.innerHTML = "";
  if(part.none) select.append(new Option("None", ""));
  const { printed, unprinted } = groupProductsByKind(products);
  for(const [label, list] of [["Printed", printed], ["Unprinted", unprinted]]){
    if(!list.length) continue;
    const group = document.createElement("optgroup");
    group.label = label;
    for(const p of list) group.append(new Option(p.name, p.id));
    select.append(group);
  }
  select.value = part.none ? "" : defaultProduct(products).id;
}

function renderSpecs(part){
  const rows = partSpecRows(selectedProduct(part), {
    fileTypes: CONFIG.artworkFileTypes.labels.join(", "),
    colorMode: partFormat().printCheck.checks.colorMode.accepted.join("/"),
    debug: isDebugMode()
  });
  const details = document.getElementById(part.prefix+"specs");
  details.classList.toggle("hidden", !rows.length);
  const body = details.querySelector(".specs-body");
  body.textContent = "";
  for(const [label, value] of rows){
    const row = document.createElement("div");
    for(const text of [label, value]){
      const span = document.createElement("span");
      span.textContent = text;
      row.append(span);
    }
    body.append(row);
  }
}

// Preview boxes keep the artwork's aspect ratio, capped in width.
function updateSizing(part){
  const size = artworkSize(partFormat(), part.catalog, selectedProduct(part));
  if(!size) return;
  for(const variant of part.variants){
    const id = role => document.getElementById(part.prefix+(variant || "")+role);
    const wrap = id("previewwrap"), caption = id("caption");
    Object.assign(wrap.style, {width: "100%", maxWidth: PART_PREVIEW_MAX_W+"px", aspectRatio: size.targetMm.w+" / "+size.targetMm.h});
    Object.assign(id("preview").style, {width: "100%", height: "100%"});
    if(caption) Object.assign(caption.style, {width: "100%", maxWidth: PART_PREVIEW_MAX_W+"px"});
  }
}

// A product change or a format change: the slots' files were sized for
// the old one, so they go.
function resetPart(part){
  Object.values(part.slots).forEach(s => s.clear());
  refreshPart(part);
}

function refreshPart(part){
  document.getElementById(part.prefix+"PrintedBody").classList.toggle("hidden", !partPrinted(part));
  updateSizing(part);
  renderSpecs(part);
  part.updatePair();
}

export function initPrintedParts(onStateChange = ()=>{}){
  partsOnStateChange = onStateChange;
  for(const part of PRINTED_PARTS){
    part.slots = {};
    for(const variant of part.variants){
      const id = role => document.getElementById(part.prefix+(variant || "")+role);
      id("input").accept = CONFIG.artworkFileTypes.accept;
      part.slots[variant] = createArtworkSlot(id, {
        size: ()=> ({...artworkSize(partFormat(), part.catalog, selectedProduct(part)), printCheck: partFormat().printCheck}),
        onChange: ()=>{ part.updatePair(); partsOnStateChange(); }
      });
    }
    part.updatePair = part.variants.length > 1
      ? pairSlots(part.slots.front, part.slots.back, document.getElementById(part.prefix+"pair"))
      : ()=>{};
    populateProducts(part);
    refreshPart(part);
    document.getElementById(part.prefix+"Product").addEventListener("change", ()=>{
      resetPart(part);
      partsOnStateChange();
    });
  }
  document.getElementById("format").addEventListener("change", ()=>{
    for(const part of PRINTED_PARTS){
      populateProducts(part);
      resetPart(part);
    }
    partsOnStateChange();
  });
}

// project.json's coverSleeve: a slot's fileName is set exactly when its
// file goes into the package, so the order texts list files from this
// data alone. The inlay nests its slots under front/back.
export function collectPrintedParts(){
  return Object.fromEntries(PRINTED_PARTS.map(part => {
    const product = selectedProduct(part);
    const printed = partPrinted(part);
    const slotData = variant => {
      const {file, originalFileName, page} = part.slots[variant].state;
      const included = printed && !!file;
      return {
        fileName: included ? partFileName(part, variant, file) : null,
        originalFileName: included ? originalFileName : null,
        page: included ? page : 1
      };
    };
    const data = {productId: product ? product.id : null};
    if(part.variants.length > 1) for(const v of part.variants) data[v] = slotData(v);
    else Object.assign(data, slotData(null));
    return [part.key, data];
  }));
}

// fileMap: package name -> File from a reopened project zip.
export async function applyPrintedParts(coverSleeve, fileMap){
  const all = coverSleeve || {};
  for(const part of PRINTED_PARTS){
    const data = all[part.key] || {};
    const products = partProducts(part);
    const match = productById(products, data.productId);
    document.getElementById(part.prefix+"Product").value = match ? match.id : part.none ? "" : defaultProduct(products).id;
    await Promise.all(part.variants.map(variant => {
      const s = (variant ? data[variant] : data) || {};
      return part.slots[variant].applyFile(s.fileName, s.originalFileName, fileMap, partPreviewName(part, variant), s.page);
    }));
    refreshPart(part);
  }
  partsOnStateChange();
}

export function printedPartIssues(){
  return PRINTED_PARTS.filter(part => part.slots && partPrinted(part)).flatMap(part =>
    part.variants.map(variant => requiredFileIssue(variant ? `${part.title} ${variant}` : part.title, part.slots[variant].state))
  ).filter(Boolean);
}

// The package's printed-part files, named like collectPrintedParts says.
export function collectPrintedPartFiles(){
  return PRINTED_PARTS.filter(partPrinted).flatMap(part =>
    part.variants.flatMap(variant => part.slots[variant].files(file => partFileName(part, variant, file), partPreviewName(part, variant)))
  );
}

// Same for the sleeve, cover and inlay slots.
export function showPartChecks(byName){
  for(const part of PRINTED_PARTS){
    for(const variant of part.variants){
      const slot = part.slots[variant];
      const hit = byName.get(slot.state.storedFileName);
      if(hit) slot.showChecks(hit);
    }
  }
}
