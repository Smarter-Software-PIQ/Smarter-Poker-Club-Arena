# v87MultiwayWetAirCheck (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87MultiwayWetAirCheck` with zero default-ON behavior change so multiway wet-flop air checking can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branch (6), when `isV87Nlh` and `opts.v87MultiwayWetAirCheck !== false`, a preflop aggressor (`initiative === 'hero'`) facing two or more live opponents (`oppCount >= 2`) on a wet flop (`wetness >= 0.55`) with air (`cat <= 1`) and fewer than 8 clean outs (`draw87.outs < 8`) immediately checks instead of c-betting into a multiway wet field (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public street, preflop initiative, live opponent count, flop board wetness, hero's two hole cards (`cat`, `draw87.outs`), and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87MultiwayWetAirCheck !== false`. No opponent read or PRNG draw is consulted.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league grading of multiway wet-flop air checks without affecting preflop `v87HoldemOverhaul` ranges or any other postflop V87 rule.

## Continuation

Status: MET

Returns an immediate flop check so hero avoids spewing c-bets with equity-poor air into multiway wet textures; later streets proceed normally if checked through or facing a bet. When `v87MultiwayWetAirCheck: false`, the spot falls through to the standard c-bet ladder.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_multiway_wet_air_check` on multiway wet NLH flops with preflop initiative and draw-poor air inside the ~4,300 fires/day V87 postflop bundle. Heads-up pots, dry flops, turn, and river are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite multiway wet flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_multiway_wet_air_check` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87MultiwayWetAirCheck` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` umbrella ablation. Setting `v87MultiwayWetAirCheck: false` isolates only branch (6) multiway wet-flop air checks.
