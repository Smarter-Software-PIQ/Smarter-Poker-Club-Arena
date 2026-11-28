#!/usr/bin/env python3
"""Unit tests for scripts/release/three-hourly-readiness.py (pure mocked inputs)."""
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/release/three-hourly-readiness.py"

spec = importlib.util.spec_from_file_location("three_hourly_readiness", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def _sha(prefix):
    return (prefix * 40)[:40]


def _health(
    release_sha=None,
    frequency="three-hourly",
    start_hours=None,
    phase="idle",
    stalled=0,
):
    return {
        "url": mod.DEFAULT_HEALTH_URL,
        "liveness": "ok",
        "releaseSha": release_sha or _sha("0"),
        "frequency": frequency,
        "startHours": list(
            start_hours
            if start_hours is not None
            else (mod.THREE_HOURLY_START_HOURS if frequency == "three-hourly" else mod.DAILY_START_HOURS)
        ),
        "phase": phase,
        "stalledTables": stalled,
        "deadStalledTables": 0,
        "wholeFleetStalled": False,
    }


def _make_git_stub(control_sha, serving_sha, commits_with_subjects):
    shas = [sha for sha, _ in commits_with_subjects]
    subjects = dict(commits_with_subjects)

    def git_fn(_repo_root, *args):
        if args[:2] == ("rev-parse", "--verify"):
            ref = args[2]
            if ref.startswith(mod.DEFAULT_CONTROL_REF):
                return control_sha
            if ref.startswith(serving_sha):
                return serving_sha
            raise mod.ReadError(f"unknown ref {ref}")
        if args[:2] == ("merge-base", "--is-ancestor"):
            return ""
        if args[:2] == ("rev-list", "--first-parent"):
            return "\n".join(shas)
        if args[:3] == ("show", "-s", "--format=%s"):
            return subjects[args[3]]
        raise AssertionError(f"unexpected git args: {args}")

    return git_fn


class ThreeHourlyReadinessTests(unittest.TestCase):
    # These cases pin certificate, prequalification and schedule rules; copy freshness (O36) has its
    # own class below, so here every certificate's copy reads as current.
    def setUp(self):
        self._real_judge = mod.judge_copy_freshness
        mod.judge_copy_freshness = lambda *_a, **_k: ("fresh", "copy current (test)")

    def tearDown(self):
        mod.judge_copy_freshness = self._real_judge

    def test_schedule_cst_cdt_spring_forward_and_fall_back(self):
        # Ordinary CST (2026-11-21 18:10 CST = 2026-11-22T00:10:00Z -> next 19:00 CST = 01:00Z)
        cst = mod.compute_next_cycle(
            datetime(2026, 11, 22, 0, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(cst["cycleId"], "2026-11-21T19")
        self.assertEqual(cst["cycleStartUtc"], "2026-11-22T01:00:00Z")
        self.assertEqual(cst["cycleStartChicago"], "2026-11-21T19:00:00-06:00")
        self.assertEqual(cst["preparationCutoffUtc"], "2026-11-22T00:30:00Z")
        self.assertEqual(cst["preparationCutoffChicago"], "2026-11-21T18:30:00-06:00")
        self.assertEqual(cst["recommendedHoldStartUtc"], "2026-11-21T23:15:00Z")
        self.assertEqual(cst["recommendedHoldStartChicago"], "2026-11-21T17:15:00-06:00")
        self.assertTrue(cst["inHoldWindow"])
        self.assertFalse(cst["cutoffPassed"])

        # Ordinary CDT (2026-07-15 18:10 CDT = 2026-07-15T23:10:00Z -> next 19:00 CDT = 2026-07-16T00:00:00Z)
        cdt = mod.compute_next_cycle(
            datetime(2026, 7, 15, 23, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(cdt["cycleId"], "2026-07-15T19")
        self.assertEqual(cdt["cycleStartUtc"], "2026-07-16T00:00:00Z")
        self.assertEqual(cdt["cycleStartChicago"], "2026-07-15T19:00:00-05:00")
        self.assertEqual(cdt["preparationCutoffUtc"], "2026-07-15T23:30:00Z")
        self.assertEqual(cdt["recommendedHoldStartUtc"], "2026-07-15T22:15:00Z")

        # Fall-back day 2026-11-01:
        # 05:10Z = 00:10 CDT -> first 01:00 CDT (06:00Z)
        fb_before = mod.compute_next_cycle(
            datetime(2026, 11, 1, 5, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(fb_before["cycleId"], "2026-11-01T01")
        self.assertEqual(fb_before["cycleStartUtc"], "2026-11-01T06:00:00Z")
        self.assertEqual(fb_before["cycleStartChicago"], "2026-11-01T01:00:00-05:00")

        # 06:10Z = 01:10 CDT -> must SKIP repeated 01:00 CST (07:00Z) and advance to 04:00 CST (10:00Z)!
        fb_after = mod.compute_next_cycle(
            datetime(2026, 11, 1, 6, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(fb_after["cycleId"], "2026-11-01")
        self.assertEqual(fb_after["cycleStartUtc"], "2026-11-01T10:00:00Z")
        self.assertEqual(fb_after["cycleStartChicago"], "2026-11-01T04:00:00-06:00")
        self.assertEqual(fb_after["preparationCutoffUtc"], "2026-11-01T09:30:00Z")

        # Spring-forward day 2026-03-08:
        # 07:10Z = 01:10 CST -> 02:00 does not exist; next is 04:00 CDT (09:00Z), 2 real hours after 01:00 CST.
        sf = mod.compute_next_cycle(
            datetime(2026, 3, 8, 7, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(sf["cycleId"], "2026-03-08")
        self.assertEqual(sf["cycleStartUtc"], "2026-03-08T09:00:00Z")
        self.assertEqual(sf["cycleStartChicago"], "2026-03-08T04:00:00-05:00")

        # Daily frequency (04:00 anchor only):
        daily = mod.compute_next_cycle(
            datetime(2026, 11, 21, 11, 0, tzinfo=timezone.utc), "daily"
        )
        self.assertEqual(daily["cycleId"], "2026-11-22")
        self.assertEqual(daily["cycleStartUtc"], "2026-11-22T10:00:00Z")
        self.assertEqual(daily["cycleStartChicago"], "2026-11-22T04:00:00-06:00")
        self.assertEqual(daily["preparationCutoffUtc"], "2026-11-22T09:30:00Z")
        self.assertEqual(daily["recommendedHoldStartUtc"], "2026-11-22T08:15:00Z")

    def test_ready_candidate_with_newer_pending_and_older_control_mismatch(self):
        serving = _sha("0")
        sha_new = _sha("a")
        sha_ready = _sha("b")
        sha_old = _sha("c")
        now = datetime(2026, 11, 22, 0, 20, tzinfo=timezone.utc)

        control_tree = (
            "100644 blob 1111111111111111111111111111111111111111\tscripts/ci/select-daily-engine.py\n"
            "100644 blob 2222222222222222222222222222222222222222\t.github/workflows/backup-engine.yml"
        )
        stale_tree = (
            "100644 blob 9999999999999999999999999999999999999999\tscripts/ci/select-daily-engine.py\n"
            "100644 blob 2222222222222222222222222222222222222222\t.github/workflows/backup-engine.yml"
        )
        projections = {sha_new: control_tree, sha_ready: control_tree, sha_old: stale_tree}

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 9001,
                            "status": "in_progress",
                            "conclusion": None,
                            "display_title": "Automatic Backup daily reservation",
                            "event": "workflow_run",
                            "head_sha": sha_ready,
                            "created_at": "2026-11-21T23:10:00Z",
                            "updated_at": "2026-11-21T23:10:05Z",
                            "html_url": "https://github.com/o/r/actions/runs/9001",
                        }
                    ]
                }
            if "backup-engine.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 9100,
                            "status": "in_progress",
                            "conclusion": None,
                            "display_title": "Backup newest",
                            "event": "push",
                            "head_sha": sha_new,
                            "created_at": "2026-11-22T00:05:00Z",
                            "updated_at": "2026-11-22T00:15:00Z",
                            "html_url": "https://github.com/o/r/actions/runs/9100",
                        }
                    ]
                }
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": sha_new}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 8200,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_new,
                            "run_attempt": 1,
                            "updated_at": "2026-11-22T00:18:00Z",
                            "html_url": "https://github.com/o/r/actions/runs/8200",
                        },
                        {
                            "id": 8100,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_ready,
                            "run_attempt": 1,
                            "updated_at": "2026-11-21T23:55:00Z",
                            "html_url": "https://github.com/o/r/actions/runs/8100",
                        },
                        {
                            "id": 8000,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_old,
                            "run_attempt": 1,
                            "updated_at": "2026-11-21T22:00:00Z",
                            "html_url": "https://github.com/o/r/actions/runs/8000",
                        },
                    ]
                }
            if f"/commits/{sha_new}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": "backup-engine/certified",
                            "state": "pending",
                            "target_url": "https://github.com/o/r/actions/runs/9100",
                            "updated_at": "2026-11-22T00:06:00Z",
                        }
                    ]
                }
            if f"/commits/{sha_ready}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": "backup-engine/certified",
                            "state": "success",
                            "target_url": "https://github.com/o/r/actions/runs/9050",
                            "updated_at": "2026-11-21T23:58:00Z",
                        }
                    ]
                }
            if f"/commits/{sha_old}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": "backup-engine/certified",
                            "state": "success",
                            "target_url": "https://github.com/o/r/actions/runs/9010",
                            "updated_at": "2026-11-21T22:10:00Z",
                        }
                    ]
                }
            raise AssertionError(f"unexpected gh api path: {path}")

        report = mod.collect_readiness(
            repo="o/r",
            limit=10,
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(
                sha_new,
                serving,
                [(sha_new, "feat: newest"), (sha_ready, "fix: ready"), (sha_old, "fix: old")],
            ),
            projection_fn=lambda sha: projections[sha],
        )

        self.assertEqual(report["verdict"], "READY")
        self.assertEqual(report["selectableSha"], sha_ready)
        self.assertIn(sha_ready[:12], report["summary"])
        self.assertEqual([c["status"] for c in report["candidates"]], ["PENDING", "SELECTABLE", "DISQUALIFIED"])
        self.assertEqual(report["candidates"][2]["changedControlPaths"], ["scripts/ci/select-daily-engine.py"])
        self.assertIn("CONTROL_INPUTS mismatch", report["candidates"][2]["reason"])
        self.assertIn("RC=3", report["candidates"][2]["reason"])
        self.assertEqual(len(report["activeRuns"]["stage"]), 1)
        self.assertEqual(len(report["activeRuns"]["backup"]), 1)

        table = mod.render_table(report)
        self.assertIn("Verdict:         READY", table)
        self.assertIn("SELECTABLE", table)
        self.assertIn("CONTROL_INPUTS mismatch", table)

    def test_in_flight_when_backup_or_prequal_pending_and_no_selectable(self):
        serving = _sha("0")
        sha_pending = _sha("d")
        now = datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc)

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                return {"workflow_runs": []}
            if "backup-engine.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 777,
                            "status": "in_progress",
                            "event": "push",
                            "head_sha": sha_pending,
                            "display_title": "Backup pending",
                        }
                    ]
                }
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": sha_pending}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 888,
                            "status": "in_progress",
                            "conclusion": None,
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_pending,
                            "run_attempt": 1,
                        }
                    ]
                }
            if f"/commits/{sha_pending}/status" in path:
                return {"statuses": []}
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(sha_pending, serving, [(sha_pending, "feat: pending")]),
            projection_fn=lambda _sha: "same-tree",
        )
        self.assertEqual(report["verdict"], "IN_FLIGHT")
        self.assertIsNone(report["selectableSha"])
        self.assertEqual(report["candidates"][0]["status"], "PENDING")
        self.assertIn("777", report["candidates"][0]["reason"])
        self.assertIn("888", report["candidates"][0]["reason"])

    def test_no_candidate_when_all_disqualified_or_same_as_serving(self):
        serving = _sha("0")
        sha_bad = _sha("e")
        now = datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc)

        def gh_get_disq(path):
            if "workflow" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 555,
                            "status": "completed",
                            "conclusion": "failure",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_bad,
                            "run_attempt": 1,
                        }
                    ]
                    if "prequalification" in path
                    else []
                }
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": sha_bad}}
            if f"/commits/{sha_bad}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": "backup-engine/certified",
                            "state": "success",
                            "target_url": "https://github.com/o/r/actions/runs/554",
                            "updated_at": "2026-11-22T00:05:00Z",
                        }
                    ]
                }
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get_disq,
            git_fn=_make_git_stub(sha_bad, serving, [(sha_bad, "fix: prequal failed")]),
            projection_fn=lambda _sha: "same-tree",
        )
        self.assertEqual(report["verdict"], "NO_CANDIDATE")
        self.assertEqual(report["candidates"][0]["status"], "DISQUALIFIED")
        self.assertIn("prequalification failure (run 555)", report["candidates"][0]["reason"])

        # Also test 0 commits ahead of serving:
        def gh_get_empty(path):
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": serving}}
            return {"workflow_runs": []}

        empty_report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get_empty,
            git_fn=_make_git_stub(serving, serving, []),
            projection_fn=lambda _sha: "same-tree",
        )
        self.assertEqual(empty_report["verdict"], "NO_CANDIDATE")
        self.assertIn("matches serving SHA", empty_report["summary"])

    def test_late_evidence_after_cutoff_is_disqualified_for_this_cycle(self):
        serving = _sha("0")
        sha_late = _sha("f")
        # 00:35Z is 5 minutes AFTER the 00:30Z preparation cutoff for 19:00 CST (01:00Z)
        now = datetime(2026, 11, 22, 0, 35, tzinfo=timezone.utc)

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path or "backup-engine.yml/runs" in path:
                return {"workflow_runs": []}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": sha_late}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 601,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha_late,
                            "run_attempt": 1,
                            "updated_at": "2026-11-22T00:32:00Z",
                        }
                    ]
                }
            if f"/commits/{sha_late}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": "backup-engine/certified",
                            "state": "success",
                            "target_url": "https://github.com/o/r/actions/runs/600",
                            "updated_at": "2026-11-22T00:25:00Z",
                        }
                    ]
                }
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(sha_late, serving, [(sha_late, "fix: late prequal")]),
            projection_fn=lambda _sha: "same-tree",
        )
        self.assertTrue(report["schedule"]["cutoffPassed"])
        self.assertEqual(report["candidates"][0]["status"], "DISQUALIFIED")
        self.assertIn("completed after 2026-11-22T00:30:00Z cutoff", report["candidates"][0]["reason"])
        self.assertEqual(report["verdict"], "NO_CANDIDATE")

    def test_unreadable_health_or_api_yields_unknown_never_ready(self):
        # 1. Unreadable /health
        r1 = mod.collect_readiness(
            repo="o/r",
            now_utc=datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc),
            health_fn=lambda: (_ for _ in ()).throw(mod.ReadError("/health timeout")),
        )
        self.assertEqual(r1["verdict"], "UNKNOWN")
        self.assertIn("/health timeout", r1["summary"])

        # 2. Malformed /health payload
        with self.assertRaises(mod.ReadError):
            mod.parse_health_payload({"releaseSha": "not-a-sha"})

        # 3. Unreadable GitHub API
        r2 = mod.collect_readiness(
            repo="o/r",
            now_utc=datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc),
            health_fn=lambda: _health(release_sha=_sha("0")),
            gh_get_fn=lambda _path: (_ for _ in ()).throw(mod.ReadError("gh api HTTP 502")),
        )
        self.assertEqual(r2["verdict"], "UNKNOWN")
        self.assertIn("HTTP 502", r2["summary"])

        # 4. Unreadable projection()
        serving = _sha("0")
        head = _sha("1")

        def gh_ok(path):
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": head}}
            return {"workflow_runs": []}

        r3 = mod.collect_readiness(
            repo="o/r",
            now_utc=datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc),
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_ok,
            git_fn=_make_git_stub(head, serving, [(head, "feat: x")]),
            projection_fn=lambda _sha: (_ for _ in ()).throw(mod.ReadError("projection failed")),
        )
        self.assertEqual(r3["verdict"], "UNKNOWN")
        self.assertIn("projection failed", r3["summary"])

    def test_json_cli_output_and_exit_codes(self):
        ready_report = {
            "schema": 1,
            "verdict": "READY",
            "summary": "selectable candidate bbbbbbbbbbbb",
            "checkedAtUtc": "2026-11-22T00:20:00Z",
            "checkedAtChicago": "2026-11-21T18:20:00-06:00",
            "checkedAtChicagoLabel": "2026-11-21 18:20:00 CST",
            "repo": "o/r",
            "health": _health(),
            "schedule": mod.compute_next_cycle(
                datetime(2026, 11, 22, 0, 20, tzinfo=timezone.utc), "three-hourly"
            ),
            "git": None,
            "activeRuns": {"stage": [], "backup": []},
            "selectableSha": _sha("b"),
            "candidates": [],
            "errors": [],
        }
        buf = io.StringIO()
        with patch.object(mod, "collect_readiness", return_value=ready_report), redirect_stdout(buf):
            rc = mod.main(["--json", "--limit", "5", "--repo", "o/r"])
        self.assertEqual(rc, 0)
        parsed = json.loads(buf.getvalue())
        self.assertEqual(parsed["verdict"], "READY")
        self.assertEqual(parsed["selectableSha"], _sha("b"))

        unknown_report = dict(ready_report, verdict="UNKNOWN", selectableSha=None, errors=["api down"])
        buf2 = io.StringIO()
        with patch.object(mod, "collect_readiness", return_value=unknown_report), redirect_stdout(buf2):
            rc2 = mod.main(["--json"])
        self.assertEqual(rc2, 3)
        self.assertEqual(json.loads(buf2.getvalue())["verdict"], "UNKNOWN")

    def test_imports_real_prequalification_projection(self):
        prequal = mod.load_prequalification_module(ROOT)
        self.assertTrue(callable(prequal.projection))
        self.assertIn("scripts/ci/read-engine-prequalification.py", prequal.CONTROL_INPUTS)

    def test_repo_dir_works_from_unrelated_temp_directory(self):
        with tempfile.TemporaryDirectory() as outer:
            unrelated_cwd = Path(outer) / "outside"
            unrelated_cwd.mkdir()
            fake_repo = Path(outer) / "repo"
            fake_repo.mkdir()

            def run_git(*args):
                subprocess.run(
                    ["git", "-C", str(fake_repo), *args],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            run_git("init", "-q")
            run_git("config", "user.email", "test@example.com")
            run_git("config", "user.name", "Test")
            helper = fake_repo / "scripts/ci/read-engine-prequalification.py"
            helper.parent.mkdir(parents=True, exist_ok=True)
            helper.write_text(
                "import subprocess\n"
                "def projection(sha):\n"
                "    return subprocess.check_output(['git', 'ls-tree', '-r', sha, '--', 'scripts/ci/read-engine-prequalification.py'], text=True).strip()\n",
                encoding="utf-8",
            )
            run_git("add", "scripts/ci/read-engine-prequalification.py")
            run_git("commit", "-q", "-m", "base commit")
            serving = mod.git_read(fake_repo, "rev-parse", "HEAD")

            (fake_repo / "app.txt").write_text("v2\n", encoding="utf-8")
            run_git("add", "app.txt")
            run_git("commit", "-q", "-m", "feat: candidate change")
            head = mod.git_read(fake_repo, "rev-parse", "HEAD")

            def gh_get(path):
                if "stage-engine-release.yml/runs" in path or "backup-engine.yml/runs" in path:
                    return {"workflow_runs": []}
                if path.endswith("/git/ref/heads/main"):
                    return {"object": {"sha": head}}
                if "engine-release-prequalification.yml/runs" in path:
                    return {
                        "workflow_runs": [
                            {
                                "id": 9501,
                                "status": "completed",
                                "conclusion": "success",
                                "event": "push",
                                "head_branch": "main",
                                "path": mod.PREQUAL_PATH,
                                "head_sha": head,
                                "run_attempt": 1,
                                "updated_at": "2026-11-22T00:10:00Z",
                                "html_url": "https://github.com/o/r/actions/runs/9501",
                            }
                        ]
                    }
                if f"/commits/{head}/status" in path:
                    return {
                        "statuses": [
                            {
                                "context": "backup-engine/certified",
                                "state": "success",
                                "target_url": "https://github.com/o/r/actions/runs/9500",
                                "updated_at": "2026-11-22T00:05:00Z",
                            }
                        ]
                    }
                raise AssertionError(f"unexpected gh api path: {path}")

            prev_cwd = os.getcwd()
            try:
                os.chdir(unrelated_cwd)
                report = mod.collect_readiness(
                    repo="o/r",
                    control_ref="HEAD",
                    repo_dir=str(fake_repo),
                    now_utc=datetime(2026, 11, 22, 0, 20, tzinfo=timezone.utc),
                    health_fn=lambda: _health(release_sha=serving),
                    gh_get_fn=gh_get,
                )
            finally:
                os.chdir(prev_cwd)

            self.assertEqual(report["verdict"], "READY")
            self.assertEqual(report["selectableSha"], head)
            self.assertEqual(report["git"]["repoDir"], str(fake_repo.resolve()))
            self.assertEqual(report["candidates"][0]["status"], "SELECTABLE")
            self.assertTrue(report["candidates"][0]["controlInputsMatch"])

            # Fallback order: when script_root has no .git, resolves from cwd inside a git repo.
            self.assertEqual(
                mod.resolve_repo_root(repo_dir=None, script_root=unrelated_cwd, cwd=fake_repo),
                fake_repo.resolve(),
            )
            with self.assertRaises(mod.ReadError):
                mod.resolve_repo_root(repo_dir=None, script_root=unrelated_cwd, cwd=unrelated_cwd)

    def test_repo_dir_non_git_fails_closed_unknown_exit_3(self):
        with tempfile.TemporaryDirectory() as outer:
            non_git = Path(outer) / "not-a-repo"
            non_git.mkdir()
            missing = Path(outer) / "does-not-exist"

            proc = subprocess.run(
                [sys.executable, "-B", str(SCRIPT), "--repo-dir", str(non_git), "--json"],
                cwd=str(non_git),
                capture_output=True,
                text=True,
                timeout=15,
            )
            self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertEqual(payload["verdict"], "UNKNOWN")
            self.assertIn("not a git repository", payload["summary"])
            self.assertTrue(any("not a git repository" in e for e in payload["errors"]))

            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = mod.main(["--repo-dir", str(missing), "--json"])
            self.assertEqual(rc, 3)
            missing_payload = json.loads(buf.getvalue())
            self.assertEqual(missing_payload["verdict"], "UNKNOWN")
            self.assertIn("not an existing directory", missing_payload["summary"])

    def test_per_cycle_o3_deferral_and_nightly_freeze_timestamps(self):
        # Non-04:00 three-hourly cycle (2026-11-22 07:00 CST = 13:00Z)
        day_cycle = mod.compute_next_cycle(
            datetime(2026, 11, 22, 10, 20, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(day_cycle["cycleId"], "2026-11-22T07")
        self.assertEqual(day_cycle["o3DeferKind"], "o3-deferral")
        self.assertEqual(day_cycle["o3DeferStartUtc"], "2026-11-22T10:30:00Z")
        self.assertEqual(day_cycle["o3DeferStartChicago"], "2026-11-22T04:30:00-06:00")
        self.assertEqual(day_cycle["o3DeferStartChicagoLabel"], "2026-11-22 04:30:00 CST")
        self.assertEqual(day_cycle["o3ClearUtc"], "2026-11-22T13:10:00Z")
        self.assertEqual(day_cycle["o3ClearChicagoLabel"], "2026-11-22 07:10:00 CST")
        self.assertFalse(day_cycle["inO3DeferWindow"])

        # 04:00 anchor (2026-11-22 04:00 CST = 10:00Z) uses nightly freeze 23:45-04:15 Chicago
        anchor = mod.compute_next_cycle(
            datetime(2026, 11, 22, 9, 43, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(anchor["cycleId"], "2026-11-22")
        self.assertEqual(anchor["o3DeferKind"], "nightly-freeze")
        self.assertEqual(anchor["o3DeferStartUtc"], "2026-11-22T05:45:00Z")
        self.assertEqual(anchor["o3DeferStartChicago"], "2026-11-21T23:45:00-06:00")
        self.assertEqual(anchor["o3DeferStartChicagoLabel"], "2026-11-21 23:45:00 CST")
        self.assertEqual(anchor["o3ClearUtc"], "2026-11-22T10:15:00Z")
        self.assertEqual(anchor["o3ClearChicagoLabel"], "2026-11-22 04:15:00 CST")
        self.assertTrue(anchor["inO3DeferWindow"])

        # Spring-forward 04:00 CDT anchor (2026-03-08 04:00 CDT = 09:00Z): freeze 23:45 CST -> 04:15 CDT
        sf_anchor = mod.compute_next_cycle(
            datetime(2026, 3, 8, 7, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(sf_anchor["cycleId"], "2026-03-08")
        self.assertEqual(sf_anchor["o3DeferStartUtc"], "2026-03-08T05:45:00Z")
        self.assertEqual(sf_anchor["o3DeferStartChicagoLabel"], "2026-03-07 23:45:00 CST")
        self.assertEqual(sf_anchor["o3ClearUtc"], "2026-03-08T09:15:00Z")
        self.assertEqual(sf_anchor["o3ClearChicagoLabel"], "2026-03-08 04:15:00 CDT")

        # Fall-back 04:00 CST anchor (2026-11-01 04:00 CST = 10:00Z): freeze 23:45 CDT -> 04:15 CST
        fb_anchor = mod.compute_next_cycle(
            datetime(2026, 11, 1, 6, 10, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(fb_anchor["cycleId"], "2026-11-01")
        self.assertEqual(fb_anchor["o3DeferStartUtc"], "2026-11-01T04:45:00Z")
        self.assertEqual(fb_anchor["o3DeferStartChicagoLabel"], "2026-10-31 23:45:00 CDT")
        self.assertEqual(fb_anchor["o3ClearUtc"], "2026-11-01T10:15:00Z")
        self.assertEqual(fb_anchor["o3ClearChicagoLabel"], "2026-11-01 04:15:00 CST")

    def test_next_open_cycle_advances_after_cutoff_and_matches_before_cutoff(self):
        # Pre-cutoff: nextOpenCycle equals nextCycle
        pre = datetime(2026, 11, 22, 9, 29, 59, tzinfo=timezone.utc)
        pre_bundle = mod.compute_cycle_schedule(pre, "three-hourly")
        self.assertFalse(pre_bundle["nextCycle"]["cutoffPassed"])
        self.assertEqual(pre_bundle["nextOpenCycle"], pre_bundle["nextCycle"])

        # Exact cutoff boundary (09:30:00Z): cutoffPassed=True -> advances to 07:00 CST
        at_cutoff = datetime(2026, 11, 22, 9, 30, 0, tzinfo=timezone.utc)
        at_bundle = mod.compute_cycle_schedule(at_cutoff, "three-hourly")
        self.assertTrue(at_bundle["nextCycle"]["cutoffPassed"])
        self.assertEqual(at_bundle["nextCycle"]["cycleId"], "2026-11-22")
        self.assertEqual(at_bundle["nextOpenCycle"]["cycleId"], "2026-11-22T07")
        self.assertFalse(at_bundle["nextOpenCycle"]["cutoffPassed"])

        # Live 2026-11-22T09:43:00Z replay (13m after 04:00 CST cutoff)
        post = datetime(2026, 11, 22, 9, 43, 0, tzinfo=timezone.utc)
        open_cycle = mod.compute_next_open_cycle(post, "three-hourly")
        self.assertEqual(open_cycle["cycleId"], "2026-11-22T07")
        self.assertEqual(open_cycle["cycleStartUtc"], "2026-11-22T13:00:00Z")
        self.assertEqual(open_cycle["cycleStartChicagoLabel"], "2026-11-22 07:00:00 CST")
        self.assertEqual(open_cycle["preparationCutoffUtc"], "2026-11-22T12:30:00Z")
        self.assertEqual(open_cycle["o3DeferStartUtc"], "2026-11-22T10:30:00Z")
        self.assertEqual(open_cycle["o3ClearUtc"], "2026-11-22T13:10:00Z")
        self.assertEqual(open_cycle["recommendedHoldStartUtc"], "2026-11-22T11:15:00Z")
        self.assertFalse(open_cycle["cutoffPassed"])
        self.assertFalse(open_cycle["inHoldWindow"])

        # Daily cadence post-cutoff advances to tomorrow's 04:00 anchor
        daily_open = mod.compute_next_open_cycle(post, "daily")
        self.assertEqual(daily_open["cycleId"], "2026-11-23")
        self.assertEqual(daily_open["cycleStartUtc"], "2026-11-23T10:00:00Z")

    def test_migration_gate_nightly_freeze_o3_deferral_open_and_dst(self):
        # 1. NIGHTLY_FREEZE at 09:43Z (03:43 CST) -> clears at 10:15Z (04:15 CST)
        g_freeze = mod.compute_migration_gate(
            datetime(2026, 11, 22, 9, 43, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_freeze["status"], "NIGHTLY_FREEZE")
        self.assertEqual(g_freeze["clearAtUtc"], "2026-11-22T10:15:00Z")
        self.assertEqual(g_freeze["clearAtChicagoLabel"], "2026-11-22 04:15:00 CST")
        self.assertEqual(g_freeze["minutesToClear"], 32.0)
        self.assertIsNone(g_freeze["nextDeferStartUtc"])

        # 2. OPEN right at 10:15Z (04:15 CST): nextDefer is O3 at 10:30Z on three-hourly, 23:45 CST on daily
        g_open_3h = mod.compute_migration_gate(
            datetime(2026, 11, 22, 10, 15, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_open_3h["status"], "OPEN")
        self.assertIsNone(g_open_3h["clearAtUtc"])
        self.assertEqual(g_open_3h["nextDeferKind"], "O3_DEFERRAL")
        self.assertEqual(g_open_3h["nextDeferStartUtc"], "2026-11-22T10:30:00Z")
        self.assertEqual(g_open_3h["nextDeferStartChicagoLabel"], "2026-11-22 04:30:00 CST")

        g_open_daily = mod.compute_migration_gate(
            datetime(2026, 11, 22, 10, 15, tzinfo=timezone.utc), "daily"
        )
        self.assertEqual(g_open_daily["status"], "OPEN")
        self.assertEqual(g_open_daily["nextDeferKind"], "NIGHTLY_FREEZE")
        self.assertEqual(g_open_daily["nextDeferStartUtc"], "2026-11-23T05:45:00Z")

        # 3. O3_DEFERRAL daytime [cycleStart - 150m, cycleStart + 10m) for 07:00 CST (13:00Z)
        g_o3_start = mod.compute_migration_gate(
            datetime(2026, 11, 22, 10, 30, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_o3_start["status"], "O3_DEFERRAL")
        self.assertEqual(g_o3_start["cycleId"], "2026-11-22T07")
        self.assertEqual(g_o3_start["clearAtUtc"], "2026-11-22T13:10:00Z")
        self.assertEqual(g_o3_start["clearAtChicagoLabel"], "2026-11-22 07:10:00 CST")

        g_o3_end_minus_1s = mod.compute_migration_gate(
            datetime(2026, 11, 22, 13, 9, 59, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_o3_end_minus_1s["status"], "O3_DEFERRAL")

        g_after_o3 = mod.compute_migration_gate(
            datetime(2026, 11, 22, 13, 10, 0, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_after_o3["status"], "OPEN")
        self.assertEqual(g_after_o3["nextDeferStartUtc"], "2026-11-22T13:30:00Z")

        # Daily cadence does NOT activate O3_DEFERRAL at 11:30Z
        g_daily_day = mod.compute_migration_gate(
            datetime(2026, 11, 22, 11, 30, tzinfo=timezone.utc), "daily"
        )
        self.assertEqual(g_daily_day["status"], "OPEN")

        # 4. 23:35 CST (05:35Z): O3_DEFERRAL for 01:00 CST continuing seamlessly into nightly freeze -> clears 04:15 CST
        g_o3_to_freeze = mod.compute_migration_gate(
            datetime(2026, 11, 22, 5, 35, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_o3_to_freeze["status"], "O3_DEFERRAL")
        self.assertEqual(g_o3_to_freeze["clearAtUtc"], "2026-11-22T10:15:00Z")
        self.assertIn("RELEASE_SCHEMA_FREEZE_CHICAGO", g_o3_to_freeze["reason"])

        # 5. Spring-forward (2026-03-08) and fall-back (2026-11-01) DST boundaries
        g_sf_o3 = mod.compute_migration_gate(
            datetime(2026, 3, 8, 5, 35, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_sf_o3["status"], "O3_DEFERRAL")
        self.assertEqual(g_sf_o3["clearAtUtc"], "2026-03-08T09:15:00Z")

        g_sf_open = mod.compute_migration_gate(
            datetime(2026, 3, 8, 9, 15, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_sf_open["status"], "OPEN")
        self.assertEqual(g_sf_open["nextDeferStartUtc"], "2026-03-08T09:30:00Z")  # 04:30 CDT, 150 min before 07:00 CDT

        g_fb_freeze = mod.compute_migration_gate(
            datetime(2026, 11, 1, 4, 50, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_fb_freeze["status"], "NIGHTLY_FREEZE")
        self.assertEqual(g_fb_freeze["clearAtUtc"], "2026-11-01T10:15:00Z")
        self.assertEqual(g_fb_freeze["clearAtChicagoLabel"], "2026-11-01 04:15:00 CST")

    def test_post_cutoff_closed_stage_run_reuses_single_fetch_and_renders_o8_sections(self):
        serving = _sha("0")
        head = _sha("4")
        now = datetime(2026, 11, 22, 9, 43, 0, tzinfo=timezone.utc)
        stage_fetch_count = {"n": 0}

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                stage_fetch_count["n"] += 1
                return {
                    "workflow_runs": [
                        {
                            "id": 45000042559,
                            "status": "completed",
                            "conclusion": "success",
                            "display_title": "Daily engine selection",
                            "event": "schedule",
                            "head_sha": head,
                            "created_at": "2026-11-22T09:20:00Z",
                            "updated_at": "2026-11-22T09:31:08Z",
                            "html_url": "https://github.com/o/r/actions/runs/45000042559",
                        },
                        {
                            "id": 44990000001,
                            "status": "completed",
                            "conclusion": "success",
                            "display_title": "Older cycle",
                            "event": "schedule",
                            "head_sha": serving,
                            "created_at": "2026-11-22T06:20:00Z",
                            "updated_at": "2026-11-22T06:31:00Z",
                            "html_url": "https://github.com/o/r/actions/runs/44990000001",
                        },
                    ]
                }
            if "backup-engine.yml/runs" in path:
                return {"workflow_runs": []}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": head}}
            if "engine-release-prequalification.yml/runs" in path:
                return {"workflow_runs": []}
            if f"/commits/{head}/status" in path:
                return {"statuses": []}
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(head, serving, [(head, "feat: post-cutoff")]),
            projection_fn=lambda _sha: "same-tree",
        )

        # Strictly zero extra API calls for Stage workflow runs
        self.assertEqual(stage_fetch_count["n"], 1)
        self.assertTrue(report["schedule"]["cutoffPassed"])
        self.assertEqual(report["nextOpenCycle"]["cycleId"], "2026-11-22T07")
        self.assertEqual(report["migrationGate"]["status"], "NIGHTLY_FREEZE")
        self.assertEqual(report["migrationGate"]["clearAtUtc"], "2026-11-22T10:15:00Z")

        closed = report["closedCycleStageRun"]
        self.assertIsNotNone(closed)
        self.assertEqual(closed["id"], 45000042559)
        self.assertEqual(closed["conclusion"], "success")
        self.assertEqual(closed["updatedAt"], "2026-11-22T09:31:08Z")
        self.assertEqual(closed["headSha"], head)

        table = mod.render_table(report)
        self.assertIn("NEXT SCHEDULED CYCLE (2026-11-22)", table)
        self.assertIn("NEXT OPEN CYCLE (2026-11-22T07)", table)
        self.assertIn("MIGRATION GATE", table)
        self.assertIn("NIGHTLY_FREEZE", table)
        self.assertIn("45000042559", table)
        self.assertIn("2026-11-22T10:30:00Z", table)
        self.assertNotIn("\u2014", table)
        self.assertNotIn("\u2013", table)

    def test_closed_cycle_stage_run_ignores_pre_cutoff_active_or_stale_runs(self):
        post_now = datetime(2026, 11, 22, 9, 43, 0, tzinfo=timezone.utc)
        post_sched = mod.compute_next_cycle(post_now, "three-hourly")
        pre_now = datetime(2026, 11, 22, 9, 20, 0, tzinfo=timezone.utc)
        pre_sched = mod.compute_next_cycle(pre_now, "three-hourly")

        run_in_window = {
            "id": 1001,
            "status": "completed",
            "conclusion": "success",
            "headSha": _sha("1"),
            "updatedAt": "2026-11-22T09:31:00Z",
        }
        run_too_old = {
            "id": 1000,
            "status": "completed",
            "conclusion": "success",
            "headSha": _sha("2"),
            "updatedAt": "2026-11-22T09:24:59Z",  # 1s before cutoff - 5m (09:25:00Z)
        }

        # Pre-cutoff -> None
        self.assertIsNone(mod.find_closed_cycle_stage_run([run_in_window], pre_sched, pre_now))
        # Active stage run present -> None
        self.assertIsNone(
            mod.find_closed_cycle_stage_run(
                [run_in_window], post_sched, post_now, active_stage_runs=[{"id": 9999}]
            )
        )
        # Only stale run outside [cutoff - 5m, now] -> None
        self.assertIsNone(mod.find_closed_cycle_stage_run([run_too_old], post_sched, post_now))
        # Exact match within [cutoff - 5m, now] -> returned
        found = mod.find_closed_cycle_stage_run([run_too_old, run_in_window], post_sched, post_now)
        self.assertEqual(found["id"], 1001)

    def test_control_sha_loads_prequalification_from_git_blob_ignoring_stale_working_tree(self):
        with tempfile.TemporaryDirectory() as outer:
            fake_repo = Path(outer) / "repo"
            fake_repo.mkdir()

            def run_git(*args):
                subprocess.run(
                    ["git", "-C", str(fake_repo), *args],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            run_git("init", "-q")
            run_git("config", "user.email", "test@example.com")
            run_git("config", "user.name", "Test")

            stale_prequal_src = (
                "import subprocess\n"
                "SOURCE_TAG = 'stale-pre-o9'\n"
                "def projection(sha):\n"
                "    return subprocess.check_output("
                "['git', 'ls-tree', '-r', sha, '--', 'scripts/ci/read-engine-prequalification.py', 'server/scripts'], "
                "text=True).strip()\n"
            )
            authoritative_prequal_src = (
                "import subprocess\n"
                "SOURCE_TAG = 'authoritative-o9'\n"
                "def projection(sha):\n"
                "    out = subprocess.check_output("
                "['git', 'ls-tree', '-r', sha, '--', 'scripts/ci/read-engine-prequalification.py', 'server/scripts'], "
                "text=True).strip()\n"
                "    return '\\n'.join("
                "line for line in out.splitlines() if not line.endswith('\\tserver/scripts/opponent-hud-build.ts'))\n"
            )

            helper = fake_repo / "scripts/ci/read-engine-prequalification.py"
            helper.parent.mkdir(parents=True, exist_ok=True)
            hud_script = fake_repo / "server/scripts/opponent-hud-build.ts"
            hud_script.parent.mkdir(parents=True, exist_ok=True)

            # Commit 1 (serving): stale pre-O9 helper
            helper.write_text(stale_prequal_src, encoding="utf-8")
            hud_script.write_text("export const V = 0;\n", encoding="utf-8")
            run_git("add", "scripts/ci/read-engine-prequalification.py", "server/scripts/opponent-hud-build.ts")
            run_git("commit", "-q", "-m", "base: stale pre-O9 helper")
            serving = mod.git_read(fake_repo, "rev-parse", "HEAD")

            # Commit 2 (candidate): O9 excludes opponent-hud-build.ts
            helper.write_text(authoritative_prequal_src, encoding="utf-8")
            hud_script.write_text("export const V = 1;\n", encoding="utf-8")
            run_git("add", "scripts/ci/read-engine-prequalification.py", "server/scripts/opponent-hud-build.ts")
            run_git("commit", "-q", "-m", "fix: O9 exclude opponent-hud-build.ts")
            candidate = mod.git_read(fake_repo, "rev-parse", "HEAD")

            # Commit 3 (head / control_sha): modifies only opponent-hud-build.ts
            hud_script.write_text("export const V = 2;\n", encoding="utf-8")
            run_git("add", "server/scripts/opponent-hud-build.ts")
            run_git("commit", "-q", "-m", "fix(hud): update opponent-hud-build.ts")
            head = mod.git_read(fake_repo, "rev-parse", "HEAD")

            # Simulate stale working tree on disk (uncommitted pre-O9 file, like ~/Documents/club-arena)
            helper.write_text(stale_prequal_src, encoding="utf-8")

            # Legacy control_sha=None reads the stale working-tree file and sees a false mismatch
            disk_mod = mod.load_prequalification_module(fake_repo)
            self.assertEqual(disk_mod.SOURCE_TAG, "stale-pre-o9")
            self.assertNotEqual(
                mod.control_projection(candidate, repo_root=fake_repo),
                mod.control_projection(head, repo_root=fake_repo),
            )

            # control_sha loads the authoritative git blob and caches by (resolved_root, control_sha)
            blob_mod_1 = mod.load_prequalification_module(fake_repo, control_sha=head)
            blob_mod_2 = mod.load_prequalification_module(fake_repo, control_sha=head)
            serving_mod = mod.load_prequalification_module(fake_repo, control_sha=serving)
            self.assertIs(blob_mod_1, blob_mod_2)
            self.assertIsNot(blob_mod_1, disk_mod)
            self.assertIsNot(blob_mod_1, serving_mod)
            self.assertEqual(blob_mod_1.SOURCE_TAG, "authoritative-o9")
            self.assertEqual(serving_mod.SOURCE_TAG, "stale-pre-o9")

            # End-to-end collect_readiness() uses control_sha blob: candidate has CTRL=MATCH and SELECTABLE
            def gh_get(path):
                if "stage-engine-release.yml/runs" in path or "backup-engine.yml/runs" in path:
                    return {"workflow_runs": []}
                if path.endswith("/git/ref/heads/main"):
                    return {"object": {"sha": head}}
                if "engine-release-prequalification.yml/runs" in path:
                    return {
                        "workflow_runs": [
                            {
                                "id": 9701,
                                "status": "completed",
                                "conclusion": "success",
                                "event": "push",
                                "head_branch": "main",
                                "path": mod.PREQUAL_PATH,
                                "head_sha": candidate,
                                "run_attempt": 1,
                                "updated_at": "2026-11-22T00:10:00Z",
                                "html_url": "https://github.com/o/r/actions/runs/9701",
                            }
                        ]
                    }
                if f"/commits/{candidate}/status" in path:
                    return {
                        "statuses": [
                            {
                                "context": "backup-engine/certified",
                                "state": "success",
                                "target_url": "https://github.com/o/r/actions/runs/9700",
                                "updated_at": "2026-11-22T00:05:00Z",
                            }
                        ]
                    }
                if f"/commits/{head}/status" in path:
                    return {"statuses": []}
                raise AssertionError(f"unexpected gh api path: {path}")

            report = mod.collect_readiness(
                repo="o/r",
                control_ref="HEAD",
                repo_dir=str(fake_repo),
                now_utc=datetime(2026, 11, 22, 0, 20, tzinfo=timezone.utc),
                health_fn=lambda: _health(release_sha=serving),
                gh_get_fn=gh_get,
            )
            self.assertEqual(report["verdict"], "READY")
            self.assertEqual(report["selectableSha"], candidate)
            cand_row = next(c for c in report["candidates"] if c["sha"] == candidate)
            self.assertTrue(cand_row["controlInputsMatch"])
            self.assertEqual(cand_row["changedControlPaths"], [])
            self.assertEqual(cand_row["status"], "SELECTABLE")

    def test_load_prequalification_module_fails_closed_on_invalid_or_unreadable_control_sha(self):
        with tempfile.TemporaryDirectory() as outer:
            fake_repo = Path(outer) / "repo"
            fake_repo.mkdir()

            def run_git(*args):
                subprocess.run(
                    ["git", "-C", str(fake_repo), *args],
                    check=True,
                    capture_output=True,
                    text=True,
                )

            run_git("init", "-q")
            run_git("config", "user.email", "test@example.com")
            run_git("config", "user.name", "Test")

            # Valid working-tree file exists on disk; invalid control_sha must STILL fail closed!
            helper = fake_repo / "scripts/ci/read-engine-prequalification.py"
            helper.parent.mkdir(parents=True, exist_ok=True)
            helper.write_text("def projection(sha):\n    return sha\n", encoding="utf-8")

            # Commit without projection() to prove missing callable fails closed
            (fake_repo / "README.md").write_text("hi\n", encoding="utf-8")
            run_git("add", "README.md")
            run_git("commit", "-q", "-m", "init without prequal helper")
            missing_blob_sha = mod.git_read(fake_repo, "rev-parse", "HEAD")

            helper.write_text("NOT_PROJECTION = 1\n", encoding="utf-8")
            run_git("add", "scripts/ci/read-engine-prequalification.py")
            run_git("commit", "-q", "-m", "helper missing projection()")
            bad_module_sha = mod.git_read(fake_repo, "rev-parse", "HEAD")

            # Restore valid disk file so only git blob loading can catch these errors
            helper.write_text("def projection(sha):\n    return sha\n", encoding="utf-8")

            for bad_sha in ("main", "HEAD", "1234", "Z" * 40, 123):
                with self.assertRaises(mod.ReadError):
                    mod.load_prequalification_module(fake_repo, control_sha=bad_sha)

            with self.assertRaises(mod.ReadError):
                mod.load_prequalification_module(fake_repo, control_sha=_sha("9"))

            with self.assertRaises(mod.ReadError):
                mod.load_prequalification_module(fake_repo, control_sha=missing_blob_sha)

            with self.assertRaises(mod.ReadError):
                mod.load_prequalification_module(fake_repo, control_sha=bad_module_sha)

    def _abandoned_gh_get(self, sha, backup_runs):
        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                return {"workflow_runs": []}
            if "backup-engine.yml/runs" in path:
                return {"workflow_runs": backup_runs}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": sha}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 888,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": sha,
                            "run_attempt": 1,
                            "updated_at": "2026-11-22T00:05:00Z",
                        }
                    ]
                }
            if f"/commits/{sha}/status" in path:
                return {
                    "statuses": [
                        {
                            "context": mod.BACKUP_STATUS_CONTEXT,
                            "state": "pending",
                            "target_url": "https://github.com/o/r/actions/runs/777",
                            "updated_at": "2026-11-22T00:01:00Z",
                        }
                    ]
                }
            raise AssertionError(path)

        return gh_get

    def test_pending_left_by_completed_backup_run_is_not_in_flight(self):
        serving = _sha("0")
        sha = _sha("e")
        now = datetime(2026, 11, 22, 0, 15, tzinfo=timezone.utc)

        def run(gh_get):
            return mod.collect_readiness(
                repo="o/r",
                now_utc=now,
                health_fn=lambda: _health(release_sha=serving),
                gh_get_fn=gh_get,
                git_fn=_make_git_stub(sha, serving, [(sha, "fix: yielded")]),
                projection_fn=lambda _sha: "same-tree",
            )

        yielded = {"id": 777, "status": "completed", "conclusion": "success", "head_sha": sha, "event": "push"}
        report = run(self._abandoned_gh_get(sha, [yielded]))
        cand = report["candidates"][0]
        self.assertEqual(report["verdict"], "NO_CANDIDATE")
        self.assertEqual(cand["status"], "PENDING")
        self.assertEqual(cand["backup"]["abandonedByRun"], {"id": 777, "conclusion": "success"})
        self.assertIn("left by completed run 777", cand["reason"])
        self.assertIn("pending (#777 ended)", mod.render_table(report))

        # An active Backup run on the same SHA keeps it in flight.
        rerun = {"id": 999, "status": "in_progress", "head_sha": sha, "event": "repository_dispatch"}
        report = run(self._abandoned_gh_get(sha, [rerun, yielded]))
        self.assertEqual(report["verdict"], "IN_FLIGHT")
        self.assertNotIn("abandonedByRun", report["candidates"][0]["backup"])

        # An owning run outside the single recent-runs read stays plain pending.
        report = run(self._abandoned_gh_get(sha, []))
        self.assertEqual(report["verdict"], "IN_FLIGHT")
        self.assertNotIn("abandonedByRun", report["candidates"][0]["backup"])
        self.assertIn("backup=pending (run 777)", report["candidates"][0]["reason"])

        # Still running: never abandoned.
        running = dict(yielded, status="in_progress", conclusion=None)
        report = run(self._abandoned_gh_get(sha, [running]))
        self.assertEqual(report["verdict"], "IN_FLIGHT")

    def test_active_workflow_lines_name_the_triggering_event(self):
        report = {
            "verdict": "IN_FLIGHT",
            "summary": "s",
            "checkedAtUtc": "2026-11-22T00:00:00Z",
            "checkedAtChicagoLabel": "x",
            "activeRuns": {
                "stage": [{"id": 1, "status": "in_progress", "event": "schedule", "headSha": _sha("a"), "displayTitle": "Stage"}],
                "backup": [
                    {"id": 2, "status": "in_progress", "event": "push", "headSha": _sha("b")},
                    {"id": 3, "status": "queued", "event": "repository_dispatch", "headSha": _sha("c")},
                    {"id": 4, "status": "queued", "event": "", "headSha": _sha("d")},
                ],
            },
            "candidates": [],
            "errors": [],
        }
        out = mod.render_table(report)
        self.assertIn("run 1 [in_progress, schedule] aaaaaaaaaaaa", out)
        self.assertIn("run 2 [in_progress, push] bbbbbbbbbbbb", out)
        self.assertIn("run 3 [queued, repository_dispatch] cccccccccccc", out)
        self.assertIn("run 4 [queued] dddddddddddd", out)

    def test_default_walk_extends_past_ten_to_find_older_selectable_candidate(self):
        # O19 (D1) replay of 2026-11-23 08:18Z: 14 newer commits landed after
        # the certified candidate (#15). Default walk (limit=None) must extend
        # up to SELECTABLE_SEARCH_LIMIT (60), skip CTRL=DIFF commits without
        # burning status calls, and return READY; explicit --limit 10 stays capped.
        serving = _sha("0")
        commits = [(f"{i:040x}", f"commit {i}") for i in range(1, 17)]
        head = commits[0][0]
        target = commits[14][0]  # 15th commit (index 14)
        ctrl_diff_sha = commits[11][0]  # 12th commit has diverged CONTROL_INPUTS
        now = datetime(2026, 11, 23, 8, 18, tzinfo=timezone.utc)
        status_calls = []

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                return {"workflow_runs": []}
            if "backup-engine.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 45116020341,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "workflow_dispatch",
                            "head_sha": target,
                            "created_at": "2026-11-23T05:09:38Z",
                            "updated_at": "2026-11-23T06:11:33Z",
                        }
                    ]
                }
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": head}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 45114163817,
                            "status": "completed",
                            "conclusion": "success",
                            "event": "push",
                            "head_branch": "main",
                            "path": mod.PREQUAL_PATH,
                            "head_sha": target,
                            "run_attempt": 1,
                            "updated_at": "2026-11-23T05:42:40Z",
                        }
                    ]
                }
            if "/commits/" in path and path.endswith("/status"):
                sha = path.split("/commits/")[1].split("/")[0]
                status_calls.append(sha)
                if sha == target:
                    return {
                        "statuses": [
                            {
                                "context": mod.BACKUP_STATUS_CONTEXT,
                                "state": "success",
                                "target_url": "https://github.com/o/r/actions/runs/45116020341",
                                "updated_at": "2026-11-23T06:11:33Z",
                            }
                        ]
                    }
                return {"statuses": []}
            raise AssertionError(f"unexpected gh_get: {path}")

        def proj(sha):
            return "diverged" if sha == ctrl_diff_sha else "same-control"

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(head, serving, commits),
            projection_fn=proj,
        )
        self.assertEqual(report["verdict"], "READY")
        self.assertEqual(report["selectableSha"], target)
        self.assertTrue(report["git"]["extendedSearchUsed"])
        self.assertEqual(report["git"]["extendedSearchInspected"], 15)
        self.assertNotIn(ctrl_diff_sha, status_calls)
        self.assertNotIn(commits[15][0], status_calls)
        table = mod.render_table(report)
        self.assertIn("searched 15", table)
        self.assertIn("SELECTABLE", table)

        # Explicit limit=10 must stay strictly bounded to 10 commits.
        capped = mod.collect_readiness(
            repo="o/r",
            limit=10,
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(head, serving, commits),
            projection_fn=proj,
        )
        self.assertEqual(capped["verdict"], "NO_CANDIDATE")
        self.assertFalse(capped["git"]["extendedSearchUsed"])
        self.assertEqual(len(capped["candidates"]), 10)

    def test_copy_time_migration_hold_advisory_triggers_before_o3_deferral(self):
        # O19 (W8a): when the migration gate is OPEN and a certifying (non-post-seal)
        # or selectable Backup copy started before O3 deferral, readiness advises
        # holding ordinary migrations immediately from that copy time.
        serving = _sha("0")
        head = _sha("a")
        # 2026-11-23T13:25Z (07:25 CST, inside the 07:10-07:30 install window):
        # next cycle is 10:00 CST (16:00Z), O3 deferral starts at 13:30Z (150 min,
        # O21 part 2), gate is currently OPEN.
        now = datetime(2026, 11, 23, 13, 25, tzinfo=timezone.utc)

        def run_with_backups(backup_runs, backup_status_state="absent", backup_status_run=None):
            def gh_get(path):
                if "stage-engine-release.yml/runs" in path:
                    return {"workflow_runs": []}
                if "backup-engine.yml/runs" in path:
                    return {"workflow_runs": backup_runs}
                if path.endswith("/git/ref/heads/main"):
                    return {"object": {"sha": head}}
                if "engine-release-prequalification.yml/runs" in path:
                    return {
                        "workflow_runs": [
                            {
                                "id": 9100,
                                "status": "completed",
                                "conclusion": "success",
                                "event": "push",
                                "head_branch": "main",
                                "path": mod.PREQUAL_PATH,
                                "head_sha": head,
                                "run_attempt": 1,
                                "updated_at": "2026-11-23T13:50:00Z",
                            }
                        ]
                    }
                if f"/commits/{head}/status" in path:
                    if backup_status_state == "absent":
                        return {"statuses": []}
                    return {
                        "statuses": [
                            {
                                "context": mod.BACKUP_STATUS_CONTEXT,
                                "state": backup_status_state,
                                "target_url": f"https://github.com/o/r/actions/runs/{backup_status_run}",
                                "updated_at": "2026-11-23T14:00:00Z",
                            }
                        ]
                    }
                raise AssertionError(path)

            return mod.collect_readiness(
                repo="o/r",
                now_utc=now,
                health_fn=lambda: _health(release_sha=serving),
                gh_get_fn=gh_get,
                git_fn=_make_git_stub(head, serving, [(head, "fix: candidate")]),
                projection_fn=lambda _sha: "same-control",
            )

        # Active workflow_dispatch Backup started at 13:16:39Z (before 13:30Z O3).
        active_report = run_with_backups(
            [
                {
                    "id": 45188945088,
                    "status": "in_progress",
                    "conclusion": None,
                    "event": "workflow_dispatch",
                    "head_sha": head,
                    "created_at": "2026-11-23T13:16:39Z",
                }
            ]
        )
        adv = active_report["migrationHoldAdvisory"]
        self.assertTrue(adv["active"])
        self.assertEqual(adv["source"], "active_backup")
        self.assertEqual(adv["runId"], 45188945088)
        self.assertEqual(adv["sinceUtc"], "2026-11-23T13:16:39Z")
        self.assertIn("copyHold:      ACTIVE NOW", mod.render_table(active_report))

        # Certified SELECTABLE candidate copied at 13:20:00Z (before 13:30Z O3).
        sel_report = run_with_backups(
            [
                {
                    "id": 45180000001,
                    "status": "completed",
                    "conclusion": "success",
                    "event": "push",
                    "head_sha": head,
                    "created_at": "2026-11-23T13:20:00Z",
                }
            ],
            backup_status_state="success",
            backup_status_run=45180000001,
        )
        self.assertTrue(sel_report["migrationHoldAdvisory"]["active"])
        self.assertEqual(sel_report["migrationHoldAdvisory"]["source"], "selectable_backup")
        self.assertEqual(sel_report["migrationHoldAdvisory"]["sinceUtc"], "2026-11-23T13:20:00Z")

        # Post-seal repository_dispatch Backup alone does not trigger a candidate copy hold.
        postseal_report = run_with_backups(
            [
                {
                    "id": 45180000002,
                    "status": "in_progress",
                    "conclusion": None,
                    "event": "repository_dispatch",
                    "head_sha": serving,
                    "created_at": "2026-11-23T13:02:00Z",
                }
            ]
        )
        self.assertFalse(postseal_report["migrationHoldAdvisory"]["active"])
        self.assertNotIn("copyHold:", mod.render_table(postseal_report))

    def test_extended_search_reports_no_candidate_cleanly_when_none_selectable(self):
        serving = _sha("0")
        commits = [(f"{i:040x}", f"commit {i}") for i in range(1, 15)]
        head = commits[0][0]
        now = datetime(2026, 11, 23, 13, 53, tzinfo=timezone.utc)

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path or "backup-engine.yml/runs" in path:
                return {"workflow_runs": []}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": head}}
            if "engine-release-prequalification.yml/runs" in path:
                return {"workflow_runs": []}
            if "/commits/" in path and path.endswith("/status"):
                return {"statuses": []}
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(head, serving, commits),
            projection_fn=lambda _sha: "same-control",
        )
        self.assertEqual(report["verdict"], "NO_CANDIDATE")
        self.assertTrue(report["git"]["extendedSearchUsed"])
        self.assertEqual(report["git"]["extendedSearchInspected"], 14)
        self.assertEqual(len(report["candidates"]), 10)
        self.assertIn("searched 14", mod.render_table(report))


    def test_a_dispatched_backup_names_its_real_target_not_its_head(self):
        # 2026-11-26 06:xxZ: manual run 45759269821 (head 6f062e8f0d1d, main)
        # certified c951436a6ead, which release-control PR #12038 had made
        # unselectable; the post said IN_FLIGHT 6f062e8f0d1d.
        serving = _sha("0")
        head = _sha("6")
        old = _sha("c")
        now = datetime(2026, 11, 26, 6, 10, tzinfo=timezone.utc)

        def gh_get(path):
            if "stage-engine-release.yml/runs" in path:
                return {"workflow_runs": []}
            if "backup-engine.yml/runs" in path:
                return {"workflow_runs": [{"id": 45759269821, "status": "in_progress",
                                           "event": "workflow_dispatch", "head_sha": head,
                                           "display_title": "Backup Engine (Clone, Stage, Certify)"}]}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": head}}
            if "engine-release-prequalification.yml/runs" in path:
                return {"workflow_runs": []}
            if f"/commits/{head}/status" in path:
                return {"statuses": []}
            if f"/commits/{old}/status" in path:
                return {"statuses": [{"context": "backup-engine/certified", "state": "pending",
                                      "target_url": "https://github.com/o/r/actions/runs/45759269821",
                                      "updated_at": "2026-11-26T05:11:00Z"}]}
            raise AssertionError(path)

        report = mod.collect_readiness(
            repo="o/r",
            now_utc=now,
            health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get,
            git_fn=_make_git_stub(head, serving, [(head, "fix(doctrine)"), (old, "perf(horse)")]),
            projection_fn=lambda sha: "old-controls" if sha == old else "new-controls",
        )
        self.assertNotIn("45759269821", report["candidates"][0]["reason"])
        self.assertEqual(report["candidates"][1]["status"], "DISQUALIFIED")
        self.assertIn(f"run 45759269821 certifies {old[:12]}, which cannot be selected (CONTROL_INPUTS mismatch",
                      report["summary"])
        self.assertNotIn(f"{head[:12]} is in flight", report["summary"])

class JobLogReaderTests(unittest.TestCase):
    """2026-11-27 16:00 CST: both readiness posts said UNKNOWN for a044fa566044 because the runner's
    gh refused to print a job log holding terminal colour codes. The candidate was fresh and sealed."""

    PATH = "repos/o/r/actions/jobs/9/logs"
    REFUSAL = "the response contains terminal escape sequences; pass --allow-escape-sequences to print them"

    def _proc(self, code, out="", err=""):
        return types.SimpleNamespace(returncode=code, stdout=out, stderr=err)

    def test_a_gh_that_refuses_escape_sequences_is_told_the_log_is_data(self):
        calls = []

        def run(argv, **_kw):
            calls.append(argv)
            if mod.GH_ALLOW_ESCAPES_FLAG in argv:
                return self._proc(0, "\x1b[36m[apply] 20261127043816_c.sql\x1b[0m\n")
            return self._proc(1, err=self.REFUSAL)

        text = mod.gh_api_get_text(self.PATH, run=run)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0], ["gh", "api", "--method", "GET", self.PATH, mod.GH_ALLOW_ESCAPES_FLAG])
        self.assertIn("[apply] 20261127043816_c.sql", text)

    def test_an_older_gh_that_does_not_know_the_flag_is_asked_the_old_way(self):
        calls = []

        def run(argv, **_kw):
            calls.append(argv)
            if mod.GH_ALLOW_ESCAPES_FLAG in argv:
                return self._proc(1, err=f"unknown flag: {mod.GH_ALLOW_ESCAPES_FLAG}")
            return self._proc(0, "log text\n")

        self.assertEqual(mod.gh_api_get_text(self.PATH, run=run), "log text\n")
        self.assertEqual(calls[1], ["gh", "api", "--method", "GET", self.PATH])

    def test_any_other_failure_is_unread_and_is_not_asked_twice(self):
        calls = []

        def run(argv, **_kw):
            calls.append(argv)
            return self._proc(1, err="HTTP 403: rate limit")

        with self.assertRaises(mod.ReadError):
            mod.gh_api_get_text(self.PATH, run=run)
        self.assertEqual(len(calls), 1)

    def test_a_coloured_applier_line_is_still_a_committed_file(self):
        log = "\n".join(
            [
                "2026-11-27T10:15:31.1Z \x1b[36;1m[apply] 20261124195144_a.sql\x1b[0m",
                "2026-11-27T10:15:32.0Z \x1b[32m[apply] APPLIED\x1b[0m",
                "2026-11-27T10:15:33.0Z [apply] 20261126191910_b.sql",
                "2026-11-27T10:15:34.0Z [apply] QUEUED",
            ]
        )
        self.assertEqual(mod.committed_files_in_log(log), ["20261124195144_a.sql"])


class CopyFreshnessTests(unittest.TestCase):
    """O36 (2026-11-27): at 05:30 CST readiness called 7c301a85a5e4 READY; its Backup copy lacked
    20261124195144, 20261126191910 and 20261127043816, which the 04:15 window had installed, so the
    selector refused it at 06:30 and the 07:00 cycle kept serving.

    O36b (2026-11-27): an independent review found the installs readiness could still not see. The
    fake GitHub below honours the list's created filter and its pages, as the real one does."""

    REPO = "o/r"
    COPY_AT = "2026-11-27T10:05:00Z"

    SHA = "7" * 40

    def _gh(self, apply_runs, stage_runs, logs, artifacts=None, attempt=1, calls=None):
        artifacts = artifacts if artifacts is not None else [
            {"id": 5, "name": f"backup-certificate-{self.SHA}-1", "expired": False}
        ]
        calls = calls if calls is not None else []

        def listed(path, runs):
            since = re.search(r"created=%3E%3D([0-9TZ:-]+)", path).group(1)
            page = int((re.search(r"&page=(\d+)", path) or [0, "1"])[1])
            size = int(re.search(r"per_page=(\d+)", path).group(1))
            kept = [r for r, _ in runs if r.get("created_at", "9999") >= since]
            return {"total_count": len(kept), "workflow_runs": kept[(page - 1) * size : page * size]}

        def gh_get(path):
            calls.append(path)
            if re.fullmatch(rf"repos/{self.REPO}/actions/runs/7\d\d", path):
                return {"id": int(path[-3:]), "run_attempt": attempt}
            if re.fullmatch(rf"repos/{self.REPO}/actions/runs/7\d\d/artifacts\?per_page=100", path):
                return {"artifacts": artifacts}
            if f"/workflows/{mod.APPLY_WORKFLOW}/runs" in path:
                return listed(path, apply_runs)
            if f"/workflows/{mod.STAGE_WORKFLOW}/runs" in path:
                return listed(path, stage_runs)
            for run, jobs in apply_runs + stage_runs:
                if path.startswith(f"repos/{self.REPO}/actions/runs/{run['id']}/jobs"):
                    return {"jobs": jobs}
            raise AssertionError(f"unexpected gh api path: {path}")

        def gh_text(path):
            calls.append(path)
            for job_id, text in logs.items():
                if path == f"repos/{self.REPO}/actions/jobs/{job_id}/logs":
                    return text
            raise mod.ReadError(f"no log {path}")

        return gh_get, gh_text

    def _zip(self, cert, evidence=None):
        buf = io.BytesIO()
        import zipfile

        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("certificate.json", json.dumps(cert))
            if evidence is not None:
                zf.writestr("schema-evidence.json", evidence)
        return buf.getvalue()

    DUMP = "d" * 64

    def _evidenced(self, restored_at, captured_at, versions=(), bound=True):
        """A certificate archive in the real shape (Backup run 46085911560, 2026-11-27): the
        certificate's database block binds schema-evidence.json by sha256 and both name the dump."""
        import hashlib

        evidence = json.dumps({
            "schema": "club-arena-schema-evidence/v1",
            "capturedAt": captured_at,
            "dumpSha256": self.DUMP,
            "functions": {},
            "migrations": [[v, f"m{v}"] for v in versions],
        }).encode()
        digest = hashlib.sha256(evidence).hexdigest() if bound else "0" * 64
        cert = {"database": {"restoredAt": restored_at, "dump": "schema.dump", "dumpSha256": self.DUMP,
                             "schemaEvidenceValidated": True, "schemaEvidenceSha256": digest}}
        return {5: self._zip(cert, evidence)}

    def _inflight(self, run_id, file, job_status="in_progress", jobs=None, nonce=" 0123abcd"):
        run = {"id": run_id, "status": "in_progress" if job_status != "queued" else "queued",
               "created_at": "2026-11-27T11:00:00Z", "display_title": f"Apply Merged Migration {file}{nonce}"}
        if jobs is None:
            jobs = [] if job_status == "queued" else [{"id": run_id + 1, "name": f"Apply {file}", "status": job_status, "conclusion": None}]
        return (run, jobs)

    def _helper(self, inert=(), seen=None):
        """A stand-in for the installed-migrations helper: its inert_versions answers `inert`,
        its bounded_inert is the real helper's."""
        real = mod.load_inert_helper(ROOT)
        self.assertIsNotNone(real)

        def inert_versions(repo, control, *others):
            if seen is not None:
                seen.append((repo, control, others))
            return frozenset(inert)

        return types.SimpleNamespace(inert_versions=inert_versions, bounded_inert=real.bounded_inert)

    def _judge(self, gh_get, gh_text, helper=None, cert=None, archives=None, run_id=700, cache=None, attempts=None):
        cert = cert if cert is not None else {"database": {"restoredAt": self.COPY_AT}}
        archives = archives if archives is not None else {5: self._zip(cert)}

        def gh_bytes(path):
            for artifact_id, archive in archives.items():
                if path == f"repos/{self.REPO}/actions/artifacts/{artifact_id}/zip":
                    return archive
            raise mod.ReadError(path)

        cand = {"sha": self.SHA, "backup": {"runId": run_id}}
        return mod.judge_copy_freshness(
            cand, self.REPO, "/repo", "c" * 40, gh_get, gh_text, helper, gh_bytes, cache, attempts
        )

    def _apply(self, run_id, job_id, done, **run):
        return (
            {"id": run_id, "status": "completed", **run},
            [{"id": job_id, "name": "Apply", "status": "completed", "conclusion": "success", "completed_at": done}],
        )

    # The window run of 2026-11-27 as GitHub reported it (run 45963036602, job 140421831827).
    WINDOW_RUN = {
        "id": 45963036602,
        "status": "completed",
        "conclusion": "success",
        "created_at": "2026-11-27T08:05:43Z",
        "updated_at": "2026-11-27T10:25:25Z",
    }
    WINDOW_JOB = {
        "id": 140421831827,
        "name": mod.WINDOW_INSTALL_JOB,
        "status": "completed",
        "conclusion": "success",
        "started_at": "2026-11-27T09:30:10Z",
        "completed_at": "2026-11-27T10:00:30Z",
    }
    WINDOW_LOG = "\n".join(
        [
            "2026-11-27T10:00:21.9228156Z [apply] 20261124195144_exact_profile_keeps_how_an_opener_answers_a_3_bet.sql",
            "2026-11-27T10:00:21.9234003Z [apply]   not present in schema_migrations; applying the migration as ONE transaction",
            "2026-11-27T10:00:24.8616654Z [apply] committed in 2817ms",
            "2026-11-27T10:00:24.9065210Z [apply] recorded version=20261124195144 name=exact_profile_keeps_how_an_opener_answers_a_3_bet",
            "2026-11-27T10:00:24.9067245Z [apply] APPLIED",
            "2026-11-27T10:00:26.1027593Z [apply] 20261126191910_club_member_held_and_locked_chips_never_go_below_zero.sql",
            "2026-11-27T10:00:27.9186963Z [apply] committed in 1693ms",
            "2026-11-27T10:00:27.9605306Z [apply] APPLIED",
            "2026-11-27T10:00:28.0055962Z [window] result: INSTALLED 2 migration(s) inside the daily maintenance freeze",
        ]
    )

    def test_the_window_install_that_cost_07_00_makes_the_certificate_stale(self):
        window_log = "\n".join(
            [
                "2026-11-27T10:15:31.1Z [apply] 20261124195144_a.sql",
                "2026-11-27T10:15:33.2Z [apply] APPLIED",
                "2026-11-27T10:15:40.0Z [apply] 20261126191910_b.sql",
                "2026-11-27T10:15:41.0Z [apply] APPLIED",
                "2026-11-27T10:16:01.0Z [apply] 20261127043816_c.sql",
                "2026-11-27T10:16:02.0Z [apply] APPLIED",
            ]
        )
        stage = [
            (
                {"id": 800, "status": "completed"},
                [
                    {"id": 81, "name": mod.WINDOW_INSTALL_JOB, "conclusion": "success", "completed_at": "2026-11-27T10:16:30Z"},
                    {"id": 82, "name": "select", "conclusion": "success", "completed_at": "2026-11-27T10:20:00Z"},
                ],
            )
        ]
        gh_get, gh_text = self._gh([], stage, {81: window_log})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "stale")
        for v in ("20261124195144", "20261126191910", "20261127043816"):
            self.assertIn(v, detail)
        self.assertIn("fresh-copy Backup", detail)

    def test_already_applied_queued_and_refused_installs_change_nothing(self):
        log = "\n".join(
            [
                "[apply] ALREADY-APPLIED: 20261127000001_x.sql",
                "[apply] 20261127000002_y.sql",
                "[apply] REFUSED: lock_timeout",
                "[apply] QUEUED: 20261127000003_z.sql",
            ]
        )
        gh_get, gh_text = self._gh([self._apply(900, 91, "2026-11-27T11:00:00Z")], [], {91: log})
        self.assertEqual(self._judge(gh_get, gh_text)[0], "fresh")

    def test_a_reused_copy_is_dated_by_its_restore_not_by_the_run(self):
        # 4f2a8bcc269e's run refreshed at 03:49 CST but certified a copy restored 01:25 CST.
        gh_get, gh_text = self._gh(
            [self._apply(904, 95, "2026-11-27T08:30:00Z")], [], {95: "[apply] 20261124195144_a.sql\n[apply] APPLIED"}
        )
        verdict, detail = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T07:25:01Z"}})
        self.assertEqual(verdict, "stale")
        self.assertIn("01:25", detail)

    def test_an_install_before_the_copy_or_an_engine_inert_one_is_not_missing(self):
        gh_get, gh_text = self._gh(
            [self._apply(901, 92, "2026-11-27T10:00:00Z")], [], {92: "[apply] 20261127000004_w.sql\n[apply] APPLIED"}
        )
        self.assertEqual(self._judge(gh_get, gh_text)[0], "fresh")
        gh_get, gh_text = self._gh(
            [self._apply(902, 93, "2026-11-27T11:00:00Z")], [], {93: "[apply] 20261127000005_v.sql\n[apply] APPLIED"}
        )
        verdict, detail = self._judge(gh_get, gh_text, helper=self._helper({"20261127000005"}))
        self.assertEqual(verdict, "fresh")
        self.assertIn("left out as engine-inert: 20261127000005", detail)
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper())[0], "stale")
        # No carve-out helper: every install counts.
        self.assertEqual(self._judge(gh_get, gh_text, helper=None)[0], "stale")

    def test_unreadable_is_unread_never_fresh(self):
        after = [self._apply(903, 94, "2026-11-27T11:00:00Z")]
        gh_get, gh_text = self._gh(after, [], {})  # the log cannot be read
        self.assertEqual(self._judge(gh_get, gh_text)[0], "unread")
        gh_get, gh_text = self._gh([], [], {}, artifacts=[])  # no certificate kept
        self.assertEqual(self._judge(gh_get, gh_text)[0], "unread")
        gh_get, gh_text = self._gh([], [], {})
        self.assertEqual(self._judge(gh_get, gh_text, cert={"database": {}})[0], "unread")
        gh_get, gh_text = self._gh([], [], {}, attempt=None)  # the run names no attempt
        self.assertEqual(self._judge(gh_get, gh_text)[0], "unread")

        def truncated(path):
            if path.endswith("/runs/700"):
                return {"id": 700, "run_attempt": 1}
            if "/artifacts" in path:
                return {"artifacts": [{"id": 5, "name": f"backup-certificate-{self.SHA}-1"}]}
            return {"total_count": 101, "workflow_runs": []}

        self.assertEqual(self._judge(truncated, gh_text)[0], "unread")

    def test_a_stale_top_candidate_is_skipped_and_an_unread_one_makes_the_verdict_unknown(self):
        health = {"phase": "idle"}
        git_info = {"totalCommitsSinceServing": 2, "controlSha": "c" * 40, "servingSha": "s" * 40}
        unread = [{"sha": "a" * 40, "subject": "x", "status": "SELECTABLE", "reason": "", "copyFreshness": "unread", "copyFreshnessDetail": "HTTP 502"}]
        verdict, sha, summary = mod.determine_verdict(health, unread, [], git_info)
        self.assertEqual(verdict, mod.VERDICT_UNKNOWN)
        self.assertIsNone(sha)
        self.assertIn("could not be read", summary)
        self.assertEqual(mod.EXIT_CODES[mod.VERDICT_UNKNOWN], 3)

    # --- O36b finding 1: an install by a run created long before the copy ---

    def test_a_stage_run_reserved_hours_before_the_copy_still_shows_its_install(self):
        # Run 45963036602 was created 08:05:43Z and installed at 10:00:30Z. A copy restored at
        # 09:40Z lies between: one hour of lookback never listed the run.
        gh_get, gh_text = self._gh([], [(self.WINDOW_RUN, [self.WINDOW_JOB])], {140421831827: self.WINDOW_LOG})
        verdict, detail = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T09:40:00Z"}})
        self.assertEqual(verdict, "stale", detail)
        self.assertIn("20261124195144", detail)
        self.assertIn("20261126191910", detail)

    def test_the_stage_lookback_covers_the_longest_reservation_the_workflow_allows(self):
        stage = (ROOT / ".github/workflows/stage-engine-release.yml").read_text()
        bound = re.search(r'\[ "\$remaining" -le (\d+) \] \|\| \{ echo \'::error::Reservation exceeds five hours', stage)
        self.assertIsNotNone(bound, "the reservation bound moved; re-derive STAGE_RESERVATION_LOOKBACK")
        default = re.search(r"lookback_seconds=\$\{lookback_seconds:-(\d+)\}", stage)
        self.assertIsNotNone(default)
        longest = max(int(bound.group(1)), int(default.group(1)))
        self.assertGreaterEqual(mod.STAGE_RESERVATION_LOOKBACK.total_seconds(), longest + 3600)

    def test_a_re_run_of_an_old_apply_run_is_seen_by_its_new_attempt(self):
        # A re-run keeps the run's created_at; its job completes now.
        old = self._apply(905, 96, "2026-11-27T11:00:00Z", created_at="2026-11-25T15:00:00Z", updated_at="2026-11-27T11:00:05Z")
        gh_get, gh_text = self._gh([old], [], {96: "[apply] 20261125150000_r.sql\n[apply] committed in 40ms\n[apply] APPLIED"})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "stale", detail)
        self.assertIn("20261125150000", detail)

    # --- O36b finding 2: what a report costs ---

    def test_a_run_not_touched_since_the_copy_costs_no_further_read(self):
        calls = []
        quiet = [
            ({"id": 810 + i, "status": "completed", "created_at": "2026-11-27T06:00:00Z", "updated_at": "2026-11-27T06:30:00Z"}, [])
            for i in range(40)
        ]
        old_apply = [
            ({"id": 910 + i, "status": "completed", "created_at": "2026-11-26T06:00:00Z", "updated_at": "2026-11-26T06:02:00Z"}, [])
            for i in range(40)
        ]
        gh_get, gh_text = self._gh(old_apply, quiet + [(self.WINDOW_RUN, [self.WINDOW_JOB])], {140421831827: self.WINDOW_LOG}, calls=calls)
        verdict, _ = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T09:40:00Z"}})
        self.assertEqual(verdict, "stale")
        # run, artifacts, two lists, one jobs read and one log: nothing per untouched run.
        self.assertEqual(len(calls), 6, calls)

    def test_a_second_certificate_on_the_same_copy_reads_only_its_own_certificate(self):
        calls, cache = [], {}
        gh_get, gh_text = self._gh([], [(self.WINDOW_RUN, [self.WINDOW_JOB])], {140421831827: self.WINDOW_LOG}, calls=calls)
        cert = {"database": {"restoredAt": "2026-11-27T09:40:00Z"}}
        first = self._judge(gh_get, gh_text, cert=cert, cache=cache)
        spent = len(calls)
        second = self._judge(gh_get, gh_text, cert=cert, run_id=701, cache=cache)
        self.assertEqual((first[0], second[0]), ("stale", "stale"))
        self.assertEqual(calls[spent:], ["repos/o/r/actions/runs/701", "repos/o/r/actions/runs/701/artifacts?per_page=100"])
        # Another copy time is another question.
        third = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T10:05:00Z"}}, run_id=702, cache=cache)
        self.assertEqual(third[0], "fresh")
        self.assertEqual(len(cache), 2)

    def test_three_stale_certificates_on_one_copy_cost_one_read_of_the_installs(self):
        serving = _sha("0")
        shas = [_sha("a"), _sha("b"), _sha("d")]
        now = datetime(2026, 11, 27, 11, 30, tzinfo=timezone.utc)
        tree = "100644 blob 1111111111111111111111111111111111111111\tscripts/ci/select-daily-engine.py"
        calls = []
        archive = self._zip({"database": {"restoredAt": "2026-11-27T09:40:00Z"}})
        runs = {sha: 701 + i for i, sha in enumerate(shas)}
        stage_list = [dict(self.WINDOW_RUN, display_title="cycle", event="workflow_run", head_sha=shas[0], html_url="")]

        def gh_get(path):
            calls.append(path)
            if "created=%3E%3D" in path:
                if mod.STAGE_WORKFLOW in path:
                    return {"total_count": 1, "workflow_runs": [self.WINDOW_RUN]}
                return {"total_count": 0, "workflow_runs": []}
            if "stage-engine-release.yml/runs" in path:
                return {"workflow_runs": stage_list}
            if "backup-engine.yml/runs" in path:
                return {"workflow_runs": []}
            if path.endswith("/git/ref/heads/main"):
                return {"object": {"sha": shas[0]}}
            if "engine-release-prequalification.yml/runs" in path:
                return {
                    "workflow_runs": [
                        {
                            "id": 8100 + i, "status": "completed", "conclusion": "success", "event": "push",
                            "head_branch": "main", "path": mod.PREQUAL_PATH, "head_sha": sha, "run_attempt": 1,
                            "updated_at": "2026-11-27T09:00:00Z", "html_url": f"https://github.com/o/r/actions/runs/{8100 + i}",
                        }
                        for i, sha in enumerate(shas)
                    ]
                }
            for sha, run_id in runs.items():
                if f"/commits/{sha}/status" in path:
                    return {
                        "statuses": [
                            {
                                "context": "backup-engine/certified", "state": "success",
                                "target_url": f"https://github.com/o/r/actions/runs/{run_id}",
                                "updated_at": "2026-11-27T09:50:00Z",
                            }
                        ]
                    }
                if path == f"repos/o/r/actions/runs/{run_id}":
                    return {"id": run_id, "run_attempt": 1}
                if path == f"repos/o/r/actions/runs/{run_id}/artifacts?per_page=100":
                    return {"artifacts": [{"id": run_id, "name": f"backup-certificate-{sha}-1", "expired": False}]}
            if path.startswith(f"repos/o/r/actions/runs/{self.WINDOW_RUN['id']}/jobs"):
                return {"jobs": [self.WINDOW_JOB]}
            raise AssertionError(f"unexpected gh api path: {path}")

        def gh_text(path):
            calls.append(path)
            return self.WINDOW_LOG

        def gh_bytes(path):
            calls.append(path)
            return archive

        report = mod.collect_readiness(
            repo="o/r", limit=10, now_utc=now, health_fn=lambda: _health(release_sha=serving),
            gh_get_fn=gh_get, gh_text_fn=gh_text, gh_bytes_fn=gh_bytes,
            git_fn=_make_git_stub(shas[0], serving, [(sha, f"fix: {i}") for i, sha in enumerate(shas)]),
            projection_fn=lambda _sha: tree, inert_helper=self._helper(),
        )
        self.assertEqual([c.get("copyFreshness") for c in report["candidates"]], ["stale"] * 3, report["summary"])
        self.assertEqual(report["verdict"], "NO_CANDIDATE")
        installs = [c for c in calls if "created=%3E%3D" in c or "/jobs" in c]
        # Two lists, one jobs read and one log for the copy, however many certificates share it.
        self.assertEqual(len(installs), 4, installs)
        self.assertEqual(len([c for c in calls if c.endswith("/zip")]), 3)

    # --- O36b finding 3: more runs than one page ---

    def _many_stage_runs(self, count):
        return [
            ({"id": 100000 + i, "status": "completed", "created_at": "2026-11-27T06:00:00Z", "updated_at": "2026-11-27T06:30:00Z"}, [])
            for i in range(count)
        ]

    def test_a_stall_long_enough_for_a_second_page_of_runs_is_read_page_by_page(self):
        # Stage held about 156 runs in 24 h on 2026-11-27. The install is on the second page.
        calls = []
        stage = self._many_stage_runs(155) + [(self.WINDOW_RUN, [self.WINDOW_JOB])]
        gh_get, gh_text = self._gh([], stage, {140421831827: self.WINDOW_LOG}, calls=calls)
        verdict, detail = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T09:40:00Z"}})
        self.assertEqual(verdict, "stale", detail)
        self.assertTrue(any(c.endswith("&page=2") and mod.STAGE_WORKFLOW in c for c in calls))
        gh_get, gh_text = self._gh([], self._many_stage_runs(155), {})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "fresh", detail)

    def test_more_pages_than_the_bound_is_unread(self):
        gh_get, gh_text = self._gh([], self._many_stage_runs(mod.RUN_PAGE_SIZE * mod.RUN_PAGE_LIMIT + 1), {})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "unread")
        self.assertIn("pages", detail)

    # --- O36b finding 4: a job is judged by its own state, not its run's ---

    def test_the_window_install_counts_while_its_run_is_still_open(self):
        # 10:00:30Z to 10:25:25Z on 2026-11-27: the installer had finished, the run had not.
        open_run = dict(self.WINDOW_RUN, status="in_progress", conclusion=None, updated_at="2026-11-27T10:00:31Z")
        gh_get, gh_text = self._gh([], [(open_run, [self.WINDOW_JOB])], {140421831827: self.WINDOW_LOG})
        verdict, detail = self._judge(gh_get, gh_text, cert={"database": {"restoredAt": "2026-11-27T09:40:00Z"}})
        self.assertEqual(verdict, "stale", detail)

    def test_an_installer_or_an_apply_run_still_running_is_unread(self):
        cert = {"database": {"restoredAt": "2026-11-27T09:40:00Z"}}
        open_run = dict(self.WINDOW_RUN, status="in_progress", conclusion=None)
        running = dict(self.WINDOW_JOB, status="in_progress", conclusion=None, completed_at=None)
        gh_get, gh_text = self._gh([], [(open_run, [running])], {})
        verdict, detail = self._judge(gh_get, gh_text, cert=cert)
        self.assertEqual(verdict, "unread", detail)
        self.assertIn("window installer", detail)
        # Not started yet: nothing was sent, and the next read sees it.
        queued = dict(self.WINDOW_JOB, status="queued", conclusion=None, completed_at=None)
        gh_get, gh_text = self._gh([], [(open_run, [queued])], {})
        self.assertEqual(self._judge(gh_get, gh_text, cert=cert)[0], "fresh")
        apply_open = ({"id": 906, "status": "in_progress", "created_at": "2026-11-27T10:30:00Z"}, [])
        gh_get, gh_text = self._gh([apply_open], [], {})
        verdict, detail = self._judge(gh_get, gh_text, cert=cert)
        self.assertEqual(verdict, "unread", detail)
        self.assertIn("906", detail)

    # --- O36b finding 5: committed is the applier's "committed", not only "APPLIED" ---

    def test_a_commit_whose_history_read_back_failed_is_still_committed(self):
        log = "\n".join(
            [
                "[apply] 20261127000006_u.sql",
                "[apply] committed in 812ms",
                "[apply] UNKNOWN: migration sent; read durable atomic history before another attempt",
                "[apply] Inspect the retained operation and durable state before another attempt.",
            ]
        )
        self.assertEqual(mod.committed_files_in_log(log), ["20261127000006_u.sql"])
        self.assertEqual(mod.committed_files_in_log(self.WINDOW_LOG), [
            "20261124195144_exact_profile_keeps_how_an_opener_answers_a_3_bet.sql",
            "20261126191910_club_member_held_and_locked_chips_never_go_below_zero.sql",
        ])

    def test_an_unknown_outcome_before_the_commit_is_unread(self):
        for tail in (
            "[apply] UNKNOWN after 5003ms",
            "[apply] UNKNOWN: could not bound the owning migration transaction: timeout",
            "[window] result: UNKNOWN `20261127000007_t.sql` (exit SIGTERM) - read schema_migrations for it before anything else.",
        ):
            with self.assertRaises(mod.ReadError, msg=tail):
                mod.committed_files_in_log("[apply] 20261127000007_t.sql\n" + tail)
        gh_get, gh_text = self._gh(
            [self._apply(907, 97, "2026-11-27T11:00:00Z")], [], {97: "[apply] 20261127000007_t.sql\n[apply] UNKNOWN after 5003ms"}
        )
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "unread")
        self.assertIn("20261127000007_t.sql", detail)
        # A definite refusal or a dry run sent nothing durable.
        self.assertEqual(mod.committed_files_in_log("[apply] 20261127000008_s.sql\n[apply] REFUSED after 1002ms\n[apply] UNKNOWN: later"), [])
        self.assertEqual(mod.committed_files_in_log("[apply] 20261127000008_s.sql\n[apply] DRY RUN: nothing sent."), [])

    def test_the_markers_are_the_strings_the_applier_and_the_installer_print(self):
        applier = (ROOT / "scripts/ci/apply-recorded-migration.mjs").read_text()
        installer = (ROOT / "scripts/ci/install-window-migrations.mjs").read_text()
        for printed in (
            "console.log(`[apply] ${file}`);",
            "console.log(`[apply] committed in ${Date.now() - started}ms`);",
            "console.log('[apply] APPLIED');",
            "console.error(`[apply] UNKNOWN: ${msg}`);",
            "console.error(`[apply] REFUSED: ${msg}`);",
            "`[apply] ${definiteRefusal ? 'REFUSED' : 'UNKNOWN'} after ${Date.now() - started}ms`",
            "console.log('[apply] DRY RUN: nothing sent.');",
        ):
            self.assertIn(printed, applier, "the applier renamed a line readiness reads")
        self.assertLess(applier.index("[apply] committed in"), applier.index("'[apply] APPLIED'"))
        self.assertIn("console.log(`[window] ${line}`);", installer)
        self.assertIn("say(`result: ${verdict}`);", installer)
        self.assertRegex(installer, r"finish\(\s*3,\s*`UNKNOWN \\`\$\{f\}\\` \(exit")
        self.assertTrue(mod.APPLY_FILE_LINE_RE.match("[apply] 20261127000009_r.sql"))
        self.assertTrue(mod.APPLY_COMMITTED_RE.match("[apply] committed in 2817ms"))
        self.assertEqual(mod.APPLY_COMMITTED_LINE, "[apply] APPLIED")
        self.assertTrue("[apply] UNKNOWN: x".startswith(mod.APPLY_UNKNOWN_PREFIX))
        self.assertTrue("[apply] UNKNOWN after 3ms".startswith(mod.APPLY_UNKNOWN_PREFIX))
        self.assertTrue("[apply] REFUSED after 3ms".startswith(mod.APPLY_REFUSED_PREFIX))
        self.assertTrue("[apply] DRY RUN: nothing sent.".startswith(mod.APPLY_DRY_RUN_PREFIX))
        self.assertTrue("[window] result: UNKNOWN `f.sql` (exit 3)".startswith(mod.WINDOW_UNKNOWN_PREFIX))

    # --- O36b finding 6: the carve-out is the selector's own ---

    def test_the_inert_carve_out_is_the_helpers_for_the_exact_target(self):
        gh_get, gh_text = self._gh(
            [self._apply(908, 98, "2026-11-27T11:00:00Z")], [], {98: "[apply] 20261127000005_v.sql\n[apply] committed in 9ms"}
        )
        seen = []
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper({"20261127000005"}, seen))[0], "fresh")
        self.assertEqual(seen, [("/repo", "c" * 40, (self.SHA,))])
        # A version the candidate itself ships is never inert: the helper leaves it out of its answer.
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper(set()))[0], "stale")
        # Above the helper's limit nothing is left out anywhere.
        real = mod.load_inert_helper(ROOT)
        many = {f"202611270001{i:02d}" for i in range(real.INERT_SUBSET_LIMIT + 1)} | {"20261127000005"}
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper(many))[0], "stale")
        within = {f"202611270001{i:02d}" for i in range(real.INERT_SUBSET_LIMIT - 1)} | {"20261127000005"}
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper(within))[0], "fresh")
        # The real helper, asked about SHAs it cannot list, leaves nothing out.
        self.assertEqual(mod.inert_carve_out(real, ROOT, "c" * 40, self.SHA), frozenset())
        self.assertFalse(hasattr(mod, "load_engine_inert"))

    # --- O36b finding 7: the certificate of the run's own attempt ---

    def test_the_certificate_read_is_the_one_named_for_the_runs_attempt(self):
        artifacts = [
            {"id": 5, "name": f"backup-certificate-{self.SHA}-1", "expired": False},
            {"id": 6, "name": f"backup-certificate-{self.SHA}-2", "expired": False},
        ]
        archives = {
            5: self._zip({"database": {"restoredAt": "2026-11-27T07:25:01Z"}}),
            6: self._zip({"database": {"restoredAt": "2026-11-27T10:05:00Z"}}),
        }
        gh_get, gh_text = self._gh([], [], {}, artifacts=artifacts, attempt=1)
        self.assertIn("01:25", self._judge(gh_get, gh_text, archives=archives)[1])
        gh_get, gh_text = self._gh([], [], {}, artifacts=artifacts, attempt=2)
        self.assertIn("04:05", self._judge(gh_get, gh_text, archives=archives)[1])
        gh_get, gh_text = self._gh([], [], {}, artifacts=artifacts[:1], attempt=2)
        verdict, detail = self._judge(gh_get, gh_text, archives=archives)
        self.assertEqual(verdict, "unread")
        self.assertIn(f"backup-certificate-{self.SHA}-2", detail)
        # A run the report already listed is not read a second time for its attempt.
        calls = []
        gh_get, gh_text = self._gh([], [], {}, artifacts=artifacts, attempt=1, calls=calls)
        self.assertIn("04:05", self._judge(gh_get, gh_text, archives=archives, attempts={700: 2})[1])
        self.assertNotIn("repos/o/r/actions/runs/700", calls)
        selector = (ROOT / "scripts/ci/select-daily-engine.py").read_text()
        self.assertIn("""name = f'backup-certificate-{sha}-{run["run_attempt"]}'""", selector)

    # --- O36b finding 8: fresh says what was read, not that contents were compared ---

    def test_fresh_says_no_install_was_seen_in_the_job_logs(self):
        gh_get, gh_text = self._gh([], [], {})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "fresh")
        self.assertIn("no install seen in the applier's job logs since the copy was restored", detail)
        self.assertNotIn("current", detail)
        health = {"phase": "idle"}
        git_info = {"totalCommitsSinceServing": 1, "controlSha": "c" * 40, "servingSha": "s" * 40}
        cand = [{"sha": "a" * 40, "subject": "x", "status": "SELECTABLE", "reason": "", "copyFreshness": "fresh", "copyFreshnessDetail": detail}]
        verdict, sha, summary = mod.determine_verdict(health, cand, [], git_info)
        self.assertEqual((verdict, sha), (mod.VERDICT_READY, "a" * 40))
        self.assertIn("no install seen in the applier's job logs", summary)

    # --- 2026-11-27: an install in flight is a risk, not a blind spot ---

    PENDING = "20261127120000_horse_threshold.sql"

    def test_an_install_in_flight_of_a_non_inert_file_is_at_risk_naming_it(self):
        for state in ("in_progress", "queued"):
            gh_get, gh_text = self._gh([self._inflight(910, self.PENDING, state)], [], {})
            verdict, detail = self._judge(gh_get, gh_text, helper=self._helper())
            self.assertEqual(verdict, "at-risk", detail)
            self.assertIn(self.PENDING, detail)
            self.assertIn("run 910", detail)
            self.assertIn(state, detail)
            self.assertIn("refuses this certificate", detail)
        health = {"phase": "idle"}
        git_info = {"totalCommitsSinceServing": 1, "controlSha": "c" * 40, "servingSha": "s" * 40}
        cand = [{"sha": "a" * 40, "subject": "x", "status": "SELECTABLE", "reason": "", "copyFreshness": verdict, "copyFreshnessDetail": detail}]
        got, sha, summary = mod.determine_verdict(health, cand, [], git_info)
        self.assertEqual((got, sha), (mod.VERDICT_AT_RISK, "a" * 40))
        self.assertNotEqual(got, mod.VERDICT_READY)
        self.assertIn("aaaaaaaaaaaa is certified and selectable now, but", summary)
        self.assertIn(self.PENDING, summary)
        self.assertEqual(mod.EXIT_CODES[mod.VERDICT_AT_RISK], 0)
        # A committed install the copy lacks still makes it stale, whatever is in flight beside it.
        done = self._apply(911, 92, "2026-11-27T11:00:00Z")
        gh_get, gh_text = self._gh([done, self._inflight(912, self.PENDING)], [], {92: "[apply] 20261127000005_v.sql\n[apply] APPLIED"})
        self.assertEqual(self._judge(gh_get, gh_text)[0], "stale")
        # The apply job finished and only the refusal report runs: its log is read, not guessed.
        jobs = [{"id": 914, "name": f"Apply {self.PENDING}", "status": "completed", "conclusion": "success", "completed_at": "2026-11-27T11:00:00Z"},
                {"id": 915, "name": mod.APPLY_REPORT_JOB, "status": "in_progress", "conclusion": None}]
        gh_get, gh_text = self._gh([self._inflight(913, self.PENDING, jobs=jobs)], [], {914: f"[apply] {self.PENDING}\n[apply] APPLIED"})
        verdict, detail = self._judge(gh_get, gh_text)
        self.assertEqual(verdict, "stale", detail)
        self.assertIn(self.PENDING[:14], detail)

    def test_an_install_in_flight_of_an_inert_file_or_one_the_copy_holds_changes_nothing(self):
        gh_get, gh_text = self._gh([self._inflight(920, self.PENDING)], [], {})
        verdict, detail = self._judge(gh_get, gh_text, helper=self._helper({self.PENDING[:14]}))
        self.assertEqual(verdict, "fresh", detail)
        self.assertIn(f"left out as engine-inert: {self.PENDING[:14]}", detail)
        self.assertIn(f"install in flight changes nothing: {self.PENDING[:14]}", detail)
        archives = self._evidenced(self.COPY_AT, "2026-11-27T10:04:00Z", versions=[self.PENDING[:14]])
        verdict, detail = self._judge(gh_get, gh_text, helper=self._helper(), archives=archives)
        self.assertEqual(verdict, "fresh", detail)
        self.assertIn(f"already in the copy: {self.PENDING[:14]}", detail)
        # The same copy without it: at risk.
        archives = self._evidenced(self.COPY_AT, "2026-11-27T10:04:00Z", versions=["20261127000001"])
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper(), archives=archives)[0], "at-risk")

    def test_an_install_in_flight_whose_file_cannot_be_identified_is_unread(self):
        cases = {
            "no name": ({"id": 930, "status": "queued", "created_at": "2026-11-27T11:00:00Z"}, []),
            "names disagree": self._inflight(931, self.PENDING, jobs=[{"id": 1, "name": "Apply 20261127120001_other.sql", "status": "in_progress"}]),
            "a name that is not a migration": ({"id": 932, "status": "queued", "created_at": "2026-11-27T11:00:00Z", "display_title": "Apply Merged Migration ../x"}, []),
            "an unknown job running": self._inflight(933, self.PENDING, jobs=[{"id": 2, "name": "something else", "status": "in_progress"}]),
        }
        for label, run in cases.items():
            gh_get, gh_text = self._gh([run], [], {})
            verdict, detail = self._judge(gh_get, gh_text, helper=self._helper())
            self.assertEqual(verdict, "unread", label)
            self.assertIn(str(run[0]["id"]), detail, label)

    def test_the_skipped_refusal_report_of_a_finished_apply_run_is_not_a_log_to_read(self):
        # Run 46091917200 (2026-11-27): its "Report a refused install" job was skipped and GitHub
        # answers its log with HTTP 404, so every Apply run after a copy read as unread.
        run = {"id": 950, "status": "completed", "created_at": "2026-11-27T11:00:00Z", "updated_at": "2026-11-27T11:01:00Z"}
        jobs = [
            {"id": 951, "name": f"Apply {self.PENDING}", "status": "completed", "conclusion": "success", "completed_at": "2026-11-27T11:00:30Z"},
            {"id": 952, "name": mod.APPLY_REPORT_JOB, "status": "completed", "conclusion": "skipped", "completed_at": "2026-11-27T11:00:31Z"},
        ]
        calls = []
        gh_get, gh_text = self._gh([(run, jobs)], [], {951: f"[apply] {self.PENDING}\n[apply] committed in 9ms"}, calls=calls)
        verdict, detail = self._judge(gh_get, gh_text, helper=self._helper({self.PENDING[:14]}))
        self.assertEqual(verdict, "fresh", detail)
        self.assertNotIn("repos/o/r/actions/jobs/952/logs", calls)
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper())[0], "stale")
        # A skipped apply job ran nothing either.
        skipped = [dict(jobs[0], conclusion="skipped")]
        gh_get, gh_text = self._gh([(run, skipped)], [], {})
        self.assertEqual(self._judge(gh_get, gh_text, helper=self._helper())[0], "fresh")

    def test_the_names_are_the_ones_the_apply_workflow_gives(self):
        workflow = (ROOT / ".github/workflows/apply-merged-migration.yml").read_text()
        self.assertIn(
            "run-name: Apply Merged Migration ${{ inputs.migration || github.event.client_payload.migration }}"
            "${{ github.event.client_payload.intent_nonce && format(' {0}', github.event.client_payload.intent_nonce) || '' }}",
            workflow,
        )
        self.assertIn("    name: Apply ${{ inputs.migration || github.event.client_payload.migration }}\n", workflow)
        self.assertIn(f"    name: {mod.APPLY_REPORT_JOB}\n", workflow)
        self.assertEqual(re.findall(r"^  ([a-z][a-z-]*):$", workflow.split("\njobs:\n", 1)[1], re.M), ["apply", "report-refusal"])
        self.assertTrue(mod.APPLY_RUN_NAME_RE.match(
            "Apply Merged Migration 20261127230642_horse_option_register_holdem_turn_bluff_on_people.sql f032cf11ec76b0e0cd7c7e9e8925777e"))

    def test_the_copy_is_dated_by_the_export_when_it_is_earlier_than_the_restore(self):
        # Backup run 46085911560: evidence captured 22:14:43Z after pg_dump, copy restored 22:15:45Z.
        install = [self._apply(940, 94, "2026-11-27T10:02:00Z")]
        gh_get, gh_text = self._gh(install, [], {94: "[apply] 20261127000005_v.sql\n[apply] APPLIED"})
        self.assertEqual(self._judge(gh_get, gh_text)[0], "fresh")  # restoredAt 10:05 alone
        archives = self._evidenced(self.COPY_AT, "2026-11-27T10:00:00.479625+00:00")
        verdict, detail = self._judge(gh_get, gh_text, archives=archives)
        self.assertEqual(verdict, "stale", detail)
        self.assertIn("04:00", detail)
        # An evidence time after the restore never moves the copy later.
        archives = self._evidenced(self.COPY_AT, "2026-11-27T10:30:00Z")
        self.assertEqual(self._judge(gh_get, gh_text, archives=archives)[0], "fresh")
        # Evidence the certificate does not bind is unread, never a date.
        archives = self._evidenced(self.COPY_AT, "2026-11-27T10:00:00Z", bound=False)
        self.assertEqual(self._judge(gh_get, gh_text, archives=archives)[0], "unread")
        # The export captures the evidence after pg_dump, compared equal to the set before it.
        tool = (ROOT / "server/standby/schema-evidence.py").read_text()
        self.assertIn("'capturedAt': datetime.now(timezone.utc).isoformat()", tool)
        backup = (ROOT / ".github/workflows/backup-engine.yml").read_text()
        before = backup.index('schema-evidence.py capture --output "$RUNNER_TEMP/out/schema-before.json"')
        after = backup.index('schema-evidence.py capture --dump "$RUNNER_TEMP/out/schema.dump" --output "$RUNNER_TEMP/out/schema-evidence.json"')
        self.assertLess(before, after)
        self.assertIn('schema-evidence.py compare "$RUNNER_TEMP/out/schema-before.json" "$RUNNER_TEMP/out/schema-evidence.json"', backup)


if __name__ == "__main__":
    unittest.main()
