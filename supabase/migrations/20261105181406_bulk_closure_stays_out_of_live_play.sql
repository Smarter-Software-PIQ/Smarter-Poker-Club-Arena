-- 20261105181406_bulk_closure_stays_out_of_live_play
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05 18:14:06 UTC.
--
-- BULK CLOSURE STAYS OUT OF LIVE PLAY (owner approval, November 5 2026:
-- "BUILD THE 3 FREEZE FIXES AND SHIP THEM LIVE AT THE NEXT SAFE BREAK", fix 2)
--
-- WHAT WENT WRONG, READ FROM ROWS
--
-- Night of 2026-11-04/05: the stuck-event closeout (owner retirement,
-- original-charge refund, equal-share) ran while tables were live. Every one
-- of these doors takes the cancellation lane (smarter_private.
-- cancellation_lane: G and the hand-settlement barrier B, exclusive) and then
-- locks the event's players, tables and seats. Measured:
--   * fn_ca_owner_retire_tournament: 115 PostgREST calls, mean 1.25 s, max
--     7.5 s; two direct postgres-session calls of 16.9 s and 20.8 s (no 8 s
--     service ceiling applied to them).
--   * fn_ca_settle_tournament_abort: mean 2.6 s, max 3.9 s.
--   * Nightly 10K (37b4adc0) carried 319 player rows; Midday Free Buy
--     (10146b16) 401. One transaction refunds every one of them.
--   * At ~04:05 UTC a settlement loop held the lane through the hourly
--     resume; ~40 Spins/Sit & Gos timed out and froze. At 05:09 UTC one
--     large event's removal froze 46 live tables.
-- The night was finished by ad-hoc scripts that stayed idle :53-:08 and
-- paused between settlements. Nothing in the platform enforced either rule.
--
-- WHAT THIS CHANGES
--
-- One admission, smarter_private.bulk_closure_admission(kind, tournament_ids),
-- is now the first statement of every operator bulk closure/refund door:
--   fn_ca_settle_tournament_abort            (original-charge refund)
--   fn_ca_settle_tournament_abort_equal_share (equal-share closure)
--   fn_ca_owner_retire_tournament            (owner retirement / removal)
--   fn_ca_operator_cancel_tournament         (console cancel + refund)
--   fn_ca_request_tournament_abort           (bulk stop request, up to 1000 ids)
-- It refuses (SQLSTATE 55P03, message bulk_closure_<reason>, nothing written):
--   break_window      minute-of-hour :53 through :07 UTC (encloses the :53
--                     announcement, the :55 tournament break, the Phase1
--                     :58-:05 maintenance and the :00 resume waves)
--   maintenance_active fn_entry_purchases_frozen() (announced/counting-down
--                     break or an active release boundary)
--   resume_settling   a thaw recorded in the last 180 s
--   large_outside_quiet_hours  more than 50 player rows across the targets
--                     ("large" = the accounts one transaction would touch)
--                     outside the daily quiet window in
--                     smarter_private.daily_window_policy (04:00-06:00
--                     America/Chicago, when every game is closed)
--   unbounded_caller  the caller's statement_timeout is 0 or above 8 s (the
--                     service ceiling). A direct postgres session must
--                     SET statement_timeout first, so no call can run 20 s.
--                     (fn_ca_operator_cancel_tournament pins its own 120 s
--                     SET clause, so this one check is not applied there; its
--                     PostgREST caller's 8 s statement ceiling still applies.)
--   cooldown          another settlement-kind admission committed less than
--                     5 s ago (the enforced pause between batches)
-- When it admits, it sets lock_timeout 100ms for the rest of the
-- transaction: a closure that meets a held row refuses and rolls back
-- atomically instead of queueing behind live play while holding the lane.
-- Each admission is recorded in smarter_private.bulk_closure_admissions.
--
-- WHAT THIS DOES NOT CHANGE
--
-- No refund, prize, fee or share arithmetic. The guard line is inserted
-- before each function's existing first lane statement; every other byte of
-- each body is the exact production body (preimage md5 pinned below and
-- refused on drift), so receipts, replay, conservation and double-pay proofs
-- are untouched. A replay of a settled operation is refused only by the
-- clock/maintenance rules, and is free to repeat after them. No new-start
-- hold: registration and new tournaments are not touched.
-- Engine-side twin: server/src/maintenance/bulkClosureGuard.ts (the
-- /admin/tournament-abort-boundary endpoint), constants pinned equal by
-- server/src/maintenance/bulkClosureGuard.test.ts.
--
-- Wrap ALL DDL for one change in ONE transaction (CLAUDE.md DDL policy).
-- @live-proof: to_regprocedure('smarter_private.bulk_closure_admission(text,uuid[])') IS NOT NULL AND (SELECT bool_and(position('PERFORM smarter_private.bulk_closure_admission(' in pg_get_functiondef(to_regprocedure(s)))>0) FROM (VALUES ('public.fn_ca_settle_tournament_abort(uuid,uuid,text)'),('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)'),('public.fn_ca_owner_retire_tournament(uuid,uuid,text)'),('public.fn_ca_operator_cancel_tournament(uuid,uuid,text,uuid,text)'),('public.fn_ca_request_tournament_abort(uuid,uuid[],text)')) v(s)) AND NOT has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

DO $pre$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.fn_ca_settle_tournament_abort(uuid,uuid,text)','41bd8459f2927155ad9613d9f0a52dbb'),
  ('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','1975b4c245da7c434772e862cfa57513'),
  ('public.fn_ca_owner_retire_tournament(uuid,uuid,text)','b1a287a84785c5d656cc928d35cc9e3f'),
  ('public.fn_ca_operator_cancel_tournament(uuid,uuid,text,uuid,text)','8f945f3bd0f73034108bd8eedd14f8ea'),
  ('public.fn_ca_request_tournament_abort(uuid,uuid[],text)','3025d9faf65e9b2336dcf9b794f6c17f')) v(sig,expected) LOOP
  IF md5(pg_get_functiondef(r.sig::regprocedure)) IS DISTINCT FROM r.expected THEN
   RAISE EXCEPTION 'BULK_CLOSURE_PREIMAGE_DRIFT %',r.sig;
  END IF;
 END LOOP;
END $pre$;

CREATE TABLE smarter_private.bulk_closure_admissions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN('settle_refund','settle_equal_share','owner_retire','operator_cancel','request_abort')),
 tournament_ids uuid[] NOT NULL,
 entrants bigint NOT NULL CHECK(entrants>=0),
 admitted_at timestamptz NOT NULL
);
CREATE INDEX bulk_closure_admissions_settlement_at ON smarter_private.bulk_closure_admissions(admitted_at DESC) WHERE kind<>'request_abort';
REVOKE ALL ON smarter_private.bulk_closure_admissions FROM PUBLIC,anon,authenticated,service_role;

-- The one clock every rule reads. A disposable test cluster may replace it;
-- in production only its owner (postgres) can, exactly as for any function.
CREATE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz
 LANGUAGE sql VOLATILE SET search_path TO 'pg_catalog' AS $$ SELECT clock_timestamp() $$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_clock() FROM PUBLIC,anon,authenticated,service_role;

-- NULL when a closure of this size may run at p_at; otherwise the reason.
-- Read-only: it answers, it never writes.
CREATE FUNCTION smarter_private.bulk_closure_refusal(p_kind text, p_entrants bigint, p_at timestamptz, p_statement_timeout_ms bigint)
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
 v_minute integer; p smarter_private.daily_window_policy; v_local time;
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
 IF p_entrants > c_large_entrants THEN
  SELECT * INTO p FROM smarter_private.daily_window_policy WHERE singleton;
  IF NOT FOUND THEN RETURN 'large_outside_quiet_hours'; END IF;
  v_local := (p_at AT TIME ZONE p.time_zone)::time;
  IF NOT (v_local >= p.window_start AND v_local < p.window_end) THEN RETURN 'large_outside_quiet_hours'; END IF;
 END IF;
 IF p_kind <> 'operator_cancel' AND (p_statement_timeout_ms IS NULL OR p_statement_timeout_ms <= 0 OR p_statement_timeout_ms > c_max_statement_timeout_ms) THEN
  RETURN 'unbounded_caller';
 END IF;
 IF p_kind <> 'request_abort' AND EXISTS(SELECT 1 FROM smarter_private.bulk_closure_admissions a
  WHERE a.kind <> 'request_abort' AND a.admitted_at > p_at - make_interval(secs => c_settlement_cooldown_seconds) AND a.admitted_at <= p_at) THEN
  RETURN 'cooldown';
 END IF;
 RETURN NULL;
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint) FROM PUBLIC,anon,authenticated,service_role;

-- The admission every bulk closure door runs first. Refuses with 55P03 and
-- writes nothing, or records the admission and bounds every later lock wait
-- in this transaction to 100 ms.
CREATE FUNCTION smarter_private.bulk_closure_admission(p_kind text, p_tournament_ids uuid[])
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
   HINT='Bulk closures run outside :53-:08 UTC and maintenance; more than 50 accounts only 04:00-06:00 America/Chicago; at most one settlement per 5 s; statement_timeout 8 s or less. Nothing was written.';
 END IF;
 PERFORM set_config('lock_timeout','100ms',true);
 INSERT INTO smarter_private.bulk_closure_admissions(kind,tournament_ids,entrants,admitted_at)
 VALUES(p_kind,p_tournament_ids,v_entrants,v_at);
END $fn$;
REVOKE ALL ON FUNCTION smarter_private.bulk_closure_admission(text,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

-- Insert the admission before each door's existing first lane statement.
DO $wire$
DECLARE r record; src text; n integer; out text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('public.fn_ca_settle_tournament_abort(uuid,uuid,text)',
   E'BEGIN\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n',
   E'BEGIN\n PERFORM smarter_private.bulk_closure_admission(''settle_refund'',ARRAY[p_tournament_id]);\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n'),
  ('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)',
   E'BEGIN\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n',
   E'BEGIN\n PERFORM smarter_private.bulk_closure_admission(''settle_equal_share'',ARRAY[p_tournament_id]);\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n'),
  ('public.fn_ca_owner_retire_tournament(uuid,uuid,text)',
   E'BEGIN\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n',
   E'BEGIN\n PERFORM smarter_private.bulk_closure_admission(''owner_retire'',ARRAY[p_tournament_id]);\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n'),
  ('public.fn_ca_operator_cancel_tournament(uuid,uuid,text,uuid,text)',
   E' -- Same global settlement lane as the existing cancellation/finish authorities.\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n',
   E' PERFORM smarter_private.bulk_closure_admission(''operator_cancel'',ARRAY[p_tournament_id]);\n -- Same global settlement lane as the existing cancellation/finish authorities.\n PERFORM smarter_private.cancellation_lane(p_tournament_id);\n'),
  ('public.fn_ca_request_tournament_abort(uuid,uuid[],text)',
   E'RAISE EXCEPTION ''operator_abort_duplicate_target'' USING ERRCODE=''22023'';END IF;\n',
   E'RAISE EXCEPTION ''operator_abort_duplicate_target'' USING ERRCODE=''22023'';END IF;\n PERFORM smarter_private.bulk_closure_admission(''request_abort'',ids);\n')
 ) v(sig,needle,replacement) LOOP
  src := pg_get_functiondef(r.sig::regprocedure);
  n := (length(src) - length(replace(src, r.needle, ''))) / length(r.needle);
  IF n <> 1 THEN RAISE EXCEPTION 'BULK_CLOSURE_ANCHOR % found % times', r.sig, n; END IF;
  out := replace(src, r.needle, r.replacement);
  EXECUTE out;
  IF pg_get_functiondef(r.sig::regprocedure) IS DISTINCT FROM out THEN
   RAISE EXCEPTION 'BULK_CLOSURE_POSTIMAGE_DRIFT %', r.sig;
  END IF;
 END LOOP;
END $wire$;

-- The ACLs survive CREATE OR REPLACE; prove it rather than assume it.
DO $post$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid IN(
   'public.fn_ca_settle_tournament_abort(uuid,uuid,text)'::regprocedure,
   'public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)'::regprocedure,
   'public.fn_ca_owner_retire_tournament(uuid,uuid,text)'::regprocedure,
   'public.fn_ca_operator_cancel_tournament(uuid,uuid,text,uuid,text)'::regprocedure,
   'public.fn_ca_request_tournament_abort(uuid,uuid[],text)'::regprocedure)
  AND (p.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}' OR NOT p.prosecdef OR p.proowner<>'postgres'::regrole)) THEN
  RAISE EXCEPTION 'BULK_CLOSURE_ACL_DRIFT';
 END IF;
 IF has_function_privilege('service_role','smarter_private.bulk_closure_admission(text,uuid[])','EXECUTE')
  OR has_function_privilege('authenticated','smarter_private.bulk_closure_refusal(text,bigint,timestamptz,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'BULK_CLOSURE_PRIVATE_EXPOSED';
 END IF;
END $post$;

COMMIT;
