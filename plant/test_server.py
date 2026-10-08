import http.client
import io
import json
import subprocess
import tempfile
import threading
import unittest
import zipfile
from http.server import ThreadingHTTPServer
from unittest import mock
from pathlib import Path

import jobs
import server
import vies
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
        self.assertEqual(self.post("/api/accept", {"item": "p x.zip"}), (200, {"job": "p"}))
        status, job = self.get("/api/job?job=p")
        self.assertNotIn("10_ORDERS", job["stages"])
        self.assertEqual((job["stage"], [f["name"] for f in job["files"]]), ("00_INBOX", ["A1.wav"]))
        self.assertEqual(self.get("/api/job/stamp?job=p")[1], {"stamp": job["stamp"], "spectrum": None})
        self.assertEqual(self.post("/api/move", {"job": "p", "to": "20_DONE"}), (200, {"job": "p"}))
        board = self.get("/api/board")[1]
        done = next(c for c in board["stages"] if c["stage"] == "20_DONE")
        self.assertEqual(done["jobs"][0]["job"], "p")
        self.assertEqual(board["inbox"], [])

    def staff_files(self, tmp):
        tmp = Path(tmp)
        (tmp / "pricelist.example.json").write_text('{"version": 1}')
        (tmp / "plant.config.local.example.js").write_text("export const PLANT_CONFIG = {};\n")
        return mock.patch.object(server, "STAFF_FILES", {
            "pricelist": (tmp / "pricelist.json", tmp / "pricelist.example.json"),
            "plant-config": (tmp / "plant.config.local.js", tmp / "plant.config.local.example.js")})

    def test_staff_file_read_write_and_conflict(self):
        with tempfile.TemporaryDirectory() as tmp, self.staff_files(tmp):
            self.assertEqual(self.get("/api/staff-file?name=pricelist"),
                             (200, {"text": '{"version": 1}', "hash": "", "exists": False}))
            body = {"name": "pricelist", "text": '{"a": 1}', "basedOn": ""}
            status, saved = self.post("/api/staff-file", body)
            self.assertEqual(status, 200)
            self.assertEqual((Path(tmp) / "pricelist.json").read_text(), '{"a": 1}')
            # A second page still holding the example is stale now.
            self.assertEqual(self.post("/api/staff-file", body)[0], 409)
            self.assertEqual(self.get("/api/staff-file?name=pricelist"),
                             (200, {"text": '{"a": 1}', "hash": saved["hash"], "exists": True}))
            self.assertEqual(self.post("/api/staff-file", {**body, "text": '{"a": 2}', "basedOn": saved["hash"]})[0], 200)
            self.assertEqual(self.post("/api/staff-file", {**body, "text": '{"a": 3}', "basedOn": saved["hash"]})[0], 409)
            self.assertEqual((Path(tmp) / "pricelist.json").read_text(), '{"a": 2}')

    def test_other_host_names_are_refused(self):
        # DNS rebinding: a page on another name that resolves to 127.0.0.1 is
        # same-origin for the browser, so the JSON-only guard doesn't stop it.
        for method, path in (("GET", "/api/board"), ("POST", "/api/staff-file")):
            for host in ("evil.example", "evil.example:8765", ""):
                conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=30)
                conn.putrequest(method, path, skip_host=True)
                if host:
                    conn.putheader("Host", host)
                conn.putheader("Content-Type", "application/json")
                conn.putheader("Content-Length", "2")
                conn.endheaders(b"{}")
                self.assertEqual(conn.getresponse().status, 403, (method, host))
        self.assertEqual(self.get("/api/board")[0], 200)
        self.assertEqual(self.request("GET", "/api/board", headers={"Host": "localhost:8765"})[0], 200)

    def test_staff_file_refuses_what_is_not_the_file(self):
        with tempfile.TemporaryDirectory() as tmp, self.staff_files(tmp):
            self.assertEqual(self.get("/api/staff-file?name=jobs")[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "../x", "text": "{}", "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "pricelist", "text": "[1]", "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "pricelist", "text": 5, "basedOn": ""})[0], 400)
            self.assertEqual(self.post("/api/staff-file", {"name": "plant-config", "text": "x = 1", "basedOn": ""})[0], 400)
            self.assertEqual(self.request("POST", "/api/staff-file", b"{}")[0], 415)
            self.assertFalse((Path(tmp) / "pricelist.json").exists())
            self.assertFalse((Path(tmp) / "plant.config.local.js").exists())

    def test_board_lists_the_archive(self):
        self.assertEqual(self.get("/api/board")[1]["archive"], [])
        (self.root / "99_ARCHIVE" / "j.zip").write_bytes(b"zip")
        self.assertEqual([e["name"] for e in self.get("/api/board")[1]["archive"]], ["j.zip"])

    def test_order_page_is_the_customer_page_with_the_staff_script(self):
        folder = self.root / "10_ORDERS" / "10_PREPRESS" / "j"
        folder.mkdir(parents=True)
        (folder / "project.json").write_text('{"catalogue": "X"}')
        status, data = self.request("GET", "/order/j")
        self.assertEqual(status, 200)
        html = data.decode()
        self.assertIn("Record Orderbook", html)
        self.assertIn('<script type="module" src="/src/app.js"></script>', html)
        self.assertIn('<script type="module" src="/src/staff.js"></script>', html)
        self.assertIn('<link rel="stylesheet" href="/src/staff.css">', html)
        self.assertNotIn('src="app.js"', html)
        self.assertEqual(self.request("GET", "/order/nope")[0], 404)
        self.assertEqual(self.request("GET", "/order/..%2Fx")[0], 404)

    def test_quote_is_written_beside_the_project_and_read_back(self):
        folder = self.root / "10_ORDERS" / "10_PREPRESS" / "j"
        folder.mkdir(parents=True)
        (folder / "project.json").write_text('{"catalogue": "X"}')
        job = self.get("/api/job?job=j")[1]
        self.assertEqual((job["quote"], job["quoteHash"]), (None, ""))
        quote = {"net": 810, "vat": {"case": "domestic"}}
        status, saved = self.post("/api/quote", {"job": "j", "quote": quote, "basedOn": ""})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads((folder / "price_quote.json").read_text()), quote)
        job = self.get("/api/job?job=j")[1]
        self.assertEqual((job["quote"], job["quoteHash"]), (quote, saved["hash"]))
        # The file is in the job's listing, so the board moves the card to the quotes.
        card = next(c for s in self.get("/api/board")[1]["stages"] for c in s["jobs"] if c["job"] == "j")
        self.assertIn("price_quote.json", [f["name"] for f in card["files"]])
        # A second page still holding no quote is stale now.
        self.assertEqual(self.post("/api/quote", {"job": "j", "quote": quote, "basedOn": ""})[0], 409)
        newer = {**quote, "net": 900}
        self.assertEqual(self.post("/api/quote", {"job": "j", "quote": newer, "basedOn": saved["hash"]})[0], 200)
        self.assertEqual(self.get("/api/job?job=j")[1]["quote"], newer)

    def test_quote_refuses_what_is_not_a_quote_or_a_job(self):
        folder = self.root / "10_ORDERS" / "10_PREPRESS" / "j"
        folder.mkdir(parents=True)
        (folder / "project.json").write_text('{"catalogue": "X"}')
        for quote in ([1], "text", None, {}):
            self.assertEqual(self.post("/api/quote", {"job": "j", "quote": quote, "basedOn": ""})[0], 400, quote)
        self.assertEqual(self.post("/api/quote", {"job": "nope", "quote": {"net": 1}, "basedOn": ""})[0], 400)
        self.assertFalse((folder / "price_quote.json").exists())

    def test_a_broken_quote_file_is_no_quote_but_can_be_replaced(self):
        folder = self.root / "10_ORDERS" / "10_PREPRESS" / "j"
        folder.mkdir(parents=True)
        (folder / "project.json").write_text('{"catalogue": "X"}')
        (folder / "price_quote.json").write_text("{")
        job = self.get("/api/job?job=j")[1]
        self.assertIsNone(job["quote"])
        self.assertNotEqual(job["quoteHash"], "")
        self.assertEqual(self.post("/api/quote", {"job": "j", "quote": {"net": 1}, "basedOn": job["quoteHash"]})[0], 200)

    def test_vat_check_asks_vies_through_the_server(self):
        with mock.patch.object(vies, "fetch", lambda country, number: {"isValid": True, "name": "Acme"}):
            status, result = self.post("/api/vat-check", {"vatId": "de 123456789"})
        self.assertEqual((status, result["status"], result["id"], result["name"]), (200, "valid", "DE123456789", "Acme"))
        self.assertEqual(self.post("/api/vat-check", {"vatId": "US123"})[1]["status"], "invalid")
        self.assertEqual(self.post("/api/vat-check", {"vatId": ""})[1]["status"], "none")
        self.assertEqual(self.post("/api/vat-check", {})[0], 400)

    def test_inbox_lists_jobs_with_the_same_catalogue(self):
        folder = self.root / "20_DONE" / "old"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        (folder / "a.pdf").write_bytes(b"abc")
        self.upload("r.zip", [("project.json", b'{"catalogue": "X"}')])
        status, info = self.get("/api/inbox?item=r.zip")
        self.assertEqual(status, 200)
        self.assertEqual([(m["job"], m["stage"]) for m in info["matches"]], [("old", "20_DONE")])
        self.assertEqual(info["matches"][0]["files"][0]["sha256"][:6], "ba7816")

    def test_refusals_are_plain_text(self):
        self.assertEqual(self.get("/api/job?job=nope"), (400, "no job nope"))
        self.assertEqual(self.get("/api/job?job=../x")[0], 400)
        self.assertEqual(self.post("/api/move", {"job": "nope"})[0], 400)
        self.assertEqual(self.post("/api/spectrum", {"job": "nope"}), (400, "no job nope"))
        status, text = self.request("POST", "/api/move", b"{nope", JSON)
        self.assertEqual((status, text.decode()), (400, "request is not valid JSON"))
        status, text = self.request("POST", "/api/upload", b"", {"X-Filename": "x.zip", "Content-Length": "abc"})
        self.assertEqual(status, 400)

    def test_posts_from_other_websites_are_refused(self):
        for kind in ("", "text/plain", "application/x-www-form-urlencoded"):
            status, text = self.request("POST", "/api/move", b'{"job": "p", "to": "20_DONE"}', {"Content-Type": kind})
            self.assertEqual((status, text.decode()), (415, "JSON requests only"))
        self.assertEqual(self.request("OPTIONS", "/api/move")[0], 501)

    def test_spectrum_starts_in_the_background(self):
        self.upload("p.zip", [("p/project.json", b"{}")])
        self.post("/api/accept", {"item": "p.zip"})
        self.assertEqual(self.post("/api/spectrum", {"job": "p"}), (200, {}))

    def test_download_zip_leaves_out_the_plant_state(self):
        self.upload("p.zip", [("p/project.json", b'{"catalogue": "X"}'), ("p/a.pdf", b"1")])
        self.post("/api/accept", {"item": "p.zip"})
        status, data = self.request("GET", "/api/zip?job=p")
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            self.assertEqual(sorted(zf.namelist()), ["p/a.pdf", "p/project.json"])
            project = json.loads(zf.read("p/project.json"))
        self.assertNotIn("plant", project)
        self.assertEqual(project["history"][0]["note"], "received p.zip")

    def test_folder_upload_then_accept(self):
        for path, data in (("project.json", b"{}"), ("A%201.wav", b"12")):
            self.assertEqual(self.request("POST", "/api/upload/file", data, {"X-Folder": "f", "X-Path": path})[0], 200)
        self.assertEqual(self.post("/api/upload/done", {"folder": "f"}), (200, {"item": "f"}))
        self.assertEqual(self.post("/api/accept", {"item": "f"}), (200, {"job": "f"}))
        self.assertEqual([(f["name"], f["size"]) for f in self.get("/api/job?job=f")[1]["files"]], [("A 1.wav", 2)])

    def test_artwork_check_body_must_be_a_json_object(self):
        self.upload("p.zip", [("p/project.json", b"{}")])
        self.post("/api/accept", {"item": "p.zip"})
        for body in (b"{nope", b"[]", b'{"job": "p", "artwork": []}'):
            self.assertEqual(self.request("POST", "/api/check/artwork", body, JSON)[0], 400)
        status, data = self.request("POST", "/api/check/artwork", b'{"job": "p"}', JSON)
        self.assertEqual((status, [json.loads(line) for line in data.decode().splitlines()]), (200, [{"result": {}}]))

    def test_audio_check_takes_only_the_files_asked_for(self):
        self.upload("p.zip", [("p/project.json", b"{}"), ("p/reference.wav", b"not audio")])
        self.post("/api/accept", {"item": "p.zip"})
        status, data = self.request("POST", "/api/check/audio", b'{"job": "p", "files": []}', JSON)
        self.assertEqual([json.loads(line) for line in data.decode().splitlines()], [{"result": {"files": {}}}])
        status, data = self.request("POST", "/api/check/audio", b'{"job": "p", "files": ["../x"]}', JSON)
        self.assertEqual(status, 400)

    def test_audio_check_of_a_job_without_audio_sends_only_the_result(self):
        self.upload("p.zip", [("p/project.json", b"{}"), ("p/cover.pdf", b"%PDF")])
        self.post("/api/accept", {"item": "p.zip"})
        status, data = self.request("POST", "/api/check/audio", b'{"job": "p"}', JSON)
        # every line before the result names its step: the page shows it
        self.assertEqual([json.loads(line) for line in data.decode().splitlines()], [{"result": {"files": {}}}])

    def test_audio_check_streams_progress_then_the_result(self):
        wav = self.root / "A1.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=d=20", "-c:a", "pcm_s24le",
                        str(wav)], check=True)
        self.upload("p.zip", [("p/project.json", b"{}"), ("p/A1.wav", wav.read_bytes())])
        self.post("/api/accept", {"item": "p.zip"})
        status, data = self.request("POST", "/api/check/audio", b'{"job": "p"}', JSON)
        self.assertEqual(status, 200)
        lines = [json.loads(line) for line in data.decode().splitlines()]
        progress = [line["progress"] for line in lines[:-1]]
        self.assertEqual(progress, sorted(progress))
        self.assertEqual(progress[-1], 100)
        self.assertEqual({line["step"] for line in lines[:-1]}, {"checking audio", "creating waveform"})
        self.assertTrue(all(line["file"] == "A1.wav" and line["count"] == 1 for line in lines[:-1]))
        facts = lines[-1]["result"]["files"]["A1.wav"]
        checks = self.root / "00_INBOX" / "p" / ".checks"
        self.assertEqual(static_target(f"/jobs/p/{facts['preview']}"), checks / facts["preview"])
        self.assertTrue((checks / facts["waveform"]).is_file())

    def test_assign_and_merge_answer_with_the_renewed_name(self):
        folder = self.root / "20_DONE" / "X_band_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        (folder / "fix.pdf").write_bytes(b"%PDF")
        digest = self.get("/api/job?job=X_band_261001-1432")[1]["projectHash"]
        status, reply = self.post("/api/assign", {"job": "X_band_261001-1432", "file": "fix.pdf",
                                                  "newName": "X_labels_A_v2.pdf", "project": {"catalogue": "X"}, "basedOn": digest,
                                                  "name": "X_band_261002-0905"})
        self.assertEqual((status, reply["job"]), (200, "X_band_261002-0905"))
        self.assertTrue((self.root / "20_DONE" / reply["job"] / "X_labels_A_v2.pdf").is_file())
        self.upload("r.zip", [("X_band_261003-1000/project.json", b'{"catalogue": "X"}')])
        digest = self.get(f"/api/job?job={reply['job']}")[1]["projectHash"]
        status, merged = self.post("/api/merge", {"item": "r.zip", "job": "X_band_261001-1432", "copies": [],
                                                  "project": {"catalogue": "X"}, "basedOn": digest, "name": "X_band_261003-1200"})
        self.assertEqual((status, merged["job"]), (200, "X_band_261003-1200"))
        self.assertEqual(self.post("/api/move", {"job": "X_band_261001-1432", "to": "10_ORDERS/20_PRESS"})[0], 200)
        self.assertTrue((self.root / "10_ORDERS/20_PRESS" / merged["job"]).is_dir())

    def test_profiles_start_downloads_and_answer_at_once(self):
        self.assertEqual(self.post("/api/profiles", {"profiles": {}}), (200, {}))
        self.assertEqual(self.post("/api/profiles", {"profiles": []})[0], 400)

    def fix_job(self):
        import pymupdf
        folder = self.root / "20_DONE" / "X_band_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        doc = pymupdf.open()
        page = doc.new_page(width=96 * 72 / 25.4, height=96 * 72 / 25.4)
        page.draw_rect(page.rect, color=None, fill=(0.6, 0.4, 0.4, 0))
        doc.save(folder / "X_labels_A_v1.pdf")
        params = {"page": 1, "targetMm": {"w": 98, "h": 98}, "trimMm": {"w": 92, "h": 92}, "round": True, "fixDpi": 100,
                  "toleranceMm": 0.5, "inkLimitPct": 220, "black": {"kMinPct": 85, "neutralTolPct": 10},
                  "profile": {"name": "ISO", "conditionId": "FOGRA39", "url": "https://127.0.0.1:9/x.icc", "file": "nope_test.icc"}}
        return folder, {"job": "X_band_261001-1432", "file": "X_labels_A_v1.pdf", "newName": "X_labels_A_v2.pdf",
                        "step": "size", "params": params}

    def test_fix_writes_the_next_version_once(self):
        folder, body = self.fix_job()
        body["fix"] = {"kind": "geometry", "candidate": {"scale": 1, "keep": "file", "fill": "mirror"}, "detail": "1:1"}
        self.assertEqual(self.post("/api/fix", body), (200, {"name": "X_labels_A_v2.pdf", "detail": "1:1"}))
        self.assertEqual((folder / "X_labels_A_v2.pdf").read_bytes()[:8], b"%PDF-1.3")
        self.assertEqual(self.post("/api/fix", body)[0], 409)
        self.assertEqual(self.post("/api/fix", {**body, "newName": "../x.pdf"})[0], 400)
        self.assertEqual(self.post("/api/fix", {**body, "newName": "X_labels_A_v3.pdf", "fix": {"kind": "magic"}})[0], 400)

    def test_fix_without_its_profile_is_refused(self):
        folder, body = self.fix_job()
        status, text = self.post("/api/fix", {**body, "step": "colour", "fix": {"kind": "assign", "detail": "x"}})
        self.assertEqual(status, 503, "unavailable for now, not a refusal of the file")
        self.assertIn("print profile", text)
        self.assertFalse((folder / "X_labels_A_v2.pdf").exists())

    def test_proof_once_and_only_of_a_finished_file(self):
        folder, body = self.fix_job()
        proof = {"job": body["job"], "file": body["file"], "newName": "X_proof_labels_A_v1.pdf",
                 "params": {**body["params"], "holeMm": 7.4}}
        status, text = self.post("/api/proof", proof)
        self.assertEqual(status, 400, "no OutputIntent: not through the fix flow")
        self.assertIn("finish the fix flow", text)
        (folder / "X_proof_labels_A_v1.pdf").write_bytes(b"made before")
        self.assertEqual(self.post("/api/proof", proof)[0], 409)

    def test_trash_saves_the_log_then_moves(self):
        folder, body = self.fix_job()
        (folder / "X_labels_A_v2.pdf").write_bytes(b"x")
        digest = self.get("/api/job?job=X_band_261001-1432")[1]["projectHash"]
        req = {"job": body["job"], "files": ["X_labels_A_v2.pdf"], "project": {"catalogue": "X", "plant": {"fixes": []}}, "basedOn": digest}
        status, reply = self.post("/api/trash", req)
        self.assertEqual(status, 200)
        self.assertTrue((folder / ".trash" / "X_labels_A_v2.pdf").is_file())
        self.assertEqual(self.post("/api/trash", req)[0], 400, "file already gone: refused before the save")
        (folder / "X_labels_A_v2.pdf").write_bytes(b"y")
        self.assertEqual(self.post("/api/trash", req)[0], 409, "project.json changed meanwhile")
        self.assertTrue((folder / "X_labels_A_v2.pdf").is_file(), "a refusal moves nothing")
        self.assertEqual(self.post("/api/trash", {**req, "basedOn": reply["projectHash"]})[0], 200)
        self.assertTrue((folder / ".trash" / "X_labels_A_v2_1.pdf").is_file())
        self.assertEqual(json.loads((folder / "project.json").read_text())["plant"], {"fixes": []})

    def test_project_save_is_safe(self):
        folder = self.root / "20_DONE" / "X_a_261001-1432"
        folder.mkdir()
        (folder / "project.json").write_text('{"catalogue": "X"}')
        digest = self.get("/api/job?job=X_a_261001-1432")[1]["projectHash"]
        body = {"job": "X_a_261001-1432", "project": {"catalogue": "X", "plant": {"lines": {"labels": [{"step": "approve"}]}}}, "basedOn": digest}
        status, reply = self.post("/api/project", body)
        self.assertEqual(status, 200)
        self.assertIn("projectHash", reply)
        self.assertEqual(self.post("/api/project", body)[0], 409)
        self.assertEqual(self.post("/api/project", {**body, "project": [], "basedOn": reply["projectHash"]})[0], 400)


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
                folder = Path(tmp) / "20_DONE" / "p"
                (folder / ".checks").mkdir(parents=True)
                (folder / "project.json").write_text("{}")
                (folder / "a.pdf").write_bytes(b"1")
                (folder / ".checks" / "a.png").write_bytes(b"1")
                self.assertEqual(static_target("/jobs/p/a.png"), folder / ".checks" / "a.png")
                (folder / "spectrum").mkdir()
                (folder / "spectrum" / "A1.wav.png").write_bytes(b"1")
                self.assertEqual(static_target("/jobs/p/spectrum/A1.wav.png"), folder / "spectrum" / "A1.wav.png")
                self.assertEqual(static_target("/jobs/p/files/a.pdf"), folder / "a.pdf")
                self.assertIsNone(static_target("/jobs/p/files/.checks"))
                self.assertIsNone(static_target("/jobs/p/files/nope.pdf"))
                self.assertIsNone(static_target("/jobs/p/other/A1.wav.png"))
                self.assertIsNone(static_target("/jobs/p/spectrum/..%2Fa.pdf"))
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
