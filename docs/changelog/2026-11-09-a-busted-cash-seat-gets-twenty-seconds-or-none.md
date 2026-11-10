# A busted cash seat gets twenty seconds, or none (2026-11-09)

Owner instruction, with a screenshot of a Kings Club / Midway Union PLO5 1/2
table dealing a hand around a seat showing 0.00:

> when a player loses all his chips, there should be a realtime check of the
> database to see if he has chips in his wallet to rebuy, and if he doesn't, it
> kicks him off the table right away. if he does give the player 20 seconds to
> rebuy before kicking them off the table.

## What was wrong

1. **The wallet was asked of the wrong club.** `anyBustedPlayerCanAffordARebuy`
   read `club_members` for `tables.club_id`. At a union table that is the union
   row, which holds no member wallet, so every busted player read as unknown,
   and unknown fails open: the table paused for, and held a seat for, a player
   with nothing to rebuy with.
2. **An open rebuy sheet held the seat with no limit.** Each heartbeat carrying
   `rebuyPromptOpen` restarted the ten-second grace, so a zero-chip seat stayed
   for as long as its owner left the sheet on screen.
3. **A player who could not rebuy still waited out the grace.**

## What changed

Engine (activates with the next certified engine release):

- `server/src/engine/BustRebuyWindow.ts` is the rule: wallet under the table
  minimum is `cannot_rebuy`; otherwise, or when the wallet or the minimum
  cannot be read, `can_rebuy` with a fixed 20 second window.
- `readSeatWalletBalances` reads the wallet each seat was bought from
  (`table_seats.club_id`, table club as fallback). The table pause and the
  release both use it.
- The dealing loop stamps the bust at the end of the hand (`noteCashBust`), so
  the twenty seconds run from the bust and include the table's own pause of up
  to five seconds, which is unchanged.
- `standUpBustedCashPlayers`, for a chip cash seat at a classic table, reads
  the wallet once per bust, before the pending-chip ledger. `cannot_rebuy` on a
  bust the engine watched is released on that sweep with the new reason
  `busted_insufficient_chips`; `can_rebuy` is released at twenty seconds with
  `busted_no_rebuy`. The rebuy sheet heartbeat no longer extends it. A rebuy
  already paid for (an unresolved `table_pending_addons` row) still keeps the
  seat, exactly as before.
- The player is told how long they have in a private `bust_rebuy_window`
  frame.

Client (no engine dependency; inert until the engine sends the frame or the
new reason):

- The bust rebuy sheet shows the engine's countdown in its existing pill.
- A removal for `busted_insufficient_chips` says so, and a confirmed removal
  closes the bust rebuy sheet.

## Limits, stated plainly

- A seat leaves at a hand boundary, like every other departure in this engine.
  A player with the chips to rebuy who lets the twenty seconds lapse while the
  next hand is being played is released when that hand ends, not mid-hand.
- A seat found at zero that the engine did not watch bust (just taken, moved
  in, read back after a restart) and whose wallet cannot cover the minimum is
  held for the existing ten-second grace, not released on sight: its first
  chips may be arriving by a path the ledger read does not show.
- Diamond cash seats and Lightning rooms keep their existing clocks. Horses
  keep their own recovery pass, which already rebuys or releases at the bust.
- Tournament seats are untouched.

## Proof

- `server/src/engine/aBustedCashSeatGetsTwentySecondsOrNone.law.test.ts`
  (17 cases; registered in `docs/laws.d/`).
- Fixtures that pinned the ten-second grace for a chip seat were moved to the
  window in the same change; the dialog-hold pin in
  `tests/run-it-multiple-times-tells-the-truth.law.test.ts` now says the hold
  is Diamond's only.
