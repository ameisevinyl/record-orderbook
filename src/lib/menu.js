// The staff app's menu, shared by the plant view and the staff editors.
// A third entry marks the settings pages.
export const MENU = [
  ["Orderbook", "/"],
  ["Archive", "/#/archive"],
  ["Pricelist", "/src/pricelist.html", "settings"],
  ["Plant config", "/src/plant-config.html", "settings"]
];

// current: the href of the page shown, its link is marked.
export function menuHtml(current){
  return MENU.map(([text, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${text}</a>`).join("");
}

// The plant view's drop-down like a desktop file menu: loading first, then
// the pages, the settings last. The home page itself isn't in it.
export function dropdownHtml(){
  const item = ([text, href]) => `<li><a href="${href}">${text}</a></li>`;
  return `<li><button type="button" id="btnLoad">Load project zip…</button></li>`
    + `<li><button type="button" id="btnLoadFolder">Load project folder…</button></li>`
    + MENU.filter(([, href, group]) => href !== "/" && !group).map(item).join("")
    + `<li class="group">Settings</li>`
    + MENU.filter(([, , group]) => group === "settings").map(item).join("");
}
