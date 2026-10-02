"""The customer proof of a printed part: the finished file (CMYK PDF/X,
the print profile as OutputIntent) with the trim and the centre hole drawn
on top, so the customer's viewer shows the print colours and where it is
cut. Spec: docs/superpowers/specs/2026-10-02-customer-proof-design.md."""
import pymupdf

import artwork

WIDTH = 0.5               # pt
DASHES = "[5 4] 0"        # as the preview's dashed lines
WHITE, BLACK = (0, 0, 0, 0), (0, 0, 0, 1)   # CMYK: the file stays CMYK-only
NOT_FINISHED = "a proof needs the finished CMYK PDF/X file — finish the fix flow first"


class ProofError(Exception):
    """A file a proof can't be made from; the message goes to the page."""


def make(source, params, out):
    try:
        kind, parsed, _ = artwork.structure(source, params["page"])
    except artwork.ArtworkError as error:
        raise ProofError(str(error)) from None
    if kind != "pdf" or parsed["colorMode"] not in ("CMYK", "Gray") or not parsed["outputIntent"]:
        raise ProofError(NOT_FINISHED)
    doc = pymupdf.open(source)
    page = doc[params["page"] - 1]
    # Shapes and the data box are unrotated; trimMm is as displayed.
    box = artwork.data_box(doc, page)
    w, h = (params["trimMm"][k] / artwork.MM_PER_PT for k in ("w", "h"))
    if page.rotation % 180:
        w, h = h, w
    centre = (box.tl + box.br) / 2
    shape = page.new_shape()
    for dashes, colour in ((None, WHITE), (DASHES, BLACK)):
        if params["round"]:
            shape.draw_circle(centre, w / 2)
        else:
            shape.draw_rect(pymupdf.Rect(centre.x - w / 2, centre.y - h / 2, centre.x + w / 2, centre.y + h / 2))
        shape.finish(color=colour, width=WIDTH, dashes=dashes)
        if params["holeMm"]:
            shape.draw_circle(centre, params["holeMm"] / 2 / artwork.MM_PER_PT)
            shape.finish(color=colour, width=WIDTH, dashes=dashes)
    shape.commit()
    artwork.save_atomic(doc, out)
