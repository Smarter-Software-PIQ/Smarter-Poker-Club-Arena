CREATE OR REPLACE FUNCTION public.ca_roll_hand_stats_forward()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '4min'
AS $function$
DECLARE
  v_ceil timestamptz;
  v_start timestamptz;
  v_now timestamptz := now();
  v_deadline timestamptz := clock_timestamp() + interval '100 seconds';
  v_last_hand_at timestamptz;
  v_end timestamptz;
  v_hands int;
  v_total int := 0;
  v_over uuid[];
  v_chunk constant int := 2000;
  v_max_chunks constant int := 12;
  v_i int := 0;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ca_hand_player_stat_background')) THEN
    RETURN 0;
  END IF;

  SELECT rolled_ceil INTO v_ceil
  FROM public.ca_hand_player_stat_state
  WHERE id
  FOR UPDATE;

  IF v_ceil IS NULL OR v_ceil >= v_now THEN RETURN 0; END IF;
  v_start := v_ceil;

  WHILE v_i < v_max_chunks AND clock_timestamp() < v_deadline AND v_ceil < v_now LOOP
    v_i := v_i + 1;

    SELECT max(created_at) INTO v_last_hand_at
    FROM (
      SELECT created_at
      FROM public.hand_history
      WHERE created_at >= v_ceil AND created_at < v_now
      ORDER BY created_at, id
      LIMIT v_chunk
    ) bounded;

    IF v_last_hand_at IS NULL THEN
      v_ceil := v_now;
      EXIT;
    END IF;

    v_end := least(v_now, v_last_hand_at + interval '1 microsecond');

    SELECT count(*) INTO v_hands
    FROM public.hand_history
    WHERE created_at >= v_ceil AND created_at < v_end;

    INSERT INTO public.ca_hand_player_stat (
      user_id, hand_id, created_at, is_cash, tournament_id, game_variant,
      big_blind, small_blind, n_players, seat_position, my_blind, won_amt, is_winner,
      invested_actions, aggro_cnt, call_cnt, vpip, pfr, folded, three_bet,
      three_bet_opp, faced_three_bet, folded_to_three_bet, cbet_opp, cbet_made,
      showdown, hand_secs, profit)
    SELECT
      f.user_id, f.hand_id, f.created_at, f.is_cash, f.tournament_id, f.game_variant,
      f.big_blind, f.small_blind, f.n_players, f.seat_position, f.my_blind, f.won_amt, f.is_winner,
      f.invested_actions, f.aggro_cnt, f.call_cnt, f.vpip, f.pfr, f.folded, f.three_bet,
      f.three_bet_opp, f.faced_three_bet, f.folded_to_three_bet, f.cbet_opp, f.cbet_made,
      f.showdown, f.hand_secs, f.profit
    FROM public.ca_hand_player_facts(v_ceil, v_end) f
    ORDER BY f.user_id, f.hand_id
    ON CONFLICT (user_id, hand_id) DO NOTHING;

    v_total := v_total + coalesce(v_hands, 0);
    v_ceil := v_end;
  END LOOP;

  -- Retention (1,000 rows per player), for every player with a row in the
  -- window this run covered, whoever wrote it.
  SELECT array_agg(user_id) INTO v_over
  FROM (
    SELECT user_id
    FROM public.ca_hand_player_stat
    WHERE user_id IN (SELECT DISTINCT user_id FROM public.ca_hand_player_stat
                      WHERE created_at >= v_start AND created_at < v_ceil)
    GROUP BY user_id
    HAVING count(*) > 1000
  ) o;

  IF v_over IS NOT NULL THEN
    DELETE FROM public.ca_hand_player_stat s
    USING (
      SELECT user_id, hand_id,
             row_number() OVER (PARTITION BY user_id, asset ORDER BY created_at DESC) AS rn
      FROM public.ca_hand_player_stat
      WHERE user_id = ANY(v_over)
    ) r
    WHERE r.rn > 1000 AND s.user_id = r.user_id AND s.hand_id = r.hand_id;
  END IF;

  UPDATE public.ca_hand_player_stat_state
  SET rolled_ceil = greatest(coalesce(rolled_ceil, v_ceil), v_ceil), updated_at = now()
  WHERE id;

  RETURN v_total;
END;
$function$
