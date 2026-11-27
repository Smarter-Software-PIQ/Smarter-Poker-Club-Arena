-- 20261126220936_monitor_and_report_reads_are_bounded_by_their_indexes.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- FOUR READS THAT OUTGREW THE 8 s STATEMENT BUDGET (production, 24 h to
-- 2026-11-26 21:45Z, SQLSTATE 57014 / edge 500 at ~8.0 s). Each is fixed by
-- reading what an index or an existing rollup already holds; no reader's
-- answer changes, and every grant is restated exactly as it is live.
--
-- 1. fn_settler_lag_check (via fn_union_treasury_selftest, 39 timeouts).
--    Once the union week closes, the "week still unaccrued" query counts cash
--    rake in [week_from, week_to) above the settler cursor. It bounded the
--    index range by week_from only and tested the cursor as a filter, and it
--    spelled the cash test NOT COALESCE(is_tournament, false), which the
--    partial index rake_records_cash_positive_created (is_tournament IS NOT
--    TRUE) cannot prove. So every call walked the whole closed week:
--    280k buffers warm, ~6.4 s cold. The range now starts at
--    GREATEST(week_from, cursor) and the cash test is spelled as the index
--    spells it: 4 buffers, 0.3 ms. Same rows counted (anything below the
--    cursor was already excluded by the keyset test).
--
-- 2. fn_bbj_analytics (the BBJ admin analytics panel, 14 timeouts).
--    contributions_24h/7d/30d, hands and the all-time total were summed over
--    ca_launch_bbj_reporting_contributions, every contribution of the pool
--    since its launch reset: 5.0M rows, 12.99 s. The jackpot already keeps a
--    trigger-invalidated hourly rollup (bbj_pool_contribution_hours, filled
--    by fn_bbj_pool_facts). Whole closed hours inside each window now come
--    from the rollup, the partial edge hour and the open tail from
--    bbj_contributions by (pool_id, created_at); the launch-reset start
--    applies to both exactly as the view applied it. Compared on production
--    for the busiest pool, all four windows matched to the cent and the row
--    (24h 8,842.85 / 26,574; all-time 1,783,400.59 / 5,011,941) in 15 ms.
--
-- 3. ca_public_arena_record_separated (profile Arena Record, 6 timeouts).
--    hands/VPIP/PFR per club counted ca_hand_facts row by row: over 40 s for
--    a heavy player. club_member_daily_facts is the trigger-maintained daily
--    rollup of the same facts (hands, vpip_hands, pfr_hands, is_mtt); summed
--    per club it matched ca_hand_facts exactly on sampled players and reads
--    in 4 ms. Output shape and coverage block are unchanged.
--
-- 4. GET /rest/v1/game_management_events (Game Management board, 13 timeouts).
--    The board read the table through RLS whose policy calls
--    fn_can_create_games / fn_is_union_operator per row. For a member who is
--    not an operator every row of the scope is rejected, so LIMIT 128 never
--    fills and the read walks the whole scope (2.3M rows in the biggest
--    union) evaluating the functions: over 20 s. fn_game_management_feed
--    decides the caller's authority ONCE and then reads either the scope
--    (idx_game_management_events_scope) or only the caller's own events
--    (idx_game_management_events_recipient): under 1 ms either way. It
--    returns exactly the rows the policy would have shown. The table and its
--    policy are unchanged; src/hooks/useGameManagementRealtime.ts moves to
--    the function.
--
-- Pinned by tests/monitor-and-report-reads-are-bounded.law.test.ts.
--
-- @live-proof: position('GREATEST(v_week_from, v_cursor)' in pg_get_functiondef('public.fn_settler_lag_check()'::regprocedure)) > 0
-- @live-proof: position('bbj_pool_contribution_hours' in pg_get_functiondef('public.fn_bbj_analytics(uuid)'::regprocedure)) > 0
-- @live-proof: position('club_member_daily_facts' in pg_get_functiondef('public.ca_public_arena_record_separated(uuid,text,text)'::regprocedure)) > 0
-- @live-proof: has_function_privilege('authenticated', 'public.fn_game_management_feed(text,uuid,integer)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.fn_game_management_feed(text,uuid,integer)', 'EXECUTE')

BEGIN;

SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- 1. ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_settler_lag_check()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- RakebackSettlerService.SETTLEMENT_INTERVAL_MS is 30 minutes. The grace is
  -- one whole interval plus the :53-to-:00 maintenance freeze, so a healthy
  -- cycle - including one that correctly waited out a freeze - is never an
  -- incident, and a cycle that was actually SKIPPED always is.
  c_interval_m constant numeric  := 30;
  c_grace_m    constant numeric  := 45;
  -- The union week closes at fn_union_week_start(now()) and the cascade cron
  -- (job 272, `0,30 * * * *`) then attempts it. Allow one settler interval past
  -- the boundary before calling the week blocked, so the drain gets a fair
  -- chance to accrue the final hands of the week first.
  c_week_grace constant interval := interval '30 minutes';
  v_cursor     timestamptz;
  v_cursor_id  uuid;
  v_saved      timestamptz;
  v_lag_h      numeric;
  v_stale_m    numeric;
  v_backlog    bigint;
  v_week_to    timestamptz;
  v_week_from  timestamptz;
  v_unaccrued  bigint := 0;
  v_blocked    boolean := false;
  v_stalled    boolean;
  v_oldest     timestamptz;
  v_cursor_age_h numeric;
BEGIN
  SELECT high_water_mark, high_water_mark_id, updated_at
    INTO v_cursor, v_cursor_id, v_saved
    FROM daemon_state
   WHERE daemon = 'rakeback_settler';

  IF v_cursor IS NULL THEN
    -- A genuine first run has no cursor. That is not a stall.
    RETURN jsonb_build_object('healthy', true, 'note', 'no settler cursor yet');
  END IF;

  v_cursor_age_h := round(EXTRACT(epoch FROM (now() - v_cursor)) / 3600.0, 2);
  v_stale_m := round(EXTRACT(epoch FROM (now() - v_saved)) / 60.0, 1);

  -- THE BACKLOG IS WHAT THE SETTLER READS (2026-10-15). The settler pages
  -- rake_records WHERE rake_amount > 0 by the keyset (created_at, id) and,
  -- with nothing to read, leaves its cursor and updated_at alone. So the
  -- backlog is the positive rows above that keyset (a reversal it never reads
  -- is not work), and the lag is the age of the OLDEST of them: an idle
  -- settler has no lag however old its cursor is. Bounded on purpose: the
  -- verdict needs to know that backlog exists and roughly how much, never
  -- the exact depth of a days-old hole.
  SELECT count(*), min(s.created_at) INTO v_backlog, v_oldest
    FROM (SELECT rr.created_at
            FROM rake_records rr
           WHERE rr.rake_amount > 0
             AND rr.created_at >= v_cursor
             AND (rr.created_at > v_cursor
                  OR (rr.created_at = v_cursor
                      AND v_cursor_id IS NOT NULL AND rr.id > v_cursor_id))
           ORDER BY rr.created_at, rr.id
           LIMIT 5000) s;
  v_lag_h := COALESCE(round(EXTRACT(epoch FROM (now() - v_oldest)) / 3600.0, 2), 0);

  v_week_to   := public.fn_union_week_start(now());
  v_week_from := v_week_to - interval '7 days';

  IF now() >= v_week_to + c_week_grace THEN
    -- The same predicate fn_process_weekly_accounting_scope gates on, minus its
    -- per-union club scoping: if ANY cash rake inside the closed week is still
    -- above the cursor then at least one union raises
    -- weekly_rake_source_not_fully_accrued and the cascade settles nothing.
    --
    -- THE WEEK IS READ FROM THE CURSOR UP (2026-11-26). Rows below the cursor
    -- can never qualify (the keyset test below refuses them), so the index
    -- range starts at GREATEST(v_week_from, v_cursor) instead of walking the
    -- whole closed week, and the cash test is spelled exactly as the partial
    -- index rake_records_cash_positive_created spells it (is_tournament IS
    -- NOT TRUE) so the planner can use it. Same rows, same count: 280k
    -- buffers became 4 (fn_union_treasury_selftest timed out 39 times on
    -- 2026-11-26).
    SELECT count(*) INTO v_unaccrued
      FROM (SELECT 1
              FROM rake_records rr
             WHERE rr.is_tournament IS NOT TRUE
               AND rr.tournament_id IS NULL
               AND rr.rake_amount > 0
               AND rr.created_at >= GREATEST(v_week_from, v_cursor)
               AND rr.created_at <  v_week_to
               AND (rr.created_at > v_cursor
                    OR (rr.created_at = v_cursor
                        AND (v_cursor_id IS NULL OR rr.id > v_cursor_id)))
             LIMIT 5000) w;
    v_blocked := v_unaccrued > 0;
  END IF;

  -- A stall is a row the settler reads that has waited longer than one
  -- interval plus the freeze. The cursor's age alone is not one (an idle
  -- floor gives the settler nothing to save), and neither is a backlog that
  -- arrived after a quiet spell and is younger than the grace.
  v_stalled := v_oldest IS NOT NULL
    AND v_oldest < now() - make_interval(mins => c_grace_m::integer);

  RETURN jsonb_build_object(
    'healthy',                 NOT (v_stalled OR v_blocked OR v_lag_h > 6),
    'cursor',                  v_cursor,
    'cursor_age_hours',        v_cursor_age_h,
    'oldest_pending_at',       v_oldest,
    'lag_hours',               v_lag_h,
    'last_save_hours_ago',     round(v_stale_m / 60.0, 2),
    'last_save_minutes_ago',   v_stale_m,
    'backlog_rows',            v_backlog,
    'interval_minutes',        c_interval_m,
    'stall_grace_minutes',     c_grace_m,
    'stalled',                 v_stalled,
    'week_from',               v_week_from,
    'week_to',                 v_week_to,
    'week_unaccrued_rows',     v_unaccrued,
    'week_settlement_blocked', v_blocked);
END $function$;

REVOKE ALL ON FUNCTION public.fn_settler_lag_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_settler_lag_check() TO service_role;

-- 2. ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_bbj_analytics(p_pool_id uuid)
 RETURNS TABLE(main_balance numeric, backup_balance numeric, promo_balance numeric, contributions_24h numeric, contributions_7d numeric, contributions_30d numeric, hands_24h bigint, hands_7d bigint, total_contributed_all_time numeric, hit_count bigint, total_paid_all_time numeric, biggest_hit numeric, last_hit_at timestamp with time zone, avg_days_between_hits numeric, days_since_last_hit numeric, net_pool_position numeric, mini_enabled boolean, mini_hit_count bigint, mini_paid_all_time numeric, mini_hits_30d bigint, mini_paid_30d numeric, mini_last_hit_at timestamp with time zone, mini_reserve_floor numeric, mini_parked numeric, mini_available numeric, hands_30d bigint, main_hit_count bigint, main_paid_all_time numeric, main_avg_days_between_hits numeric, main_last_hit_at timestamp with time zone, main_days_since_last_hit numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_club_id uuid;
  v_union_id uuid;
  v_allowed boolean := false;
  v_start timestamptz;
  v_cut   timestamptz;
  v_c24 numeric; v_c7 numeric; v_c30 numeric; v_call numeric;
  v_h24 bigint;  v_h7 bigint;  v_h30 bigint;
BEGIN
  SELECT bp.club_id, bp.union_id INTO v_club_id, v_union_id
  FROM public.bbj_pools bp WHERE bp.id = p_pool_id;

  IF v_club_id IS NULL AND v_union_id IS NULL THEN
    RAISE EXCEPTION 'BBJ pool not found';
  END IF;

  IF v_club_id IS NOT NULL THEN
    v_allowed := public.fn_is_club_admin_uid(v_club_id);
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.clubs c
      WHERE c.union_id = v_union_id
        AND public.fn_is_club_admin_uid(c.id)
    ) INTO v_allowed;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Not authorized: club admin role required for this jackpot pool';
  END IF;

  -- CONTRIBUTIONS FROM THE HOURLY ROLLUP (2026-11-26). The windows below are
  -- exactly what ca_launch_bbj_reporting_contributions gave (every
  -- contribution at or after the pool's last executed launch reset, and newer
  -- than the window's start), but whole closed UTC hours come from
  -- bbj_pool_contribution_hours, the trigger-invalidated rollup
  -- fn_bbj_pool_facts keeps for the jackpot page, and only the partial first
  -- hour and the open tail are read from bbj_contributions by
  -- (pool_id, created_at). Summing the view row by row read 5.0M rows for the
  -- busiest pool and timed out 14 times on 2026-11-26.
  SELECT COALESCE(max(o.captured_at), '-infinity'::timestamptz) INTO v_start
    FROM public.ca_launch_reset_operations o
    JOIN public.ca_launch_reset_rows r ON r.operation_id = o.operation_id
   WHERE o.state = 'executed' AND r.relation_name = 'bbj_pools'
     AND r.row_key = jsonb_build_object('id', p_pool_id);

  -- Make every closed hour before the cut present in the rollup (the same
  -- fill, under the same per-pool key, that the jackpot page performs).
  PERFORM 1 FROM public.fn_bbj_pool_facts(p_pool_id);
  v_cut := date_trunc('hour', now() - interval '15 minutes', 'UTC');

  WITH bounds(w, after_at) AS (
    VALUES ('24h', now() - interval '24 hours'),
           ('7d',  now() - interval '7 days'),
           ('30d', now() - interval '30 days'),
           ('all', '-infinity'::timestamptz)
  ), b AS (
    SELECT bounds.w, bounds.after_at,
           date_trunc('hour', GREATEST(bounds.after_at, v_start), 'UTC') + interval '1 hour' AS full_from
      FROM bounds
  ), s AS (
    SELECT b.w,
      COALESCE((SELECT sum(h.total) FROM public.bbj_pool_contribution_hours h
                 WHERE h.pool_id = p_pool_id AND h.hour_start >= b.full_from AND h.hour_start < v_cut), 0)
      + COALESCE((SELECT sum(c.amount) FROM public.bbj_contributions c
                   WHERE c.pool_id = p_pool_id AND c.created_at >= v_start AND c.created_at > b.after_at
                     AND c.created_at < LEAST(b.full_from, v_cut)), 0)
      + COALESCE((SELECT sum(c.amount) FROM public.bbj_contributions c
                   WHERE c.pool_id = p_pool_id AND c.created_at >= v_cut
                     AND c.created_at >= v_start AND c.created_at > b.after_at), 0) AS amt,
      COALESCE((SELECT sum(h.hands) FROM public.bbj_pool_contribution_hours h
                 WHERE h.pool_id = p_pool_id AND h.hour_start >= b.full_from AND h.hour_start < v_cut), 0)
      + (SELECT count(*) FROM public.bbj_contributions c
          WHERE c.pool_id = p_pool_id AND c.created_at >= v_start AND c.created_at > b.after_at
            AND c.created_at < LEAST(b.full_from, v_cut))
      + (SELECT count(*) FROM public.bbj_contributions c
          WHERE c.pool_id = p_pool_id AND c.created_at >= v_cut
            AND c.created_at >= v_start AND c.created_at > b.after_at) AS n
    FROM b
  )
  SELECT max(s.amt) FILTER (WHERE s.w = '24h'), max(s.amt) FILTER (WHERE s.w = '7d'),
         max(s.amt) FILTER (WHERE s.w = '30d'), max(s.amt) FILTER (WHERE s.w = 'all'),
         max(s.n) FILTER (WHERE s.w = '24h')::bigint, max(s.n) FILTER (WHERE s.w = '7d')::bigint,
         max(s.n) FILTER (WHERE s.w = '30d')::bigint
    INTO v_c24, v_c7, v_c30, v_call, v_h24, v_h7, v_h30
    FROM s;

  RETURN QUERY
  WITH pool AS (
    SELECT bp.main_balance, bp.backup_balance, bp.promo_balance,
           COALESCE(bp.mini_reserve_floor, 0) AS reserve_floor
    FROM public.bbj_pools bp WHERE bp.id = p_pool_id
  ),
  contrib AS (
    SELECT v_c24 AS c24, v_c7 AS c7, v_c30 AS c30,
           v_h24 AS h24, v_h7 AS h7, v_h30 AS h30,
           v_call AS call_time
  ),
  hits AS (
    SELECT
      COUNT(*) AS n,
      COALESCE(SUM(total_payout), 0) AS paid,
      COALESCE(MAX(total_payout), 0) AS biggest,
      MAX(awarded_at) AS last_at,
      MIN(awarded_at) AS first_at
    FROM public.ca_launch_bbj_reporting_winners WHERE pool_id = p_pool_id
  ),
  main_only AS (
    SELECT
      COUNT(*) AS n,
      COALESCE(SUM(total_payout), 0) AS paid,
      MAX(awarded_at) AS last_at,
      MIN(awarded_at) AS first_at
    FROM public.ca_launch_bbj_reporting_winners
    WHERE pool_id = p_pool_id AND COALESCE(kind, 'main') = 'main'
  ),
  mini AS (
    SELECT
      COUNT(*) AS n,
      COALESCE(SUM(total_payout), 0) AS paid,
      COUNT(*) FILTER (WHERE awarded_at > now() - interval '30 days') AS n30,
      COALESCE(SUM(total_payout) FILTER (WHERE awarded_at > now() - interval '30 days'), 0) AS paid30,
      MAX(awarded_at) AS last_at
    FROM public.ca_launch_bbj_reporting_winners WHERE pool_id = p_pool_id AND kind = 'mini'
  ),
  parked AS (
    SELECT public.fn_bbj_parked_reserve(p_pool_id, 'backup') AS amt
  )
  SELECT
    p.main_balance,
    p.backup_balance,
    p.promo_balance,
    c.c24, c.c7, c.c30,
    c.h24, c.h7,
    c.call_time,
    h.n, h.paid, h.biggest, h.last_at,
    CASE WHEN h.n > 1
      THEN ROUND(EXTRACT(EPOCH FROM (h.last_at - h.first_at)) / 86400.0 / (h.n - 1), 2)
      ELSE NULL END,
    CASE WHEN h.last_at IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (now() - h.last_at)) / 86400.0, 2)
      ELSE NULL END,
    ROUND(c.call_time - h.paid, 2),
    EXISTS (SELECT 1 FROM public.bbj_mini_tiers t WHERE t.enabled),
    m.n, m.paid, m.n30, m.paid30, m.last_at,
    p.reserve_floor,
    pk.amt,
    GREATEST(0, COALESCE(p.backup_balance, 0) - pk.amt - p.reserve_floor),
    c.h30,
    mo.n,
    mo.paid,
    CASE WHEN mo.n > 1
      THEN ROUND(EXTRACT(EPOCH FROM (mo.last_at - mo.first_at)) / 86400.0 / (mo.n - 1), 2)
      ELSE NULL END,
    mo.last_at,
    CASE WHEN mo.last_at IS NOT NULL
      THEN ROUND(EXTRACT(EPOCH FROM (now() - mo.last_at)) / 86400.0, 2)
      ELSE NULL END
  FROM pool p, contrib c, hits h, mini m, main_only mo, parked pk;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_bbj_analytics(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_bbj_analytics(uuid) TO authenticated, service_role;

-- 3. ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ca_public_arena_record_separated(p_target_user uuid, p_game_mode text DEFAULT 'cash'::text, p_asset text DEFAULT 'chips'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'arena record requires authentication' USING ERRCODE='42501'; END IF;
 IF p_target_user IS NULL OR p_game_mode IS NULL OR p_game_mode NOT IN ('cash','tournament')
 OR p_asset IS NULL OR p_asset NOT IN ('chips','diamonds')
 THEN RAISE EXCEPTION 'invalid arena record scope' USING ERRCODE='22023'; END IF;
 -- HANDS FROM THE DAILY ROLLUP (2026-11-26). club_member_daily_facts is the
 -- trigger-maintained per-day sum of ca_hand_facts (hands, vpip_hands,
 -- pfr_hands, is_mtt = tournament hand), so summing it per club gives the
 -- same counts without reading every hand a player ever played (over 40 s
 -- for a heavy player; 6 timeouts on 2026-11-26).
 RETURN (WITH hands AS (
  SELECT d.club_id,sum(d.hands)::numeric hands_played,
   sum(d.vpip_hands)::numeric/sum(d.hands)*100 vpip,
   sum(d.pfr_hands)::numeric/sum(d.hands)*100 pfr
  FROM public.club_member_daily_facts d JOIN public.clubs c ON c.id=d.club_id
  WHERE d.user_id=p_target_user AND coalesce(c.asset,'chips')=p_asset
   AND d.is_mtt=(p_game_mode='tournament') GROUP BY d.club_id HAVING sum(d.hands)>0
 ), events AS (
  SELECT coalesce(tp.club_id,t.club_id) club_id,count(*)::numeric tournaments_played,
   count(*) FILTER(WHERE tp.position=1 OR tp.status='winner')::numeric tournaments_won
  FROM public.tournament_players tp JOIN public.tournaments t ON t.id=tp.tournament_id
  JOIN public.clubs c ON c.id=coalesce(tp.club_id,t.club_id)
  WHERE p_game_mode='tournament' AND tp.user_id=p_target_user
   AND coalesce(c.asset,'chips')=p_asset AND upper(coalesce(t.status,''))='COMPLETED'
   AND t.ended_at IS NOT NULL GROUP BY coalesce(tp.club_id,t.club_id)
 ), records AS (
  SELECT coalesce(h.hands_played,0) hands_played,coalesce(h.vpip,0) vpip,coalesce(h.pfr,0) pfr,
   coalesce(e.tournaments_played,0) tournaments_played,coalesce(e.tournaments_won,0) tournaments_won
  FROM hands h FULL JOIN events e USING(club_id)
 ) SELECT jsonb_build_object('contract_version',2,'scope',jsonb_build_object(
   'target_user_id',p_target_user,'game_mode',p_game_mode,'asset',p_asset,'visibility','public'),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY hands_played DESC) FROM records r),'[]'::jsonb),
   'coverage',jsonb_build_object('source','ca_hand_facts','unclassified_history_included',false)));
END;$function$;

REVOKE ALL ON FUNCTION public.ca_public_arena_record_separated(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_public_arena_record_separated(uuid, text, text) TO authenticated, service_role;

-- 4. ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_game_management_feed(p_scope_kind text, p_scope_id uuid, p_limit integer DEFAULT 128)
 RETURNS TABLE(sequence bigint, event_type text, scope_kind text, scope_id uuid, club_id uuid, entity_type text, entity_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 128), 1), 128);
BEGIN
  -- THE BOARD'S FEED, AUTHORIZED ONCE (2026-11-26). Exactly the rows the
  -- game_management_events_authorized_read policy shows the caller for one
  -- scope: all of them to an operator of that scope (fn_can_create_games for
  -- a club, fn_is_union_operator for a union), otherwise only the caller's
  -- own (recipient_id). Reading the table through that policy evaluated the
  -- functions per row and, for a non-operator, walked the whole scope
  -- looking for 128 visible rows (over 20 s; 13 timeouts on 2026-11-26).
  IF v_uid IS NULL OR p_scope_id IS NULL OR p_scope_kind IS NULL
     OR p_scope_kind NOT IN ('club', 'union') THEN
    RETURN;
  END IF;

  IF (p_scope_kind = 'club' AND public.fn_can_create_games(p_scope_id, v_uid))
     OR (p_scope_kind = 'union' AND public.fn_is_union_operator(p_scope_id, v_uid)) THEN
    RETURN QUERY
      SELECT e.sequence, e.event_type, e.scope_kind, e.scope_id, e.club_id, e.entity_type, e.entity_id
        FROM public.game_management_events e
       WHERE e.scope_id = p_scope_id AND e.scope_kind = p_scope_kind
       ORDER BY e.sequence DESC
       LIMIT v_limit;
  ELSE
    RETURN QUERY
      SELECT e.sequence, e.event_type, e.scope_kind, e.scope_id, e.club_id, e.entity_type, e.entity_id
        FROM public.game_management_events e
       WHERE e.recipient_id = v_uid
         AND e.scope_id = p_scope_id AND e.scope_kind = p_scope_kind
       ORDER BY e.sequence DESC
       LIMIT v_limit;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_game_management_feed(text, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_game_management_feed(text, uuid, integer) TO authenticated, service_role;

-- PROBES: each changed definer function runs once before COMMIT and is undone
-- (scripts/ci/migration-function-probes.mjs).

-- @probe-for: public.fn_settler_lag_check
DO $probe$
DECLARE
  v jsonb;
BEGIN
  v := public.fn_settler_lag_check();
  IF jsonb_typeof(v) <> 'object' OR NOT (v ? 'healthy') THEN
    RAISE EXCEPTION 'settler lag probe returned %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_bbj_analytics
DO $probe$
DECLARE
  v_pool uuid;
  v_uid  uuid;
  v_rows integer := 0;
  v_all  numeric;
BEGIN
  -- The busiest pool and one of its admins, when the database has one; a
  -- schema-only rehearsal database has none, and then there is nothing to read.
  SELECT bp.id, cm.user_id INTO v_pool, v_uid
    FROM public.bbj_pools bp
    JOIN public.clubs c ON c.id = bp.club_id OR (bp.club_id IS NULL AND c.union_id = bp.union_id)
    JOIN public.club_members cm ON cm.club_id = c.id
     AND cm.role IN ('owner','co_owner','admin','manager')
     AND COALESCE(cm.status, 'active') = 'active'
   ORDER BY (SELECT count(*) FROM public.bbj_pool_contribution_hours h WHERE h.pool_id = bp.id) DESC, bp.id
   LIMIT 1;
  IF v_pool IS NOT NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
    PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    SELECT count(*), max(a.total_contributed_all_time) INTO v_rows, v_all
      FROM public.fn_bbj_analytics(v_pool) a;
    IF v_rows <> 1 OR v_all IS NULL THEN
      RAISE EXCEPTION 'bbj analytics probe returned % rows, all-time %', v_rows, v_all;
    END IF;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.ca_public_arena_record_separated
DO $probe$
DECLARE
  v_uid uuid := gen_random_uuid();
  v     jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v := public.ca_public_arena_record_separated(v_uid, 'cash', 'chips');
  IF (v->>'contract_version') <> '2' OR jsonb_typeof(v->'rows') <> 'array'
     OR (v->'coverage'->>'source') <> 'ca_hand_facts' THEN
    RAISE EXCEPTION 'arena record probe returned %', v;
  END IF;
  v := public.ca_public_arena_record_separated(v_uid, 'tournament', 'chips');
  IF jsonb_typeof(v->'rows') <> 'array' THEN
    RAISE EXCEPTION 'arena record tournament probe returned %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_game_management_feed
DO $probe$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_n   integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  -- A stranger to the scope sees only their own events: none.
  SELECT count(*) INTO v_n FROM public.fn_game_management_feed('club', gen_random_uuid(), 128);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'management feed probe showed a stranger % rows', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.fn_game_management_feed('union', gen_random_uuid(), 128);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'management feed union probe showed a stranger % rows', v_n;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
