-- 20261119121500_the_sweep_measures_a_week_only_for_a_winning_day.sql
--
-- THE SWEEP MEASURES A WEEK ONLY FOR A WINNING DAY (fn_union_integrity_sweep, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, 2026-11-19 ~12:10 UTC)
--
-- After 20261119063000 the union-integrity-sweep cron failed at 10:33 and
-- 11:33 UTC (300 s), where it had finished in 47-52 s all day. The 7-day
-- measure (fn_union_agent_roster_sustained_edge) sat in the same WHERE as
-- `n.player_net > 0`, a condition on `net` alone, so the planner pushed both
-- down onto the scan of `net`: the 7-day measure ran for EVERY agent with a
-- positive day, before the rake join could rule almost all of them out.
-- 20261119120000 made one measure cheap; this makes the sweep ask it only for
-- an agent whose 24 h edge already holds.
--
-- THE FIX
--
-- The 24 h test runs inside a fenced subquery (OFFSET 0) and the 7-day measure
-- filters its output. Same flags, same columns. Pinned pre/postimage; re-apply
-- is a no-op. The probe runs the whole sweep for every union before COMMIT and
-- refuses the migration unless it finishes inside 90 s (the cron allows 120 s).
--
-- @live-proof: position('OFFSET 0) f' in pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '240s';

CREATE FUNCTION pg_temp.uis_subst(p_sig text, p_before text, p_after text,
                                  p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

SELECT pg_temp.uis_subst(
  'public.fn_union_integrity_sweep(uuid,integer)',
  '307c48cc499243732b05193ec2af9611', 'f764df872c6812b8186bf2329e670f76',
  ARRAY[
$o1$  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_user_id', n.agent_id, 'players', n.players,
           'player_net', round(n.player_net,2), 'rake_generated', round(COALESCE(k.rake,0),2),
           'win_to_rake_ratio', round(n.player_net / NULLIF(COALESCE(k.rake,0),0), 2))), '[]'::jsonb)
    INTO v_agent_flags
    FROM net n LEFT JOIN rake k ON k.agent_id = n.agent_id
   WHERE n.player_net > 0
     AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)
     -- A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000): one winning
     -- day of a player who loses over the week is variance, not an edge.
     AND public.fn_union_agent_roster_sustained_edge(p_union_id, n.agent_id, 7);$o1$],
  ARRAY[
$n1$  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'agent_user_id', f.agent_id, 'players', f.players,
           'player_net', round(f.player_net,2), 'rake_generated', round(COALESCE(f.rake,0),2),
           'win_to_rake_ratio', round(f.player_net / NULLIF(COALESCE(f.rake,0),0), 2))), '[]'::jsonb)
    INTO v_agent_flags
    FROM (SELECT n.agent_id, n.players, n.player_net, k.rake
            FROM net n LEFT JOIN rake k ON k.agent_id = n.agent_id
           WHERE n.player_net > 0
             AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)
          OFFSET 0) f
   -- A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000), measured only
   -- for an agent whose 24 h edge already holds (20261119121500): the fence
   -- keeps the planner from pushing the 7-day measure down onto every agent
   -- with a positive net before the rake join.
   WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, f.agent_id, 7);$n1$]);

-- @probe-for: public.fn_union_integrity_sweep
DO $probe$
DECLARE t0 timestamptz := clock_timestamp(); u record;
BEGIN
  FOR u IN SELECT id FROM public.unions LOOP
    PERFORM public.fn_union_integrity_sweep(u.id, 24);
  END LOOP;
  IF clock_timestamp() - t0 > interval '90 seconds' THEN
    RAISE EXCEPTION 'the union sweep still does not fit its cron budget: %', clock_timestamp() - t0;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
