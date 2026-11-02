#!/usr/bin/env python3
"""Unit tests for `scripts/operations/verify_proby_settlement.py`."""

import copy
import importlib.util
from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "operations" / "verify_proby_settlement.py"

spec = importlib.util.spec_from_file_location("verify_proby_settlement", MODULE_PATH)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def _valid_postretire_payload() -> dict:
    return {
        "tournament_id": mod.PROBY_TOURNAMENT_ID,
        "operation_id": mod.PROBY_OPERATION_ID,
        "disposition": mod.DISPOSITION,
        "serving_engine": {
            "release_sha": "a496b1e83a3fd8f87ac502f8fd6695ad5c0b05a7",
            "sealed": True,
            "v3_thaw_complete": True,
        },
        "v4_equal_share_receipt_present": False,
        "human_bank_refund_proof": {
            "user_id": mod.PROBYOURMOM_USER_ID,
            "registration_id": mod.PROBYOURMOM_REGISTRATION_ID,
            "entitlement_id": mod.PROBYOURMOM_ENTITLEMENT_ID,
            "funding_source_id": mod.MIDWAY_UNION_MAIN_BANK_ID,
            "refunded_chips": "5.00",
            "committed": True,
        },
        "bank_transfer_proof": {
            "destination_id": mod.MIDWAY_UNION_MAIN_BANK_ID,
            "prize_transferred_chips": "31.50",
            "bounty_transferred_chips": "0.00",
            "fee_transferred_chips": "3.50",
            "total_transferred_chips": "35.00",
        },
        "escrow_after": {
            "prize_balance": "0.00",
            "bounty_balance": "0.00",
            "fee_balance": "0.00",
            "closed_at": "2026-11-02T17:15:00Z",
        },
        "runtime_retirement": {
            "active_table_count": 0,
            "open_seat_count": 0,
            "active_lease_count": 0,
            "reserved_permit_count": 0,
            "restart_blocked_by_guard": True,
            "unrelated_other_table_seats_preserved": 12,
        },
    }


class VerifyProbySettlementTests(unittest.TestCase):
    def test_canonical_proby_preimage_passes(self) -> None:
        payload = mod.build_canonical_proby_preimage()
        self.assertEqual(mod.verify_proby_preimage(payload), [])

    def test_preimage_rejects_cancelled_equal_share_plan(self) -> None:
        bad = mod.build_canonical_proby_preimage()
        bad["disposition"] = "started_operator_equal_share"
        bad["v4_equal_share_receipt_present"] = True
        errors = mod.verify_proby_preimage(bad)
        self.assertTrue(any("disposition must be" in e for e in errors))
        self.assertTrue(any("v4_equal_share_receipt_present must be False" in e for e in errors))

    def test_preimage_rejects_deducting_human_refund_from_event_escrow(self) -> None:
        bad = mod.build_canonical_proby_preimage()
        bad["non_horse_liability"]["reduces_tournament_escrow"] = True
        bad["escrow"]["total_escrow"] = "30.00"
        errors = mod.verify_proby_preimage(bad)
        self.assertTrue(any("reduces_tournament_escrow must be False" in e for e in errors))
        self.assertTrue(any("escrow.total_escrow must be 35.00" in e for e in errors))

    def test_valid_postretire_payload_passes(self) -> None:
        payload = _valid_postretire_payload()
        self.assertEqual(mod.verify_proby_postretire(payload), [])

    def test_postretire_rejects_old_eed06fe5_engine_or_uncommitted_refund(self) -> None:
        bad = _valid_postretire_payload()
        bad["serving_engine"]["release_sha"] = "eed06fe51dea622069c661a6213d5b031ff3a9e3"
        bad["human_bank_refund_proof"]["committed"] = False
        errors = mod.verify_proby_postretire(bad)
        self.assertTrue(any("non-eed06fe5 containing engine SHA" in e for e in errors))
        self.assertTrue(any("human_bank_refund_proof.committed must be True" in e for e in errors))

    def test_postretire_rejects_non_zero_remaining_escrow_or_disturbed_unrelated_seats(self) -> None:
        bad = _valid_postretire_payload()
        bad["escrow_after"]["prize_balance"] = "31.50"
        bad["runtime_retirement"]["unrelated_other_table_seats_preserved"] = 11
        errors = mod.verify_proby_postretire(bad)
        self.assertTrue(any("escrow_after.prize_balance must be 0.00" in e for e in errors))
        self.assertTrue(any("unrelated_other_table_seats_preserved must be 12" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
