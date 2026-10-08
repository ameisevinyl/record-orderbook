import http.client
import unittest
import urllib.error

import vies


def replying(reply, calls=None):
    def fetch(country, number):
        if calls is not None:
            calls.append((country, number))
        return reply
    return fetch


def failing(error):
    def fetch(country, number):
        raise error
    return fetch


class ViesTest(unittest.TestCase):
    def check(self, vat_id, fetch):
        return vies.check(vat_id, fetch=fetch, today="2026-10-09")

    def test_valid_and_invalid_replies(self):
        calls = []
        valid = self.check("de 123.456-789", replying({"isValid": True, "userError": "VALID", "name": "Acme GmbH"}, calls))
        self.assertEqual(valid, {"id": "DE123456789", "status": "valid", "name": "Acme GmbH", "checked": "2026-10-09", "reason": ""})
        self.assertEqual(calls, [("DE", "123456789")])
        invalid = self.check("FR12345678901", replying({"isValid": False, "userError": "INVALID"}))
        self.assertEqual((invalid["status"], invalid["checked"]), ("invalid", "2026-10-09"))

    def test_greece_is_el(self):
        calls = []
        self.assertEqual(self.check("EL123456789", replying({"isValid": True}, calls))["status"], "valid")
        self.assertEqual(calls, [("EL", "123456789")])

    def test_the_service_not_answering_is_not_checked_never_invalid(self):
        for fetch in (failing(urllib.error.URLError("offline")), failing(TimeoutError()), failing(ValueError("not json")),
                      replying({"actionSucceed": False, "errorWrappers": [{"error": "MS_UNAVAILABLE"}]}),
                      replying({"isValid": False, "userError": "MS_UNAVAILABLE"}), replying(None), replying("text")):
            result = self.check("DE123456789", fetch)
            self.assertEqual((result["status"], result["checked"]), ("unchecked", ""), fetch)
            self.assertTrue(result["reason"], "the page shows why there is no answer")

    def test_the_reason_a_number_is_not_checked_is_the_services_or_the_networks(self):
        reasons = [
            (replying({"actionSucceed": False, "errorWrappers": [{"error": "MS_UNAVAILABLE"}]}), "MS_UNAVAILABLE"),
            (replying({"isValid": False, "userError": "MS_MAX_CONCURRENT_REQ"}), "MS_MAX_CONCURRENT_REQ"),
            (failing(urllib.error.URLError("offline")), "URLError: <urlopen error offline>"),
            (failing(http.client.IncompleteRead(b"")), "IncompleteRead"),
            (replying(None), "unexpected reply")]
        for fetch, expected in reasons:
            self.assertIn(expected, self.check("DE123456789", fetch)["reason"])

    def test_the_placeholder_name_is_no_name(self):
        self.assertEqual(self.check("IE6388047V", replying({"isValid": True, "name": "---"}))["name"], "")

    def test_a_number_that_was_never_sent_says_so(self):
        self.assertIn("not an EU", self.check("US123456789", replying({}))["reason"])

    def test_nothing_to_ask_without_a_plausible_member_state_id(self):
        calls = []
        for vat_id in ("D", "1234567", "US123456789", "DE", "DE 12 !"):
            self.assertEqual(self.check(vat_id, replying({"isValid": True}, calls))["status"], "invalid", vat_id)
        self.assertEqual(calls, [])
        self.assertEqual(self.check("  ", replying({}, calls)), {"id": "", "status": "none", "name": "", "checked": "", "reason": ""})
        self.assertEqual(self.check(None, replying({}, calls))["status"], "none")
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
