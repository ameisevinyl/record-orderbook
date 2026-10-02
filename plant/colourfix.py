"""Plant-side colour step of the fix flow, every printed part. The data
area becomes one CMYK image at fixDpi with three rules — black (K ≥
kMinPct) → 0/0/0/100, neutral greys (C, M, Y within neutralTolPct) → K
only at the same lightness, total ink over the part's limit → C, M, Y
scaled down, K kept — written as PDF/X-1a with the part's profile as
OutputIntent. assign only marks a file PDF/X-1a, numbers untouched. CMYK
keeps the file's own numbers, grey goes into K, RGB goes through the
part's profile (LittleCMS). Specs:
docs/superpowers/specs/2026-10-01-label-colour-fix-design.md,
docs/superpowers/specs/2026-10-02-artwork-fix-flow-design.md."""
import numpy
import pymupdf
from PIL import Image, ImageCms

import artwork


class FixError(Exception):
    """A file this fix can't handle; the message goes to the page."""


def fix_pixels(cmyk, light, ramp, ink_limit, k_min, neutral_tol):
    """Per pixel, in this order: K ≥ k_min → pure K; neutral (C, M, Y within
    neutral_tol of each other) → K only at its lightness (light: L* per
    pixel, ramp: L* of K = 0..100 in the part's profile); else total ink
    over the limit → C, M, Y scaled, K kept. Returns the pixels and how
    many each rule changed (black, neutral, capped)."""
    c = cmyk.astype(numpy.float32) * (100 / 255)
    k, cmy = c[..., 3], c[..., :3]
    total = cmy.sum(axis=-1)
    black = k >= k_min
    neutral = (cmy.max(axis=-1) - cmy.min(axis=-1) <= neutral_tol) & (total > 0) & ~black
    room = numpy.clip(ink_limit - k, 0, None)
    capped = (total + k > ink_limit) & (total > 0) & ~neutral & ~black
    out = c.copy()
    out[..., :3] *= numpy.where(capped, room / numpy.maximum(total, 1e-6), 1.0)[..., None]
    out[neutral] = 0
    out[..., 3][neutral] = numpy.interp(light[neutral], ramp[::-1], numpy.arange(100, -1, -1))
    out[black] = (0, 0, 0, 100)
    pixels = numpy.round(out * 2.55).clip(0, 255).astype(numpy.uint8)
    return pixels, numpy.array([black.sum(), neutral.sum(), capped.sum()])


def light(cmyk, transform):
    """L* (0–100) per pixel through the part's profile."""
    h, w = cmyk.shape[:2]
    im = Image.frombytes("CMYK", (w, h), numpy.ascontiguousarray(cmyk).tobytes())
    return numpy.asarray(ImageCms.applyTransform(im, transform))[..., 0].astype(numpy.float32) * (100 / 255)


def lab_transform(profile_path):
    """CMYK → Lab through the part's profile, and the L* of K = 0..100 in it."""
    transform = ImageCms.buildTransform(ImageCms.getOpenProfile(str(profile_path)), ImageCms.createProfile("LAB"),
                                        "CMYK", "LAB")
    ramp = numpy.zeros((1, 101, 4), numpy.uint8)
    ramp[0, :, 3] = numpy.round(numpy.arange(101) * 2.55)
    return transform, light(ramp, transform)[0]


STRIP = 256  # rows per pass: the float copies stay small at 1200 dpi


def fix_in_strips(cmyk, transform, ramp, ink_limit, k_min, neutral_tol):
    out = numpy.empty_like(cmyk)
    counts = numpy.zeros(3, numpy.int64)
    for y in range(0, cmyk.shape[0], STRIP):
        part = cmyk[y:y + STRIP]
        out[y:y + STRIP], n = fix_pixels(part, light(part, transform), ramp, ink_limit, k_min, neutral_tol)
        counts += n
    return out, counts


def _to_cmyk(im, profile_path):
    if im.mode == "CMYK":
        return numpy.asarray(im)
    if im.mode in ("L", "1", "LA"):
        k = 255 - numpy.asarray(im.convert("L"))
        out = numpy.zeros((*k.shape, 4), numpy.uint8)
        out[..., 3] = k
        return out
    to_cmyk = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), ImageCms.getOpenProfile(str(profile_path)),
                                      "RGB", "CMYK", renderingIntent=ImageCms.Intent.PERCEPTUAL)
    return numpy.asarray(ImageCms.applyTransform(im.convert("RGB"), to_cmyk))


def _raster(path, kind, parsed, params, profile_path):
    """(CMYK array, data size in mm). CMYK and grey are read unmanaged."""
    im, page_mm = artwork.pixels(path, kind, parsed, params, params["fixDpi"])
    return _to_cmyk(im, profile_path), page_mm


NO_PROFILE = "the part's print profile isn't available — see the plant server's output"


def fix(path, params, out, profile_path):
    """The part's colour fix as out, PDF/X-1a; returns what it did."""
    if profile_path is None:
        raise FixError(NO_PROFILE)
    target, tol = params["targetMm"], params["toleranceMm"]
    try:
        kind, parsed, _ = artwork.structure(path, params["page"])
    except artwork.ArtworkError as error:
        raise FixError(str(error)) from None
    size = parsed["pageSizeMm"] or (
        {"w": parsed["imagePx"]["w"] / parsed["declaredDpi"]["x"] * 25.4,
         "h": parsed["imagePx"]["h"] / parsed["declaredDpi"]["y"] * 25.4} if parsed["declaredDpi"] else target)
    if abs(size["w"] - target["w"]) > tol or abs(size["h"] - target["h"]) > tol:
        raise FixError(f"the file is {size['w']:.1f}×{size['h']:.1f} mm, expected "
                       f"{target['w']:g}×{target['h']:g} mm — fix the size first")
    cmyk, page_mm = _raster(path, kind, parsed, params, profile_path)
    transform, ramp = lab_transform(profile_path)
    black = params["black"]
    fixed, counts = fix_in_strips(cmyk, transform, ramp, params["inkLimitPct"], black["kMinPct"], black["neutralTolPct"])
    # CMYK that no rule changes (a dark colour under the limit the Black
    # check flags) would be proposed again after every accept.
    if not counts.any() and parsed["colorMode"] not in ("RGB", "Gray"):
        raise FixError("nothing to fix by rule — a dark colour under the ink limit; needs correction by hand")
    doc = artwork.raster_pdf(fixed, "CMYK", page_mm, params["trimMm"])
    artwork.pdfx(doc, profile_path, params["profile"])
    artwork.save_atomic(doc, out)
    pct = counts / (cmyk.shape[0] * cmyk.shape[1]) * 100
    return f"pure K {pct[0]:.1f} %, neutral → K {pct[1]:.1f} %, ink capped {pct[2]:.1f} % of the area"


def assign(path, params, out, profile_path):
    """A copy with the part's profile as OutputIntent (PDF/X-1a), numbers untouched."""
    if profile_path is None:
        raise FixError(NO_PROFILE)
    try:
        doc = pymupdf.open(path)
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise FixError(f"can't read PDF: {error}") from None
    if doc.needs_pass:
        raise FixError("the PDF is encrypted")
    artwork.pdfx(doc, profile_path, params["profile"])
    artwork.save_atomic(doc, out)
    return f"assigned {params['profile']['name']}, colours unchanged"
