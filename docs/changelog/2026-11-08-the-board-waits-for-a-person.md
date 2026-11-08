# The board waits for a person

**2026-11-08.** Dan asked for the number of Spins and Sit & Gos played each day
to come down "to like under 300 per day combined", taken out of the horse
launch schedule.

## What the numbers actually were

Counted on production, by Chicago day, for the seven days to 2026-11-07:

|          | 7-day average | Nov 5-7 (after the engine changeover) |
| -------- | ------------- | ------------------------------------- |
| Spins    | 4,228 a day   | 5,914 a day                           |
| Heads-Up | 3,772 a day   | 5,625 a day                           |
| Combined | ~8,000 a day  | ~11,539 a day                         |

The seven-day average is dragged down by 2026-11-03, on which not a single
Spin or Heads-Up was created or started, and by a very short 2026-11-04. The
three clean days are the real rate.

Of the 55,998 games completed in that week, **seven had a person in them** -
five Spins and two Heads-Up.

## What "Sit N Go" means in this data

Every game the platform records as `tournament_type = 'SNG'` and plays in
volume is a **Heads-Up match**: 2 seats, 32 distinct boards, 17,363 started in
three days. The 6-max and 9-max Sit & Gos are satellites and ran eleven times
in the same three days. So the Sit & Go number in the measurement above, and
the six boards in Dan's instruction, are Heads-Up.

## Why it was eight thousand a day

Two multiplied together.

**The board was every price point, on every owner.** `ensureBoardOpen`
guarantees one joinable instance per config per activated board: 64 Spin
configs and 32 Heads-Up configs, across the house board and each activated
owner. Measured the same day: 134 open seat-first boards.

**Each of those cycled about every six minutes.** A board opened with
`seats - 1` horses - so a Spin appeared on the lobby already one seat from
dealing - and held that last seat for a randomised **90 to 350 seconds**
before the past-start top-up gave it to a horse. 134 boards times ten cycles
an hour is the eight thousand.

The 90-350 second window was itself a widening, made on 2026-09-05 after a
week in which 31,153 Spins ran and four had a human in them. Widening the door
from 150 seconds to 350 did not change the outcome, because the problem was
never the width of the door. A board that deals six minutes after it opens is
not a board a person can walk up to; it is a horse game with a formality in
front of it.

## What it is now

### The waiting ladder

`server/src/config/seatFirstLadder.ts`, carrying Dan's words.

- A board opens with **one** horse, whatever its seat count.
- **Spin:** 60-80 minutes before a second horse sits, then another 30-60
  before the third sits and it deals.
- **Heads-Up:** 3-4 hours before the second horse sits and it deals.

Every rung is randomised per board, for the reason the old window was: a
constant delay makes the whole lobby tick over in lockstep.

The rungs are carried in `start_time`, which is already the instant the engine
treats a board as fillable, so nothing downstream needed teaching. What
changed is that the top-up now takes **one rung at a time** on a horse-only
board (`GameServer.advanceSeatFirstRung`) instead of filling to a full field,
and the board goes back to waiting after each.

### A person overtakes the ladder

`seatFirstHumanPartnerHoldUntilMs` used to hold a seated player's open seats
until the LATER of the board's own window and 90 s after they sat. That was
right when the window was 350 seconds and is wrong now that it is hours: it
would make the one person who actually sat down wait out the entire horse
ladder. The hold is now counted from their seat alone - 3 minutes, 7 at the
outside - which is Dan's rule: "IF A HUMAN SITS AT AN EMPTY TABLE, OTHERS
SHOULD JOIN THE SIT N GO WITHIN 3-7 MIN." The felt's countdown
(`src/utils/seatFirstPartnerHold.ts`) moved with it.

### The board is eleven and six

`SPIN_BOARD_OPEN_TARGET = 11`, `SNG_BOARD_OPEN_TARGET = 6`, platform-wide -
not per club and not per price point. The catalogue is untouched: all 64 Spin
and 32 Heads-Up price points still exist, and which of them are open is drawn
fresh each tick, so the board walks the whole ladder over a day rather than
pinning the cheapest eleven open for ever.

A failed read of the open-board count opens **nothing** that tick rather than
defaulting to "plenty of room", which would re-open the whole catalogue - the
exact failure the target exists to prevent (CLAUDE.md 10.86: a signal that
answers when it does not know).

## The retired third surface

`theClubProgrammeMirrorsTheHouse.test.ts` pinned the 90-350 second rule across
three surfaces, one of which was the SQL in
`20260905104109_the_third_seat_waits_90_to_350_seconds_for_a_human.sql`. That
function, `fn_repair_seat_first_games`, was dropped on 2026-09-08 by
`20260908043450_seat_first_inventory_is_created_atomically` and confirmed
absent from production today. Pinning its text kept a retired rule looking
live; the pin is removed and the two surfaces that remain still move together
or neither does.

## What this is not

It is not a cap, a clock or a throttle. Nothing counts games played and
nothing refuses a launch. The board is narrower and each board waits longer;
the games themselves run at exactly the speed and in exactly the style they
always did - the same rule Dan set for Lightning cash games on 2026-11-05:
"THERE IS NO CAP OR CLOCK THAT SHOULD BE WATCHING THIS, JUST HAVE AND LAUNCH
FEWER GAMES."

## Expected rate

Eleven Spin boards on a roughly two-hour cycle and six Heads-Up boards on a
roughly 3.5-hour cycle is about 130 Spins and 40 Heads-Up a day - call it 170
combined, against Dan's ceiling of 300. The live count is to be measured over
a full day after this ships and reported against that ceiling.
