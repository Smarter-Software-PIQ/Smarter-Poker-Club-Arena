# omahaBigBetIsPotShare (PLO Strategy lane 2026-11-15; branch agent/plo-rivercall-01BbZPDi/fix/omaha-river-medium-bet-strong-hand-calls, pull request not yet opened)

Off by default (read `=== true`). This file records the evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md) as they stand; the option stays off until its declared evaluation passes.

## Mechanism

Status: MET

The range read (`HorseMind.ts`, the band read) sets `bigBet` on an opponent's read when his wager on the newest street is 20 big blinds or more, whatever share of the pot it is. `omahaAggressorTier` (`HorseEval.ts`) adds a tier when `lastFrac >= 0.7 || bigBet`, so in a large pot a half-pot bet is tiered as a pot-sized one and `omahaTierRequirement` samples the bettor as 81 to 88 percent trips, straights or full houses on the river. On the eleven recorded river folds to 50 to 58 percent bets (archive `plo-handoff-review-01a1cbbd/rivercall-20261115/SPOT-TABLE.md`) the equity used was 6 to 26 percent against a price of 25 to 27.

With the option on, in PLO4 / PLO5 cash (high only), when the decision is on the turn or river and an opponent's newest wager is on that street, carries the mark and is under 0.7 of the pot it went into (`lastFrac`, the read's own number), the decision sets `tierByPotShare` on that read and `omahaAggressorTier` does not count the mark. 0.7 is the tier's own existing pot-share line and is used on both streets, so no new threshold is introduced; the flop keeps the mark (no evidence there, and flop ranges are tiered with draws standing in).

Readers of the mark and what happens to each:

- `HorseEval.ts` `omahaAggressorTier`: CHANGED (this option).
- `HorseLogic.ts` V56 (`omahaAggressorTier(read) === 3` sets `strictPressureRange` for weak trips): follows the tier; a weak-trips hand facing a line that is no longer tier 3 is no longer held to the strict range. Not separately gated.
- `HorseEval.ts` `v62SizeClass` (the hold'em river model), the sampler's non-tier contact branch (`wantCat`, `pStrong`, `tries` from `bigBet`), the range-consumption receipt's `bigBetMask`: unchanged, they read `bigBet`, which is not touched.
- `HorseLogic.ts`: the `v16SizeCond` and V86 maniac strips of `bigBet`, the `v16_sizecond_bigbet` receipt, the per-board reads of multi-board pots (`bigBet` copied): unchanged.
- `HorseRangeConsumptionReceipt.ts` (records `bigBet`): unchanged; it does not record `tierByPotShare`, so a replay from that receipt alone would recompute the old tier input.
- `HorseMind.ts` `range_read_big_bet_counted` receipt: unchanged.

## Input fidelity

Status: NOT MET

As for `omahaRiverMediumBetStrongHandCalls`: recorded public nodes and the Horses' own cards; the opponent memory supplied by hand from a read an hour after the session.

## Value

Status: NOT MET

Not measured. On the eleven recorded folds, with only this option on: against an unknown bettor four become calls on every seed (one best hand +179 chips; three beaten two pairs -528); with the bettor's memory rows five do. That sample is negative for the two pairs it frees and does not reach the sets and trips, whose tier comes from the second and third betting street.

## Continuation

Status: NOT MET

The tier feeds every Omaha turn and river equity read, including bets and raises; what follows was not measured.

## Reach

Status: NOT MET

Not counted in production.

## Scope

Status: MET

PLO4 and PLO5, cash, high only, turn and river decisions, single-board sampling (multi-board pots use the legacy contact read). Decision-level cases in `HorseOmahaBigBetIsPotShare.test.ts`.

## Visibility

Status: MET

Receipt `omaha_big_bet_by_pot_share` in `HorseDataLedger.ts`.

## Limits

Status: MET

- It removes one of the three size-blind steps. Two or three betting streets still raise the tier whatever the sizes, and the paired-board fold is untouched.
- It changes the equity every turn and river decision reads, not only calls facing a bet.
- Live behaviour is unverified: the option is off.
