# Horses are regulars (2026-11-07)

Owner request: cash rooms where horses behave the way people do.

- **Regular schedules.** Every horse has a stable weekly pattern derived from its id
  (`server/src/services/HorseRegulars.ts`): 2-5 sessions a week at one Chicago start
  hour, 3-6 hours each, anchored on the room's own curve (`SECOND_TABLE_RATE` per
  `roomBandAt`), so the sum of every pattern follows the weekend/evening shape.
  The fleet's draw pool is the pattern OR the old daily window (a superset, so no
  table goes short), and a regular inside its hours is drawn first.
- **Home games.** One or two variants and one or two adjacent stakes per horse. Seat
  draws and the horse line on a full game prefer the game's regulars. Ordering only:
  the count seated at every game is unchanged (proved across the production
  `cash_games` set).
- **Decision timing by situation.** `server/src/engine/horseDecisionGravity.ts`
  scores how big a decision is (all-in, big bet, big pot, river, stack at risk) and
  `HorseLogic.computeThinkTime` takes longer on big ones and is quicker on a
  preflop fold or a small-pot check. No new randomness; the engine still caps
  every duration at the action clock and the time bank a person has.
- **Hit and run.** A pattern ending raises the rotator's ordinary session hazard
  (0.7 inside the pattern, 1.3 after it, 1.6 outside both). The departure is the
  rotator's ordinary leave, so a horse in profit that owes hands stays (tested on
  the real rotator).

Engine change: live with the next engine release.
