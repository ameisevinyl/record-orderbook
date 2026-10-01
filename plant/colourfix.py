"""Plant-side colour fix for labels (baked in the oven before pressing:
rich black and heavy ink don't dry). The label's data area becomes one
CMYK image at fixDpi with two rules — black (K ≥ kMinPct) → 0/0/0/100,
total ink over the limit → C, M, Y scaled down, K kept — written as a
PDF. CMYK keeps the file's own numbers, grey goes into K, RGB goes
through the part's output profile (LittleCMS). Spec:
docs/superpowers/specs/2026-10-01-label-colour-fix-design.md."""
import numpy
from PIL import ImageCms

import artwork


class FixError(Exception):
    """A label this fix can't handle; the message goes to the page."""


def fix_pixels(cmyk, ink_limit, k_min):
    c = cmyk.astype(numpy.float32) * (100 / 255)
    k = c[..., 3]
    cmy = c[..., :3].sum(axis=-1)
    room = numpy.clip(ink_limit - k, 0, None)
    scale = numpy.where((cmy + k > ink_limit) & (cmy > 0), room / numpy.maximum(cmy, 1e-6), 1.0)
    out = c.copy()
    out[..., :3] *= scale[..., None]
    out[k >= k_min] = (0, 0, 0, 100)
    return numpy.round(out * 2.55).clip(0, 255).astype(numpy.uint8)


STRIP = 256  # rows per pass: the float copies stay small at 1200 dpi


def fix_in_strips(cmyk, ink_limit, k_min):
    out = numpy.empty_like(cmyk)
    for y in range(0, cmyk.shape[0], STRIP):
        out[y:y + STRIP] = fix_pixels(cmyk[y:y + STRIP], ink_limit, k_min)
    return out


def _to_cmyk(im, profile_path):
    if im.mode == "CMYK":
        return numpy.asarray(im)
    if im.mode in ("L", "1", "LA"):
        k = 255 - numpy.asarray(im.convert("L"))
        out = numpy.zeros((*k.shape, 4), numpy.uint8)
        out[..., 3] = k
        return out
    if profile_path is None:
        raise FixError("RGB needs the labels profile, which isn't available — see the plant server's output")
    to_cmyk = ImageCms.buildTransform(ImageCms.createProfile("sRGB"), ImageCms.getOpenProfile(str(profile_path)),
                                      "RGB", "CMYK", renderingIntent=ImageCms.Intent.PERCEPTUAL)
    return numpy.asarray(ImageCms.applyTransform(im.convert("RGB"), to_cmyk))


def _raster(path, kind, parsed, params, profile_path):
    """(CMYK array, data size in mm). CMYK and grey are read unmanaged."""
    im, page_mm = artwork.pixels(path, kind, parsed, params, params["fixDpi"])
    return _to_cmyk(im, profile_path), page_mm


def fix_label(path, params, out, profile_path=None):
    target, tol = params["targetMm"], params["toleranceMm"]
    try:
        kind, parsed, _ = artwork.structure(path, params["page"])
    except artwork.ArtworkError as error:
        raise FixError(str(error)) from None
    size = parsed["pageSizeMm"] or (
        {"w": parsed["imagePx"]["w"] / parsed["declaredDpi"]["x"] * 25.4,
         "h": parsed["imagePx"]["h"] / parsed["declaredDpi"]["y"] * 25.4} if parsed["declaredDpi"] else target)
    if abs(size["w"] - target["w"]) > tol or abs(size["h"] - target["h"]) > tol:
        raise FixError(f"the label is {size['w']:.1f}×{size['h']:.1f} mm, expected "
                       f"{target['w']:g}×{target['h']:g} mm — fix the size first")
    cmyk, page_mm = _raster(path, kind, parsed, params, profile_path)
    fixed = fix_in_strips(cmyk, params["inkLimitPct"], params["black"]["kMinPct"])
    artwork.save_atomic(artwork.raster_pdf(fixed, "CMYK", page_mm, params["trimMm"]), out)
