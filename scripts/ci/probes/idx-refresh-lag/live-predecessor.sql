CREATE OR REPLACE FUNCTION public.ca_refresh_hand_player_index(p_max_hands integer DEFAULT 50000)
 RETURNS TABLE(hands_indexed integer, rows_added integer, floor_at timestamp with time zone, ceil_at timestamp with time zone, complete boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '10min'
AS $function$
DECLARE
  f timestamptz; c timestamptz; done boolean; new_floor timestamptz; new_ceil timestamptz;
  n_hands int := 0; n_rows int := 0; k int; kr int;
  v_chunk constant int := 3000;
  v_budget int := least(greatest(coalesce(p_max_hands, 3000), 1), 200000);
  v_deadline timestamptz := clock_timestamp() + interval '90 seconds';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('ca_hand_player_idx_background')) THEN
    RETURN QUERY SELECT 0, 0, NULL::timestamptz, NULL::timestamptz, false;
    RETURN;
  END IF;

  SELECT idx_floor, idx_ceil, backfill_complete INTO f, c, done
  FROM public.ca_hand_player_idx_state WHERE id FOR UPDATE;
  IF f IS NULL THEN f := now(); END IF;
  IF c IS NULL THEN c := now(); END IF;

  LOOP
    EXIT WHEN n_hands >= v_budget OR clock_timestamp() >= v_deadline;
    SELECT max(created_at) INTO new_ceil
    FROM (
      SELECT created_at FROM public.hand_history
      WHERE created_at > c ORDER BY created_at, id LIMIT v_chunk
    ) bounded;
    EXIT WHEN new_ceil IS NULL;
    WITH src AS (
      SELECT h.id, h.created_at, h.players FROM public.hand_history h
      WHERE h.created_at > c AND h.created_at <= new_ceil
    ), expanded AS (
      SELECT DISTINCT ((pl->>'userId')::uuid) AS user_id, s.created_at, s.id AS hand_id
      FROM src s, jsonb_array_elements(s.players) pl
      WHERE pl->>'userId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    ), ins AS (
      INSERT INTO public.ca_hand_player_idx (user_id, created_at, hand_id)
      SELECT user_id, created_at, hand_id FROM expanded
      ORDER BY user_id, hand_id, created_at
      ON CONFLICT DO NOTHING RETURNING 1
    )
    SELECT (SELECT count(*) FROM src)::int, (SELECT count(*) FROM ins)::int INTO k, kr;
    n_hands := n_hands + coalesce(k, 0); n_rows := n_rows + coalesce(kr, 0); c := new_ceil;
  END LOOP;

  IF NOT done AND clock_timestamp() < v_deadline THEN
    SELECT min(created_at) INTO new_floor FROM (
      SELECT created_at FROM public.hand_history
      WHERE created_at < f ORDER BY created_at DESC LIMIT v_chunk
    ) q;
    IF new_floor IS NULL THEN done := true;
    ELSE
      WITH src AS (
        SELECT h.id, h.created_at, h.players FROM public.hand_history h
        WHERE h.created_at < f AND h.created_at >= new_floor
      ), expanded AS (
        SELECT DISTINCT ((pl->>'userId')::uuid) AS user_id, s.created_at, s.id AS hand_id
        FROM src s, jsonb_array_elements(s.players) pl
        WHERE pl->>'userId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      ), ins AS (
        INSERT INTO public.ca_hand_player_idx (user_id, created_at, hand_id)
        SELECT user_id, created_at, hand_id FROM expanded
      ORDER BY user_id, hand_id, created_at
        ON CONFLICT DO NOTHING RETURNING 1
      )
      SELECT (SELECT count(*) FROM src)::int, (SELECT count(*) FROM ins)::int INTO k, kr;
      n_hands := n_hands + coalesce(k, 0); n_rows := n_rows + coalesce(kr, 0); f := new_floor;
      IF NOT EXISTS (SELECT 1 FROM public.hand_history WHERE created_at < f) THEN done := true; END IF;
    END IF;
  END IF;

  UPDATE public.ca_hand_player_idx_state
  SET idx_floor = least(coalesce(idx_floor, f), f),
      idx_ceil = greatest(coalesce(idx_ceil, c), c),
      backfill_complete = done,
      rows_indexed = rows_indexed + n_rows,
      updated_at = now()
  WHERE id;

  RETURN QUERY SELECT n_hands, n_rows, f, c, done;
END;
$function$
