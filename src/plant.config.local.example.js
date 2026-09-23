// Template — copy this file to src/plant.config.local.js and fill in
// this plant's real identity. plant.config.local.js is gitignored and
// never committed; build/build.js uses it instead of this example when
// it exists, so a real plant's data overrides these sample values at
// build time. Without it (the raw src/ tree in dev mode, and the public
// GitHub Pages demo built by CI, which never sees a gitignored file)
// these sample values ship.
//
// Keep the export name and shape identical: config.js imports
// PLANT_CONFIG from this file in dev, and build.js concatenates
// whichever of the two files is used ahead of config.js in the bundle.

export const PLANT_CONFIG = {
  // EU/German legal imprint requirement (Impressum) — shown small in
  // the page footer. Same field shape as the billing/shipping
  // addresses elsewhere in this tool. A reasonable general field set,
  // not legal advice: confirm your own jurisdiction's exact
  // requirements before relying on it.
  //
  // Sample data is an homage to Tuff Gong's old Kingston pressing plant
  // (Ken Khouri's Federal Records plant, Rita Marley bought it in 1981).
  imprint: {
    recipientName: "Tuff Gong International",
    addressLine1: "220 Marcus Garvey Drive",
    addressLine2: "",
    addressLine3: "",
    city: "Kingston 11",
    stateProvince: "",
    postalCode: "",
    countryCode: "JM",
    phone: "",
    email: "pressing.plant@example.com",
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
    uploadEmail: "pressing.plant@example.com"
  }
};
