// The staff's order view: the customer page (served at /order/<job> by
// plant/server.py) filled from the job folder, locked, with the plant's own
// checks where the browser's checks run for the customer, and what only the
// plant knows. It shows; it changes nothing.
import { CONFIG } from "./config.js";
import { prepareProject } from "./lib/project.js";
import { projectGaps } from "./lib/completeness.js";
import { sideAudio, audioFindings } from "./lib/audio-checks.js";
import { artworkSlots, artworkRows, artworkVerdict } from "./lib/artwork-checks.js";
import { getFormat } from "./lib/format-catalogue.js";
import { lineState } from "./lib/lines.js";
import { jobFiles } from "./lib/versions.js";
import { staffJob } from "./lib/staff-mode.js";
import { readStream } from "./lib/stream.js";
import { VERDICT, renderUnmanaged, renderHistory } from "./lib/plant-overview.js";
import { renderStaffBar, renderStaffStatus, openItems, renderLineStatus } from "./lib/staff-info.js";
import { applyProject, showAudioChecks } from "./modules/tracklist.js";
import { showLabelChecks } from "./modules/labels.js";
import { showPricing } from "./modules/pricing.js";
import { validatePricelist, upgradePricelist } from "./lib/pricelist.js";
import { vatCase } from "./lib/vat-case.js";
import { normalizeVatId } from "./lib/vat-rates.js";
import { buildPriceQuote } from "./lib/price-quote.js";
import { renderQuotePanel, staleReason } from "./lib/staff-quote.js";
import { showPartChecks } from "./modules/printed-parts.js";

const job = staffJob();
const query = encodeURIComponent(job);

async function getJson(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

async function post(path, body){
  const res = await fetch(path, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  if(!res.ok) throw new Error(await res.text());
  return res;
}

// What the page is doing, in the bar; an error stays there in red.
function task(text, error = false){
  const el = document.getElementById("staffTask");
  if(!el) return;
  el.textContent = text;
  el.classList.toggle("err", error);
}

// Every control but the folding stays off — also the ones the page makes later.
// The staff's own controls (the quote's) are marked data-staff and stay on.
function lock(){
  for(const el of document.querySelectorAll(".sheet :is(input, select, textarea, button):not([data-staff])")) el.disabled = true;
}

const today = () => new Date().toLocaleDateString("sv");

// The Quote panel: the order priced from the live pricelist, the VAT treatment
// proposed from the billing address and the VAT ID (checked on VIES by the
// plant server when asked), saved as price_quote.json.
async function startQuote(project, data){
  const box = document.getElementById("staffQuote");
  let pricelist, listHash;
  try{
    const file = await getJson("/api/staff-file?name=pricelist");
    listHash = file.hash;
    pricelist = validatePricelist(upgradePricelist(JSON.parse(file.text), today()));
  }catch(error){
    box.innerHTML = renderQuotePanel({error: `the pricelist can't be read: ${error.message}`});
    return;
  }
  const billing = project.shippingBilling.billing;
  const id = normalizeVatId(billing.vat);
  const earlier = data.quote && data.quote.vat && data.quote.vat.vatId;
  const state = {saved: data.quote, savedHash: data.quoteHash, chosen: "",
    vatId: earlier && earlier.id === id ? {name: "", checked: "", ...earlier} : {id, status: id ? "unchecked" : "none", name: "", checked: ""}};
  const rateFor = kind => kind === "domestic" || kind === "plus-vat" ? pricelist.vat.rate : kind === "none" ? null : 0;
  const render = () => {
    const proposal = vatCase({plantCountry: pricelist.vat.country, plantRate: pricelist.vat.rate, billingCountry: billing.countryCode,
      vatId: state.vatId.id, vatIdStatus: state.vatId.status});
    const kind = state.chosen || proposal.case;
    const built = buildPriceQuote({project, pricelist, config: CONFIG, today: today(), vat: {case: kind, rate: rateFor(kind), vatId: state.vatId}});
    box.innerHTML = renderQuotePanel({saved: state.saved, built, proposal, chosen: state.chosen, vatId: state.vatId, billingCountry: billing.countryCode});
    return built;
  };
  let built = render();
  box.addEventListener("click", async event => {
    const act = event.target.dataset.act;
    try{
      if(act === "vatCheck"){
        task("asking VIES");
        state.vatId = await (await post("/api/vat-check", {vatId: state.vatId.id})).json();
        task("");
        built = render();
      }else if(act === "saveQuote" && built.ok){
        // The quote was priced from the order and pricelist as this page read them.
        const stale = staleReason({projectHash: data.projectHash, listHash}, {
          projectHash: (await getJson(`/api/job?job=${query}`)).projectHash,
          listHash: (await getJson("/api/staff-file?name=pricelist")).hash});
        if(stale) throw new Error(stale);
        const {hash} = await (await post("/api/quote", {job, quote: built.quote, basedOn: state.savedHash})).json();
        Object.assign(state, {saved: built.quote, savedHash: hash});
        showPricing(state.saved);
        built = render();
      }
    }catch(error){
      task(`quote: ${error.message}`, true);
    }
  });
  box.addEventListener("change", event => {
    if(event.target.dataset.act !== "vatCase") return;
    state.chosen = event.target.value;
    built = render();
  });
}

async function start(){
  document.body.classList.add("staff");
  const sheet = document.querySelector(".sheet");
  const data = await getJson(`/api/job?job=${query}`);
  sheet.insertAdjacentHTML("afterbegin", renderStaffBar(job, data.stage));
  const project = prepareProject(data.project, CONFIG);
  await applyProject(project, new Map());
  showPricing(data.quote);
  document.getElementById("stamp").textContent = job;

  // The page's own status list counts every file as missing (none is
  // attached): the plant's list takes its place.
  const status = document.getElementById("checklist");
  status.closest("section").querySelector("h2").textContent = "Status — plant checks";
  status.insertAdjacentHTML("afterend", '<ul class="checklist" id="staffChecklist"></ul>');
  const first = status.closest("section");
  first.insertAdjacentHTML("beforebegin", '<details class="panel" open><summary>Quote</summary><div id="staffQuote"></div></details>'
    + '<details class="panel" open><summary>Plant</summary><div id="staffPanel"></div></details>');
  lock();
  new MutationObserver(lock).observe(sheet, {childList: true, subtree: true});

  const files = jobFiles(project, data.files);
  const gaps = projectGaps(project, CONFIG, data.files);
  const printCheck = getFormat(CONFIG, project.format).printCheck;
  const checkable = artworkSlots(project, CONFIG);
  const audioNames = ["A", "B"].flatMap(side => sideAudio(project.sides[side], side).map(f => f.name));
  // checked: both checks came in; until then the list never says "nothing open".
  const draw = (artworkFacts, findings, artwork, checked) => {
    const states = Object.keys(CONFIG.lines).map(name => lineState(project, CONFIG, name, artworkFacts));
    document.getElementById("staffPanel").innerHTML = renderLineStatus(states) + renderHistory(project) + renderUnmanaged(files);
    document.getElementById("staffChecklist").innerHTML = renderStaffStatus(openItems({gaps, findings, artwork}), checked);
  };
  draw(null, [], [], false);
  startQuote(project, data);

  // The two checks are tried one after the other and independently: a failed
  // audio check doesn't keep the artwork from being checked.
  const step = what => msg => task(`checking ${what}  ${msg.file || ""} ${msg.index || ""}/${msg.count || ""}`);
  let problem = "", findings = [], audioOk = false;
  try{
    task("checking audio");
    const audio = await readStream(await post("/api/check/audio", {job, rescan: false, files: audioNames}), step("audio"));
    showAudioChecks(audio);
    findings = audioFindings(project, audio, CONFIG);
    audioOk = true;
    draw(null, findings, [], false);
  }catch(error){
    problem = `couldn't check audio: ${error.message}`;
  }
  try{
    task("checking artwork");
    const facts = await readStream(await post("/api/check/artwork",
      {job, rescan: false, artwork: Object.fromEntries(checkable.map(c => [c.name, c.params]))}), step("artwork"));
    const hits = new Map(), artwork = [];
    for(const c of checkable){
      const one = facts[c.name] || {error: "not checked"};
      const rows = artworkRows(one, c.params, printCheck);
      const verdict = artworkVerdict(rows);
      hits.set(c.name, {rows, preview: one.preview ? `/jobs/${query}/${encodeURIComponent(one.preview)}` : null, status: VERDICT[verdict]});
      artwork.push({title: c.title, verdict});
    }
    showLabelChecks(hits);
    showPartChecks(hits);
    draw(facts, findings, artwork, audioOk);
  }catch(error){
    problem += (problem ? "; " : "") + `couldn't check artwork: ${error.message}`;
  }
  task(problem, !!problem);
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));

// The customer page's own init runs first (its listener is registered first).
// Only on an /order/<job> address; anywhere else this script has no job to show.
if(job) document.addEventListener("DOMContentLoaded", () => {
  start().catch(error => {
    document.querySelector(".sheet").insertAdjacentHTML("afterbegin",
      `<nav class="staffbar"><a href="/">← orderbook</a> · <span class="err">${esc(job)} can't be shown: ${esc(error.message)}</span></nav>`);
  });
});
