# omahaPairedBoardBetIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash, a paired turn or river below a full house: a bet is priced beside the check against every opponent, whatever his label (`omahaPricedBet`), and stands when it is worth at least the check. The card-impact press is no longer withheld on a paired board. The river of a board paired on the turn after the Horse turn bet was called is the same comparison. The river nut-blocker bluff is admitted on a paired board when some bet is priced above the check.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

OFF-ONLY in the live switch: it failed its declared evaluation (ploFailed, HorseOptionSwitch.ts); the database refuses on for it. Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaPairedBoardBetIsPriced docs/horse-option-authority.d/omahaPairedBoardBetIsPriced.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaPairedRiverNoThinLeadVsValueLeader`, `omahaOverpairNoOopBarrelVsValueLeader`, `omahaPairedTurnNoBarrelWithoutBoatVsValueLeader` (`omahaOopCheckRules`), the card-impact press veto (`omahaCardImpactRule`), `ploPairedBoardRiverCheck` (`pairedBoardRiverCheck`) and the `!boardPaired15` bar of the river nut-blocker bluff (decidePostflop), all HorseLogic.ts (audit rows 11 and 12 and section 3 item 9: blanket by label, texture and line).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

The card-impact comparison of the check and every bet size, with the opponent read as continuous figures (his fold to a bet, his river call rate, his bet rate when checked to, a bluff share that follows his bet rate). The knowledge of the rules survives as his range: his line this hand (the calls that brought him to a paired board) weights the sample toward trips and full houses, so a thin bet into that range prices below the check.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_paired_board_bet_kept, \_checked, \_unpriced_kept, omaha_priced_paired_board_blocker_bluff_admitted (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Follow-up of 2026-11-18 (priced2: opponent kind, review notes N1-N4)

Every opponent figure a priced comparison reads now comes from his own KIND's prior (`omahaPricedKindPrior`, HorseOmahaPricedMode.ts; kind from `gs.humanUserIds`, else the seat's `is_horse`): a Horse is never priced on a person's bluff table, bet rate, fold rate or reference rate, nor a person on a Horse's. Each posterior is re-centred on that prior, so a player with no opportunity reads exactly it (no step at the first opportunity). The Horse figures are measured on the same 5,379-hand production window as the person figures (archive plo-handoff-review-01a1cbbd/priced2-013U37/calib). Where the comparison cannot price a spot at all, the categorical rule acts there as with the option off, beside the `_unpriced_kept` receipt (it no longer falls open). Cause and measurements: archive priced-01BNteGZ/ALLON-DIAGNOSIS-20261118.md. Evaluation protocol of this source: archive priced2-013U37/PASS-BAR.md. The v2 verdict below was measured on the #11212 source and is NOT carried over to this source.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 -0.94 +/- 1.04 bb/100 (80 sessions, 40000 pairs, 91 divergent pairs), F5 -2.18 +/- 1.02 bb/100 (80 sessions, 40000 pairs, 103 divergent pairs), pooled -1.56 +/- 0.73; Horse-only tables M4 -0.22 +/- 0.83 bb/100 (16 sessions, 8000 pairs, 401 divergent pairs), M5 -0.72 +/- 1.07 bb/100 (16 sessions, 8000 pairs, 263 divergent pairs), pooled -0.47 +/- 0.68. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: FAIL (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 9 decisions changed (0 more aggressive, 9 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 3: judged-wrong fixed 0, newly wrong 3; audit-judge EV difference -42.0 bb over the 3 changes it prices (mean -14.00, se 3.17); off-arm decisions judged wrong 342, of them left unchanged 342; the same decisions with the winner's measured read: 11 decisions changed (6 more aggressive, 5 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 4: judged-wrong fixed 1, newly wrong 1; audit-judge EV difference +15.5 bb over the 4 changes it prices (mean +3.88, se 10.95); off-arm decisions judged wrong 358, of them left unchanged 357; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 3 decisions changed (0 more aggressive, 3 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 1: judged-wrong fixed 0, newly wrong 0; audit-judge EV difference +8.8 bb over the 1 changes it prices (mean +8.76, se nan); off-arm decisions judged wrong 160, of them left unchanged 160; the same Nov 16 decisions with the winner's measured read: 5 decisions changed (3 more aggressive, 2 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 2: judged-wrong fixed 2, newly wrong 0; audit-judge EV difference +45.0 bb over the 2 changes it prices (mean +22.52, se 17.98); off-arm decisions judged wrong 168, of them left unchanged 166.

## Limits

The measured figures for paired boards (he holds trips or better on 60 / 77 / 72 percent of his flop / turn / river bets there) enter only through the pooled read until the per-street, per-texture read is delivered. The blocker bluff itself still starts from an equity line (0.28) in the reference brain; only its paired-board bar is priced here.
