"""Job folders on disk: a job is a folder holding project.json, sitting in
a stage folder (NN_NAME) or one level of sub-stage below, e.g.
00_INBOX/<job>, 10_ORDERS/10_PREPRESS/<job>. Moving a job is moving its
folder — by the plant view, Finder or mv, all the same. project.json
records the stage it was last seen in; a scan appends any move it finds
to its history, so moves made on disk get logged too.

Standard library only. No workflow rules here: the page decides, this
module only reads and writes the disk.
"""
import hashlib
import json
import os
import re
import shutil
import stat
import threading
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

STAGE = re.compile(r"\d\d_[A-Z0-9_]+")
DEFAULT_STAGES = ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS", "20_DONE", "99_ARCHIVE"]
INBOX = "00_INBOX"
# Written by the customer page into every package; replaced on a resend.
TEXT_FILES = ("order_summary.txt", "tracklist.txt")
CHUNK = 1 << 20
# One writer at a time: the server is threaded.
LOCK = threading.RLock()


class JobError(Exception):
    """A request the jobs tree refuses; the message goes to the page as-is."""


class Conflict(JobError):
    """project.json changed on disk since the page read it."""


def plain(name):
    """A single file or folder name from the page, never a path."""
    if not isinstance(name, str) or name in ("", ".", "..") or "/" in name or "\\" in name or name.startswith("."):
        raise JobError(f"invalid name: {name!r}")
    return name


def ensure_stages(root):
    root.mkdir(parents=True, exist_ok=True)
    if not stages(root):
        for stage in DEFAULT_STAGES:
            (root / stage).mkdir(parents=True, exist_ok=True)


def stages(root):
    """Stage paths relative to root ("10_ORDERS/10_PREPRESS"), sorted."""
    found = []
    for top in sorted(root.iterdir()):
        if top.is_dir() and STAGE.fullmatch(top.name):
            found.append(top.name)
            found += [f"{top.name}/{sub.name}" for sub in sorted(top.iterdir())
                      if sub.is_dir() and STAGE.fullmatch(sub.name)]
    return found


def jobs_in(root, stage):
    folder = root / stage
    return sorted(p.name for p in folder.iterdir() if p.is_dir() and (p / "project.json").is_file())


def find(root, job):
    """(stage, folder) of the job named `job`."""
    plain(job)
    hits = [stage for stage in stages(root) if (root / stage / job / "project.json").is_file()]
    if not hits:
        raise JobError(f"no job {job}")
    if len(hits) > 1:
        raise JobError(f"job {job} is in more than one stage: {', '.join(hits)}")
    return hits[0], root / hits[0] / job


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def read_project(folder):
    """(project, sha256 of project.json's bytes)."""
    data = (folder / "project.json").read_bytes()
    try:
        project = json.loads(data)
    except ValueError:
        raise JobError(f"{folder.name}: project.json is not valid JSON") from None
    if not isinstance(project, dict):
        raise JobError(f"{folder.name}: project.json is not an object")
    return project, hashlib.sha256(data).hexdigest()


def write_project(folder, project, based_on):
    """Replace project.json unless it changed since the reader saw
    based_on. Temp file + rename: never half-written."""
    with LOCK:
        if read_project(folder)[1] != based_on:
            raise Conflict("project.json changed meanwhile — reload and try again")
        tmp = folder / ".project.json.tmp"
        tmp.write_text(json.dumps(project, indent=2, ensure_ascii=False))
        os.replace(tmp, folder / "project.json")
    return read_project(folder)[1]


def history_entry(note, by):
    """Same shape as historyEntry() in src/lib/project.js."""
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {"savedAt": now, "by": by, "note": note}


def note_stage(folder, stage, by, note=None):
    """Record stage in project.json (plant.stage) with a history entry,
    if it differs from the one recorded."""
    with LOCK:
        project, digest = read_project(folder)
        plant = project.get("plant") if isinstance(project.get("plant"), dict) else {}
        before = plant.get("stage") or ""
        if before == stage:
            return
        project["plant"] = {**plant, "stage": stage}
        history = project.get("history") if isinstance(project.get("history"), list) else []
        project["history"] = history + [history_entry(note or (f"{before} → {stage}" if before else f"in {stage}"), by)]
        write_project(folder, project, digest)


def board(root):
    """Every stage with its jobs, the zips waiting in the inbox, and
    problems found on the way. Logs moves made on disk."""
    columns, problems, seen = [], [], {}
    for stage in stages(root):
        cards = []
        for job in jobs_in(root, stage):
            folder = root / stage / job
            seen.setdefault(job, []).append(stage)
            try:
                note_stage(folder, stage, "disk")
                project = read_project(folder)[0]
                cards.append({"job": job, "catalogue": project.get("catalogue", ""),
                              "title": project.get("albumTitle", ""), "artist": project.get("albumArtist", "")})
            except (JobError, OSError) as error:
                cards.append({"job": job, "error": str(error)})
        columns.append({"stage": stage, "jobs": cards})
    problems += [f"{job} is in more than one stage: {', '.join(where)}" for job, where in seen.items() if len(where) > 1]
    inbox = root / INBOX
    zips = sorted(p.name for p in inbox.iterdir() if p.is_file() and p.suffix.lower() == ".zip") if inbox.is_dir() else []
    return {"stages": columns, "inbox": zips, "problems": problems}


def files(folder):
    """Every file in the job but project.json; dot names (.checks/,
    .DS_Store) are the machine's, not the job's."""
    return [{"name": p.relative_to(folder).as_posix(), "size": p.stat().st_size}
            for p in sorted(folder.rglob("*"))
            if p.is_file() and p != folder / "project.json"
            and not any(part.startswith(".") for part in p.relative_to(folder).parts)]


def move(root, job, to):
    with LOCK:
        stage, folder = find(root, job)
        if to not in stages(root):
            raise JobError(f"no stage {to}")
        target = root / to / job
        if target.exists():
            raise Conflict(f"{to} already holds {job}")
        folder.rename(target)
        note_stage(target, to, "plant")


def assign(folder, name, new_name, project, based_on):
    """Rename a file of the job to new_name (a slot's next version) and
    save the project that points the slot at it; undone if the save fails."""
    source, target = folder / plain(name), folder / plain(new_name)
    if not source.is_file():
        raise JobError(f"no file {name}")
    with LOCK:
        if name != new_name:
            if target.exists():
                raise Conflict(f"{new_name} exists already")
            source.rename(target)
        try:
            return write_project(folder, project, based_on)
        except Exception:
            if name != new_name:
                target.rename(source)
            raise


# --- Project zips --------------------------------------------------------

def safe_names(zf):
    names = []
    for info in zf.infolist():
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts or "\\" in info.filename:
            raise JobError(f"unsafe path in zip: {info.filename}")
        # Unix mode lives in the high 16 bits of external_attr.
        if stat.S_ISLNK(info.external_attr >> 16):
            raise JobError(f"symlink in zip: {info.filename}")
        if not info.is_dir():
            names.append(info.filename)
    if len(names) != len(set(names)):
        raise JobError("duplicate filename in zip")
    return names


def open_zip(path):
    try:
        return zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise JobError(f"{path.name}: not a zip file") from None


def zip_layout(zf):
    """(project.json entry, {file name: entry}) — names relative to the
    folder holding project.json, which may sit at the root or nested."""
    names = safe_names(zf)
    jsons = [n for n in names if PurePosixPath(n).name == "project.json"]
    if not jsons:
        raise JobError("no project.json in zip")
    if len(jsons) > 1:
        raise JobError("more than one project.json in zip")
    base = jsons[0][:-len("project.json")]
    entries = {n[len(base):]: n for n in names if n.startswith(base) and n != jsons[0]}
    return jsons[0], entries


def inspect_zip(path):
    """What a zip in the inbox holds, without unpacking it: the project,
    each file with its sha256, and the job name it would get."""
    with open_zip(path) as zf:
        json_entry, entries = zip_layout(zf)
        try:
            project = json.loads(zf.read(json_entry))
        except ValueError:
            raise JobError("project.json is not valid JSON") from None
        listing = []
        for name, entry in sorted(entries.items()):
            h = hashlib.sha256()
            try:
                with zf.open(entry) as f:
                    while chunk := f.read(CHUNK):
                        h.update(chunk)
            except (zipfile.BadZipFile, zlib.error, EOFError) as error:
                raise JobError(f"corrupt file in zip: {error}") from None
            listing.append({"name": name, "size": zf.getinfo(entry).file_size, "sha256": h.hexdigest()})
    parent = PurePosixPath(json_entry).parent.name
    return {"job": parent or path.stem, "project": project, "files": listing}


def extract(zf, entry, target):
    try:
        with zf.open(entry) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK)
    except (zipfile.BadZipFile, zlib.error, EOFError) as error:
        target.unlink(missing_ok=True)
        raise JobError(f"corrupt file in zip: {error}") from None


def accept(root, zip_name):
    """A new job from an inbox zip: unpacked flat into 00_INBOX/<job>/,
    the zip removed. Refuses a job name that exists anywhere."""
    path = root / INBOX / plain(zip_name)
    with LOCK:
        info = inspect_zip(path)
        job = plain(info["job"])
        if any((root / stage / job).exists() for stage in stages(root)):
            raise Conflict(f"job {job} exists already")
        folder = root / INBOX / job
        tmp = root / INBOX / f".{job}.tmp"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        try:
            with open_zip(path) as zf:
                json_entry, entries = zip_layout(zf)
                extract(zf, json_entry, tmp / "project.json")
                for name, entry in entries.items():
                    (tmp / name).parent.mkdir(parents=True, exist_ok=True)
                    extract(zf, entry, tmp / name)
            tmp.rename(folder)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        note_stage(folder, INBOX, "plant", f"received {zip_name}")
        path.unlink()
    return job


def merge(root, zip_name, job, copies, project, based_on):
    """A resend into an existing job: copies [{from, to}] (from: name in
    the zip, to: a new file in the job — never an existing one), the
    zip's text files replace the job's, project saved, zip removed."""
    path = root / INBOX / plain(zip_name)
    with LOCK:
        folder = find(root, job)[1]
        if read_project(folder)[1] != based_on:
            raise Conflict("project.json changed meanwhile — reload and try again")
        written = []
        try:
            with open_zip(path) as zf:
                entries = zip_layout(zf)[1]
                for copy in copies:
                    source, target = copy["from"], folder / plain(copy["to"])
                    if source not in entries:
                        raise JobError(f"{source} is not in the zip")
                    if target.exists():
                        raise Conflict(f"{copy['to']} exists already")
                    extract(zf, entries[source], target)
                    written.append(target)
                for name in TEXT_FILES:
                    if name in entries:
                        extract(zf, entries[name], folder / name)
            write_project(folder, project, based_on)
        except BaseException:
            for target in written:
                target.unlink(missing_ok=True)
            raise
        path.unlink()


def write_zip(folder, out):
    """The job as a customer-page package: every file but dot names,
    nested under the job's folder name. out: a writable binary stream
    (need not seek)."""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        zf.write(folder / "project.json", f"{folder.name}/project.json")
        for entry in files(folder):
            zf.write(folder / entry["name"], f"{folder.name}/{entry['name']}")
