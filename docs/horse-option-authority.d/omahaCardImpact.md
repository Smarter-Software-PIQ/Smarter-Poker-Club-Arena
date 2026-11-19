# omahaCardImpact: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

PLO4/PLO5 cash heads-up turn or river with nothing to call: the chosen check or bet is priced beside a check and every bet size against the opponent's range as the last card left it, and the best replaces it above a margin. Acts only where no owner-ruled check acted; never checks or shrinks a nut-class wager.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaCardImpact docs/horse-option-authority.d/omahaCardImpact.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

59517323, 59521326 (owner 2026-11-15 11:41)

## Receipts

omaha_card_impact_changed, \_defence_check, \_press_bet, \_freeroll_pot

A receipt describes the final action (2026-11-15 follow-up): a verdict a later rule can still overturn is proposed and settled when the decision is final; its receipt fires when the final action is the verdict, and its `_vetoed` twin fires when a later rule replaced it. Vetoed twins: omaha_card_impact_defence_check_vetoed, omaha_card_impact_press_bet_vetoed, omaha_card_impact_freeroll_pot_vetoed, omaha_card_impact_resized_vetoed (omaha_card_impact_changed fires only with a verdict that stood).

omaha_card_impact_paired_board_press_withheld: on a paired turn or river board, with less than a full house, against measured postflop value leaders, the comparison creates no bet and makes none bigger.

omaha_owner_approved_bet_kept: the comparison proposed another size for a bet the owner rules had let through, and an owner-ruled check rule, the made-hand defence or the street plan refuses that size; the bet stands at the size it had (beside omaha_owner_ruled_check_kept and omaha_nut_class_wager_kept).

## Tests

HorseOmahaCardImpact.test.ts, HorseOmahaStrategyPrecedence.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

Keeps its own opponent-range sampler (not unified with omahaFacingBetEv: known duplication, follow-up). Multiway, flop and facing-bet decisions are outside. Turn cost 35-50 ms measured by the builder under load.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)
