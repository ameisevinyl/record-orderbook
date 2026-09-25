"""Artwork facts for the plant view: structure (PyMuPDF for PDF, Pillow
for JPEG/TIFF headers) and pixel measurements (see facts()). The shape
of `parsed` is the one src/lib/print-artwork.js documents, so the
customer page's rules (buildChecklistRows) judge it unchanged.
"""
import io
import re

import numpy
import pymupdf
from PIL import Image, ImageCms

MM_PER_PT = 25.4 / 72
# The plant trusts its customers' files: a print-size cover TIFF at
# 1200 dpi is ~470 MP, far over Pillow's "decompression bomb" limit.
Image.MAX_IMAGE_PIXELS = None


class ArtworkError(Exception):
    """A file the checks can't read; the message goes to the page."""


def sniff(path):
    with open(path, "rb") as f:
        head = f.read(4)
    if head.startswith(b"%PDF"):
        return "pdf"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    return "unknown"


def size_mm(rect):
    return {"w": rect.width * MM_PER_PT, "h": rect.height * MM_PER_PT}


def icc_name(data):
    try:
        return ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(data))).strip() or None
    except (OSError, ImageCms.PyCMSError):
        return "embedded ICC profile (name unavailable)"


def pdf_icc_name(doc):
    # Output intent first (PDF/X): Catalog /OutputIntents [<< /DestOutputProfile n 0 R >>].
    kind, value = doc.xref_get_key(doc.pdf_catalog(), "OutputIntents")
    if kind == "xref":
        kind, value = "array", doc.xref_object(int(value.split()[0]), compressed=True)
    for ref in re.findall(r"(\d+) 0 R", value) if kind == "array" else []:
        kind, value = doc.xref_get_key(int(ref), "DestOutputProfile")
        if kind == "xref":
            return icc_name(doc.xref_stream(int(value.split()[0])))
    for xref in range(1, doc.xref_length()):
        m = re.search(r"/ICCBased\s+(\d+)\s+0\s+R", doc.xref_object(xref, compressed=True))
        if m:
            return icc_name(doc.xref_stream(int(m.group(1))))
    return None


def spot_colours(doc):
    names = set()
    for xref in range(1, doc.xref_length()):
        obj = doc.xref_object(xref, compressed=True)
        names.update(re.findall(r"/Separation\s*/([^\s/\[\]<>()]+)", obj))
        for group in re.findall(r"/DeviceN\s*\[([^\]]*)\]", obj):
            names.update(re.findall(r"/([^\s/\[\]<>()]+)", group))
    # PDF names escape bytes as #xx (e.g. PANTONE#20185#20C).
    names = {re.sub(r"#([0-9A-Fa-f]{2})", lambda m: chr(int(m.group(1), 16)), n) for n in names}
    return sorted(names - {"All", "None", "Cyan", "Magenta", "Yellow", "Black"})


# Content-stream colour operators: last operand, then the operator.
OPS = {"CMYK": rb"[\d.]\s+[kK]\b", "RGB": rb"[\d.]\s+(?:rg|RG)\b", "Gray": rb"[\d.]\s+[gG]\b"}


def colour_mode(doc, page):
    modes = set()
    for img in page.get_images(full=True):
        n = doc.extract_image(img[0]).get("colorspace", 0)
        modes.add({1: "Gray", 3: "RGB", 4: "CMYK"}.get(n))
    content = page.read_contents()
    modes.update(mode for mode, op in OPS.items() if re.search(op, content))
    # RGB anywhere is what needs fixing, so it wins.
    return next((m for m in ("RGB", "CMYK", "Gray") if m in modes), "unknown")


def effective_dpi(page):
    lowest = None
    for info in page.get_image_info():
        bbox = pymupdf.Rect(info["bbox"])
        if bbox.width <= 0 or bbox.height <= 0:
            continue
        dpi = {"x": info["width"] / (bbox.width / 72), "y": info["height"] / (bbox.height / 72)}
        if lowest is None or min(dpi.values()) < min(lowest.values()):
            lowest = dpi
    return lowest


def has_box(doc, page, key):
    """Whether the page sets the box itself — PyMuPDF's page.trimbox falls
    back to the MediaBox when the key is absent."""
    return doc.xref_get_key(page.xref, key)[0] != "null"


def data_box(doc, page):
    """The printed data area, bleed included: the BleedBox, which the PDF
    standard defaults to the CropBox. Crop marks and slug outside it
    don't count."""
    return page.bleedbox if has_box(doc, page, "BleedBox") else page.cropbox


def pdf_structure(path, page_no):
    try:
        doc = pymupdf.open(path)
    except (pymupdf.FileDataError, RuntimeError) as error:
        raise ArtworkError(f"can't read PDF: {error}") from None
    if doc.needs_pass:
        # Nothing past the trailer is readable without the password.
        return {"pageSizeMm": None, "imagePx": None, "declaredDpi": None, "colorMode": "unknown",
                "spotColors": [], "iccProfileName": None, "trimBoxMm": None, "encrypted": True,
                "hasUnembeddedFonts": None, "pdfVersion": None, "pageCount": doc.page_count,
                "effectiveDpi": None}, []
    if not 1 <= page_no <= doc.page_count:
        raise ArtworkError(f"page {page_no} of {doc.page_count}")
    page = doc[page_no - 1]
    fonts = sorted({f[3].split("+")[-1] for f in page.get_fonts() if f[1] == "n/a" and f[2] != "Type3"})
    images = page.get_images(full=True)
    largest = max(images, key=lambda i: i[2] * i[3], default=None)
    version = (doc.metadata.get("format") or "").removeprefix("PDF ") or None
    return {
        "pageSizeMm": size_mm(data_box(doc, page)),
        "imagePx": {"w": largest[2], "h": largest[3]} if largest else None,
        "declaredDpi": None,
        "colorMode": colour_mode(doc, page),
        "spotColors": spot_colours(doc),
        "iccProfileName": pdf_icc_name(doc),
        "trimBoxMm": size_mm(page.trimbox) if has_box(doc, page, "TrimBox") else None,
        "encrypted": bool(doc.is_encrypted or doc.metadata.get("encryption")),
        "hasUnembeddedFonts": bool(fonts),
        "pdfVersion": version,
        "pageCount": doc.page_count,
        "effectiveDpi": effective_dpi(page),
    }, fonts


def raster_structure(path):
    try:
        with Image.open(path) as im:
            dpi = im.info.get("dpi")
            icc = im.info.get("icc_profile")
            mode, size = im.mode, im.size
    except OSError as error:
        raise ArtworkError(f"can't read image: {error}") from None
    return {
        "pageSizeMm": None,
        "imagePx": {"w": size[0], "h": size[1]},
        "declaredDpi": {"x": round(dpi[0]), "y": round(dpi[1])} if dpi and dpi[0] and dpi[1] else None,
        "colorMode": {"CMYK": "CMYK", "RGB": "RGB", "L": "Gray", "1": "Gray"}.get(mode, "unknown"),
        "spotColors": [],
        "iccProfileName": icc_name(icc) if icc else None,
        "trimBoxMm": None, "encrypted": None, "hasUnembeddedFonts": None, "pdfVersion": None,
        "pageCount": 1, "effectiveDpi": None,
    }, []


def structure(path, page_no):
    kind = sniff(path)
    if kind == "pdf":
        return (kind, *pdf_structure(path, page_no))
    if kind in ("jpeg", "tiff"):
        return (kind, *raster_structure(path))
    raise ArtworkError("unrecognized file — expected PDF, JPG, or TIFF")


MEASURE_DPI = 72      # 1 px ≈ 0.35 mm, averages like a densitometer spot
INKED_PCT = 5         # a pixel with more coverage counts as printed
PREVIEW_PX = 800      # long side of the preview PNG
EDGE_MM = 0.5         # bands keep off the cut line: anti-aliasing, cutting tolerance
MAX_GRID_PX = 3000    # long side of the measuring grid: bounds memory for huge pages
OVER = (220, 0, 0, 170)       # overlay: over the ink limit
RICH = (255, 140, 0, 170)     # overlay: rich black


def measure_dpi(page_mm):
    """MEASURE_DPI, lowered so the grid's long side stays ≤ MAX_GRID_PX
    (a raster tagged 72 dpi at print size would otherwise be huge)."""
    return min(MEASURE_DPI, MAX_GRID_PX / (max(page_mm["w"], page_mm["h"]) / 25.4))


def page_geometry(doc_page, kind, parsed, params):
    """The rendered area (clip, in displayed page coordinates), its size
    and the trim rectangle in mm, top-left origin. A PDF is measured on
    data_box, the box its Size row judges; /Rotate is applied, so the
    page is measured as displayed."""
    if kind == "pdf":
        rot = doc_page.rotation_matrix
        clip = (data_box(doc_page.parent, doc_page) * rot).normalize()
        page_mm = size_mm(clip)
        if parsed["trimBoxMm"]:
            t = (doc_page.trimbox * rot).normalize()
            return clip, page_mm, {"x": (t.x0 - clip.x0) * MM_PER_PT, "y": (t.y0 - clip.y0) * MM_PER_PT,
                                   "w": t.width * MM_PER_PT, "h": t.height * MM_PER_PT}
    elif parsed["declaredDpi"]:
        clip = doc_page.rect
        px, dpi = parsed["imagePx"], parsed["declaredDpi"]
        page_mm = {"w": px["w"] / dpi["x"] * 25.4, "h": px["h"] / dpi["y"] * 25.4}
    else:
        clip = doc_page.rect
        page_mm = dict(params["targetMm"])  # no dpi: taken to be the data size, as in the browser
    trim = params["trimMm"]
    return clip, page_mm, {"x": (page_mm["w"] - trim["w"]) / 2, "y": (page_mm["h"] - trim["h"]) / 2, **trim}


def render(doc_page, clip, page_mm, dpi, colorspace):
    sx = page_mm["w"] / 25.4 * dpi / clip.width
    sy = page_mm["h"] / 25.4 * dpi / clip.height
    return doc_page.get_pixmap(matrix=pymupdf.Matrix(sx, sy), clip=clip, colorspace=colorspace, alpha=False)


def bands(shape, trim, bleed_mm, round_, dpi):
    """Boolean masks (the bleed band outside the trim, a band of the same
    width inside it) on the measuring grid, both EDGE_MM off the cut."""
    h, w = shape
    px = dpi / 25.4
    ys, xs = numpy.ogrid[0:h, 0:w]
    x, y = (xs + 0.5) / px, (ys + 0.5) / px  # pixel centres in mm
    if round_:
        r = trim["w"] / 2
        d = numpy.hypot(x - (trim["x"] + r), y - (trim["y"] + r))
        return (d > r + EDGE_MM) & (d <= r + bleed_mm), (d < r - EDGE_MM) & (d >= r - bleed_mm)

    def inside(grow):
        return ((x >= trim["x"] - grow) & (x <= trim["x"] + trim["w"] + grow)
                & (y >= trim["y"] - grow) & (y <= trim["y"] + trim["h"] + grow))
    return inside(bleed_mm) & ~inside(EDGE_MM), inside(-EDGE_MM) & ~inside(-bleed_mm)


def share(mask, where=None):
    """Percent of `where` (default: everything) covered by mask."""
    n = mask.size if where is None else where.sum()
    hit = mask.sum() if where is None else (mask & where).sum()
    return round(float(hit / n * 100), 2) if n else 0.0


def facts(path, params, out_dir, base):
    try:
        kind, parsed, fonts = structure(path, params["page"])
        if parsed["encrypted"] and parsed["pageSizeMm"] is None:
            return {"kind": kind, "parsed": parsed, "unembeddedFonts": fonts}
        doc_page = pymupdf.open(path)[params["page"] - 1 if kind == "pdf" else 0]
    except ArtworkError as error:
        return {"error": str(error)}
    clip, page_mm, trim = page_geometry(doc_page, kind, parsed, params)

    dpi = measure_dpi(page_mm)
    cmyk = render(doc_page, clip, page_mm, dpi, pymupdf.csCMYK)
    ink = numpy.frombuffer(cmyk.samples, numpy.uint8).reshape(cmyk.height, cmyk.width, 4).astype(numpy.float32) * (100 / 255)
    total = ink.sum(axis=2)
    c, m, y, k = (ink[..., i] for i in range(4))
    black = params["black"]
    rich = ((k >= black["kMinPct"]) | ((c >= 60) & (m >= 60) & (y >= 60))) & (c + m + y > black["cmyMaxPct"])
    over = total > params["inkLimitPct"]

    outer, inner = bands(total.shape, trim, params["bleedMm"], params["round"], dpi)
    inked = total > INKED_PCT
    bleed, tol = params["bleedMm"], params["toleranceMm"]
    no_bleed = page_mm["w"] < trim["w"] + 2 * bleed - tol or page_mm["h"] < trim["h"] + 2 * bleed - tol

    preview, overlay = base + ".png", base + ".overlay.png"
    shown = render(doc_page, clip, page_mm, PREVIEW_PX / max(page_mm["w"], page_mm["h"]) * 25.4, pymupdf.csRGB)
    shown.save(out_dir / preview)
    layer = numpy.zeros((*total.shape, 4), numpy.uint8)
    layer[over] = OVER
    layer[rich] = RICH
    Image.fromarray(layer, "RGBA").resize((shown.width, shown.height), Image.NEAREST).save(out_dir / overlay)

    return {
        "kind": kind, "parsed": parsed, "unembeddedFonts": fonts,
        "pageMm": page_mm, "trimRectMm": trim,
        "ink": {"maxPct": round(float(total.max()), 1), "overPct": share(over)},
        "black": {"richPct": share(rich)},
        "bleed": {"outerInkPct": None if no_bleed else share(inked, outer), "innerInkPct": share(inked, inner)},
        "preview": preview, "overlay": overlay,
    }
