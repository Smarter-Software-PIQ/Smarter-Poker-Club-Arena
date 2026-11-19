# A promo entry fee never settles promo progress inside a payout (2026-11-19)

Incident 075013fd, lane D3: the 10-30 s tournament between-hands tails.

## Cause, read from production (2026-11-18 23:05Z - 2026-11-19 00:05Z)

`fn_ca_promo_profit_finish_entry_fee` (reached from every
`tournament_refund_entitlements` insert through `ca_promo_entry_fee_entitlement`,
and from every promo event charge) ran `fn_ca_promo_profit_settle` for each promo
holder of the charge: mean 874 ms, p95 2.7 s, max 16.3 s per account.

The capped satellite qualifier settlement of "Satellite Into 25 Chip Bankroll
Builder" #1 and #2 (19-20 qualifiers each) writes one seat entitlement per
qualifier, so it settled promo progress up to 20 times in one transaction. It was
cancelled at the 8 s statement timeout on every attempt (30-44 cancels per 5 min,
about 80% inside `fn_ca_promo_fee_events`), re-prepared every ~9 s, and never
committed. Each attempt held the finish lane F and the satellite's and target's
T keys exclusively for 8 s:

- the target's hands queued on T (`fn_f06_retain_hand_continuation`,
  `insert_hole_cards`, hand-number allocation);
- every satellite's qualifier read (315 waits of 1 s or more) and every ordinary
  finish queued on F;
- the two satellites stayed parked on their held qualifier boundary.

Tournaments with a settling satellite: 28% of hands over 9 s, p95 20.3 s.

## Fix

The entry fee keeps its consumption and no longer settles. Owner ruling
2026-11-18: promo progress is updated once per hour
(`sp_ca_promo_profit_hourly_sweep`) and at cash-out, never per hand or per
charge. Every winnings credit (`fn_ca_promo_profit_credit_owned`) and ticket
snapshot still settles the holder first, so no restriction decision reads a
stale gate.

Migration `20261119001629`; native proof
`scripts/ci/test-promo-entry-fee-never-settles-progress.py` (PostgreSQL 16).
