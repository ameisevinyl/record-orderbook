import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf
from PIL import Image

import artwork
import colourfix

MM = 72 / 25.4
GENERIC_CMYK = Path("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc")
PARAMS = {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "toleranceMm": 0.5,
          "inkLimitPct": 220, "black": {"kMinPct": 85, "neutralTolPct": 10}, "fixDpi": 150,
          "profile": {"name": "Generic", "conditionId": "FOGRA39"}}


def px(*cmyk):
    return numpy.array([[[round(v * 2.55) for v in cmyk]]], numpy.uint8)


def pct(a):
    return [round(v / 2.55) for v in a[0, 0]]


def cmyk_pdf(path, size_mm=106, fill=(0.6, 0.4, 0.4, 1)):
    doc = pymupdf.open()
    page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
    page.draw_rect(page.rect, color=None, fill=fill)
    doc.save(path)


RAMP = numpy.linspace(100, 0, 101)  # L* = 100 − K: K reads straight off


class RulesTest(unittest.TestCase):
    def fix(self, *cmyk, light=50, limit=220):
        out, _ = colourfix.fix_pixels(px(*cmyk), numpy.array([[light]], numpy.float32), RAMP, limit, 85, 10)
        return pct(out)

    def test_rules(self):
        self.assertEqual(self.fix(60, 40, 40, 100), [0, 0, 0, 100])          # K ≥ 85 → pure K
        self.assertEqual(self.fix(34, 37, 35, 36, light=40), [0, 0, 0, 60])  # neutral → K at its lightness
        self.assertEqual(self.fix(60, 55, 55, 40, light=20), [0, 0, 0, 80])  # rich grey edge, 210 %
        self.assertEqual(self.fix(100, 100, 0, 50), [85, 85, 0, 50])         # colour over the limit: CMY scaled
        self.assertEqual(self.fix(60, 20, 20, 10), [60, 20, 20, 10])         # tinted, under the limit: untouched
        self.assertEqual(self.fix(0, 0, 0, 40), [0, 0, 0, 40])               # pure K grey stays
        self.assertEqual(self.fix(0, 0, 0, 0), [0, 0, 0, 0])
        self.assertEqual(self.fix(50, 50, 0, 84, limit=90), [3, 3, 0, 84])   # K near the limit

    def test_counts(self):
        a = numpy.concatenate([px(60, 40, 40, 100), px(34, 37, 35, 36), px(100, 100, 0, 50)], axis=1)
        _, counts = colourfix.fix_pixels(a, numpy.full((1, 3), 50, numpy.float32), RAMP, 220, 85, 10)
        self.assertEqual(counts.tolist(), [1, 1, 1])


@unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
class FixTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, out):
        doc = pymupdf.open(out)
        page = doc[0]
        (xref, *_), = page.get_images(full=True)
        pix = pymupdf.Pixmap(doc, xref)
        return doc, page, pix

    def test_cmyk_pdf_becomes_one_cmyk_image_at_fix_dpi(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src)
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        doc, page, pix = self.image(out)
        self.assertAlmostEqual(page.rect.width / MM, 106, places=1)
        self.assertAlmostEqual(page.trimbox.width / MM, 100, places=1)
        self.assertAlmostEqual(page.trimbox.x0 / MM, 3, places=1)
        self.assertEqual(pix.n, 4)
        self.assertAlmostEqual(pix.width, 106 / 25.4 * 150, delta=2)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 100])

    def test_grey_goes_into_k(self):
        src, out = self.dir / "g.tif", self.dir / "g_v2.pdf"
        Image.new("L", (626, 626), 64).save(src, dpi=(150, 150))  # 106 mm at 150 dpi
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 75])

    @unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
    def test_rgb_goes_through_the_profile(self):
        src, out = self.dir / "r.jpg", self.dir / "r_v2.pdf"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        c, m, y, k = pix.pixel(10, 10)
        self.assertGreater(m, c)
        self.assertLessEqual((c + m + y + k) / 2.55, 220.5)

    def test_no_profile_refuses(self):
        src = self.dir / "r.jpg"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        with self.assertRaisesRegex(colourfix.FixError, "print profile"):
            colourfix.fix(src, PARAMS, self.dir / "r_v2.pdf", None)

    def test_neutral_grey_keeps_its_lightness_as_k(self):
        src, out = self.dir / "n.pdf", self.dir / "n_v2.pdf"
        cmyk_pdf(src, fill=(0.34, 0.37, 0.35, 0.36))
        detail = colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        c, m, y, k = pix.pixel(10, 10)
        self.assertEqual((c, m, y), (0, 0, 0))
        t, _ = colourfix.lab_transform(GENERIC_CMYK)
        before = colourfix.light(px(34, 37, 35, 36), t)[0, 0]
        after = colourfix.light(numpy.array([[[0, 0, 0, k]]], numpy.uint8), t)[0, 0]
        self.assertLess(abs(before - after), 2)
        self.assertIn("neutral → K 100.0 %", detail)

    def test_fixed_file_is_pdfx(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src)
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        _, parsed, _ = artwork.structure(out, 1)
        self.assertEqual(parsed["pdfVersion"], "1.3")
        self.assertIsNotNone(parsed["outputIntent"])

    def test_assign_keeps_the_numbers(self):
        src, out = self.dir / "a.pdf", self.dir / "a_v2.pdf"
        cmyk_pdf(src, fill=(0.6, 0.4, 0.4, 0.2))
        self.assertIn("colours unchanged", colourfix.assign(src, PARAMS, out, GENERIC_CMYK))
        page = pymupdf.open(out)[0]
        self.assertIsNotNone(artwork.structure(out, 1)[1]["outputIntent"])
        self.assertEqual(out.read_bytes()[:8], b"%PDF-1.3")
        pymupdf.TOOLS.set_icc(False)
        try:
            pix = page.get_pixmap(colorspace=pymupdf.csCMYK, alpha=False)
        finally:
            pymupdf.TOOLS.set_icc(True)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(5, 5)], [60, 40, 40, 20])

    def test_refuses_wrong_size(self):
        src = self.dir / "a4.pdf"
        cmyk_pdf(src, size_mm=210)
        with self.assertRaisesRegex(colourfix.FixError, "210.0×210.0 mm, expected 106×106 mm"):
            colourfix.fix(src, PARAMS, self.dir / "x.pdf", GENERIC_CMYK)
        self.assertFalse((self.dir / "x.pdf").exists())

    def test_uses_the_chosen_page(self):
        src, out = self.dir / "two.pdf", self.dir / "two_v2.pdf"
        doc = pymupdf.open()
        for fill in [(0, 0, 0, 0), (0, 0, 0, 0.5)]:
            page = doc.new_page(width=106 * MM, height=106 * MM)
            page.draw_rect(page.rect, color=None, fill=fill)
        doc.save(src)
        colourfix.fix(src, {**PARAMS, "page": 2}, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 50])


@unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
class ReviewFixesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_vector_cmyk_painted_with_cs_scn_keeps_its_numbers_without_a_profile(self):
        # InDesign/Illustrator paint with "cs … scn"; colour_mode can't tell, so it reads "unknown".
        src, out = self.dir / "vec.pdf", self.dir / "vec_v2.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=106 * MM, height=106 * MM)
        xref = doc.get_new_xref()
        doc.update_object(xref, "<< /Length 0 >>")
        doc.update_stream(xref, b"/DeviceCMYK cs 0 0 0 0.5 scn 0 0 400 400 re f")
        doc.xref_set_key(page.xref, "Contents", f"{xref} 0 R")
        doc.save(src)
        colourfix.fix(src, PARAMS, out, GENERIC_CMYK)
        doc2 = pymupdf.open(out)
        (img, *_), = doc2[0].get_images(full=True)
        self.assertEqual([round(v / 2.55) for v in pymupdf.Pixmap(doc2, img).pixel(10, 10)], [0, 0, 0, 50])

    def test_strips_give_the_same_result_as_the_whole(self):
        rng = numpy.random.default_rng(1)
        a = rng.integers(0, 256, (1300, 7, 4), dtype=numpy.uint8)
        t, ramp = colourfix.lab_transform(GENERIC_CMYK)
        strips, n1 = colourfix.fix_in_strips(a, t, ramp, 220, 85, 10)
        whole, n2 = colourfix.fix_pixels(a, colourfix.light(a, t), ramp, 220, 85, 10)
        self.assertTrue(numpy.array_equal(strips, whole))
        self.assertEqual(n1.tolist(), n2.tolist())
