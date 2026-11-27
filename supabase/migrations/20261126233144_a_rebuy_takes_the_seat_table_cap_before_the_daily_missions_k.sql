-- 20261126233144_a_rebuy_takes_the_seat_table_cap_before_the_daily_missions_k.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A REBUY TAKES THE SEAT ROOT'S TABLE CAP BEFORE THE DAILY MISSIONS KEY
--
-- THE DEFECT, READ FROM THE POSTGRES LOG. At 2026-11-26 15:23:23.393 UTC a
-- tournament seat acquisition was cancelled as the deadlock victim while it
-- waited in fn_lock_daily_mission_user line 7 (advisory
-- 'daily-missions-user:'||user), called from
-- fn_ca_lock_tournament_seat_acquisition. The other side was the same
-- player's process_tournament_rebuy.
--
-- THE CAUSE, BY LINE (live definitions read 2026-11-26). The player has two
-- table-cap keys: the bigint hashtextextended('table_cap:'||user,0) and the
-- two-int (hashtext('table_cap'),hashtext(user)) the seat roots take.
--   seat/registration roots (fn_ca_lock_tournament_seat_acquisition,
--     fn_ca_lock_tournament_registration_acquisition,
--     fn_ca_lock_tournament_rebuy_acquisition):
--       two-int table_cap, then fn_lock_daily_mission_user
--       ('daily-missions-user:' key, then profiles).
--   process_tournament_rebuy lines 405-413 (purchases not frozen):
--       try bigint table_cap, try 'daily-missions-user:'  <- held
--     then line 425 fn_ca_lock_tournament_rebuy_acquisition:
--       two-int table_cap (BLOCKING)                       <- waited
-- So the rebuy held daily-missions and waited for the two-int key while a
-- seat acquisition held the two-int key and waited for daily-missions. The
-- try-locks were added (20261119013430) to refuse a busy player fast, but they
-- skipped the two-int key and so inverted the roots' order.
--
-- THE FIX. Between the two existing try-locks, try the two-int key with the
-- same refusal (55P03 TOURNAMENT_PURCHASE_PLAYER_BUSY, which the engine
-- already resends in place). The rebuy now takes, in order: bigint table_cap,
-- two-int table_cap, daily-missions, profiles (NOWAIT), then the seat root,
-- which re-enters the keys it already holds. That is the roots' own order, so
-- no cycle remains; a player busy on the two-int key gets the designed fast
-- refusal instead of blocking while holding daily-missions.
--
-- WHY NO OUTCOME CHANGES. A refusal here is the same 55P03 refusal the two
-- neighbouring try-locks already give, before anything is written. No amount,
-- chip count, seat choice, receipt or finishing place changes; nothing reads
-- is_horse.
--
-- HOW. An anchored edit of the live definition: the needle must occur exactly
-- once or the whole file aborts and nothing changes. CREATE OR REPLACE keeps
-- the ACL; the edit block compares it with the one read before the edit
-- (live 2026-11-26: {postgres=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres}).
--
-- Law: tests/a-rebuy-takes-the-seat-table-cap-before-the-daily-missions-key.law.test.ts
-- Changelog: docs/changelog/2026-11-26-db-contention.md
-- @live-proof: (SELECT pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure) LIKE E'%hashtextextended(''table_cap:'' || p_user_id::text, 0))%THE SEAT ROOT''S TABLE CAP BEFORE DAILY MISSIONS (20261126233144)%pg_try_advisory_xact_lock(hashtext(''table_cap''), hashtext(p_user_id::text))%hashtextextended(''daily-missions-user:'' || p_user_id::text, 0))%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $rebuy_takes_the_two_int_cap_first$
DECLARE
  v_fn regprocedure := 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure;
  v_def text := pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure);
  v_acl text := (SELECT proacl::text FROM pg_proc WHERE oid = 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure);
  v_old text := E'        END IF;\n        IF NOT pg_try_advisory_xact_lock(hashtextextended(''daily-missions-user:'' || p_user_id::text, 0)) THEN\n';
  v_new text := E'        END IF;\n        -- THE SEAT ROOT''S TABLE CAP BEFORE DAILY MISSIONS (20261126233144).\n        -- Every seat root takes this two-int key, then daily-missions; the\n        -- rebuy''s root below takes it too. Tried here, in that order, the\n        -- rebuy never holds daily-missions while it waits for this key\n        -- (deadlock 2026-11-26 15:23:23 with a seat acquisition).\n        IF NOT pg_try_advisory_xact_lock(hashtext(''table_cap''), hashtext(p_user_id::text)) THEN\n          RAISE EXCEPTION ''TOURNAMENT_PURCHASE_PLAYER_BUSY: retry this same purchase request''\n            USING ERRCODE=''55P03'';\n        END IF;\n        IF NOT pg_try_advisory_xact_lock(hashtextextended(''daily-missions-user:'' || p_user_id::text, 0)) THEN\n';
BEGIN
  IF position('THE SEAT ROOT''S TABLE CAP BEFORE DAILY MISSIONS' IN v_def) > 0 THEN
    RAISE EXCEPTION 'process_tournament_rebuy already tries the two-int table cap first: re-read before editing';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'process_tournament_rebuy daily-missions try-lock anchor was expected exactly once';
  END IF;
  IF position('pg_advisory_xact_lock(hashtext(''table_cap''), hashtext(p_user_id::text))'
              IN pg_get_functiondef('public.fn_ca_lock_tournament_rebuy_acquisition(uuid,uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'fn_ca_lock_tournament_rebuy_acquisition no longer takes the two-int table cap: re-read before editing';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF (SELECT proacl::text FROM pg_proc WHERE oid = v_fn) IS DISTINCT FROM v_acl THEN
    RAISE EXCEPTION 'process_tournament_rebuy grants changed';
  END IF;
END
$rebuy_takes_the_two_int_cap_first$;

-- @probe-for: public.process_tournament_rebuy
DO $probe$
DECLARE v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_key text; v_r jsonb;
BEGIN
  v_key := 'tourney:'||v_t::text||':addon:'||v_u::text;
  INSERT INTO public.entry_purchase_idempotency_receipts(key_domain,idempotency_key,request,response,claimed_at,completed_at)
  VALUES('tournament_chip_purchase',v_key,
    jsonb_build_object('version','v1','tournament_id',v_t,'user_id',v_u,'rebuy_type','addon','idempotency_key',v_key),
    jsonb_build_object('success',true,'seated',true,'atomic_tournament_chip_purchase','v1','rebuy_type','addon',
      'table_id',gen_random_uuid(),'seat_id',gen_random_uuid(),'stack',1),
    clock_timestamp(),clock_timestamp());
  v_r := public.process_tournament_rebuy(v_t,v_u,'addon',NULL,NULL,NULL,NULL);
  IF v_r->>'atomic_tournament_chip_purchase' IS DISTINCT FROM 'v1' THEN
    RAISE EXCEPTION 'process_tournament_rebuy probe did not replay its receipt: %', v_r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

DO $verify_rebuy$
DECLARE
  v_bigint int := position('pg_try_advisory_xact_lock(hashtextextended(''table_cap:'' || p_user_id::text, 0))'
    IN pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure));
  v_two_int int := position('pg_try_advisory_xact_lock(hashtext(''table_cap''), hashtext(p_user_id::text))'
    IN pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure));
  v_daily int := position('pg_try_advisory_xact_lock(hashtextextended(''daily-missions-user:'' || p_user_id::text, 0))'
    IN pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure));
  v_root int := position('v_gate:=public.fn_ca_lock_tournament_rebuy_acquisition('
    IN pg_get_functiondef('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)'::regprocedure));
BEGIN
  IF v_bigint = 0 OR v_two_int = 0 OR v_daily = 0 OR v_root = 0
     OR NOT (v_bigint < v_two_int AND v_two_int < v_daily AND v_daily < v_root)
     OR has_function_privilege('anon', 'public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'process_tournament_rebuy does not try table cap, then the two-int cap, then daily-missions before its seat root, or anon can call it';
  END IF;
END
$verify_rebuy$;

COMMIT;
