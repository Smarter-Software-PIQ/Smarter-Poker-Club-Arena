# The human window is the whole 3-7 minutes - 2026-11-09

Dan's rule, from the message that started this work:

> "IF A HUMAN SITS AT AN EMPTY TABLE, OTHERS SHOULD JOIN THE SIT N GO WITHIN
> 3-7 MIN."

What shipped yesterday put every fill at **3:00 to 3:30** after the person sat.
That is inside the band and it is not the sentence. The floor was the stated
floor, the ceiling was present but could never bind, and the per-board spread
that was supposed to vary the arrival was 30 seconds wide - twelve and a half
percent of the band, used at its very start.

## Why that is a defect and not a conservative reading

Two reasons, and the second is the one that matters.

1. **It is not what was asked for.** A four minute band used in its first
   thirty seconds is one instant with a little wobble. "Within 3-7 min"
   describes a range of arrivals.

2. **It is the tell the spread exists to remove.** CLAUDE.md 10.5: "TIMING IS
   PART OF THE TREATMENT ... The tell is never one hand, it is the RHYTHM."
   The constant's own header says the fleet must not arrive on the bell,
   because an opponent who lands the same second the countdown hits zero is
   marked as house-supplied by the timing alone. An opponent who lands between
   3:00 and 3:30 after every single human sits down is marked just as surely.
   Thirty seconds of jitter does not hide a rhythm; four minutes does.

## The change

One constant on each side, and the two sides must agree:

```ts
// server/src/services/TournamentRecurringService.ts
export const SEAT_FIRST_HUMAN_PARTNER_HOLD_SPREAD_MS =
  SEAT_FIRST_HUMAN_WINDOW_MAX_MS - SEAT_FIRST_HUMAN_WINDOW_MIN_MS;  // was 30_000

// src/utils/seatFirstPartnerHold.ts
export const SEAT_FIRST_PARTNER_HOLD_SPREAD_MS =
  SEAT_FIRST_PARTNER_HOLD_MAX_MS - SEAT_FIRST_PARTNER_HOLD_MS;      // was 30_000
```

The hold is still `min(ceiling, floor + spread)` with the spread drawn
deterministically from the board id, so every lane and every pass still agree
on one instant per board. What changes is that the draw now covers the whole
band:

| | before | after |
| --- | --- | --- |
| earliest fill after a person sits | 3:00 | 3:00 |
| latest fill | 3:30 | 7:00 |
| band actually used | 30 s of 240 s | all 240 s |
| countdown shown on the table | "Deals In 3:30 At The Latest" | "Deals In 7:00 At The Latest" |

## What it costs, stated plainly

A person can now wait up to seven minutes for an opponent instead of three and
a half. Most boards still fill well before that - the draw is uniform across
the band - and the table names the wait the whole time. "At the latest" stays
literally true, which is the only promise that line makes. If seven minutes
turns out to be too long to sit alone, the fix is to change the band, not to
go back to using its first thirty seconds while claiming the whole of it.

Nothing else moves: the floor, the ceiling, the determinism, the ladder, and
the rule that a seated person is never made to wait out the horse ladder are
all unchanged.

## Tests moved with the behaviour, in the same commit

- `tests/unit/seatFirstPartnerHold.test.ts` - the countdown is 7:00, and the
  source pin follows the constant.
- `server/src/services/aHumansOpponentSeatIsKeptForPeople.test.ts` - the draw
  is asserted to reach both ends of the band across 200 board ids and to stay
  inside it; two cases that used 245 s and 200 s as "the hold is over" now use
  the ceiling plus a minute, because that is the only instant past the hold
  for EVERY board once the draw is four minutes wide. Both were green before
  and red after the constant moved, which is the test doing its job.
