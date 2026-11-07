-- 20261107125004_leaderboard_scalar_extrema_stop_at_first_eligible_date
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 12:50:04 UTC.
--
-- Root cause of the post-deploy Leaderboards failure (run 42349055319,
-- "[LeaderboardService.getClubLeaderboard_v2] canceling statement due to
-- statement timeout"). 20261107084902 bounded the three union-scope date
-- lookups; the three SCALAR lookups at the top of fn_club_leaderboard_period_v2
-- and the three in fn_club_leaderboard_by_dates still asked
-- max()/min(snapshot_date) of the filtered view. The view's anti-joins defeat
-- PostgreSQL's min/max optimization, so the planner walked the whole club
-- through player_stats_snapshots_pkey (user_id first) and filtered every row:
-- measured on production, KINGS CLUB max() through the view = 3,999 ms; the
-- same answer as ORDER BY snapshot_date DESC LIMIT 1 = 36 ms (backward scan of
-- idx_pss_club_date_user_measures, stopping at the first eligible row). Two
-- such lookups per call exceed the 8 s authenticated statement_timeout.
--
-- Same view, same filter, same answer: snapshot_date is NOT NULL (primary key),
-- so the first row in date order is exactly max()/min(), and a club with no
-- eligible row still leaves the variable NULL (SELECT INTO with no row).
-- Ranking, attribution, roles, owner, ACL, volatility and search_path are
-- untouched. Read-only production comparison of the rewritten copies (pg_temp)
-- against the live functions returned zero differing rows; see the changelog.
-- @live-proof: md5(pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure)) = '3a785f72cee6dee70a792d4dcb9a13e2'
BEGIN;
SET LOCAL lock_timeout = '250ms';
DO $patch$
DECLARE
  v_def text;
  v_pold1 constant text := $pold1$SELECT max(snapshot_date) INTO v_baseline
      FROM public.ca_stats_player_stats_snapshots_real
     WHERE club_id = p_club_id AND snapshot_date <= v_period_start;$pold1$;
  v_pnew1 constant text := $pnew1$SELECT snapshot_date INTO v_baseline
      FROM public.ca_stats_player_stats_snapshots_real
     WHERE club_id = p_club_id AND snapshot_date <= v_period_start ORDER BY snapshot_date DESC LIMIT 1;$pnew1$;
  v_pold2 constant text := $pold2$SELECT min(snapshot_date) INTO v_baseline
        FROM public.ca_stats_player_stats_snapshots_real WHERE club_id = p_club_id;$pold2$;
  v_pnew2 constant text := $pnew2$SELECT snapshot_date INTO v_baseline
        FROM public.ca_stats_player_stats_snapshots_real WHERE club_id = p_club_id ORDER BY snapshot_date ASC LIMIT 1;$pnew2$;
  v_pold3 constant text := $pold3$SELECT max(snapshot_date) INTO v_prev_end
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1;$pold3$;
  v_pnew3 constant text := $pnew3$SELECT snapshot_date INTO v_prev_end
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 1 ORDER BY snapshot_date DESC LIMIT 1;$pnew3$;
  v_dold1 constant text := $dold1$SELECT max(snapshot_date) INTO v_baseline
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= v_start;$dold1$;
  v_dnew1 constant text := $dnew1$SELECT snapshot_date INTO v_baseline
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= v_start ORDER BY snapshot_date DESC LIMIT 1;$dnew1$;
  v_dold2 constant text := $dold2$SELECT max(snapshot_date) INTO v_end_snap
      FROM public.ca_stats_player_stats_snapshots_real
     WHERE club_id = p_club_id AND snapshot_date <= v_end;$dold2$;
  v_dnew2 constant text := $dnew2$SELECT snapshot_date INTO v_end_snap
      FROM public.ca_stats_player_stats_snapshots_real
     WHERE club_id = p_club_id AND snapshot_date <= v_end ORDER BY snapshot_date DESC LIMIT 1;$dnew2$;
  v_dold3 constant text := $dold3$SELECT max(snapshot_date) INTO v_prev_start
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= v_start - v_span;$dold3$;
  v_dnew3 constant text := $dnew3$SELECT snapshot_date INTO v_prev_start
    FROM public.ca_stats_player_stats_snapshots_real
   WHERE club_id = p_club_id AND snapshot_date <= v_start - v_span ORDER BY snapshot_date DESC LIMIT 1;$dnew3$;
BEGIN
  v_def := pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure);
  IF md5(v_def) IS DISTINCT FROM '1aafb566857b993ba7b51c6cf19814cc' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_PREIMAGE % moved: %', 'p', md5(v_def);
  END IF;
  IF (length(v_def)-length(replace(v_def,v_pold1,'')))/length(v_pold1) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR p1 moved';
  END IF;
  v_def := replace(v_def,v_pold1,v_pnew1);
  IF (length(v_def)-length(replace(v_def,v_pold2,'')))/length(v_pold2) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR p2 moved';
  END IF;
  v_def := replace(v_def,v_pold2,v_pnew2);
  IF (length(v_def)-length(replace(v_def,v_pold3,'')))/length(v_pold3) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR p3 moved';
  END IF;
  v_def := replace(v_def,v_pold3,v_pnew3);
  IF md5(v_def) IS DISTINCT FROM '3a785f72cee6dee70a792d4dcb9a13e2' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_REWRITE % moved: %', 'p', md5(v_def);
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef('public.fn_club_leaderboard_period_v2(uuid,text,text,integer,integer)'::regprocedure)) IS DISTINCT FROM '3a785f72cee6dee70a792d4dcb9a13e2' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_POSTIMAGE % moved', 'p';
  END IF;
  v_def := pg_get_functiondef('public.fn_club_leaderboard_by_dates(uuid,text,date,date,integer,integer)'::regprocedure);
  IF md5(v_def) IS DISTINCT FROM 'c8d939f6f8612a91f98a7f997c15f048' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_PREIMAGE % moved: %', 'd', md5(v_def);
  END IF;
  IF (length(v_def)-length(replace(v_def,v_dold1,'')))/length(v_dold1) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR d1 moved';
  END IF;
  v_def := replace(v_def,v_dold1,v_dnew1);
  IF (length(v_def)-length(replace(v_def,v_dold2,'')))/length(v_dold2) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR d2 moved';
  END IF;
  v_def := replace(v_def,v_dold2,v_dnew2);
  IF (length(v_def)-length(replace(v_def,v_dold3,'')))/length(v_dold3) <> 1 THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_ANCHOR d3 moved';
  END IF;
  v_def := replace(v_def,v_dold3,v_dnew3);
  IF md5(v_def) IS DISTINCT FROM '9162b850276ce59bc83c5ad598687eeb' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_REWRITE % moved: %', 'd', md5(v_def);
  END IF;
  EXECUTE v_def;
  IF md5(pg_get_functiondef('public.fn_club_leaderboard_by_dates(uuid,text,date,date,integer,integer)'::regprocedure)) IS DISTINCT FROM '9162b850276ce59bc83c5ad598687eeb' THEN
    RAISE EXCEPTION 'LEADERBOARD_SCALAR_EXTREMA_POSTIMAGE % moved', 'd';
  END IF;
END
$patch$;
COMMIT;
