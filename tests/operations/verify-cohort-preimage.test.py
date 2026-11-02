#!/usr/bin/env python3
"""Unit tests for scripts/operations/verify_cohort_preimage.py."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = ROOT / "scripts" / "operations" / "verify_cohort_preimage.py"

spec = importlib.util.spec_from_file_location("verify_cohort_preimage", SCRIPT_PATH)
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class VerifyCohortPreimageTest(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = {
            "observed_at": "2026-11-02T08:48:46Z",
            "count": 3,
            "events": [
                {
                    "grp": "original89",
                    "name": "Proby",
                    "asset": "chips",
                    "owner": "01a19a5c-0f6b-7ae1-9dc5-fe2708a568e7",
                    "status": "RUNNING",
                    "abort_state": "stop_requested",
                    "operation_id": "d44c4440-2911-430c-8ee7-376611ef3f38",
                    "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
                    "eligible_players": 5,
                    "retained_seats": 5,
                    "prize_balance": "100.00",
                    "bounty_balance": "0.00",
                    "fee_balance": "10.00",
                },
                {
                    "grp": "other26_25",
                    "name": "Diamond Deep Stack",
                    "asset": "diamonds",
                    "owner": "01a19a5c-0f6b-7ae1-9dc5-fe2708a568e7",
                    "status": "RUNNING",
                    "abort_state": "none",
                    "operation_id": "11111111-2222-5333-8444-555555555555",
                    "tournament_id": "0fc27b7b-0000-4000-8000-000000000001",
                    "eligible_players": 12,
                    "retained_seats": 12,
                    "prize_balance": "20000",
                    "bounty_balance": "1350",
                    "fee_balance": "2000",
                },
                {
                    "grp": "other26_special1",
                    "name": "Union Mystery Bounty (PLO5)",
                    "asset": "chips",
                    "owner": "01a19a5c-0f6b-7ae1-9dc5-fe2708a568e7",
                    "status": "RUNNING",
                    "abort_state": "none",
                    "operation_id": "12cc90ca-05b9-5a9b-bac8-31cac7c60e37",
                    "tournament_id": "16761305-83ad-4282-be72-5b9cb2dd88bc",
                    "eligible_players": 11,
                    "retained_seats": 11,
                    "prize_balance": "2427.90",
                    "bounty_balance": "1464.00",
                    "fee_balance": "305.00",
                },
            ],
        }

    def test_excludes_special_event_16761305_by_default(self) -> None:
        filtered = mod.filter_manifest_events(self.manifest, include_special=False)
        self.assertEqual(len(filtered), 2)
        ids = [e["tournament_id"] for e in filtered]
        self.assertNotIn("16761305-83ad-4282-be72-5b9cb2dd88bc", ids)

        included = mod.filter_manifest_events(self.manifest, include_special=True)
        self.assertEqual(len(included), 3)

    def test_build_single_pass_sql_embeds_all_cohort_ids(self) -> None:
        sql = mod.build_single_pass_sql(
            [
                "94beb183-6b2a-4dbf-b1ea-556bf9681124",
                "0fc27b7b-0000-4000-8000-000000000001",
            ]
        )
        self.assertIn("'94beb183-6b2a-4dbf-b1ea-556bf9681124'::uuid", sql)
        self.assertIn("'0fc27b7b-0000-4000-8000-000000000001'::uuid", sql)
        self.assertIn("fn_poker_diamond_tournament_escrow", sql)
        self.assertIn("tournament_cancellation_receipts", sql)

    def test_validate_cohort_preimage_passes_when_live_matches_and_separates_assets(
        self,
    ) -> None:
        baseline = mod.filter_manifest_events(self.manifest, include_special=False)
        live_rows = [
            {
                "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
                "status": "RUNNING",
                "abort_state": "stopped",
                "eligible_players": 5,
                "retained_seats": 5,
                "prize_balance": "100.00",
                "bounty_balance": "0.00",
                "fee_balance": "10.00",
                "v4_settled": False,
            },
            {
                "tournament_id": "0fc27b7b-0000-4000-8000-000000000001",
                "status": "RUNNING",
                "abort_state": "stop_requested",
                "eligible_players": 12,
                "retained_seats": 12,
                "prize_balance": "20000.00",
                "bounty_balance": "1350.00",
                "fee_balance": "2000.00",
                "v4_settled": False,
            },
        ]
        report = mod.validate_cohort_preimage(baseline, live_rows)
        self.assertTrue(report["ok"])
        self.assertEqual(report["ready_count"], 2)
        self.assertEqual(report["drifted_count"], 0)
        self.assertEqual(
            report["totals_ready_by_asset"]["chips"],
            {
                "prize_balance": "100.00",
                "bounty_balance": "0.00",
                "fee_balance": "10.00",
            },
        )
        self.assertEqual(
            report["totals_ready_by_asset"]["diamonds"],
            {
                "prize_balance": "20000",
                "bounty_balance": "1350",
                "fee_balance": "2000",
            },
        )

    def test_validate_cohort_preimage_detects_already_settled_and_drifted_events(
        self,
    ) -> None:
        baseline = mod.filter_manifest_events(self.manifest, include_special=False)
        live_rows = [
            {
                "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
                "status": "CANCELLED",
                "abort_state": "settled",
                "eligible_players": 5,
                "retained_seats": 0,
                "prize_balance": "0.00",
                "bounty_balance": "0.00",
                "fee_balance": "0.00",
                "v4_settled": True,
            },
            {
                "tournament_id": "0fc27b7b-0000-4000-8000-000000000001",
                "status": "RUNNING",
                "abort_state": "none",
                "eligible_players": 11,  # drifted from 12
                "retained_seats": 11,
                "prize_balance": "20000.00",
                "bounty_balance": "1275.00",  # drifted from 1350
                "fee_balance": "2000.00",
                "v4_settled": False,
            },
        ]
        report = mod.validate_cohort_preimage(baseline, live_rows)
        self.assertFalse(report["ok"])
        self.assertEqual(report["already_settled_count"], 1)
        self.assertEqual(report["drifted_count"], 1)
        self.assertEqual(
            report["drifted_events"][0]["diffs"]["eligible_players"],
            {"expected": 12, "actual": 11},
        )
        self.assertEqual(
            report["drifted_events"][0]["diffs"]["bounty_balance"],
            {"expected": "1350", "actual": "1275.00"},
        )

    def test_cli_end_to_end_with_temp_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            m_path = Path(tmp) / "manifest.json"
            l_path = Path(tmp) / "live.json"
            m_path.write_text(json.dumps(self.manifest), encoding="utf-8")
            l_path.write_text(
                json.dumps(
                    [
                        {
                            "tournament_id": "94beb183-6b2a-4dbf-b1ea-556bf9681124",
                            "status": "RUNNING",
                            "abort_state": "stop_requested",
                            "eligible_players": 5,
                            "retained_seats": 5,
                            "prize_balance": "100.00",
                            "bounty_balance": "0.00",
                            "fee_balance": "10.00",
                            "v4_settled": False,
                        },
                        {
                            "tournament_id": "0fc27b7b-0000-4000-8000-000000000001",
                            "status": "RUNNING",
                            "abort_state": "none",
                            "eligible_players": 12,
                            "retained_seats": 12,
                            "prize_balance": "20000",
                            "bounty_balance": "1350",
                            "fee_balance": "2000",
                            "v4_settled": False,
                        },
                    ]
                ),
                encoding="utf-8",
            )
            rc = mod.main(["--manifest", str(m_path), "--live-json", str(l_path)])
            self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
