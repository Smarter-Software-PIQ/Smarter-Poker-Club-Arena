# EngineCutoverMissed 2026-11-22: the all-in tail was mis-graded

Production Alerts PRIMARY, 2026-11-22 ~10:45-11:05 UTC. Closes (after live verification only):
`operational_alert_events` 447376 (`EngineCutoverMissed`, `missed:2026-11-22`).

## Chain, read from the owning runs

1. `stage-engine-release.yml` run 45000042559 (reserved 07:50Z, cutoff 09:30Z), job
   "Record the daily release evidence": `Selection kept serving c2d6e45e... deferred:
   5e85d1508c6a: Backup copy lacks installed migration 20261121152102 ... and 4 more;
   0191691c15f3: serving rollback rehearsal unavailable`. Neither is the freeze baseline.
2. `backup-engine.yml` run 44994520089 (plan 06:37Z): `FREEZE BASELINE: 0a3a6a52... is
   tonight's shippable 04:00 build` - correctly planned on a copy restored 06:42Z.
3. Its certify job (06:44-07:36Z): boot, crash, rollback/forward rehearsal all passed; the
   soak refused it:
   `FAIL unintended hand-gap delay exceeded budget: kind=cash shape=cash_bust hands=12
   unintended_p50_ms=1 unintended_p95_ms=499 unintended_p99_ms=501 budget_ms=250 over_budget=2`
   -> `backup-engine/certified = failure` on 0a3a6a52, so the selection found no certified build.

## Root cause

500 ms = ALL_IN_SHOWDOWN_EXTRA_MS (2000) - WINNING_CARDS_EXTRA_MS (1500).
- Engine: `isAllInShowdown` (server/src/engine/presentation/handEventFrames.ts:214) adds the
  tail when any shown player `is_all_in`. `HandController.ts` sets `is_all_in` on a `call`,
  `bet`/`raise` (and blinds/antes) that empties the stack, recorded under that action's name.
- Grader (`fn_ca_hand_gap_unintended_delay`, used by the production watch AND by
  server/standby/standby-engine.sh for the certificate): all-in only if a shown player has an
  action named `'all_in'`. So those hands owed 500 ms more than the grader counted.

## Production measurements (read-only)

- 12 h: showdowns with a shown player at stack 0: cash 369 (1 with no 'all_in' action),
  tournament 6,294 (37 with none).
- 8 h, 10,118 showdowns with the next hand's `cadence.hold_ms` (engine's own hold):
  72 graded exactly 500 ms under the engine; "shown player at stack 0" detects 22, all 22
  equal to the engine's hold (0 false). The other 50 are all-in winners (e.g. `a1365a00`,
  all-in recorded as `raise`), not derivable from the hand row -> the engine now records
  `cadence.all_in_showdown`.
- `05f7550e`: busted player all-in by blind+ante; engine hold 4750, grader 4250; real gap
  excess +159 ms graded +659 ms.
- 150 min, 22 graded cash busts in production: 0 over budget (the Backup's 2 of 12 are the
  rare blind/ante/call all-in shape; the Backup per-hand rows were not retained because the
  evidence step skips on failure).

## Proof

`python3 scripts/ci/test-hand-gap-watch.py` on PostgreSQL 16.15: 63/63 passed
(`test-hand-gap-watch-RESULTS.json`). Phase 5 measures the defect BEFORE the migration
(cash bust without an 'all_in' action: unintended 500 ms, 19/19 over budget; all-in winner
+500 ms) and AFTER it (0 ms both; recorded `all_in_showdown=false` stays a checked river at
0 ms; a real 800 ms delay after an all-in bust still grades 800 ms, 18/18 over budget).
Vitest laws: 1946/1946 across the 7 hand-gap/registry/backup-cert law files.
