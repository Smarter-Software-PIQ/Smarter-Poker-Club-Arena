-- 20261121174545_full_ring_feeder_and_opening_count_honour_hourly_cap.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- FULL-RING FEEDER STARTS AND CONCURRENT OPENING FEEDERS HONOUR THE HOURLY CAP
-- (ClusterFeedersAbandoned, 2026-11-21)
--
-- WHAT WAS WRONG (live production evidence, 2026-11-21 17:23 UTC)
--
-- ClusterFeedersAbandoned fired continuously with 20.17 feeders abandoned in
-- 30 minutes and 195 abandoned vs 191 opened vs 0 feeder_live in 6 hours,
-- despite 20261118165301_a_feeder_the_hourly_cap_would_refuse_is_not_opened.sql.
-- Two remaining gaps produced every abandonment:
--
-- 1. Full-ring feeder starts bypassed the hourly cap:
--    20261118165301 guarded only the buyer-driven ELSIF branch and left the
--    full-ring feeder start branch unguarded on the assumption that moving
--    two seated players off Main 1 bypasses the hourly cap. In
--    fn_cash_hourly_table_admit (20261116194028), funded_move only bypasses
--    the cap when NOT empty; moving a horse off a 9-handed Main 1 into a newly
--    opened empty feeder has empty = true and releases_source = false, so at
--    table_cap it raises cash_hourly_table_cap_reached. Both bump moves cancel
--    immediately as destination_refused, the next wake drops held 2 -> 0 and
--    emits feeder_start_ended = complete, the empty feeder expires at 6 min as
--    feeder_abandoned, and 2 min later the same 4 waitlisted horses trigger
--    another feeder in an infinite 8-minute loop (4 games: 37ac7634, 042cfa8e,
--    bc1a347f, 830603f7).
--
-- 2. Thundering herd when one slot opens below table_cap:
--    fn_cash_hourly_table_capacity_census() counts only tables that already
--    hold live seats (occupied > 0), ignoring empty 'opening' feeders. When
--    occupied = table_cap - 1, every waiting cluster game in the same pass
--    reads occupied < cap and opens an empty feeder simultaneously (6 games in
--    one pass: c79d8ec2, 67e5ad65, c1094914, 2c67b57b, 2ba1c0a6, 7b9fb0be);
--    cash_hourly_table_start_paced / cap_reached blocks seating on the extras
--    and all abandon 6 min later.
--
-- THE FIX
--
-- 1. fn_cash_hourly_feeder_admissible(p_game) adds the count of empty active
--    'opening' cash feeders to fn_cash_hourly_table_capacity_census() before
--    comparing against table_cap, so at most (table_cap - occupied) feeders
--    can be opening at once. A human waiting on the game's waitlist still
--    opens a feeder unconditionally.
-- 2. Both fn_cash_cluster_tick(uuid,integer) and
--    fn_cash_cluster_tick_uncapped(uuid,integer) guard the full-ring feeder
--    start branch with fn_cash_hourly_feeder_admissible(g.id), matching the
--    buyer-driven branch.
--
-- Rows written by this file: none. No money moves; no player is moved or
-- removed. Functions only (no hot-table DDL).
--
-- @live-proof: (position('lifecycle = ''opening''' in pg_get_functiondef('public.fn_cash_hourly_feeder_admissible(uuid)'::regprocedure)) > 0 AND position('FULL-RING FEEDER HONOURS HOURLY CAP' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('FULL-RING FEEDER HONOURS HOURLY CAP' in pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure)) > 0)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.fn_cash_hourly_feeder_admissible(p_game uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $f$
  -- THE SAME QUESTION AS THE ADMISSION (fn_cash_hourly_table_admissions, the
  -- f.table_id IS NULL branch), plus empty active 'opening' cash feeders so
  -- concurrent cluster ticks cannot open more feeders than remaining hourly
  -- cap slots. A person on the line is never gated by the hourly policy.
  SELECT NOT public.fn_cash_hourly_table_enabled()
      OR (
        (
          (SELECT count(*) FROM public.fn_cash_hourly_table_capacity_census())
          + (SELECT count(*) FROM public.tables tb
              WHERE tb.cluster_id IS NOT NULL
                AND tb.role = 'feeder'
                AND tb.lifecycle = 'opening'
                AND tb.status IN ('waiting', 'running', 'active')
                AND coalesce(tb.is_deleted, false) = false
                AND tb.tournament_id IS NULL
                AND NOT coalesce(tb.is_spins, false)
                AND NOT EXISTS (
                  SELECT 1 FROM public.table_seats ts
                   WHERE ts.table_id = tb.id AND ts.left_at IS NULL
                ))
        ) < (SELECT r.table_cap FROM public.fn_cash_hourly_table_range() r)
        AND NOT EXISTS (SELECT 1 FROM public.cash_hourly_table_pacing p
                         WHERE p.scope = 'floor' AND p.next_open_at > clock_timestamp())
      )
      OR EXISTS (SELECT 1 FROM public.cash_game_waitlist w
                   JOIN public.profiles pr ON pr.id = w.user_id
                  WHERE w.game_id = p_game AND w.status IN ('waiting', 'notified')
                    AND NOT coalesce(pr.is_horse, false));
$f$;

REVOKE ALL ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hourly_feeder_admissible(uuid) TO service_role;

CREATE FUNCTION pg_temp.ca_patch_full_ring_feeder_admissible(
  p_sig text,
  p_before text,
  p_old text,
  p_new text
)
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF position('FULL-RING FEEDER HONOURS HOURLY CAP' IN v_def) > 0 THEN
    RAISE NOTICE '%: already carries full-ring feeder hourly cap gate, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned preimage (md5 %)', p_sig, md5(v_def);
  END IF;
  v_n := (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%: full-ring feeder anchor occurs % times, expected exactly 1', p_sig, v_n;
  END IF;
  v_new := replace(v_def, p_old, p_new);
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF position('FULL-RING FEEDER HONOURS HOURLY CAP' IN pg_get_functiondef(p_sig::regprocedure)) = 0 THEN
    RAISE EXCEPTION '%: replaced function does not read back with full-ring hourly cap gate', p_sig;
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

SELECT pg_temp.ca_patch_full_ring_feeder_admissible(
  'public.fn_cash_cluster_tick(uuid,integer)',
  'a1e1e261b69a11d52675c490b1c51c25',
  $o1$    ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1
          AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id)
          AND EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.role = 'main' AND c.lifecycle = 'live') THEN$o1$,
  $n1$    ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1
          AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id)
          AND EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.role = 'main' AND c.lifecycle = 'live')
          -- FULL-RING FEEDER HONOURS HOURLY CAP (20261121174545): fn_cash_hourly_table_admit
          -- refuses horse moves onto a newly opened empty feeder at table_cap, cancelling
          -- both bump moves as destination_refused and abandoning the feeder 6m later.
          AND public.fn_cash_hourly_feeder_admissible(g.id) THEN$n1$
);

SELECT pg_temp.ca_patch_full_ring_feeder_admissible(
  'public.fn_cash_cluster_tick_uncapped(uuid,integer)',
  'edbd9c20231d5056dfe71f4a9ac19e28',
  $o1$    ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1
          AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id)
          AND EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.role = 'main' AND c.lifecycle = 'live') THEN$o1$,
  $n1$    ELSIF v_full_ring AND NOT v_classic AND v_live_tables = 1
          AND NOT EXISTS (SELECT 1 FROM public.cash_cluster_feeder_starts fs WHERE fs.game_id = g.id)
          AND EXISTS (SELECT 1 FROM unnest(v_census) c WHERE c.role = 'main' AND c.lifecycle = 'live')
          -- FULL-RING FEEDER HONOURS HOURLY CAP (20261121174545): fn_cash_hourly_table_admit
          -- refuses horse moves onto a newly opened empty feeder at table_cap, cancelling
          -- both bump moves as destination_refused and abandoning the feeder 6m later.
          AND public.fn_cash_hourly_feeder_admissible(g.id) THEN$n1$
);

COMMIT;
