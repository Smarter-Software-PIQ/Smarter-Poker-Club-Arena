-- 20261106032337_bounty_only_final_two_payout_is_watched
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-06 03:23:37 UTC.
--
-- A BOUNTY ONLY PKO CLOSED AT TWO PAID BOTH SURVIVORS EXACTLY THEIR OWN HEADS
-- (owner rule 2026-11-05: the event ends with two players left and both keep
-- the bounty on their own head; 20261106010426.)
--
-- fn_ca_bounty_only_pko_final_two pays the second player his own head and the
-- unchanged terminal pays the first player the pool residual, which must be
-- exactly his own head. Nothing watched the result. This adds a detection
-- only watch, read-only toward money, that every five minutes proves for
-- each bounty only PKO finished after the rule went live (12:00 UTC on
-- 2026-11-06, the first opening after the engine release that calls it):
--
--   (a) the second player's bounty_residual obligation paid exactly the head
--       recorded on the close;
--   (b) the champion's completion receipt paid a residual of exactly the
--       first player's head, to the first player;
--   (c) the pool closed exactly: bounty_pool_paid = bounty_pool and the
--       event's 'bounty' wallet rows sum to bounty_pool;
--   (d) no knockout of the second player was paid after the close;
--
-- and that a completed bounty only PKO with two or more entrants closed at
-- two at all (a close row exists), and a close row is not left on an event
-- that stopped short of COMPLETED. A close row is judged on (b) and (c) only
-- once its event is COMPLETED; it is a breach if that has not happened 10
-- minutes after the close.
--
-- Each breach writes one critical financial_alerts row per tournament and
-- breach kind while an unresolved one exists (the same per tournament dedupe
-- as trg_seed_bounty_head). Nothing here moves chips.
-- @live-proof: to_regprocedure('public.fn_ca_bounty_only_final_two_watch(timestamptz)') IS NOT NULL AND to_regclass('public.ca_bounty_only_final_two_breaches') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='ca-bounty-only-final-two-watch-5m') AND NOT has_function_privilege('authenticated','public.fn_ca_bounty_only_final_two_watch(timestamptz)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regclass('public.ca_bounty_only_final_two_breaches') IS NOT NULL
     OR to_regprocedure('public.fn_ca_bounty_only_final_two_watch(timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'bounty only final two watch already installed';
  END IF;
  IF to_regclass('public.ca_bounty_only_final_two') IS NULL
     OR to_regclass('public.tournament_obligations') IS NULL
     OR to_regclass('public.tournament_bounty_completion_receipts') IS NULL
     OR to_regclass('public.tournament_bounties') IS NULL
     OR to_regclass('public.wallet_transactions') IS NULL
     OR to_regclass('public.financial_alerts') IS NULL THEN
    RAISE EXCEPTION 'bounty only final two watch dependencies are missing';
  END IF;
END $pre$;

CREATE TABLE public.ca_bounty_only_final_two_breaches(
  tournament_id uuid NOT NULL,
  breach text NOT NULL,
  detail jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tournament_id, breach));
COMMENT ON TABLE public.ca_bounty_only_final_two_breaches IS
 'Bounty only PKOs whose close at two players did not pay both survivors exactly their own heads (owner rule 2026-11-05). Written only by fn_ca_bounty_only_final_two_watch; detection only, nothing here moves chips.';
ALTER TABLE public.ca_bounty_only_final_two_breaches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_bounty_only_final_two_breaches FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_bounty_only_final_two_breaches TO service_role;

CREATE FUNCTION public.fn_ca_bounty_only_final_two_watch(p_since timestamptz DEFAULT NULL)
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
          WHERE tp.tournament_id = ev.id) AS entrants
        FROM ev
    ), breaches AS (
      SELECT id, name, 'closed_without_final_two'::text AS breach,
             jsonb_build_object('status', status, 'entrants', entrants) AS detail
        FROM checks WHERE NOT closed AND entrants >= 2
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
COMMENT ON FUNCTION public.fn_ca_bounty_only_final_two_watch(timestamptz) IS
 'Detection only: proves every bounty only PKO finished after the close-at-two rule paid both survivors exactly their own heads and closed its pool exactly; one critical financial alert per tournament and breach. Moves no chips.';

-- periodic-work: the owner requires that a bounty only PKO ends with two players and both keep exactly their own head; this proves it for every such event within five minutes of its close and raises a critical financial alert when it did not. Read-only toward money.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-bounty-only-final-two-watch-5m';
SELECT cron.schedule('ca-bounty-only-final-two-watch-5m', '3,8,13,18,23,28,33,38,43,48,53,58 * * * *',
  $c$SET statement_timeout = '60s'; SELECT public.fn_ca_bounty_only_final_two_watch();$c$);

COMMIT;
