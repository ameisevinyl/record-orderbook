import io
import json
import os
import stat
import tempfile
import unittest
import warnings
import zipfile
from datetime import datetime
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


def sized(files):
    """files() without the modification times."""
    return [{"name": f["name"], "size": f["size"]} for f in files]


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
        folder = self.job("10_ORDERS/20_PRESS", "j")
        jobs.board(self.root)
        self.assertEqual(self.project(folder)["plant"], {"stage": "10_ORDERS/20_PRESS"})
        folder.rename(self.root / "20_DONE" / "j")  # someone's mv
        board = jobs.board(self.root)
        project = self.project(self.root / "20_DONE" / "j")
        self.assertEqual(project["plant"]["stage"], "20_DONE")
        self.assertEqual([(h["by"], h["note"]) for h in project["history"]],
                         [("disk", "in 10_ORDERS/20_PRESS"), ("disk", "10_ORDERS/20_PRESS → 20_DONE")])
        done = next(c for c in board["stages"] if c["stage"] == "20_DONE")
        self.assertEqual([{k: c[k] for k in ("job", "catalogue", "title", "artist")} for c in done["jobs"]],
                         [{"job": "j", "catalogue": "X", "title": "", "artist": ""}])
        jobs.board(self.root)
        self.assertEqual(len(self.project(self.root / "20_DONE" / "j")["history"]), 2)

    def test_board_reports_a_job_in_two_stages_and_broken_json(self):
        self.job("10_ORDERS/10_PREPRESS", "j")
        self.job("20_DONE", "j")
        (self.job("10_ORDERS/20_PRESS", "bad") / "project.json").write_text("{")
        board = jobs.board(self.root)
        self.assertEqual(board["problems"], ["more than one job j: 10_ORDERS/10_PREPRESS/j, 20_DONE/j"])
        press = next(c for c in board["stages"] if c["stage"] == "10_ORDERS/20_PRESS")
        self.assertIn("not valid JSON", press["jobs"][0]["error"])
        with self.assertRaisesRegex(JobError, "more than one job j"):
            jobs.find(self.root, "j")

    def test_board_cards_carry_project_files_and_cached_artwork(self):
        folder = self.job("20_DONE", "X_a_261001-1432", {"catalogue": "X"})
        (folder / "L.pdf").write_bytes(b"%PDF")
        (folder / ".checks").mkdir()
        (folder / ".checks" / "artwork.json").write_text(json.dumps({"L.pdf": {"sha256": "abc", "facts": {"kind": "pdf"}}}))
        card = next(c for s in jobs.board(self.root)["stages"] for c in s["jobs"] if c["job"] == "X_a_261001-1432")
        self.assertEqual(card["project"]["catalogue"], "X")
        self.assertEqual([f["name"] for f in card["files"]], ["L.pdf"])
        self.assertEqual(card["artwork"], {"L.pdf": {"kind": "pdf", "sha256": "abc"}})

    def test_archived_lists_the_archive_zips_newest_first(self):
        folder = self.root / "99_ARCHIVE"
        for name, data, when in (("old.zip", b"1", 1_000_000_000), ("new.zip", b"22", 1_700_000_000)):
            (folder / name).write_bytes(data)
            os.utime(folder / name, (when, when))
        (folder / ".new.zip.part").write_bytes(b"half")
        (folder / "notes.txt").write_text("x")
        listing = jobs.archived(self.root)
        self.assertEqual([(e["name"], e["size"]) for e in listing], [("new.zip", 2), ("old.zip", 1)])
        self.assertRegex(listing[0]["modified"], r"^2023-11-14T\d\d:\d\d:\d\dZ$")
        self.assertEqual(jobs.board(self.root)["archive"], listing)

    def test_archived_without_an_archive_stage_is_empty(self):
        (self.root / "99_ARCHIVE").rmdir()
        self.assertEqual(jobs.archived(self.root), [])

    def test_the_customer_zip_gets_a_quote_without_the_lines(self):
        full = {"version": 1, "created": "2026-10-09", "validUntil": "2026-12-31", "currency": "EUR", "net": 810, "copies": 300,
                "perCopy": 2.7, "order": {"format": "7"}, "lines": [{"key": "7/record/setup", "amount": 100}],
                "vat": {"case": "reverse-charge", "rate": 0, "amount": 0, "gross": 810, "note": "no VAT",
                        "vatId": {"id": "FR1", "status": "valid", "name": "Acme", "checked": "2026-10-09"}}}
        folder = self.job("20_DONE", "j")
        (folder / "price_quote.json").write_text(json.dumps(full))

        def quote_in(**kwargs):
            buf = io.BytesIO()
            jobs.write_zip(folder, buf, **kwargs)
            with zipfile.ZipFile(buf) as zf:
                name = "j/price_quote.json"
                return json.loads(zf.read(name)) if name in zf.namelist() else None

        customer = quote_in(quote=jobs.customer_quote(full))
        self.assertEqual(sorted(customer), ["copies", "created", "currency", "net", "perCopy", "validUntil", "vat", "version"])
        self.assertEqual(customer["vat"], {"case": "reverse-charge", "rate": 0, "amount": 0, "gross": 810, "note": "no VAT"})
        self.assertEqual(quote_in(), full, "inside the plant the file is whole (archive)")
        self.assertIsNone(quote_in(quote=False), "no usable quote: none in the zip")

    def test_move_renames_and_logs(self):
        self.job("00_INBOX", "j", {"plant": {"stage": "00_INBOX"}})
        jobs.move(self.root, "j", "10_ORDERS/10_PREPRESS")
        project = self.project(self.root / "10_ORDERS/10_PREPRESS/j")
        self.assertEqual(project["history"][-1]["by"], "plant")
        self.assertEqual(project["history"][-1]["note"], "00_INBOX → 10_ORDERS/10_PREPRESS")
        with self.assertRaisesRegex(JobError, "no stage"):
            jobs.move(self.root, "j", "../x")
        self.job("20_DONE", "k")
        self.job("10_ORDERS/20_PRESS", "k2")
        (self.root / "20_DONE" / "k2").mkdir()
        with self.assertRaises(Conflict):
            jobs.move(self.root, "k2", "20_DONE")

    def test_a_grouping_stage_takes_no_jobs(self):
        self.assertEqual(jobs.grouping(self.root), {"10_ORDERS"})
        self.assertEqual(jobs.places(self.root), ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS",
                                                  "20_DONE", "99_ARCHIVE"])
        self.job("10_ORDERS/10_PREPRESS", "j")
        with self.assertRaisesRegex(JobError, "only groups"):
            jobs.move(self.root, "j", "10_ORDERS")
        self.job("10_ORDERS", "k")  # put there by hand: still found, so it can be moved out
        self.assertEqual(jobs.find(self.root, "k")[0], "10_ORDERS")
        jobs.move(self.root, "k", "10_ORDERS/20_PRESS")

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
        self.assertEqual(sized(jobs.files(folder)), [{"name": "A1.wav", "size": 5}])

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
        self.assertEqual(sized(jobs.files(folder)), [{"name": "X_A1_v1.wav", "size": 3}])
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
        info = jobs.inspect(self.root / "00_INBOX" / "p.zip")
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
            jobs.merge(self.root, "r.zip", "j", [{"from": "X_labels_A_v1.pdf", "to": "X_labels_A_v1.pdf"}], {}, digest, "j")
        jobs.merge(self.root, "r.zip", "j", [{"from": "X_labels_A_v1.pdf", "to": "X_labels_A_v2.pdf"}],
                   {"merged": True}, digest, "j")
        self.assertEqual((folder / "X_labels_A_v1.pdf").read_bytes(), b"old")
        self.assertEqual((folder / "X_labels_A_v2.pdf").read_bytes(), b"new")
        self.assertEqual((folder / "order_summary.txt").read_text(), "new")
        self.assertEqual(self.project(folder), {"merged": True})
        self.assertFalse((self.root / "00_INBOX" / "r.zip").exists())

    def test_merge_on_a_stale_project_writes_nothing(self):
        folder = self.job("20_DONE", "j")
        self.inbox_zip("r.zip", [("project.json", b"{}"), ("a.pdf", b"new")])
        with self.assertRaises(Conflict):
            jobs.merge(self.root, "r.zip", "j", [{"from": "a.pdf", "to": "a_v2.pdf"}], {}, "stale", "j")
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


class FolderTest(Tree):
    """Unpacked project folders in the inbox (copied in, synced, uploaded)."""

    def received(self, *parts, project=b'{"catalogue": "X"}'):
        folder = self.root / "00_INBOX" / Path(*parts)
        folder.mkdir(parents=True)
        (folder / "project.json").write_bytes(project)
        (folder / "X_labels_A_v1.pdf").write_bytes(b"abc")
        (folder / ".DS_Store").write_bytes(b"1")
        return folder

    def test_a_received_folder_is_an_inbox_item_not_a_job(self):
        self.received("p")
        self.received("Download", "q")
        self.job("00_INBOX", "taken", {"plant": {"stage": "00_INBOX"}})
        board = jobs.board(self.root)
        self.assertEqual(board["inbox"], ["Download", "p"])
        self.assertEqual([j["job"] for j in board["stages"][0]["jobs"]], ["taken"])
        self.assertNotIn("plant", self.project(self.root / "00_INBOX" / "p"))  # not reconciled
        info = jobs.inspect(self.root / "00_INBOX" / "Download")
        self.assertEqual((info["job"], [f["name"] for f in info["files"]]), ("q", ["X_labels_A_v1.pdf"]))

    def test_accept_takes_a_folder_in_place(self):
        self.received("p")
        self.assertEqual(jobs.accept(self.root, "p"), "p")
        self.assertEqual(jobs.board(self.root)["inbox"], [])
        project = self.project(self.root / "00_INBOX" / "p")
        self.assertEqual(project["history"][0]["note"], "received p")
        self.assertEqual(project["plant"]["received"], {"X_labels_A_v1.pdf":
                         "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"})

    def test_stamp_changes_on_any_save(self):
        folder = self.received("p")
        before = jobs.stamp(folder)
        self.assertEqual(jobs.stamp(folder), before)
        (folder / "X_labels_A_v1.pdf").write_bytes(b"fixed")
        self.assertNotEqual(jobs.stamp(folder), before)
        after = jobs.stamp(folder)
        (folder / ".DS_Store").write_bytes(b"22")
        self.assertEqual(jobs.stamp(folder), after)

    def test_accept_takes_a_folder_out_of_its_wrapper(self):
        self.received("Download", "q")
        self.received("r", "r")  # wrapper with the job's own name
        self.assertEqual(jobs.accept(self.root, "Download"), "q")
        self.assertEqual(jobs.accept(self.root, "r"), "r")
        self.assertFalse((self.root / "00_INBOX" / "Download").exists())
        self.assertTrue((self.root / "00_INBOX" / "r" / "project.json").is_file())
        self.assertFalse((self.root / "00_INBOX" / "r" / "r").exists())

    def test_accept_refuses_a_folder_named_like_a_job(self):
        self.job("20_DONE", "p")
        self.received("p")
        with self.assertRaises(Conflict):
            jobs.accept(self.root, "p")

    def test_merge_from_a_folder_removes_it(self):
        folder = self.job("20_DONE", "j")
        self.received("resend", "j")
        jobs.merge(self.root, "resend", "j", [{"from": "X_labels_A_v1.pdf", "to": "X_labels_A_v1.pdf"}],
                   {"merged": True}, jobs.read_project(folder)[1], "j")
        self.assertEqual((folder / "X_labels_A_v1.pdf").read_bytes(), b"abc")
        self.assertFalse((self.root / "00_INBOX" / "resend").exists())

    def test_uploaded_folder_appears_when_done(self):
        jobs.upload_file(self.root, "p", "project.json", io.BytesIO(b"{}"), 2)
        jobs.upload_file(self.root, "p", "sub/a.pdf", io.BytesIO(b"abc"), 3)  # kept, though not a job file
        self.assertEqual(jobs.inbox(self.root), [])
        jobs.upload_done(self.root, "p")
        self.assertEqual(jobs.inbox(self.root), ["p"])
        self.assertTrue((self.root / "00_INBOX" / "p" / "sub" / "a.pdf").is_file())
        for bad in ("../x", "a/../../x", ".hidden"):
            with self.subTest(bad), self.assertRaises(JobError):
                jobs.upload_file(self.root, "q", bad, io.BytesIO(b""), 0)
        jobs.upload_file(self.root, "p", "project.json", io.BytesIO(b"{}"), 2)
        with self.assertRaises(Conflict):
            jobs.upload_done(self.root, "p")


if __name__ == "__main__":
    unittest.main()


class StampTest(Tree):
    """Job names end in a local-time stamp; the rest is the job's key."""

    def test_key_and_stamp(self):
        self.assertEqual(jobs.job_key("PNKRCK007_band_loud_261001-1432"), "PNKRCK007_band_loud")
        self.assertEqual(jobs.job_key("260925_X_a"), "260925_X_a")

    def test_find_resolves_an_older_stamp(self):
        folder = self.job("20_DONE", "X_band_261002-0910")
        self.assertEqual(jobs.find(self.root, "X_band_261001-1432"), ("20_DONE", folder))
        self.job("10_ORDERS/20_PRESS", "X_band_261003-1200")
        with self.assertRaises(JobError):
            jobs.find(self.root, "X_band_261001-1432")

    def test_rename_takes_the_page_s_name_old_format_included(self):
        self.job("20_DONE", "260925_X_a")
        self.assertEqual(jobs.rename(self.root, "260925_X_a", "X_band_loud_261002-0905"), "X_band_loud_261002-0905")
        self.assertTrue((self.root / "20_DONE" / "X_band_loud_261002-0905" / "project.json").is_file())
        self.assertEqual(jobs.rename(self.root, "X_band_loud_261002-0905", "X_band_loud_261002-0905"), "X_band_loud_261002-0905")
        self.job("20_DONE", "Y_other_261001-1000")
        with self.assertRaises(Conflict):
            jobs.rename(self.root, "X_band_loud_261002-0905", "Y_other_261003-1100")
        with self.assertRaises(JobError):
            jobs.rename(self.root, "X_band_loud_261002-0905", "../x")

    def test_accept_keeps_the_stamp_and_refuses_a_same_key_job(self):
        make_zip(self.root / "00_INBOX" / "a.zip", [("X_band_261001-1432/project.json", b"{}")])
        self.assertEqual(jobs.accept(self.root, "a.zip"), "X_band_261001-1432")
        make_zip(self.root / "00_INBOX" / "b.zip", [("X_band_261002-0910/project.json", b"{}")])
        with self.assertRaises(Conflict):
            jobs.accept(self.root, "b.zip")

    def test_merge_renames_to_the_given_name(self):
        folder = self.job("10_ORDERS/10_PREPRESS", "X_band_261001-1432")
        make_zip(self.root / "00_INBOX" / "r.zip", [("X_band_261002-0910/project.json", b"{}")])
        new = jobs.merge(self.root, "r.zip", "X_band_261001-1432", [], {"m": 1}, jobs.read_project(folder)[1],
                         "X_band_261002-0910")
        self.assertEqual(new, "X_band_261002-0910")
        self.assertEqual(self.project(self.root / "10_ORDERS/10_PREPRESS" / new), {"m": 1})

    def test_jobs_sort_by_catalogue_number_naturally(self):
        for name in ["PNKRCK10_a_261001-1432", "PNKRCK7_a_261001-1432", "PNKRCK007_b_261001-1432"]:
            self.job("20_DONE", name)
        self.assertEqual(jobs.jobs_in(self.root, "20_DONE"),
                         ["PNKRCK7_a_261001-1432", "PNKRCK007_b_261001-1432", "PNKRCK10_a_261001-1432"])


class TrashTest(unittest.TestCase):
    def test_moves_into_the_job_trash_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "X_labels_A_v2.pdf").write_bytes(b"one")
            self.assertEqual(jobs.trash(folder, "X_labels_A_v2.pdf"), "X_labels_A_v2.pdf")
            (folder / "X_labels_A_v2.pdf").write_bytes(b"two")
            self.assertEqual(jobs.trash(folder, "X_labels_A_v2.pdf"), "X_labels_A_v2_1.pdf")
            self.assertEqual((folder / ".trash" / "X_labels_A_v2.pdf").read_bytes(), b"one")
            for bad in ("project.json", ".checks", "../x", "missing.pdf"):
                with self.assertRaises(jobs.JobError):
                    jobs.trash(folder, bad)
