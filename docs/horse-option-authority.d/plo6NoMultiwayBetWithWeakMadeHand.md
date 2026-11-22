# plo6NoMultiwayBetWithWeakMadeHand: authority for the live switch (OFF-ONLY)

Status: OFF-ONLY (`OPTION_SWITCH_OFF_ONLY`, status `hold` since 2026-11-18 under the owner's 2026-11-17 11:49 America/Chicago no-blanket-rules order). Evidence NOT MET (development evidence only); no owner order to switch this option on is recorded in this file, and the database refuses any `on` row.

## What it does

A PLO6 multiway bet with a weak made hand and no qualifying draw becomes a check. The spot (`plo6MultiwayWeakBetSpot` in `server/src/engine/HorsePlo6MultiwayWeakBet.ts`): six-card Omaha high, pot limit, one board, not a bomb pot, not all-in-or-fold; cash and tournaments; flop or turn; nothing to call and a check legal; two or more live opponents (not folded, not sitting out; an all-in opponent counts). The Horse's best hand is a weak made hand: one pair below the top card of the board (a pocket pair under it, or a pair with a lower board card), two pair without the top card of the board (bottom two pair on the flop; on the turn any two pair that does not hold the board's top rank, so a flop bottom two pair stays in the class after a turn card that does not pair it), the board's own pair with such a pair, or an overpair: a pocket pair above the top card of an unpaired board (added 2026-11-15 on its own measurement, below; on a paired board the same pocket pair is not in the class). It holds no qualifying draw: no nut flush draw, fewer than eight straight outs, fewer than four outs to the nut straight, and no combo draw (a flush draw of any rank together with four or more straight outs; a straight card that also makes the flush is not counted as a straight out, so an open-ended draw with a flush draw reads six). It is not nut class. Then a bet (or a raise or all-in that opens the betting) becomes a check.

It never turns a check into anything and never touches a decision facing a bet, a heads-up pot, the river, PLO4 or PLO5, top pair, an overpair on a paired board, top and any other pair, a set or better, a hand with the qualifying draw or a nut-class hand. It reads the Horse's cards, the board and the public seats; no opponent read; no random number.

The overpair class is not PLO Strategy's `omahaBareOverpairOopFlopCheck` (`HorseOmahaOopChecks.ts`). That option is PLO4 and PLO5 cash, the flop only, the Horse the last preflop aggressor and out of position (heads-up or multiway, with a heads-up continuation after its check), and any flush draw keeps its bet. This class is PLO6, flop and turn, two or more opponents, any position, with the betting lead or without it, and uses this option's own draw test. Neither acts in the other's games.

Where it runs: first in `omahaOwnBetRules` (`HorseLogic.ts`, both decision paths), with the owner-ruled own-bet checks, so the pricing rules never see the bet; `omahaOwnerRuledFinal` keeps the check when a later rule proposes a bet in the spot (receipt `omaha_owner_ruled_check_kept`). The decision receiver admits the bet-to-check transition only in PLO6 and, when the request is known, only where the spot re-run on it holds (`responseValidation.ts`).

Default OFF in source (read `=== true`). Initially registered in migration `20261116074500_horse_option_switch_plo6_strategy`, then locked in `OPTION_SWITCH_OFF_ONLY` (status `hold`) by migration `20261119144317_horse_option_switch_off_only_reraise_flop_fl_plo6` under the owner's 2026-11-17 11:49 no-blanket-rules order (see `## Off-only` below). Both the engine registry and the database refuse any `on` row; any replacement must be a priced comparison (such as dark `plo6MultiwayBetIsPriced` work) that passes its own declared evaluation.

## The owner's orders it rests on (cited by file, not quoted)

- Owner order to the PLO6 lane, 2026-11-15 13:37 and 15:42 America/Chicago (bring the PLO Strategy work to PLO6; build what is unfinished): recorded in the PLO6 archive checkpoint, `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/CHECKPOINT.md`, entries 2026-11-15T19:59:19Z and 2026-11-15T21:53:52Z. The checkpoint records the orders in the lane's words; the owner's own text is not copied here.
- The owner's principles of 2026-11-15 for the Omaha strategy work (the verbatim texts): `agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261115-1000-PLO-CHAT-VERBATIM.md`.

Neither file is an order to switch this option on. That order, when given, is recorded here with its time before any `on` row cites this file.

## Recorded hands it answers

The PLO6 human-table sweep, family D2 (`agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/SWEEP-PLO6.md`, section 2 row 1; 45 bets in 43 hands, hand net -1,005.5 bb):

58871344, 58718499, 58462589, 58723936, 58469752, 59285463, 58698748, 58409374, 58722129, 59544392, 58928618, 58906290, 58406317, 58740649, 58731525, 58753437, 58738906, 58718726, 58466272, 58721646, 58904916, 58734090, 58730197, 58718987, 58752745, 58740938, 58733475, 58729480, 58723402, 58728500, 58717395, 58461204, 58692649, 58719791, 58893007, 58897376, 58722787, 58895243, 58720340, 58734903, 58725374, 58463364, 58716315

The overpair class (28 bets in 26 hands, hand net -1,008.2 bb; measured 2026-11-15, the archive note's section 13):

58405783, 58697247, 58721553, 58722543, 58723241, 58727391, 58728245, 58729617, 58729940, 58730666, 58730792, 58731076, 58732321, 58738760, 58741169, 58747694, 58748025, 58753918, 58754166, 58754352, 58754410, 58754878, 58882392, 58897639, 58902937, 58998763

## Receipts

plo6_multiway_weak_made_hand_bet_checked (one receipt: the rule reads no opponent, so it has no withheld state). A default-off option production does not set is silent.

## Tests

`HorsePlo6MultiwayWeakBet.test.ts` (the rule's own cases, among them the combo draw kept, the bare flush draw and the bare gutshot checked, two pair the same class on the flop and the turn, the rule's own game-name check tested alone, and the overpair: checked three-way with no draw on the flop and the turn, kept heads-up, kept with each of the four qualifying draws, not in the class on a paired board, with a set, top pair and top two pair untouched), `HorsePlo6MultiwayWeakBetWiring.test.ts` (through `HorseLogic.decide`: unset equals false at every seed with no receipt; on, every bet in the spot becomes a check and the receipt fires once per bet; no change heads-up, in PLO5, facing a bet, with the nut flush draw, with a nut-class hand; a later rule's bet does not stand), `responseValidation.test.ts` (the admitted and refused transitions).

## Measured (development evidence, unevaluated)

Population: every Horse decision with a person live in PLO6 cash, 2026-11-10T21:30Z to 2026-11-15T20:05Z: 912 hands, 7 persons, one person in 667 of the hands. "Net" is the Horse's whole-hand result, a hand counted once per row. Source: `agent-evidence/extreme-archive/plo6-audit-01TLQer9Hdf/phase1-play/plo-port-20261115/MULTIWAY-WEAK-BET-WIRING.md`, section 9 and its section "After pre-review" (2026-11-15). The rows below are re-measured on the same hands with the final conditions (after the pre-review fixes: the combo draw keeps the bet; two pair without the top card is one class on the flop and the turn). Before the fixes the option removed 62 bets in 58 hands, -1,403.7 bb (lost 41 hands -1,825.9, won 17 hands +422.2, 4.33). The combo line keeps 3 of those bets (+15.6 bb: lost 1 hand -41.0, won 2 hands +56.6); the turn two-pair class removes 3 more turn bets (-305.1 bb, all three hands lost). The two fixes were decided on the poker in review, not chosen on these numbers.

| set                                                      | bets | hands | net bb   | lost (hands, bb) | won (hands, bb) | lost to won |
| -------------------------------------------------------- | ---- | ----- | -------- | ---------------- | --------------- | ----------- |
| every multiway flop or turn bet                          | 454  | 402   | +3,827.4 | 173, -11,491.2   | 229, +15,318.6  | 0.75        |
| sweep family D2                                          | 45   | 43    | -1,005.5 | 29, -1,470.8     | 14, +465.4      | 3.16        |
| the option removes                                       | 62   | 59    | -1,706.9 | 43, -2,089.9     | 16, +383.0      | 5.46        |
| of them, on the flop                                     | 42   | 42    | -1,259.6 | 30, -1,530.6     | 12, +271.0      | 5.65        |
| of them, on the turn                                     | 20   | 20    | -493.5   | 15, -615.7       | 5, +122.2       | 5.04        |
| of them, in D2                                           | 41   | 39    | -1,142.7 | 28, -1,455.8     | 11, +313.1      | 4.65        |
| of them, not in D2 (the cost side of the wider class)    | 21   | 20    | -564.2   | 15, -634.1       | 5, +70.0        | 9.06        |
| D2 bets the option keeps (nut-straight outs, combo draw) | 4    | 4     | +137.3   | 1, -15.0         | 3, +152.3       | 0.10        |
| the same weak hands, kept by the draw                    | 44   | 42    | -180.1   | 22, -1,062.7     | 20, +882.5      | 1.20        |
| every other multiway flop or turn bet (untouched)        | 392  | 349   | +5,187.2 | 135, -9,765.9    | 214, +14,953.0  | 0.65        |

The Horses already check this spot 302 times in the window against the 62 bets. Of the 62 removed bets, 57 had exactly one person live.

The table above is the five classes built first, without the overpair. The overpair was measured afterwards on the same hands with the same method and the module's own functions, before it was built (the archive note's section 13). A multiway flop or turn bet with a pocket pair above the top card of an unpaired board, one pair the best hand:

| set                                             | bets | hands | net bb   | lost (hands, bb) | won (hands, bb) | lost to won |
| ----------------------------------------------- | ---- | ----- | -------- | ---------------- | --------------- | ----------- |
| every such overpair bet                         | 44   | 41    | -810.7   | 21, -1,746.2     | 20, +935.5      | 1.87        |
| with no qualifying draw (the class removes)     | 28   | 26    | -1,008.2 | 15, -1,406.3     | 11, +398.1      | 3.53        |
| kept by the draw (the cost side avoided)        | 16   | 16    | +276.3   | 6, -339.9        | 10, +616.2      | 0.55        |
| removed, on the flop                            | 26   | 26    | -1,008.2 | 15, -1,406.3     | 11, +398.1      | 3.53        |
| removed, on the turn (both hands also bet flop) | 2    | 2     | -229.4   | 2, -229.4        | 0, 0.0          | n/a         |
| removed, aces                                   | 11   | 10    | -419.5   | 6, -506.9        | 4, +87.4        | 5.80        |
| removed, kings                                  | 10   | 9     | -466.6   | 5, -644.8        | 4, +178.2       | 3.62        |
| removed, queens or lower                        | 7    | 7     | -122.0   | 4, -254.6        | 3, +132.5       | 1.92        |
| removed, two opponents                          | 16   | 14    | -891.3   | 10, -1,038.0     | 4, +146.7       | 7.08        |
| removed, three or more opponents                | 12   | 12    | -116.9   | 5, -368.3        | 7, +251.4       | 1.46        |
| removed, dry board                              | 8    | 8     | -500.2   | 6, -601.5        | 2, +101.3       | 5.94        |
| removed, two-tone, monotone or connected board  | 20   | 20    | -737.4   | 11, -1,034.1     | 9, +296.8       | 3.48        |
| removed, pot under 12 bb                        | 1    | 1     | -9.3     | 1, -9.3          | 0, 0.0          | n/a         |
| removed, pot 12 to 25 bb                        | 14   | 14    | -401.7   | 8, -560.9        | 6, +159.2       | 3.52        |
| removed, pot over 25 bb                         | 13   | 13    | -826.6   | 8, -1,065.4      | 5, +238.9       | 4.46        |
| removed, answered: everyone folded              | 5    | 5     | +90.9    | 0, 0.0           | 5, +90.9        | 0.00        |
| removed, answered: called                       | 17   | 15    | -621.8   | 11, -881.7       | 4, +260.0       | 3.39        |
| removed, answered: raised                       | 6    | 6     | -477.3   | 4, -524.5        | 2, +47.2        | 11.10       |
| overpair on a paired board, no draw (NOT in)    | 4    | 4     | +257.1   | 0, 0.0           | 4, +257.1       | 0.00        |
| the same overpair bet heads-up (NOT in)         | 27   | 25    | +213.3   | 10, -609.7       | 15, +823.0      | 0.74        |

A dry board is three suits and no three ranks inside five. The bar was stated before any cell was read: build only if the removed set loses at least 2.0 to 1 on at least 20 bets, and no cell of 8 or more bets known at the decision (street, rank, opponents, board, pot) has a ratio under 1.0. It was met with no exclusion; the weakest such cell is three or more opponents (1.46). Of the 28 removed bets, 25 had exactly one person live, and the person who sits in 667 of the 912 hands was live at 25.

The final rule, the five classes and the overpair together:

| set                                               | bets | hands | net bb   | lost (hands, bb) | won (hands, bb) | lost to won |
| ------------------------------------------------- | ---- | ----- | -------- | ---------------- | --------------- | ----------- |
| the option removes                                | 90   | 85    | -2,715.1 | 58, -3,496.2     | 27, +781.1      | 4.48        |
| of them, on the flop                              | 68   | 68    | -2,267.8 | 45, -2,936.9     | 23, +669.1      | 4.39        |
| of them, on the turn                              | 22   | 22    | -722.9   | 17, -845.1       | 5, +122.2       | 6.91        |
| of them, two opponents                            | 43   | 40    | -1,903.4 | 29, -2,273.9     | 11, +370.5      | 6.14        |
| of them, three or more opponents                  | 47   | 47    | -868.1   | 31, -1,278.7     | 16, +410.6      | 3.11        |
| of them, answered: everyone folded                | 12   | 12    | +159.6   | 0, 0.0           | 12, +159.6      | 0.00        |
| the same hands, kept by the draw                  | 60   | 58    | +96.2    | 28, -1,402.6     | 30, +1,498.8    | 0.94        |
| every other multiway flop or turn bet (untouched) | 364  | 327   | +6,143.5 | 122, -8,584.3    | 205, +14,727.8  | 0.58        |

The Horses already check the final spot 363 times in the window against the 90 bets. Of the 90 removed bets, 82 had exactly one person live, and the person who sits in 667 of the hands was live at 74.

## Evidence rows

- Mechanism, scope, visibility (flag and receipt in `HorseDataLedger.ts`), tests: MET.
- Option unset or false: the decision is identical to the base at every seed of the wiring test's spots, and no receipt fires. The lane's decision-digest pin on PLO6 cells is not recorded here.
- Value: NOT MET. Development evidence only (the tables above): 90 bets, -2,715.1 bb net removed against +781.1 bb of winning hands removed, lost to won 4.48 (without the overpair 62 bets, -1,706.9 bb, 5.46). No paired evaluation has been run.
- Continuation: NOT MET. What the checked hand does on the next street, and what a check wins where the bet took the pot (12 of the 90 bets), is not measured.
- Reach: NOT MET. 90 bets in 912 hands, 7 persons, one person in 667 of the hands; not counted in production; league card `plo6_no_multiway_bet_with_weak_made_hand` (six seats, production personas) has not been run as an evaluation; a 600-pair reach check (seed 20261115) diverged in 14 pairs, and in 14 again after the pre-review fixes, so the league reaches the spot (not re-run after the overpair class was added).

## Limits

- Five days, 912 cash hands, 7 persons, one person in 667 hands: mostly one opponent.
- Whole-hand results, not the value of the bet; all-in luck not removed; rake as recorded; no solver grade; no counterfactual.
- The conditions were chosen on the same hands they are measured on. Cells under about 10 bets are not stable; the draw thresholds (eight straight outs, four nut-straight outs) rest on cells of 4 to 19 bets, and the combo line (a flush draw with four or more straight outs) on 3 bets; the combo line and the turn two-pair class come from review of the poker, and their cells (3 bets each) are too small to support or refute them.
- No opponent read: the rule cannot tell a player who calls everything from one who folds.
- An all-in opponent counts as live: a pot against one opponent who can still act and one who is all in is multiway for this rule, although only one player can answer the bet. Not measured apart.
- Tournaments are admitted on the argument that a check adds no chips, not on evidence (3 such bets in 2 hands in the window, +23.4 bb).
- The nut flush draw keeps the bet although the 11 such bets in the window lost (-274.7 bb): owed to the evaluation.
- The overpair class passed a screen, not an evaluation: 28 bets, cells of 1 to 26 bets, 25 of the 28 against the same one person. Cells under 8 bets that won and are removed all the same: queens or lower on a two-tone, monotone or connected board (6 bets, +50.0 bb), kings against three or more opponents (4 bets, +17.4 bb), a flush draw that is not to the nuts with one to three straight outs (4 bets, +118.7 bb). Against three or more opponents the class is close to even (12 bets, -116.9 bb, 1.46).
- Outside the option and not built: the same hands bet heads-up (21 bets, -413.6 bb; with the overpair 48 bets, -200.3 bb, the overpair alone +213.3 bb) and on the river (3 bets, -80.1 bb, not re-measured with the overpair).

Scope, stated plainly: the rule acts in every PLO6 high game that reaches the spot, tournaments included (3 of the measured bets were tournament bets) and Lightning PLO6 cash if such a table exists; nothing in the option excludes either. A check adds no chips in any of them.

Out-of-sample check, 2026-11-16 (bar written before reading: lost:won ratio at least 2.0, net negative, at least 20 removed bets; archive `phase1-play/plo-port-20261115/FRESH-SAMPLE-20261116.md`): INSUFFICIENT in both sets. After the development window (to 2026-11-16T04:36Z): 162 cash hands, 3 removed bets in 2 hands, net -219.8 bb. Before it (2026-08-19 to 2026-11-10T21:30Z): 845 hands, 4 removed bets in 4 hands, net -19.8 bb, ratio 1.95. The direction agrees with the rule; the size of the development leak is not confirmed, and the spot is much rarer outside the development window (5.7% and 2.4% of candidate bets against 19.8%). The value row stays NOT MET; default OFF.

## Off-only (categorical, 2026-11-18)

It decides by hand class, player count and street with no price ("a check has no price to weigh"), which the owner's no-blanket-rules order of 2026-11-17 11:49 Chicago rules out; it fired 0 times in 7 days and its league run was -0.44 (SE 2) (horse-switch swarm, PLO6-HILO VERDICT-READY items 1 and 16). It is now in OPTION_SWITCH_OFF_ONLY (status `hold`). Production read 2026-11-19T00:05Z (SELECT only): no option-switch row for it. The follow-up list migration `20261119144317_horse_option_switch_off_only_reraise_flop_fl_plo6` re-asserts the database lists so the table refuses an `on` row. It comes back only as a priced comparison that passes its own declared evaluation.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
