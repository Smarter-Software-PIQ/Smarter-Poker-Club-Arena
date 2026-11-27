# Seat And Table Locks Taken In One Order (2026-11-26)

Read on production for the 24 hours to 3:45 PM CST, 2026-11-26 (21:45 UTC):
six "deadlock detected" lines, 62 "hand rake remains pending" refusals and 72
"tournament move destination seat is occupied" refusals.

## What Was Wrong

1. Three deadlocks (5:09 PM and 8:54 PM CST on 11-25, 3:29 PM CST on 11-26):
   a cash-out or a sit-out against a Lightning hand settlement on the same host
   table.
2. One deadlock (9:23 AM CST): a tournament seat acquisition against the same
   player's rebuy.
3. One deadlock (10:22 AM CST): the tournament table lane against the engine
   writing a moved player's sit-out.
4. Every "destination seat is occupied" refusal was logged twice, about 0.1 to
   0.9 s apart.

## Why It Broke

1. Cash writers lock the tables row, then the seat (THE TABLE BEFORE THE SEAT,
   20261123024433 / 20261123024034). `fn_lightning_settle_hand` locked every
   anchor seat (step 5, line 249) and only then, through
   `fn_ca_commit_hand_settlement_exact_before_obligations` line 102, its host
   tables row FOR UPDATE.
2. Seat roots take the two-int `table_cap` key, then `daily-missions-user:`.
   `process_tournament_rebuy`'s fast-refusal try-locks (lines 405-413) took the
   bigint `table_cap:` key and `daily-missions-user:`, and only then, blocking,
   the two-int key in `fn_ca_lock_tournament_rebuy_acquisition`.
3. `adoptTournamentMovePresence` (`ServerTableEngineBase.ts`) PATCHed
   `table_seats.is_sitting_out` directly: the chair, then (trigger
   `zz_note_human_seat_seen`) the tables row. `fn_ca_f06_share_table_lane`
   takes the tables row, then every chair.
4. `moveTournamentPlayerAtomically` sent every request twice under the same
   request id, even after a definite refusal. The refusal itself is the race PR
   #11980 already handles (live since 2026-11-25 07:02 UTC): a new entrant takes
   the chosen chair between the door read and the move, and the manager asks
   once more with a fresh chair and a new request id. Example: 19:16:26.684 UTC a
   new entrant sat in chair 9 of table 87dc859e; the move's two identical
   refusals followed at 19:16:26.750 and 19:16:26.883.

## The Change

- Migration `20261126233138`: `fn_lightning_settle_hand` takes its host tables
  row FOR UPDATE (the commit core's own mode) inside step 5's BEGIN block, before
  the first anchor. Anchored edit, grants compared before and after, probed.
- Migration `20261126233144`: `process_tournament_rebuy` tries the two-int
  `table_cap` key between the bigint key and `daily-missions-user:`, with the
  same 55P03 TOURNAMENT_PURCHASE_PLAYER_BUSY refusal. Anchored edit, grants
  compared, probed.
- Engine (`server/src/engine/ServerTableEngineBase.ts`): a carried sit-out is
  written through `fn_cash_seat_sitout` (`SeatSitOutPersistence`), which takes
  the table first.
- Engine (`server/src/tournament/tournamentSeatMoveRpc.ts`): a first-attempt
  definite refusal is final for that request id; lock contention and routing
  failures, an earlier ambiguous attempt, or an outcome already unknown still get
  the one identical resend.

The two engine changes ship with the next certified cutover after merge. The
migrations install through the ordinary queue (no hot-table DDL, no install
window).

## Not Changed, And Why

- "hand rake remains pending ... busy" (62): a designed, bounded refusal.
  `fn_ca_bank_pending_cash_rake` takes the shared `union_wallets` row
  `FOR NO KEY UPDATE NOWAIT` and records the rake as pending when any other
  writer of that row holds it; 62 different hands were each refused once and
  banked on a later pass (`cash_rake_pending` was empty when read).
- One deadlock (8:33 PM CST, 11-25) between a Midway registration's free-buy
  promo head on `union_wallets` and a horse Diamond Spins prize payment
  (`union_wallets`, then `clubs`, then `club_members`). Only one edge is visible
  in the log, so it is reported, not changed.

## Hardening

- `tests/a-lightning-settlement-takes-its-host-table-before-its-anchors.law.test.ts`
- `tests/a-rebuy-takes-the-seat-table-cap-before-the-daily-missions-key.law.test.ts`
- `server/src/engine/aCarriedSitOutTakesItsTableFirst.law.test.ts`: also forbids
  any direct `table_seats` PATCH of `is_sitting_out` or `leave_pending` in engine
  code.
- `server/src/tournament/aMoveVerdictIsSentOnce.law.test.ts` and
  `tournamentSeatMoveRpc.test.ts`.
