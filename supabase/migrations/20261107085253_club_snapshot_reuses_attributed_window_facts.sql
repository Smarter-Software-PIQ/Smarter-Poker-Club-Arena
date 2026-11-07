-- The unfiltered Kings/assigned-club snapshot timed out in its summary reads.
-- It asked for two full screens, including pages it discarded. Aggregate the
-- same attributed facts once for both contiguous windows. Keep the screen
-- reader for every other scope and filter; preserve hands and page selection.
-- @live-proof: position('scoped_games AS MATERIALIZED' IN pg_get_functiondef('public.ca_club_data_snapshot_v2(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.ca_club_data_snapshot_v2(uuid,date,date,text,text,text,integer)'::regprocedure);
  previous text := $old$  v_cur:=public.ca_club_data_screen(p_club_id,v_start,v_end,v_game,v_stakes,v_q,1)->'summary';
  v_prev:=public.ca_club_data_screen(p_club_id,v_pstart,v_pend,v_game,v_stakes,v_q,1)->'summary';$old$;
  replacement text := $new$  IF v_game = 'ALL' AND v_stakes = 'ALL' AND v_q IS NULL
     AND public.fn_ca_club_data_scope(p_club_id) <> 'downline'
     AND (p_club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR EXISTS (
       SELECT 1 FROM public.ca_horse_club_assignments a
        WHERE a.club_id = ANY(public.fn_ca_club_data_clubs(p_club_id)))) THEN
    WITH scoped_games AS MATERIALIZED (
      SELECT d.stat_date >= v_start AS current_window, d.game_id,
             sum(d.fee) FILTER (WHERE d.kind = 'CASH') AS cash_fee,
             sum(d.winnings) FILTER (WHERE d.kind = 'CASH') AS cash_win,
             sum(d.fee) FILTER (WHERE d.kind <> 'CASH') AS tour_fee,
             sum(d.winnings) FILTER (WHERE d.kind <> 'CASH') AS tour_win,
             sum(d.fee) FILTER (WHERE d.kind = 'TOURNAMENT') AS tournament_game_fee,
             sum(d.winnings) FILTER (WHERE d.kind = 'TOURNAMENT') AS tournament_game_win
        FROM public.ca_stats_club_data_fact_ct d
       WHERE d.club_id = ANY(public.fn_ca_club_data_clubs(p_club_id))
         AND d.stat_date BETWEEN v_pstart AND v_end
       GROUP BY 1, d.game_id
    ), felt AS (
      SELECT (s.joined_at AT TIME ZONE 'America/Chicago')::date >= v_start AS current_window,
             s.table_id, sum(s.stack) AS amount
        FROM public.table_seats s
        JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
       WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
         AND coalesce(s.status,'active') <> 'left' AND s.stack > 0
         AND (s.joined_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_pstart AND v_end
         AND coalesce(s.club_id, public.fn_ca_cash_reporting_club(t.union_id,t.club_id,s.user_id))
             = ANY(public.fn_ca_club_data_clubs(p_club_id))
       GROUP BY 1, s.table_id
    ), games AS (
      SELECT coalesce(g.current_window,f.current_window) AS current_window,
             coalesce(g.game_id,f.table_id) AS game_id, f.amount, g.cash_fee,g.cash_win,g.tour_fee,g.tour_win,
             g.tournament_game_fee,g.tournament_game_win, tr.status = 'RUNNING' AS live_tournament,
             tr.tournament_type = 'MTT' AS mtt, coalesce(tr.status IN ('COMPLETED','CANCELLED'),false) AS finished
        FROM scoped_games g
        LEFT JOIN public.tournaments tr ON tr.id = g.game_id
        FULL JOIN felt f ON f.current_window = g.current_window AND f.table_id = g.game_id
    ), totals AS (
      SELECT w.current_window, count(g.game_id) AS games,
             count(g.amount) + count(*) FILTER (WHERE g.live_tournament) AS live_games,
             coalesce(sum(g.amount),0) AS on_felt,
             coalesce(sum(g.cash_fee),0) AS cash_fee, coalesce(sum(g.cash_win),0) AS cash_win,
             coalesce(sum(g.tour_fee),0) AS tour_fee, coalesce(sum(g.tour_win),0) AS tour_win,
             coalesce(sum(g.tournament_game_win) FILTER (WHERE g.mtt AND g.finished),0) AS mtt_win,
             coalesce(sum(g.tournament_game_fee) FILTER (WHERE g.mtt AND g.finished),0) AS mtt_fee,
             coalesce(sum(g.tournament_game_win) FILTER (WHERE g.mtt AND NOT g.finished),0) AS running_win,
             coalesce(sum(g.tournament_game_fee) FILTER (WHERE g.mtt AND NOT g.finished),0) AS running_fee
        FROM (VALUES (true),(false)) w(current_window)
        LEFT JOIN games g ON g.current_window = w.current_window
       GROUP BY w.current_window
    ), summaries AS (
      SELECT current_window, jsonb_build_object(
        'games',games,'live_games',live_games,'on_felt',round(on_felt,2),
        'total_winnings',round(cash_win+tour_win+on_felt,2),'cash_winnings',round(cash_win+on_felt,2),
        'tournament_winnings',round(tour_win,2),'mtt_winnings',round(mtt_win,2),
        'running_mtt_entries',round(running_win,2),'running_mtt_fee',round(running_fee,2),
        'fee',round(cash_fee+tour_fee,2),'cash_fee',round(cash_fee,2),
        'tournament_fee',round(tour_fee,2),'mtt_fee',round(mtt_fee,2)) AS summary
        FROM totals
    )
    SELECT (SELECT summary FROM summaries WHERE current_window),
           (SELECT summary FROM summaries WHERE NOT current_window) INTO v_cur,v_prev;
  ELSE
$new$ || previous || E'\n  END IF;';
BEGIN
  IF strpos(definition,'WITH scoped_games AS MATERIALIZED') > 0 OR
     (length(definition)-length(replace(definition,previous,''))) <> length(previous) THEN
    RAISE EXCEPTION 'Club Data snapshot summary preimage changed; review before installation';
  END IF;
  EXECUTE replace(definition,previous,replacement);
END
$migration$;
COMMIT;
