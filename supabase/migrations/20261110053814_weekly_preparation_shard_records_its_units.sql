-- @live-proof: md5(pg_get_functiondef('smarter_private.weekly_prep_shard(integer,integer)'::regprocedure))='bb29caec19261452661e3c6c4ec3bbba'
-- 20261110053814_weekly_preparation_shard_records_its_units.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE WEEKLY PREPARATION SHARD RECORDS ITS UNITS
--
-- CAUSE. smarter_private.weekly_prep_shard(integer,integer) declares a PL/pgSQL
-- variable named units and, after each prepared unit, runs
--     UPDATE smarter_private.weekly_prep_shard_runs SET units=units+1,last_unit=lbl ...
-- The right-hand units names both the variable and the column, so PL/pgSQL
-- raises: column reference "units" is ambiguous. The statement sits outside
-- the unit's own exception block, so the procedure aborts and the unit's work
-- since the last COMMIT rolls back. Every call that prepares a unit fails.
--
-- EVIDENCE (production, read only, 2026-11-09).
--   * cron.job_run_details: each of the four jobs weekly-prep-shard-0..3 failed
--     166 or 167 times with exactly that message, every minute from 08:00Z to
--     10:47Z. smarter_private.weekly_prep_shard_runs for that week: 678 rows,
--     sum(units) = 0.
--   * The weekly payout due at 10:00Z was booked at about 10:47Z, prepared by
--     a slower path instead of the shards.
--   * scripts/ci/test-rakeback-cascade-real-runner-postgres.py loads the
--     production definition byte-exact, shows the same failure on all four
--     shards, installs this file whole and then prepares and pays the week on
--     the first eligible ticks.
--   * No other routine in smarter_private has this shape (one pg_proc read of
--     every SET x=x+/- whose x is also a declared variable or an argument:
--     this procedure only).
--
-- THE FIX. The line that produced the failure is changed, in both loops (the
-- window loop and the club loop), and nothing else:
--     SET units=units+1                          (before)
--     SET units=weekly_prep_shard_runs.units+1   (after)
-- The local counter units:=units+1 is untouched. The body below is the
-- production text (md5 c2188f253dab440846951fe852f44584) with exactly those two
-- references qualified. The file refuses to install on any other preimage and
-- refuses to commit unless the installed result is md5
-- bb29caec19261452661e3c6c4ec3bbba.
--
-- INSTALL. One CREATE OR REPLACE PROCEDURE of a routine that is not SECURITY
-- DEFINER and has no SET clause. It takes no table lock, so it is not a
-- maintenance-window file: it installs at merge through Apply Merged
-- Migration. CREATE OR REPLACE keeps the owner (postgres) and the ACL
-- (production: postgres=X/postgres only); the closing check refuses if either
-- moved. A shard call that is running keeps its old body until it returns.
--
-- This file writes no data, adds no schedule and no repair path, and replays
-- nothing: the week of 2026-11-02 is settled and is not touched. Horses are
-- players: nothing here reads is_horse.

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$DECLARE p pg_proc%ROWTYPE; d text;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='smarter_private.weekly_prep_shard(integer,integer)'::regprocedure;
 d:=pg_get_functiondef(p.oid);
 IF md5(d) IS DISTINCT FROM 'c2188f253dab440846951fe852f44584' THEN RAISE EXCEPTION 'weekly_prep_shard_units_preimage_changed: %',md5(d);END IF;
 IF p.prokind<>'p' OR p.prosecdef OR p.proconfig IS NOT NULL THEN RAISE EXCEPTION 'weekly_prep_shard_units_preimage_shape_changed';END IF;
 IF cardinality(string_to_array(d,'SET units=units+1,last_unit=lbl WHERE')) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'weekly_prep_shard_units_anchor_changed';END IF;
 PERFORM set_config('weekly_prep_shard_units.owner_acl',p.proowner::text||' '||COALESCE(p.proacl::text,'default'),true);
END $pre$;
CREATE OR REPLACE PROCEDURE smarter_private.weekly_prep_shard(IN p_shard integer, IN p_shards integer)
 LANGUAGE plpgsql
AS $procedure$
DECLARE n timestamptz:=clock_timestamp(); e timestamptz; due timestamptz; plan jsonb; item jsonb; k text; id uuid; ps timestamptz; pe timestamptz;
 began timestamptz:=clock_timestamp(); run_id bigint; units int:=0; lbl text; c uuid; i int; nw int; step text; did boolean; d_from date; npages int;
BEGIN
 IF p_shards<1 OR p_shard<0 OR p_shard>=p_shards THEN RAISE EXCEPTION 'weekly_prep_shard_invalid'; END IF;
 e:=public.fn_union_week_start(n); due:=public.fn_union_accounting_run_at(e);
 -- Only between the week's close and twelve hours after its payout time.
 IF n<e OR n>=due+interval '12 hours' THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses p WHERE p.period_end=e AND p.phase IN('draining','ready','paying')) THEN RETURN; END IF;
 plan:=smarter_private.weekly_payout_scope_plan(e,n);
 IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN; END IF;
 INSERT INTO smarter_private.weekly_prep_shard_runs(shard,period_end) VALUES(p_shard,e) RETURNING smarter_private.weekly_prep_shard_runs.id INTO run_id;
 COMMIT;
 -- Scope club lists, resolved once under the coordinator's own key (shard 0).
 IF p_shard=0 THEN
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   k:=item->>'kind'; id:=(item->>'id')::uuid; ps:=(item->>'period_start')::timestamptz; pe:=(item->>'period_end')::timestamptz;
   IF NOT EXISTS(SELECT 1 FROM smarter_private.weekly_prep_scope_clubs q WHERE q.scope_kind=k AND q.scope_id=id AND q.period_start=ps AND q.period_end=pe) THEN
    BEGIN
     SET LOCAL lock_timeout='3s';
     INSERT INTO smarter_private.weekly_prep_scope_clubs(scope_kind,scope_id,period_start,period_end,club_ids)
     SELECT k,id,ps,pe,r.club_ids FROM public.fn_resolve_accounting_routing_scope(k,id,ps,pe) r ON CONFLICT DO NOTHING;
    EXCEPTION WHEN lock_not_available THEN NULL;
    END;
    COMMIT;
   END IF;
  END LOOP;
 END IF;
 -- Stage order: own-agent markers, earned plan, calculator parts, round windows.
 FOREACH step IN ARRAY ARRAY['clean','earned','players','tq','counts','check','write','r2','r3'] LOOP
  FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
   k:=item->>'kind'; id:=(item->>'id')::uuid; ps:=(item->>'period_start')::timestamptz; pe:=(item->>'period_end')::timestamptz;
   IF step='earned' AND k<>'union' THEN CONTINUE; END IF;
   IF step IN('clean','earned','r2','r3') THEN
    SELECT count(*) INTO nw FROM public.fn_accounting_close_windows(ps,pe);
    FOR i IN 0..nw-1 LOOP
     CONTINUE WHEN i%p_shards<>p_shard;
     IF clock_timestamp()>began+interval '45 seconds' THEN EXIT; END IF;
     BEGIN
      lbl:=smarter_private.weekly_prep_unit(k,id,ps,pe,step,NULL,i);
     EXCEPTION WHEN OTHERS THEN
      UPDATE smarter_private.weekly_prep_shard_runs SET last_error=left(step||' '||i||': '||SQLERRM,500) WHERE smarter_private.weekly_prep_shard_runs.id=run_id; lbl:=NULL;
     END;
     IF lbl IS NOT NULL THEN units:=units+1; UPDATE smarter_private.weekly_prep_shard_runs SET units=weekly_prep_shard_runs.units+1,last_unit=lbl WHERE smarter_private.weekly_prep_shard_runs.id=run_id; END IF;
     COMMIT;
    END LOOP;
   ELSE
    FOR c IN SELECT w.club_id FROM public.fn_accounting_week_clubs(CASE WHEN k='union' THEN id END,CASE WHEN k='club' THEN id END,ps,pe) w ORDER BY w.club_id LOOP
     d_from:=(ps AT TIME ZONE 'America/Los_Angeles')::date;
     nw:=CASE step WHEN 'players' THEN 1 WHEN 'tq' THEN 29 WHEN 'counts' THEN 86 ELSE
       COALESCE((SELECT jsonb_array_length(value->'pages') FROM public.accounting_recompute_split_parts WHERE club_id=c AND period_start=d_from AND kind='players' AND part=0),0) END;
     FOR i IN 0..nw-1 LOOP
      CONTINUE WHEN (i+abs(hashtext(c::text)))%p_shards<>p_shard;
      IF clock_timestamp()>began+interval '45 seconds' THEN EXIT; END IF;
      BEGIN
       lbl:=smarter_private.weekly_prep_unit(k,id,ps,pe,step,c,i);
      EXCEPTION WHEN OTHERS THEN
       UPDATE smarter_private.weekly_prep_shard_runs SET last_error=left(step||' '||c||' '||i||': '||SQLERRM,500) WHERE smarter_private.weekly_prep_shard_runs.id=run_id; lbl:=NULL;
      END;
      IF lbl IS NOT NULL THEN units:=units+1; UPDATE smarter_private.weekly_prep_shard_runs SET units=weekly_prep_shard_runs.units+1,last_unit=lbl WHERE smarter_private.weekly_prep_shard_runs.id=run_id; END IF;
      COMMIT;
     END LOOP;
    END LOOP;
   END IF;
  END LOOP;
  EXIT WHEN clock_timestamp()>began+interval '45 seconds';
 END LOOP;
 UPDATE smarter_private.weekly_prep_shard_runs SET finished_at=clock_timestamp() WHERE smarter_private.weekly_prep_shard_runs.id=run_id;
 COMMIT;
END $procedure$;
DO $post$DECLARE p pg_proc%ROWTYPE; d text;
BEGIN
 SELECT * INTO p FROM pg_proc WHERE oid='smarter_private.weekly_prep_shard(integer,integer)'::regprocedure;
 d:=pg_get_functiondef(p.oid);
 IF md5(d) IS DISTINCT FROM 'bb29caec19261452661e3c6c4ec3bbba' THEN RAISE EXCEPTION 'weekly_prep_shard_units_postimage_changed: %',md5(d);END IF;
 IF position('SET units=units+1' IN d)>0 OR cardinality(string_to_array(d,'SET units=weekly_prep_shard_runs.units+1,last_unit=lbl WHERE')) IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'weekly_prep_shard_units_not_qualified';END IF;
 IF p.prokind<>'p' OR p.prosecdef OR p.proconfig IS NOT NULL THEN RAISE EXCEPTION 'weekly_prep_shard_units_postimage_shape_changed';END IF;
 IF p.proowner::text||' '||COALESCE(p.proacl::text,'default') IS DISTINCT FROM current_setting('weekly_prep_shard_units.owner_acl',true) THEN RAISE EXCEPTION 'weekly_prep_shard_units_owner_or_acl_changed';END IF;
END $post$;
COMMIT;
