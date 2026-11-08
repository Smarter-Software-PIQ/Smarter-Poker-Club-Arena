# 2026-11-08 - An Unused Spin Or Sit & Go Board Is Parked At 3 AM, Not Recycled

## What was wrong

`fn_daily_window_close_seat_first_lobbies` (the engine's 3:00-6:00 AM Chicago lobby close) cancelled every open, unstarted, not-full seat-first lobby, including boards nobody ever sat at. At 6:00 the engine's always-on board (`TournamentRecurringService.ensureBoardOpen`) found no REGISTERING instance of each config and opened a fresh one. Every standing board was cancelled and minted again once a day, leaving a CANCELLED tournament, a closed table and an immutable zero `tournament_cancellation_receipts` row per board per day.

Measured on production (SELECT only), cancellations in the 3 AM Chicago hour:

| Day        | Cancelled | Zero players/seats/refund | Tables closed |
| ---------- | --------- | ------------------------- | ------------- |
| 2026-11-05 | 115       | 85                        | 83            |
| 2026-11-06 | 134       | 109                       | 84            |
| 2026-11-07 | 139       | 122                       | 94            |

On 2026-11-07: 12 empty boards per welcome-certification fixture club (five clubs) and 62 of the Midway Union's 79 (the rest held real entrants). Of the 160 seat-first lobbies open at the time of writing, 114 had never had an entrant.

## Why parking keeps the 3 AM guarantee

The close exists so no lobby holds a player's buy-in through the 4:00-6:00 window. An unused board holds nothing. From 3:00 `fn_ca_lock_tournament_seat_acquisition`, which every registration and seat door takes (human and horse alike), already refuses new entries to seat-first games with `spin_sng_closed_until_reopen`, so a parked board cannot gain a player, fill or start before 6:00.

## Fix

Migration `20261108034940`:

- New `fn_daily_window_seat_first_lobby_unused(tournament)`: true only when no `tournament_players` row exists in any status, no `table_seats` row ever existed on its tables, prize pool, current players and rake are zero, it never started, and no Spin multiplier was drawn. It never reads `is_horse`.
- The 3 AM close skips such boards in its scan (before the LIMIT) and reports them as `parked`. Every other lobby is cancelled exactly as before through `atomic_cancel_tournament` with its exact receipt.
- The 4:00 "still open" alert, in the close and in the database watchdog, counts only lobbies somebody used.

No engine change: at 6:00 the board finds the parked REGISTERING instance and opens nothing new. Historical cancelled generations and their receipts are left as they are.

## Proof

On a scratch PostgreSQL 16, the 20261103222817 definitions reproduced the production md5 preimages exactly (`c610d559...`, `b306e4ab...`). After this migration at 03:30 Chicago: two unused boards were parked; a board with a seated player, one with a seat since left, and one with a registration were cancelled; a full board was left to deal. At 04:30 the close and the watchdog each alerted for the full board only.

Law: `tests/an-unused-seat-first-board-is-parked-not-recycled-at-3am.law.test.ts`.
