# A fixed-limit bet is never a probe, on by default (defect repair)

Fixed-Limit lane, 2026-11-15. The switch was built default off in #10930 (`2026-11-14-a-fixed-limit-bet-is-never-a-probe.md`); this change sets its source default on.

## The change

`FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT` in `server/src/engine/HorseMind.ts` is now `true`. In a hand whose betting structure is fixed limit (flh, flo8), `HorseMind.observe` counts no probe tally, so a fixed-limit bettor's bets stay whole in `betCheckedTo` and the maniac and aggressor reads can engage in fixed limit. Nothing else changes: no-limit and pot-limit counting is identical, T2 (`FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT`) stays false and every fixed-limit decide option from #10930 stays off. Engine only, no migration.

## Evidence

`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md`, the eight rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`: paired offline evaluation, F1 alone against a sustained maniac at six seats, validated river portion +17.03 +/- 5.54 (flh) and +72.24 +/- 14.59 (flo8) big bets per 100 hands; tight-value cells exactly 0; gear-changer cells +0.00 to +0.29; no cell harmed. The three cells asked for before serving: F1 alone against Horse opponents changes nothing (flh 0 of 4,487 deals, flo8 1 of 1,929, both +0.00 +/- 0.00); flh nine seats against a sustained maniac +3.36 +/- 3.77 validated (+18.19 +/- 9.33 total); flh tournament table +24.57 +/- 7.18 validated. Offline only; no person has played fixed limit since 2026-11-03.

## Hardening

`HorseDefaultOnNeedsEvidence.law.test.ts` now also fails a HorseMind process-switch source default of `true` (`export const <NAME>_DEFAULT = true`) without its evidence file; before, it saw only decide options read in HorseLogic, so a process switch could be turned on by default with no evidence.

## Rollback

No runtime switch in production (owner 23:10: no new process-level switches). OFF is a release rollback or a source change back to `false`, effective at the release restart; `HorseMind.setFixedLimitBetsAreNeverProbes(false)` is for tests, the harness and replay and reproduces the old counting exactly (`AFixedLimitBetIsNeverAProbe.law.test.ts`). Nothing persists: the probe tallies are decision-worker memory only and the boot replay recounts with the booting release's value. Full contract: the evidence file, "OFF and rollback contract".
