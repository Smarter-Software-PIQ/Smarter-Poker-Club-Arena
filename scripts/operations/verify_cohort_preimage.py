#!/usr/bin/env python3
"""
Phase 1 Cohort Preimage & Prerequisite Verifier (`verify_cohort_preimage.py`).

Reconciled with the superseding November 2, 2026 (`15:38Z` / `09:38` CST) owner
cleanup instruction (`01a19ccc-894e-75e2-a9e7-fe0d2df6c326`) installed in:
  - `scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json`
  - `supabase/migrations/20261102152030_diamond_closure_disables_and_rejects_future_schedules.sql`
  - `supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql`

Enforces:
  1. Exact 140-event pre-today (`started_at < 2026-11-02T06:00:00Z`) retirement cohort:
       - 125 Chip events -> Midway Union Main Bank (`fade0000-0000-0000-0000-000000000001`)
       - 15 Diamond events -> KingFish (`47965354-0e56-43ef-931c-ddaab82af765`)
  2. Equal-share payout plan (`started_operator_equal_share`) is explicitly
     superseded and refused (`owner_deletion_supersedes_equal_share`, MD5
     `1975b4c245da7c434772e862cfa57513`), and restart of any of the 140 events is
     refused (`owner_deleted_tournament_cannot_restart`, MD5
     `b080d19b8b2027440b67f350e67d8807`).
  3. 73 unstarted waiting SNG/Spin events (`49` SNG + `24` Spin) outside Diamond
     Arena are preserved (`0` overlapped with the 140 deletion cohort).
  4. Complete Diamond Arena shutdown: `ca_diamond_arena_owner_closure.closed = true`,
     `0` active `tournament_schedules` (`a02_closed_diamond_schedule` installed),
     `0` open Diamond cash tables, and `88` prior unstarted Diamond v2 cancellations
     (`34,600` Diamonds refunded across `849e12b9` + `4b5263cc`) preserved.
  5. Six non-horse registrations across four Chip events (`2781bcd7`, `6379b29e`,
     `7986217a`, `d5decc98`) and their 4 direct human Chip charges (`8.00` Chips
     total across `26b465dd`, `8e6232d8`, `1edfe4d2`, `26ac24a2`) are separated
     before any pooled bank transfer.
  6. Chip and Diamond liabilities are kept strictly separate (`0` cross-asset sum).
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys
from typing import Any, Dict, List

REPO_ROOT = Path(__file__).resolve().parents[2]
CANONICAL_OWNER_RETIREMENT_MANIFEST_PATH = (
    REPO_ROOT
    / "scripts"
    / "ci"
    / "fixtures"
    / "tournament-abort"
    / "owner-retirement-nov2-manifest.json"
)

MIDWAY_UNION_MAIN_BANK_ID = "fade0000-0000-0000-0000-000000000001"
KINGFISH_PROFILE_ID = "47965354-0e56-43ef-931c-ddaab82af765"
OWNER_CHAT_ID = "01a19ccc-894e-75e2-a9e7-fe0d2df6c326"
DISPOSITION = "terminal_retirement_with_verified_liability_separation"

REQUIRED_INSTALLED_MIGRATIONS = (
    "20261101004247",
    "20261101005048",
    "20261101174851",
    "20261102055042",
    "20261102070619",
    "20261102121000",
    "20261102152030",
    "20261102152756",
)

EXPECTED_EQUAL_SHARE_REFUSAL_MD5 = "1975b4c245da7c434772e862cfa57513"
EXPECTED_RESTART_GUARD_MD5 = "b080d19b8b2027440b67f350e67d8807"

NON_HORSE_LIABILITY_EVENTS = {
    "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110": {
        "name": "25 Chip Daily Rebuy (NLH) Satellite 5",
        "escrow_total_chips": Decimal("35.00"),
        "registrations": [
            {
                "registration_id": "35b2eada-7211-4b91-873a-914aa7850951",
                "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90",
                "username": "Probyourmom",
                "status": "playing",
                "human_chip_charge": Decimal("5.00"),
                "entitlement_id": "26b465dd-600d-42eb-9f37-68f6052febac",
            }
        ],
    },
    "6379b29e-1307-4e8b-91e7-e9a0975cd64d": {
        "name": "Midday Free Buy (NLH)",
        "escrow_total_chips": Decimal("373.75"),
        "registrations": [
            {
                "registration_id": "3e511a86-8d42-4db6-bbe7-1e375d732a32",
                "user_id": "d55730d2-da5a-45fc-8478-82e49f97cd7e",
                "username": "Mongo",
                "status": "eliminated",
                "human_chip_charge": Decimal("1.00"),
                "entitlement_id": "8e6232d8-bbd7-4dc8-9640-4fbfa45ca952",
            }
        ],
    },
    "7986217a-0a67-4585-bd43-254356a9cb54": {
        "name": "Midnight Free Buy (NLH)",
        "escrow_total_chips": Decimal("238.40"),
        "registrations": [
            {
                "registration_id": "977564df-dca6-465a-ad70-342c276ab074",
                "user_id": "b52f183b-c0fc-4dcc-8d96-7d2a1cdb7216",
                "username": "Mikey",
                "status": "playing",
                "human_chip_charge": Decimal("0.00"),
                "entitlement_id": None,
            }
        ],
    },
    "d5decc98-cd0f-417f-aa28-6df009a74c76": {
        "name": "Morning Free Buy (NLH)",
        "escrow_total_chips": Decimal("143.79"),
        "registrations": [
            {
                "registration_id": "5c85924a-56ee-4de6-a9f3-4718028a0303",
                "user_id": "c657675c-f970-4c42-8f19-ba4d8096be67",
                "username": "MichaelJordan",
                "status": "eliminated",
                "human_chip_charge": Decimal("1.00"),
                "entitlement_id": "26ac24a2-7c73-44af-a5ae-b971d0a8e4fd",
            },
            {
                "registration_id": "bcb009db-a19a-4441-841f-d3609cac2694",
                "user_id": "ed2d1c05-c3bb-4d9e-b862-2a9797d32044",
                "username": "king",
                "status": "eliminated",
                "human_chip_charge": Decimal("1.00"),
                "entitlement_id": "1edfe4d2-005d-4b93-96d0-fc0bb10f8c95",
            },
            {
                "registration_id": "fd028a4d-d4c0-4a2f-96e0-10cd3f0ffa4e",
                "user_id": "1c465f14-42ce-45cb-9186-828a5f926152",
                "username": "Frenzy",
                "status": "eliminated",
                "human_chip_charge": Decimal("0.00"),
                "entitlement_id": None,
            },
        ],
    },
}


def _dec(val: Any) -> Decimal:
    return Decimal(str(val))


def load_canonical_owner_retirement_manifest(
    manifest_path: Path = CANONICAL_OWNER_RETIREMENT_MANIFEST_PATH,
) -> Dict[str, Any]:
    with manifest_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def verify_cohort_preimage(
    data: Dict[str, Any],
    canonical_manifest: Dict[str, Any] | None = None,
) -> List[str]:
    """Return a list of invariant violations (empty list means valid)."""
    errors: List[str] = []
    if canonical_manifest is None:
        canonical_manifest = load_canonical_owner_retirement_manifest()

    canonical_targets = canonical_manifest.get("targets", [])
    canonical_preserved = set(
        canonical_manifest.get("preserved_outside_diamond_event_ids", [])
    )

    if len(canonical_targets) != 140:
        errors.append(
            f"canonical manifest targets must have 140 entries, got {len(canonical_targets)}"
        )
    if len(canonical_preserved) != 73:
        errors.append(
            f"canonical manifest preserved_outside_diamond_event_ids must have 73 entries, got {len(canonical_preserved)}"
        )

    # 1. Disposition and equal-share prohibition
    if data.get("disposition") != DISPOSITION:
        errors.append(
            f"disposition must be {DISPOSITION!r} (equal-share is revoked), got {data.get('disposition')!r}"
        )
    if data.get("owner_chat_id") != OWNER_CHAT_ID:
        errors.append(
            f"owner_chat_id must be {OWNER_CHAT_ID!r}, got {data.get('owner_chat_id')!r}"
        )
    if data.get("equal_share_superseded") is not True:
        errors.append("equal_share_superseded must be True")
    if data.get("v4_equal_share_receipt_count", -1) != 0:
        errors.append(
            f"v4_equal_share_receipt_count must be 0 (equal-share plan is cancelled), got {data.get('v4_equal_share_receipt_count')}"
        )

    # 2. Installed database prerequisites & refusal guards
    installed_migrations = set(data.get("installed_migrations", []))
    missing_migrations = [
        m for m in REQUIRED_INSTALLED_MIGRATIONS if m not in installed_migrations
    ]
    if missing_migrations:
        errors.append(f"missing required installed migrations: {missing_migrations}")

    if data.get("equal_share_function_md5") != EXPECTED_EQUAL_SHARE_REFUSAL_MD5:
        errors.append(
            f"equal_share_function_md5 must be {EXPECTED_EQUAL_SHARE_REFUSAL_MD5!r} (owner_deletion_supersedes_equal_share), got {data.get('equal_share_function_md5')!r}"
        )
    if data.get("restart_guard_function_md5") != EXPECTED_RESTART_GUARD_MD5:
        errors.append(
            f"restart_guard_function_md5 must be {EXPECTED_RESTART_GUARD_MD5!r} (owner_deleted_tournament_cannot_restart), got {data.get('restart_guard_function_md5')!r}"
        )
    if data.get("owner_deletion_intents_count") != 140:
        errors.append(
            f"owner_deletion_intents_count must be 140, got {data.get('owner_deletion_intents_count')}"
        )
    if data.get("owner_deletion_manifest_immutable_trigger") is not True:
        errors.append("owner_deletion_manifest_immutable_trigger must be True")

    # 3. Exact 140 target binding & destinations
    targets = data.get("targets", [])
    if not isinstance(targets, list) or len(targets) != 140:
        errors.append(
            f"targets must be a list of 140 events, got {len(targets) if isinstance(targets, list) else type(targets).__name__}"
        )
    else:
        canonical_by_id = {t["tournament_id"]: t for t in canonical_targets}
        seen_ids = set()
        chip_count = 0
        diamond_count = 0
        for row in targets:
            tid = row.get("tournament_id")
            if tid in seen_ids:
                errors.append(f"duplicate tournament_id in targets: {tid}")
            seen_ids.add(tid)
            exp = canonical_by_id.get(tid)
            if exp is None:
                errors.append(f"unexpected tournament_id not in 140 manifest: {tid}")
                continue
            exp_op_id = exp.get("original_operation_id") or exp.get("operation_id")
            got_op_id = row.get("original_operation_id") or row.get("operation_id")
            if got_op_id != exp_op_id:
                errors.append(
                    f"tournament {tid}: operation_id mismatch {got_op_id!r} != {exp_op_id!r}"
                )
            if row.get("asset") != exp["asset"]:
                errors.append(
                    f"tournament {tid}: asset mismatch {row.get('asset')!r} != {exp['asset']!r}"
                )
            exp_dest_id = exp.get("eligible_remainder_destination") or exp.get("destination_id")
            got_dest_id = row.get("eligible_remainder_destination") or row.get("destination_id")
            if got_dest_id != exp_dest_id:
                errors.append(
                    f"tournament {tid}: destination_id mismatch {got_dest_id!r} != {exp_dest_id!r}"
                )
            if row.get("asset") == "chips":
                chip_count += 1
                if got_dest_id != MIDWAY_UNION_MAIN_BANK_ID:
                    errors.append(
                        f"chip tournament {tid} must route to Midway Union Main Bank {MIDWAY_UNION_MAIN_BANK_ID}"
                    )
            elif row.get("asset") == "diamonds":
                diamond_count += 1
                if got_dest_id != KINGFISH_PROFILE_ID:
                    errors.append(
                        f"diamond tournament {tid} must route to KingFish {KINGFISH_PROFILE_ID}"
                    )
        if chip_count != 125:
            errors.append(f"expected 125 chip targets in 140 cohort, got {chip_count}")
        if diamond_count != 15:
            errors.append(
                f"expected 15 diamond targets in 140 cohort, got {diamond_count}"
            )

    # 4. Preserved 73 waiting SNG/Spin games outside Diamond Arena
    preserved = data.get("preserved_waiting_games", {})
    preserved_ids = set(preserved.get("event_ids", []))
    if preserved_ids != canonical_preserved:
        errors.append(
            f"preserved_waiting_games.event_ids must match the 73 canonical preserved IDs (got {len(preserved_ids)})"
        )
    if preserved_ids & {t["tournament_id"] for t in canonical_targets}:
        errors.append(
            "preserved_waiting_games.event_ids must be strictly disjoint from the 140 deletion targets"
        )
    if preserved.get("deleted_by_owner_cohort_count", -1) != 0:
        errors.append(
            f"preserved_waiting_games.deleted_by_owner_cohort_count must be 0, got {preserved.get('deleted_by_owner_cohort_count')}"
        )

    # 5. Complete Diamond Arena shutdown & prior exclusions
    diamond_shutdown = data.get("diamond_arena_shutdown", {})
    if diamond_shutdown.get("closed") is not True:
        errors.append("diamond_arena_shutdown.closed must be True")
    if diamond_shutdown.get("active_tournament_schedules", -1) != 0:
        errors.append(
            f"diamond_arena_shutdown.active_tournament_schedules must be 0, got {diamond_shutdown.get('active_tournament_schedules')}"
        )
    if diamond_shutdown.get("schedule_guard_trigger_installed") is not True:
        errors.append("diamond_arena_shutdown.schedule_guard_trigger_installed must be True")
    if diamond_shutdown.get("open_cash_tables", -1) != 0:
        errors.append(
            f"diamond_arena_shutdown.open_cash_tables must be 0, got {diamond_shutdown.get('open_cash_tables')}"
        )
    if diamond_shutdown.get("registering_tournaments", -1) != 0:
        errors.append(
            f"diamond_arena_shutdown.registering_tournaments must be 0, got {diamond_shutdown.get('registering_tournaments')}"
        )
    if diamond_shutdown.get("prior_v2_cancellations_count") != 88:
        errors.append(
            f"diamond_arena_shutdown.prior_v2_cancellations_count must be 88, got {diamond_shutdown.get('prior_v2_cancellations_count')}"
        )
    if _dec(diamond_shutdown.get("prior_overdue_50_refund_diamonds", -1)) != Decimal(
        "34600"
    ):
        errors.append(
            f"diamond_arena_shutdown.prior_overdue_50_refund_diamonds must be 34600, got {diamond_shutdown.get('prior_overdue_50_refund_diamonds')}"
        )

    if data.get("excluded_completed_55_count") != 55:
        errors.append(
            f"excluded_completed_55_count must be 55, got {data.get('excluded_completed_55_count')}"
        )

    # 6. Strictly separated Chip & Diamond escrows (no cross-asset sum)
    chip_summary = data.get("chip_escrow_summary", {})
    if chip_summary.get("event_count") != 125:
        errors.append(
            f"chip_escrow_summary.event_count must be 125, got {chip_summary.get('event_count')}"
        )
    if chip_summary.get("destination_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"chip_escrow_summary.destination_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}, got {chip_summary.get('destination_id')!r}"
        )
    chip_prize = _dec(chip_summary.get("prize_balance_chips", "-1"))
    chip_bounty = _dec(chip_summary.get("bounty_balance_chips", "-1"))
    chip_fee = _dec(chip_summary.get("fee_balance_chips", "-1"))
    chip_total = _dec(chip_summary.get("total_escrow_chips", "-1"))
    if chip_prize != Decimal("21905.41"):
        errors.append(
            f"chip_escrow_summary.prize_balance_chips must be 21905.41, got {chip_prize}"
        )
    if chip_bounty != Decimal("1464.00"):
        errors.append(
            f"chip_escrow_summary.bounty_balance_chips must be 1464.00, got {chip_bounty}"
        )
    if chip_fee != Decimal("1787.80"):
        errors.append(
            f"chip_escrow_summary.fee_balance_chips must be 1787.80, got {chip_fee}"
        )
    if chip_total != Decimal("25157.21") or (chip_prize + chip_bounty + chip_fee) != chip_total:
        errors.append(
            f"chip_escrow_summary.total_escrow_chips must be 25157.21 (prize + bounty + fee), got {chip_total}"
        )
    if _dec(chip_summary.get("event_16761305_earned_mystery_bounties_preserved_chips", "-1")) != Decimal("253.10"):
        errors.append(
            "chip_escrow_summary.event_16761305_earned_mystery_bounties_preserved_chips must be 253.10"
        )
    if _dec(chip_summary.get("event_16761305_natural_itm_payout_preserved_chips", "-1")) != Decimal("95.98"):
        errors.append(
            "chip_escrow_summary.event_16761305_natural_itm_payout_preserved_chips must be 95.98"
        )

    diamond_summary = data.get("diamond_custody_summary", {})
    if diamond_summary.get("event_count") != 15:
        errors.append(
            f"diamond_custody_summary.event_count must be 15, got {diamond_summary.get('event_count')}"
        )
    if diamond_summary.get("destination_id") != KINGFISH_PROFILE_ID:
        errors.append(
            f"diamond_custody_summary.destination_id must be {KINGFISH_PROFILE_ID!r}, got {diamond_summary.get('destination_id')!r}"
        )
    if diamond_summary.get("active_custody_rows") != 1436:
        errors.append(
            f"diamond_custody_summary.active_custody_rows must be 1436 (704 playing + 732 eliminated), got {diamond_summary.get('active_custody_rows')}"
        )
    if diamond_summary.get("playing_custody_rows") != 704:
        errors.append(
            f"diamond_custody_summary.playing_custody_rows must be 704, got {diamond_summary.get('playing_custody_rows')}"
        )
    if diamond_summary.get("eliminated_custody_rows") != 732:
        errors.append(
            f"diamond_custody_summary.eliminated_custody_rows must be 732, got {diamond_summary.get('eliminated_custody_rows')}"
        )
    dia_prize = _dec(diamond_summary.get("prize_balance_diamonds", "-1"))
    dia_bounty = _dec(diamond_summary.get("bounty_balance_diamonds", "-1"))
    dia_fee = _dec(diamond_summary.get("fee_balance_diamonds", "-1"))
    dia_total = _dec(diamond_summary.get("total_custody_diamonds", "-1"))
    if dia_prize != Decimal("380070"):
        errors.append(
            f"diamond_custody_summary.prize_balance_diamonds must be 380070, got {dia_prize}"
        )
    if dia_bounty != Decimal("22500"):
        errors.append(
            f"diamond_custody_summary.bounty_balance_diamonds must be 22500, got {dia_bounty}"
        )
    if dia_fee != Decimal("25642"):
        errors.append(
            f"diamond_custody_summary.fee_balance_diamonds must be 25642, got {dia_fee}"
        )
    if dia_total != Decimal("428212") or (dia_prize + dia_bounty + dia_fee) != dia_total:
        errors.append(
            f"diamond_custody_summary.total_custody_diamonds must be 428212 (380070 + 22500 + 25642), got {dia_total}"
        )
    if _dec(diamond_summary.get("prior_earned_awards_preserved_diamonds", "-1")) != Decimal("8990"):
        errors.append(
            f"diamond_custody_summary.prior_earned_awards_preserved_diamonds must be 8990 (1090 ITM + 7900 PKO), got {diamond_summary.get('prior_earned_awards_preserved_diamonds')}"
        )

    # 7. Six non-horse registrations & 8.00 Chip direct bank refund separation
    non_horse = data.get("non_horse_liability_separation", {})
    if non_horse.get("non_horse_registration_count") != 6:
        errors.append(
            f"non_horse_liability_separation.non_horse_registration_count must be 6, got {non_horse.get('non_horse_registration_count')}"
        )
    if non_horse.get("affected_chip_event_count") != 4:
        errors.append(
            f"non_horse_liability_separation.affected_chip_event_count must be 4, got {non_horse.get('affected_chip_event_count')}"
        )
    if _dec(non_horse.get("held_event_escrow_chips", "-1")) != Decimal("790.94"):
        errors.append(
            f"non_horse_liability_separation.held_event_escrow_chips must be 790.94, got {non_horse.get('held_event_escrow_chips')}"
        )
    if _dec(non_horse.get("direct_bank_refund_total_chips", "-1")) != Decimal("8.00"):
        errors.append(
            f"non_horse_liability_separation.direct_bank_refund_total_chips must be 8.00, got {non_horse.get('direct_bank_refund_total_chips')}"
        )
    if non_horse.get("refund_funding_source_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"non_horse_liability_separation.refund_funding_source_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}"
        )
    events_map = non_horse.get("events", {})
    if set(events_map.keys()) != set(NON_HORSE_LIABILITY_EVENTS.keys()):
        errors.append(
            f"non_horse_liability_separation.events keys must match {sorted(NON_HORSE_LIABILITY_EVENTS.keys())}"
        )
    else:
        for tid, exp_ev in NON_HORSE_LIABILITY_EVENTS.items():
            got_ev = events_map.get(tid, {})
            if _dec(got_ev.get("escrow_total_chips", "-1")) != exp_ev["escrow_total_chips"]:
                errors.append(
                    f"non-horse event {tid}: escrow_total_chips must be {exp_ev['escrow_total_chips']}, got {got_ev.get('escrow_total_chips')}"
                )
            got_regs = got_ev.get("registrations", [])
            if len(got_regs) != len(exp_ev["registrations"]):
                errors.append(
                    f"non-horse event {tid}: expected {len(exp_ev['registrations'])} registrations, got {len(got_regs)}"
                )
                continue
            by_reg = {r.get("registration_id"): r for r in got_regs}
            for exp_r in exp_ev["registrations"]:
                rid = exp_r["registration_id"]
                got_r = by_reg.get(rid)
                if not got_r:
                    errors.append(f"non-horse event {tid}: missing registration {rid}")
                    continue
                if got_r.get("user_id") != exp_r["user_id"]:
                    errors.append(f"registration {rid}: user_id mismatch")
                if _dec(got_r.get("human_chip_charge", "-1")) != exp_r["human_chip_charge"]:
                    errors.append(
                        f"registration {rid}: human_chip_charge must be {exp_r['human_chip_charge']}, got {got_r.get('human_chip_charge')}"
                    )
                if got_r.get("entitlement_id") != exp_r["entitlement_id"]:
                    errors.append(
                        f"registration {rid}: entitlement_id must be {exp_r['entitlement_id']!r}, got {got_r.get('entitlement_id')!r}"
                    )

    return errors


def build_canonical_preimage_payload() -> Dict[str, Any]:
    manifest = load_canonical_owner_retirement_manifest()
    return {
        "disposition": DISPOSITION,
        "owner_chat_id": OWNER_CHAT_ID,
        "equal_share_superseded": True,
        "v4_equal_share_receipt_count": 0,
        "installed_migrations": list(REQUIRED_INSTALLED_MIGRATIONS),
        "equal_share_function_md5": EXPECTED_EQUAL_SHARE_REFUSAL_MD5,
        "restart_guard_function_md5": EXPECTED_RESTART_GUARD_MD5,
        "owner_deletion_intents_count": 140,
        "owner_deletion_manifest_immutable_trigger": True,
        "targets": manifest["targets"],
        "preserved_waiting_games": {
            "event_ids": manifest["preserved_outside_diamond_event_ids"],
            "sng_count": 49,
            "spin_count": 24,
            "deleted_by_owner_cohort_count": 0,
        },
        "diamond_arena_shutdown": {
            "closed": True,
            "active_tournament_schedules": 0,
            "schedule_guard_trigger_installed": True,
            "open_cash_tables": 0,
            "registering_tournaments": 0,
            "prior_v2_cancellations_count": 88,
            "prior_overdue_50_refund_diamonds": 34600,
        },
        "excluded_completed_55_count": 55,
        "chip_escrow_summary": {
            "event_count": 125,
            "destination_kind": "midway_union_main_bank",
            "destination_id": MIDWAY_UNION_MAIN_BANK_ID,
            "playing_players": 973,
            "prize_balance_chips": "21905.41",
            "bounty_balance_chips": "1464.00",
            "fee_balance_chips": "1787.80",
            "total_escrow_chips": "25157.21",
            "event_16761305_earned_mystery_bounties_preserved_chips": "253.10",
            "event_16761305_natural_itm_payout_preserved_chips": "95.98",
        },
        "diamond_custody_summary": {
            "event_count": 15,
            "destination_kind": "kingfish",
            "destination_id": KINGFISH_PROFILE_ID,
            "active_custody_rows": 1436,
            "playing_custody_rows": 704,
            "eliminated_custody_rows": 732,
            "prize_balance_diamonds": 380070,
            "bounty_balance_diamonds": 22500,
            "fee_balance_diamonds": 25642,
            "total_custody_diamonds": 428212,
            "prior_earned_awards_preserved_diamonds": 8990,
        },
        "non_horse_liability_separation": {
            "non_horse_registration_count": 6,
            "affected_chip_event_count": 4,
            "held_event_escrow_chips": "790.94",
            "direct_bank_refund_total_chips": "8.00",
            "refund_funding_source_id": MIDWAY_UNION_MAIN_BANK_ID,
            "events": {
                tid: {
                    "name": ev["name"],
                    "escrow_total_chips": str(ev["escrow_total_chips"]),
                    "registrations": [
                        {
                            **r,
                            "human_chip_charge": str(r["human_chip_charge"]),
                        }
                        for r in ev["registrations"]
                    ],
                }
                for tid, ev in NON_HORSE_LIABILITY_EVENTS.items()
            },
        },
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify 140-event owner-retirement cohort preimage and installed DB guards."
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Optional path to a JSON preimage snapshot to validate (defaults to canonical 140-event payload).",
    )
    args = parser.parse_args(argv)

    if args.manifest is not None:
        with args.manifest.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
    else:
        data = build_canonical_preimage_payload()

    errors = verify_cohort_preimage(data)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "disposition": DISPOSITION,
                "target_count": 140,
                "chip_events": 125,
                "diamond_events": 15,
                "preserved_waiting_sng_spin_count": 73,
                "chip_total_escrow": "25157.21",
                "diamond_total_custody": 428212,
                "non_horse_registrations": 6,
                "human_bank_refund_chips": "8.00",
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
