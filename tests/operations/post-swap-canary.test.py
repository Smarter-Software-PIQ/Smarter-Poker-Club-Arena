#!/usr/bin/env python3
"""Unit tests for scripts/release/post-swap-canary.py."""
from __future__ import annotations

import http.server
import importlib.util
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "release" / "post-swap-canary.py"
SHA = "a" * 40


def load_module():
    spec = importlib.util.spec_from_file_location("post_swap_canary", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {SCRIPT}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def healthy_health(
    *,
    sha: str = SHA,
    running: bool = True,
    liveness: str = "ok",
    stalled: int = 0,
    blocked: int = 0,
    quarantined: int = 0,
    settlement_status: str = "ok",
    whole_fleet_stalled: bool = False,
    hands: int = 12,
    tables_expected: int = 6,
    maint_active: bool = False,
) -> dict:
    return {
        "running": running,
        "releaseSha": sha,
        "instanceId": "1-deadbeef",
        "liveness": liveness,
        "stalledTableCount": stalled,
        "blockedSettlementCount": blocked,
        "tournamentManagersQuarantined": quarantined,
        "settlementStatus": settlement_status,
        "wholeFleetStalled": whole_fleet_stalled,
        "maintenance": {"active": maint_active},
        "dealRate": {
            "tablesExpectedDealing": tables_expected,
            "handsInWindow": hands,
        },
    }


class PostSwapCanaryTests(unittest.TestCase):
    def test_sustained_healthy_canary_passes(self) -> None:
        mod = load_module()
        samples = [
            healthy_health(hands=4),
            healthy_health(hands=8),
            healthy_health(hands=14),
            healthy_health(hands=20),
            healthy_health(hands=26),
        ]
        idx = [0]
        now = [1000.0]

        def fetch():
            cur = samples[min(idx[0], len(samples) - 1)]
            idx[0] += 1
            return cur

        def sleep(sec: float):
            now[0] += sec

        receipt = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=120,
            interval_seconds=30,
            fetch_fn=fetch,
            clock_fn=lambda: now[0],
            sleep_fn=sleep,
        )
        self.assertEqual(receipt["exitCode"], 0)
        self.assertEqual(receipt["verdict"], "healthy")
        self.assertEqual(receipt["breaches"], [])
        self.assertGreaterEqual(receipt["sampleCount"], 5)
        self.assertIn("Post-Swap Live Canary: HEALTHY", receipt["markdownSummary"])

    def test_active_maintenance_break_does_not_false_trigger_deal_rate(self) -> None:
        mod = load_module()
        now = [1000.0]
        receipt = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=120,
            interval_seconds=30,
            fetch_fn=lambda: healthy_health(hands=0, tables_expected=0, maint_active=True),
            clock_fn=lambda: now[0],
            sleep_fn=lambda s: now.__setitem__(0, now[0] + s),
        )
        self.assertEqual(receipt["exitCode"], 0)
        self.assertEqual(receipt["verdict"], "healthy")

    def test_hard_slo_breaches_fail_immediately(self) -> None:
        mod = load_module()
        cases = [
            ("liveness", healthy_health(liveness="degraded")),
            ("blockedSettlementCount", healthy_health(blocked=1)),
            ("tournamentManagersQuarantined", healthy_health(quarantined=1)),
            ("settlementStatus", healthy_health(settlement_status="degraded")),
            ("wholeFleetStalled", healthy_health(whole_fleet_stalled=True)),
            ("releaseSha", healthy_health(sha="b" * 40)),
            ("running", healthy_health(running=False)),
        ]
        for label, payload in cases:
            with self.subTest(case=label):
                now = [1000.0]
                receipt = mod.run_canary(
                    expected_sha=SHA,
                    duration_seconds=120,
                    interval_seconds=30,
                    fetch_fn=lambda p=payload: p,
                    clock_fn=lambda: now[0],
                    sleep_fn=lambda s: now.__setitem__(0, now[0] + s),
                )
                self.assertEqual(receipt["exitCode"], 1, label)
                self.assertEqual(receipt["verdict"], "breach", label)
                self.assertTrue(receipt["breaches"], label)

    def test_stalled_table_persisting_two_samples_breaches_but_single_transient_recovers(self) -> None:
        mod = load_module()
        # Transient 1-sample blip recovers cleanly
        seq_ok = [healthy_health(stalled=1), healthy_health(stalled=0), healthy_health(stalled=0)]
        i1 = [0]
        now1 = [1000.0]

        def fetch_ok():
            cur = seq_ok[min(i1[0], len(seq_ok) - 1)]
            i1[0] += 1
            return cur

        r1 = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=60,
            interval_seconds=30,
            fetch_fn=fetch_ok,
            clock_fn=lambda: now1[0],
            sleep_fn=lambda s: now1.__setitem__(0, now1[0] + s),
        )
        self.assertEqual(r1["exitCode"], 0)

        # Two consecutive stalled samples -> breach (exit 1)
        seq_bad = [healthy_health(stalled=1), healthy_health(stalled=1), healthy_health(stalled=0)]
        i2 = [0]
        now2 = [1000.0]

        def fetch_bad():
            cur = seq_bad[min(i2[0], len(seq_bad) - 1)]
            i2[0] += 1
            return cur

        r2 = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=60,
            interval_seconds=30,
            fetch_fn=fetch_bad,
            clock_fn=lambda: now2[0],
            sleep_fn=lambda s: now2.__setitem__(0, now2[0] + s),
        )
        self.assertEqual(r2["exitCode"], 1)
        self.assertIn("stalledTableCount", " ".join(r2["breaches"]))

    def test_zero_hands_across_sustained_post_thaw_window_breaches(self) -> None:
        mod = load_module()
        now = [1000.0]
        receipt = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=120,
            interval_seconds=30,
            fetch_fn=lambda: healthy_health(hands=0, tables_expected=6, maint_active=False),
            clock_fn=lambda: now[0],
            sleep_fn=lambda s: now.__setitem__(0, now[0] + s),
        )
        self.assertEqual(receipt["exitCode"], 1)
        self.assertIn("handsInWindow", " ".join(receipt["breaches"]))

    def test_consecutive_unreadable_health_exits_3_not_1(self) -> None:
        mod = load_module()
        now = [1000.0]

        def fail_fetch():
            raise RuntimeError("connection refused")

        receipt = mod.run_canary(
            expected_sha=SHA,
            duration_seconds=120,
            interval_seconds=30,
            fetch_fn=fail_fetch,
            clock_fn=lambda: now[0],
            sleep_fn=lambda s: now.__setitem__(0, now[0] + s),
        )
        self.assertEqual(receipt["exitCode"], 3)
        self.assertEqual(receipt["verdict"], "unreadable")

    def test_cli_over_local_http_server(self) -> None:
        payload = healthy_health(hands=15)

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        port = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory(dir=str(ROOT / "node_modules")) as td:
                json_out = Path(td) / "canary.json"
                md_out = Path(td) / "canary.md"
                res = subprocess.run(
                    [
                        sys.executable,
                        "-B",
                        str(SCRIPT),
                        "--url",
                        f"http://127.0.0.1:{port}/health",
                        "--expected-sha",
                        SHA,
                        "--duration-seconds",
                        "1",
                        "--interval-seconds",
                        "1",
                        "--json-out",
                        str(json_out),
                        "--markdown-out",
                        str(md_out),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                self.assertEqual(res.returncode, 0, res.stderr + res.stdout)
                parsed = json.loads(json_out.read_text(encoding="utf-8"))
                self.assertEqual(parsed["verdict"], "healthy")
                self.assertIn("Post-Swap Live Canary: HEALTHY", md_out.read_text(encoding="utf-8"))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
