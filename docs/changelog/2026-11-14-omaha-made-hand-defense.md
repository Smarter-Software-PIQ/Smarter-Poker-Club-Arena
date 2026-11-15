# Omaha turn and river: a made hand a straight or flush beats plays defense

Date: 2026-11-14. Lane: PLO Strategy. Owner-reported hands 59414191 and 59416584 (PLO5 cash), following hand 59401453.

## What happened

- Hand 59414191: a Horse with a set faced a pot-sized lead on the turn card that made straights possible and raised it; on the river, checked to by the player who had led, it bet again.
- Hand 59416584: a Horse with a set bet first to act into the turn card that made a straight possible, and a second Horse with top two pair moved all in over that bet.

The owner's rulings, in substance: Horses must know that straights beat two pair and sets and play defense when the straight card comes; raising there is a call at most; they stop paying off value raises with bluff catchers; and with the nuts they stop betting fractions of the pot.

## Root cause

The same as hand 59401453. The raise, bet and commitment branches of `HorseLogic.ts` compare an equity estimate with a bar, and the nut measure (`omahaNutStatus`) is read only for made straights and flushes, so two pair and sets were never asked whether the board already beats them. V40 caps the bet size of such a hand but does not stop the raise or the bet. The big-bet call folds (V81, V84) did not cover a Horse that already had chips in on the street and was raised.

## What changed

On by default: the river nut-raise rule with its price-conditioned set fold cell, and the turn set sizing (both from the earlier change in this branch). OFF by default (opt-in) until a declared paired evaluation passes: `omahaBeatenMadeHandDefense`, `omahaBluffCatcherRaiseFold`, `omahaNutClassValueSize`; each has an evidence file, a league card, receipts and tests. PLO high, one board; Hi-Lo, fixed limit and all-in-or-fold tables are outside.

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

Hand Analysis reviewed the pull request at 1921fa54 and asked for the three unmeasured options to ship off. They do: `omahaBeatenMadeHandDefense`, `omahaBluffCatcherRaiseFold` and `omahaNutClassValueSize` are read `=== true`. Code, receipts, league cards and tests stay; the tests and the four turn and river complaint laws switch the rule on explicitly, and their control is the default brain. `omahaRiverNutRaiseOnly` (river non-nut raise becomes a call; the price-conditioned set fold) and `omahaTurnSetPound` are unchanged and on.

Open PLO Strategy findings, not addressed here: one-pair river bets (hands 59407629, 59430325); one-pair-aces stack-offs (59426444, 59417700); 59431232 and 59435912 have no decision node in this change; the turn and river hands 59414191 and 59416584 are answered only with the opt-in rule switched on.

PLO6 pressure evidence (`HorseV53PressureBehavior`): at 110 hands the PLO6 3-bet counts tied 16 to 16 after this change; at 220 hands the counts are 38 against 33 (PLO6), 38 against 15 (PLO4) and 37 against 31 (PLO5), so the test plays 220 hands. No engine change was made for it; development evidence only.

## Owner's order, 2026-11-15 00:32 America/Chicago

Told that the turn made-hand rule and the nut-class pot size would ship switched off as unmeasured, the owner ordered them into this release switched on. `omahaBeatenMadeHandDefense` and `omahaNutClassValueSize` are therefore read `!== false` (on); their evidence files mark Value and Continuation (and Reach for the size rule) NOT MET with the owner's authority, and say so. `omahaBluffCatcherRaiseFold` stays off (owner 2026-11-14 23:10: no blanket fold). Their league cards are removed with the default; the declared paired evaluation runs outside the league and a failing result switches the option off again. Where this section and an earlier one disagree about on and off, this section is the head's state.

## Off after its evaluation (2026-11-15)

`omahaBeatenMadeHandDefense` failed its declared evaluation (eval3; source 9d9ad486; 200 sessions x 300 pairs per cell): Horses against a loose-aggressive value seat PLO4 -23.73 bb/100 (SE 8.21, z -2.89), PLO5 -16.17 (SE 6.69, z -2.42); development human field pooled -0.72 (SE 1.27). It is read `=== true` again with plo4/plo5 league cards. `omahaRiverNutRaiseOnly`, `omahaTurnSetPound` and `omahaNutClassValueSize` are unchanged. Where this section and an earlier one disagree about on and off, this section is the head's state.

## Nut-class value size off after its evaluation (2026-11-15)

`omahaNutClassValueSize` served on from the owner window 1206z by the owner's order. Its declared re-run with the live-table fields supplied to the league (PROTOCOL-nutsize-2) gained against the development human field (pooled +2.29 bb/100, SE 0.44) and lost on both Horse-only cells (PLO4 -1.19, SE 0.41; PLO5 -1.31, SE 0.59), breaking the declared harm bar. It is read `=== true` again with plo4/plo5 league cards. A default-brain test now pins that neither the made-hand defence nor the nut-class size fires with the options unset.
