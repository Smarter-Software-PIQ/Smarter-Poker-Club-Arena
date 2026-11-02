#!/usr/bin/env python3
"""Unit tests for `scripts/operations/verify_cohort_preimage.py`."""

import copy
import importlib.util
from pathlib import Path
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "operations" / "verify_cohort_preimage.py"

spec = importlib.util.spec_from_file_location("verify_cohort_preimage", MODULE_PATH)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class VerifyCohortPreimageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = mod.build_canonical_preimage_payload()

    def test_canonical_140_owner_retirement_preimage_passes(self) -> None:
        errors = mod.verify_cohort_preimage(self.payload)
        self.assertEqual(errors, [])

    def test_rejects_superseded_equal_share_disposition_or_outdated_139_cohort(self) -> None:
        bad = copy.deepcopy(self.payload)
        bad["disposition"] = "started_operator_equal_share"
        bad["v4_equal_share_receipt_count"] = 1
        bad["targets"] = bad["targets"][:139]
        errors = mod.verify_cohort_preimage(bad)
        self.assertTrue(any("disposition must be" in e for e in errors))
        self.assertTrue(any("v4_equal_share_receipt_count must be 0" in e for e in errors))
        self.assertTrue(any("targets must be a list of 140 events" in e for e in errors))

    def test_rejects_wrong_destination_or_missing_installed_guard_md5(self) -> None:
        bad = copy.deepcopy(self.payload)
        bad["equal_share_function_md5"] = "ef3c8122a5fccc4f90630c1672080240"
        bad["targets"][0]["eligible_remainder_destination"] = "00000000-0000-0000-0000-000000000000"
        errors = mod.verify_cohort_preimage(bad)
        self.assertTrue(any("equal_share_function_md5" in e for e in errors))
        self.assertTrue(any("destination_id mismatch" in e for e in errors))

    def test_rejects_missing_preserved_73_waiting_games_or_active_diamond_schedules(self) -> None:
        bad = copy.deepcopy(self.payload)
        bad["preserved_waiting_games"]["event_ids"] = bad["preserved_waiting_games"]["event_ids"][:72]
        bad["diamond_arena_shutdown"]["active_tournament_schedules"] = 26
        errors = mod.verify_cohort_preimage(bad)
        self.assertTrue(any("73 canonical preserved IDs" in e for e in errors))
        self.assertTrue(any("active_tournament_schedules must be 0" in e for e in errors))

    def test_rejects_unseparated_non_horse_liabilities_or_cross_asset_drift(self) -> None:
        bad = copy.deepcopy(self.payload)
        bad["non_horse_liability_separation"]["direct_bank_refund_total_chips"] = "0.00"
        bad["chip_escrow_summary"]["total_escrow_chips"] = "453369.21"
        errors = mod.verify_cohort_preimage(bad)
        self.assertTrue(any("direct_bank_refund_total_chips must be 8.00" in e for e in errors))
        self.assertTrue(any("total_escrow_chips must be 25157.21" in e for e in errors))


if __name__ == "__main__":
    unittest.main()
