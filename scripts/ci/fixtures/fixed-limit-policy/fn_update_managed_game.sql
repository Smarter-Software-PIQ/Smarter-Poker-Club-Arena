CREATE OR REPLACE FUNCTION public.fn_update_managed_game(p_kind text, p_game_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_club uuid;
  v_players integer;
  v_status text;
  v_name text;
  v_sb numeric;
  v_bb numeric;
  v_min numeric;
  v_max numeric;
  v_seats integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_kind='tournament' THEN
    PERFORM pg_advisory_xact_lock_shared(530090,1);
    PERFORM public.fn_ca_lock_mtt_admission_contract();
  END IF;

  IF p_kind = 'table' THEN
    SELECT club_id, current_players, status
      INTO v_club, v_players, v_status
      FROM public.tables
     WHERE id = p_game_id
     FOR UPDATE;
  ELSIF p_kind = 'tournament' THEN
    SELECT club_id, current_players, status
      INTO v_club, v_players, v_status
      FROM public.tournaments
     WHERE id = p_game_id
     FOR UPDATE;
  ELSE
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_game_kind');
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'game_not_found');
  END IF;
  IF NOT public.fn_can_create_games(v_club, v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  IF p_kind='tournament' AND public.fn_ca_tournament_is_unlimited(p_game_id) THEN
    p_patch:=p_patch-'max_players'; -- obsolete request field must not reach integer casting
  END IF;

  v_name := left(regexp_replace(COALESCE(p_patch ->> 'name', ''), '\s+', ' ', 'g'), 80);
  IF length(trim(v_name)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_required');
  END IF;

  IF p_kind = 'table' THEN
    IF v_players > 0 OR lower(v_status) IN ('running', 'active') THEN
      UPDATE public.tables
         SET name = v_name, updated_at = now()
       WHERE id = p_game_id;
    ELSE
      SELECT COALESCE((p_patch ->> 'small_blind')::numeric, t.small_blind),
             COALESCE((p_patch ->> 'big_blind')::numeric, t.big_blind),
             COALESCE((p_patch ->> 'min_buy_in')::numeric, t.min_buy_in),
             COALESCE((p_patch ->> 'max_buy_in')::numeric, t.max_buy_in),
             COALESCE((p_patch ->> 'max_players')::integer, t.max_players)
        INTO v_sb, v_bb, v_min, v_max, v_seats
        FROM public.tables t
       WHERE t.id = p_game_id;

      IF v_sb IS NULL OR v_bb IS NULL OR v_min IS NULL OR v_max IS NULL OR v_seats IS NULL
         OR v_sb <= 0 OR v_bb < v_sb OR v_min <= 0 OR v_max < v_min THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_table_limits');
      END IF;

      UPDATE public.tables
         SET name = v_name,
             small_blind = v_sb,
             big_blind = v_bb,
             min_buy_in = v_min,
             max_buy_in = v_max,
             max_players = LEAST(10, GREATEST(2, v_seats)),
             updated_at = now()
       WHERE id = p_game_id;
    END IF;
  ELSE
    PERFORM 1
      FROM public.tournament_players tp
     WHERE tp.tournament_id = p_game_id
     FOR UPDATE;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'players_registered');
    END IF;
    IF upper(v_status) NOT IN ('ANNOUNCED', 'REGISTERING', 'SCHEDULED') THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_started');
    END IF;

    UPDATE public.tournaments
       SET name = v_name,
           max_players = CASE WHEN public.fn_ca_tournament_is_unlimited(p_game_id)
             THEN max_players -- retain accepted v1 storage, or v2 NULL
             ELSE GREATEST(2,COALESCE((p_patch->>'max_players')::integer,max_players)) END,
           start_time = COALESCE((p_patch ->> 'start_time')::timestamptz, start_time),
           updated_at = now()
     WHERE id = p_game_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$function$
