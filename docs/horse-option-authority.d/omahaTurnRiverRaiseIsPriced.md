# omahaTurnRiverRaiseIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence MET on the v2 evaluation; the option ships OFF and no switch row is written by this change.

## What it does

PLO4/PLO5 cash turn and river facing a wager: the outermost answer is a priced comparison of the fold, the call and a raise to each legal size on the exact hand (`omahaPricedRaise`). A raise is made when it is worth more than the best other action by 4 percent of the pot, with any hand; a raise another owner proposed that is not becomes the priced call or fold. A nut-class hand keeps the raise or call it was given.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaTurnRiverRaiseIsPriced docs/horse-option-authority.d/omahaTurnRiverRaiseIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaTurnRiverRaiseNeedsNuts` (`omahaTurnRiverRaiseNeedsNutsRule`, HorseLogic.ts; `HorseOmahaTurnRiverRaiseNeedsNuts.ts`) and `omahaRiverNutRaiseOnly` (`HorseOmahaRiverNutRaise.ts`): every turn or river raise below the nuts becomes a call or a fold, against every opponent (audit rows 7 and 8, blanket by category).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

EV(call) is the facing-bet verdict (exact count of the opponent holdings that beat, tie and lose to the hand, the Horse own cards, the board and dead cards removed). EV(raise to a size): the share of his betting range that folds is the minimum-defence figure at the price the raise lays him (1 - price), replaced by his measured fold to a raise where the street read supplies it, shrunk toward the population figure by its opportunity count; on the river his bluffs fold first and the strongest part of his value region continues; on the turn the part of his range beyond his value region holds draws and the Horse share against it is counted over every river card; 26 percent of his range raises again (measured, 14 of 54) and the Horse gives up its raise to that unless its hand holds; every other player in the hand must fold or be beaten. The knowledge of the nut rule survives as the range: a raise that only better hands continue against prices below the call.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_raise_kept, \_called, \_folded, \_made_value, \_made_bluff, \_unpriced_kept (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 +2.49 +/- 1.94 bb/100 (80 sessions, 40000 pairs, 140 divergent pairs), F5 +4.07 +/- 1.66 bb/100 (80 sessions, 40000 pairs, 132 divergent pairs), pooled +3.28 +/- 1.28; Horse-only tables M4 -0.49 +/- 0.78 bb/100 (16 sessions, 8000 pairs, 252 divergent pairs), M5 +0.10 +/- 0.85 bb/100 (16 sessions, 8000 pairs, 159 divergent pairs), pooled -0.19 +/- 0.58. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: WIN (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 12 decisions changed (11 more aggressive, 1 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 8: judged-wrong fixed 1, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 342, of them left unchanged 341; the same decisions with the winner's measured read: 10 decisions changed (9 more aggressive, 1 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 6: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 358, of them left unchanged 358; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 6 decisions changed (6 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 6: judged-wrong fixed 1, newly wrong 1; no change the audit judge prices; off-arm decisions judged wrong 160, of them left unchanged 159; the same Nov 16 decisions with the winner's measured read: 4 decisions changed (4 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 4: judged-wrong fixed 1, newly wrong 1; no change the audit judge prices; off-arm decisions judged wrong 168, of them left unchanged 167.

## Limits

No bluff raise can be priced in until the per-street read delivers a fold-to-raise cell: a fold to a bet when checked to is not read as a fold to a raise, and against the population a pure bluff raise never has positive expected value in this model. On the turn the share against the continuing part of his value region is read on the turn board as it stands (river improvement is not credited there), which leans against thin turn raises. The re-raise share and the fold-to-raise check are measured on persons and Horses together (the archived file does not split them). The raise margin (4 percent of the pot) is HorseOmahaStrongHandValue own constant.

## Batch integration 2026-11-18 (PLO option batch, agent/plo-batch-013U37/feat/omaha-option-batch)

Lead ruling (2026-11-18, review R2 of priced2): this option is NOT off-only. Its v2 WIN above stands for the code on main (#11212), which the batch keeps byte-identical while the two new options are off: `omahaPricedPriorsByOpponentKind` (default OFF: the opponent-kind priors, the card-impact read by kind, the fall-closed handling of unpriceable spots and the priceable-only ownership) and `omahaRaiseEvCountsLossesOnce` (OFF-ONLY: the re-raisers' losses counted once). The priced2 league of 2026-11-18 (configuration 0, Horse-only PLO4 -1.84 +/- 0.88, FAIL) measured this option WITH those changes on; it is recorded, provisionally (raw rows lost with SSD1), in docs/horse-option-authority.d/omahaRaiseEvCountsLossesOnce.md and does not apply to this option's #11212 form. Test: HorseOmahaPricedKindOptions.test.ts (fixture record 59804454, HorseOmahaPricedRules.fixture.json :578, stays call 88 with this option on and both new options off).

## Fold to a raise is priced at the raise's price (2026-11-19, plo-truncation-013U37)

Found by BLANKET-LOO-1 (HORSE SWITCH lane) and reproduced at f3e99378ccbb: with omahaReadIsByStreetAndTexture on, the street read's fold-to-raise cell (counted over raises of every size) replaced the size-aware minimum-defence fold (1 - price) once it had a few opportunities, so a minimum raise bought the fold share of a pot raise for 2 bb. Two Horses facing each other's minimum raise re-raised by the minimum until the stacks were in (the league's 48-action street cap: 18-65 truncated hands per 100,000 in every Horse-only cell; production has no cap in pot limit). Fix: the fold priced is the smaller of the size-blind read (as before) and the read taken at this price, the minimum-defence fold times his fold-to-raise rate over the population's measured 14/54 (OMAHA_PRICED_FOLD_TO_RAISE_POPULATION, the same measurement as OMAHA_PRICED_RERAISE_SHARE). With no street cell (omahaReadIsByStreetAndTexture off, production on 2026-11-19) both readings are the minimum-defence fold: decisions are byte-identical. Evidence: plo-handoff-review-01a1cbbd/truncation-013U37/FINDINGS.md.
