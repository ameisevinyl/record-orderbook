---
name: Record Orderbook
description: An order-intake form for a vinyl pressing plant, styled as a printed patch-sheet from a mastering studio's reference binder.
colors:
  ink: "#161616"
  ink-hover: "#000000"
  ink-dim: "#5c5c59"
  ink-dim2: "#737370"
  paper: "#ffffff"
  panel-2: "#f5f5f4"
  inset: "#f6f6f5"
  edge: "#d6d6d3"
  edge-lo: "#e9e9e7"
  severity-low: "#6b6b68"
  severity-alert: "#b3261e"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 700
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.04em"
    textTransform: uppercase
  data:
    fontFamily: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, 'Roboto Mono', monospace"
    fontSize: "13.5px"
    fontVariantNumeric: tabular-nums
  data-label:
    fontFamily: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, 'Roboto Mono', monospace"
    fontSize: "12px"
    fontWeight: 700
    fontVariantNumeric: tabular-nums
  data-total:
    fontFamily: "ui-monospace, 'JetBrains Mono', 'IBM Plex Mono', 'Cascadia Code', 'Fira Code', 'SF Mono', Consolas, 'Roboto Mono', monospace"
    fontSize: "25px"
    fontWeight: 700
    fontVariantNumeric: tabular-nums
rounded:
  sm: "3px"
  md: "4px"
  pill: "99px"
  circle: "50%"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  input:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "7px 8px"
---

# Design System: Record Orderbook

## Overview

**Creative North Star: "The Patch Sheet"**

This is an order-intake form for a vinyl pressing plant, and it refuses to look like another SaaS form. It reads as a printed wiring/normalling schedule pulled from a mastering studio's reference binder: white paper, hairline rules, colourless except for one deliberate exception — red, spent only on what needs attention. Fieldsets are lane panels divided by rule rather than by fill; the checklist's tie-line marks (a solid bar for patched/complete, a bar with a visible gap for open/missing) are the one place that still reads as "interactive vocabulary" rather than page furniture, and it's exactly where the red lives.

This is a deliberate third pass on the same structural world. The tool's original identity was a warm cream page with a dashed "vinyl groove" motif and a terracotta accent. A first redesign replaced that with a dark "patch bay" world — near-black hardware panels, one amber accent. A second pass replaced *that* with a fully colourless patch sheet at the user's request for something lighter, quieter, more scientific. This third pass keeps the colourless sheet but restores exactly one hue, red, and only for warnings/errors/missing parts — the user's own correction that a genuinely urgent state benefits from a real alarm colour, not just a darker grey. Every other state (ok/complete) stays neutral.

The audience is dual: label owners and artists (non-technical customers) filling the form, and pressing-plant staff (customer service, mastering engineer, graphics department) rereading or editing it. Both read the same sheet; neither needs onboarding to understand a checklist, an input, or a button.

**Key Characteristics:**
- Pure white ground, near-black ink, no hue anywhere except one: red, reserved entirely for "needs attention."
- Severity is binary in hue (neutral grey vs. red) and reinforced by shape/weight (the checklist's solid-vs-gapped tie-line, bold vs. regular warning text) — red is never used for anything that isn't a warning, error, or missing/incomplete state.
- Panels are divided by a 1px hairline rule, not by background fill; nothing "floats" on a card.
- Tie-line iconography — a solid bar with rounded terminals for complete, the same bar with a visible gap for missing — replaces every generic checkmark/exclamation glyph.
- One system sans throughout; a monospaced/tabular treatment is reserved for actual measurement (catalogue number, matrix inscription, track lengths, positions), never used as a blanket "technical" costume.
- Screen and print share one palette — no separate darker token set needed for paper, because the system was already designed for it.

## Colors

Effectively two colors plus one alarm: black ink, white paper, and red. Red is the single hue in the whole system, and it is load-bearing — it means "warning, error, or missing part," full stop, everywhere it appears.

### Neutral
- **Ink** (`#161616`): primary text, primary button fill, the one thing every emphasis technique (weight, underline, fill) ultimately resolves to.
- **Ink Dim** (`#5c5c59`) / **Ink Dim 2** (`#737370`): secondary and tertiary text — field labels, meta rows, captions. Two steps, both re-tuned to clear 4.5:1 against every background they sit on.
- **Paper** (`#ffffff`): page and panel background — panels are not visually distinct from the page, only bordered.
- **Panel 2** (`#f5f5f4`): the one barely-there surface tint, for icon buttons' resting state and hover fills.
- **Inset** (`#f6f6f5`): input/preview backgrounds — the one place a field is distinguishable from its panel, by fill alone, no shadow.
- **Edge** (`#d6d6d3`) / **Edge Dim** (`#e9e9e7`): hairline borders and dividers, two steps of the same idea.

### Semantic
- **Severity Low** (`#6b6b68`, neutral grey): "ok"/complete state — the checklist's solid tie-line, a successfully attached file. Deliberately colorless: satisfied requirements don't compete for attention.
- **Severity Alert** (`#b3261e`, red): the one hue in the system. Warnings, errors, and missing/incomplete parts — the checklist's gapped tie-line, artwork warnings, the "approaching limit"/exceeded badges and meter fill, a required field left blank. Bold weight marks the more severe end of this category (errors) where it's used alongside regular weight (warnings); red itself doesn't further subdivide by shade.

### Named Rules
**The One Alarm Rule.** Red means exactly one thing: something here needs attention. It is never decorative, never a brand mark, never used for a merely-informational or positive state. Everything else on the page is neutral ink or grey.

**The Shape-First Rule.** Where red reinforces a state, shape or weight already carries the primary signal (the checklist's solid-vs-gapped tie-line, bold vs. regular warning text) — color is the accelerant, not the only mechanism, so the page stays legible even for a colorblind reader.

## Typography

**Body/UI Font:** system sans stack (`-apple-system, "Segoe UI", Roboto, Arial, sans-serif`) — no imported font, by the project's own zero-runtime-dependency constraint.
**Data Font:** `ui-monospace` / `JetBrains Mono` stack, tabular numerals.

**Character:** One family carries everything — headings, labels, body, buttons; the second, monospaced family is reserved strictly for measured or identifying data, so its appearance is itself a signal ("this value is exact/measured"), not a generic "technical" flourish. With no color left to do rhetorical work, type weight and the ink-density ramp carry more of the page's hierarchy than before.

### Hierarchy
- **Title** (700, 18px): the page's own `<h1>`, "Record Orderbook".
- **Section label** (700, 11px, 0.1em tracking, uppercase): fieldset legends, `<h2>` side headings.
- **Field label** (700, 11px, 0.04em tracking, uppercase): every form label. 11px is a deliberate floor — nothing functional sits below it on screen.
- **Body** (400, 13.5px): input text, notes, checklist copy.
- **Data** (400–700, 12–25px, tabular-nums, monospace): catalogue number, matrix inscription, track positions/lengths, the playing-time total.

### Named Rules
**The 11px Floor Rule.** No functional on-screen text — a label, a button, a meta row — renders below 11px. Print is exempt: it's a dense single-page reference sheet read on paper, not a screen-DPI legibility problem, and keeps the smaller 9–10px sizing the tool has always used there.

## Layout

Single-column vertical form, `max-width: 1040px`, centered, generous fieldset spacing on screen. Rows use flex-wrap with `min-width` floors on fields so narrow viewports reflow rather than clip — the tool's primary use is a desktop browser at a service desk or a lathe, so no dedicated mobile breakpoint exists. Print collapses the same structure into a dense single reference sheet (tight padding, hairline rules) rather than a separate layout — and now needs almost no print-specific overrides, since the screen system was already paper-native.

## Elevation & Depth

Flat by design, deliberately more so than the system this replaced. No shadows anywhere except the browser's own default control chrome. Panels are distinguished from the page by a 1px border only; inputs are distinguished from their panel by a faint fill tint (`--inset`) only. Depth, where it exists at all, is implied by ink density (a field's border vs. a section's border) rather than by simulated light.

### Named Rules
**The Flat, Not Raised Rule.** No `box-shadow` on any structural element (fieldset, panel, input, badge). If a future element seems to need one to read as "clickable" or "contained," add a border or a fill tint first.

## Shapes

Small, consistent corner radius throughout (3–4px) — enough to soften a printed form's stamped boxes, not enough to read as a soft consumer app. Badges and the completeness pill are the one fully-rounded (99px) exception, deliberately marking them as status chips rather than containers. The info-toggle button is the only true circle (50%), consistent with its single-glyph content.

## Components

### Buttons
- **Shape:** 3px radius, 9px/15px padding.
- **Primary** (`btn`): solid ink-black background, white text — the one button on the page competing for attention, reserved for the print/export action.
- **Ghost** (`btn.ghost`): white background, ink border/text, `panel-2` fill on hover — every other action (save/open/send).
- **Icon buttons** (`pickbtn`, `rmbtn`): square, 26px/22px, an authored SVG mask icon (never a Unicode glyph) centered via flex, colored via `currentColor` so hover/state just recolors the mask.
- **Hover / Focus:** ghost buttons darken their border to full ink; all interactive elements share one focus ring (2px solid ink, 1px offset) via `:focus-visible`.

### Cards / Containers (fieldsets, side-boxes)
- **Corner Style:** 4px.
- **Background:** Paper (same as page — no fill distinction).
- **Shadow Strategy:** none. See Elevation.
- **Border:** 1px Edge.
- **Internal Padding:** 14–16px.

### Inputs / Fields
- **Style:** Inset fill (barely distinct from paper), 1px Edge border, 3px radius, no shadow.
- **Focus:** 2px solid ink outline, 1px offset.
- **Disabled:** 40% opacity, `cursor: not-allowed`.
- **Native controls** (checkbox/radio/select) keep their browser chrome but are recolored via `accent-color: var(--ink)` rather than replaced with custom-drawn controls — a checked box is a small black square, not a colored one.

### Checklist (signature component)
The page's completeness state, drawn as tie-lines rather than checkmarks: a solid bar with rounded terminal dots for a satisfied requirement (neutral grey), the same bar with a visible gap for a missing one (red). Shape carries the primary signal (solid vs. broken); red reinforces it for the one state that's actually urgent. This is the one place the "patch sheet" metaphor becomes literal interactive vocabulary rather than background texture, and the one place color survives on the page.

### Lane Badge (signature component)
The track position (`A1`, `B2`…) renders as a small bordered, ink-numbered chip on an inset fill rather than plain bold text — a "numbered lane" reference lifted directly from the patch-sheet world, and the only place a data value gets its own contained shape instead of sitting inline.

## Do's and Don'ts

### Do:
- **Do** use red exclusively for warning/error/missing states. If a new feature needs to flag "needs attention," reuse `--warn`/`--danger`, don't invent a second hue.
- **Do** pair red with a shape or weight change (not color alone) wherever practical, so the signal survives grayscale/colorblind viewing.
- **Do** keep the tie-line icon vocabulary limited to what the app's data model actually has states for (complete / missing) — add a third/fourth variant only when a real feature needs it, using pattern (dash, double line) rather than a new color.
- **Do** reserve the monospace/tabular type for genuinely measured or identifying values (catalogue #, matrix inscription, times, positions).

### Don't:
- **Don't** reintroduce the cream/terracotta original identity or the amber "patch bay" identity this replaced.
- **Don't** use red for anything that isn't a warning, error, or missing/incomplete part — not emphasis, not a brand mark, not a positive/neutral state.
- **Don't** add a second hue "to match" red. If red isn't enough to express a new state, that's a shape/weight problem, not a missing-color problem.
- **Don't** add a box-shadow to a structural element. Distinguish surfaces with a border or a fill tint instead.
- **Don't** use a Unicode glyph or emoji as a stand-in icon (⏏, ✕, a literal "i"). Every icon is an authored SVG mask.
- **Don't** uppercase a label that reads as a full sentence rather than a short field name (`label.hint` exists for exactly this — descriptive artwork-format hints stay in sentence case).
