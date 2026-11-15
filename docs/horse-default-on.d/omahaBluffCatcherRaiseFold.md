# omahaBluffCatcherRaiseFold (owner ruling 2026-11-14, with hands 59414191 and 59416584)

On by default. Evidence for the eight rows of [HORSE-DECISION-CHANGE-EVIDENCE.md](../HORSE-DECISION-CHANGE-EVIDENCE.md). The pull request that carries this file is the one titled "Omaha turn and river: a made hand a straight or flush beats plays defense"; the rule it extends is V81 (the Omaha big-bet call discipline, `HorseOmahaBigBetCalls.ts`), and the made-hand class beside it, V40, was last touched for the river in #10642.

This option is turned on by the owner's direct ruling ("Horses are calling every one of his value raises with bluff catchers"), as a defect repair. It was not admitted by the V81 measurement and no value row supports it; that is stated under Value and Limits.

## Mechanism

V81 folds a PLO4 or PLO5 call of a bet of 0.9 pot or more only when the Horse has no chips in on the street, and V84 folds one class after the Horse's own river wager. Neither covers the Horse that bet or called on the street and is then raised, and on the turn V81 folds three narrow classes only. So a set, two pair or a lower straight or flush that was raised kept calling.

`omahaBluffCatcherCell` in `server/src/engine/HorseOmahaBigBetCalls.ts` extends the same fold, under every V81 condition (a wager of 0.9 pot or more, more than 20 big blinds effective, not a heads-up table, not a bounty event, not a bomb pot, not Hi-Lo, one board, a call price of 0.13 or more) and only when the call leaves chips behind:

- River, the Horse has chips in on the street and is raised: two pair, a set or trips on a straight- or flush-possible board, a straight that is not the nut straight or sits on a flush or paired board, a flush that is not the nut flush, the nut flush on a paired board.
- Turn, raised, or facing a bet of 0.9 pot or more from a player who also bet or raised the flop: the same classes without the nut flush on a paired board.

Two exceptions keep the call: the bettor is measured as a postflop over-bluffer (the V81 read, never the presumption), and on the turn the share of unseen river cards that make a full house or the nut flush or nut straight is at least the call price. The cell runs after V81 and V84, so a call those already fold keeps their receipt. An all-in-or-fold table is outside it.

## Input fidelity

The cell reads the Horse's cards, the board, the pot, the wager and the public action record, and one stored read (the measured postflop over-bluffer class). Its decision-level cases are built states, not recorded nodes: the replays of the two reported hands do not fire this cell at their complaint nodes. The opponent read at a live table is the worker's and is not reproduced.

## Value

Not measured. The V81 study measured calls made with no chips in on the street; it never observed a call after the Horse's own chips went in (that was its exclusion), and its turn rows for sets and two pair straddle zero over every bettor without a split by the bettor's flop action. No simulation of these cells was run. The sign is unsupported by a value row and rests on the owner's ruling.

## Continuation

Not measured. How often a raise of 0.9 pot or more on the turn or river is a bluff in these games, by bettor class, was not counted for this change beyond the existing over-bluffer read.

## Reach

Not counted from recorded hands. An upper bound from the first fix's count: 17 recorded Horse river calls of 0.9 pot or more with chips behind in three days of human-facing PLO4, PLO5 and PLO6 cash (2026-11-12 01:30Z to 2026-11-15 01:30Z); the share of those that followed the Horse's own chips on the street was not split out. Turn calls were not counted.

## Scope

Gated in code to all of: PLO4 or PLO5, not Hi-Lo, one board, not a bomb pot, not a heads-up table, not a bounty event, not an all-in-or-fold table, the turn or river, a wager of 0.9 pot or more, more than 20 big blinds effective, a call price of 0.13 or more, chips behind the call, the classes listed. PLO6 is outside. Decision-level cases in `HorseOmahaMadeHandDefense.test.ts`: the river classes that fold and the nut straight that does not; every V81 exclusion kept; the turn raise and the big bet from the flop bettor; the priced redraw calling; the bare set folding and calling with the option off; the measured over-bluffer called. `HorseOmahaRiverReraiseCalls.law.test.ts` pins that V84 keeps its own folds and that a river raise after the Horse only called is folded by this cell.

## Visibility

`omaha_bluff_catcher_raise_fold` fires on each fold (registered in `HorseDataLedger.ts`); the fold is also counted inside `v81_omaha_big_bet_call_fold`.

## Limits

- No value measurement. A fold of a set or two pair to every raise of 0.9 pot or more can be exploited by a player who raises as a bluff and has not yet been measured as an over-bluffer.
- The over-bluffer exception needs the stored read; a new opponent has none.
- The turn redraw exception counts outs to a nut-class hand only and ignores implied odds.
- Reach is not counted. Tournaments have no decision-level case of their own.
- Live behaviour is unverified until a release carries this and the receipt is read.
