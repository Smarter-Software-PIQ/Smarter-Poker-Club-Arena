# omahaDrawRaiseIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash flop and turn: a raise facing a wager with a draw the 12:30 bar names is priced beside the call (`omahaPricedSampledRaise`) and stands when it is worth more than the call by 2 percent of the pot, else it is the call. At the three draw-raise sites of the brain the same comparison decides whether the site raises. The big-draw wager (`omahaBigDrawAggression`) is priced out of position and without the combo-draw class.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaDrawRaiseIsPriced docs/horse-option-authority.d/omahaDrawRaiseIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaNoDrawRaiseOutOfPosition` (`omahaNoDrawRaiseFinal` and `drawRaiseBarred`, HorseLogic.ts) and the `out_of_position` / `not_combo` holds of `omahaBigDrawVerdict` (`HorseOmahaBigDrawAggression.ts`): no draw raise out of position, combo draws only in position (audit row 9, blanket by category).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

The seeded sample of HorseOmahaBigDrawAggression (opponent hands from the unseen cards, run out three times each) gives the Horse share against every hand, against the range that continues against a bet and against the range that continues against a raise. Fold equity is each opponent measured fold to a bet (posterior mean; the population 0.42 without one) times the stated raise scale 0.42, replaced by his measured fold to a raise where the street read supplies it. Out of position the Horse realizes 0.8 of its share on both lines unless the raise is all in.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_draw_raise_kept, \_called, \_unpriced_kept, \_site_admitted, \_site_withheld (HorseDataLedger.ts); under omahaPricedMix, \_mixed_kept (a raise the mix took, not priced above the call, kept) and \_mixed_called (a raise priced above the call that the mix turned into the call), so the kept and called words are true.

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Follow-up of 2026-11-18 (priced2: opponent kind, review notes N1-N4)

**Batch integration 2026-11-18 (lead ruling on review R2 B1/B2 of priced2 54d47a6a706): everything in this section acts ONLY with the default-OFF option `omahaPricedPriorsByOpponentKind` on (no league yet; do not switch on without a WIN); the re-raise counted once (N1) acts only with the OFF-ONLY option `omahaRaiseEvCountsLossesOnce`. With both off this family is byte-identical to #11212 (HorseOmahaPricedKindOptions.test.ts and HorseOmahaPricedRulesRecorded.test.ts, on recorded decisions whose seats' kinds are known). Unpriceable spots, stated honestly: with omahaPricedPriorsByOpponentKind on, a spot the comparison cannot price hands back to the OLD CATEGORICAL RULE, which then decides, beside the family's `_unpriced_kept` receipt; with it off the decision given is kept, as in #11212.**

Every opponent figure a priced comparison reads now comes from his own KIND's prior (`omahaPricedKindPrior`, HorseOmahaPricedMode.ts; kind from `gs.humanUserIds`, else the seat's `is_horse`): a Horse is never priced on a person's bluff table, bet rate, fold rate or reference rate, nor a person on a Horse's. Each posterior is re-centred on that prior, so a player with no opportunity reads exactly it (no step at the first opportunity). The Horse figures are measured on the same 5,379-hand production window as the person figures (archive plo-handoff-review-01a1cbbd/priced2-013U37/calib). Where the comparison cannot price a spot at all, the categorical rule acts there as with the option off, beside the `_unpriced_kept` receipt (it no longer falls open). Cause and measurements: archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md. Evaluation protocol of this source: archive priced2-013U37/PASS-BAR.md. The v2 verdict below was measured on the #11212 source and is NOT carried over to this source.

## Follow-up of 2026-11-19 (the sampled raise priced at every size)

The sampled comparison this family asks (`omahaPricedSampledRaise`) prices one raise size and reads the fold to a raise size-blind (verifier follow-up on #11345). The repair sits behind the default-OFF option `omahaSampledRaiseIsPricedAtEverySize` (docs/horse-option-authority.d/omahaSampledRaiseIsPricedAtEverySize.md): with it on, the fold, the call and a raise to each legal size are priced, each raise's fold share at the price it lays. With it off this family is byte-identical to before; its evaluation above was measured with it off.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 -1.41 +/- 1.07 bb/100 (80 sessions, 40000 pairs, 31 divergent pairs), F5 -0.67 +/- 0.74 bb/100 (80 sessions, 40000 pairs, 65 divergent pairs), pooled -1.04 +/- 0.65; Horse-only tables M4 -0.47 +/- 0.81 bb/100 (16 sessions, 8000 pairs, 197 divergent pairs), M5 -1.02 +/- 1.04 bb/100 (16 sessions, 8000 pairs, 242 divergent pairs), pooled -0.75 +/- 0.66. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: EQUAL (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 6 decisions changed (6 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 3: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 342, of them left unchanged 342; the same decisions with the winner's measured read: 8 decisions changed (8 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 4: judged-wrong fixed 1, newly wrong 0; audit-judge EV difference +4.1 bb over the 1 changes it prices (mean +4.13, se nan); off-arm decisions judged wrong 358, of them left unchanged 357; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 6 decisions changed (6 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 4: judged-wrong fixed 3, newly wrong 0; audit-judge EV difference +29.3 bb over the 3 changes it prices (mean +9.75, se 3.89); off-arm decisions judged wrong 160, of them left unchanged 157; the same Nov 16 decisions with the winner's measured read: 9 decisions changed (9 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 6: judged-wrong fixed 3, newly wrong 0; audit-judge EV difference +29.3 bb over the 3 changes it prices (mean +9.75, se 3.89); off-arm decisions judged wrong 168, of them left unchanged 165.

## Limits

The fold-to-raise prior (0.42 x 0.42 = 0.18) agrees with the measured flop figure (11 of 65 heads-up raises folded to, 0.17; turn 9 of 39, 0.23; persons and Horses together). The out-of-position realization 0.8 is the big-draw module constant, not measured. One or two opponents only; three or more keep the decision given.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: LEGACY (as of 2026-11-19 this file records a replay in prose only; it was not written by the scorer's --row, so the scorer commit and the validity of its arms' option sets are not recorded. A row needs a new run)
