-- 20261115181339_the_payout_day_union_books_tick_runs_the_post_money_close.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against origin/main,
-- every remote branch and every worktree on this machine.
--
-- THE PAYOUT-DAY UNION BOOKS TICK RUNS THE POST-MONEY CLOSE
--
-- WHAT WAS WRONG (pre-flight of the 2026-11-16 04:00 Chicago close, read on
-- production 2026-11-15, read only):
--
--   20261114163249 added cron job weekly-union-books (every 2 minutes, 900 s
--   statement, 8-minute scope budget): once the round runner has paid and
--   RELEASED the week, it calls public.fn_union_settlement_cascade_due() so the
--   union's books (P&L certification, one tournament proof per club, ECO and
--   the MIDWAY square-ups) close on Monday instead of two days later on job
--   272's 240 s tick. It has never yet run past the release (first payout day
--   is 2026-11-16).
--
--   fn_union_settlement_cascade_due() calls smarter_private.weekly_payout_due()
--   first. With the week's newest payout boundary RELEASED, weekly_payout_due
--   returns smarter_private.weekly_payout_prepare_due(), whose second
--   statement is the original bounded-tick pin:
--
--     IF COALESCE(current_setting('app.weekly_accounting_chunked',true),'')<>'on'
--      OR current_setting('statement_timeout')::interval IS DISTINCT FROM interval '240 seconds'
--     THEN RAISE EXCEPTION 'weekly_payout_original_bounded_tick_required' USING ERRCODE='55000';
--
--   Job 564 runs with statement_timeout 900 s, so every one of its ticks after
--   the release raises 55000 before the close is reached. Reproduced read-only
--   on production (2026-11-15 18:00Z): with set_config('statement_timeout',
--   '900s') and app.weekly_accounting_chunked='on',
--   smarter_private.weekly_payout_prepare_due() raises
--   weekly_payout_original_bounded_tick_required at line 13; with '240s' it
--   returns NULL (the week is fully paid, the plan is empty). The job would
--   fail every two minutes for twelve hours and the union's statements would
--   again wait for job 272 - the exact lateness 20261114163249 was written to
--   end. The money rounds are not affected: weekly_payout_next_round (job 528)
--   never calls prepare_due, and job 272 keeps its 240 s pin.
--
-- THE FIX. smarter_private.weekly_union_books_due() keeps every guard it had
-- (engine caller, payout-day window, freeze, round runner not released, open
-- union closes) and adds the one check weekly_payout_due would have made for
-- it: the week's scope plan must be EMPTY (every scope the week owes has its
-- financial receipt or its complete v3 run). A week that still owes a scope is
-- left to job 272's bounded tick, which prepares and pays it; this tick returns
-- 'weekly_union_books_waiting_for_owed_scopes' and touches nothing. With the
-- plan empty it takes the same scheduler lock the cascade takes
-- (hashtextextended('union-accounting-scheduler',0), try-lock, so it never
-- runs beside job 272 or job 528) and runs the cascade's post-money steps in
-- the cascade's own order and with its own return rule:
--
--     fn_midway_weekly_horse_promo_due()        (returns if it advanced or owns the tick)
--     fn_accounting_close_windows_advance_due() (returns if not null)
--     fn_process_weekly_accounting(NULL)        (the close itself)
--
-- Those three are exactly what fn_union_settlement_cascade_due() runs after
-- weekly_payout_due() returns NULL; the only thing left out is the
-- weekly_payout_due() call whose bounded-tick pin refuses a 900 s statement.
-- Neither of the three pins the statement budget (fn_process_weekly_accounting
-- _scope reads current_setting('statement_timeout') to size its own batches
-- and treats 20 minutes or more as a cron-sized tick). The advisory lock is
-- transaction-scoped and re-entrant within the session, so the try-locks the
-- three functions take themselves succeed.
--
-- No money logic changes. No pinned function changes: weekly_payout_due,
-- weekly_payout_prepare_due, fn_union_settlement_cascade_due and
-- fn_process_weekly_accounting_scope keep their production bodies (the scope
-- plan's authority pin on fn_process_weekly_accounting_scope stays
-- 4179282ab83f30094d4c3b2885102917). Job 564's schedule and settings are
-- unchanged. The preimage check below refuses to install over any body other
-- than the one 20261114163249 installed (md5 fd1fe5b44d1359d08ec9b4a17fba7add).
--
-- INSTALL. One CREATE OR REPLACE FUNCTION of a routine owned by postgres with
-- ACL {postgres=X/postgres}; the REVOKE restates that ACL. No table lock, no
-- data written: an ordinary merged-migration install.
--
-- Horses are players: nothing here reads is_horse.
--
-- @live-proof: position('weekly_union_books_waiting_for_owed_scopes' IN pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) > 0 AND position('weekly_payout_scope_plan(e, n)' IN pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) > 0 AND position('fn_union_settlement_cascade_due()' IN pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) = 0

BEGIN;
SET LOCAL lock_timeout = '4s';
SET LOCAL statement_timeout = '30s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure))
       IS DISTINCT FROM 'fd1fe5b44d1359d08ec9b4a17fba7add' THEN
    RAISE EXCEPTION 'WEEKLY_UNION_BOOKS_PREIMAGE_CHANGED: %',
      md5(pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure));
  END IF;
  IF md5(pg_get_functiondef('public.fn_process_weekly_accounting_scope(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM '4179282ab83f30094d4c3b2885102917' THEN
    RAISE EXCEPTION 'WEEKLY_UNION_BOOKS_SCOPE_AUTHORITY_CHANGED';
  END IF;
END
$preimage$;

CREATE OR REPLACE FUNCTION smarter_private.weekly_union_books_due()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  n timestamptz := clock_timestamp();
  e timestamptz := public.fn_union_week_start(clock_timestamp());
  due timestamptz;
  v_open jsonb;
  v_plan jsonb;
  v_tick jsonb;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  due := public.fn_union_accounting_run_at(e);
  IF n < due OR n >= due + interval '12 hours' THEN RETURN NULL; END IF;
  IF public.fn_entry_purchases_frozen() IS NOT FALSE OR public.fn_platform_frozen() IS NOT FALSE THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_frozen');
  END IF;
  -- The round runner owns the money until it releases the week.
  IF EXISTS (SELECT 1 FROM public.weekly_accounting_payout_pauses p
              WHERE p.period_end = e AND p.instance_id = 'weekly-payout-rounds'
                AND p.phase <> 'released') THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_waiting_for_payout');
  END IF;
  -- Every union the released payout covered whose close is still open.
  SELECT jsonb_agg(DISTINCT s.value->>'id') INTO v_open
    FROM public.weekly_accounting_payout_pauses p
    CROSS JOIN LATERAL jsonb_array_elements(p.scope_plan) s
   WHERE p.period_end = e AND p.instance_id = 'weekly-payout-rounds' AND p.phase = 'released'
     AND s.value->>'kind' = 'union'
     AND NOT EXISTS (SELECT 1 FROM public.union_accounting_runs r
                      WHERE r.scope_kind = 'union' AND r.scope_id = (s.value->>'id')::uuid
                        AND r.period_end = e AND r.status = 'complete');
  IF v_open IS NULL OR jsonb_array_length(v_open) = 0 THEN RETURN NULL; END IF;
  -- THE WEEK'S MONEY MUST BE DONE (2026-11-15). The scope plan lists every
  -- scope this week still owes. While it is not empty the original 240 s tick
  -- (job 272, union-weekly-rakeback-close) prepares and pays it through
  -- weekly_payout_due; this 900 s tick cannot enter that path (its bounded-tick
  -- pin refuses any other statement budget) and leaves the week alone.
  v_plan := smarter_private.weekly_payout_scope_plan(e, n);
  IF v_plan IS NOT NULL AND jsonb_array_length(v_plan) > 0 THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_waiting_for_owed_scopes',
      'open_unions', v_open, 'owed', v_plan);
  END IF;
  -- The cascade's own scheduler lock: never beside job 272 or job 528.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('union-accounting-scheduler', 0)) THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books_scheduler_busy', 'open_unions', v_open);
  END IF;
  -- The post-money steps of fn_union_settlement_cascade_due, in its order and
  -- with its return rule; only the paid-week weekly_payout_due call is left out.
  v_tick := public.fn_midway_weekly_horse_promo_due();
  IF v_tick->>'advanced' = 'true' OR v_tick->>'owns_tick' = 'true' THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books', 'open_unions', v_open, 'tick', v_tick);
  END IF;
  v_tick := public.fn_accounting_close_windows_advance_due();
  IF v_tick IS NOT NULL THEN
    RETURN jsonb_build_object('stage', 'weekly_union_books', 'open_unions', v_open, 'tick', v_tick);
  END IF;
  RETURN jsonb_build_object('stage', 'weekly_union_books', 'open_unions', v_open,
    'tick', public.fn_process_weekly_accounting(NULL));
END
$function$;
REVOKE ALL ON FUNCTION smarter_private.weekly_union_books_due() FROM PUBLIC, anon, authenticated, service_role;

DO $post$
BEGIN
  IF position('weekly_union_books_waiting_for_owed_scopes' IN
       pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) = 0
     OR position('fn_union_settlement_cascade_due()' IN
       pg_get_functiondef('smarter_private.weekly_union_books_due()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'WEEKLY_UNION_BOOKS_INSTALL_MISMATCH';
  END IF;
  IF (SELECT proowner::regrole::text FROM pg_proc
       WHERE oid = 'smarter_private.weekly_union_books_due()'::regprocedure) <> 'postgres' THEN
    RAISE EXCEPTION 'WEEKLY_UNION_BOOKS_OWNER_MOVED';
  END IF;
END
$post$;

COMMIT;
