import http.client
import io
import json
import subprocess
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

import jobs
import server
from jobs import JobError
from server import Handler, ROOT, missing, static_target, upload_name


JSON = {"Content-Type": "application/json"}


def make_zip(entries):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in entries:
            zf.writestr(name, data)
    buf.seek(0)
    return buf


class HttpTest(unittest.TestCase):
    """A server on a fresh jobs tree."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        jobs.ensure_stages(self.root)
        self.saved, server.JOBS = server.JOBS, self.root
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        server.JOBS = self.saved
        self.tmp.cleanup()

    def request(self, method, path, body=b"", headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=30)
        conn.putrequest(method, path)
        for key, value in {"Content-Length": str(len(body)), **(headers or {})}.items():
            conn.putheader(key, value)
        conn.endheaders(body)
        res = conn.getresponse()
        return res.status, res.read()

    def post(self, path, obj):
        status, data = self.request("POST", path, json.dumps(obj).encode(), JSON)
        return status, json.loads(data) if status == 200 else data.decode()

    def get(self, path):
        status, data = self.request("GET", path)
        return status, json.loads(data) if status == 200 else data.decode()

    def upload(self, name, entries):
        body = make_zip(entries).getvalue()
        return self.request("POST", "/api/upload", body, {"X-Filename": name})

    def test_upload_accept_move_and_board(self):
        self.assertEqual(self.upload("p%20x.zip", [("p/project.json", b'{"catalogue": "X"}'),
                                                   ("p/A1.wav", b"1")])[0], 200)
        self.assertEqual(self.upload("p%20x.zip", [("project.json", b"{}")])[0], 409)
        self.assertEqual(self.get("/api/board")[1]["inbox"], ["p x.zip"])
        self.assertEqual(self.post("/api/accept", {"zip": "p x.zip"}), (200, {"job": "p"}))
        status, job = self.get("/api/job?job=p")
        self.assertEqual((job["stage"], job["files"]), ("00_INBOX", [{"name": "A1.wav", "size": 1}]))
        self.assertEqual(self.post("/api/move", {"job": "p", "to": "20_DONE"}), (200, {"job": "p"}))
        board = self.get("/api/board")[1]
        done = next(c for c in board["stages"] if c["stage"] == "20_DONE")
        self.assertEqual(done["jobs"][0]["job"], "p")
        self.assertEqual(board["inbox"], [])

    def test_inbox_lists_jobs_with_the_same_catalogue(self):
        folder = self.root / "20_DONE" / "old"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        (folder / "a.pdf").write_bytes(b"abc")
        self.upload("r.zip", [("project.json", b'{"catalogue": "X"}')])
        status, info = self.get("/api/inbox?zip=r.zip")
        self.assertEqual(status, 200)
        self.assertEqual([(m["job"], m["stage"]) for m in info["matches"]], [("old", "20_DONE")])
        self.assertEqual(info["matches"][0]["files"][0]["sha256"][:6], "ba7816")

    def test_refusals_are_plain_text(self):
        self.assertEqual(self.get("/api/job?job=nope"), (400, "no job nope"))
        self.assertEqual(self.get("/api/job?job=../x")[0], 400)
        self.assertEqual(self.post("/api/move", {"job": "nope"})[0], 400)
        status, text = self.request("POST", "/api/move", b"{nope", JSON)
        self.assertEqual((status, text.decode()), (400, "request is not valid JSON"))
        status, text = self.request("POST", "/api/upload", b"", {"X-Filename": "x.zip", "Content-Length": "abc"})
        self.assertEqual(status, 400)

    def test_posts_from_other_websites_are_refused(self):
        for kind in ("", "text/plain", "application/x-www-form-urlencoded"):
            status, text = self.request("POST", "/api/move", b'{"job": "p", "to": "20_DONE"}', {"Content-Type": kind})
            self.assertEqual((status, text.decode()), (415, "JSON requests only"))
        self.assertEqual(self.request("OPTIONS", "/api/move")[0], 501)

    def test_download_zip(self):
        self.upload("p.zip", [("p/project.json", b"{}"), ("p/a.pdf", b"1")])
        self.post("/api/accept", {"zip": "p.zip"})
        status, data = self.request("GET", "/api/zip?job=p")
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            self.assertEqual(sorted(zf.namelist()), ["p/a.pdf", "p/project.json"])

    def test_artwork_check_body_must_be_a_json_object(self):
        self.upload("p.zip", [("p/project.json", b"{}")])
        self.post("/api/accept", {"zip": "p.zip"})
        for body in (b"{nope", b"[]", b'{"job": "p", "artwork": []}'):
            self.assertEqual(self.request("POST", "/api/check/artwork", body, JSON)[0], 400)
        self.assertEqual(self.post("/api/check/artwork", {"job": "p"}), (200, {}))

    def test_audio_check_streams_progress_then_the_result(self):
        wav = self.root / "A1.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=d=20", "-c:a", "pcm_s24le",
                        str(wav)], check=True)
        self.upload("p.zip", [("p/project.json", b"{}"), ("p/A1.wav", wav.read_bytes())])
        self.post("/api/accept", {"zip": "p.zip"})
        status, data = self.request("POST", "/api/check/audio", b'{"job": "p"}', JSON)
        self.assertEqual(status, 200)
        lines = [json.loads(line) for line in data.decode().splitlines()]
        progress = [line["progress"] for line in lines[:-1]]
        self.assertEqual(progress, sorted(progress))
        self.assertEqual(progress[-1], 100)
        facts = lines[-1]["result"]["files"]["A1.wav"]
        checks = self.root / "00_INBOX" / "p" / ".checks"
        self.assertEqual(static_target(f"/jobs/p/{facts['preview']}"), checks / facts["preview"])
        self.assertTrue((checks / facts["waveform"]).is_file())


class StartupTest(unittest.TestCase):
    def test_port_in_use_is_a_clear_exit(self):
        busy = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        try:
            with self.assertRaisesRegex(SystemExit, f"port {busy.server_port} is in use"):
                server.make_server(busy.server_port)
        finally:
            busy.server_close()

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

    def test_static_target_serves_only_check_output_of_jobs(self):
        with tempfile.TemporaryDirectory() as tmp:
            saved, server.JOBS = server.JOBS, Path(tmp)
            try:
                folder = Path(tmp) / "00_INBOX" / "p"
                (folder / ".checks").mkdir(parents=True)
                (folder / "project.json").write_text("{}")
                (folder / "a.pdf").write_bytes(b"1")
                (folder / ".checks" / "a.png").write_bytes(b"1")
                self.assertEqual(static_target("/jobs/p/a.png"), folder / ".checks" / "a.png")
                self.assertIsNone(static_target("/jobs/p/../p/a.pdf"))
                self.assertIsNone(static_target("/jobs/p/%2e%2e%2fa.pdf"))
                self.assertIsNone(static_target("/jobs/p/nope.png"))
                self.assertIsNone(static_target("/jobs/nope/a.png"))
            finally:
                server.JOBS = saved

    def test_upload_name_decodes_and_strips_folders(self):
        self.assertEqual(upload_name("260924_X_a%40b%C3%B6.de.zip"), "260924_X_a@bö.de.zip")
        self.assertEqual(upload_name("..%2F..%2Fevil.zip"), "evil.zip")
        self.assertEqual(upload_name("p"), "p.zip")
        with self.assertRaises(JobError):
            upload_name("..%2F.hidden.zip")


if __name__ == "__main__":
    unittest.main()
