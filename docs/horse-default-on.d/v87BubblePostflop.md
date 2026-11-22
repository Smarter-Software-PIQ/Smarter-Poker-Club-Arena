# v87BubblePostflop (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87BubblePostflop` with zero default-ON behavior change so tournament bubble/ITM postflop ICM overlays can be evaluated independently from preflop `v87HoldemOverhaul` and cash V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branches (1) and (9), when `isV87Nlh` and `opts.v87BubblePostflop !== false` in a near-bubble or in-the-money tournament (`bubble87`): (1) a covered 15-45bb medium stack checks back bare non-Rule-3 one pair on wet turns/rivers (`wetness >= 0.45`); (9) a covering stack facing covered 15-45bb stacks fires extra 50-62% turn/river pressure at 12% deterministic frequency via `v87SpotUnit('bubblecover')` (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public tournament bubble/ITM state (`trustedTournament ?? gs.tournament`), public stack depths in big blinds, board wetness, hand category, `dangered`, `equity`, deterministic `v87SpotUnit`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87BubblePostflop !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while cleanly isolating tournament bubble/ITM postflop overrides from cash V87 postflop rules and from preflop `v87HoldemOverhaul`.

## Continuation

Status: MET

Branch (1) returns a turn/river pot-control check; branch (9) calls `planBarrel(equity)` before returning a 50-62% pot pressure bet. When `v87BubblePostflop: false`, both spots fall through cleanly to standard tournament postflop evaluation.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_bubble_covered_pot_control` and `v87_bubble_cover_pressure` exclusively in near-bubble/ITM NLH tournaments inside the ~4,300 fires/day V87 postflop bundle. Cash and Lightning tables never enter it.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite tournament turn/river spots near the bubble or in the money (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). Cash games, PLO4, PLO5, PLO6, and all Omaha variants are completely unaffected.

## Visibility

Status: MET

Emits telemetry receipts `v87_bubble_covered_pot_control` and `v87_bubble_cover_pressure` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87BubblePostflop` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` umbrella ablation. Setting `v87BubblePostflop: false` isolates only branches (1) and (9) tournament bubble/ITM postflop adjustments.
