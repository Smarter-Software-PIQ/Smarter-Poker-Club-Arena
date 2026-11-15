# A fixed-limit read is never probe-discounted (F1b), and the fixed-limit fixes key on the betting structure

Fixed-Limit lane, 2026-11-15. Follows the default-on of FIXED-LIMIT BETS ARE NEVER PROBES (#10964, `2026-11-15-a-fixed-limit-bet-is-never-a-probe-by-default.md`).

## The change

- Read time (F1b). The probe tallies are pooled per player across games; with the switch on they hold only his no-limit and pot-limit bets, but every read still applied that share, so a no-limit prober's fixed-limit `betCheckedTo` was cut by his no-limit probe share. Now, under the same process switch (`HorseMind.setFixedLimitBetsAreNeverProbes`, source default on), a decision whose betting structure is fixed limit takes no probe discount in `opponentRead`, `omahaTightReadOf`, `styleRead` or `streetBullyRead`, and `fixed_limit_read_probe_discount_withheld` receipts each withholding. No-limit and pot-limit reads are byte-identical.
- The structure, not the variant name. `HorseLogic.prepareOriginalReads` hands the state's `bettingStructure` to `HorseMind.setDecisionBettingStructure`; F1b and the fixed-limit Omaha presumption option (`fixedLimitOmahaNoPresumption`, still default off) read `HorseMind.decisionBettingStructure()` instead of `bettingStructureFor(variant)`. In production the worker requires the state's structure to equal `bettingStructureFor(gameVariant)`, so this is the same value there; it matters for flo4/flo5/flo6 (#10865, open), which every fixed-limit fix now reaches through the structure alone.

## Tests

`AFixedLimitReadIsNeverProbeDiscounted.law.test.ts` (read time, flh, flo8 and plo4 with fixed-limit betting; off reproduces the discounted read; no-limit and pot-limit identical on and off) and `AFixedLimitFixKeysOnTheBettingStructure.law.test.ts` (F2 and F3 engage on a real four-card fixed-limit Omaha table shown as plo4 / plo8 card rules; a real pot-limit plo4 table never engages F2).

## Evidence and rollback

`docs/horse-default-on.d/fixedLimitBetsAreNeverProbes.md` amended (Mechanism, Reach, Scope, Visibility, Limits, OFF contract). F1b's Horse-against-Horse reach in production is not measured. Rollback: as for the switch (release rollback or source default `false`); `setFixedLimitBetsAreNeverProbes(false)` restores the discounted read. Engine only, no migration.
