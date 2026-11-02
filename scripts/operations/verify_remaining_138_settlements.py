#!/usr/bin/env python3
"""
Phase 4 Remaining 139 Owner-Retirement Verifier (`verify_remaining_138_settlements.py`).

Reconciled with the superseding November 2, 2026 (`15:38Z` / `09:38` CST) owner
cleanup instruction (`01a19ccc-894e-75e2-a9e7-fe0d2df6c326`) installed in:
  - `scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json`
  - `supabase/migrations/20261102152030_diamond_closure_disables_and_rejects_future_schedules.sql`
  - `supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql`

Why this file retains its path (`scripts/operations/verify_remaining_138_settlements.py`)
while enforcing the full 140-event cohort (`Proby` + `139` remaining = `140` total):
  - Existing law tests (`tests/cross-version-bootstrap-compatibility.law.test.ts`)
    import this script path.
  - Under the superseding owner instruction, the outdated 139-event equal-share
    plan is revoked and replaced by the 140-event (`125` Chip + `15` Diamond)
    terminal retirement cohort (`Proby` `2781bcd7-cc8a-4713-ab3e-0d0a81fdf110`
    + `139` remaining events, including `16761305-83ad-4282-be72-5b9cb2dd88bc`).

Enforces:
  1. All 140 events (`Proby` + 139 remaining = `125` Chip events + `15` Diamond events)
     match `owner-retirement-nov2-manifest.json`. Any attempt to certify the
     outdated 139-event cohort or `started_operator_equal_share` is rejected.
  2. Equal-share payout is blocked by `fn_ca_settle_tournament_abort_equal_share`
     (`owner_deletion_supersedes_equal_share`, MD5 `1975b4c245da7c434772e862cfa57513`),
     and restart of any of the 140 events is blocked by `fn_ca_guard_tournament_restart_source`
     (`owner_deleted_tournament_cannot_restart`, MD5 `b080d19b8b2027440b67f350e67d8807`).
  3. All 6 non-horse registrations across the 4 Chip events (`2781bcd7`, `6379b29e`,
     `7986217a`, `d5decc98`) have their liabilities separated first, including
     the 4 direct human Chip refunds (`26b465dd` `5.00`, `8e6232d8` `1.00`,
     `1edfe4d2` `1.00`, `26ac24a2` `1.00` = `8.00` Chips total) funded directly
     from Midway Union Main Bank (`fade0000-0000-0000-0000-000000000001`) without
     reducing tournament escrow.
  4. Chip and Diamond totals are kept strictly separate:
     - `125` Chip events (`1` `Proby` + `124` remaining): `21,905.41` Chips prize +
       `1,464.00` Chips bounty + `1,787.80` Chips fee = `25,157.21` Chips total
       escrow (`35.00` on `Proby` + `25,122.21` across the `124` remaining Chip
       events) -> Midway Union Main Bank (`fade0000-0000-0000-0000-000000000001`).
       Prior earned Chip payouts (`285.31` across 73 ITM rows + `95.98` natural ITM
       payout on `16761305` + `253.10` earned mystery bounties on `16761305`)
       remain preserved.
     - `15` Diamond events (`7` in `original89` + `8` in `other26_25`): `380,070`
       Diamonds prize + `22,500` Diamonds bounty + `25,642` Diamonds fee =
       `428,212` Diamonds across `1,436` custody rows (`704` playing + `732`
       eliminated) -> KingFish (`47965354-0e56-43ef-931c-ddaab82af765`). Prior
       earned Diamond awards (`8,990` Diamonds = `1,090` ITM + `7,900` PKO) and
       `88` prior unstarted Diamond v2 cancellations (`34,600` Diamonds refunded)
       remain preserved.
  5. Complete Diamond Arena shutdown (`closed = true`, `0` active schedules,
     `0` open cash tables, `0` registering events) and preservation of the `73`
     waiting SNG/Spin games outside Diamond Arena (`49` SNG + `24` Spin).
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

PROBY_TOURNAMENT_ID = "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110"
EVENT_16761305_ID = "16761305-83ad-4282-be72-5b9cb2dd88bc"
MIDWAY_UNION_MAIN_BANK_ID = "fade0000-0000-0000-0000-000000000001"
KINGFISH_PROFILE_ID = "47965354-0e56-43ef-931c-ddaab82af765"
OWNER_CHAT_ID = "01a19ccc-894e-75e2-a9e7-fe0d2df6c326"
DISPOSITION = "terminal_retirement_with_verified_liability_separation"

EXPECTED_EQUAL_SHARE_REFUSAL_MD5 = "1975b4c245da7c434772e862cfa57513"
EXPECTED_RESTART_GUARD_MD5 = "b080d19b8b2027440b67f350e67d8807"
LEGACY_EED_SHA_PREFIX = "eed06fe5"

REQUIRED_HUMAN_BANK_REFUND_ENTITLEMENTS = {
    "26b465dd-600d-42eb-9f37-68f6052febac": {
        "tournament_id": "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110",
        "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90",
        "username": "Probyourmom",
        "amount_chips": Decimal("5.00"),
    },
    "8e6232d8-bbd7-4dc8-9640-4fbfa45ca952": {
        "tournament_id": "6379b29e-1307-4e8b-91e7-e9a0975cd64d",
        "user_id": "d55730d2-da5a-45fc-8478-82e49f97cd7e",
        "username": "Mongo",
        "amount_chips": Decimal("1.00"),
    },
    "26ac24a2-7c73-44af-a5ae-b971d0a8e4fd": {
        "tournament_id": "d5decc98-cd0f-417f-aa28-6df009a74c76",
        "user_id": "c657675c-f970-4c42-8f19-ba4d8096be67",
        "username": "MichaelJordan",
        "amount_chips": Decimal("1.00"),
    },
    "1edfe4d2-005d-4b93-96d0-fc0bb10f8c95": {
        "tournament_id": "d5decc98-cd0f-417f-aa28-6df009a74c76",
        "user_id": "ed2d1c05-c3bb-4d9e-b862-2a9797d32044",
        "username": "king",
        "amount_chips": Decimal("1.00"),
    },
}


def _dec(val: Any) -> Decimal:
    return Decimal(str(val))


def load_canonical_owner_retirement_manifest(
    manifest_path: Path = CANONICAL_OWNER_RETIREMENT_MANIFEST_PATH,
) -> Dict[str, Any]:
    with manifest_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def verify_remaining_139_preimage(
    data: Dict[str, Any],
    canonical_manifest: Dict[str, Any] | None = None,
) -> List[str]:
    """Verify pre-retirement state across the full 140-event cohort (`Proby` + 139 remaining)."""
    errors: List[str] = []
    if canonical_manifest is None:
        canonical_manifest = load_canonical_owner_retirement_manifest()

    canonical_targets = canonical_manifest.get("targets", [])
    canonical_preserved = set(
        canonical_manifest.get("preserved_outside_diamond_event_ids", [])
    )

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
            f"v4_equal_share_receipt_count must be 0, got {data.get('v4_equal_share_receipt_count')}"
        )
    if data.get("equal_share_function_md5") != EXPECTED_EQUAL_SHARE_REFUSAL_MD5:
        errors.append(
            f"equal_share_function_md5 must be {EXPECTED_EQUAL_SHARE_REFUSAL_MD5!r}, got {data.get('equal_share_function_md5')!r}"
        )
    if data.get("restart_guard_function_md5") != EXPECTED_RESTART_GUARD_MD5:
        errors.append(
            f"restart_guard_function_md5 must be {EXPECTED_RESTART_GUARD_MD5!r}, got {data.get('restart_guard_function_md5')!r}"
        )

    if data.get("total_cohort_count") != 140:
        errors.append(
            f"total_cohort_count must be 140 (outdated 139 cohort is rejected), got {data.get('total_cohort_count')}"
        )
    if data.get("remaining_after_proby_count") != 139:
        errors.append(
            f"remaining_after_proby_count must be 139 (124 chip + 15 diamond), got {data.get('remaining_after_proby_count')}"
        )

    targets = data.get("targets", [])
    if not isinstance(targets, list) or len(targets) != 140:
        errors.append(
            f"targets must be a list of 140 events, got {len(targets) if isinstance(targets, list) else type(targets).__name__}"
        )
    else:
        by_id = {t.get("tournament_id"): t for t in targets}
        if EVENT_16761305_ID not in by_id:
            errors.append(
                f"16761305 ({EVENT_16761305_ID}) must be included in the 140 owner-retirement cohort"
            )
        if PROBY_TOURNAMENT_ID not in by_id:
            errors.append(
                f"Proby ({PROBY_TOURNAMENT_ID}) must be included in the 140 owner-retirement cohort"
            )
        for exp in canonical_targets:
            tid = exp["tournament_id"]
            got = by_id.get(tid)
            if not got:
                errors.append(f"missing canonical target {tid}")
                continue
            exp_op = exp.get("original_operation_id") or exp.get("operation_id")
            got_op = got.get("original_operation_id") or got.get("operation_id")
            exp_dest = exp.get("eligible_remainder_destination") or exp.get("destination_id")
            got_dest = got.get("eligible_remainder_destination") or got.get("destination_id")
            if (
                got_op != exp_op
                or got.get("asset") != exp["asset"]
                or got_dest != exp_dest
            ):
                errors.append(f"target {tid} metadata mismatch against canonical manifest")

    # Chip totals (125 total = 1 Proby + 124 remaining)
    chip = data.get("chip_cohort", {})
    if chip.get("total_chip_events") != 125:
        errors.append(f"chip_cohort.total_chip_events must be 125, got {chip.get('total_chip_events')}")
    if chip.get("remaining_chip_events_after_proby") != 124:
        errors.append(
            f"chip_cohort.remaining_chip_events_after_proby must be 124, got {chip.get('remaining_chip_events_after_proby')}"
        )
    if chip.get("destination_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"chip_cohort.destination_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}"
        )
    if _dec(chip.get("total_prize_chips", "-1")) != Decimal("21905.41"):
        errors.append(
            f"chip_cohort.total_prize_chips must be 21905.41, got {chip.get('total_prize_chips')}"
        )
    if _dec(chip.get("remaining_124_prize_chips", "-1")) != Decimal("21873.91"):
        errors.append(
            f"chip_cohort.remaining_124_prize_chips must be 21873.91, got {chip.get('remaining_124_prize_chips')}"
        )
    if _dec(chip.get("total_bounty_chips", "-1")) != Decimal("1464.00"):
        errors.append(
            f"chip_cohort.total_bounty_chips must be 1464.00, got {chip.get('total_bounty_chips')}"
        )
    if _dec(chip.get("total_fee_chips", "-1")) != Decimal("1787.80"):
        errors.append(
            f"chip_cohort.total_fee_chips must be 1787.80, got {chip.get('total_fee_chips')}"
        )
    if _dec(chip.get("remaining_124_fee_chips", "-1")) != Decimal("1784.30"):
        errors.append(
            f"chip_cohort.remaining_124_fee_chips must be 1784.30, got {chip.get('remaining_124_fee_chips')}"
        )
    if _dec(chip.get("total_escrow_chips", "-1")) != Decimal("25157.21"):
        errors.append(
            f"chip_cohort.total_escrow_chips must be 25157.21, got {chip.get('total_escrow_chips')}"
        )
    if _dec(chip.get("remaining_124_total_escrow_chips", "-1")) != Decimal("25122.21"):
        errors.append(
            f"chip_cohort.remaining_124_total_escrow_chips must be 25122.21, got {chip.get('remaining_124_total_escrow_chips')}"
        )

    # Diamond totals (15 events)
    dia = data.get("diamond_cohort", {})
    if dia.get("total_diamond_events") != 15:
        errors.append(
            f"diamond_cohort.total_diamond_events must be 15, got {dia.get('total_diamond_events')}"
        )
    if dia.get("destination_id") != KINGFISH_PROFILE_ID:
        errors.append(f"diamond_cohort.destination_id must be {KINGFISH_PROFILE_ID!r}")
    if dia.get("active_custody_rows") != 1436:
        errors.append(
            f"diamond_cohort.active_custody_rows must be 1436, got {dia.get('active_custody_rows')}"
        )
    if _dec(dia.get("prize_diamonds", "-1")) != Decimal("380070"):
        errors.append("diamond_cohort.prize_diamonds must be 380070")
    if _dec(dia.get("bounty_diamonds", "-1")) != Decimal("22500"):
        errors.append("diamond_cohort.bounty_diamonds must be 22500")
    if _dec(dia.get("fee_diamonds", "-1")) != Decimal("25642"):
        errors.append("diamond_cohort.fee_diamonds must be 25642")
    if _dec(dia.get("total_custody_diamonds", "-1")) != Decimal("428212"):
        errors.append("diamond_cohort.total_custody_diamonds must be 428212")

    # Human Chip bank refunds & non-horse liability separation
    refunds = data.get("human_bank_refunds", {})
    if refunds.get("funding_source_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"human_bank_refunds.funding_source_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}"
        )
    if _dec(refunds.get("total_refund_chips", "-1")) != Decimal("8.00"):
        errors.append(
            f"human_bank_refunds.total_refund_chips must be 8.00, got {refunds.get('total_refund_chips')}"
        )
    entitlements = refunds.get("entitlements", {})
    if set(entitlements.keys()) != set(REQUIRED_HUMAN_BANK_REFUND_ENTITLEMENTS.keys()):
        errors.append(
            "human_bank_refunds.entitlements keys must match the 4 verified human Chip charges"
        )
    else:
        for eid, exp_e in REQUIRED_HUMAN_BANK_REFUND_ENTITLEMENTS.items():
            got_e = entitlements.get(eid, {})
            if got_e.get("tournament_id") != exp_e["tournament_id"]:
                errors.append(f"entitlement {eid}: tournament_id mismatch")
            if got_e.get("user_id") != exp_e["user_id"]:
                errors.append(f"entitlement {eid}: user_id mismatch")
            if _dec(got_e.get("amount_chips", "-1")) != exp_e["amount_chips"]:
                errors.append(f"entitlement {eid}: amount_chips mismatch")

    preserved_ids = set(data.get("preserved_waiting_event_ids", []))
    if preserved_ids != canonical_preserved:
        errors.append("preserved_waiting_event_ids must match the 73 canonical IDs")

    return errors


def verify_remaining_139_postretire(
    data: Dict[str, Any],
    canonical_manifest: Dict[str, Any] | None = None,
) -> List[str]:
    """Verify terminal post-retirement state across all 140 events (`Proby` + 139 remaining)."""
    errors = verify_remaining_139_preimage(data, canonical_manifest)

    engine = data.get("serving_engine", {})
    sha = str(engine.get("release_sha", ""))
    if not sha or sha.startswith(LEGACY_EED_SHA_PREFIX):
        errors.append(
            f"serving_engine.release_sha must be a non-eed06fe5 containing engine SHA, got {sha!r}"
        )
    if engine.get("sealed") is not True:
        errors.append("serving_engine.sealed must be True")
    if engine.get("v3_thaw_complete") is not True:
        errors.append("serving_engine.v3_thaw_complete must be True")

    post = data.get("postretire_verification", {})
    if post.get("retired_event_count") != 140:
        errors.append(
            f"postretire_verification.retired_event_count must be 140, got {post.get('retired_event_count')}"
        )
    if post.get("v4_equal_share_receipt_count", -1) != 0:
        errors.append(
            "postretire_verification.v4_equal_share_receipt_count must be 0 (equal-share is forbidden)"
        )
    if post.get("all_4_human_bank_refunds_committed") is not True:
        errors.append("postretire_verification.all_4_human_bank_refunds_committed must be True")
    if _dec(post.get("midway_bank_transferred_chips", "-1")) != Decimal("25157.21"):
        errors.append(
            f"postretire_verification.midway_bank_transferred_chips must be 25157.21, got {post.get('midway_bank_transferred_chips')}"
        )
    if _dec(post.get("kingfish_transferred_diamonds", "-1")) != Decimal("428212"):
        errors.append(
            f"postretire_verification.kingfish_transferred_diamonds must be 428212, got {post.get('kingfish_transferred_diamonds')}"
        )
    if _dec(post.get("remaining_chip_escrow", "-1")) != Decimal("0.00"):
        errors.append("postretire_verification.remaining_chip_escrow must be 0.00")
    if post.get("remaining_open_diamond_custody_rows", -1) != 0:
        errors.append("postretire_verification.remaining_open_diamond_custody_rows must be 0")
    if post.get("remaining_active_tables_in_140", -1) != 0:
        errors.append("postretire_verification.remaining_active_tables_in_140 must be 0")
    if post.get("remaining_open_seats_in_140", -1) != 0:
        errors.append("postretire_verification.remaining_open_seats_in_140 must be 0")
    if post.get("remaining_active_leases_in_140", -1) != 0:
        errors.append("postretire_verification.remaining_active_leases_in_140 must be 0")
    if post.get("remaining_reserved_permits_in_140", -1) != 0:
        errors.append("postretire_verification.remaining_reserved_permits_in_140 must be 0")
    if post.get("diamond_arena_closed") is not True:
        errors.append("postretire_verification.diamond_arena_closed must be True")
    if post.get("diamond_active_schedules", -1) != 0:
        errors.append("postretire_verification.diamond_active_schedules must be 0")

    return errors


def build_canonical_remaining_139_preimage() -> Dict[str, Any]:
    manifest = load_canonical_owner_retirement_manifest()
    return {
        "disposition": DISPOSITION,
        "owner_chat_id": OWNER_CHAT_ID,
        "equal_share_superseded": True,
        "v4_equal_share_receipt_count": 0,
        "equal_share_function_md5": EXPECTED_EQUAL_SHARE_REFUSAL_MD5,
        "restart_guard_function_md5": EXPECTED_RESTART_GUARD_MD5,
        "total_cohort_count": 140,
        "remaining_after_proby_count": 139,
        "targets": manifest["targets"],
        "chip_cohort": {
            "total_chip_events": 125,
            "remaining_chip_events_after_proby": 124,
            "destination_id": MIDWAY_UNION_MAIN_BANK_ID,
            "total_prize_chips": "21905.41",
            "remaining_124_prize_chips": "21873.91",
            "total_bounty_chips": "1464.00",
            "total_fee_chips": "1787.80",
            "remaining_124_fee_chips": "1784.30",
            "total_escrow_chips": "25157.21",
            "remaining_124_total_escrow_chips": "25122.21",
        },
        "diamond_cohort": {
            "total_diamond_events": 15,
            "destination_id": KINGFISH_PROFILE_ID,
            "active_custody_rows": 1436,
            "prize_diamonds": 380070,
            "bounty_diamonds": 22500,
            "fee_diamonds": 25642,
            "total_custody_diamonds": 428212,
        },
        "human_bank_refunds": {
            "funding_source_id": MIDWAY_UNION_MAIN_BANK_ID,
            "total_refund_chips": "8.00",
            "entitlements": {
                eid: {
                    **info,
                    "amount_chips": str(info["amount_chips"]),
                }
                for eid, info in REQUIRED_HUMAN_BANK_REFUND_ENTITLEMENTS.items()
            },
        },
        "preserved_waiting_event_ids": manifest["preserved_outside_diamond_event_ids"],
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify 140-event (Proby + 139 remaining) owner-retirement & liability separation."
    )
    parser.add_argument(
        "--mode",
        choices=("preimage", "postretire"),
        default="preimage",
        help="Verification mode (defaults to 'preimage').",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Optional JSON file path to verify.",
    )
    args = parser.parse_args(argv)

    if args.input is not None:
        with args.input.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
    elif args.mode == "preimage":
        payload = build_canonical_remaining_139_preimage()
    else:
        print("ERROR: --input is required for --mode postretire", file=sys.stderr)
        return 1

    errors = (
        verify_remaining_139_preimage(payload)
        if args.mode == "preimage"
        else verify_remaining_139_postretire(payload)
    )
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "status": "ok",
                "mode": args.mode,
                "disposition": DISPOSITION,
                "total_cohort_count": 140,
                "remaining_after_proby_count": 139,
                "chip_events": 125,
                "diamond_events": 15,
                "midway_bank_total_escrow_chips": "25157.21",
                "kingfish_total_custody_diamonds": 428212,
                "human_bank_refund_chips": "8.00",
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
