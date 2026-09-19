// CONFIG — edit these values for your own production line. Shared across every
// module (tracklist, labels, covers, shipping...), so it lives here once.

export const CONFIG = {
  // Email address customers should send SwissTransfer packages to.
  studioEmail: "cutting@example.com",

  // Physical formats offered in the Release section's dropdown. `order`
  // sets the dropdown's display order; `enabled` toggles a format on or
  // off — a disabled format is simply left out of the dropdown at
  // startup, it stays fully configured everywhere else below (RPM,
  // label, cover-sleeve specs). At least one format must stay enabled.
  //
  // Currently only 7" is enabled, for testing.
  formatCatalogue: {
    order: [12, 10, 7],
    labels: { 12: '12" LP', 10: '10" EP', 7: '7" SP' },
    enabled: { 12: true, 10: false, 7: true }
  },

  // Default RPM per format, applied whenever the format is changed.
  defaultRpm: { 7:45, 10:33, 12:33 },

  // Recommended playing time in minutes, per format / RPM / cut type.
  // "ideal"  — comfortably safe cutting level, no warning shown
  // "max"    — hard ceiling; exceeding this shows a red warning
  // "normal"      — standard release
  // "soundsystem" — shorter, hotter cut (12"/10" club or soundsystem pressings)
  timeLimits: {
    7:  {
      normal:      { ideal:{45:4.5, 33:6.5}, max:{45:6.0, 33:8.0} },
      soundsystem: { ideal:{45:3.5, 33:5.0}, max:{45:4.5, 33:6.0} }
    },
    10: {
      normal:      { ideal:{45:8,   33:12},  max:{45:8,   33:14} },
      soundsystem: { ideal:{45:4.5, 33:7},   max:{45:6,   33:9} }
    },
    12: {
      normal:      { ideal:{45:12,  33:20},  max:{45:15,  33:27} },
      soundsystem: { ideal:{45:10,   33:15},  max:{45:10,   33:16} }
    }
  },

  // Label artwork specs, per format. diameterMm is the trim size (the
  // physical label after cutting); dataSizeMm is the full print file
  // size including bleed on every side — these are independent, given
  // values, not derived from one another, because bleed isn't uniform
  // across formats (7" has 3mm bleed all round; 10"/12" has 3mm too,
  // but a larger trim diameter).
  label: {
    formats: {
      7:  { diameterMm: 92,  dataSizeMm: 98  },
      10: { diameterMm: 100, dataSizeMm: 106 },
      12: { diameterMm: 100, dataSizeMm: 106 }
    },
    // Spindle hole. "Big center" (jukebox-style 45s) only applies to 7".
    centerHoleMm: { normal: 7.4, big: 38 },
    bigCenterFormats: [7],
    // Front-end checks here are best-effort — the studio's backend
    // preprocessor does the real, authoritative validation on upload.
    sizeToleranceMm: 0.5,
    dpi: { min: 300, max: 1200 }
  },

  // Cover / inner sleeve / inlay specs, per format.
  // trimMm — the finished, cut/folded size the customer sees.
  // dataMm — the full flat print file size, delivered opened flat with
  //          front on the right and back on the left, bleed included
  //          (and, for the cover, the spine).
  // Both are independent given values, not derived from one another —
  // trim and data don't reduce to a single uniform bleed figure (the
  // 7" cover is a rigid "box"-style sleeve with a 3mm spine, which
  // skews its numbers differently than a simple bleed allowance would).
  coverSleeve: {
    sizeToleranceMm: 0.5,
    dpi: { min: 300, max: 1200 },
    outerCover: {
      formats: {
        7:  { trimMm: {w:373, h:185}, dataMm: {w:383,   h:201} }, // "box" style, 3mm spine
        10: { trimMm: {w:523, h:260}, dataMm: {w:533,   h:276} },
        12: { trimMm: {w:633, h:312}, dataMm: {w:638.5, h:324} }
      },
      unprintedColors: ["black", "brown", "white"]
    },
    innerSleeve: {
      formats: {
        7:  { trimMm: {w:180, h:180}, dataMm: {w:366, h:186} },
        10: { trimMm: {w:255, h:255}, dataMm: {w:516, h:261} },
        12: { trimMm: {w:304, h:309}, dataMm: {w:614, h:315} }
      },
      unprintedColors: ["black", "brown", "white"],
      centerCutoutDefault: true
    },
    inlay: {
      paperGsm: 170,
      formats: {
        7:  { trimMm: {w:181, h:181}, dataMm: {w:187, h:187} },
        // 10" not supplied yet — guessed by interpolation, replace with
        // the real spec.
        10: { trimMm: {w:250, h:250}, dataMm: {w:256, h:256} },
        12: { trimMm: {w:297, h:297}, dataMm: {w:303, h:303} }
      }
    }
  },

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
      black: 0,
      yellow: 300, red: 300, pink: 300, blue: 300, green: 300, transparent: 300, white: 300,
      random: 300
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
