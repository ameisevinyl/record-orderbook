import io
import shutil
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

from checks import aiff_markers as read_markers, probe_facts, run


def aiff_markers(data):
    return read_markers(io.BytesIO(data))

HAS_FFMPEG = bool(shutil.which("ffprobe") and shutil.which("ffmpeg"))


def chunk(chunk_id, body, endian=">"):
    pad = b"\0" if len(body) % 2 else b""
    return chunk_id + struct.pack(endian + "I", len(body)) + body + pad


def pstring(text):
    raw = bytes([len(text)]) + text
    return raw + (b"\0" if len(raw) % 2 else b"")


def aiff_with_marks(marks, extra=b""):
    body = struct.pack(">H", len(marks)) + b"".join(
        struct.pack(">HI", i + 1, pos) + pstring(name) for i, (pos, name) in enumerate(marks))
    form = b"AIFF" + extra + chunk(b"MARK", body)
    return b"FORM" + struct.pack(">I", len(form)) + form


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


class AiffMarkersTest(unittest.TestCase):
    def test_reads_positions_and_names(self):
        data = aiff_with_marks([(0, b"Intro"), (44100, b"Verse")])
        self.assertEqual(aiff_markers(data), [(0, "Intro"), (44100, "Verse")])

    def test_skips_odd_sized_chunk_before_mark(self):
        data = aiff_with_marks([(10, b"A")], extra=chunk(b"ANNO", b"odd"))
        self.assertEqual(aiff_markers(data), [(10, "A")])

    def test_sorted_by_position(self):
        data = aiff_with_marks([(500, b"late"), (5, b"early")])
        self.assertEqual([pos for pos, _ in aiff_markers(data)], [5, 500])

    def test_no_mark_chunk_or_not_aiff(self):
        form = b"AIFF" + chunk(b"ANNO", b"x")
        self.assertEqual(aiff_markers(b"FORM" + struct.pack(">I", len(form)) + form), [])
        self.assertEqual(aiff_markers(b"RIFF\0\0\0\0WAVE"), [])

    def test_truncated_mark_chunk_keeps_what_was_read(self):
        data = aiff_with_marks([(1, b"one"), (2, b"two")])
        self.assertEqual(aiff_markers(data[:-4]), [(1, "one")])


@unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg")
class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_wav_facts_software_and_cue_markers(self):
        wav = self.dir / "t.wav"
        ffmpeg("-f", "lavfi", "-i", "sine=d=2", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le",
               "-write_bext", "1", "-metadata", "title=My Way", "-metadata", "originator=WaveLab 11",
               "-metadata", "coding_history=A=PCM,F=48000,W=24", str(wav))
        # cue  (RIFF): count, then per point id, position, fccChunk,
        # chunkStart, blockStart, sampleOffset; LIST/adtl/labl: id + text.
        data = bytearray(wav.read_bytes())
        cue = struct.pack("<I", 1) + struct.pack("<II4sIII", 1, 0, b"data", 0, 0, 48000)
        labl = chunk(b"labl", struct.pack("<I", 1) + b"Verse\0", "<")
        data += chunk(b"cue ", cue, "<") + chunk(b"LIST", b"adtl" + labl, "<")
        struct.pack_into("<I", data, 4, len(data) - 8)
        wav.write_bytes(data)

        facts = probe_facts(wav)
        self.assertEqual((facts["container"], facts["codec"]), ("wav", "pcm_s24le"))
        self.assertEqual((facts["sampleRate"], facts["bitsPerSample"], facts["channels"]), (48000, 24, 2))
        self.assertAlmostEqual(facts["duration"], 2.0, places=2)
        self.assertEqual(facts["title"], "My Way")
        self.assertIn("WaveLab 11", facts["software"])
        self.assertIn("A=PCM,F=48000,W=24", facts["software"])
        self.assertEqual(facts["markers"], [{"seconds": 1.0, "label": "Verse"}])
        self.assertEqual(facts["spec"], {"encoding": "PCM", "encodingSupported": True,
                                         "bitsPerSample": 24, "sampleRate": 48000})

    def test_aiff_markers_in_seconds(self):
        aiff = self.dir / "t.aiff"
        ffmpeg("-f", "lavfi", "-i", "sine=d=2", "-ar", "44100", "-c:a", "pcm_s16be", str(aiff))
        data = bytearray(aiff.read_bytes())
        body = struct.pack(">H", 1) + struct.pack(">HI", 1, 22050) + pstring(b"half")
        data += chunk(b"MARK", body)
        struct.pack_into(">I", data, 4, len(data) - 8)
        aiff.write_bytes(data)
        facts = probe_facts(aiff)
        self.assertEqual(facts["markers"], [{"seconds": 0.5, "label": "half"}])
        self.assertEqual(facts["bitsPerSample"], 16)

    def test_compressed_file_is_not_supported_pcm(self):
        mp3 = self.dir / "t.mp3"
        ffmpeg("-f", "lavfi", "-i", "sine=d=1", str(mp3))
        facts = probe_facts(mp3)
        self.assertEqual(facts["codec"], "mp3")
        self.assertFalse(facts["spec"]["encodingSupported"])

    def test_unreadable_file_gets_error(self):
        bad = self.dir / "bad.wav"
        bad.write_bytes(b"not audio")
        self.assertIn("error", probe_facts(bad))

    def test_run_writes_facts_and_previews_outside_project(self):
        project = self.dir / "work" / "p" / "p"
        project.mkdir(parents=True)
        (project / "project.json").write_text("{}")
        (project / "cover.pdf").write_bytes(b"%PDF")
        ffmpeg("-f", "lavfi", "-i", "sine=d=1", "-c:a", "pcm_s16le", str(project / "A1.wav"))
        out = self.dir / "work" / "p.checks"
        result = run(project, out)
        self.assertEqual(list(result["files"]), ["A1.wav"])
        facts = result["files"]["A1.wav"]
        self.assertTrue((out / facts["preview"]).is_file())
        self.assertTrue((out / facts["waveform"]).is_file())
        self.assertTrue((out / "facts.json").is_file())
        self.assertEqual(sorted(p.name for p in project.iterdir()), ["A1.wav", "cover.pdf", "project.json"])


class ArtworkWiringTest(unittest.TestCase):
    def test_run_passes_params_and_keeps_audio_errors_separate(self):
        import checks
        saved_which, saved_artwork = checks.shutil.which, checks.artwork_facts
        checks.shutil.which = lambda name: None
        checks.artwork_facts = lambda path, params, out_dir, base: {"page": params["page"], "base": base}
        try:
            with tempfile.TemporaryDirectory() as tmp:
                project = Path(tmp) / "p"
                project.mkdir()
                (project / "L.pdf").write_bytes(b"%PDF")
                result = run(project, Path(tmp) / "out", {"L.pdf": {"page": 2}, "gone.pdf": {"page": 1}})
            self.assertEqual(result["error"], "needs ffmpeg")
            self.assertEqual(result["artwork"]["L.pdf"], {"page": 2, "base": "L.pdf"})
            self.assertEqual(result["artwork"]["gone.pdf"], {"error": "not in the zip"})
        finally:
            checks.shutil.which, checks.artwork_facts = saved_which, saved_artwork


class NoFfmpegTest(unittest.TestCase):
    def test_run_says_needs_ffmpeg(self):
        import checks
        saved = checks.shutil.which
        checks.shutil.which = lambda name: None
        try:
            with tempfile.TemporaryDirectory() as tmp:
                self.assertEqual(run(Path(tmp), Path(tmp) / "out"), {"error": "needs ffmpeg", "artwork": {}})
        finally:
            checks.shutil.which = saved


if __name__ == "__main__":
    unittest.main()
