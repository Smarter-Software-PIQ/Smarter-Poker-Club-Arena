-- 20261106074830_club_data_selectable_ranges_and_player_totals.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- Chicago-day drilldown from the same attributed facts and live cash seats as Club Data.
-- Read-only: no ledger, wallet, commission or settlement changes.
-- @live-proof: to_regprocedure('public.ca_club_data_player_totals(uuid,date,date,text,text,text)') IS NOT NULL
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION public.ca_club_data_player_totals(
  p_club_id uuid, p_start date, p_end date, p_game text DEFAULT 'ALL',
  p_stakes text DEFAULT 'ALL', p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET work_mem = '64MB' AS $function$
DECLARE
  v_scope text := public.fn_ca_club_data_scope(p_club_id);
  v_users uuid[];
  v_clubs uuid[];
  v_game text := upper(coalesce(nullif(p_game,''),'ALL'));
  v_stakes text := upper(coalesce(nullif(p_stakes,''),'ALL'));
  v_search text := nullif(btrim(coalesce(p_search,'')),'');
  v_result jsonb;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'not authorized for this club' USING ERRCODE='42501'; END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_start > p_end OR p_end > (now() AT TIME ZONE 'America/Chicago')::date OR p_end-p_start > 92 THEN
    RAISE EXCEPTION 'invalid Chicago date range' USING ERRCODE='22023';
  END IF;
  IF v_game NOT IN ('ALL','HOLDEM','OMAHA','MIXED','MTT','SNG') OR v_stakes NOT IN ('ALL','MICRO','SMALL','MID','HIGH') THEN
    RAISE EXCEPTION 'invalid game filters' USING ERRCODE='22023';
  END IF;
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);
  IF v_scope='downline' THEN v_users := public.fn_ca_club_data_downline(p_club_id,auth.uid()); END IF;
  WITH facts AS MATERIALIZED (
    SELECT d.kind,d.game_id,d.user_id,sum(d.winnings) winnings,sum(d.fee) fee
    FROM public.ca_stats_club_data_fact_ct d
    WHERE d.club_id=ANY(v_clubs) AND d.stat_date BETWEEN p_start AND p_end
      AND (v_users IS NULL OR d.user_id=ANY(v_users))
    GROUP BY d.kind,d.game_id,d.user_id
  ), felt AS (
    SELECT 'CASH'::text kind,s.table_id game_id,s.user_id,sum(s.stack) winnings,0::numeric fee
    FROM public.table_seats s JOIN public.tables t ON t.id=s.table_id AND t.tournament_id IS NULL
    WHERE s.left_at IS NULL AND s.user_id IS NOT NULL AND coalesce(s.status,'active')<>'left' AND coalesce(s.stack,0)>0
      AND (s.joined_at AT TIME ZONE 'America/Chicago')::date BETWEEN p_start AND p_end
      AND coalesce(s.club_id,public.fn_ca_cash_reporting_club(t.union_id,t.club_id,s.user_id))=ANY(v_clubs)
      AND (v_users IS NULL OR s.user_id=ANY(v_users))
    GROUP BY s.table_id,s.user_id
  ), movements AS (
    SELECT * FROM facts UNION ALL SELECT * FROM felt
  ), described AS (
    SELECT d.*,
      CASE WHEN d.kind='CASH' THEN
        CASE WHEN coalesce(t.game_variant,'') ILIKE '%plo%' OR coalesce(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
          WHEN coalesce(t.game_variant,'') ILIKE '%mixed%' OR coalesce(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED' ELSE 'HOLDEM' END
        ELSE tr.tournament_type END game_class,
      CASE WHEN coalesce(t.big_blind,0)<1 THEN 'MICRO' WHEN t.big_blind<5 THEN 'SMALL' WHEN t.big_blind<25 THEN 'MID' ELSE 'HIGH' END stakes_tier,
      CASE WHEN d.kind='CASH' THEN coalesce(t.name,'Unnamed') ELSE coalesce(tr.name,'Tournament') END game_name,
      CASE WHEN d.kind='CASH' THEN coalesce(pr.username,'') ELSE '' END creator,
      (d.kind='TOURNAMENT' AND tr.tournament_type='MTT' AND coalesce(tr.status IN ('COMPLETED','CANCELLED'),false)) finished_mtt
    FROM movements d
    LEFT JOIN public.tables t ON d.kind='CASH' AND t.id=d.game_id
    LEFT JOIN public.profiles pr ON pr.id=t.created_by
    LEFT JOIN public.tournaments tr ON d.kind='TOURNAMENT' AND tr.id=d.game_id
  ), filtered AS (
    SELECT * FROM described d
    WHERE (v_game='ALL' OR d.game_class=v_game)
      AND (v_stakes='ALL' OR (d.kind='CASH' AND d.stakes_tier=v_stakes))
      AND (v_search IS NULL OR d.game_name ILIKE '%'||v_search||'%' OR d.game_id::text ILIKE '%'||v_search||'%'
        OR (d.kind='CASH' AND d.creator ILIKE '%'||v_search||'%'))
  ), players AS (
    SELECT user_id,sum(winnings) total_winnings,
      coalesce(sum(winnings) FILTER (WHERE finished_mtt),0) mtt_winnings,
      sum(fee) fee
    FROM filtered GROUP BY user_id
  )
  SELECT jsonb_build_object('contract','ca_club_data_player_totals.v1','club_id',p_club_id,
    'range',jsonb_build_object('start',p_start,'end',p_end),
    'filters',jsonb_build_object('game',v_game,'stakes',v_stakes,'search',v_search),
    'scope',v_scope,'day_basis','America/Chicago','generated_at',now(),
    'players',coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,
      'name',CASE WHEN p.user_id='00000000-0000-0000-0000-000000000000'::uuid THEN 'Unattributed Fees'
        ELSE coalesce(public.fn_arena_name(pr.alias,pr.username,pr.display_name,pr.first_name,pr.last_name,pr.full_name),'Player') END,
      'total_winnings',p.total_winnings,'mtt_winnings',p.mtt_winnings,'fee',p.fee) ORDER BY p.total_winnings DESC,p.user_id),'[]'::jsonb))
    INTO v_result FROM players p LEFT JOIN public.profiles pr ON pr.id=p.user_id;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.ca_club_data_player_totals(uuid,date,date,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ca_club_data_player_totals(uuid,date,date,text,text,text) TO authenticated,service_role;

-- The summary fast path must respect the same existing club-stat attribution
-- as its rows and this drilldown. Keep the rollup optimization for other clubs.
DO $align$
DECLARE d text; old text := 'IF v_users IS NULL THEN'; new text := $replacement$IF v_users IS NULL AND NOT (
    p_club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR
    EXISTS (SELECT 1 FROM public.ca_horse_club_assignments a WHERE a.club_id=ANY(public.fn_ca_club_data_clubs(p_club_id)))
  ) THEN$replacement$;
BEGIN
  d := pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure);
  IF (length(d)-length(replace(d,old,'')))/length(old) <> 2 THEN
    RAISE EXCEPTION 'Club Data summary fast path changed; review before installation';
  END IF;
  EXECUTE replace(d,old,new);
END $align$;
COMMIT;
