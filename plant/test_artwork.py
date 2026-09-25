import tempfile
import unittest
from pathlib import Path

try:
    import pymupdf
    from PIL import Image
except ImportError:
    pymupdf = None

if pymupdf:
    import artwork

MM = 72 / 25.4


def pdf(path, size_mm=106, trim_mm=None, fills=(), text=False, image_dpi=None, pages=1):
    doc = pymupdf.open()
    for _ in range(pages):
        page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
        if trim_mm:
            o = (size_mm - trim_mm) / 2 * MM
            page.set_trimbox(pymupdf.Rect(o, o, o + trim_mm * MM, o + trim_mm * MM))
        for rect_mm, cmyk in fills:
            page.draw_rect(pymupdf.Rect(*(v * MM for v in rect_mm)), color=None, fill=cmyk)
        if text:
            page.insert_text((20, 40), "Label", fontname="helv")  # base-14: not embedded
        if image_dpi:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, image_dpi, image_dpi))
            pix.clear_with(200)
            page.insert_image(pymupdf.Rect(0, 0, 72, 72), pixmap=pix)  # 1 inch
    doc.save(path)


@unittest.skipIf(pymupdf is None, "needs uv run --project plant")
class StructureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_pdf_boxes_fonts_colour_and_dpi(self):
        path = self.dir / "a.pdf"
        pdf(path, trim_mm=100, fills=[((0, 0, 106, 106), (0, 0, 0, 1))], text=True, image_dpi=150)
        kind, parsed, fonts = artwork.structure(path, 1)
        self.assertEqual(kind, "pdf")
        self.assertAlmostEqual(parsed["trimBoxMm"]["w"], 100, places=1)
        self.assertAlmostEqual(parsed["pageSizeMm"]["w"], 100, places=1)  # TrimBox beats MediaBox
        self.assertEqual(parsed["colorMode"], "RGB")  # the RGB image wins
        self.assertEqual(round(parsed["effectiveDpi"]["x"]), 150)
        self.assertTrue(parsed["hasUnembeddedFonts"])
        self.assertIn("Helvetica", fonts)
        self.assertFalse(parsed["encrypted"])
        self.assertEqual(parsed["pageCount"], 1)
        self.assertRegex(parsed["pdfVersion"], r"^\d\.\d$")

    def test_cmyk_vector_only(self):
        path = self.dir / "k.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0, 0, 0, 1))])
        _, parsed, fonts = artwork.structure(path, 1)
        self.assertEqual(parsed["colorMode"], "CMYK")
        self.assertIsNone(parsed["trimBoxMm"])
        self.assertIsNone(parsed["effectiveDpi"])
        self.assertEqual(fonts, [])

    def test_page_beyond_count_is_an_error(self):
        path = self.dir / "two.pdf"
        pdf(path, pages=2)
        self.assertEqual(artwork.structure(path, 2)[1]["pageCount"], 2)
        with self.assertRaisesRegex(artwork.ArtworkError, "page 3 of 2"):
            artwork.structure(path, 3)

    def test_encrypted(self):
        path = self.dir / "enc.pdf"
        doc = pymupdf.open()
        doc.new_page()
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="o", user_pw="u")
        _, parsed, _ = artwork.structure(path, 1)
        self.assertTrue(parsed["encrypted"])

    def test_tiff_and_jpeg_headers(self):
        tif, jpg = self.dir / "a.tif", self.dir / "a.jpg"
        Image.new("CMYK", (118, 118), (0, 0, 0, 255)).save(tif, dpi=(300, 300))
        Image.new("RGB", (100, 50), (0, 0, 0)).save(jpg)
        kind, parsed, _ = artwork.structure(tif, 1)
        self.assertEqual((kind, parsed["colorMode"], parsed["declaredDpi"]), ("tiff", "CMYK", {"x": 300, "y": 300}))
        kind, parsed, _ = artwork.structure(jpg, 1)
        self.assertEqual((kind, parsed["colorMode"], parsed["imagePx"]), ("jpeg", "RGB", {"w": 100, "h": 50}))
        self.assertIsNone(parsed["declaredDpi"])

    def test_unreadable(self):
        bad = self.dir / "bad.pdf"
        bad.write_bytes(b"%PDF-1.4 garbage")
        with self.assertRaises(artwork.ArtworkError):
            artwork.structure(bad, 1)


if __name__ == "__main__":
    unittest.main()
