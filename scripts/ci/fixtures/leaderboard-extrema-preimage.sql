CREATE OR REPLACE FUNCTION public.fn_club_leaderboard_period_v2(p_club_id uuid, p_metric text DEFAULT 'profit'::text, p_period text DEFAULT 'weekly'::text, p_limit integer DEFAULT 10, p_offset integer DEFAULT 0)
 RETURNS TABLE(user_id uuid, hands_played numeric, total_winnings numeric, total_losses numeric, tournaments_won numeric, total_rake numeric, sum_big_blind numeric, rank_change integer, qualified boolean, rank integer, total_ranked integer, baseline_date date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_start date;
  v_baseline date;
  v_prev_end date;
  v_min_hands integer := 20;
  v_is_all_time boolean := p_period = 'all_time';
  v_union uuid;
BEGIN
  SELECT bounds.start_date INTO v_period_start
    FROM public.fn_leaderboard_period_window(p_period, 0) bounds;

  IF NOT v_is_all_time THEN
    SELECT max(snapshot_date) INTO v_baseline
      FROM public.ca_stats_player_stats_snapshots_real
     WHERE club_id = p_club_id AND snapshot_date <= v_period_start;
    IF v_baseline IS NULL THEN
      SELECT min(snapshot_date) INTO v_baseline
        FROM public.ca_stats_player_stats_snapshots_real WHERE club_id = p_club_id;
    END IF;
  END IF;

  SELECT max(snapshot_date) INTO v_prev_end
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1;

  -- A union member's open-period play is projected under the union's shared
  -- tables, not under the member club (2026-10-17). Rank the club's own
  -- players (the Players page's home attribution) on their play across the
  -- union's physical scope. All Time keeps the club's own rows.
  SELECT uc.union_id INTO v_union FROM public.union_clubs uc
   WHERE uc.club_id = p_club_id LIMIT 1;

  RETURN QUERY
  WITH att_club AS MATERIALIZED (
    SELECT a.user_id FROM (
      SELECT DISTINCT ON(cm.user_id) cm.user_id,cm.club_id
        FROM public.club_members cm JOIN public.union_clubs uc
          ON uc.club_id=cm.club_id AND uc.union_id=v_union
       WHERE v_union IS NOT NULL AND NOT v_is_all_time
       ORDER BY cm.user_id,cm.joined_at ASC NULLS LAST,cm.club_id) a
     WHERE public.fn_ca_stats_home_club(a.user_id, a.club_id)=p_club_id
  ), union_scope AS MATERIALIZED (
    SELECT hc.club_id,
           COALESCE(
             (SELECT max(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id AND s.snapshot_date <= v_period_start),
             (SELECT min(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id)) AS baseline,
           (SELECT max(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
             WHERE s.club_id = hc.club_id
               AND s.snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1) AS prev_end
      FROM (
        SELECT v_union AS club_id WHERE v_union IS NOT NULL AND NOT v_is_all_time
        UNION
        SELECT uc.club_id FROM public.union_clubs uc
         WHERE v_union IS NOT NULL AND NOT v_is_all_time AND uc.union_id = v_union
      ) hc
  ), union_rows AS (
    SELECT ps.user_id AS uid,
           GREATEST(ps.hands_dealt-COALESCE(b.hands_dealt,0),0)::numeric AS d_hands,
           (ps.total_winnings-COALESCE(b.total_winnings,0)) AS d_win,
           (ps.total_losses-COALESCE(b.total_losses,0)) AS d_loss,
           GREATEST(ps.tournaments_won-COALESCE(b.tournaments_won,0),0)::numeric AS d_twon,
           GREATEST(ps.total_rake-COALESCE(b.total_rake,0),0) AS d_rake,
           GREATEST(ps.sum_big_blind-COALESCE(b.sum_big_blind,0),0) AS d_bb,
           (CASE WHEN pe.user_id IS NULL OR sc.prev_end <= sc.baseline THEN NULL ELSE GREATEST(pe.hands_dealt-COALESCE(pv.hands_dealt,0),0)::numeric END) AS p_hands,
           (CASE WHEN pe.user_id IS NULL OR sc.prev_end <= sc.baseline THEN NULL ELSE (pe.total_winnings-COALESCE(pv.total_winnings,0)) END) AS p_win,
           (CASE WHEN pe.user_id IS NULL OR sc.prev_end <= sc.baseline THEN NULL ELSE (pe.total_losses-COALESCE(pv.total_losses,0)) END) AS p_loss,
           (CASE WHEN pe.user_id IS NULL OR sc.prev_end <= sc.baseline THEN NULL ELSE GREATEST(pe.tournaments_won-COALESCE(pv.tournaments_won,0),0)::numeric END) AS p_twon,
           (CASE WHEN pe.user_id IS NULL OR sc.prev_end <= sc.baseline THEN NULL ELSE GREATEST(pe.sum_big_blind-COALESCE(pv.sum_big_blind,0),0) END) AS p_bb
      FROM union_scope sc
      JOIN public.player_stats ps ON ps.club_id = sc.club_id
      JOIN att_club a ON a.user_id = ps.user_id
      LEFT JOIN public.player_stats_snapshots b
        ON b.user_id=ps.user_id AND b.club_id=ps.club_id AND b.snapshot_date=sc.baseline
      LEFT JOIN public.player_stats_snapshots pe
        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=sc.prev_end
      LEFT JOIN public.player_stats_snapshots pv
        ON pv.user_id=ps.user_id AND pv.club_id=ps.club_id AND pv.snapshot_date=sc.baseline
  ), cur AS (
    SELECT u.uid,
           sum(u.d_hands) AS d_hands, sum(u.d_win) AS d_win, sum(u.d_loss) AS d_loss,
           sum(u.d_twon) AS d_twon, sum(u.d_rake) AS d_rake, sum(u.d_bb) AS d_bb,
           sum(u.p_hands) AS p_hands, sum(u.p_win) AS p_win, sum(u.p_loss) AS p_loss,
           sum(u.p_twon) AS p_twon, sum(u.p_bb) AS p_bb
      FROM union_rows u
     GROUP BY u.uid
    UNION ALL
    SELECT ps.user_id AS uid,
           (CASE WHEN v_is_all_time THEN ps.hands_dealt::numeric ELSE GREATEST(ps.hands_dealt-COALESCE(b.hands_dealt,0),0)::numeric END) AS d_hands,
           (CASE WHEN v_is_all_time THEN ps.total_winnings ELSE (ps.total_winnings-COALESCE(b.total_winnings,0)) END) AS d_win,
           (CASE WHEN v_is_all_time THEN ps.total_losses ELSE (ps.total_losses-COALESCE(b.total_losses,0)) END) AS d_loss,
           (CASE WHEN v_is_all_time THEN ps.tournaments_won::numeric ELSE GREATEST(ps.tournaments_won-COALESCE(b.tournaments_won,0),0)::numeric END) AS d_twon,
           (CASE WHEN v_is_all_time THEN ps.total_rake ELSE GREATEST(ps.total_rake-COALESCE(b.total_rake,0),0) END) AS d_rake,
           (CASE WHEN v_is_all_time THEN ps.sum_big_blind ELSE GREATEST(ps.sum_big_blind-COALESCE(b.sum_big_blind,0),0) END) AS d_bb,
           (CASE WHEN pe.user_id IS NULL OR (NOT v_is_all_time AND v_prev_end <= v_baseline) THEN NULL ELSE GREATEST(pe.hands_dealt-COALESCE(pv.hands_dealt,0),0)::numeric END) AS p_hands,
           (CASE WHEN pe.user_id IS NULL OR (NOT v_is_all_time AND v_prev_end <= v_baseline) THEN NULL ELSE (pe.total_winnings-COALESCE(pv.total_winnings,0)) END) AS p_win,
           (CASE WHEN pe.user_id IS NULL OR (NOT v_is_all_time AND v_prev_end <= v_baseline) THEN NULL ELSE (pe.total_losses-COALESCE(pv.total_losses,0)) END) AS p_loss,
           (CASE WHEN pe.user_id IS NULL OR (NOT v_is_all_time AND v_prev_end <= v_baseline) THEN NULL ELSE GREATEST(pe.tournaments_won-COALESCE(pv.tournaments_won,0),0)::numeric END) AS p_twon,
           (CASE WHEN pe.user_id IS NULL OR (NOT v_is_all_time AND v_prev_end <= v_baseline) THEN NULL ELSE GREATEST(pe.sum_big_blind-COALESCE(pv.sum_big_blind,0),0) END) AS p_bb
      FROM public.ca_stats_player_stats_lifetime ps
      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime b
        ON NOT v_is_all_time AND b.user_id=ps.user_id AND b.club_id=ps.club_id AND b.snapshot_date=v_baseline
      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime pe
        ON pe.user_id=ps.user_id AND pe.club_id=ps.club_id AND pe.snapshot_date=v_prev_end
      LEFT JOIN public.ca_stats_player_stats_snapshots_lifetime pv
        ON NOT v_is_all_time AND pv.user_id=ps.user_id AND pv.club_id=ps.club_id AND pv.snapshot_date=v_baseline
     WHERE ps.club_id = p_club_id
       AND (v_union IS NULL OR v_is_all_time)
  ),
  scored AS (
    SELECT c.*,
           (CASE p_metric
              WHEN 'hands_played' THEN c.d_hands
              WHEN 'tournaments_won' THEN c.d_twon
              WHEN 'roi' THEN CASE WHEN c.d_loss>0 AND c.d_hands>=v_min_hands THEN (c.d_win-c.d_loss)/c.d_loss END
              WHEN 'bb100' THEN CASE WHEN c.d_bb>0 AND c.d_hands>=v_min_hands THEN 100*(c.d_win-c.d_loss)/c.d_bb END
              ELSE (c.d_win-c.d_loss) END) AS score,
           (CASE p_metric
              WHEN 'hands_played' THEN c.p_hands
              WHEN 'tournaments_won' THEN c.p_twon
              WHEN 'roi' THEN CASE WHEN c.p_loss>0 AND c.p_hands>=v_min_hands THEN (c.p_win-c.p_loss)/c.p_loss END
              WHEN 'bb100' THEN CASE WHEN c.p_bb>0 AND c.p_hands>=v_min_hands THEN 100*(c.p_win-c.p_loss)/c.p_bb END
              ELSE (c.p_win-c.p_loss) END) AS prev_score
      FROM cur c
  ),
  ranked AS (
    SELECT s.*,
           row_number() OVER (ORDER BY s.score DESC NULLS LAST, s.uid) AS rn_now,
           rank() OVER (ORDER BY s.score DESC NULLS LAST) AS rk_now,
           count(*) OVER () AS total_active,
           CASE WHEN s.prev_score IS NULL THEN NULL
                ELSE rank() OVER (ORDER BY s.prev_score DESC NULLS LAST) END AS rk_old
      FROM scored s
     WHERE NOT EXISTS (SELECT 1 FROM public.profiles dp WHERE dp.id = s.uid AND dp.status = 'deleted')
       AND (s.d_hands > 0 OR s.d_twon > 0 OR s.d_win <> 0 OR s.d_loss <> 0)
  )
  SELECT r.uid, r.d_hands, r.d_win, r.d_loss, r.d_twon, r.d_rake, r.d_bb,
         COALESCE((r.rk_old-r.rk_now)::integer,0),
         (p_metric NOT IN ('roi','bb100') OR
          (r.d_hands>=v_min_hands AND (CASE WHEN p_metric='roi' THEN r.d_loss ELSE r.d_bb END)>0)),
         r.rk_now::integer, r.total_active::integer, v_baseline
    FROM ranked r
   ORDER BY r.rn_now
   LIMIT p_limit OFFSET GREATEST(COALESCE(p_offset,0),0);
END;
$function$
