import http.client
import io
import json
import subprocess
import stat
import tempfile
import threading
import unittest
import warnings
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

import server
from server import Handler, OpenError, ROOT, missing, static_target, unpack, zip_stem


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

    def test_removes_stale_check_output(self):
        stale = self.dest.with_name("p.checks")
        stale.mkdir(parents=True)
        unpack(make_zip([("project.json", b"{}")]), self.dest)
        self.assertFalse(stale.exists())

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


    def test_corrupt_member_is_an_open_error(self):
        z = make_zip([("project.json", b"{}"), ("A1.wav", b"x" * 100)])
        data = bytearray(z.getvalue())
        data[data.index(b"x" * 100)] = ord("y")  # breaks the CRC of A1.wav
        with self.assertRaisesRegex(OpenError, "corrupt"):
            unpack(io.BytesIO(bytes(data)), self.dest)

    def test_concurrent_opens_of_the_same_name_all_succeed(self):
        errors = []

        def run():
            try:
                files = unpack(make_zip([("p/project.json", b"{}"), ("p/A1.wav", b"1" * 50000)]), self.dest)[1]
                self.assertEqual(files, [{"name": "A1.wav", "size": 50000}])
            except Exception as error:  # collected, asserted below
                errors.append(error)

        threads = [threading.Thread(target=run) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, headers, body=b"", path="/api/open"):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=30)
        conn.putrequest("POST", path)
        for key, value in headers.items():
            conn.putheader(key, value)
        conn.endheaders(body)
        res = conn.getresponse()
        return res.status, res.read().decode()

    def test_bad_content_length_gets_a_reply(self):
        status, text = self.post({"X-Filename": "x.zip", "Content-Length": "abc"})
        self.assertEqual(status, 400)
        self.assertIn("Content-Length", text)

    def test_overlong_name_gets_a_reply(self):
        body = make_zip([("project.json", b"{}")]).getvalue()
        status, text = self.post({"X-Filename": "a" * 300 + ".zip", "Content-Length": str(len(body))}, body)
        self.assertEqual(status, 500)
        self.assertTrue(text)

    def test_check_body_must_be_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved, server.WORK = server.WORK, Path(tmp)
            try:
                body = make_zip([("p/project.json", b"{}")]).getvalue()
                self.post({"X-Filename": "p.zip", "Content-Length": str(len(body))}, body)
                status, text = self.post({"X-Filename": "p.zip", "Content-Length": "5"}, b"{nope", path="/api/check")
                self.assertEqual((status, text), (400, "check request is not valid JSON"))
                status, _ = self.post({"X-Filename": "p.zip", "Content-Length": "0"}, path="/api/check")
                self.assertEqual(status, 200)
            finally:
                server.WORK = saved

    def test_check_before_open_is_refused(self):
        status, text = self.post({"X-Filename": "never-opened-xyz.zip"}, path="/api/check")
        self.assertEqual((status, text), (400, "project not open"))

    def test_open_then_check_serves_previews(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved, server.WORK = server.WORK, Path(tmp)
            try:
                wav = Path(tmp) / "A1.wav"
                subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=d=1", "-c:a", "pcm_s16le",
                                str(wav)], check=True)
                body = make_zip([("p/project.json", b"{}"), ("p/A1.wav", wav.read_bytes())]).getvalue()
                self.assertEqual(self.post({"X-Filename": "p.zip", "Content-Length": str(len(body))}, body)[0], 200)
                status, text = self.post({"X-Filename": "p.zip"}, path="/api/check")
                self.assertEqual(status, 200)
                facts = json.loads(text)["files"]["A1.wav"]
                self.assertEqual(static_target(f"/work/p.checks/{facts['preview']}"),
                                 (Path(tmp) / "p.checks" / facts["preview"]).resolve())
            finally:
                server.WORK = saved


class StartupTest(unittest.TestCase):
    def test_reports_missing_and_too_old_tools(self):
        libs = {"pymupdf": "1.28.2", "pillow": "11.3.0", "numpy": None}
        tools = {"ffmpeg": "6.1.1", "ffprobe": "N-118000-g1234"}  # git build: no version to compare
        self.assertEqual(missing(libs.get, tools.get), [
            "pillow >= 12.0 needed (found 11.3.0)",
            "numpy >= 2.5 needed (not installed)",
            "ffmpeg >= 9.0 needed (found 6.1.1)",
        ])

    def test_all_present(self):
        self.assertEqual(missing(lambda name: "99.0", lambda name: "99.0"), [])

    def test_installed_environment_passes(self):
        self.assertEqual(missing(), [])


class HelpersTest(unittest.TestCase):
    def test_static_target_stays_inside_src(self):
        self.assertEqual(static_target("/"), ROOT / "src" / "plant" / "index.html")
        self.assertEqual(static_target("/src/config.js?x=1"), ROOT / "src" / "config.js")
        self.assertIsNone(static_target("/src/../plant/server.py"))
        self.assertIsNone(static_target("/src/%2e%2e/plant/server.py"))
        self.assertIsNone(static_target("/plant/server.py"))
        self.assertIsNone(static_target("/src/nope.js"))

    def test_static_target_serves_only_check_output_from_work(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved, server.WORK = server.WORK, Path(tmp)
            try:
                for folder in ("p.checks", "p/p"):
                    (Path(tmp) / folder).mkdir(parents=True)
                    (Path(tmp) / folder / "a.mp3").write_bytes(b"1")
                self.assertEqual(static_target("/work/p.checks/a.mp3"), (Path(tmp) / "p.checks" / "a.mp3").resolve())
                self.assertIsNone(static_target("/work/p/p/a.mp3"))
                self.assertIsNone(static_target("/work/p.checks/../p/p/a.mp3"))
                self.assertIsNone(static_target("/work/p.checks/nope.mp3"))
            finally:
                server.WORK = saved

    def test_zip_stem_decodes_and_strips_folders(self):
        self.assertEqual(zip_stem("260924_X_a%40b%C3%B6.de.zip"), "260924_X_a@bö.de")
        self.assertEqual(zip_stem("..%2F..%2Fevil.zip"), "evil")
        with self.assertRaises(OpenError):
            zip_stem("..")


if __name__ == "__main__":
    unittest.main()
