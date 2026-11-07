# 2026-11-07 - River bluffs for fixed limit, short deck, bomb pots and multi-board pots

Owner instruction (Dan, 2026-11-06): "FULLY UPGRADE ENHANCE, OPTIMIZE AND
IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION ... CHECK THAT THERE IS
NOTHING THAT IS EVER BLOCKING OR PREVENTING, OR 'SHUTTING OFF' RIVER BLUFFS
FOR QUALIFIED CANDIDATES OR SITUATIONS."

#9803 (`HorseRiverBluffRange.ts`, changelog `2026-11-07-horse-river-bluff-range.md`)
gave heads-up Hold'em and PLO rivers a baseline bluff range, but its
eligibility returned `domain` for every fixed-limit, short-deck, multi-board
and bomb-pot spot. Those spots went back to the old layers that rarely bluff.

## What production deals (read-only, `hand_history` and `tables`)

| type        | evidence                                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fixed limit | `flh` 152,805 and `flo8` 66,170 hands in 9 days (27,607 / 13,003 in the last 3); 20 + 20 open tables                                                    |
| short deck  | `short_deck` 22,989 hands 2026-10-29 to 2026-11-02 07:25 UTC, none since; 9 tables still configured (2 with bomb pots), so it is dealt and comes back |
| bomb pots   | 320 hands in 3 days (plo5 187, flo8 133); every bomb-pot table in production is configured `bomb_pot_double_board` with `bomb_pot_board_count = 2`       |
| multi-board | outside bomb pots none: no table has `double_board` or `triple_board`, and `rit_boards` are all-in runouts with no river decision                       |

So "multi-board" in production today means the double-board bomb pot; both
paths apply to it.

## Measured before the change (heads-up rivers checked to a horse or first in, `publicNode.toCall = 0`)

| type                         | window  | spots | bet % | air* spots | air bet % |
| ---------------------------- | ------- | ----- | ----- | ---------- | --------- |
| flh                          | 2 days  | 3,615 | 39.2  | 1,106      | 20.6      |
| flo8                         | 2 days  | 2,767 | 29.8  | 299        | 33.4**    |
| short_deck                   | 9 days  | 7,203 | 40.4  | 1,539      | 37.2      |
| bomb plo5 (two boards)       | 9 days  | 489   | 44.6  | 1          | -         |
| bomb plo8 (two boards)       | 9 days  | 185   | 46.5  | 2          | -         |
| bomb short_deck (two boards) | 9 days  | 99    | 69.7  | 3          | -         |

\* air here is rank-only: no hole rank on the board, no pocket pair (so made
straights and flushes count; short deck's air includes many straights).
\** flo8 air includes the lows it was betting for the low half.
Air across two boards and five Omaha cards almost never happens, so the
double-board rows only show the volume.

Fixed-limit heads-up river bets average 0.195 pot (flh) and 0.221 pot (flo8),
and were folded to 36.1% (flh, 341 bets) and 27.7% (flo8, 430 bets) of the
time. The fixed-limit bluff needs only s/(1+s), about 16%, to pay, so the
fixed-limit population is not the calling-station wall it is reputed to be:
the balanced baseline applies, and a measured station still gets x0.2.

## What changed (`HorseRiverBluffRange.ts`, wired in `HorseLogic.ts`)

Each type has its own path and opts flag, default on; `false` restores
#9803's exclusion for that type only (`riverBluffFixedLimit`,
`riverBluffShortDeck`, `riverBluffBombPot`, `riverBluffMultiBoard`, all
registered in `HorseDataLedger.ts`).

- **Fixed limit.** The bluff is the one legal bet (`gs.fixedBetSize`, else
  twice the hand's small bet), or all in for less; no other size exists. The
  frequency is the same balanced share, which at s = 0.2 is about one bluff
  per six value bets: low but real. Hi-lo `flo8` bluffs the high only when no
  low is possible (the existing hi-lo rule).
- **Short deck.** `riverMissedDraw` and `riverNutBlocker` take the engine's
  ranking (`PokerEngine.evaluate5Cards`): the 36-card deck (six to ace), the
  ace also low as a five so A-6-7-8-9 is a straight, and a flush above a full
  house, so a flush board's nut blocker (the top unseen card of the suit,
  six to ace) stays the nut blocker on a paired board.
- **Bomb pots.** Every story line is postflop (turn barrel, flop bet, a
  checked-through turn, the turn bettor giving up, a scare card) and a
  preflop raise alone is never one, so nothing assumes preflop aggression.
  The range composition comes from `HorseMind.bandFor`, which already starts
  a bomb pot from a random hand and narrows it by postflop play (V36).
- **Multi-board.** HorseLogic's own V36 rule 2: "A BLUFF MUST FOLD OUT EVERY
  BOARD ... bluff volume drops by half on two boards and by two-thirds on
  three". Hero is a candidate only with equity under the air bar on every
  board; the missed draw, nut blocker (per board, Omaha nut-flush class per
  board) and Hold'em unblocker are read on every board and the combo weight
  is their average (the receipt names the weakest board's selection); the
  frequency, including the V53 over-folder floor, is divided by the number
  of boards. Composition uses the prior shares (the public ranges are not
  built for multi-board).
- Receipts: `river_bluff_baseline_bet_<type>` and
  `river_bluff_baseline_check_<type>` beside the existing selection receipt
  (covered by the registered `river_bluff_baseline_*` wildcard).

## Measured after (HorseLogic.decide, unknown opponent, heads-up, 200 seeds)

| spot                                                      | paths off | paths on |
| --------------------------------------------------------- | --------- | -------- |
| flh 6-3 on 9-8-5-K-2, barrels called (blocker + gutshot)  | 8.0%      | 14.5%    |
| flh Q-3 junk, same spot                                   | 6.0%      | 5.5%     |
| flo8 A-4-3-2 on K-J-9-T-6 (no low, ace blocks broadway)   | 1.5%      | 11.0%    |
| short deck A-Q on 7-8-9-K-J (blocker + missed wheel draw) | 14.0%     | 37.5%    |
| nlh bomb pot, single board, barrels called                | 16.5%     | 41.0%    |
| nlh bomb pot, single board, checked-through turn          | 17.5%     | 32.0%    |
| nlh double board, air on both                             | 10.0%     | 17.0%    |
| plo5 double-board bomb pot, air on both                   | 2.0%      | 9.5%     |
| nlh single-board reference (unchanged)                    | 40.5%     | 40.5%    |

Showdown value is untouched: flh middle pair, short-deck top pair and a
double board with a pair on board two never take the baseline. The flh junk
row moves inside sampling noise: at a 0.2-pot bet the balanced junk share is
about 5.5%, the same volume the old layers produced.

## Law

`server/src/engine/HorseRiverBluffOtherGames.law.test.ts`
(`docs/laws.d/horse-river-bluff-other-games.md`), fixtures in
`HorseRiverBluffOtherGames.test-support.ts`. No existing pin moved.

## Still open

- Hi-lo with a low possible still bluffs only through the old layers.
- Multiway rivers and out-of-position leads into the turn bettor (from #9803).
- No league measurement or ablation of these paths yet; each flag is ready
  for one.

## Activation

Engine change: it activates only in the next certified 04:00-04:05
America/Chicago maintenance release. Not live before then.
