import tempfile
import unittest
from pathlib import Path

import pymupdf
from PIL import Image

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
        self.assertAlmostEqual(parsed["pageSizeMm"]["w"], 106, places=1)  # no BleedBox: the CropBox, bleed included
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


LABEL = {"targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "bleedMm": 3, "round": True,
         "page": 1, "inkLimitPct": 220, "black": {"kMinPct": 85, "cmyMaxPct": 30}, "toleranceMm": 0.5}


class MeasureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def facts(self, path, **over):
        return artwork.facts(path, {**LABEL, **over}, self.dir, path.name)

    def test_ink_over_limit_and_rich_black(self):
        path = self.dir / "rich.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0.6, 0.6, 0.6, 1))])
        f = self.facts(path)
        self.assertGreater(f["ink"]["maxPct"], 270)
        self.assertGreater(f["ink"]["overPct"], 99)
        self.assertGreater(f["black"]["richPct"], 99)
        self.assertTrue((self.dir / f["preview"]).is_file())
        self.assertTrue((self.dir / f["overlay"]).is_file())

    def test_pure_k_is_clean(self):
        path = self.dir / "k.pdf"
        pdf(path, fills=[((0, 0, 106, 106), (0, 0, 0, 1))])
        f = self.facts(path)
        self.assertLess(f["ink"]["overPct"], 0.5)
        self.assertLess(f["black"]["richPct"], 0.5)

    def test_round_label_trimmed_to_the_circle(self):
        path = self.dir / "trimmed.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=106 * MM, height=106 * MM)
        page.draw_circle((53 * MM, 53 * MM), 50 * MM, color=None, fill=(0, 1, 0, 0))
        doc.save(path)
        b = self.facts(path)["bleed"]
        self.assertGreater(b["innerInkPct"], 90)
        self.assertLess(b["outerInkPct"], 5)

    def test_bled_label_and_no_bleed_in_file(self):
        bled = self.dir / "bled.pdf"
        pdf(bled, fills=[((0, 0, 106, 106), (0, 1, 0, 0))])
        self.assertGreater(self.facts(bled)["bleed"]["outerInkPct"], 90)
        flush = self.dir / "flush.pdf"
        pdf(flush, size_mm=100, fills=[((0, 0, 100, 100), (0, 1, 0, 0))])
        self.assertIsNone(self.facts(flush)["bleed"]["outerInkPct"])

    def test_rect_part_uses_trimbox_position(self):
        path = self.dir / "sleeve.pdf"
        pdf(path, size_mm=106, trim_mm=100, fills=[((3, 3, 103, 103), (0, 1, 0, 0))])
        f = self.facts(path, round=False)
        self.assertAlmostEqual(f["trimRectMm"]["x"], 3, places=1)
        self.assertLess(f["bleed"]["outerInkPct"], 5)
        self.assertGreater(f["bleed"]["innerInkPct"], 90)

    def test_jpeg_without_dpi_is_measured_at_target_size(self):
        jpg = self.dir / "a.jpg"
        Image.new("RGB", (300, 300), (0, 0, 0)).save(jpg)
        f = self.facts(jpg)
        self.assertAlmostEqual(f["pageMm"]["w"], 106, places=1)
        self.assertGreater(f["black"]["richPct"], 90)  # RGB black separates to rich black

    def test_errors_are_per_file(self):
        path = self.dir / "one.pdf"
        pdf(path)
        self.assertIn("page 2 of 1", self.facts(path, page=2)["error"])


class ReviewFixesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_rotated_page_is_measured_as_displayed(self):
        # Landscape MediaBox turned upright by /Rotate 90, bled all round.
        path = self.dir / "rot.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=318 * MM, height=160 * MM)
        page.draw_rect(page.rect, color=None, fill=(0, 1, 0, 0))
        page.set_trimbox(pymupdf.Rect(3 * MM, 3 * MM, 315 * MM, 157 * MM))
        page.set_rotation(90)
        doc.save(path)
        f = artwork.facts(path, {**LABEL, "round": False, "targetMm": {"w": 160, "h": 318},
                                 "trimMm": {"w": 154, "h": 312}}, self.dir, "rot")
        self.assertAlmostEqual(f["pageMm"]["w"], 160, places=0)
        self.assertAlmostEqual(f["pageMm"]["h"], 318, places=0)
        self.assertAlmostEqual(f["trimRectMm"]["x"], 3, places=0)
        self.assertAlmostEqual(f["trimRectMm"]["w"], 154, places=0)
        self.assertGreater(f["bleed"]["outerInkPct"], 90)

    def test_crop_marks_outside_the_bleed_box_are_not_measured(self):
        # Prepress export: 126 mm sheet, BleedBox 106, TrimBox 100, 400 % registration marks in the slug.
        path = self.dir / "marks.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=126 * MM, height=126 * MM)
        page.draw_rect(pymupdf.Rect(10 * MM, 10 * MM, 116 * MM, 116 * MM), color=None, fill=(0, 0, 0, 1))
        for x, y in ((0, 0), (120, 0), (0, 120), (120, 120)):
            page.draw_rect(pymupdf.Rect(x * MM, y * MM, (x + 6) * MM, (y + 6) * MM), color=None, fill=(1, 1, 1, 1))
        page.set_bleedbox(pymupdf.Rect(10 * MM, 10 * MM, 116 * MM, 116 * MM))
        page.set_trimbox(pymupdf.Rect(13 * MM, 13 * MM, 113 * MM, 113 * MM))
        doc.save(path)
        f = artwork.facts(path, LABEL, self.dir, "marks")
        self.assertAlmostEqual(f["pageMm"]["w"], 106, places=0)
        self.assertLessEqual(f["ink"]["maxPct"], 101)
        self.assertAlmostEqual(f["trimRectMm"]["x"], 3, places=0)
        self.assertGreater(f["bleed"]["outerInkPct"], 90)

    def test_measuring_grid_is_capped(self):
        self.assertLessEqual(artwork.measure_dpi({"w": 5000, "h": 300}) * 5000 / 25.4, artwork.MAX_GRID_PX)
        self.assertEqual(artwork.measure_dpi({"w": 106, "h": 106}), artwork.MEASURE_DPI)

    def test_big_rasters_are_not_decompression_bombs(self):
        self.assertIsNone(Image.MAX_IMAGE_PIXELS)


if __name__ == "__main__":
    unittest.main()
