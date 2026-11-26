# v87RiverBlockerBluffRaise (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87RiverBlockerBluffRaise` with zero default-ON behavior change so river nut-blocker bluff-raising can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` facing-a-bet river nut-blocker bluff-raise site, when `isV87Nlh` and `opts.v87RiverBlockerBluffRaise !== false`, heads-up on the river with `useMind`, air (`cat > 0 && cat <= 1`, never one pair per V64), strong nut blockers (`blocker87 >= 0.65`), `potFrac <= 0.8`, against an observed non-station bettor whose `riverFoldRate >= 0.38`, hero bluff-raises 75% pot (only when non-committing per V78) at deterministic `v87SpotUnit('v64blockerraise')` frequency `0.08 + riverBluffGear * 0.07` (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot, bet size, hero's two hole cards and river board (`cat`, `blocker87`), observed non-presumed `HorseMind.opponentRead`/`riverFoldRate`, V78 commitment check, deterministic `v87SpotUnit`, persona `riverBluffGear`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87RiverBlockerBluffRaise !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league evaluation of river nut-blocker bluff-raising without disabling preflop `v87HoldemOverhaul` ranges or any other postflop V87 rule.

## Continuation

Status: MET

Sets `riverBluffDeclaredPending = true` and returns the 75% pot raise on river; when the raise would commit per V78 or the hash misses, hero falls through to the standard river fold/call decision. When `v87RiverBlockerBluffRaise: false`, the hand falls through immediately to normal river fold/call evaluation.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_river_blocker_bluff_raise` on heads-up single-board NLH rivers with air + nut blockers against observed folding bettors. Flop, turn, multiway, and non-air hands are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board heads-up rivers (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`, `!multiBoard36`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_river_blocker_bluff_raise` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87RiverBlockerBluffRaise` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87RiverBlockerBluffRaise: false` isolates only the V64-safe river nut-blocker bluff-raise.
