#!/usr/bin/env python3
"""
Read-only Single-Pass SQL Cohort Pre-Image Validator (2026-11-02).

Compares the baseline equal-share settlement manifest (`reconciled_140_ownership_and_liabilities.json`)
against a single-pass live SQL snapshot of all assigned events (`139` equal-share targets,
excluding Event `16761305-83ad-4282-be72-5b9cb2dd88bc` unless `--include-special` is set).

Produces:
  1. The exact single-pass SQL query (`--emit-sql`) so the operator or automated runner can
     fetch all 139 events' live `status`, `abort_state`, `eligible_players`, `retained_seats`,
     `prize_balance`, `bounty_balance`, `fee_balance`, and `v4_settled` in one round trip.
  2. Deterministic comparison (`validate_cohort_preimage`) between the manifest baseline and
     the live SQL rows, reporting:
     - `ready_to_settle`: events whose live pre-image matches the baseline (or has already
       transitioned to `abort_state in ('stop_requested', 'stopped')` with unchanged balances
       and recipient counts).
     - `already_settled`: events with `v4_settled = true` or `abort_state = 'settled'`.
     - `drifted_events`: events where `status != 'RUNNING'`, `eligible_players` changed,
       `retained_seats` changed, or `prize_balance` / `bounty_balance` / `fee_balance` drifted,
       requiring an explicit per-event pre-image refresh before settlement.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys
from typing import Any, Dict, List, Sequence

SPECIAL_EVENT_ID = "16761305-83ad-4282-be72-5b9cb2dd88bc"


def build_single_pass_sql(tournament_ids: Sequence[str]) -> str:
    """Build the single-pass read-only SQL query for the given tournament UUIDs."""
    if not tournament_ids:
        raise ValueError("tournament_ids must not be empty")
    quoted_ids = ", ".join(f"'{tid}'::uuid" for tid in tournament_ids)
    return f"""WITH cohort_ids AS (
  SELECT unnest(ARRAY[{quoted_ids}]) AS tournament_id
),
live_players AS (
  SELECT
    tp.tournament_id,
    count(*) FILTER (WHERE tp.status = 'playing' AND tp.eliminated_at IS NULL)::int AS eligible_players
  FROM public.tournament_players tp
  JOIN cohort_ids c ON c.tournament_id = tp.tournament_id
  GROUP BY tp.tournament_id
),
live_seats AS (
  SELECT
    tb.tournament_id,
    count(ts.id) FILTER (WHERE ts.left_at IS NULL)::int AS retained_seats
  FROM public.tables tb
  JOIN cohort_ids c ON c.tournament_id = tb.tournament_id
  LEFT JOIN public.table_seats ts ON ts.table_id = tb.id AND ts.left_at IS NULL
  GROUP BY tb.tournament_id
),
chip_escrow AS (
  SELECT
    te.tournament_id,
    te.prize_balance::numeric(14,2) AS prize_balance,
    te.bounty_balance::numeric(14,2) AS bounty_balance,
    te.fee_balance::numeric(14,2) AS fee_balance
  FROM public.tournament_escrow te
  JOIN cohort_ids c ON c.tournament_id = te.tournament_id
),
v4_receipts AS (
  SELECT
    r.tournament_id,
    bool_or(r.receipt_version = 4) AS v4_settled
  FROM public.tournament_cancellation_receipts r
  JOIN cohort_ids c ON c.tournament_id = r.tournament_id
  GROUP BY r.tournament_id
)
SELECT
  t.id::text AS tournament_id,
  t.name,
  COALESCE(
    tat.asset,
    CASE WHEN t.club_id = '002c2d27-9584-4e52-835a-bb2be148fc81'::uuid THEN 'diamonds' ELSE 'chips' END
  ) AS asset,
  t.status,
  COALESCE(tat.state, 'none') AS abort_state,
  COALESCE(lp.eligible_players, 0) AS eligible_players,
  COALESCE(ls.retained_seats, 0) AS retained_seats,
  CASE
    WHEN COALESCE(
      tat.asset,
      CASE WHEN t.club_id = '002c2d27-9584-4e52-835a-bb2be148fc81'::uuid THEN 'diamonds' ELSE 'chips' END
    ) = 'diamonds'
      THEN COALESCE(de.prize_balance, 0)::text
    ELSE COALESCE(ce.prize_balance, 0.00)::numeric(14,2)::text
  END AS prize_balance,
  CASE
    WHEN COALESCE(
      tat.asset,
      CASE WHEN t.club_id = '002c2d27-9584-4e52-835a-bb2be148fc81'::uuid THEN 'diamonds' ELSE 'chips' END
    ) = 'diamonds'
      THEN COALESCE(de.bounty_balance, 0)::text
    ELSE COALESCE(ce.bounty_balance, 0.00)::numeric(14,2)::text
  END AS bounty_balance,
  CASE
    WHEN COALESCE(
      tat.asset,
      CASE WHEN t.club_id = '002c2d27-9584-4e52-835a-bb2be148fc81'::uuid THEN 'diamonds' ELSE 'chips' END
    ) = 'diamonds'
      THEN COALESCE(de.fee_balance, 0)::text
    ELSE COALESCE(ce.fee_balance, 0.00)::numeric(14,2)::text
  END AS fee_balance,
  COALESCE(vr.v4_settled, false) AS v4_settled
FROM cohort_ids c
JOIN public.tournaments t ON t.id = c.tournament_id
LEFT JOIN smarter_private.tournament_abort_targets tat ON tat.tournament_id = t.id
LEFT JOIN LATERAL public.fn_poker_diamond_tournament_escrow(t.id) de
  ON COALESCE(
    tat.asset,
    CASE WHEN t.club_id = '002c2d27-9584-4e52-835a-bb2be148fc81'::uuid THEN 'diamonds' ELSE 'chips' END
  ) = 'diamonds'
LEFT JOIN live_players lp ON lp.tournament_id = t.id
LEFT JOIN live_seats ls ON ls.tournament_id = t.id
LEFT JOIN chip_escrow ce ON ce.tournament_id = t.id
LEFT JOIN v4_receipts vr ON vr.tournament_id = t.id
ORDER BY t.id;
"""


def _norm_dec(val: Any) -> Decimal:
    if val is None or val == "":
        return Decimal("0")
    return Decimal(str(val))


def filter_manifest_events(
    manifest_data: Dict[str, Any], include_special: bool = False
) -> List[Dict[str, Any]]:
    events = list(manifest_data.get("events", []))
    if not include_special:
        events = [
            e
            for e in events
            if e.get("tournament_id") != SPECIAL_EVENT_ID
            and e.get("grp") != "other26_special1"
        ]
    return events


def validate_cohort_preimage(
    baseline_events: Sequence[Dict[str, Any]],
    live_rows: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    """Compare baseline manifest events against live SQL rows in a single pass."""
    live_by_id: Dict[str, Dict[str, Any]] = {
        str(r["tournament_id"]): r for r in live_rows
    }

    ready_to_settle: List[Dict[str, Any]] = []
    already_settled: List[Dict[str, Any]] = []
    drifted_events: List[Dict[str, Any]] = []
    missing_events: List[str] = []

    chip_prize_ready = Decimal("0.00")
    chip_bounty_ready = Decimal("0.00")
    chip_fee_ready = Decimal("0.00")
    diamond_prize_ready = Decimal("0")
    diamond_bounty_ready = Decimal("0")
    diamond_fee_ready = Decimal("0")

    for base in baseline_events:
        tid = str(base["tournament_id"])
        live = live_by_id.get(tid)
        if live is None:
            missing_events.append(tid)
            continue

        v4_settled = bool(live.get("v4_settled", False)) or (
            str(live.get("abort_state", "")) == "settled"
        )
        if v4_settled:
            already_settled.append(
                {
                    "tournament_id": tid,
                    "name": base.get("name"),
                    "asset": base.get("asset"),
                    "operation_id": base.get("operation_id"),
                    "status": live.get("status"),
                    "abort_state": live.get("abort_state"),
                }
            )
            continue

        diffs: Dict[str, Dict[str, Any]] = {}
        if str(live.get("status")) != "RUNNING":
            diffs["status"] = {
                "expected": "RUNNING",
                "actual": live.get("status"),
            }

        for count_key in ("eligible_players", "retained_seats"):
            exp_count = int(base.get(count_key, 0))
            act_count = int(live.get(count_key, 0))
            if exp_count != act_count:
                diffs[count_key] = {"expected": exp_count, "actual": act_count}

        for bal_key in ("prize_balance", "bounty_balance", "fee_balance"):
            exp_bal = _norm_dec(base.get(bal_key))
            act_bal = _norm_dec(live.get(bal_key))
            if exp_bal != act_bal:
                diffs[bal_key] = {
                    "expected": str(exp_bal),
                    "actual": str(act_bal),
                }

        if diffs:
            drifted_events.append(
                {
                    "tournament_id": tid,
                    "name": base.get("name"),
                    "asset": base.get("asset"),
                    "operation_id": base.get("operation_id"),
                    "diffs": diffs,
                }
            )
        else:
            ready_to_settle.append(
                {
                    "tournament_id": tid,
                    "name": base.get("name"),
                    "asset": base.get("asset"),
                    "operation_id": base.get("operation_id"),
                    "eligible_players": int(live.get("eligible_players", 0)),
                    "prize_balance": str(_norm_dec(live.get("prize_balance"))),
                    "bounty_balance": str(_norm_dec(live.get("bounty_balance"))),
                    "fee_balance": str(_norm_dec(live.get("fee_balance"))),
                }
            )
            if base.get("asset") == "diamonds":
                diamond_prize_ready += _norm_dec(live.get("prize_balance"))
                diamond_bounty_ready += _norm_dec(live.get("bounty_balance"))
                diamond_fee_ready += _norm_dec(live.get("fee_balance"))
            else:
                chip_prize_ready += _norm_dec(live.get("prize_balance"))
                chip_bounty_ready += _norm_dec(live.get("bounty_balance"))
                chip_fee_ready += _norm_dec(live.get("fee_balance"))

    ok = len(missing_events) == 0 and len(drifted_events) == 0
    return {
        "ok": ok,
        "total_baseline": len(baseline_events),
        "ready_count": len(ready_to_settle),
        "already_settled_count": len(already_settled),
        "drifted_count": len(drifted_events),
        "missing_count": len(missing_events),
        "totals_ready_by_asset": {
            "chips": {
                "prize_balance": f"{chip_prize_ready:.2f}",
                "bounty_balance": f"{chip_bounty_ready:.2f}",
                "fee_balance": f"{chip_fee_ready:.2f}",
            },
            "diamonds": {
                "prize_balance": str(int(diamond_prize_ready)),
                "bounty_balance": str(int(diamond_bounty_ready)),
                "fee_balance": str(int(diamond_fee_ready)),
            },
        },
        "ready_to_settle": ready_to_settle,
        "already_settled": already_settled,
        "drifted_events": drifted_events,
        "missing_events": missing_events,
    }


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Single-pass SQL cohort pre-image validator for equal-share settlements."
    )
    parser.add_argument(
        "--manifest",
        required=True,
        help="Path to reconciled_140_ownership_and_liabilities.json",
    )
    parser.add_argument(
        "--include-special",
        action="store_true",
        help="Include Event 16761305-83ad-4282-be72-5b9cb2dd88bc in the cohort (default: false, keeps 139 scope).",
    )
    parser.add_argument(
        "--emit-sql",
        action="store_true",
        help="Print the single-pass read-only SQL query and exit 0.",
    )
    parser.add_argument(
        "--live-json",
        help="Path to JSON file containing live SQL rows (or '-' for stdin).",
    )
    args = parser.parse_args(argv)

    manifest_path = Path(args.manifest)
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    baseline_events = filter_manifest_events(
        manifest_data, include_special=args.include_special
    )
    tournament_ids = [str(e["tournament_id"]) for e in baseline_events]

    if args.emit_sql:
        sys.stdout.write(build_single_pass_sql(tournament_ids))
        return 0

    if not args.live_json:
        parser.error("Either --emit-sql or --live-json is required")

    if args.live_json == "-":
        live_payload = json.loads(sys.stdin.read())
    else:
        live_payload = json.loads(Path(args.live_json).read_text(encoding="utf-8"))

    live_rows = (
        live_payload.get("rows", live_payload)
        if isinstance(live_payload, dict)
        else live_payload
    )
    report = validate_cohort_preimage(baseline_events, live_rows)
    sys.stdout.write(json.dumps(report, indent=2) + "\n")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
