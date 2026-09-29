import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from PIL import Image

import spectrum


def tone(path, seconds):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"sine=f=1000:d={seconds}",
                    "-ac", "2", str(path)], check=True)


class SpectrumTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_one_fixed_size_with_scales(self):
        tone(self.dir / "a.wav", 2)
        spectrum.render(self.dir / "a.wav", self.dir / "a.png")
        with Image.open(self.dir / "a.png") as im:
            w, h = im.size
        self.assertTrue(w > 1280 and h > 600)  # plot area plus the scales
        self.assertFalse((self.dir / ".a.png.part").exists())

    def test_job_renders_new_files_and_drops_stale_ones(self):
        tone(self.dir / "A1.wav", 2)
        stale = self.dir / "spectrum" / "gone.wav.png"
        stale.parent.mkdir()
        stale.write_bytes(b"old")
        spectrum.job(self.dir)
        png = self.dir / "spectrum" / "A1.wav.png"
        self.assertTrue(png.is_file())
        self.assertFalse(stale.exists())
        made = png.stat().st_mtime_ns
        spectrum.job(self.dir)
        self.assertEqual(png.stat().st_mtime_ns, made)  # up to date: not rendered again

    def test_job_reports_the_file_it_plots(self):
        for name in ("A1.wav", "A2.wav"):
            tone(self.dir / name, 1)
        seen = []
        saved = spectrum.render
        spectrum.render = lambda path, out: seen.append(dict(spectrum.PROGRESS[self.dir]))
        try:
            spectrum.job(self.dir)
        finally:
            spectrum.render = saved
        self.assertEqual(seen, [{"file": "A1.wav", "index": 1, "count": 2}, {"file": "A2.wav", "index": 2, "count": 2}])
        self.assertNotIn(self.dir, spectrum.PROGRESS)

    def test_names_limit_the_spectrograms_to_those_files(self):
        for name in ("A1.wav", "reference.wav"):
            tone(self.dir / name, 1)
        stale = self.dir / "spectrum" / "reference.wav.png"
        stale.parent.mkdir()
        stale.write_bytes(b"old")
        spectrum.job(self.dir, ["A1.wav"])
        self.assertEqual(sorted(p.name for p in (self.dir / "spectrum").iterdir()), ["A1.wav.png"])

    def test_start_runs_in_the_background(self):
        tone(self.dir / "A1.wav", 2)
        spectrum.start(self.dir)
        for _ in range(200):
            if self.dir not in spectrum.RUNNING:
                break
            time.sleep(0.05)
        self.assertTrue((self.dir / "spectrum" / "A1.wav.png").is_file())


if __name__ == "__main__":
    unittest.main()
