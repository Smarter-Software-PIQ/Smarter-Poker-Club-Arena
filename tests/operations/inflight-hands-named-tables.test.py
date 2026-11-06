#!/usr/bin/env python3
"""The in-flight witness proves every table the engine named (2026-11-06).

engine-release-inflight-hands.py --tables proves each named cards_in_air table
on top of the fleet-wide read: no incomplete snapshot for that table in the
window, and, for a held original that never started, no snapshot row for that
hand at all. Any failure refuses; malformed names are UNKNOWN, never skipped.
"""
import importlib.util
import pathlib
import sys
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "inflight_hands", ROOT / "server/scripts/engine-release-inflight-hands.py")
H = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(H)

T1 = "72417d9c-f9ff-417b-b902-26016d4a2571"
T2 = "aed78e3f-850b-4929-bb1d-1503449b41ce"
ENV = {"SUPABASE_URL": "https://kuklfnapbkmacvwxktbh.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "x"}


def run(tables, answers):
    """answers(url) -> rows. Returns the exit code main() raised."""
    argv = ["inflight", "--env-file", "/dev/null", "--max-age-seconds", "600"]
    if tables is not None:
        argv += ["--tables", tables]
    calls = []

    def fake_get(url, *_a, **_k):
        calls.append(url)
        return answers(url)

    with mock.patch.object(sys, "argv", argv), \
            mock.patch.object(H, "read_fixed_env", return_value=ENV), \
            mock.patch.object(H, "get_json", side_effect=fake_get):
        with self_exit() as code:
            H.main()
    return code[0], calls


class self_exit:
    def __enter__(self):
        self.code = [None]
        return self.code

    def __exit__(self, kind, value, _tb):
        if kind is SystemExit:
            self.code[0] = value.code
            return True
        return False


def quiet(_url):
    return []


class NamedTables(unittest.TestCase):
    def test_no_names_is_the_fleet_read_alone(self):
        code, calls = run(None, quiet)
        self.assertEqual(code, H.EXIT_QUIET)
        self.assertEqual(len(calls), 1)

    def test_every_named_table_is_read_and_a_held_hand_must_never_have_started(self):
        code, calls = run(f"{T1}:55620681,{T2}", quiet)
        self.assertEqual(code, H.EXIT_QUIET)
        self.assertEqual(len(calls), 4)  # fleet + T1 in-flight + T1 hand + T2 in-flight
        self.assertTrue(any(f"table_id=eq.{T1}" in c and "hand_number=eq.55620681" in c for c in calls))

    def test_a_named_table_with_a_moving_hand_refuses(self):
        code, _ = run(T1, lambda url: [{"table_id": T1}] if f"table_id=eq.{T1}" in url else [])
        self.assertEqual(code, H.EXIT_HAND_IN_AIR)

    def test_a_held_hand_that_started_refuses(self):
        code, _ = run(f"{T1}:55620681", lambda url: [{"table_id": T1}] if "hand_number=eq.55620681" in url else [])
        self.assertEqual(code, H.EXIT_HAND_IN_AIR)

    def test_the_fleet_read_still_decides_first(self):
        code, calls = run(T1, lambda url: [{"table_id": T2, "hand_number": 1}] if "table_id=eq." not in url else [])
        self.assertEqual(code, H.EXIT_HAND_IN_AIR)

    def test_an_unreadable_per_table_answer_is_unknown(self):
        code, _ = run(T1, lambda url: {"error": 1} if f"table_id=eq.{T1}" in url else [])
        self.assertEqual(code, H.EXIT_UNKNOWN)

    def test_malformed_names_are_unknown_before_any_read(self):
        for bad in ("not-a-uuid", f"{T1}:abc", f"{T1}:", ",".join([T1] * 65)):
            code, calls = run(bad, quiet)
            self.assertEqual(code, H.EXIT_UNKNOWN, bad)
            self.assertEqual(calls, [], bad)


if __name__ == "__main__":
    unittest.main()
