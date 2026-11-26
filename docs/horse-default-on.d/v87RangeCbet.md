# v87RangeCbet (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87RangeCbet` with zero default-ON behavior change so Hold'em postflop range c-betting can be graded or ablated independently without disabling preflop `v87HoldemOverhaul` ranges or any other V87 postflop sub-rule.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet flop branch (7), when `isV87Nlh` and `opts.v87RangeCbet !== false`, a heads-up in-position preflop aggressor on a dry flop (`wetness < 0.42`, `cat <= 2`, `draw87.outs < 8`, `!premiumLocked87`, `equity < 0.62`, `exploit.bluffMod >= 0.9`, `useCbet10`) fires a 30-36% pot continuation bet on a deterministic `v87SpotUnit('rangecbet')` hash mix (`< 0.52` air / `0.58` weak pair, scaled by `personaPost87?.cbet`), while deferring to calling stations, low fold-to-cbet reads (`< 0.35`), and `flopTurnBluffEligibility` (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public board wetness, hero's two hole cards and hand category/outs, position, preflop initiative, opponent count, V10 c-bet option, observed station/fold-to-cbet reads when `useMind` is enabled, deterministic `v87SpotUnit`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87RangeCbet !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while cleanly decoupling the highest-volume V87 postflop rule from the `v87HoldemOverhaul` umbrella so future single-rule shadow/league grading can measure `v87RangeCbet` against direct V38 / priced replacements without touching preflop VPIP or any other V87 rule.

## Continuation

Status: MET

Calls `planBarrel(equity)` before returning the 30-36% pot `betSize` decision so turn/river continuation plans remain synchronized. When `v87RangeCbet: false`, the decision falls through cleanly to the standard flop c-bet / V38 ladder with zero PRNG shift.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): `v87_range_cbet` is the primary postflop contributor inside the ~4,300 fires/day `v87HoldemOverhaul` telemetry bundle on heads-up IP dry flops. Multiway pots, wet flops, turn, and river are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em heads-up IP dry flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`, single-board, non-satellite). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and are byte-identical regardless of flag state.

## Visibility

Status: MET

Emits telemetry receipt `v87_range_cbet` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87RangeCbet` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation for historical frozen-digest corpora. Setting `v87RangeCbet: false` disables only branch (7) range c-betting and leaves all other V87 preflop and postflop sub-rules unchanged.
