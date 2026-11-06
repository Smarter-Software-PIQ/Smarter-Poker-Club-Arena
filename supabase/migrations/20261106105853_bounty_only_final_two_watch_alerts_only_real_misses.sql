-- 20261106105853_bounty_only_final_two_watch_alerts_only_real_misses.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE FINAL TWO WATCH ALERTS ONLY A REAL MISS (2026-11-06).
--
-- fn_ca_bounty_only_final_two_watch (20261106032337) raised a critical
-- financial alert, closed_without_final_two, for every completed bounty only
-- PKO with two or more entrants and no close row. Two outcomes of the rule
-- working leave no close row and were raised as critical:
--
--   1. The field never sat at exactly two. The engine asks for the close only
--      after a settled bust leaves two players; when one hand busts the
--      second and third players together the field goes from three to one
--      (production already shows 454 bust pairs under half a second apart in
--      three days), and a two player event never has such a bust.
--   2. The close was refused. fn_ca_bounty_only_pko_final_two refuses for a
--      rule reason (heads_do_not_match_the_open_pool, a_live_head_is_empty,
--      ...), and the engine now also gives up on a "not yet" that outlasts
--      its retry budget (about 60s or 12 asks) so the final two can never
--      freeze; both play on heads up. Refusals were written only to the
--      engine log, which the database cannot read.
--
-- So this adds ca_bounty_only_final_two_refusals, which the engine writes
-- once per refused event (service_role; one row per tournament), and the
-- watch raises closed_without_final_two only when the field did sit at two
-- (three or more entrants, and the players recorded second and third were
-- busted in different hands, from tournament_knockout_candidates) and no
-- refusal was recorded. An unknown bust hand still raises. Every other check
-- of the watch, including pool_not_closed_exactly for a refused event, is
-- unchanged. Nothing here moves chips.
--
-- The preimage is guarded on the live definition (md5, owner, ACL, config,
-- SECURITY DEFINER, read 2026-11-06 10:53 UTC); CREATE OR REPLACE keeps the
-- owner and ACL, and both are re-asserted and proved after. No watch alert
-- had been raised when this was written (its window opens 12:00 UTC
-- 2026-11-06), so nothing needs resolving.
-- @live-proof: to_regclass('public.ca_bounty_only_final_two_refusals') IS NOT NULL AND has_table_privilege('service_role','public.ca_bounty_only_final_two_refusals','INSERT') AND NOT has_table_privilege('authenticated','public.ca_bounty_only_final_two_refusals','SELECT') AND position('third_bust_hand' in pg_get_functiondef('public.fn_ca_bounty_only_final_two_watch(timestamptz)'::regprocedure)) > 0 AND NOT has_function_privilege('authenticated','public.fn_ca_bounty_only_final_two_watch(timestamptz)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regclass('public.ca_bounty_only_final_two_refusals') IS NOT NULL THEN
    RAISE EXCEPTION 'bounty only final two refusals already installed';
  END IF;
  IF to_regclass('public.ca_bounty_only_final_two') IS NULL
     OR to_regclass('public.tournament_knockout_candidates') IS NULL
     OR to_regclass('public.ca_bounty_only_final_two_breaches') IS NULL THEN
    RAISE EXCEPTION 'bounty only final two watch dependencies are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_final_two_watch(timestamptz)')
                    AND md5(pg_get_functiondef(p.oid)) = 'd5d3d03c25baa6b97533ee1699827ec2'
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_PREIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END $pre$;

CREATE TABLE public.ca_bounty_only_final_two_refusals(
  tournament_id uuid PRIMARY KEY,
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
COMMENT ON TABLE public.ca_bounty_only_final_two_refusals IS
 'Bounty only PKOs whose close at two players was refused (a rule reason, or retries that outlasted the engine budget so the final two never froze); the event played on heads up. Written by the engine (service_role), read by fn_ca_bounty_only_final_two_watch. Moves no chips.';
ALTER TABLE public.ca_bounty_only_final_two_refusals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_bounty_only_final_two_refusals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.ca_bounty_only_final_two_refusals TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_bounty_only_final_two_watch(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The database close was installed 2026-11-06 03:10 UTC (20261106010426);
  -- the engine that calls it ships in the 03:31-03:43 Chicago release and the
  -- room is closed for maintenance until 06:00 Chicago (12:00 UTC). An event
  -- finished before that played to one winner on the previous engine.
  v_since timestamptz := COALESCE(p_since, '2026-11-06 12:00:00+00'::timestamptz);
  v_found integer := 0;
  r record;
BEGIN
  FOR r IN
    WITH ev AS (
      SELECT t.id, t.name, upper(COALESCE(t.status::text, '')) AS status, t.ended_at,
             round(COALESCE(t.bounty_pool, 0), 2) AS pool,
             round(COALESCE(t.bounty_pool_paid, 0), 2) AS pool_paid,
             c.tournament_id IS NOT NULL AS closed,
             c.created_at AS closed_at, c.winner_user_id, c.runner_up_user_id,
             c.winner_head, c.runner_up_head
        FROM public.tournaments t
        LEFT JOIN public.ca_bounty_only_final_two c ON c.tournament_id = t.id
       WHERE COALESCE(t.is_pko, false)
         AND NOT COALESCE(t.is_mystery_bounty, false)
         AND COALESCE(t.buy_in_amount, 0) <= 0
         AND COALESCE(t.guaranteed_prize, 0) <= 0
         AND COALESCE(t.prize_pool, 0) <= 0
         AND COALESCE(t.bounty_pool, 0) > 0
         AND (c.tournament_id IS NOT NULL
              OR (upper(COALESCE(t.status::text, '')) = 'COMPLETED'
                  AND COALESCE(t.ended_at, t.updated_at) >= v_since))
         AND COALESCE(c.created_at, t.ended_at, t.updated_at) >= now() - interval '14 days'
    ), checks AS (
      SELECT ev.*,
        (SELECT round(COALESCE(sum(o.amount_paid), 0), 2) FROM public.tournament_obligations o
          WHERE o.tournament_id = ev.id AND o.kind = 'bounty_residual' AND o.place IS NULL
            AND o.user_id = ev.runner_up_user_id) AS runner_up_paid,
        (SELECT jsonb_build_object('winner', rc.winner_user_id,
                  'residual', round(COALESCE((rc.pool_result->>'residual')::numeric, 0), 2),
                  'paid_to', rc.pool_result->>'paid_to')
           FROM public.tournament_bounty_completion_receipts rc
          WHERE rc.tournament_id = ev.id AND rc.pool_finalized_at IS NOT NULL) AS receipt,
        (SELECT round(COALESCE(sum(CASE WHEN lower(wt.type) = 'debit' THEN -abs(wt.amount)
                                        ELSE wt.amount END), 0), 2)
           FROM public.wallet_transactions wt
          WHERE wt.related_entity_id = ev.id AND wt.category = 'bounty') AS wallet_bounty,
        (SELECT count(*) FROM public.tournament_bounties b
          WHERE b.tournament_id = ev.id AND b.eliminated_player_id = ev.runner_up_user_id
            AND b.created_at > ev.closed_at) AS knockouts_after_close,
        (SELECT count(DISTINCT tp.user_id) FROM public.tournament_players tp
          WHERE tp.tournament_id = ev.id) AS entrants,
        -- The hand that busted the player recorded second, and the one that
        -- busted the player recorded third: the same hand means the field
        -- went from three to one and never sat at exactly two.
        (SELECT c.hand_id FROM public.tournament_players tp
           JOIN public.tournament_knockout_candidates c
             ON c.tournament_id = tp.tournament_id AND c.eliminated_user_id = tp.user_id
            AND c.state = 'eliminated'
          WHERE tp.tournament_id = ev.id AND tp.position = 2
          ORDER BY c.created_at DESC LIMIT 1) AS second_bust_hand,
        (SELECT c.hand_id FROM public.tournament_players tp
           JOIN public.tournament_knockout_candidates c
             ON c.tournament_id = tp.tournament_id AND c.eliminated_user_id = tp.user_id
            AND c.state = 'eliminated'
          WHERE tp.tournament_id = ev.id AND tp.position = 3
          ORDER BY c.created_at DESC LIMIT 1) AS third_bust_hand,
        (SELECT f.reason FROM public.ca_bounty_only_final_two_refusals f
          WHERE f.tournament_id = ev.id) AS refusal
        FROM ev
    ), breaches AS (
      -- A miss only: the field sat at exactly two after a settled bust (three
      -- or more entrants, and second and third were busted in different
      -- hands), and the engine recorded no refusal. A field that went from
      -- three to one in one hand, a two player event, and a close the
      -- authority refused for a rule reason (or that the engine gave up on so
      -- the event never froze) are the rule working, not a breach. An unknown
      -- bust hand is not proof of either, so it still raises.
      SELECT id, name, 'closed_without_final_two'::text AS breach,
             jsonb_build_object('status', status, 'entrants', entrants,
                                'second_bust_hand', second_bust_hand,
                                'third_bust_hand', third_bust_hand) AS detail
        FROM checks
       WHERE NOT closed AND entrants >= 3 AND refusal IS NULL
         AND (second_bust_hand IS NULL OR third_bust_hand IS NULL
              OR second_bust_hand <> third_bust_hand)
      UNION ALL
      SELECT id, name, 'runner_up_not_paid_own_head',
             jsonb_build_object('runner_up', runner_up_user_id, 'head', runner_up_head,
                                'paid', runner_up_paid)
        FROM checks WHERE closed AND runner_up_paid IS DISTINCT FROM round(runner_up_head, 2)
      UNION ALL
      SELECT id, name, 'not_completed_after_close',
             jsonb_build_object('status', status, 'closed_at', closed_at)
        FROM checks WHERE closed AND status <> 'COMPLETED'
                      AND closed_at < now() - interval '10 minutes'
      UNION ALL
      SELECT id, name, 'winner_not_paid_own_head',
             jsonb_build_object('winner', winner_user_id, 'head', winner_head, 'receipt', receipt)
        FROM checks WHERE closed AND status = 'COMPLETED'
                      AND (receipt IS NULL
                           OR (receipt->>'winner')::uuid IS DISTINCT FROM winner_user_id
                           OR (receipt->>'residual')::numeric IS DISTINCT FROM round(winner_head, 2))
      UNION ALL
      SELECT id, name, 'pool_not_closed_exactly',
             jsonb_build_object('bounty_pool', pool, 'bounty_pool_paid', pool_paid,
                                'wallet_bounty', wallet_bounty)
        FROM checks WHERE status = 'COMPLETED' AND (pool_paid <> pool OR wallet_bounty <> pool)
      UNION ALL
      SELECT id, name, 'runner_up_knocked_out_after_close',
             jsonb_build_object('runner_up', runner_up_user_id, 'knockouts', knockouts_after_close)
        FROM checks WHERE closed AND knockouts_after_close > 0
    )
    SELECT * FROM breaches
  LOOP
    v_found := v_found + 1;
    INSERT INTO public.ca_bounty_only_final_two_breaches AS b (tournament_id, breach, detail)
    VALUES (r.id, r.breach, r.detail)
    ON CONFLICT (tournament_id, breach) DO UPDATE
       SET detail = EXCLUDED.detail, last_seen_at = clock_timestamp();

    INSERT INTO public.financial_alerts (severity, source, message, context)
    SELECT 'critical', 'fn_ca_bounty_only_final_two_watch',
           'Bounty only PKO closed at two did not pay both survivors exactly their own heads: '
             || r.breach,
           jsonb_build_object('tournament_id', r.id, 'tournament_name', r.name,
                              'breach', r.breach, 'detail', r.detail)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.financial_alerts a
        WHERE a.source = 'fn_ca_bounty_only_final_two_watch'
          AND a.resolved IS NOT TRUE
          AND a.context->>'tournament_id' = r.id::text
          AND a.context->>'breach' = r.breach);
  END LOOP;
  RETURN v_found;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_bounty_only_final_two_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bounty_only_final_two_watch(timestamptz) TO service_role;

DO $post$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_final_two_watch(timestamptz)')
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef
                    AND position('third_bust_hand' in pg_get_functiondef(p.oid)) > 0
                    AND position('ca_bounty_only_final_two_refusals' in pg_get_functiondef(p.oid)) > 0) THEN
    RAISE EXCEPTION 'FINAL_TWO_WATCH_POSTIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END $post$;

COMMIT;
