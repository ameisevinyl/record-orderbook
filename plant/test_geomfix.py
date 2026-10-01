import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf
from PIL import Image

import artwork
import geomfix

MM = 72 / 25.4
RECT = {"page": 1, "targetMm": {"w": 106, "h": 106}, "trimMm": {"w": 100, "h": 100}, "round": False}
KEEP = {"id": "keep", "scale": 1, "keep": "file", "fill": "mirror"}
REBUILD = {"id": "rebuild", "scale": 1, "keep": "trim", "fill": "mirror"}


def px(mm, dpi):
    return round(mm / 25.4 * dpi)


class MirrorTest(unittest.TestCase):
    def test_radial_mirror_reflects_at_the_circle(self):
        a = numpy.tile(numpy.arange(101, dtype=numpy.uint16), (101, 1))  # value = x
        out = geomfix.radial_mirror(a, 30)
        self.assertEqual(out[50, 85], 75)   # d = 35 → 2·30 − 35 = 25 from the centre
        self.assertEqual(out[50, 60], 60)   # inside: untouched
        self.assertEqual(out[50, 15], 25)

    def test_fit_crops_and_pads(self):
        a = numpy.arange(16, dtype=numpy.uint8).reshape(4, 4)
        self.assertEqual(geomfix.fit(a, 2, 2, "edge").tolist(), [[5, 6], [9, 10]])
        self.assertEqual(geomfix.fit(a, 4, 6, "symmetric")[0].tolist(), [0, 0, 1, 2, 3, 3])


class RenderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def image(self, out):
        doc = pymupdf.open(out)
        page = doc[0]
        pix = pymupdf.Pixmap(doc, page.get_images(full=True)[0][0])
        return page, pix

    def stripe_pdf(self, size_mm=100):
        """Light K page, a cyan stripe 5 mm wide on the left edge."""
        path = self.dir / "s.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=size_mm * MM, height=size_mm * MM)
        page.draw_rect(page.rect, color=None, fill=(0, 0, 0, 0.2))
        page.draw_rect(pymupdf.Rect(0, 0, 5 * MM, size_mm * MM), color=None, fill=(1, 0, 0, 0))
        doc.save(path)
        return path

    def test_keep_mirrors_the_missing_bleed(self):
        out = self.dir / "k.pdf"
        geomfix.render(self.stripe_pdf(), RECT, KEEP, out, 50)
        page, pix = self.image(out)
        self.assertAlmostEqual(page.rect.width / MM, 106, places=2)
        self.assertAlmostEqual(page.trimbox.x0 / MM, 3, places=2)
        self.assertEqual((pix.width, pix.n), (px(106, 50), 4))
        self.assertEqual(pix.pixel(px(1.5, 50), pix.height // 2), (255, 0, 0, 0))   # mirrored stripe
        self.assertEqual(pix.pixel(pix.width // 2, pix.height // 2), (0, 0, 0, 51))  # kept, own numbers

    def test_rebuild_drops_the_white_bleed(self):
        path = self.dir / "w.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=106 * MM, height=106 * MM)
        page.draw_rect(pymupdf.Rect(3 * MM, 3 * MM, 103 * MM, 103 * MM), color=None, fill=(0.5, 0, 0, 0))
        doc.save(path)
        out = self.dir / "r.pdf"
        geomfix.render(path, RECT, REBUILD, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(px(1, 50), px(1, 50)), pix.pixel(pix.width // 2, pix.height // 2))

    def test_fit_resamples_a_raster_to_the_fix_dpi(self):
        path = self.dir / "l.tif"
        Image.new("CMYK", (1134, 1134), (0, 0, 0, 255)).save(path, dpi=(300, 300))
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True}
        out = self.dir / "f.pdf"
        geomfix.render(path, params, {"id": "fit", "scale": 98 / (1134 / 300 * 25.4), "keep": "file", "fill": None}, out, 300)
        page, pix = self.image(out)
        self.assertEqual((pix.width, pix.height), (px(98, 300), px(98, 300)))
        self.assertAlmostEqual(page.trimbox.width / MM, 92, places=2)

    def test_round_rebuild_mirrors_radially(self):
        path = self.dir / "c.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=98 * MM, height=98 * MM)
        page.draw_circle(pymupdf.Point(49 * MM, 49 * MM), 46 * MM, color=None, fill=(0, 1, 0, 0))  # magenta trim circle, white outside
        doc.save(path)
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True}
        out = self.dir / "c_fix.pdf"
        geomfix.render(path, params, REBUILD, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(pix.width // 2, px(1, 50)), (0, 255, 0, 0))  # bleed ring now magenta

    def test_grey_and_rgb_keep_their_mode(self):
        grey = self.dir / "g.jpg"
        Image.new("L", (394, 394), 128).save(grey, dpi=(100, 100))
        out = self.dir / "g.pdf"
        geomfix.render(grey, RECT, KEEP, out, 50)
        self.assertEqual(self.image(out)[1].n, 1)
        rgb = self.dir / "rgb.pdf"
        doc = pymupdf.open()
        page = doc.new_page(width=100 * MM, height=100 * MM)
        page.draw_rect(page.rect, color=None, fill=(1, 0, 0))
        doc.save(rgb)
        geomfix.render(rgb, RECT, KEEP, self.dir / "rgb_fix.pdf", 50)
        self.assertEqual(self.image(self.dir / "rgb_fix.pdf")[1].n, 3)

    def test_the_slots_page(self):
        path = self.dir / "p.pdf"
        doc = pymupdf.open()
        for fill in ((0, 0, 0, 1), (0, 0, 1, 0)):
            page = doc.new_page(width=100 * MM, height=100 * MM)
            page.draw_rect(page.rect, color=None, fill=fill)
        doc.save(path)
        out = self.dir / "p_fix.pdf"
        geomfix.render(path, {**RECT, "page": 2}, KEEP, out, 50)
        _, pix = self.image(out)
        self.assertEqual(pix.pixel(pix.width // 2, pix.height // 2), (0, 0, 255, 0))

    def test_preview_png(self):
        out = self.dir / "k.png"
        geomfix.render(self.stripe_pdf(), RECT, KEEP, out, geomfix.preview_dpi(RECT["targetMm"]))
        with Image.open(out) as im:
            self.assertEqual(im.mode, "RGB")
            self.assertLessEqual(abs(max(im.size) - artwork.PREVIEW_PX), 1)

    def test_encrypted_and_unknown_files_refused(self):
        path = self.dir / "e.pdf"
        doc = pymupdf.open()
        doc.new_page()
        doc.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
        with self.assertRaisesRegex(geomfix.FixError, "encrypted"):
            geomfix.render(path, RECT, KEEP, self.dir / "e_fix.pdf", 50)
        junk = self.dir / "x.pdf"
        junk.write_bytes(b"nope")
        with self.assertRaises(geomfix.FixError):
            geomfix.render(junk, RECT, KEEP, self.dir / "x_fix.pdf", 50)
        self.assertFalse((self.dir / "e_fix.pdf").exists())
