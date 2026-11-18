# omahaReraisedPotFlopContinueNeedsEquityShape: authority for the live switch (OFF-ONLY)

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

On the flop of a re-raised pot the Horse called, a continue stands only when the flop cell keeps it.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaReraisedPotFlopContinueNeedsEquityShape docs/horse-option-authority.d/omahaReraisedPotFlopContinueNeedsEquityShape.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

owner 2026-11-15 11:49 and 11:51

## Receipts

see ledger

## Tests

HorseOmahaOopReraisedPot.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Off-only (measured harm, 2026-11-18)

Switched OFF live at 2026-11-18T01:42:08Z (switch audit row 69) for measured harm on real hands: its rule `omaha_reraised_flop_continue_folded` took heads-up flop folds in re-raised pots from 9 of 30 to 37 of 69; switching it off removes 15 of 15 of its folds, 13 audited wrong or questionable, and breaks 0 audited-correct calls or raises (WooWoo 48-hour audit, SWITCH-AUDIT.md anomaly 5; repairs/FLOP-DEFENCE/ATTRIBUTION.md).

It is now in OPTION_SWITCH_OFF_ONLY (status `harm`) and OPTION_SWITCH_RELEASE_DEFAULT_OFF. The follow-up list migration `20261118154252_horse_option_switch_reraised_flop_shape_off_only` re-asserts the database lists so the table refuses an `on` row from any writer; it writes no switch row and raises if the row is `on` when it installs. The earlier evidence rows and digest of this file no longer authorise `on`. The rule comes back only as a new option with a priced replacement that passes its declared evaluation.
