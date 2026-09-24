import io
import stat
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

from server import OpenError, ROOT, static_target, unpack, zip_stem


def make_zip(entries):
    """entries: (name, data) pairs or (ZipInfo, data) pairs."""
    buf = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # duplicate-name warning
        with zipfile.ZipFile(buf, "w") as zf:
            for name, data in entries:
                zf.writestr(name, data)
    buf.seek(0)
    return buf


class UnpackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name) / "work" / "p"

    def tearDown(self):
        self.tmp.cleanup()

    def test_foldered_zip_lists_files_relative_to_project_json(self):
        z = make_zip([("p/project.json", b'{"catalogue": "X"}'), ("p/A1.wav", b"12345")])
        project, files = unpack(z, self.dest)
        self.assertEqual(project, {"catalogue": "X"})
        self.assertEqual(files, [{"name": "A1.wav", "size": 5}])
        self.assertTrue((self.dest / "p" / "A1.wav").is_file())

    def test_root_level_zip(self):
        z = make_zip([("project.json", b"{}"), ("labA.pdf", b"1")])
        self.assertEqual(unpack(z, self.dest)[1], [{"name": "labA.pdf", "size": 1}])

    def test_replaces_existing_work_folder(self):
        self.dest.mkdir(parents=True)
        (self.dest / "stale.txt").write_text("old")
        unpack(make_zip([("project.json", b"{}")]), self.dest)
        self.assertFalse((self.dest / "stale.txt").exists())

    def test_rejects_unsafe_and_invalid_zips(self):
        link = zipfile.ZipInfo("p/link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        cases = {
            "not a zip file": io.BytesIO(b"nope"),
            "unsafe path": make_zip([("project.json", b"{}"), ("../x", b"1")]),
            "unsafe path ": make_zip([("project.json", b"{}"), ("/abs", b"1")]),
            "symlink": make_zip([("project.json", b"{}"), (link, b"target")]),
            "duplicate filename": make_zip([("project.json", b"{}"), ("a", b"1"), ("a", b"2")]),
            "no project.json": make_zip([("a", b"1")]),
            "more than one project.json": make_zip([("a/project.json", b"{}"), ("b/project.json", b"{}")]),
            "not valid JSON": make_zip([("project.json", b"{")]),
        }
        for message, z in cases.items():
            with self.subTest(message):
                with self.assertRaisesRegex(OpenError, message.strip()):
                    unpack(z, self.dest)


class HelpersTest(unittest.TestCase):
    def test_static_target_stays_inside_src(self):
        self.assertEqual(static_target("/"), ROOT / "src" / "plant" / "index.html")
        self.assertEqual(static_target("/src/config.js?x=1"), ROOT / "src" / "config.js")
        self.assertIsNone(static_target("/src/../plant/server.py"))
        self.assertIsNone(static_target("/src/%2e%2e/plant/server.py"))
        self.assertIsNone(static_target("/plant/server.py"))
        self.assertIsNone(static_target("/src/nope.js"))

    def test_zip_stem_decodes_and_strips_folders(self):
        self.assertEqual(zip_stem("260924_X_a%40b%C3%B6.de.zip"), "260924_X_a@bö.de")
        self.assertEqual(zip_stem("..%2F..%2Fevil.zip"), "evil")
        with self.assertRaises(OpenError):
            zip_stem("..")


if __name__ == "__main__":
    unittest.main()
