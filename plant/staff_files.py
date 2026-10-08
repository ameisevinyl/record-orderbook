"""The two staff editors' files (src/pricelist.json, src/plant.config.local.js):
read for the page, written back only when unchanged since the page read
them. The page validates the content; this refuses only what is plainly
not the file."""
import hashlib
import json
import os

from jobs import LOCK, Conflict, JobError


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path, example):
    """{text, hash, exists}. Before the plant has the file, the committed
    example with hash "": writing it back then needs the basis "" (the
    file must still not exist)."""
    try:
        data, exists = path.read_bytes(), True
    except FileNotFoundError:
        data, exists = example.read_bytes(), False
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise JobError(f"{(path if exists else example).name} is not UTF-8") from None
    return {"text": text, "hash": digest(data) if exists else "", "exists": exists}


def check(name, text):
    if name == "pricelist":
        try:
            ok = isinstance(json.loads(text), dict)
        except ValueError:
            ok = False
        if not ok:
            raise JobError("pricelist.json must be a JSON object")
    elif "export const PLANT_CONFIG" not in text:
        raise JobError("plant.config.local.js must export PLANT_CONFIG")


def write(path, text, based_on):
    """Replaces the file unless it changed since the reader saw based_on.
    Temp file + rename: never half-written. Returns the new hash."""
    if not isinstance(text, str) or not isinstance(based_on, str):
        raise JobError("text and basedOn must be text")
    data = text.encode("utf-8")
    with LOCK:
        try:
            now = digest(path.read_bytes())
        except FileNotFoundError:
            now = ""
        if now != based_on:
            raise Conflict(f"{path.name} changed meanwhile — reload and try again")
        tmp = path.with_name(f".{path.name}.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return digest(data)
