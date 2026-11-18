# omahaOopTurnBarrelIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash turn, out of position, the flop bet was called, not nut class: the bet is priced beside the check against every opponent (`omahaPricedBet`) and stands when it is worth at least the check. The turn bet the Horse then faces after checking is NOT taken over: its priced replacement, the facing-bet expected value, folded strong draws and a set class at prices their equity beats in the counterfactual replay of the audited hands (4 of 4 judged changes wrong, about -102 bb on the audit judge; the field-factor and turn-realization defect, WooWoo audit RC-02b, held by 01BNteGY), so the outs-and-price verdict keeps deciding that half; it is listed in `OMAHA_OPEN_RULE_SITES` and pinned by the law test.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaOopTurnBarrelIsPriced docs/horse-option-authority.d/omahaOopTurnBarrelIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaOopTurnCheckAfterFlopCall` (`omahaOopCheckRules`, `omahaOopTurnFacingBetRule`, `omahaFacingBetEvOf`, HorseLogic.ts; `HorseOmahaOopChecks.ts`): every such turn bet becomes a check, and the bet then faced is called with four or more nut outs and folded with none (audit row 10, blanket by line, no opponent term).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

HorseOmahaCardImpact prices the check and every bet size against each opponent range as his line left it (a sample from the unseen cards weighted by his calls, bets and checks); at each size the top of his range raises, the next part calls, the rest folds, sized by the price and by his measured fold to a bet (posterior mean, no threshold, no label). Two or more opponents are combined as HorseOmahaStrongHandValue combines them.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_oop_turn_barrel_kept, \_checked, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Follow-up of 2026-11-18 (priced2: opponent kind, review notes N1-N4)

Every opponent figure a priced comparison reads now comes from his own KIND's prior (`omahaPricedKindPrior`, HorseOmahaPricedMode.ts; kind from `gs.humanUserIds`, else the seat's `is_horse`): a Horse is never priced on a person's bluff table, bet rate, fold rate or reference rate, nor a person on a Horse's. Each posterior is re-centred on that prior, so a player with no opportunity reads exactly it (no step at the first opportunity). The Horse figures are measured on the same 5,379-hand production window as the person figures (archive plo-handoff-review-01a1cbbd/priced2-013U37/calib). Where the comparison cannot price a spot at all, the categorical rule acts there as with the option off, beside the `_unpriced_kept` receipt (it no longer falls open). Cause and measurements: archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md. Evaluation protocol of this source: archive priced2-013U37/PASS-BAR.md. The v2 verdict below was measured on the #11212 source and is NOT carried over to this source.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 -1.52 +/- 1.31 bb/100 (80 sessions, 40000 pairs, 101 divergent pairs), F5 -1.39 +/- 1.14 bb/100 (80 sessions, 40000 pairs, 132 divergent pairs), pooled -1.45 +/- 0.87; Horse-only tables M4 +0.95 +/- 0.74 bb/100 (16 sessions, 8000 pairs, 447 divergent pairs), M5 +1.88 +/- 0.91 bb/100 (16 sessions, 8000 pairs, 377 divergent pairs), pooled +1.41 +/- 0.59. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: INCONCLUSIVE (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 20 decisions changed (20 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 342, of them left unchanged 342; the same decisions with the winner's measured read: 12 decisions changed (12 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 358, of them left unchanged 358; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 16 decisions changed (16 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 160, of them left unchanged 160; the same Nov 16 decisions with the winner's measured read: 16 decisions changed (16 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 168, of them left unchanged 168.

## Limits

The card-impact model prices a check as a line in which the Horse only calls or folds afterwards (no check-raise), so the check is undervalued and the comparison leans toward betting. An opponent all in from an earlier street leaves the decision as given.
