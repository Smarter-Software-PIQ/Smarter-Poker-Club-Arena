#!/usr/bin/env python3
"""Unit tests for the tournament monitor's incident records, CLI and operator-absence finding.

Run:  python3 -m unittest ops/tournament-monitor/test_tournament_monitor.py

Python's unittest only; no network, no production data. Each test gets its own TM_BASE.
"""
import datetime as dt
import importlib.util
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC = importlib.util.spec_from_file_location("tournament_monitor", os.path.join(HERE, "tournament_monitor.py"))
tm = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tm)


def read_text(path):
    with open(path) as f:
        return f.read()


def finding(fp="0123456789abcdef", status="open", symptom="decided_not_settled", severity="critical",
            summary="1 player(s) with chips left and the event is still RUNNING 151 min after its last hand",
            resolved_at=None, test=False, event_id="11111111-2222-3333-4444-555555555555", event_name="Nightly 500"):
    f = {"fingerprint": fp, "status": status, "symptom": symptom, "severity": severity, "summary": summary,
         "event_id": event_id, "event_name": event_name, "format": "MTT", "table_id": None,
         "first_seen": "2026-11-05T20:00:00Z", "last_seen": "2026-11-05T20:03:00Z", "occurrences": 1,
         "details": {"players_with_chips": 1}, "releaseSha": "abc1234", "test": test}
    if resolved_at:
        f["resolved_at"] = resolved_at
    return f


class Base(unittest.TestCase):
    def setUp(self):
        self.base = tempfile.mkdtemp(prefix="tm-test-")
        tm.BASE = self.base
        tm.STATE = os.path.join(self.base, "state")
        tm.INCIDENTS = os.path.join(self.base, "incidents")
        tm.CLAUDE_HEARTBEAT = os.path.join(tm.STATE, "claude_heartbeat")
        os.makedirs(tm.STATE)
        self.now = dt.datetime(2026, 11, 5, 21, 0, 0, tzinfo=dt.timezone.utc)

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def t(self, minutes):
        return self.now + dt.timedelta(minutes=minutes)


class IncidentRecords(Base):
    def test_record_created_once_per_fingerprint_and_times_seen_increments(self):
        fp = "0123456789abcdef"
        fstate = {fp: finding(fp)}
        s1 = tm.sync_incidents(fstate, {fp}, self.t(0), 1)
        self.assertEqual(s1["created_this_cycle"], [fp])
        self.assertEqual(s1["open_count"], 1)
        self.assertEqual(sorted(os.listdir(tm.INCIDENTS)), [f"{fp}.json"])
        rec = tm.load_incident(fp)
        self.assertEqual(rec["stage"], "Detected")
        self.assertEqual(rec["times_seen"], 1)
        self.assertIsNone(rec["owner"])
        self.assertIsNone(rec["resolved_at"])
        self.assertEqual(rec["tournament_id"], "11111111-2222-3333-4444-555555555555")
        self.assertEqual(rec["tournament_name"], "Nightly 500")
        self.assertEqual(rec["format"], "MTT")
        self.assertEqual(rec["severity"], "critical")
        self.assertEqual(rec["stage_history"][0]["stage"], "Detected")
        self.assertEqual(rec["stage_history"][0]["by"], tm.CHECKER_ACTOR)
        self.assertEqual(rec["links"], {"prs": [], "migrations": [], "releases": []})
        # the same fingerprint on later cycles updates the one record; no second file
        fstate[fp]["occurrences"] = 2
        s2 = tm.sync_incidents(fstate, {fp}, self.t(3), 2)
        fstate[fp]["occurrences"] = 3
        s3 = tm.sync_incidents(fstate, {fp}, self.t(6), 3)
        self.assertEqual(s2["created_this_cycle"], [])
        self.assertEqual(s3["created_this_cycle"], [])
        self.assertEqual(len(os.listdir(tm.INCIDENTS)), 1)
        rec = tm.load_incident(fp)
        self.assertEqual(rec["times_seen"], 3)
        self.assertEqual(rec["last_seen_utc"], tm.iso(self.t(6)))
        self.assertEqual(rec["first_seen_utc"], "2026-11-05T20:00:00Z")
        self.assertEqual(rec["last_cycle"], 3)
        self.assertEqual(rec["stage"], "Detected")

    def test_resolve_keeps_record_open_then_reappearance_reopens(self):
        fp = "0123456789abcdef"
        fstate = {fp: finding(fp)}
        tm.sync_incidents(fstate, {fp}, self.t(0), 1)
        tm.advance_incident(fp, "Investigating", "chat-A", "reading the engine logs", now=self.t(1))
        # symptom disappears: the checker marks resolved_at but the record stays open at its stage
        fstate[fp]["status"] = "resolved"
        fstate[fp]["resolved_at"] = tm.iso(self.t(3))
        s = tm.sync_incidents(fstate, set(), self.t(3), 2)
        self.assertEqual(s["symptom_resolved_this_cycle"], [fp])
        rec = tm.load_incident(fp)
        self.assertEqual(rec["resolved_at"], tm.iso(self.t(3)))
        self.assertEqual(rec["stage"], "Investigating")
        self.assertTrue(tm.incident_is_open(rec))
        self.assertEqual(s["open_count"], 1)
        self.assertEqual(s["symptom_active"], 0)
        # a later cycle that does not see it changes nothing
        tm.sync_incidents(fstate, set(), self.t(6), 3)
        self.assertEqual(tm.load_incident(fp)["times_seen"], 1)
        # the symptom returns (findings_state reopens it): the record is reopened and goes back to Detected
        fstate[fp]["status"] = "open"
        fstate[fp].pop("resolved_at")
        s = tm.sync_incidents(fstate, {fp}, self.t(9), 4)
        self.assertEqual(s["reopened_this_cycle"], [fp])
        rec = tm.load_incident(fp)
        self.assertIsNone(rec["resolved_at"])
        self.assertEqual(rec["stage"], "Detected")
        self.assertEqual(rec["times_reopened"], 1)
        self.assertEqual(rec["times_seen"], 2)
        self.assertEqual(rec["stage_history"][-1]["stage"], "Reopened")
        self.assertEqual(rec["stage_history"][-1]["by"], tm.CHECKER_ACTOR)
        self.assertIn("Investigating", rec["stage_history"][-1]["note"])
        self.assertEqual(rec["owner"], "chat-A")
        self.assertEqual(len(os.listdir(tm.INCIDENTS)), 1)

    def test_closed_record_reappearing_is_reopened_and_checker_never_closes_or_deletes(self):
        fp = "0123456789abcdef"
        fstate = {fp: finding(fp)}
        tm.sync_incidents(fstate, {fp}, self.t(0), 1)
        for stage in tm.STAGES[1:]:
            tm.advance_incident(fp, stage, "chat-B", f"done: {stage}", now=self.t(1))
        self.assertEqual(tm.load_incident(fp)["stage"], "Closed")
        self.assertEqual(tm.list_incidents(open_only=True), [])
        # the symptom disappears and even gets pruned from findings_state; the file stays
        s = tm.sync_incidents({}, set(), self.t(5), 2)
        self.assertEqual(s["open_count"], 0)
        self.assertTrue(os.path.exists(tm.incident_path(fp)))
        # it comes back under the same fingerprint as a brand new finding
        s = tm.sync_incidents({fp: finding(fp)}, {fp}, self.t(10), 3)
        self.assertEqual(s["reopened_this_cycle"], [fp])
        rec = tm.load_incident(fp)
        self.assertEqual(rec["stage"], "Detected")
        self.assertEqual(rec["times_reopened"], 1)
        self.assertEqual(s["open_count"], 1)

    def test_checker_absence_finding_gets_no_record(self):
        fstate = {"fedcba9876543210": finding("fedcba9876543210", symptom="no_claude_session", severity="warning",
                                              event_id=None, event_name=None)}
        s = tm.sync_incidents(fstate, set(fstate), self.t(0), 1)
        self.assertEqual(s["created_this_cycle"], [])
        self.assertEqual(s["open_count"], 0)

    def test_test_findings_are_recorded_but_not_counted_as_production(self):
        fp = "0123456789abcdef"
        s = tm.sync_incidents({fp: finding(fp, test=True)}, {fp}, self.t(0), 1)
        self.assertEqual(s["open_count"], 1)
        self.assertEqual(s["open_production"], 0)


class StageOrder(Base):
    def setUp(self):
        super().setUp()
        self.fp = "0123456789abcdef"
        tm.sync_incidents({self.fp: finding(self.fp)}, {self.fp}, self.t(0), 1)

    def test_forward_moves_and_links_and_owner(self):
        rec = tm.advance_incident(self.fp, "Investigating", "chat-A", "claimed", now=self.t(1))
        self.assertEqual(rec["owner"], "chat-A")
        rec = tm.advance_incident(self.fp, "Fix implemented", "chat-A", "root cause in settle path", pr=9700,
                                  now=self.t(2))
        rec = tm.advance_incident(self.fp, "Pushed/merged", "chat-A", "merged", pr=9700, migration="20261105210000",
                                  release="deadbeef", now=self.t(3))
        self.assertEqual(rec["links"], {"prs": [9700], "migrations": ["20261105210000"], "releases": ["deadbeef"]})
        self.assertEqual([h["stage"] for h in rec["stage_history"]],
                         ["Detected", "Investigating", "Fix implemented", "Pushed/merged"])
        # a later chat may advance; the owner stays unless set explicitly
        rec = tm.advance_incident(self.fp, "Deployed", "chat-B", "release on host", now=self.t(4))
        self.assertEqual(rec["owner"], "chat-A")
        rec = tm.advance_incident(self.fp, "Production fix verified", "chat-B", "verified", owner="chat-B",
                                  now=self.t(5))
        self.assertEqual(rec["owner"], "chat-B")
        # skipping stages forward is allowed (the note says what was done)
        rec = tm.advance_incident(self.fp, "Closed", "chat-B", "hardening verified live", now=self.t(6))
        self.assertEqual(rec["stage"], "Closed")
        self.assertEqual(rec["closed_at"], tm.iso(self.t(6)))

    def test_backwards_unknown_and_missing_fields_are_refused(self):
        tm.advance_incident(self.fp, "Deployed", "chat-A", "deployed", now=self.t(1))
        with self.assertRaises(ValueError):
            tm.advance_incident(self.fp, "Investigating", "chat-A", "back", now=self.t(2))
        with self.assertRaises(ValueError):
            tm.advance_incident(self.fp, "Fixed", "chat-A", "typo stage", now=self.t(2))
        with self.assertRaises(ValueError):
            tm.advance_incident(self.fp, "Closed", "", "no actor", now=self.t(2))
        with self.assertRaises(ValueError):
            tm.advance_incident(self.fp, "Closed", "chat-A", "", now=self.t(2))
        with self.assertRaises(ValueError):
            tm.advance_incident("ffffffffffffffff", "Closed", "chat-A", "no such record", now=self.t(2))
        with self.assertRaises(ValueError):
            tm.advance_incident("../etc/passwd", "Closed", "chat-A", "bad fingerprint", now=self.t(2))
        self.assertEqual(tm.load_incident(self.fp)["stage"], "Deployed")

    def test_explicit_reopen_returns_to_detected(self):
        tm.advance_incident(self.fp, "Production fix verified", "chat-A", "verified", now=self.t(1))
        rec = tm.advance_incident(self.fp, "Reopened", "chat-C", "symptom seen in a new event", now=self.t(2))
        self.assertEqual(rec["stage"], "Detected")
        self.assertEqual(rec["times_reopened"], 1)
        self.assertEqual(rec["stage_history"][-1]["stage"], "Reopened")
        self.assertEqual(rec["stage_history"][-1]["by"], "chat-C")

    def test_cli_incident_subcommand(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = tm.entry(["incident", self.fp, "--stage", "Investigating", "--by", "chat-A", "--note", "looking",
                           "--pr", "9700"])
        self.assertEqual(rc, 0)
        self.assertEqual(json.loads(out.getvalue())["stage"], "Investigating")
        self.assertEqual(tm.load_incident(self.fp)["links"]["prs"], [9700])
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            rc = tm.entry(["incident", self.fp, "--stage", "Detected", "--by", "chat-A", "--note", "back"])
        self.assertEqual(rc, 2)
        self.assertIn("refused", err.getvalue())


class Handoff(Base):
    def test_handoff_lists_every_open_incident_and_touches_heartbeat(self):
        fps = {"0123456789abcdef": finding("0123456789abcdef"),
               "1111111111111111": finding("1111111111111111", symptom="no_hand_progress", severity="warning",
                                           summary="No hand recorded for 9 min", event_id="aaaa", event_name="Spin 10"),
               "2222222222222222": finding("2222222222222222", symptom="payouts_missing",
                                           summary="Prize pool 50 but no payout rows", event_id="bbbb", event_name="Sat"),
               "3333333333333333": finding("3333333333333333", symptom="closed_one", event_id="cccc", event_name="Old")}
        tm.sync_incidents(fps, set(fps), self.t(0), 1)
        tm.advance_incident("3333333333333333", "Closed", "chat-Z", "verified", now=self.t(1))
        tm.advance_incident("1111111111111111", "Fix implemented", "chat-A", "fixed in engine", pr=9701, now=self.t(1))
        tm.atomic_write(os.path.join(tm.STATE, "latest.json"), json.dumps({
            "cycle": 42, "ended_utc": tm.iso(self.t(0)), "ended_chicago": tm.chi(self.t(0)),
            "coverage": {"expected": 7, "checked": 6, "unchecked": 1, "by_format": {"MTT": 4, "SPIN": 3},
                         "source_errors": []},
            "findings": {"open_count": 3, "open_critical": 2}, "engine": {"releaseSha": "abc1234"},
            "window": {"status": "observing", "started_chicago": "2026-11-05T14:00:00-06:00",
                       "ends_chicago": "2026-11-06T14:00:00-06:00"}}))
        self.assertFalse(os.path.exists(tm.CLAUDE_HEARTBEAT))
        out = io.StringIO()
        with redirect_stdout(out):
            rc = tm.entry(["handoff", "--by", "chat-next"])
        self.assertEqual(rc, 0)
        text = out.getvalue()
        for fp in ("0123456789abcdef", "1111111111111111", "2222222222222222"):
            self.assertIn(fp, text)
        self.assertNotIn("3333333333333333", text)
        self.assertIn("OPEN INCIDENTS: 3 (2 unclaimed", text)
        self.assertIn("stage: Fix implemented   owner: chat-A", text)
        self.assertIn("owner: UNCLAIMED", text)
        self.assertIn("prs=[9701]", text)
        self.assertIn("Last cycle: #42", text)
        self.assertIn("checked 6/7", text)
        self.assertIn("Window: observing", text)
        self.assertIn("--stage Investigating", text)
        self.assertIn("--stage Closed", text)
        self.assertIn("Previous handoff read: never", text)
        self.assertNotIn(chr(0x2014), text)  # no em dashes in the handoff (CLAUDE.md 10.7)
        hb = tm.load_json(tm.CLAUDE_HEARTBEAT, {})
        self.assertEqual(hb["by"], "chat-next")
        self.assertIsNotNone(tm.parse_ts(hb["at_utc"]))
        # a second read reports the previous reader
        out = io.StringIO()
        with redirect_stdout(out):
            tm.entry(["handoff", "--by", "chat-after"])
        self.assertIn("by chat-next", out.getvalue())

    def test_incidents_open_json(self):
        fps = {"0123456789abcdef": finding("0123456789abcdef"), "3333333333333333": finding("3333333333333333")}
        tm.sync_incidents(fps, set(fps), self.t(0), 1)
        tm.advance_incident("3333333333333333", "Closed", "chat-Z", "verified", now=self.t(1))
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(tm.entry(["incidents", "--open"]), 0)
        recs = json.loads(out.getvalue())
        self.assertEqual([r["fingerprint"] for r in recs], ["0123456789abcdef"])
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(tm.entry(["incidents"]), 0)
        self.assertEqual(len(json.loads(out.getvalue())), 2)


class ClaudeHeartbeat(Base):
    def test_age_never_and_fresh_and_stale(self):
        self.assertEqual(tm.claude_heartbeat_age(self.now), (None, None))
        tm.touch_claude_heartbeat("chat-A", now=self.t(-10))
        age, rec = tm.claude_heartbeat_age(self.now)
        self.assertEqual(age, 600)
        self.assertEqual(rec["by"], "chat-A")
        tm.touch_claude_heartbeat("chat-A", now=self.t(-45))
        age, _ = tm.claude_heartbeat_age(self.now)
        self.assertGreater(age, tm.CLAUDE_HEARTBEAT_MAX_S)

    def test_finding_logic_matches_the_cycle(self):
        """The cycle adds no_claude_session when production incidents are open and the heartbeat is
        missing or older than 30 min; never when nothing is open; never on a fresh heartbeat."""
        def would_fire(now):
            age, _ = tm.claude_heartbeat_age(now)
            open_prod = [r for r in tm.list_incidents(open_only=True) if not r.get("test")]
            return bool(open_prod and (age is None or age > tm.CLAUDE_HEARTBEAT_MAX_S))
        self.assertFalse(would_fire(self.now))                      # nothing open, never read
        fp = "0123456789abcdef"
        tm.sync_incidents({fp: finding(fp)}, {fp}, self.t(0), 1)
        self.assertTrue(would_fire(self.now))                       # open, never read
        tm.touch_claude_heartbeat("chat-A", now=self.t(-5))
        self.assertFalse(would_fire(self.now))                      # read 5 min ago
        self.assertTrue(would_fire(self.t(31)))                     # 36 min later, nobody read again
        tm.advance_incident(fp, "Closed", "chat-A", "verified", now=self.t(31))
        self.assertFalse(would_fire(self.t(60)))                    # closed: absence no longer matters

    def test_cycle_emits_the_absence_finding(self):
        """Run main() with every external source stubbed so the real cycle path adds the finding."""
        fp = "0123456789abcdef"
        tm.sync_incidents({fp: finding(fp)}, {fp}, self.t(-60), 1)
        tm.touch_claude_heartbeat("chat-A", now=self.t(-45))

        class FakeCycle:
            def __init__(self):
                self.start = tm.now_utc()
                self.candidates, self.source_errors, self.events = [], [], {}
                self.health, self.metrics, self.log_lines, self.release_sha = {}, None, [], "abc1234"
                self.suppressed, self.cycle_no = False, 0
            add = tm.Cycle.add

        def fake_run_cycle(prev):
            return FakeCycle(), {"timings": {}, "maint_active": False, "recovery_active": False, "maint": {},
                                 "lease_owner": None, "rebuilds_this_cycle": {}, "recent_done": 0, "settled_recent": 0,
                                 "test_events": 0, "rebuild_hist": {}, "last_maint_end": None, "supabase_requests": 0}
        tm.LOCK = os.path.join(self.base, "run.lock")
        orig = tm.run_cycle
        tm.run_cycle = fake_run_cycle
        try:
            out = io.StringIO()
            with redirect_stdout(out):
                rc = tm.main()
        finally:
            tm.run_cycle = orig
        self.assertEqual(rc, 0)
        latest = tm.load_json(os.path.join(tm.STATE, "latest.json"), {})
        syms = [f["symptom"] for f in latest["findings"]["open"]]
        self.assertIn("no_claude_session", syms)
        f = next(f for f in latest["findings"]["open"] if f["symptom"] == "no_claude_session")
        self.assertIn("no Claude session has read the incident handoff for more than 30 minutes", f["summary"])
        self.assertIn("1 incident(s) are open", f["summary"])
        self.assertEqual(f["details"]["last_reader"], "chat-A")
        self.assertEqual(latest["claude_session"]["last_reader"], "chat-A")
        self.assertTrue(latest["claude_session"]["unattended"])
        self.assertGreaterEqual(latest["claude_session"]["age_minutes"], 45)
        self.assertEqual(latest["incidents"]["open_count"], 1)
        self.assertEqual(latest["incidents"]["unclaimed"], 1)
        # the absence finding does not open an incident of its own
        self.assertEqual(len(os.listdir(tm.INCIDENTS)), 1)
        # cycles.jsonl keeps every existing field and gains the new ones
        line = json.loads(read_text(os.path.join(tm.STATE, "cycles.jsonl")).splitlines()[-1])
        for k in ("type", "cycle", "started_utc", "started_chicago", "ended_utc", "duration_s", "expected", "checked",
                  "by_format", "new_findings", "resolved", "open_findings", "open_critical", "maintenance_active",
                  "releaseSha", "source_errors", "window_status"):
            self.assertIn(k, line)
        self.assertEqual(line["open_incidents"], 1)
        self.assertEqual(line["unclaimed_incidents"], 1)
        # the next chat reads the handoff: the following cycle resolves the absence finding
        tm.touch_claude_heartbeat("chat-B")
        tm.run_cycle = fake_run_cycle
        try:
            with redirect_stdout(io.StringIO()):
                self.assertEqual(tm.main(), 0)
        finally:
            tm.run_cycle = orig
        latest = tm.load_json(os.path.join(tm.STATE, "latest.json"), {})
        self.assertNotIn("no_claude_session", [f["symptom"] for f in latest["findings"]["open"]])
        self.assertFalse(latest["claude_session"]["unattended"])


if __name__ == "__main__":
    unittest.main()
