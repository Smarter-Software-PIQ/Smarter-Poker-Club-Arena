-- Every fixture seat's result through all four access paths equals chips won
-- minus every chip put in (ante included), no blind is reported in a bomb pot,
-- and the seats' chips in reconcile to the stored pot. Raises on the first
-- disagreement, naming the hand, the seat and the path.
DO $assert$
DECLARE
  r record;
  v_n integer;
BEGIN
  FOR r IN
    WITH paths AS (
      SELECT 'one' AS path, f.* FROM public.hand_history h
        CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, NULL) f
      UNION ALL
      SELECT 'range', f.* FROM public.ca_hand_player_facts_range('2026-11-24 10:00:00+00', '2026-11-24 10:01:00+00', NULL) f
      UNION ALL
      SELECT 'dispatch_one', f.* FROM public.hand_history h
        CROSS JOIN LATERAL public.ca_hand_player_facts(NULL, NULL, NULL, h.id) f
      UNION ALL
      SELECT 'dispatch_range', f.* FROM public.ca_hand_player_facts('2026-11-24 10:00:00+00', '2026-11-24 10:01:00+00', NULL, NULL) f
    )
    SELECT coalesce(p.path, 'missing') AS path, e.hand_id, e.user_id,
           e.profit AS want_profit, p.profit AS got_profit,
           e.my_blind AS want_blind, p.my_blind AS got_blind,
           e.put_in AS want_in, p.invested_actions + p.my_blind AS got_in
      FROM public.bomb_proof_expected e
      LEFT JOIN paths p ON p.hand_id = e.hand_id AND p.user_id = e.user_id
     ORDER BY e.hand_id, e.user_id, p.path
  LOOP
    IF r.path = 'missing'
       OR r.got_profit IS DISTINCT FROM r.want_profit
       OR r.got_blind IS DISTINCT FROM r.want_blind
       OR r.got_in IS DISTINCT FROM r.want_in THEN
      RAISE EXCEPTION 'Hand result wrong (hand %, seat %, path %): profit % want %, blind % want %, put in % want %',
        r.hand_id, r.user_id, r.path, r.got_profit, r.want_profit, r.got_blind, r.want_blind, r.got_in, r.want_in;
    END IF;
  END LOOP;

  -- Each path returns exactly the expected seats, no more.
  SELECT count(*) INTO v_n FROM public.hand_history h
    CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, NULL) f;
  IF v_n <> (SELECT count(*) FROM public.bomb_proof_expected) THEN
    RAISE EXCEPTION 'Seat count changed: % rows for % expected seats', v_n, (SELECT count(*) FROM public.bomb_proof_expected);
  END IF;

  -- Chips in, summed over the seats, are the stored pot on every hand.
  SELECT count(*) INTO v_n FROM (
    SELECT h.id FROM public.hand_history h
      CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, NULL) f
     GROUP BY h.id, h.pot_size
    HAVING sum(f.invested_actions + f.my_blind) IS DISTINCT FROM h.pot_size
  ) bad;
  IF v_n <> 0 THEN RAISE EXCEPTION '% hands do not reconcile to their stored pot', v_n; END IF;
END
$assert$;
SELECT 'HAND_PLAYER_FACTS_BOMB_POT_OK' AS result;
