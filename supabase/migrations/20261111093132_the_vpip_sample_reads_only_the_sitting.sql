-- 20261111093132_the_vpip_sample_reads_only_the_sitting
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-11.
--
-- THE VPIP SAMPLE READS ONLY THE SITTING (2026-11-11).
--
-- WHAT WAS WRONG (proven live). fn_nit_sample and fn_nit_hands_since are SQL
-- functions with SET search_path, so they are never inlined and run on a
-- generic plan. Their predicate (p_since IS NULL OR f.played_at >= p_since)
-- cannot become an index condition in a generic plan, so the planner walked a
-- player's ENTIRE idx_ca_hand_facts_user_time history (horses: 78k-178k rows)
-- whenever the sitting held fewer than the window's hands, filtering table_id
-- row by row. fn_nit_sample for one horse (99079d3e, sitting since 09:00:44Z)
-- exceeded 25 s. The engine calls fn_nit_status and then fn_nit_enforce at
-- every hand boundary on a nit_game table; each hit the 8 s statement timeout
-- (57014, engine log 09:23:55 and 09:24:03Z on 8fee68cc), so every hand on those
-- tables started about 16.9 s late (#10435: 438 of 454 breaches 05:34-09:24Z,
-- dominated by load_next_hand_inputs, all nit_game tables) and the VPIP floor
-- was neither read nor enforced there.
--
-- WHAT THIS CHANGES. Two predicates, one per function:
--   (p_since IS NULL OR f.played_at >= p_since)
--     -> f.played_at >= COALESCE(p_since, '-infinity'::timestamptz)
--   (p_since IS NULL OR f.played_at > p_since)
--     -> f.played_at > COALESCE(p_since, '-infinity'::timestamptz)
-- ca_hand_facts.played_at is NOT NULL, so each rewrite selects exactly the same
-- rows for every argument, NULL included. Under force_generic_plan the sample
-- becomes Index Cond (user_id = $3 AND played_at >= COALESCE($4, ...)):
-- 3.5 ms, 315 buffers, for the same call that exceeded 25 s. Every other byte
-- of both bodies is the live text (md5-pinned below); owner, ACL, proconfig,
-- volatility and SECURITY are unchanged and re-proved in the postflight.
-- No table is touched and no hot relation is locked: an ordinary install.
-- The career branch of fn_nit_check (all facts, no since) is unchanged; no live
-- table has career_percent_min > 0.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_nit_sample(uuid,uuid,uuid,timestamptz,boolean,integer)');
  v_def text;
  v_old text := $f$       AND (p_since IS NULL OR f.played_at >= p_since)
$f$;
  v_new text := $f$       AND f.played_at >= COALESCE(p_since, '-infinity'::timestamptz)
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'fn_nit_sample is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> 'aa2d137ebcf2cad719cb5a40913a142f'
     AND md5(replace(v_def, v_new, v_old)) <> 'aa2d137ebcf2cad719cb5a40913a142f' THEN
    RAISE EXCEPTION 'fn_nit_sample is not the pinned text (md5 %)', md5(v_def);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND NOT p.prosecdef
                   AND p.provolatile = 's'
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_nit_sample authority changed';
  END IF;
END $m$;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_nit_hands_since(uuid,uuid,uuid,timestamptz)');
  v_def text;
  v_old text := $f$     AND (p_since IS NULL OR f.played_at > p_since)
$f$;
  v_new text := $f$     AND f.played_at > COALESCE(p_since, '-infinity'::timestamptz)
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'fn_nit_hands_since is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF md5(v_def) <> '6bc3fb588d3c28aef69dc112c8c6dcc9'
     AND md5(replace(v_def, v_new, v_old)) <> '6bc3fb588d3c28aef69dc112c8c6dcc9' THEN
    RAISE EXCEPTION 'fn_nit_hands_since is not the pinned text (md5 %)', md5(v_def);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND NOT p.prosecdef
                   AND p.provolatile = 's'
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_nit_hands_since authority changed';
  END IF;
END $m$;

CREATE OR REPLACE FUNCTION public.fn_nit_sample(
  p_table_id uuid, p_game_id uuid, p_user_id uuid, p_since timestamptz,
  p_rolling boolean, p_window integer)
 RETURNS TABLE(hands integer, vpip numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT f.vpip AS v
      FROM public.ca_hand_facts f
     WHERE f.user_id = p_user_id
       AND f.played_at >= COALESCE(p_since, '-infinity'::timestamptz)
       AND (CASE WHEN p_game_id IS NOT NULL
                 THEN f.table_id IN (SELECT t2.id FROM public.tables t2
                                      WHERE t2.cluster_id = p_game_id)
                 ELSE f.table_id = p_table_id END)
     ORDER BY f.played_at DESC
     LIMIT CASE WHEN COALESCE(p_rolling, false) THEN GREATEST(p_window, 1) ELSE NULL END
  )
  SELECT count(*)::int,
         CASE WHEN count(*) = 0 THEN NULL
              ELSE round(100.0 * avg(CASE WHEN v THEN 1 ELSE 0 END), 1) END
    FROM eligible;
$function$;

CREATE OR REPLACE FUNCTION public.fn_nit_hands_since(
  p_table_id uuid, p_game_id uuid, p_user_id uuid, p_since timestamptz)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT count(*)::int
    FROM public.ca_hand_facts f
   WHERE f.user_id = p_user_id
     AND f.played_at > COALESCE(p_since, '-infinity'::timestamptz)
     AND (CASE WHEN p_game_id IS NOT NULL
               THEN f.table_id IN (SELECT t2.id FROM public.tables t2
                                    WHERE t2.cluster_id = p_game_id)
               ELSE f.table_id = p_table_id END);
$function$;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_nit_sample(uuid,uuid,uuid,timestamptz,boolean,integer)');
  v_def text;
  v_old text := $f$       AND (p_since IS NULL OR f.played_at >= p_since)
$f$;
  v_new text := $f$       AND f.played_at >= COALESCE(p_since, '-infinity'::timestamptz)
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'fn_nit_sample is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1
     OR position(v_old IN v_def) <> 0
     OR md5(replace(v_def, v_new, v_old)) <> 'aa2d137ebcf2cad719cb5a40913a142f' THEN
    RAISE EXCEPTION 'fn_nit_sample: the change is not exactly the one predicate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND NOT p.prosecdef
                   AND p.provolatile = 's'
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_nit_sample authority changed';
  END IF;
END $m$;

DO $m$
DECLARE
  v_oid oid := to_regprocedure('public.fn_nit_hands_since(uuid,uuid,uuid,timestamptz)');
  v_def text;
  v_old text := $f$     AND (p_since IS NULL OR f.played_at > p_since)
$f$;
  v_new text := $f$     AND f.played_at > COALESCE(p_since, '-infinity'::timestamptz)
$f$;
BEGIN
  IF v_oid IS NULL THEN RAISE EXCEPTION 'fn_nit_hands_since is missing'; END IF;
  v_def := pg_get_functiondef(v_oid);
  IF (length(v_def) - length(replace(v_def, v_new, ''))) / length(v_new) <> 1
     OR position(v_old IN v_def) <> 0
     OR md5(replace(v_def, v_new, v_old)) <> '6bc3fb588d3c28aef69dc112c8c6dcc9' THEN
    RAISE EXCEPTION 'fn_nit_hands_since: the change is not exactly the one predicate';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_oid
                   AND pg_get_userbyid(p.proowner) = 'postgres' AND NOT p.prosecdef
                   AND p.provolatile = 's'
                   AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                   AND p.proconfig::text = '{"search_path=public, pg_temp"}') THEN
    RAISE EXCEPTION 'fn_nit_hands_since authority changed';
  END IF;
END $m$;

COMMIT;
