# omahaFlopFacingBetEv: authority for the live switch

Built 2026-11-17 by the PLO Strategy lane on the owner's ruling of 2026-11-16; reworked 2026-11-18 (the field counted together, realization measured by hand class and position, a larger and balanced sample; section "The rework of 2026-11-18"). @@HEADLINE@@ This file does not authorize switching the option on: no owner order to switch it on is recorded here. It records what the option is, what was measured and what must pass first.

## What it does

PLO4/PLO5 cash, one board, high only, on the FLOP, facing a bet or a raise: a fold or a call (the whole-stack call included) becomes one expected-value verdict (`server/src/engine/HorseOmahaFlopFacingBetEv.ts`, applied by `HorseOmahaFlopFacingBetEvRule.ts`), the flop form of `omahaFacingBetEv`:

- Hand: the hand's showdown result on two-card runouts against opponent holdings, sampled with a seed taken from the cards: a pool of 1,280 holdings ordered by strength on the flop; a balanced set of runouts (every unseen card the turn card of 12 runouts heads-up, 8 with one other player in, 6 with two, 4 with more, and the river card of as many); on each runout two holdings of the bettor's value region and one of his other holdings. The same cards always give the same numbers. The brain's random stream is not read.
- Player: the bettor's range is the strongest share of holdings on the flop (0.56 under 40% of the pot, 0.46 to 70%, 0.36 to 110%, 0.26 above, 0.18 for a raise) and a share of every other holding (0.40 / 0.42 / 0.32 / 0.28, raise 0.18), both times 0.8 when he leads into the preflop raiser before that player has acted and times 0.9 when he bets after the preflop raiser checked (a stab), the second moved by his measured read (`omahaEvBluffShare`, the turn and river function). The size sets the range; it is never the verdict.
- Field: every other player is counted on the same runouts as the bettor. A caller of the bet or a player all in before the flop holds a hand from his range share that must be beaten together with the bettor's (a joint count, not a product of separate shares). A player still to act folds, or continues with his call in the pot and his hand to beat, at the measured continue rate for a bet of that share of the pot (79% under a quarter of the pot down to 30% for a pot-sized bet); EV is summed over how many continue. No cap on the realization for a player behind. More than five other players: not answered (the given decision stands).
- Later streets: a call with chips behind takes a realization factor. First the runout model (`omahaFlopRunoutRealization`): equity on runouts where the hand can call the turn (0.15 to 0.35 against his value region with a card to come) and the river (0.2 to 0.5) is realized; equity against his other holdings is also realized on a street he checks (0.6 in position, 0.45 out, rising to all of it as his non-value share goes from 0.35 to 0.6); within 0.3 and 1. Then the measured correction by hand class (two pair or better; a draw; one pair or less) and position: what such flop calls returned in production over what this verdict expected, shrunk toward 1 by the size of each sample (`OMAHA_FLOP_EV_REALIZATION_FIT`; multipliers 1.08 / 0.88 for made hands in and out of position, 0.92 / 1.05 for draws, 0.73 / 0.80 for one pair or less; within 0 and 1.25). Then what is left to bet: nothing behind is no factor, a pot or more behind is the whole factor, a straight line between (no step). A call for the whole stack, or with nobody left who can bet, takes no factor. Nothing in it is the size of the bet or a share of the stack.
- Price: EV(call) on the actual pot and call against the one margin of the turn and river rule (2% of the final pot).

Where each constant comes from, with sample sizes and intervals: `docs/horse-option-authority.d/omahaFlopFacingBetEv.CONSTANTS.md`.

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

Recorded hands in the tests (PLO5 1/2 cash, Horses facing that player's flop bet or raise): 59790514, 59829906, 59811519, 59833259, 59852600, 59840990, 59869211, 59802550, 59806482 (folds the audit judged wrong; the verdict calls); 59833693, 59848622 (judged wrong folds the verdict still folds); 59831538, 59868806, 59870825 (calls that lost; the verdict folds); 59789847 (a call of a third of the pot on a paired flop; kept). Added 2026-11-18: 59710501, 59727433, 59756252, 59806482, 59842423 (the five flop folds of sets and nut straights the 48-hour audit named, RC-02a: four are called, 59710501 is a priced fold, below); 59830767 (a real node of the bare-overpair continuation, which the verdict stands aside for).

## Receipts

omaha_flop_facing_bet_ev_call, omaha_flop_facing_bet_ev_fold (the verdict, every time it answers), omaha_flop_facing_bet_ev_changed (it differed from the answer it was given; the rule it replaced is the legacy receipt fired in the same decision, for example plo_paired_board_fold). A failure fires omaha_strategy_rule_failed and keeps the decision it was given. A default-off option production does not set is silent.

## Tests

`HorseOmahaFlopFacingBetEv.test.ts` (43 tests): the sampled count against an independent estimate, its balanced runouts, its determinism and its own random stream; the sampling error of the verdict against its margin; the realization model by hand; the measured correction (classes, shrinkage by sample size, bounds, no size term) and the straight line over what is left to bet; the spot and its scope; a lead told from a stab; the joint count with a caller and the two-way pricing of a player behind; the chip-scale invariance of the verdict; the recorded decisions through `HorseLogic.decide` with the production option list, option off and on, a PLO4 node, a caller node and a whole-stack call included; the five RC-02a hands; precedence against the paired-board fold, the 20 big blind mark, a raise and the bare-overpair continuation (on a real node of it); unset, false and a truthy non-boolean byte-identical; the worker receipt validator.

## Speed

The engine's per-decision mark is 80 ms (the wave-two timing tables, archive `plo-handoff-review-01a1cbbd/wave2-20261116/TIMING-before-after.txt`). Exact enumeration of the flop the way the turn is counted was not built: the turn's exact count costs about 180 ms for PLO5 over 44 river cards, and the flop has 946 runouts. The sampled count of this build was measured with that harness (the same generated states, 400 decisions per cell, the 2026-11-16 production option list with and without the option, machine load 12 to 14; archive `plo-handoff-review-01a1cbbd/flopev2-013U37/timing/TIMING-flop.txt`):

| game | flop decisions | production list p50 / p99 | with the option p50 / p99 | over 80 ms |
| ---- | -------------- | ------------------------- | ------------------------- | ---------- |
| PLO4 | 800            | 3.2 / 16.3 ms             | 16.7 / 23.3 ms            | 0 of 800   |
| PLO5 | 800            | 3.1 / 22.6 ms             | 25.8 / 34.8 ms            | 2 of 800   |

The two PLO5 decisions over 80 ms: 132.2 ms on the generated state that takes 102.0 ms without the option, and one of 82.2 ms. Decisions the verdict answered: PLO4 398, p50 20.6 ms, p99 23.5 ms; PLO5 403, p50 31.0 ms, p99 34.9 ms. No decision failed and no `omaha_strategy_rule_failed` fired. The option adds about 13 to 23 ms to a flop decision facing a bet and nothing to any other decision. (The first cut: p99 27.4 / 36.7 ms under a load of 45 to 50.) Sampling error against the margin: CONSTANTS file, section "Sampling" (median 0.013 of the pot against the margin of 0.02; 0.022 at the 90th percentile).

## Evaluation

@@EVAL@@

### The first cut (PR #11210, head 672dbb20509), for the record

This result is of the first cut, not of the build described above.

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

## The rework of 2026-11-18

The first cut merged default OFF with its own cross-check against one player's audited decisions unfavourable (below, and archive `plo-handoff-review-01a1cbbd/flopev-01BNteGZ/FLOPEV-AUDIT-DISAGREEMENT-RESOLUTION-20261117.md`): it folded sets through a product of separate "must also beat him" shares with no pot credit for a player behind and a 0.85 cap, and it called one pair and draws on realization shares carried from the turn. Changed:

- the field is a joint count on the hand's own runouts, a player behind is priced both ways with his call in the pot, the cap is gone;
- the realization model is corrected by measurement, by hand class and position (1,923 production flop calls), shrunk by sample size;
- the pool is four times larger and the runouts are balanced; the sampling error is measured against the margin;
- a bet after the preflop raiser checked is a stab (0.9), not a lead (0.8); whether the raiser was in the hand is read when the bet was made, not when the Horse acts;
- the step at a tenth of the pot behind is a straight line from nothing behind to a pot behind;
- the receipt validator no longer admits a `bet` that became a call (it cannot happen facing a wager).

The 53 audited decisions the first cut changed, joined by node (hand, seat and action ordinal), against the resolution file's math verdicts (archive `flopev2-013U37/replay/TABLE.txt`):

| against the math verdict                  | decisions | what they are                                                                                                                                                                                                                     |
| ----------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fixed (first cut wrong, this build right) | 9         | 3 calls the first cut folded are calls again (59814239, 59823259, 59841112); 6 one-pair folds the first cut called are folds again                                                                                                |
| unchanged, right                          | 19        |                                                                                                                                                                                                                                   |
| unchanged, wrong                          | 14        | 3 calls still folded (59831538 a draw in position against a lead, 59840083 a set with a caller in on a three-flush flop, 59871104 two pair on a paired flop); 11 folds still called (5 one pair or less, 6 draws out of position) |
| newly wrong                               | 1         | 59784847: a draw out of position with a caller in and a player behind, called                                                                                                                                                     |
| open in the resolution file               | 10        |                                                                                                                                                                                                                                   |

Of the 43 with a verdict the first cut was right on 20 and this build on 28. The 12 calls the math verdict rejects (11 kept, 1 new) are draws out of position and single pairs: that verdict rests on 84 calls of one winning player's bets (draws out of position -0.39, one pair -0.03 of their equity); the 1,923 calls against everybody do not show it for draws out of position (1.08 of what the verdict expects, interval 0.69 to 1.49) and show it in part for one pair (0.44 and 0.69). The verdict has no per-opponent realization read: against that one player it still calls hands his numbers say to fold.

The five RC-02a hands (replayed at this build): 59727433, 59756252, 59806482 and 59842423 (top set, two players behind) are calls on the decision's seed and on eight other seeds each. 59710501 (bottom set on 7h 9h Jd, out of position, a caller in and a player behind, price 0.23) is a fold: counted together its share of the pot is 0.23 on the decision's seed (0.28 on an independent count of the same ranges), made hands called out of position returned 0.84 of what the verdict expects (n 515), and its EV is 1.6 to 6.6% of the pot under the margin on all nine seeds. That fold is priced, not a rule; the audit and the resolution file judged it a call.

### A second yardstick: the 48-hour audit's 563 journaled flop decisions

The 48-hour audit of the same tables replays its 563 journaled flop decisions through the whole decision with the recorded production reads and switches (its harness and records, archive `woowoo-48h-audit-01BNteGYgf/repairs/FLOP-DEFENCE/`), and judges the recorded action of each (a model verdict with flat realization factors, not ground truth). Against the serving configuration, with this option on (archive `flopev2-013U37/w8/XTAB.txt`):

| change against the serving configuration               | first cut                     | this build                   |
| ------------------------------------------------------ | ----------------------------- | ---------------------------- |
| audited-bad folds that become a call or a raise        | 40                            | 44                           |
| audited-ok folds that become a call or a raise         | 23 (heads-up 10, multiway 13) | 36 (heads-up 7, multiway 29) |
| audited-ok calls that become folds                     | 23 (heads-up 14, multiway 9)  | 26 (heads-up 23, multiway 3) |
| of those, calls of a strong draw or a strong made hand | 5                             | 4                            |
| audited-bad calls that become folds                    | 1                             | 1                            |

On that audit's verdicts this build is not better than the first cut: it fixes four more bad folds and breaks sixteen more decisions the audit accepted. The two movements are the two things this build changed. Multiway it calls more (the joint field with the pot credit): 29 folds the audit accepted become calls, most of them one pair or a medium made hand. Heads-up it folds more one-pair hands (the measured realization): 23 calls the audit accepted become folds. Production money does not side with the audit on either count where it can be read: recorded calls with other players in returned 1.09 to 1.12 of what the fitted verdict expects (0.99 with two or more players behind; n 912), and recorded one-pair calls returned nothing over their cost (CONSTANTS file). The calls the option ADDS are hands the brain of those days folded: their return is not in any record and is the part no replay settles.

Of the spec's named lists (its section (e)): made hands multiway that must become a continue, 6 of 7 (the first cut 5; the seventh is 59710501); calls that must stay calls, 10 of 23 kept (the first cut 0 of 23); folds that should stay folds unless the fitted realization supports the call, 4 of 9 kept (the first cut 0 of 9).

## Evidence rows

- Mechanism, scope, visibility (flag and receipts in `HorseDataLedger.ts`), tests: MET.
- Option unset or false: every decision byte-identical to the base at the recorded nodes, with and without the production option list (`HorseOmahaFlopFacingBetEv.test.ts`; with the list every byte but `thinkTime`, which `horseActionTimeIsPublicOnly` draws from the timing stream).
- Speed: MET against the 80 ms mark at p99 (table above; 2 of 800 PLO5 decisions over it, one of them a state that is over it without the option), measured under load on the development machine, not on the engine host.
- Value: @@VALUE@@
- Continuation, reach: PARTLY MEASURED, NOT MET. What flop calls returned on the later streets is now measured from production and is in the verdict (CONSTANTS file), on the later-street play of 2026-11-06 to 2026-11-17 and on the calls the brain of those days made, not on the calls this option adds. Not counted in production with the option on.

## Limits

- Measured: the realization cells, the continue rate of a player behind, the stab factor's place, the sampling error. Stated, not measured: the flop value shares and non-value shares (they extend the turn rows of `omahaFacingBetEv`), the caller's range share, the bounds of the runout model, the lead factor. Measured against the hands really left in, the verdict's share of the pot is too high by about five points (0.465 against 0.400 on 1,992 calls): its ranges are too weak on average. The realization cells carry that error for the classes and positions measured; the ranges themselves were not refitted.
- No realization cell is separated from 1 at 95% on its own; one pair or less as a class is (0.59, interval 0.24 to 0.94). The cells are shrunk for that reason. Twelve days of hands.
- The bettor's range has no flop-specific read: the pooled postflop read of the turn and river rule is the one asked, with its value-leader cap. There is no per-opponent realization read.
- The value region is the strongest share of holdings by made hand on the flop. On a paired flop that region is wider than the range the audited player bets there (trips or better on 60% of his paired-flop bets): the verdict calls more there than a read of that player would.
- The count is sampled: a decision within about 1.3% of the pot of its margin (2.2% at the 90th percentile) can differ from an exact count; it is the same decision every time for the same cards.
- No implied odds beyond what the measured cells hold; a player behind who continues is priced as calling, never as raising.
- The receipt validator admits the flop fold or raise that became a call in the rule's spot for the exact chips; it cannot re-run the verdict (the opponent memory is not in the request), as for `omahaFacingBetEv`.
- The first cut's replay of 368 audited flop decisions and its 19-agree / 39-disagree cross-check are superseded by the node-joined table above (the 58 were 53 audited nodes: 19 agreements and 34 disagreements).
