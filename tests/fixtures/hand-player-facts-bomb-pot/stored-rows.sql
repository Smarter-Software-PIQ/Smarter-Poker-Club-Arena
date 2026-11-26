-- What the old readers stored for every fixture seat, as the live projector
-- does, then a frozen copy to compare against after the recompute.
INSERT INTO public.ca_hand_player_stat (user_id, hand_id, created_at, my_blind, invested_actions, won_amt, profit, vpip)
SELECT f.user_id, f.hand_id, f.created_at, f.my_blind, f.invested_actions, f.won_amt, f.profit, f.vpip
  FROM public.hand_history h CROSS JOIN LATERAL public.ca_hand_player_facts_one(h.id, NULL) f
 ORDER BY f.user_id, f.hand_id;
CREATE TABLE public.bomb_proof_stored_before AS TABLE public.ca_hand_player_stat;
-- The old readers really were wrong on every bomb-pot seat but one: the b4
-- winner (no blind seat, the ante returned in the pot it won) cannot show it.
DO $old$ BEGIN
  IF (SELECT count(*) FROM public.ca_hand_player_stat s JOIN public.bomb_proof_expected e USING (user_id, hand_id)
       WHERE s.hand_id::text LIKE '%b_' AND s.profit IS DISTINCT FROM e.profit) < 15 THEN
    RAISE EXCEPTION 'The fixture no longer reproduces the old bomb-pot results';
  END IF;
END $old$;
