-- 20261124170034_promo_sweep_defers_an_account_that_outruns_its_budget.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- public.sp_ca_promo_profit_hourly_sweep(integer) (cron job 570, every 2
-- minutes, CALL ...(15)) checks its run budget only BETWEEN accounts. Inside one
-- account nothing bounded the work except the statement_timeout of the role
-- the job runs as (postgres: 2 min). When that timer fired inside an account's
-- LOOK refresh, the cancel (SQLSTATE 57014, query_canceled) was not caught,
-- because PL/pgSQL's WHEN OTHERS never catches query_canceled. The whole run
-- failed, and because the failing account had no sweep-state row it sorted
-- FIRST on the next run, so the next run spent its time on the same account
-- and failed the same way. Production evidence (cron.job_run_details, job 570):
-- runs 3105787 (2026-11-20 05:04Z), 3106101 (05:10Z) and 3294974
-- (2026-11-22 15:46Z) all failed at exactly 120.0 s with "canceling statement
-- due to statement timeout" inside fn_ca_promo_fee_state_refresh, line 46 at IF.
--
-- (The 160.2 s run 3420840 at 2026-11-24 06:40Z is NOT a sweep overrun. The
-- pg_cron launcher was blocked for 157.7 s by job 286, a multi-statement
-- command whose replay sends NOTICEs: pg_cron 1.6.4 loops on PQgetResult
-- inside its launcher. 27 runs recorded their end within 0.5 s of 286's, and
-- the sweep's own candidate query finished 06:40:15Z. Fixed at its source by
-- 20261124204828_every_cron_job_is_one_statement.sql.)
--
-- PostgreSQL cannot arm a fresh statement timer inside a procedure: neither
-- SET LOCAL nor set_config('statement_timeout', ...) before or after an
-- in-procedure COMMIT takes effect until the next top-level statement, and a
-- pg_cron command of the form "SET ...; CALL ..." runs in an implicit
-- transaction block, where a committing procedure fails with "invalid
-- transaction termination". Both are proved on native PG17 by
-- scripts/ci/test-promo-sweep-defers-an-overrunning-account.py. The only timer
-- that reaches an account's work is the CALL's own statement_timeout, so this
-- migration makes that timer a clean per-account deferral instead of a failed
-- run:
--
--   1. query_canceled is caught in LOOK, ACT and POST-ACT. The account's
--      sub-transaction rolls back, so ca_promo_fee_state_cache and its
--      computed_at watermark stay exactly as they were, and no gate or grant
--      changes. The account is recorded with last_error 'deferred: run budget';
--      last_swept_at is NOT advanced (a never-swept account gets -infinity), so
--      no activity window, 1-hour gate or 6-hour floor moves. The run then
--      stops (its time is spent), unlocks and returns success.
--   2. A deferred account sorts AFTER every other candidate on the next run, so
--      one slow account can no longer take every run's time; it is still looked
--      at as soon as the others are done, and a successful look clears the mark.
--   3. LOOK and POST-ACT now run with lock_timeout 1s (local), as ACT already
--      did, so a row lock can never stretch an account; a lock-not-available
--      in LOOK is 'busy' exactly like ACT's (no state write, next run retries).
--
-- Unchanged: candidate selection, the 15 s loop budget, the :55 freeze, the
-- session advisory key, ACT's try-lock/NOWAIT/lock_timeout and 'busy'
-- semantics, every gate/grant predicate, the post-act cache sync, the 5-minute
-- error backoff and the cron job (no job is added or changed).
--
-- @live-proof: (SELECT position('deferred: run budget' IN pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) > 0 AND position('WHEN query_canceled' IN pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) > 0 AND position('EXIT WHEN v_deferred' IN pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '60s';

DO $sweep_defers$
DECLARE
  d text;
  n text;
  i integer;
  pairs text[] := ARRAY[
    -- 1. declare the deferral flag
    $a$  v_act_mutated boolean;
$a$,
    $a$  v_act_mutated boolean;
  v_deferred    boolean := false;
$a$,
    -- 2. reset it per account
    $a$    v_act_mutated := false;

    -- LOOK. No grant row, no member row and no member scope is held.
    BEGIN
      IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
$a$,
    $a$    v_act_mutated := false;
    v_deferred := false;

    -- LOOK. No grant row, no member row and no member scope is held.
    BEGIN
      -- 20261124170034: never queue behind a row lock here either.
      PERFORM set_config('lock_timeout', '1s', true);
      IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
$a$,
    -- 3. LOOK: the run's timer is a deferral, a lock is 'busy'
    $a$    EXCEPTION WHEN OTHERS THEN
      v_err := left(SQLERRM, 500);
    END;
$a$,
    $a$    EXCEPTION
      WHEN query_canceled THEN
        -- 20261124170034: the run's time ran out inside this account. Its
        -- look rolled back; the cache and its watermark are untouched.
        v_deferred := true;
      WHEN OTHERS THEN
        v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
    END;
$a$,
    -- 4. ACT only for an account that was looked at in full
    $a$    IF v_err IS NULL AND (v_unlock IS NOT NULL OR v_met IS NOT NULL) THEN
$a$,
    $a$    IF v_err IS NULL AND NOT v_deferred AND (v_unlock IS NOT NULL OR v_met IS NOT NULL) THEN
$a$,
    -- 5. ACT: the run's timer is a deferral
    $a$      EXCEPTION WHEN OTHERS THEN
        v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
      END;
$a$,
    $a$      EXCEPTION
        WHEN query_canceled THEN
          v_deferred := true;
          v_act_mutated := false;
        WHEN OTHERS THEN
          v_err := CASE WHEN SQLSTATE = '55P03' THEN 'busy' ELSE left(SQLERRM, 500) END;
      END;
$a$,
    -- 6. record a deferral without moving any watermark
    $a$    IF v_err IS DISTINCT FROM 'busy' THEN
      INSERT INTO public.ca_promo_profit_sweep_state AS st
$a$,
    $a$    IF v_deferred THEN
      -- 20261124170034: keep last_swept_at (a never-swept account gets
      -- -infinity, which every predicate reads as "never"), so no activity
      -- window moves; the mark sorts this account last on the next run.
      INSERT INTO public.ca_promo_profit_sweep_state AS st
        (club_id, user_id, last_swept_at, last_ms, last_error)
      VALUES (r.club_id, r.user_id, '-infinity'::timestamptz,
              (extract(epoch FROM clock_timestamp() - t0) * 1000)::integer, 'deferred: run budget')
      ON CONFLICT (club_id, user_id) DO UPDATE
        SET last_ms    = EXCLUDED.last_ms,
            last_error = EXCLUDED.last_error;
    ELSIF v_err IS DISTINCT FROM 'busy' THEN
      INSERT INTO public.ca_promo_profit_sweep_state AS st
$a$,
    -- 7. POST-ACT: bounded lock wait, the run's timer is a deferral
    $a$        BEGIN
          IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
            UPDATE public.ca_promo_profit_sweep_state
$a$,
    $a$        BEGIN
          PERFORM set_config('lock_timeout', '1s', true);
          IF public.fn_ca_promo_fee_state_refresh(r.club_id, r.user_id) THEN
            UPDATE public.ca_promo_profit_sweep_state
$a$,
    $a$        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
$a$,
    $a$        EXCEPTION
          WHEN query_canceled THEN
            -- The grant change is committed; the stale cache row is picked
            -- up by the signature check on the next run.
            v_deferred := true;
          WHEN OTHERS THEN
            NULL;
        END;
$a$,
    -- 8. stop once the run's time is spent
    $a$    END IF;
  END LOOP;
$a$,
    $a$    END IF;
    -- 20261124170034: the run's timer fired; nothing more fits in this run.
    EXIT WHEN v_deferred;
  END LOOP;
$a$,
    -- 9. a deferred account goes after every other candidate
    $a$     ORDER BY
       (k.club_id IS NULL
$a$,
    $a$     ORDER BY
       COALESCE(s.last_error = 'deferred: run budget', false),
       (k.club_id IS NULL
$a$
  ];
BEGIN
  d := pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure);
  IF position('deferred: run budget' IN d) > 0 THEN
    RETURN; -- already installed: idempotent
  END IF;
  n := d;
  i := 1;
  WHILE i < array_length(pairs, 1) LOOP
    IF (length(n) - length(replace(n, pairs[i], ''))) / length(pairs[i]) <> 1 THEN
      RAISE EXCEPTION 'sp_ca_promo_profit_hourly_sweep anchor % is not present exactly once', (i + 1) / 2;
    END IF;
    n := replace(n, pairs[i], pairs[i + 1]);
    i := i + 2;
  END LOOP;
  EXECUTE n;

  d := pg_get_functiondef('public.sp_ca_promo_profit_hourly_sweep(integer)'::regprocedure);
  IF position('deferred: run budget' IN d) = 0 OR position('EXIT WHEN v_deferred' IN d) = 0 THEN
    RAISE EXCEPTION 'sp_ca_promo_profit_hourly_sweep deferral did not install';
  END IF;
END $sweep_defers$;

REVOKE ALL ON PROCEDURE public.sp_ca_promo_profit_hourly_sweep(integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- @probe-exempt: public.sp_ca_promo_profit_hourly_sweep is a procedure that COMMITs per account, so it cannot be CALLed inside this migration's transaction (invalid transaction termination); the rewritten body was compiled against production in a rolled-back probe (md5 0e091543e181e4031b2dea388d50a27f) and is executed end to end by scripts/ci/test-promo-sweep-defers-an-overrunning-account.py
COMMIT;
