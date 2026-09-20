---
version: 1
slug: "src-index-html"
primary_target: "src/index.html"
related_targets: []
---

## Scope

Redesign `src/index.html` (page shell + inline CSS). Operate mode: an order-intake form for a vinyl pressing plant. Audience: label owners/artists (customers, non-technical) filling the form; customer service, mastering engineer, and graphics department staff reading/reopening it. Preserve every existing id/class the JS modules bind to, all functionality, and the existing print path — only the visual system changes.

## Direction contract

THESIS: This order form should read as the mastering room's own patch bay, not another SaaS form — refusing the soft "print order sheet" look (and its cream-paper/terracotta AI-generic sibling) for a hardware panel whose lit tie-lines ARE the completeness state.

OWN-WORLD: Near-black graphite panels as fieldset "lane" modules with an inset bevel edge; one signal copper/amber accent for links, focus, and primary actions; one condensed system sans throughout (no imported fonts); numbered lane legends (A1, A2…) down the left edge; small tie-line glyphs (solid = complete, gapped = missing, doubled = duplicate/warn, open ring = destructive) replace today's checkmark icons as the literal state vocabulary for every checklist and required field.

STORY: A label owner or engineer opens what looks like a piece of real studio hardware, not a web form; each field's tie-line shows itself complete, missing, or duplicated at a glance, exactly as a patched channel shows live, normalled, or broken.

FIRST VIEWPORT: The Release fieldset as the first lane panel — catalogue/format/title/artist inputs on an inset dark panel, amber focus rings, tie-line status dots beside required fields, a header stamp panel top-right showing catalogue# and save state.

FORM: Challenger `operate-b-normalled-jackfield` (patch-bay/normalling schedule), won both weighing axes (audience identification, product clarity) against my own assigned grounded candidate #6 ("cutting lathe control panel") from a 7-candidate grounded list (route-card traveler, test-press white label, runout-groove matrix, tape-box session label, sleeve backside print, cutting lathe, record-store crate card); seed key a48babbb. Raised with phosphor-terminal's (declined) discipline: status prints as plain text, never decorative chrome.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Constraints

- Zero runtime dependencies: no CDN fonts/scripts/images, nothing external. `dist/index.html` must stay a single offline-capable file.
- Code-led build (no image generation available this session) — no comps, no raster plates. Every visual element is CSS/inline SVG.
- Must preserve every field id, class hook, and DOM structure `src/modules/*.js` / `src/app.js` depend on.
- `@media print` gets refreshed to the same system, kept plain/ink-cheap.
- No formal accessibility standard required; keep it legible as a byproduct of good design.
