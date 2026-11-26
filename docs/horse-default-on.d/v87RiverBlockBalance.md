# v87RiverBlockBalance (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87RiverBlockBalance` with zero default-ON behavior change so the non-trap Ecosystem #1 river block-bet balance rules can be evaluated independently from `v87RiverBlockBetTrap`, preflop `v87HoldemOverhaul`, and other V87 postflop rules.

## Mechanism

Status: MET

In `HorseLogic.ts`, when `isV87Nlh` (or `v87NlhManiac`) and `opts.v87RiverBlockBalance !== false`: (a) OOP heads-up river branch (8) checks fragile one-pair hands (`cat === 2 && equity < 0.62 + mw`) instead of block-betting into a LAG bully (`v87_river_block_lag_check`); (b) OOP heads-up air with nut blockers (`blocker87 >= 0.5`) against a non-station fires a 28-33% river block-bet bluff at deterministic `v87SpotUnit('riverblockbluff')` frequency (`v87_river_block_blocker_bluff`); (c) when hero's small river block-bet is raised `>= 0.3` pot and `v67RiverBetRaisedOnePair` is enabled, bare one-pair folds (`v87_river_block_raised_one_pair_fold`) and `maniacCallDown` refuses to auto-call over the raise (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public pot, bet/raise sizing, hero's two hole cards and river board (`cat`, `equity`, `blocker87`, `pairedBoard`), action history (`v87HeroRiverBlockBetFrac`), observed LAG/station reads when `useMind` is on, deterministic `v87SpotUnit`, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87RiverBlockBalance !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while cleanly separating the non-trap river block-bet balance rules from `v87RiverBlockBetTrap` (nut-trap lead and trap-reraise) and from the preflop `v87HoldemOverhaul` umbrella.

## Continuation

Status: MET

The LAG check returns a river check; the block-bet bluff sets `riverBluffDeclaredPending = true` and `pendingRaisePlan = 'foldToRaise'`; the raised-block one-pair fold returns a river fold. When `v87RiverBlockBalance: false`, all three sites fall through cleanly to standard river value/bluff/V67 pricing while `v87RiverBlockBetTrap` remains independently controlled.

## Reach

Status: MET

Live production telemetry (`public.horse_brain_telemetry`, 2026-11-19..21): fires as `v87_river_block_lag_check`, `v87_river_block_blocker_bluff`, and `v87_river_block_raised_one_pair_fold` on heads-up OOP NLH rivers. Flop, turn, and IP spots are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em single-board rivers (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && !vi.isHiLo && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh`/`v87NlhManiac` and remain byte-identical.

## Visibility

Status: MET

Emits telemetry receipts `v87_river_block_lag_check`, `v87_river_block_blocker_bluff`, and `v87_river_block_raised_one_pair_fold` (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87RiverBlockBalance` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change, does not alter `v87RiverBlockBetTrap` or `v67RiverBetRaisedOnePair`, and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87RiverBlockBalance: false` isolates only the non-trap river block-bet balance rules.
