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
explain itself beyond a per-field `?` info toggle for whoever wants
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

Small inline actions are plain single characters, not icons:
`↑` choose/attach a file, `x` remove a file, `?` open a field's info
text. No authored SVG icon anywhere in the system.

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
- Use plain ASCII/text for every small affordance (`↑`, `x`,
  `?`, `✓`, `!`) instead of an authored icon.
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
