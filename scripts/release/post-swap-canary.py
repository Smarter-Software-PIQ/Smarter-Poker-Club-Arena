#!/usr/bin/env python3
"""Deterministic post-swap live canary sampler for the engine release flow.

Runs strictly inside the release deploy flow (never on a timer/cron) right
after the swap seals and leadership is adopted. Samples /health across a
sustained window (default: 120s, every 15s) verifying hard runtime SLOs:
  - running == true and releaseSha == expected_sha
  - liveness == 'ok'
  - stalledTableCount == 0 (breaches on 2 consecutive samples or final sample)
  - blockedSettlementCount == 0
  - tournamentManagersQuarantined == 0
  - settlementStatus == 'ok'
  - wholeFleetStalled == false
  - dealRate.handsInWindow non-zero/progressing once thawed with active tables

Exit codes (CLAUDE.md 10.86 fail-safe):
  0  Healthy across the full canary window
  1  Confirmed hard SLO breach (triggers deterministic rollback)
  3  Unreadable / unreachable /health (fail closed without blind rollback)
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

sys.dont_write_bytecode = True

EXIT_HEALTHY = 0
EXIT_BREACH = 1
EXIT_UNREADABLE = 3

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
MIN_POST_THAW_SPAN_SECONDS = 60.0
MAX_CONSECUTIVE_UNREADABLE = 3


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def fetch_health(url: str, timeout: float = 15.0) -> dict[str, Any]:
    sep = "&" if "?" in url else "?"
    target = f"{url}{sep}nocache={time.time_ns()}"
    req = urllib.request.Request(
        target,
        headers={"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("/health payload is not a JSON object")
    return parsed


def _check_immediate_breaches(sample: dict[str, Any], expected_sha: str) -> list[str]:
    breaches: list[str] = []
    if sample.get("running") is not True:
        breaches.append(f"running={sample.get('running')!r} (expected true)")
    sha = sample.get("releaseSha")
    if sha != expected_sha:
        breaches.append(f"releaseSha={sha!r} (expected {expected_sha})")
    liveness = sample.get("liveness")
    if liveness != "ok":
        breaches.append(f"liveness={liveness!r} (expected 'ok')")
    blocked = sample.get("blockedSettlementCount")
    if not _is_exact_int(blocked) or blocked != 0:
        breaches.append(f"blockedSettlementCount={blocked!r} (expected 0)")
    quarantined = sample.get("tournamentManagersQuarantined")
    if not _is_exact_int(quarantined) or quarantined != 0:
        breaches.append(f"tournamentManagersQuarantined={quarantined!r} (expected 0)")
    settlement = sample.get("settlementStatus")
    if settlement != "ok":
        breaches.append(f"settlementStatus={settlement!r} (expected 'ok')")
    if sample.get("wholeFleetStalled") is True:
        breaches.append("wholeFleetStalled=true (expected false)")
    return breaches


def format_markdown(receipt: dict[str, Any]) -> str:
    verdict = str(receipt.get("verdict", "unknown")).upper()
    lines = [
        f"### Post-Swap Live Canary: {verdict}",
        "",
        f"- **Expected SHA:** `{receipt.get('expectedSha', 'unknown')}`",
        f"- **Samples collected:** `{receipt.get('sampleCount', 0)}` (window `{receipt.get('elapsedSeconds', 0)}s`)",
    ]
    breaches = receipt.get("breaches") or []
    if breaches:
        lines.append("- **Hard SLO breaches:**")
        for b in breaches:
            lines.append(f"  - `{b}`")
    else:
        lines.append("- **Hard SLO breaches:** none")
    if receipt.get("error"):
        lines.append(f"- **Error:** `{receipt['error']}`")
    return "\n".join(lines) + "\n"


def run_canary(
    *,
    expected_sha: str,
    duration_seconds: float = 120.0,
    interval_seconds: float = 15.0,
    fetch_fn: Callable[[], dict[str, Any]],
    clock_fn: Callable[[], float] = time.monotonic,
    sleep_fn: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    if not SHA_RE.fullmatch(expected_sha or ""):
        receipt = {
            "schemaVersion": 1,
            "verdict": "unreadable",
            "exitCode": EXIT_UNREADABLE,
            "expectedSha": expected_sha,
            "sampleCount": 0,
            "elapsedSeconds": 0.0,
            "breaches": [],
            "error": "invalid expected_sha",
        }
        receipt["markdownSummary"] = format_markdown(receipt)
        return receipt

    started = clock_fn()
    deadline = started + max(0.0, float(duration_seconds))
    interval = max(1.0, float(interval_seconds))

    samples: list[dict[str, Any]] = []
    breaches: list[str] = []
    consecutive_unreadable = 0
    consecutive_stalled = 0
    last_error = ""
    last_read_ok = False

    first_active_at: float | None = None
    last_active_at: float | None = None
    active_hands_values: list[int] = []

    while True:
        now = clock_fn()
        try:
            payload = fetch_fn()
            if not isinstance(payload, dict):
                raise ValueError("/health returned non-object JSON")
            consecutive_unreadable = 0
            last_read_ok = True
        except Exception as exc:
            consecutive_unreadable += 1
            last_read_ok = False
            last_error = str(exc)
            if consecutive_unreadable >= MAX_CONSECUTIVE_UNREADABLE:
                elapsed = round(max(0.0, clock_fn() - started), 2)
                receipt = {
                    "schemaVersion": 1,
                    "verdict": "unreadable",
                    "exitCode": EXIT_UNREADABLE,
                    "expectedSha": expected_sha,
                    "sampleCount": len(samples),
                    "elapsedSeconds": elapsed,
                    "breaches": [],
                    "error": f"{consecutive_unreadable} consecutive unreadable /health probes: {last_error}",
                }
                receipt["markdownSummary"] = format_markdown(receipt)
                return receipt
        else:
            dr = payload.get("dealRate") if isinstance(payload.get("dealRate"), dict) else {}
            maint = payload.get("maintenance") if isinstance(payload.get("maintenance"), dict) else {}
            stalled = payload.get("stalledTableCount")
            samples.append(
                {
                    "elapsedSeconds": round(max(0.0, now - started), 2),
                    "liveness": payload.get("liveness"),
                    "stalledTableCount": stalled,
                    "blockedSettlementCount": payload.get("blockedSettlementCount"),
                    "tournamentManagersQuarantined": payload.get("tournamentManagersQuarantined"),
                    "settlementStatus": payload.get("settlementStatus"),
                    "wholeFleetStalled": payload.get("wholeFleetStalled"),
                    "maintenanceActive": maint.get("active"),
                    "tablesExpectedDealing": dr.get("tablesExpectedDealing"),
                    "handsInWindow": dr.get("handsInWindow"),
                }
            )
            immediate = _check_immediate_breaches(payload, expected_sha)
            if immediate:
                breaches.extend(immediate)
                break

            if not _is_exact_int(stalled) or stalled != 0:
                consecutive_stalled += 1
                if consecutive_stalled >= 2:
                    breaches.append(
                        f"stalledTableCount={stalled!r} persisted across {consecutive_stalled} consecutive samples"
                    )
                    break
            else:
                consecutive_stalled = 0

            maint_active = maint.get("active") is True
            tables_expected = dr.get("tablesExpectedDealing")
            hands = dr.get("handsInWindow")
            if not maint_active and _is_exact_int(tables_expected) and tables_expected > 0:
                if first_active_at is None:
                    first_active_at = now
                last_active_at = now
                if _is_exact_int(hands):
                    active_hands_values.append(hands)

        now = clock_fn()
        if now >= deadline:
            break
        sleep_fn(min(interval, max(0.0, deadline - now)))

    if not breaches and not last_read_ok:
        elapsed = round(max(0.0, clock_fn() - started), 2)
        receipt = {
            "schemaVersion": 1,
            "verdict": "unreadable",
            "exitCode": EXIT_UNREADABLE,
            "expectedSha": expected_sha,
            "sampleCount": len(samples),
            "elapsedSeconds": elapsed,
            "breaches": [],
            "error": f"final /health probe unreadable: {last_error}",
        }
        receipt["markdownSummary"] = format_markdown(receipt)
        return receipt

    if not breaches and consecutive_stalled > 0:
        breaches.append(f"stalledTableCount remained non-zero on final canary sample")

    if (
        not breaches
        and first_active_at is not None
        and last_active_at is not None
        and (last_active_at - first_active_at) >= MIN_POST_THAW_SPAN_SECONDS
        and active_hands_values
        and max(active_hands_values) <= 0
    ):
        breaches.append(
            f"dealRate.handsInWindow stayed 0 across {round(last_active_at - first_active_at, 1)}s with active tables"
        )

    elapsed = round(max(0.0, clock_fn() - started), 2)
    verdict = "breach" if breaches else "healthy"
    exit_code = EXIT_BREACH if breaches else EXIT_HEALTHY
    receipt = {
        "schemaVersion": 1,
        "verdict": verdict,
        "exitCode": exit_code,
        "expectedSha": expected_sha,
        "sampleCount": len(samples),
        "elapsedSeconds": elapsed,
        "samples": samples,
        "breaches": breaches,
    }
    receipt["markdownSummary"] = format_markdown(receipt)
    return receipt


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Deterministic post-swap live canary check.")
    p.add_argument("--url", required=True, help="Health endpoint URL (e.g. https://engine.smarter.poker/health)")
    p.add_argument("--expected-sha", required=True, help="Expected 40-hex releaseSha")
    p.add_argument("--duration-seconds", type=float, default=120.0, help="Canary window duration (default: 120)")
    p.add_argument("--interval-seconds", type=float, default=15.0, help="Sample interval (default: 15)")
    p.add_argument("--timeout-seconds", type=float, default=15.0, help="Per-probe HTTP timeout (default: 15)")
    p.add_argument("--json-out", default="", help="Optional path to write JSON receipt")
    p.add_argument("--markdown-out", default="", help="Optional path to write Markdown summary")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    receipt = run_canary(
        expected_sha=args.expected_sha,
        duration_seconds=args.duration_seconds,
        interval_seconds=args.interval_seconds,
        fetch_fn=lambda: fetch_health(args.url, timeout=args.timeout_seconds),
    )
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if args.markdown_out:
        Path(args.markdown_out).write_text(receipt["markdownSummary"], encoding="utf-8")
    print(json.dumps(receipt, indent=2))
    return int(receipt["exitCode"])


if __name__ == "__main__":
    sys.exit(main())
