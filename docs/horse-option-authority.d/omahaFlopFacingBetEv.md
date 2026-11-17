# omahaFlopFacingBetEv: authority for the live switch

Built 2026-11-17 by the PLO Strategy lane on the owner's ruling of 2026-11-16. Evidence NOT MET as a whole: the value row is MET by the declared evaluation (WIN, below); the continuation and reach row is NOT MET. This file does not authorize switching the option on: no owner order to switch it on is recorded here. It records what the option is, what was measured and what must pass first.

## What it does

PLO4/PLO5 cash, one board, high only, on the FLOP, facing a bet or a raise: a fold or a call (the whole-stack call included) becomes one expected-value verdict (`server/src/engine/HorseOmahaFlopFacingBetEv.ts`, applied by `HorseOmahaFlopFacingBetEvRule.ts`), the flop form of `omahaFacingBetEv`:

- Hand: the hand's showdown result on two-card runouts against opponent holdings, sampled with a seed taken from the cards (every unseen card the turn card once, three river cards each; on each runout five holdings of the bettor's value region and three of his other holdings; 132 to 135 runouts, about 1,060 showdowns). The same cards always give the same numbers. The brain's random stream is not read.
- Player: the bettor's range is the strongest share of holdings on the flop (0.56 under 40% of the pot, 0.46 to 70%, 0.36 to 110%, 0.26 above, 0.18 for a raise) and a share of every other holding (0.40 / 0.42 / 0.32 / 0.28, raise 0.18), both times 0.8 when he bets into the live preflop raiser without having raised himself, the second moved by his measured read (`omahaEvBluffShare`, the turn and river function). The size sets the range; it is never the verdict.
- Later streets: a call with chips behind takes a realization factor read from the hand's own runouts (`omahaFlopRunoutRealization`): equity on runouts where the hand can call the turn (0.15 to 0.35 against his value region with a card to come) and the river (0.2 to 0.5) is realized; equity against his other holdings is also realized on a street he checks (0.6 in position, 0.45 out, rising to all of it as his non-value share goes from 0.35 to 0.6). Within 0.3 and 1; at most 0.85 with a player still to act. A call for the whole stack, one that leaves under a tenth of the pot, or one with nobody left who can bet takes no factor.
- Price: EV(call) on the actual pot and call against the one margin of the turn and river rule (2% of the final pot).
- Field: a caller of the bet, a player all in before the flop and a player still to act must each be beaten, as on the later streets.

Precedence in the spot it covers: the verdict replaces a fold or a call, so the stack-share paired-board fold (`HorsePloPairedBoardFold.ts`), its price exception, the reference brain's own fold or call (which reads the 20 big blind big-bet mark of `HorseMind.ts`) and the flop call-discipline folds no longer decide there. A raise is left alone (a raise the paired-board fold already folded arrives as a fold and gets the verdict). It stands aside for the bare-overpair continuation (`omahaBareOverpairOopFlopCheck`), which has its own priced verdict. Outside the spot (tournaments, PLO6 even with `omahaStrategyInPlo6` on, hi-lo, several boards, bomb pots, all-in-or-fold, capped wagers, a hand that cannot be sampled, any failure) the decision it was given stands, exactly as with the option off. It is independent of `omahaFacingBetEv`.

Default OFF in source (read `=== true`). Registered in the option switch (follow-up migration `20261117182301_horse_option_switch_omaha_flop_facing_bet_ev`), switchable live, not off-only. On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaFlopFacingBetEv docs/horse-option-authority.d/omahaFlopFacingBetEv.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on

- 2026-11-16, verbatim as recorded by the lane (`docs/horse-option-authority.d` entry of the Phase 2 texture work, archive `plo-handoff-review-01a1cbbd/phase2-texture-01BNteGZ`): "THE SIZE OF THE BET SHOULD NOT MAKE OR BREAK THE DECISION, THE DECISION NEEDS TO BE MADE ON THE HAND, AND THE MATH AND THE OPPONENTS RANGE AND OTHER FACTORS NOT JUST "IF ITS A BIG BET" ITS ALMOST ALWAYS A BIG BET!"
- 2026-11-17 11:32 America/Chicago (cited by file, not quoted: the lane's coordination record, archive `COORDINATION-INBOX-FALLBACK-20261116.md`, entries of 2026-11-17T17:34Z and later): the PLO Strategy verification session owns the engineering decisions of this work and is to carry it to completion.

Neither is an order to switch this option on. That order, when given, is recorded here with its time before any `on` row cites this file.

## The audits it answers

- `plo-handoff-review-01a1cbbd/rules-audit-01BNteGZ/PLO-BLANKET-RULE-AND-CONFLICT-AUDIT-20261117.md`: rows 1, 2 and 14 and conflict C1 (the flop is decided by a stack share and a chip mark; the turn and river of the same hand by EV against a range).
- `plo-handoff-review-01a1cbbd/audit2-01BNteGZ/PLO5-WOOWOO-AUDIT-PART2-20261117.md`: Horses folded to 268 of one player's 376 flop bets (71%) and folded the best hand on 57 of those 268 folds (21%); 49% of the flop folds had more equity than the price against the hand he held.
- `plo-handoff-review-01a1cbbd/phase2-texture-01BNteGZ/AUDIT-AND-BUILD-20261117.md`: section 5, "the flop has no EV rule to put a correction in".

Recorded hands in the tests (PLO5 1/2 cash, Horses facing that player's flop bet or raise): 59790514, 59829906, 59811519, 59833259, 59852600, 59840990, 59869211, 59802550, 59806482 (folds the audit judged wrong; the verdict calls); 59833693, 59848622 (judged wrong folds the verdict still folds); 59831538, 59868806, 59870825 (calls that lost; the verdict folds); 59789847 (a call of a third of the pot on a paired flop; kept).

## Receipts

omaha_flop_facing_bet_ev_call, omaha_flop_facing_bet_ev_fold (the verdict, every time it answers), omaha_flop_facing_bet_ev_changed (it differed from the answer it was given; the rule it replaced is the legacy receipt fired in the same decision, for example plo_paired_board_fold). A failure fires omaha_strategy_rule_failed and keeps the decision it was given. A default-off option production does not set is silent.

## Tests

`HorseOmahaFlopFacingBetEv.test.ts` (29 tests): the sampled count against an independent estimate, its determinism and its own random stream; the realization factor by hand; the spot and its scope; the chip-scale invariance of the verdict; the fifteen recorded decisions through `HorseLogic.decide` with the production option list, option off and on; precedence against the paired-board fold, the 20 big blind mark, a raise and the bare-overpair continuation; unset, false and a truthy non-boolean byte-identical; the worker receipt validator.

## Speed

The engine's per-decision mark is 80 ms (the wave-two timing tables, archive `plo-handoff-review-01a1cbbd/wave2-20261116/TIMING-before-after.txt`: p50, p95, p99 and the count over 80 ms by street). Exact enumeration of the flop the way the turn is counted (every runout, every holding) was not built: the turn's exact count costs about 180 ms for PLO5 over 44 river cards, and the flop has 946 runouts. The sampled count was measured with that harness (the same generated states, 400 decisions per cell, the 2026-11-16 production option list with and without the option, machine load 45 to 50; archive `plo-handoff-review-01a1cbbd/flopev-01BNteGZ/timing/TIMING-flop.txt`):

| game | flop decisions | production list p50 / p99 | with the option p50 / p99 | over 80 ms |
| ---- | -------------- | ------------------------- | ------------------------- | ---------- |
| PLO4 | 800            | 3.1 / 23.3 ms             | 10.6 / 27.4 ms            | 0 of 800   |
| PLO5 | 800            | 3.0 / 24.2 ms             | 15.6 / 36.7 ms            | 1 of 800   |

The one PLO5 decision over 80 ms (118 ms) is the same generated state whose time without the option was 104 ms: a load spike, not the count. Decisions the verdict answered: PLO4 398, p50 12.6 ms, p99 40.0 ms; PLO5 403, p50 17.7 ms, p99 37.6 ms. No decision failed and no `omaha_strategy_rule_failed` fired. The option adds about 8 to 13 ms to a flop decision facing a bet and nothing to any other decision.

## Evaluation

The paired league evaluation was declared before it ran (archive `plo-handoff-review-01a1cbbd/flopev-01BNteGZ/PASS-BAR.md`, written 2026-11-17T18:14Z; launched 18:21Z) and ran to its declared size on the declared seeds. Result: WIN under the bar (archive `flopev-01BNteGZ/final/RESULT.txt`, per-session lines in the same folder).

| cell | table                                          | sessions x pairs | hero hands | A minus B, bb/100 | SE   | z     |
| ---- | ---------------------------------------------- | ---------------- | ---------- | ----------------- | ---- | ----- |
| F4   | PLO4, one Horse vs five human-calibrated seats | 1,000 x 500      | 1,000,000  | +3.90             | 1.13 | +3.44 |
| F5   | PLO5, the same                                 | 1,000 x 500      | 1,000,000  | +4.88             | 1.21 | +4.03 |
| M4   | PLO4, Horse-only, production styles            | 100 x 500        | 100,000    | +1.75             | 0.58 | +3.02 |
| M5   | PLO5, the same                                 | 100 x 500        | 100,000    | +2.26             | 0.65 | +3.49 |

Pooled: human-like +4.39 bb/100, SE 0.83 (z +5.30); Horse-only +2.00 bb/100, SE 0.43 (z +4.61). Validity: illegal actions 0, brain exception fallbacks 0, truncated streets 0, no inert cell; divergent pairs F4 9,167, F5 8,321, M4 5,598, M5 4,750. The two field runs were killed from outside at about 19:40Z (session 645 of PLO4, 468 of PLO5) and were finished from the last completed session with the same driver and a start index; the overlapping session was rerun and matched its first line exactly (seed, result, standard error, divergent pairs, both arms), and the engine files still matched their launch sha256 (archive `final/INTERRUPTION.txt`). No constant was changed. Limits of this result: the human-like field is a development population that misses its fidelity criterion at the flop facing-bet node and does not adapt; no rake; six seats; stacks reset each hand.

- Arms: A = the 2026-11-16 production option list plus this option; B = that list without it.
- Cells: PLO4 and PLO5, six seats, 100 big blinds, cash: one Horse against five seats of the human-calibrated Omaha development field (1,000 sessions of 500 duplicate pairs per game), and Horse-only tables with production styles (100 sessions of 500 pairs per game).
- Bar (the lane's two-standard-error rule): WIN only if the human-like pooled figure is above +2 SE and neither pooled figure nor any cell is below -2 SE.

## Evidence rows

- Mechanism, scope, visibility (flag and receipts in `HorseDataLedger.ts`), tests: MET.
- Option unset or false: every decision byte-identical to the base at the fifteen recorded nodes, with and without the production option list (`HorseOmahaFlopFacingBetEv.test.ts`; with the list every byte but `thinkTime`, which `horseActionTimeIsPublicOnly` draws from the timing stream), and at 368 replayed flop decisions with no options (archive `flopev-01BNteGZ/replay/`).
- Speed: MET against the 80 ms mark (table above), measured under load on the development machine, not on the engine host.
- Value: MET. The declared evaluation's result is WIN under the bar written before it ran (section above), with the limits stated there.
- Continuation, reach: NOT MET. What a called hand does on the turn and river with the option on is whatever today's turn and river rules do; it is not measured apart. Not counted in production.

## Limits

- The constants are stated, not measured: the flop value shares and non-value shares extend the turn rows of `omahaFacingBetEv`; the realization shares are those of the turn runout work. One measured anchor, one player. The bettor's range has no flop-specific read: the pooled postflop read of the turn and river rule is the one asked, with its value-leader cap.
- The value region is the strongest share of holdings by made hand on the flop. On a paired flop that region is wider than the range the audited player bets there (trips or better on 60% of his paired-flop bets): the verdict calls more there than a read of that player would.
- The count is sampled: about 1,060 showdowns give the win share against each region to about two points. A decision within that of its margin can differ from an exact count; it is the same decision every time for the same cards.
- No implied odds: a draw's later winnings are not added, and a player still to act is priced as a tax (the field factor and the 0.85 cap), so a bare draw with players behind can fold where a person would call.
- The replay of 368 audited flop decisions (archive `flopev-01BNteGZ/replay/REPLAY-SUMMARY.md`) is a development measurement on one opponent: of 32 folds the audit judged wrong the verdict calls 19; of 215 folds it judged right the verdict calls 23; of 92 calls it judged right the verdict folds 16. The audit's judge is a model, not ground truth. Of the 58 decisions the verdict changes against the recorded action there (folds become calls, calls become folds), the audit agrees with 19 and disagrees with 39: out of position 10 agree and 22 disagree, in position 9 and 17. Against that one player's audited decisions the verdict is therefore not shown to be better, out of position included; the league WIN above is against a development population and does not settle this. Any switch-on decision weighs both.
- The receipt validator admits the flop fold or raise that became a call in the rule's spot for the exact chips; it cannot re-run the verdict (the opponent memory is not in the request), as for `omahaFacingBetEv`.
