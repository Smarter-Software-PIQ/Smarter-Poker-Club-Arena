# v87ComboDrawPump (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87ComboDrawPump` with zero default-ON behavior change so 12+ out flop combo-draw semi-bluff raising/jamming can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` facing-a-bet flop combo-draw pump, when `isV87Nlh` and `opts.v87ComboDrawPump !== false`, on the flop outside baseline HU semi-bluff ownership (`!ftRaiseOwned`) and `comboDrawPressure`, with `oppCount <= 2`, `potFrac <= 1.0`, `spr <= 7`, and `draw87.outs >= 12`, hero raises 80-100% pot (or jams if `spr <= 3.5` / V78-committing and `equity >= 0.44`) at deterministic `v87SpotUnit('combopump')` frequency (`(persona87?.comboDrawAggro ?? 0.55) * (ip ? 0.55 : 0.68)`) (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot, bet size, stack-to-pot ratio (`spr`), opponent count, hero's two hole cards and flop board (`draw87.outs`, `equity`), `ftRaiseOwned`, V78 commitment check, deterministic `v87SpotUnit`, persona `comboDrawAggro`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87ComboDrawPump !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league evaluation of flop combo-draw semi-bluff pumping without disabling preflop `v87HoldemOverhaul` ranges or any other postflop V87 rule.

## Continuation

Status: MET

Calls `planBarrel(equity)` before returning the semi-bluff raise, or legalizes `all_in` when committing with `>= 0.44` equity. When `v87ComboDrawPump: false`, the draw falls through cleanly to the standard semi-bluff / draw call pricing ladder below.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_combo_draw_raise` and `v87_combo_draw_jam` on single-board NLH flops with 12+ clean outs outside `flopTurnBluffBaseline` ownership. Turn, river, and non-combo hands are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`, `!multiBoard36`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipts `v87_combo_draw_raise` and `v87_combo_draw_jam` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87ComboDrawPump` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87ComboDrawPump: false` isolates only the V87 flop combo-draw semi-bluff pump.
