// Expert-reference info-panel text — looked up by key with a locale
// fallback to English (see CONFIG.infoText / CONFIG.locale in
// config.js). Kept here, not inlined in the DOM modules, so both the
// lookup and the rendered markup are testable without a browser.

export function infoText(infoConfig, locale, key){
  const entry = infoConfig[key];
  if(!entry) return "";
  return entry[locale] || entry.en || "";
}

// Renders the collapsed-by-default "i" info toggle as a native
// <details> element — no JS needed to open or close it. `no-print`
// keeps this expert reference note off the printed order sheet, same
// as the file-picker buttons.
export function renderInfoIcon(text){
  if(!text) return "";
  return `<details class="info no-print"><summary title="More info"></summary><div class="info-body">${text}</div></details>`;
}
