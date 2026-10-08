import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
execFileSync(process.execPath, ["build/build.js"], { cwd: ROOT, stdio: "ignore" });
const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// A built page's script in a stub DOM. answers: what the plant server says per
// staff file name ({text, hash, exists}); none = no server (fetch is absent or refused).
async function run(page, answers){
  const js = read(`dist/${page}.html`).match(/<script>\n([\s\S]*)\n<\/script>/)[1];
  const els = new Map(), menu = [];
  const mk = id => {
    const el = { id, dataset: {}, style: {}, added: [], textContent: "", className: "", value: "", files: [],
      classList: { add: c => el.added.push(c), toggle(){}, remove(){} },
      addEventListener(){}, querySelectorAll: () => [], click(){},
      set innerHTML(v){ el._h = v; }, get innerHTML(){ return el._h || ""; } };
    return el;
  };
  const document = {
    getElementById: id => els.get(id) || (els.set(id, mk(id)), els.get(id)),
    querySelector: () => ({ insertAdjacentHTML: (_, html) => menu.push(html) }),
    addEventListener(){}, querySelectorAll: () => [],
    body: { classList: { add(){}, remove(){} } }, createElement: () => ({ click(){} })
  };
  const fetch = answers && (async url => {
    const answer = answers[new URL(url, "http://x").searchParams.get("name")];
    return answer ? { ok: true, json: async () => answer } : { ok: false };
  });
  vm.runInNewContext(js, { document, fetch, window: { addEventListener(){} }, console, structuredClone, Blob, URL, Event: class {} });
  await new Promise(resolve => setTimeout(resolve, 10));
  return { els, menu };
}

const example = { text: read("src/plant.config.local.example.js"), hash: "", exists: false };

test("plant config page: no plant server — works on downloads, no menu", async () => {
  for(const answers of [undefined, {}]){
    const { els, menu } = await run("plant-config", answers);
    assert.ok(els.get("editor").innerHTML.includes("Imprint"));
    assert.deepEqual(menu, []);
  }
});

test("plant config page: on the plant server — the file on disk, with the menu", async () => {
  const { els, menu } = await run("plant-config", { "plant-config": example });
  assert.equal(els.get("file").textContent, "src/plant.config.local.js (new, from the example)");
  assert.ok(els.get("editor").innerHTML.includes("Saved to src/plant.config.local.js"));
  assert.equal(menu.length, 1);
  assert.ok(menu[0].includes('aria-current="page">Plant config</a>'));
});

test("plant config page: a file on disk that doesn't parse is no dead end", async () => {
  const { els } = await run("plant-config", { "plant-config": { text: "garbage", hash: "h", exists: true } });
  assert.equal(els.get("status").className, "err");
  assert.ok(els.get("editor").innerHTML.includes("Open a plant.config.local.js"));
  assert.ok(!els.get("btnOpen").added.includes("hidden"));
});

test("pricelist page: no plant server — the embedded template, no menu", async () => {
  const { els, menu } = await run("pricelist", undefined);
  assert.equal(els.get("file").textContent, "pricelist.json");
  assert.deepEqual(menu, []);
});
