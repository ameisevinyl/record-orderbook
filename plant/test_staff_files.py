import tempfile
import unittest
from pathlib import Path

import staff_files
from jobs import Conflict, JobError


class StaffFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.path = self.dir / "pricelist.json"
        self.example = self.dir / "pricelist.example.json"
        self.example.write_text('{"example": true}')

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_missing_file_gives_the_example_without_a_hash(self):
        self.assertEqual(staff_files.read(self.path, self.example),
                         {"text": '{"example": true}', "hash": "", "exists": False})

    def test_read_refuses_a_file_that_is_not_utf8(self):
        self.path.write_bytes("Preis €".encode("latin-1", "replace") + b"\xe4")
        with self.assertRaises(JobError):
            staff_files.read(self.path, self.example)

    def test_read_existing_file_gives_its_text_and_hash(self):
        self.path.write_text('{"a": 1}')
        got = staff_files.read(self.path, self.example)
        self.assertEqual((got["text"], got["exists"]), ('{"a": 1}', True))
        self.assertEqual(got["hash"], staff_files.digest(b'{"a": 1}'))

    def test_write_creates_a_missing_file_for_an_empty_basis(self):
        new = staff_files.write(self.path, '{"a": 1}', "")
        self.assertEqual(self.path.read_text(), '{"a": 1}')
        self.assertEqual(new, staff_files.digest(b'{"a": 1}'))
        self.assertEqual([p.name for p in self.dir.iterdir() if p.name.endswith(".tmp")], [])

    def test_write_replaces_when_the_basis_is_current(self):
        self.path.write_text("old")
        staff_files.write(self.path, "new", staff_files.digest(b"old"))
        self.assertEqual(self.path.read_text(), "new")

    def test_write_refuses_a_stale_basis_and_keeps_the_file(self):
        self.path.write_text("theirs")
        with self.assertRaises(Conflict):
            staff_files.write(self.path, "mine", staff_files.digest(b"old"))
        self.assertEqual(self.path.read_text(), "theirs")

    def test_write_refuses_an_empty_basis_when_the_file_exists(self):
        self.path.write_text("theirs")
        with self.assertRaises(Conflict):
            staff_files.write(self.path, "mine", "")

    def test_write_refuses_non_text(self):
        with self.assertRaises(JobError):
            staff_files.write(self.path, {"a": 1}, "")

    def test_check_pricelist_must_be_a_json_object(self):
        staff_files.check("pricelist", '{"a": 1}')
        for bad in ("nonsense", "[1]", "3"):
            with self.assertRaises(JobError, msg=bad):
                staff_files.check("pricelist", bad)

    def test_check_plant_config_must_export_the_config(self):
        staff_files.check("plant-config", "export const PLANT_CONFIG = {};\n")
        with self.assertRaises(JobError):
            staff_files.check("plant-config", "const x = 1;")


if __name__ == "__main__":
    unittest.main()
