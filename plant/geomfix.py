"""Plant-side size and bleed fix for printed parts: the candidate staff
picked (geometryFixes in src/lib/artwork-checks.js) — the source scaled
and centred on the data size, the kept region as it is, the rest mirrored
from its edge — as one raster PDF at fixDpi in the file's own colours.
Spec: docs/superpowers/specs/2026-10-01-artwork-geometry-fix-design.md."""
import numpy
import pymupdf

import artwork

STRIP = 256  # rows per pass of the radial mirror: index arrays stay small at 1200 dpi


class FixError(Exception):
    """A file this fix can't handle; the message goes to the page."""


def fit(a, h, w, mode):
    """a centred on h×w: cropped where larger, padded where smaller —
    "symmetric" mirrors from the edge, "edge" repeats it (scale rounding)."""
    top, left = max(a.shape[0] - h, 0) // 2, max(a.shape[1] - w, 0) // 2
    a = a[top:top + h, left:left + w]
    dy, dx = h - a.shape[0], w - a.shape[1]
    pad = [(dy // 2, dy - dy // 2), (dx // 2, dx - dx // 2)] + [(0, 0)] * (a.ndim - 2)
    return numpy.pad(a, pad, mode=mode)


def radial_mirror(a, r):
    """Pixels further than r (px) from the centre take the pixel mirrored at
    that circle: same angle, d' = 2r − d. Past 2r it stays at the centre —
    corners far outside the bleed are cut away."""
    h, w = a.shape[:2]
    cy, cx = (h - 1) / 2, (w - 1) / 2
    dx = numpy.arange(w, dtype=numpy.float32) - cx
    out = numpy.empty_like(a)
    for y in range(0, h, STRIP):
        dy = (numpy.arange(y, min(y + STRIP, h), dtype=numpy.float32) - cy)[:, None]
        d = numpy.hypot(dx, dy)
        f = numpy.where(d > r, numpy.clip(2 * r - d, 0, None) / numpy.maximum(d, 1e-6), 1)
        sy = numpy.clip(numpy.rint(cy + dy * f), 0, h - 1).astype(numpy.intp)
        sx = numpy.clip(numpy.rint(cx + dx * f), 0, w - 1).astype(numpy.intp)
        out[y:y + STRIP] = a[sy, sx]
    return out


def preview_dpi(target_mm):
    return artwork.PREVIEW_PX / max(target_mm["w"], target_mm["h"]) * 25.4


def build(path, params, candidate, dpi):
    """The fixed data area at dpi: (pixel array, Pillow mode)."""
    try:
        kind, parsed, _ = artwork.structure(path, params["page"])
    except artwork.ArtworkError as error:
        raise FixError(str(error)) from None
    if parsed["encrypted"] and parsed["pageSizeMm"] is None:
        raise FixError("the PDF is encrypted")
    # Rendered at dpi × scale, the source lands at dpi once scaled.
    im, _ = artwork.pixels(path, kind, parsed, params, dpi * candidate["scale"])
    a = numpy.asarray(im)
    px = lambda mm: round(mm / 25.4 * dpi)
    target, trim = params["targetMm"], params["trimMm"]
    h, w = px(target["h"]), px(target["w"])
    if candidate["keep"] == "trim" and params["round"]:
        a = radial_mirror(fit(a, h, w, "edge"), trim["w"] / 2 / 25.4 * dpi)
    elif candidate["keep"] == "trim":
        a = fit(fit(a, px(trim["h"]), px(trim["w"]), "edge"), h, w, "symmetric")
    else:
        a = fit(a, h, w, "symmetric" if candidate["fill"] == "mirror" else "edge")
    return a, im.mode


def render(path, params, candidate, out, dpi):
    """The fix as a PDF (page = data size, TrimBox the trim centred), or for
    an out *.png the same as a preview, shown in RGB like the check previews."""
    a, mode = build(path, params, candidate, dpi)
    doc = artwork.raster_pdf(a, mode, params["targetMm"], params["trimMm"])
    if out.suffix == ".png":
        part = out.with_name(f".{out.name}.part")
        zoom = pymupdf.Matrix(dpi / 72, dpi / 72)  # get_pixmap(dpi=) wants an int
        doc[0].get_pixmap(matrix=zoom, colorspace=pymupdf.csRGB, alpha=False).save(part, output="png")
        part.rename(out)
    else:
        artwork.save_atomic(doc, out)
