#!/usr/bin/env python3
"""Pre-cutover vs. post-cutover live /health baseline diff tool.

Compares a pre-cutover /health JSON snapshot (:45) against a post-cutover
/health JSON snapshot (:15) to verify hard SLO invariants and detect relative
performance or capacity regressions.

Exit codes (CLAUDE.md 10.86 fail-safe):
  0  Healthy (all hard SLOs pass and no relative regressions exceed thresholds)
  1  Hard SLO breach detected on post-cutover snapshot
  2  Relative regression warning (all hard SLOs pass, >=1 regression breached)
  3  Unreadable, missing, or malformed input snapshot
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

sys.dont_write_bytecode = True

EXIT_HEALTHY = 0
EXIT_HARD_SLO_BREACH = 1
EXIT_REGRESSION_WARNING = 2
EXIT_UNREADABLE = 3

DEFAULT_RSS_GROWTH_PCT = 25.0
DEFAULT_RSS_FLOOR_MB = 200.0
DEFAULT_EVENT_LOOP_P99_PCT = 30.0
DEFAULT_EVENT_LOOP_P99_FLOOR_MS = 15.0
DEFAULT_HORSE_COMPUTE_PCT = 35.0
DEFAULT_HORSE_COMPUTE_FLOOR_MS = 10.0
DEFAULT_DEAL_RATE_DROP_PCT = 25.0
DEFAULT_MIN_TABLES_FOR_DEAL_RATE = 3


class InputError(Exception):
    """Raised when an input snapshot is unreadable or malformed."""


def _is_finite_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def load_snapshot(path: str | Path, label: str) -> dict[str, Any]:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise InputError(f"{label} snapshot unreadable: {exc}") from exc
    if not raw.strip():
        raise InputError(f"{label} snapshot is empty")
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InputError(f"{label} snapshot contains invalid JSON: {exc.msg}") from exc
    if not isinstance(parsed, dict):
        raise InputError(f"{label} snapshot must be a JSON object")
    return parsed


def _extract_rss_mb(snapshot: dict[str, Any], label: str) -> float | None:
    memory = snapshot.get("memory")
    if memory is None:
        return None
    if not isinstance(memory, dict):
        raise InputError(f"{label}.memory must be an object when present")
    if "rssMb" in memory:
        val = memory["rssMb"]
        if val is None:
            return None
        if not _is_finite_number(val) or val < 0:
            raise InputError(f"{label}.memory.rssMb must be a non-negative finite number")
        return float(val)
    if "rssBytes" in memory:
        val = memory["rssBytes"]
        if val is None:
            return None
        if not _is_finite_number(val) or val < 0:
            raise InputError(f"{label}.memory.rssBytes must be a non-negative finite number")
        return float(val) / 1e6
    return None


def _extract_event_loop_p99_ms(snapshot: dict[str, Any], label: str) -> float | None:
    for container_key in ("eventLoopDelay", "mainEventLoopGovernor"):
        container = snapshot.get(container_key)
        if container is None:
            continue
        if not isinstance(container, dict):
            raise InputError(f"{label}.{container_key} must be an object when present")
        for field in ("p99Ms", "p99ms"):
            if field in container:
                val = container[field]
                if val is None:
                    return None
                if not _is_finite_number(val) or val < 0:
                    raise InputError(
                        f"{label}.{container_key}.{field} must be a non-negative finite number"
                    )
                return float(val)
    return None


def _extract_horse_compute_ms(snapshot: dict[str, Any], label: str) -> float | None:
    lhd = snapshot.get("liveHorseDecision")
    if lhd is None:
        return None
    if not isinstance(lhd, dict):
        raise InputError(f"{label}.liveHorseDecision must be an object when present")
    if "lastComputeMs" not in lhd or lhd["lastComputeMs"] is None:
        return None
    val = lhd["lastComputeMs"]
    if not _is_finite_number(val) or val < 0:
        raise InputError(f"{label}.liveHorseDecision.lastComputeMs must be a non-negative finite number")
    return float(val)


def _extract_deal_rate(snapshot: dict[str, Any], label: str) -> tuple[float | None, int | None]:
    dr = snapshot.get("dealRate")
    if dr is None:
        return None, None
    if not isinstance(dr, dict):
        raise InputError(f"{label}.dealRate must be an object when present")
    hands = dr.get("handsInWindow")
    tables = dr.get("tablesExpectedDealing")
    if hands is not None:
        if not _is_finite_number(hands) or hands < 0:
            raise InputError(f"{label}.dealRate.handsInWindow must be a non-negative finite number or null")
        hands = float(hands)
    if tables is not None:
        if not _is_exact_int(tables) or tables < 0:
            raise InputError(f"{label}.dealRate.tablesExpectedDealing must be a non-negative integer")
    return hands, tables


def _require_hard_slo_fields(post: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    liveness = post.get("liveness")
    if not isinstance(liveness, str) or not liveness:
        raise InputError("post.liveness is missing or not a non-empty string")
    checks.append({
        "name": "liveness",
        "expected": "ok",
        "actual": liveness,
        "passed": liveness == "ok",
    })

    for int_field in ("stalledTableCount", "blockedSettlementCount", "tournamentManagersQuarantined"):
        val = post.get(int_field)
        if not _is_exact_int(val) or val < 0:
            raise InputError(f"post.{int_field} is missing or not a non-negative integer")
        checks.append({
            "name": int_field,
            "expected": 0,
            "actual": val,
            "passed": val == 0,
        })

    settlement_status = post.get("settlementStatus")
    if not isinstance(settlement_status, str) or not settlement_status:
        raise InputError("post.settlementStatus is missing or not a non-empty string")
    checks.append({
        "name": "settlementStatus",
        "expected": "ok",
        "actual": settlement_status,
        "passed": settlement_status == "ok",
    })

    whole_fleet = post.get("wholeFleetStalled")
    if not isinstance(whole_fleet, bool):
        raise InputError("post.wholeFleetStalled is missing or not a boolean")
    checks.append({
        "name": "wholeFleetStalled",
        "expected": False,
        "actual": whole_fleet,
        "passed": whole_fleet is False,
    })

    return checks


def _check_upper_regression(
    *,
    name: str,
    unit: str,
    pre_val: float | None,
    post_val: float | None,
    max_growth_pct: float,
    floor: float,
) -> dict[str, Any]:
    if pre_val is None or post_val is None:
        return {
            "name": name,
            "unit": unit,
            "pre": pre_val,
            "post": post_val,
            "deltaPct": None,
            "thresholdPct": max_growth_pct,
            "floor": floor,
            "status": "unavailable",
            "regressed": False,
            "note": "metric missing or null in pre or post snapshot",
        }
    if post_val <= floor:
        denom = max(pre_val, floor)
        delta_pct = round(((post_val - pre_val) / denom) * 100.0, 2) if denom > 0 else 0.0
        return {
            "name": name,
            "unit": unit,
            "pre": round(pre_val, 3),
            "post": round(post_val, 3),
            "deltaPct": delta_pct,
            "thresholdPct": max_growth_pct,
            "floor": floor,
            "status": "within_floor",
            "regressed": False,
            "note": f"post value {round(post_val, 3)}{unit} is at or below floor {floor}{unit}",
        }
    denom = max(pre_val, floor)
    delta_pct = round(((post_val - pre_val) / denom) * 100.0, 2)
    regressed = delta_pct > max_growth_pct
    return {
        "name": name,
        "unit": unit,
        "pre": round(pre_val, 3),
        "post": round(post_val, 3),
        "deltaPct": delta_pct,
        "thresholdPct": max_growth_pct,
        "floor": floor,
        "status": "regressed" if regressed else "ok",
        "regressed": regressed,
        "note": (
            f"grew {delta_pct}% above threshold {max_growth_pct}% (baseline floor {floor}{unit})"
            if regressed
            else f"change {delta_pct}% within threshold {max_growth_pct}%"
        ),
    }


def _check_deal_rate_regression(
    *,
    pre_hands: float | None,
    pre_tables: int | None,
    post_hands: float | None,
    post_tables: int | None,
    max_drop_pct: float,
    min_tables: int,
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "name": "dealRate.handsPerTable",
        "unit": "hands/table",
        "preHands": pre_hands,
        "preTables": pre_tables,
        "postHands": post_hands,
        "postTables": post_tables,
        "pre": None,
        "post": None,
        "deltaPct": None,
        "thresholdPct": -max_drop_pct,
        "minTables": min_tables,
    }
    if pre_hands is None or post_hands is None or pre_tables is None or post_tables is None:
        return {
            **base,
            "status": "unavailable",
            "regressed": False,
            "note": "dealRate handsInWindow or tablesExpectedDealing missing or null",
        }
    if pre_tables < min_tables or post_tables < min_tables:
        return {
            **base,
            "status": "below_table_floor",
            "regressed": False,
            "note": f"fleet below min tables ({min_tables}) for adjusted deal-rate comparison",
        }
    pre_rate = pre_hands / pre_tables
    post_rate = post_hands / post_tables
    if pre_rate <= 0:
        return {
            **base,
            "pre": round(pre_rate, 3),
            "post": round(post_rate, 3),
            "status": "zero_baseline",
            "regressed": False,
            "note": "pre-cutover hands/table rate is 0; relative drop not defined",
        }
    drop_pct = ((pre_rate - post_rate) / pre_rate) * 100.0
    delta_pct = round(-drop_pct, 2)
    regressed = drop_pct > max_drop_pct
    return {
        **base,
        "pre": round(pre_rate, 3),
        "post": round(post_rate, 3),
        "deltaPct": delta_pct,
        "status": "regressed" if regressed else "ok",
        "regressed": regressed,
        "note": (
            f"table-adjusted deal rate dropped {round(drop_pct, 2)}% (limit {max_drop_pct}%)"
            if regressed
            else f"table-adjusted deal rate change {delta_pct}% within -{max_drop_pct}% limit"
        ),
    }


def format_markdown(receipt: dict[str, Any]) -> str:
    verdict = receipt["verdict"].upper()
    pre_sha = receipt["preMeta"].get("releaseSha") or "unknown"
    post_sha = receipt["postMeta"].get("releaseSha") or "unknown"
    lines = [
        f"## Post-Cutover Baseline Diff: {verdict}",
        "",
        f"- Pre-cutover release: `{pre_sha}`",
        f"- Post-cutover release: `{post_sha}`",
        f"- Exit code: `{receipt['exitCode']}`",
        "",
        "### Hard SLO Checks (Post-Cutover)",
        "",
        "| Check | Expected | Actual | Result |",
        "| --- | --- | --- | --- |",
    ]
    for check in receipt["hardSloChecks"]:
        status = "PASS" if check["passed"] else "BREACH"
        lines.append(
            f"| `{check['name']}` | `{check['expected']}` | `{check['actual']}` | {status} |"
        )

    lines.extend([
        "",
        "### Relative Regression Checks (Pre vs Post)",
        "",
        "| Metric | Pre | Post | Delta % | Threshold | Status |",
        "| --- | --- | --- | --- | --- | --- |",
    ])
    for reg in receipt["regressions"]:
        pre_s = "n/a" if reg["pre"] is None else f"{reg['pre']}"
        post_s = "n/a" if reg["post"] is None else f"{reg['post']}"
        delta_s = "n/a" if reg["deltaPct"] is None else f"{reg['deltaPct']:+.2f}%"
        thr = reg["thresholdPct"]
        thr_s = f"{thr:+.1f}%" if thr < 0 else f"+{thr:.1f}%"
        lines.append(
            f"| `{reg['name']}` | {pre_s} | {post_s} | {delta_s} | {thr_s} | {reg['status']} |"
        )

    if receipt["breaches"]:
        lines.extend(["", "### Hard SLO Breaches", ""])
        for item in receipt["breaches"]:
            lines.append(f"- {item}")
    if receipt["warnings"]:
        lines.extend(["", "### Regression Warnings", ""])
        for item in receipt["warnings"]:
            lines.append(f"- {item}")

    return "\n".join(lines) + "\n"


def _meta(snapshot: dict[str, Any]) -> dict[str, Any]:
    sha = snapshot.get("releaseSha") or snapshot.get("gitSha") or snapshot.get("commitSha")
    started = snapshot.get("engineStartedAt")
    return {
        "releaseSha": sha if isinstance(sha, str) else None,
        "engineStartedAt": started if isinstance(started, str) else None,
        "liveness": snapshot.get("liveness") if isinstance(snapshot.get("liveness"), str) else None,
    }


def compare_snapshots(
    pre: dict[str, Any],
    post: dict[str, Any],
    *,
    rss_growth_pct: float = DEFAULT_RSS_GROWTH_PCT,
    rss_floor_mb: float = DEFAULT_RSS_FLOOR_MB,
    event_loop_p99_pct: float = DEFAULT_EVENT_LOOP_P99_PCT,
    event_loop_p99_floor_ms: float = DEFAULT_EVENT_LOOP_P99_FLOOR_MS,
    horse_compute_pct: float = DEFAULT_HORSE_COMPUTE_PCT,
    horse_compute_floor_ms: float = DEFAULT_HORSE_COMPUTE_FLOOR_MS,
    deal_rate_drop_pct: float = DEFAULT_DEAL_RATE_DROP_PCT,
    min_tables_for_deal_rate: int = DEFAULT_MIN_TABLES_FOR_DEAL_RATE,
) -> dict[str, Any]:
    if not isinstance(pre, dict) or not isinstance(post, dict):
        raise InputError("both pre and post snapshots must be JSON objects")

    hard_checks = _require_hard_slo_fields(post)
    breaches = [
        f"{c['name']} expected {c['expected']!r}, got {c['actual']!r}"
        for c in hard_checks
        if not c["passed"]
    ]

    pre_rss = _extract_rss_mb(pre, "pre")
    post_rss = _extract_rss_mb(post, "post")
    pre_p99 = _extract_event_loop_p99_ms(pre, "pre")
    post_p99 = _extract_event_loop_p99_ms(post, "post")
    pre_horse = _extract_horse_compute_ms(pre, "pre")
    post_horse = _extract_horse_compute_ms(post, "post")
    pre_hands, pre_tables = _extract_deal_rate(pre, "pre")
    post_hands, post_tables = _extract_deal_rate(post, "post")

    regressions = [
        _check_upper_regression(
            name="memory.rssMb",
            unit="MB",
            pre_val=pre_rss,
            post_val=post_rss,
            max_growth_pct=rss_growth_pct,
            floor=rss_floor_mb,
        ),
        _check_upper_regression(
            name="eventLoopDelay.p99Ms",
            unit="ms",
            pre_val=pre_p99,
            post_val=post_p99,
            max_growth_pct=event_loop_p99_pct,
            floor=event_loop_p99_floor_ms,
        ),
        _check_upper_regression(
            name="liveHorseDecision.lastComputeMs",
            unit="ms",
            pre_val=pre_horse,
            post_val=post_horse,
            max_growth_pct=horse_compute_pct,
            floor=horse_compute_floor_ms,
        ),
        _check_deal_rate_regression(
            pre_hands=pre_hands,
            pre_tables=pre_tables,
            post_hands=post_hands,
            post_tables=post_tables,
            max_drop_pct=deal_rate_drop_pct,
            min_tables=min_tables_for_deal_rate,
        ),
    ]

    warnings = [f"{r['name']}: {r['note']}" for r in regressions if r["regressed"]]

    if breaches:
        verdict = "breach"
        exit_code = EXIT_HARD_SLO_BREACH
    elif warnings:
        verdict = "warning"
        exit_code = EXIT_REGRESSION_WARNING
    else:
        verdict = "healthy"
        exit_code = EXIT_HEALTHY

    receipt: dict[str, Any] = {
        "schemaVersion": 1,
        "verdict": verdict,
        "exitCode": exit_code,
        "preMeta": _meta(pre),
        "postMeta": _meta(post),
        "thresholds": {
            "rssGrowthPct": rss_growth_pct,
            "rssFloorMb": rss_floor_mb,
            "eventLoopP99Pct": event_loop_p99_pct,
            "eventLoopP99FloorMs": event_loop_p99_floor_ms,
            "horseComputePct": horse_compute_pct,
            "horseComputeFloorMs": horse_compute_floor_ms,
            "dealRateDropPct": deal_rate_drop_pct,
            "minTablesForDealRate": min_tables_for_deal_rate,
        },
        "hardSloChecks": hard_checks,
        "regressions": regressions,
        "breaches": breaches,
        "warnings": warnings,
    }
    receipt["markdownSummary"] = format_markdown(receipt)
    return receipt


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare pre-cutover (:45) and post-cutover (:15) /health snapshots."
    )
    parser.add_argument("--pre", required=True, help="Path to pre-cutover /health JSON snapshot")
    parser.add_argument("--post", required=True, help="Path to post-cutover /health JSON snapshot")
    parser.add_argument("--json-out", default="", help="Optional path to write JSON receipt")
    parser.add_argument("--markdown-out", default="", help="Optional path to write Markdown summary")
    parser.add_argument(
        "--format",
        choices=("json", "markdown"),
        default="json",
        help="Stdout format (default: json)",
    )
    parser.add_argument("--rss-growth-pct", type=float, default=DEFAULT_RSS_GROWTH_PCT)
    parser.add_argument("--rss-floor-mb", type=float, default=DEFAULT_RSS_FLOOR_MB)
    parser.add_argument("--event-loop-p99-pct", type=float, default=DEFAULT_EVENT_LOOP_P99_PCT)
    parser.add_argument(
        "--event-loop-p99-floor-ms", type=float, default=DEFAULT_EVENT_LOOP_P99_FLOOR_MS
    )
    parser.add_argument("--horse-compute-pct", type=float, default=DEFAULT_HORSE_COMPUTE_PCT)
    parser.add_argument(
        "--horse-compute-floor-ms", type=float, default=DEFAULT_HORSE_COMPUTE_FLOOR_MS
    )
    parser.add_argument("--deal-rate-drop-pct", type=float, default=DEFAULT_DEAL_RATE_DROP_PCT)
    parser.add_argument(
        "--min-tables-for-deal-rate", type=int, default=DEFAULT_MIN_TABLES_FOR_DEAL_RATE
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        pre = load_snapshot(args.pre, "pre")
        post = load_snapshot(args.post, "post")
        receipt = compare_snapshots(
            pre,
            post,
            rss_growth_pct=args.rss_growth_pct,
            rss_floor_mb=args.rss_floor_mb,
            event_loop_p99_pct=args.event_loop_p99_pct,
            event_loop_p99_floor_ms=args.event_loop_p99_floor_ms,
            horse_compute_pct=args.horse_compute_pct,
            horse_compute_floor_ms=args.horse_compute_floor_ms,
            deal_rate_drop_pct=args.deal_rate_drop_pct,
            min_tables_for_deal_rate=args.min_tables_for_deal_rate,
        )
    except InputError as exc:
        err_receipt = {
            "schemaVersion": 1,
            "verdict": "unreadable",
            "exitCode": EXIT_UNREADABLE,
            "error": str(exc),
        }
        if args.json_out:
            Path(args.json_out).write_text(json.dumps(err_receipt, indent=2) + "\n", encoding="utf-8")
        if args.format == "markdown":
            md = f"## Post-Cutover Baseline Diff: UNREADABLE\n\n- Error: {exc}\n"
            if args.markdown_out:
                Path(args.markdown_out).write_text(md, encoding="utf-8")
            print(md, end="")
        else:
            print(json.dumps(err_receipt, indent=2))
        return EXIT_UNREADABLE

    if args.json_out:
        Path(args.json_out).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if args.markdown_out:
        Path(args.markdown_out).write_text(receipt["markdownSummary"], encoding="utf-8")

    if args.format == "markdown":
        print(receipt["markdownSummary"], end="")
    else:
        print(json.dumps(receipt, indent=2))
    return int(receipt["exitCode"])


if __name__ == "__main__":
    sys.exit(main())
