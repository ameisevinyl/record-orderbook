// Template — copy this file to src/plant.config.local.js and fill in
// this plant's real identity. plant.config.local.js is gitignored and
// never committed; build/build.js splices it into the bundle right
// after config.js, when present, overwriting the sample CONFIG.plant
// object with this one. Without it, both the raw src/ tree (dev mode)
// and any build run without this file present show the safe sample
// data from config.js instead — that's what the public GitHub Pages
// demo (built by CI, which never sees a gitignored file) serves.
//
// This file is NOT a real ES module — it's concatenated directly into
// the bundle after config.js by build/build.js, so it can just assign
// to the already-declared CONFIG. It only ever runs as part of that
// concatenated build, never imported directly.

CONFIG.plant = {
  // EU/German legal imprint requirement (Impressum) — shown small in
  // the page footer. Same field shape as the billing/shipping
  // addresses elsewhere in this tool. A reasonable general field set,
  // not legal advice: confirm your own jurisdiction's exact
  // requirements before relying on it.
  imprint: {
    recipientName: "",
    addressLine1: "",
    addressLine2: "",
    addressLine3: "",
    city: "",
    stateProvince: "",
    postalCode: "",
    countryCode: "",
    phone: "",
    email: "",
    vat: ""
  },
  // uploadUrl: a specific, already-targeted drop-link (e.g. a
  // Nextcloud File Request) — when set, this alone is the whole flow:
  // "open this link, drop your zip in". Leave blank to fall back to
  // uploadServiceUrl + uploadEmail (a generic transfer service's
  // homepage, e.g. SwissTransfer, where the customer starts a new
  // transfer and types the recipient themselves) — see
  // src/lib/transfer.js.
  transfer: {
    uploadUrl: "",
    uploadServiceUrl: "https://www.swisstransfer.com/",
    uploadEmail: ""
  }
};
