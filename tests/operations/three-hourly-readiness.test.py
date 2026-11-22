#!/usr/bin/env python3
"""Unit tests for scripts/release/three-hourly-readiness.py (pure mocked inputs)."""
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
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
        self.assertEqual(day_cycle["o3DeferStartUtc"], "2026-11-22T11:30:00Z")
        self.assertEqual(day_cycle["o3DeferStartChicago"], "2026-11-22T05:30:00-06:00")
        self.assertEqual(day_cycle["o3DeferStartChicagoLabel"], "2026-11-22 05:30:00 CST")
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
        self.assertEqual(open_cycle["o3DeferStartUtc"], "2026-11-22T11:30:00Z")
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

        # 2. OPEN right at 10:15Z (04:15 CST): nextDefer is O3 at 11:30Z on three-hourly, 23:45 CST on daily
        g_open_3h = mod.compute_migration_gate(
            datetime(2026, 11, 22, 10, 15, tzinfo=timezone.utc), "three-hourly"
        )
        self.assertEqual(g_open_3h["status"], "OPEN")
        self.assertIsNone(g_open_3h["clearAtUtc"])
        self.assertEqual(g_open_3h["nextDeferKind"], "O3_DEFERRAL")
        self.assertEqual(g_open_3h["nextDeferStartUtc"], "2026-11-22T11:30:00Z")
        self.assertEqual(g_open_3h["nextDeferStartChicagoLabel"], "2026-11-22 05:30:00 CST")

        g_open_daily = mod.compute_migration_gate(
            datetime(2026, 11, 22, 10, 15, tzinfo=timezone.utc), "daily"
        )
        self.assertEqual(g_open_daily["status"], "OPEN")
        self.assertEqual(g_open_daily["nextDeferKind"], "NIGHTLY_FREEZE")
        self.assertEqual(g_open_daily["nextDeferStartUtc"], "2026-11-23T05:45:00Z")

        # 3. O3_DEFERRAL daytime [cycleStart - 90m, cycleStart + 10m) for 07:00 CST (13:00Z)
        g_o3_start = mod.compute_migration_gate(
            datetime(2026, 11, 22, 11, 30, tzinfo=timezone.utc), "three-hourly"
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
        self.assertEqual(g_after_o3["nextDeferStartUtc"], "2026-11-22T14:30:00Z")

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
        self.assertEqual(g_sf_open["nextDeferStartUtc"], "2026-03-08T10:30:00Z")

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
        self.assertIn("2026-11-22T11:30:00Z", table)
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


if __name__ == "__main__":
    unittest.main()
