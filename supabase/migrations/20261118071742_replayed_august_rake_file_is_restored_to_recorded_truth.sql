-- TIER: 1. Incident 758cd269 TournamentFinishRefusalsPersisting (reason=rake_attribution). AUTHOR: Claude.
-- APPLIED: production 2026-11-18 07:17:42 UTC (recorded version 20261118071742).
-- ROOT CAUSE: ~2026-11-18 06:16 UTC the file 20260826_tournament_rake_settlement_integrity.sql
-- (applied 2026-08-27, RECORDED as 20260827011455) was replayed because its filename version
-- 20260826 is not a recorded version. It rolled five tournament money functions back to their
-- August bodies (fn_settle_tournament_rake lost attribution, so every terminal finish was
-- refused: 'rake attribution did not complete'), resurrected the 6-arg process_tournament_rebuy
-- dropped by 20260828021009 (EXECUTE to PUBLIC/anon), and re-granted atomic_cancel_tournament
-- to authenticated.
-- FIX: each body is restored from the exact statement the latest recorded migration that
-- defines it applied (supabase_migrations.schema_migrations is the record of what ran), and
-- each restored body is asserted by md5. ACLs are restored to those migrations' grants.
-- Source files in this repo: 20261102180105 (settle), 20260909014534 (sweep; recorded as
-- 20260909215641), 20260909165629 (unregister wrapper), 20261103064259 (cancel).
-- REPLAY-SAFE: refuses unless every target is in the stale (replayed) or restored state.
SET LOCAL lock_timeout='5s';

DO $restore$
DECLARE
  r record; v_live text; v_stmt text; v_frag text; v_tag text; v_create text; v_body text; v_pos int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('fn_settle_tournament_rake','uuid,text','20261102180105','af89499b16d4011ea9e64f366b59c1eb','30dc972220452d046ac4847dc8f34edc'),
    ('fn_sweep_unsettled_tournament_rake','integer,integer','20260909215641','2ba3632f4a457df44a026e2498d7f9a5','0b099303c20d0fdeb9e26821f12aa763'),
    ('fn_unregister_from_tournament','uuid','20260909165629','3f715e92e9e7e494942ce8e7c0b864ab','cc93302253f3cc5b23265665f8cf86e3'),
    ('atomic_cancel_tournament','uuid,uuid','20261103064259','2dec9d322115de68f8400175622a2032','c7172f9d760fc00219cb2186f19f93ed')
  ) x(fname,args,src_version,stale_md5,good_md5) LOOP
    SELECT md5(p.prosrc) INTO v_live FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.'||r.fname||'('||r.args||')');
    IF v_live IS NULL OR v_live NOT IN (r.stale_md5, r.good_md5) THEN
      RAISE EXCEPTION 'restore refused: public.%(%) is in an unknown state (md5 %); a newer definition exists, never replay this file',
        r.fname, r.args, v_live;
    END IF;
    CONTINUE WHEN v_live = r.good_md5;

    SELECT st.stmt INTO v_stmt
      FROM supabase_migrations.schema_migrations m, unnest(m.statements) st(stmt)
     WHERE m.version = r.src_version
       AND st.stmt ~* ('CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.'||r.fname||'\s*\(')
     LIMIT 1;
    IF v_stmt IS NULL THEN
      RAISE EXCEPTION 'restore refused: recorded migration % has no definition of %', r.src_version, r.fname;
    END IF;
    v_pos  := strpos(lower(v_stmt), lower('CREATE OR REPLACE FUNCTION public.'||r.fname||'('));
    IF v_pos = 0 THEN
      v_pos := strpos(lower(v_stmt), lower('FUNCTION public.'||r.fname||'('));
      v_frag := 'CREATE OR REPLACE ' || substr(v_stmt, v_pos);
    ELSE
      v_frag := substr(v_stmt, v_pos);
    END IF;
    v_tag  := substring(v_frag from '\mAS\s+(\$[A-Za-z_]*\$)');
    v_body := split_part(substr(v_frag, strpos(v_frag, v_tag) + length(v_tag)), v_tag, 1);
    IF md5(v_body) IS DISTINCT FROM r.good_md5 THEN
      RAISE EXCEPTION 'restore refused: recorded body of % in % hashes % not %', r.fname, r.src_version, md5(v_body), r.good_md5;
    END IF;
    v_create := substr(v_frag, 1, strpos(v_frag, v_tag) + length(v_tag) - 1) || v_body || v_tag;
    EXECUTE v_create;
  END LOOP;
END $restore$;

REVOKE ALL ON FUNCTION public.fn_settle_tournament_rake(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_settle_tournament_rake(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_unregister_from_tournament(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_unregister_from_tournament(uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.atomic_cancel_tournament(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.atomic_cancel_tournament(uuid,uuid) TO service_role;

-- Dropped by 20260828021009; the replay resurrected it with EXECUTE to PUBLIC/anon.
DROP FUNCTION IF EXISTS public.process_tournament_rebuy(uuid, uuid, text, numeric, numeric, integer);

DO $assert$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_settle_tournament_rake(uuid,text)','30dc972220452d046ac4847dc8f34edc'),
    ('public.fn_sweep_unsettled_tournament_rake(integer,integer)','0b099303c20d0fdeb9e26821f12aa763'),
    ('public.fn_unregister_from_tournament(uuid)','cc93302253f3cc5b23265665f8cf86e3'),
    ('public.atomic_cancel_tournament(uuid,uuid)','c7172f9d760fc00219cb2186f19f93ed')
  ) x(sig,good) LOOP
    SELECT md5(p.prosrc) INTO v FROM pg_proc p WHERE p.oid = to_regprocedure(r.sig);
    IF v IS DISTINCT FROM r.good THEN RAISE EXCEPTION 'ASSERT FAILED: % body % <> %', r.sig, v, r.good; END IF;
  END LOOP;
  IF to_regprocedure('public.process_tournament_rebuy(uuid,uuid,text,numeric,numeric,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'ASSERT FAILED: legacy 6-arg process_tournament_rebuy still exists'; END IF;
  IF has_function_privilege('authenticated','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE')
   OR has_function_privilege('authenticated','public.fn_settle_tournament_rake(uuid,text)','EXECUTE')
   OR has_function_privilege('anon','public.fn_unregister_from_tournament(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ASSERT FAILED: restored ACLs are wider than the recorded grants'; END IF;
END $assert$;
