# A zero prize pool PKO names its winner as a zero-valued first place (2026-11-05)

## What happened

The Midday Free Buy (`39b5fa14`, 18:30 UTC, a bounty-only promo PKO with a
locked ordinary prize pool of 0 and a bounty pool of 323) reached its winner at
21:17 UTC and never finished. The engine's finalizer retried every cycle and the
database refused each attempt with:

    cash authority returned a partial result:
    {"ok": true, "status": "COMPLETING", "payouts": [], "fully_settled": true, "winner_amount": 0}

## Cause

Migration `20261105203911` had let `fn_settle_tournament_places` accept an
empty place ladder when the locked pool is exactly 0 (previously it raised
"derived an empty ladder"). That removed the first refusal but left the cash
authority returning `payouts: []`. The terminal guard
(`fn_complete_tournament_terminal_pre_seat_guard`) refuses any cash result with
fewer than one payout line, and its own zero-cash branch states the contract it
expects: "the cash authority returns the derived zero-dollar winner line".

## Fix

Migration `20261105215359`: when the derived ladder is empty and the locked
pool is 0, `fn_settle_tournament_places` names first place as one zero-valued
ladder line. Every existing rule then applies to it unchanged:

- a zero-valued place is standings, not a debt (no obligation, no payout row,
  no wallet credit);
- the ladder total (0) equals the locked pool (0);
- the winner is already stamped position 1 before the ladder is walked;
- the receipt carries one payout line of amount 0 and `winner_amount` 0, which
  the guard and `fn_ca_tournament_terminal_receipt` already accept.

Bounties still settle through their own authority, and a positive pool with an
empty ladder still refuses (23514). Rehearsed read-only in a rolled-back
transaction against the live Midday Free Buy before merge.
