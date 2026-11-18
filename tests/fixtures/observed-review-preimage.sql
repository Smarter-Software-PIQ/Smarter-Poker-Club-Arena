 SELECT h.* FROM public.hand_history h
 WHERE (SELECT auth.uid()) IS NOT NULL
 AND (p_table_id IS NOT NULL OR cardinality(p_hand_ids) BETWEEN 1 AND 100)
 AND (p_table_id IS NULL OR h.table_id=p_table_id
   OR EXISTS(SELECT 1 FROM public.ca_observed_hands r WHERE r.viewer_id=(SELECT auth.uid())
     AND r.hand_id=h.id AND r.hand_number=h.hand_number AND r.table_id=p_table_id))
 AND (p_hand_ids IS NULL OR h.id=ANY(p_hand_ids[1:100]))
 AND (p_before IS NULL OR h.hand_number<p_before)
 AND (p_game_mode IS NULL OR (p_game_mode='cash' AND h.tournament_id IS NULL)
   OR (p_game_mode='tournament' AND h.tournament_id IS NOT NULL))
 AND (h.players @> jsonb_build_array(jsonb_build_object('userId',(SELECT auth.uid())::text))
   OR EXISTS(SELECT 1 FROM public.ca_observed_hands o WHERE o.viewer_id=(SELECT auth.uid())
     AND o.hand_id=h.id AND o.hand_number=h.hand_number))
 ORDER BY h.hand_number DESC LIMIT greatest(1,least(coalesce(p_limit,50),200))
 OFFSET greatest(0,least(coalesce(p_offset,0),10000));
