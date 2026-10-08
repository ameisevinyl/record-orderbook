// The staff app's menu, shared by the plant view and the staff editors.
export const MENU = [
  ["Plant view", "/"],
  ["Archive", "/#/archive"],
  ["Pricelist", "/src/pricelist.html"],
  ["Plant config", "/src/plant-config.html"]
];

// current: the href of the page shown, its link is marked.
export function menuHtml(current){
  return MENU.map(([text, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${text}</a>`).join("");
}
