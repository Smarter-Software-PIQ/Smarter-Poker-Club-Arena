# Horses bank the win on Lightning, and the line never measures from more than the table maximum

Owner rule (2026-11-10): a horse at 4-6x its starting stack books the win; never the hand after a big pot, it plays one more orbit and gets up before its next big blind. #10390 shipped it for Classic tables.

Live acceptance on 2026-11-11 (read-only, natural evidence, recorded on #10390) found two gaps:

1. **Lightning never booked.** The rule lived in the Classic settlement step; a Lightning hand is settled by `LightningHandHost`. Horses at 600.77 against a 581.4 line kept posting blinds for half an hour after their last big pot.
2. **The line ran away on re-entry.** A horse rejoining the same game inside the 2 hour rejoin window must bring its stack back, and top-ups add to the baseline, so 543 of 856 horse sessions read a baseline above the table maximum (61e113cb: 1,391.85 baseline, 1,461.52 stack, in a 100 game).

## Fix

- `startingStackFor` caps the starting stack at the table's maximum buy-in (nobody starts with more than the table lets them buy).
- `server/src/lightning/LightningBankTheWin.ts` applies the same rule to each committed pool hand: big pot = half a starting stack; an orbit = the players dealt; due for the big blind = an orbit of hands since its last one (the pool hands blinds to whoever posted longest ago). The horse stands up from its anchor seat through the ordinary Leave door, hit-and-run included; a refused leave re-arms for the next hand.

## Not a defect (withdrawn)

The 33 in-profit Lightning exits with the ten-hand count unfinished had all asked to leave before their countdown started, which `fn_cash_leave_check` honours by design.
