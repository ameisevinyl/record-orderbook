"""Plant view server: serves src/plant/ (and the src/ modules it imports,
unbuilt) and unpacks posted project zips into plant/work/<zip stem>/.

Standard library only; binds 127.0.0.1. Run: python3 plant/server.py
"""
import argparse
import json
import shutil
import stat
import tempfile
import threading
import zipfile
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
WORK = ROOT / "plant" / "work"
INDEX = SRC / "plant" / "index.html"
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
}
CHUNK = 1 << 20
# ThreadingHTTPServer: two opens of the same zip would otherwise wipe
# and fill the same work folder at once.
UNPACK_LOCK = threading.Lock()


class OpenError(Exception):
    """A zip the plant view refuses; the message goes to the page as-is."""


def safe_names(zf):
    names = []
    for info in zf.infolist():
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
            raise OpenError(f"unsafe path in zip: {info.filename}")
        # Unix mode lives in the high 16 bits of external_attr.
        if stat.S_ISLNK(info.external_attr >> 16):
            raise OpenError(f"symlink in zip: {info.filename}")
        if not info.is_dir():
            names.append(info.filename)
    if len(names) != len(set(names)):
        raise OpenError("duplicate filename in zip")
    return names


def unpack(zip_file, dest):
    """Unpack a project zip into dest (replaced). Returns (project, files):
    the parsed project.json and every other file, named relative to the
    folder that holds project.json."""
    try:
        zf = zipfile.ZipFile(zip_file)
    except zipfile.BadZipFile:
        raise OpenError("not a zip file") from None
    with zf:
        names = safe_names(zf)
        jsons = [n for n in names if PurePosixPath(n).name == "project.json"]
        if not jsons:
            raise OpenError("no project.json in zip")
        if len(jsons) > 1:
            raise OpenError("more than one project.json in zip")
        try:
            project = json.loads(zf.read(jsons[0]))
        except ValueError:
            raise OpenError("project.json is not valid JSON") from None
        with UNPACK_LOCK:
            if dest.exists():
                shutil.rmtree(dest)
            dest.mkdir(parents=True)
            try:
                zf.extractall(dest)
            except (zipfile.BadZipFile, zlib.error, EOFError) as error:
                raise OpenError(f"corrupt file in zip: {error}") from None
            base = dest / PurePosixPath(jsons[0]).parent
            files = [{"name": p.relative_to(base).as_posix(), "size": p.stat().st_size}
                     for p in sorted(base.rglob("*")) if p.is_file() and p != base / "project.json"]
    return project, files


def static_target(url_path):
    """File under src/ for a GET path, or None."""
    path = unquote(urlsplit(url_path).path)
    target = INDEX if path in ("/", "/index.html") else (ROOT / path.lstrip("/")).resolve()
    return target if target.is_relative_to(SRC) and target.is_file() else None


def zip_stem(header_value):
    """Work-folder name from the X-Filename header (encodeURIComponent'd)."""
    name = PurePosixPath(unquote(header_value).replace("\\", "/")).name
    stem = name[:-4] if name.lower().endswith(".zip") else name
    if stem in ("", ".", ".."):
        raise OpenError("invalid file name")
    return stem


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, body, content_type):
        data = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        target = static_target(self.path)
        if target is None:
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        self.reply(200, target.read_bytes(), TYPES.get(target.suffix, "application/octet-stream"))

    def do_POST(self):
        if self.path != "/api/open":
            return self.reply(404, "not found", "text/plain; charset=utf-8")
        try:
            raw_name = self.headers.get("X-Filename", "")
            stem = zip_stem(raw_name)
            try:
                remaining = int(self.headers.get("Content-Length", 0))
            except ValueError:
                raise OpenError("invalid Content-Length") from None
            # Project zips can be hundreds of MB: stream to disk, not memory.
            with tempfile.TemporaryFile() as tmp:
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, CHUNK))
                    if not chunk:
                        break
                    tmp.write(chunk)
                    remaining -= len(chunk)
                tmp.seek(0)
                project, files = unpack(tmp, WORK / stem)
        except OpenError as error:
            return self.reply(400, str(error), "text/plain; charset=utf-8")
        except OSError as error:
            # Disk full, name too long, ...: still an answer the page can show.
            return self.reply(500, f"couldn't unpack: {error}", "text/plain; charset=utf-8")
        name = PurePosixPath(unquote(raw_name)).name
        self.reply(200, json.dumps({"name": name, "project": project, "files": files}),
                   "application/json; charset=utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    port = parser.parse_args().port
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"plant view: http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
