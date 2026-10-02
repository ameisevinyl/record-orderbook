# Customer proof — design

Status: approved in conversation 2026-10-02, pending written-spec review. Builds on the
artwork fix flow (`2026-10-02-artwork-fix-flow-design.md`): a slot's file is finished
when size → pdf → colour pass; `/api/fix`.

## Context

Before a printed part goes to the printer, the customer approves how it will look: the
artwork as it will print, with where it is cut and punched. The plant view shows this to
staff; the customer needs it as a file. Customers look at it on an RGB screen, so the file
carries the print colours with their profile; the customer's viewer shows them on
the screen.

## Decisions

- **Preview: trim and centre hole only.** The dotted bleed line (the data format) goes
  from the plant view's preview; trim and hole stay dashed.
- **One proof per printed part, as a PDF**, made from the file a slot uses.
- **On the proof: the artwork and the trim and hole lines.** No caption, no problem areas.
- **Made on demand:** a "proof" button on the slot's file in use, once its flow is
  through. Nothing is logged in `project.json`.
- **Saved in the job folder**, named after the version it shows:
  `PNKRCK007_labels_A_v2.pdf` → `PNKRCK007_proof_labels_A_v2.pdf`. Never written over;
  an existing proof is opened instead. It is listed as an unmanaged file.

## The proof file (`plant/proof.py`)

- **Only from a finished file:** a PDF in CMYK (or grey) with an OutputIntent — the slot's
  file in use once size → pdf → colour pass. RGB, TIFF and JPG go through the fix flow
  first; anything else is refused.
- **The file in use, copied, with the lines drawn on top.** Its OutputIntent (the part's
  print profile) stays, so the customer's viewer (Acrobat, ColorSync in Preview) shows
  the print colours on their screen. No raster, no RGB conversion; the proof is as big as
  the file.
- **Lines:** vector, in CMYK, on the data box: the trim (rect, or circle when round) and
  the centre hole — dashed black on a white line of the same width, as on the preview.
- Written as PDF 1.3 with `artwork.save_atomic`.

## Plant view and server

- `proofFileName(catalogue, file)` in `src/lib/package-naming.js`: inserts `proof_` after
  the catalogue number.
- The slot's file in use gets a "proof" button: when its proof exists in the job folder it
  opens it (`/jobs/<job>/files/<name>`); else it posts `/api/proof`
  `{job, file, newName, params}` and opens the result in a new tab.
- `/api/proof` uses `fix_paths` (source must exist, target must not — 409); a file
  that isn't finished is 400.

## Testing

- JS: `proofFileName`; `cutLinesSvg` draws no bleed line; the slot offers a proof only
  when its flow is through.
- Python `plant/test_proof.py`: same page size and OutputIntent as the source; trim and
  hole drawn, dashed, in CMYK; a source without OutputIntent or in RGB is refused.
  `test_server.py`: an existing target is refused (409); a job file is served.
