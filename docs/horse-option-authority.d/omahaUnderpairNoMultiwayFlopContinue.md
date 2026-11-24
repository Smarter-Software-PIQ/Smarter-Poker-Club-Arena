# omahaUnderpairNoMultiwayFlopContinue: authority for the live switch

**State: OFF** in production since `2026-11-22T23:07:17Z` (`audit #184`; see "Live switch" at the end). Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET; a live read is owed after the release.

## What it does

On an unpaired flop facing a bet and a call, one pair below the top card with no real draw folds.

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: omahaUnderpairNoMultiwayFlopContinue docs/horse-option-authority.d/omahaUnderpairNoMultiwayFlopContinue.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

59518335

## Receipts

omaha_underpair_no_multiway_flop_continue, \_priced_in

## Tests

HorseOmahaUnderpair.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No evaluation was run (evaluation NOT RUN); a live read is owed after the release.

## Limits

Multiway (bet and a call) only; heads-up flops untouched.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Live switch, 2026-11-22: off (audit #184)

2026-11-24 (recording a write of 2026-11-22): switched off at `2026-11-22T23:07:17Z` (audit #184) by the owner-ordered reset to the pre-lead-4 switch state (owner 3:55 PM and 4:43 PM CST Nov 22); it reverses audit #176 (lead-4 on); restores lead-2 audit #169. Why, as the audit note records: blanket rule removal: the replay changed 0 decisions; the rule is a blanket fold, which the owner's order of 2026-11-17 (no blanket rule decides) retires. Evidence: the audit note of ca_horse_style_switch_audit #184 and the lead-5 pre-notice in `/Volumes/SmarterArchives/agent-evidence/COORDINATION-INBOX.md`. The "a live read is owed after the release" line above no longer applies while it is off.
