#!/usr/bin/env python3
"""
Phase 3 First-Event (`Proby` / `2781bcd7-cc8a-4713-ab3e-0d0a81fdf110`) Verifier (`verify_proby_settlement.py`).

Reconciled with the superseding November 2, 2026 (`15:38Z` / `09:38` CST) owner
cleanup instruction (`01a19ccc-894e-75e2-a9e7-fe0d2df6c326`) installed in:
  - `scripts/ci/fixtures/tournament-abort/owner-retirement-nov2-manifest.json`
  - `supabase/migrations/20261102152756_owner_tournament_deletion_replaces_equal_share_intent.sql`

Enforces:
  1. `Proby` (`2781bcd7-cc8a-4713-ab3e-0d0a81fdf110` / `25 Chip Daily Rebuy (NLH) Satellite 5`)
     is bound to `operation_id = d44c4440-2911-430c-8ee7-376611ef3f38` with
     `disposition = "terminal_retirement_with_verified_liability_separation"` and
     `destination_id = "fade0000-0000-0000-0000-000000000001"` (Midway Union Main Bank).
  2. Equal-share payout (`started_operator_equal_share` / `receipt_version = 4`)
     is explicitly superseded and refused (`owner_deletion_supersedes_equal_share`,
     MD5 `1975b4c245da7c434772e862cfa57513`). Any attempt to certify an equal-share
     receipt on `Proby` is rejected.
  3. The non-horse registrant `Probyourmom` (`eed278a8-3ca2-4e2d-a196-0a0cd9e74f90`,
     registration `35b2eada-7211-4b91-873a-914aa7850951`) is separated first:
     its `5.00` Chip entry debit (`entitlement_id = 26b465dd-600d-42eb-9f37-68f6052febac`,
     `4.50` prize + `0.50` fee) is refunded directly from Midway Union Main Bank
     without reducing `Proby`'s `35.00` Chip tournament escrow (`31.50` prize +
     `3.50` fee).
  4. In `postretire` mode, verifies:
     - `Probyourmom`'s `5.00` Chip direct bank-funded refund receipt is committed;
     - `Proby`'s full `35.00` Chip tournament escrow (`31.50` prize + `3.50` fee)
       is transferred to Midway Union Main Bank (`fade0000-0000-0000-0000-000000000001`),
       leaving `prize_balance = 0`, `bounty_balance = 0`, `fee_balance = 0`, and
       `closed_at IS NOT NULL`;
     - All `6` seats in `Proby` are vacated (`left_at IS NOT NULL`), all runtime
       leases are retired (`0` active leases), restart is blocked by
       `fn_ca_guard_tournament_restart_source` (`b080d19b8b2027440b67f350e67d8807`),
       and the `12` unrelated seats held by `Proby`'s players on other tables
       remain untouched.
"""

from __future__ import annotations

import argparse
from decimal import Decimal
import json
from pathlib import Path
import sys
from typing import Any, Dict, List

PROBY_TOURNAMENT_ID = "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110"
PROBY_OPERATION_ID = "d44c4440-2911-430c-8ee7-376611ef3f38"
MIDWAY_UNION_MAIN_BANK_ID = "fade0000-0000-0000-0000-000000000001"
DISPOSITION = "terminal_retirement_with_verified_liability_separation"

PROBYOURMOM_USER_ID = "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90"
PROBYOURMOM_REGISTRATION_ID = "35b2eada-7211-4b91-873a-914aa7850951"
PROBYOURMOM_ENTITLEMENT_ID = "26b465dd-600d-42eb-9f37-68f6052febac"
PROBYOURMOM_BANK_REFUND_CHIPS = Decimal("5.00")

EXPECTED_EQUAL_SHARE_REFUSAL_MD5 = "1975b4c245da7c434772e862cfa57513"
EXPECTED_RESTART_GUARD_MD5 = "b080d19b8b2027440b67f350e67d8807"
LEGACY_EED_SHA_PREFIX = "eed06fe5"


def _dec(val: Any) -> Decimal:
    return Decimal(str(val))


def verify_proby_preimage(data: Dict[str, Any]) -> List[str]:
    """Validate `Proby` pre-retirement state under the superseding 140-event contract."""
    errors: List[str] = []

    if data.get("tournament_id") != PROBY_TOURNAMENT_ID:
        errors.append(
            f"tournament_id must be {PROBY_TOURNAMENT_ID!r}, got {data.get('tournament_id')!r}"
        )
    if data.get("operation_id") != PROBY_OPERATION_ID:
        errors.append(
            f"operation_id must be {PROBY_OPERATION_ID!r}, got {data.get('operation_id')!r}"
        )
    if data.get("disposition") != DISPOSITION:
        errors.append(
            f"disposition must be {DISPOSITION!r} (equal-share is revoked), got {data.get('disposition')!r}"
        )
    if data.get("asset") != "chips":
        errors.append(f"asset must be 'chips', got {data.get('asset')!r}")
    if data.get("destination_kind") != "midway_union_main_bank":
        errors.append(
            f"destination_kind must be 'midway_union_main_bank', got {data.get('destination_kind')!r}"
        )
    if data.get("destination_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"destination_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}, got {data.get('destination_id')!r}"
        )

    if data.get("equal_share_superseded") is not True:
        errors.append("equal_share_superseded must be True")
    if data.get("equal_share_function_md5") != EXPECTED_EQUAL_SHARE_REFUSAL_MD5:
        errors.append(
            f"equal_share_function_md5 must be {EXPECTED_EQUAL_SHARE_REFUSAL_MD5!r}, got {data.get('equal_share_function_md5')!r}"
        )
    if data.get("restart_guard_function_md5") != EXPECTED_RESTART_GUARD_MD5:
        errors.append(
            f"restart_guard_function_md5 must be {EXPECTED_RESTART_GUARD_MD5!r}, got {data.get('restart_guard_function_md5')!r}"
        )
    if data.get("v4_equal_share_receipt_present") is not False:
        errors.append(
            "v4_equal_share_receipt_present must be False (equal-share payout is forbidden)"
        )

    escrow = data.get("escrow", {})
    if _dec(escrow.get("prize_balance", "-1")) != Decimal("31.50"):
        errors.append(
            f"escrow.prize_balance must be 31.50, got {escrow.get('prize_balance')}"
        )
    if _dec(escrow.get("bounty_balance", "-1")) != Decimal("0.00"):
        errors.append(
            f"escrow.bounty_balance must be 0.00, got {escrow.get('bounty_balance')}"
        )
    if _dec(escrow.get("fee_balance", "-1")) != Decimal("3.50"):
        errors.append(
            f"escrow.fee_balance must be 3.50, got {escrow.get('fee_balance')}"
        )
    if _dec(escrow.get("total_escrow", "-1")) != Decimal("35.00"):
        errors.append(
            f"escrow.total_escrow must be 35.00, got {escrow.get('total_escrow')}"
        )

    if data.get("playing_seat_count") != 6:
        errors.append(
            f"playing_seat_count must be 6, got {data.get('playing_seat_count')}"
        )
    if data.get("eliminated_player_count") != 1:
        errors.append(
            f"eliminated_player_count must be 1, got {data.get('eliminated_player_count')}"
        )

    sep = data.get("non_horse_liability", {})
    if sep.get("user_id") != PROBYOURMOM_USER_ID:
        errors.append(
            f"non_horse_liability.user_id must be {PROBYOURMOM_USER_ID!r}, got {sep.get('user_id')!r}"
        )
    if sep.get("registration_id") != PROBYOURMOM_REGISTRATION_ID:
        errors.append(
            f"non_horse_liability.registration_id must be {PROBYOURMOM_REGISTRATION_ID!r}, got {sep.get('registration_id')!r}"
        )
    if sep.get("entitlement_id") != PROBYOURMOM_ENTITLEMENT_ID:
        errors.append(
            f"non_horse_liability.entitlement_id must be {PROBYOURMOM_ENTITLEMENT_ID!r}, got {sep.get('entitlement_id')!r}"
        )
    if _dec(sep.get("bank_funded_refund_chips", "-1")) != PROBYOURMOM_BANK_REFUND_CHIPS:
        errors.append(
            f"non_horse_liability.bank_funded_refund_chips must be 5.00, got {sep.get('bank_funded_refund_chips')}"
        )
    if sep.get("funding_source_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"non_horse_liability.funding_source_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}"
        )
    if sep.get("reduces_tournament_escrow") is not False:
        errors.append("non_horse_liability.reduces_tournament_escrow must be False")

    return errors


def verify_proby_postretire(data: Dict[str, Any]) -> List[str]:
    """Validate `Proby` post-retirement & liability separation state."""
    errors: List[str] = []

    if data.get("tournament_id") != PROBY_TOURNAMENT_ID:
        errors.append(
            f"tournament_id must be {PROBY_TOURNAMENT_ID!r}, got {data.get('tournament_id')!r}"
        )
    if data.get("operation_id") != PROBY_OPERATION_ID:
        errors.append(
            f"operation_id must be {PROBY_OPERATION_ID!r}, got {data.get('operation_id')!r}"
        )
    if data.get("disposition") != DISPOSITION:
        errors.append(
            f"disposition must be {DISPOSITION!r}, got {data.get('disposition')!r}"
        )

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

    # Equal-share receipt must never exist on Proby
    if data.get("v4_equal_share_receipt_present") is not False:
        errors.append(
            "v4_equal_share_receipt_present must be False (equal-share plan is revoked)"
        )

    # 1. Direct bank-funded human refund proof for Probyourmom
    refund = data.get("human_bank_refund_proof", {})
    if refund.get("user_id") != PROBYOURMOM_USER_ID:
        errors.append("human_bank_refund_proof.user_id mismatch")
    if refund.get("registration_id") != PROBYOURMOM_REGISTRATION_ID:
        errors.append("human_bank_refund_proof.registration_id mismatch")
    if refund.get("entitlement_id") != PROBYOURMOM_ENTITLEMENT_ID:
        errors.append("human_bank_refund_proof.entitlement_id mismatch")
    if refund.get("funding_source_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append("human_bank_refund_proof.funding_source_id mismatch")
    if _dec(refund.get("refunded_chips", "-1")) != PROBYOURMOM_BANK_REFUND_CHIPS:
        errors.append(
            f"human_bank_refund_proof.refunded_chips must be 5.00, got {refund.get('refunded_chips')}"
        )
    if refund.get("committed") is not True:
        errors.append("human_bank_refund_proof.committed must be True")

    # 2. Pooled escrow transfer to Midway Union Main Bank
    transfer = data.get("bank_transfer_proof", {})
    if transfer.get("destination_id") != MIDWAY_UNION_MAIN_BANK_ID:
        errors.append(
            f"bank_transfer_proof.destination_id must be {MIDWAY_UNION_MAIN_BANK_ID!r}"
        )
    if _dec(transfer.get("prize_transferred_chips", "-1")) != Decimal("31.50"):
        errors.append("bank_transfer_proof.prize_transferred_chips must be 31.50")
    if _dec(transfer.get("bounty_transferred_chips", "-1")) != Decimal("0.00"):
        errors.append("bank_transfer_proof.bounty_transferred_chips must be 0.00")
    if _dec(transfer.get("fee_transferred_chips", "-1")) != Decimal("3.50"):
        errors.append("bank_transfer_proof.fee_transferred_chips must be 3.50")
    if _dec(transfer.get("total_transferred_chips", "-1")) != Decimal("35.00"):
        errors.append("bank_transfer_proof.total_transferred_chips must be 35.00")

    escrow_after = data.get("escrow_after", {})
    if _dec(escrow_after.get("prize_balance", "-1")) != Decimal("0.00"):
        errors.append("escrow_after.prize_balance must be 0.00")
    if _dec(escrow_after.get("bounty_balance", "-1")) != Decimal("0.00"):
        errors.append("escrow_after.bounty_balance must be 0.00")
    if _dec(escrow_after.get("fee_balance", "-1")) != Decimal("0.00"):
        errors.append("escrow_after.fee_balance must be 0.00")
    if not escrow_after.get("closed_at"):
        errors.append("escrow_after.closed_at must be non-empty")

    # 3. Terminal runtime retirement & unrelated seat preservation
    runtime = data.get("runtime_retirement", {})
    if runtime.get("active_table_Count", runtime.get("active_table_count", -1)) != 0:
        errors.append("runtime_retirement.active_table_count must be 0")
    if runtime.get("open_seat_count", -1) != 0:
        errors.append("runtime_retirement.open_seat_count must be 0")
    if runtime.get("active_lease_count", -1) != 0:
        errors.append("runtime_retirement.active_lease_count must be 0")
    if runtime.get("reserved_permit_count", -1) != 0:
        errors.append("runtime_retirement.reserved_permit_count must be 0")
    if runtime.get("restart_blocked_by_guard") is not True:
        errors.append("runtime_retirement.restart_blocked_by_guard must be True")
    if runtime.get("unrelated_other_table_seats_preserved") != 12:
        errors.append(
            f"runtime_retirement.unrelated_other_table_seats_preserved must be 12, got {runtime.get('unrelated_other_table_seats_preserved')}"
        )

    return errors


def build_canonical_proby_preimage() -> Dict[str, Any]:
    return {
        "tournament_id": PROBY_TOURNAMENT_ID,
        "operation_id": PROBY_OPERATION_ID,
        "disposition": DISPOSITION,
        "asset": "chips",
        "destination_kind": "midway_union_main_bank",
        "destination_id": MIDWAY_UNION_MAIN_BANK_ID,
        "equal_share_superseded": True,
        "equal_share_function_md5": EXPECTED_EQUAL_SHARE_REFUSAL_MD5,
        "restart_guard_function_md5": EXPECTED_RESTART_GUARD_MD5,
        "v4_equal_share_receipt_present": False,
        "escrow": {
            "prize_balance": "31.50",
            "bounty_balance": "0.00",
            "fee_balance": "3.50",
            "total_escrow": "35.00",
        },
        "playing_seat_count": 6,
        "eliminated_player_count": 1,
        "non_horse_liability": {
            "username": "Probyourmom",
            "user_id": PROBYOURMOM_USER_ID,
            "registration_id": PROBYOURMOM_REGISTRATION_ID,
            "entitlement_id": PROBYOURMOM_ENTITLEMENT_ID,
            "bank_funded_refund_chips": "5.00",
            "funding_source_id": MIDWAY_UNION_MAIN_BANK_ID,
            "reduces_tournament_escrow": False,
        },
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify Proby (2781bcd7-cc8a-4713-ab3e-0d0a81fdf110) owner-retirement & liability separation."
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
        payload = build_canonical_proby_preimage()
    else:
        print("ERROR: --input is required for --mode postretire", file=sys.stderr)
        return 1

    errors = (
        verify_proby_preimage(payload)
        if args.mode == "preimage"
        else verify_proby_postretire(payload)
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
                "tournament_id": PROBY_TOURNAMENT_ID,
                "disposition": DISPOSITION,
                "destination_id": MIDWAY_UNION_MAIN_BANK_ID,
                "probyourmom_bank_refund_chips": "5.00",
                "proby_escrow_chips": "35.00",
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
