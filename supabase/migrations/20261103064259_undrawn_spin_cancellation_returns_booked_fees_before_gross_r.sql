-- @live-proof: md5(pg_get_functiondef('public.atomic_cancel_tournament(uuid,uuid)'::regprocedure))='8c6c08fa4932958ec9c9c7ef4eb28656' AND md5(pg_get_functiondef('public.fn_ca_tournament_terminal_receipt(uuid,uuid)'::regprocedure))='c7b377efdec82cf7b75af6696563ea0f' AND md5(pg_get_functiondef('public.fn_stamp_tournament_terminal_evidence_markers()'::regprocedure))='59b675bd24c05a85cfac0d4262a713da' AND md5(pg_get_functiondef('public.fn_spin_reserve_receipt_is_immutable()'::regprocedure))='7c1d581b3e0b2454f0bfb83d75df82ff' AND NOT has_function_privilege('anon','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','public.atomic_cancel_tournament(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public.fn_ca_tournament_terminal_receipt(uuid,uuid)','EXECUTE')
-- A booked but undrawn Spin returns its original gross entries atomically.
-- Production rollback reproduction: b8befe51 cache prize9/rake0, escrow
-- prize0/fee0.72/reserve8.28, three immutable3chip prize-rail entitlements.
-- No live data patch, pool zeroing, entitlement rewrite or retry loop.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_spin_reserve_receipt_is_immutable()'::regprocedure))
    IS DISTINCT FROM '7c1d581b3e0b2454f0bfb83d75df82ff' THEN
  RAISE EXCEPTION 'Spin append-only receipt authority changed';
 END IF;
 IF md5(pg_get_functiondef('public.atomic_cancel_tournament(uuid,uuid)'::regprocedure))
    IS DISTINCT FROM '23c7da7a05d2e4cac903ebd501fbb4df' THEN
  RAISE EXCEPTION 'undrawn Spin cancellation source changed';
 END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.atomic_cancel_tournament(p_tournament_id uuid, p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_undrawn_spin boolean := false;
  v_uid uuid := auth.uid();
  v_actor uuid := COALESCE(
    auth.uid(),p_admin_id,'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid);
  v_t public.tournaments%ROWTYPE;
  v_stored public.tournament_cancellation_receipts%ROWTYPE;
  v_e public.tournament_escrow%ROWTYPE;
  v_player record;
  v_entitlement public.tournament_refund_entitlements%ROWTYPE;
  v_fee record;
  v_contribution public.spin_reserve_ledger%ROWTYPE;
  v_draw public.spin_reserve_ledger%ROWTYPE;
  v_pool public.spin_bonus_pools%ROWTYPE;
  v_settle jsonb;
  v_receipt jsonb;
  v_refunds jsonb := '[]'::jsonb;
  v_ticket_returns jsonb := '[]'::jsonb;
  v_source_player_ids uuid[] := ARRAY[]::uuid[];
  v_refunded_registration_ids uuid[] := ARRAY[]::uuid[];
  v_ticket_return_ids uuid[] := ARRAY[]::uuid[];
  v_zero_refund_registration_ids uuid[] := ARRAY[]::uuid[];
  v_closed_table_ids uuid[] := ARRAY[]::uuid[];
  v_source_seat_ids uuid[] := ARRAY[]::uuid[];
  v_released_seat_ids uuid[] := ARRAY[]::uuid[];
  v_fee_reversal_ids uuid[] := ARRAY[]::uuid[];
  v_registration_id uuid;
  v_fee_reversal_id uuid;
  v_original_entry_journal_id uuid;
  v_original_draw_journal_id uuid;
  v_draw_reversal_id uuid;
  v_draw_reversal_journal_id uuid;
  v_contribution_reversal_id uuid;
  v_contribution_reversal_journal_id uuid;
  v_spin_unwind_id uuid;
  v_source_player_count integer := 0;
  v_refunded_count integer := 0;
  v_refund_line_count integer := 0;
  v_ticket_return_count integer := 0;
  v_zero_refund_count integer := 0;
  v_closed_table_count integer := 0;
  v_source_seat_count integer := 0;
  v_released_seat_count integer := 0;
  v_total_refunded numeric := 0;
  v_total_ticket_returned numeric := 0;
  v_fees_reversed numeric := 0;
  v_total_rake_before numeric := 0;
  v_total_rake_after numeric := 0;
  v_total_owed numeric;
  v_draw_amount numeric := 0;
  v_pool_balance_before numeric;
  v_pool_balance_after numeric;
  v_rows integer;
  v_journal_count integer;
  v_cancelled_at timestamptz := transaction_timestamp();
  v_close_note constant text := 'atomic cancellation receipt: exact zero';
BEGIN
  -- Every terminal authority takes this lock before any row lock. Cancellation,
  -- satellite finish and cash finish can touch the same wallets and event rows.
  PERFORM smarter_private.cancellation_lane(p_tournament_id);
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'Tournament id is required' USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_t FROM public.tournaments t
   WHERE t.id=p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tournament not found' USING ERRCODE = 'P0002';
  END IF;
  -- DIAMOND PHASE 8: a Diamond event is cancelled by its own authority, which
  -- returns every entry from custody and writes the same immutable receipt;
  -- the chip rails below never saw a Diamond entry.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    RETURN public.fn_poker_diamond_tournament_cancel(p_tournament_id, p_admin_id);
  END IF;
  IF v_uid IS NOT NULL
     AND NOT public.fn_can_create_games(v_t.club_id,v_uid) THEN
    RAISE EXCEPTION 'Only the governed game operator may cancel a tournament'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_stored FROM public.tournament_cancellation_receipts h
   WHERE h.tournament_id=p_tournament_id FOR UPDATE;
  IF FOUND THEN
    RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,NULL);
  END IF;
  IF upper(COALESCE(v_t.status::text,'')) IN
       ('COMPLETED','CANCELLED','CANCELED','COMPLETING') THEN
    RAISE EXCEPTION 'Tournament is already %',v_t.status USING ERRCODE='55000';
  END IF;

  -- A tournament that has started is resumed or settled, never voided.
  -- start_time is a schedule/fill deadline; it is not proof that play began.
  -- The stored receipt above remains replayable without another cancellation.
  IF v_t.started_at IS NOT NULL
     OR upper(COALESCE(v_t.status::text,'')) IN ('RUNNING','BREAK')
     OR COALESCE(v_t.spin_multiplier,0)>0
     OR EXISTS (SELECT 1 FROM public.tournament_launch_receipts r
                 WHERE r.tournament_id=p_tournament_id AND r.completed_at IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.spin_draw_receipts r
                 WHERE r.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                 WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw')
     OR EXISTS (SELECT 1 FROM public.hand_history hh
                 WHERE hh.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tables tb
                 JOIN public.hand_history hh ON hh.table_id=tb.id
                 WHERE tb.tournament_id=p_tournament_id)
     OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                 WHERE o.tournament_id=p_tournament_id
                   AND o.kind<>'refund' AND o.amount_paid>0) THEN
    RAISE EXCEPTION
      'Tournament has started or committed awards; resume or settle it instead of cancelling'
      USING ERRCODE='55000';
  END IF;

  PERFORM public.fn_lock_accounting_tournament_recognition_week(p_tournament_id,transaction_timestamp());

  -- Freeze every identity before any payer runs. Any concurrent registration,
  -- seat move or hand settlement either committed before these locks and is in
  -- the receipt, or waits behind this transaction and sees a terminal parent.
  PERFORM 1 FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id
   ORDER BY tp.user_id,tp.id FOR UPDATE;
  PERFORM 1 FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id ORDER BY tb.id FOR UPDATE;
  PERFORM 1 FROM public.table_seats s
   JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id
   ORDER BY s.table_id,s.id FOR UPDATE OF s;
  SELECT COALESCE(array_agg(tp.id ORDER BY tp.id),ARRAY[]::uuid[])
    INTO v_source_player_ids FROM public.tournament_players tp
   WHERE tp.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),ARRAY[]::uuid[])
    INTO v_closed_table_ids FROM public.tables tb
   WHERE tb.tournament_id=p_tournament_id;
  SELECT COALESCE(array_agg(s.id ORDER BY s.table_id,s.id),ARRAY[]::uuid[])
    INTO v_source_seat_ids FROM public.table_seats s
    JOIN public.tables tb ON tb.id=s.table_id
   WHERE tb.tournament_id=p_tournament_id;
  v_source_player_count := cardinality(v_source_player_ids);
  v_closed_table_count := cardinality(v_closed_table_ids);
  v_source_seat_count := cardinality(v_source_seat_ids);

  PERFORM public.fn_ca_midway_free_buy_promo_head(p_tournament_id,tp.id,true)
    FROM public.tournament_players tp WHERE tp.tournament_id=p_tournament_id ORDER BY tp.id;
  SELECT * INTO v_t FROM public.tournaments WHERE id=p_tournament_id;
  PERFORM public.fn_ca_escrow_apply(
    p_tournament_id,'atomic cancellation escrow prelock');
  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  -- A full Spin books its reserve before the launch/draw transaction. Its
  -- immutable wallet entitlements still hold the original gross prize rail.
  -- Prove that exact pre-draw state before accepting its pre-launch display.
  v_undrawn_spin := upper(COALESCE(v_t.tournament_type,''))='SPIN'
    AND EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id AND r.kind='contribution');
  IF v_undrawn_spin AND ((
    v_e.enforced IS TRUE AND v_e.closed_at IS NULL
    AND v_e.gross_in>0 AND v_e.bounty_in=0 AND v_e.overlay_in=0
    AND v_e.satellite_in=0 AND v_e.satellite_fee_in=0
    AND v_e.prize_out=0 AND v_e.bounty_out=0 AND v_e.fee_out=0
    AND v_e.refund_prize=0 AND v_e.refund_bounty=0 AND v_e.refund_fee=0
    AND v_e.reserve_in=0 AND v_e.prize_balance=0 AND v_e.bounty_balance=0
    AND v_e.gross_in=v_e.reserve_out+v_e.fee_balance
    AND (SELECT count(*) FROM public.tournament_players p
      WHERE p.tournament_id=p_tournament_id)=3
    AND (SELECT count(*) FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id)=3
    AND NOT EXISTS (SELECT 1 FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id AND
       (e.entitlement_kind<>'wallet_charge' OR e.refund_prize<>e.gross
        OR e.refund_fee<>0 OR e.refund_bounty<>0
        OR EXISTS (SELECT 1 FROM public.tournament_refund_tranches tr
          WHERE tr.entitlement_id=e.id)))
    AND (SELECT sum(e.gross) FROM public.tournament_refund_entitlements e
      WHERE e.tournament_id=p_tournament_id)=v_e.gross_in
    AND (SELECT count(*) FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id)=1
    AND EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
      WHERE r.tournament_id=p_tournament_id AND r.kind='contribution'
        AND r.amount=v_e.reserve_out AND r.house_rake=v_e.fee_balance
        AND r.seats=3 AND round(r.buy_in*3,2)=v_e.gross_in)
  ) IS NOT TRUE) THEN
    RAISE EXCEPTION 'undrawn Spin cancellation entry evidence disagrees'
      USING ERRCODE='P0404';
  END IF;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR (v_t.prize_pool IS DISTINCT FROM v_e.prize_balance
         AND NOT (v_undrawn_spin AND v_t.prize_pool=v_e.gross_in))
     OR v_t.bounty_pool IS DISTINCT FROM v_e.bounty_balance
     OR (v_t.total_rake IS DISTINCT FROM v_e.fee_balance
         AND NOT (v_undrawn_spin AND v_t.total_rake=0)) THEN
    RAISE EXCEPTION 'tournament % caches do not equal exact escrow before cancellation',
      p_tournament_id USING ERRCODE='P0404';
  END IF;

  -- A booked Spin first gives back its draw, then withdraws this event's own
  -- contribution. Each pool movement creates its strict journal before the
  -- matching immutable reversal row and all four ids are stored together.
  PERFORM 1 FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id ORDER BY r.created_at,r.id FOR UPDATE;
  SELECT * INTO v_contribution FROM public.spin_reserve_ledger r
   WHERE r.tournament_id=p_tournament_id AND r.kind='contribution';
  IF FOUND THEN
    IF (SELECT count(*) FROM public.spin_reserve_ledger r
         WHERE r.tournament_id=p_tournament_id AND r.kind='contribution') <> 1
       OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind IN ('draw_reversal','contribution_reversal'))
       OR EXISTS (SELECT 1 FROM public.tournament_spin_cancellation_unwinds u
                   WHERE u.tournament_id=p_tournament_id) THEN
      RAISE EXCEPTION 'Spin % has an ambiguous or partially unwound reserve contract',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_draw FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id AND r.kind='jackpot_draw';
    IF FOUND AND (SELECT count(*) FROM public.spin_reserve_ledger r
                   WHERE r.tournament_id=p_tournament_id
                     AND r.kind='jackpot_draw') <> 1 THEN
      RAISE EXCEPTION 'Spin % has more than one immutable draw',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    SELECT * INTO v_pool FROM public.spin_bonus_pools p
     WHERE p.club_id=v_contribution.club_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % original reserve owner is missing',p_tournament_id
        USING ERRCODE='P0404';
    END IF;
    v_pool_balance_before := v_pool.balance;
    IF v_pool_balance_before IS NULL
       OR v_pool_balance_before::text IN ('NaN','Infinity','-Infinity')
       OR v_pool_balance_before<0 THEN
      RAISE EXCEPTION 'Spin % reserve balance is invalid',p_tournament_id
        USING ERRCODE='22003';
    END IF;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_original_entry_journal_id
      FROM public.chip_ledger l
     WHERE l.tournament_id=p_tournament_id
       AND l.category='spin_entry'
       AND l.from_type='prize_liability'
       AND l.from_entity_id=p_tournament_id
       AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 OR v_contribution.amount<=0 THEN
      RAISE EXCEPTION 'Spin % contribution has no single exact journal',p_tournament_id
        USING ERRCODE='P0404';
    END IF;

    IF v_draw.id IS NOT NULL THEN
      IF v_draw.club_id IS DISTINCT FROM v_contribution.club_id
         OR v_draw.amount>=0 THEN
        RAISE EXCEPTION 'Spin % draw disagrees with its contribution owner',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      v_draw_amount := round(-v_draw.amount,2);
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_original_draw_journal_id
        FROM public.chip_ledger l
       WHERE l.tournament_id=p_tournament_id
         AND l.category='spin_prize'
         AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
         AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
      PERFORM public.fn_ca_declare_ledger(
        'reversal','prize_liability',p_tournament_id,NULL,
        'spin:'||p_tournament_id::text||':cancel:draw',NULL);
      UPDATE public.spin_bonus_pools
         SET balance=balance+v_draw_amount,updated_at=now()
       WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Spin % reserve vanished during draw reversal',p_tournament_id
          USING ERRCODE='55000';
      END IF;
      INSERT INTO public.spin_reserve_ledger
        (club_id,tournament_id,kind,amount,balance_after,multiplier,
         buy_in,seats,house_rake,note)
      VALUES
        (v_draw.club_id,p_tournament_id,'draw_reversal',v_draw_amount,
         v_pool_balance_after,v_draw.multiplier,v_draw.buy_in,v_draw.seats,
         v_draw.house_rake,'atomic cancellation reversed the exact reserve draw')
      RETURNING id INTO v_draw_reversal_id;
      SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
        INTO v_journal_count,v_draw_reversal_journal_id
        FROM public.chip_ledger l
       WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:draw'
         AND l.tournament_id=p_tournament_id AND l.category='reversal'
         AND l.from_type='prize_liability' AND l.from_entity_id=p_tournament_id
         AND l.to_type='spin_reserve' AND l.to_entity_id=v_pool.id
         AND l.amount=v_draw_amount;
      IF v_journal_count<>1 THEN
        RAISE EXCEPTION 'Spin % draw reversal has no single exact journal',p_tournament_id
          USING ERRCODE='P0404';
      END IF;
    ELSE
      v_pool_balance_after := v_pool_balance_before;
    END IF;

    IF v_pool_balance_after<v_contribution.amount THEN
      RAISE EXCEPTION 'Spin % reserve cannot return its own contribution',p_tournament_id
        USING ERRCODE='P0403';
    END IF;
    PERFORM public.fn_ca_declare_ledger(
      'reversal','prize_liability',p_tournament_id,NULL,
      'spin:'||p_tournament_id::text||':cancel:entry',NULL);
    UPDATE public.spin_bonus_pools
       SET balance=balance-v_contribution.amount,updated_at=now()
     WHERE id=v_pool.id RETURNING balance INTO v_pool_balance_after;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Spin % reserve vanished during contribution reversal',p_tournament_id
        USING ERRCODE='55000';
    END IF;
    INSERT INTO public.spin_reserve_ledger
      (club_id,tournament_id,kind,amount,balance_after,multiplier,
       buy_in,seats,house_rake,note)
    VALUES
      (v_contribution.club_id,p_tournament_id,'contribution_reversal',
       -v_contribution.amount,v_pool_balance_after,v_contribution.multiplier,
       v_contribution.buy_in,v_contribution.seats,v_contribution.house_rake,
       'atomic cancellation returned the exact entry contribution')
    RETURNING id INTO v_contribution_reversal_id;
    SELECT count(*),(array_agg(l.id ORDER BY l.created_at,l.id))[1]
      INTO v_journal_count,v_contribution_reversal_journal_id
      FROM public.chip_ledger l
     WHERE l.idempotency_key='spin:'||p_tournament_id::text||':cancel:entry'
       AND l.tournament_id=p_tournament_id AND l.category='reversal'
       AND l.from_type='spin_reserve' AND l.from_entity_id=v_pool.id
       AND l.to_type='prize_liability' AND l.to_entity_id=p_tournament_id
       AND l.amount=v_contribution.amount;
    IF v_journal_count<>1 THEN
      RAISE EXCEPTION 'Spin % contribution reversal has no single exact journal',
        p_tournament_id USING ERRCODE='P0404';
    END IF;
    INSERT INTO public.tournament_spin_cancellation_unwinds(
      tournament_id,pool_id,reserve_owner_id,
      original_contribution_id,original_draw_id,
      original_entry_journal_id,original_draw_journal_id,
      draw_reversal_id,draw_reversal_journal_id,
      contribution_reversal_id,contribution_reversal_journal_id,
      contribution_amount,draw_amount,pool_balance_before,pool_balance_after,
      settled_at)
    VALUES(
      p_tournament_id,v_pool.id,v_contribution.club_id,
      v_contribution.id,v_draw.id,
      v_original_entry_journal_id,v_original_draw_journal_id,
      v_draw_reversal_id,v_draw_reversal_journal_id,
      v_contribution_reversal_id,v_contribution_reversal_journal_id,
      v_contribution.amount,v_draw_amount,v_pool_balance_before,
      v_pool_balance_after,v_cancelled_at)
    RETURNING tournament_id INTO v_spin_unwind_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.spin_reserve_ledger r
     WHERE r.tournament_id=p_tournament_id
       AND r.kind IN ('jackpot_draw','draw_reversal','contribution_reversal')) THEN
    RAISE EXCEPTION 'Spin % has reserve evidence without its contribution',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  -- Reverse fee attribution before the exact refund payer. Ordinary entry
  -- entitlements retain their fee rail. Reverse each current player's net fee and
  -- each aggregate Spin source exactly once, retaining immutable source ids.
  IF EXISTS (SELECT 1 FROM public.rake_records r
              WHERE r.tournament_id=p_tournament_id
                AND r.source='atomic_cancel_tournament') THEN
    RAISE EXCEPTION 'unreceipted cancellation rake evidence already exists'
      USING ERRCODE='P0404';
  END IF;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_before FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_before<0
     OR v_total_rake_before::text IN ('NaN','Infinity','-Infinity')
     OR (round(COALESCE(v_t.total_rake,0),2) IS DISTINCT FROM v_total_rake_before
         AND NOT (v_undrawn_spin AND v_t.total_rake=0
                  AND v_total_rake_before=v_e.fee_balance)) THEN
    RAISE EXCEPTION 'tournament % rake cache and evidence disagree',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  FOR v_fee IN
    SELECT tp.user_id,r.club_id,
           round(sum(r.rake_amount),2) AS amount,
           jsonb_agg(r.id ORDER BY r.id) AS source_ids
      FROM (SELECT DISTINCT p.user_id FROM public.tournament_players p
             WHERE p.tournament_id=p_tournament_id AND p.user_id IS NOT NULL) tp
      JOIN public.rake_records r
        ON r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.metadata->>'user_id'=tp.user_id::text
     GROUP BY tp.user_id,r.club_id HAVING round(sum(r.rake_amount),2)>0
     ORDER BY tp.user_id,r.club_id
  LOOP
    INSERT INTO public.rake_records(
      hand_id,table_id,club_id,rake_amount,pot_size,num_players,
      bbj_contribution,is_tournament,tournament_id,source,metadata)
    VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.amount,1,0,true,
      p_tournament_id,'atomic_cancel_tournament',jsonb_build_object(
        'kind','tournament_fee_refund','user_id',v_fee.user_id,
        'original_rake_record_ids',v_fee.source_ids))
    RETURNING id INTO v_fee_reversal_id;
    v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
    v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
  END LOOP;
  FOR v_fee IN
    SELECT r.*,round(r.rake_amount+COALESCE((SELECT sum(rr.rake_amount)
      FROM public.rake_records rr WHERE rr.tournament_id=p_tournament_id
       AND rr.source='atomic_cancel_tournament'
       AND rr.metadata->>'original_rake_record_id'=r.id::text),0),2) AS amount
      FROM public.rake_records r
     WHERE r.tournament_id=p_tournament_id AND r.is_tournament
       AND r.source IN ('fn_spin_book_entry','fn_spin_settle_game')
       AND r.rake_amount>0 AND NULLIF(r.metadata->>'user_id','') IS NULL
     ORDER BY r.id FOR UPDATE
  LOOP
    IF v_fee.amount>0 THEN
      INSERT INTO public.rake_records(
        hand_id,table_id,club_id,rake_amount,pot_size,num_players,
        bbj_contribution,is_tournament,tournament_id,source,
        player_contributions,metadata)
      VALUES(NULL,NULL,v_fee.club_id,-v_fee.amount,v_fee.pot_size,
        v_fee.num_players,0,true,p_tournament_id,'atomic_cancel_tournament',
        v_fee.player_contributions,jsonb_build_object(
          'kind','spin_rake_refund','original_source',v_fee.source,
          'original_rake_record_id',v_fee.id))
      RETURNING id INTO v_fee_reversal_id;
      v_fee_reversal_ids:=array_append(v_fee_reversal_ids,v_fee_reversal_id);
      v_fees_reversed:=round(v_fees_reversed+v_fee.amount,2);
    END IF;
  END LOOP;
  SELECT round(COALESCE(sum(r.rake_amount),0),2)
    INTO v_total_rake_after FROM public.rake_records r
   WHERE r.tournament_id=p_tournament_id AND r.is_tournament;
  IF v_total_rake_after IS DISTINCT FROM 0::numeric
     OR v_fees_reversed IS DISTINCT FROM v_total_rake_before THEN
    RAISE EXCEPTION 'tournament % fee reversal did not close exactly',p_tournament_id
      USING ERRCODE='P0404';
  END IF;

  IF v_undrawn_spin THEN
    -- The reserve reversal and negative fee records above are now proved.
    -- Return those exact booked components to the original gross entry rail;
    -- never rewrite an entitlement or fund a refund from another event.
    IF v_spin_unwind_id IS DISTINCT FROM p_tournament_id
       OR v_contribution.amount IS DISTINCT FROM v_e.reserve_out
       OR v_fees_reversed IS DISTINCT FROM v_e.fee_balance THEN
      RAISE EXCEPTION 'undrawn Spin cancellation unwind is not exact'
        USING ERRCODE='P0404';
    END IF;
    PERFORM public.fn_ca_escrow_apply(p_tournament_id,
      'undrawn Spin exact contribution and fee reversal',
      p_reserve_out=>-v_contribution.amount,
      p_fee_entries_in=>-v_fees_reversed);
  END IF;


  -- Return each unconsumed funded entitlement as cash to its recorded club.
  -- The exact refund payer proves wallet, satellite transfer or redeemed-ticket
  -- funding and excludes value already returned as a ticket. Stored historical
  -- cancellation receipts continue to replay through their original evidence.
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    JOIN public.tournament_players tp ON tp.id=e.registration_id
    JOIN public.tournament_tickets tk
      ON tk.source_refund_entitlement_id=e.id
   WHERE e.tournament_id=p_tournament_id
     AND tp.tournament_id=p_tournament_id) THEN
    RAISE EXCEPTION 'active qualifier roster already has an unreceipted return ticket'
      USING ERRCODE='P0404';
  END IF;
  /* A DISPOSED ENTITLEMENT DOES NOT BLOCK A CANCELLATION (2026-10-05).

     This guard exists to catch an entitlement the refund loop below would
     MISS: one still owed money with no roster row to pay it through. It
     used to demand a live tournament_players row for EVERY entitlement,
     which is strictly stronger than the loop's own rule. The loop selects
     an entitlement only when it has no tournament_refund_tranches row and
     no tournament_tickets return - this function's own definition of
     "already disposed" - so an entitlement holding either of those is
     settled evidence the loop would never pay a second time, and demanding
     a roster row for it refused a cancellation that was in fact complete.

     The roster row is exactly what goes missing: fn_ca_unregister_tournament
     _player_exact DELETEs tournament_players when it refunds a registration,
     while tournament_refund_entitlements is append-only and carries no
     disposed marker, so the two can never be reconciled by repair - only by
     reading the tranche, which is what the loop already does.

     Measured on Deep Stack Society, 2026-10-05: 561 entitlements across 29
     events, every one paid in full through that authority (sum paid 5506.00
     = sum entitled 5506.00; none partial, none untranched) with every roster
     row deleted. Those 29 events could therefore never reach CANCELLED, and
     the club could never be retired at all, because fn_retire_settled_club
     refuses while any tournament is still active.

     The two arms now agree by construction: an entitlement trips this guard
     only if the loop would have wanted to pay it. An untranched, unticketed
     entitlement with no roster row still raises - the case this was written
     for. The ticket arm is unexercised by the measurement above (no return
     tickets exist for those events) and stays guarded on the dangerous side
     by the unreceipted-return-ticket check immediately preceding, which
     still refuses a ticketed entitlement whose qualifier is on the roster. */
  IF EXISTS (
    SELECT 1 FROM public.tournament_refund_entitlements e
    LEFT JOIN public.tournament_players tp
      ON tp.tournament_id=e.tournament_id AND tp.user_id=e.user_id
   WHERE e.tournament_id=p_tournament_id
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_refund_tranches tr
        WHERE tr.entitlement_id=e.id)
     AND NOT EXISTS (
       SELECT 1 FROM public.tournament_tickets tk
        WHERE tk.source_refund_entitlement_id=e.id)
     AND (tp.id IS NULL OR (e.entitlement_kind IN (
            'satellite_seat','tournament_ticket')
          AND e.registration_id IS DISTINCT FROM tp.id))) THEN
    RAISE EXCEPTION 'refund entitlement is detached from the frozen roster'
      USING ERRCODE='P0404';
  END IF;
  FOR v_player IN
    SELECT DISTINCT ON (tp.user_id) tp.id,tp.user_id
      FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
     ORDER BY tp.user_id,tp.id
  LOOP
    -- The owner-only plan validates every source ledger, wallet debit and
    -- escrow rail. Identity comes from the locked entitlement table below.
    PERFORM 1 FROM public.fn_ca_tournament_refund_plan(
      p_tournament_id,v_player.user_id);
    LOOP
      SELECT e.* INTO v_entitlement
        FROM public.tournament_refund_entitlements e
       WHERE e.tournament_id=p_tournament_id
         AND e.user_id=v_player.user_id
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_refund_tranches tr
            WHERE tr.entitlement_id=e.id)
         AND NOT EXISTS (
           SELECT 1 FROM public.tournament_tickets tk
            WHERE tk.source_refund_entitlement_id=e.id)
       ORDER BY e.entitlement_kind,e.id
       LIMIT 1 FOR UPDATE OF e;
      EXIT WHEN NOT FOUND;
      v_registration_id:=COALESCE(v_entitlement.registration_id,v_player.id);
      IF v_entitlement.entitlement_kind IN (
          'wallet_charge','satellite_seat','tournament_ticket') THEN
        SELECT COALESCE(o.amount_paid,0)+v_entitlement.gross
          INTO v_total_owed FROM public.tournament_obligations o
         WHERE o.tournament_id=p_tournament_id AND o.kind='refund'
           AND o.place IS NULL AND o.user_id=v_player.user_id FOR UPDATE;
        IF NOT FOUND THEN v_total_owed:=v_entitlement.gross; END IF;
        v_settle:=public.fn_settle_tournament_refund_exact(
          p_tournament_id,v_player.user_id,
          v_entitlement.refund_wallet_club_id,v_total_owed,
          v_entitlement.refund_prize,v_entitlement.refund_bounty,
          v_entitlement.refund_fee,'atomic_cancel_tournament',
          'Tournament cancellation refund: '||COALESCE(v_t.name,'Unknown'));
        IF COALESCE((v_settle->>'ok')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'fully_settled')::boolean,false) IS NOT TRUE
           OR COALESCE((v_settle->>'remaining')::numeric,-1)<>0
           OR (v_settle->>'entitlement_id')::uuid
                IS DISTINCT FROM v_entitlement.id
           OR v_settle->>'entitlement_kind' IS DISTINCT FROM v_entitlement.entitlement_kind
           OR (v_settle->>'paid')::numeric IS DISTINCT FROM v_entitlement.gross
           OR (v_settle->>'refund_prize')::numeric
                IS DISTINCT FROM v_entitlement.refund_prize
           OR (v_settle->>'refund_bounty')::numeric
                IS DISTINCT FROM v_entitlement.refund_bounty
           OR (v_settle->>'refund_fee')::numeric
                IS DISTINCT FROM v_entitlement.refund_fee THEN
          RAISE EXCEPTION 'exact cancellation refund refused entitlement %: %',
            v_entitlement.id,v_settle USING ERRCODE='55000';
        END IF;
        v_refunds:=v_refunds||jsonb_build_array(jsonb_build_object(
          'registration_id',v_registration_id,
          'user_id',v_player.user_id,
          'entitlement_id',v_entitlement.id,
          'entitlement_kind',v_entitlement.entitlement_kind,
          'source_wallet_club_id',v_entitlement.refund_wallet_club_id,
          'gross_paid',v_entitlement.gross,
          'amount_paid_before',(v_settle->>'already_paid')::numeric,
          'amount_paid_now',(v_settle->>'paid')::numeric,
          'refund_prize',(v_settle->>'refund_prize')::numeric,
          'refund_bounty',(v_settle->>'refund_bounty')::numeric,
          'refund_fee',(v_settle->>'refund_fee')::numeric,
          'obligation_id',(v_settle->>'obligation_id')::uuid,
          'idempotency_key',v_settle->>'idempotency_key',
          'credit_ledger_id',(v_settle->>'credit_ledger_id')::uuid,
          'wallet_transaction_id',(v_settle->>'wallet_transaction_id')::uuid));
        v_refund_line_count:=v_refund_line_count+1;
        v_total_refunded:=round(
          v_total_refunded+(v_settle->>'paid')::numeric,2);
      ELSE
        RAISE EXCEPTION 'unknown cancellation entitlement kind %',
          v_entitlement.entitlement_kind USING ERRCODE='P0404';
      END IF;
      IF NOT v_registration_id=ANY(v_refunded_registration_ids) THEN
        v_refunded_registration_ids:=array_append(
          v_refunded_registration_ids,v_registration_id);
      END IF;
    END LOOP;
  END LOOP;
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_refunded_registration_ids
    FROM unnest(v_refunded_registration_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_zero_refund_registration_ids
    FROM unnest(v_source_player_ids) ids(id)
   WHERE NOT id=ANY(v_refunded_registration_ids);
  v_refunded_count:=cardinality(v_refunded_registration_ids);
  v_zero_refund_count:=cardinality(v_zero_refund_registration_ids);

  IF EXISTS (
    SELECT 1 FROM public.tournament_players tp
     WHERE tp.tournament_id=p_tournament_id AND tp.user_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.fn_ca_tournament_refund_plan(
                    p_tournament_id,tp.user_id))) THEN
    RAISE EXCEPTION 'cancellation left a refundable entitlement unpaid'
      USING ERRCODE='55000';
  END IF;


  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id=p_tournament_id FOR UPDATE;
  IF v_e.tournament_id IS NULL OR v_e.enforced IS DISTINCT FROM true
     OR v_e.prize_balance IS DISTINCT FROM 0::numeric
     OR v_e.bounty_balance IS DISTINCT FROM 0::numeric
     OR v_e.fee_balance IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'tournament % cancellation did not close all escrow banks',
      p_tournament_id USING ERRCODE='P0404';
  END IF;
  UPDATE public.tournament_escrow
     SET closed_at=v_cancelled_at,close_note=v_close_note,updated_at=now()
   WHERE tournament_id=p_tournament_id AND closed_at IS NULL
     AND prize_balance=0 AND bounty_balance=0 AND fee_balance=0;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its exact-zero escrow close',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  UPDATE public.tournament_players
     SET status='eliminated',eliminated_at=v_cancelled_at,
         chips=0,current_bounty=0
   WHERE tournament_id=p_tournament_id;
  WITH released AS (
    UPDATE public.table_seats s
       SET left_at=v_cancelled_at,status='left',leave_pending=false,
           is_sitting_out=false,is_away=false,sit_out_at=NULL,
           scheduled_leave_hands=NULL
      FROM public.tables tb
     WHERE tb.id=s.table_id AND tb.tournament_id=p_tournament_id
       AND s.left_at IS NULL RETURNING s.id)
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_released_seat_ids FROM released;
  v_released_seat_count:=cardinality(v_released_seat_ids);
  UPDATE public.table_seats s
     SET status='left',leave_pending=false,is_sitting_out=false,is_away=false,
         sit_out_at=NULL,scheduled_leave_hands=NULL
   WHERE s.id=ANY(v_source_seat_ids) AND s.left_at IS NOT NULL;

  UPDATE public.tournaments
     SET status='CANCELLED',ended_at=v_cancelled_at,updated_at=now(),
         prize_pool=0,bounty_pool=0,total_rake=0,current_players=0,
         on_break=false,break_started_at=NULL,break_ends_at=NULL
   WHERE id=p_tournament_id
     AND upper(COALESCE(status::text,'')) NOT IN
         ('COMPLETED','CANCELLED','CANCELED','COMPLETING');
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN
    RAISE EXCEPTION 'tournament % lost its cancellation lifecycle claim',
      p_tournament_id USING ERRCODE='55000';
  END IF;
  UPDATE public.tables
     SET status='closed',lifecycle='closed',current_players=0,
         terminal_closed_at=v_cancelled_at,updated_at=now()
   WHERE tournament_id=p_tournament_id;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>v_closed_table_count THEN
    RAISE EXCEPTION 'tournament % did not close every table',p_tournament_id
      USING ERRCODE='55000';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_fee_reversal_ids FROM unnest(v_fee_reversal_ids) ids(id);
  SELECT COALESCE(array_agg(id ORDER BY id),ARRAY[]::uuid[])
    INTO v_ticket_return_ids FROM unnest(v_ticket_return_ids) ids(id);
  v_receipt:=jsonb_build_object(
    'ok',true,'success',true,'fully_settled',true,'receipt_version',2,
    'tournament_id',p_tournament_id,'actor_id',v_actor,'status','CANCELLED',
    'source_player_count',v_source_player_count,
    'refunded_count',v_refunded_count,'refund_line_count',v_refund_line_count,
    'ticket_return_count',v_ticket_return_count,
    'total_ticket_returned',v_total_ticket_returned,
    'total_refunded',v_total_refunded,'fees_reversed',v_fees_reversed,
    'closed_table_count',v_closed_table_count,
    'source_seat_count',v_source_seat_count,
    'released_seat_count',v_released_seat_count,
    'refunds',v_refunds,'ticket_returns',v_ticket_returns,
    'settled_at',v_cancelled_at);
  INSERT INTO public.tournament_cancellation_receipts(
    tournament_id,actor_id,receipt_version,
    source_player_count,source_player_ids,
    refunded_count,refunded_registration_ids,refund_line_count,
    ticket_return_count,ticket_return_ids,total_ticket_returned,
    zero_refund_count,zero_refund_registration_ids,
    total_refunded,fees_reversed,total_rake_before,total_rake_after,
    closed_table_count,closed_table_ids,source_seat_count,source_seat_ids,
    released_seat_count,released_seat_ids,fee_reversal_ids,
    escrow_closed_at,escrow_close_note,spin_unwind_tournament_id,
    receipt,settled_at)
  VALUES(
    p_tournament_id,v_actor,2,
    v_source_player_count,v_source_player_ids,
    v_refunded_count,v_refunded_registration_ids,v_refund_line_count,
    v_ticket_return_count,v_ticket_return_ids,v_total_ticket_returned,
    v_zero_refund_count,v_zero_refund_registration_ids,
    v_total_refunded,v_fees_reversed,v_total_rake_before,v_total_rake_after,
    v_closed_table_count,v_closed_table_ids,v_source_seat_count,v_source_seat_ids,
    v_released_seat_count,v_released_seat_ids,v_fee_reversal_ids,
    v_cancelled_at,v_close_note,v_spin_unwind_id,v_receipt,v_cancelled_at);

  PERFORM public.fn_record_accounting_tournament_cancellation(p_tournament_id);
  RETURN public.fn_ca_tournament_cancellation_receipt(p_tournament_id,v_actor);
END;
$function$;
DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_stamp_tournament_terminal_evidence_markers()'::regprocedure)) IS DISTINCT FROM '14c900bb427e28b265172e38b274afa7' THEN RAISE EXCEPTION 'Spin terminal source changed'; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_stamp_tournament_terminal_evidence_markers()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_terminal_at timestamptz;
BEGIN
  IF upper(COALESCE(NEW.status::text,'')) NOT IN
       ('COMPLETED','CANCELLED','CANCELED')
     OR (TG_OP = 'UPDATE' AND upper(COALESCE(OLD.status::text,'')) IN
       ('COMPLETED','CANCELLED','CANCELED')) THEN
    RETURN NEW;
  END IF;
  v_terminal_at := NEW.ended_at;
  IF v_terminal_at IS NULL OR NOT isfinite(v_terminal_at) THEN
    RAISE EXCEPTION 'terminal tournament % requires one finite close marker',NEW.id
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.tournament_players
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_obligations
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_payouts
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_rake_settlements
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.rake_records
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_bounty_chests
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_bounty_awards
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_guarantee_overlays
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.table_seats s
     SET terminal_closed_at = v_terminal_at
    FROM public.tables tb
   WHERE tb.id = s.table_id AND tb.tournament_id = NEW.id
     AND s.terminal_closed_at IS NULL;
  UPDATE public.wallet_transactions
     SET terminal_closed_at = v_terminal_at
   WHERE related_entity_id = NEW.id AND terminal_closed_at IS NULL;
  UPDATE public.tournament_bounty_award_recipients r
     SET terminal_closed_at = v_terminal_at
    FROM public.tournament_bounty_awards a
   WHERE a.id = r.award_id AND a.tournament_id = NEW.id
     AND r.terminal_closed_at IS NULL;
  UPDATE public.tournament_escrow
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id AND terminal_closed_at IS NULL;
  -- Contribution, draw and reversal receipts already have an unconditional
  -- append-only guard. Stamp only mutable Spin evidence such as surplus rows.
  UPDATE public.spin_reserve_ledger
     SET terminal_closed_at = v_terminal_at
   WHERE tournament_id = NEW.id
     AND kind NOT IN ('contribution','jackpot_draw','draw_reversal','contribution_reversal')
     AND terminal_closed_at IS NULL;

  IF EXISTS (SELECT 1 FROM public.tournament_players x
              WHERE x.tournament_id=NEW.id
                AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_obligations x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_payouts x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_rake_settlements x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.rake_records x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_bounty_chests x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_guarantee_overlays x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (
       SELECT 1 FROM public.table_seats s
       JOIN public.tables tb ON tb.id=s.table_id
        WHERE tb.tournament_id=NEW.id
          AND s.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.wallet_transactions x
                 WHERE x.related_entity_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (
       SELECT 1 FROM public.tournament_bounty_award_recipients r
       JOIN public.tournament_bounty_awards a ON a.id=r.award_id
        WHERE a.tournament_id=NEW.id
          AND r.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.tournament_escrow x
                 WHERE x.tournament_id=NEW.id
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at)
     OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger x
                 WHERE x.tournament_id=NEW.id
                   AND x.kind NOT IN ('contribution','jackpot_draw','draw_reversal','contribution_reversal')
                   AND x.terminal_closed_at IS DISTINCT FROM v_terminal_at) THEN
    RAISE EXCEPTION 'terminal tournament % did not stamp every mutable evidence row',
      NEW.id USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DO $preimage$ BEGIN IF md5(pg_get_functiondef('public.fn_ca_tournament_terminal_receipt(uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'f590179b53eaf449197e44d1d0aa835e' THEN RAISE EXCEPTION 'Spin terminal source changed'; END IF; END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_tournament_terminal_receipt(p_tournament_id uuid, p_observed_winner_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_accounting jsonb; v_deferred boolean := false;v_custody boolean:=false;v_resolved boolean:=false;v_original_witness jsonb;v_spin_witness jsonb;v_spin_original jsonb;
  v_h public.tournament_terminal_settlements%ROWTYPE;
  v_t record;
  v_e public.tournament_escrow%ROWTYPE;
  v_r record;
  v_cash_count integer;
  v_cash_total numeric(15,2);
  v_cash_obligation_total numeric(15,2);
  v_bounty_total numeric(15,2);
  v_rake_total numeric(15,2);
  v_roster_count integer;
  v_winner_count integer;
  v_raw_winner_id uuid;
  v_raw_winner_amount numeric(15,2);
  v_bubble jsonb;
  v_durable_payouts jsonb;
  v_durable_deal_shares jsonb;
  v_durable_bubble jsonb;
  v_durable_table_ids uuid[];
  v_durable_table_count integer;
  v_durable_seat_ids uuid[];
  v_durable_seat_count integer;
  v_durable_released_count integer;
  v_mystery_evidence jsonb;
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'terminal receipt requires a tournament id'
      USING ERRCODE = '22004';
  END IF;

  SELECT * INTO v_h
    FROM public.tournament_terminal_settlements h
   WHERE h.tournament_id = p_tournament_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % has no immutable terminal receipt',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  v_accounting:=CASE WHEN v_h.accounting_state='fee_custody_unresolved' THEN public.fn_ca_tournament_fee_custody_receipt(p_tournament_id) ELSE public.fn_accounting_tournament_terminal_fee_receipt(p_tournament_id) END;
  v_deferred:=COALESCE(v_accounting->>'status'='banked_accrual_deferred',false);
  v_custody:=v_h.accounting_state='fee_custody_unresolved';
  v_resolved:=v_custody AND COALESCE((v_accounting->>'accounting_complete')::boolean,false);
  IF v_h.accounting_state IS DISTINCT FROM COALESCE(v_accounting->>'status','legacy')
     OR (v_accounting IS NOT NULL AND v_h.receipt_version<>CASE WHEN v_custody THEN 3 ELSE 2 END) THEN
    RAISE EXCEPTION 'terminal accounting state has no exact durable receipt' USING ERRCODE='P0404';
  END IF;
  IF p_observed_winner_id IS NOT NULL
     AND v_h.winner_id IS DISTINCT FROM p_observed_winner_id THEN
    RAISE EXCEPTION 'tournament % receipt winner % differs from observed winner %',
      p_tournament_id, v_h.winner_id, p_observed_winner_id
      USING ERRCODE = '55000';
  END IF;

  SELECT t.id,t.status,t.variant,t.tournament_type,t.satellite_target_id,
         t.satellite_target,t.prize_pool,t.bounty_pool,t.bounty_pool_paid,
         t.is_bounty,t.is_pko,t.is_mystery_bounty,t.mystery_bounty_stage,
         t.mystery_bounty_pool_cents,t.club_id,t.ended_at,t.on_break,
         t.break_started_at,t.break_ends_at
    INTO v_t FROM public.tournaments t
   WHERE t.id = p_tournament_id;
  IF v_t.id IS NULL THEN
    RAISE EXCEPTION 'terminal receipt lost tournament %', p_tournament_id
      USING ERRCODE = 'P0404';
  END IF;
  IF lower(COALESCE(v_t.variant::text, '')) = 'satellite'
     OR upper(COALESCE(v_t.tournament_type::text, '')) = 'SATELLITE'
     OR v_t.satellite_target_id IS NOT NULL
     OR v_t.satellite_target IS NOT NULL THEN
    RAISE EXCEPTION 'terminal receipt % belongs to a satellite', p_tournament_id
      USING ERRCODE = 'P0404';
  END IF;
  IF upper(COALESCE(v_t.status::text, '')) <> 'COMPLETED'
     OR v_t.ended_at IS DISTINCT FROM v_h.completed_at
     OR COALESCE(v_t.on_break, false)
     OR v_t.break_started_at IS NOT NULL
     OR v_t.break_ends_at IS NOT NULL THEN
    RAISE EXCEPTION 'tournament % is not durably closed by its receipt',
      p_tournament_id USING ERRCODE = '55000';
  END IF;

  -- Every mutable child carries the same tuple-owned close fact. This makes a
  -- replay prove the synchronous marker transition itself, while queued
  -- writers can reject from OLD after a row-lock wait without relying on a
  -- pre-wait statement snapshot of the parent or receipt.
  IF EXISTS (SELECT 1 FROM public.tournament_players x
              WHERE x.tournament_id=p_tournament_id
                AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_obligations x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_payouts x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_rake_settlements x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.rake_records x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_bounty_chests x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_guarantee_overlays x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (
       SELECT 1 FROM public.table_seats s
       JOIN public.tables tb ON tb.id=s.table_id
        WHERE tb.tournament_id=p_tournament_id
          AND s.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.wallet_transactions x
                 WHERE x.related_entity_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (
       SELECT 1 FROM public.tournament_bounty_award_recipients r
       JOIN public.tournament_bounty_awards a ON a.id=r.award_id
        WHERE a.tournament_id=p_tournament_id
          AND r.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.tournament_escrow x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at)
     OR EXISTS (SELECT 1 FROM public.spin_reserve_ledger x
                 WHERE x.tournament_id=p_tournament_id
                   AND x.kind NOT IN ('contribution','jackpot_draw','draw_reversal','contribution_reversal')
                   AND x.terminal_closed_at IS DISTINCT FROM v_h.completed_at) THEN
    RAISE EXCEPTION 'tournament % mutable evidence lacks its exact terminal marker',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Table closure is money-adjacent terminal state, not an asynchronous UI
  -- cleanup. The immutable identities prove that no tournament table vanished,
  -- appeared or reopened after this receipt and that every seat released by
  -- the terminal transaction still has its exact terminal state.
  SELECT COALESCE(array_agg(tb.id ORDER BY tb.id),ARRAY[]::uuid[]),count(*)
    INTO v_durable_table_ids,v_durable_table_count
    FROM public.tables tb
   WHERE tb.tournament_id = p_tournament_id;
  SELECT COALESCE(array_agg(s.id ORDER BY s.id),ARRAY[]::uuid[]),count(*)
    INTO v_durable_seat_ids,v_durable_seat_count
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id;
  SELECT count(*) INTO v_durable_released_count
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id
     AND s.id = ANY(v_h.released_seat_ids)
     AND s.left_at IS NOT DISTINCT FROM v_h.completed_at
     AND COALESCE(s.status,'') = 'left'
     AND COALESCE(s.leave_pending,false) IS FALSE
     AND COALESCE(s.is_sitting_out,false) IS FALSE;
  IF v_durable_table_ids IS DISTINCT FROM v_h.closed_table_ids
     OR v_durable_table_count IS DISTINCT FROM v_h.closed_table_count
     OR v_durable_seat_ids IS DISTINCT FROM v_h.source_seat_ids
     OR v_durable_seat_count IS DISTINCT FROM v_h.source_seat_count
     OR v_durable_released_count IS DISTINCT FROM v_h.released_seat_count
     OR EXISTS (
       SELECT 1 FROM public.tables tb
        WHERE tb.tournament_id = p_tournament_id
          AND (lower(COALESCE(tb.status::text,'')) <> 'closed'
            OR lower(COALESCE(tb.lifecycle,'')) <> 'closed'
            OR tb.current_players IS DISTINCT FROM 0
            OR tb.terminal_closed_at IS DISTINCT FROM v_h.completed_at))
     OR EXISTS (
       SELECT 1
         FROM public.table_seats s
         JOIN public.tables tb ON tb.id = s.table_id
        WHERE tb.tournament_id = p_tournament_id
          AND (s.left_at IS NULL
            OR s.status IS DISTINCT FROM 'left'
            OR s.terminal_closed_at IS DISTINCT FROM v_h.completed_at
            OR s.leave_pending IS DISTINCT FROM false
            OR s.is_sitting_out IS DISTINCT FROM false
            OR s.is_away IS DISTINCT FROM false
            OR s.sit_out_at IS NOT NULL
            OR s.scheduled_leave_hands IS NOT NULL)) THEN
    RAISE EXCEPTION 'tournament % table or seat closure differs from its immutable receipt',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  IF v_t.prize_pool IS NULL
     OR v_t.prize_pool::text IN ('NaN','Infinity','-Infinity')
     OR round(v_t.prize_pool,2) IS DISTINCT FROM v_h.prize_pool
     OR v_t.bounty_pool IS NULL
     OR v_t.bounty_pool::text IN ('NaN','Infinity','-Infinity')
     OR round(v_t.bounty_pool,2) IS DISTINCT FROM v_h.bounty_pool THEN
    RAISE EXCEPTION 'tournament % pools differ from its immutable receipt',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE tp.status::text = 'winner'
                            AND tp.position = 1)
    INTO v_roster_count,v_winner_count
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id;
  IF v_roster_count < 1 OR v_winner_count <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND tp.user_id = v_h.winner_id
          AND tp.status::text = 'winner' AND tp.position = 1
          AND tp.eliminated_at IS NULL
          AND tp.elimination_sequence IS NULL)
     OR (SELECT count(tp.position) FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id) <> v_roster_count
     OR (SELECT count(DISTINCT tp.position) FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id) <> v_roster_count
     OR (SELECT min(tp.position) FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id) <> 1
     OR (SELECT max(tp.position) FROM public.tournament_players tp
          WHERE tp.tournament_id = p_tournament_id) <> v_roster_count
     OR EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND tp.status::text NOT IN ('winner','eliminated')) THEN
    RAISE EXCEPTION 'tournament % has ambiguous or incomplete final standings',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF jsonb_typeof(v_h.cash_receipt->'payouts') <> 'array'
     OR COALESCE((v_h.cash_receipt->>'ok')::boolean,false) IS NOT TRUE
     OR COALESCE((v_h.cash_receipt->>'fully_settled')::boolean,false) IS NOT TRUE
     OR upper(COALESCE(v_h.cash_receipt->>'status','')) <> 'COMPLETING'
     OR v_h.cash_receipt->>'winner_amount' IS NULL
     OR (v_h.cash_receipt->>'winner_amount')::numeric < 0
     OR (v_h.cash_receipt->>'winner_amount')::numeric IS DISTINCT FROM
          round((v_h.cash_receipt->>'winner_amount')::numeric,2)
     OR (v_h.settlement_mode = 'final_table_deal'
         AND v_h.cash_receipt->>'money_path'
               IS DISTINCT FROM 'fn_settle_tournament_final_table_deal') THEN
    RAISE EXCEPTION 'tournament % stored a malformed cash authority receipt',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF to_regprocedure('smarter_private.breakfast_standings_witness(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT smarter_private.breakfast_standings_witness($1,$2)' INTO v_original_witness USING p_tournament_id,v_h.winner_id;
  END IF;
  IF NULLIF(v_h.cash_receipt->'original_witness','null'::jsonb) IS DISTINCT FROM NULLIF(v_original_witness,'null'::jsonb) THEN
    RAISE EXCEPTION 'terminal cash original witness disagrees with immutable standings' USING ERRCODE='P0404';
  END IF;
  v_spin_original:=public.fn_ca_sep8_spin_original_fee_proof(p_tournament_id);
  IF to_regprocedure('smarter_private.spin_original_standings_witness(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(smarter_private.spin_original_standings_witness($1,$2),smarter_private.spin_archived_first_standings($1,$2))' INTO v_spin_witness USING p_tournament_id,v_h.winner_id;
  END IF;
  IF (v_spin_original IS NOT NULL AND jsonb_typeof(v_spin_witness) IS DISTINCT FROM 'object')
    OR NULLIF(v_h.cash_receipt->'original_standings','null'::jsonb) IS DISTINCT FROM NULLIF(v_spin_witness,'null'::jsonb) THEN
    RAISE EXCEPTION 'terminal cash original Spin standings disagree with immutable authority' USING ERRCODE='P0404';
  END IF;
  SELECT (p->>'user_id')::uuid,(p->>'amount')::numeric
    INTO v_raw_winner_id,v_raw_winner_amount
    FROM jsonb_array_elements(v_h.cash_receipt->'payouts') p
   WHERE (p->>'place')::integer = 1;
  IF v_raw_winner_id IS DISTINCT FROM v_h.winner_id
     OR v_raw_winner_amount IS DISTINCT FROM
          (v_h.cash_receipt->>'winner_amount')::numeric
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_h.cash_receipt->'payouts') p
        WHERE p->>'place' IS NULL OR p->>'user_id' IS NULL
           OR p->>'amount' IS NULL
           OR (p->>'place')::integer < 1
           OR (p->>'amount')::numeric < 0
           OR (p->>'amount')::numeric IS DISTINCT FROM
                round((p->>'amount')::numeric,2)
           OR NOT EXISTS (
             SELECT 1 FROM public.tournament_players tp
              WHERE tp.tournament_id = p_tournament_id
                AND tp.position = (p->>'place')::integer
                AND tp.user_id = (p->>'user_id')::uuid))
     OR (SELECT count(*) FROM jsonb_array_elements(v_h.cash_receipt->'payouts')) < 1
     OR (SELECT count(DISTINCT (p->>'place')::integer)
           FROM jsonb_array_elements(v_h.cash_receipt->'payouts') p)
          <> (SELECT count(*) FROM jsonb_array_elements(v_h.cash_receipt->'payouts')) THEN
    RAISE EXCEPTION 'tournament % cash receipt does not name exact finishers',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  -- Satellite and bounty records never consume the ordinary prize pool.
  IF EXISTS (
    SELECT 1 FROM public.tournament_payouts p
     WHERE p.tournament_id = p_tournament_id
       AND p.source IN ('satellite_seat','satellite_ticket','satellite_remainder')
  ) THEN
    RAISE EXCEPTION 'non-satellite tournament % carries satellite payout evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  SELECT count(*),round(COALESCE(sum(p.amount),0),2)
    INTO v_cash_count,v_cash_total
    FROM public.tournament_payouts p
   WHERE p.tournament_id = p_tournament_id
     AND p.source NOT IN (
       'bounty','bounty_residual','own_bounty','mystery_bounty',
       'mystery_bounty_residual','satellite_seat','satellite_ticket',
       'satellite_remainder');
  IF v_cash_count IS DISTINCT FROM v_h.cash_payout_count
     OR v_cash_total IS DISTINCT FROM v_h.cash_payout_total
     OR v_cash_total IS DISTINCT FROM v_h.prize_pool
     OR EXISTS (
       SELECT 1 FROM public.tournament_payouts p
        WHERE p.tournament_id = p_tournament_id
          AND p.source NOT IN (
            'bounty','bounty_residual','own_bounty','mystery_bounty',
            'mystery_bounty_residual','satellite_seat','satellite_ticket',
            'satellite_remainder')
          AND (p.amount IS NULL
            OR p.amount::text IN ('NaN','Infinity','-Infinity')
            OR p.amount <= 0 OR p.amount IS DISTINCT FROM round(p.amount,2)
            OR p.idempotency_key IS NULL OR NOT EXISTS (
              SELECT 1 FROM public.wallet_credit_idempotency k
               WHERE k.key = p.idempotency_key
                 AND k.user_id = p.user_id AND k.amount = p.amount))) THEN
    RAISE EXCEPTION 'tournament % cash payout evidence is incomplete or malformed',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'place',q.place,'user_id',q.user_id,'amount',q.amount)
           ORDER BY q.place,q.user_id),'[]'::jsonb)
    INTO v_durable_payouts
    FROM (
      SELECT tp.position AS place,p.user_id,round(sum(p.amount),2) AS amount
        FROM public.tournament_payouts p
        JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id AND tp.user_id = p.user_id
       WHERE p.tournament_id = p_tournament_id
         AND p.source <> 'bubble_protection'
         AND p.source NOT IN (
           'bounty','bounty_residual','own_bounty','mystery_bounty',
           'mystery_bounty_residual','satellite_seat','satellite_ticket',
           'satellite_remainder')
       GROUP BY tp.position,p.user_id
    ) q;
  IF v_h.prize_pool = 0 AND v_durable_payouts = '[]'::jsonb THEN
    -- A zero-cash event has a real winner and no wallet/payout mutation. Keep
    -- that explicit standings line in the receipt without inventing durable
    -- payment evidence.
    v_durable_payouts := jsonb_build_array(jsonb_build_object(
      'place',1,'user_id',v_h.winner_id,'amount',0));
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'place',q.place,'user_id',q.user_id,'amount',q.amount)
           ORDER BY q.place,q.user_id),'[]'::jsonb)
    INTO v_durable_deal_shares
    FROM (
      SELECT tp.position AS place,p.user_id,round(sum(p.amount),2) AS amount
        FROM public.tournament_payouts p
        JOIN public.tournament_players tp
          ON tp.tournament_id = p_tournament_id AND tp.user_id = p.user_id
       WHERE p.tournament_id = p_tournament_id
         AND p.source = 'final_table_deal'
       GROUP BY tp.position,p.user_id
    ) q;
  -- Match the terminal writer's one-recipient receipt across every verified
  -- partial credit interval. The exact credit-key and total checks still apply.
  IF (SELECT count(DISTINCT p.user_id) FROM public.tournament_payouts p
       WHERE p.tournament_id = p_tournament_id
         AND p.source = 'bubble_protection') > 1 THEN
    RAISE EXCEPTION 'tournament % has multiple durable bubble payout recipients',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;
  SELECT jsonb_build_object(
           'user_id',p.user_id,'position',tp.position,'amount',round(sum(p.amount),2))
    INTO v_durable_bubble
    FROM public.tournament_payouts p
    JOIN public.tournament_players tp
      ON tp.tournament_id = p_tournament_id AND tp.user_id = p.user_id
   WHERE p.tournament_id = p_tournament_id
     AND p.source = 'bubble_protection'
   GROUP BY p.user_id,tp.position;
  v_durable_bubble := COALESCE(v_durable_bubble,'null'::jsonb);
  IF v_h.cash_receipt->'payouts' IS DISTINCT FROM v_durable_payouts
     OR jsonb_typeof(v_h.cash_receipt->'deal_shares') <> 'array'
     OR v_h.cash_receipt->'deal_shares' IS DISTINCT FROM
          (CASE WHEN v_h.settlement_mode = 'final_table_deal'
                THEN v_durable_deal_shares ELSE '[]'::jsonb END)
     OR COALESCE(v_h.cash_receipt->'bubble_protection','null'::jsonb)
          IS DISTINCT FROM v_durable_bubble
     OR ((SELECT round(COALESCE(sum((p->>'amount')::numeric),0),2)
            FROM jsonb_array_elements(v_durable_payouts) p)
         + (CASE WHEN v_durable_bubble = 'null'::jsonb THEN 0
                 ELSE (v_durable_bubble->>'amount')::numeric END))
          IS DISTINCT FROM v_h.cash_payout_total THEN
    RAISE EXCEPTION
      'tournament % stored cash lines differ from complete durable payout evidence',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT round(COALESCE(sum(o.amount_paid),0),2)
    INTO v_cash_obligation_total
    FROM public.tournament_obligations o
   WHERE o.tournament_id = p_tournament_id
     AND o.kind IN ('place','bubble_protection','final_table_deal');
  IF v_cash_obligation_total IS DISTINCT FROM v_h.prize_pool
     OR EXISTS (
       SELECT 1 FROM public.tournament_obligations o
        WHERE o.tournament_id = p_tournament_id
          AND (o.amount_owed IS NULL OR o.amount_paid IS NULL
            OR o.amount_owed::text IN ('NaN','Infinity','-Infinity')
            OR o.amount_paid::text IN ('NaN','Infinity','-Infinity')
            OR o.amount_owed < 0 OR o.amount_paid < 0
            OR o.amount_owed IS DISTINCT FROM round(o.amount_owed,2)
            OR o.amount_paid IS DISTINCT FROM round(o.amount_paid,2)
            OR o.amount_paid IS DISTINCT FROM o.amount_owed
            OR o.settled_at IS NULL)) THEN
    RAISE EXCEPTION 'tournament % has incomplete or malformed obligations',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT round(COALESCE(sum(w.amount),0),2)
    INTO v_bounty_total
    FROM public.wallet_transactions w
   WHERE w.related_entity_id = p_tournament_id AND lower(w.category) = 'bounty';
  -- DIAMOND PHASE 9: a Diamond bounty is a ledger row, not a wallet row.
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    SELECT e.bounty_out INTO v_bounty_total
      FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id) e;
  END IF;
  IF v_bounty_total IS DISTINCT FROM v_h.bounty_payout_total
     OR v_bounty_total IS DISTINCT FROM v_h.bounty_pool
     OR EXISTS (
       SELECT 1 FROM public.wallet_transactions w
        WHERE w.related_entity_id = p_tournament_id
          AND lower(w.category) = 'bounty'
          AND (lower(w.type) <> 'credit' OR w.amount <= 0
            OR w.amount::text IN ('NaN','Infinity','-Infinity')
            OR w.amount IS DISTINCT FROM round(w.amount,2)))
     OR COALESCE(v_t.bounty_pool_paid,0) IS DISTINCT FROM v_h.bounty_pool
     OR EXISTS (
       SELECT 1 FROM public.tournament_players tp
        WHERE tp.tournament_id = p_tournament_id
          AND COALESCE(tp.current_bounty,0) <> 0) THEN
    RAISE EXCEPTION 'tournament % bounty pool is underfunded, overfunded or still open',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF v_h.bounty_pool > 0 THEN
    IF NOT (COALESCE(v_t.is_bounty,false) OR COALESCE(v_t.is_pko,false)
            OR COALESCE(v_t.is_mystery_bounty,false))
       OR COALESCE((v_h.bounty_receipt->>'ok')::boolean,false) IS NOT TRUE
       OR COALESCE((v_h.bounty_receipt->>'funded')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'tournament % bounty receipt is not a funded close',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  ELSIF COALESCE(v_t.is_bounty,false) OR COALESCE(v_t.is_pko,false)
        OR COALESCE(v_t.is_mystery_bounty,false)
        OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                    WHERE o.tournament_id = p_tournament_id
                      AND o.kind IN ('bounty','bounty_residual','mystery_bounty'))
        OR EXISTS (SELECT 1 FROM public.tournament_bounty_chests c
                    WHERE c.tournament_id = p_tournament_id)
        OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards a
                    WHERE a.tournament_id = p_tournament_id) THEN
    RAISE EXCEPTION 'ordinary tournament % carries unfunded bounty state',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  IF v_h.mystery_was_active THEN
    v_mystery_evidence :=
      public.fn_ca_mystery_bounty_completion_evidence(
        p_tournament_id,v_h.winner_id);
    IF COALESCE(v_t.is_mystery_bounty,false) IS NOT TRUE
       OR v_t.mystery_bounty_stage IS DISTINCT FROM 'complete'
       OR COALESCE(v_t.mystery_bounty_pool_cents,0)
            IS DISTINCT FROM v_h.mystery_pool_cents
       OR COALESCE((v_h.mystery_receipt->>'ok')::boolean,false) IS NOT TRUE
       OR COALESCE((v_h.mystery_receipt->>'balanced')::boolean,false) IS NOT TRUE
       OR COALESCE((v_h.mystery_receipt->>'pool_cents')::bigint,-1)
            IS DISTINCT FROM v_h.mystery_pool_cents
       OR COALESCE((v_h.mystery_receipt->>'settled_cents')::bigint,-1)
            IS DISTINCT FROM v_h.mystery_pool_cents
       OR (SELECT COALESCE(sum(c.amount_cents),0)
             FROM public.tournament_bounty_chests c
            WHERE c.tournament_id = p_tournament_id)
            IS DISTINCT FROM v_h.mystery_pool_cents
       OR v_h.mystery_receipt->'payment_evidence'
            IS DISTINCT FROM v_mystery_evidence
       OR COALESCE((v_h.mystery_receipt->>'residual_paid_cents')::bigint,-1)
            IS DISTINCT FROM
              COALESCE((v_mystery_evidence->>'void_chest_cents')::bigint,0)
       OR EXISTS (SELECT 1 FROM public.tournament_bounty_chests c
                   WHERE c.tournament_id = p_tournament_id
                     AND c.status NOT IN ('paid','void'))
       OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards a
                   WHERE a.tournament_id = p_tournament_id
                     AND a.status NOT IN ('completed','void'))
       OR EXISTS (
         SELECT 1 FROM public.tournament_bounty_awards a
          WHERE a.tournament_id = p_tournament_id
            AND ((a.status = 'completed' AND (
                  a.paid_at IS NULL OR
                  (SELECT COALESCE(sum(r.amount_cents),0)
                     FROM public.tournament_bounty_award_recipients r
                    WHERE r.award_id = a.id) <> a.amount_cents OR
                  EXISTS (SELECT 1
                            FROM public.tournament_bounty_award_recipients r
                           WHERE r.award_id = a.id
                             AND r.amount_cents > 0 AND r.paid_at IS NULL)))
              OR (a.status = 'void' AND EXISTS (
                  SELECT 1 FROM public.tournament_bounty_award_recipients r
                   WHERE r.award_id = a.id AND r.paid_at IS NOT NULL)))) THEN
      RAISE EXCEPTION 'tournament % has open or inconsistent mystery bounty evidence',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  ELSE
    IF v_h.mystery_pool_cents <> 0
       OR COALESCE(v_h.mystery_receipt->>'reason','')
            NOT IN ('never_activated','not_a_mystery_tournament')
       OR EXISTS (SELECT 1 FROM public.tournament_bounty_chests c
                   WHERE c.tournament_id = p_tournament_id)
       OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards a
                   WHERE a.tournament_id = p_tournament_id) THEN
      RAISE EXCEPTION 'tournament % stored an invalid non-active mystery close',
        p_tournament_id USING ERRCODE = 'P0404';
    END IF;
  END IF;

  SELECT * INTO v_e FROM public.tournament_escrow e
   WHERE e.tournament_id = p_tournament_id;
  IF v_e.tournament_id IS NULL
     OR v_e.prize_balance IS DISTINCT FROM 0::numeric
     OR v_e.bounty_balance IS DISTINCT FROM 0::numeric
     OR v_e.fee_balance IS DISTINCT FROM (CASE WHEN v_custody AND NOT v_resolved THEN v_h.rake_amount ELSE 0::numeric END)
     OR v_e.closed_at IS DISTINCT FROM v_h.escrow_closed_at
     OR v_e.close_note IS DISTINCT FROM v_h.escrow_close_note THEN
    RAISE EXCEPTION 'tournament % escrow is not an exact durable zero close',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  SELECT round(COALESCE(sum(rr.rake_amount),0),2) INTO v_rake_total
    FROM public.rake_records rr
   WHERE rr.tournament_id = p_tournament_id AND rr.is_tournament;
  IF public.fn_poker_diamond_tournament(p_tournament_id) THEN
    -- DIAMOND PHASE 8: a Diamond event's fee is its fee bank, settled to the house.
    SELECT e.fee_balance + e.fee_out INTO v_rake_total
      FROM public.fn_poker_diamond_tournament_escrow(p_tournament_id) e;
  END IF;
  IF v_custody THEN
    IF v_accounting->>'status' IS DISTINCT FROM 'fee_custody_unresolved'
      OR (v_accounting->>'held_amount')::numeric IS DISTINCT FROM v_h.rake_amount
      OR v_h.rake_amount IS DISTINCT FROM v_rake_total
      OR v_h.rake_destination IS DISTINCT FROM 'tournament_escrow'
      OR v_h.rake_settled_at IS NOT NULL OR v_h.rake_attributed_at IS NOT NULL
      OR v_h.rake_attributed_users IS DISTINCT FROM 0 OR v_h.escrow_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'terminal unresolved fee proof disagrees with original custody' USING ERRCODE='P0404';
    END IF;
  ELSE
  SELECT rs.* INTO v_r FROM public.tournament_rake_settlements rs
   WHERE rs.tournament_id = p_tournament_id;
  IF v_r.tournament_id IS NULL
     OR v_r.amount IS DISTINCT FROM v_rake_total
     OR v_r.amount IS DISTINCT FROM v_h.rake_amount
     OR v_r.destination IS DISTINCT FROM v_h.rake_destination
     OR v_r.settled_at IS DISTINCT FROM v_h.rake_settled_at
     OR v_r.attributed_at IS DISTINCT FROM v_h.rake_attributed_at
     OR v_r.attributed_users IS DISTINCT FROM v_h.rake_attributed_users
     OR v_r.attributed_users IS NULL OR v_r.attributed_users < 0
     OR (v_r.attribution_error IS NOT NULL AND NOT v_deferred)
     OR lower(v_r.destination) IN ('pending','')
     OR (v_r.amount > 0 AND v_t.club_id IS NOT NULL AND NOT public.fn_poker_diamond_tournament(p_tournament_id) AND NOT v_deferred
         AND (v_r.attributed_users < 1
           OR v_r.destination NOT LIKE 'union:%'
              AND v_r.destination NOT LIKE 'chip_retirement:%'
              AND NOT (v_h.receipt_version=1 AND v_h.accounting_state='legacy'
                       AND v_r.destination LIKE 'club_treasury:%'))) THEN
    RAISE EXCEPTION 'tournament % rake is not durably and successfully attributed',
      p_tournament_id USING ERRCODE = 'P0404';
  END IF;

  END IF;

  v_bubble := CASE WHEN v_h.cash_receipt ? 'bubble_protection'
                    THEN v_h.cash_receipt->'bubble_protection'
                   ELSE 'null'::jsonb END;

  RETURN jsonb_build_object(
    'ok',true,
    'fully_settled',NOT v_custody OR v_resolved,
    'player_result','final',
    'accounting_complete',(NOT v_custody AND NOT v_deferred) OR v_resolved,
    'accounting_state',CASE WHEN v_resolved THEN 'recognized' ELSE v_h.accounting_state END,
    'status','COMPLETED',
    'tournament_id',v_h.tournament_id,
    'winner_id',v_h.winner_id,
    'mode',v_h.settlement_mode,
    'settlement_mode',v_h.settlement_mode,
    'payouts',v_h.cash_receipt->'payouts',
    'deal_shares',v_h.cash_receipt->'deal_shares',
    'winner_amount',(v_h.cash_receipt->>'winner_amount')::numeric,
    'bubble_protection',v_bubble,
    'cash',v_h.cash_receipt,
    'mystery_bounty',v_h.mystery_receipt,
    'bounty',v_h.bounty_receipt,
    'closed_table_count',v_h.closed_table_count,
    'source_seat_count',v_h.source_seat_count,
    'released_seat_count',v_h.released_seat_count,
    'table_closure',jsonb_build_object(
      'closed_table_count',v_h.closed_table_count,
      'closed_table_ids',to_jsonb(v_h.closed_table_ids),
      'source_seat_count',v_h.source_seat_count,
      'source_seat_ids',to_jsonb(v_h.source_seat_ids),
      'released_seat_count',v_h.released_seat_count,
      'released_seat_ids',to_jsonb(v_h.released_seat_ids)),
    'rake',jsonb_build_object(
      'amount',v_h.rake_amount,
      'destination',v_h.rake_destination,
      'attributed',NOT (v_deferred OR v_custody),
      'accounting',v_accounting,
      'attributed_users',v_h.rake_attributed_users,
      'settled_at',v_h.rake_settled_at,
      'attributed_at',v_h.rake_attributed_at),
    'escrow',jsonb_build_object(
      'prize_balance',v_e.prize_balance,
      'bounty_balance',v_e.bounty_balance,
      'fee_balance',v_e.fee_balance,
      'closed_at',v_h.escrow_closed_at,
      'close_note',v_h.escrow_close_note),
    'cash_payout_total',v_h.cash_payout_total,
    'bounty_payout_total',v_h.bounty_payout_total,
    'receipt_version',v_h.receipt_version,
    'settled_at',v_h.settled_at);
END;
$function$;
-- Preserve the installed owner-only readers/triggers and service cancellation.
REVOKE ALL ON FUNCTION public.atomic_cancel_tournament(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.atomic_cancel_tournament(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_stamp_tournament_terminal_evidence_markers()
  FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fn_ca_tournament_terminal_receipt(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
