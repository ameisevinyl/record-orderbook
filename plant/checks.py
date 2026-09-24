"""Audio facts for the plant view: probes every audio file of an unpacked
project with ffprobe, reads AIFF markers itself, and renders a prelisten
MP3 and a waveform PNG per file into a separate output folder.

Standard library + ffmpeg on the PATH. The rules that judge these facts
live in src/lib/audio-checks.js.
Run: python3 plant/checks.py <project folder> [<output folder>]
"""
import json
import shutil
import struct
import subprocess
import sys
from pathlib import Path

AUDIO_EXT = {".wav", ".wave", ".bwf", ".aif", ".aiff", ".aifc",
             ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".opus"}
# Tags that name the software a file came from: WAV INFO ISFT (encoder),
# BWF bext originator (encoded_by) and coding history.
SOFTWARE_TAGS = ("encoder", "encoded_by", "coding_history")
WAVE_COLOUR = "#5c5c59"  # --ink-dim in src/plant/index.html


def aiff_markers(data):
    """(position in sample frames, name) per MARK marker, by position.

    MARK: numMarkers(2), then per marker id(2), position(4), name as a
    pstring padded to even length. Chunks are padded to even size."""
    if data[:4] != b"FORM" or data[8:12] not in (b"AIFF", b"AIFC"):
        return []
    offset = 12
    while offset + 8 <= len(data):
        chunk_id, size = data[offset:offset + 4], struct.unpack_from(">I", data, offset + 4)[0]
        if chunk_id == b"MARK":
            end = min(offset + 8 + size, len(data))
            pos = offset + 10
            markers = []
            for _ in range(struct.unpack_from(">H", data, offset + 8)[0]):
                if pos + 7 > end:
                    break
                position, length = struct.unpack_from(">IB", data, pos + 2)
                if pos + 7 + length > end:
                    break
                markers.append((position, data[pos + 7:pos + 7 + length].decode("latin-1")))
                pos += 7 + length + (length + 1) % 2
            return sorted(markers)
        offset += 8 + size + size % 2
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
        markers = [(pos / rate, name) for pos, name in aiff_markers(Path(path).read_bytes())] if rate else []
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


def render_previews(path, out_dir, base):
    """MP3 for prelisten and a mono waveform PNG; returns their names."""
    mp3, png = base + ".mp3", base + ".png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-vn", "-ac", "2", "-b:a", "128k",
                    str(out_dir / mp3)], check=True, capture_output=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-filter_complex",
                    f"aformat=channel_layouts=mono,showwavespic=s=1600x120:colors={WAVE_COLOUR}",
                    "-frames:v", "1", str(out_dir / png)], check=True, capture_output=True)
    return mp3, png


def run(project_dir, out_dir):
    """Facts for every audio file under project_dir, keyed by its name
    relative to it; previews and facts.json go to out_dir (replaced)."""
    if not (shutil.which("ffprobe") and shutil.which("ffmpeg")):
        return {"error": "needs ffmpeg"}
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    files = {}
    for path in sorted(project_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXT:
            continue
        name = path.relative_to(project_dir).as_posix()
        facts = probe_facts(path)
        if "error" not in facts:
            try:
                facts["preview"], facts["waveform"] = render_previews(path, out_dir, name.replace("/", "_"))
            except subprocess.CalledProcessError as error:
                facts["previewError"] = error.stderr.decode(errors="replace").strip() or "ffmpeg failed"
        files[name] = facts
    result = {"files": files}
    (out_dir / "facts.json").write_text(json.dumps(result, indent=1))
    return result


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__.strip().splitlines()[-1])
    project = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) == 3 else project.parent / (project.name + ".checks")
    print(json.dumps(run(project, out), indent=1))
