# UI declutter — design

Status: approved, pending implementation plan

## Context

`DESIGN.md` and the UI it describes accumulated visual ceremony across
three prior redesign passes (cream/terracotta → dark "patch bay" →
colourless "patch sheet"). Two independent reviews of the current state
— one from this session, one from a separate conversation the user had
with another AI tool — converged on the same conclusion, and the user
confirmed it directly: the tool over-frames itself. Sections nest inside
sections (a bordered `Labels` fieldset wrapping two more bordered
per-side boxes, each with its own heading), status gets wrapped in
pills and custom icon vocabulary (tie-line connectors, a boxed "lane
badge" for track position) that a plain form doesn't need, and several
CSS custom properties turn out to be exact duplicate aliases
(`--warn` === `--danger`, both `#b3261e`; `--accent`/`--accent-2` both
resolve to ink). None of this serves the audience — label owners/
artists and plant staff who already know how to read an order form —
better than plain text would.

The user's own framing: build it like the plant's own
`order_summary.txt` — a written sheet, not a styled product. "We are
hackers: we are always better than webdesigners. We focus on function
and simplicity, not on attraction and marketing."

This is a **visual and structural** pass only. No validation, gating,
calculation, file-handling, ZIP-naming, or checklist-timing logic
changes. Every DOM id/class the JS logic reads or writes stays exactly
as it is — see Constraints.

## Goals

- Rewrite `DESIGN.md` from scratch: short, single authoritative
  statement per rule, no redesign history, no contradictions.
- Remove all nested framing (fieldset-in-fieldset-in-box). Top-level
  sections get a heading + one hairline rule; repeated sub-items get a
  plain sub-heading and nothing else.
- Replace every authored SVG icon with plain ASCII/Unicode text —
  `(+)` choose file, `(x)` remove, `(?)` info — and drop the custom
  disclosure chevron in favour of the browser's native `<details>`
  marker. Zero custom icon masks left in the system.
- Replace the tie-line checklist icons with plain `✓`/`!` marks, the
  playing-time badge pill with plain text, and the track-position lane
  chip with plain text in its own column.
- Consolidate CSS custom properties to the minimum the system actually
  uses; delete exact-duplicate aliases.
- Sentence-case field labels at normal weight; drop uppercase +
  letter-spacing as a blanket label treatment.
- Rename/reorder the action buttons to `SAVE · LOAD | SEND | PRINT`,
  one uniform button style (no primary/ghost distinction), grouped by
  workflow order with room for future buttons. `SEND` replaces "Send
  to Plant (via SwissTransfer)" — same handler (`sendToPlant()`), same
  gating (`confirmIncompleteSend()`), just the label and surrounding
  chrome change.
- Restyle the generated SwissTransfer instruction page (currently
  off-system inline cream/terracotta CSS embedded in `tracklist.js`)
  to the same token set as the main page.

## Non-goals / Constraints

- **No behavior change.** Checklist red-on-blank-load stays as-is
  (explicitly deferred by the user, separate future decision). Send/
  Print gating, artwork validation, quantity allocation, address
  handling, ZIP save/load, and file naming are untouched.
- **DOM contracts stay fixed.** The logic reads/writes these by id or
  class and must keep working unmodified:
  `.checklist li.bad`, `.checklist li.blocking`, `.checklist li.ok`,
  `.filemeta.empty[id]` (+ its `.hidden`-ancestor check),
  `.labelwarnings li.err`/`.warn`/`.ok`, `.hidden`, every element id
  `recompute()`/`updateChecklist()`/each module's `apply*`/`collect*`
  touches (`total-${side}`, `badge-${side}`, `limitsnote-${side}`,
  `labelbox-${side}`, `labelmeta-${side}`, etc.). Renaming a CSS class
  used purely for styling (e.g. `.side-box`) is fine; renaming an id or
  a class the JS selects on is not, unless the JS is updated in the
  same change and still reads/writes the same semantic state.
- No new dependencies, no build changes. Still one self-contained
  `dist/index.html`.
- `src/lib/*` and `tests/*` are untouched — this is a `src/index.html`
  + `src/modules/*` (templates/CSS only) + `DESIGN.md` change.
- Desktop-first stays explicit and final: both audiences (customers
  and plant staff) use this at a desk, not on a phone. No new
  responsive breakpoint work; existing flex-wrap stays as a fallback,
  not a design target.

## Target design (replaces `DESIGN.md` in full)

The Appendix below is the literal replacement content for `DESIGN.md`
(front-matter + body). The implementation plan writes this file
verbatim, then brings the UI into line with it.

### Structural mapping (old → new)

- **Top-level sections** (`Release`, `Notes to the Cutting Engineer`,
  `Record Summary`, `Labels`, `Inner Sleeve`, `Outer Cover`, `Inlay`,
  `Vinyl Colour & Quantity`, `Billing Address`, `Shipping Address(es)`):
  `<fieldset><legend>` (bordered box) → `<h2>` + one `<hr>`-style
  hairline rule directly under it. No border, no background fill.
- **Repeated sub-items** (Label A/B, Inlay front/back, each shipping
  address instance): nested `.side-box` (bordered, own heading) →
  plain `<h3>` sub-heading, no border, no background. Fields below it
  flow directly, same as a top-level section's fields would.
- **Icon buttons** (`.pickbtn` with an upload SVG mask, `.rmbtn` with
  an X SVG mask): become plain text buttons, `(+)` and `(x)`
  respectively — same click handlers, same ids, just SVG-mask styling
  replaced by literal button text. No icon vocabulary to learn.
- **Info-toggle button** (circle, "i" SVG mask): becomes plain text
  `(?)`. Same `<details>`-toggle behavior.
- **Disclosure chevron** on `details.panel > summary`: drop the custom
  SVG mask entirely; let the browser render its native `<details>`
  marker (`::-webkit-details-marker` no longer suppressed).
- **Checklist marks** (`.checklist .mark::before` tie-line SVG masks):
  become plain text characters, `✓` for `.ok`, `!` for `.bad` — same
  `li.ok`/`li.bad`/`li.blocking` classes and colors (`--ink-dim`/
  `--danger`), just rendered as text instead of a masked icon.
- **Playing-time status badge** (`.badge`, bordered 99px-radius pill):
  becomes plain inline text next to the total — same content
  ("within recommendation" / "approaching limit" / "exceeds
  recommendation"), same color logic, no pill shape/border.
- **Track position** (`.pos`, bordered chip): becomes plain text in
  its grid column — no border, no background, no radius.
- **Action buttons**: reorder/relabel to `Save`, `Load`, `Send`,
  `Print`, one shared button style (border + text, no filled
  "primary"), grouped with spacing (`Save Load` | `Send` | `Print`).
  `#btnSaveProject` → label "Save" (id can stay or become `#btnSave`,
  implementer's call, since it's referenced by id only within
  `app.js`'s own wiring). Same for Load/Send/Print.
- **SwissTransfer instruction page** (`tracklist.js`'s inline
  `<style>` block in the generated HTML string): replace the
  cream/terracotta tokens with the new shared token set (ink/paper/
  edge/field/danger), same content and structure (filename box,
  studio-email box, swisstransfer.com link).

### CSS custom property consolidation

Drop (exact duplicates or no-longer-needed):
`--panel-2`, `--edge-lo`, `--ink-dim2`, `--ok`, `--warn` (alias of
`--danger`), `--accent`, `--accent-2` (aliases of `--ink`),
`--icon-upload`, `--icon-remove`, `--icon-info`, `--icon-tie-ok`,
`--icon-tie-bad`, `--icon-chevron` (no more authored icon masks).

Keep: `--bg`/`--paper`, `--ink`, `--ink-dim` (single secondary-text
step), `--edge` (hairline rules + input borders — the only place a
border appears), `--field` (rename of `--inset`, input fill only),
`--danger`, `--sans`, `--mono`.

Every current use of `--ok`, `--warn`, `--panel-2`, `--edge-lo`,
`--ink-dim2`, `--accent`/`--accent-2` needs to be re-pointed at the
consolidated token that already carries the same meaning (mostly
`--ink-dim` for "ok"/secondary states, `--danger` for anything that
was `--warn`, `--edge` for anything that was `--edge-lo`, `--ink` for
anything that was `--accent`/`--accent-2`).

## Appendix: new `DESIGN.md`

```markdown
---
name: Record Orderbook
description: An order-intake form for a vinyl pressing plant — plain, dense, and text-first, like the plant's own order summary sheet.
colors:
  ink: "#161616"
  ink-dim: "#5c5c59"
  paper: "#ffffff"
  field: "#f6f6f5"
  edge: "#d6d6d3"
  danger: "#b3261e"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  data:
    fontFamily: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, 'Roboto Mono', monospace"
    fontSize: "13.5px"
    fontVariantNumeric: tabular-nums
rounded:
  sm: "3px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "22px"
components:
  button:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 8px"
---

# Design System: Record Orderbook

## Overview

This is an order-intake form for a vinyl pressing plant, built like the
plant's own `order_summary.txt`: a plain written sheet — heading, rule,
label, value, next heading. No visual theme, no metaphor, no icon
vocabulary to learn. Every element earns its place by carrying
information; nothing is decoration.

Audience: label owners/artists filling the form, and plant staff
(customer service, mastering engineer, graphics department) rereading
or editing it. Both are desktop users at a desk — this is not designed
for mobile. Both already know how to read a form; the page doesn't
explain itself beyond a per-field `(?)` info toggle for whoever wants
more detail.

## Colors

Two colors plus one alarm: black ink, white paper, red for "needs
attention." Nothing else.

- **Ink** (`#161616`): all text, all button/input borders and text.
- **Ink Dim** (`#5c5c59`): secondary/meta text — hints, filenames,
  captions, satisfied checklist items. One step, not two.
- **Paper** (`#ffffff`): page background. Sections are not visually
  distinct from the page — no fill, no border, no card.
- **Field** (`#f6f6f5`): input backgrounds only — the one place a
  fill distinguishes an element, because it's interactive.
- **Edge** (`#d6d6d3`): hairline rules under section headings, and
  input/button borders. The only place a border appears.
- **Danger** (`#b3261e`): the one alarm color. Warnings, errors,
  missing/incomplete parts — checklist `!` marks, artwork warnings, a
  required field left blank at send time. Never anything else.

**The One Alarm Rule.** Red means "needs attention," full stop. If a
future state needs flagging, reuse `--danger` or change weight/
punctuation — don't add a second hue.

## Typography

One system sans for everything — headings, labels, body, buttons.
One monospace (`ui-monospace`/`JetBrains Mono` stack, tabular numerals)
reserved strictly for measured/identifying data: catalogue number,
matrix inscription, track times and positions. Its appearance is
itself a signal ("this value is exact"), not a technical costume.

Field labels are sentence case, normal weight, body size — no
uppercase, no letter-spacing. Section headings are bold, one size up.
Nothing on screen renders below 11px; print is exempt (dense
single-page reference, not a screen-legibility problem).

## Layout

Single-column vertical form, desktop-first, `max-width: 1040px`,
centered. A section is a bold heading followed by one hairline rule;
fields flow directly beneath it, no border, no background. A repeated
sub-item (a side, an address) is a plain sub-heading one size down
from the section heading — no box, no fill, no rule of its own. Rows
use flex-wrap with `min-width` floors so a narrower window reflows
rather than clips, but no dedicated mobile layout exists — this tool
lives at a service desk or a lathe, not a phone.

Print collapses the same structure into a dense reference sheet (tight
padding, hairline rules) — the screen and print layouts were already
close; this pass makes them closer.

## Elevation & Depth

None. No shadows, no cards, no raised surfaces anywhere. A section is
separated from the page by a rule under its heading, nothing more. An
input is separated from the page by its `--field` fill, nothing more.

## Components

### Buttons

One style: `--edge` border, `--ink` text, `--paper` background, 3px
radius, 8px/14px padding. No filled "primary" button — hierarchy comes
from left-to-right order and grouping spacing, not weight or fill.

Action order: **Save · Load | Send | Print** — grouped by workflow
(project actions, then the plant-facing action, then the rarely-used
print/export), with room for future buttons in the same order logic.

Small inline actions are plain bracketed text, not icons:
`(+)` choose/attach a file, `(x)` remove a file, `(?)` open a field's
info text. No authored SVG icon anywhere in the system.

### Sections

A bold heading, one hairline rule beneath it, fields below. No border,
no fill, no nesting. A sub-item inside a section (a side, an address)
is a plain sub-heading, not a box.

### Inputs / Fields

`--field` fill, `--edge` 1px border, 3px radius, no shadow. Focus is a
2px solid ink outline, 1px offset, on every interactive element.
Native controls (checkbox/radio/select) keep browser chrome,
recolored via `accent-color: var(--ink)`.

### Checklist

Plain text marks: `✓` for a satisfied item (`--ink-dim`), `!` for a
missing/invalid one (`--danger`). No custom iconography — the
character and the color both carry the signal.

### Status text

The playing-time recommendation ("within recommendation" /
"approaching limit" / "exceeds recommendation") and the track position
(`A1`, `B2`) are plain inline text — no pill, no chip, no border.

## Do's and Don'ts

### Do:
- Use `--danger` exclusively for warning/error/missing states.
- Use plain ASCII/text for every small affordance (`(+)`, `(x)`,
  `(?)`, `✓`, `!`) instead of an authored icon.
- Reserve monospace for genuinely measured/identifying values.
- Let native browser chrome (details marker, checkbox/radio/select)
  do the work instead of a custom-drawn replacement.

### Don't:
- Don't add a border, fill, or shadow to a section or sub-item just to
  group it — a heading and spacing already do that.
- Don't add a second hue. If red isn't enough to express a new state,
  that's a text/weight problem, not a missing-color problem.
- Don't author a new SVG icon. If an action needs a glyph, it's
  bracketed ASCII text.
```

## Verification

- `node --test tests/` — unchanged (no `src/lib` changes), must stay
  at the current 131 passing.
- `node build/build.js` — must succeed, `dist/index.html` stays a
  single self-contained file.
- Grep the built file for the removed icon custom-properties
  (`--icon-upload`, `--icon-tie-ok`, etc.) and for `--warn`/`--ok`/
  `--panel-2`/`--edge-lo`/`--ink-dim2`/`--accent-2` — expect zero
  matches once the consolidation is complete.
- Manual read-through of the diff against this spec for every module
  (labels, cover, inner-sleeve, inlay, vinyl-color, shipping-billing,
  tracklist) confirming no DOM id/class the JS reads was renamed
  without updating its call site.
- Ask the user before any live-in-browser Chrome verification, per
  their standing preference.
