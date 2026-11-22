# horseActionTimeIsPublicOnly: authority for the live switch

Owner order of 2026-11-15 12:10 America/Chicago. Evidence NOT MET (no `--row` replay run; activated `owner_forced`). LIVE ON (`owner_forced`) 2026-11-16T02:55:24Z (evidence `#10`, serving `3529e866`), verified `32/32` sha match + `0` exceptions/illegal/refusals over `38,664` decisions (max `277 ms`), re-verified live on `8/8` workers and in `2026-11-21T20:00Z` prod switch snapshot.

## What it does

The time a Horse takes is a function of public information only (all games).

Default OFF in source (read `=== true`). On live only by an option-switch row whose note cites this file and its sha256 (`authority: horseActionTimeIsPublicOnly docs/horse-option-authority.d/horseActionTimeIsPublicOnly.md sha256 <digest>`). The maintained rollback (switch row off, about 30 s) applies if harm is established.

## The owner's orders it rests on (verbatim)

- 2026-11-15 12:06: "BRO YOU HAVE THESE BUILT, THEY NEED TO BE IMPLIMENTED AND TURNED ON... THEY CAN BE TESTED IN REAL TIME AGAINST THE HUMANS AND YOU CAN RUN ANY AND ALL TESTS IN THE BACKGROUND AND MAKE CHANGES AND CORRECTIONS AS WE FIND THEM... WE HAVE TO GET THE CHANGES AND CORRECTIONS LIVE NOW WITH AN MUCH EARILER CUT OVER FOR PLO AND HOLDEM"
- 2026-11-15 12:10: "NO YOU NEED TO LAUNCH EVERYTHING EVERY SINGLE THING WE IMPROVED AND BUILT AND TALKED ABOUT... GET IT ALL LAUNCHED AS SOON AS POSSIBLE FOR PLO AND HOLDEM, EVEN IF IT TAKES A COUPLE MORE HOURS TO GET IT DONE, IT HAS TO BE ALL TOGETHER, ACTIVATED, THEN WE CAN DO REAL TIME TESTING AGAINST HUMANS AND INSIDE YOUR TEST ARENA"

## Recorded hands and rulings it answers

timing lane 2026-11-15

## Receipts

see ledger

## Tests

HorseActionTimePublicOnly.test.ts, aHorseActionTimeIsPublicInformationOnly.law.test.ts (all pass on the PLO strategy head; server tsc 0).

## Evidence rows

- Mechanism, scope, visibility (receipts in HorseDataLedger.ts), tests: MET.
- Option unset or false: decisions identical to the base (decision digest pin, plo4/plo5 x dev/horse, 150 pairs, seed 5560001: every option false at 55260db1f62 equals a5935a1a61e unset on all four cells).
- Value, continuation, reach: NOT MET. No offline league evaluation was run (evaluation NOT RUN). LIVE ON (`owner_forced`) 2026-11-16T02:55:24Z (evidence `#10`, serving `3529e866`), verified `32/32` sha match + `0` exceptions/illegal/refusals over `38,664` decisions (max `277 ms`), re-verified live on `8/8` workers and in `2026-11-21T20:00Z` prod switch snapshot.

## Limits

Global: all games, not PLO only.

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: NOT RUN (as of 2026-11-19 no replay of this option on real audited decisions, off against on, scored by server/scripts/audited-decision-replay.ts with --row, is recorded for it)

## Rollback

If enabled, set `horseActionTimeIsPublicOnly` to `off` via the `horse-option-switch` CLI (`fn_ca_horse_option_switch_set('horseActionTimeIsPublicOnly', 'off', '<actor>', '<reason>')`) to restore the base brain within ~30s; zero data migration needed.
