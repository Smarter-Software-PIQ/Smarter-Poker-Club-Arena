-- After 20261124145120: every stored row of a marked bomb pot carries the true result,
-- every ordinary row is untouched, and nothing but the money columns moved.
DO $after$
DECLARE v_n integer;
BEGIN
  -- Rows of a marked bomb pot (hand_history.bomb_pot set, the only bomb pots
  -- production has) carry the true result; b4, marked only by its log, is
  -- outside the recompute's reach and must stay exactly as stored.
  SELECT count(*) INTO v_n FROM public.ca_hand_player_stat s JOIN public.bomb_proof_expected e USING (user_id, hand_id)
   JOIN public.hand_history h ON h.id = s.hand_id AND h.bomb_pot IS NOT NULL
   WHERE s.profit IS DISTINCT FROM e.profit OR s.my_blind IS DISTINCT FROM e.my_blind
      OR s.invested_actions + s.my_blind IS DISTINCT FROM e.put_in;
  IF v_n <> 0 THEN RAISE EXCEPTION '% stored rows still disagree with the true result', v_n; END IF;

  SELECT count(*) INTO v_n FROM (
    (SELECT * FROM public.ca_hand_player_stat s
      WHERE NOT EXISTS (SELECT 1 FROM public.hand_history h WHERE h.id = s.hand_id AND h.bomb_pot IS NOT NULL)
     EXCEPT ALL
     SELECT * FROM public.bomb_proof_stored_before b
      WHERE NOT EXISTS (SELECT 1 FROM public.hand_history h WHERE h.id = b.hand_id AND h.bomb_pot IS NOT NULL))
  ) changed;
  IF v_n <> 0 THEN RAISE EXCEPTION '% rows outside a marked bomb pot changed', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.ca_hand_player_stat s JOIN public.bomb_proof_stored_before b USING (user_id, hand_id)
   WHERE s.created_at IS DISTINCT FROM b.created_at OR s.vpip IS DISTINCT FROM b.vpip OR s.asset IS DISTINCT FROM b.asset;
  IF v_n <> 0 THEN RAISE EXCEPTION '% rows changed a column the recompute must not touch', v_n; END IF;
END
$after$;
SELECT 'BOMB_POT_STAT_RECOMPUTE_OK' AS result;
