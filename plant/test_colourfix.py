import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf
from PIL import Image

import colourfix

MM = 72 / 25.4
GENERIC_CMYK = Path("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc")
PARAMS = {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "toleranceMm": 0.5,
          "inkLimitPct": 220, "black": {"kMinPct": 85}, "fixDpi": 150}


def px(*cmyk):
    return numpy.array([[[round(v * 2.55) for v in cmyk]]], numpy.uint8)


def pct(a):
    return [round(v / 2.55) for v in a[0, 0]]


def cmyk_pdf(path, size_mm=106, fill=(0.6, 0.4, 0.4, 1)):
    doc = pymupdf.open()
    page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
    page.draw_rect(page.rect, color=None, fill=fill)
    doc.save(path)


class RulesTest(unittest.TestCase):
    def test_rules(self):
        fix = lambda *v: pct(colourfix.fix_pixels(px(*v), 220, 85))
        self.assertEqual(fix(60, 40, 40, 100), [0, 0, 0, 100])    # rich black → pure K
        self.assertEqual(fix(80, 70, 70, 90), [0, 0, 0, 100])     # K ≥ 85 counts as black
        self.assertEqual(fix(100, 100, 100, 0), [73, 73, 73, 0])  # 300 % colour → 220 %, hue kept
        self.assertEqual(fix(50, 50, 50, 80), [47, 47, 47, 80])   # K kept, CMY scaled by 140/150
        self.assertEqual(fix(0, 0, 0, 0), [0, 0, 0, 0])
        self.assertEqual(fix(0, 0, 0, 100), [0, 0, 0, 100])
        self.assertEqual(fix(30, 20, 10, 40), [30, 20, 10, 40])   # under the limit: untouched
        self.assertEqual(pct(colourfix.fix_pixels(px(50, 50, 0, 84), 90, 85)), [3, 3, 0, 84])  # K near the limit


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
        colourfix.fix_label(src, PARAMS, out)
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
        colourfix.fix_label(src, PARAMS, out)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 75])

    @unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
    def test_rgb_goes_through_the_profile(self):
        src, out = self.dir / "r.jpg", self.dir / "r_v2.pdf"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        colourfix.fix_label(src, PARAMS, out, GENERIC_CMYK)
        _, _, pix = self.image(out)
        c, m, y, k = pix.pixel(10, 10)
        self.assertGreater(m, c)
        self.assertLessEqual((c + m + y + k) / 2.55, 220.5)

    def test_rgb_without_profile_refuses(self):
        src = self.dir / "r.jpg"
        Image.new("RGB", (626, 626), (200, 30, 30)).save(src, dpi=(150, 150))
        with self.assertRaisesRegex(colourfix.FixError, "RGB needs the labels profile"):
            colourfix.fix_label(src, PARAMS, self.dir / "r_v2.pdf")

    def test_refuses_wrong_size(self):
        src = self.dir / "a4.pdf"
        cmyk_pdf(src, size_mm=210)
        with self.assertRaisesRegex(colourfix.FixError, "210.0×210.0 mm, expected 106×106 mm"):
            colourfix.fix_label(src, PARAMS, self.dir / "x.pdf")
        self.assertFalse((self.dir / "x.pdf").exists())

    def test_uses_the_chosen_page(self):
        src, out = self.dir / "two.pdf", self.dir / "two_v2.pdf"
        doc = pymupdf.open()
        for fill in [(0, 0, 0, 0), (0, 0, 0, 0.5)]:
            page = doc.new_page(width=106 * MM, height=106 * MM)
            page.draw_rect(page.rect, color=None, fill=fill)
        doc.save(src)
        colourfix.fix_label(src, {**PARAMS, "page": 2}, out)
        _, _, pix = self.image(out)
        self.assertEqual([round(v / 2.55) for v in pix.pixel(10, 10)], [0, 0, 0, 50])


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
        colourfix.fix_label(src, PARAMS, out)  # no profile: CMYK needs none
        doc2 = pymupdf.open(out)
        (img, *_), = doc2[0].get_images(full=True)
        self.assertEqual([round(v / 2.55) for v in pymupdf.Pixmap(doc2, img).pixel(10, 10)], [0, 0, 0, 50])

    def test_strips_give_the_same_result_as_the_whole(self):
        rng = numpy.random.default_rng(1)
        a = rng.integers(0, 256, (1300, 7, 4), dtype=numpy.uint8)
        self.assertTrue(numpy.array_equal(colourfix.fix_in_strips(a, 220, 85), colourfix.fix_pixels(a, 220, 85)))
