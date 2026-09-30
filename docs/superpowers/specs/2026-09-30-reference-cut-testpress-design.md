# Reference cut and testpress — design

Status: approved in conversation 2026-09-30, pending written-spec review.

## Context

Two more products on the customer form. A **reference cut** is a
one-off acetate, for a customer unsure about mix or master. A
**testpress** is a few records pressed before the run, checking for
pressing errors, not mix or master problems. It's recommended only from
about 1,000 records up. A plant offers each one per format.

## Decisions

- A reference cut is one acetate: a checkbox, no quantity.
- A testpress takes a quantity from 1 to n, prefilled with 3 when ticked.
- Each is enabled or disabled per format in `CONFIG`. A disabled product
  is hidden and reset. With both disabled, the section is hidden.
- Shipping is not part of the form; the plant settles it with the
  customer.
- A testpress for a run under the threshold gives a soft,
  non-blocking note in the order checklist.
- `tracklist.txt` carries the reference cut upfront but not the
  testpress. `order_summary.txt` carries both.

## Config (`src/config.js`)

- Per format: `proofs: { referenceCut: true, testpress: true }` (7", 10", 12").
- Plant-wide: `CONFIG.proofs = { testpressDefaultQty: 3, testpressRecommendedFromQty: 1000 }`.
- `infoText.referenceCut` and `infoText.testpress` (en), behind the info
  icon:
  - referenceCut: "A one-off acetate cut from your master, to hear the
    cut before the lacquers are made. Unsure about your mix or master?
    Order a reference cut."
  - testpress: "The first records from the stamper, to check the
    pressing for real errors before the run — not for judging mix or
    master (that's the reference cut). Recommended for runs of 1,000
    records or more."
- `src/lib/config-validation.js` checks both `proofs` shapes and the two
  numbers (a positive integer default, a non-negative threshold).

## Form (new `src/modules/proofs.js`)

This is a section "Reference cut & Testpress" in `src/index.html`,
directly below "Vinyl Colour & Quantity":

```
☐ Reference cut (one acetate)            (i)
☐ Testpress   [ 3 ] records               (i)
```

- The quantity field shows only while Testpress is ticked. Ticking it
  prefills `testpressDefaultQty`. An empty field or one below 1 is an
  issue in the order checklist, like other quantities.
- A format change hides products the format doesn't offer and resets
  them (unticked, 0).
- Exports `initProofs(onStateChange)`, `collectProofs()`,
  `applyProofs(data)` and `proofIssues(totalQty)`. The total run comes
  from `getColorBreakdown()` in `vinyl-color.js`, read by `tracklist.js`.

## Rule (pure, `src/lib/proofs.js`)

`testpressNote(testpresses, totalQty, recommendedFromQty)` returns the
note text when `testpresses > 0 && totalQty < recommendedFromQty`, else
null: "Testpresses are not recommended for small runs (<1000). If you
want to check your mix and master, order a reference cut." (The number
comes from `testpressRecommendedFromQty`.)

## Data (`project.json`)

- `proofs: { referenceCut: false, testpresses: 0 }`, where 0 means no
  testpress.
- `prepareProject` (`src/lib/project.js`) validates it: a boolean and a
  non-negative integer. A project without `proofs` loads as none.

## Output

- Both text files: the shared header (`documentHeader`,
  `src/lib/order-documents.js`) gets `Reference cut: yes` after `Cut:`,
  only when ordered.
- `order_summary.txt` only: `Testpresses: 3` next to the vinyl colour
  quantities, only when ordered.
- Plant view Basic section (`src/lib/plant-overview.js`): the rows
  "Reference cut" and "Testpresses", each only when ordered.
- Plant gaps (`src/lib/completeness.js`): the same soft testpress note.

## Tests

- `tests/proofs.test.js`: `testpressNote` below, at and above the
  threshold, and with no testpress.
- `tests/project.test.js`: `proofs` present, absent and invalid.
- `tests/order-documents.test.js`: the reference cut line in both texts,
  and the testpress line in the summary only.
- `tests/config-validation.test.js`: bad `proofs` shapes.
- `tests/plant-overview.test.js`: the rows appear only when ordered.
