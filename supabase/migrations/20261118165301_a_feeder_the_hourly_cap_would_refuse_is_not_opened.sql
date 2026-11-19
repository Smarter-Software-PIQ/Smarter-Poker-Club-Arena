-- 20261118165301_a_feeder_the_hourly_cap_would_refuse_is_not_opened.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A FEEDER THE HOURLY CAP WOULD REFUSE IS NOT OPENED (ClusterFeedersAbandoned,
-- 2026-11-18)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-18 ~16:40 UTC)
--
-- ClusterFeedersAbandoned fired 25 times since 2026-11-17. In the six hours to
-- 16:40 UTC the cluster ticks opened 152 feeders; 10 went live and 142 were
-- abandoned (PLO6 0.50/1 Classic 41/2/39, PLO4 0.50/1 Classic 35/2/33, FL Holdem
-- 0.25/0.50 Classic 32/3/28, NLH 0.50/1 Classic 25/3/23, PLO4 1/2 Lightning
-- 18/0/17). Every abandoned PLO6 feeder in the last three hours was held its
-- full 360 s and seated nobody.
--
-- Two authorities disagree. The hourly cash policy (#11118, 2026-11-16) admits
-- horse seating at a table with nobody on it yet - every new feeder - only while
-- the floor is under its table cap and no floor pacing hold is active
-- (fn_cash_hourly_table_admissions: f.table_id IS NULL -> occupied < cap AND no
-- 'floor' pacing row with next_open_at in the future). At 10:00 Chicago the cap
-- was 16 and the floor held 16: both opening Classic/Lightning feeders read
-- allowed=false. The engine's seeding loop and its seat-call answerer both skip
-- a table the policy does not admit, so the waiting horses' 60-second holds on
-- the feeder expired (PLO6: 117 expired, 15 seated in six hours) and the feeder
-- was abandoned at six minutes. fn_cash_cluster_tick and
-- fn_cash_cluster_tick_uncapped open a feeder on counted buyers with no
-- knowledge of that cap, so two minutes later they opened the next one.
--
-- THE FIX (the opener asks the same question the admission answers)
--
-- 1. public.fn_cash_hourly_feeder_admissible(game) answers exactly the hourly
--    admission's new-table branch: the policy is off, or the floor is under its
--    cap with no floor pacing hold. A person waiting on the game's line still
--    opens the feeder: the hourly policy gates horse seating only.
-- 2. Both cluster ticks open a buyer-driven feeder only when it is admissible.
--    The full-ring feeder start (which moves seated players, not new buyers) is
--    unchanged.
--
-- Rows written by this file: none. No money moves; no player is moved or
-- removed.
--
-- @live-proof: to_regprocedure('public.fn_cash_hourly_feeder_admissible(uuid)') IS NOT NULL AND position('fn_cash_hourly_feeder_admissible(g.id)' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('fn_cash_hourly_feeder_admissible(g.id)' in pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_feeder_admissible(p_game uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $f$
  -- THE SAME QUESTION AS THE ADMISSION (fn_cash_hourly_table_admissions, the
  -- f.table_id IS NULL branch): a new, empty table is admitted for horses only
  -- while the floor is under its hourly table cap and no floor pacing hold is
  -- active. A person on the line is never gated by the hourly policy.
  SELECT NOT public.fn_cash_hourly_table_enabled()
      OR ((SELECT count(*) FROM public.fn_cash_hourly_table_capacity_census())
            < (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)
          AND NOT EXISTS (SELECT 1 FROM public.cash_hourly_table_pacing p
                           WHERE p.scope = 'floor' AND p.next_open_at > clock_timestamp()))
      OR EXISTS (SELECT 1 FROM public.cash_game_waitlist w
                   JOIN public.profiles pr ON pr.id = w.user_id
                  WHERE w.game_id = p_game AND w.status IN ('waiting', 'notified')
                    AND NOT coalesce(pr.is_horse, false));
$f$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) TO service_role;

-- The pinned-text substitution (the form 20261118073646 uses). Already the
-- postimage (applied before merge, or a re-run): a no-op, never a refusal.
CREATE FUNCTION pg_temp.lane_a_subst(p_sig text, p_before text, p_after text,
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
  IF array_length(p_old, 1) IS DISTINCT FROM array_length(p_new, 1) THEN
    RAISE EXCEPTION '%: anchors and replacements do not pair', p_sig;
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

SELECT pg_temp.lane_a_subst(
  'public.fn_cash_cluster_tick(uuid,integer)',
  '3a88f6b1cbdcc425b5049b8f7800d00a', 'a1e1e261b69a11d52675c490b1c51c25',
  ARRAY[$o1$    ELSIF v_buyers >= 2 OR v_plo_startup THEN
$o1$], ARRAY[$n1$    ELSIF (v_buyers >= 2 OR v_plo_startup)
          -- A FEEDER THE HOURLY CAP WOULD REFUSE IS NOT OPENED (20261118165301): the
          -- hourly policy admits horses at a new, empty table only under its
          -- table cap; a feeder it refuses is never seeded, is abandoned at six
          -- minutes and was reopened two minutes later. A person waiting on the
          -- line still opens it.
          AND public.fn_cash_hourly_feeder_admissible(g.id) THEN
$n1$]);

SELECT pg_temp.lane_a_subst(
  'public.fn_cash_cluster_tick_uncapped(uuid,integer)',
  '6058aeeb6b9f78f286e8ad35c5356218', 'edbd9c20231d5056dfe71f4a9ac19e28',
  ARRAY[$o1$    ELSIF v_buyers >= 2 OR v_plo_startup THEN
$o1$], ARRAY[$n1$    ELSIF (v_buyers >= 2 OR v_plo_startup)
          -- A FEEDER THE HOURLY CAP WOULD REFUSE IS NOT OPENED (20261118165301): the
          -- hourly policy admits horses at a new, empty table only under its
          -- table cap; a feeder it refuses is never seeded, is abandoned at six
          -- minutes and was reopened two minutes later. A person waiting on the
          -- line still opens it.
          AND public.fn_cash_hourly_feeder_admissible(g.id) THEN
$n1$]);

COMMIT;
