"""The customer's VAT ID, asked of the EU's VIES service by the plant server
(never by a page). Standard library only; the service's address and the shape of
its reply are kept in URL and parse() — confirm them against the live service
before relying on a result. Any failure to get an answer is "unchecked", never
"invalid": reverse charge is only ever proposed on a number VIES confirmed.
"""
import json
import re
import urllib.request
from datetime import date

URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/{country}/vat/{number}"
TIMEOUT = 8
# VIES prefixes: the 27 member states (Greece is EL) and Northern Ireland.
MEMBERS = {"AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "EL", "HU", "IE", "IT", "LV", "LT",
           "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "XI"}


def split(vat_id):
    """(prefix, number) of a VAT ID typed any way, or None."""
    m = re.fullmatch(r"([A-Z]{2})([A-Z0-9]{2,14})", re.sub(r"[\s.\-]", "", str(vat_id or "")).upper())
    return (m.group(1), m.group(2)) if m and m.group(1) in MEMBERS else None


def fetch(country, number):
    """The service's reply as parsed JSON; raises on any failure."""
    with urllib.request.urlopen(URL.format(country=country, number=number), timeout=TIMEOUT) as res:
        return json.load(res)


def parse(reply):
    """(status, name) of a reply: valid, invalid, or unchecked for anything else."""
    if not isinstance(reply, dict) or reply.get("errorWrappers") or reply.get("actionSucceed") is False:
        return "unchecked", ""
    if reply.get("isValid") is True:
        return "valid", str(reply.get("name") or "")
    if reply.get("isValid") is False and reply.get("userError") in (None, "INVALID"):
        return "invalid", ""
    return "unchecked", ""


def check(vat_id, fetch=fetch, today=None):
    """{id, status: valid|invalid|unchecked|none, name, checked}; checked is
    the date of an answer, "" when there was none."""
    if not str(vat_id or "").strip():
        return {"id": "", "status": "none", "name": "", "checked": ""}
    parts = split(vat_id)
    clean = re.sub(r"[\s.\-]", "", str(vat_id)).upper()
    if parts is None:
        return {"id": clean, "status": "invalid", "name": "", "checked": str(today or date.today())}
    try:
        status, name = parse(fetch(*parts))
    except (OSError, ValueError):
        status, name = "unchecked", ""
    return {"id": clean, "status": status, "name": name, "checked": "" if status == "unchecked" else str(today or date.today())}
