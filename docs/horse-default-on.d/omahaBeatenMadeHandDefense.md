# omahaBeatenMadeHandDefense (owner rulings 2026-11-14, hands 59414191 and 59416584)

Off by default (opt-in, read `=== true`): owner instruction 2026-11-14 23:40 America/Chicago keeps an option off unless both the owner's verbatim authorization and the governing evidence are there; rows 3 to 5 below are not measured. It goes on only after a declared paired evaluation passes and an exact-head review. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The pull request that carries this file is the one titled "Omaha turn and river: a made hand a straight or flush beats plays defense"; it sits on the first fix for hand 59401453 (only the nuts raise an Omaha river bet), and the made-hand class it reads beside, V40, was last touched for the river in #10642. Chip amounts are table chips.

This option is turned on by the owner's direct rulings on two reported hands, as a defect repair. No value comparison of the old and new action was computed; that is stated under Value and Limits.

## Mechanism

Two PLO5 cash hands on one evening. In 59414191 a Horse with a set faced a pot-sized lead on the turn card that made straights possible and raised it, then bet the river when the player who had led checked. In 59416584 a Horse with a set bet first to act into the turn card that made a straight possible, and a second Horse with top two pair moved all in over that bet.

The cause is the one found in hand 59401453. The raise, bet and commitment branches of `server/src/engine/HorseLogic.ts` compare an equity estimate with a bar. The nut measure (`omahaNutStatus`) is read only for made straights and flushes, so two pair and sets were never asked whether the board already beats them. V40 limits the bet size of such a hand; it does not stop the raise or the bet.

The change is `server/src/engine/HorseOmahaMadeHandDefense.ts`, run in the `wager_rules` node right after the river nut-raise rule and before the call-discipline folds. A hand is "beaten" when a made straight or flush is possible on the board (three ranks inside a five-rank window, or three of a suit) and the Horse holds two pair, a set or trips, a straight that is not the nut straight or sits under a possible flush, or a flush that is not the nut flush. For a beaten hand:

- Turn, facing a wager: a raise or an all-in for more than the call becomes a call. When the decision before the later policy owners was a fold, the fold comes back. An all-in that is itself the call is left alone. (The river half is `omahaRiverNutRaiseOnly`.)
- Turn or river, facing no wager: the bet becomes a check when the straight or flush became possible on this street's card and a player who has not acted sits behind the Horse in the betting order; and on the river when a live player bet or raised an earlier street on which that straight or flush was already possible.

In position and checked to on the fresh card, the hand may still bet (hand 59401453's turn).

## Input fidelity

The nodes are the recorded public snapshots of the two hands (the complaint fixtures). They carry the public state and the table's VPIP floor; they do not carry the seat's judged VPIP, the opponent read or the second look. With the opponent memory on and empty the replay reproduces the recorded turn raise of 59414191 on 51 of 60 seeds; with it off the same node calls on 60 of 60, so that raise depended on the memory path being present, not on a read of the bettor. The other three nodes reproduce the recorded action class on 60 of 60 seeds with the memory off. The rule itself reads only the Horse's cards, the board and the public actions.

## Value

Not measured as a comparison of actions. What was computed (sampled opponent holdings against the Horse's hand at the recorded turn boards, exact river enumeration, 1,000 holdings per class):

| Node                           | Against a made straight | Against a better set or two pair | Against a worse set or two pair | Against a draw of eight or more outs |
| ------------------------------ | ----------------------: | -------------------------------: | ------------------------------: | -----------------------------------: |
| 59414191 turn, the set         |                   0.286 |                            0.105 |                           0.850 |                                0.775 |
| 59416584 turn, top two pair    |                   0.131 |                            0.164 |                           0.749 |                                0.706 |
| 59416584 turn, the leading set |                   0.446 |                            0.345 |                           0.921 |                                0.906 |

These are the Horse's equities, not the value of raising against calling. A raise wins more from the worse made hands and draws when they continue and loses more to the made straight; which is larger depends on what the bettor holds after leading or raising the straight card, and that range was not measured. On the river of 59414191, 25% of random five-card holdings beat the set, 9% are a lower set and 32% are two pair; the range that check-calls a river bet after leading the turn was not measured. The sign of the change is therefore unsupported by a value row. It rests on the owner's ruling.

## Continuation

Not measured. How often a player who leads or raises the card that completes a straight holds it, and how often worse hands call a turn raise or a river bet in these lines, were not counted.

## Reach

Recorded Horse turn raises facing a wager in human-facing PLO4, PLO5 and PLO6 cash hands, classified with the rule's own `omahaBeatenByBoard` (a read-only extract; its time window was not written down with the count): 38 raises, 9 of them with a beaten hand (5 PLO4, 3 PLO5, 1 PLO6: 5 sets or trips, 2 two pair, 2 second-nut flushes). Those 9 become calls, 24% of the recorded turn raises. The 29 others (9 nut straights, 8 full houses or better, 5 sets on a board with no straight or flush possible, 6 one pair, 1 no pair) are untouched. The two checking rules were not counted in production. At the four reported nodes the action changes on 60 of 60 seeds.

## Scope

Gated in code to all of: PLO4, PLO5 or PLO6, not Hi-Lo, not fixed limit, one board, not an all-in-or-fold table, the turn or the river, a straight or flush possible on the board, a hand of two pair up to a non-nut flush. Cash and tournaments, heads-up and multiway are inside. Decision-level cases in `HorseOmahaMadeHandDefense.test.ts`: the four reported nodes; PLO4, PLO5 and PLO6 top two pair facing a turn bet; the nut straight still raising and betting; a board with no straight or flush possible unchanged; Hi-Lo unchanged; the flop unchanged; an all-in that is the call unchanged; the set checked to in position still betting. Tournaments and multiway turn pots have no decision-level case of their own.

## Visibility

Receipts registered in `HorseDataLedger.ts`: `omaha_turn_beaten_raise_flatted`, `omaha_turn_beaten_raise_fold_restored`, `omaha_beaten_fresh_card_check`, `omaha_beaten_river_no_value_bet`.

## Limits

- Two reported hands, four nodes. No value comparison and no continuation measurement supports the sign; the owner's ruling does.
- The rule removes semi-bluff and protection raises with a set or two pair on a straight- or flush-possible turn in every line, including against a small bet and against a player who bluffs often. No opponent read is consulted.
- A set or two pair first to act on the card that completes a straight or flush now always checks; it gives a free card to draws.
- "Possible" is a board test (three ranks in a five-rank window, three of a suit). It does not weigh how likely the straight is.
- Reach for the two checking rules is not counted, and the reach window for the turn raises is not recorded.
- Live behaviour is unverified until a release carries this and the receipts are read.

## Owner's instruction, verbatim (PLO Strategy chat, 2026-11-14, America/Chicago)

The owner's own text, exactly as typed; "[...]" marks words left out, nothing is reworded. Full record: evidence archive `plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md`.

- 20:39 (hand 59416584): "[...] WHY IS THE ONE HORSE BETTING ON THAT TURN, AND WHY [...] IS THE OTHER HORSE RAISING TURN ON A CLEAR CALL ONLY.... THEY SHOULD BOTH BE PLAYING DEFENSE OR MORE CAUTIOUS WHEN THE STRAIGHT CARD COMES!"
- 20:40 (hand 59414191): "[...] THE HORSE AGAIN RAISES WHEN CLEARLY THERE IS A STRAIGHT OUT THERE. [...] WHY AREN'T THE HORSES AWARD THAT STRAIGHTS BE TWO PAIRS AND SETS?!?!?!?"
- 22:02: "NO RAISING THE TURN AS WELL WITHOUT THE NUTS OR CLOSE TO THE NUTS! HOW MANY TIMES HAVE I SHOWN YOU A RAISE WITH TOP SET ON THE TURN WITH 2-3 DIFFERENT STRAIGHTS AND OR FLUSHES OUT THERE... STOP THE MADNESS AND THE BLEEDING! [...] FIX THIS NOW"

This option is OFF by default; the owner's words above name the misplay it answers and are not a measurement. Its value, continuation and reach rows are not measured (stated in the rows above); its actions are a call or a check, never a fold.
