#!/usr/bin/env python3
"""
Phase 3 of 5 — Authoritative First-Event (`Proby` 2781bcd7-cc8a-4713-ab3e-0d0a81fdf110)
& Single-Event Equal-Share Pre-Flight, Rollback-Preview, and Post-Settlement Verifier.

Supports three deterministic verification stages:
  1. `preflight`:
     - Verifies the lossless private SQL readback (`queries/<tournament_id>.sql`)
       against the expected event identity, operation_id, asset, unit_scale,
       escrow pre-image, playing vs. eliminated roster, zero unpaid obligations,
       zero existing receipts, and untouched unrelated seats.
     - Computes the exact deterministic UUID-ordered equal-share table (`shares`)
       and verifies that the PostgreSQL canonical JSONB `md5((financial->'shares')::text)`
       matches `expected_allocation_hash`.
     - When `--require-quiesced` is set, verifies `target_owners[0].state == 'quiesced'`,
       `quiescence.generation == lease.generation`, `quiescence.money_hash == current_money_hash`,
       `pending_custody is False`, and `unacknowledged_boundaries == 0`.
  2. `preview`:
     - Verifies the `equal_preview` workflow receipt (`outcome == 'equal_share_preview_rolled_back'`,
       `preview.preview_only is True`, `preview.rolled_back is True`,
       `preview.allocation_hash == expected_allocation_hash`,
       `preview.money_hash == expected_money_hash`, `preview.receipt.total_distributed`,
       `preview.receipt.fee_before`, and `canonicalAfter.state == 'quiesced'` with
       `canonicalAfter.receipt is None`).
  3. `postsettle`:
     - Verifies the complete post-`equal_settle` + post-`equal_ack` durable DB and
       runtime state:
       * `smarter_private.tournament_abort_targets.state == 'settled'`
       * `tournament_cancellation_receipts.receipt_version == 4`,
         `mode == 'started_operator_equal_share'`, `fully_settled is True`,
         `allocation_hash == expected_allocation_hash`
       * Every playing recipient has a matching credit in `wallet_credit_idempotency`
         (or `poker_diamond_tournament_ledger` for Diamonds) and `tournament_payouts`
         (`source == 'operator_abort_equal_share'`)
       * `tournament_escrow` has `prize_balance == 0`, `bounty_balance == 0`,
         `fee_balance == 0`, `closed_at IS NOT NULL`, `terminal_closed_at IS NOT NULL`
       * `tournament_rake_settlements` has `amount == expected_fee`,
         `source == 'operator_abort_equal_share'`
       * `tournaments.status == 'CANCELLED'`, `current_players == 0`,
         `prize_pool == 0`, `bounty_pool == 0`, `total_rake == expected_fee`,
         `ended_at IS NOT NULL`
       * All formerly playing `tournament_players` rows have `status == 'eliminated'`,
         `chips == 0`, `current_bounty == 0`, while `eliminated_at IS NULL`
         (preserving prior natural elimination witnesses with non-null `eliminated_at`)
       * All tournament `table_seats` have `left_at IS NOT NULL`, `status == 'left'`,
         `stack == 0`, while unrelated cash/tournament seats for those same users
         remain untouched
       * `tables.status == 'closed'`, `terminal_closed_at IS NOT NULL`, and
         `smarter_private.f06_hand_permits.state == 'aborted_unsettled'`
       * `engine_tournament_leases` and `engine_table_leases` have `0` rows and
         final `equal_ack` reports `outcome == 'equal_share_runtime_retired'`
         with `runtime.runtime_retired is True`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

PROBY_TOURNAMENT_ID = "2781bcd7-cc8a-4713-ab3e-0d0a81fdf110"
PROBY_OPERATION_ID = "d44c4440-2911-430c-8ee7-376611ef3f38"
PROBY_TABLE_ID = "96341322-7624-4b93-ae79-6820367d05f3"
PROBY_EXPECTED_ALLOCATION_HASH = "025de5372478d079e763291256fe60cd"
PROBY_EXPECTED_PLAYING_RECIPIENTS = (
    ("4c417026-97b3-476e-ac35-18d4455a592d", "89013192-99f8-4549-8c9d-63da040ce094"),
    ("4cb9ecf4-962b-44d2-87be-95fcfa1a2918", "c087624b-9868-455e-a6d0-ab33c24acf1f"),
    ("4ce9fa05-703f-40e4-a14e-40cffc3ba305", "3cfda714-25ce-4892-a68a-4c79376b8aa4"),
    ("4dbd99cd-aa34-4c4c-879c-2323aec3cc19", "39bd9656-28ed-4188-8893-ac7c57529df5"),
    ("50c24ee9-9233-4c16-bc16-3d3726488264", "9674221e-c52a-4b0c-8fee-07cfa28d2664"),
    ("eed278a8-3ca2-4e2d-a196-0a0cd9e74f90", "35b2eada-7211-4b91-873a-914aa7850951"),
)
PROBY_EXPECTED_ELIMINATED_USERS = (
    ("5129542f-958c-4693-862d-ff95799e344c", "e8b834a0-4eca-47b0-afee-bf16f71f02d1"),
)


def _d(val: Any) -> Decimal:
    if val is None:
        return Decimal("0")
    return Decimal(str(val))


def _fmt_pg_numeric(units: int, unit_scale: int) -> Any:
    """Format scaled integer units identically to PostgreSQL numeric->jsonb."""
    if unit_scale == 1:
        return int(units)
    dec = Decimal(units) / Decimal(unit_scale)
    if dec == dec.to_integral_value():
        return int(dec)
    normalized = dec.normalize()
    text = format(normalized, "f")
    return float(text) if float(text) == dec else DecNumber(text)


class DecNumber(float):
    """Float wrapper that preserves exact decimal text representation in JSON."""

    def __new__(cls, text: str) -> "DecNumber":
        obj = super().__new__(cls, float(text))
        obj._text = text
        return obj

    def __repr__(self) -> str:
        return self._text


def _pg_jsonb_serialize_value(val: Any) -> str:
    if val is None:
        return "null"
    if val is True:
        return "true"
    if val is False:
        return "false"
    if isinstance(val, DecNumber):
        return repr(val)
    if isinstance(val, int):
        return str(val)
    if isinstance(val, float):
        if val.is_integer():
            return str(int(val))
        return repr(val)
    if isinstance(val, Decimal):
        norm = val.normalize()
        if norm == norm.to_integral_value():
            return str(int(norm))
        return format(norm, "f")
    if isinstance(val, str):
        return json.dumps(val, ensure_ascii=False)
    if isinstance(val, list):
        return "[" + ", ".join(_pg_jsonb_serialize_value(item) for item in val) + "]"
    if isinstance(val, dict):
        # PostgreSQL jsonb orders object keys by (key byte length, key UTF-8 bytes)
        ordered_keys = sorted(val.keys(), key=lambda k: (len(k.encode("utf-8")), k.encode("utf-8")))
        parts = [
            f"{json.dumps(k, ensure_ascii=False)}: {_pg_jsonb_serialize_value(val[k])}"
            for k in ordered_keys
        ]
        return "{" + ", ".join(parts) + "}"
    raise TypeError(f"Unsupported JSONB type: {type(val)!r}")


def compute_equal_share_allocation(
    *,
    tournament_id: str,
    operation_id: str,
    asset: str,
    prize_balance: Decimal,
    bounty_balance: Decimal,
    fee_balance: Decimal,
    playing_roster: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Replicates `smarter_private.tournament_equal_share_plan(p_operation_id, p_tournament_id)`
    exact integer-unit division, remainder distribution, and PostgreSQL JSONB `allocation_hash`.
    """
    if asset not in ("chips", "diamonds"):
        raise ValueError(f"Unsupported asset {asset!r}")
    unit_scale = 100 if asset == "chips" else 1
    prize_units = int((prize_balance * unit_scale).to_integral_value())
    bounty_units = int((bounty_balance * unit_scale).to_integral_value())
    fee_units = int((fee_balance * unit_scale).to_integral_value())

    if Decimal(prize_units) != prize_balance * unit_scale:
        raise ValueError(f"Non-integer scaled prize_balance: {prize_balance} (scale {unit_scale})")
    if Decimal(bounty_units) != bounty_balance * unit_scale:
        raise ValueError(f"Non-integer scaled bounty_balance: {bounty_balance} (scale {unit_scale})")
    if Decimal(fee_units) != fee_balance * unit_scale:
        raise ValueError(f"Non-integer scaled fee_balance: {fee_balance} (scale {unit_scale})")

    ordered = sorted(
        playing_roster,
        key=lambda r: (str(r["user_id"]).lower(), str(r["registration_id"]).lower()),
    )
    count = len(ordered)
    if count <= 0:
        raise ValueError("Cannot compute equal-share allocation for 0 playing recipients")

    p_quot, p_rem = divmod(prize_units, count)
    b_quot, b_rem = divmod(bounty_units, count)

    shares: list[dict[str, Any]] = []
    for idx, row in enumerate(ordered, start=1):
        uid = str(row["user_id"]).lower()
        reg_id = str(row["registration_id"]).lower()
        p_u = p_quot + (1 if idx <= p_rem else 0)
        b_u = b_quot + (1 if idx <= b_rem else 0)
        tot_u = p_u + b_u
        prize_val = _fmt_pg_numeric(p_u, unit_scale)
        bounty_val = _fmt_pg_numeric(b_u, unit_scale)
        amount_val = _fmt_pg_numeric(tot_u, unit_scale)
        prize_key = (
            f"tourney:{tournament_id}:operator-equal-share:{operation_id}:{uid}:prize"
            if p_u > 0
            else None
        )
        bounty_key = (
            f"tourney:{tournament_id}:operator-equal-share:{operation_id}:{uid}:bounty"
            if b_u > 0
            else None
        )
        shares.append(
            {
                "registration_id": reg_id,
                "user_id": uid,
                "prize": prize_val,
                "bounty": bounty_val,
                "amount": amount_val,
                "prize_key": prize_key,
                "bounty_key": bounty_key,
            }
        )

    canonical_shares_text = _pg_jsonb_serialize_value(shares)
    allocation_hash = hashlib.md5(canonical_shares_text.encode("utf-8")).hexdigest()

    return {
        "tournament_id": tournament_id,
        "operation_id": operation_id,
        "asset": asset,
        "unit_scale": unit_scale,
        "recipient_count": count,
        "prize_pool": _fmt_pg_numeric(prize_units, unit_scale),
        "bounty_pool": _fmt_pg_numeric(bounty_units, unit_scale),
        "total_distributable": _fmt_pg_numeric(prize_units + bounty_units, unit_scale),
        "fee_balance": _fmt_pg_numeric(fee_units, unit_scale),
        "prize_quotient_units": p_quot,
        "prize_remainder_units": p_rem,
        "bounty_quotient_units": b_quot,
        "bounty_remainder_units": b_rem,
        "shares": shares,
        "canonical_shares_text": canonical_shares_text,
        "allocation_hash": allocation_hash,
    }


def verify_preflight(
    payload: dict[str, Any],
    *,
    require_quiesced: bool = False,
    enforce_proby_constants: bool = True,
) -> dict[str, Any]:
    """
    Validates a pre-settlement readback payload for `Proby` (or a single event).
    """
    errors: list[str] = []

    tournament_id = str(payload.get("tournament_id", "")).lower()
    operation_id = str(payload.get("expected_operation_id", "")).lower()

    if enforce_proby_constants:
        if tournament_id != PROBY_TOURNAMENT_ID:
            errors.append(f"tournament_id mismatch: expected {PROBY_TOURNAMENT_ID}, got {tournament_id}")
        if operation_id != PROBY_OPERATION_ID:
            errors.append(f"operation_id mismatch: expected {PROBY_OPERATION_ID}, got {operation_id}")

    event = payload.get("event") or {}
    if str(event.get("id", "")).lower() != tournament_id:
        errors.append(f"event.id {event.get('id')!r} != tournament_id {tournament_id!r}")
    if event.get("status") != "RUNNING":
        errors.append(f"event.status must be 'RUNNING' before settlement, got {event.get('status')!r}")

    target_owners = payload.get("target_owners") or []
    if len(target_owners) != 1:
        errors.append(f"expected exactly 1 target_owner row, got {len(target_owners)}")
        target = {}
    else:
        target = target_owners[0]
        if str(target.get("operation_id", "")).lower() != operation_id:
            errors.append(
                f"target_owners[0].operation_id {target.get('operation_id')!r} != {operation_id!r}"
            )
        if str(target.get("tournament_id", "")).lower() != tournament_id:
            errors.append(
                f"target_owners[0].tournament_id {target.get('tournament_id')!r} != {tournament_id!r}"
            )
        if target.get("receipt") is not None:
            errors.append("target_owners[0].receipt must be null before settlement")
        if target.get("settled_at") is not None:
            errors.append("target_owners[0].settled_at must be null before settlement")

    asset = str(target.get("asset") or "chips").lower()
    chip_escrow = payload.get("chip_escrow") or {}
    diamond_escrow = payload.get("diamond_canonical_escrow") or {}

    if asset == "chips":
        prize_balance = _d(chip_escrow.get("prize_balance"))
        bounty_balance = _d(chip_escrow.get("bounty_balance"))
        fee_balance = _d(chip_escrow.get("fee_balance"))
        if chip_escrow.get("closed_at") is not None or chip_escrow.get("terminal_closed_at") is not None:
            errors.append("chip_escrow must not be closed before settlement")
        if _d(diamond_escrow.get("prize_balance")) != 0 or _d(diamond_escrow.get("bounty_balance")) != 0:
            errors.append("chip event must have zero diamond_canonical_escrow balances")
    else:
        prize_balance = _d(diamond_escrow.get("prize_balance"))
        bounty_balance = _d(diamond_escrow.get("bounty_balance"))
        fee_balance = _d(diamond_escrow.get("fee_balance"))

    if enforce_proby_constants:
        if asset != "chips":
            errors.append(f"Proby asset must be 'chips', got {asset!r}")
        if prize_balance != Decimal("31.50"):
            errors.append(f"Proby prize_balance must be 31.50, got {prize_balance}")
        if bounty_balance != Decimal("0"):
            errors.append(f"Proby bounty_balance must be 0, got {bounty_balance}")
        if fee_balance != Decimal("3.50"):
            errors.append(f"Proby fee_balance must be 3.50, got {fee_balance}")

    roster = payload.get("roster") or []
    playing_roster = [
        r
        for r in roster
        if str(r.get("status", "")).lower() in ("playing", "registered")
        and r.get("eliminated_at") is None
    ]
    eliminated_roster = [
        r
        for r in roster
        if str(r.get("status", "")).lower() == "eliminated"
        or r.get("eliminated_at") is not None
    ]

    if len(playing_roster) + len(eliminated_roster) != len(roster):
        errors.append("roster contains ambiguous player status rows")

    if enforce_proby_constants:
        actual_playing_pairs = tuple(
            sorted(
                (str(r["user_id"]).lower(), str(r["registration_id"]).lower())
                for r in playing_roster
            )
        )
        if actual_playing_pairs != PROBY_EXPECTED_PLAYING_RECIPIENTS:
            errors.append(
                f"Proby playing recipients mismatch: expected {PROBY_EXPECTED_PLAYING_RECIPIENTS}, got {actual_playing_pairs}"
            )
        actual_elim_pairs = tuple(
            sorted(
                (str(r["user_id"]).lower(), str(r["registration_id"]).lower())
                for r in eliminated_roster
            )
        )
        if actual_elim_pairs != PROBY_EXPECTED_ELIMINATED_USERS:
            errors.append(
                f"Proby eliminated roster mismatch: expected {PROBY_EXPECTED_ELIMINATED_USERS}, got {actual_elim_pairs}"
            )
        for r in eliminated_roster:
            if r.get("eliminated_at") is None:
                errors.append(f"Proby eliminated player {r.get('user_id')} missing eliminated_at witness")
            if _d(r.get("chips")) != 0:
                errors.append(f"Proby eliminated player {r.get('user_id')} has non-zero chips {r.get('chips')}")

    if int(payload.get("unpaid_obligations") or 0) != 0:
        errors.append(f"unpaid_obligations must be 0, got {payload.get('unpaid_obligations')}")

    existing_receipts = payload.get("existing_receipts") or []
    if len(existing_receipts) != 0:
        errors.append(f"existing_receipts must be empty ([]), got {len(existing_receipts)} rows")

    allocation = compute_equal_share_allocation(
        tournament_id=tournament_id,
        operation_id=operation_id,
        asset=asset,
        prize_balance=prize_balance,
        bounty_balance=bounty_balance,
        fee_balance=fee_balance,
        playing_roster=playing_roster,
    )

    if enforce_proby_constants and allocation["allocation_hash"] != PROBY_EXPECTED_ALLOCATION_HASH:
        errors.append(
            f"Proby allocation_hash mismatch: expected {PROBY_EXPECTED_ALLOCATION_HASH}, got {allocation['allocation_hash']}"
        )

    table_and_seats = payload.get("table_and_seats")
    if table_and_seats is not None:
        if enforce_proby_constants and str(table_and_seats.get("table_id", "")).lower() != PROBY_TABLE_ID:
            errors.append(
                f"Proby table_id mismatch: expected {PROBY_TABLE_ID}, got {table_and_seats.get('table_id')}"
            )
        seats = table_and_seats.get("seats") or []
        if len(seats) != len(playing_roster):
            errors.append(
                f"active table_seats count ({len(seats)}) != playing_roster count ({len(playing_roster)})"
            )
        seat_by_user = {str(s["user_id"]).lower(): s for s in seats}
        for r in playing_roster:
            uid = str(r["user_id"]).lower()
            seat = seat_by_user.get(uid)
            if seat is None:
                errors.append(f"playing recipient {uid} missing open table_seat")
            elif _d(seat.get("stack")) != _d(r.get("chips")):
                errors.append(
                    f"playing recipient {uid} seat stack {seat.get('stack')} != tournament_players.chips {r.get('chips')}"
                )

    if require_quiesced:
        if target.get("state") != "quiesced":
            errors.append(f"require_quiesced: target.state is {target.get('state')!r}, expected 'quiesced'")
        quiescence = target.get("quiescence") or {}
        lease = payload.get("lease") or {}
        if not lease.get("generation"):
            errors.append("require_quiesced: lease.generation is missing")
        elif quiescence.get("generation") != lease.get("generation"):
            errors.append(
                f"require_quiesced: quiescence.generation {quiescence.get('generation')!r} != lease.generation {lease.get('generation')!r}"
            )
        if not payload.get("current_money_hash"):
            errors.append("require_quiesced: current_money_hash is missing")
        elif quiescence.get("money_hash") != payload.get("current_money_hash"):
            errors.append(
                f"require_quiesced: quiescence.money_hash {quiescence.get('money_hash')!r} != current_money_hash {payload.get('current_money_hash')!r}"
            )
        if payload.get("pending_custody") is not False:
            errors.append(f"require_quiesced: pending_custody must be False, got {payload.get('pending_custody')!r}")
        if int(payload.get("unacknowledged_boundaries") or 0) != 0:
            errors.append(
                f"require_quiesced: unacknowledged_boundaries must be 0, got {payload.get('unacknowledged_boundaries')!r}"
            )

    return {
        "ok": len(errors) == 0,
        "mode": "preflight",
        "require_quiesced": require_quiesced,
        "tournament_id": tournament_id,
        "operation_id": operation_id,
        "target_state": target.get("state"),
        "current_money_hash": payload.get("current_money_hash"),
        "pending_custody": payload.get("pending_custody"),
        "unacknowledged_boundaries": payload.get("unacknowledged_boundaries"),
        "allocation": allocation,
        "errors": errors,
    }


def verify_preview(
    preview_output: dict[str, Any],
    *,
    expected_tournament_id: str = PROBY_TOURNAMENT_ID,
    expected_operation_id: str = PROBY_OPERATION_ID,
    expected_allocation_hash: str = PROBY_EXPECTED_ALLOCATION_HASH,
    expected_money_hash: str | None = None,
    expected_total_distributed: Decimal = Decimal("31.50"),
    expected_fee_before: Decimal = Decimal("3.50"),
    expected_recipient_count: int = 6,
) -> dict[str, Any]:
    """
    Validates the output of `equal_preview` from `tournament-original-recovery-control.mjs`.
    """
    errors: list[str] = []

    if preview_output.get("mode") != "equal_preview":
        errors.append(f"mode must be 'equal_preview', got {preview_output.get('mode')!r}")
    if preview_output.get("outcome") != "equal_share_preview_rolled_back":
        errors.append(
            f"outcome must be 'equal_share_preview_rolled_back', got {preview_output.get('outcome')!r}"
        )
    if str(preview_output.get("tournamentId", "")).lower() != expected_tournament_id.lower():
        errors.append(
            f"tournamentId {preview_output.get('tournamentId')!r} != {expected_tournament_id!r}"
        )
    if str(preview_output.get("operationId", "")).lower() != expected_operation_id.lower():
        errors.append(
            f"operationId {preview_output.get('operationId')!r} != {expected_operation_id!r}"
        )

    preview = preview_output.get("preview") or {}
    if preview.get("ok") is not True:
        errors.append("preview.ok must be True")
    if preview.get("preview_only") is not True:
        errors.append("preview.preview_only must be True")
    if preview.get("rolled_back") is not True:
        errors.append("preview.rolled_back must be True")
    if preview.get("allocation_hash") != expected_allocation_hash:
        errors.append(
            f"preview.allocation_hash {preview.get('allocation_hash')!r} != {expected_allocation_hash!r}"
        )
    if expected_money_hash is not None and preview.get("money_hash") != expected_money_hash:
        errors.append(
            f"preview.money_hash {preview.get('money_hash')!r} != {expected_money_hash!r}"
        )

    receipt = preview.get("receipt") or {}
    if receipt.get("receipt_version") != 4:
        errors.append(f"preview.receipt.receipt_version must be 4, got {receipt.get('receipt_version')!r}")
    if receipt.get("mode") != "started_operator_equal_share":
        errors.append(
            f"preview.receipt.mode must be 'started_operator_equal_share', got {receipt.get('mode')!r}"
        )
    if receipt.get("fully_settled") is not True:
        errors.append("preview.receipt.fully_settled must be True")
    if receipt.get("allocation_hash") != expected_allocation_hash:
        errors.append(
            f"preview.receipt.allocation_hash {receipt.get('allocation_hash')!r} != {expected_allocation_hash!r}"
        )
    if int(receipt.get("recipient_count") or 0) != expected_recipient_count:
        errors.append(
            f"preview.receipt.recipient_count {receipt.get('recipient_count')!r} != {expected_recipient_count}"
        )
    if _d(receipt.get("total_distributed")) != expected_total_distributed:
        errors.append(
            f"preview.receipt.total_distributed {receipt.get('total_distributed')!r} != {expected_total_distributed}"
        )
    if _d(receipt.get("fee_before")) != expected_fee_before:
        errors.append(
            f"preview.receipt.fee_before {receipt.get('fee_before')!r} != {expected_fee_before}"
        )
    if _d(receipt.get("total_rake_after")) != expected_fee_before:
        errors.append(
            f"preview.receipt.total_rake_after {receipt.get('total_rake_after')!r} != {expected_fee_before}"
        )
    if _d(receipt.get("fees_reversed")) != Decimal("0"):
        errors.append(
            f"preview.receipt.fees_reversed must be 0, got {receipt.get('fees_reversed')!r}"
        )

    canonical_after = preview_output.get("canonicalAfter") or {}
    if canonical_after.get("state") != "quiesced":
        errors.append(
            f"canonicalAfter.state must remain 'quiesced' after rollback preview, got {canonical_after.get('state')!r}"
        )
    if canonical_after.get("receipt") is not None:
        errors.append("canonicalAfter.receipt must remain None after rollback preview")
    if canonical_after.get("current_boundary_valid") is not True:
        errors.append("canonicalAfter.current_boundary_valid must remain True after rollback preview")

    return {
        "ok": len(errors) == 0,
        "mode": "preview",
        "tournament_id": expected_tournament_id,
        "operation_id": expected_operation_id,
        "allocation_hash": preview.get("allocation_hash"),
        "money_hash": preview.get("money_hash"),
        "errors": errors,
    }


def verify_postsettle(
    postsettle_payload: dict[str, Any],
    *,
    expected_allocation: dict[str, Any] | None = None,
    enforce_proby_constants: bool = True,
) -> dict[str, Any]:
    """
    Validates the complete durable DB state + runtime retirement after `equal_settle` and final `equal_ack`.
    """
    errors: list[str] = []

    tournament_id = str(postsettle_payload.get("tournament_id", "")).lower()
    operation_id = str(postsettle_payload.get("operation_id", "")).lower()

    if enforce_proby_constants:
        if tournament_id != PROBY_TOURNAMENT_ID:
            errors.append(f"tournament_id {tournament_id!r} != {PROBY_TOURNAMENT_ID!r}")
        if operation_id != PROBY_OPERATION_ID:
            errors.append(f"operation_id {operation_id!r} != {PROBY_OPERATION_ID!r}")

    if expected_allocation is None and enforce_proby_constants:
        expected_allocation = compute_equal_share_allocation(
            tournament_id=PROBY_TOURNAMENT_ID,
            operation_id=PROBY_OPERATION_ID,
            asset="chips",
            prize_balance=Decimal("31.50"),
            bounty_balance=Decimal("0.00"),
            fee_balance=Decimal("3.50"),
            playing_roster=[
                {"user_id": u, "registration_id": r}
                for u, r in PROBY_EXPECTED_PLAYING_RECIPIENTS
            ],
        )

    if expected_allocation is None:
        raise ValueError("expected_allocation is required when enforce_proby_constants is False")

    expected_hash = expected_allocation["allocation_hash"]
    expected_shares = expected_allocation["shares"]
    expected_total_dist = _d(expected_allocation["total_distributable"])
    expected_fee = _d(expected_allocation["fee_balance"])
    expected_count = int(expected_allocation["recipient_count"])

    # 1. Abort target & canonical receipt
    target = postsettle_payload.get("target") or {}
    if target.get("state") != "settled":
        errors.append(f"target.state must be 'settled', got {target.get('state')!r}")
    if target.get("settled_at") is None:
        errors.append("target.settled_at must not be null")

    receipt = postsettle_payload.get("cancellation_receipt") or {}
    if receipt.get("receipt_version") != 4:
        errors.append(f"cancellation_receipt.receipt_version must be 4, got {receipt.get('receipt_version')!r}")
    if receipt.get("mode") != "started_operator_equal_share":
        errors.append(
            f"cancellation_receipt.mode must be 'started_operator_equal_share', got {receipt.get('mode')!r}"
        )
    if str(receipt.get("operation_id", "")).lower() != operation_id:
        errors.append(
            f"cancellation_receipt.operation_id {receipt.get('operation_id')!r} != {operation_id!r}"
        )
    if str(receipt.get("tournament_id", "")).lower() != tournament_id:
        errors.append(
            f"cancellation_receipt.tournament_id {receipt.get('tournament_id')!r} != {tournament_id!r}"
        )
    if receipt.get("ok") is not True or receipt.get("success") is not True or receipt.get("fully_settled") is not True:
        errors.append("cancellation_receipt ok/success/fully_settled must all be True")
    if receipt.get("status") != "CANCELLED":
        errors.append(f"cancellation_receipt.status must be 'CANCELLED', got {receipt.get('status')!r}")
    if receipt.get("allocation_hash") != expected_hash:
        errors.append(
            f"cancellation_receipt.allocation_hash {receipt.get('allocation_hash')!r} != {expected_hash!r}"
        )
    if int(receipt.get("recipient_count") or 0) != expected_count:
        errors.append(
            f"cancellation_receipt.recipient_count {receipt.get('recipient_count')!r} != {expected_count}"
        )
    if _d(receipt.get("total_distributed")) != expected_total_dist:
        errors.append(
            f"cancellation_receipt.total_distributed {receipt.get('total_distributed')!r} != {expected_total_dist}"
        )
    if _d(receipt.get("fee_before")) != expected_fee or _d(receipt.get("total_rake_after")) != expected_fee:
        errors.append(
            f"cancellation_receipt fee_before/total_rake_after ({receipt.get('fee_before')}/{receipt.get('total_rake_after')}) != {expected_fee}"
        )
    if _d(receipt.get("fees_reversed")) != Decimal("0"):
        errors.append(f"cancellation_receipt.fees_reversed must be 0, got {receipt.get('fees_reversed')!r}")

    if target.get("receipt") != receipt:
        errors.append("target.receipt does not match canonical cancellation_receipt")

    # 2. Per-recipient wallet idempotency credits & tournament_payouts
    wallet_credits = postsettle_payload.get("wallet_credits") or []
    credits_by_key = {str(c.get("idempotency_key")): c for c in wallet_credits}
    payouts = postsettle_payload.get("tournament_payouts") or []
    payouts_by_user = {str(p.get("user_id", "")).lower(): p for p in payouts}

    if len(wallet_credits) != expected_count:
        errors.append(f"expected {expected_count} wallet_credit_idempotency rows, got {len(wallet_credits)}")
    if len(payouts) != expected_count:
        errors.append(f"expected {expected_count} tournament_payouts rows, got {len(payouts)}")

    for share in expected_shares:
        uid = share["user_id"]
        expected_amt = _d(share["amount"])
        pkey = share["prize_key"]
        credit = credits_by_key.get(pkey)
        if credit is None:
            errors.append(f"missing wallet_credit_idempotency row for key {pkey!r}")
        else:
            if str(credit.get("user_id", "")).lower() != uid:
                errors.append(f"wallet_credit_idempotency user_id {credit.get('user_id')!r} != {uid!r}")
            if _d(credit.get("amount")) != expected_amt:
                errors.append(f"wallet_credit_idempotency amount {credit.get('amount')!r} != {expected_amt}")

        payout = payouts_by_user.get(uid)
        if payout is None:
            errors.append(f"missing tournament_payouts row for user_id {uid!r}")
        else:
            if _d(payout.get("amount")) != expected_amt:
                errors.append(f"tournament_payouts amount for {uid} is {payout.get('amount')!r}, expected {expected_amt}")
            if payout.get("source") != "operator_abort_equal_share":
                errors.append(
                    f"tournament_payouts.source for {uid} is {payout.get('source')!r}, expected 'operator_abort_equal_share'"
                )

    # 3. Tournament escrow & rake settlement
    escrow = postsettle_payload.get("chip_escrow") or {}
    if _d(escrow.get("prize_balance")) != Decimal("0"):
        errors.append(f"chip_escrow.prize_balance must be 0, got {escrow.get('prize_balance')!r}")
    if _d(escrow.get("bounty_balance")) != Decimal("0"):
        errors.append(f"chip_escrow.bounty_balance must be 0, got {escrow.get('bounty_balance')!r}")
    if _d(escrow.get("fee_balance")) != Decimal("0"):
        errors.append(f"chip_escrow.fee_balance must be 0, got {escrow.get('fee_balance')!r}")
    if _d(escrow.get("prize_out")) != expected_total_dist:
        errors.append(f"chip_escrow.prize_out must be {expected_total_dist}, got {escrow.get('prize_out')!r}")
    if _d(escrow.get("fee_out")) != expected_fee:
        errors.append(f"chip_escrow.fee_out must be {expected_fee}, got {escrow.get('fee_out')!r}")
    if escrow.get("closed_at") is None or escrow.get("terminal_closed_at") is None:
        errors.append("chip_escrow closed_at and terminal_closed_at must both be non-null")

    rake_settlements = postsettle_payload.get("rake_settlements") or []
    if len(rake_settlements) != 1:
        errors.append(f"expected 1 tournament_rake_settlements row, got {len(rake_settlements)}")
    else:
        rs = rake_settlements[0]
        if _d(rs.get("amount")) != expected_fee:
            errors.append(f"rake_settlements[0].amount {rs.get('amount')!r} != {expected_fee}")
        if rs.get("source") != "operator_abort_equal_share":
            errors.append(
                f"rake_settlements[0].source {rs.get('source')!r} != 'operator_abort_equal_share'"
            )

    # 4. Tournament row, roster, seats, table & permit disposition
    event = postsettle_payload.get("event") or {}
    if event.get("status") != "CANCELLED":
        errors.append(f"event.status must be 'CANCELLED', got {event.get('status')!r}")
    if event.get("current_players") is None or int(event.get("current_players")) != 0:
        errors.append(f"event.current_players must be 0, got {event.get('current_players')!r}")
    if _d(event.get("prize_pool")) != Decimal("0") or _d(event.get("bounty_pool")) != Decimal("0"):
        errors.append(
            f"event prize_pool/bounty_pool must be 0/0, got {event.get('prize_pool')}/{event.get('bounty_pool')}"
        )
    if _d(event.get("total_rake")) != expected_fee:
        errors.append(f"event.total_rake must be {expected_fee}, got {event.get('total_rake')!r}")
    if event.get("ended_at") is None:
        errors.append("event.ended_at must not be null")

    roster = postsettle_payload.get("roster") or []
    expected_playing_uids = {s["user_id"] for s in expected_shares}
    expected_elim_uids = {u for u, _ in PROBY_EXPECTED_ELIMINATED_USERS} if enforce_proby_constants else set()

    for r in roster:
        uid = str(r.get("user_id", "")).lower()
        if r.get("status") != "eliminated":
            errors.append(f"post-settlement roster user {uid} has status {r.get('status')!r}, expected 'eliminated'")
        if _d(r.get("chips")) != Decimal("0") or _d(r.get("current_bounty")) != Decimal("0"):
            errors.append(f"post-settlement roster user {uid} has non-zero chips/bounty")
        if uid in expected_playing_uids and r.get("eliminated_at") is not None:
            errors.append(
                f"administratively retired playing recipient {uid} must keep eliminated_at IS NULL, got {r.get('eliminated_at')!r}"
            )
        if uid in expected_elim_uids and r.get("eliminated_at") is None:
            errors.append(
                f"prior eliminated player {uid} lost eliminated_at witness timestamp"
            )

    table = postsettle_payload.get("table") or {}
    if str(table.get("status", "")).lower() != "closed":
        errors.append(f"table.status must be 'closed', got {table.get('status')!r}")
    if table.get("terminal_closed_at") is None:
        errors.append("table.terminal_closed_at must not be null")

    tournament_seats = postsettle_payload.get("tournament_seats") or []
    if len(tournament_seats) != expected_count:
        errors.append(f"expected {expected_count} tournament_seats rows, got {len(tournament_seats)}")
    for s in tournament_seats:
        if s.get("left_at") is None:
            errors.append(f"tournament_seat {s.get('seat_id')} still has left_at IS NULL")
        if str(s.get("status", "")).lower() != "left":
            errors.append(f"tournament_seat {s.get('seat_id')} status is {s.get('status')!r}, expected 'left'")
        if _d(s.get("stack")) != Decimal("0"):
            errors.append(f"tournament_seat {s.get('seat_id')} stack is {s.get('stack')!r}, expected 0")

    # Verify unrelated active seats for the same users were untouched
    unrelated_seats_before = postsettle_payload.get("unrelated_active_seats_before") or []
    unrelated_seats_after = postsettle_payload.get("unrelated_active_seats_after") or []
    if unrelated_seats_before:
        after_by_id = {str(s.get("seat_id")): s for s in unrelated_seats_after}
        for before_seat in unrelated_seats_before:
            sid = str(before_seat.get("seat_id"))
            after_seat = after_by_id.get(sid)
            if after_seat is None:
                errors.append(f"unrelated active seat {sid} disappeared or was closed during Proby settlement")
            else:
                if after_seat.get("left_at") is not None:
                    errors.append(f"unrelated active seat {sid} had left_at set during Proby settlement")
                if _d(after_seat.get("stack")) != _d(before_seat.get("stack")):
                    errors.append(
                        f"unrelated active seat {sid} stack changed from {before_seat.get('stack')} to {after_seat.get('stack')}"
                    )

    # 5. Permit disposition & runtime lease retirement
    permits = postsettle_payload.get("permits") or []
    for p in permits:
        if p.get("state") == "reserved":
            errors.append(f"permit {p.get('permit_id')} is still in state 'reserved'")
        if p.get("hand_number") == 52039597 and p.get("state") != "aborted_unsettled":
            errors.append(
                f"Proby hand 52039597 permit {p.get('permit_id')} state is {p.get('state')!r}, expected 'aborted_unsettled'"
            )

    if int(postsettle_payload.get("open_tournament_leases") or 0) != 0:
        errors.append(
            f"open_tournament_leases must be 0 after final equal_ack, got {postsettle_payload.get('open_tournament_leases')}"
        )
    if int(postsettle_payload.get("open_table_leases") or 0) != 0:
        errors.append(
            f"open_table_leases must be 0 after final equal_ack, got {postsettle_payload.get('open_table_leases')}"
        )

    runtime_ack = postsettle_payload.get("runtime_ack") or {}
    if runtime_ack:
        if runtime_ack.get("outcome") != "equal_share_runtime_retired":
            errors.append(
                f"runtime_ack.outcome must be 'equal_share_runtime_retired', got {runtime_ack.get('outcome')!r}"
            )
        runtime_inner = runtime_ack.get("runtime") or {}
        if runtime_inner.get("runtime_retired") is not True:
            errors.append("runtime_ack.runtime.runtime_retired must be True")

    return {
        "ok": len(errors) == 0,
        "mode": "postsettle",
        "tournament_id": tournament_id,
        "operation_id": operation_id,
        "allocation_hash": expected_hash,
        "recipient_count": expected_count,
        "total_distributed": str(expected_total_dist),
        "fee_settled": str(expected_fee),
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mode",
        choices=("preflight", "preview", "postsettle"),
        default="preflight",
        help="Verification stage to run",
    )
    parser.add_argument(
        "--input",
        type=Path,
        required=True,
        help="Path to JSON input payload for the selected mode",
    )
    parser.add_argument(
        "--require-quiesced",
        action="store_true",
        help="In preflight mode, require target state == 'quiesced' and valid boundary quiescence",
    )
    parser.add_argument(
        "--generic-event",
        action="store_true",
        help="Allow non-Proby tournament/operation IDs while enforcing all structural and financial invariants",
    )
    args = parser.parse_args(argv)

    raw = json.loads(args.input.read_text(encoding="utf-8"))
    enforce_proby = not args.generic_event

    if args.mode == "preflight":
        result = verify_preflight(
            raw,
            require_quiesced=args.require_quiesced,
            enforce_proby_constants=enforce_proby,
        )
    elif args.mode == "preview":
        result = verify_preview(raw)
    else:
        result = verify_postsettle(raw, enforce_proby_constants=enforce_proby)

    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
