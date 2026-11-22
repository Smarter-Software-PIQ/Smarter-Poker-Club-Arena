# v87LowSprCommit (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87LowSprCommit` with zero default-ON behavior change so low-SPR commitment betting can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branch (2), when `isV87Nlh` and `opts.v87LowSprCommit !== false`, on flop or turn with `initiative !== 'opp'`, `spr <= 3.5`, live opponents, `!dominated21`, and TPTK/overpair, real two-pair+, or a 12+ out flop combo draw, hero shoves at `spr <= 1.3` or bets 55-75% pot using deterministic `v87SpotUnit('lowspr')` (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot, effective stack-to-pot ratio (`spr`), street, initiative, hero's two hole cards and community cards (`tptk87`, `cat`, `draw87.outs`, `dominated21`), deterministic `v87SpotUnit`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87LowSprCommit !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league evaluation of low-SPR commitment betting without disabling V87 preflop ranges or any other postflop V87 branch.

## Continuation

Status: MET

Commits directly via `legalize(all_in)` at `spr <= 1.3` or returns a 55-75% pot sizing that sets up an easy turn/river stack-off. When `v87LowSprCommit: false`, the hand falls through to the standard postflop value/SPR ladder below.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_low_spr_commit` on 3-bet and 4-bet NLH flop/turn pots with `spr <= 3.5` inside the ~4,300 fires/day V87 postflop bundle. River spots and deep-SPR (`> 3.5`) pots are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite flop/turn open-action spots (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_low_spr_commit` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87LowSprCommit` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and retains `v87HoldemOverhaul: false` umbrella compatibility for historical corpora. Setting `v87LowSprCommit: false` isolates only branch (2) low-SPR commitment betting.
