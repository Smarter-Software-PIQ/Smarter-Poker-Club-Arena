CREATE OR REPLACE FUNCTION public.fn_cash_game_ensure(p_club_id uuid, p_variant text, p_sb numeric, p_bb numeric, p_template text DEFAULT 'classic'::text, p_handedness integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; v_def jsonb; v_snap jsonb; v_id uuid; v_union uuid;
  v_t text := lower(coalesce(p_template, 'classic'));
  v_v text := lower(p_variant);
  v_label text; v_variant_label text; v_name text; v_seats integer; v_choices integer[];
BEGIN

  -- MIDWAY_UNION_HOST_ONLY: member wallets pay; the union owns new games.
  IF p_club_id <> 'fade0000-0000-0000-0000-000000000001'::uuid
     AND EXISTS (SELECT 1 FROM public.fn_club_union_context(p_club_id) ctx
       WHERE ctx.member_union_id='fade0000-0000-0000-0000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'UNION_HOST_REQUIRED: launch Midway games from Midway Union'
      USING ERRCODE='23514';
  END IF;

  IF v_t NOT IN ('classic', 'action', 'madness') THEN v_t := 'classic'; END IF;

  -- THE TEMPLATE IS PART OF THE KEY (2026-09-09). Classic keeps every stake and
  -- Action and Madness run one game per blind band, so the same club can - and
  -- the platform club does, on 29 keys - hold all three at the same stakes. A
  -- key matched on (club, variant, sb, bb) alone returned whichever was oldest,
  -- and on that club the oldest was Action for NLH 1/2 and Madness for PLO6
  -- 2/5: an order for a Classic game was answered with a game that charges an
  -- ante. A game ensured under one template is never another.
  SELECT * INTO g FROM public.cash_games
   WHERE club_id = p_club_id AND variant = v_v AND sb = p_sb AND bb = p_bb
     AND template_name = v_t
   ORDER BY enabled DESC, created_at LIMIT 1;
  IF FOUND THEN
    IF NOT g.enabled THEN
      UPDATE public.cash_games SET enabled = true, closed_at = NULL, closed_by = NULL, updated_at = now()
       WHERE id = g.id;
      INSERT INTO public.cash_cluster_events (game_id, kind, payload)
      VALUES (g.id, 'game_woken', jsonb_build_object('by', 'fn_cash_game_ensure'));
    END IF;
    -- A game with no open table at all: Main 1 is opened, as at creation.
    IF NOT EXISTS (SELECT 1 FROM public.tables t WHERE t.cluster_id = g.id AND t.lifecycle <> 'closed'
                    AND coalesce(t.is_deleted, false) = false) THEN
      PERFORM public.fn_cash_cluster_open_table(g.id, 'main', 1, 'live', NULL);
    END IF;
    RETURN g.id;
  END IF;

  v_def := public.fn_cash_template_defaults(v_t, v_v);
  -- HANDEDNESS IS ONE OF THE TEMPLATE'S CHOICES, as fn_cash_game_create already
  -- requires of a host (HANDEDNESS_INVALID). A machine caller that asks for a
  -- size the template does not offer gets the template's default rather than a
  -- refusal that would strand the open order, and the event records both
  -- numbers so the difference is readable rather than silent.
  SELECT array_agg(x::integer) INTO v_choices FROM jsonb_array_elements_text(v_def->'seat_choices') x;
  IF (v_def->>'seats_locked')::boolean THEN
    v_seats := (v_def->>'seats')::integer;
  ELSIF p_handedness IS NOT NULL AND p_handedness = ANY (v_choices) THEN
    v_seats := p_handedness;
  ELSE
    v_seats := (v_def->>'seats')::integer;
  END IF;

  -- table_mode was missing from every snapshot this function wrote. must_move
  -- is the column of record and this function always creates a must-move game.
  v_snap := v_def || jsonb_build_object('seats', v_seats, 'sb', p_sb, 'bb', p_bb,
                                        'table_mode', 'must_move',
                                        'resolved_at', to_jsonb(clock_timestamp()),
                                        'created_by', 'fn_cash_game_ensure');
  v_variant_label := CASE v_v
    WHEN 'nlh' THEN 'NLH' WHEN 'plo4' THEN 'PLO4' WHEN 'plo5' THEN 'PLO5' WHEN 'plo6' THEN 'PLO6'
    WHEN 'plo8' THEN 'PLO8' WHEN 'flo8' THEN 'FLO8' WHEN 'flh' THEN 'FLH'
    WHEN 'short_deck' THEN 'Short Deck' WHEN 'pineapple' THEN 'Pineapple' ELSE upper(v_v) END;
  v_label := public.fn_cash_stakes_label(p_sb, p_bb, v_v);
  v_name := left(v_variant_label || ' ' || v_label || ' ' || initcap(v_t), 60);
  SELECT u.id INTO v_union
    FROM public.fn_club_union_context(p_club_id) ctx
    JOIN public.unions u ON u.id = COALESCE(ctx.own_union_id, ctx.member_union_id);

  INSERT INTO public.cash_games
    (club_id, union_id, name, template_name, variant, sb, bb, handedness, ruleset_snapshot, created_by, must_move)
  VALUES
    (p_club_id, v_union, v_name, v_t, v_v, p_sb, p_bb, v_seats, v_snap, NULL, true)
  RETURNING id INTO v_id;
  PERFORM public.fn_cash_cluster_open_table(v_id, 'main', 1, 'live', NULL);
  INSERT INTO public.cash_cluster_events (game_id, kind, payload)
  VALUES (v_id, 'game_created', jsonb_build_object('name', v_name, 'must_move', true,
                                                   'by', 'fn_cash_game_ensure',
                                                   'template', v_t,
                                                   'seats', v_seats, 'seats_asked', p_handedness));
  RETURN v_id;
END;
$function$
