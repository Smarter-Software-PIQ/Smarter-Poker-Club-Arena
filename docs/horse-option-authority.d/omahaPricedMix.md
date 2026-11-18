# omahaPricedMix: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

Inside a priced rule that is on (the turn and river raise, the draw raise, the out-of-position turn barrel, the paired-board bet): when the two best actions are closer than the comparison own uncertainty, the lower-valued one is taken with probability 0.5 x (1 - gap / uncertainty). A raise is mixed in only when its expected value is positive.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

OFF-ONLY in the live switch: it failed its declared evaluation (ploFailed, HorseOptionSwitch.ts); the database refuses on for it. Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaPricedMix docs/horse-option-authority.d/omahaPricedMix.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

None: this is not a replacement. A priced rule with a fixed margin is a threshold an opponent can sit on.

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

The uncertainty is the standard error of the sampled share in chips (0 for the exact count) plus the spread of the opponent read (0.5 / sqrt(opportunities + 6) times the chips that ride on his answer). No chip or size constant. The draw is `omahaSlowplayUnit` (the decision derived stream, read and never advanced) keyed on public state only: the street, the board, the pot, the wager, the seat and the count of public actions. The Horse hole cards are not read, so the fast, deep and retried decision of one node agree and the draw says nothing about the hand.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_mix_lower_action_taken (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Follow-up of 2026-11-18 (priced2: opponent kind, review notes N1-N4)

**Batch integration 2026-11-18 (lead ruling on review R2 B1/B2 of priced2 54d47a6a706): everything in this section acts ONLY with the default-OFF option `omahaPricedPriorsByOpponentKind` on (no league yet; do not switch on without a WIN); the re-raise counted once (N1) acts only with the OFF-ONLY option `omahaRaiseEvCountsLossesOnce`. With both off this family is byte-identical to #11212 (HorseOmahaPricedKindOptions.test.ts and HorseOmahaPricedRulesRecorded.test.ts, on recorded decisions whose seats' kinds are known). Unpriceable spots, stated honestly: with omahaPricedPriorsByOpponentKind on, a spot the comparison cannot price hands back to the OLD CATEGORICAL RULE, which then decides, beside the family's `_unpriced_kept` receipt; with it off the decision given is kept, as in #11212.**

Every opponent figure a priced comparison reads now comes from his own KIND's prior (`omahaPricedKindPrior`, HorseOmahaPricedMode.ts; kind from `gs.humanUserIds`, else the seat's `is_horse`): a Horse is never priced on a person's bluff table, bet rate, fold rate or reference rate, nor a person on a Horse's. Each posterior is re-centred on that prior, so a player with no opportunity reads exactly it (no step at the first opportunity). The Horse figures are measured on the same 5,379-hand production window as the person figures (archive plo-handoff-review-01a1cbbd/priced2-013U37/calib). Where the comparison cannot price a spot at all, the categorical rule acts there as with the option off, beside the `_unpriced_kept` receipt (it no longer falls open). Cause and measurements: archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md. Evaluation protocol of this source: archive priced2-013U37/PASS-BAR.md. The v2 verdict below was measured on the #11212 source and is NOT carried over to this source.

Its v2 FAIL was measured on the pre-fix source with every family on; it is retried on this source (priced2-013U37/PASS-BAR.md, configuration 2) and stays off-only unless it meets its bar there.

### All nine families on, 2026-11-18 source (priced2-013U37/PASS-BAR.md configuration 1)

Incomplete when SSD1 dropped off the Mac (F5 77 of 80 sessions, M4 14 of 16, M5 12 of 16), aggregates as printed: field F4 -5.60 +/- 3.47, F5 -5.00 +/- 3.78, pooled -5.30 +/- 2.56; Horse-only M4 +0.09 +/- 1.84, M5 +1.53 +/- 1.28, pooled +0.81 +/- 1.12. Not a verdict (partial). Read: the Horse-only loss of v2/v3 (-7.8) is gone with the kind priors; the human-like field loss is not. The families stay never-on-together.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option (all nine families on in both arms), A minus B in bb/100, standard error across sessions): human-like field F4 -0.42 +/- 1.22 bb/100 (80 sessions, 40000 pairs, 153 divergent pairs), F5 -1.33 +/- 1.93 bb/100 (80 sessions, 40000 pairs, 137 divergent pairs), pooled -0.87 +/- 1.14; Horse-only tables M4 -0.94 +/- 1.32 bb/100 (16 sessions, 8000 pairs, 512 divergent pairs), M5 -1.95 +/- 0.94 bb/100 (16 sessions, 8000 pairs, 422 divergent pairs), pooled -1.44 +/- 0.81. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: FAIL (the bar for this option is EQUAL against the field and not FAIL at Horse-only tables).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 80 decisions changed (65 more aggressive, 15 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 33: judged-wrong fixed 8, newly wrong 6; audit-judge EV difference +242.4 bb over the 14 changes it prices (mean +17.31, se 10.71); off-arm decisions judged wrong 342, of them left unchanged 334; the same decisions with the winner's measured read: 75 decisions changed (69 more aggressive, 6 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 34: judged-wrong fixed 10, newly wrong 2; audit-judge EV difference +236.6 bb over the 18 changes it prices (mean +13.14, se 4.36); off-arm decisions judged wrong 358, of them left unchanged 348; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 61 decisions changed (49 more aggressive, 12 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 29: judged-wrong fixed 5, newly wrong 5; audit-judge EV difference +31.9 bb over the 13 changes it prices (mean +2.45, se 5.39); off-arm decisions judged wrong 160, of them left unchanged 155; the same Nov 16 decisions with the winner's measured read: 59 decisions changed (50 more aggressive, 9 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 25: judged-wrong fixed 6, newly wrong 3; audit-judge EV difference +85.4 bb over the 8 changes it prices (mean +10.67, se 4.93); off-arm decisions judged wrong 168, of them left unchanged 162.

## Limits

A fixed field cannot measure exploitability, which is what mixing is for; the evaluation can only show that it costs nothing against one.
