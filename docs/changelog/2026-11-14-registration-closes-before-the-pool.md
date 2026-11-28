# Registration closes before the pool when rebuys run longer (2026-11-14)

Follows #10826. That PR enforces the owner law of November 14: no overlay chips go into an event until registration, rebuys and the add-on have all ended. Because of it, an event whose rebuy levels outlast its late-registration levels (the 25 Chip Bankroll Builder: 9 and 12) now keeps its pool open, unfunded, through the rebuy levels. The database answers `entry_closed` false with reason `rebuy_window_open`.

## Engine

- **Registration-closed announcement.** `TournamentManagerBase.reconcileTournamentEntryWindowOnce` broadcasts `late_reg_closed` once when the database closes registration while keeping the pool open. The broadcast carries the current pool and `rebuysOpen: true`. Without this, players heard "registration closed" only at level 12, when the pool finalized. The pool still finalizes when the authority is asked again after the rebuy window closes, and no second announcement follows.
- **Short-guarantee alert at entry close.** `HorseOverlayGuard.lateRegisterHorsesOnce` raises one durable warning per event, `HorseOverlayGuard.guarantee_short_at_entry_close`, when an event stops taking entries while its guarantee is still short. That is the last moment the gap can be read before any house chips move. The guard already marks the event short (the rebuy and add-on rate boost) before it checks the entry door, so the boost keeps running through the rebuy levels while the pool stays open.

## Client

- `TournamentPage` shows "Late Registration Closed. Rebuys Are Still Open" when the announcement says rebuys remain open.

## Checked and left unchanged

- **The excess start overlay return for satellites.** `fn_ca_return_excess_start_overlay_locked` keeps a satellite's pool at no less than its guaranteed seat value and runs before the close-time seat funding. A start-funded satellite is never refunded and then funded again.

## Tests

- `server/src/tournament/EntryClosePrizeContract.test.ts`: the announcement is made once, the pool stays unfinalized and nothing is repriced.
- `server/src/services/guaranteeShortAtEntryClose.test.ts`: one alert per event when short, no alert when covered, and the boost stays published.
- `server/src/services/aShortGuaranteeIsCoveredFromEverySource.law.test.ts` lists the new durable alert.

This needs an engine release. The target is the next certified daily window, ahead of Sunday 200 Deep Stack (1:00 PM Chicago, November 15).
