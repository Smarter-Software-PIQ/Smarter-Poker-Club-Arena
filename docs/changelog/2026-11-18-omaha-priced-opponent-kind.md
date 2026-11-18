# Omaha priced rules: every opponent priced on his own kind's prior; the re-raise counted once; unpriceable spots fall closed

Date: 2026-11-18. Lane: PLO Strategy (priced2). Follows docs/changelog/2026-11-17-omaha-priced-rules.md. All ten options stay default OFF; nothing is switched.

## Why

All nine priced families switched on together lost 6 to 8 bb/100 at Horse-only tables (v3 Horse-only -7.79 +/- 0.86). A leave-one-out, pairwise and mechanism diagnosis on a protocol written before the runs (archive plo-handoff-review-01a1cbbd/priced-01BNteGZ/PASS-BAR-v4-allon-diagnosis.md, result ALLON-DIAGNOSIS-20261118.md) found the cause: with `omahaFacingBetRangeIsContinuous` on, the bluff prior was the one measured on PERSONS' bets, and `omahaBluffShareFromBetRate` then scaled it by a factor that divided a posterior shrunk toward the HORSE mean by a person's rate, with a stated exponent 1.5. At a Horse-only table every bettor is a Horse. Holding that factor at 1 removed the loss (-0.92 +/- 0.95 against -6.32 +/- 1.91, same seeds).

## What changed (HorseOmahaPricedMode.ts, HorseOmahaPricedRules.ts, HorseOmahaPricedWiring.ts, HorseOmahaFacingBetEv.ts)

- `omahaOpponentKindOf`: a seat is a person or a Horse by `gs.humanUserIds` (the engine's roster of persons), else by its `is_horse` flag; unknown keeps the merged prior.
- `omahaPricedKindPrior` (the one owner of every prior a priced comparison assumes): per kind, the facing-bet bluff table, the bet and fold rates by street and over all streets, the card-impact bluff share and the bet-rate elasticity. The Horse figures are MEASURED on the same production window and method as the person figures (5,379 PLO4/PLO5 cash hands with a person seated, 2026-11-13 19:40Z to 2026-11-17 19:40Z): Horse bettors' heads-up turn bets hold 0.14 to 0.17 bluffs against a person's 0.30 to 0.43, their 70-110% river bets 0.128 against 0.294; the bet-rate elasticity is -0.2 +/- 1.0 for Horses (113 bettors) and +0.72 +/- 0.95 for persons (10), shrunk toward 0 to -0.10 and 0.38 (the stated 1.5 had no measurement). Archive plo-handoff-review-01a1cbbd/priced2-013U37/calib.
- `omahaPricedRecentred`, `omahaPricedKindBetRate`, `omahaPricedBluffReferenceRatio`: each posterior is re-centred on the kind's prior before it is read against the kind's reference rate, so a player with no opportunity reads exactly his kind's prior (continuous at zero; review N2, N3) and nobody is read against another population's rate.
- The priced read (`omahaPricedRead`, through `omahaPricedReadOfUser`), the card-impact read and the facing-bet read carry the kind; the continuous facing-bet range takes the bettor's kind's bluff table.
- Review N1: `omahaPricedRaiseAloneEv` counts the re-raising top of his range once (before, its losses were charged twice and value raises were under-priced).
- Review N4: where a comparison cannot price a spot at all (a sampled comparison with three or more opponents or one all in, a hand that cannot be counted, a spot outside the card-impact model), the categorical rule acts as with the option off, beside the family's `_unpriced_kept` receipt (new: `omaha_priced_pressure_unpriced_kept`). The big-bet cells decide there instead of the decision falling through unchanged. The no-blanket-rule law admits a categorical receipt only beside that receipt.

## Tests

HorseOmahaPricedKindPrior.test.ts (new): kind detection; each kind's table; every read exactly the kind prior at zero opportunities and continuous after; a Horse at the Horse mean reads 1; the elasticities; the card-impact read; a whole facing-bet decision on the Horse table for a Horse bettor and the person table for a person, through the spot, the verdict and HorseLogic.decide; the re-raise counted once (the reviewer's example); a draw raise into three players falls closed. HorseOmahaPricedRulesRecorded.test.ts re-pinned on purpose: 16 configuration entries of 9 recorded production decisions move (five made-hand calls or folds become value raises, N1; one Horse-bettor river call with a low flush becomes a fold, Horse prior; one turn semi-bluff raise with the nut-flush draw; one OOP turn jam where the card-impact model cannot price becomes the old rule's check, N4; one paired-board river check becomes a bet against a person, card-impact person prior). HorseOmahaNoBlanketRule.law.test.ts: the fall-closed exception.

## Evaluation

Protocol written before the runs: archive priced2-013U37/PASS-BAR.md (replay on the audited decisions; league for omahaTurnRiverRaiseIsPriced alone and all nine; omahaPricedMix retried last). The v2 single-family verdicts were measured on the #11212 source and are not carried over. Results are recorded in the option authority files when they exist.
