-- Read-only Player Menu snapshot, with the same active recursive agent relationship
-- as the downline watch reader, bound to the particular player being inspected.
-- @live-proof: has_function_privilege('authenticated','public.ca_player_menu_cash_stats(uuid,uuid)','execute') AND NOT has_function_privilege('anon','public.ca_player_menu_cash_stats(uuid,uuid)','execute')
BEGIN;
CREATE FUNCTION public.ca_player_menu_cash_stats(p_table_id uuid, p_player_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  viewer uuid := auth.uid();
  result jsonb;
BEGIN
  IF viewer IS NULL OR p_player_id IS NULL OR p_table_id IS NULL THEN RETURN NULL; END IF;
  IF viewer <> '47965354-0e56-43ef-931c-ddaab82af765'::uuid THEN
    IF viewer = p_player_id OR NOT EXISTS (
      WITH RECURSIVE branch(club_id,user_id) AS (
        SELECT club_id,user_id FROM public.club_members
        WHERE user_id=viewer AND role IN ('agent','sub_agent','super_agent')
          AND status IN ('active','approved')
        UNION
        SELECT child.club_id, child.user_id FROM branch parent JOIN public.club_members child
          ON child.club_id=parent.club_id AND child.agent_id=parent.user_id
        WHERE child.status IN ('active','approved')
      ) SELECT 1 FROM branch WHERE user_id=p_player_id
    ) THEN RETURN NULL; END IF;
  END IF;

  WITH seats AS MATERIALIZED (
    SELECT t.id, t.name, t.cluster_id FROM public.table_seats seat
    JOIN public.tables t ON t.id=seat.table_id
    WHERE seat.user_id=p_player_id AND seat.left_at IS NULL AND t.tournament_id IS NULL
      AND NOT coalesce(t.is_deleted,false) AND lower(t.status::text) IN ('waiting','running','active')
  ), sittings AS (
    SELECT t.*, s.opened_at, s.baseline AS bought_in, 'chips' AS unit FROM seats t
    JOIN public.cash_player_session s ON s.player_id=p_player_id AND s.scope_type='table'
      AND s.scope_id=t.id AND s.closed_at IS NULL
    UNION ALL
    SELECT t.*, c.created_at, (SELECT sum(m.amount) FROM public.poker_diamond_movements m
      WHERE m.custody_id=c.id AND m.action='reserve'), 'diamonds' FROM seats t
    JOIN public.poker_diamond_custody c ON c.user_id=p_player_id AND c.target_id=t.id
      AND c.purpose='cash_seat' AND c.state='active'
  )
  SELECT jsonb_agg(jsonb_build_object('tableId',s.id,'table',s.name,'unit',s.unit,'boughtIn',s.bought_in,
    'hands',a.hands,'net',a.net,'vpip',a.vpip,'pfr',a.pfr) ORDER BY (s.id=p_table_id) DESC,s.id)
  INTO result FROM sittings s
  CROSS JOIN LATERAL (
    SELECT count(*) AS hands,
      CASE WHEN count(f.hand_id)=count(*) THEN coalesce(sum(f.net),0) END AS net,
      CASE WHEN count(f.hand_id)=count(*) THEN round(100*avg(f.vpip::int),1) END AS vpip,
      CASE WHEN count(f.hand_id)=count(*) THEN round(100*avg(f.pfr::int),1) END AS pfr
    FROM public.hand_history h JOIN public.tables ht ON ht.id=h.table_id
    LEFT JOIN public.ca_hand_facts f ON f.hand_id=h.id AND f.user_id=p_player_id
      AND f.table_id=h.table_id AND f.tournament_id IS NULL
    WHERE h.created_at>=s.opened_at AND ht.tournament_id IS NULL
      AND (ht.id=s.id OR (s.cluster_id IS NOT NULL AND ht.cluster_id=s.cluster_id))
      AND h.players @> jsonb_build_array(jsonb_build_object('userId',p_player_id::text))
  ) a WHERE EXISTS (SELECT 1 FROM seats WHERE id=p_table_id);
  RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.ca_player_menu_cash_stats(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_player_menu_cash_stats(uuid,uuid) TO authenticated;
COMMIT;
