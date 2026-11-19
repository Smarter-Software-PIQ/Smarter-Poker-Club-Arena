# A rebuy reads promo fee state outside its event lane

2026-11-19, incident 075013fd, lane E3. Migration
`20261119054539_a_rebuy_reads_promo_fee_state_outside_its_event_lane.sql`.

## Where a rebuy's time goes

`process_tournament_rebuy` takes its event's rebuy key first, so every step of one purchase is time the next purchase of the same event waits. `track_functions` is off and `pg_stat_statements` tracks top level only, so the parts were measured read-only on production (2026-11-19, 05:30 to 06:00 UTC):

- 99% of the 4,616 chip purchases in six hours were made by promo grant holders: 77% held a locked winnings gate and 12% an open grant.
- Two steps can recompute the holder's whole fee history when the hourly snapshot is not current. For 40 recent buyers that cost 1,367 ms mean, 1,041 ms median and 5,497 ms max, and 29 of the 40 had no current snapshot. Free Buy grants keep changing the snapshot's signature.
  - The winnings settle on every entry charge. It is removed by `20261119053144` (PR for lane E3 task A).
  - `fn_ca_promo_play_through_settle` from the custody trigger, for an open-grant holder.
- Nothing else reaches the fee history. `fn_ca_promo_fund_from_balance` reads `fn_ca_promo_play_through_state`, whose join stops before the recomputation when there is no open grant, and finds the snapshot just refreshed when there is one. Receipt, wake, club stamp and Diamond work are single-row reads and writes. Guarding `fund_from_balance` was tried and measured: it saved nothing, so it is not in this change.

## What changed

The rebuy calls `fn_ca_promo_fee_state_ensure` for an open-grant holder before it takes the event's rebuy key. The settles inside the lane then find the snapshot current. This applies the rule of `20261119002019` (a current snapshot is trusted for up to two hours) a few lane-waits earlier. Releases are still decided live, and cash-outs are still live. Holders with no open grant pay nothing.

When the purchase itself closes a grant (213 of 584 open-grant purchases) and another grant stays open, the settle still refreshes inside the lane, as before.

## Proof

`scripts/ci/test-a-rebuy-reads-promo-fee-state-outside-its-lane.py` runs on native PostgreSQL 16/17 against the production bodies, with their md5s pinned. With a 400 ms recomputation and 100 ms of in-lane work, the second of two purchases of one event waited 1,002 ms before and 588 ms after. The law is `tests/a-rebuy-reads-promo-fee-state-outside-its-lane.law.test.ts`.

This change requires `20261119013430` (lane B7, #11356) and applies to that migration's post-image, `c294af49`, landing on `8acb4563`.
