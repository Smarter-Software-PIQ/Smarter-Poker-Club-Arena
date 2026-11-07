# 2026-11-07 - Out-of-position river leads and hi-lo river bluffs

Owner instruction (Dan, 2026-11-06 20:52 Chicago): "MAKE SURE THAT YOU FULLY
UPGRADE ENHANCE, OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION
FOR BOTH HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING
THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR
QUALIFIED CANDITATES OR SITUATIONS."

Closes two gaps #9803 (`HorseRiverBluffRange.ts`) left open.

## Measured before (production, read-only SQL)

Out of position, first to act on the river, heads-up, into the player who bet
the turn (hero called), `publicNode.toCall = 0`, 3 hours to 2026-11-07 08:15 UTC:

| variant | river           | spots | lead % |
| ------- | --------------- | ----- | ------ |
| nlh     | flush completes | 186   | 5.9    |
| nlh     | paired          | 158   | 0.6    |
| nlh     | other           | 489   | 2.9    |
| plo4    | flush completes | 176   | 2.8    |
| plo4    | paired          | 147   | 2.0    |
| plo4    | other           | 515   | 2.9    |
| plo5    | all             | 57    | 1.8    |

The few human samples in the same spot (11 in the 3 hours before) led 33%
(nlh) and 62% (plo4).

PLO8, horse river decisions with nothing to call, heads-up, 7 days (hole cards
recorded; "air" = no hole rank pairing the board, no pocket pair, no flush):

| low possible | hero has a low | air (high) | spots | bet % |
| ------------ | -------------- | ---------- | ----- | ----- |
| no           | -              | yes        | 181   | 7.7   |
| no           | -              | no         | 1,190 | 20.8  |
| yes          | no             | yes        | 19    | 26.3  |
| yes          | no             | no         | 1,032 | 15.8  |
| yes          | yes            | yes        | 250   | 22.4  |
| yes          | yes            | no         | 1,652 | 23.1  |

Four days, low possible, nut-low holders (both of the two lowest off-board low
ranks) with no pair: 23 spots, 30.4% bet. So air with no low bet into a
possible low a quarter of the time (a half-pot giveaway against the PLO8
range, which holds a low more often than not), while the freeroll (nut low, no
high) was barely bet at the same rate as junk.

## What was blocking (HorseLogic.ts)

| gate                                                                                     | verdict                                                                                                                                   | action                                                                                                                           |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `riverBluffLine` returned `none` out of position unless a scare card met the nut blocker | DEFECT: every completing river without the nut blocker, and every blank, was handed to the V11 gate, which checks                         | new lead lines `leadDraw` (0.9) and `leadBlank` (0.25)                                                                           |
| V11 initiative gate on the river                                                         | correct on blanks (the caller check-raises or check-calls), over-tight on rivers that complete the caller's draws: the made flush led 30% | passes a value hand to the value ladder at 0.6 (monster bar) / 0.3 (equity 0.7) on completing rivers only (`riverLeadValueSpot`) |
| baseline `domain` refusal of every hi-lo river with a low possible                       | DEFECT: the freeroll was never owned, and air bluffs into a likely low were left to the old layers                                        | hi-lo branch in `riverBluffEligibility`                                                                                          |
| PLO paired-board rulings (2026-10-25 fold, 2026-11-06 river check)                       | owner rulings                                                                                                                             | preserved; Omaha never leads a paired board                                                                                      |

## What changed

`HorseRiverBluffRange.ts`:

- `riverLeadSpot`: the last turn bet was the opponent's, hero called it, the
  river has no action yet. `riverCompletedDraw`: the river is the third card
  of a suit with two on the turn (flush), or allows a straight no two hole
  ranks made on the turn (straight); public cards only.
- Lines: `leadDraw` (completing river, factor 0.9), `leadBlank` (otherwise,
  0.25: rare), none on an Omaha paired board. The existing selection weights
  put the bluffs on nut blockers and missed draws.
- A credible station is never bluff-led into (probability 0, receipt
  `river_lead_skip_station`); a measured river folder is led into more.
- Hi-lo, three or more low ranks on board, Omaha:
  - high share (the MC's `hiLoSplit.hi`) of 0.25 or more, or a low that is not
    the nut: showdown value, untouched;
  - the nut low (`riverHeroNutLow`: no two unseen low ranks beat it) and no
    high: `freeroll`, bet at 0.55 x (1 - 2 x quarter share); a better high
    that calls splits exactly as a check would, a better high that folds is a
    scoop; no read lowers it;
  - neither half: `scoop` only when `riverOpponentLowChance` (exact count of
    random holdings making a low, from the public cards and hero's own) is at
    most 0.5 and the line tells a story, at the balanced share times the
    chance of no low; otherwise `low_giveaway`, and hero checks.
- `opts.riverLeadRange` and `opts.riverBluffHiLo` (both default on) ablate;
  ledger flags and the `river_lead_*` and `river_bluff_hilo_*` receipts are
  registered, `river_bluff_baseline_freeroll` and
  `river_bluff_baseline_skip_low_giveaway` join the baseline family.

## Measured after (HorseLogic.decide, unknown opponent, 1/2 cash, 100bb, 300 seeds)

Before = both new flags off; after = default.

| spot                                                    | before | after |
| ------------------------------------------------------- | ------ | ----- |
| nlh A4 (Ah blocker), lead on the flush-completing river | 26%    | 28%   |
| nlh Q4 junk, same                                       | 0%     | 9%    |
| nlh QhTh made flush, lead                               | 30%    | 82%   |
| nlh QJ missed straight draw, lead on a blank            | 0%     | 7%    |
| nlh K9 two pair, lead on a blank                        | 0%     | 0%    |
| plo4 Ah blocker air, lead on the flush river            | 24%    | 26%   |
| plo4 nut flush, lead                                    | 32%    | 82%   |
| plo4 missed draw, lead on a blank                       | 0%     | 6%    |
| plo4 lead on a paired river                             | 0%     | 0%    |
| plo8 nut low, no high (freeroll)                        | 0%     | 52%   |
| plo8 air with no low into a possible low                | 6%     | 0%    |
| plo8 non-nut low, no high                               | 0%     | 0%    |

Against a station (folds 10% of river bets) the bluff lead is 0; against a
river folder it rises above the unknown rate.

## Pins

New law `server/src/engine/HorseRiverLeadHiLo.law.test.ts`
(`docs/laws.d/horse-river-lead-and-hilo-bluff.md`).

Pins moved, with the reason:

- `HorseOpponentExploitNeutrality.law.test.ts` replays a frozen pre-layer
  corpus. The out-of-position value lead (`riverLeadValueSpot`) reads no
  opponent but changes those frozen no-read decisions, so it is isolated
  there exactly as #9803 isolated the baseline; the real gate runs without an
  opt-out in the new law.
- `HorseRiverBluffOtherGames.law.test.ts` (#9837), "a preflop record is never
  a story in a bomb pot": its spot is hero calling the turn bet out of
  position, which is now itself a postflop story (the lead). The preflop-only
  assertion is kept with `leadRange: false`, and two assertions are added:
  with the lead on the story is `leadBlank`, and with the turn call removed
  the preflop raise alone is still no story.

## With #9837 (fixed limit, short deck, bomb pots, multi-board)

Merged on top of it. The lead lines apply in every game type its paths admit
(a bomb pot's turn call is a postflop story). The hi-lo low-possible branch
applies to flo8 as well (its one fixed bet sizes the freeroll); multi-board
hi-lo with a low possible keeps the old domain refusal (the MC's hi/lo split
is averaged over boards, so a per-board nut low cannot be read from it), and
the V11 value-lead pass is single-board only.

## Activation

Engine change: it activates only in the next certified 04:00-04:05
America/Chicago maintenance release. Not live before then.
