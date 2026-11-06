"""Unit tests for the observation-window report (no network, no production data).

Run:  python3 -m unittest ops/tournament-monitor/test_report_24h.py
"""
import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location("report_24h", os.path.join(HERE, "report_24h.py"))


def cycle(n, at, checked=10, expected=10, sha="abc"):
    return {"type": "cycle", "cycle": n, "started_utc": at, "started_chicago": at,
            "checked": checked, "expected": expected, "duration_s": 5.0, "releaseSha": sha, "source_errors": 0}


def record(fp, stage, history, owner=None):
    return {"fingerprint": fp, "stage": stage, "symptom": "lease_missing", "severity": "critical",
            "tournament_name": "Spin", "tournament_id": "11111111", "times_seen": 1,
            "first_seen_chicago": "a", "last_seen_chicago": "b", "release_sha_first_seen": "abc",
            "owner": owner, "stage_history": history}


class ReportTest(unittest.TestCase):
    def run_report(self, cycles, incidents):
        base = tempfile.mkdtemp(prefix="tm-report-")
        os.makedirs(os.path.join(base, "state"))
        os.makedirs(os.path.join(base, "incidents"))
        with open(os.path.join(base, "state/cycles.jsonl"), "w") as fh:
            for c in cycles:
                fh.write(json.dumps(c) + "\n")
        with open(os.path.join(base, "window.json"), "w") as fh:
            json.dump({"started_utc": "2026-11-05T20:00:00Z", "ends_utc": "2026-11-05T20:30:00Z",
                       "started_chicago": "s", "ends_chicago": "e", "duration_hours": 0.5,
                       "status": "complete", "authorized": "test"}, fh)
        for i in incidents:
            with open(os.path.join(base, "incidents", i["fingerprint"] + ".json"), "w") as fh:
                json.dump(i, fh)
        out = os.path.join(base, "report.md")
        module = importlib.util.module_from_spec(SPEC)
        import sys
        argv = sys.argv
        sys.argv = ["report_24h.py", base, out]
        try:
            SPEC.loader.exec_module(module)
            with redirect_stdout(io.StringIO()):
                module.main()
        finally:
            sys.argv = argv
        return open(out).read()

    def test_gap_short_coverage_and_window_bounds(self):
        text = self.run_report([
            cycle(1, "2026-11-05T20:00:00Z"), cycle(2, "2026-11-05T20:03:00Z"),
            cycle(3, "2026-11-05T20:10:00Z", checked=9), cycle(4, "2026-11-05T21:00:00Z")], [])
        self.assertIn("Cycles inside the window: 3 of about 10", text)
        self.assertIn("Gaps over 240 s: 1.", text)
        self.assertIn("checked fewer events than the database listed: 1 (cycles [3])", text)

    def test_unresolved_records_are_listed_and_claims_are_audited(self):
        cleared = record("aaaa", "Cleared, no fix recorded", [
            {"stage": "Detected", "by": "tournament_monitor"},
            {"stage": "Cleared, no fix recorded", "by": "tournament_monitor"}])
        claimed_later = record("bbbb", "Closed", [
            {"stage": "Detected", "by": "tournament_monitor"},
            {"stage": "Cleared, no fix recorded", "by": "tournament_monitor"},
            {"stage": "Closed", "by": "session"}], owner="session")
        cleared_after_claim = record("cccc", "Cleared, no fix recorded", [
            {"stage": "Detected", "by": "tournament_monitor"},
            {"stage": "Investigating", "by": "owner"},
            {"stage": "Cleared, no fix recorded", "by": "tournament_monitor"}], owner="owner")
        text = self.run_report([cycle(1, "2026-11-05T20:00:00Z")], [cleared, claimed_later, cleared_after_claim])
        self.assertIn("root cause not established): 2", text)
        self.assertIn("`aaaa`", text)
        self.assertIn("changed after someone claimed them: 1 ['cccc']", text)


if __name__ == "__main__":
    unittest.main()
