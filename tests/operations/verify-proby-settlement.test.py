#!/usr/bin/env python3
"""
Unit & contract tests for `scripts/operations/verify_proby_settlement.py`
(Phase 3 of 5 — First Event `Proby` 2781bcd7-cc8a-4713-ab3e-0d0a81fdf110
equal-share settlement preflight, rollback preview, and post-settlement verifier).
"""

from __future__ import annotations

import copy
import sys
import unittest
from decimal import Decimal
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "operations"))

import verify_proby_settlement as vps  # noqa: E402


def make_live_proby_preflight_payload() -> dict:
    return {
        "observed_at": "2026-11-02T14:55:41.496784+00:00",
        "tournament_id": vps.PROBY_TOURNAMENT_ID,
        "expected_operation_id": vps.PROBY_OPERATION_ID,
        "event": {
            "id": vps.PROBY_TOURNAMENT_ID,
            "name": "25 Chip Daily Rebuy (NLH) Satellite 5",
            "status": "RUNNING",
            "club_id": "fade0000-0000-0000-0000-000000000001",
        },
        "target_owners": [
            {
                "operation_id": vps.PROBY_OPERATION_ID,
                "tournament_id": vps.PROBY_TOURNAMENT_ID,
                "asset": "chips",
                "state": "stop_requested",
                "requested_generation": "911c7b1a-ae01-4204-8d35-6041e2b35791",
                "requested_at": "2026-10-30T22:19:56.685623+00:00",
                "quiescence": None,
                "money_snapshot": None,
                "receipt": None,
                "settled_at": None,
            }
        ],
        "lease": {
            "generation": "016a9596-d619-4eff-99a6-de75945445c7",
            "protocol_version": 2,
            "heartbeat_at": "2026-11-02T14:34:49.015346+00:00",
        },
        "roster": [
            {
                "registration_id": "89013192-99f8-4549-8c9d-63da040ce094",
                "user_id": "4c417026-97b3-476e-ac35-18d4455a592d",
                "username": "huskerfiona",
                "status": "playing",
                "eliminated_at": None,
                "chips": 12942,
                "current_bounty": 0,
            },
            {
                "registration_id": "c087624b-9868-455e-a6d0-ab33c24acf1f",
                "user_id": "4cb9ecf4-962b-44d2-87be-95fcfa1a2918",
                "username": "kaneholloway",
                "status": "playing",
                "eliminated_at": None,
                "chips": 10853,
                "current_bounty": 0,
            },
            {
                "registration_id": "3cfda714-25ce-4892-a68a-4c79376b8aa4",
                "user_id": "4ce9fa05-703f-40e4-a14e-40cffc3ba305",
                "username": "craneyarrow",
                "status": "playing",
                "eliminated_at": None,
                "chips": 16509,
                "current_bounty": 0,
            },
            {
                "registration_id": "39bd9656-28ed-4188-8893-ac7c57529df5",
                "user_id": "4dbd99cd-aa34-4c4c-879c-2323aec3cc19",
                "username": "sagemontrose",
                "status": "playing",
                "eliminated_at": None,
                "chips": 8043,
                "current_bounty": 0,
            },
            {
                "registration_id": "9674221e-c52a-4b0c-8fee-07cfa28d2664",
                "user_id": "50c24ee9-9233-4c16-bc16-3d3726488264",
                "username": "shreveportg",
                "status": "playing",
                "eliminated_at": None,
                "chips": 11653,
                "current_bounty": 0,
            },
            {
                "registration_id": "e8b834a0-4eca-47b0-afee-bf16f71f02d1",
                "user_id": "5129542f-958c-4693-862d-ff95799e344c",
                "username": "viking",
                "status": "eliminated",
                "eliminated_at": "2026-10-29T22:09:08.70461+00:00",
                "chips": 0,
                "current_bounty": 0,
            },
            {
                "registration_id": "35b2eada-7211-4b91-873a-914aa7850951",
                "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90",
                "username": "Probyourmom",
                "status": "playing",
                "eliminated_at": None,
                "chips": 10000,
                "current_bounty": 0,
            },
        ],
        "chip_escrow": {
            "tournament_id": vps.PROBY_TOURNAMENT_ID,
            "gross_in": 35,
            "prize_balance": 31.5,
            "bounty_balance": 0,
            "fee_balance": 3.5,
            "prize_out": 0,
            "bounty_out": 0,
            "fee_out": 0,
            "closed_at": None,
            "terminal_closed_at": None,
        },
        "diamond_canonical_escrow": {
            "prize_balance": 0,
            "bounty_balance": 0,
            "fee_balance": 0,
        },
        "current_money_hash": "d0b8e08f0b0781ffb679ba6fd1f6eb88",
        "pending_custody": True,
        "unacknowledged_boundaries": 1,
        "unpaid_obligations": 0,
        "existing_receipts": [],
        "table_and_seats": {
            "table_id": vps.PROBY_TABLE_ID,
            "table_status": "running",
            "f06_lifecycle": 1892309,
            "seats": [
                {
                    "seat_id": "cc92f1fb-450a-4266-8f94-3b4291156c06",
                    "seat_number": 1,
                    "user_id": "4cb9ecf4-962b-44d2-87be-95fcfa1a2918",
                    "stack": 10853,
                    "status": "active",
                    "left_at": None,
                },
                {
                    "seat_id": "514a9e0f-7166-48e5-9d39-3c326ac920ca",
                    "seat_number": 2,
                    "user_id": "50c24ee9-9233-4c16-bc16-3d3726488264",
                    "stack": 11653,
                    "status": "active",
                    "left_at": None,
                },
                {
                    "seat_id": "d759401a-cfdc-491e-965b-9942489aa9ff",
                    "seat_number": 3,
                    "user_id": "4dbd99cd-aa34-4c4c-879c-2323aec3cc19",
                    "stack": 8043,
                    "status": "active",
                    "left_at": None,
                },
                {
                    "seat_id": "c3c425b9-f77c-4cd2-8a2d-4ab92741a6e2",
                    "seat_number": 4,
                    "user_id": "4ce9fa05-703f-40e4-a14e-40cffc3ba305",
                    "stack": 16509,
                    "status": "active",
                    "left_at": None,
                },
                {
                    "seat_id": "ca35a4e7-7f90-476d-8f8a-863bcbc98b83",
                    "seat_number": 5,
                    "user_id": "eed278a8-3ca2-4e2d-a196-0a0cd9e74f90",
                    "stack": 10000,
                    "status": "left",
                    "left_at": None,
                },
                {
                    "seat_id": "8ff4c2ed-41dd-4c64-94ae-60c84b4576ce",
                    "seat_number": 6,
                    "user_id": "4c417026-97b3-476e-ac35-18d4455a592d",
                    "stack": 12942,
                    "status": "active",
                    "left_at": None,
                },
            ],
        },
    }


def make_proby_preview_payload() -> dict:
    return {
        "mode": "equal_preview",
        "outcome": "equal_share_preview_rolled_back",
        "tournamentId": vps.PROBY_TOURNAMENT_ID,
        "operationId": vps.PROBY_OPERATION_ID,
        "preview": {
            "ok": True,
            "preview_only": True,
            "rolled_back": True,
            "allocation_hash": vps.PROBY_EXPECTED_ALLOCATION_HASH,
            "money_hash": "d0b8e08f0b0781ffb679ba6fd1f6eb88",
            "receipt": {
                "receipt_version": 4,
                "mode": "started_operator_equal_share",
                "operation_id": vps.PROBY_OPERATION_ID,
                "tournament_id": vps.PROBY_TOURNAMENT_ID,
                "ok": True,
                "success": True,
                "fully_settled": True,
                "status": "CANCELLED",
                "allocation_hash": vps.PROBY_EXPECTED_ALLOCATION_HASH,
                "recipient_count": 6,
                "total_distributed": 31.5,
                "fee_before": 3.5,
                "total_rake_after": 3.5,
                "fees_reversed": 0,
            },
        },
        "canonicalAfter": {
            "ok": True,
            "state": "quiesced",
            "current_boundary_valid": True,
            "receipt": None,
        },
    }


def make_proby_postsettle_payload() -> dict:
    alloc = vps.compute_equal_share_allocation(
        tournament_id=vps.PROBY_TOURNAMENT_ID,
        operation_id=vps.PROBY_OPERATION_ID,
        asset="chips",
        prize_balance=Decimal("31.50"),
        bounty_balance=Decimal("0"),
        fee_balance=Decimal("3.50"),
        playing_roster=[
            {"user_id": u, "registration_id": r}
            for u, r in vps.PROBY_EXPECTED_PLAYING_RECIPIENTS
        ],
    )
    receipt = {
        "receipt_version": 4,
        "mode": "started_operator_equal_share",
        "operation_id": vps.PROBY_OPERATION_ID,
        "tournament_id": vps.PROBY_TOURNAMENT_ID,
        "ok": True,
        "success": True,
        "fully_settled": True,
        "status": "CANCELLED",
        "allocation_hash": vps.PROBY_EXPECTED_ALLOCATION_HASH,
        "recipient_count": 6,
        "total_distributed": 31.5,
        "fee_before": 3.5,
        "total_rake_after": 3.5,
        "fees_reversed": 0,
        "shares": alloc["shares"],
    }
    wallet_credits = [
        {
            "idempotency_key": s["prize_key"],
            "user_id": s["user_id"],
            "amount": 5.25,
        }
        for s in alloc["shares"]
    ]
    payouts = [
        {
            "user_id": s["user_id"],
            "amount": 5.25,
            "source": "operator_abort_equal_share",
        }
        for s in alloc["shares"]
    ]
    roster = [
        {
            "user_id": u,
            "registration_id": r,
            "status": "eliminated",
            "eliminated_at": None,
            "chips": 0,
            "current_bounty": 0,
        }
        for u, r in vps.PROBY_EXPECTED_PLAYING_RECIPIENTS
    ] + [
        {
            "user_id": "5129542f-958c-4693-862d-ff95799e344c",
            "registration_id": "e8b834a0-4eca-47b0-afee-bf16f71f02d1",
            "status": "eliminated",
            "eliminated_at": "2026-10-29T22:09:08.70461+00:00",
            "chips": 0,
            "current_bounty": 0,
        }
    ]
    tournament_seats = [
        {
            "seat_id": f"seat-{idx}",
            "user_id": u,
            "status": "left",
            "stack": 0,
            "left_at": "2026-11-02T15:05:00+00:00",
        }
        for idx, (u, _) in enumerate(vps.PROBY_EXPECTED_PLAYING_RECIPIENTS, start=1)
    ]
    unrelated_seats = [
        {
            "seat_id": "3348189b-2bbe-42db-9300-835fa1a89f88",
            "user_id": "4c417026-97b3-476e-ac35-18d4455a592d",
            "table_id": "ea34f32d-791a-4019-a8dd-cbb7843906c1",
            "stack": "151.54",
            "status": "active",
            "left_at": None,
        },
        {
            "seat_id": "68ad8792-0de7-4e8b-8c50-a530f72e5946",
            "user_id": "4c417026-97b3-476e-ac35-18d4455a592d",
            "table_id": "b5a40a28-b4c1-4bd9-abcf-7ce65798fa26",
            "stack": "50.00",
            "status": "active",
            "left_at": None,
        },
    ]
    return {
        "tournament_id": vps.PROBY_TOURNAMENT_ID,
        "operation_id": vps.PROBY_OPERATION_ID,
        "target": {
            "state": "settled",
            "settled_at": "2026-11-02T15:05:00+00:00",
            "receipt": receipt,
        },
        "cancellation_receipt": copy.deepcopy(receipt),
        "wallet_credits": wallet_credits,
        "tournament_payouts": payouts,
        "chip_escrow": {
            "prize_balance": 0,
            "bounty_balance": 0,
            "fee_balance": 0,
            "prize_out": 31.5,
            "bounty_out": 0,
            "fee_out": 3.5,
            "closed_at": "2026-11-02T15:05:00+00:00",
            "terminal_closed_at": "2026-11-02T15:05:00+00:00",
        },
        "rake_settlements": [
            {
                "amount": 3.5,
                "source": "operator_abort_equal_share",
            }
        ],
        "event": {
            "id": vps.PROBY_TOURNAMENT_ID,
            "status": "CANCELLED",
            "current_players": 0,
            "prize_pool": 0,
            "bounty_pool": 0,
            "total_rake": 3.5,
            "ended_at": "2026-11-02T15:05:00+00:00",
        },
        "roster": roster,
        "table": {
            "id": vps.PROBY_TABLE_ID,
            "status": "closed",
            "terminal_closed_at": "2026-11-02T15:05:00+00:00",
        },
        "tournament_seats": tournament_seats,
        "unrelated_active_seats_before": copy.deepcopy(unrelated_seats),
        "unrelated_active_seats_after": copy.deepcopy(unrelated_seats),
        "permits": [
            {
                "permit_id": "4562a8e2-627e-4685-b083-532022963523",
                "hand_number": 52039597,
                "state": "aborted_unsettled",
            }
        ],
        "open_tournament_leases": 0,
        "open_table_leases": 0,
        "runtime_ack": {
            "outcome": "equal_share_runtime_retired",
            "runtime": {
                "runtime_retired": True,
            },
        },
    }


class VerifyProbySettlementTest(unittest.TestCase):
    def test_preflight_matches_live_proby_preimage_and_pg_jsonb_allocation_hash(self) -> None:
        payload = make_live_proby_preflight_payload()
        res = vps.verify_preflight(payload, require_quiesced=False)
        self.assertTrue(res["ok"], res["errors"])
        self.assertEqual(res["allocation"]["allocation_hash"], "025de5372478d079e763291256fe60cd")
        self.assertEqual(res["allocation"]["recipient_count"], 6)
        self.assertEqual(res["allocation"]["prize_remainder_units"], 0)
        for share in res["allocation"]["shares"]:
            self.assertEqual(share["prize"], 5.25)
            self.assertEqual(share["bounty"], 0)
            self.assertEqual(share["amount"], 5.25)

    def test_preflight_require_quiesced_rejects_stop_requested_and_passes_when_quiesced(self) -> None:
        payload = make_live_proby_preflight_payload()
        res_not_quiesced = vps.verify_preflight(payload, require_quiesced=True)
        self.assertFalse(res_not_quiesced["ok"])
        self.assertTrue(
            any("require_quiesced: target.state" in err for err in res_not_quiesced["errors"])
        )

        # Transition payload to quiesced
        payload["target_owners"][0]["state"] = "quiesced"
        payload["target_owners"][0]["quiescence"] = {
            "generation": payload["lease"]["generation"],
            "money_hash": payload["current_money_hash"],
        }
        payload["pending_custody"] = False
        payload["unacknowledged_boundaries"] = 0
        res_quiesced = vps.verify_preflight(payload, require_quiesced=True)
        self.assertTrue(res_quiesced["ok"], res_quiesced["errors"])

    def test_preview_validates_rollback_and_rejects_mutated_state(self) -> None:
        preview = make_proby_preview_payload()
        res = vps.verify_preview(
            preview,
            expected_money_hash="d0b8e08f0b0781ffb679ba6fd1f6eb88",
        )
        self.assertTrue(res["ok"], res["errors"])

        bad = copy.deepcopy(preview)
        bad["canonicalAfter"]["state"] = "settled"
        bad["preview"]["allocation_hash"] = "deadbeef"
        res_bad = vps.verify_preview(bad)
        self.assertFalse(res_bad["ok"])
        self.assertEqual(len(res_bad["errors"]), 2)

    def test_postsettle_validates_complete_proby_settlement_and_runtime_retirement(self) -> None:
        post = make_proby_postsettle_payload()
        res = vps.verify_postsettle(post)
        self.assertTrue(res["ok"], res["errors"])

    def test_postsettle_rejects_missing_wallet_credit_unclosed_escrow_or_touched_cash_seat(self) -> None:
        post = make_proby_postsettle_payload()
        # 1. Tamper with one recipient credit
        post["wallet_credits"][0]["amount"] = 5.24
        # 2. Leave escrow unclosed
        post["chip_escrow"]["closed_at"] = None
        # 3. Touch huskerfiona's unrelated cash seat stack
        post["unrelated_active_seats_after"][0]["stack"] = "0.00"
        # 4. Leave 1 open tournament lease
        post["open_tournament_leases"] = 1

        res = vps.verify_postsettle(post)
        self.assertFalse(res["ok"])
        joined = "\n".join(res["errors"])
        self.assertIn("wallet_credit_idempotency amount", joined)
        self.assertIn("chip_escrow closed_at", joined)
        self.assertIn("unrelated active seat 3348189b-2bbe-42db-9300-835fa1a89f88 stack changed", joined)
        self.assertIn("open_tournament_leases must be 0", joined)


if __name__ == "__main__":
    unittest.main()
