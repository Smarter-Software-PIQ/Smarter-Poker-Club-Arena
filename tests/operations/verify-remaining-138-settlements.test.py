#!/usr/bin/env python3
"""Unit and regression tests for scripts/operations/verify_remaining_138_settlements.py."""

from __future__ import annotations

import copy
from decimal import Decimal
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "operations"))

import verify_remaining_138_settlements as verifier  # noqa: E402


def make_preflight_snapshot(include_proby: bool = False) -> dict:
    source_map = (
        verifier.CANONICAL_139_BY_ID
        if include_proby
        else verifier.CANONICAL_138_REMAINING_BY_ID
    )
    events = []
    for tid, entry in source_map.items():
        events.append({
            "tournament_id": tid,
            "operation_id": entry["operation_id"],
            "cohort_group": entry["cohort_group"],
            "asset": entry["asset"],
            "name": entry["name"],
            "status": "RUNNING",
            "eligible_players": entry["eligible_players"],
            "retained_seats": entry["retained_seats"],
            "prize_balance": entry["prize_balance"],
            "bounty_balance": entry["bounty_balance"],
            "fee_balance": entry["fee_balance"],
        })
    return {
        "events": events,
        "diamond_custody_summary": {
            "active_custody_rows": 1436,
            "playing_custody_rows": 704,
            "eliminated_custody_rows": 732,
            "total_custody_balance": "428212",
            "open_guarantee_earmarks": 0,
            "earmark_ledger_rows": 39,
        },
        "prior_awards_and_closures": {
            "diamond_prior_prize_count": 5,
            "diamond_prior_prize_sum": "1090",
            "diamond_prior_bounty_obligations": 120,
            "diamond_prior_bounty_legs": 121,
            "diamond_prior_bounty_sum": "7900",
            "diamond_unpaid_bounty_obligations": 0,
            "chip_prior_payouts_count": 73,
            "chip_prior_payouts_sum": "285.31",
            "prior_diamond_v2_cancellations": 88,
            "prior_diamond_overdue_refund_sum": "34600",
            "diamond_arena_closed": True,
        },
        "excluded_event_16761305": {
            "tournament_id": verifier.EXCLUDED_MYSTERY_BOUNTY_ID,
            "in_139_scope": False,
            "abort_target_present": False,
            "earned_mystery_bounties_count": 3,
            "earned_mystery_bounties_sum": "253.10",
        },
    }


def make_postsettle_snapshot(include_proby: bool = True) -> dict:
    source_map = (
        verifier.CANONICAL_139_BY_ID
        if include_proby
        else verifier.CANONICAL_138_REMAINING_BY_ID
    )
    settled_at = "2026-11-02T16:10:00Z"
    events = []
    for tid, entry in source_map.items():
        asset = entry["asset"]
        players_count = int(entry["eligible_players"])
        prize_bal = Decimal(entry["prize_balance"])
        bounty_bal = Decimal(entry["bounty_balance"])
        fee_bal = Decimal(entry["fee_balance"])
        total_bal = prize_bal + bounty_bal

        synth_players = [
            {
                "registration_id": f"{tid[:8]}-reg-{idx:04d}",
                "user_id": f"{tid[:8]}-usr-{idx:04d}",
                "registered_at": f"2026-10-30T12:{idx // 60:02d}:{idx % 60:02d}Z",
            }
            for idx in range(1, players_count + 1)
        ]
        shares, alloc_hash = verifier.compute_equal_shares_for_event(
            tid, asset, prize_bal, bounty_bal, synth_players
        )
        pos_prize_legs = sum(1 for s in shares if Decimal(str(s["prize"])) > 0)
        pos_bounty_legs = sum(1 for s in shares if Decimal(str(s["bounty"])) > 0)
        credit_legs = pos_prize_legs + pos_bounty_legs

        if asset == "chips":
            ledger_proof = {
                "positive_prize_legs": pos_prize_legs,
                "positive_bounty_legs": pos_bounty_legs,
                "wallet_credit_idempotency_rows": credit_legs,
                "equal_share_payout_rows": pos_prize_legs,
                "equal_share_payout_sum": str(prize_bal),
                "accounting_credit_receipts": credit_legs,
                "chip_ledger_rows": credit_legs,
                "chip_ledger_sum": str(total_bal),
                "wallet_transaction_rows": credit_legs,
                "wallet_transaction_sum": str(total_bal),
            }
            rake_settlement = {
                "amount": str(fee_bal),
                "destination": f"union:{verifier.CHIP_UNION_ID}",
                "settled_at": settled_at,
                "attributed_at": settled_at,
                "attribution_error": None,
            }
        else:
            is_freebuy = tid in verifier.DIAMOND_FREEBUY_ZERO_FEE_IDS
            ledger_proof = {
                "positive_prize_legs": pos_prize_legs,
                "positive_bounty_legs": pos_bounty_legs,
                "wallet_credit_idempotency_rows": credit_legs,
                "equal_share_payout_rows": pos_prize_legs,
                "equal_share_payout_sum": str(prize_bal),
                "diamond_ledger_pay_rows": credit_legs,
                "diamond_ledger_pay_sum": str(total_bal),
                "diamond_arena_withdraw_rows": credit_legs,
                "diamond_arena_withdraw_sum": str(total_bal),
                "diamond_release_movements_sum": str(total_bal),
                "diamond_fee_ledger_amount": "0" if is_freebuy else str(fee_bal),
                "ca_mint_player_burn_sum": "0" if is_freebuy else str(fee_bal),
                "ca_mint_house_mint_amount": "0" if is_freebuy else str(fee_bal),
                "ca_mint_house_holder_id": verifier.DIAMOND_HOUSE_HOLDER_ID,
            }
            rake_settlement = {
                "amount": str(fee_bal),
                "destination": "none" if is_freebuy else "diamond_house",
                "settled_at": settled_at,
                "attributed_at": settled_at,
                "attribution_error": None,
            }

        ev_obj = {
            "tournament_id": tid,
            "operation_id": entry["operation_id"],
            "abort_state": "settled",
            "status": "CANCELLED",
            "current_players": 0,
            "settled_at": settled_at,
            "ended_at": settled_at,
            "active_seats": 0,
            "active_players": 0,
            "open_tables": 0,
            "remaining_leases": 0,
            "refund_tranches": 0,
            "pending_custody_rows": 0,
            "remaining_custody_balance": "0",
            "open_guarantee_earmark": 0,
            "allocation_hash": alloc_hash,
            "escrow_after": {
                "prize_balance": "0",
                "bounty_balance": "0",
                "fee_balance": "0",
                "closed_at": settled_at,
                "close_note": "operator_abort_equal_share",
            },
            "receipt": {
                "receipt_version": 4,
                "mode": "started_operator_equal_share",
                "operation_id": entry["operation_id"],
                "eligible_player_count": players_count,
                "allocation_hash": alloc_hash,
                "financial": {
                    "asset": asset,
                    "prize_before": str(prize_bal),
                    "prize_distributed": str(prize_bal),
                    "prize_after": "0",
                    "bounty_before": str(bounty_bal),
                    "bounty_distributed": str(bounty_bal),
                    "bounty_after": "0",
                    "fee_before": str(fee_bal),
                    "fee_after": "0",
                    "fees_reversed": "0",
                    "total_distributed": str(total_bal),
                    "total_rake_before": str(fee_bal),
                    "total_rake_after": str(fee_bal),
                    "shares": shares,
                },
            },
            "ledger_proof": ledger_proof,
            "rake_settlement": rake_settlement,
            "hand_dispositions": {
                "reserved_permits_remaining": 0,
                "aborted_unsettled_permits": 1,
                "disposition_receipts": 1,
            },
            "runtime_retirement": {
                "outcome": "equal_share_runtime_retired",
                "runtime_retired": True,
            },
        }
        events.append(ev_obj)

    return {
        "events": events,
        "diamond_custody_after": {
            "released_custody_rows": 1436,
            "unreleased_custody_rows": 0,
            "remaining_custody_balance": "0",
            "open_guarantee_earmarks": 0,
            "earmark_ledger_rows": 39,
        },
        "prior_awards_and_closures_after": {
            "diamond_prior_prize_count": 5,
            "diamond_prior_prize_sum": "1090",
            "diamond_prior_bounty_obligations": 120,
            "diamond_prior_bounty_legs": 121,
            "diamond_prior_bounty_sum": "7900",
            "diamond_unpaid_bounty_obligations": 0,
            "chip_prior_payouts_count": 73,
            "chip_prior_payouts_sum": "285.31",
            "prior_diamond_v2_cancellations": 88,
            "prior_diamond_overdue_refund_sum": "34600",
            "diamond_arena_closed": True,
        },
        "excluded_event_16761305": {
            "tournament_id": verifier.EXCLUDED_MYSTERY_BOUNTY_ID,
            "in_139_scope": False,
            "abort_target_present": False,
            "v4_receipt_present": False,
            "earned_mystery_bounties_count": 3,
            "earned_mystery_bounties_sum": "253.10",
        },
    }


class VerifyRemaining138SettlementsTests(unittest.TestCase):
    def test_preflight_138_remaining_and_139_total_pass(self) -> None:
        snap138 = make_preflight_snapshot(include_proby=False)
        res138 = verifier.verify_remaining_138_preflight(snap138)
        self.assertTrue(res138["ok"], res138["errors"])
        self.assertEqual(res138["event_count"], 138)
        self.assertEqual(res138["chip_summary"]["events"], 123)
        self.assertEqual(res138["chip_summary"]["eligible_players"], 957)
        self.assertEqual(res138["chip_summary"]["prize_balance"], "19541.99")
        self.assertEqual(res138["chip_summary"]["fee_balance"], "1479.30")
        self.assertEqual(res138["diamond_summary"]["events"], 15)
        self.assertEqual(res138["diamond_summary"]["eligible_players"], 704)
        self.assertEqual(res138["diamond_summary"]["distributable_total"], "402570")
        self.assertEqual(res138["diamond_summary"]["fee_balance"], "25642")

        snap139 = make_preflight_snapshot(include_proby=True)
        res139 = verifier.verify_remaining_138_preflight(snap139)
        self.assertTrue(res139["ok"], res139["errors"])
        self.assertEqual(res139["event_count"], 139)
        self.assertEqual(res139["chip_summary"]["events"], 124)
        self.assertEqual(res139["chip_summary"]["eligible_players"], 963)
        self.assertEqual(res139["chip_summary"]["prize_balance"], "19573.49")
        self.assertEqual(res139["chip_summary"]["fee_balance"], "1482.80")

    def test_preflight_rejects_16761305_inclusion_or_custody_drift(self) -> None:
        snap = make_preflight_snapshot(include_proby=False)
        snap["events"][0]["tournament_id"] = verifier.EXCLUDED_MYSTERY_BOUNTY_ID
        snap["diamond_custody_summary"]["active_custody_rows"] = 1435
        res = verifier.verify_remaining_138_preflight(snap)
        self.assertFalse(res["ok"])
        joined = " | ".join(res["errors"])
        self.assertIn(verifier.EXCLUDED_MYSTERY_BOUNTY_ID, joined)
        self.assertIn("active custody rows mismatch", joined)

    def test_postsettle_138_and_139_full_reconciliation_pass(self) -> None:
        snap138 = make_postsettle_snapshot(include_proby=False)
        res138 = verifier.verify_remaining_138_postsettle(snap138)
        self.assertTrue(res138["ok"], res138["errors"])
        self.assertEqual(res138["settled_event_count"], 138)
        self.assertEqual(res138["chip_reconciliation"]["settled_events"], 123)
        self.assertEqual(res138["chip_reconciliation"]["prize_distributed"], "19541.99")
        self.assertEqual(res138["diamond_reconciliation"]["settled_events"], 15)
        self.assertEqual(res138["diamond_reconciliation"]["distributable_total"], "402570")
        self.assertEqual(res138["diamond_reconciliation"]["fee_settled_to_diamond_house"], "25642")
        self.assertEqual(res138["diamond_reconciliation"]["ca_mint_house_mint_total"], "25642")
        self.assertEqual(res138["diamond_reconciliation"]["released_custody_rows"], 1436)

        snap139 = make_postsettle_snapshot(include_proby=True)
        res139 = verifier.verify_remaining_138_postsettle(snap139)
        self.assertTrue(res139["ok"], res139["errors"])
        self.assertEqual(res139["settled_event_count"], 139)
        self.assertEqual(res139["chip_reconciliation"]["settled_events"], 124)
        self.assertEqual(res139["chip_reconciliation"]["prize_distributed"], "19573.49")
        self.assertEqual(res139["chip_reconciliation"]["fee_settled"], "1482.80")

    def test_postsettle_detects_fee_custody_earmark_and_hand_disposition_regressions(self) -> None:
        snap = make_postsettle_snapshot(include_proby=True)
        # Tamper with a paid Diamond event's house fee mint and unreleased custody
        diamond_ev = next(
            e for e in snap["events"]
            if e["tournament_id"] == "0fc27b7b-4290-4e73-8680-9791e021f114"
        )
        diamond_ev["ledger_proof"]["ca_mint_house_mint_amount"] = "2799"
        diamond_ev["ledger_proof"]["positive_bounty_legs"] = 0
        diamond_ev["pending_custody_rows"] = 1
        diamond_ev["open_guarantee_earmark"] = 500
        diamond_ev["hand_dispositions"]["reserved_permits_remaining"] = 1
        diamond_ev["runtime_retirement"]["runtime_retired"] = False
        diamond_ev["allocation_hash"] = ""
        diamond_ev["receipt"]["allocation_hash"] = ""
        snap["prior_awards_and_closures_after"]["diamond_prior_bounty_sum"] = "7800"

        res = verifier.verify_remaining_138_postsettle(snap)
        self.assertFalse(res["ok"])
        joined = " | ".join(res["errors"])
        self.assertIn("ca_mint_ledger house mint", joined)
        self.assertIn("share-derived legs", joined)
        self.assertIn("missing recorded allocation_hash", joined)
        self.assertIn("unreleased custody", joined)
        self.assertIn("open_guarantee_earmark", joined)
        self.assertIn("reserved_permits_remaining=1", joined)
        self.assertIn("equal_share_runtime_retired", joined)
        self.assertIn("prior_awards_and_closures_after", joined)

    def test_combined_prize_bounty_share_allocation_hash_matches_pko_diamond_events(self) -> None:
        # Verify combined prize + bounty split on all 3 PKO Diamond events (0fc27b7b, 28fd0051, e287e6b9)
        for tid, exp_p, exp_b, exp_cnt in (
            ("0fc27b7b-4290-4e73-8680-9791e021f114", Decimal("20000"), Decimal("1350"), 58),
            ("28fd0051-32fa-408d-950e-3a556c5979b2", Decimal("15000"), Decimal("8325"), 61),
            ("e287e6b9-630d-4f2e-a205-d21841a490d8", Decimal("30000"), Decimal("12825"), 84),
        ):
            players = [
                {
                    "registration_id": f"{tid[:8]}-reg-{idx:04d}",
                    "user_id": f"{tid[:8]}-usr-{idx:04d}",
                    "registered_at": f"2026-10-30T12:{idx // 60:02d}:{idx % 60:02d}Z",
                }
                for idx in range(1, exp_cnt + 1)
            ]
            shares, md5_hash = verifier.compute_equal_shares_for_event(
                tid, "diamonds", exp_p, exp_b, players
            )
            self.assertEqual(len(shares), exp_cnt)
            self.assertEqual(sum(Decimal(str(s["prize"])) for s in shares), exp_p)
            self.assertEqual(sum(Decimal(str(s["bounty"])) for s in shares), exp_b)
            self.assertEqual(sum(Decimal(str(s["amount"])) for s in shares), exp_p + exp_b)
            self.assertEqual(len(md5_hash), 32)

    def test_cli_preflight_and_postsettle_exit_zero(self) -> None:
        script_path = REPO_ROOT / "scripts" / "operations" / "verify_remaining_138_settlements.py"
        with tempfile.TemporaryDirectory() as tmpdir:
            pre_file = Path(tmpdir) / "pre.json"
            post_file = Path(tmpdir) / "post.json"
            pre_file.write_text(json.dumps(make_preflight_snapshot(include_proby=True)), encoding="utf-8")
            post_file.write_text(json.dumps(make_postsettle_snapshot(include_proby=True)), encoding="utf-8")

            proc_pre = subprocess.run(
                [sys.executable, "-B", str(script_path), "--mode", "preflight", "--input", str(pre_file)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc_pre.returncode, 0, proc_pre.stderr or proc_pre.stdout)

            proc_post = subprocess.run(
                [sys.executable, "-B", str(script_path), "--mode", "postsettle", "--input", str(post_file)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc_post.returncode, 0, proc_post.stderr or proc_post.stdout)


if __name__ == "__main__":
    unittest.main()
