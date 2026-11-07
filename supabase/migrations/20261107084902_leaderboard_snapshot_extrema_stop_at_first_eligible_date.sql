-- The filtered snapshot view defeats PostgreSQL's min/max optimization.
-- Read-only plan: 2923ms -> 90ms; EXCEPT ALL both ways: zero differing rows.
-- Existing filtered view, attribution, ranking, roles and errors are preserved.
-- @live-proof: md5(pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure)) = '1aafb566857b993ba7b51c6cf19814cc'
BEGIN;
SET LOCAL lock_timeout = '250ms';
DO $patch$
DECLARE
  v_sig constant regprocedure := 'public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure;
  v_actual text;
  v_old1 constant text := $old1$(SELECT max(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id AND s.snapshot_date <= v_period_start$old1$;
  v_new1 constant text := $new1$(SELECT s.snapshot_date FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id AND s.snapshot_date <= v_period_start ORDER BY s.snapshot_date DESC LIMIT 1$new1$;
  v_old2 constant text := $old2$(SELECT min(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id$old2$;
  v_new2 constant text := $new2$(SELECT s.snapshot_date FROM public.ca_stats_player_stats_snapshots_real s
               WHERE s.club_id = hc.club_id ORDER BY s.snapshot_date ASC LIMIT 1$new2$;
  v_old3 constant text := $old3$(SELECT max(s.snapshot_date) FROM public.ca_stats_player_stats_snapshots_real s
             WHERE s.club_id = hc.club_id
               AND s.snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1$old3$;
  v_new3 constant text := $new3$(SELECT s.snapshot_date FROM public.ca_stats_player_stats_snapshots_real s
             WHERE s.club_id = hc.club_id
               AND s.snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1 ORDER BY s.snapshot_date DESC LIMIT 1$new3$;
BEGIN
  SELECT pg_get_functiondef(v_sig) INTO v_actual;
  IF md5(v_actual) IS DISTINCT FROM 'ffa11689a6f12269f606d091b828e838' THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_PREIMAGE moved: %', md5(v_actual);
  END IF;
  IF (length(v_actual)-length(replace(v_actual,v_old1,'')))/length(v_old1) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_ANCHOR 1 moved';
  END IF;
  v_actual := replace(v_actual,v_old1,v_new1);
  IF (length(v_actual)-length(replace(v_actual,v_old2,'')))/length(v_old2) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_ANCHOR 2 moved';
  END IF;
  v_actual := replace(v_actual,v_old2,v_new2);
  IF (length(v_actual)-length(replace(v_actual,v_old3,'')))/length(v_old3) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_ANCHOR 3 moved';
  END IF;
  v_actual := replace(v_actual,v_old3,v_new3);
  IF md5(v_actual) IS DISTINCT FROM '1aafb566857b993ba7b51c6cf19814cc' THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_REWRITE moved: %', md5(v_actual);
  END IF;
  EXECUTE v_actual;
  SELECT pg_get_functiondef(v_sig) INTO v_actual;
  IF md5(v_actual) IS DISTINCT FROM '1aafb566857b993ba7b51c6cf19814cc' THEN
    RAISE EXCEPTION 'LEADERBOARD_EXTREMA_POSTIMAGE moved: %', md5(v_actual);
  END IF;
END
$patch$;
COMMIT;
