# UI Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `DESIGN.md` and bring the UI into line with it — plain
sections instead of nested bordered boxes, ASCII text affordances
(`(+)`/`(x)`/`(?)`) instead of authored SVG icons, plain-text checklist
marks/status/track-position instead of pills and chips, a six-token
color palette, and a relabeled/reordered `Save · Load | Send | Print`
action row.

**Architecture:** One shared page shell (`src/index.html`: CSS tokens +
component rules + static body markup) carries almost the entire visual
change. A handful of modules (`labels.js`, `tracklist.js`,
`vinyl-color.js`, `shipping-billing.js`) own their own template strings
for per-side/per-row markup and need matching edits. `cover.js`,
`inner-sleeve.js`, and `inlay.js` need **no changes** — their artwork-
picker markup is static in `index.html`, and their JS only wires click
handlers to fixed ids.

**Tech Stack:** Plain ES2020+ JS, HTML, CSS — no new dependencies.
`node --test` covers only `src/lib/*` (this plan touches none of it,
except one presentation-only line in `src/lib/info-text.js` whose test
doesn't pin the string it changes — see Task 4). Everything else is
DOM/CSS with no existing unit-test seam, verified the same way the
prior artwork-preview-pipeline plan verified its DOM tasks: syntax
check, full regression suite staying green, a successful build, and a
grep/diff read-through against this plan's exact code.

**Spec:** `docs/superpowers/specs/2026-09-22-ui-declutter-design.md`

## Global Constraints

- No runtime dependencies; `dist/index.html` stays a single self-
  contained file (no CDN, no build tooling beyond `build/build.js`'s
  plain concatenation).
- `node --test tests/` must pass after every task, staying at the
  current 131 passing throughout (no `src/lib` logic changes in this
  plan).
- `node build/build.js` must succeed after every task.
- **No behavior/logic change.** Validation, gating, calculations, file
  handling, ZIP naming/structure, and checklist-timing are untouched.
  Every DOM id/class the JS reads or writes stays exactly as it is,
  *except* purely-presentational class removal explicitly called out
  in a task below (e.g. dropping the `side-box` class name once no
  rule anywhere selects on it for behavior — only for CSS).
- **This codebase does not unit-test DOM modules** — only `src/lib/*`
  is covered by `node --test`. Tasks touching `src/index.html`/
  `src/modules/*` are verified by: syntax check (`node --check`),
  full regression suite staying green, a successful build, and a grep/
  diff read-through against this plan's exact code.
- **Do not spin up Chrome browser automation to live-verify a task by
  default — ask the user first**, per their standing preference (it's
  token-expensive); a task is done when the checks above pass and the
  diff matches this plan.
- Commit messages: short, imperative, no ceremony, precise — matching
  this repo's existing history (`git log --oneline` for examples).

## File Structure

- `DESIGN.md` — replaced in full (Task 1) with the spec's Appendix A
  content verbatim.
- `src/index.html` — the shared `<style>` block (tokens + component
  rules, Task 2) and the shared body markup (sections, actions row,
  static artwork-picker buttons, Task 3).
- `src/lib/info-text.js` — `renderInfoIcon()` gains `(?)` summary text
  (Task 4).
- `src/modules/labels.js` — per-side template: drop `side-box` box
  styling class, `<h2>`→`<h3>`, pick button text (Task 5).
- `src/modules/tracklist.js` — three separate concerns, three tasks:
  track-row pick/remove button text and per-side continuous-file pick
  button text (Task 6); no change needed to checklist rendering (the
  literal `✓`/`!` text is already there — Task 2 handles the CSS that
  currently hides it); the generated SwissTransfer instruction page's
  inline `<style>` block (Task 9).
- `src/modules/vinyl-color.js` — colour-row remove button text (Task 7).
- `src/modules/shipping-billing.js` — ship-addr template: drop
  `side-box` box styling class, `<h2>`→`<h3>`, remove button text
  (Task 8).
- `src/modules/cover.js`, `src/modules/inner-sleeve.js`,
  `src/modules/inlay.js` — **no changes.** Their pick-button markup is
  static in `index.html` (Task 3); their own code only wires click
  handlers to fixed ids and renders the (untouched) `CHECKLIST_ICON`
  artwork table from `src/lib/print-artwork.js`.

---

### Task 1: Rewrite `DESIGN.md`

**Files:**
- Modify: `DESIGN.md`

**Interfaces:** none — a documentation file, no code depends on its
contents at runtime.

- [ ] **Step 1: Replace the file**

Replace the entire contents of `DESIGN.md` with the literal Markdown
from the spec's "Appendix: new `DESIGN.md`" section
(`docs/superpowers/specs/2026-09-22-ui-declutter-design.md`, the block
starting `---\nname: Record Orderbook\n...` through the final `Don't`
list) — copy it verbatim, including the front-matter between the two
`---` lines.

- [ ] **Step 2: Verify**

Run: `node --test tests/` — expect 131 passing, unchanged (no code
touched).

- [ ] **Step 3: Commit**

```bash
git add DESIGN.md
git commit -m "DESIGN.md: rewrite for plain, text-first system"
```

---

### Task 2: `src/index.html` — CSS tokens + component rules

**Files:**
- Modify: `src/index.html` (the `<style>` block only — no body markup
  in this task)

**Interfaces:**
- Produces: the consolidated token set (`--ink`, `--ink-dim`,
  `--paper`/`--bg`, `--edge`, `--field`, `--danger`, `--sans`,
  `--mono`) and every component rule Task 3 and the module tasks rely
  on already being correct by the time their markup lands. This task
  intentionally leaves stale classnames (`fieldset`, `.groove`,
  `.side-box`, `⏏`/`✕` button text) in the body markup — Task 3 and the
  module tasks remove them. An unmatched CSS rule is harmless; the page
  will look transitionally plain (unstyled fieldsets) between this task
  and Task 3, which is expected and not a regression to fix here.

- [ ] **Step 1: Replace the `:root` token block**

Current (lines 28–56):

```css
  :root{
    --bg:      #ffffff;
    --panel:   #ffffff;
    --panel-2: #f5f5f4;
    --inset:   #f6f6f5;
    --edge:    #d6d6d3;
    --edge-lo: #e9e9e7;
    --ink:     #161616;
    --ink-dim: #5c5c59;
    --ink-dim2:#737370;
    --accent:  #161616;
    --accent-2:#000000;
    --ok:      #6b6b68;
    --warn:    #b3261e;
    --danger:  #b3261e;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "JetBrains Mono", "IBM Plex Mono", "Cascadia Code",
            "Fira Code", "SF Mono", Consolas, "Roboto Mono", monospace;

    /* Authored icons — drawn as masks so they inherit currentColor
       (never a Unicode glyph standing in for an icon). Geometry lives
       once here; every consumer below just masks+colors a box. */
    --icon-upload: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='12,3 18,10 14,10 14,16 10,16 10,10 6,10' fill='black'/><rect x='5' y='19' width='14' height='2' rx='1' fill='black'/></svg>");
    --icon-remove: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect x='11' y='2' width='2' height='20' rx='1' fill='black' transform='rotate(45 12 12)'/><rect x='11' y='2' width='2' height='20' rx='1' fill='black' transform='rotate(-45 12 12)'/></svg>");
    --icon-info: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='7.5' r='1.5' fill='black'/><rect x='10.75' y='10.5' width='2.5' height='7.5' rx='1.25' fill='black'/></svg>");
    --icon-tie-ok: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='4' cy='12' r='3' fill='black'/><rect x='4' y='10' width='16' height='4' fill='black'/><circle cx='20' cy='12' r='3' fill='black'/></svg>");
    --icon-tie-bad: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='4' cy='12' r='3' fill='black'/><rect x='4' y='10' width='6' height='4' fill='black'/><rect x='14' y='10' width='6' height='4' fill='black'/><circle cx='20' cy='12' r='3' fill='black'/></svg>");
    --icon-chevron: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><polygon points='6,4 18,12 6,20' fill='black'/></svg>");
  }
```

Replace with:

```css
  :root{
    --bg:      #ffffff;
    --panel:   #ffffff;
    --field:   #f6f6f5;
    --edge:    #d6d6d3;
    --ink:     #161616;
    --ink-dim: #5c5c59;
    --danger:  #b3261e;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: ui-monospace, "JetBrains Mono", "IBM Plex Mono", "Cascadia Code",
            "Fira Code", "SF Mono", Consolas, "Roboto Mono", monospace;
  }
```

- [ ] **Step 2: Repoint every remaining use of a dropped token**

Every line below is a straight token substitution — same property,
same intent, new variable name. Apply each one exactly (line numbers
are from the file *before* Step 1's edit shifted them; find each by
its unique surrounding text, not by number, since Step 1 already
changed line counts):

`--panel-2` → `--field`:
```
.pickbtn{ ... background:var(--panel-2); ...            →  background:var(--field);
.artist-field input.artist[readonly]{ background:var(--panel-2); ...  →  background:var(--field);
.rmbtn:hover{ ...background:var(--panel-2); }            →  background:var(--field);
details.info .info-body{ ...background:var(--panel-2); ...  →  background:var(--field);
button.btn.ghost:hover{ background:var(--panel-2); ...   →  (this whole rule is deleted in Step 6 — skip)
```

`--edge-lo` → `--edge`:
```
.groove{ ...background:var(--edge-lo); }                 →  (this whole rule is deleted in Step 4 — skip)
(track header) padding:6px 4px; border-bottom:1px solid var(--edge-lo);  →  border-bottom:1px solid var(--edge);
.rmbtn{ ...border:1px solid var(--edge-lo); ...           →  border:1px solid var(--edge);
.labelwarnings th{ ...border-bottom:1px solid var(--edge-lo); }  →  border-bottom:1px solid var(--edge);
.foot{ ...border-top:1px solid var(--edge-lo); ...        →  border-top:1px solid var(--edge);
```

`--ink-dim2` → `--ink-dim`:
```
::-webkit-scrollbar-thumb:hover{ background:var(--ink-dim2); }  →  var(--ink-dim)
input:hover, select:hover, textarea:hover{ border-color:var(--ink-dim2); }  →  var(--ink-dim)
input[type=text]::placeholder, input[type=number]::placeholder{ color:var(--ink-dim2); }  →  var(--ink-dim)
(header .idline){ ...color:var(--ink-dim2); ...           →  var(--ink-dim)
.artist-change, .artist-revert{ ...color:var(--ink-dim2); ...  →  var(--ink-dim)
.rmbtn{ ...color:var(--ink-dim2); ...                     →  var(--ink-dim)
.limits-note{ font-size:11px; color:var(--ink-dim2); ...  →  var(--ink-dim)
(checklist meta note){ color:var(--ink-dim2); ...         →  var(--ink-dim)
.foot{ ...color:var(--ink-dim2); ...                      →  var(--ink-dim)
```

`--ok` → `--ink-dim`:
```
.pickbtn.has-file{ border-color:var(--ok); color:var(--ok); }  →  var(--ink-dim) for both
.autoflag{ font-size:11px; color:var(--ok); ...           →  var(--ink-dim)
.badge.ok{ color:var(--ok); }                             →  var(--ink-dim)
.labelwarnings tr.info{ color:var(--ok); }                →  var(--ink-dim)
.checklist .ok .mark{ color:var(--ok); }                  →  var(--ink-dim)
```

`--warn` → `--danger`:
```
.badge.warn{ color:var(--warn); }                         →  var(--danger)
.labelwarnings tr.warn{ color:var(--warn); }              →  var(--danger)
```

`--accent`/`--accent-2` → `--ink`:
```
.pickbtn:hover{ border-color:var(--accent); color:var(--accent-2); }  →  border-color:var(--ink); color:var(--ink);
.addbtn:hover{ border-color:var(--accent); border-style:solid; color:var(--accent-2); }  →  border-color:var(--ink); color:var(--ink);
details.info:hover > summary, details.info[open] > summary{ border-color:var(--accent); color:var(--accent-2); }  →  border-color:var(--ink); color:var(--ink);
label .req{ color:var(--accent-2); }                      →  var(--ink)
input:focus-visible, ... { outline:2px solid var(--accent-2); ...  →  var(--ink)
button.btn{ ...background:var(--accent); ...border:1px solid var(--accent); }  →  this whole rule is replaced in Step 6 — skip
button.btn:hover{ background:var(--accent-2); border-color:var(--accent-2); }  →  deleted in Step 6 — skip
```

- [ ] **Step 3: `fieldset`/`legend` → heading + rule; repurpose `h2`, add `h3`**

Current:

```css
  fieldset{
    border:1px solid var(--edge); border-radius:4px; padding:14px 16px 16px; margin:0;
    background:var(--panel);
  }
  legend{ padding:0 7px; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-dim); font-weight:700; }
```

and, further down:

```css
  h1,h2,h3{ font-family:var(--sans); font-weight:700; margin:0; }
  h1{ font-size:18px; letter-spacing:-.005em; color:var(--ink); }
  h2{ font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--ink-dim); font-weight:700; }
```

Replace both blocks. Delete the `fieldset{...}`/`legend{...}` rule
entirely (Task 3 replaces every `<fieldset><legend>` with a plain
`<section><h2>`). Replace the `h1,h2,h3`/`h1`/`h2` block with:

```css
  h1,h2,h3{ font-family:var(--sans); font-weight:700; margin:0; }
  h1{ font-size:18px; letter-spacing:-.005em; color:var(--ink); }
  h2{
    font-size:15px; color:var(--ink); padding-bottom:8px;
    border-bottom:1px solid var(--edge); margin-bottom:14px;
  }
  h3{ font-size:13.5px; color:var(--ink); margin-bottom:8px; }
```

- [ ] **Step 4: Delete the `.groove` divider**

Current:

```css
  /* ---------- seam rule — a panel-to-panel divider ---------- */
  .groove{
    height:1px; margin:22px 0;
    background:var(--edge-lo);
  }
  .groove.tight{ margin:14px 0; }
```

Delete this rule entirely (both the comment and both declarations) —
each section's `<h2>` now carries its own rule via `border-bottom`
(Step 3). Also delete the two print-media overrides that reference it:

```css
    .groove{ margin:6px 0; }
    .groove.tight{ margin:4px 0; }
```

(inside the `@media print` block — find by the `.groove` text, delete
both lines).

- [ ] **Step 5: `label` → sentence case; delete `.side-box`; fix `.side-head h2` → `.side-head h3`**

Current:

```css
  label{ display:block; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--ink-dim); margin-bottom:3px; }
  label .req{ color:var(--accent-2); }
```

Replace with (drops uppercase/tracking; `.req` already repointed to
`--ink` in Step 2):

```css
  label{ display:block; font-size:13.5px; color:var(--ink-dim); margin-bottom:3px; }
  label .req{ color:var(--ink); }
```

`label.hint` (a couple lines below) already sets
`text-transform:none; letter-spacing:0;` to opt *out* of the old
uppercase treatment — now that the base `label` rule is no longer
uppercase, `label.hint` no longer needs to override it. Current:

```css
  label.hint{ text-transform:none; letter-spacing:0; font-weight:500; color:var(--ink-dim); }
```

Replace with:

```css
  label.hint{ font-weight:500; color:var(--ink-dim); }
```

Delete the `.side-box{...}` ruleset entirely (find it — it's the block
starting `.side-box{` a few lines above `.side-head`). Its
`border-color:var(--edge)` reference inside the `@media print` rule
`fieldset, .side-box, details.panel{ border-color:var(--edge); break-inside:avoid; }`
becomes just `fieldset` → see Step 9 for that line (fieldsets are
gone too by the end of this plan, but that line is deleted in Step 9
alongside the dead `details.panel` rules — don't touch it here).

Fix the h2→h3 selector: current `.side-head h2{ margin:0; }` becomes
`.side-head h3{ margin:0; }` (the headings inside `.side-head` are
`<h3>` after Task 5/8's markup changes).

- [ ] **Step 6: `.actions`/`.btn` → one uniform button style**

Current:

```css
  .actions{ display:flex; gap:10px; flex-wrap:wrap; }
  button.btn{
    font-family:var(--sans); font-size:12px; font-weight:600; letter-spacing:.01em;
    background:var(--accent); color:#fff; border:1px solid var(--accent);
    padding:9px 15px; border-radius:3px; cursor:pointer;
  }
  button.btn:hover{ background:var(--accent-2); border-color:var(--accent-2); }
  button.btn.ghost{ background:var(--panel); color:var(--ink); border-color:var(--edge); }
  button.btn.ghost:hover{ background:var(--panel-2); border-color:var(--ink); }
  button.btn:disabled{ opacity:.4; cursor:not-allowed; }
```

Replace with (one style for every action button; `.action-group` is
the tight-gap wrapper Task 3's markup uses for Save+Load):

```css
  .actions{ display:flex; align-items:center; gap:24px; flex-wrap:wrap; }
  .action-group{ display:flex; gap:10px; flex-wrap:wrap; }
  button.btn{
    font-family:var(--sans); font-size:13px; font-weight:600;
    background:var(--paper); color:var(--ink); border:1px solid var(--edge);
    padding:8px 14px; border-radius:3px; cursor:pointer;
  }
  button.btn:hover{ background:var(--field); border-color:var(--ink); }
  button.btn:disabled{ opacity:.4; cursor:not-allowed; }
```

(`--paper` isn't defined yet — Step 1's new `:root` block only has
`--bg`/`--panel`, both `#ffffff`. Use `var(--panel)` instead of
`var(--paper)` here, since that's the token already in scope; the
spec's "Field"/"paper" naming is documentation language, not a literal
required CSS variable rename.)

- [ ] **Step 7: Icon buttons (`pickbtn`/`rmbtn`) → plain bracketed text**

Current:

```css
  /* Icon buttons — geometry drawn once via mask-image so every button
     of this shape (across every module's generated markup) shares one
     glyph, colored from currentColor rather than baked into a raster. */
  .pickbtn, .rmbtn{
    position:relative; cursor:pointer; display:flex; align-items:center; justify-content:center;
    font-size:0; /* the "⏏"/"✕" text node collapses; screen readers still get it via the title/DOM text */
  }
  .pickbtn::before, .rmbtn::before{
    content:""; display:block; width:14px; height:14px; background-color:currentColor;
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-position:center; mask-position:center;
    -webkit-mask-size:contain; mask-size:contain;
  }
  .pickbtn::before{ -webkit-mask-image:var(--icon-upload); mask-image:var(--icon-upload); }
  .rmbtn::before{ width:11px; height:11px; -webkit-mask-image:var(--icon-remove); mask-image:var(--icon-remove); }

  .pickbtn{
    width:26px; height:26px; border:1px solid var(--edge); background:var(--panel-2);
    border-radius:3px; color:var(--ink-dim);
  }
  .pickbtn:hover{ border-color:var(--accent); color:var(--accent-2); }
  .pickbtn.has-file{ border-color:var(--ok); color:var(--ok); }
```

and, lower in the file:

```css
  .rmbtn{
    width:22px; height:22px; border:1px solid var(--edge-lo); background:transparent;
    color:var(--ink-dim2); border-radius:3px;
  }
  .rmbtn:hover{ border-color:var(--danger); color:var(--danger); background:var(--panel-2); }
```

Replace the first block with (text is now the actual visible content —
Tasks 3/5/8 change each button's DOM text to `(+)`/`(x)`):

```css
  .pickbtn, .rmbtn{
    cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
    font-family:var(--sans); font-size:12px; font-weight:600;
    border-radius:3px; padding:5px 8px;
  }
  .pickbtn{ border:1px solid var(--edge); background:var(--field); color:var(--ink-dim); }
  .pickbtn:hover{ border-color:var(--ink); color:var(--ink); }
  .pickbtn.has-file{ border-color:var(--ink-dim); color:var(--ink-dim); }
```

Replace the second block with:

```css
  .rmbtn{ border:1px solid var(--edge); background:transparent; color:var(--ink-dim); }
  .rmbtn:hover{ border-color:var(--danger); color:var(--danger); background:var(--field); }
```

- [ ] **Step 8: Checklist marks, badge, and track position → plain text**

Current:

```css
  .checklist{ list-style:none; margin:0; padding:0; font-size:11.5px; }
  .checklist li{ display:flex; gap:7px; align-items:center; padding:2px 0; }
  .checklist .mark{
    width:16px; height:12px; flex:0 0 auto; font-size:0;
  }
  .checklist .mark::before{
    content:""; display:block; width:100%; height:100%; background-color:currentColor;
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-position:center; mask-position:center;
    -webkit-mask-size:contain; mask-size:contain;
  }
  .checklist .ok .mark{ color:var(--ok); }
  .checklist .ok .mark::before{ -webkit-mask-image:var(--icon-tie-ok); mask-image:var(--icon-tie-ok); }
  .checklist .bad .mark{ color:var(--danger); }
  .checklist .bad .mark::before{ -webkit-mask-image:var(--icon-tie-bad); mask-image:var(--icon-tie-bad); }
```

Replace with (the `✓`/`!` text these `<span class="mark">` elements
already contain — see `tracklist.js`/`vinyl-color.js`/
`shipping-billing.js` — is no longer hidden by `font-size:0`, so no JS
change is needed to show it):

```css
  .checklist{ list-style:none; margin:0; padding:0; font-size:13px; }
  .checklist li{ display:flex; gap:7px; align-items:center; padding:2px 0; }
  .checklist .mark{ width:1em; flex:0 0 auto; font-weight:700; }
  .checklist .ok .mark{ color:var(--ink-dim); }
  .checklist .bad .mark{ color:var(--danger); }
```

Current:

```css
  .badge{
    font-size:11px; letter-spacing:.04em; text-transform:uppercase; font-weight:700;
    padding:3px 9px; border-radius:99px; border:1px solid currentColor;
  }
  .badge.ok{ color:var(--ok); }
  .badge.warn{ color:var(--warn); }
  .badge.danger{ color:var(--danger); }
```

Replace with:

```css
  .badge{ font-size:13px; font-weight:600; }
  .badge.ok{ color:var(--ink-dim); }
  .badge.warn{ color:var(--danger); }
  .badge.danger{ color:var(--danger); }
```

Current:

```css
  .pos{
    font-weight:700; font-size:12px; color:var(--ink); text-align:center;
    background:var(--inset); border:1px solid var(--edge); border-radius:3px; padding:2px 0;
  }
```

Replace with:

```css
  .pos{ font-weight:700; font-size:13px; color:var(--ink); text-align:center; }
```

(Any other rule in the file using `var(--inset)` — check with
`grep -n "var(--inset)" src/index.html` after this step — repoint to
`var(--field)`; `--inset` was renamed to `--field` in Step 1, so any
remaining `var(--inset)` reference is now a build-breaking undefined
variable and must be caught here.)

- [ ] **Step 9: Info toggle → `(?)` text; drop the custom chevron; delete dead `details.panel` CSS**

Current:

```css
  details.info{ display:inline-block; vertical-align:middle; }
  details.info > summary{
    display:inline-flex; align-items:center; justify-content:center;
    width:15px; height:15px; border:1px solid var(--edge); border-radius:50%;
    cursor:pointer; list-style:none;
    color:var(--ink-dim); user-select:none;
  }
  details.info > summary::before{
    content:""; display:block; width:9px; height:9px; background-color:currentColor;
    -webkit-mask-image:var(--icon-info); mask-image:var(--icon-info);
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-size:contain; mask-size:contain;
  }
  details.info > summary::-webkit-details-marker{ display:none; }
  details.info:hover > summary, details.info[open] > summary{ border-color:var(--accent); color:var(--accent-2); }
  details.info .info-body{
    margin-top:6px; padding:8px 10px; max-width:320px;
    background:var(--panel-2); border:1px solid var(--edge); border-radius:3px;
```

(the `.info-body` rule continues past this excerpt — leave the rest of
it as-is, only the properties shown above change). Replace the shown
lines with:

```css
  details.info{ display:inline-block; vertical-align:middle; }
  details.info > summary{
    display:inline-flex; align-items:center; justify-content:center;
    font-size:11px; font-weight:600; padding:1px 5px;
    border:1px solid var(--edge); border-radius:3px;
    cursor:pointer; list-style:none;
    color:var(--ink-dim); user-select:none;
  }
  details.info > summary::-webkit-details-marker{ display:none; }
  details.info:hover > summary, details.info[open] > summary{ border-color:var(--ink); color:var(--ink); }
  details.info .info-body{
    margin-top:6px; padding:8px 10px; max-width:320px;
    background:var(--field); border:1px solid var(--edge); border-radius:3px;
```

Now find and delete, in full, these three dead rules (no markup
anywhere uses `class="panel"` on a `<details>` — confirmed by
`grep -rn "details class=\"panel\|class=\"panel\"" src/` returning
nothing):

```css
  details.panel{ border:1px solid var(--edge); border-radius:4px; background:var(--panel); }
  details.panel > summary{
    cursor:pointer; padding:10px 14px; font-size:11px; letter-spacing:.08em; font-weight:700;
    text-transform:uppercase; color:var(--ink-dim); list-style:none;
    display:flex; align-items:center; gap:8px;
  }
  details.panel > summary::-webkit-details-marker{ display:none; }
  details.panel > summary::before{
    content:""; display:block; width:9px; height:9px; background-color:var(--accent-2);
    -webkit-mask-image:var(--icon-chevron); mask-image:var(--icon-chevron);
    -webkit-mask-repeat:no-repeat; mask-repeat:no-repeat;
    -webkit-mask-size:contain; mask-size:contain;
    transition:transform .15s ease-out;
  }
  details.panel[open] > summary::before{ transform:rotate(90deg); }
  .panel-body{ padding:0 16px 16px; font-size:12px; }
  .panel-body p{ color:var(--ink-dim); margin:6px 0 12px; }
  .log{
    background:var(--inset); border:1px solid var(--edge); border-radius:3px; padding:8px;
    font-size:11px; max-height:140px; overflow:auto; white-space:pre-wrap; margin-top:8px;
  }
```

Also remove `details.panel > summary:focus-visible` from this combined
selector (find it near the top of the file):

```css
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible,
  details.info > summary:focus-visible, details.panel > summary:focus-visible{
```

becomes:

```css
  input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible,
  details.info > summary:focus-visible{
```

And in the `@media print` block, find:

```css
    fieldset, .side-box, details.panel{ border-color:var(--edge); break-inside:avoid; }
```

Delete this line entirely (fieldsets and `.side-box` are gone by the
end of this plan; `details.panel` was already dead).

- [ ] **Step 10: Verify**

Run: `node --check src/index.html` — this isn't valid (`.html` isn't
JS), so instead just open the file and confirm no unclosed braces by
eye, then rely on Step 11's build, which fails loudly on malformed
`<style>` content only if it breaks the surrounding HTML structure
(build.js does plain string concatenation, not CSS parsing — a CSS
syntax error won't fail the build, but will visibly break the page;
read the diff carefully).

Run: `grep -c -- "--panel-2\|--edge-lo\|--ink-dim2\|--icon-upload\|--icon-remove\|--icon-info\|--icon-tie-ok\|--icon-tie-bad\|--icon-chevron" src/index.html` —
expect `0`.
Run: `grep -c -- "--ok:\|--warn:\|--accent:\|--accent-2:" src/index.html` —
expect `0` (the declarations are gone; Step 2 already repointed every
*use*, so this also confirms no stray `var(--ok)` etc. survived).
Run: `grep -c "var(--inset)" src/index.html` — expect `0` (renamed to
`--field` everywhere).
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.

- [ ] **Step 11: Commit**

```bash
git add src/index.html
git commit -m "index.html: consolidate CSS tokens, drop icon masks for plain text"
```

---

### Task 3: `src/index.html` — body markup restructure

**Files:**
- Modify: `src/index.html` (body only — the `<style>` block was Task 2)

**Interfaces:** none new — this task only changes markup to match the
CSS Task 2 already put in place. No ids referenced by JS change.

- [ ] **Step 1: Delete every `.groove`/`.groove.tight` divider div**

There are 9 occurrences, each on its own line, e.g.
`<div class="groove"></div>` (once, right after the `<header>`) and
`<div class="groove tight"></div>` (8 times, between every other pair
of sections, and once more right before the actions row). Delete all
9 lines. Find them with `grep -n "class=\"groove" src/index.html`
before and after to confirm the count drops from 9 to 0.

- [ ] **Step 2: Convert each top-level `<fieldset><legend>...</legend>` to `<section><h2>...</h2>`**

There are 10 fieldsets. For each, replace the opening
`<fieldset>\n    <legend>TEXT</legend>` with
`<section>\n    <h2>TEXT</h2>` and its matching closing `</fieldset>`
with `</section>`. The 10 legends, verbatim, are: `Release`,
`Notes to the Cutting Engineer`, `Record Summary`, `Labels`,
`Inner Sleeve`, `Outer Cover`,
`Inlay <span style="font-weight:400;text-transform:none;letter-spacing:0;">(optional, printed both sides, 170gsm)</span>`,
`Vinyl Colour & Quantity`, `Billing Address`, `Shipping Address(es)`.
Everything else inside each fieldset (all the field rows, inputs,
selects, ids) stays byte-for-byte identical — only the two wrapping
tags change. Example, the `Release` section — current:

```html
  <fieldset>
    <legend>Release</legend>
    <div class="row">
```

becomes:

```html
  <section>
    <h2>Release</h2>
    <div class="row">
```

...and its closing `</fieldset>` (a few lines later, right before the
`<div class="groove tight"></div>` that Step 1 already deleted)
becomes `</section>`. Repeat for all 10. (`<section>` has no special
CSS — it's a plain block element here, same as the `<div>` it
effectively replaces; the visual structure comes entirely from `<h2>`
now.)

- [ ] **Step 3: Inlay's two `side-box` sub-items → plain `<h3>`**

Current (inside the now-renamed Inlay `<section>`, within
`#inlayBody`):

```html
        <div class="side-box">
          <div class="side-head">
            <h2>Inlay Front</h2>
          </div>
          <div class="row" style="align-items:end;">
            <div class="field" style="flex:0 0 auto;">
              <label>&nbsp;</label>
              <button type="button" class="pickbtn no-print" id="inlayfrontpick" title="Choose inlay front artwork">⏏</button>
            </div>
```

Replace the wrapping/heading lines (leave everything from
`<div class="row"...` onward in this excerpt untouched apart from the
button text handled in Step 4):

```html
        <div>
          <div class="side-head">
            <h3>Inlay Front</h3>
          </div>
          <div class="row" style="align-items:end;">
            <div class="field" style="flex:0 0 auto;">
              <label>&nbsp;</label>
              <button type="button" class="pickbtn no-print" id="inlayfrontpick" title="Choose inlay front artwork">⏏</button>
            </div>
```

A few lines later, the "Inlay Back" block has the identical shape.
Current:

```html
        <div class="side-box">
          <div class="side-head">
            <h2>Inlay Back</h2>
          </div>
          <div class="row" style="align-items:end;">
            <div class="field" style="flex:0 0 auto;">
              <label>&nbsp;</label>
              <button type="button" class="pickbtn no-print" id="inlaybackpick" title="Choose inlay back artwork">⏏</button>
            </div>
```

Replace with:

```html
        <div>
          <div class="side-head">
            <h3>Inlay Back</h3>
          </div>
          <div class="row" style="align-items:end;">
            <div class="field" style="flex:0 0 auto;">
              <label>&nbsp;</label>
              <button type="button" class="pickbtn no-print" id="inlaybackpick" title="Choose inlay back artwork">⏏</button>
            </div>
```

- [ ] **Step 4: Static pick buttons → `(+)` text**

Four buttons, each currently `title="..." >⏏</button>`. Change each
button's inner text from `⏏` to `(+)` — everything else (attributes,
id, title) stays identical:

```html
<button type="button" class="pickbtn no-print" id="innersleevepick" title="Choose inner sleeve artwork">⏏</button>
<button type="button" class="pickbtn no-print" id="coverpick" title="Choose cover artwork">⏏</button>
<button type="button" class="pickbtn no-print" id="inlayfrontpick" title="Choose inlay front artwork">⏏</button>
<button type="button" class="pickbtn no-print" id="inlaybackpick" title="Choose inlay back artwork">⏏</button>
```

each becomes (only the inner text changes, e.g.):

```html
<button type="button" class="pickbtn no-print" id="innersleevepick" title="Choose inner sleeve artwork">(+)</button>
```

...and identically for the other three.

- [ ] **Step 5: Relabel and reorder the actions row**

Current:

```html
  <!-- ============ ACTIONS ============ -->
  <div class="actions no-print">
    <button class="btn" id="btnPrint">Print / Save as PDF</button>
    <button class="btn ghost" id="btnSaveProject">Save Project (.zip)</button>
    <button class="btn ghost" id="btnOpenProject">Open Project (.zip)</button>
    <input type="file" id="openProjectInput" accept=".zip,application/zip" class="hidden">
    <button class="btn ghost" id="btnSwissTransfer">Send to Plant (via SwissTransfer)</button>
  </div>
```

Replace with (ids unchanged — `tracklist.js`'s `initTracklist()` wires
listeners to these same four ids, see Task 6 for confirmation no JS
edit is needed):

```html
  <!-- ============ ACTIONS ============ -->
  <div class="actions no-print">
    <div class="action-group">
      <button class="btn" id="btnSaveProject">Save</button>
      <button class="btn" id="btnOpenProject">Load</button>
      <input type="file" id="openProjectInput" accept=".zip,application/zip" class="hidden">
    </div>
    <button class="btn" id="btnSwissTransfer">Send</button>
    <button class="btn" id="btnPrint">Print</button>
  </div>
```

- [ ] **Step 6: Verify**

Run: `grep -c "<fieldset\|<legend\|class=\"groove\|class=\"side-box\"" src/index.html` —
expect `0` (the one remaining `.side-box` reference, ship-addr's
`class="side-box ship-addr"`, is a different string — `class="ship-addr side-box"`
never appears standalone as `class="side-box"` after this task, but it
still exists as a substring in Task 8's target until that task runs;
if this grep is nonzero because of that, confirm by eye it's only the
`shipAddrTemplate` occurrence in `shipping-billing.js`, not anything
left in `index.html`).
Run: `grep -c "⏏" src/index.html` — expect `0`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.
Read the diff and confirm every section's inner content (inputs,
selects, ids) is byte-identical to before — only wrapping
tags/headings/dividers/button text changed.

- [ ] **Step 7: Commit**

```bash
git add src/index.html
git commit -m "index.html: plain sections instead of bordered fieldsets"
```

---

### Task 4: `src/lib/info-text.js` — `(?)` info toggle text

**Files:**
- Modify: `src/lib/info-text.js`

**Interfaces:**
- Produces: `renderInfoIcon(text)` — same signature, same early-return
  on empty/missing text, same `<details class="info no-print">`
  wrapper. Only the `<summary>` element's inner text changes (from
  empty, icon-only via CSS, to literal `(?)`). `tests/info-text.test.js`
  asserts the output starts with `<details class="info no-print">`,
  contains `<summary`, contains the passed-in text, and has no `open`
  attribute — none of those assertions pin the summary's inner content,
  so this change doesn't require a test edit.

- [ ] **Step 1: Change the summary's text content**

Current:

```js
export function renderInfoIcon(text){
  if(!text) return "";
  return `<details class="info no-print"><summary title="More info"></summary><div class="info-body">${text}</div></details>`;
}
```

Replace with:

```js
export function renderInfoIcon(text){
  if(!text) return "";
  return `<details class="info no-print"><summary title="More info">(?)</summary><div class="info-body">${text}</div></details>`;
}
```

- [ ] **Step 2: Verify**

Run: `node --test tests/info-text.test.js` — expect all 6 tests still
passing.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.

- [ ] **Step 3: Commit**

```bash
git add src/lib/info-text.js
git commit -m "info-text: render (?) as the info-toggle's visible text"
```

---

### Task 5: `src/modules/labels.js` — plain sub-headings, `(+)` pick button

**Files:**
- Modify: `src/modules/labels.js`

**Interfaces:** none change — `labelSideTemplate(side)`'s return value
changes, but every id inside it (`labelbox-${side}`, `labelpick-${side}`,
etc.) stays identical, so every other function in this file that does
`document.getElementById(...)` on those ids keeps working unmodified.

- [ ] **Step 1: Update the template**

Current:

```js
function labelSideTemplate(side){
  return `
  <div class="side-box" id="labelbox-${side}">
    <div class="side-head">
      <h2>Label ${side}</h2>
      <div class="side-opts">
        <label class="chk"><input type="checkbox" id="whitelabel-${side}"> whitelabel (blank)</label>
      </div>
    </div>

    <div id="labelbody-${side}">
      <div class="row" style="align-items:end;">
        <div class="field" style="flex:0 0 auto;">
          <label>&nbsp;</label>
          <button type="button" class="pickbtn no-print" id="labelpick-${side}" title="Choose label artwork">⏏</button>
        </div>
```

Replace with (drops the `side-box` class from the wrapping div, keeps
its `id`; `<h2>` → `<h3>`; pick button text `⏏` → `(+)`):

```js
function labelSideTemplate(side){
  return `
  <div id="labelbox-${side}">
    <div class="side-head">
      <h3>Label ${side}</h3>
      <div class="side-opts">
        <label class="chk"><input type="checkbox" id="whitelabel-${side}"> whitelabel (blank)</label>
      </div>
    </div>

    <div id="labelbody-${side}">
      <div class="row" style="align-items:end;">
        <div class="field" style="flex:0 0 auto;">
          <label>&nbsp;</label>
          <button type="button" class="pickbtn no-print" id="labelpick-${side}" title="Choose label artwork">(+)</button>
        </div>
```

(the rest of the template — everything from `<div class="field">` for
the artwork-file label onward, through the closing `</div>`s — is
unchanged; only the four lines shown above differ.)

- [ ] **Step 2: Verify**

Run: `node --check src/modules/labels.js`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.
Grep the built file: `grep -c "side-box\" id=\"labelbox" dist/index.html` —
expect `0`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/labels.js
git commit -m "labels: plain sub-heading and (+) pick button per side"
```

---

### Task 6: `src/modules/tracklist.js` — track-row and continuous-file button text

**Files:**
- Modify: `src/modules/tracklist.js`

**Interfaces:** none change — only button inner text changes; every id
and class the rest of the file/other modules select on stays
identical. Confirms (does not change) that `#btnSaveProject`,
`#btnOpenProject`, `#btnSwissTransfer`, `#btnPrint` listener wiring in
`initTracklist()` needs no edit, since Task 3 kept those four ids.

- [ ] **Step 1: Track-row pick/remove buttons**

Current (inside `createTrackRow(side)`):

```js
    <div class="pos">--</div>
    <button type="button" class="pickbtn no-print" title="Choose audio file">⏏</button>
```

and, further down in the same template string:

```js
    <button type="button" class="rmbtn no-print" title="Remove track">✕</button>
```

Replace the pick button's text:

```js
    <div class="pos">--</div>
    <button type="button" class="pickbtn no-print" title="Choose audio file">(+)</button>
```

Replace the remove button's text:

```js
    <button type="button" class="rmbtn no-print" title="Remove track">(x)</button>
```

- [ ] **Step 2: Per-side continuous-file pick button**

Current:

```js
            <button type="button" class="pickbtn no-print" id="contpick-${side}" title="Choose side file">⏏</button>
```

Replace with:

```js
            <button type="button" class="pickbtn no-print" id="contpick-${side}" title="Choose side file">(+)</button>
```

- [ ] **Step 3: Verify**

Run: `node --check src/modules/tracklist.js`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.
Grep the built file: `grep -c "⏏\|>✕<" dist/index.html` — expect `0`
(this also confirms Tasks 7/8 haven't run yet if you're executing
tasks out of order — re-run this grep again at the end of Task 8 and
expect `0` there too, since by then every source of `⏏`/`✕` is gone).

- [ ] **Step 4: Commit**

```bash
git add src/modules/tracklist.js
git commit -m "tracklist: (+)/(x) text for track-row and side-file buttons"
```

---

### Task 7: `src/modules/vinyl-color.js` — `(x)` remove button

**Files:**
- Modify: `src/modules/vinyl-color.js`

**Interfaces:** none change.

- [ ] **Step 1: Update the template**

Current:

```js
    <div class="field" style="flex:0 0 auto;">
      <label>&nbsp;</label>
      <button type="button" class="rmbtn no-print colourRemove" title="Remove colour">✕</button>
    </div>
```

Replace with:

```js
    <div class="field" style="flex:0 0 auto;">
      <label>&nbsp;</label>
      <button type="button" class="rmbtn no-print colourRemove" title="Remove colour">(x)</button>
    </div>
```

- [ ] **Step 2: Verify**

Run: `node --check src/modules/vinyl-color.js`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.

- [ ] **Step 3: Commit**

```bash
git add src/modules/vinyl-color.js
git commit -m "vinyl-color: (x) text for the remove-colour button"
```

---

### Task 8: `src/modules/shipping-billing.js` — plain sub-heading, `(x)` remove button

**Files:**
- Modify: `src/modules/shipping-billing.js`

**Interfaces:** none change — `shipAddrTemplate(isPrimary)`'s return
value changes, but `.ship-addr` (still present, just without
`side-box`) and `.ship-addr-title` stay as the exact selectors
`shipAddrEls()`/`renumberShipAddrs()` already use.

- [ ] **Step 1: Update the template**

Current:

```js
function shipAddrTemplate(isPrimary){
  return `
  <div class="side-box ship-addr">
    <div class="side-head">
      <h2 class="ship-addr-title"></h2>
      <div class="side-opts">
        ${isPrimary ? `<label class="chk"><input type="checkbox" class="sameAsBilling"> same as billing address</label>` : `<button type="button" class="rmbtn no-print shipRemove" title="Remove address">✕</button>`}
      </div>
    </div>
```

Replace with (drops `side-box` from the class list, keeps
`ship-addr`; `<h2>` → `<h3>`; remove-button text `✕` → `(x)`):

```js
function shipAddrTemplate(isPrimary){
  return `
  <div class="ship-addr">
    <div class="side-head">
      <h3 class="ship-addr-title"></h3>
      <div class="side-opts">
        ${isPrimary ? `<label class="chk"><input type="checkbox" class="sameAsBilling"> same as billing address</label>` : `<button type="button" class="rmbtn no-print shipRemove" title="Remove address">(x)</button>`}
      </div>
    </div>
```

(the rest of the function — `addressCoreFieldsHtml()` call, the
colour-qty row, the note field, the checklist `<ul>` — is unchanged.)

- [ ] **Step 2: Verify**

Run: `node --check src/modules/shipping-billing.js`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.
Grep the built file for every icon/box remnant this and the prior
module tasks removed:
`grep -c "⏏\|>✕<\|class=\"side-box" dist/index.html` — expect `0`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/shipping-billing.js
git commit -m "shipping-billing: plain address sub-heading, (x) remove button"
```

---

### Task 9: `src/modules/tracklist.js` — restyle the SwissTransfer instruction page

**Files:**
- Modify: `src/modules/tracklist.js`

**Interfaces:** none change — `sendToPlant()`'s logic (gate, build zip,
download, generate and download the instruction page) is untouched;
only the generated HTML page's inline `<style>` block and heading
text change.

- [ ] **Step 1: Restyle the generated page**

Current (inside `sendToPlant()`):

```js
  const page = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Send via SwissTransfer</title>
<style>
  body{font-family:ui-monospace,"JetBrains Mono","IBM Plex Mono",Consolas,monospace;
       background:#eeece3;color:#1c1b18;max-width:520px;margin:60px auto;padding:0 20px;line-height:1.6;}
  h1{font-size:16px;letter-spacing:.04em;}
  .box{border:1px solid #bdb7a4;border-radius:2px;padding:16px 18px;margin:18px 0;background:#fff;}
  .label{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#5c584e;}
  .val{font-size:15px;font-weight:700;margin-top:2px;}
  a.btn{display:inline-block;margin-top:14px;padding:9px 16px;background:#1c1b18;color:#eeece3;
        text-decoration:none;border-radius:2px;font-size:12px;}
  a.btn:hover{background:#d1470f;}
</style></head>
<body>
  <h1>Send via SwissTransfer — ${cat}</h1>
  <div class="box">
    <div class="label">Upload this file</div>
    <div class="val">${fileName}</div>
  </div>
  <div class="box">
    <div class="label">Send to</div>
    <div class="val">${CONFIG.studioEmail}</div>
  </div>
  <p>Open SwissTransfer, add the file above, enter the address above as the recipient, and send.</p>
  <a class="btn" href="https://www.swisstransfer.com/" target="_blank" rel="noopener">Open swisstransfer.com</a>
</body></html>`;
```

Replace with (same structure and content, tokens matching the main
page's consolidated palette, no pill-shaped button):

```js
  const page = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>Send — ${cat}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
       background:#ffffff;color:#161616;max-width:520px;margin:60px auto;padding:0 20px;line-height:1.6;}
  h1{font-size:15px;padding-bottom:8px;border-bottom:1px solid #d6d6d3;margin-bottom:14px;}
  .box{border:1px solid #d6d6d3;border-radius:3px;padding:12px 14px;margin:14px 0;background:#f6f6f5;}
  .label{font-size:12px;color:#5c5c59;}
  .val{font-size:14px;font-weight:700;margin-top:2px;}
  a.btn{display:inline-block;margin-top:14px;padding:8px 14px;border:1px solid #d6d6d3;color:#161616;
        text-decoration:none;border-radius:3px;font-size:13px;}
  a.btn:hover{background:#f6f6f5;border-color:#161616;}
</style></head>
<body>
  <h1>Send — ${cat}</h1>
  <div class="box">
    <div class="label">Upload this file</div>
    <div class="val">${fileName}</div>
  </div>
  <div class="box">
    <div class="label">Send to</div>
    <div class="val">${CONFIG.studioEmail}</div>
  </div>
  <p>Open SwissTransfer, add the file above, enter the address above as the recipient, and send.</p>
  <a class="btn" href="https://www.swisstransfer.com/" target="_blank" rel="noopener">Open swisstransfer.com</a>
</body></html>`;
```

- [ ] **Step 2: Verify**

Run: `node --check src/modules/tracklist.js`.
Run: `node --test tests/` — expect 131 passing, unchanged.
Run: `node build/build.js` — expect success.
Read the diff and confirm the JS logic above and below the `page =`
template literal (gating, zip building, download, the second
`pageBlob`/download-trigger lines right after it) is untouched — only
the string contents of `page` changed.

- [ ] **Step 3: Commit**

```bash
git add src/modules/tracklist.js
git commit -m "tracklist: restyle the SwissTransfer instruction page"
```

---

### Task 10: Final integration pass

**Files:** none (verification only)

- [ ] **Step 1: Full regression suite**

Run: `node --test tests/`
Expected: 131 passing, 0 failing — unchanged from this plan's start
(no `src/lib` logic touched; Task 4's `info-text.js` change doesn't
affect any assertion).

- [ ] **Step 2: Build**

Run: `node build/build.js`
Expected: success, no errors.

- [ ] **Step 3: Grep the built file for every removed pattern**

```bash
grep -c -- "--panel-2\|--edge-lo\|--ink-dim2\|--icon-upload\|--icon-remove\|--icon-info\|--icon-tie-ok\|--icon-tie-bad\|--icon-chevron\|var(--ok)\|var(--warn)\|var(--accent" dist/index.html
```

Expected: `0`.

```bash
grep -c "⏏\|>✕<\|class=\"side-box\|<fieldset\|<legend\|class=\"groove\|details.panel\|class=\"panel\"" dist/index.html
```

Expected: `0`.

```bash
grep -c "class=\"btn ghost\"" dist/index.html
```

Expected: `0` — no button uses the deleted `ghost` modifier anymore.

- [ ] **Step 4: Spec coverage check**

Re-read `docs/superpowers/specs/2026-09-22-ui-declutter-design.md`
section by section and confirm each is covered:
- `DESIGN.md` rewritten per the Appendix, verbatim (Task 1) ✓.
- No nested framing: fieldsets → sections+headings (Task 3), side-box
  sub-items → plain `<h3>` (Tasks 3, 5, 8) ✓.
- Icon elimination: pick/remove/info buttons → `(+)`/`(x)`/`(?)` text
  (Tasks 3–9), custom chevron dropped along with dead `details.panel`
  CSS (Task 2) ✓.
- Checklist marks, status badge, track position → plain text
  (Task 2 — no JS change needed, confirmed the `✓`/`!` text was
  already present) ✓.
- CSS token consolidation to the six documented tokens (Task 2) ✓.
- Sentence-case labels (Task 2, Step 5) ✓.
- Action buttons relabeled/reordered `Save · Load | Send | Print`,
  uniform style (Tasks 2 Step 6, 3 Step 5) ✓.
- SwissTransfer page restyled (Task 9) ✓.
- Non-goals: confirm no task touched `src/lib/*` logic, `tests/*`,
  validation/gating/calculation code, or any DOM id the JS reads —
  only `src/lib/info-text.js`'s presentational string (Task 4, doesn't
  affect its test) and `src/index.html`/module *markup and CSS* were
  touched.

- [ ] **Step 5: Report to the user**

Summarize: tests passing, build succeeding, spec coverage confirmed.
Note explicitly that live-in-browser verification of the actual
rendered UI (does the page actually look plain and uncluttered, do the
`(+)`/`(x)`/`(?)` buttons look right, does the actions row group
correctly) has **not** been performed automatically — ask the user
whether they want it verified live in Chrome before considering this
done, per their standing preference not to spin that up by default.
