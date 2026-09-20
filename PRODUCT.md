# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share the same page:

- **Customers** — record label owners and artists (non-developers, not necessarily technical) placing an order with a vinyl pressing plant: choosing tracks and assembling the tracklist for mastering, printed parts (labels, sleeves, cover, inlay), vinyl colour/quantity, and billing/shipping.
- **Plant staff** — customer service / production management (who receive the complete order) and the mastering engineer / graphics department (who receive only the tracklist and file manifest, not billing/shipping). Staff also reopen the same page to review or edit an order already placed (e.g. a phone-in quantity change).

## Product Purpose

A single, self-contained browser page a record pressing plant hands to its customers to assemble one release's complete order — tracklist and playing time per side, printed parts, vinyl colour/quantity, billing/shipping — and package it into one file to send back to the plant. Success is a complete, correct order the plant can act on without a round trip to fix missing information.

## Positioning

Not built for one specific plant — one build is reused across plants via a config file, not hardcoded to one brand. Zero setup: it is a single HTML file that works fully offline, with no backend, no accounts, and no per-plant hosting — a mechanism a typical SaaS order-intake form doesn't offer.

## Operating Context

1. The plant sends the customer the tool (the HTML file, or a link to it).
2. The customer fills the form top to bottom — release info, tracklist, printed parts, quantities, billing/shipping — with inline info and warnings at each step.
3. At any point the customer can save the current state as a project (a single .zip) and reopen it later to resume; files inside re-attach automatically on reopen.
4. Everything must be complete and correct before sending to the plant — the tool warns (dismissibly) rather than silently shipping gaps.
5. Sending produces one .zip containing: the project JSON, a complete human-readable order summary, a narrower tracklist-only document (audio/artwork file manifest, no customer billing/shipping — this one reaches the mastering engineer and graphics department), and the customer's own audio/artwork files renamed to the plant's internal convention.
6. The page is printable to a plain paper order sheet for the rare customer who wants one — not the primary path.
7. The plant reopens the same tool to review, edit, or resend an order.

## Capabilities and Constraints

- No runtime dependencies: no CDN scripts, fonts, or images; nothing loaded at runtime beyond the page itself.
- The distributable is a single self-contained HTML file (built from `src/` via a plain Node script) — must work offline, indefinitely, with no maintenance.
- Plain HTML/CSS/JS, no framework, no build tool beyond string concatenation. Dev tooling may use Node but installs zero npm packages.
- Domain terms in use: catalogue number, side A/B, RPM, format, soundsystem cut, matrix/runout inscription, whitelabel, gap/pregap, project, package.

## Brand Commitments

None formally declared. The page is titled "Record Orderbook"; footer carries "© amei.se". No logo or other identity asset exists yet.

## Evidence on Hand

No customer testimonials, case studies, or press — this is an internal production tool, not a marketing surface, and none should be fabricated. Two external reference links exist in the project's own docs (sst-ffm.de mastering FAQ, randmuzik.de printed-parts specifications) as domain/subject-matter references, not visual references.

## Product Principles

- Zero setup, zero dependency — must keep working by opening one HTML file, offline, indefinitely.
- Plant-agnostic — one build, reusable by any pressing plant via configuration, never hardcoded to one plant's brand.
- Complete-before-send — actively warn rather than silently let an incomplete order reach production.
- Minimal distraction for the common case, depth on demand — deeper explanations sit behind an opt-in info affordance rather than cluttering the default view.

## Accessibility & Inclusion

No formal standard required; keep the design reasonably legible and usable as a natural outcome of good design, not as an explicit compliance target.
