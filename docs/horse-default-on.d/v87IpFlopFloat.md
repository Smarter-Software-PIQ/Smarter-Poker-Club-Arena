# v87IpFlopFloat (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87IpFlopFloat` with zero default-ON behavior change so IP flop floating against high-stab/turn-give-up opponents can be evaluated independently from preflop `v87HoldemOverhaul`, `v87TurnTakeaway`, and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` facing-a-bet IP flop float site, when `isV87Nlh` and `opts.v87IpFlopFloat !== false`, on a single-board flop in position with `oppCount <= 2`, `!raisedAfterAggr`, facing `potFrac <= 0.55` from an opponent with observed `bully87?.highFlopStab === true || bully87?.turnGiveUp === true`, air (`cat <= 1`) holding `draw87.outs >= 4 || draw87.overcardsAndBdfd` calls to float in position (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot, bet size (`potFrac`), position, opponent count, hero's two hole cards and flop board (`cat`, `draw87.outs`, `draw87.overcardsAndBdfd`), observed `HorseMind.streetBullyRead` (`highFlopStab`/`turnGiveUp`), and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87IpFlopFloat !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league grading of IP flop floats without disabling preflop `v87HoldemOverhaul`, `v87TurnTakeaway`, or any other postflop V87 rule.

## Continuation

Status: MET

Returns an in-position flop call; if the stabber checks the turn, `v87TurnTakeaway` (or normal turn probe pricing) handles the turn continuation. When `v87IpFlopFloat: false`, the spot falls through cleanly to standard V32/V38 flop call pricing.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_ip_flop_float` on IP single-board NLH flops facing small stabs (`<= 55%` pot) from high-stab or turn-give-up opponents. OOP, turn, river, and large-bet spots are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board IP flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`, `!multiBoard36`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_ip_flop_float` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87IpFlopFloat` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87IpFlopFloat: false` isolates only the IP flop float call.
