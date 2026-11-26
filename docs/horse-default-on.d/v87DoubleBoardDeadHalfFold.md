# v87DoubleBoardDeadHalfFold (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87DoubleBoardDeadHalfFold` with zero default-ON behavior change so NLH double-board dead-half turn/river folding can be evaluated independently from preflop `v87HoldemOverhaul` and single-board V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` facing-a-bet double-board guard, when `isV87Nlh` and `opts.v87DoubleBoardDeadHalfFold !== false`, on a multi-board (`multiBoard36`) turn or river facing `>= 60%` pot pressure (`potFrac87 >= 0.6`), if hero holds one pair or worse (`cat <= 2`) on at least one board, has no locked board (`lockShare36 === 0`), and holds no strong (`cat >= 5 && boardEq >= 0.78`) other board, hero folds instead of donating for half the pot at best (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public multi-board community cards, pot, wager size (`toCall`), hero's two hole cards (`bestTwoCardCategory`, `boardEq36`, `lockShare36`), street, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87DoubleBoardDeadHalfFold !== false`. No opponent read or PRNG draw is consulted.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while cleanly isolating NLH multi-board dead-half folding from single-board Hold'em postflop rules and preflop `v87HoldemOverhaul`.

## Continuation

Status: MET

Returns an immediate fold on turn/river dead-half spots; hands with a locked board or strong scoop equity fall through to V36 freeroll/split-pot equity pricing. When `v87DoubleBoardDeadHalfFold: false`, the spot falls through cleanly to standard multi-board equity call pricing.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_double_board_dead_half_fold` exclusively on NLH double/multi-board bomb-pot turn and river spots facing 60%+ pot pressure. Single-board tables never enter it.

## Scope

Status: MET

Two-card no-limit Hold'em multi-board turn/river spots (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). Single-board Hold'em, PLO4, PLO5, PLO6, and all Omaha variants are excluded and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_double_board_dead_half_fold` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87DoubleBoardDeadHalfFold` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87DoubleBoardDeadHalfFold: false` isolates only the NLH double-board dead-half turn/river fold.
