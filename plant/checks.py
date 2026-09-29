"""Audio facts for the plant view: probes every audio file of an unpacked
project with ffprobe, reads AIFF markers itself, and renders a prelisten
MP3 and a waveform PNG per file into a separate output folder
(the job's .checks/). Facts are cached there per file and reused while
the file is unchanged (see Cache).

Needs ffmpeg on the PATH and the libraries in plant/pyproject.toml
(plant/server.py checks both before it starts). The rules that judge
these facts live in src/lib/audio-checks.js and artwork-checks.js.
Run: python3 plant/checks.py <project folder> [<output folder>]
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

import artwork
from jobs import sha256

AUDIO_EXT = {".wav", ".wave", ".bwf", ".aif", ".aiff", ".aifc",
             ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus"}
# Tags that name the software a file came from: WAV INFO ISFT (encoder),
# BWF bext originator (encoded_by) and coding history.
SOFTWARE_TAGS = ("encoder", "encoded_by", "coding_history")
WAVE_COLOUR = "#5c5c59"  # --ink-dim in src/plant/index.html
# Bump when the facts read from a file change: cached facts then expire.
CHECKS_VERSION = 1


def outputs(facts):
    return [facts[key] for key in ("preview", "waveform", "overlay") if facts.get(key)]


class Cache:
    """Facts per file in out_dir/<kind>.json, with the file's size, mtime
    and sha256. Size and mtime equal: reused. Else the sha256 decides, so
    a file a sync tool only touched isn't checked again. params (artwork:
    ink limit, sizes …) must match too; the JS rules judging the facts
    always run fresh, so changing a rule needs no re-check."""

    def __init__(self, out_dir, kind):
        self.out, self.path = out_dir, out_dir / f"{kind}.json"
        try:
            self.entries = json.loads(self.path.read_text())
        except (OSError, ValueError):
            self.entries = {}
        self.used = {}

    def get(self, path, name, params=None):
        entry, st = self.entries.get(name), path.stat()
        if not entry or entry.get("code") != CHECKS_VERSION or entry.get("params") != params:
            return None
        if not all((self.out / f).is_file() for f in outputs(entry["facts"])):
            return None
        if (entry["size"], entry["mtime"]) != (st.st_size, st.st_mtime_ns):
            if entry["size"] != st.st_size or entry["sha256"] != sha256(path):
                return None
            entry["mtime"] = st.st_mtime_ns
        self.used[name] = entry
        return entry["facts"]

    def put(self, path, name, params, facts):
        st = path.stat()
        self.used[name] = {"size": st.st_size, "mtime": st.st_mtime_ns, "sha256": sha256(path),
                           "code": CHECKS_VERSION, "params": params, "facts": facts}

    def save(self):
        """Keeps what this run used; previews of the rest are removed."""
        keep = {f for entry in self.used.values() for f in outputs(entry["facts"])}
        for entry in self.entries.values():
            for f in outputs(entry.get("facts", {})):
                if f not in keep:
                    (self.out / f).unlink(missing_ok=True)
        self.path.write_text(json.dumps(self.used, indent=1))


def aiff_markers(f):
    """(position in sample frames, name) per MARK marker, by position.

    f: a binary file; chunks are skipped by seeking, so a large side file
    is never read whole. MARK: numMarkers(2), then per marker id(2),
    position(4), name as a pstring padded to even length. Chunks are
    padded to even size."""
    head = f.read(12)
    if head[:4] != b"FORM" or head[8:12] not in (b"AIFF", b"AIFC"):
        return []
    while len(chunk := f.read(8)) == 8:
        size = struct.unpack(">I", chunk[4:])[0]
        if chunk[:4] != b"MARK":
            f.seek(size + size % 2, 1)
            continue
        data = f.read(size)
        pos, markers = 2, []
        for _ in range(struct.unpack_from(">H", data)[0] if len(data) >= 2 else 0):
            if pos + 7 > len(data):
                break
            position, length = struct.unpack_from(">IB", data, pos + 2)
            if pos + 7 + length > len(data):
                break
            markers.append((position, data[pos + 7:pos + 7 + length].decode("latin-1")))
            pos += 7 + length + (length + 1) % 2
        return sorted(markers)
    return []


def ffprobe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", str(path)],
        capture_output=True, text=True)
    if out.returncode:
        raise ValueError(out.stderr.strip() or "ffprobe failed")
    return json.loads(out.stdout)


def probe_facts(path):
    try:
        info = ffprobe(path)
    except ValueError as error:
        return {"error": str(error)}
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
    if stream is None:
        return {"error": "no audio stream"}
    fmt = info["format"]
    tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
    codec = stream["codec_name"]
    rate = int(stream.get("sample_rate") or 0) or None
    bits = int(stream.get("bits_per_sample") or stream.get("bits_per_raw_sample") or 0) or None
    if fmt["format_name"] == "aiff":
        with open(path, "rb") as f:
            markers = [(pos / rate, name) for pos, name in aiff_markers(f)] if rate else []
    else:
        markers = [(float(c["start_time"]), c.get("tags", {}).get("title", "")) for c in info.get("chapters", [])]
    pcm = codec.startswith("pcm_")
    return {
        "container": fmt["format_name"], "codec": codec,
        "sampleRate": rate, "bitsPerSample": bits, "channels": stream.get("channels"),
        "duration": float(fmt.get("duration") or stream.get("duration") or 0),
        "software": [tags[k] for k in SOFTWARE_TAGS if tags.get(k)],
        "title": tags.get("title", ""), "artist": tags.get("artist", ""), "comment": tags.get("comment", ""),
        "markers": [{"seconds": round(s, 3), "label": label} for s, label in markers],
        # Same shape as parseWavSpec/parseAiffSpec in src/lib/audio-duration.js.
        "spec": {"encoding": ("IEEE float" if codec.startswith("pcm_f") else "PCM") if pcm else stream.get("codec_long_name", codec),
                 "encodingSupported": pcm, "bitsPerSample": bits, "sampleRate": rate},
    }


def render_previews(path, out_dir, base, read=lambda n: None):
    """MP3 for prelisten and a mono waveform PNG in one ffmpeg pass;
    returns their names. The file goes in through stdin, so read(n) can
    count the bytes: ffmpeg's own progress stays N/A until the waveform
    output is written at the very end."""
    mp3, png = base + ".mp3", base + ".png"
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", "pipe:0", "-filter_complex",
           f"[0:a]asplit[a][b];[b]aformat=channel_layouts=mono,showwavespic=s=1600x120:colors={WAVE_COLOUR}:filter=peak[w]",
           "-map", "[a]", "-ac", "2", "-b:a", "128k", str(out_dir / mp3),
           "-map", "[w]", "-frames:v", "1", str(out_dir / png)]
    with open(path, "rb") as f, subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE) as proc:
        try:
            while chunk := f.read(1 << 20):
                proc.stdin.write(chunk)
                read(len(chunk))
            proc.stdin.close()
        except BrokenPipeError:
            pass  # ffmpeg stopped early; its exit code and stderr tell why
        err = proc.stderr.read()
    if proc.returncode:
        raise subprocess.CalledProcessError(proc.returncode, cmd, stderr=err)
    return mp3, png


def audio(project_dir, out_dir, progress=lambda fraction: None):
    """Facts for every audio file under project_dir, keyed by its name
    relative to it; previews go to out_dir. progress(fraction) follows
    the bytes read, across all files."""
    # Dot folders are the machine's: .checks/ holds MP3s of its own.
    paths = [p for p in sorted(project_dir.rglob("*")) if p.is_file() and p.suffix.lower() in AUDIO_EXT
             and not any(part.startswith(".") for part in p.relative_to(project_dir).parts)]
    total = sum(p.stat().st_size for p in paths) or 1
    done = 0

    def read(n):
        nonlocal done
        done += n
        progress(min(done / total, 1.0))

    cache = Cache(out_dir, "audio")
    files = {}
    for path in paths:
        name = path.relative_to(project_dir).as_posix()
        facts = cache.get(path, name)
        if facts is not None:
            read(path.stat().st_size)
        else:
            facts = probe_facts(path)
            if "error" not in facts:
                try:
                    facts["preview"], facts["waveform"] = render_previews(path, out_dir, name.replace("/", "_"), read)
                except subprocess.CalledProcessError as error:
                    facts["previewError"] = error.stderr.decode(errors="replace").strip() or "ffmpeg failed"
            cache.put(path, name, None, facts)
        files[name] = facts
    cache.save()
    done = total
    progress(1.0)
    return {"files": files}


def check_artwork(project_dir, out_dir, params_by_name):
    """Facts per artwork file the page asked for, with its part's params."""
    cache = Cache(out_dir, "artwork")
    result = {}
    for name, params in params_by_name.items():
        # Names come from the page: only files inside the project count.
        path = (project_dir / name).resolve()
        if not path.is_relative_to(project_dir.resolve()) or not path.is_file():
            result[name] = {"error": "not in the job"}
            continue
        facts = cache.get(path, name, params)
        if facts is None:
            try:
                facts = artwork.facts(path, params, out_dir, name.replace("/", "_"))
            except Exception as error:  # one broken file must not end the whole check
                result[name] = {"error": f"can't check: {error}"}
                continue
            cache.put(path, name, params, facts)
        result[name] = facts
    cache.save()
    return result


def run(project_dir, out_dir, artwork_params=None):
    """Audio facts plus artwork facts for the files named in
    artwork_params; previews, caches and facts.json go to out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    result = audio(project_dir, out_dir)
    result["artwork"] = check_artwork(project_dir, out_dir, artwork_params or {})
    (out_dir / "facts.json").write_text(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__.strip().splitlines()[-1])
    project = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) == 3 else project / ".checks"
    print(json.dumps(run(project, out), indent=1))
