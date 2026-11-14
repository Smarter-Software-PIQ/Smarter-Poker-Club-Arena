# No overlay chips before the entry period ends (2026-11-14)

Owner law, Dan, 10:04 Chicago, November 14: "NO CHIPS ARE EVER EVER EVER SUPPOSED TO GO TO ANY TOURNAMENT 'FOR OVERLAYS' UNTIL THE REGISTRATION / REBUY / ADD ON PERIOD HAS OFFICALLY ENDED... MAKE SURE THAT IS THE LAW, AND ITS FULLY BUILT AND IMPLEMENTED FOR ANY AND ALL EVENTS WITH A GUARANTEE".

## What was still possible (read from production)

- **Rebuy levels longer than late registration.** If an event's rebuy levels ran past its late-registration levels and it had no add-on, it was finalized when late registration closed. `fn_close_tournament_entry_window` only asked whether late registration was open. Finalizing funds the guarantee and also ends rebuys.
  - The 25 Chip Bankroll Builder (1,000 GTD, 9 late-registration levels, 12 rebuy levels) closed at level 9 on November 11, 12 and 13. Its guarantee was funded while three configured rebuy levels were still ahead, and those rebuys were refused.
  - Sunday 200 Deep Stack (25,000 GTD, November 15) has the same shape.
- **Satellite seats were funded at the start.** `fn_ca_fund_overlay_on_lock` still paid a satellite's guaranteed seats before any late registration, rebuy or add-on had happened. It did not fire for any of the 212 satellites completed since November 5, but the path was live.
- **Nothing below the callers refused.** `fn_apply_prize_guarantee` funded whenever it was called. No ledger rule tied guarantee money to the entry period.

Since November 7, every house posting into a guaranteed event came after its last player payment. The only postings made during registration were the per-entry Free Buy promo heads on non-guaranteed Free Buys, which pay for the free entry itself, not an overlay.

## What changed

Migration `20261114161610_a_guarantee_moves_no_chips_until_every_entry_window_closes` (function images only; installs on merge):

- **`fn_ca_guarantee_entry_period_ended(id)` is the single answer.**
  - An add-on event's period ends at the actual add-on end; its late registration and rebuys run through the add-on.
  - Any other running event's period ends when late registration and the rebuy window are both closed.
  - A finalized, completing, completed or cancelled event has ended. A registering event has not.
- **The entry-window close waits for rebuys.** `fn_close_tournament_entry_window` keeps the pool open while the rebuy window is open (`entry_closed` false, reason `rebuy_window_open`). Registration still closes at its own level. The serving engine already asks again at every blind transition and at the clock deadline, so no engine change is needed.
- **`fn_apply_prize_guarantee` refuses early.** Before the period ends it returns `entry_period_open`, retryable, and funds nothing:
  - no overlay
  - no guarantee promo
  - no Free Buy cutoff funding
  - no satellite seats

  Only the two settlement authorities pass, because they close a finished event whose winner is known.

- **Satellite seats move to the close.**
  - A satellite with late registration, rebuys, re-entry or an add-on is no longer funded at its start. `fn_ca_fund_satellite_seats_at_close_locked` funds its seats at the close, from the same banks in the same order, with the same alerts.
  - A satellite with none of those closes its entry at the start, so its start funding stays.
- **The ledger guard function is installed.** `fn_ca_overlay_waits_for_entry_close()` is created here and attached to `chip_ledger` by the second migration below.

Migration `20261114161611_the_ledger_refuses_overlay_chips_before_entry_close` (daily maintenance window, `@locks: public.chip_ledger`):

- Adds a `BEFORE INSERT` trigger on `chip_ledger`. It refuses `overlay` and `promo_send` chips from `union_bank`, `union_wallet` or `club_treasury` into a prize liability before the period ends, whichever writer sends them.
- The one exemption is a Free Buy entry's bounty part booked at sign-up (`tourney:<id>:promo_head:<registration>`).

## Proof

- `tests/unit/aGuaranteeWaitsForEntryClose.pg.test.ts` runs on isolated PostgreSQL against the production images captured 2026-11-14:
  - **Bankroll Builder:** deferred at level 9, refused by `fn_apply_prize_guarantee` and by the ledger, rebuys still open, then funded once at level 12.
  - **Add-on event:** refused until the actual add-on end, then funded.
  - **Registering and completed events, and the Free Buy head:** a registering event is refused; a completed event and the Free Buy head pass.
  - **Settlement of an event that finished inside late registration:** funded.
  - **Satellite with late registration:** not funded at start; seats funded at close.
  - **Satellite with no entry period after the start:** funded at start.
- `tests/a-guarantee-moves-no-chips-until-entry-closes.law.test.ts` pins the law wherever these functions are defined next.
- `tests/a-tournament-start-does-not-block-foreign-keys.law.test.ts` now strips block comments as well as line comments. The installed lock image explains its own lock choice inside a block comment.

No chips, balances or settled rows move. Every escrow from the 11 historical overlays balances; they are reconciled on #10786.
