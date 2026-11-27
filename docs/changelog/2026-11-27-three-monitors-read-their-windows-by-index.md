# Three Monitors Read Their Windows By Index (2026-11-27)

After 20261126220936 three readers were still cancelled on production with
SQLSTATE 57014. Each one paid a random read per row, pool or pair where the rows
it needs sit in one index range.

## Cause

- `fn_union_treasury_selftest` (rakeback settler, PostgREST, 8 s): cold reads
  inside `fn_bbj_conservation_check`. The `bbj_promo_sweep` sum had no covering
  index (5.5 s cold), the snapshot count scanned a 496 MB heap (2.3 s cold), the
  contributions tail walked all of `idx_bbj_contrib_pool_facts` (1.8 to 3.8 s),
  and every late pool probed chip_ledger twice for its seeds and burns since the
  sweep checkpoint (8,100 probes).
- `fn_ca_horse_exposure_watch` (hourly cron, 150 s): from 02:17Z the run flagged a
  person with a 13,629-hand window. The leak breakdown joined window-wide CTEs
  to each other and the planner rescanned one for every row of another:
  quadratic, 42 s for 300 hands.
- `fn_rake_attribution_drift(24)` (FeeReconciler, PostgREST, 8 s): one random
  probe of `idx_rake_attributions_hand_id` per hand, about 30,000 a day, 7.5 s
  and more cold.

## Fix

Migration `20261127043816`:

- Four covering indexes, built CONCURRENTLY and verified by name before the
  transaction: `idx_rake_attributions_created_cover`,
  `idx_bbj_contrib_nullhand_created`, `idx_ca_bbj_pool_snapshots_runs`,
  `idx_chip_tx_bbj_promo_sweep`.
- The contributions total and its hourly advance read two `created_at` ranges
  and plan with the checkpoint's value.
- The conservation check reads the late pools' tail legs once, from the range of
  `idx_chip_ledger_bbj_pool_legs` it already reads, grouped by pool. The whole
  and absorbed reads run as LATERAL key probes only for the pools that need them
  (2 and 52 of 4,063), instead of a scalar subquery for every pool. That block
  took 4,675 ms old and 222 ms new on production.
- The rake drift reads the attributions as one range from a day before its
  window and sums any hand the range misses by hand id with no window.
- The horse watch's breakdown reads one hand at a time; steps 1, 2 and 4 are
  unchanged byte for byte.

Every answer was compared with the live definition on production, read-only, in
one snapshot: contributions tail 1,190.68 both ways, advance delta 560.44,
seeded 406,100.22, burned 407,205.34, the breakdown identical on four samples
(including Lightning hands), and every attribution on its rake row's
`created_at` (29,880 hands). The breakdown for all 13,629 hands takes 2.7 s.
Grants are restated as live (service_role only). No money moves and no schedule
or threshold changes. `fn_bbj_contributions_total_verify`, the daily full
recompute, is unchanged.

Law: `tests/three-monitors-read-their-windows-by-index.law.test.ts`.
