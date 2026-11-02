#!/usr/bin/env python3
"""Unit tests for `scripts/operations/verify_remaining_138_settlements.py`."""

import copy
import importlib.util
from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "operations" / "verify_remaining_138_settlements.py"

spec = importlib.util.spec_from_file_location("verify_remaining_138_settlements", MODULE_PATH)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def _valid_postretire_payload() -> dict:
    base = mod.build_canonical_remaining_139_preimage()
    base["serving_engine"] = {
        "release_sha": "a496b1e83a3fd8f87ac502f8fd6695ad5c0b05a7",
        "sealed": True,
        "v3_thaw_complete": True,
    }
    base["postretire_verification"] = {
        "retired_event_count": 140,
        "v4_equal_share_receipt_count": 0,
        "all_4_human_bank_refunds_committed": True,
        "midway_bank_transferred_chips": "25157.21",
        "kingfish_transferred_diamonds": 428212,
        "remaining_chip_escrow": "0.00",
        "remaining_open_diamond_custody_rows": 0,
        "remaining_active_tables_in_140": 0,
        "remaining_open_seats_in_140": 0,
        "remaining_active_leases_in_140": 0,
        "remaining_reserved_permits_in_140": 0,
        "diamond_arena_closed": True,
        "diamond_active_schedules": 0,
    }
    return base


class VerifyRemaining139OwnerRetirementTests(unittest.TestCase):
    def test_canonical_140_preimage_passes(self) -> None:
        payload = mod.build_canonical_remaining_139_preimage()
        self.assertEqual(mod.verify_remaining_139_preimage(payload), [])

    def test_rejects_outdated_139_cohort_excluding_16761305(self) -> None:
        bad = mod.build_canonical_remaining_139_preimage()
        bad["total_cohort_count"] = 139
        bad["remaining_after_proby_count"] = 138
        bad["targets"] = [
            t for t in bad["targets"] if t["tournament_id"] != mod.EVENT_16761305_ID
        ]
        errors = mod.verify_remaining_139_preimage(bad)
        self.assertTrue(any("total_cohort_count must be 140" in e for e in errors))
        self.assertTrue(any("targets must be a list of 140 events" in e for e in errors))

    def test_rejects_cancelled_equal_share_disposition(self) -> None:
        bad = mod.build_canonical_remaining_139_preimage()
        bad["disposition"] = "started_operator_equal_share"
        bad["v4_equal_share_receipt_count"] = 139
        errors = mod.verify_remaining_139_preimage(bad)
        self.assertTrue(any("disposition must be" in e for e in errors))
        self.assertTrue(any("v4_equal_share_receipt_count must be 0" in e for e in errors))

    def test_rejects_missing_human_bank_refund_entitlements(self) -> None:
        bad = mod.build_canonical_remaining_139_preimage()
        bad["human_bank_refunds"]["total_refund_chips"] = "7.00"
        bad["human_bank_refunds"]["entitlements"].pop(
            "1edfe4d2-005d-4b93-96d0-fc0bb10f8c95"
        )
        errors = mod.verify_remaining_139_preimage(bad)
        self.assertTrue(any("total_refund_chips must be 8.00" in e for e in errors))
        self.assertTrue(any("4 verified human Chip charges" in e for e in errors))

    def test_valid_postretire_140_payload_passes(self) -> None:
        payload = _valid_postretire_payload()
        self.assertEqual(mod.verify_remaining_139_postretire(payload), [])

    def test_postretire_rejects_untransferred_custody_or_old_engine(self) -> None:
        bad = _valid_postretire_payload()
        bad["serving_engine"]["release_sha"] = "eed06fe51dea622069c661a6213d5b031ff3a9e3"
        bad["postretire_verification"]["remaining_open_diamond_custody_rows"] = 1436
        errors = mod.verify_remaining_139_postretire(bad)
        self.assertTrue(any("non-eed06fe5 containing engine SHA" in e for e in errors))
        self.assertTrue(any("remaining_open_diamond_custody_rows must be 0" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
