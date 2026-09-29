import io
import json
import stat
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

import jobs
from jobs import Conflict, JobError


def make_zip(path, entries):
    """entries: (name, data) pairs or (ZipInfo, data) pairs."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # duplicate-name warning
        with zipfile.ZipFile(path, "w") as zf:
            for name, data in entries:
                zf.writestr(name, data)


class Tree(unittest.TestCase):
    """A fresh jobs tree per test."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        jobs.ensure_stages(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def job(self, stage, name, project=None):
        folder = self.root / stage / name
        folder.mkdir(parents=True)
        (folder / "project.json").write_text(json.dumps(project or {"catalogue": "X"}))
        return folder

    def project(self, folder):
        return json.loads((folder / "project.json").read_text())


class JobsTest(Tree):
    def test_default_stages_only_in_an_empty_root(self):
        self.assertEqual(jobs.stages(self.root), ["00_INBOX", "10_ORDERS", "10_ORDERS/10_PREPRESS",
                                                  "10_ORDERS/20_PRESS", "20_DONE", "99_ARCHIVE"])
        (self.root / "15_TESTPRESS").mkdir()
        (self.root / "notes").mkdir()
        (self.root / "20_DONE" / "lower_case").mkdir()
        jobs.ensure_stages(self.root)
        self.assertIn("15_TESTPRESS", jobs.stages(self.root))
        self.assertNotIn("notes", jobs.stages(self.root))
        self.assertNotIn("20_DONE/lower_case", jobs.stages(self.root))

    def test_board_logs_a_move_made_on_disk(self):
        folder = self.job("00_INBOX", "j")
        jobs.board(self.root)
        self.assertEqual(self.project(folder)["plant"], {"stage": "00_INBOX"})
        folder.rename(self.root / "20_DONE" / "j")  # someone's mv
        board = jobs.board(self.root)
        project = self.project(self.root / "20_DONE" / "j")
        self.assertEqual(project["plant"]["stage"], "20_DONE")
        self.assertEqual([(h["by"], h["note"]) for h in project["history"]],
                         [("disk", "in 00_INBOX"), ("disk", "00_INBOX → 20_DONE")])
        done = next(c for c in board["stages"] if c["stage"] == "20_DONE")
        self.assertEqual(done["jobs"], [{"job": "j", "catalogue": "X", "title": "", "artist": ""}])
        jobs.board(self.root)
        self.assertEqual(len(self.project(self.root / "20_DONE" / "j")["history"]), 2)

    def test_board_reports_a_job_in_two_stages_and_broken_json(self):
        self.job("00_INBOX", "j")
        self.job("20_DONE", "j")
        (self.job("10_ORDERS/20_PRESS", "bad") / "project.json").write_text("{")
        board = jobs.board(self.root)
        self.assertEqual(board["problems"], ["j is in more than one stage: 00_INBOX, 20_DONE"])
        press = next(c for c in board["stages"] if c["stage"] == "10_ORDERS/20_PRESS")
        self.assertIn("not valid JSON", press["jobs"][0]["error"])
        with self.assertRaisesRegex(JobError, "more than one stage"):
            jobs.find(self.root, "j")

    def test_move_renames_and_logs(self):
        self.job("00_INBOX", "j")
        jobs.move(self.root, "j", "10_ORDERS/10_PREPRESS")
        project = self.project(self.root / "10_ORDERS/10_PREPRESS/j")
        self.assertEqual(project["history"][-1]["by"], "plant")
        self.assertEqual(project["history"][-1]["note"], "in 10_ORDERS/10_PREPRESS")
        with self.assertRaisesRegex(JobError, "no stage"):
            jobs.move(self.root, "j", "../x")
        self.job("20_DONE", "k")
        self.job("00_INBOX", "k2")
        (self.root / "20_DONE" / "k2").mkdir()
        with self.assertRaises(Conflict):
            jobs.move(self.root, "k2", "20_DONE")

    def test_names_from_the_page_are_plain(self):
        for bad in ("", ".", "..", "a/b", "..\\x", ".checks", None):
            with self.subTest(bad), self.assertRaises(JobError):
                jobs.plain(bad)

    def test_write_project_refuses_a_stale_base(self):
        folder = self.job("00_INBOX", "j")
        digest = jobs.read_project(folder)[1]
        (folder / "project.json").write_text('{"edited": "by hand"}')
        with self.assertRaises(Conflict):
            jobs.write_project(folder, {"x": 1}, digest)
        new = jobs.write_project(folder, {"x": 1}, jobs.read_project(folder)[1])
        self.assertEqual(self.project(folder), {"x": 1})
        self.assertEqual(new, jobs.read_project(folder)[1])
        self.assertFalse((folder / ".project.json.tmp").exists())

    def test_files_skip_dot_names(self):
        folder = self.job("00_INBOX", "j")
        (folder / "A1.wav").write_bytes(b"12345")
        (folder / ".checks").mkdir()
        (folder / ".checks" / "A1.wav.mp3").write_bytes(b"1")
        (folder / ".DS_Store").write_bytes(b"1")
        self.assertEqual(jobs.files(folder), [{"name": "A1.wav", "size": 5}])

    def test_assign_renames_and_saves_or_undoes(self):
        folder = self.job("00_INBOX", "j")
        (folder / "fix.pdf").write_bytes(b"%PDF")
        digest = jobs.read_project(folder)[1]
        with self.assertRaises(Conflict):
            jobs.assign(folder, "fix.pdf", "X_labels_A_v2.pdf", {"y": 1}, "stale")
        self.assertTrue((folder / "fix.pdf").is_file())
        jobs.assign(folder, "fix.pdf", "X_labels_A_v2.pdf", {"y": 1}, digest)
        self.assertTrue((folder / "X_labels_A_v2.pdf").is_file())
        self.assertEqual(self.project(folder), {"y": 1})


class ZipTest(Tree):
    def inbox_zip(self, name, entries):
        make_zip(self.root / "00_INBOX" / name, entries)

    def test_accept_unpacks_flat_under_the_zip_folder_name(self):
        self.inbox_zip("upload.zip", [("260925_X_a/project.json", b'{"catalogue": "X"}'),
                                      ("260925_X_a/X_A1_v1.wav", b"123")])
        self.assertEqual(jobs.accept(self.root, "upload.zip"), "260925_X_a")
        folder = self.root / "00_INBOX" / "260925_X_a"
        self.assertEqual(jobs.files(folder), [{"name": "X_A1_v1.wav", "size": 3}])
        self.assertEqual(self.project(folder)["history"][0]["note"], "received upload.zip")
        self.assertFalse((self.root / "00_INBOX" / "upload.zip").exists())

    def test_accept_root_level_zip_uses_the_zip_name(self):
        self.inbox_zip("p.zip", [("project.json", b"{}")])
        self.assertEqual(jobs.accept(self.root, "p.zip"), "p")

    def test_accept_refuses_an_existing_job(self):
        self.job("20_DONE", "p")
        self.inbox_zip("p.zip", [("project.json", b"{}")])
        with self.assertRaises(Conflict):
            jobs.accept(self.root, "p.zip")
        self.assertTrue((self.root / "00_INBOX" / "p.zip").exists())

    def test_rejects_unsafe_and_invalid_zips(self):
        link = zipfile.ZipInfo("p/link")
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        cases = {
            "unsafe path": [("project.json", b"{}"), ("../x", b"1")],
            "unsafe path ": [("project.json", b"{}"), ("/abs", b"1")],
            "symlink": [("project.json", b"{}"), (link, b"target")],
            "duplicate filename": [("project.json", b"{}"), ("a", b"1"), ("a", b"2")],
            "no project.json": [("a", b"1")],
            "more than one project.json": [("a/project.json", b"{}"), ("b/project.json", b"{}")],
            "not valid JSON": [("project.json", b"{")],
        }
        for message, entries in cases.items():
            with self.subTest(message):
                self.inbox_zip("z.zip", entries)
                with self.assertRaisesRegex(JobError, message.strip()):
                    jobs.accept(self.root, "z.zip")
        (self.root / "00_INBOX" / "n.zip").write_bytes(b"nope")
        with self.assertRaisesRegex(JobError, "not a zip"):
            jobs.accept(self.root, "n.zip")

    def test_corrupt_member_leaves_no_job(self):
        self.inbox_zip("p.zip", [("project.json", b"{}"), ("A1.wav", b"x" * 100)])
        path = self.root / "00_INBOX" / "p.zip"
        data = bytearray(path.read_bytes())
        data[data.index(b"x" * 100)] = ord("y")  # breaks the CRC of A1.wav
        path.write_bytes(bytes(data))
        with self.assertRaisesRegex(JobError, "corrupt"):
            jobs.accept(self.root, "p.zip")
        self.assertEqual([p.name for p in (self.root / "00_INBOX").iterdir()], ["p.zip"])

    def test_inspect_hashes_without_unpacking(self):
        self.inbox_zip("p.zip", [("f/project.json", b'{"catalogue": "X"}'), ("f/a.pdf", b"abc")])
        info = jobs.inspect_zip(self.root / "00_INBOX" / "p.zip")
        self.assertEqual(info["job"], "f")
        self.assertEqual(info["files"], [{"name": "a.pdf", "size": 3, "sha256":
                                          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}])

    def test_merge_adds_new_versions_and_replaces_text_files(self):
        folder = self.job("10_ORDERS/10_PREPRESS", "j")
        (folder / "X_labels_A_v1.pdf").write_bytes(b"old")
        (folder / "order_summary.txt").write_text("old")
        self.inbox_zip("r.zip", [("j/project.json", b"{}"), ("j/X_labels_A_v1.pdf", b"new"),
                                 ("j/order_summary.txt", b"new")])
        digest = jobs.read_project(folder)[1]
        with self.assertRaises(Conflict):
            jobs.merge(self.root, "r.zip", "j", [{"from": "X_labels_A_v1.pdf", "to": "X_labels_A_v1.pdf"}], {}, digest)
        jobs.merge(self.root, "r.zip", "j", [{"from": "X_labels_A_v1.pdf", "to": "X_labels_A_v2.pdf"}],
                   {"merged": True}, digest)
        self.assertEqual((folder / "X_labels_A_v1.pdf").read_bytes(), b"old")
        self.assertEqual((folder / "X_labels_A_v2.pdf").read_bytes(), b"new")
        self.assertEqual((folder / "order_summary.txt").read_text(), "new")
        self.assertEqual(self.project(folder), {"merged": True})
        self.assertFalse((self.root / "00_INBOX" / "r.zip").exists())

    def test_merge_on_a_stale_project_writes_nothing(self):
        folder = self.job("20_DONE", "j")
        self.inbox_zip("r.zip", [("project.json", b"{}"), ("a.pdf", b"new")])
        with self.assertRaises(Conflict):
            jobs.merge(self.root, "r.zip", "j", [{"from": "a.pdf", "to": "a_v2.pdf"}], {}, "stale")
        self.assertFalse((folder / "a_v2.pdf").exists())

    def test_write_zip_is_a_customer_package(self):
        folder = self.job("20_DONE", "j")
        (folder / "a.pdf").write_bytes(b"1")
        (folder / ".checks").mkdir()
        (folder / ".checks" / "a.png").write_bytes(b"1")
        buf = io.BytesIO()
        jobs.write_zip(folder, buf)
        with zipfile.ZipFile(buf) as zf:
            self.assertEqual(sorted(zf.namelist()), ["j/a.pdf", "j/project.json"])


if __name__ == "__main__":
    unittest.main()
