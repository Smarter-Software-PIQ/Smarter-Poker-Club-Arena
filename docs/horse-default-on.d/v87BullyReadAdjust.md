# v87BullyReadAdjust (#10471)

Originally shipped on by default on 2026-11-10 in #10471 under `v87HoldemOverhaul` (`docs/changelog/2026-11-10-holdem-cash-and-tournament-elite-strategy.md`), and split onto its own independent default-ON sub-flag `v87BullyReadAdjust` with zero default-ON behavior change so the three postflop V87 anti-LAG/bully read modifiers can be evaluated independently from preflop `v87HoldemOverhaul` and every other V87 postflop rule.

## Mechanism

Status: MET

In `HorseLogic.ts`, when `v87NlhManiac`/`isV87Nlh` and `opts.v87BullyReadAdjust !== false`: (a) inside `maniacCallDown`, a flop stabber with `bullyRead87?.turnGiveUp` has call-down `betRate` decayed (`* 0.65` turn, `* 0.35` river) because later barrels are polarized; (b) inside V79/V80 top-pair equity capping (`cap80`), strong-kicker top pair facing an observed sustained LAG bettor (`lag87 && !bully87?.turnGiveUp`) raises `cap80` by `+0.05` (`V79_CAP + 0.05`); (c) inside V53 facing-bet pressure (`pressure53`), 3-way flop/turn pressure (`oppCount === 2`) is enabled when facing an observed LAG or high-frequency flop stabber (`lag87 || bully87?.highFlopStab === true`) (`AV87HoldemOverhaulSplitIsExact.law.test.ts`).

## Input fidelity

Status: MET

Reads only public observed `HorseMind.streetBullyRead` / `HorseMind.isLagBully` when `useMind` is active, street, opponent count, V79/V80 hand classification, and boolean flags `opts.v87HoldemOverhaul !== false` and `opts.v87BullyReadAdjust !== false`. Consumes zero `fastRandom()` draws.

## Value

Status: MET

Preserves 100% bit-identical default-ON production behavior from #10471 while allowing isolated counterfactual and league evaluation of the postflop anti-bully read modifiers without affecting preflop `v87HoldemOverhaul`, `v80TopPairStrongKicker`, `v53Pressure`, or any other V87 postflop branch.

## Continuation

Status: MET

Each modifier feeds directly into its existing downstream owner (`maniacCallDown`, V80 `eq15` cap, V53 `pressure53` raise/call pricing). When `v87BullyReadAdjust: false`, all three sites revert cleanly to their exact baseline `maniacCallDown`, V80 `V79_CAP`, and heads-up-only V53 behavior.

## Reach

Status: MET

Active only on two-card NLH postflop spots where `useMind` supplies an observed LAG or high-flop-stab/turn-give-up opponent read. Unread opponents, preflop spots, and non-LAG tables are untouched.

## Scope

Status: MET

Two-card no-limit Hold'em postflop facing-a-bet spots (`!vi.isOmaha && !vi.isShortDeck && !vi.isFixedLimit && vi.holeCount === 2`). PLO4, PLO5, PLO6, and all Omaha variants are excluded by `isV87Nlh`/`v87NlhManiac` and remain byte-identical.

## Visibility

Status: MET

Feeds existing `v80_top_pair_strong_kicker` and V53 pressure telemetry keys (`HorseDataLedger.ts`). Registered in `HORSE_DATA_LEDGER` as flag `v87BullyReadAdjust` and held in `OPTION_SWITCH_REFUSED` pending a dedicated SQL switch registration migration.

## Limits

Status: MET

This split introduces zero default-ON behavior change and preserves `v87HoldemOverhaul: false` full-umbrella ablation. Setting `v87BullyReadAdjust: false` isolates only the three postflop bully-read modifier sites.
