# Phase 14 Says Why A Decision Is Outside Its Kernel, And Upgrade 10 Counts Its Opportunities

On engine 533608409f the corrective kernel (Phase 14) and the fast recency window (upgrade 10) both read zero over the first four and a half hours. A zero could not be classified: neither had an opportunity count. These counters supply one. Evidence only: no decision, wager, think time, queue or deadline changes.

## Phase 14

- `phase14_kernel_refused_<reason>_seen` counts a FAST decision in an admitted Phase 14 domain that the kernel's declared family refuses, by the first refusing check. The reasons are the closed strings of `kernelEligibility.ts` and `kernelTournamentEligibility.ts`, plus `baseline_unusable`. A decision in a domain that is not admitted counts nothing.
- `phase14_kernel_eligible_deep_seen` counts a DEEP second look that reached the admitted kernel. It is kept apart from `phase14_kernel_eligible_seen` (FAST), which may have counted the same turn.
- `phase14Admission` evaluates the same three checks in the same order as before (candidate mode, snapshot family, baseline composition), each at most once on the first evaluation, and still re-checks all three when the evaluator runs.

For cash, the family is narrow: exactly two players dealt, chips at 0.01, no ante or dead blind, a single-board river, the opponent all in with nothing behind. On 2026-11-13 between 08:09 and 12:35 UTC, 417 of 52,282 cash hands were dealt to exactly two players and none had an all-in on the river. Lightning formed only 4, 5 and 6 player hands in the same interval, so the kernel cannot reach a Lightning decision at the current pool sizes.

## Upgrade 10

`upgrade10_fast_window_ready_seen` counts a read of a fast-engage statistic that is not engaged while the fast window holds at least the engage minimum of recent opportunities. `upgrade10_fast_window_engaged` counts the subset the fast window switched on. Like the engage counters, it counts read computations, not decisions.

## Not Needed For Upgrade 09

`upgrade09_preaction_purge_table_seen` and `_lightning_seen` already fire exactly when a stale pre-action exists, so their opportunity and their invocation are the same event. A zero there means no stale pre-action occurred.

## Regression

- `horseDecision/phase14Evidence.test.ts` (4), real worker: an eligible FAST decision counts eligible once and no refusal; an admitted decision with the opponent not all in counts `phase14_kernel_refused_original_opponent_not_all_in_seen`; a domain that is not admitted counts nothing; a DEEP look that reached the kernel counts `phase14_kernel_eligible_deep_seen`.
- `HorseUpgradeEvidenceCounters.test.ts`: engagements are a strict subset of ready reads on the existing grid; a fast window below the minimum counts nothing ready.

## Guard: An Occurrence Counter Never Carries A Floor

`HorseDataLedger.test.ts` now fails when a receipt whose key ends in `_seen` is given a `minRatio`. A floor is something the receipt audit reports as critical at zero, and an occurrence counter (a side game nobody offered, a rare cleanup, a once-per-process build) has quiet days by nature. This closes the class of mistake corrected in #10668 for every counter named for what it is. A `_seen` population counter such as `phase10_seen` is still allowed as a denominator.
