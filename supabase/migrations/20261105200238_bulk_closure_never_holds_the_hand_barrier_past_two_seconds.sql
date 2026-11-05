-- 20261105200238_bulk_closure_never_holds_the_hand_barrier_past_two_seconds
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 20:02:38 UTC.
--
-- A BULK CLOSURE NEVER HOLDS THE HAND BARRIER PAST TWO SECONDS DURING PLAY
-- (owner approval November 5 2026, fix 2, second half; follows
-- 20261105181406_bulk_closure_stays_out_of_live_play.sql).
--
-- THE LOCK THAT FROZE THE TABLES, READ FROM THE LOGS
--
-- Every hand commit platform-wide takes the hand-settlement barrier SHARED:
--   public.fn_ca_share_settlement_lane_for_table
--     pg_advisory_xact_lock_shared(hashtextextended('ca:hand-settlement-barrier:v1',0))
-- Every closure takes the same barrier EXCLUSIVE and holds it to COMMIT:
--   smarter_private.cancellation_lane -> pg_try_advisory_xact_lock(b)
-- So while one closure runs, no hand anywhere can commit.
--
-- 04:05 UTC Nov 5 (postgres_logs): fn_ca_owner_retire_tournament held the
-- barrier until its own 8 s service statement_timeout killed it (57014 at
-- 04:05:15.333, 04:05:26.284, 04:05:47.047; context "after_history:=" - the
-- step that md5s the event's whole hand_history). Hand commits queued
-- behind it hit THEIR 8 s ceiling and died: fn_ca_retain_hand_submission
-- 57014 at 04:05:15.379, fn_ca_commit_hand_submission 57014 at 04:05:26.308.
-- An operator probe meanwhile retried fn_ca_settle_tournament_abort 41 times
-- against CANCELLATION_GLOBAL_LANE_BUSY (04:05:53.853). 12/20/20 statement
-- timeouts per minute 04:05-04:07 against 0 at 04:00-04:04.
-- 05:09 UTC: fn_ca_owner_retire_tournament (Nightly 10K, 3,933 hands, 24 MB
-- of hand_history, md5'd twice) 57014 at 05:09:11.246 in "before_history:=";
-- 32 more 57014s in the next 400 ms from hand commits waiting in
-- fn_ca_share_settlement_lane_for_table and f06_authority. 33 timeouts that
-- minute against 0 in each minute 05:10-05:14.
--
-- The previous migration decides WHEN a closure may run and bounds how long
-- it WAITS for a lock (100 ms). It still let an admitted closure HOLD the
-- barrier for the full 8 s ceiling, which is exactly what killed the hands.
--
-- WHAT THIS CHANGES
--
-- During live play (outside 04:00-06:00 America/Chicago) a closure is
-- admitted only when the statement it runs in has a ceiling of 2 s or less
-- (statement_timeout in (0, 2000] ms). Every door is one statement, so that
-- ceiling bounds how long it can hold the barrier: a hand waiting behind it
-- (its own ceiling 8 s) commits late, never fails. In the quiet window, when
-- every game is closed, the 8 s ceiling still applies, so the largest events
-- (24 MB of history) close there. PostgREST service calls carry 8 s, so
-- during play they are refused unless the caller lowers its own ceiling.
-- A closure that overruns is cancelled by Postgres and rolls back
-- atomically (no refund, receipt or state is written); the same request can
-- simply be repeated, since every door is idempotent and a settled replay
-- returns its original receipt.
--
-- WHY THE CEILING IS CHECKED, NOT SET (measured on PostgreSQL 17,
-- 2026-11-05): set_config('statement_timeout',...) inside a running
-- statement does not bound that statement, and a function SET clause does
-- not either; only transaction_timeout does, and it ends the whole session
-- with FATAL, which on the shared PostgREST pool is worse than the problem.
-- The caller's own ceiling is the one bound Postgres enforces on the
-- statement already running, so the admission refuses any caller without one.
--
-- WHY THE HAND-HISTORY PROOF IS NOT MOVED OUT OF THE LOCK
--
-- before_history/after_history md5 the event's hand_history inside the lane
-- to prove no hand was written WHILE the closure held it. A hash taken before
-- the lock proves nothing about that window, and a row count / max id mark
-- would miss an UPDATE to an existing row, which is what it guards. Keeping
-- the proof whole and bounding the hold instead keeps every existing proof.
--
-- Only smarter_private.bulk_closure_refusal and bulk_closure_admission
-- change; no money door body, refund, prize, fee or share arithmetic.
-- @live-proof: position('c_live_max_statement_timeout_ms CONSTANT bigint := 2000;' in pg_get_functiondef('smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint)'::regprocedure))>0 AND position('hold_exceeds_live_bound' in pg_get_functiondef('smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint)'::regprocedure))>0 AND NOT has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $pre$
BEGIN
 IF to_regprocedure('smarter_private.bulk_closure_admission(text,uuid[])') IS NULL
  OR to_regprocedure('smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint)') IS NULL THEN
  RAISE EXCEPTION 'BULK_CLOSURE_HOLD_BOUND_REQUIRES_20261105181406';
 END IF;
END $pre$;

CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_refusal(p_kind text, p_entrants bigint, p_at timestamptz, p_statement_timeout_ms bigint)
 RETURNS text LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog','public','smarter_private'
AS $fn$
DECLARE
 -- Pinned equal to server/src/maintenance/bulkClosureGuard.ts by its test.
 c_break_opens_minute CONSTANT integer := 53;
 c_break_closes_minute CONSTANT integer := 8;
 c_large_entrants CONSTANT bigint := 50;
 c_resume_settle_seconds CONSTANT integer := 180;
 c_settlement_cooldown_seconds CONSTANT integer := 5;
 c_max_statement_timeout_ms CONSTANT bigint := 8000;
 -- During play a closure may hold the hand barrier for at most this long;
 -- a waiting hand's own ceiling is 8 s, so it commits late, never fails.
 c_live_max_statement_timeout_ms CONSTANT bigint := 2000;
 v_minute integer; p smarter_private.daily_window_policy; v_local time; v_quiet boolean := false;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN('settle_refund','settle_equal_share','owner_retire','operator_cancel','request_abort') THEN
  RETURN 'unknown_kind';
 END IF;
 IF p_at IS NULL OR p_entrants IS NULL OR p_entrants<0 THEN RETURN 'size_unknown'; END IF;
 v_minute := extract(minute FROM (p_at AT TIME ZONE 'UTC'))::integer;
 IF v_minute >= c_break_opens_minute OR v_minute < c_break_closes_minute THEN RETURN 'break_window'; END IF;
 IF public.fn_entry_purchases_frozen() THEN RETURN 'maintenance_active'; END IF;
 IF EXISTS(SELECT 1 FROM (SELECT x.thawed_at FROM public.engine_maintenance_thaws x ORDER BY x.freeze_started_at DESC LIMIT 3) t
  WHERE t.thawed_at > p_at - make_interval(secs => c_resume_settle_seconds) AND t.thawed_at <= p_at + interval '1 minute') THEN
  RETURN 'resume_settling';
 END IF;
 SELECT * INTO p FROM smarter_private.daily_window_policy WHERE singleton;
 IF FOUND THEN
  v_local := (p_at AT TIME ZONE p.time_zone)::time;
  v_quiet := v_local >= p.window_start AND v_local < p.window_end;
 END IF;
 IF p_entrants > c_large_entrants AND NOT v_quiet THEN RETURN 'large_outside_quiet_hours'; END IF;
 IF p_kind <> 'operator_cancel' AND (p_statement_timeout_ms IS NULL OR p_statement_timeout_ms <= 0 OR p_statement_timeout_ms > c_max_statement_timeout_ms) THEN
  RETURN 'unbounded_caller';
 END IF;
 -- During play the hold may not exceed 2 s. The console cancel pins its own
 -- 120 s SET clause, so it can only run in the quiet window.
 IF NOT v_quiet AND (p_kind = 'operator_cancel' OR p_statement_timeout_ms > c_live_max_statement_timeout_ms) THEN
  RETURN 'hold_exceeds_live_bound';
 END IF;
 IF p_kind <> 'request_abort' AND EXISTS(SELECT 1 FROM smarter_private.bulk_closure_admissions a
  WHERE a.kind <> 'request_abort' AND a.admitted_at > p_at - make_interval(secs => c_settlement_cooldown_seconds) AND a.admitted_at <= p_at) THEN
  RETURN 'cooldown';
 END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION smarter_private.bulk_closure_admission(p_kind text, p_tournament_ids uuid[])
 RETURNS void LANGUAGE plpgsql VOLATILE SET search_path TO 'pg_catalog','public','smarter_private'
AS $fn$
DECLARE v_at timestamptz := smarter_private.bulk_closure_clock(); v_entrants bigint; v_timeout bigint; v_refusal text;
BEGIN
 IF p_tournament_ids IS NULL OR cardinality(p_tournament_ids)=0 THEN v_entrants := NULL;
 ELSE SELECT count(*) INTO v_entrants FROM public.tournament_players WHERE tournament_id = ANY(p_tournament_ids);
 END IF;
 SELECT setting::bigint INTO v_timeout FROM pg_catalog.pg_settings WHERE name='statement_timeout';
 v_refusal := smarter_private.bulk_closure_refusal(p_kind, v_entrants, v_at, v_timeout);
 IF v_refusal IS NOT NULL THEN
  RAISE EXCEPTION 'bulk_closure_%', v_refusal USING ERRCODE='55P03',
   DETAIL=jsonb_build_object('kind',p_kind,'entrants',v_entrants,'at',v_at,'statement_timeout_ms',v_timeout)::text,
   HINT='Bulk closures run outside :53-:08 UTC and maintenance; more than 50 accounts only 04:00-06:00 America/Chicago; at most one settlement per 5 s; statement_timeout 2 s or less during play (8 s in the quiet window). Nothing was written.';
 END IF;
 PERFORM set_config('lock_timeout','100ms',true);
 INSERT INTO smarter_private.bulk_closure_admissions(kind,tournament_ids,entrants,admitted_at)
 VALUES(p_kind,p_tournament_ids,v_entrants,v_at);
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_admission(text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

DO $post$
BEGIN
 IF has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')
  OR has_function_privilege('authenticated','smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'BULK_CLOSURE_PRIVATE_EXPOSED';
 END IF;
END $post$;

COMMIT;
