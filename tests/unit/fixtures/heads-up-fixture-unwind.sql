CREATE OR REPLACE FUNCTION public.fn_unwind_unused_first_club_welcome_package(p_club_id uuid, p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid:=COALESCE(auth.uid(),(SELECT actor_id FROM public.club_welcome_package_receipts WHERE club_id=p_club_id));
  v_prior public.club_welcome_reset_receipts%ROWTYPE;
  v_cash uuid[]:='{}'; v_schedules uuid[]:='{}'; v_tournaments uuid[]:='{}'; v_tables uuid[]:='{}';
  v_bbj public.bbj_pools%ROWTYPE; v_spin public.spin_bonus_pools%ROWTYPE;
  v_bbj_funding numeric; v_spin_funding numeric; v_after numeric; v_spin_result jsonb;
  v_saved jsonb; v_result jsonb;
  v_cancel_id uuid; v_cancel jsonb;
BEGIN
  IF p_club_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'WELCOME_UNWIND_REQUIRES_CLUB_AND_OPERATION';
  END IF;
  SELECT * INTO v_prior FROM public.club_welcome_reset_receipts
   WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF v_prior.club_id IS DISTINCT FROM p_club_id THEN
      RAISE EXCEPTION 'WELCOME_UNWIND_OPERATION_PAYLOAD_MISMATCH';
    END IF;
    RETURN v_prior.result||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO v_prior FROM public.club_welcome_reset_receipts
   WHERE club_id=p_club_id AND COALESCE((result->>'ok')::boolean,false) IS TRUE
   ORDER BY completed_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN v_prior.result||jsonb_build_object('replayed',true,'requested_operation_id',p_operation_id);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.club_welcome_package_receipts WHERE club_id=p_club_id) THEN
    RETURN jsonb_build_object('ok',true,'club_id',p_club_id,'reason','no_welcome_package','replayed',false);
  END IF;

  PERFORM public.fn_ca_lock_settlement_lane_global();
  PERFORM 1 FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  PERFORM 1 FROM public.club_welcome_package_items
   WHERE club_id=p_club_id ORDER BY slot_key FOR UPDATE;
  SELECT amount INTO v_bbj_funding FROM public.club_welcome_package_funding
   WHERE club_id=p_club_id AND destination='bbj_main' FOR UPDATE;
  SELECT amount INTO v_spin_funding FROM public.club_welcome_package_funding
   WHERE club_id=p_club_id AND destination='spin_reserve' FOR UPDATE;
  SELECT * INTO v_bbj FROM public.bbj_pools WHERE club_id=p_club_id AND union_id IS NULL FOR UPDATE;
  SELECT * INTO v_spin FROM public.spin_bonus_pools WHERE club_id=p_club_id FOR UPDATE;
  SELECT COALESCE(array_agg(entity_id ORDER BY entity_id),'{}') INTO v_cash
    FROM public.club_welcome_package_items
   WHERE club_id=p_club_id AND entity_kind='cash_game' AND retired_at IS NULL;
  SELECT COALESCE(array_agg(entity_id ORDER BY entity_id),'{}') INTO v_schedules
    FROM public.club_welcome_package_items
   WHERE club_id=p_club_id AND entity_kind='tournament_schedule' AND retired_at IS NULL;
  PERFORM 1 FROM public.tournament_schedules WHERE id=ANY(v_schedules) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tournament_schedule_spawns
   WHERE schedule_id=ANY(v_schedules) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tournaments t
   WHERE t.club_id=p_club_id AND (
     upper(COALESCE(t.tournament_type::text,'')) IN('SPIN','SNG','SATELLITE')
     OR t.schedule_id=ANY(v_schedules) OR EXISTS(
       SELECT 1 FROM public.tournament_schedule_spawns sp
        WHERE sp.tournament_id=t.id AND sp.schedule_id=ANY(v_schedules)
     )
   ) ORDER BY t.id FOR UPDATE;
  IF NOT (WITH expected(name,game_type,variant,tournament_type,buy_in_amount,buy_in_fee,seats,stack) AS (
    VALUES
      ('NLH Heads-Up 1','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('PLO4 Heads-Up 1','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('NLH Heads-Up 1 Turbo','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('PLO4 Heads-Up 1 Turbo','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('1 Chip Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Deep Stack Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,1000)
  ), candidates AS (
    SELECT e.name FROM public.tournaments t JOIN expected e
      ON t.name=e.name AND upper(COALESCE(t.game_type,''))=e.game_type
     AND lower(COALESCE(t.variant,''))=e.variant
     AND upper(COALESCE(t.tournament_type::text,''))=e.tournament_type
     AND t.buy_in_amount=e.buy_in_amount AND t.buy_in_fee=e.buy_in_fee
     AND t.max_players=e.seats AND t.min_players=e.seats
     AND t.table_size=e.seats AND t.starting_chips=e.stack
     WHERE t.club_id=p_club_id AND t.union_id IS NULL AND t.schedule_id IS NULL
       AND t.restart_source_id IS NULL AND t.satellite_target_id IS NULL
       AND t.satellite_target IS NULL
       -- An earlier generation the 3 AM close cancelled with a receipt that
       -- moved nothing is history, not a second board (2026-11-07).
       AND NOT (
         upper(COALESCE(t.status::text,''))='CANCELLED'
         AND COALESCE(t.current_players,0)=0 AND t.started_at IS NULL
         AND EXISTS(SELECT 1 FROM public.tournament_cancellation_receipts r
           WHERE r.tournament_id=t.id
             AND r.source_player_count=0 AND r.source_seat_count=0
             AND r.refunded_count=0 AND r.refund_line_count=0
             AND r.ticket_return_count=0 AND r.zero_refund_count=0
             AND r.total_refunded=0 AND r.total_ticket_returned=0
             AND r.fees_reversed=0 AND r.total_rake_before=0 AND r.total_rake_after=0
             AND r.released_seat_count=0
             AND cardinality(r.source_player_ids)=0 AND cardinality(r.source_seat_ids)=0
             AND cardinality(r.refunded_registration_ids)=0
             AND cardinality(r.ticket_return_ids)=0
             AND cardinality(r.zero_refund_registration_ids)=0
             AND cardinality(r.fee_reversal_ids)=0)
       )
  ) SELECT count(*)=count(DISTINCT name) FROM candidates) THEN
    RAISE EXCEPTION 'WELCOME_PACKAGE_BOARD_LINEAGE_AMBIGUOUS' USING ERRCODE='55000';
  END IF;
  WITH package_schedule_tournaments AS (
    SELECT t.id FROM public.tournaments t
     WHERE t.club_id=p_club_id AND t.schedule_id=ANY(v_schedules)
    UNION
    SELECT t.id FROM public.tournament_schedule_spawns sp
    JOIN public.tournaments t ON t.id=sp.tournament_id
     WHERE sp.schedule_id=ANY(v_schedules) AND t.club_id=p_club_id
  ), expected(name,game_type,variant,tournament_type,buy_in_amount,buy_in_fee,seats,stack) AS (
    VALUES
      ('NLH Heads-Up 1','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('PLO4 Heads-Up 1','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,1000),
      ('NLH Heads-Up 1 Turbo','NLH','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('PLO4 Heads-Up 1 Turbo','PLO4','sng','SNG',0.95::numeric,0.05::numeric,2,300),
      ('1 Chip Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,300),
      ('1 Chip Deep Stack Spin NLH','NLH','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO4','PLO4','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO5','PLO5','spin','SPIN',1::numeric,0::numeric,3,1000),
      ('1 Chip Deep Stack Spin PLO6','PLO6','spin','SPIN',1::numeric,0::numeric,3,1000)
  )
  SELECT COALESCE(array_agg(q.id ORDER BY q.id),'{}') INTO v_tournaments FROM (
    SELECT p.id FROM package_schedule_tournaments p
    UNION
    SELECT t.id FROM public.tournaments t JOIN expected e
      ON t.name=e.name AND upper(COALESCE(t.game_type,''))=e.game_type
     AND lower(COALESCE(t.variant,''))=e.variant
     AND upper(COALESCE(t.tournament_type::text,''))=e.tournament_type
     AND t.buy_in_amount=e.buy_in_amount AND t.buy_in_fee=e.buy_in_fee
     AND t.max_players=e.seats AND t.min_players=e.seats
     AND t.table_size=e.seats AND t.starting_chips=e.stack
     WHERE t.club_id=p_club_id AND t.union_id IS NULL AND t.schedule_id IS NULL
       AND t.restart_source_id IS NULL AND t.satellite_target_id IS NULL
       AND t.satellite_target IS NULL
    UNION
    SELECT t.id FROM public.tournaments t
     WHERE t.club_id=p_club_id AND t.union_id IS NULL
       AND upper(COALESCE(t.tournament_type::text,''))='SATELLITE'
       AND EXISTS(
         SELECT 1 FROM package_schedule_tournaments target
          WHERE target.id=t.satellite_target_id OR target.id=t.satellite_target
       )
  ) q;
  SELECT COALESCE(array_agg(id ORDER BY id),'{}') INTO v_tables
    FROM public.tables WHERE cluster_id=ANY(v_cash) OR tournament_id=ANY(v_tournaments);

  PERFORM 1 FROM public.tournament_schedules WHERE id=ANY(v_schedules) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.cash_games WHERE id=ANY(v_cash) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tournaments WHERE id=ANY(v_tournaments) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.tables WHERE id=ANY(v_tables) ORDER BY id FOR UPDATE;

  IF EXISTS(SELECT 1 FROM public.table_seats WHERE table_id=ANY(v_tables) AND left_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.table_sessions WHERE table_id=ANY(v_tables) AND COALESCE(is_active,false) AND left_at IS NULL)
     OR EXISTS(SELECT 1 FROM public.table_waitlist WHERE table_id=ANY(v_tables) AND status IN('waiting','notified'))
     OR EXISTS(SELECT 1 FROM public.cash_game_waitlist WHERE game_id=ANY(v_cash) AND status IN('waiting','notified'))
     OR EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=ANY(v_tournaments))
     OR EXISTS(SELECT 1 FROM public.hand_history h
          WHERE h.tournament_id=ANY(v_tournaments))
     OR EXISTS(SELECT 1 FROM public.hand_history h
          WHERE h.table_id=ANY(v_tables))
     OR EXISTS(SELECT 1 FROM public.cash_seat_moves WHERE game_id=ANY(v_cash))
     OR EXISTS(SELECT 1 FROM public.cash_seat_change_requests WHERE game_id=ANY(v_cash))
     OR EXISTS(SELECT 1 FROM public.managed_game_schedules WHERE status='executing' AND
          ((game_kind='tournament' AND game_id=ANY(v_tournaments)) OR
           (game_kind='table' AND game_id=ANY(v_tables)))) THEN
    RAISE EXCEPTION 'WELCOME_PACKAGE_HAS_PLAY_OR_REGISTRATION_HISTORY' USING ERRCODE='55000';
  END IF;

  IF v_bbj_funding IS DISTINCT FROM 100 OR v_spin_funding IS DISTINCT FROM 200
     OR v_bbj.id IS NULL OR v_bbj.main_balance IS DISTINCT FROM v_bbj_funding
     OR COALESCE(v_bbj.backup_balance,0)<>0 OR COALESCE(v_bbj.promo_balance,0)<>0
     OR COALESCE(v_bbj.total_contributed,0)<>0 OR COALESCE(v_bbj.total_paid_out,0)<>0
     OR COALESCE(v_bbj.hit_count,0)<>0
     OR EXISTS(SELECT 1 FROM public.bbj_contributions WHERE pool_id=v_bbj.id)
     OR EXISTS(SELECT 1 FROM public.bbj_payouts WHERE pool_id=v_bbj.id)
     OR EXISTS(SELECT 1 FROM public.wallet_credit_idempotency i
          WHERE i.key LIKE 'bbjpromo:'||v_bbj.id::text||':%')
     OR v_spin.id IS NULL OR v_spin.balance IS DISTINCT FROM v_spin_funding
     OR v_spin.seeded_amount IS DISTINCT FROM v_spin_funding THEN
    RAISE EXCEPTION 'WELCOME_PACKAGE_ECONOMICS_ARE_NOT_PRISTINE' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.wheel_pools WHERE host_id=p_club_id
      AND (spins<>0 OR intake_diamonds<>0 OR chips_minted<>0 OR chips_paid<>0 OR diamonds_paid<>0))
     OR EXISTS(SELECT 1 FROM public.diamond_game_pools WHERE host_id=p_club_id
      AND (rounds<>0 OR intake_diamonds<>0 OR chips_minted<>0 OR chips_paid<>0 OR reserved_chips<>0)) THEN
    RAISE EXCEPTION 'WELCOME_DIAMOND_GAMES_ARE_NOT_UNUSED' USING ERRCODE='55000';
  END IF;

  -- Stop every recurrence source before cancelling unused materializations.
  UPDATE public.spin_bonus_pools SET is_active=false,deactivated_at=now(),updated_at=now()
   WHERE club_id=p_club_id;
  UPDATE public.tournament_schedules SET active=false,updated_at=now() WHERE id=ANY(v_schedules);
  UPDATE public.wheel_configs SET enabled=false,updated_at=now(),updated_by=v_actor WHERE host_id=p_club_id;
  UPDATE public.diamond_game_configs SET enabled=false,updated_at=now(),updated_by=v_actor WHERE host_id=p_club_id;
  UPDATE public.clubs SET spins_enabled=false,bbj_enabled=false,bbj_rake_enabled=false,updated_at=now()
   WHERE id=p_club_id;

  PERFORM set_config('app.managed_game_lifecycle','on',true);
  UPDATE public.cash_games SET enabled=false,state='dormant',closed_at=COALESCE(closed_at,now()),
    closed_by=v_actor,updated_at=now() WHERE id=ANY(v_cash);
  -- A cancellation is a terminal settlement with an immutable receipt
  -- (deferred trigger tournaments_cancel_must_refund). Use the receipted door
  -- fn_close_managed_game uses; the global lane and lifecycle flag are held.
  FOR v_cancel_id IN SELECT t.id FROM public.tournaments t
     WHERE t.id=ANY(v_tournaments)
       AND upper(COALESCE(t.status::text,'')) NOT IN('COMPLETED','CANCELLED','CANCELED')
     ORDER BY t.id LOOP
    v_cancel:=public.atomic_cancel_tournament(v_cancel_id,v_actor);
    IF v_cancel->>'ok' IS DISTINCT FROM 'true'
       OR v_cancel->>'fully_settled' IS DISTINCT FROM 'true'
       OR v_cancel->>'status' IS DISTINCT FROM 'CANCELLED'
       OR v_cancel->>'tournament_id' IS DISTINCT FROM v_cancel_id::text
       OR COALESCE((v_cancel->>'source_player_count')::integer,-1)<>0 THEN
      RAISE EXCEPTION 'WELCOME_TOURNAMENT_CANCELLATION_RECEIPT_REFUSED: %',v_cancel_id
        USING ERRCODE='55000';
    END IF;
  END LOOP;
  UPDATE public.tables SET status='closed',current_players=0,updated_at=now()
   WHERE id=ANY(v_tables) AND lower(COALESCE(status,'')) NOT IN('closed','completed','cancelled','finished');
  UPDATE public.managed_game_schedules SET status='cancelled',completed_at=now(),
    result=jsonb_build_object('ok',false,'reason','welcome_package_reset')
   WHERE status IN('scheduled','executing') AND
    ((game_kind='tournament' AND game_id=ANY(v_tournaments)) OR (game_kind='table' AND game_id=ANY(v_tables)));

  v_spin_result:=public.fn_spin_deactivate(p_club_id,v_actor);
  IF COALESCE((v_spin_result->>'seed_returned')::numeric,0) IS DISTINCT FROM v_spin_funding THEN
    RAISE EXCEPTION 'WELCOME_SPIN_SEED_RETURN_REFUSED';
  END IF;

  v_saved:=public.fn_ca_ledger_declaration_save(ARRAY['bbj_pools']);
  PERFORM public.fn_ca_declare_ledger('treasury_transfer','bbj_pool',v_bbj.id,
    NULL,NULL,ARRAY['bbj_pools']);
  PERFORM set_config('app.ledger_counterparty_label', 'bbj_pools.main_balance', true);
  v_after:=public.fn_spin_move_owner_wallet(p_club_id,'club','chip_treasury',v_bbj_funding);
  IF v_after IS NULL THEN RAISE EXCEPTION 'WELCOME_BBJ_RETURN_REFUSED'; END IF;
  INSERT INTO public.chip_transactions
    (id,club_id,amount,transaction_type,notes,balance_after,metadata)
  VALUES(gen_random_uuid(),p_club_id,v_bbj_funding,'bbj_promo_sweep',
    'Unused welcome-package BBJ principal returned to club treasury',v_after,
    jsonb_build_object('reason','welcome_package_reset','operation_id',p_operation_id,'pool_id',v_bbj.id));
  UPDATE public.bbj_pools SET main_balance=0,backup_balance=0,promo_balance=0,status='retired',updated_at=now()
   WHERE id=v_bbj.id;
  PERFORM public.fn_ca_ledger_declaration_restore(v_saved);

  UPDATE public.club_welcome_package_items SET retired_at=now(),reset_operation_id=p_operation_id
   WHERE club_id=p_club_id AND retired_at IS NULL;
  v_result:=jsonb_build_object('ok',true,'replayed',false,'club_id',p_club_id,
    'package_version','welcome-v1','operation_id',p_operation_id,'opening_grant_unwound',false,
    'returned_to_treasury',jsonb_build_object('bbj',v_bbj_funding,'spin',v_spin_funding),
    'removed',jsonb_build_object('cash_game_ids',to_jsonb(v_cash),'schedule_ids',to_jsonb(v_schedules),
      'tournament_ids',to_jsonb(v_tournaments),'table_ids',to_jsonb(v_tables)),
    'owner_acceptance_required',true,'owner_acceptance_receipts_preserved',true,
    'completed_at',transaction_timestamp());
  INSERT INTO public.club_welcome_reset_receipts(club_id,operation_id,actor_id,result)
  VALUES(p_club_id,p_operation_id,v_actor,v_result);
  RETURN v_result;
END $function$
;
