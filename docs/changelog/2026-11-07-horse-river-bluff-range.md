# 2026-11-07 - The baseline river bluff range (Hold'em and PLO)

Owner instruction (Dan, 2026-11-06 20:52 Chicago): "MAKE SURE THAT YOU FULLY
UPGRADE ENHANCE, OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION
FOR BOTH HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING
THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR
QUALIFIED CANDITATES OR SITUATIONS." A regular had just written "paid two
people off. Have to remember rarely any bluffs on here."

## Measured before the change (production, read-only)

`hand_history`, 12 hours to about 02:00 UTC 2026-11-07, horse river decisions
with nothing to call (`publicNode.toCall = 0`), heads-up by live seats:

| variant | HU spots checked to / first in | bet % | air share of HU river bets* | high card or one pair at showdown, of bets shown down |
| ------- | ------------------------------ | ----- | --------------------------- | ----------------------------------------------------- |
| nlh     | 25,586                         | 30.5  | 24.3%                       | 1,115 of 3,020 (36.9%; high card only 4.5%)           |
| plo4    | 15,681                         | 30.5  | 7.8%                        | 125 of 1,537 (8.1%)                                   |
| plo5    | 2,283                          | 34.0  | 1.5%                        | 9 of 262 (3.4%)                                       |
| plo6    | 704                            | 47.7  | 1.4%                        | 1 of 72 (1.4%)                                        |
| plo8    | 300                            | 28.7  | 10.0%                       | 4 of 40                                               |

\* air = no hole rank paired with the board, no pocket pair, no flush (the
sample with recorded hole cards). With air, Hold'em horses bet 12.8% of the
time and PLO4 12.0%.

`horse_brain_telemetry`, three days: `v53_river_bluff` 105 and
`v53_river_scare_bluff` 167 fires against about 98,000 Phase 10 river
decisions; no `v54_*` receipt at all (default off); `v17_river_probe` none
(opt-in); `v30_gto_river_open` 16,793.

## Every gate between a qualified candidate and a bet (HorseLogic.ts)

| gate                                                                        | verdict                                                                                                                                                                               | action                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| V54 targeted river bluff (`opts.v54RiverBluff === true`)                    | default-off candidate behind the feature authority; no league evidence                                                                                                                | left opt-in; its good parts (blockers, story, capped range, balanced cap, station check) are subsumed by the baseline          |
| V29/V30 GTO river cell (NLH, HU, hero initiative)                           | DEFECT for air: the cell is a class mean over every board and checks a missed draw whose class average has showdown value (the V58 comment documents the same failure for made hands) | the baseline now decides air before the cell                                                                                   |
| V11 initiative gate                                                         | river probe after the aggressor checks the turn back was impossible OOP (`prevChecked` is turn-only)                                                                                  | the baseline owns checked-through turns, OOP included; OOP leads into the turn bettor on a blank stay checked (correct)        |
| V53 over-folder river bluff                                                 | read-gated: no credible river-fold read, zero                                                                                                                                         | kept as a read-driven floor inside the baseline                                                                                |
| V7 barrel continuation and "one-and-done give up" (80% check)               | needs a recorded plan; solver and value bets record none                                                                                                                              | the baseline owns the river barrel; an explicitly selected `barrelContinuationOutlook` candidate still owns its pending barrel |
| V38 EV engine `!isRiver`                                                    | DEFECT for Omaha: below the value bars PLO had no river bluff path except the generic ladder                                                                                          | the baseline is the PLO river path, pot-limit sized                                                                            |
| V17 river probe (opt-in)                                                    | measured negative in the league                                                                                                                                                       | left opt-in, subsumed by the checked-through line                                                                              |
| River bluff check-raise candidates                                          | default-off candidates                                                                                                                                                                | untouched (facing a bet, a different spot)                                                                                     |
| V40 Omaha third barrel (`bluffScale * 0.15`)                                | over-tight: the range that called two pots is condensed, not closed                                                                                                                   | the baseline halves the frequency instead                                                                                      |
| V5 river polarization, V12 block bet, thin value                            | correct: medium hands check                                                                                                                                                           | untouched (the baseline only owns equity under 0.25)                                                                           |
| V23 river fold read, river-call light read, exploit bluffMod, respectWinner | correct reshaping                                                                                                                                                                     | applied to the baseline as multipliers                                                                                         |
| ICM risk, V37 satellite lock                                                | correct survival arithmetic                                                                                                                                                           | risk scales the baseline (never below a quarter); a locked satellite seat never bluffs; a shove under risk is sized down       |
| PLO paired-board river check (Dan, 2026-11-06)                              | owner ruling                                                                                                                                                                          | preserved; it still converts the bluff to a check (pinned)                                                                     |
| V53 `oppCount === 1` with no opponent                                       | latent throw (`opponents[0]` undefined)                                                                                                                                               | now `opponents.length === 1`                                                                                                   |

## What changed

`server/src/engine/HorseRiverBluffRange.ts` owns the heads-up river with no bet
to face when hero has no showdown value (equity under 0.25 against the read
range) and the line tells a story: turn barrel called, delayed bet after a
flop bet, a checked-through turn, the turn bettor checking the river to hero
in position, or a scare card hero blocks or whose range it improves.

- Size: Hold'em 0.65-1.0 pot, 1.0-1.5x overbet with the nut blocker on a river
  that helped hero's range, the shove when shallow (not under survival risk);
  pot limit 0.6-1.0 pot, never above the pot.
- Frequency: the balanced share for the size, b <= v * s/(1+s) (one bluff per
  two value bets at a pot-sized bet), over hero's value/air composition on
  this board (`estimateRiverRangeComposition`, at most 0.6 value per air,
  because the public bands cannot see missed draws), weighted by selection
  (junk 0.5, missed draw 0.9, blocker 1.15, blocker and draw 1.3, plus 0.1
  for the Hold'em missed-flush unblocker) and by line (barrel 1.1 ... scare
  0.85), capped at 0.45 per combo.
- Blockers: `riverNutBlocker` - Hold'em, the top unseen card of a three-flush
  suit or a rank of the best straight's holdings; Omaha, the
  `omahaFlushBlocker` nut class or the best straight's rank. Sharper than
  `HorseMind.hasBlocker`, which called a queen a blocker on 9-8-5-K-2.
- Reads reshape, never switch off: station x0.2, river fold rate up to x1.6,
  the V53 over-folder frequency as a floor. No read is the baseline.
- `opts.riverBluffBaseline` (default on) ablates it; ledger flag and
  `river_bluff_baseline_*` receipts registered.

## Measured after (HorseLogic.decide, unknown opponent, 1/2 cash, 100bb)

| spot                                                                  | before | after                            |
| --------------------------------------------------------------------- | ------ | -------------------------------- |
| nlh 6-3 on 9-8-5-K-2 (blocks 7-6, missed gutshot), turn barrel called | 16%    | 43-46%                           |
| nlh junk (Q-3, J-3, 4-3) same spot                                    | 12%    | 15-21%                           |
| nlh J-T missed straight draw                                          | -      | 25%                              |
| nlh checked-through turn, blocker                                     | 17%    | 36%                              |
| plo4 As-Qh-4c-3d on Ks-9s-6d-2s-Jc (nut-flush blocker)                | 18%    | 35-39%                           |
| plo4 same air without the ace                                         | 9%     | 32-36% (missed draw) / 22%       |
| plo4 after two called barrels                                         | 4%     | 21%                              |
| plo5 nut-flush blocker air                                            | 15%    | 39%                              |
| nlh tournament bubble, blocker                                        | 16%    | 35%                              |
| station (folds 10% of rivers)                                         | -      | well under 0.6x unknown, never 0 |

Showdown value (middle pair, PLO top two) is untouched.

## Pins moved, with the reason

The baseline deliberately changes no-read river decisions, so three frozen
comparisons that replay the pre-baseline brain isolate it the way earlier
independent layers were isolated: the opponent-exploit neutrality corpus
(mocks `riverBluffEligibility` to ineligible), the V54 default-off golden and
the V53 PLO tournament corpus (`riverBluffBaseline: false`). The
barrelContinuationOutlook wiring law compares its candidate against the brain
it was built on (`riverBluffBaseline: false`); in production the baseline
yields to a pending outlook when that candidate is selected.

## Activation

Engine change: it activates only in the next certified 04:00-04:05
America/Chicago maintenance release. Not live before then.
