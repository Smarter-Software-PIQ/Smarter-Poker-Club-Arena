CREATE OR REPLACE FUNCTION public.fn_cash_cluster_open_table(p_game_id uuid, p_role text, p_main_index integer, p_lifecycle text DEFAULT 'opening'::text, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  g record; s jsonb; v_opts jsonb;
  v_ante text; v_ante_chips numeric; v_vpip integer; v_vpip_window integer;
  v_bomb_on boolean; v_bomb_trigger text; v_bomb_ante integer; v_bomb_boards integer;
  v_min_bb integer; v_max_bb integer; v_name text; v_table_id uuid; v_n integer;
  v_kill_mode text; v_kill_bb smallint;
BEGIN
  SELECT * INTO g FROM public.cash_games WHERE id = p_game_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GAME_NOT_FOUND: %', p_game_id; END IF;
  IF p_role NOT IN ('main', 'feeder') THEN RAISE EXCEPTION 'ROLE_INVALID: %', p_role; END IF;
  IF p_role = 'main' AND (p_main_index IS NULL OR p_main_index < 1) THEN
    RAISE EXCEPTION 'MAIN_INDEX_INVALID: %', p_main_index;
  END IF;
  IF p_lifecycle NOT IN ('opening', 'live') THEN RAISE EXCEPTION 'LIFECYCLE_INVALID: %', p_lifecycle; END IF;

  s := g.ruleset_snapshot;
  v_opts := coalesce(s->'options', '{}'::jsonb);
  v_ante := coalesce(s->>'regular_ante', 'none');
  v_ante_chips := CASE v_ante WHEN 'sb' THEN g.sb WHEN 'bb' THEN g.bb ELSE 0 END;
  v_vpip := coalesce((s->>'vpip_floor')::integer, 0);
  v_vpip_window := coalesce((s->>'vpip_window')::integer, 10);
  v_bomb_on := coalesce((s->'bombs'->>'enabled')::boolean, false);
  v_bomb_trigger := s->'bombs'->>'trigger';
  v_bomb_ante := (s->'bombs'->>'ante_bb')::integer;
  v_bomb_boards := (s->'bombs'->>'boards')::integer;
  v_min_bb := coalesce((s->>'min_buyin_bb')::integer, 40);
  v_max_bb := coalesce((s->>'max_buyin_bb')::integer, 200);
  -- KILL POTS (kill-v1, 20260924034010). The game's snapshot carries
  -- {"kill":{"mode","threshold_bb"}}; fn_cash_apply_ruleset projects the
  -- same two values identically. 'off' whenever the kill would be refused
  -- at this table, so opening a table never fails on a kill setting.
  v_kill_bb := CASE WHEN (s->'kill'->>'threshold_bb') IN ('8','10','12','15')
                    THEN (s->'kill'->>'threshold_bb')::smallint ELSE 10 END;
  v_kill_mode := lower(coalesce(s->'kill'->>'mode', 'off'));
  IF v_kill_mode NOT IN ('half', 'full') THEN
    v_kill_mode := 'off';
  ELSIF public.fn_kill_pot_configuration_refusal(v_kill_mode, g.variant, 'cash', NULL, v_bomb_on, g.bb, g.club_id) IS NOT NULL THEN
    v_kill_mode := 'off';
  ELSIF NOT public.fn_capability_available('cash.fixed_limit.kill_pots') THEN
    v_kill_mode := 'off';
  END IF;

  -- "NLH 1/2 Classic" for Main 1, "NLH 1/2 Classic Main 2", "... Feeder".
  -- LIVE tables only. R3 reopens a closed cluster's one table with the
  -- closed row still present, so an all-time count made a reopened lone
  -- feeder "<game> Feeder" and the lone-feeder guard then stopped the ROLES
  -- step ever renaming it (2026-09-21 remediation).
  SELECT count(*) INTO v_n FROM public.tables WHERE cluster_id = p_game_id
     AND lifecycle <> 'closed' AND coalesce(is_deleted, false) = false;
  v_name := CASE
    WHEN p_role = 'main' AND p_main_index = 1 THEN g.name
    WHEN p_role = 'main' THEN left(g.name, 50) || ' Main ' || p_main_index
    -- the cluster's first table stands for the game, whatever its role
    WHEN v_n = 0 THEN g.name
    ELSE left(g.name, 50) || ' Feeder' END;

  INSERT INTO public.tables (
    club_id, union_id, name, game_type, game_variant, game_mode,
    small_blind, big_blind, stakes,
    max_players, min_buy_in, max_buy_in,
    ante_enabled, ante, ante_bb, big_blind_ante_enabled,
    nit_game, career_percent_min, maintain_percent_min, maintain_hands,
    bomb_pot_enabled, bomb_pot_trigger_mode, bomb_pot_interval_seconds, bomb_pot_frequency,
    bomb_pot_ante_multiplier, bomb_pot_board_count, bomb_pot_double_board, bomb_pot_min_players,
    straddle_enabled, auto_utg_straddle, voluntary_straddle,
    run_it_mode, run_it_twice, allow_run_it_twice, run_it_twice_enabled,
    rake_percent, rake_cap_bb,
    is_private, is_vip_only, is_anonymous, ban_chat, insurance_enabled,
    seven_deuce_enabled, seven_deuce_amount,
    action_time_seconds, auto_start_players,
    auto_extension, auto_restart, auto_create_table,
    status, current_players, created_by,
    cluster_id, role, main_index, lifecycle, opened_at, live_at,
    kill_mode, kill_threshold_bb
  ) VALUES (
    g.club_id, g.union_id, v_name, 'cash', g.variant, 'regular',
    g.sb, g.bb, public.fn_cash_stakes_label(g.sb, g.bb, g.variant),
    g.handedness, round(g.bb * v_min_bb, 2), round(g.bb * v_max_bb, 2),
    -- BIG BLIND ANTE (2026-09-05): 'bb' is the format, not just the size -
    -- the big blind posts one ante for the table. 'sb' is the classic ante,
    -- a small blind from every seat.
    v_ante_chips > 0, v_ante_chips, CASE WHEN v_ante_chips > 0 THEN round(v_ante_chips / g.bb, 4) ELSE 0 END,
    (v_ante = 'bb'),
    v_vpip > 0, 0, v_vpip, v_vpip_window,
    v_bomb_on,
    CASE WHEN v_bomb_on AND v_bomb_trigger IN ('timed_10m', 'timed_12m', 'timed_15m', 'timed_20m') THEN 'timed'
         WHEN v_bomb_on AND v_bomb_trigger = 'every_orbit' THEN 'once_per_orbit'
         ELSE 'every_n_hands' END,
    CASE WHEN NOT v_bomb_on THEN NULL
         WHEN v_bomb_trigger = 'timed_12m' THEN 720
                     WHEN v_bomb_trigger = 'timed_10m' THEN 600
         WHEN v_bomb_trigger = 'timed_15m' THEN 900
         WHEN v_bomb_trigger = 'timed_20m' THEN 1200
         ELSE NULL END,
    0,
    coalesce(v_bomb_ante, 2), coalesce(v_bomb_boards, 1), coalesce(v_bomb_boards, 1) >= 2, 2,
    false, false, false,
    'player_choice', true, true, true,
    -1, -1,
    coalesce((v_opts->>'is_private')::boolean, false), coalesce((v_opts->>'is_vip_only')::boolean, false),
    coalesce((v_opts->>'is_anonymous')::boolean, false), coalesce((v_opts->>'ban_chat')::boolean, false),
    coalesce((v_opts->>'insurance_enabled')::boolean, false),
    coalesce((v_opts->>'seven_deuce_enabled')::boolean, false),
    CASE WHEN coalesce((v_opts->>'seven_deuce_enabled')::boolean, false) THEN 2 ELSE 0 END,
    LEAST(120, GREATEST(10, coalesce((v_opts->>'action_time_seconds')::integer, 15))), CASE WHEN g.template_name IN ('action','madness') THEN 6 ELSE 2 END,
    -- A cluster table's life is the controller's (Slice 6). A manual (R9)
    -- table's life is the host's. Neither uses the lifecycle-pass flags.
    false, false, false,
    'waiting', 0, coalesce(p_created_by, g.created_by),
    p_game_id, p_role, CASE WHEN p_role = 'main' THEN p_main_index END, p_lifecycle,
    clock_timestamp(), CASE WHEN p_lifecycle = 'live' THEN clock_timestamp() END,
    v_kill_mode, v_kill_bb
  ) RETURNING id INTO v_table_id;

  IF EXISTS(SELECT 1 FROM public.clubs c WHERE c.id=g.club_id AND c.asset='diamonds') THEN
    PERFORM public.fn_poker_diamond_project_cluster(g.id,v_table_id);
  END IF;

  -- BORN HALTED IN A CLUSTER THAT IS NOT DEALING CASH (2026-09-26).
  IF g.cluster_mode IS DISTINCT FROM 'must_move' THEN
    UPDATE public.tables t
       SET dealing_halted_at = clock_timestamp(),
           dealing_halted_reason = CASE WHEN g.cluster_mode = 'pending_on'
                                        THEN 'lightning_pending_on' ELSE 'lightning' END
     WHERE t.id = v_table_id;
  END IF;

  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
  VALUES (p_game_id, v_table_id, CASE WHEN p_role = 'feeder' THEN 'feeder_opened' ELSE 'main_opened' END,
          jsonb_build_object('role', p_role, 'main_index', p_main_index, 'lifecycle', p_lifecycle, 'name', v_name));
  RETURN v_table_id;
END;
$function$
