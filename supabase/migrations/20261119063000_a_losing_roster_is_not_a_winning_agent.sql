-- 20261119063000_a_losing_roster_is_not_a_winning_agent.sql
--
-- A LOSING ROSTER IS NOT A WINNING AGENT (fn_union_integrity_sweep, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, read-only, 2026-11-19 ~06:20 UTC)
--
-- After 20261118165323 closed the cashout misfires, 12 sweep alerts stayed open,
-- every one an agent_roster_winning signal for agent "savage" (9ca264f1, Club
-- Savage) whose only non-horse roster player with play is kingfish: player_net
-- +395 to +942 per 24 h window, 20-30x the rake generated. But over 14 days
-- kingfish's union wallet flow is -2,845 (cash 14,520 out vs 17,330 in;
-- tournaments 364 vs 400), and over 30 days he lost on 20 of 26 playing days.
-- The signal scored ONE 24 h window with no memory, so a losing high-variance
-- player raised an alert on every winning day; a real roster edge is sustained.
--
-- THE FIX (the signal, not a threshold)
--
-- 1. fn_union_agent_roster_sustained_edge(union, agent, days): the roster's
--    net (cashout/prize/bounty in minus buy-in/rebuy/add-on/tournament buy-in
--    out) and its rake over the last N days, scoped exactly as the sweep scopes
--    them (union tables and tournaments, horses excluded); true when net > 0 and
--    net > 10x rake - the sweep's own ratio.
-- 2. The sweep flags an agent roster only when the 24 h edge is also sustained
--    over 7 days.
-- 3. An open alert closes on a re-measurement when it names no co-seating pair,
--    none of its direct transfers is a dump (fn_union_transfer_counts_as_dump),
--    and no roster it names has a sustained 7-day edge now. Co-seating stays a
--    review item for a person.
--
-- No money moves. Re-apply is a no-op (pinned pre/postimage).
--
-- @live-proof: to_regprocedure('public.fn_union_agent_roster_sustained_edge(uuid,uuid,integer)') IS NOT NULL AND position('fn_union_agent_roster_sustained_edge(p_union_id, n.agent_id, 7)' in pg_get_functiondef('public.fn_union_integrity_sweep(uuid,integer)'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

CREATE OR REPLACE FUNCTION public.fn_union_agent_roster_sustained_edge(
  p_union_id uuid, p_agent_id uuid, p_days integer DEFAULT 7)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
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
    SELECT COALESCE(SUM(rr.rake_amount * (e.value::numeric) / NULLIF(c.total, 0)), 0) AS v
      FROM public.rake_records rr
      CROSS JOIN LATERAL (SELECT SUM(t.value::numeric) AS total
                            FROM jsonb_each_text(rr.player_contributions) t(key, value)) c
      CROSS JOIN LATERAL jsonb_each_text(rr.player_contributions) e(key, value)
      JOIN roster r ON r.player_id = (e.key)::uuid
     WHERE rr.created_at >= now() - make_interval(days => GREATEST(p_days, 1))
       AND rr.player_contributions IS NOT NULL AND c.total > 0
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
  '5405e7e915005d18df43dcc8056f3eb0', '307c48cc499243732b05193ec2af9611',
  ARRAY[
$o1$   WHERE n.player_net > 0
     AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1);
$o1$,
$o2$
  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,$o2$],
  ARRAY[
$n1$   WHERE n.player_net > 0
     AND n.player_net > 10 * GREATEST(COALESCE(k.rake,0), 1)
     -- A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000): one winning
     -- day of a player who loses over the week is variance, not an edge.
     AND public.fn_union_agent_roster_sustained_edge(p_union_id, n.agent_id, 7);
$n1$,
$n2$
  /* A LOSING ROSTER IS NOT A WINNING AGENT (20261119063000). An open alert
     closes on a re-measurement when it names no co-seating pair, none of its
     direct transfers is a dump, and no roster it names has a sustained 7-day
     edge now. Co-seating stays a review item for a person. */
  UPDATE financial_alerts a
     SET resolved = true, resolved_at = now(),
         resolution = 'verified: re-measured; no agent roster it names holds a sustained 7-day edge (net > 10x rake), and none of its direct chip transfers is a player-to-player dump'
   WHERE a.source = 'fn_union_integrity_sweep' AND NOT a.resolved
     AND a.context->>'union_id' = p_union_id::text
     AND jsonb_array_length(COALESCE(a.context->'co_seating', '[]'::jsonb)) = 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(COALESCE(a.context->'agent_roster_winning', '[]'::jsonb)) e
        WHERE public.fn_union_agent_roster_sustained_edge(p_union_id, (e->>'agent_user_id')::uuid, 7))
     AND NOT EXISTS (
       SELECT 1 FROM chip_transactions ct
        WHERE ct.created_at >= a.created_at - make_interval(hours => GREATEST(COALESCE((a.context->>'window_hours')::int, 24), 1))
          AND ct.created_at <= a.created_at
          AND (EXISTS (SELECT 1 FROM public.union_clubs uc
                 WHERE uc.union_id=p_union_id AND uc.club_id=ct.club_id)
            OR EXISTS (SELECT 1 FROM public.clubs c
                 WHERE c.id=p_union_id AND c.is_union IS TRUE AND c.id=ct.club_id))
          AND public.fn_union_transfer_counts_as_dump(ct));

  RETURN jsonb_build_object(
    'union_id', p_union_id, 'window_hours', p_hours, 'signals', v_total,$n2$]);

COMMIT;
