CREATE OR REPLACE FUNCTION public.fn_cash_seat_swap_execute_before_maintenance_gate(p_move_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
/* A MOVED PLAYER NEVER POSTS TO ENTER (Dan 2026-11-15): both swapped chairs arrive 'moved', owing nothing. */
DECLARE
  m record; pm record; a record; b record; ta record; tb record;
  v_stack_a numeric; v_stack_b numeric; v_now timestamptz := clock_timestamp();
BEGIN
  IF public.fn_platform_frozen() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'frozen');
  END IF;
  PERFORM 1 FROM public.cash_seat_moves
   WHERE id IN (p_move_id, (SELECT swap_move_id FROM public.cash_seat_moves WHERE id = p_move_id))
   ORDER BY id FOR UPDATE;
  SELECT * INTO m FROM public.cash_seat_moves WHERE id = p_move_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF m.state <> 'pending' THEN RETURN jsonb_build_object('ok', false, 'reason', m.state); END IF;
  SELECT * INTO pm FROM public.cash_seat_moves WHERE id = m.swap_move_id;
  IF NOT FOUND OR pm.state <> 'pending' OR pm.expires_at <= v_now OR m.expires_at <= v_now THEN
    -- EACH SIDE NAMES ITS OWN CAUSE (2026-09-09). This used to write
    -- 'swap_partner_gone' on both rows whatever had actually happened, so a
    -- move that timed out on its own deadline blamed the other player, and a
    -- partner that was still pending and still inside its deadline was
    -- recorded as `expired`. A count of expiries was not a count of expiries.
    UPDATE public.cash_seat_moves SET state = CASE WHEN m.expires_at <= v_now THEN 'expired' ELSE 'cancelled' END,
           note = CASE WHEN m.expires_at <= v_now THEN 'own_ttl_expired'
                       WHEN pm.id IS NULL THEN 'swap_partner_gone'
                       WHEN pm.expires_at <= v_now THEN 'swap_partner_expired'
                       ELSE 'swap_partner_gone' END
     WHERE id = m.id;
    IF pm.id IS NOT NULL AND pm.state = 'pending' THEN
      -- The partner is alive: it did not expire, this side did. It is
      -- CANCELLED, and the note says which.
      UPDATE public.cash_seat_moves
         SET state = CASE WHEN pm.expires_at <= v_now THEN 'expired' ELSE 'cancelled' END,
             note = CASE WHEN pm.expires_at <= v_now THEN 'own_ttl_expired' ELSE 'swap_partner_expired' END
       WHERE id = pm.id;
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'swap_partner_gone');
  END IF;

  SELECT * INTO a FROM public.table_seats
   WHERE table_id = m.from_table_id AND user_id = m.player_id AND left_at IS NULL FOR UPDATE;
  SELECT * INTO b FROM public.table_seats
   WHERE table_id = pm.from_table_id AND user_id = pm.player_id AND left_at IS NULL FOR UPDATE;
  IF a.id IS NULL OR b.id IS NULL OR coalesce(a.stack, 0) <= 0 OR coalesce(b.stack, 0) <= 0 THEN
    UPDATE public.cash_seat_moves SET state = 'cancelled',
           note = CASE WHEN a.id IS NULL THEN 'player_not_seated' WHEN coalesce(a.stack, 0) <= 0 THEN 'busted' ELSE 'swap_partner_gone' END
     WHERE id = m.id;
    UPDATE public.cash_seat_moves SET state = 'cancelled',
           note = CASE WHEN b.id IS NULL THEN 'player_not_seated' WHEN coalesce(b.stack, 0) <= 0 THEN 'busted' ELSE 'swap_partner_gone' END
     WHERE id = pm.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'swap_cancelled');
  END IF;
  SELECT * INTO ta FROM public.tables WHERE id = m.to_table_id;
  SELECT * INTO tb FROM public.tables WHERE id = pm.to_table_id;
  -- BOTH DESTINATIONS MUST EXIST AND BE OPEN BY STATUS AS WELL (F4, 2026-09-10).
  -- On a record that was never found `ta.lifecycle IN (...)` is NULL, so a
  -- destination that vanished used to pass this test. The single-move gate
  -- has always read status too; this is the same predicate.
  IF ta.id IS NULL OR tb.id IS NULL
     OR ta.lifecycle IN ('breaking', 'closed') OR tb.lifecycle IN ('breaking', 'closed')
     OR ta.status NOT IN ('waiting', 'running', 'active')
     OR tb.status NOT IN ('waiting', 'running', 'active') THEN
    UPDATE public.cash_seat_moves SET state = 'cancelled', note = 'destination_unavailable' WHERE id IN (m.id, pm.id);
    RETURN jsonb_build_object('ok', false, 'reason', 'destination_unavailable');
  END IF;

  IF m.ready_at IS NULL THEN
    UPDATE public.cash_seat_moves SET ready_at = v_now WHERE id = m.id;
  END IF;
  IF pm.ready_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waiting_partner', 'held', true,
                              'to_table_id', m.to_table_id, 'partner_id', pm.player_id);
  END IF;

  -- Each side carries its OWN sit-out across, for the reason written on
  -- fn_cash_seat_move_execute: neither player asked to be dealt into a hand
  -- they had sat out of.
  v_stack_a := a.stack; v_stack_b := b.stack;
  PERFORM set_config('app.cash_seat_move', 'on', true);
  BEGIN
    UPDATE public.table_seats SET stack = 0 WHERE id IN (a.id, b.id);
    UPDATE public.table_seats SET left_at = v_now, leave_pending = false, status = 'left' WHERE id IN (a.id, b.id);
    UPDATE public.table_seats
       SET user_id = a.user_id, member_id = a.member_id, stack = v_stack_a,
           is_sitting_out = coalesce(a.is_sitting_out, false), sit_out_at = a.sit_out_at,
           is_away = coalesce(a.is_away, false),
           joined_at = a.joined_at, horse_id = a.horse_id, status = 'active', leave_pending = false,
           auto_rebuy = a.auto_rebuy, time_bank_remaining = a.time_bank_remaining,
           time_bank_uses_remaining = a.time_bank_uses_remaining, club_id = a.club_id,
           entry_hold = 'moved', entry_post_agreed = false, left_at = NULL
     WHERE id = b.id;
    UPDATE public.table_seats
       SET user_id = b.user_id, member_id = b.member_id, stack = v_stack_b,
           is_sitting_out = coalesce(b.is_sitting_out, false), sit_out_at = b.sit_out_at,
           is_away = coalesce(b.is_away, false),
           joined_at = b.joined_at, horse_id = b.horse_id, status = 'active', leave_pending = false,
           auto_rebuy = b.auto_rebuy, time_bank_remaining = b.time_bank_remaining,
           time_bank_uses_remaining = b.time_bank_uses_remaining, club_id = b.club_id,
           entry_hold = 'moved', entry_post_agreed = false, left_at = NULL
     WHERE id = a.id;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.cash_seat_move', '', true);
    UPDATE public.cash_seat_moves SET state = 'cancelled', note = left(SQLERRM, 200) WHERE id IN (m.id, pm.id);
    RETURN jsonb_build_object('ok', false, 'reason', 'destination_refused', 'detail', left(SQLERRM, 200));
  END;
  PERFORM set_config('app.cash_seat_move', '', true);

  /* A RE-POINT IS NOT ALLOWED TO COLLIDE (2026-09-10) - see the move path
     for the measurement. A swap re-points BOTH players, so both need it. */
  UPDATE public.cash_player_session
     SET closed_at = clock_timestamp(), closed_reason = 'superseded_by_swap'
   WHERE player_id = m.player_id AND scope_type = 'table' AND scope_id = m.to_table_id AND closed_at IS NULL;
  UPDATE public.cash_player_session SET scope_id = m.to_table_id, table_id = m.to_table_id
   WHERE player_id = m.player_id AND scope_type = 'table' AND scope_id = m.from_table_id AND closed_at IS NULL;
  UPDATE public.cash_player_session
     SET closed_at = clock_timestamp(), closed_reason = 'superseded_by_swap'
   WHERE player_id = pm.player_id AND scope_type = 'table' AND scope_id = pm.to_table_id AND closed_at IS NULL;
  UPDATE public.cash_player_session SET scope_id = pm.to_table_id, table_id = pm.to_table_id
   WHERE player_id = pm.player_id AND scope_type = 'table' AND scope_id = pm.from_table_id AND closed_at IS NULL;

  UPDATE public.cash_seat_moves SET state = 'done', executed_at = v_now, to_seat_number = b.seat_number WHERE id = m.id;
  UPDATE public.cash_seat_moves SET state = 'done', executed_at = v_now, to_seat_number = a.seat_number WHERE id = pm.id;
  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload)
  VALUES (m.game_id, m.to_table_id, 'seat_moved',
          jsonb_build_object('player_id', m.player_id, 'from_table_id', m.from_table_id, 'to_seat', b.seat_number,
                             'stack', v_stack_a, 'reason', 'seat_change', 'swap', true)),
         (pm.game_id, pm.to_table_id, 'seat_moved',
          jsonb_build_object('player_id', pm.player_id, 'from_table_id', pm.from_table_id, 'to_seat', a.seat_number,
                             'stack', v_stack_b, 'reason', 'seat_change', 'swap', true));
  RETURN jsonb_build_object('ok', true, 'swap', true, 'to_table_id', m.to_table_id, 'to_seat_number', b.seat_number,
                            'stack', v_stack_a,
                            'partner', jsonb_build_object('player_id', pm.player_id, 'from_table_id', pm.from_table_id,
                                                          'to_table_id', pm.to_table_id, 'to_seat_number', a.seat_number,
                                                          'stack', v_stack_b));
END;
$function$
