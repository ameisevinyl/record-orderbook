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
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

STAGE = re.compile(r"\d\d_[A-Z0-9_]+")
# A job name ends in a local-time stamp, <key>_YYMMDD-HHMM (the customer
# page names its zips so); the key is the job's identity across renames.
STAMP = re.compile(r"_\d{6}-\d{4}$")
DEFAULT_STAGES = ["00_INBOX", "10_ORDERS/10_PREPRESS", "10_ORDERS/20_PRESS", "20_DONE", "99_ARCHIVE"]
INBOX = "00_INBOX"
ARCHIVE = "99_ARCHIVE"
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


def grouping(root):
    """Stages that only group sub-stages (10_ORDERS): no job belongs in them."""
    all_ = stages(root)
    return {s for s in all_ if any(t.startswith(s + "/") for t in all_)}


def places(root):
    """The stages a job may sit in: all but the grouping ones."""
    group = grouping(root)
    return [s for s in stages(root) if s not in group]


def job_key(name):
    return STAMP.sub("", name)


def natural_key(name):
    """PNKRCK7 before PNKRCK10: digit runs compare as numbers."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part) for part in re.split(r"(\d+)", name)]


def jobs_in(root, stage):
    """Job folders in a stage; in the inbox only accepted ones (see inbox())."""
    folder = root / stage
    return sorted((p.name for p in folder.iterdir() if p.is_dir() and not p.name.startswith(".")
                   and (p / "project.json").is_file() and (stage != INBOX or accepted(p))), key=natural_key)


def same_key(root, job):
    """(stage, name) of every job with job's key."""
    key = job_key(job)
    return [(stage, name) for stage in stages(root) for name in jobs_in(root, stage) if job_key(name) == key]


def find(root, job):
    """(stage, folder) of the job `job`, by key: an older stamp still finds
    the job after a rename."""
    plain(job)
    hits = same_key(root, job)
    if not hits:
        raise JobError(f"no job {job}")
    if len(hits) > 1:
        raise JobError(f"more than one job {job_key(job)}: {', '.join(f'{s}/{n}' for s, n in hits)}")
    stage, name = hits[0]
    return stage, root / stage / name


def rename(root, job, name):
    """A job's content changed through the plant view: it takes the name
    the page built from its project.json (the customer page's rule, with
    the plant's local time). Refused when another job has that key."""
    plain(name)
    with LOCK:
        stage, folder = find(root, job)
        if name == folder.name:
            return name
        if any(root / s / n != folder for s, n in same_key(root, name)) or folder.with_name(name).exists():
            raise Conflict(f"job {job_key(name)} exists already")
        folder.rename(folder.with_name(name))
        return name


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


def trash(folder, name):
    """Moves a job file into <job>/.trash/: out of listings, checks and
    zips, recoverable by hand on any filesystem. A name already there
    gets _<n> — nothing is overwritten."""
    if plain(name) == "project.json":
        raise JobError("project.json can't be trashed")
    source = folder / name
    if not source.is_file():
        raise JobError(f"no file {name}")
    bin_ = folder / ".trash"
    bin_.mkdir(exist_ok=True)
    target, n = bin_ / name, 1
    while target.exists():
        target, n = bin_ / f"{source.stem}_{n}{source.suffix}", n + 1
    source.rename(target)
    return target.name


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
    """Every stage with its jobs, the items waiting in the inbox, and
    problems found on the way. Logs moves made on disk."""
    columns, problems, seen = [], [], {}
    for stage in stages(root):
        cards = []
        for job in jobs_in(root, stage):
            folder = root / stage / job
            seen.setdefault(job_key(job), []).append(f"{stage}/{job}")
            try:
                note_stage(folder, stage, "disk")
                project = read_project(folder)[0]
                # What the board needs to derive the job's lines: its files
                # and the last check results (read only, never re-checked here).
                try:
                    cached = json.loads((folder / ".checks" / "artwork.json").read_text())
                except (OSError, ValueError):
                    cached = {}
                artwork = {name: {**e.get("facts", {}), "sha256": e.get("sha256")}
                           for name, e in cached.items() if isinstance(e, dict)}
                # albumTitle: the production title of a version 1 project.json
                title = project.get("productionTitle", project.get("albumTitle", ""))
                cards.append({"job": job, "catalogue": project.get("catalogue", ""),
                              "title": title, "artist": project.get("albumArtist", ""),
                              "project": project, "files": files(folder), "artwork": artwork})
            except (JobError, OSError) as error:
                cards.append({"job": job, "error": str(error)})
        columns.append({"stage": stage, "jobs": cards})
    problems += [f"more than one job {key}: {', '.join(where)}" for key, where in seen.items() if len(where) > 1]
    return {"stages": columns, "inbox": inbox(root), "problems": problems, "archive": archived(root)}


def job_paths(folder):
    """Every file in the job but project.json: top level only, like the
    customer package (subfolders such as spectrum/ are the plant's own),
    and no dot names (.checks/, .DS_Store)."""
    return [p for p in sorted(folder.iterdir()) if p.is_file() and p.name != "project.json"
            and not p.name.startswith(".")]


def iso(mtime):
    """A modification time as ISO, UTC."""
    return datetime.fromtimestamp(mtime, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def files(folder):
    """job_paths() with size and modification time (ISO, UTC)."""
    listing = []
    for p in job_paths(folder):
        st = p.stat()
        listing.append({"name": p.relative_to(folder).as_posix(), "size": st.st_size, "modified": iso(st.st_mtime)})
    return listing


def archived(root):
    """The zips plant/archive.py wrote into the archive stage, newest first."""
    folder = root / ARCHIVE
    if not folder.is_dir():
        return []
    listing = []
    for p in folder.iterdir():
        if p.is_file() and p.suffix == ".zip" and not p.name.startswith("."):
            st = p.stat()
            listing.append({"name": p.name, "size": st.st_size, "modified": iso(st.st_mtime)})
    return sorted(listing, key=lambda e: e["modified"], reverse=True)


def stamp(folder):
    """A fingerprint of the job's files and project.json from their sizes
    and times: cheap enough to poll, changes on any save."""
    h = hashlib.sha256()
    for p in [folder / "project.json"] + job_paths(folder):
        st = p.stat()
        h.update(f"{p.relative_to(folder)}\0{st.st_size}\0{st.st_mtime_ns}\n".encode())
    return h.hexdigest()


def remember_received(folder):
    """plant.received: the sha256 of every file as it came in, so a later
    resend of the same content doesn't undo a fix saved over it
    (mergeResend in src/lib/versions.js keeps it up to date)."""
    with LOCK:
        project, digest = read_project(folder)
        plant = project.get("plant") if isinstance(project.get("plant"), dict) else {}
        project["plant"] = {**plant, "received": {p.relative_to(folder).as_posix(): sha256(p) for p in job_paths(folder)}}
        write_project(folder, project, digest)


def move(root, job, to):
    with LOCK:
        stage, folder = find(root, job)
        if to not in places(root):
            raise JobError(f"{to} only groups its sub-stages" if to in stages(root) else f"no stage {to}")
        target = root / to / folder.name
        if target.exists():
            raise Conflict(f"{to} already holds {folder.name}")
        folder.rename(target)
        note_stage(target, to, "plant")
        return folder.name


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


# --- Inbox: received zips and folders -------------------------------------

def project_dir(folder):
    """The folder holding project.json: folder itself, or the one folder
    inside it (unzipping may add a wrapper, e.g. "Download/<job>/")."""
    if (folder / "project.json").is_file():
        return folder
    inner = [p for p in folder.iterdir() if p.is_dir() and not p.name.startswith(".") and (p / "project.json").is_file()]
    return inner[0] if len(inner) == 1 else None


def accepted(folder):
    """A job the plant took in: its project.json names a stage. A received
    folder doesn't — the customer page never writes plant.stage."""
    try:
        plant = read_project(folder)[0].get("plant")
    except JobError:
        return True  # shown as a job with its error
    return isinstance(plant, dict) and bool(plant.get("stage"))


def inbox(root):
    """Received items in 00_INBOX, not yet a job: zips, and folders with a
    project.json (at their top or one folder down) that no stage names."""
    folder = root / INBOX
    items = []
    for p in sorted(folder.iterdir()) if folder.is_dir() else []:
        if p.name.startswith("."):
            continue
        if p.is_file() and p.suffix.lower() == ".zip":
            items.append(p.name)
        elif p.is_dir() and (base := project_dir(p)) is not None and (base != p or not accepted(p)):
            items.append(p.name)
    return items


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


@contextmanager
def open_item(path):
    """An inbox zip or folder as (job name, project, {file name: open()}):
    names relative to the folder holding project.json."""
    if path.is_dir():
        base = project_dir(path)
        if base is None:
            raise JobError(f"{path.name}: no project.json in the folder")
        yield base.name, read_project(base)[0], {f["name"]: (lambda p=base / f["name"]: open(p, "rb")) for f in files(base)}
        return
    with open_zip(path) as zf:
        json_entry, entries = zip_layout(zf)
        try:
            project = json.loads(zf.read(json_entry))
        except ValueError:
            raise JobError("project.json is not valid JSON") from None
        yield (PurePosixPath(json_entry).parent.name or path.stem), project, {n: (lambda e=e: zf.open(e)) for n, e in entries.items()}


def read_stream(opener, sink):
    """Feeds every chunk of opener() to sink; a broken zip member is a JobError."""
    try:
        with opener() as f:
            while chunk := f.read(CHUNK):
                sink(chunk)
    except (zipfile.BadZipFile, zlib.error, EOFError) as error:
        raise JobError(f"corrupt file in zip: {error}") from None


def copy_out(opener, target):
    try:
        with open(target, "wb") as dst:
            read_stream(opener, dst.write)
    except BaseException:
        target.unlink(missing_ok=True)
        raise


def inspect(path):
    """What an inbox item holds, without unpacking it: the project, each
    file with its size and sha256, and the job name it would get."""
    with open_item(path) as (job, project, entries):
        listing = []
        for name, opener in sorted(entries.items()):
            h, size = hashlib.sha256(), 0

            def sink(chunk):
                nonlocal size
                h.update(chunk)
                size += len(chunk)
            read_stream(opener, sink)
            listing.append({"name": name, "size": size, "sha256": h.hexdigest()})
    return {"job": job, "project": project, "files": listing}


def remove_item(path):
    if path.is_dir():
        shutil.rmtree(path)
    else:
        path.unlink()


def accept(root, name):
    """A new job from an inbox item, flat in 00_INBOX/<job>/: a zip is
    unpacked and removed, a folder taken as it is (out of its wrapper).
    Refuses a job name that exists anywhere."""
    path = root / INBOX / plain(name)
    with LOCK:
        with open_item(path) as (job, project, entries):
            job = plain(job)
            folder = root / INBOX / job
            in_place = path.is_dir() and project_dir(path) == folder
            if same_key(root, job) or any((root / stage / job).exists() for stage in stages(root)
                                          if not (path == folder and stage == INBOX)):
                raise Conflict(f"job {job_key(job)} exists already")
            if path.is_dir() and not in_place:
                # Out of its wrapper (which may carry the job's own name).
                moved = root / INBOX / f".{job}.tmp"
                project_dir(path).rename(moved)
                if not any(not p.name.startswith(".") for p in path.iterdir()):
                    shutil.rmtree(path)
                if folder.exists():
                    moved.rename(path / job)
                    raise Conflict(f"{path.name} holds more than the job {job}")
                moved.rename(folder)
            elif path.is_file():
                tmp = root / INBOX / f".{job}.tmp"
                shutil.rmtree(tmp, ignore_errors=True)
                tmp.mkdir()
                try:
                    (tmp / "project.json").write_text(json.dumps(project, indent=2, ensure_ascii=False))
                    for entry, opener in entries.items():
                        (tmp / entry).parent.mkdir(parents=True, exist_ok=True)
                        copy_out(opener, tmp / entry)
                    tmp.rename(folder)
                except BaseException:
                    shutil.rmtree(tmp, ignore_errors=True)
                    raise
        note_stage(folder, INBOX, "plant", f"received {name}")
        remember_received(folder)
        if path.is_file():
            path.unlink()
    return job


def merge(root, name, job, copies, project, based_on, new_name):
    """A resend into an existing job: copies [{from, to}] (from: name in
    the item, to: a new file in the job — never an existing one), the
    item's text files replace the job's, project saved, item removed.
    The job then takes new_name (see rename), which is returned."""
    path = root / INBOX / plain(name)
    with LOCK:
        folder = find(root, job)[1]
        if read_project(folder)[1] != based_on:
            raise Conflict("project.json changed meanwhile — reload and try again")
        written = []
        try:
            with open_item(path) as (_, _, entries):
                for copy in copies:
                    source, target = copy["from"], folder / plain(copy["to"])
                    if source not in entries:
                        raise JobError(f"{source} is not in {name}")
                    if target.exists():
                        raise Conflict(f"{copy['to']} exists already")
                    copy_out(entries[source], target)
                    written.append(target)
                for text in TEXT_FILES:
                    if text in entries:
                        copy_out(entries[text], folder / text)
            write_project(folder, project, based_on)
        except BaseException:
            for target in written:
                target.unlink(missing_ok=True)
            raise
        remove_item(path)
        return rename(root, job, new_name)


def upload_file(root, folder, rel, stream, length):
    """One file of a folder the page uploads, into 00_INBOX/.<folder>.part/
    until upload_done; rel may hold subfolders."""
    parts = [plain(part) for part in rel.split("/")]
    target = root / INBOX / f".{plain(folder)}.part" / Path(*parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with open(target, "wb") as f:
        while length > 0:
            chunk = stream.read(min(length, CHUNK))
            if not chunk:
                raise JobError("upload ended early")
            f.write(chunk)
            length -= len(chunk)


def upload_done(root, folder):
    part = root / INBOX / f".{plain(folder)}.part"
    target = root / INBOX / folder
    with LOCK:
        if not part.is_dir():
            raise JobError(f"nothing uploaded for {folder}")
        if target.exists():
            shutil.rmtree(part)
            raise Conflict(f"{folder} is in the inbox already")
        part.rename(target)


def write_zip(folder, out, project=None):
    """The job as a customer-page package: every file but dot names,
    nested under the job's folder name; project replaces project.json when
    given. out: a writable binary stream (need not seek)."""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        if project is None:
            zf.write(folder / "project.json", f"{folder.name}/project.json")
        else:
            zf.writestr(f"{folder.name}/project.json", json.dumps(project, indent=2, ensure_ascii=False))
        for entry in files(folder):
            zf.write(folder / entry["name"], f"{folder.name}/{entry['name']}")
