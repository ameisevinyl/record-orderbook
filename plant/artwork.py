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
    boxes = {"BleedBox": page.bleedbox, "TrimBox": page.trimbox, "MediaBox": page.mediabox}
    page_box = next(rect for key, rect in boxes.items() if key == "MediaBox" or has_box(doc, page, key))
    fonts = sorted({f[3].split("+")[-1] for f in page.get_fonts() if f[1] == "n/a" and f[2] != "Type3"})
    images = page.get_images(full=True)
    largest = max(images, key=lambda i: i[2] * i[3], default=None)
    version = (doc.metadata.get("format") or "").removeprefix("PDF ") or None
    return {
        "pageSizeMm": size_mm(page_box),
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
