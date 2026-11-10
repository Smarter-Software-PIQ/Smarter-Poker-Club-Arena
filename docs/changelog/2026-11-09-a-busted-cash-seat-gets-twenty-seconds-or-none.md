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

## Follow-up, 2026-11-10: the timing contract, enforced

Owner acceptance terms: the 20 seconds begin at the bust and include the table
pause; expiry makes the player ineligible for another hand; physical removal
follows the safe departure boundary; reopening the sheet, reconnecting or
restarting must not renew the deadline; a failed lookup is never reported as
insufficient funds.

- **Clock.** The window runs on `maintenanceActiveNow()`, the engine clock a
  freeze stops (the one Lightning's window already uses), so a break neither
  burns the window nor renews it (CLAUDE.md 13.4).
- **Expiry.** A per-seat timer fires at the deadline. A busted player is never
  in the live hand, and Dan's 2026-10-25 ruling lets a player who is not in the
  hand leave at once, so the seat is released at 20 seconds, mid-hand included.
  `atomic_table_rebuy` requires a live seat, so a later purchase is refused.
  The same check runs at every hand boundary before pending add-ons are
  delivered, so a late rebuy is never put on the felt and dealt.
- **Paid in time vs late.** At expiry an unresolved rebuy row the database
  stamped inside the window (1 s clock tolerance, in the player's favour) keeps
  the seat. A row stamped after it does not; the seat is released and
  `resolve_pending_addon` returns the whole debit because the seat was vacated
  (its `addon_refund:<id>` credit, exactly once, into the seat's club). An
  unreadable row list keeps the seat and asks again a second later. The timer
  and the boundary sweep share one release per occupancy.
- **Restart and cutover.** A fresh engine reads the bust instant from
  `hand_atomic_commits.stack_result` (the newest accepted hand listing the
  player, at zero) and excludes every freeze since from
  `engine_maintenance_thaws`, so the window resumes rather than restarts. An
  unreadable record leaves the first-sight clock and the existing grace.
- **Reopen and reconnect.** The sheet's heartbeat is answered with the time
  LEFT (at most every 3 s), never a fresh 20.
- **Minimum.** A wallet is judged against `cashRebuyMinimum`,
  `greatest(min_buy_in, 40 * big_blind)`, the rule the purchase enforces, now
  beside `cashMinBuyIn` in `server/src/config/cashBuyIn.ts`.
- **Wallet.** `readSeatWalletBalances` reads only the seat's own club. A seat
  naming no club is UNKNOWN, never the table club's wallet.

Horses: they answer at the bust (rebought, or released on stop-loss, declined
or unfunded), and the table pause is unchanged for everyone. A human cash seat
has no explicit decline (the client never calls `/reject_rebuy`), so a human
who does not rebuy is held for the full 20 seconds while a declining horse
leaves at once. That asymmetry predates this change and is not altered here.

### Database proof (existing chip-journal fixture route)

`scripts/ci/probes/chip-journal-atomicity/test_bust_rebuy_window.py`, run by
`run-isolated.sh` (beside `test_deferred_settlement.py`), installs the real
`atomic_table_rebuy`, `resolve_pending_addon` and `atomic_credit_wallet_and_log`
closures from migration history (stubs only for branches a cash refund never
reaches) and proves, each case rolled back:

1. Union table: the engine's read returns the seat club wallet the rebuy
   debits; the table club holds no wallet.
2. A wallet of 3 cannot rebuy at `min_buy_in` 2 (minimum `greatest(2, 4)`).
3. A rebuy after release is refused with no debit, row or receipt.
4. A rebuy racing the release is refunded whole, once, into the seat club;
   resolving again and replaying the purchase key move nothing.
5. An in-time rebuy is charged once and delivered once; a duplicate request
   replays.
6. A seat naming no club yields no wallet row (unknown).
7. The unresolved row carries the purchase stamp the window is judged by.

Duplicate keys and concurrent replay of the purchase itself are also covered by
the existing `test_rebuy_receipts.py` cases.
