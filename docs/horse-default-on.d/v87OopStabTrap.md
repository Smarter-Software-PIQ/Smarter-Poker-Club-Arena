# v87OopStabTrap (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87OopStabTrap` with zero default-ON behavior change so OOP flop check-trapping into high-frequency stabbers can be evaluated independently from `v87FlopStabCheckRaise`, preflop `v87HoldemOverhaul`, and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branch (4), when `isV87Nlh` and `opts.v87OopStabTrap !== false`, out of position on the flop with `oppCount <= 2` and an observed high-frequency flop stabber (`anyStabber87`), hero checks strong non-Rule-3 top-pair+/two-pair+ hands or 12+ out combo draws at deterministic frequency `personaPost87?.trap ?? 0.42` via `v87SpotUnit('oopstabtrap')` to induce a stab (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only hero's two hole cards, flop board (`tptk87`, `cat`, `premiumLocked87`, `draw87.outs`), position, opponent count, observed public `streetBullyRead(...).highFlopStab`, deterministic `v87SpotUnit`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87OopStabTrap !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while cleanly separating the open-action check-trap induction from the facing-bet `v87FlopStabCheckRaise` response and from preflop `v87HoldemOverhaul` ranges.

## Continuation

Status: MET

Checking OOP hands action to the stabber; if the stabber bets, `v87FlopStabCheckRaise` (or normal facing-bet pricing) handles the check-raise or call response. When `v87OopStabTrap: false`, the hand falls through to the normal OOP flop betting/checking ladder.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_oop_stab_trap` on OOP NLH flops (`<= 2` opponents) when an opponent has a measured high-frequency flop-stab read inside the ~4,300 fires/day V87 postflop bundle.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite OOP flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_oop_stab_trap` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87OopStabTrap` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` umbrella ablation and `v87FlopStabCheckRaise` behavior unchanged. Setting `v87OopStabTrap: false` disables only branch (4) OOP check-trap induction.
