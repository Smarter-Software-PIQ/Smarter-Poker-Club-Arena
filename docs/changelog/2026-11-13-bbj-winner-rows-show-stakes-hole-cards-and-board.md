# BBJ winner rows show the stakes, hole cards against hole cards, and the board

Date: 2026-11-13
Surface: Bad Beat Jackpot popup and page, Winner tab (`src/components/bbj/BBJRecentHits.tsx`), main and Mini lists.

## Owner instruction

Dan, 2026-11-13: "FOR THE BBJ DISPLAYED WINNERS NEXT TO THE BLUE NLH FLH PLO ETC SHOULD BE THE
GAME STAKES. IT SHOULD SAY 1/2 PLO OR .50/1.00 NLH ETC. THE STAKES THAT IT WAS HIT AT SHOULD BE
DISPLAYED AS WELL AS THE GAME." and "IT SHOULD SHOW THE BOARD. REMOVE THE BAD BEAT HAND AND LOST
TO HAND. JUST SHOW THE HOLE CARDS VS HOLE CARDS AND THE BOARD. (MAKE SURE EACH 'HOLE CARDS' HAS
THE PLAYERS NAME UNDER IT.)"

## What changed

- The blue game tag now reads the stakes and the game, for example `0.25/0.50 NLH` or `1/2 PLO`.
  The stakes are the hand's own stored blinds (`fn_bbj_recent_hits` already returned
  `small_blind` and `big_blind` from `hand_history`), printed with the lobby's `stakesLabel`, so a
  fixed-limit game reads its bet sizes exactly as its lobby card does. A hit with no stored blinds
  shows the game alone.
- The five-card "Bad Beat Hand" and "Lost To" strips and their hand names are removed from the row.
- The row shows the jackpot winner's hole cards, `VS`, the hand winner's hole cards, each with the
  player's name underneath, and the board below them.
- The row no longer runs `bestFive()`; it draws stored cards only.

No database change: the function already returned every field used.

## Proof

`tests/bbj-history-total-payout.test.tsx` pins the stakes tag (including fixed limit and missing
blinds), the names under both sets of hole cards for 2, 4, 5 and 6 card games, the board, and the
absence of the removed labels. `tests/jackpot-initial-layout.test.tsx` updated for the name now
appearing twice in a row.
