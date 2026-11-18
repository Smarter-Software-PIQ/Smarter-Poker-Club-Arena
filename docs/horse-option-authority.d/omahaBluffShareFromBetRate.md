# omahaBluffShareFromBetRate: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago. Evidence NOT MET: the option stays OFF.

## What it does

PLO4/PLO5 cash, the facing-bet expected value (turn and river): the bettor bluff share is the population prior moved continuously by his posterior-mean bet rate when checked to beside the population mean (ratio to the power 1.5, between 0.4 and 1.6). No sample threshold and no label: the value-leader cap of 0.65 and the maniac floor of 1.3 do not act.

Scope: PLO4 and PLO5 cash, one board, high only, no bomb pot, not Lightning. It acts where the rule it replaces is on; out of scope, and with the option unset or false, every decision is exactly as before.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaBluffShareFromBetRate docs/horse-option-authority.d/omahaBluffShareFromBetRate.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-17 11:49 America/Chicago: "there should not be any blanket rules, you need to coordinate and re write any and all "blanket rules" to be fully adaptable to real time decisions, a blanket rule shouldn't be allowed to effect a decision, they must all be done by math, gto, players hand or preceived range of hands as well as the opponents range of hand, equity, EV etc."
- 2026-11-17, earlier the same day: the size of the bet must not make or break a decision.

## The rule it replaces

`omahaEvBluffShare` (`HorseOmahaFacingBetEv.ts`): `k = Math.min(k, 0.65)` for a labelled value leader and `Math.max(k, 1.3)` for a labelled postflop maniac, applied at every size, street and texture, and only when the read is flagged measured (audit row 16, blanket by label).

That rule stays in source and keeps deciding while this option is off: it is live production behaviour. It retires only after this option is evaluated and switched on.

## The priced comparison

`omahaPricedBluffFactor` (HorseOmahaPricedMode.ts). The posterior mean shrinks toward the population with few (decayed) opportunities, so a thin or stale read moves the share a little and a deep fresh one moves it fully. Through the one read interface a per-street or per-texture bet rate replaces the pooled one where known.

The opponent read comes through one interface (`omahaPricedReadOfUser`, HorseOmahaPricedWiring.ts): the pooled read today, without its labels; the per-street, per-texture read through `omahaPricedSetStreetRatesSource` when it is delivered. Every opponent range is drawn from the cards the Horse does not hold. Order of the rules: docs/OMAHA-RULE-PRECEDENCE.md.

## Receipts

omaha_priced_facing_inputs_changed_to_call, \_changed_to_fold (shared with omahaFacingBetRangeIsContinuous) (HorseDataLedger.ts).

## Tests

HorseOmahaPricedRules.test.ts, HorseOmahaPricedRulesRecorded.test.ts (real decisions from production, per family), HorseOmahaNoBlanketRule.law.test.ts (no registered categorical rule decides with the priced options on; the open parts are pinned), HorseOmahaPricedReceiptGate.test.ts (the worker receipt admits a priced raise that became a call only under the decision's own option), OmahaPricedRangeCalibration.test.ts (the calibration arithmetic and the measured prior). Server tsc 0.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: decisions byte-identical to the base (HorseOmahaPricedRules.test.ts, nine spots, three seeds, unset / false / truthy non-boolean; and all 56 recorded decisions reproduce their recorded action with the option off).
- Value: NOT MET. Evaluation v2 (PASS-BAR-v2.md, source priced-01BNteGZ/eval2/RUN-SOURCE.txt; arm A = base + the option, A minus B in bb/100, standard error across sessions): human-like field F4 -0.39 +/- 0.91 bb/100 (80 sessions, 40000 pairs, 116 divergent pairs), F5 +0.80 +/- 1.04 bb/100 (80 sessions, 40000 pairs, 108 divergent pairs), pooled +0.20 +/- 0.69; Horse-only tables M4 +1.14 +/- 0.98 bb/100 (16 sessions, 8000 pairs, 366 divergent pairs), M5 -0.84 +/- 0.74 bb/100 (16 sessions, 8000 pairs, 297 divergent pairs), pooled +0.15 +/- 0.61. Illegal actions, brain exception fallbacks and truncated streets: 0 in total. VERDICT: EQUAL (the bar is WIN: the pooled human-like figure above two standard errors with no cell below minus two).
- Counterfactual replay of the real audited decisions, off vs on, final source priced-01BNteGZ/eval2/RUN-SOURCE.txt (judge: the audits own rules, audit2-01BNteGZ analyze.py, re-applied to both actions; it agrees with the audit verdict on 97.8% of the recorded actions): audit2 hands (721 PLO5 hands after the Nov 16 seal, 2,950 postflop Horse decisions), empty opponent memory: 0 decisions changed (0 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 342, of them left unchanged 342; the same decisions with the winner's measured read: 4 decisions changed (4 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 4: judged-wrong fixed 2, newly wrong 0; audit-judge EV difference +38.5 bb over the 4 changes it prices (mean +9.62, se 5.92); off-arm decisions judged wrong 358, of them left unchanged 356; Nov 16 hands before the seal (476 PLO5 hands with the winner seated, 2,019 postflop Horse decisions, 965 judged by the audit rules), empty opponent memory: 0 decisions changed (0 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 0: judged-wrong fixed 0, newly wrong 0; no change the audit judge prices; off-arm decisions judged wrong 160, of them left unchanged 160; the same Nov 16 decisions with the winner's measured read: 2 decisions changed (2 more aggressive, 0 more passive), illegal 0, receipt refusals 0; of the changes the audit judged 2: judged-wrong fixed 1, newly wrong 1; audit-judge EV difference +25.8 bb over the 1 changes it prices (mean +25.82, se nan); off-arm decisions judged wrong 168, of them left unchanged 167.

## Limits

The exponent 1.5 and the bounds are stated, not fitted. With the pooled read a player who bets most flops and few rivers still carries one ratio on every street.
