# Customer proof — design

Status: approved in conversation 2026-10-02, pending written-spec review. Builds on the
artwork fix flow (`2026-10-02-artwork-fix-flow-design.md`): `artwork.pixels`,
`colourfix`, `icc.ensure`, `/api/fix`.

## Context

Before a printed part goes to the printer, the customer approves how it will look: the
artwork as it will print, with where it is cut and punched. The plant view shows this to
staff; the customer needs it as a file. Customers look at it on an RGB screen, so the file
carries the print colours with their profile; the customer's viewer converts them for
the screen.

## Decisions

- **Preview: trim and centre hole only.** The dotted bleed line (the data format) goes
  from the plant view's preview; trim and hole stay dashed.
- **One proof per printed part, as a PDF**, made from the file a slot uses.
- **On the proof: the artwork and the trim and hole lines.** No caption, no problem areas.
- **Made on demand:** a "proof" button on the slot's file in use. Nothing is logged in
  `project.json`.
- **Saved in the job folder**, named after the version it shows:
  `PNKRCK007_labels_A_v2.pdf` → `PNKRCK007_proof_labels_A_v2.pdf`. Never written over;
  an existing proof is opened instead. It is listed as an unmanaged file.

## The proof file (`plant/proof.py`)

- **Page** = the file's data size in mm (trim + bleed), as in the check preview.
- **Artwork:** one CMYK raster at `PROOF_DPI = 300`, JPEG quality 90, colour space
  `[/ICCBased <print profile>]` — the part's print profile (`CONFIG.printProfiles`,
  `icc.ensure`). The viewer (Acrobat, Apple ColorSync in Preview) converts it to the
  customer's screen; the proof itself stays in the print colours. A CMYK JPEG as Pillow
  writes it is Adobe-inverted, hence `/Decode [1 0 1 0 1 0 1 0]`.
- **Colour:** the file's own CMYK numbers (`artwork.pixels`). RGB goes sRGB → print
  profile as in the colour fix (so the proof shows what would print); grey is K.
- **No OutputIntent, no PDF/X keys.** The image's own ICC tag is what every viewer reads;
  PDF/X-1a doesn't allow ICCBased colour, and the proof isn't a print file.
- **Lines:** vector, the trim (rect, or circle when round) and the centre hole: dashed
  black on a white line of the same width, as on the preview.
- Written as PDF 1.3 with `artwork.save_atomic`.

## Plant view and server

- `proofName(file)` in `src/lib/package-naming.js`: inserts `proof_` after the catalogue
  number.
- The slot's file in use gets a "proof" button: when its proof exists in the job folder it
  opens it; else it posts `/api/proof` `{job, file, newName, params}` and opens the result
  in a new tab.
- `/api/proof` uses `fix_paths` (source must exist, target must not — 409); a missing
  profile is 503, a file the proof can't read 400.

## Testing

- JS: `proofName`; `cutLinesSvg` draws no bleed line.
- Python `plant/test_proof.py`: page size = data size; the image is CMYK, ICCBased with the
  print profile, and its numbers match the source's (JPEG tolerance); an RGB source is
  converted; trim and hole are drawn; an existing
  target is refused.
