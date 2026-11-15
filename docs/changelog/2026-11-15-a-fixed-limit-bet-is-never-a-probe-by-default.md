# A fixed-limit bet is never a probe, on by default (defect repair)

Fixed-Limit lane, 2026-11-15. The switch was built default off in #10930 (`2026-11-14-a-fixed-limit-bet-is-never-a-probe.md`); this change sets its source default on.

## The change

`FIXED_LIMIT_BETS_ARE_NEVER_PROBES_DEFAULT` in `server/src/engine/HorseMind.ts` is now `true`. In a hand whose betting structure is fixed limit (flh, flo8), `HorseMind.observe` counts no probe tally, so a fixed-limit bettor's bets stay whole in `betCheckedTo` and the maniac and aggressor reads can engage in fixed limit. Nothing else changes: no-limit and pot-limit counting is identical, T2 (`FIXED_LIMIT_RIVER_BETS_ARE_VALUE_EVIDENCE_DEFAULT`) stays false and every fixed-limit decide option from #10930 stays off. Engine only, no migration.

## Evidence

`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md`, the eight rows of `docs/HORSE-DECISION-CHANGE-EVIDENCE.md`: paired offline evaluation, F1 alone against a sustained maniac at six seats, validated river portion +17.03 +/- 5.54 (flh) and +72.24 +/- 14.59 (flo8) big bets per 100 hands; tight-value cells exactly 0; gear-changer cells +0.00 to +0.29; no cell harmed. Offline only; no person has played fixed limit since 2026-11-03.

## Hardening

`HorseDefaultOnNeedsEvidence.law.test.ts` now also fails a HorseMind process-switch source default of `true` (`export const <NAME>_DEFAULT = true`) without its evidence file; before, it saw only decide options read in HorseLogic, so a process switch could be turned on by default with no evidence.

## Rollback

`HorseMind.setFixedLimitBetsAreNeverProbes(false)` reproduces the old counting exactly (`AFixedLimitBetIsNeverAProbe.law.test.ts`); in production it is a source change back to `false`.
