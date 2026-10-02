import tempfile
import unittest
from pathlib import Path

import numpy
import pymupdf

import artwork
import proof

GENERIC_CMYK = Path("/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc")
PROFILE = {"name": "Generic", "conditionId": "FOGRA39"}
LABEL = {"page": 1, "trimMm": {"w": 100, "h": 100}, "round": True, "holeMm": 7.4}
INLAY = {"page": 1, "trimMm": {"w": 120, "h": 60}, "round": False, "holeMm": None}


def finished(path, page_mm, trim_mm, rotate=0, intent=True):
    """A file through the fix flow: one CMYK raster, PDF/X with the profile."""
    a = numpy.full((40, 40, 4), (150, 50, 0, 20), numpy.uint8)
    doc = artwork.raster_pdf(a, "CMYK", page_mm, trim_mm)
    if intent:
        artwork.pdfx(doc, GENERIC_CMYK, PROFILE)
    doc[0].set_rotation(rotate)
    artwork.save_atomic(doc, path)


def strokes(path):
    page = pymupdf.open(path)[0]
    return page, page.read_contents().decode(), page.get_drawings()


@unittest.skipUnless(GENERIC_CMYK.is_file(), "needs a CMYK profile")
class ProofTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.src, self.out = self.dir / "X_labels_A_v2.pdf", self.dir / "X_proof_labels_A_v2.pdf"

    def test_label_keeps_the_file_and_draws_trim_and_hole(self):
        finished(self.src, {"w": 106, "h": 106}, LABEL["trimMm"])
        proof.make(self.src, LABEL, self.out)
        src, out = pymupdf.open(self.src), pymupdf.open(self.out)
        self.assertEqual(out[0].rect, src[0].rect)
        self.assertEqual(artwork.output_intent_name(out), artwork.output_intent_name(src))
        self.assertEqual(out.metadata["format"], "PDF 1.3")
        self.assertEqual(len(out[0].get_images()), 1)
        page, content, drawings = strokes(self.out)
        self.assertNotIn(" RG", content)  # the lines are CMYK, like the file
        self.assertIn("0 0 0 1 K", content)
        self.assertIn("0 0 0 0 K", content)
        dashed = [d["rect"] for d in drawings if d["dashes"] != "[] 0"]
        mm = lambda r: round(r.width * artwork.MM_PER_PT, 1)
        self.assertEqual(sorted(mm(r) for r in dashed), [7.4, 100.0])
        for r in dashed:  # centred
            self.assertAlmostEqual((r.x0 + r.x1) / 2, page.rect.width / 2, 2)
        self.assertEqual(len(drawings), 4)  # each dashed line on a white one

    def test_rect_trim_on_a_rotated_page(self):
        # Shown 126×66 mm, stored unrotated as 66×126: the trim turns with it.
        finished(self.src, {"w": 66, "h": 126}, {"w": 60, "h": 120}, rotate=90)
        proof.make(self.src, INLAY, self.out)
        _, _, drawings = strokes(self.out)
        r = [d["rect"] for d in drawings if d["dashes"] != "[] 0"][0]
        self.assertEqual((round(r.width * artwork.MM_PER_PT), round(r.height * artwork.MM_PER_PT)), (60, 120))

    def test_refuses_an_unfinished_file(self):
        finished(self.src, {"w": 106, "h": 106}, LABEL["trimMm"], intent=False)
        with self.assertRaisesRegex(proof.ProofError, "finish the fix flow"):
            proof.make(self.src, LABEL, self.out)
        rgb = self.dir / "rgb.pdf"
        doc = pymupdf.open()
        doc.new_page().draw_rect(pymupdf.Rect(0, 0, 50, 50), fill=(1, 0, 0))
        doc.save(rgb)
        with self.assertRaisesRegex(proof.ProofError, "finish the fix flow"):
            proof.make(rgb, LABEL, self.out)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
