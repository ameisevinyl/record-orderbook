"""Spectrogram per audio file for the mastering engineer, in
<job>/spectrum/<file>.png: ffmpeg's showspectrumpic, two channels
stacked (left above right), with its frequency, time and dBFS scales.
Linear frequency 20 Hz–20 kHz (the standard; the highs, where cutting
trouble sits, get most of the height), magma (colour-blind safe, high
contrast), 50 dB shown — a record's own range is ~70 dB at best. The
plant view asks for it after its checks (/api/spectrum) and doesn't
show it. By hand: python3 plant/spectrum.py <job folder>
"""
import subprocess
import sys
import threading
from pathlib import Path

import checks

# Plot area for both channels; the scales add a margin around it. The
# levels shown are per frequency bin, where music sits well below full
# scale: the 50 dB window starts at -20 dBFS.
FILTER = ("showspectrumpic=s=1280x600:mode=separate:legend=1:fscale=lin:start=20:stop=20000"
          ":color=magma:drange=50:limit=-20")


def render(path, out):
    tmp = out.with_name(f".{out.name}.part")
    run = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-lavfi", FILTER,
                          "-frames:v", "1", "-f", "image2", "-c:v", "png", str(tmp)], capture_output=True, text=True)
    if run.returncode:
        tmp.unlink(missing_ok=True)
        raise ValueError(run.stderr.strip() or "ffmpeg failed")
    tmp.replace(out)


# Job folder → {"file", "index", "count"} while its spectrograms are
# plotted; the page's change poll shows it (/api/job/stamp).
PROGRESS = {}


def job(folder, names=None):
    """Spectrograms for every audio file of the job — or only the ones in
    names (the page's managed files) — that has none, or one older than
    the file or this code; stale ones removed."""
    out = folder / "spectrum"
    audio = [p for p in sorted(folder.iterdir()) if p.is_file() and p.suffix.lower() in checks.AUDIO_EXT
             and not p.name.startswith(".") and (names is None or p.name in names)]
    wanted = {out / f"{p.name}.png": p for p in audio}
    if wanted:
        out.mkdir(exist_ok=True)
    code = Path(__file__).stat().st_mtime  # a change here redraws them all
    todo = [(png, path) for png, path in wanted.items()
            if not png.exists() or png.stat().st_mtime < max(path.stat().st_mtime, code)]
    try:
        for index, (png, path) in enumerate(todo, 1):
            PROGRESS[folder] = {"file": path.name, "index": index, "count": len(todo)}
            try:
                render(path, png)
            except (ValueError, OSError) as error:
                print(f"spectrum {path.name}: {error}", file=sys.stderr)
    finally:
        PROGRESS.pop(folder, None)
    for png in out.glob("*.png") if out.is_dir() else []:
        if png not in wanted:
            png.unlink()


RUNNING = set()
RUNNING_LOCK = threading.Lock()


def start(folder, names=None):
    """job(folder, names) in a background thread, once at a time per folder."""
    with RUNNING_LOCK:
        if folder in RUNNING:
            return
        RUNNING.add(folder)

    def run():
        try:
            job(folder, names)
        except OSError as error:  # e.g. the job was moved meanwhile
            print(f"spectrum {folder.name}: {error}", file=sys.stderr)
        finally:
            with RUNNING_LOCK:
                RUNNING.discard(folder)
    threading.Thread(target=run, daemon=True).start()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("python3 plant/spectrum.py <job folder>")
    job(Path(sys.argv[1]))
