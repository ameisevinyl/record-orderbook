"""Plant view server: serves src/plant/ (and the src/ modules it imports,
unbuilt) and works on the jobs tree (jobs.py): stage folders holding one
folder per job. Project zips land in 00_INBOX/ and become a new job or
merge into an existing one; the audio and artwork checks (checks.py) run
into each job's .checks/ folder.

Standard library only; binds 127.0.0.1. Refuses to start without the
tools and libraries the checks need (plant/pyproject.toml).
Run: uv run --project plant plant/server.py [--jobs <folder>]
"""
import argparse
import errno
import importlib.metadata
import json
import re
import shutil
import subprocess
import sys
import tomllib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, quote, unquote, urlsplit

import jobs
import staff_files
from jobs import JobError, Conflict

ROOT = Path(__file__).resolve().parent.parent
PYPROJECT = ROOT / "plant" / "pyproject.toml"
SRC = ROOT / "src"
# The jobs tree; --jobs changes it.
JOBS = ROOT / "plant" / "jobs"
INDEX = SRC / "plant" / "index.html"
# The staff editors' files: name -> (the plant's own file, the committed example).
STAFF_FILES = {
    "pricelist": (SRC / "pricelist.json", SRC / "pricelist.example.json"),
    "plant-config": (SRC / "plant.config.local.js", SRC / "plant.config.local.example.js"),
}
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".png": "image/png",
    ".pdf": "application/pdf",
}
CHUNK = 1 << 20


def lib_version(name):
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def tool_version(name):
    """ffmpeg/ffprobe print "<name> version 9.0.2 …" on -version."""
    path = shutil.which(name)
    if not path:
        return None
    out = subprocess.run([path, "-version"], capture_output=True, text=True).stdout
    m = re.search(r"version\s+(\S+)", out)
    return m.group(1) if m else ""


def version_tuple(text):
    m = re.match(r"\d+(?:\.\d+)*", text)
    return tuple(int(part) for part in m.group().split(".")) if m else None


def missing(lib_version=lib_version, tool_version=tool_version):
    """What's missing or too old, per plant/pyproject.toml: its
    "name>=x.y" dependencies and the [tool.plant] command-line tools."""
    config = tomllib.loads(PYPROJECT.read_text())
    wanted = [(*re.fullmatch(r"([\w.-]+)\s*>=\s*([\d.]+)", dep).groups(), lib_version)
              for dep in config["project"]["dependencies"]]
    wanted += [(name, minimum, tool_version) for name, minimum in config["tool"]["plant"].items()]
    problems = []
    for name, minimum, version_of in wanted:
        found = version_of(name)
        if found is None:
            problems.append(f"{name} >= {minimum} needed (not installed)")
            continue
        # A version that doesn't parse (e.g. an ffmpeg git build) passes.
        have = version_tuple(found)
        if have is not None and have < version_tuple(minimum):
            problems.append(f"{name} >= {minimum} needed (found {found})")
    return problems


def static_target(url_path):
    """File under src/, check output (/jobs/<job>/<file> from the job's
    .checks/), a spectrogram (/jobs/<job>/spectrum/<file>) or a job's own
    file (/jobs/<job>/files/<file>, e.g. a proof to open), for a GET path,
    or None."""
    path = unquote(urlsplit(url_path).path)
    if path in ("/", "/index.html"):
        return INDEX
    if path.startswith("/jobs/"):
        parts = path.removeprefix("/jobs/").split("/")
        try:
            if len(parts) == 2:
                target = jobs.find(JOBS, parts[0])[1] / ".checks" / jobs.plain(parts[1])
            elif len(parts) == 3 and parts[1] == "spectrum":
                target = jobs.find(JOBS, parts[0])[1] / "spectrum" / jobs.plain(parts[2])
            elif len(parts) == 3 and parts[1] == "files":
                target = jobs.find(JOBS, parts[0])[1] / jobs.plain(parts[2])
            else:
                return None
        except JobError:
            return None
    else:
        target = (ROOT / path.lstrip("/")).resolve()
        if not target.is_relative_to(SRC):
            return None
    return target if target.is_file() else None


def upload_name(header_value):
    """Inbox file name from the X-Filename header (encodeURIComponent'd)."""
    name = PurePosixPath(unquote(header_value).replace("\\", "/")).name
    if not name.lower().endswith(".zip"):
        name += ".zip"
    return jobs.plain(name)


def files(request):
    """The file names a check request is limited to (the page's managed
    files), or None for all."""
    names = request.get("files")
    if names is None:
        return None
    if not isinstance(names, list):
        raise JobError("files must be a list")
    return [jobs.plain(name) for name in names]


class Unavailable(Exception):
    """Can't be done right now (a profile download): the page doesn't log it
    as a refusal of the file, the next load tries again."""


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type="text/plain; charset=utf-8"):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def json(self, obj):
        self.reply(200, json.dumps(obj), "application/json; charset=utf-8")

    def query(self, key):
        return parse_qs(urlsplit(self.path).query).get(key, [""])[0]

    def body(self):
        try:
            request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        except ValueError:
            raise JobError("request is not valid JSON") from None
        if not isinstance(request, dict):
            raise JobError("request is not a JSON object")
        return request

    def do_GET(self):
        route = urlsplit(self.path).path
        api = {"/api/board": self.get_board, "/api/job": self.get_job, "/api/job/stamp": self.get_stamp,
               "/api/inbox": self.get_inbox, "/api/zip": self.get_zip,
               "/api/staff-file": self.get_staff_file}.get(route)
        if api:
            return self.answer(api)
        target = static_target(self.path)
        if target is None:
            return self.reply(404, "not found")
        self.reply(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self):
        api = {"/api/upload": self.upload, "/api/upload/file": self.upload_file, "/api/upload/done": self.upload_done,
               "/api/accept": self.accept, "/api/merge": self.merge,
               "/api/move": self.move, "/api/assign": self.assign,
               "/api/check/audio": self.check_audio, "/api/check/artwork": self.check_artwork,
               "/api/spectrum": self.spectrum, "/api/profiles": self.profiles,
               "/api/fix": self.fix, "/api/proof": self.proof,
               "/api/trash": self.trash, "/api/project": self.save_project,
               "/api/staff-file": self.save_staff_file}.get(self.path)
        if api is None:
            return self.reply(404, "not found")
        # A JSON content type makes browsers ask first (CORS preflight,
        # which this server doesn't answer), so other websites can't post
        # here. Uploads need their X- headers for the same reason.
        if api not in (self.upload, self.upload_file) and self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self.reply(415, "JSON requests only")
        self.answer(api)

    def answer(self, api):
        """Runs an endpoint; refusals go to the page as plain text."""
        try:
            api()
        except Conflict as error:
            self.reply(409, str(error))
        except Unavailable as error:
            self.reply(503, str(error))
        except (JobError, KeyError, TypeError) as error:
            self.reply(400, str(error) if isinstance(error, JobError) else f"bad request: {error}")
        except OSError as error:
            # Disk full, name too long, ...: still an answer the page can show.
            self.reply(500, str(error))

    def get_board(self):
        self.json(jobs.board(JOBS))

    def get_job(self):
        stage, folder = jobs.find(JOBS, self.query("job"))
        project, digest = jobs.read_project(folder)
        self.json({"job": folder.name, "stage": stage, "stages": jobs.places(JOBS),
                   "project": project, "projectHash": digest, "files": jobs.files(folder),
                   "stamp": jobs.stamp(folder)})

    def get_stamp(self):
        """Changes when any file of the job does; also what the background
        spectrum is plotting. The open page polls it."""
        import spectrum  # needs the libraries main() verified
        folder = jobs.find(JOBS, self.query("job"))[1]
        self.json({"stamp": jobs.stamp(folder), "spectrum": spectrum.PROGRESS.get(folder)})

    def get_inbox(self):
        """A zip or folder in the inbox, and the jobs with its catalogue number."""
        item = jobs.plain(self.query("item"))
        info = jobs.inspect(JOBS / jobs.INBOX / item)
        matches = []
        for stage in jobs.stages(JOBS):
            for job in jobs.jobs_in(JOBS, stage):
                folder = JOBS / stage / job
                try:
                    project, digest = jobs.read_project(folder)
                except JobError:
                    continue
                if project.get("catalogue") and project.get("catalogue") == info["project"].get("catalogue"):
                    listing = [{**f, "sha256": jobs.sha256(folder / f["name"])} for f in jobs.files(folder)]
                    matches.append({"job": job, "stage": stage, "project": project,
                                    "projectHash": digest, "files": listing})
        self.json({"item": item, **info, "matches": matches})

    def get_zip(self):
        folder = jobs.find(JOBS, self.query("job"))[1]
        # Where the job sits is the plant's; a resend must not carry it.
        project = jobs.read_project(folder)[0]
        project.pop("plant", None)
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{quote(folder.name)}.zip")
        self.end_headers()  # no length: HTTP/1.0 ends the body by closing
        jobs.write_zip(folder, self.wfile, project)

    def upload(self):
        """The zip in the body lands in the inbox, like a synced one."""
        name = upload_name(self.headers.get("X-Filename", ""))
        try:
            remaining = int(self.headers.get("Content-Length", 0))
        except ValueError:
            raise JobError("invalid Content-Length") from None
        target = JOBS / jobs.INBOX / name
        if target.exists():
            raise Conflict(f"{name} is in the inbox already")
        tmp = target.with_name(f".{name}.part")
        # Project zips can be hundreds of MB: stream to disk, not memory.
        try:
            with open(tmp, "wb") as f:
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, CHUNK))
                    if not chunk:
                        break
                    f.write(chunk)
                    remaining -= len(chunk)
            if remaining:
                raise JobError("upload ended early")
            tmp.rename(target)
        finally:
            tmp.unlink(missing_ok=True)
        self.json({"item": name})

    def upload_file(self):
        """One file of a folder picked in the page: X-Folder, X-Path."""
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            raise JobError("invalid Content-Length") from None
        jobs.upload_file(JOBS, unquote(self.headers.get("X-Folder", "")), unquote(self.headers.get("X-Path", "")),
                         self.rfile, length)
        self.json({})

    def upload_done(self):
        folder = self.body()["folder"]
        jobs.upload_done(JOBS, folder)
        self.json({"item": folder})

    def accept(self):
        self.json({"job": jobs.accept(JOBS, self.body()["item"])})

    def merge(self):
        r = self.body()
        self.json({"job": jobs.merge(JOBS, r["item"], r["job"], r["copies"], r["project"], r["basedOn"], r["name"])})

    def move(self):
        r = self.body()
        self.json({"job": jobs.move(JOBS, r["job"], r["to"])})

    def assign(self):
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        digest = jobs.assign(folder, r["file"], r["newName"], r["project"], r["basedOn"])
        self.json({"projectHash": digest, "job": jobs.rename(JOBS, folder.name, r["name"])})

    def stream(self):
        """Starts an NDJSON reply; returns line(obj), which sends one line."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.end_headers()  # no length: HTTP/1.0 ends the body by closing

        def line(obj):
            self.wfile.write((json.dumps(obj) + "\n").encode())
            self.wfile.flush()
        return line

    def check_audio(self):
        """Streams one JSON object per line: {"file", "index", "count",
        "step", "progress"} while the files are read, then {"result":
        facts} (or {"error": …})."""
        import checks  # needs the libraries main() verified
        r = self.body()
        names = files(r)  # refused before the stream starts, as a plain 400
        folder = jobs.find(JOBS, r["job"])[1]
        out = folder / ".checks"
        out.mkdir(exist_ok=True)
        line = self.stream()
        shown, state = -1, {}

        def step(file, index, count, what):
            state.update(file=file, index=index, count=count, step=what)
            line({**state, "progress": max(shown, 0)})

        def progress(fraction):
            nonlocal shown
            # Before the first step (a job without audio) there is nothing to name.
            if state and int(fraction * 100) != shown:
                shown = int(fraction * 100)
                line({**state, "progress": shown})
        try:
            line({"result": checks.audio(folder, out, progress, bool(r.get("rescan")), step, names)})
        except OSError as error:
            line({"error": f"couldn't check audio: {error}"})

    def spectrum(self):
        """Starts the job's spectrograms in the background (spectrum.py);
        the page asks once its checks are done."""
        import spectrum
        r = self.body()
        spectrum.start(jobs.find(JOBS, r["job"])[1], files(r))
        self.json({})

    def profiles(self):
        """The page sends CONFIG.printProfiles on load; missing ones are
        downloaded in the background (icc.py)."""
        import icc
        specs = self.body().get("profiles", {})
        if not isinstance(specs, dict):
            raise JobError("profiles must be an object")
        icc.ensure_all(specs)
        self.json({})

    def save_project(self):
        """project.json as the page decided it (a production log entry);
        refused with 409 when it changed since the page read it."""
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        if not isinstance(r.get("project"), dict):
            raise JobError("project must be an object")
        self.json({"projectHash": jobs.write_project(folder, r["project"], r["basedOn"])})

    def staff_file(self, name):
        if name not in STAFF_FILES:
            raise JobError(f"no staff file {name!r}")
        return STAFF_FILES[name]

    def get_staff_file(self):
        path, example = self.staff_file(self.query("name"))
        self.json(staff_files.read(path, example))

    def save_staff_file(self):
        """The pricelist or plant config as the editor decided it; refused
        with 409 when the file changed since the page read it."""
        r = self.body()
        path = self.staff_file(r["name"])[0]
        staff_files.check(r["name"], r["text"])
        self.json({"hash": staff_files.write(path, r["text"], r["basedOn"])})

    def fix_paths(self, r):
        """(source, target) of a fix in the job: the source must exist, the
        target must not — a fix never writes over a file."""
        folder = jobs.find(JOBS, r["job"])[1]
        source, target = folder / jobs.plain(r["file"]), folder / jobs.plain(r["newName"])
        if not source.is_file():
            raise JobError(f"no file {r['file']}")
        if target.exists():
            raise Conflict(f"{r['newName']} exists already")
        return source, target

    def fix(self):
        """One step's fix as the slot's next version (the page names it and
        says which): geometry (size, pdf), assign or colour. The file in use
        is never touched; a refusal goes to the page as 400."""
        import colourfix
        import geomfix
        import icc
        r = self.body()
        source, target = self.fix_paths(r)
        params, fix = r["params"], r["fix"]
        try:
            if fix["kind"] == "geometry":
                geomfix.render(source, params, fix["candidate"], target, params["fixDpi"])
                detail = fix["detail"]
            else:
                run = {"assign": colourfix.assign, "colour": colourfix.fix}[fix["kind"]]
                try:
                    profile = icc.ensure(params["profile"])
                except icc.ProfileError as error:
                    raise Unavailable(f"print profile: {error}") from None
                detail = run(source, params, target, profile)
        except (geomfix.FixError, colourfix.FixError) as error:
            raise JobError(str(error)) from None
        self.json({"name": r["newName"], "detail": detail})

    def proof(self):
        """The customer proof of a finished file, under the name the page
        gives (proofFileName); never over a file."""
        import proof
        r = self.body()
        source, target = self.fix_paths(r)
        try:
            proof.make(source, r["params"], target)
        except proof.ProofError as error:
            raise JobError(str(error)) from None
        self.json({"name": r["newName"]})

    def trash(self):
        """Saves project.json (the page's log of it, 409 when it changed),
        then moves the files into the job's .trash/. Every file must exist
        first, so a refusal changes nothing."""
        r = self.body()
        folder = jobs.find(JOBS, r["job"])[1]
        if not isinstance(r.get("project"), dict):
            raise JobError("project must be an object")
        for name in r["files"]:
            if not (folder / jobs.plain(name)).is_file():
                raise JobError(f"no file {name}")
        digest = jobs.write_project(folder, r["project"], r["basedOn"])
        for name in r["files"]:
            jobs.trash(folder, name)
        self.json({"projectHash": digest})

    def check_artwork(self):
        """Streams {"file", "index", "count", "step"} as each file starts,
        then {"result": facts} (or {"error": …})."""
        import checks  # needs the libraries main() verified
        r = self.body()
        if not isinstance(r.get("artwork", {}), dict):
            raise JobError("artwork must be an object")
        folder = jobs.find(JOBS, r["job"])[1]
        out = folder / ".checks"
        out.mkdir(exist_ok=True)
        line = self.stream()

        def step(file, index, count, what):
            line({"file": file, "index": index, "count": count, "step": what})
        try:
            line({"result": checks.check_artwork(folder, out, r.get("artwork", {}), bool(r.get("rescan")), step)})
        except OSError as error:
            line({"error": f"couldn't check artwork: {error}"})

def make_server(port):
    try:
        return ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            sys.exit(f"port {port} is in use — is another plant view running? (or: --port)")
        sys.exit(f"can't listen on port {port}: {error.strerror}")


def main():
    global JOBS
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--jobs", type=Path, default=JOBS, help="the jobs tree (default: plant/jobs/)")
    args = parser.parse_args()
    port, JOBS = args.port, args.jobs.resolve()
    problems = missing()
    if problems:
        sys.exit("plant view can't start:\n" + "".join(f"  {p}\n" for p in problems)
                 + "start with: uv run --project plant plant/server.py (ffmpeg: brew install ffmpeg)")
    jobs.ensure_stages(JOBS)
    server = make_server(port)
    print(f"plant view: http://127.0.0.1:{port}/ — jobs in {JOBS}")
    server.serve_forever()


if __name__ == "__main__":
    main()
