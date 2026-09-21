# Catalogue Schema Restructure (sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure `src/config.js`'s `CONFIG` object so format is the primary axis (an array of fully self-contained format objects, each owning its own printable-part specs), and split `src/modules/cover-sleeve.js` into three independent modules (`cover.js`, `inner-sleeve.js`, `inlay.js`) matching the one-file-per-artifact-type pattern the rest of `src/modules/` already follows.

**Architecture:** `CONFIG.formats` becomes an array of `{id, label, enabled, rpm, centerHole, timeLimits, printCheck, printableParts}` objects. A new pure lib, `src/lib/format-catalogue.js`, provides `getFormat`/`enabledFormats`/`firstEnabledFormat` lookups so every module reads the same format object instead of reaching across 2-3 separate CONFIG domains. `cover-sleeve.js`'s DOM wiring splits into three files, each owning its own artwork-slot scaffolding (accepted duplication, not shared — see Decision 8 below), each importing `getFormat` to read its own slice of `printableParts`. `project.json`'s saved shape does not change (Decision 10) — only `config.js` and module boundaries move.

**Tech Stack:** Plain ES2020+ JS, no runtime dependencies, `node --test` for unit tests, `build/build.js`'s manual file-concatenation build (no bundler — see Global Constraints below).

**Spec:** `docs/superpowers/specs/2026-09-20-catalogue-schema-restructure-design.md`

## Global Constraints

- **No runtime dependencies, no npm installs.** Every new/changed file is plain JS; `node --test` for tests (Node ≥18 built-in).
- **`dist/index.html` stays a single, self-contained file.** No external requests. Built by `node build/build.js`.
- **`build/build.js` flattens every source file into one shared top-level scope** (see its own header comment) — two files cannot declare the same top-level `const`/`let`/function name, or the build produces a `SyntaxError` (duplicate `const`) or a silent last-writer-wins collision (duplicate `function`). Every new file below uses a unique prefix for its module-local names for exactly this reason (e.g. `COVER_PX_PER_MM`, `INNER_SLEEVE_PX_PER_MM`, `INLAY_PX_PER_MM` — never a shared `PX_PER_MM`, which `labels.js` already occupies).
- **`build/build.js`'s `FILES` array is the only place that decides what's actually bundled** — it strips `import` lines unconditionally without checking the import target is listed, so a file used via `import` but missing from `FILES` silently becomes an undefined reference in `dist/index.html` at runtime, not a build error. Every new file created in this plan MUST be added to `FILES`, dependencies before dependents.
- **KISS. No premature abstraction.** `src/lib/*.js` stays pure/DOM-free; `src/modules/*.js` stays DOM wiring only.
- **Decision 1 (spec):** Format is the primary axis. `CONFIG.formats` is an array; each entry is fully self-contained. Release-level data that doesn't vary by format (`studioEmail`, `locale`, `infoText`, `vinylColor`) stays as siblings of `formats`.
- **Decision 3 (spec):** `centerHole` lives at format level. A format without a big-center option omits the `big` key entirely.
- **Decision 4 (spec):** `printCheck` (size tolerance + DPI range) is one shared value per format, not duplicated per printable part.
- **Decision 5 (spec):** Every format's `printableParts` entries are fully self-contained — values are duplicated across formats even where identical today. This is an accepted tradeoff, not something to "clean up."
- **Decision 8 (spec):** `cover-sleeve.js` splits into three fully independent files, each with its own copy of the artwork-slot scaffolding. Explicit choice: duplication over a shared helper, so each part can diverge later without fighting a forced abstraction.
- **Decision 9 (spec, corrected):** Format `id` is a string, matching `<select>.value`. This is a no-op for already-saved `project.json` files — `document.getElementById("format").value` was already a string before this refactor (DOM `<select>` values are always strings; today's `${f}` template literal in `populateFormatOptions` already stringified the numeric format). All four `parseInt(document.getElementById("format").value, 10)` call sites (`tracklist.js:257`, `tracklist.js:447`, `cover-sleeve.js:30`, `labels.js:22`) are dropped — pass the raw string straight through.
- **Deviation from spec, confirmed with maintainer:** the spec's schema note collapsing `timeLimits` to a flat number per format (dropping the RPM key) is **wrong** and is NOT implemented by this plan. RPM is a live per-side `<select>` choice (33⅓ or 45, `src/index.html`'s `rpm-${side}` select), not fixed by format — `defaultRpm`/a format's `rpm` field is only the pre-filled default. `timeLimits` stays keyed by `mode` → `ideal`/`max` → `rpm`, exactly as today, just nested under each format object instead of a top-level map. `computeStatus`'s signature changes from `(timeLimits, format, rpm, mode, seconds)` to `(timeLimits, rpm, mode, seconds)` since the caller now resolves the one format's `timeLimits` table before calling in (via `getFormat`), so `computeStatus` no longer needs to index by format itself.
- **Decision 10 (spec):** `project.json`'s saved shape is unaffected. The single `coverSleeve: {cover, innerSleeve, inlay}` key is preserved — the three new modules' `collect*`/`apply*` functions are orchestrated by `tracklist.js` into/out of that one JSON key, same as `collectCoverSleeve()` does today.
- **Explicitly out of scope (spec):** price/expense data, inlay page counts/booklets, any schema-validation layer.

---

## File Structure

**New files:**
- `src/lib/format-catalogue.js` — pure `getFormat`/`enabledFormats`/`firstEnabledFormat` lookups over `CONFIG.formats`.
- `tests/format-catalogue.test.js` — unit tests for the above.
- `src/modules/cover.js` — outer cover artwork (printed/plain-colour/none). Replaces the cover-only third of `cover-sleeve.js`.
- `src/modules/inner-sleeve.js` — inner sleeve artwork (printed/plain-colour, optional center cut-out). Replaces the inner-sleeve third of `cover-sleeve.js`.
- `src/modules/inlay.js` — optional double-sided inlay (front + back). Replaces the inlay third of `cover-sleeve.js`.

**Modified files:**
- `src/config.js` — rewritten into the format-array schema.
- `src/lib/playing-time.js` — `computeStatus` drops its `format` parameter.
- `tests/playing-time.test.js` — fixture/call-site update for the new signature.
- `src/modules/labels.js` — reads format specs via `getFormat` instead of `CONFIG.label.*`.
- `src/modules/tracklist.js` — reads format specs via `getFormat`/`firstEnabledFormat`; imports/calls the three new cover-sleeve modules instead of the old one.
- `src/app.js` — imports/calls `initCover`/`initInnerSleeve`/`initInlay` instead of `initCoverSleeve`.
- `build/build.js` — `FILES` array: add `src/lib/format-catalogue.js`, remove `src/modules/cover-sleeve.js`, add `src/modules/cover.js`/`inner-sleeve.js`/`inlay.js` in its place.
- `src/index.html` — one stale comment (`<!-- options populated from CONFIG.formatCatalogue at init -->`) corrected. No DOM structure changes (Decision: HTML template ownership moves between JS files, not the markup itself).

**Deleted files:**
- `src/modules/cover-sleeve.js` — fully replaced by the three new files.

---

## Task 0: Save a pre-refactor project zip for the final regression check

This produces the fixture used by Task 10's manual round-trip test — it must be captured **before** any code in this plan changes, using today's unmodified app, so it's a genuine "old-shape" save file.

**Files:** none changed — this is a manual browser step.

- [ ] **Step 1: Build and open the current app**

```bash
cd /Users/ameise/src/record-orderbook
node build/build.js
open dist/index.html
```

- [ ] **Step 2: Fill in a minimal release and save it**

In the opened page: set Catalogue Number to `PLANTEST001`, leave Format at its default (7" SP), add a track title on Side A, check "Big center" if visible, toggle the inner sleeve to "printed" and the cover to "printed" (no need to actually attach artwork files — an empty artwork slot is fine, the point is exercising the `coverSleeve` JSON shape, not file content). Click "Save Project" (in `tracklist.js`'s `saveProject`). Save the downloaded zip as `/tmp/claude-501/-Users-ameise-src-record-orderbook/*/scratchpad/pre-refactor-test.zip` (your session's scratchpad dir) or any path you'll remember.

- [ ] **Step 3: Note this task is done**

No commit — this is a throwaway fixture for Task 10, not a repo file.

---

## Task 1: `src/lib/format-catalogue.js` — pure format lookups

**Files:**
- Create: `src/lib/format-catalogue.js`
- Test: `tests/format-catalogue.test.js`

**Interfaces:**
- Produces: `getFormat(config, id)` → format object or `undefined`. `enabledFormats(config)` → array of format objects, `enabled: true` only, in array order. `firstEnabledFormat(config)` → first enabled format's `id` (string), or throws `Error("CONFIG.formats: at least one format must be enabled")`.

- [ ] **Step 1: Write the failing tests**

Create `tests/format-catalogue.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { getFormat, enabledFormats, firstEnabledFormat } from "../src/lib/format-catalogue.js";

const config = {
  formats: [
    { id: "12", label: '12" LP', enabled: true },
    { id: "10", label: '10" EP', enabled: false },
    { id: "7",  label: '7" SP',  enabled: true }
  ]
};

test("getFormat returns the format matching id", () => {
  assert.deepEqual(getFormat(config, "7"), { id: "7", label: '7" SP', enabled: true });
});

test("getFormat returns undefined for an unknown id", () => {
  assert.equal(getFormat(config, "9"), undefined);
});

test("enabledFormats filters to enabled:true, keeping array order", () => {
  const result = enabledFormats(config);
  assert.deepEqual(result.map(f => f.id), ["12", "7"]);
});

test("firstEnabledFormat returns the first enabled format's id", () => {
  assert.equal(firstEnabledFormat(config), "12");
});

test("firstEnabledFormat throws when no format is enabled", () => {
  const allDisabled = { formats: [{ id: "7", label: '7" SP', enabled: false }] };
  assert.throws(() => firstEnabledFormat(allDisabled), /at least one format must be enabled/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/format-catalogue.test.js`
Expected: FAIL — `Cannot find module '../src/lib/format-catalogue.js'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/format-catalogue.js`:

```javascript
// Pure lookups over CONFIG.formats — no DOM, no CONFIG import (the
// caller passes CONFIG in, so this stays testable independently of
// where CONFIG lives). See docs/superpowers/specs/2026-09-20-catalogue-
// schema-restructure-design.md for the schema this operates on: `formats`
// is an array, each entry a fully self-contained description of one
// physical format; array order is display order.

export function getFormat(config, id){
  return config.formats.find(f => f.id === id);
}

export function enabledFormats(config){
  return config.formats.filter(f => f.enabled);
}

export function firstEnabledFormat(config){
  const first = enabledFormats(config)[0];
  if(!first) throw new Error("CONFIG.formats: at least one format must be enabled");
  return first.id;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/format-catalogue.test.js`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/format-catalogue.js tests/format-catalogue.test.js
git commit -m "add format-catalogue lib: pure getFormat/enabledFormats/firstEnabledFormat"
```

---

## Task 2: `computeStatus` drops its `format` parameter

Callers will resolve the single format's `timeLimits` table themselves (via `getFormat`, Task 8) before calling in, so `computeStatus` no longer needs to index by format.

**Files:**
- Modify: `src/lib/playing-time.js`
- Test: `tests/playing-time.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `computeStatus(timeLimits, rpm, mode, seconds)` where `timeLimits` is shaped `{ [mode]: { ideal:{[rpm]:min}, max:{[rpm]:min} } }` — one format's table. Return shape unchanged: `{level, maxMin, idealMin, minutes}`.

- [ ] **Step 1: Update the test to the new signature (this is the "failing test" step — it fails against the current 5-arg implementation)**

Replace `tests/playing-time.test.js` in full:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus } from "../src/lib/playing-time.js";

const timeLimits = {
  normal: { ideal: { 33: 18, 45: 10 }, max: { 33: 24, 45: 14 } },
};

test("computeStatus returns ok under the ideal threshold", () => {
  const r = computeStatus(timeLimits, 33, "normal", 17 * 60);
  assert.equal(r.level, "ok");
});

test("computeStatus returns warn between ideal and max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 19 * 60);
  assert.equal(r.level, "warn");
});

test("computeStatus returns danger past max", () => {
  const r = computeStatus(timeLimits, 33, "normal", 25 * 60);
  assert.equal(r.level, "danger");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/playing-time.test.js`
Expected: FAIL — `limits.max[rpm]` reads `undefined` because the old 5-arg `computeStatus(timeLimits, format, rpm, mode, seconds)` is being called with only 4 args (`format` slot now holds `rpm`, shifting everything).

- [ ] **Step 3: Update the implementation**

Replace `src/lib/playing-time.js` in full:

```javascript
// Pure playing-time threshold logic — no DOM, no CONFIG import (the
// caller passes in the specific format's timeLimits table, via
// src/lib/format-catalogue.js's getFormat, so this stays testable and
// reusable regardless of where CONFIG lives).
//
// timeLimits shape: { [mode]: { ideal:{[rpm]:min}, max:{[rpm]:min} } } —
// one format's table; rpm is a live per-side choice, not fixed by
// format, hence the extra key level under ideal/max.

export function computeStatus(timeLimits, rpm, mode, seconds){
  const limits = timeLimits[mode];
  const maxMin = limits.max[rpm];
  const idealMin = limits.ideal[rpm];
  const minutes = seconds/60;
  let level = "ok";
  if(minutes > maxMin) level = "danger";
  else if(minutes > idealMin) level = "warn";
  return {level, maxMin, idealMin, minutes};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/playing-time.test.js`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/playing-time.js tests/playing-time.test.js
git commit -m "playing-time: drop format param from computeStatus, caller resolves it"
```

Note: this commit temporarily breaks `src/modules/tracklist.js`'s one call site (`statusFor`, currently `computeStatus(CONFIG.timeLimits, format, rpm, mode, seconds)`), since `tests/` doesn't exercise DOM modules and `node --test` won't catch it. Task 8 fixes the call site. Don't run `node build/build.js` and open the app between this commit and Task 8's — the recompute path will throw.

---

## Task 3: Rewrite `src/config.js` into the format-array schema

**Files:**
- Modify: `src/config.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `CONFIG.formats` (array of `{id, label, enabled, rpm, centerHole, timeLimits, printCheck, printableParts}`), plus unchanged siblings `studioEmail`, `vinylColor`, `locale`, `infoText`. Removes `formatCatalogue`, `defaultRpm`, `timeLimits` (top-level), `label`, `coverSleeve`.

This isn't unit-testable directly (`config.js` is a plain data object, no pure-lib test target per CLAUDE.md's scoping) — correctness is verified by value-for-value comparison against the current file (below) plus the full test suite + build in later tasks, since `tests/format-catalogue.test.js` and the DOM modules exercise this shape once wired up.

- [ ] **Step 1: Replace `src/config.js` in full**

Every numeric value below is carried over unchanged from the current `src/config.js` — only the shape changes (format becomes the primary array axis; `printCheck`/`unprintedColors`/`centerCutoutDefault`/`paperGsm` move from a single shared value into each format's own `printableParts`/`printCheck`, per Decisions 4 and 5).

```javascript
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
      printCheck: { sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 } },
      printableParts: {
        // diameterMm is the trim size (the physical label after
        // cutting); dataSizeMm is the full print file size including
        // bleed on every side.
        label: { diameterMm: 100, dataSizeMm: 106 },
        // trimMm — the finished, cut/folded size the customer sees.
        // dataMm — the full flat print file size, delivered opened flat
        //          with front on the right and back on the left, bleed
        //          included (and, for the cover, the spine).
        outerCover: {
          trimMm: {w:633, h:312}, dataMm: {w:638.5, h:324},
          unprintedColors: ["black", "brown", "white"]
        },
        innerSleeve: {
          trimMm: {w:304, h:309}, dataMm: {w:614, h:315},
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        inlay: {
          trimMm: {w:297, h:297}, dataMm: {w:303, h:303},
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
      printCheck: { sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 } },
      printableParts: {
        label: { diameterMm: 100, dataSizeMm: 106 },
        outerCover: {
          trimMm: {w:523, h:260}, dataMm: {w:533, h:276},
          unprintedColors: ["black", "brown", "white"]
        },
        innerSleeve: {
          trimMm: {w:255, h:255}, dataMm: {w:516, h:261},
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        // Not supplied yet — guessed by interpolation, replace with the
        // real spec.
        inlay: {
          trimMm: {w:250, h:250}, dataMm: {w:256, h:256},
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
      printCheck: { sizeToleranceMm: 0.5, dpi: { min: 300, max: 1200 } },
      printableParts: {
        label: { diameterMm: 92, dataSizeMm: 98 },
        // "box" style, 3mm spine — trim and data don't reduce to a
        // single uniform bleed figure the way a simple allowance would.
        outerCover: {
          trimMm: {w:373, h:185}, dataMm: {w:383, h:201},
          unprintedColors: ["black", "brown", "white"]
        },
        innerSleeve: {
          trimMm: {w:180, h:180}, dataMm: {w:366, h:186},
          unprintedColors: ["black", "brown", "white"],
          centerCutoutDefault: true
        },
        inlay: {
          trimMm: {w:181, h:181}, dataMm: {w:187, h:187},
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
```

- [ ] **Step 2: Verify no leftover references to the old shape exist yet in config.js itself**

Run: `grep -n "formatCatalogue\|defaultRpm" src/config.js`
Expected: no output (both removed).

- [ ] **Step 3: Commit**

```bash
git add src/config.js
git commit -m "config: restructure CONFIG.formats as the primary axis (sub-project A)"
```

Note: this commit breaks every consumer of the old `CONFIG.formatCatalogue`/`CONFIG.defaultRpm`/`CONFIG.timeLimits`/`CONFIG.label`/`CONFIG.coverSleeve` shape (`tracklist.js`, `labels.js`, `cover-sleeve.js`) until Tasks 4-8 land. `node --test` still passes (none of those are unit-tested), but don't build+open the app until Task 9.

---

## Task 4: `src/modules/labels.js` reads format specs via `getFormat`

**Files:**
- Modify: `src/modules/labels.js`

**Interfaces:**
- Consumes: `getFormat(config, id)` from `src/lib/format-catalogue.js` (Task 1).

- [ ] **Step 1: Add the import**

In `src/modules/labels.js`, after the existing `import { CONFIG } from "../config.js";` line:

```javascript
import { getFormat } from "../lib/format-catalogue.js";
```

- [ ] **Step 2: Update `currentFormat()` (line 21-23) — drop the now-unneeded `parseInt`**

Old:
```javascript
function currentFormat(){
  return parseInt(document.getElementById("format").value, 10);
}
```

New:
```javascript
function currentFormat(){
  return document.getElementById("format").value;
}
```

- [ ] **Step 3: Update `formatSpec()` (line 25-27)**

Old:
```javascript
function formatSpec(){
  return CONFIG.label.formats[currentFormat()];
}
```

New:
```javascript
function formatSpec(){
  return getFormat(CONFIG, currentFormat()).printableParts.label;
}
```

- [ ] **Step 4: Update `centerHoleMm()` (line 29-33)**

Old:
```javascript
function centerHoleMm(){
  const big = CONFIG.label.bigCenterFormats.includes(currentFormat())
    && document.getElementById("bigCenter").checked;
  return big ? CONFIG.label.centerHoleMm.big : CONFIG.label.centerHoleMm.normal;
}
```

New:
```javascript
function centerHoleMm(){
  const centerHole = getFormat(CONFIG, currentFormat()).centerHole;
  const big = !!centerHole.big && document.getElementById("bigCenter").checked;
  return big ? centerHole.big : centerHole.normal;
}
```

- [ ] **Step 5: Update the `validateArtwork` call inside `handleFile()` (around line 161-163)**

Old:
```javascript
  const spec = formatSpec();
  const result = validateArtwork(
    parsed, {w:spec.dataSizeMm, h:spec.dataSizeMm}, CONFIG.label.sizeToleranceMm, CONFIG.label.dpi.min, CONFIG.label.dpi.max);
```

New:
```javascript
  const spec = formatSpec();
  const printCheck = getFormat(CONFIG, currentFormat()).printCheck;
  const result = validateArtwork(
    parsed, {w:spec.dataSizeMm, h:spec.dataSizeMm}, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
```

- [ ] **Step 6: Update `updateBigCenterVisibility` inside `initLabels()` (around line 212-214)**

Old:
```javascript
  const updateBigCenterVisibility = ()=>{
    bigCenterWrap.classList.toggle("hidden", !CONFIG.label.bigCenterFormats.includes(currentFormat()));
  };
```

New:
```javascript
  const updateBigCenterVisibility = ()=>{
    bigCenterWrap.classList.toggle("hidden", !getFormat(CONFIG, currentFormat()).centerHole.big);
  };
```

- [ ] **Step 7: Verify no leftover old-shape references**

Run: `grep -n "CONFIG\.label\." src/modules/labels.js`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/modules/labels.js
git commit -m "labels: read format specs via getFormat instead of CONFIG.label.*"
```

---

## Task 5: New module `src/modules/cover.js`

Extracted from `src/modules/cover-sleeve.js`'s cover-only third. `src/modules/cover-sleeve.js` is not deleted yet (Task 7 deletes it, after all three extractions exist) — leave it untouched in this task.

**Files:**
- Create: `src/modules/cover.js`

**Interfaces:**
- Consumes: `getFormat` (Task 1), `CONFIG` (Task 3's shape — `getFormat(CONFIG, id).printableParts.outerCover`, `.printCheck`).
- Produces (consumed by `tracklist.js` in Task 8, and `app.js` in Task 9): `initCover()`, `collectCover()` → `{mode, color, simprint, fileName}`, `applyCover(data, fileMap)`, `collectCoverFiles()` → `Promise<Array<{name, data}>>`.

- [ ] **Step 1: Create `src/modules/cover.js`**

```javascript
// Cover module — outer cover artwork (printed / plain colour / none),
// delivered as a single flat print file with front on the right and back
// on the left. Split out of the former cover-sleeve.js along with
// inner-sleeve.js and inlay.js (see the catalogue schema restructure
// design spec, Decision 8) — each owns its own copy of the artwork-slot
// scaffolding on purpose, so each part can diverge later without
// fighting a forced shared abstraction.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// Canvas render resolution in pixels-per-mm — named distinctly per
// printed-part module (see build/build.js's header comment: everything
// flattens into one shared top-level scope, so labels.js's PX_PER_MM and
// inner-sleeve.js's/inlay.js's own constants can't collide with this).
const COVER_PX_PER_MM = 4;

// On-screen preview cap, in px. A flat cover spread can be 600+mm wide —
// displaying that at true CSS-mm size would make the preview several
// times wider than a browser window. Canvas render resolution above is
// unaffected by this.
const COVER_PREVIEW_MAX_W = 640;

function coverCurrentFormat(){
  return document.getElementById("format").value;
}

function coverSpec(){
  return getFormat(CONFIG, coverCurrentFormat()).printableParts.outerCover;
}

function renderCoverWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

function createCoverArtworkSlot(){
  const input = document.getElementById("coverinput");
  const meta = document.getElementById("covermeta");
  const preview = document.getElementById("coverpreview");
  const wrap = document.getElementById("coverpreviewwrap");
  const canvas = document.getElementById("coversim");
  const warningsList = document.getElementById("coverwarnings");
  const simChk = document.getElementById("coversimprint");
  const caption = document.getElementById("covercaption");
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = coverSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * COVER_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * COVER_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = COVER_PREVIEW_MAX_W+"px";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = coverSpec();
    const inset = computeSpreadInsetPx(canvas.width, canvas.height, dataMm, trimMm);
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(inset.x, inset.y, canvas.width - 2*inset.x, canvas.height - 2*inset.y);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
  }

  async function handleFile(f){
    file = f;
    meta.classList.remove("empty");
    meta.textContent = "file: " + f.name + " — checking…";
    if(url) URL.revokeObjectURL(url);

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm } = coverSpec();
    const printCheck = getFormat(CONFIG, coverCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderCoverWarnings(warningsList, result);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&view=Fit"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    meta.textContent = "file: " + f.name;
    draw();
  }

  document.getElementById("coverpick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, getFile: ()=> file, setFile: handleFile };
}

function coverSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"cover", ext: fileExt(file.name)});
}

async function collectCoverSlotFile(){
  const file = coverSlot.getFile();
  if(!file) return null;
  return { name: coverSlotFileName(file), data: await file.arrayBuffer() };
}

let coverSlot;

function updateCoverMode(){
  const printed = document.getElementById("cover-printed").checked;
  const unprinted = document.getElementById("cover-unprinted").checked;
  document.getElementById("coverPrintedBody").classList.toggle("hidden", !printed);
  document.getElementById("coverColorWrap").classList.toggle("hidden", !unprinted);
}

export function initCover(){
  coverSlot = createCoverArtworkSlot();
  coverSlot.updateSizing();
  coverSlot.draw();

  document.getElementById("format").addEventListener("change", ()=>{
    coverSlot.updateSizing();
    coverSlot.draw();
  });

  document.getElementById("cover-printed").addEventListener("change", updateCoverMode);
  document.getElementById("cover-unprinted").addEventListener("change", updateCoverMode);
  document.getElementById("cover-none").addEventListener("change", updateCoverMode);
  updateCoverMode();
}

function setCoverFileNamePlaceholder(name){
  const meta = document.getElementById("covermeta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "file: " + name + " — please re-select this file (not stored in the order file)";
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

// fileMap: canonical package name -> File, from a reopened project zip
// (see tracklist.js's loadProject). If the slot's stored name is in the
// map, the file gets re-attached directly; otherwise it falls back to
// the "please re-select" placeholder.
function applyCoverSlotFile(fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) coverSlot.setFile(file);
  else setCoverFileNamePlaceholder(fileName);
}

// Exported for the tracklist module's project save/load, same
// collect/apply pattern as vinyl-color.js/shipping-billing.js. File
// contents aren't stored in the JSON, only the canonical package name —
// collectCoverFiles below builds the exact same name for the actual
// file. A non-null fileName always means the file is actually in the
// package, which is what lets the tracklist/order-summary exports build
// their file manifest straight from this data, no DOM re-check needed.
export function collectCover(){
  const coverPrinted = document.getElementById("cover-printed").checked;
  const file = coverSlot.getFile();
  return {
    mode: coverPrinted ? "printed"
        : document.getElementById("cover-unprinted").checked ? "unprinted" : "none",
    color: document.getElementById("coverColor").value,
    simprint: document.getElementById("coversimprint").checked,
    fileName: (coverPrinted && file) ? coverSlotFileName(file) : null
  };
}

export function applyCover(data, fileMap){
  const c = data || {};
  document.getElementById("cover-printed").checked = c.mode === "printed";
  document.getElementById("cover-unprinted").checked = c.mode === "unprinted";
  document.getElementById("cover-none").checked = c.mode !== "printed" && c.mode !== "unprinted";
  document.getElementById("coverColor").value = c.color || "white";
  document.getElementById("coversimprint").checked = !!c.simprint;
  applyCoverSlotFile(c.fileName, fileMap);
  updateCoverMode();
  coverSlot.updateSizing();
  coverSlot.draw();
}

// Exported for the tracklist module's package export, same pattern as
// labels.js's collectLabelFiles — the only interface between modules.
export async function collectCoverFiles(){
  const files = [];
  if(document.getElementById("cover-printed").checked){
    const cover = await collectCoverSlotFile();
    if(cover) files.push(cover);
  }
  return files;
}
```

- [ ] **Step 2: Sanity-check for syntax errors**

Run: `node --check src/modules/cover.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add src/modules/cover.js
git commit -m "add cover.js, extracted from cover-sleeve.js (1 of 3)"
```

---

## Task 6: New module `src/modules/inner-sleeve.js`

Same extraction pattern as Task 5, for the inner-sleeve third of `cover-sleeve.js`.

**Files:**
- Create: `src/modules/inner-sleeve.js`

**Interfaces:**
- Consumes: `getFormat` (Task 1), `CONFIG` (Task 3 — `getFormat(CONFIG, id).printableParts.innerSleeve`, `.printCheck`).
- Produces (consumed by `tracklist.js` in Task 8, `app.js` in Task 9): `initInnerSleeve()`, `collectInnerSleeve()` → `{mode, color, cutout, simprint, fileName}`, `applyInnerSleeve(data, fileMap)`, `collectInnerSleeveFiles()` → `Promise<Array<{name, data}>>`.

- [ ] **Step 1: Create `src/modules/inner-sleeve.js`**

```javascript
// Inner Sleeve module — printed or plain-colour inner sleeve, optional
// center cut-out. Delivered as a single flat print file with front on
// the right and back on the left. Split out of the former
// cover-sleeve.js along with cover.js and inlay.js (see the catalogue
// schema restructure design spec, Decision 8) — each owns its own copy
// of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// See cover.js's identical comment — flattened build, must stay unique.
const INNER_SLEEVE_PX_PER_MM = 4;
const INNER_SLEEVE_PREVIEW_MAX_W = 640;

function innerSleeveCurrentFormat(){
  return document.getElementById("format").value;
}

function innerSleeveSpec(){
  return getFormat(CONFIG, innerSleeveCurrentFormat()).printableParts.innerSleeve;
}

function renderInnerSleeveWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

function createInnerSleeveArtworkSlot(){
  const input = document.getElementById("innersleeveinput");
  const meta = document.getElementById("innersleevemeta");
  const preview = document.getElementById("innersleevepreview");
  const wrap = document.getElementById("innersleevepreviewwrap");
  const canvas = document.getElementById("innersleevesim");
  const warningsList = document.getElementById("innersleevewarnings");
  const simChk = document.getElementById("innersleevesimprint");
  const caption = document.getElementById("innersleevecaption");
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = innerSleeveSpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * INNER_SLEEVE_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * INNER_SLEEVE_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
    caption.style.width = "100%"; caption.style.maxWidth = INNER_SLEEVE_PREVIEW_MAX_W+"px";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = innerSleeveSpec();
    const inset = computeSpreadInsetPx(canvas.width, canvas.height, dataMm, trimMm);
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(inset.x, inset.y, canvas.width - 2*inset.x, canvas.height - 2*inset.y);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
  }

  async function handleFile(f){
    file = f;
    meta.classList.remove("empty");
    meta.textContent = "file: " + f.name + " — checking…";
    if(url) URL.revokeObjectURL(url);

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm } = innerSleeveSpec();
    const printCheck = getFormat(CONFIG, innerSleeveCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderInnerSleeveWarnings(warningsList, result);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&view=Fit"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    meta.textContent = "file: " + f.name;
    draw();
  }

  document.getElementById("innersleevepick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, getFile: ()=> file, setFile: handleFile };
}

function innerSleeveSlotFileName(file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"innersleeve", ext: fileExt(file.name)});
}

async function collectInnerSleeveSlotFile(){
  const file = innerSleeveSlot.getFile();
  if(!file) return null;
  return { name: innerSleeveSlotFileName(file), data: await file.arrayBuffer() };
}

let innerSleeveSlot;

function updateInnerSleeveMode(){
  const unprinted = document.getElementById("innersleeve-unprinted").checked;
  document.getElementById("innersleevePrintedBody").classList.toggle("hidden", unprinted);
  document.getElementById("innersleeveColorWrap").classList.toggle("hidden", !unprinted);
}

export function initInnerSleeve(){
  innerSleeveSlot = createInnerSleeveArtworkSlot();
  innerSleeveSlot.updateSizing();
  innerSleeveSlot.draw();

  document.getElementById("format").addEventListener("change", ()=>{
    innerSleeveSlot.updateSizing();
    innerSleeveSlot.draw();
  });

  document.getElementById("innersleeve-printed").addEventListener("change", updateInnerSleeveMode);
  document.getElementById("innersleeve-unprinted").addEventListener("change", updateInnerSleeveMode);
  updateInnerSleeveMode();
}

function setInnerSleeveFileNamePlaceholder(name){
  const meta = document.getElementById("innersleevemeta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "file: " + name + " — please re-select this file (not stored in the order file)";
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

function applyInnerSleeveSlotFile(fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) innerSleeveSlot.setFile(file);
  else setInnerSleeveFileNamePlaceholder(fileName);
}

export function collectInnerSleeve(){
  const innerSleevePrinted = document.getElementById("innersleeve-printed").checked;
  const file = innerSleeveSlot.getFile();
  return {
    mode: innerSleevePrinted ? "printed" : "unprinted",
    color: document.getElementById("innersleeveColor").value,
    cutout: document.getElementById("innersleeveCutout").checked,
    simprint: document.getElementById("innersleevesimprint").checked,
    fileName: (innerSleevePrinted && file) ? innerSleeveSlotFileName(file) : null
  };
}

export function applyInnerSleeve(data, fileMap){
  const is = data || {};
  document.getElementById("innersleeve-printed").checked = is.mode === "printed";
  document.getElementById("innersleeve-unprinted").checked = is.mode !== "printed";
  document.getElementById("innersleeveColor").value = is.color || "white";
  document.getElementById("innersleeveCutout").checked = is.cutout !== false;
  document.getElementById("innersleevesimprint").checked = !!is.simprint;
  applyInnerSleeveSlotFile(is.fileName, fileMap);
  updateInnerSleeveMode();
  innerSleeveSlot.updateSizing();
  innerSleeveSlot.draw();
}

export async function collectInnerSleeveFiles(){
  const files = [];
  if(document.getElementById("innersleeve-printed").checked){
    const sleeve = await collectInnerSleeveSlotFile();
    if(sleeve) files.push(sleeve);
  }
  return files;
}
```

- [ ] **Step 2: Sanity-check for syntax errors**

Run: `node --check src/modules/inner-sleeve.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add src/modules/inner-sleeve.js
git commit -m "add inner-sleeve.js, extracted from cover-sleeve.js (2 of 3)"
```

---

## Task 7: New module `src/modules/inlay.js`, delete `cover-sleeve.js`

Same extraction pattern, for the inlay third (front + back). Once this file exists, the old `cover-sleeve.js` has nothing left depending on it that isn't already replaced — delete it in this task.

**Files:**
- Create: `src/modules/inlay.js`
- Delete: `src/modules/cover-sleeve.js`

**Interfaces:**
- Consumes: `getFormat` (Task 1), `CONFIG` (Task 3 — `getFormat(CONFIG, id).printableParts.inlay`, `.printCheck`).
- Produces (consumed by `tracklist.js` in Task 8, `app.js` in Task 9): `initInlay()`, `collectInlay()` → `{include, front:{simprint,fileName}, back:{simprint,fileName}}`, `applyInlay(data, fileMap)`, `collectInlayFiles()` → `Promise<Array<{name, data}>>`.

- [ ] **Step 1: Create `src/modules/inlay.js`**

```javascript
// Inlay module — optional double-sided inlay (front + back), delivered
// as two separate square pages (unlike cover.js/inner-sleeve.js's single
// flat spread, since an inlay is printed on both sides of one physical
// sheet). No page count/booklet support — explicitly deferred, see the
// catalogue schema restructure design spec. Split out of the former
// cover-sleeve.js along with cover.js and inner-sleeve.js (Decision 8) —
// each owns its own copy of the artwork-slot scaffolding on purpose.
//
// Parsing/validation is the same pure logic labels.js uses, from
// ../lib/print-artwork.js.

import { CONFIG } from "../config.js";
import { getFormat } from "../lib/format-catalogue.js";
import { sniffFileKind, parseJpegArtwork, parseTiffArtwork, parsePdfArtwork, validateArtwork, computeSpreadInsetPx } from "../lib/print-artwork.js";
import { printedPartFileName, fileExt } from "../lib/package-naming.js";

// See cover.js's identical comment — flattened build, must stay unique.
const INLAY_PX_PER_MM = 4;
const INLAY_PREVIEW_MAX_W = 640;

function inlayCurrentFormat(){
  return document.getElementById("format").value;
}

function inlaySpec(){
  return getFormat(CONFIG, inlayCurrentFormat()).printableParts.inlay;
}

function renderInlayWarnings(listEl, result){
  const items = [];
  result.errors.forEach(e=> items.push(`<li class="err">⚠ ${e}</li>`));
  result.warnings.forEach(w=> items.push(`<li>⚠ ${w}</li>`));
  listEl.innerHTML = items.join("");
}

// prefix is "inlayfront" or "inlayback" — the two sides share this
// scaffolding (unlike cover.js/inner-sleeve.js, which each have exactly
// one slot), since front/back are otherwise identical.
function createInlayArtworkSlot(prefix){
  const input = document.getElementById(prefix+"input");
  const meta = document.getElementById(prefix+"meta");
  const preview = document.getElementById(prefix+"preview");
  const wrap = document.getElementById(prefix+"previewwrap");
  const canvas = document.getElementById(prefix+"sim");
  const warningsList = document.getElementById(prefix+"warnings");
  const simChk = document.getElementById(prefix+"simprint");
  let file = null, url = null;

  function updateSizing(){
    const { dataMm } = inlaySpec();
    wrap.style.width = "100%";
    wrap.style.maxWidth = INLAY_PREVIEW_MAX_W+"px";
    wrap.style.aspectRatio = dataMm.w+" / "+dataMm.h;
    preview.style.width = "100%"; preview.style.height = "100%";
    canvas.width = Math.round(dataMm.w * INLAY_PX_PER_MM);
    canvas.height = Math.round(dataMm.h * INLAY_PX_PER_MM);
    canvas.style.width = "100%"; canvas.style.height = "100%";
  }

  function draw(){
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if(!simChk.checked) return;
    const { dataMm, trimMm } = inlaySpec();
    const inset = computeSpreadInsetPx(canvas.width, canvas.height, dataMm, trimMm);
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.rect(inset.x, inset.y, canvas.width - 2*inset.x, canvas.height - 2*inset.y);
    ctx.fillStyle = "#000";
    ctx.fill("evenodd");
  }

  async function handleFile(f){
    file = f;
    meta.classList.remove("empty");
    meta.textContent = "file: " + f.name + " — checking…";
    if(url) URL.revokeObjectURL(url);

    const buf = await f.arrayBuffer();
    const kind = sniffFileKind(buf);
    let parsed = null;
    if(kind === "pdf") parsed = parsePdfArtwork(buf);
    else if(kind === "jpeg") parsed = parseJpegArtwork(buf);
    else if(kind === "tiff") parsed = parseTiffArtwork(buf);

    const { dataMm } = inlaySpec();
    const printCheck = getFormat(CONFIG, inlayCurrentFormat()).printCheck;
    const result = validateArtwork(parsed, dataMm, printCheck.sizeToleranceMm, printCheck.dpi.min, printCheck.dpi.max);
    if(kind === "unknown") result.errors.unshift("unrecognized file — expected PDF, JPG, or TIFF");
    renderInlayWarnings(warningsList, result);

    url = URL.createObjectURL(f);
    if(kind === "pdf"){
      preview.innerHTML = `<iframe src="${url}#toolbar=0&navpanes=0&view=Fit"></iframe>`;
    } else if(kind === "jpeg"){
      preview.innerHTML = `<img src="${url}" alt="artwork">`;
    } else if(kind === "tiff"){
      const dims = parsed && parsed.imagePx ? `${parsed.imagePx.w}×${parsed.imagePx.h}px` : "unreadable header";
      preview.innerHTML = `<div class="label-placeholder">TIFF — ${dims}<br>no in-browser preview</div>`;
    } else{
      preview.innerHTML = `<div class="label-placeholder">preview not available</div>`;
    }
    meta.textContent = "file: " + f.name;
    draw();
  }

  document.getElementById(prefix+"pick").addEventListener("click", ()=> input.click());
  input.addEventListener("change", ()=>{
    const f = input.files[0];
    if(f) handleFile(f);
  });
  simChk.addEventListener("change", draw);

  return { updateSizing, draw, getFile: ()=> file, setFile: handleFile };
}

function inlaySlotFileName(variant, file){
  return printedPartFileName({catalogue: document.getElementById("catalogue").value, part:"inlay", variant, ext: fileExt(file.name)});
}

async function collectInlaySlotFile(slot, variant){
  const file = slot.getFile();
  if(!file) return null;
  return { name: inlaySlotFileName(variant, file), data: await file.arrayBuffer() };
}

let inlayFrontSlot, inlayBackSlot;

function updateInlayVisibility(){
  document.getElementById("inlayBody").classList.toggle("hidden", !document.getElementById("inlayInclude").checked);
}

export function initInlay(){
  inlayFrontSlot = createInlayArtworkSlot("inlayfront");
  inlayBackSlot = createInlayArtworkSlot("inlayback");
  [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });

  document.getElementById("format").addEventListener("change", ()=>{
    [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });
  });

  document.getElementById("inlayInclude").addEventListener("change", updateInlayVisibility);
  updateInlayVisibility();
}

function setInlayFileNamePlaceholder(prefix, name){
  const meta = document.getElementById(prefix+"meta");
  if(name){
    meta.classList.remove("empty");
    meta.textContent = "file: " + name + " — please re-select this file (not stored in the order file)";
  } else {
    meta.classList.add("empty");
    meta.textContent = "";
  }
}

function applyInlaySlotFile(slot, prefix, fileName, fileMap){
  const file = fileMap && fileName && fileMap.get(fileName);
  if(file) slot.setFile(file);
  else setInlayFileNamePlaceholder(prefix, fileName);
}

export function collectInlay(){
  const inlayInclude = document.getElementById("inlayInclude").checked;
  const nameFor = (slot, variant) => {
    if(!inlayInclude) return null;
    const file = slot.getFile();
    return file ? inlaySlotFileName(variant, file) : null;
  };
  return {
    include: inlayInclude,
    front: {
      simprint: document.getElementById("inlayfrontsimprint").checked,
      fileName: nameFor(inlayFrontSlot, "front")
    },
    back: {
      simprint: document.getElementById("inlaybacksimprint").checked,
      fileName: nameFor(inlayBackSlot, "back")
    }
  };
}

export function applyInlay(data, fileMap){
  const inlay = data || {};
  document.getElementById("inlayInclude").checked = !!inlay.include;
  document.getElementById("inlayfrontsimprint").checked = !!(inlay.front && inlay.front.simprint);
  applyInlaySlotFile(inlayFrontSlot, "inlayfront", inlay.front && inlay.front.fileName, fileMap);
  document.getElementById("inlaybacksimprint").checked = !!(inlay.back && inlay.back.simprint);
  applyInlaySlotFile(inlayBackSlot, "inlayback", inlay.back && inlay.back.fileName, fileMap);
  updateInlayVisibility();
  [inlayFrontSlot, inlayBackSlot].forEach(s=>{ s.updateSizing(); s.draw(); });
}

export async function collectInlayFiles(){
  const files = [];
  if(document.getElementById("inlayInclude").checked){
    const front = await collectInlaySlotFile(inlayFrontSlot, "front");
    if(front) files.push(front);
    const back = await collectInlaySlotFile(inlayBackSlot, "back");
    if(back) files.push(back);
  }
  return files;
}
```

- [ ] **Step 2: Sanity-check for syntax errors**

Run: `node --check src/modules/inlay.js`
Expected: no output (exit code 0).

- [ ] **Step 3: Delete the old combined module**

```bash
git rm src/modules/cover-sleeve.js
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/inlay.js
git commit -m "add inlay.js, extracted from cover-sleeve.js (3 of 3); remove cover-sleeve.js"
```

Note: `src/modules/tracklist.js` and `src/app.js` still import from the now-deleted `./cover-sleeve.js` and `./modules/cover-sleeve.js` respectively until Tasks 8 and 9. Don't build+open the app until Task 9.

---

## Task 8: `src/modules/tracklist.js` — format lookups and three-way cover-sleeve wiring

**Files:**
- Modify: `src/modules/tracklist.js`

**Interfaces:**
- Consumes: `getFormat`, `firstEnabledFormat` (Task 1); `collectCover`/`applyCover`/`collectCoverFiles` (Task 5); `collectInnerSleeve`/`applyInnerSleeve`/`collectInnerSleeveFiles` (Task 6); `collectInlay`/`applyInlay`/`collectInlayFiles` (Task 7); `computeStatus(timeLimits, rpm, mode, seconds)` (Task 2).

- [ ] **Step 1: Update the import block at the top of the file**

Old:
```javascript
import { CONFIG } from "../config.js";
import { formatTime, parseTime, trackGapSeconds } from "../lib/time.js";
import { readAudioDuration, compressionWarning } from "../lib/audio-duration.js";
import { buildZip, parseZipBytes } from "../lib/zip.js";
import { computeStatus } from "../lib/playing-time.js";
import { trackFileName, continuousSideFileName, projectFileName, fileExt, mimeType, humanDate } from "../lib/package-naming.js";
import { renderTable } from "../lib/text-table.js";
import { defaultMatrix } from "../lib/matrix.js";
import { collectLabelFiles, collectLabels, applyLabels } from "./labels.js";
import { collectCoverSleeveFiles, collectCoverSleeve, applyCoverSleeve } from "./cover-sleeve.js";
import { collectVinylColor, applyVinylColor } from "./vinyl-color.js";
import { collectShippingBilling, applyShippingBilling, buildShippingBillingSummary } from "./shipping-billing.js";
```

New:
```javascript
import { CONFIG } from "../config.js";
import { formatTime, parseTime, trackGapSeconds } from "../lib/time.js";
import { readAudioDuration, compressionWarning } from "../lib/audio-duration.js";
import { buildZip, parseZipBytes } from "../lib/zip.js";
import { computeStatus } from "../lib/playing-time.js";
import { getFormat, firstEnabledFormat } from "../lib/format-catalogue.js";
import { trackFileName, continuousSideFileName, projectFileName, fileExt, mimeType, humanDate } from "../lib/package-naming.js";
import { renderTable } from "../lib/text-table.js";
import { defaultMatrix } from "../lib/matrix.js";
import { collectLabelFiles, collectLabels, applyLabels } from "./labels.js";
import { collectCoverFiles, collectCover, applyCover } from "./cover.js";
import { collectInnerSleeveFiles, collectInnerSleeve, applyInnerSleeve } from "./inner-sleeve.js";
import { collectInlayFiles, collectInlay, applyInlay } from "./inlay.js";
import { collectVinylColor, applyVinylColor } from "./vinyl-color.js";
import { collectShippingBilling, applyShippingBilling, buildShippingBillingSummary } from "./shipping-billing.js";
```

- [ ] **Step 2: Update `sideMeta()` (around line 256-261) — drop the format `parseInt`**

Old:
```javascript
function sideMeta(side){
  const format = parseInt(document.getElementById("format").value, 10);
  const rpm = parseInt(document.getElementById("rpm-"+side).value, 10);
  const mode = document.getElementById("soundsystem").checked ? "soundsystem" : "normal";
  return {format, rpm, mode};
}
```

New:
```javascript
function sideMeta(side){
  const format = document.getElementById("format").value;
  const rpm = parseInt(document.getElementById("rpm-"+side).value, 10);
  const mode = document.getElementById("soundsystem").checked ? "soundsystem" : "normal";
  return {format, rpm, mode};
}
```

- [ ] **Step 3: Update `statusFor()` (around line 281-284)**

Old:
```javascript
function statusFor(seconds, side){
  const {format, rpm, mode} = sideMeta(side);
  return computeStatus(CONFIG.timeLimits, format, rpm, mode, seconds);
}
```

New:
```javascript
function statusFor(seconds, side){
  const {format, rpm, mode} = sideMeta(side);
  return computeStatus(getFormat(CONFIG, format).timeLimits, rpm, mode, seconds);
}
```

- [ ] **Step 4: Replace the local `firstEnabledFormat()` and `populateFormatOptions()` (around line 426-444)**

Old:
```javascript
// The dropdown's option list is driven by CONFIG.formatCatalogue rather
// than hardcoded in index.html, so disabling a format is a one-line
// config change that takes effect on the next build.
function firstEnabledFormat(){
  const { order, enabled } = CONFIG.formatCatalogue;
  const first = order.find(f => enabled[f]);
  if(first === undefined) throw new Error("CONFIG.formatCatalogue: at least one format must be enabled");
  return first;
}

function populateFormatOptions(){
  firstEnabledFormat(); // throws early if the config disabled every format
  const { order, labels, enabled } = CONFIG.formatCatalogue;
  const select = document.getElementById("format");
  select.innerHTML = order
    .filter(f => enabled[f])
    .map(f => `<option value="${f}">${labels[f]}</option>`)
    .join("");
}
```

New (the `firstEnabledFormat` function itself is removed entirely — it's now imported from `../lib/format-catalogue.js`, see Step 1):
```javascript
// The dropdown's option list is driven by CONFIG.formats rather than
// hardcoded in index.html, so disabling a format is a one-line config
// change that takes effect on the next build.
function populateFormatOptions(){
  firstEnabledFormat(CONFIG); // throws early if the config disabled every format
  const select = document.getElementById("format");
  select.innerHTML = CONFIG.formats
    .filter(f => f.enabled)
    .map(f => `<option value="${f.id}">${f.label}</option>`)
    .join("");
}
```

- [ ] **Step 5: Update `applyDefaultRpm()` (around line 446-452)**

Old:
```javascript
function applyDefaultRpm(){
  const format = parseInt(document.getElementById("format").value, 10);
  const def = CONFIG.defaultRpm[format];
  document.getElementById("rpm-A").value = def;
  document.getElementById("rpm-B").value = def;
  recompute();
}
```

New:
```javascript
function applyDefaultRpm(){
  const format = document.getElementById("format").value;
  const def = getFormat(CONFIG, format).rpm;
  document.getElementById("rpm-A").value = def;
  document.getElementById("rpm-B").value = def;
  recompute();
}
```

- [ ] **Step 6: Update `buildProjectObject()` (around line 561-575) — assemble the three-way split back into one `coverSleeve` key**

Old:
```javascript
function buildProjectObject(){
  return {
    catalogue: document.getElementById("catalogue").value,
    format: document.getElementById("format").value,
    soundsystem: document.getElementById("soundsystem").checked,
    albumTitle: document.getElementById("albumTitle").value,
    albumArtist: document.getElementById("albumArtist").value,
    notes: document.getElementById("notes").value,
    sides: { A: serializeSide("A"), B: serializeSide("B") },
    vinylColor: collectVinylColor(),
    shippingBilling: collectShippingBilling(),
    labels: collectLabels(),
    coverSleeve: collectCoverSleeve()
  };
}
```

New:
```javascript
function buildProjectObject(){
  return {
    catalogue: document.getElementById("catalogue").value,
    format: document.getElementById("format").value,
    soundsystem: document.getElementById("soundsystem").checked,
    albumTitle: document.getElementById("albumTitle").value,
    albumArtist: document.getElementById("albumArtist").value,
    notes: document.getElementById("notes").value,
    sides: { A: serializeSide("A"), B: serializeSide("B") },
    vinylColor: collectVinylColor(),
    shippingBilling: collectShippingBilling(),
    labels: collectLabels(),
    coverSleeve: { cover: collectCover(), innerSleeve: collectInnerSleeve(), inlay: collectInlay() }
  };
}
```

- [ ] **Step 7: Update `loadProject()`'s format-restore line (around line 649) — drop the now-unneeded `String()` wrap**

Old:
```javascript
  document.getElementById("format").value = p.format || String(firstEnabledFormat());
```

New:
```javascript
  document.getElementById("format").value = p.format || firstEnabledFormat(CONFIG);
```

- [ ] **Step 8: Update `loadProject()`'s cover-sleeve apply call (around line 661) — split into three calls**

Old:
```javascript
  applyCoverSleeve(p.coverSleeve, fileMap);
```

New:
```javascript
  const cs = p.coverSleeve || {};
  applyCover(cs.cover, fileMap);
  applyInnerSleeve(cs.innerSleeve, fileMap);
  applyInlay(cs.inlay, fileMap);
```

- [ ] **Step 9: Update `loadProject()`'s per-side RPM restore line (around line 690)**

Old:
```javascript
    document.getElementById("rpm-"+side).value = s.rpm || CONFIG.defaultRpm[document.getElementById("format").value];
```

New:
```javascript
    document.getElementById("rpm-"+side).value = s.rpm || getFormat(CONFIG, document.getElementById("format").value).rpm;
```

- [ ] **Step 10: Update the package file-collection call (around line 752) — split into three calls**

Old:
```javascript
  files.push(...await collectLabelFiles());
  files.push(...await collectCoverSleeveFiles());
  return files;
```

New:
```javascript
  files.push(...await collectLabelFiles());
  files.push(...await collectCoverFiles());
  files.push(...await collectInnerSleeveFiles());
  files.push(...await collectInlayFiles());
  return files;
```

- [ ] **Step 11: Verify no leftover old-shape references**

Run: `grep -n "CONFIG\.formatCatalogue\|CONFIG\.defaultRpm\|CONFIG\.timeLimits\|collectCoverSleeve\|applyCoverSleeve\|cover-sleeve\.js" src/modules/tracklist.js`
Expected: no output.

- [ ] **Step 12: Commit**

```bash
git add src/modules/tracklist.js
git commit -m "tracklist: read formats via getFormat/firstEnabledFormat; wire the 3-way cover-sleeve split"
```

---

## Task 9: Wire `app.js`, `build.js`, and fix the stale `index.html` comment

**Files:**
- Modify: `src/app.js`
- Modify: `build/build.js`
- Modify: `src/index.html`

**Interfaces:**
- Consumes: `initCover` (Task 5), `initInnerSleeve` (Task 6), `initInlay` (Task 7).

- [ ] **Step 1: Update `src/app.js`**

Old:
```javascript
import { initTracklist } from "./modules/tracklist.js";
import { initLabels } from "./modules/labels.js";
import { initCoverSleeve } from "./modules/cover-sleeve.js";
import { initVinylColor } from "./modules/vinyl-color.js";
import { initShippingBilling } from "./modules/shipping-billing.js";

document.addEventListener("DOMContentLoaded", () => {
  initTracklist();
  initLabels();
  initCoverSleeve();
  initVinylColor();
  initShippingBilling();
});
```

New:
```javascript
import { initTracklist } from "./modules/tracklist.js";
import { initLabels } from "./modules/labels.js";
import { initCover } from "./modules/cover.js";
import { initInnerSleeve } from "./modules/inner-sleeve.js";
import { initInlay } from "./modules/inlay.js";
import { initVinylColor } from "./modules/vinyl-color.js";
import { initShippingBilling } from "./modules/shipping-billing.js";

document.addEventListener("DOMContentLoaded", () => {
  initTracklist();
  initLabels();
  initCover();
  initInnerSleeve();
  initInlay();
  initVinylColor();
  initShippingBilling();
});
```

- [ ] **Step 2: Update `build/build.js`'s `FILES` array**

Old:
```javascript
const FILES = [
  "src/config.js",
  "src/lib/time.js",
  "src/lib/zip.js",
  "src/lib/audio-duration.js",
  "src/lib/playing-time.js",
  "src/lib/print-artwork.js",
  "src/lib/shipping.js",
  "src/lib/countries.js",
  "src/lib/vinyl-color.js",
  "src/lib/info-text.js",
  "src/lib/package-naming.js",
  "src/lib/text-table.js",
  "src/lib/matrix.js",
  "src/modules/labels.js",
  "src/modules/cover-sleeve.js",
  "src/modules/vinyl-color.js",
  "src/modules/shipping-billing.js",
  "src/modules/tracklist.js",
  "src/app.js",
];
```

New:
```javascript
const FILES = [
  "src/config.js",
  "src/lib/time.js",
  "src/lib/zip.js",
  "src/lib/audio-duration.js",
  "src/lib/playing-time.js",
  "src/lib/print-artwork.js",
  "src/lib/shipping.js",
  "src/lib/countries.js",
  "src/lib/vinyl-color.js",
  "src/lib/info-text.js",
  "src/lib/package-naming.js",
  "src/lib/text-table.js",
  "src/lib/matrix.js",
  "src/lib/format-catalogue.js",
  "src/modules/labels.js",
  "src/modules/cover.js",
  "src/modules/inner-sleeve.js",
  "src/modules/inlay.js",
  "src/modules/vinyl-color.js",
  "src/modules/shipping-billing.js",
  "src/modules/tracklist.js",
  "src/app.js",
];
```

- [ ] **Step 3: Fix the stale comment in `src/index.html`**

Old (around line 461):
```html
        <select id="format"><!-- options populated from CONFIG.formatCatalogue at init --></select>
```

New:
```html
        <select id="format"><!-- options populated from CONFIG.formats at init --></select>
```

- [ ] **Step 4: Build and check for syntax errors**

```bash
node build/build.js
node --check dist/index.html 2>&1 || true
```
(`node --check` doesn't understand HTML — instead, extract and check the bundled script directly:)

```bash
node -e "
const html = require('fs').readFileSync('dist/index.html', 'utf8');
const m = html.match(/<script>\n([\s\S]*)\n<\/script>/);
require('fs').writeFileSync('/tmp/bundle-check.mjs', m[1]);
"
node --check /tmp/bundle-check.mjs
```
Expected: `built dist/index.html (... KB)` then no output from the syntax checks (exit code 0). A `SyntaxError` here almost always means a duplicate top-level `const`/`let` name across two of the new module files — check `COVER_PX_PER_MM`/`INNER_SLEEVE_PX_PER_MM`/`INLAY_PX_PER_MM` and similar are each still unique.

- [ ] **Step 5: Commit**

```bash
git add src/app.js build/build.js src/index.html
git commit -m "wire cover.js/inner-sleeve.js/inlay.js into app.js and build.js"
```

---

## Task 10: Full verification

**Files:** none changed.

- [ ] **Step 1: Run the full unit test suite**

Run: `node --test tests/`
Expected: all tests pass, 0 failures. Should include the 5 new `format-catalogue.test.js` tests and the updated 3 `playing-time.test.js` tests, on top of the existing suite.

- [ ] **Step 2: Rebuild and open the app**

```bash
node build/build.js
open dist/index.html
```
Expected: page loads with no browser console errors. Format dropdown shows "12\" LP" and "7\" SP" (10" stays hidden — `enabled: false`).

- [ ] **Step 3: Exercise format-dependent behavior manually**

- Switch the format dropdown between 12" and 7" — confirm the label preview size, big-center checkbox visibility, and cover/inner-sleeve/inlay preview aspect ratios all update.
- On a 7" side, set RPM to 33⅓ (not the format's default 45) and enter a track length long enough to cross the ideal/max thresholds — confirm the warning/danger colouring still triggers correctly (this is the RPM-keyed `timeLimits` fix from the Global Constraints deviation — if this doesn't warn correctly, `computeStatus`'s `rpm` lookup is broken).
- Toggle "Big center" on a 7" — confirm it's hidden entirely on 12" (no `centerHole.big` key there).

- [ ] **Step 4: Regression-check `project.json` compatibility with the pre-refactor save (Task 0's fixture)**

In the running (post-refactor) `dist/index.html`, click "Load Project" and select the `pre-refactor-test.zip` saved in Task 0. Expected: catalogue number, format, track title, and the cover/inner-sleeve print-mode toggles all restore exactly as saved — confirming `project.json`'s `coverSleeve: {cover, innerSleeve, inlay}` shape and the `format` string value are genuinely unaffected by this refactor (Decision 10).

- [ ] **Step 5: Confirm nothing's left referencing the old shape anywhere in `src/`**

Run: `grep -rn "formatCatalogue\|CONFIG\.defaultRpm\|CONFIG\.timeLimits\|CONFIG\.label\.\|CONFIG\.coverSleeve\|cover-sleeve\.js" src/`
Expected: no output.

- [ ] **Step 6: Update the spec's status line**

In `docs/superpowers/specs/2026-09-20-catalogue-schema-restructure-design.md`, change:
```
Status: approved, pending implementation plan
```
to:
```
Status: implemented
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-09-20-catalogue-schema-restructure-design.md
git commit -m "mark catalogue schema restructure (sub-project A) implemented"
```
