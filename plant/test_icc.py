import tempfile
import unittest
import zipfile
from pathlib import Path

from PIL import ImageCms

import icc


def profile_bytes():
    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


class IccTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.out = self.dir / "icc"

    def tearDown(self):
        self.tmp.cleanup()

    def test_direct_icc_is_downloaded_once(self):
        src, data = self.dir / "p.icc", profile_bytes()  # the header carries a time: build once
        src.write_bytes(data)
        spec = {"name": "P", "url": src.as_uri(), "file": "p.icc"}
        self.assertIsNone(icc.path(spec, self.out))
        self.assertEqual(icc.ensure(spec, self.out).read_bytes(), data)
        src.unlink()  # a second call must not download again
        self.assertEqual(icc.ensure(spec, self.out), self.out / "p.icc")

    def test_member_of_a_zip_by_basename_skipping_macosx(self):
        z, data = self.dir / "e.zip", profile_bytes()
        with zipfile.ZipFile(z, "w") as zf:
            zf.writestr("__MACOSX/ECI/._ISOcoated_v2_eci.icc", b"junk")
            zf.writestr("ECI/ISOcoated_v2_eci.icc", data)
        spec = {"name": "ISO", "url": z.as_uri(), "file": "ISOcoated_v2_eci.icc"}
        self.assertEqual(icc.ensure(spec, self.out).read_bytes(), data)

    def test_failures_name_the_profile_and_leave_nothing(self):
        with zipfile.ZipFile(self.dir / "x.zip", "w") as zf:
            zf.writestr("other.icc", profile_bytes())
        for url in [(self.dir / "missing.icc").as_uri(), (self.dir / "x.zip").as_uri()]:
            with self.assertRaisesRegex(icc.ProfileError, "ISO Coated"):
                icc.ensure({"name": "ISO Coated", "url": url, "file": "p.icc"}, self.out)
        self.assertEqual(list(self.out.glob("*")) if self.out.exists() else [], [])

    def test_unsafe_file_names_are_refused(self):
        with self.assertRaises(icc.ProfileError):
            icc.path({"name": "x", "url": "https://x", "file": "../x.icc"}, self.out)
