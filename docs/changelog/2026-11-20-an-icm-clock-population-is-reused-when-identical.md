# A tournament decision reuses the ICM clock population when its inputs are identical (2026-11-20)

The tournament-utility step built a fresh Monte Carlo ICM estimator (up to 240,000 clock draws and a sort per trial)
for every tournament Horse decision; in production 2026-11-21 00:00-00:26Z that step took 44% of all Horse decision
time. `createIcmEquityEstimator` now reuses an estimator (bounded LRU of 8 per process) only when field length, hero
index, payout curve, mutable (table-local) slots, trial cap, live count and every non-mutable stack are identical.
The estimator is a pure seeded function of those inputs, so no estimate and no decision changes
(law: IcmEstimatorReuse.law.test.ts; docs/laws.d/an-icm-clock-population-is-reused-only-when-it-is-the-same.md).
