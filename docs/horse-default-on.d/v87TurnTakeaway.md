# v87TurnTakeaway (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87TurnTakeaway` with zero default-ON behavior change so IP turn takeaway probes can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branch (5), when `isV87Nlh` and `opts.v87TurnTakeaway !== false`, on the turn in position heads-up against a live opponent whose `bully87?.checkedTurnAfterFlopStab === true`, hero fires a 62-72% pot bet on deterministic `v87SpotUnit('turntakeaway')` (`< min(0.9, (0.55 + probeRate * 0.6) * stabScale)`) (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public action history (`checkedTurnAfterFlopStab` via `HorseMind.streetBullyRead`), position, street, live opponent stack, deterministic `v87SpotUnit`, persona probe scale, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87TurnTakeaway !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league grading of the turn takeaway stab without cross-disabling V87 preflop ranges or any other postflop V87 rule.

## Continuation

Status: MET

Calls `planBarrel(equity)` before returning the 62-72% pot `betSize` decision so river follow-through plans stay coherent. When `v87TurnTakeaway: false`, the spot falls through cleanly to standard turn probe / V38 evaluation.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_turn_takeaway` on heads-up IP NLH turns where a flop stabber checks turn inside the ~4,300 fires/day V87 postflop bundle. Flop, river, OOP, and multiway pots are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite heads-up IP turn spots (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_turn_takeaway` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87TurnTakeaway` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87TurnTakeaway: false` isolates only branch (5) turn takeaway betting.
