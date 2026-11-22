# omahaTurnSetPound (owner ruling 2026-11-14, hand 59401453)

On by default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The pull request that carries this file is the one titled "Omaha river: only the nuts raise a bet; a set pounds the turn"; the size rule it changes is V40 (the Omaha made-hand class), last touched for the river in #10642. Chip amounts are table chips at 1/2 blinds.

This option is turned on by the owner's direct ruling on a reported hand ("pound the turn"). The value row is negative under the value-only range; that is stated there and under Limits.

## Mechanism

Status: MET

Hand 59401453, PLO5 1/2 cash, heads-up on the turn. The Horse held top set on a turn board with two clubs on which the turn card made a straight possible. Pot 100, checked to the Horse, which bet 42.

The bet was sized in the strong-value tier of the checked-to path in `server/src/engine/HorseLogic.ts` (`equity >= multiwayValueBar(0.62, oppCount) + ...`). At the node: equity 0.70 to 0.80, wetness 0.48, so `vulnerable` is true and the uncapped fraction is (0.468 + 0.12 + 0.10 + up to 0.15) x 0.86 (the five-card damp) = 0.59 to 0.72 of the pot. It was then capped at 0.5 by `cap40Frac`: `omahaMadeClass` marks a set `weak` wherever a straight or a flush is possible, and V40 sizes a weak class at half the pot or less from the turn on. `betSize` turned 0.5 into 39 to 46 chips over 60 seeds (median 42). With the opponent memory off the same tier checks 28 times in 60, because the fresh straight card reads as `dangered` when the blocker read is absent.

The change: an Omaha high set on a turn board where a straight is possible and no flush is possible (fewer than three of a suit) is `turnSetPound`. In the monster tier and the strong-value tier it bets the monster tier's existing size (the geometric stacks-in-by-the-river fraction when known, `max(sizeBase + 0.2, geomFrac)` plus up to 0.1), without the V40 cap and the five- and six-card damp, and it is not checked back by the trap or the fresh-danger check. At the node that is 81 to 87 chips into 100 on 60 of 60 seeds. Nothing else about the hand is re-read: the equity tiers that send a hand to these two branches are unchanged.

## Input fidelity

Status: MET

The node is the hand's own recorded public snapshot (the complaint fixture, decision 20). It carries the public state and the table's VPIP floor; it does not carry the seat's judged VPIP, the opponent read or the second look. With the opponent memory on and empty the replay reproduces the recorded size (median 42, the recorded bet was 42); board texture and the blocker read come from the cards and are present. The opponent read the worker held is not reproduced; in this branch it enters only through `exploitValueSize`, which multiplies the old and the new size alike.

## Value

Status: NOT MET
Owner authority: agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 36620b8177ba5e44f4dc503f3f3246504078fbf216682dd7aea8a75da9c00d32

Hero's equity at the turn node against classes of the caller's five cards, by exact enumeration of the river (1,200 sampled holdings per class), and the value of a called bet, `equity x (100 + 2 x bet) - bet`, ignoring river betting:

| Caller holds                                | Hero equity | Bet 42 called | Bet 84 called | 84 minus 42 | Equity the caller needs (42 / 84) |
| ------------------------------------------- | ----------: | ------------: | ------------: | ----------: | --------------------------------- |
| Value only: the made straight               |       0.237 |          +1.7 |         -20.4 |       -22.1 | 0.228 / 0.313                     |
| A flush draw, no straight                   |       0.709 |         +88.5 |        +106.1 |       +17.6 | 0.228 / 0.313                     |
| A wrap of eight or more outs, no flush draw |       0.716 |         +89.7 |        +107.8 |       +18.1 | 0.228 / 0.313                     |
| Two pair or a smaller set                   |       0.897 |        +123.1 |        +156.4 |       +33.3 | 0.228 / 0.313                     |

The larger bet is better by 18 to 33 chips against every drawing and worse-made class if they still call, and wins the 100 in the pot outright if they fold (their equity, 0.28 to 0.29, is above the 0.228 a call of 42 needs and below the 0.313 a call of 84 needs). It is worse by 22 chips against a hand that already holds the straight. So the sign is not the same under every range: it is negative under the value-only range. The break-even share of made straights among callers is about 45% against draws that keep calling (17.6 / (17.6 + 22.1)). In the sampled holdings a made straight is much rarer than a draw on this board, but the caller's actual range after a flop call and a turn check is not measured. These are simulated values against assumed ranges with no river play modelled.

## Continuation

Status: NOT MET
Owner authority: agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 36620b8177ba5e44f4dc503f3f3246504078fbf216682dd7aea8a75da9c00d32

Whether draws call or fold to the larger bet was not measured for this spot; both cases are shown and both favour the larger bet against drawing hands. How often a player who check-calls the turn holds the made straight was not measured.

## Reach

Status: NOT MET
Owner authority: agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 36620b8177ba5e44f4dc503f3f3246504078fbf216682dd7aea8a75da9c00d32

Not measured from recorded hands: the retained decision nodes this lane holds are river nodes, and counting turn set bets in production needs a classification of every turn bet that was not run inside the capture window. At the reported node 60 of 60 decisions change (size 39 to 46 becomes 81 to 87). The rule can only touch an Omaha high set that is checked to on the turn, on a board with a possible straight and no possible flush, whose equity already clears the strong-value bar.

## Scope

Status: MET

Gated in code to all of: Omaha, not Hi-Lo, not fixed limit, one board, the turn, `omahaMadeClass` class `set`, a straight possible, no flush possible. Cash and tournaments, heads-up and multiway, PLO4, PLO5 and PLO6 are inside. Decision-level cases in `HorseOmahaRiverNutRaise.test.ts`: the hand's node with the opponent memory off and on; PLO4 and PLO6 sets on the same turn; and three cases that keep today's decisions seed for seed: a turn with three of a suit, top two pair instead of a set, and Hi-Lo. The river, the flop, a facing-a-bet decision and hold'em never reach the two branches with this flag set. Tournaments and multiway pots have no decision-level case of their own.

## Visibility

Status: MET

`omaha_turn_set_pound` fires each time the size is applied (registered in `HorseDataLedger.ts`).

## Limits

Status: MET

- One reported hand and one node. The owner's ruling names the class by example (top set on a straightening two-tone board); the rule applies to every set on a straight-possible turn without three of a suit.
- The value is negative against a caller who already holds the straight and positive against every other class shown. No river play is modelled and the caller's range is assumed.
- Reach in production is not counted.
- The size is the monster tier's existing geometric fraction passed through the existing `betSize`; at this node it is 0.81 to 0.87 of the pot, not the full pot.
- A set on a turn with three of a suit, a set below the strong-value equity bar, trips and two pair keep the V40 small ball.
- Live behaviour is unverified until a release carries this and the receipt is read.
