# A Bust In The Money Is Worth Its Place

2026-11-15. Hold'em Strategy lane, follow-up to production hand 59441335.
Engine source: `server/src/engine/IcmModel.ts` (`bubbleFactor`,
`pairwiseBubbleFactor`), `server/src/engine/HorseLogic.ts`
(`heroBubbleFactor`). No migration.

## Cause

`bubbleFactor` compares what a whole-stack risk wins with what it loses. The
losing side was read through `icmEquity`, which prices a zero stack at 0. A
player who busts in this hand still finishes in a place: behind every stack
that was live before it. In the money that place is paid, so the factor
charged a short stack every payout, including the one it collects anyway.

At hand 59441335 (nine left, 13 paid, the 2.1bb cutoff with 12,609 chips):
equity 5.10 pool points, 5.74 doubled through the covering stack, 4.34 (ninth
place) busted. The factor read 5, its cap ((5.10 - 0) / 0.64, capped); the
bust at its place gives (5.10 - 4.34) / 0.64 = 1.17.

`bubbleFactor` feeds `icmRisk` (the V16 survival premium the tournament
preflop and postflop layers read) and the payout-aware push/fold tables
(`heroBubbleFactor`). `pairwiseBubbleFactor`, which the Phase 7 arbiter and
the asymmetric cover read use for the covered opponent, had the same defect.

## The correction

A down state in which the player has no chips left is valued at the payout of
place `live` (the number of stacks above zero before the pot), 0 where that
place is unpaid. Every other state is priced by `icmEquity` as before. Both
factors share the one helper (`equityAfterPot`). The separate
`bustAwareBubbleFactor` that the 2026-11-15 push/fold change introduced is
removed: `bubbleFactor` is now that function.

## What changes

- Outside the money nothing changes: the bust place is unpaid and the factor
  is the same number, to the last digit (IcmModel.test.ts pins it).
- A risk that leaves chips behind is unchanged.
- In the money, a stack that can bust reads a lower factor. The V16 premium of
  the 2.1bb final-table stack falls from 0.14 (factor 5) to about 0.007
  (factor 1.17); the premium of a deep stack, which no single opponent can
  bust, is unchanged.
- The Phase 7 utility arbiter already valued a hero bust at its finishing
  place and is unchanged; only its covered-opponent fold read
  (`pairwiseBubbleFactor`) moves, in the money only.

## Tests

`IcmModel.test.ts` (final-table ladder: the short stack, every stack that can
bust, the pairwise factor, outside the money, a partial risk),
`HorseV16.test.ts` (icmRisk for the in-the-money short stack), and
`AShortStackJamPricesThePayJump.law.test.ts`, whose first case compared the
two factors and now holds `bubbleFactor` itself to the bust-at-its-place
value.
