# PLO boat coolers stop reading as under-fulls, and sets on wet boards get a name

2026-11-07 (follow-up to the 2026-11-06 review of the twenty biggest horse losses)

## What the review reported, checked against the stored rows

Every claim was read back from `public.horse_hand_reviews` before anything
changed.

| review  | reported                                                    | stored row says                                                                                                                                                      | verdict             |
| ------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 3359671 | plo_underfull_stackoff on trip queens, not a full house     | hero 3c 6d Qs 6c 4s 8s, commit on the turn Qd Qc 3d As: Qs 3c makes QUEENS FULL OF THREES; Q-A and A-A make bigger boats                                             | tag correct, pinned |
| 3363822 | plo_underfull_stackoff on AAA77, beaten only by quad sevens | hero Kh Ac Kd 3s on As Ah 7d 7c 3d: the boat is ACES FULL OF THREES (hero holds no seven); Ad 7h and Ad 7s make aces full of sevens                                  | tag correct, pinned |
| 3363822 | coldcall_stackoff may be wrong                              | small blind flatted a 4.5bb raise preflop and lost 425bb: exactly the tag's definition (cold-called a raise, never took the initiative, lost 40bb+)                  | tag correct, pinned |
| 3370600 | bottom set five-bet the turn, -595bb, no tag                | 5d 2s 2c Ac on 2h Ts 9h 3s, five-bet all in on the turn, Ks river; turn board has two of each suit and no three-rank straight window, so plo_set_stackoff stood down | missing tag, added  |

## The real defect behind item 2

The rule the review asked for, "a boat that loses only to quads or a straight
flush is a cooler", was broken even though 3363822 itself was not an example
of it. `omahaBoatIsNut` (`server/src/services/HorseHandReview.ts`) returned
false whenever any unseen two cards made a bigger full house OR QUADS. Quads
are live on every paired board, so the top full house on a paired board was
tagged `plo_underfull_stackoff`. It now counts only a bigger full house.
Straight flushes were already not counted.

## The new tag: set_on_wet_board_stackoff

Measurement only (HorseDataLedger row, consumer `measurement`), mirrored as
`set_on_wet_board_stackoff_won` per the denominator law. Fires inside the V38
PLO block (Omaha, one board, showdown, 100bb+ invested) when all hold:

- the commit street (`commitStreet`) is the turn or the river;
- hero holds exactly three of a kind at the commit street (set or trips) and
  has not reached a full house by the river;
- the board shows three to a flush or three to a straight on the board as of
  the commit street OR on the river board;
- hero had no redraw when it committed: on a turn commit no flush draw (nut or
  dominated) and fewer than eight straight outs (`omahaDrawQuality`, the same
  test `plo_toppair_no_redraw_stackoff` uses), and in hi-lo no made low or low
  draw. The full-house redraw every set carries is not counted.

Why the river board is read as well as the commit board: the literal rule
("the board at the commit street shows three to a flush or a straight") does
not tag 3370600, whose turn showed neither, and on every board where it does
hold it duplicates `plo_set_stackoff` / `plo_naked_trips_stackoff`. A set
that commits on the turn is betting that the draws miss; whether they arrived
is the measured situation, and the `_won` mirror carries the other side.

On the two hands the review named as already tagged: 3364887 (middle set on a
three-heart turn, river straight that lost to the flush) and 3370281 (top set
on T-6-J-Q) both also carry the new tag, beside their unchanged
`plo_set_stackoff`. `plo_set_stackoff` and `plo_naked_trips_stackoff` are read
by HorseLogic's PLO_STACKOFF_TAGS and were deliberately not changed. No
strategy dial moves.

## Wiring

- `server/src/engine/HorseDataLedger.ts`: TAG_CONSUMERS row.
- `server/src/services/EveryLeakTagHasADenominator.law.test.ts`: added to
  MIRRORED.
- No migration: no SQL view or audit function enumerates hand-review tag
  names (the EV ranking and leak-spike functions are generic, and the ledger
  is synced from TypeScript).

## Tests

`server/src/services/HorseLeakDetectorsBoatCoolersAndWetSets.test.ts`: the
five stored hands as fixtures, a quads-only cooler on the 3363822 board shape,
and the negatives (nut flush draw on the turn, filled up by the river, dry
runout, flop commit, under 100bb).
