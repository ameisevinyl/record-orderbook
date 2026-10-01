"""Output profiles (CONFIG.printProfiles) for plant-side colour fixes:
downloaded into plant/icc/ when missing — never committed. A .zip URL
yields its member with the profile's file name (__MACOSX/ copies skipped)."""
import io
import threading
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ICC_DIR = Path(__file__).resolve().parent / "icc"
LOCK = threading.Lock()


class ProfileError(Exception):
    """A profile that isn't there and couldn't be downloaded."""


def _file(spec):
    name = spec.get("file", "")
    if not name.endswith(".icc") or "/" in name or "\\" in name or name.startswith("."):
        raise ProfileError(f"bad profile file name: {name!r}")
    return name


def path(spec, icc_dir=ICC_DIR):
    target = Path(icc_dir) / _file(spec)
    return target if target.is_file() else None


def ensure(spec, icc_dir=ICC_DIR):
    found = path(spec, icc_dir)
    if found:
        return found
    name = _file(spec)
    with LOCK:
        if path(spec, icc_dir):
            return path(spec, icc_dir)
        try:
            with urllib.request.urlopen(spec["url"], timeout=60) as response:
                data = response.read()
            if spec["url"].lower().endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(data)) as zf:
                    members = [m for m in zf.namelist()
                               if PurePosixPath(m).name == name and not m.startswith("__MACOSX/")]
                    if not members:
                        raise ProfileError(f"{spec['name']}: {name} is not in {spec['url']}")
                    data = zf.read(members[0])
        except ProfileError:
            raise
        except (OSError, zipfile.BadZipFile, ValueError) as error:
            raise ProfileError(f"{spec['name']} not available: {error}") from None
        icc_dir = Path(icc_dir)
        icc_dir.mkdir(parents=True, exist_ok=True)
        part = icc_dir / f".{name}.part"
        part.write_bytes(data)
        part.rename(icc_dir / name)
        return icc_dir / name


def ensure_all(specs, icc_dir=ICC_DIR):
    """Downloads every missing profile in the background; a failure is
    printed and tried again on the next request."""
    for spec in specs.values():
        if path(spec, icc_dir) is None:
            def run(spec=spec):
                try:
                    ensure(spec, icc_dir)
                except ProfileError as error:
                    print(f"profile: {error}")
            threading.Thread(target=run, daemon=True).start()
