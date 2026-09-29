"""Archive finished jobs: every job in the done stage whose move there is
older than --days becomes one zip in the archive stage (the customer
package: project.json with its history, and the job's files), and its
folder is removed once the zip reads back. Meant for cron or launchd:

  uv run --project plant plant/archive.py --jobs <folder> --days 60
"""
import argparse
import shutil
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jobs

DONE, ARCHIVE = "20_DONE", "99_ARCHIVE"


def arrived(project, stage):
    """When the history last shows the job arriving in stage, or None."""
    for entry in reversed(project.get("history") or []):
        note = entry.get("note", "") if isinstance(entry, dict) else ""
        if note.endswith(f"→ {stage}") or note == f"in {stage}":
            try:
                return datetime.fromisoformat(entry["savedAt"].replace("Z", "+00:00"))
            except (KeyError, ValueError):
                return None
    return None


def archive(root, days, now=None, done=DONE, to=ARCHIVE):
    """Archives what's due; returns the job names archived."""
    now = now or datetime.now(timezone.utc)
    (root / to).mkdir(exist_ok=True)
    archived = []
    for job in jobs.jobs_in(root, done):
        folder = root / done / job
        jobs.note_stage(folder, done, "disk")  # a job moved by hand starts its time now
        since = arrived(jobs.read_project(folder)[0], done)
        if since is None or now - since < timedelta(days=days):
            continue
        target = root / to / f"{job}.zip"
        if target.exists():
            print(f"{job}: {target.name} exists already, skipped", file=sys.stderr)
            continue
        part = target.with_name(f".{target.name}.part")
        with open(part, "wb") as f:
            jobs.write_zip(folder, f)
        with zipfile.ZipFile(part) as zf:
            bad = zf.testzip()
        if bad:
            part.unlink()
            print(f"{job}: {bad} doesn't read back, skipped", file=sys.stderr)
            continue
        part.rename(target)
        shutil.rmtree(folder)
        archived.append(job)
    return archived


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--jobs", type=Path, required=True)
    parser.add_argument("--days", type=int, required=True)
    args = parser.parse_args()
    for job in archive(args.jobs, args.days):
        print(f"archived {job}")


if __name__ == "__main__":
    main()
