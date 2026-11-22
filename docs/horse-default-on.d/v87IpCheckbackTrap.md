# v87IpCheckbackTrap (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87IpCheckbackTrap` with zero default-ON behavior change so IP dry-flop slowplay check-backs can be evaluated independently from preflop `v87HoldemOverhaul` and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts` not-facing-a-bet branch (3), when `isV87Nlh` and `opts.v87IpCheckbackTrap !== false`, on a dry flop (`wetness < 0.4`) in position heads-up with a non-QQ+ strong made hand (`cat >= 3`, excluding trips on a paired board, `!premiumLocked87`, and excluding pocket QQ/KK/AA), hero mixes a check-back trap at deterministic frequency `min(0.32, 0.15 + trapFrequency * 0.3)` via `v87SpotUnit('ipcheckback')` (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only hero's two hole cards, flop community cards (`wetness`, `cat`, `pairedBoard`, `premiumLocked87`), position, opponent count, deterministic `v87SpotUnit`, persona trap frequency, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87IpCheckbackTrap !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league grading of IP dry-flop slowplay check-backs without affecting V87 preflop ranges or any other postflop V87 branch.

## Continuation

Status: MET

Returns a check on the flop to disguise IP check-back range; turn and river value betting continue through the normal postflop value ladder. When `v87IpCheckbackTrap: false`, the hand proceeds immediately to the normal flop value betting line.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_ip_checkback_trap` on heads-up IP dry NLH flops with non-QQ+ sets/two-pair/straights/flushes inside the ~4,300 fires/day V87 postflop bundle. Wet flops, OOP, multiway, turn, and river spots are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board non-satellite heads-up IP dry flops (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipt `v87_ip_checkback_trap` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87IpCheckbackTrap` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87IpCheckbackTrap: false` isolates only branch (3) IP dry-flop check-back traps.
