# PLO6: the six-card port of the Omaha strategy options is written (gate still off-only)

2026-11-16, PLO6 lane.

## What changed

The PLO4/PLO5 strategy options of 2026-11-15 now have their six-card branches: re-raised pots, the underpair rule, the facing-bet EV rule (river only for six cards), the river medium-bet call, the river-plan and street-plan folds, the strong-hand class and the validator admission. Five options are excluded from PLO6 outright. The list, file by file, is in `docs/horse-option-authority.d/omahaStrategyInPlo6.md`.

## What did not change

Nothing a player can see. Every new branch is reached only when `omahaStrategyInPlo6` is on for the decision, and that option is registered OFF-ONLY: no switch row can turn it on. With it off, PLO4, PLO5 and PLO6 decide exactly as before. No option-switch list or migration change; one ledger receipt added.

## Why

Owner orders of 2026-11-15 (13:37 and 15:42 America/Chicago) and 21:34: bring the PLO Strategy work to PLO6 and build what is unfinished. The gate stays held until PLO Strategy and Hand Analysis have reviewed the port and the owed items in the authority file are closed.

## Checks

Server tsc 0. 104 test files, 2,824 tests passed, 4 skipped (every Omaha, PLO, PLO6, phase digest, reference source, ledger, switch-law and receipt-validation file).
