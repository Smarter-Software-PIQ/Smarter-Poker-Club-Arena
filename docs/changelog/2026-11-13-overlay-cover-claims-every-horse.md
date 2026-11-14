# Overlay cover has first claim on every horse (2026-11-13)

## What happened

Nightly 20K (NLH) `27268410`, started 2026-11-14 01:00 UTC (7:00 PM Chicago),
closed registration with 195 entries, 105 rebuys and 93 add-ons: 12,705 net
credited toward a 20,000 guarantee, and the house posted 7,295. The same event
took 456 entries the night before and 530 the night before that.

## Why (read from production rows)

The overlay guard ran every cycle and asked for horses. It was given almost
none, because the registration pool (`registerHorses`) only offers a horse that
is inside its activity window, not on its rest day and below the four-game
limit. At 7:30 PM Chicago on 2026-11-13:

| Held by                | 2026-11-13                             | 2026-11-12 |
| ---------------------- | -------------------------------------- | ---------- |
| Free Buy               | 440 horses                             | 569 horses |
| Cash tables            | 477 seats, 165 horses (most at 3 to 4) | 33 seats   |
| Rest day (not offered) | 136 horses, 0 entered                  | 62 entered |

- About 510 of 1,000 horses were on shift and not resting. 153 of them entered
  the 20K. The other ~360 were held at the game limit by the Free Buy, the cash
  floor (relaunched 2026-11-11, seated on the work schedule since 2026-11-12)
  and nine other events.
- About 480 off-shift and rest-day horses held nothing and were never offered.
- Entries arrived in bursts at exactly 01:00 and 02:00 UTC, when the hour
  changed which horses were on shift, and dried up within ten minutes each time.
- The final ten-minute rescue asked for 40 a cycle and registered 9 in total.
- Nothing reported it: the "added none" line is a console warning.

## Owner rulings (2026-11-13, 21:03 to 21:08 Chicago)

- "ANY AND ALL HORSES SHOULD BE ACTIVATED AT ALL TIMES, REGUARDLESS OF TIME OFF
  OR DAY OFF IF THERE IS EVER AN OVERLAY THAT NEEDS TO BE FILLED! HORSES MUST
  JUMP IN WITHIN THE LAST 20 MINUTES"
- "HORSES ARE SUPPOSED TO PLAY 2 CASH GAMES AND 2 TOURNAMENTS. NOT 4 CASH
  GAMES. HORSES MUST LEAVE A CASH GAME AND PLAY A TOURNAMENT IF A OVERLAY IS
  POSSIBLE!"

The second supersedes the 2026-09-02 "THEY SHOULD BE PLAYING 4 TABLES AT ONCE"
wording for cash: four games in total, at most two of them cash.

## What changed

1. `HorseOverlayGuard.lateRegisterHorsesOnce` reads net guarantee coverage for
   every running guaranteed event each cycle. While entries are still missing
   the top-up is made with `overlayCover`.
2. `registerHorses(overlayCover)` waives the rest day, the activity window and
   the bankroll temperament (the wallet must still cover the entry). The club
   scope, the four-game limit and the registration door are unchanged.
3. The rescue window is 20 minutes (`OVERLAY_RESCUE_WINDOW_MS`, was 10) and asks
   for everything still missing at once; the 40-per-cycle ceiling no longer
   applies to it.
4. When free horses do not cover the ask, horses at the game limit that are not
   in the event are called (`horseOverlayCover`). The session rotator sends a
   called horse out of one cash seat through the ordinary leave door.
5. `HORSE_MAX_CASH_TABLES = 2`: `remainingGameCapacity` never offers a third
   cash table, and the rotator walks a horse above two cash tables down, one
   exit per table per cycle, owed hands first, never leaving a person short.
6. A cycle that registers fewer horses than overlay cover asked for is reported
   through `reportError` (`HorseOverlayGuard.overlay_cover_short`).

## What this does not do

- The four-game limit is the database's and applies to every player; it is not
  waived. Cover therefore depends on enough horses being below it or able to
  leave a cash seat inside the window.
- A guarantee larger than the whole fleet can fund (1,000 horses, one entry
  each, plus rebuys) can still fall short. The Nightly 20K needs 635 net
  entries at 31.50.
- Tonight's 7,295 is already posted and the pool is final; nothing is taken
  back from players.

## Tests

`horseOverlayCover.test.ts` (new), `horseOverlayRescue.test.ts`,
`HorseGameLoad.test.ts`, `lateRegistrationOutlivesTheGuarantee.law.test.ts`.
Engine change: activates at the 04:00 Chicago release.
