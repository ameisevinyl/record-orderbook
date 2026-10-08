"""The customer's VAT ID, asked of the EU's VIES service by the plant server
(never by a page). Standard library only; the service's address and the shape of
its reply are kept in URL and parse() — confirm them against the live service
before relying on a result. Any failure to get an answer is "unchecked", never
"invalid": reverse charge is only ever proposed on a number VIES confirmed.
"""
import http.client
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
    """(status, name, reason) of a reply: valid, invalid, or unchecked for
    anything else, with the service's own word for why in reason."""
    if not isinstance(reply, dict):
        return "unchecked", "", "unexpected reply"
    errors = reply.get("errorWrappers")
    if errors or reply.get("actionSucceed") is False:
        first = errors[0] if isinstance(errors, list) and errors and isinstance(errors[0], dict) else {}
        return "unchecked", "", str(first.get("error") or "the service reported an error")
    if reply.get("isValid") is True:
        name = str(reply.get("name") or "")
        return "valid", "" if not name.strip("- ") else name, ""  # VIES writes --- for a name it withholds
    if reply.get("isValid") is False and reply.get("userError") in (None, "INVALID"):
        return "invalid", "", ""
    return "unchecked", "", str(reply.get("userError") or "unexpected reply")


def check(vat_id, fetch=fetch, today=None):
    """{id, status: valid|invalid|unchecked|none, name, checked, reason};
    checked is the date of an answer, "" when there was none; reason why a
    number is not checked, or invalid without having been asked."""
    if not str(vat_id or "").strip():
        return {"id": "", "status": "none", "name": "", "checked": "", "reason": ""}
    parts = split(vat_id)
    clean = re.sub(r"[\s.\-]", "", str(vat_id)).upper()
    day = str(today or date.today())
    if parts is None:
        return {"id": clean, "status": "invalid", "name": "", "checked": day, "reason": "not an EU VAT ID (country prefix or shape)"}
    try:
        status, name, reason = parse(fetch(*parts))
    except (OSError, ValueError, http.client.HTTPException) as error:
        status, name, reason = "unchecked", "", f"{type(error).__name__}: {error}"
    return {"id": clean, "status": status, "name": name, "checked": "" if status == "unchecked" else day, "reason": reason}
