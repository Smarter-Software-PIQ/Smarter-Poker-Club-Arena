# 2026-11-21 — H10: 3 AM lobby close, unfilled-spin expiry, and orphan reseat respect the maintenance freeze

## Symptom

On 2026-11-21 at 09:04 UTC (GitHub Actions run `44887083680`, Backup `trials.jsonl` line 591), the rollback rehearsal swapping Backup from candidate `f94c25f0` back to serving `bb21dc82` failed with `rollback_rehearsal_failed_to_bb21dc826731` / `frozen_seat_boundary:boundary_changed:count`:

- `frozenSeatBoundary` at `08:59:12Z`: `138` seats (`221bbceb977dfa185a14df9f900b1d39`)
- `postBootSeatSnapshot` at `08:59:23Z` (after `bb21dc82` booted and adopted): `138` seats (matched)
- `lastVerifiedFrozenSnapshot` at `09:00:01.288Z`: `138` seats (still matched 38 s after boot)
- `rejectedSeatObservation` at `09:00:04.384Z` (4 seconds after `03:00:00 America/Chicago`): `132` seats (`ef2fad0622aae276549ce8ac18ead2d0`, `-6` seats)

An identical prior failure occurred on `2026-11-16` at `09:00:06.323Z` (`trials.jsonl` line 373, `125 -> 115` seats, `-10` seats).

## Root Cause

Two independent gaps let seat-cancelling sweeps mutate `public.table_seats` while the platform was frozen:

1. **Engine (`server/src/GameServer.ts`, `discoverTournaments`)**: The `for (const tournament of registering || [])` loop broke immediately on `isMaintenanceFrozen()`, but the post-loop sweeps in the same discovery pass ran without checking `isMaintenanceFrozen()`:
   - `fn_daily_window_close_seat_first_lobbies` (`lastLobbyCloseAt = 0` on boot) fired on the first 5-second pass after `03:00:00 America/Chicago` (`09:00:00 UTC`), calling `atomic_cancel_tournament` on every open, used, unfilled Spin/SNG lobby and setting `table_seats.left_at = now()` inside the frozen break.
   - `fn_spin_expire_unfilled` (`lastSpinExpireAt = 0` on boot) had the identical missing freeze guard and would vacate any Spin past `spin_fill_policy.unfilled_timeout_minutes` immediately on boot during a swap at any hour.
   - `repairOrphanedTournamentSeats()` and `TournamentManager.absorbOrphanedSeats()` also lacked `isMaintenanceFrozen()` guards (unlike neighboring `finishSeatFirstGamesThatAreOver`, `reopenTablesClosedUnderLiveTournaments`, and `rebuildManagersOfDarkTournaments`).
2. **Postgres (`fn_daily_window_close_seat_first_lobbies` and `fn_spin_expire_unfilled`)**: `zz_freeze_guard` (`fn_refuse_while_frozen`) intentionally exempts `service_role` JWTs so in-flight hands can settle during a break, and `zz_freeze_entry_guard` only blocks new cash-table entries. Neither RPC checked `public.fn_platform_frozen()`, so any `service_role` caller (including an older serving engine during a rollback rehearsal or `/api/cron/spin-sweep`) mutated seats and refunded buy-ins during a maintenance freeze.

## Fix

- **Engine (`server/src/GameServer.ts`, `server/src/tournament/TournamentManager.ts`)**:
  - Gate `fn_spin_expire_unfilled`, `fn_daily_window_close_seat_first_lobbies`, `repairOrphanedTournamentSeats()`, and `TournamentManager.absorbOrphanedSeats()` on `!isMaintenanceFrozen()`.
  - Because `lastSpinExpireAt` and `lastLobbyCloseAt` are updated only inside the gated blocks, frozen ticks do not consume the cooldown and both sweeps run on the first discovery pass after thaw.
- **Database (`supabase/migrations/20261121200024_lobby_close_and_spin_expiry_respect_maintenance_freeze.sql`)**:
  - Add fail-closed `IF public.fn_platform_frozen() IS DISTINCT FROM false THEN RETURN ...` guards (before scanning and again inside each loop before `atomic_cancel_tournament`) to `public.fn_daily_window_close_seat_first_lobbies` and `public.fn_spin_expire_unfilled`.
  - Keep `p_dry = true` read-only on `fn_daily_window_close_seat_first_lobbies`, return `ok: true, platform_frozen: true` with zero closed/expired so older engines during rollback rehearsals do not raise false failure alerts, and keep `service_role`-only privileges, preimage MD5 guards, and `DO $probe$` execution proofs.

## Regression Barriers Added

- `server/src/maintenance/frozenDiscoverySweeps.test.ts`: drives `GameServer.discoverTournaments()` at `2026-11-21T09:00:04Z` (`03:00:04 America/Chicago`) while frozen (proving zero RPC calls, preserved cooldowns, and zero orphan reseats) and then thawed (proving immediate execution).
- `server/src/maintenance/theFreezeIsTotal.law.test.ts`: pins `!isMaintenanceFrozen()` on `fn_spin_expire_unfilled`, `fn_daily_window_close_seat_first_lobbies`, `repairOrphanedTournamentSeats`, and `absorbOrphanedSeats`.
- `tests/lobby-close-and-spin-expiry-respect-maintenance-freeze.law.test.ts` (registered in `docs/laws.d/`): pins both the SQL `fn_platform_frozen() IS DISTINCT FROM false` guards and the engine freeze gates.
- `tests/a-spin-or-sng-lobby-open-at-3am-is-closed-and-refunded.law.test.ts`: tightened to require `!isMaintenanceFrozen()` alongside `!spinSngBoardsOpen(new Date())`.
