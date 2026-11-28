#!/usr/bin/env python3
"""Unit and CLI tests for scripts/release/post-cutover-baseline-diff.py."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "release" / "post-cutover-baseline-diff.py"


def load_module():
    spec = importlib.util.spec_from_file_location("post_cutover_baseline_diff", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


MOD = load_module()


def healthy_snapshot(**overrides):
    snap = {
        "releaseSha": "a" * 40,
        "engineStartedAt": "2026-11-28T09:45:00.000Z",
        "liveness": "ok",
        "stalledTableCount": 0,
        "blockedSettlementCount": 0,
        "tournamentManagersQuarantined": 0,
        "settlementStatus": "ok",
        "wholeFleetStalled": False,
        "memory": {"rssMb": 1200},
        "eventLoopDelay": {"p50Ms": 4.2, "p95Ms": 18.0, "p99Ms": 30.0, "maxMs": 60.0},
        "liveHorseDecision": {"phase": "ready", "lastComputeMs": 20.0},
        "dealRate": {"tablesExpectedDealing": 100, "handsInWindow": 400},
    }
    snap.update(overrides)
    return snap


class PostCutoverBaselineDiffTest(unittest.TestCase):
    def test_healthy_snapshots_exit_zero_and_zero_em_dashes(self):
        pre = healthy_snapshot(releaseSha="a" * 40)
        post = healthy_snapshot(
            releaseSha="b" * 40,
            memory={"rssMb": 1320},  # +10% (<=25%)
            eventLoopDelay={"p99Ms": 36.0},  # +20% (<=30%)
            liveHorseDecision={"phase": "ready", "lastComputeMs": 25.0},  # +25% (<=35%)
            dealRate={"tablesExpectedDealing": 80, "handsInWindow": 300},  # 3.75 vs 4.0 (-6.25%)
        )
        receipt = MOD.compare_snapshots(pre, post)
        self.assertEqual(receipt["exitCode"], 0)
        self.assertEqual(receipt["verdict"], "healthy")
        self.assertEqual(receipt["breaches"], [])
        self.assertEqual(receipt["warnings"], [])
        self.assertNotIn("\u2014", receipt["markdownSummary"])
        self.assertNotIn("\u2013", receipt["markdownSummary"])

    def test_every_hard_slo_breach_returns_exit_one(self):
        cases = [
            {"liveness": "degraded"},
            {"liveness": "dead"},
            {"stalledTableCount": 1},
            {"blockedSettlementCount": 2},
            {"tournamentManagersQuarantined": 1},
            {"settlementStatus": "blocked"},
            {"wholeFleetStalled": True},
        ]
        pre = healthy_snapshot()
        for override in cases:
            with self.subTest(override=override):
                post = healthy_snapshot(**override)
                receipt = MOD.compare_snapshots(pre, post)
                self.assertEqual(receipt["exitCode"], 1)
                self.assertEqual(receipt["verdict"], "breach")
                self.assertEqual(len(receipt["breaches"]), 1)

    def test_relative_regressions_trigger_exit_two_warnings(self):
        pre = healthy_snapshot()

        # RSS growth > 25%
        r_rss = MOD.compare_snapshots(pre, healthy_snapshot(memory={"rssMb": 1600}))
        self.assertEqual(r_rss["exitCode"], 2)
        self.assertEqual(r_rss["verdict"], "warning")
        self.assertTrue(any("memory.rssMb" in w for w in r_rss["warnings"]))

        # Event-loop p99 > 30%
        r_el = MOD.compare_snapshots(pre, healthy_snapshot(eventLoopDelay={"p99Ms": 45.0}))
        self.assertEqual(r_el["exitCode"], 2)
        self.assertTrue(any("eventLoopDelay.p99Ms" in w for w in r_el["warnings"]))

        # liveHorseDecision.lastComputeMs > 35%
        r_hd = MOD.compare_snapshots(
            pre, healthy_snapshot(liveHorseDecision={"phase": "ready", "lastComputeMs": 30.0})
        )
        self.assertEqual(r_hd["exitCode"], 2)
        self.assertTrue(any("liveHorseDecision.lastComputeMs" in w for w in r_hd["warnings"]))

        # Deal-rate adjusted for tablesExpectedDealing drop > 25%
        # pre: 400 / 100 = 4.0 hands/table; post: 200 / 100 = 2.0 hands/table (-50%)
        r_dr = MOD.compare_snapshots(
            pre, healthy_snapshot(dealRate={"tablesExpectedDealing": 100, "handsInWindow": 200})
        )
        self.assertEqual(r_dr["exitCode"], 2)
        self.assertTrue(any("dealRate.handsPerTable" in w for w in r_dr["warnings"]))

    def test_deal_rate_adjusts_for_smaller_fleet_without_false_alarm(self):
        # pre: 400 hands / 100 tables = 4.0 hands/table
        # post: 200 hands / 50 tables = 4.0 hands/table (0% drop despite 50% fewer total hands)
        pre = healthy_snapshot(dealRate={"tablesExpectedDealing": 100, "handsInWindow": 400})
        post = healthy_snapshot(dealRate={"tablesExpectedDealing": 50, "handsInWindow": 200})
        receipt = MOD.compare_snapshots(pre, post)
        self.assertEqual(receipt["exitCode"], 0)

    def test_floors_prevent_noise_on_small_values(self):
        pre = healthy_snapshot(
            memory={"rssMb": 100},
            eventLoopDelay={"p99Ms": 2.0},
            liveHorseDecision={"lastComputeMs": 1.0},
        )
        post = healthy_snapshot(
            memory={"rssMb": 190},  # <= 200MB floor
            eventLoopDelay={"p99Ms": 12.0},  # <= 15ms floor
            liveHorseDecision={"lastComputeMs": 9.0},  # <= 10ms floor
        )
        receipt = MOD.compare_snapshots(pre, post)
        self.assertEqual(receipt["exitCode"], 0)

    def test_hard_slo_breach_takes_precedence_over_warning(self):
        pre = healthy_snapshot()
        post = healthy_snapshot(stalledTableCount=1, memory={"rssMb": 2500})
        receipt = MOD.compare_snapshots(pre, post)
        self.assertEqual(receipt["exitCode"], 1)
        self.assertEqual(receipt["verdict"], "breach")
        self.assertTrue(receipt["breaches"])
        self.assertTrue(receipt["warnings"])

    def test_cli_unreadable_and_malformed_inputs_exit_three(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            good = root / "good.json"
            bad_json = root / "bad.json"
            empty = root / "empty.json"
            missing_slo = root / "missing_slo.json"
            wrong_type = root / "wrong_type.json"
            json_out = root / "receipt.json"
            md_out = root / "summary.md"

            good.write_text(json.dumps(healthy_snapshot()), encoding="utf-8")
            bad_json.write_text('{"liveness": "ok",', encoding="utf-8")
            empty.write_text("", encoding="utf-8")
            incomplete = healthy_snapshot()
            del incomplete["wholeFleetStalled"]
            missing_slo.write_text(json.dumps(incomplete), encoding="utf-8")
            wrong_type.write_text(
                json.dumps(healthy_snapshot(stalledTableCount="0")), encoding="utf-8"
            )

            for bad_path in (root / "does-not-exist.json", bad_json, empty, missing_slo, wrong_type):
                with self.subTest(bad_path=bad_path.name):
                    proc = subprocess.run(
                        [sys.executable, "-B", str(SCRIPT), "--pre", str(good), "--post", str(bad_path)],
                        capture_output=True,
                        text=True,
                    )
                    self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
                    payload = json.loads(proc.stdout)
                    self.assertEqual(payload["verdict"], "unreadable")

            # Verify CLI writes JSON and Markdown output files cleanly on healthy run
            proc = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPT),
                    "--pre",
                    str(good),
                    "--post",
                    str(good),
                    "--json-out",
                    str(json_out),
                    "--markdown-out",
                    str(md_out),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertTrue(json_out.exists())
            self.assertTrue(md_out.exists())
            md_text = md_out.read_text(encoding="utf-8")
            self.assertIn("Post-Cutover Baseline Diff: HEALTHY", md_text)
            self.assertNotIn("\u2014", md_text)

    def test_exit_three_writes_markdown_out_even_under_default_json_format(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            good = root / "good.json"
            bad = root / "bad.json"
            json_out = root / "err.json"
            md_out = root / "err.md"
            good.write_text(json.dumps(healthy_snapshot()), encoding="utf-8")
            bad.write_text("{not-json", encoding="utf-8")

            proc = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(SCRIPT),
                    "--pre",
                    str(good),
                    "--post",
                    str(bad),
                    "--json-out",
                    str(json_out),
                    "--markdown-out",
                    str(md_out),
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(proc.returncode, 3, proc.stdout + proc.stderr)
            self.assertEqual(json.loads(proc.stdout)["verdict"], "unreadable")
            self.assertTrue(json_out.exists())
            self.assertTrue(md_out.exists(), "--markdown-out must be written on exit 3 even with default --format json")
            self.assertIn("UNREADABLE", md_out.read_text(encoding="utf-8"))

    def test_zero_floor_and_zero_baseline_and_invalid_cli_floors_never_crash(self):
        pre = healthy_snapshot(memory={"rssMb": 0}, dealRate={"tablesExpectedDealing": 0, "handsInWindow": 0})
        post = healthy_snapshot(memory={"rssMb": 50}, dealRate={"tablesExpectedDealing": 0, "handsInWindow": 0})
        receipt = MOD.compare_snapshots(pre, post, rss_floor_mb=0.0)
        self.assertEqual(receipt["exitCode"], 2)
        self.assertEqual(receipt["verdict"], "warning")
        rss_reg = next(r for r in receipt["regressions"] if r["name"] == "memory.rssMb")
        self.assertTrue(rss_reg["regressed"])
        self.assertEqual(rss_reg["status"], "regressed")

        # Invalid CLI parameters (min-tables-for-deal-rate <= 0, negative or NaN floor) fail closed with InputError / exit 3
        with self.assertRaises(MOD.InputError):
            MOD.compare_snapshots(pre, post, min_tables_for_deal_rate=0)
        with self.assertRaises(MOD.InputError):
            MOD.compare_snapshots(pre, post, rss_floor_mb=-1.0)
        with self.assertRaises(MOD.InputError):
            MOD.compare_snapshots(pre, post, event_loop_p99_pct=float("nan"))

    def test_null_primary_metric_falls_back_to_secondary_fields(self):
        pre = healthy_snapshot(
            memory={"rssMb": None, "rssBytes": 1_000_000_000},
            eventLoopDelay={"p99Ms": None},
            mainEventLoopGovernor={"p99Ms": 20.0},
        )
        post = healthy_snapshot(
            memory={"rssMb": None, "rssBytes": 1_500_000_000},  # +50% (> 25%)
            eventLoopDelay={"p99Ms": None},
            mainEventLoopGovernor={"p99Ms": 40.0},  # +100% (> 30%)
        )
        receipt = MOD.compare_snapshots(pre, post)
        self.assertEqual(receipt["exitCode"], 2)
        rss_reg = next(r for r in receipt["regressions"] if r["name"] == "memory.rssMb")
        el_reg = next(r for r in receipt["regressions"] if r["name"] == "eventLoopDelay.p99Ms")
        self.assertEqual(rss_reg["pre"], 1000.0)
        self.assertEqual(rss_reg["post"], 1500.0)
        self.assertTrue(rss_reg["regressed"])
        self.assertEqual(el_reg["pre"], 20.0)
        self.assertEqual(el_reg["post"], 40.0)
        self.assertTrue(el_reg["regressed"])


if __name__ == "__main__":
    unittest.main()
