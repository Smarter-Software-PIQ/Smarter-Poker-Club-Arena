# Promo play-through, phase 1 of 5: the lock ledger and the fee meter

Owner ruling, November 15, 2026: every promo chip grant carries a 4x
play-through in fees before it can be cashed out or claimed back by an agent
(50 promo chips need 200 chips of fees). Profit above the locked amount can be
cashed out at any time. It applies to every promo chip sent to any player or
agent, and to tickets bought with promo chips. Players must see how far they
have to go.

## What was true before

Measured on production the same day: 0 of 2,587 memberships held a locked
promo balance. Every promo door credits `club_members.chip_balance` directly,
so `promo_balance` and `promo_playthrough_required` are never set and
`promo_apply_playthrough` always answers `no_outstanding_promo`. That older
meter also counted chips put in the pot, not fees.

## What phase 1 adds

Migration `20261115210559_promo_play_through_lock_ledger_and_fee_meter.sql`:

- `ca_promo_play_through_settings`: one row. Default multiplier 4, 30 days
  before an unmet grant expires, and `enforced_from`, which stays NULL until
  go-live so promo already in wallets is never locked after the fact.
- `ca_promo_play_through_grants`: one row per grant, with its own multiplier,
  fee target, source and funding wallet. It holds no balance and moves no
  chips.
- `fn_ca_promo_play_through_fees_between`: the meter. Cash rake share from
  `rake_attributions` plus tournament fees from
  `accounting_tournament_fee_sources`, less the member's named refund rows in
  `rake_records`. These are the rows rakeback already reads.
- `fn_ca_promo_play_through_state`, `_settle`, `_record_grant`, `_summary`
  and the member's own door `fn_ca_my_promo_play_through`.

The meter writes nothing during play. Progress is read from fee rows that
already exist, so a hand settlement never touches a play-through row.

## The rule as built

Each grant locks its amount and adds amount x multiplier to the fee target.
Grants held at the same time form one cycle; fees since the cycle began fill
the oldest grant first. Locked is the sum of the unmet grants; the rest of the
wallet is cashable. A grant not met by its expiry stays unmet even if fees
arrive later.

## What phase 1 does not do

Nothing records a grant yet (phase 2 wires the promo doors) and nothing is
refused yet (phase 3 wires cash-out requests, claim-backs and transfers).
Installing this migration changes no behaviour.

## Proof

`scripts/ci/test-promo-play-through.py` applies the real migration to a
throwaway PostgreSQL cluster and runs 22 checks; workflow
`promo-play-through.yml` runs it on every pull request that touches these
paths.
