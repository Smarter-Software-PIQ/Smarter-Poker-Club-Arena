# omahaFacingBetRangeIsContinuous: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash, the facing-bet expected value (turn and river): the bet share of the pot is a continuous input to the bettor range and to the price. The value-share and bluff-prior tables are interpolated between the centres of their size rows; the line overrides of #11135 and #11183 are weights that grow with the size; the two turn realization caps and the small-bet margin cap are continuous in the size. The bluff prior is the MEASURED one (`OMAHA_PRICED_MEASURED_BLUFF`, HorseOmahaPricedMode.ts): fitted so the comparison predicts the share the Horse actually won against the real cards of 995 heads-up turn and river bets by persons (2026-11-13 to 2026-11-17, every player cards from the hand facts, no showdown selection), shrunk toward the stepped prior by its 8 pseudo-bets. The stepped prior under-predicted the Horse win share at the sizes people bet most (river 40-110 percent: 0.20-0.22 predicted, 0.29 won, n 294; turn 70-110: 0.27 predicted, 0.34 won, n 337).

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaFacingBetRangeIsContinuous docs/horse-option-authority.d/omahaFacingBetRangeIsContinuous.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaBetSizeBucket` and the stepped tables (`HorseOmahaFacingBetEv.ts`, value share 0.50 to 0.38 at 40 percent of the pot on the turn), the size-triggered overrides in `omahaFacingBetEvSpot` (paired-river lead at 40 percent, multiway paired river at 25 percent, raised barrel at 70 percent, the capped all-in) and the realization caps in `omahaFacingBetEvVerdict` (0.42 from 40 percent on a paired turn, 0.65 from 70 percent) and the margin cap under 10 percent (audit rows 15, 17, 18, 19).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

`omahaPricedBySize`, `omahaPricedFacingRange`, `omahaPricedRealizationCap` (HorseOmahaPricedMode.ts). Each override keeps its knowledge as a range input: the same line and texture conditions, with the size as a weight from 0 to 1 across the old line.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_facing_inputs_changed_to_call, \_changed_to_fold (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Follow-up of 2026-11-18 (priced2: opponent kind, review notes N1-N4)

Every opponent figure a priced comparison reads now comes from his own KIND's prior (`omahaPricedKindPrior`, HorseOmahaPricedMode.ts; kind from `gs.humanUserIds`, else the seat's `is_horse`): a Horse is never priced on a person's bluff table, bet rate, fold rate or reference rate, nor a person on a Horse's. Each posterior is re-centred on that prior, so a player with no opportunity reads exactly it (no step at the first opportunity). The Horse figures are measured on the same 5,379-hand production window as the person figures (archive plo-handoff-review-01a1cbbd/priced2-013U37/calib). Where the comparison cannot price a spot at all, the categorical rule acts there as with the option off, beside the `_unpriced_kept` receipt (it no longer falls open). Cause and measurements: archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md. Evaluation protocol of this source: archive priced2-013U37/PASS-BAR.md. The v2 verdict below was measured on the #11212 source and is NOT carried over to this source.

Also: the measured bluff prior is the bettor's kind's: `OMAHA_PRICED_MEASURED_BLUFF` (persons, 995 bets) or `OMAHA_PRICED_MEASURED_BLUFF_HORSE` (Horses, 934 heads-up bets into Horses: turn 0.139 to 0.244, river 0.128 to 0.219).

### All nine families on, 2026-11-18 source (priced2-013U37/PASS-BAR.md configuration 1)

Incomplete when SSD1 dropped off the Mac (F5 77 of 80 sessions, M4 14 of 16, M5 12 of 16), aggregates as printed: field F4 -5.60 +/- 3.47, F5 -5.00 +/- 3.78, pooled -5.30 +/- 2.56; Horse-only M4 +0.09 +/- 1.84, M5 +1.53 +/- 1.28, pooled +0.81 +/- 1.12. Not a verdict (partial). Read: the Horse-only loss of v2/v3 (-7.8) is gone with the kind priors; the human-like field loss is not. The families stay never-on-together.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 +1.41 +/- 1.74 bb/100 (80 sessions, 40000 pairs, 145 divergent pairs), F5 -2.38 +/- 1.32 bb/100 (80 sessions, 40000 pairs, 134 divergent pairs), pooled -0.49 +/- 1.09; Horse-only tables M4 -0.61 +/- 0.68 bb/100 (16 sessions, 8000 pairs, 344 divergent pairs), M5 -0.87 +/- 0.82 bb/100 (16 sessions, 8000 pairs, 273 divergent pairs), pooled -0.74 +/- 0.53. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: INCONCLUSIVE (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 27 decisions changed (26 more aggressive, 1 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 15: judged-wrong fixed 8, newly wrong 3; audit-judge EV difference +376.6 bb over the 12 changes it prices (mean +31.39, se 10.79); off-arm decisions judged wrong 342, of them left unchanged 334; the same decisions with the winner's measured read: 19 decisions changed (18 more aggressive, 1 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 7: judged-wrong fixed 5, newly wrong 0; audit-judge EV difference +122.3 bb over the 7 changes it prices (mean +17.47, se 7.36); off-arm decisions judged wrong 358, of them left unchanged 353; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 18 decisions changed (15 more aggressive, 3 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 11: judged-wrong fixed 2, newly wrong 4; audit-judge EV difference +24.7 bb over the 8 changes it prices (mean +3.09, se 9.16); off-arm decisions judged wrong 160, of them left unchanged 158; the same Nov 16 decisions with the winner's measured read: 14 decisions changed (10 more aggressive, 4 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 7: judged-wrong fixed 2, newly wrong 4; audit-judge EV difference +37.0 bb over the 3 changes it prices (mean +12.34, se 7.30); off-arm decisions judged wrong 168, of them left unchanged 166.

## Limits

The ramps (for example 20 to 60 percent of the pot around the old 40 percent line) are stated, not fitted. The exact count still reads the value region at the nearest strength class, so the win share moves in small steps with the holdings, not with the size.
