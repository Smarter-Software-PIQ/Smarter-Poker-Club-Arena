# Three Database Error Sources Stop Repeating (2026-11-26)

Read on production for the 24 hours to 3:45 PM CST, 2026-11-26 (21:45 UTC).

## What Was Wrong

1. `rpc/fn_spin_draw_and_settle_atomic` answered 500 nine times (6:54 PM to 6:55 PM CST on 2026-11-25 seven times in a row, then twice more by 10:33 PM CST), every one a lock timeout on a `clubs` row.
2. `rpc/process_tournament_rebuy` answered 500 seven times with the bare Postgres text "could not obtain lock on row in relation profiles", and 400 twelve times in 19 seconds (11:36 PM CST) with FOUR TABLE LIMIT for one Horse.
3. `horse_job_runs_pkey` logged four unique violations (8:41 AM to 9:11 AM CST) and PostgREST answered 409 for each.

## Why It Broke

1. `fn_spin_reserve_pool` answers "which pool owns this club" and also made sure the pool row existed with `INSERT ... ON CONFLICT DO NOTHING`. Postgres fires BEFORE ROW INSERT triggers before it detects the conflict, so every lookup of an existing pool still ran `fn_guard_retired_club_mutation`, which takes the club row FOR KEY SHARE, and queued behind any writer of that club. `fn_spin_draw_multiplier` calls the lookup once per spin tournament row.
2. The engine resent a busy purchase only when the 55P03 carried the TOURNAMENT_PURCHASE_PLAYER_BUSY marker. The profiles row is taken NOWAIT and raises 55P03 without that marker, so the purchase ended unproven. A 23514 refusal was treated as an unproven answer, so the Horse input device re-asked the same offer every two seconds until the window closed.
3. `claimNightlyJob` claimed a night with a plain INSERT, so every losing claim was a unique violation by design.

## The Change

- Migration `20261126215837`: `fn_spin_reserve_pool` returns the owner without any write when the pool row exists and inserts only a missing pool. Grants unchanged (service_role only), probed before COMMIT, preimage pinned.
- Engine (`server/src/tournament/TournamentManagerEliminations.ts`): any 55P03 from the purchase RPC is busy and resent in place, bounded as before (the transaction rolled back, so the idempotent request is safe to resend). A 23514 refusal is the Horse's final no, persisted through `fn_decline_tournament_rebuy` and answered.
- Engine (`server/src/benchmark/HorseLeague.ts`): the nightly claim is `INSERT ... ON CONFLICT (job, run_date) DO NOTHING RETURNING job`. The primary key is still the lock; a lost claim is zero rows, not an error.

The two engine changes ship with the next certified cutover after merge.

## Hardening

- `tests/a-spin-pool-lookup-never-writes-an-existing-pool.law.test.ts` (law, `docs/laws.d/a-spin-pool-lookup-never-writes-an-existing-pool.md`).
- `server/src/tournament/tournamentPurchaseRefusal.test.ts`: the bare profiles NOWAIT is resent until bought; 23514 declines and answers before the urgent sweep re-arms.
- `server/src/benchmark/LeagueClaimRecovery.test.ts` and `HorseLeagueSchedule.test.ts`: the claim double refuses a plain insert and models ON CONFLICT DO NOTHING.
