-- The union treasury log shows only closed history (verification, 2026-11-02).
--
-- Found while verifying 20261102063939 against production:
--
--   1. A day's "Daily Total Collected" row was listed as soon as ANY hour of
--      that day had been summed. During the October backfill, 2026-10-14
--      showed 15,636.57 from 1 of its 24 hours; and every night between
--      00:00 and 00:15 Chicago the day just ended was listed before its last
--      hour had closed. A partial day must never read as a finished one.
--   2. The 7 and 30 day totals were built from those same partial rows, and
--      nothing told the reader that history was still filling.
--   3. A page could hold at most 200 rows, so the screen's CSV export (which
--      only wrote what was on screen) could not export a whole log.
--
-- The writer (fn_union_treasury_log_tick and its helpers) is unchanged and
-- was verified exact. Only the reader changes:
--
--   * History is the newest gap-free run of closed hours. Its first whole
--     Chicago day is "complete from"; nothing older is listed or summed, and
--     "filling" stays true until that run reaches the backfill floor.
--   * A daily row is listed only once its whole day lies inside that run.
--   * Totals are the hourly bricks of closed hours + itemized rows + a live
--     read since the last closed hour of collection and of any out or
--     one-off in the 5-minute tick has not copied yet, each counted once. Today, 7 days and 30 days say whether they are fully covered.
--   * A page may hold up to 5,000 rows, so an export can page the whole log.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_union_treasury_log(
  p_union_id  uuid,
  p_wallet    text,
  p_kind      text        DEFAULT 'all',     -- all | ins | outs
  p_before    timestamptz DEFAULT NULL,
  p_before_id bigint      DEFAULT NULL,
  p_limit     integer     DEFAULT 50,
  p_category  text        DEFAULT NULL,
  p_search    text        DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor        uuid := auth.uid();
  v_limit        int := least(greatest(coalesce(p_limit, 50), 1), 5000);
  v_today        date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_today_ts     timestamptz := v_today::timestamp AT TIME ZONE 'America/Chicago';
  v_week_ts      timestamptz := (v_today - 6)::timestamp AT TIME ZONE 'America/Chicago';
  v_month_ts     timestamptz := (v_today - 29)::timestamp AT TIME ZONE 'America/Chicago';
  v_floor        timestamptz;
  v_closed_until timestamptz;
  v_cover_start  timestamptz;
  v_from_day     date;
  v_from_ts      timestamptz;
  v_rows         jsonb;
  v_cats         jsonb;
  -- live collection since the last closed hour
  v_live_today   numeric; v_live_today_n bigint; v_live_week numeric; v_live_month numeric;
  v_lout_today   numeric; v_lout_today_n bigint; v_lout_week numeric; v_lout_month numeric;
  v_lin_today    numeric; v_lin_today_n  bigint; v_lin_week  numeric; v_lin_month  numeric;
  -- closed-hour bricks
  v_brk_today    numeric; v_brk_today_n bigint; v_brk_week numeric; v_brk_month numeric;
  -- itemized rows
  v_out_today    numeric; v_out_today_n bigint; v_out_week numeric; v_out_month numeric;
  v_in_today     numeric; v_in_today_n bigint;  v_in_week  numeric; v_in_month  numeric;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role'
     AND NOT public.fn_union_can_manage_wallets(p_union_id, v_actor)
     AND NOT EXISTS (SELECT 1 FROM union_admins ua WHERE ua.union_id = p_union_id AND ua.user_id = v_actor) THEN
    RETURN jsonb_build_object('authorized', false, 'error', 'The Treasury Log Is Restricted To Union Staff');
  END IF;
  IF p_wallet NOT IN ('union_bank','rake_treasury','backup_bbj','main_bbj','promo','spins_treasury') THEN
    RETURN jsonb_build_object('authorized', false, 'error', 'Unknown Union Wallet');
  END IF;

  SELECT backfill_floor INTO v_floor FROM ca_union_treasury_log_state WHERE id = 1;
  SELECT max(hour_start) + interval '1 hour' INTO v_closed_until FROM ca_union_treasury_hours_done;
  -- Start of the newest gap-free run of closed hours.
  SELECT max(h.hour_start) INTO v_cover_start
    FROM (SELECT hour_start, lag(hour_start) OVER (ORDER BY hour_start) AS prev
            FROM ca_union_treasury_hours_done) h
   WHERE h.prev IS NULL OR h.prev <> h.hour_start - interval '1 hour';
  v_closed_until := coalesce(v_closed_until, v_today_ts);
  v_cover_start  := coalesce(v_cover_start, v_closed_until);
  v_from_day := (v_cover_start AT TIME ZONE 'America/Chicago')::date;
  IF (v_from_day::timestamp AT TIME ZONE 'America/Chicago') < v_cover_start THEN
    v_from_day := v_from_day + 1;
  END IF;
  v_from_ts := v_from_day::timestamp AT TIME ZONE 'America/Chicago';

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.occurred_at DESC, r.id DESC), '[]'::jsonb) INTO v_rows
    FROM (
      SELECT t.id, t.entry_kind, t.occurred_at, t.log_day, t.amount, t.category, t.entries,
             t.breakdown, t.counterparty_type, t.counterparty_label, t.counterparty_name,
             t.performed_by_name, t.description, t.balance_after, t.club_name, t.tournament_id
        FROM ca_union_treasury_log t
       WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet
         AND t.occurred_at >= v_from_ts
         AND (t.entry_kind <> 'daily_in'
              OR ((t.log_day + 1)::timestamp AT TIME ZONE 'America/Chicago') <= v_closed_until)
         AND (p_kind = 'all'
              OR (p_kind = 'outs' AND t.entry_kind = 'out')
              OR (p_kind = 'ins'  AND t.entry_kind IN ('in','daily_in')))
         AND (p_category IS NULL OR t.category = p_category)
         AND (p_search IS NULL OR p_search = ''
              OR t.counterparty_name ILIKE '%' || p_search || '%'
              OR t.performed_by_name ILIKE '%' || p_search || '%'
              OR t.description       ILIKE '%' || p_search || '%'
              OR t.club_name         ILIKE '%' || p_search || '%')
         AND (p_before IS NULL
              OR t.occurred_at < p_before
              OR (t.occurred_at = p_before AND t.id < coalesce(p_before_id, 9223372036854775807)))
       ORDER BY t.occurred_at DESC, t.id DESC
       LIMIT v_limit
    ) r;

  -- Since the last closed hour, read live from the ledger: all collection,
  -- plus any out or one-off in the 5-minute tick has not copied yet, so the
  -- totals are current to the second (the itemized list follows on the tick).
  SELECT coalesce(sum(g.amount) FILTER (WHERE g.coll AND g.created_at >= v_today_ts), 0),
         count(*)               FILTER (WHERE g.coll AND g.created_at >= v_today_ts),
         coalesce(sum(g.amount) FILTER (WHERE g.coll AND g.created_at >= greatest(v_week_ts,  v_from_ts)), 0),
         coalesce(sum(g.amount) FILTER (WHERE g.coll AND g.created_at >= greatest(v_month_ts, v_from_ts)), 0),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'out' AND g.created_at >= v_today_ts), 0),
         count(*)               FILTER (WHERE g.side = 'out' AND g.created_at >= v_today_ts),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'out' AND g.created_at >= greatest(v_week_ts,  v_from_ts)), 0),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'out' AND g.created_at >= greatest(v_month_ts, v_from_ts)), 0),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'in' AND NOT g.coll AND g.created_at >= v_today_ts), 0),
         count(*)               FILTER (WHERE g.side = 'in' AND NOT g.coll AND g.created_at >= v_today_ts),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'in' AND NOT g.coll AND g.created_at >= greatest(v_week_ts,  v_from_ts)), 0),
         coalesce(sum(g.amount) FILTER (WHERE g.side = 'in' AND NOT g.coll AND g.created_at >= greatest(v_month_ts, v_from_ts)), 0)
    INTO v_live_today, v_live_today_n, v_live_week, v_live_month,
         v_lout_today, v_lout_today_n, v_lout_week, v_lout_month,
         v_lin_today,  v_lin_today_n,  v_lin_week,  v_lin_month
    FROM (
      SELECT l.created_at, l.amount, l.side,
             (l.side = 'in' AND fn_union_treasury_is_collection(l.category)) AS coll
        FROM fn_union_treasury_legs(v_closed_until, now()) l
       WHERE l.union_id = p_union_id AND l.wallet_key = p_wallet
         AND ((l.side = 'in' AND fn_union_treasury_is_collection(l.category))
              OR NOT EXISTS (SELECT 1 FROM ca_union_treasury_log c
                              WHERE c.source_ledger_id = l.ledger_id
                                AND c.wallet_key = p_wallet
                                AND c.entry_kind = l.side))
    ) g;

  -- Collection in closed hours.
  SELECT coalesce(sum(h.amount)  FILTER (WHERE h.hour_start >= v_today_ts), 0),
         coalesce(sum(h.entries) FILTER (WHERE h.hour_start >= v_today_ts), 0),
         coalesce(sum(h.amount)  FILTER (WHERE h.hour_start >= greatest(v_week_ts, v_from_ts)), 0),
         coalesce(sum(h.amount), 0)
    INTO v_brk_today, v_brk_today_n, v_brk_week, v_brk_month
    FROM ca_union_treasury_hourly_ins h
   WHERE h.union_id = p_union_id AND h.wallet_key = p_wallet
     AND h.hour_start >= greatest(v_month_ts, v_from_ts)
     AND h.hour_start <  v_closed_until;

  -- Itemized outs and one-off ins.
  SELECT coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'out' AND t.occurred_at >= v_today_ts), 0),
         count(*)               FILTER (WHERE t.entry_kind = 'out' AND t.occurred_at >= v_today_ts),
         coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'out' AND t.occurred_at >= greatest(v_week_ts, v_from_ts)), 0),
         coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'out'), 0),
         coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'in'  AND t.occurred_at >= v_today_ts), 0),
         count(*)               FILTER (WHERE t.entry_kind = 'in'  AND t.occurred_at >= v_today_ts),
         coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'in'  AND t.occurred_at >= greatest(v_week_ts, v_from_ts)), 0),
         coalesce(sum(t.amount) FILTER (WHERE t.entry_kind = 'in'), 0)
    INTO v_out_today, v_out_today_n, v_out_week, v_out_month,
         v_in_today,  v_in_today_n,  v_in_week,  v_in_month
    FROM ca_union_treasury_log t
   WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet
     AND t.entry_kind IN ('out','in')
     AND t.occurred_at >= greatest(v_month_ts, v_from_ts);

  SELECT coalesce(jsonb_agg(DISTINCT t.category), '[]'::jsonb) INTO v_cats
    FROM ca_union_treasury_log t
   WHERE t.union_id = p_union_id AND t.wallet_key = p_wallet AND t.entry_kind = 'out'
     AND t.occurred_at >= greatest(v_from_ts, (v_today - 89)::timestamp AT TIME ZONE 'America/Chicago');

  RETURN jsonb_build_object(
    'authorized', true, 'wallet', p_wallet, 'rows', v_rows,
    'has_more', jsonb_array_length(v_rows) = v_limit,
    'summary', jsonb_build_object(
      'today_in', jsonb_build_object(
        'amount',  v_brk_today + v_live_today + v_in_today + v_lin_today,
        'entries', v_brk_today_n + v_live_today_n + v_in_today_n + v_lin_today_n,
        'as_of',   now()),
      'today_out', v_out_today + v_lout_today, 'today_out_count', v_out_today_n + v_lout_today_n,
      'week_in',  v_brk_week + v_live_week + v_in_week + v_lin_week,     'week_out',  v_out_week + v_lout_week,
      'month_in', v_brk_month + v_live_month + v_in_month + v_lin_month, 'month_out', v_out_month + v_lout_month,
      'week_complete',  v_week_ts  >= v_from_ts,
      'month_complete', v_month_ts >= v_from_ts),
    'out_categories', v_cats,
    'history', jsonb_build_object(
      'complete_from',  v_from_day,
      'closed_through', v_closed_until,
      'filling',        v_cover_start > v_floor,
      'logged_since',   v_floor),
    'last_tick_at', (SELECT last_tick_at FROM ca_union_treasury_log_state WHERE id = 1));
END $$;

REVOKE ALL ON FUNCTION public.fn_union_treasury_log(uuid, text, text, timestamptz, bigint, integer, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.fn_union_treasury_log(uuid, text, text, timestamptz, bigint, integer, text, text) TO authenticated, service_role;

COMMIT;
