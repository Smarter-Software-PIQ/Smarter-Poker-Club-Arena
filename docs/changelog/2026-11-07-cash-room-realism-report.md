# 2026-11-07 - The cash room, measured against its own targets; the AI disclosure names what AI opponents now do

Owner request 2026-11-07: "GO AHEAD AND FULLY BUILD, FIX AND ENHANCE ALL OF
THESE AND MAKE SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING
SUCCESS."

1. **`scripts/ops/cash-room-realism-report.mjs`** - a read-only check run on
   demand (no schedule, no alert, no write). Per Chicago hour and weekday, for
   cash games: table fullness, share of games with a second table, waiting-list
   lengths, seat-to-leave session lengths, table opens and breaks, people vs
   horses as aggregate counts only (no account is ever identified). Each metric
   shows the room's target from HorseBehavior.ts (#9875): the 75% seated floor,
   the FULL share per band, the second-table rate per band weighted by game, a
   FULL game's line of 1-4. `--api` reads production through the management
   API with `read_only: true`; `--run` through psql in one `BEGIN READ ONLY`;
   `--sql` prints the query; `--from-json` aggregates a saved reply. Output is
   a text table plus JSON. `tests/unit/cashRoomRealismReport.test.ts` checks the
   aggregation on a fixture and pins every target to HorseBehavior.ts.
2. **The AI-opponent disclosure** (sign-up form, Terms of Service, acceptance
   modal) said only that tables may include AI opponents. AI opponents now also
   buy in, top up, rebuy, sit out, join waiting lists, move between games and
   keep regular hours; the one sentence now says so, and still says nothing
   about which accounts they are. The law test requires each of those named.

   Before: "Tables May Include AI Opponents Run By Smarter.Poker. They Play
   Under Ordinary Player Names, And We Do Not Say Which Seats They Hold."

   After: "Tables May Include AI Opponents Run By Smarter.Poker. Like Any
   Player, They Buy In, Top Up, Rebuy, Sit Out, Join Waiting Lists, Move Between
   Games And Keep Regular Hours. They Play Under Ordinary Player Names, And We Do
   Not Say Which Seats They Hold."

   The Terms carry the sentence, so their "last updated" date moves to
   November 7, 2026 with it (`legalDates.ts`, fingerprints re-recorded in
   `tests/legal-dates-move-with-the-words.law.test.tsx`).
