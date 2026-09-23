// CONFIG — edit these values for your own production line. Shared across every
// module (tracklist, labels, covers, shipping...), so it lives here once.
//
// formats is an array; each entry is a fully self-contained description of
// one physical format — array order is display order. `enabled` toggles a
// format out of the dropdown without removing its configuration; it stays
// fully usable everywhere else. At least one format must stay enabled.
// Release-level data that doesn't vary by format (studio email, vinyl
// colour, locale, info text) stays here as formats' siblings, not nested
// under it.
//
// Currently only 12" and 7" are enabled — 10" is configured but off, for
// testing.

export const CONFIG = {
  // Email address customers should send SwissTransfer packages to.
  studioEmail: "cutting@example.com",

  // Hard-blocks "Send to Plant" (not Save Project, which always stays
  // warning-only) when required artwork is missing or unreadable/
  // unrecognized-format — see tracklist.js's confirmIncompleteSend.
  // Set false to fall back to the old fully-dismissible behavior for
  // every checklist item, including these two.
  blockIncompleteArtworkOnSend: true,

  // Accepted artwork file types — the single source both the file
  // pickers' accept="" attribute and each printed part's "Allowed
  // filetypes" spec line read from, so they can't drift apart. `accept`
  // is the exact string every artwork <input type=file> uses; `labels`
  // is the human-readable list shown in the specs panel (deliberately
  // shorter — JPG/JPEG and TIFF/TIF collapse to one label each).
  artworkFileTypes: {
    accept: ".pdf,.jpg,.jpeg,.tiff,.tif",
    labels: ["PDF", "JPG", "TIFF"]
  },

  formats: [
    {
      id: "12",
      label: '12" LP',
      enabled: true,
      // Default RPM, applied whenever this format is selected — the RPM
      // <select> itself still lets the customer pick either 33⅓ or 45
      // for any format, this is only the pre-filled starting value.
      rpm: 33,
      // Spindle hole, in mm. "big" (jukebox-style 45s) is omitted for
      // formats that don't offer it.
      centerHole: { normal: 7.4 },
      // Recommended playing time in minutes, per cut type and RPM.
      // "ideal" — comfortably safe cutting level, no warning shown
      // "max"   — hard ceiling; exceeding this shows a red warning
      // "normal"      — standard release
      // "soundsystem" — shorter, hotter cut (club/soundsystem pressings)
      timeLimits: {
        normal:      { ideal:{45:12,  33:20}, max:{45:15,  33:27} },
        soundsystem: { ideal:{45:10,  33:15}, max:{45:10,  33:16} }
      },
      // Front-end checks here are best-effort — the studio's backend
      // preprocessor does the real, authoritative validation on upload.
      // `checks` is the artwork checklist's spec table (see
      // buildChecklistRows in lib/print-artwork.js): one entry per row,
      // each an accepted value/list plus a severity: "debug" (never
      // shown to the customer, win or lose — plant/?debug eyes only),
      // "info" (shown, neutral, never blocks), "warn" (shown,
      // dismissible on failure), or "error" (shown, hard-blocks Send to
      // Plant on failure — see CONFIG.blockIncompleteArtworkOnSend). A
      // passing check always displays as "info" unless its severity is
      // "debug", in which case it's invisible either way — see
      // resolveSeverity in print-artwork.js. `required: false` means
      // "checked when present, not flagged when absent" (colorProfile/
      // trimBox); `accepted` is the list/flag of values that pass (e.g.
      // spotColors.accepted: true silently allows spot inks — flip to
      // false to warn on any, since spot colours usually mean an extra
      // plate/cost). PDF version and font-embedding are plant-technical
      // detail a customer doesn't need to see, hence "debug"; encryption
      // is "error" since the plant's system genuinely can't process an
      // encrypted file — the customer needs to see why sending is
      // blocked, not just have it silently refused.
      printCheck: {
        sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 },
        checks: {
          size:         { severity: "warn" },
          resolution:   { severity: "warn" },
          colorMode:    { accepted: ["CMYK"], severity: "warn" },
          spotColors:   { accepted: true,     severity: "warn" },
          colorProfile: { required: false,    severity: "warn" },
          pdfVersion:   { accepted: ["1.4"],  severity: "debug" },
          trimBox:      { required: false,    severity: "warn" },
          encryption:   { severity: "error" },
          fonts:        { requireEmbedded: true, severity: "debug" }
        }
      },
      printableParts: {
        // Bleed added on every outward-facing edge of a part's print
        // file, beyond its trim/end size — default for every part
        // below; a part can override it (outerCover does, below). Data
        // sizes are never hand-entered — see labelDataSizeMm/
        // flatDataMm/foldedDataMm in lib/format-catalogue.js, which
        // derive them from trim/diameter + bleed (+ spine for the
        // cover), so they can't drift out of sync with each other.
        bleedMm: 3,
        // diameterMm is the trim size (the physical label after
        // cutting) — data size (with bleed) is derived, see above.
        label: { diameterMm: 100 },
        // trimMm — the finished, flat-opened size, front on the right
        // and back on the left. For the cover this already includes
        // the spine (panel + spineMm + panel width-wise, spineMm added
        // top and bottom of panel height-wise — a "box"-style spine
        // wraps slightly around all three of those edges). Data size
        // (trim + bleed) is derived — see above.
        outerCover: {
          trimMm: {w:633, h:318}, spineMm: 3, bleedMm: 5, paperGsm: 300,
          unprintedColors: ["black", "brown", "white"]
        },
        // trimMm here is ONE folded pocket's finished size, not the
        // flat spread — foldedDataMm doubles the width (front+back
        // opened flat side by side) before adding bleed.
        innerSleeve: {
          trimMm: {w:304, h:309}, paperGsm: 135,
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        inlay: {
          trimMm: {w:297, h:297},
          paperGsm: 170
        }
      }
    },
    {
      id: "10",
      label: '10" EP',
      enabled: false,
      rpm: 33,
      centerHole: { normal: 7.4 },
      timeLimits: {
        normal:      { ideal:{45:8,   33:12}, max:{45:8,   33:14} },
        soundsystem: { ideal:{45:4.5, 33:7},  max:{45:6,   33:9} }
      },
      printCheck: {
        sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 },
        checks: {
          size:         { severity: "warn" },
          resolution:   { severity: "warn" },
          colorMode:    { accepted: ["CMYK"], severity: "warn" },
          spotColors:   { accepted: true,     severity: "warn" },
          colorProfile: { required: false,    severity: "warn" },
          pdfVersion:   { accepted: ["1.4"],  severity: "debug" },
          trimBox:      { required: false,    severity: "warn" },
          encryption:   { severity: "error" },
          fonts:        { requireEmbedded: true, severity: "debug" }
        }
      },
      printableParts: {
        bleedMm: 3,
        label: { diameterMm: 100 },
        outerCover: {
          trimMm: {w:523, h:266}, spineMm: 3, bleedMm: 5, paperGsm: 300,
          unprintedColors: ["black", "brown", "white"]
        },
        innerSleeve: {
          trimMm: {w:255, h:255}, paperGsm: 135,
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        // Not supplied yet — guessed by interpolation, replace with the
        // real spec.
        inlay: {
          trimMm: {w:250, h:250},
          paperGsm: 170
        }
      }
    },
    {
      id: "7",
      label: '7" SP',
      enabled: true,
      rpm: 45,
      centerHole: { normal: 7.4, big: 38 },
      timeLimits: {
        normal:      { ideal:{45:4.5, 33:6.5}, max:{45:6.0, 33:8.0} },
        soundsystem: { ideal:{45:3.5, 33:5.0}, max:{45:4.5, 33:6.0} }
      },
      printCheck: {
        sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 },
        checks: {
          size:         { severity: "warn" },
          resolution:   { severity: "warn" },
          colorMode:    { accepted: ["CMYK"], severity: "warn" },
          spotColors:   { accepted: true,     severity: "warn" },
          colorProfile: { required: false,    severity: "warn" },
          pdfVersion:   { accepted: ["1.4"],  severity: "debug" },
          trimBox:      { required: false,    severity: "warn" },
          encryption:   { severity: "error" },
          fonts:        { requireEmbedded: true, severity: "debug" }
        }
      },
      printableParts: {
        bleedMm: 3,
        label: { diameterMm: 92 },
        // "box" style, 3mm spine.
        outerCover: {
          trimMm: {w:373, h:191}, spineMm: 3, bleedMm: 5, paperGsm: 300,
          unprintedColors: ["black", "brown", "white"]
        },
        innerSleeve: {
          trimMm: {w:180, h:180}, paperGsm: 135,
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        inlay: {
          trimMm: {w:181, h:181},
          paperGsm: 170
        }
      }
    }
  ],

  // Vinyl colour options. standardColor is the default (no surcharge,
  // no minimum). basicColors is the editable list of solid colour
  // options — add/remove/rename entries as the pressing plant's actual
  // stock changes. "random" (mixed/recycled colour vinyl) is a distinct
  // option, not part of the list, since it isn't a specific colour.
  // minOrderQty gives each option's minimum order quantity; missing
  // entries default to 0 (no minimum).
  vinylColor: {
    standardColor: "black",
    basicColors: ["yellow", "red", "pink", "blue", "green", "transparent", "white"],
    minOrderQty: {
      black: 1,
      yellow: 100, red: 100, pink: 100, blue: 100, green: 100, transparent: 100, white: 100,
      random: 100
    }
  },

  // UI language for the info-panel text below. Only "en" has content
  // today — German and Spanish are planned; once real translations
  // exist, add a "de"/"es" key next to "en" in each infoText entry and
  // switch this. The lookup already falls back to "en" for any key a
  // locale doesn't have yet, so nothing else needs to change.
  locale: "en",

  // Expert-reference text shown when someone clicks an element's "i"
  // icon — collapsed by default so the day-to-day UI stays terse for
  // customer service and the cutting engineer. Keyed by element, then
  // by locale. Edit freely per pressing plant; this is the one place
  // that text lives.
  infoText: {
    bigCenter: {
      en: `38mm center hole, jukebox style. First choice for 7" pressings running 45 RPM — needs a center adapter for playback.`
    },
    labelArtwork: {
      en: `Accepted files: PDF, JPG, TIFF. Colour mode: CMYK. Max. ink coverage: 200%. Colour profile: ISO ECI v2 300.`
    }
  }
};
