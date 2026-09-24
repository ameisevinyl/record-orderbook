# PDF page choice per artwork slot — design

Status: approved in conversation, pending written-spec review.

## Context

The plant wants one page per artwork file, but many customers send
multi-page PDFs: InDesign/Illustrator layouts often start as a 2-pager
(label A and B, inlay front and back). Catch it in the customer view,
where the customer knows which page is which — like Photoshop's page
dialog when opening a multi-page PDF.

## Behaviour (customer view)

- **Every artwork slot** (labels A/B, inner sleeve, cover, inlay
  front/back): when the attached PDF has more than one page, a picker
  "Page [1 ▾] of N" appears next to the file. Default page 1.
- **Pairs** — labels A/B, inlay front/back: when a multi-page PDF lands
  in the first slot (label A, inlay front) and the second is empty (for
  labels: and not whitelabel), a one-click offer "Use page 2 for side
  B" / "…for back" attaches the same file there with page 2.
- **Preview:** the PDF preview iframe gets `&page=N`. Chrome and
  Firefox jump to the page; Safari's viewer ignores it and stays on
  page 1 (the choice still applies).
- **Checks:** the browser parser reads the PDF as a whole, not per
  page. A multi-page PDF adds an info row "Pages — N pages, page P
  used; exact checks at the plant". The other rows stay as they are
  (a 2-page label file normally has equal page sizes, so Size still
  holds).
- A single-page PDF, JPG or TIFF shows no picker and no row.

## Data

- `project.json`: each artwork slot gets `page` (integer ≥ 1, default
  1) beside its `fileName`: `labels.sides.A|B`, `coverSleeve.innerSleeve`,
  `coverSleeve.cover`, `coverSleeve.inlay.front|back`.
  `prepareProject` validates it; older projects without it get 1.
- **Package:** each slot keeps its own file under its own name
  (`…_labels_A_v1.pdf`, `…_labels_B_v1.pdf`) — the same PDF may be in
  the zip twice. Label and inlay PDFs are small; the naming convention
  and "one file per slot" stay intact.
- `loadProject` restores the page with the file.

## Code

- `src/lib/print-artwork.js`
  - `parsePdfArtwork` adds `pageCount`: page objects (`/Type /Page`,
    not `/Pages`) counted in the plain text and in inflated object
    streams (`/Type /ObjStm`), which modern InDesign exports use. 1
    when none is found. JPEG/TIFF: `pageCount: 1`.
  - `buildChecklistRows(parsed, …, page)` adds the info row "Pages"
    when `pageCount > 1`.
- Each artwork module keeps owning its DOM: picker and pair offer are
  rendered by the module; a small shared helper for the picker markup
  and the page number goes in `src/lib/` only if the four modules would
  otherwise repeat it.
- Plant side: `artworkParams` passes `page` to Python; PyMuPDF checks
  that page (artwork-checks spec). Piece 3 extracts that page as a
  single-page PDF for the printing house.

## Out of scope

A thumbnail page picker (would need a PDF renderer in the browser — no
dependencies). A 2-page cover (front and back as separate pages) is an
imposition job for piece 5, not a page choice.

## Tests

- `tests/print-artwork.test.js` — `pageCount` for 1/2/3-page PDFs
  built with `src/lib/pdf.js`, and for a PDF whose page objects sit in
  a Flate object stream; the "Pages" row.
- `tests/project.test.js` — `page` default, validation, round trip.
