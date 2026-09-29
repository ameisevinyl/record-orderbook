import json
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import jobs
from archive import archive


class ArchiveTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        jobs.ensure_stages(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def done_job(self, name, since):
        folder = self.root / "20_DONE" / name
        folder.mkdir()
        (folder / "a.pdf").write_bytes(b"1")
        (folder / "project.json").write_text(json.dumps({"plant": {"stage": "20_DONE"}, "history": [
            {"savedAt": since, "by": "plant", "note": "10_ORDERS/20_PRESS → 20_DONE"}]}))

    def test_archives_only_jobs_done_long_enough(self):
        self.done_job("old", "2026-01-01T00:00:00.000Z")
        self.done_job("new", "2026-09-28T00:00:00.000Z")
        now = datetime(2026, 9, 29, tzinfo=timezone.utc)
        self.assertEqual(archive(self.root, 30, now), ["old"])
        self.assertFalse((self.root / "20_DONE" / "old").exists())
        self.assertTrue((self.root / "20_DONE" / "new").exists())
        with zipfile.ZipFile(self.root / "99_ARCHIVE" / "old.zip") as zf:
            self.assertEqual(sorted(zf.namelist()), ["old/a.pdf", "old/project.json"])

    def test_a_job_moved_by_hand_starts_its_time_now(self):
        folder = self.root / "20_DONE" / "j"
        folder.mkdir()
        (folder / "project.json").write_text('{"plant": {"stage": "10_ORDERS/20_PRESS"}}')
        self.assertEqual(archive(self.root, 1), [])
        self.assertEqual(archive(self.root, 0), ["j"])

    def test_existing_archive_zip_is_left_alone(self):
        self.done_job("old", "2026-01-01T00:00:00.000Z")
        (self.root / "99_ARCHIVE" / "old.zip").write_bytes(b"earlier")
        self.assertEqual(archive(self.root, 1), [])
        self.assertTrue((self.root / "20_DONE" / "old").exists())


if __name__ == "__main__":
    unittest.main()
