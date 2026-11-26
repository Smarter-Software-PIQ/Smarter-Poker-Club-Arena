#!/usr/bin/env python3
"""Proof for scripts/ci/cutover-outcome-ledger.py and its wiring (CR1, 2026-11-24).

Two consecutive refusals on the same gate fail; a seal (or selection, or a
different gate) resets; a receiver that did not seal is caught one cycle late;
an unreadable previous ledger is "could not tell" (exit 2), never a pass; the
real Nov 18-24 refusal strings classify to their gates; the seed is the
backfill; and stage-engine-release.yml runs the record inside its existing run
without the release signal depending on it.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/ci/cutover-outcome-ledger.py"
SEED = ROOT / "scripts/ci/cutover-outcome-ledger-seed.json"
WORKFLOW = ROOT / ".github/workflows/stage-engine-release.yml"

spec = importlib.util.spec_from_file_location("ledger", SCRIPT)
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)

A = "a" * 40
B = "b" * 40
C = "c" * 40


def keep(reason: str, sha: str = C, serving: str = A) -> dict:
    return {"schema": 1, "outcome": "keep-serving", "reason": "No newer protected candidate has complete current evidence by the cutoff.",
            "servingSha": serving, "targetSha": None, "deferredCandidates": [{"sha": sha, "reason": reason}]}


def selected(target: str = B, serving: str = A) -> dict:
    return {"schema": 1, "outcome": "selected", "reason": "selected", "servingSha": serving, "targetSha": target, "deferredCandidates": []}


class Run:
    """Drives the CLI exactly as the workflow does, one cycle at a time."""

    def __init__(self, test: unittest.TestCase, seed: list | None = None):
        self.test = test
        self.dir = Path(tempfile.mkdtemp())
        self.previous = None
        (self.dir / "seed.json").write_text(json.dumps({"schema": 1, "records": seed or []}))
        self.n = 0

    def cycle(self, selection: dict | str, cycle: str):
        self.n += 1
        sel = self.dir / f"sel{self.n}.json"
        sel.write_text(selection if isinstance(selection, str) else json.dumps(selection))
        out = self.dir / f"ledger{self.n}.json"
        ver = self.dir / f"verdict{self.n}.json"
        args = [sys.executable, "-B", str(SCRIPT), "record", "--selection", str(sel), "--cycle", cycle,
                "--run-id", str(1000 + self.n), "--seed", str(self.dir / "seed.json"), "--output", str(out), "--verdict", str(ver)]
        if self.previous:
            args += ["--previous-ledger", str(self.previous)]
        proc = subprocess.run(args, capture_output=True, text=True)
        if proc.returncode in (0, 3):
            self.previous = out
        return proc.returncode, proc.stdout + proc.stderr, json.loads(ver.read_text())


class Check(unittest.TestCase):
    def test_two_identical_refusals_fail_naming_the_gate(self):
        r = Run(self)
        code, _, _ = r.cycle(keep("serving rollback rehearsal unavailable"), "2026-11-24T07")
        self.assertEqual(code, 0, "one refusal is not yet a repeat")
        code, out, v = r.cycle(keep("serving rollback rehearsal unavailable", sha=B), "2026-11-24T10")
        self.assertEqual(code, 3)
        self.assertTrue(v["repeated"])
        self.assertEqual(v["gate"], "serving-rollback-rehearsal-unavailable")
        self.assertIn("::error title=Engine cutover refused twice on the same gate: serving-rollback-rehearsal-unavailable::", out)
        self.assertIn("2026-11-24T07, 2026-11-24T10", out)

    def test_different_migrations_are_the_same_gate(self):
        r = Run(self)
        r.cycle(keep("Backup copy lacks installed migration 20261121033455"), "2026-11-22T01")
        code, _, v = r.cycle(keep("Backup copy lacks installed migration 20261121152102, 20261121171027 and 4 more"), "2026-11-22")
        self.assertEqual((code, v["gate"]), (3, "backup-lacks-installed-migration"))

    def test_a_seal_resets(self):
        r = Run(self)
        r.cycle(keep("hand-gap regression: 15 of 290 hands over budget"), "2026-11-24T10")
        r.cycle(selected(target=B, serving=A), "2026-11-24T13")
        code, _, v = r.cycle(keep("hand-gap regression: 3 of 300 hands over budget", serving=B), "2026-11-24T16")
        self.assertEqual(code, 0, "the seal between the two refusals resets the streak")
        led = json.loads(r.previous.read_text())["records"]
        self.assertEqual(led[-2]["outcome"], "sealed", "serving moved to the selected target: sealed")
        self.assertEqual(v["streak"], 1)

    def test_a_different_gate_resets(self):
        r = Run(self)
        r.cycle(keep("prequalification unavailable"), "2026-11-21")
        code, _, v = r.cycle(keep("serving rollback rehearsal unavailable"), "2026-11-21T16")
        self.assertEqual((code, v["streak"]), (0, 1))

    def test_nothing_newer_to_ship_resets(self):
        r = Run(self)
        r.cycle(keep("prequalification unavailable"), "2026-11-21")
        r.cycle({"schema": 1, "outcome": "keep-serving", "reason": "current", "servingSha": A, "targetSha": None, "deferredCandidates": []}, "2026-11-21T16")
        code, _, _ = r.cycle(keep("prequalification unavailable"), "2026-11-21T19")
        self.assertEqual(code, 0)

    def test_newer_commits_with_no_certified_candidate_is_a_refusal(self):
        none = {"schema": 1, "outcome": "keep-serving", "reason": "No newer protected candidate has complete current evidence by the cutoff.",
                "servingSha": A, "controlSha": B, "targetSha": None, "deferredCandidates": []}
        r = Run(self)
        r.cycle(none, "2026-11-20")
        code, _, v = r.cycle(dict(none, controlSha=C), "2026-11-20T07")
        self.assertEqual((code, v["gate"]), (3, "no-certified-candidate"))

    def test_a_receiver_that_did_not_seal_twice_fails_one_cycle_late(self):
        r = Run(self)
        r.cycle(selected(target=B, serving=A), "2026-11-24T10")
        code, _, _ = r.cycle(selected(target=C, serving=A), "2026-11-24T13")
        self.assertEqual(code, 0, "one unsealed dispatch is not yet a repeat")
        code, out, v = r.cycle(keep("prequalification unavailable", serving=A), "2026-11-24T16")
        self.assertEqual((code, v["gate"]), (3, "receiver-did-not-seal"))
        self.assertIn("2026-11-24T10, 2026-11-24T13", out)

    def test_another_release_moving_serving_is_not_a_receiver_refusal(self):
        r = Run(self)
        r.cycle(selected(target=B, serving=A), "2026-11-24T10")
        r.cycle(selected(target=B, serving=C), "2026-11-24T13")
        led = json.loads(r.previous.read_text())["records"]
        self.assertEqual(led[-2]["outcome"], "serving-advanced")
        self.assertIsNone(led[-2]["gate"])

    def test_the_same_cycle_recorded_twice_counts_once(self):
        r = Run(self)
        r.cycle(keep("prequalification unavailable"), "2026-11-24T13")
        code, _, v = r.cycle(keep("prequalification unavailable"), "2026-11-24T13")
        self.assertEqual((code, v["streak"]), (0, 1))
        self.assertEqual(len(json.loads(r.previous.read_text())["records"]), 1)

    def test_a_streak_carries_over_from_the_seed(self):
        seed = [ledger.record_from_selection(keep("prequalification unavailable"), "2026-11-24T13", "1")]
        r = Run(self, seed=seed)
        code, _, _ = r.cycle(keep("prequalification unavailable"), "2026-11-24T16")
        self.assertEqual(code, 3)

    def test_unreadable_inputs_are_could_not_tell_never_a_pass(self):
        r = Run(self)
        r.previous = r.dir / "missing-ledger.json"
        code, out, v = r.cycle(keep("prequalification unavailable"), "2026-11-24T16")
        self.assertEqual(code, 2)
        self.assertIn("could not tell", out.lower())
        r2 = Run(self)
        code, _, _ = r2.cycle("{not json", "2026-11-24T16")
        self.assertEqual(code, 2)
        code, _, _ = r2.cycle({"outcome": "maybe"}, "2026-11-24T16")
        self.assertEqual(code, 2)

    def test_real_refusal_strings_name_their_gates(self):
        cases = {
            "Backup copy lacks installed migration 20261117193740, 20261118080240": "backup-lacks-installed-migration",
            "Backup copy lacks the exact candidate migration(s) 20261119013426, 20261119013430": "backup-lacks-candidate-migration",
            "Backup copy holds migration production does not have 20261123002808": "backup-holds-migration-production-lacks",
            "serving rollback rehearsal unavailable": "serving-rollback-rehearsal-unavailable",
            "prequalification unavailable": "prequalification-unavailable",
            "hand-gap regression": "hand-gap-regression",
            "": "unrecorded-refusal",
        }
        for reason, gate in cases.items():
            self.assertEqual(ledger.classify(reason), gate, reason)
        self.assertEqual(ledger.classify("Gate X failed on 20261124085047 for abcdef1234567"),
                         ledger.classify("Gate X failed on 20261124099999 for 1234567abcdef"))

    def test_the_committed_seed_is_the_nov_18_to_24_backfill(self):
        records = json.loads(SEED.read_text())["records"]
        cycles = [r["cycle"] for r in records]
        self.assertEqual(cycles[0], "2026-11-18")
        self.assertTrue(any(c.startswith("2026-11-24") for c in cycles))
        self.assertEqual(len(cycles), len(set(cycles)))
        for r in records:
            self.assertIn(r["outcome"], {"keep-serving", "blocked", "selected", "sealed", "not-sealed", "serving-advanced"})
            if r["outcome"] == "keep-serving" and r.get("reason") != "current":
                self.assertTrue(r["gate"], r["cycle"])


class Wiring(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text()
        m = re.search(r"\n  cutover-outcome-record:\n(.*?)(?=\n  [a-z][a-z0-9-]*:\n)", self.text, re.S)
        self.assertIsNotNone(m, "stage-engine-release.yml has a cutover-outcome-record job")
        self.job = m.group(1)

    def test_runs_inside_the_existing_run_after_selection(self):
        # O32 (2026-11-26): it also reads the look-back's gaps, from a job that
        # needs nothing and never waits (tests/every-cycle-has-an-owner-or-says-so.law.test.ts).
        self.assertRegex(self.job, r"needs: \[detect, selection, cycle-look-back\]")
        self.assertIn("needs.detect.outputs.daily_preparation == 'true'", self.job)
        self.assertIn("needs.detect.outputs.owner_window_id == ''", self.job)
        self.assertIn("github.run_attempt == 1", self.job)
        self.assertIn("scripts/ci/cutover-outcome-ledger.py record", self.job)
        self.assertIn("name: cutover-outcome-ledger", self.job)
        self.assertNotIn("continue-on-error: true", self.job, "a repeated refusal must fail the run")

    def test_detection_only(self):
        for verb in ("dispatches", "repository_dispatch", "workflow_dispatch", "actions: write", "contents: write"):
            self.assertNotIn(verb if verb != "dispatches" else "/dispatches", self.job)

    def test_the_release_signal_does_not_depend_on_it(self):
        sig = re.search(r"\n  signal:\n(.*?)(?=\n  [a-z][a-z0-9-]*:\n|\Z)", self.text, re.S).group(1)
        self.assertNotIn("cutover-outcome-record", sig)

    def test_no_new_schedule(self):
        self.assertEqual(self.text.count("- cron:"), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
