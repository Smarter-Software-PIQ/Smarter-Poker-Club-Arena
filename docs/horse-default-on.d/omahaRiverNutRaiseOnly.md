# omahaRiverNutRaiseOnly (owner ruling 2026-11-14, hand 59401453)

On by default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The pull request that carries this file is the one titled "Omaha river: only the nuts raise a bet; a set pounds the turn"; earlier work it builds on: #9943 (the V15 river raise gate and its scope study) and #10642 (the previous single-hand river repair). Chip amounts are table chips at 1/2 blinds unless marked bb.

This option is turned on by the owner's direct ruling on a reported hand. The value row below does not show the same sign under every range for the fold half of the change; that is stated there and under Limits, not hidden.

## Mechanism

Status: MET

Hand 59401453, PLO5 1/2 cash with a big blind ante, six handed. The Horse held top set on a river board with no pair, no possible flush and three different possible straights. Pot 184; the other player led 184; the Horse had 314.35 behind and moved all in. It was called by the nut straight.

The decision was taken in the low-SPR commitment branch of the facing-a-bet path in `server/src/engine/HorseLogic.ts` (`if (committed)`, the block that ends `return matchedCommitment?.wager ?? { action: 'all_in' }`). At the node: SPR 0.854 (314.35 over the 368 pot), so `committed` is true; pot odds 0.337, required equity 0.357; the estimated equity `eq15` was 0.57 to 0.62 depending on the seed, above the branch's 0.42 jam floor. The branch then jams unless `preferFlat15` names the hand. For Omaha that flag is `nuts15 != null && !nutClass15`, and `nuts15` (`omahaNutStatus`) is only read for straights and flushes (`cat === 5 || cat === 6`). A set is category 4, so no flat rule applied and the hand was re-shoved. The existing opt-in `v55OmahaRiverTripsFlat` names exactly this class and is off in production. No opponent read was needed: the same all-in is produced on 60 of 60 seeds with the opponent memory off and with it on and empty.

The change has two parts.

1. `server/src/engine/HorseOmahaRiverNutRaise.ts`, called in the policy graph's `wager_rules` node after every owner that can raise and before the call-discipline folds. In PLO4, PLO5 and PLO6 high on one board, a river raise or an all-in for more than the call, facing a wager, stands only when the hand is the exact river nuts (`hasRiverNuts`) or one of the engine's existing effective-nut classes: a full house or better that no bigger full house beats (`omahaBoatsAbove`), the nut flush on an unpaired board, the nut straight on an unpaired board with no possible flush (`omahaNutStatus`). Any other raise becomes a call of the wager. If the reference decision was a fold and a later owner raised it, the fold is restored. An all-in that is itself the call is left alone.
2. `HorseOmahaBigBetCalls.ts`: the V81 call discipline gains one river cell, `trips_set_drawy` (a set or trips on a river board where a straight or a flush is possible), in PLO4 and PLO5, under every existing V81 condition (wager of 0.9 pot or more, more than 20bb effective, not a heads-up table, not a bounty event, no chips of the Horse's in this street, call price 0.13 or more, bettor not measured as a postflop over-bluffer) and only when the call leaves chips behind. In the hand, the call the first part leaves is in this cell and folds.

## Input fidelity

Status: MET

The node is the hand's own recorded public snapshot (`server/src/engine/horseComplaints/plo5-top-set-jams-over-a-pot-river-lead.fixture.json`, produced by the complaint pipeline). It carries seats, stacks, street bets, pot, board, legal actions, blinds, ante, dealer, the action history, the table's VPIP floor (50) and its window (30). It does not carry the seat's judged VPIP, the opponent read the worker held, or the second look. The replay was run with the opponent memory off and with it on and empty; the action was the same in both. The bettor's stored profile was read afterwards (read-only, about fifteen minutes after the hand): bet-when-checked-to rate 0.33, which is not the measured over-bluffer class (`isPostflopManiac`); what the worker held at the moment of the decision was not recorded and is not reproduced. The serving release at the time was a7965514; the commitment branch, `preferFlat15` and the V81 cells are the same in it and in the main this change is based on (the two differ in `HorseLogic.ts` by unrelated additions).

## Value

Status: NOT MET
Owner authority: agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 36620b8177ba5e44f4dc503f3f3246504078fbf216682dd7aea8a75da9c00d32

Values at the hand's river node, in chips, relative to folding (0), exact card removal, 200,000 sampled five-card holdings for the bettor. Of all holdings, 33.0% hold a straight (14.6% the nut straight), 11.0% a smaller set, 28.8% two pair, 27.2% less.

| Bettor's pot-sized lead range                     | Calls an all-in with |   Call | All-in | All-in minus call |
| ------------------------------------------------- | -------------------- | -----: | -----: | ----------------: |
| Value only: straights                             | straights            | -184.0 | -314.4 |            -130.4 |
| Polar: straights plus one bluff per two straights | straights            |    0.0 |  -86.9 |             -86.9 |
| Straights, sets and two pair                      | straights and sets   | +117.9 |  +78.5 |             -39.4 |
| Straights, sets and two pair                      | all of them          | +117.9 | +130.1 |             +12.2 |
| Any five cards                                    | two pair or better   | +186.0 | +194.9 |              +8.9 |

Raise against call (part 1): the all-in is worse than the call under the value-only range, the polar range and the strong range in which two pair folds to an all-in. It is better, by 9 to 12 chips with 130 more at risk, only if the bettor both leads the pot with two pair and then calls a pot-sized all-in with all of it. So the sign depends on one continuation frequency (next row); it does not depend on how many bluffs the bettor has, because a bluff folds to the raise exactly as it loses to the call.

Call against fold (part 2): the sign is not the same under every range. The call needs the Horse to be ahead 33.3% of the time. It loses 184 against a value-only range, breaks even against the polar range above and wins against the two wide ranges. Under the rule in the evidence document this half is "not supported" by assumed ranges. What supports it is measured, not assumed: the horses' own river calls in this class, facing 0.9 pot or more, decision EV against folding (`docs/horse-measure/2026-11-02/v81-omaha-call-cells.txt`, rows `trips_set_drawy|pf>=0.9|river`): day A -42.85 bb [-50.10, -35.60] n 96, day B -41.05 bb [-46.77, -35.32] n 75. These are simulated values against assumed ranges and one two-day production measurement on an older release; they are not win rates of this release.

## Continuation

Status: NOT MET
Owner authority: agent-evidence/extreme-archive/plo-handoff-review-01a1cbbd/river-raise-59401453/OWNER-TEXT-20261114-PLO-CHAT-VERBATIM.md sha256 36620b8177ba5e44f4dc503f3f3246504078fbf216682dd7aea8a75da9c00d32

The raise-against-call sign turns on how often a player who led the full pot on the river calls a pot-sized all-in with two pair or a smaller set. That frequency was not measured for this spot. The only measured neighbour is `docs/horse-measure/2026-11-07/v15-river-raise-scope.md`: the horses' own river raises with non-nut hands, raise against fold (not against call), which that document itself says cannot show a raise is better than a call. In those two days non-nut straights that raised won against folding (+15.3 bb n 16, +9.6 bb n 11) and second-nut flushes lost (-31.5 n 28, -32.3 n 20). The owner's ruling is categorical for every non-nut hand; the measurement does not show that every such raise loses against folding, and it cannot compare it with calling.

## Reach

Status: MET

Recorded decisions, read-only, human-facing PLO4/PLO5/PLO6 cash hands on one board outside bomb pots, 2026-11-12 01:30Z to 2026-11-15 01:30Z (3,612 hands): the horses made 701 river decisions facing a wager: 490 folds, 154 calls and 57 raises. Classified at the decision with the rule's own license function, 32 of the 57 raises were licensed (29 the exact nuts, 3 effective nuts) and 25 were not (20 PLO4, 4 PLO5, 1 PLO6): 17 full houses a bigger full house beats, 4 sets or trips on a straight- or flush-possible board, 3 two pair, 1 dominated flush. Those 25 become calls (3.6% of the river decisions facing a wager, 44% of the raises). None was already a call in production by construction. For part 2, 17 calls faced 0.9 pot or more with chips behind; 6 of them (4 PLO4, 2 PLO5) were in the `trips_set_drawy` class and are the ceiling of what the new cell folds, before its other exclusions.

This count is a classification of recorded decisions, not a replay of them with the live inputs: opponent reads, the judged VPIP and the second look are not in the record. Hands with no human seated are not counted. The retained decision nodes this lane holds (7 river nodes of the R3 hands and 106 of the Horse-against-Horse paired-river set) were replayed with the option on and off over 10 seeds: none faces a wager and none changes, which shows only that the rule is silent when no wager is faced.

## Scope

Status: MET

Gated in code (`omahaRiverNutRaiseInScope`) to all of: PLO4, PLO5 or PLO6; the river with five board cards; not Hi-Lo; one board; not fixed limit; not an all-in-or-fold table; a wager to call. Cash and tournaments are both inside (the commitment branch and the value raises run in both). Bomb pots on one board are inside part 1 and outside part 2 (V81 excludes them). Decision-level cases in `HorseOmahaRiverNutRaise.test.ts`: the hand's node, top set, a second-nut straight and top two pair in each of PLO4, PLO5 and PLO6, with the stack all in and with a pot raise on the menu; the nut straight still raises in all three; the all-in that is the call; a river that faces no bet; Hi-Lo unchanged seed for seed; and the scope function refusing Hi-Lo, a second board, fixed limit, all-in-or-fold, the turn and hold'em. Tournaments have no decision-level case of their own in that file; the tournament corpora in `HorseOpponentExploitNeutrality` and `HorseOmahaTournamentPressure` changed under the rule and are held on their historical baselines with the option off. Part 2 is PLO4 and PLO5 only (V81's variants); in PLO6 the call that part 1 leaves is judged by the existing PLO6 river rules.

## Visibility

Status: MET

`omaha_river_non_nut_raise_flatted` fires each time a raise becomes a call, `omaha_river_non_nut_raise_fold_restored` each time a fold is restored, and `v81_river_set_big_bet_fold` each time the new cell folds (it is also counted inside `v81_omaha_big_bet_call_fold`). All three are registered in `HorseDataLedger.ts`. The worker's receipt validator (`horseDecision/responseValidation.ts`) admits the raise-to-call transition in the `wager_rules` node for these three games only with the request, on which it re-runs the rule and requires the same call.

## Limits

Status: MET

- One reported hand. The mechanism is exact; the value figures are simulated against stated ranges.
- The fold half is positive under some assumed ranges and negative under others. It rests on the owner's ruling and on one two-day production measurement of the class on an older release. The river-only variant and format slices of that measurement were not tabulated, so the second half of the V81 admission rule is not shown for this cell.
- The raise half removes raises that an earlier measurement found winning against folding (non-nut straights, third-nut flushes) and raises the engine made on purpose: the small-pot near-nut river raise (V86, and the opt-in `smallPotNearNutRiverValue` candidate) no longer reaches the table when it faces a bet, and an under-full in PLO4, PLO6 and tournaments no longer re-raises. Their tests now hold this option off to keep measuring their own rule and pin the new default beside it.
- The opt-in `riverBluffCheckRaise` arm (off in production) turns a fold into a river bluff raise after this rule has run and is not stopped by it.
- Hi-Lo, multi-board and fixed-limit Omaha are outside the rule.
- The reach count is three days of human-facing hands classified from the record, not a replay.
- Live behaviour is unverified until a release carries this and the receipts above are read.
