-- 20261119120000_a_roster_edge_reads_only_its_own_rake.sql
--
-- A ROSTER EDGE READS ONLY ITS OWN RAKE (fn_union_agent_roster_sustained_edge, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, 2026-11-19 ~11:55 UTC)
--
-- 20261119063000 installed at 10:15 UTC; the union-integrity-sweep cron then
-- failed at 10:33 and 11:33 on its 120 s statement timeout inside
-- fn_union_agent_roster_sustained_edge. Its rake leg expanded EVERY rake record
-- of the 7-day window (541,753 rows, every player_contributions object, and a
-- full scan of tables and tournaments for the scope test) and only then joined
-- the roster: 24 s for one agent, and the sweep calls it per flagged agent and
-- per open alert. The 7-day net leg was already roster-driven (0.7 ms).
--
-- THE FIX
--
-- The rake leg starts from the roster: for each roster player, only the rake
-- records whose player_contributions name that player (the GIN index
-- idx_rake_records_contribs_gin), inside the window, with the same scope test
-- and the same proportional share. Same answer (savage: 141.99 both ways),
-- 0.2 s / 2.1 s for the two largest rosters instead of 24 s. COST 10000 makes
-- the planner evaluate it after the sweep's own cheap conditions.
--
-- @live-proof: position('player_contributions ? (r.player_id::text)' in pg_get_functiondef('public.fn_union_agent_roster_sustained_edge(uuid,uuid,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $guard$
DECLARE v_def text := pg_get_functiondef('public.fn_union_agent_roster_sustained_edge(uuid,uuid,integer)'::regprocedure);
BEGIN
  IF md5(v_def) <> '6aea003938c2d3ff045ebd2ddbfa4f8e'
     AND position('player_contributions ? (r.player_id::text)' in v_def) = 0 THEN
    RAISE EXCEPTION 'fn_union_agent_roster_sustained_edge is neither the 20261119063000 text nor this repair (md5 %)', md5(v_def);
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_union_agent_roster_sustained_edge(
  p_union_id uuid, p_agent_id uuid, p_days integer DEFAULT 7)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
COST 10000
SET search_path TO 'public'
AS $f$
  WITH scope_clubs AS MATERIALIZED (
    SELECT uc.club_id FROM public.union_clubs uc WHERE uc.union_id = p_union_id
    UNION
    SELECT c.id FROM public.clubs c WHERE c.id = p_union_id AND c.is_union IS TRUE
  ),
  roster AS MATERIALIZED (
    SELECT DISTINCT m.user_id AS player_id
      FROM public.club_members m
      JOIN scope_clubs sc ON sc.club_id = m.club_id
     WHERE m.agent_id = p_agent_id
       AND NOT EXISTS (SELECT 1 FROM public.profiles hp
                        WHERE hp.id = m.user_id AND COALESCE(hp.is_horse, false))
  ),
  net AS (
    SELECT COALESCE(SUM(CASE
             WHEN wt.type = 'credit' AND wt.category IN ('cashout','prize','bounty') THEN wt.amount
             WHEN wt.type = 'debit'  AND wt.category IN ('buyin','rebuy','addon','tournament_buyin') THEN -wt.amount
             ELSE 0 END), 0) AS v
      FROM roster r
      JOIN public.wallet_transactions wt ON wt.user_id = r.player_id
     WHERE wt.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND (EXISTS (SELECT 1 FROM public.tables t WHERE t.id = wt.table_id
                     AND (t.union_id = p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
            OR (wt.table_id IS NULL AND EXISTS (
                  SELECT 1 FROM public.tournaments t WHERE t.id = wt.related_entity_id
                   AND (t.union_id = p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))))
  ),
  rk AS (
    SELECT COALESCE(SUM(rr.rake_amount * ((rr.player_contributions ->> (r.player_id::text))::numeric) / NULLIF(c.total, 0)), 0) AS v
      FROM roster r
      CROSS JOIN LATERAL (
        SELECT x.* FROM public.rake_records x
         WHERE x.player_contributions ? (r.player_id::text)
           AND x.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
        OFFSET 0) rr
      CROSS JOIN LATERAL (SELECT SUM(t.value::numeric) AS total
                            FROM jsonb_each_text(rr.player_contributions) t(key, value)) c
     WHERE c.total > 0
       AND (EXISTS (SELECT 1 FROM public.tables t WHERE t.id = rr.table_id
                     AND (t.union_id = p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs))))
            OR (rr.table_id IS NULL AND EXISTS (
                  SELECT 1 FROM public.tournaments t WHERE t.id = rr.tournament_id
                   AND (t.union_id = p_union_id OR (t.union_id IS NULL AND t.club_id IN (SELECT club_id FROM scope_clubs)))))
            OR (rr.table_id IS NULL AND rr.tournament_id IS NULL AND rr.club_id IN (SELECT club_id FROM scope_clubs)))
  )
  SELECT (SELECT v FROM net) > 0
     AND (SELECT v FROM net) > 10 * GREATEST((SELECT v FROM rk), 1);
$f$;

REVOKE ALL ON FUNCTION public.fn_union_agent_roster_sustained_edge(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_union_agent_roster_sustained_edge(uuid, uuid, integer) TO service_role;

-- The repaired body answers inside the sweep's budget before COMMIT: every
-- agent named by an open sweep alert, together, well under the 120 s cron limit.
-- @probe-for: public.fn_union_agent_roster_sustained_edge
DO $probe$
DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.fn_union_agent_roster_sustained_edge((a.context->>'union_id')::uuid, (e->>'agent_user_id')::uuid, 7)
     FROM public.financial_alerts a
     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) e
    WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved;
  PERFORM public.fn_union_agent_roster_sustained_edge(gen_random_uuid(), gen_random_uuid(), 7);
  IF clock_timestamp() - t0 > interval '60 seconds' THEN
    RAISE EXCEPTION 'roster edge still too slow for the sweep: %', clock_timestamp() - t0;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
