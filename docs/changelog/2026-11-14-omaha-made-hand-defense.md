# Omaha turn and river: a made hand a straight or flush beats plays defense

Date: 2026-11-14. Lane: PLO Strategy. Owner-reported hands 59414191 and 59416584 (PLO5 cash), following hand 59401453.

## What happened

- Hand 59414191: a Horse with a set faced a pot-sized lead on the turn card that made straights possible and raised it; on the river, checked to by the player who had led, it bet again.
- Hand 59416584: a Horse with a set bet first to act into the turn card that made a straight possible, and a second Horse with top two pair moved all in over that bet.

The owner's rulings, in substance: Horses must know that straights beat two pair and sets and play defense when the straight card comes; raising there is a call at most; they stop paying off value raises with bluff catchers; and with the nuts they stop betting fractions of the pot.

## Root cause

The same as hand 59401453. The raise, bet and commitment branches of `HorseLogic.ts` compare an equity estimate with a bar, and the nut measure (`omahaNutStatus`) is read only for made straights and flushes, so two pair and sets were never asked whether the board already beats them. V40 caps the bet size of such a hand but does not stop the raise or the bet. The big-bet call folds (V81, V84) did not cover a Horse that already had chips in on the street and was raised.

## What changed

All on by default as a defect repair on the owner's rulings, each with an evidence file. PLO high, one board; Hi-Lo, fixed limit and all-in-or-fold tables are outside.

1. New `server/src/engine/HorseOmahaMadeHandDefense.ts`, in the `wager_rules` node after the river nut-raise rule (option `omahaBeatenMadeHandDefense`; PLO4, PLO5, PLO6). A hand is beaten when a straight or flush is possible on the board and the Horse holds two pair, a set or trips, a non-nut straight (or one under a possible flush) or a non-nut flush. Facing a turn wager a beaten hand never raises: it calls, or folds when the decision was a fold before the later owners ran. The nuts may raise. The river half is the earlier `omahaRiverNutRaiseOnly`.
2. Facing no wager, a beaten hand checks when this street's card made the straight or flush possible and a player still acts behind it, and checks the river when a live player bet or raised an earlier street on which it was already possible. In position and checked to on the fresh card it may still bet large.
3. The rules run after every owner that can raise or bet, so no later stage turns the answer back into a raise or a bet.
4. `HorseOmahaBigBetCalls.ts`, `omahaBluffCatcherCell` (option `omahaBluffCatcherRaiseFold`; PLO4, PLO5): under every V81 condition and with chips behind the call, a bluff catcher folds to a raise of 0.9 pot or more on the river or turn, and to a turn bet of 0.9 pot or more from a player who also bet or raised the flop. Kept as calls: a bettor measured as a postflop over-bluffer, and a turn hand whose redraw to a nut-class hand pays the call price.
5. `omahaNutClassValueSize` (PLO4, PLO5): a bet or raise with the nuts or an effective-nut hand is the pot (the all-in when the stack is smaller) on the flop, turn and river. A wager that already covers every opponent is left alone.

The worker's receipt validator admits the turn raise-to-call transition with the request (it re-runs the rule) and the bet-to-check transition in the form of the paired-board river check. Receipts: `omaha_turn_beaten_raise_flatted`, `omaha_turn_beaten_raise_fold_restored`, `omaha_beaten_fresh_card_check`, `omaha_beaten_river_no_value_bet`, `omaha_bluff_catcher_raise_fold`, `omaha_nut_class_pot_wager`.

## At the hands' nodes (live cash profile, 60 seeds, before is the first fix)

| Node                                                 | Before                                                                       | After          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- | -------------- |
| 59414191 turn, set facing a pot-sized lead           | raise on 51 of 60 with the opponent memory on (call on 60 of 60 with it off) | call 60 of 60  |
| 59414191 river, set checked to by the turn leader    | bet on 60 of 60 (43 of 60 with the opponent memory on)                       | check 60 of 60 |
| 59416584 turn, set first to act on the straight card | bet on 60 of 60                                                              | check 60 of 60 |
| 59416584 turn, top two pair facing that bet          | all in on 60 of 60                                                           | call 60 of 60  |

Hand 59401453 keeps the first fix's answers: the turn bet of 80 to 87 into 100 in position, and the river fold.

## Tests

`HorseOmahaMadeHandDefense.test.ts` and four complaint laws (exact replays, every profile, each with a control that brings the action back with the option off): `plo5-set-raises-a-pot-turn-lead-on-the-straight-card`, `plo5-set-bets-the-river-into-the-turn-leader`, `plo5-set-leads-the-straight-card-out-of-position`, `plo5-top-two-pair-jams-over-a-turn-bet-on-the-straight-card`.

Earlier tests updated, and why:

- `HorseOmahaRiverReraiseCalls.law.test.ts` (V84): its "off is today" arm and its "today" helper hold the new bluff-catcher cell off so the law keeps measuring V84; it now also pins that a river raise after the Horse only called is folded by the new cell.
- `horseComplaints/plo4-straight-jams-flush-river-into-two-callers`: the law is unchanged and still holds. Its non-vacuity control now switches off both rules that stop the jam (`v40Omaha` and `omahaBeatenMadeHandDefense`).
- `HorseOmahaTournamentPressure.test.ts` and `HorseOpponentExploitNeutrality.test-support.ts`: the two historical corpora keep their recorded bytes with the three new options off.

No pinned expectation was changed in `HorseHeadsUpCommitment.test.ts` or `HorsePolicyRegistry.test.ts`; the rules were narrowed instead (the pot size leaves a covering wager alone; "acts behind" also follows the button).

## Evidence and limits

`docs/horse-default-on.d/omahaBeatenMadeHandDefense.md`, `omahaBluffCatcherRaiseFold.md` and `omahaNutClassValueSize.md` answer the eight evidence rows. No value comparison supports the sign of any of the three; they rest on the owner's rulings. Reach: 9 of 38 recorded Horse turn raises facing a wager were made with a beaten hand and become calls; the other rules were not counted in production.

## After the exact-head review (2026-11-15)

`omahaBluffCatcherRaiseFold` ships OFF by default (opt-in): it folds on bet size alone and has no value or continuation measurement, which the owner's 23:10 instruction rules out as a default. Code, receipts and tests stay; the tests switch it on explicitly. `omahaBeatenMadeHandDefense` and `omahaNutClassValueSize` stay ON on the owner's verbatim instruction, now quoted in their evidence files. `omahaRiverNutRaiseOnly` and `omahaTurnSetPound` are unchanged.
