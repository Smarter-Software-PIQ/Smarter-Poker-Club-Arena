CREATE OR REPLACE FUNCTION public.atomic_table_addon_before_maintenance_announcement_gate(p_user_id uuid, p_table_id uuid, p_amount numeric, p_apply_to_seat boolean DEFAULT true, p_idempotency_key text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original_ledger uuid; v_original_wallet uuid; v_original_pending uuid; v_new_balance numeric; v_claimed integer; v_seat_club uuid; v_seat_rows integer;
        v_stack numeric; v_max numeric;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Add-on amount must be positive';
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Cannot add on for another user';
  END IF;

  PERFORM set_config('app.ledger_category', 'addon', true);
  PERFORM set_config('app.ledger_counterparty', 'table_stack', true);
  PERFORM set_config('app.ledger_counterparty_entity', COALESCE(p_table_id::text, ''), true);

  SELECT ts.club_id, ts.stack INTO v_seat_club, v_stack
    FROM table_seats ts
   WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id AND ts.left_at IS NULL
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player not seated at this table'; END IF;

  /* CHIP CONTINUITY (A0.17, I2): the table maximum is a hard ceiling in the
     database as well as in the engine. Between hands the chips land on the
     seat here; mid-hand resolve_pending_addon already caps at delivery. */
  IF p_apply_to_seat THEN
    SELECT t.max_buy_in INTO v_max FROM tables t WHERE t.id = p_table_id;
    IF v_max IS NOT NULL AND v_max > 0 AND COALESCE(v_stack, 0) + p_amount > v_max THEN
      RAISE EXCEPTION 'BUYIN_ABOVE_MAX: add-on of % would take the stack above the table maximum (%)', p_amount, v_max;
    END IF;
  END IF;

  IF v_seat_club IS NULL THEN
    v_seat_club := public.fn_seat_club_for_user(p_user_id, p_table_id, NULL);
  END IF;
  IF v_seat_club IS NULL THEN
    RAISE EXCEPTION 'No club wallet resolves for this add-on';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO table_addon_idempotency (key, user_id, table_id, amount, applied_to_seat)
    VALUES (p_idempotency_key, p_user_id, p_table_id, p_amount, p_apply_to_seat)
    ON CONFLICT (key) DO NOTHING;
    GET DIAGNOSTICS v_claimed = ROW_COUNT;
    IF v_claimed = 0 THEN
      SELECT chip_balance INTO v_new_balance FROM club_members
       WHERE user_id = p_user_id AND club_id = v_seat_club;
      RETURN v_new_balance;
    END IF;
  END IF;

  PERFORM public.fn_ensure_club_wallet(p_user_id, v_seat_club);

  PERFORM set_config('app.cash_original_debit_ledger','',true);
  UPDATE club_members
     SET chip_balance = chip_balance - p_amount, updated_at = NOW()
   WHERE user_id = p_user_id AND club_id = v_seat_club AND chip_balance >= p_amount
   RETURNING chip_balance INTO v_new_balance;
  v_original_ledger:=NULLIF(current_setting('app.cash_original_debit_ledger',true),'')::uuid;
  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient club chips for add-on (club %)', v_seat_club;
  END IF;

  IF p_apply_to_seat THEN
    UPDATE table_seats SET stack = stack + p_amount
     WHERE table_id = p_table_id AND user_id = p_user_id AND left_at IS NULL;
    GET DIAGNOSTICS v_seat_rows = ROW_COUNT;
    IF v_seat_rows = 0 THEN
      RAISE EXCEPTION
        'Add-on of % could not be applied: seat vacated mid-add-on (table %, player %)',
        p_amount, p_table_id, p_user_id;
    END IF;
    -- CHIP CONTINUITY: chips landed on the seat -> baseline rises with them.
    PERFORM public.fn_cash_session_add_baseline(p_user_id, p_table_id, p_amount);
  ELSE
    INSERT INTO table_pending_addons (table_id, user_id, amount)
    VALUES (p_table_id, p_user_id, p_amount) RETURNING id INTO v_original_pending;
  END IF;

  INSERT INTO wallet_transactions
    (user_id, wallet_type, type, amount, category, description, table_id, balance_after)
    VALUES (p_user_id, 'PLAYER', 'debit', p_amount, 'addon',
            'Table add-on (club wallet)', p_table_id, v_new_balance) RETURNING id INTO v_original_wallet;

  PERFORM public.fn_cash_record_original_funding('addon',p_idempotency_key::text,p_user_id,p_table_id,
    v_original_ledger,v_original_wallet,v_seat_club,p_amount,v_new_balance,v_original_pending);

  RETURN v_new_balance;
END;
$function$;
CREATE OR REPLACE FUNCTION public.resolve_pending_addon(p_pending_id uuid, p_max_buy_in numeric DEFAULT NULL::numeric)
 RETURNS TABLE(applied numeric, refunded numeric, was_resolved boolean)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_original_occupancy uuid;
  v_row        table_pending_addons%ROWTYPE;
  v_stack      numeric;
  v_headroom   numeric;
  v_applied    numeric := 0;
  v_refunded   numeric := 0;
  v_credit     numeric := 0;
BEGIN
  SELECT * INTO v_row
    FROM table_pending_addons
   WHERE id = p_pending_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending add-on % not found', p_pending_id;
  END IF;

  IF v_row.resolved_at IS NOT NULL THEN
    applied      := COALESCE(v_row.applied_to_stack, 0);
    refunded     := COALESCE(v_row.refunded, 0);
    was_resolved := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT stack INTO v_stack
    FROM table_seats
   WHERE table_id = v_row.table_id
     AND user_id  = v_row.user_id
     AND left_at IS NULL
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Seat vacated: the whole debit comes back. Exact, not rounded, so the
    -- receipt still sums to the stored amount for a historical dusty row.
    v_applied  := 0;
    v_refunded := v_row.amount;
  ELSE
    IF p_max_buy_in IS NULL THEN
      v_applied := v_row.amount;
    ELSE
      v_headroom := GREATEST(round(COALESCE(p_max_buy_in, 0), 2) - COALESCE(v_stack, 0), 0);
      v_applied  := LEAST(v_row.amount, v_headroom);
    END IF;

    -- ROUND THE APPLIED SIDE FIRST, THEN DERIVE THE REFUND FROM THE STORED
    -- AMOUNT. It used to be the other way round - `refunded := ROUND(amount -
    -- applied, 2)` against an UNROUNDED applied - so the two summed to the
    -- amount only when the amount was already 2 dp. That is what makes a
    -- non-cent row unresolvable against the post-commit obligation check,
    -- rather than merely untidy. This ordering holds for every input.
    v_applied  := round(v_applied, 2);
    IF v_applied > v_row.amount THEN
      v_applied := v_row.amount;   -- rounding up may never exceed the debit
    END IF;
    v_refunded := v_row.amount - v_applied;

    IF v_applied > 0 THEN
      UPDATE table_seats
         SET stack = COALESCE(stack, 0) + v_applied
       WHERE table_id = v_row.table_id
         AND user_id  = v_row.user_id
         AND left_at IS NULL RETURNING occupancy_id INTO v_original_occupancy;
      -- CHIP CONTINUITY (I10): a reload in place is not a leave; the baseline
      -- rises by what was delivered, never by what was refunded.
      PERFORM public.fn_cash_session_add_baseline(v_row.user_id, v_row.table_id, v_applied);
    END IF;
  END IF;

  -- The wallet moves in hundredths (its column is numeric(20,2) and would
  -- round this anyway); the RECEIPT below stays exact so the obligation
  -- check can always reconcile it against the stored amount.
  v_credit := round(v_refunded, 2);
  IF v_credit > 0 THEN
    PERFORM atomic_credit_wallet_and_log(
      v_row.user_id,
      v_credit,
      'addon_refund',
      'Add-on refund (exceeds max buy-in or seat vacated)',
      v_row.table_id,
      NULL::uuid,
      NULL::uuid,
      'addon_refund:' || v_row.id::text
    );
  END IF;

  UPDATE table_pending_addons
     SET resolved_at      = now(),
         applied_to_stack = v_applied,
         refunded         = v_refunded
   WHERE id = v_row.id;
  PERFORM public.fn_cash_record_funding_application(v_row.id,v_applied,v_refunded,v_original_occupancy);

  applied      := v_applied;
  refunded     := v_refunded;
  was_resolved := true;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.atomic_table_rebuy_before_maintenance_announcement_gate(p_user_id uuid, p_table_id uuid, p_amount numeric, p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_original_ledger uuid; v_original_wallet uuid; v_original_pending uuid;
  v_new_balance numeric; v_club_id uuid; v_union_id uuid; v_ban_id uuid; v_seat_club uuid;
  v_seat_id uuid; v_pending uuid;
  v_context jsonb; v_setting text;
BEGIN
  -- ── A DEAD SESSION MOVES NO MONEY (Dan 2026-09-03) ────────────────────
  -- "I WAS LOGGED OUT, BUT SOMEHOW ABLE TO SIT DOWN AND BUY CHIPS AND GET
  -- DEALT A HAND. THAT CAN NEVER HAPPEN." It could, because this project
  -- issues SEVEN-DAY access tokens and PostgREST verifies a JWT locally -
  -- signature and exp only. It never asks GoTrue whether the session behind
  -- that token still exists, so signing out left a bearer token that kept
  -- spending real chips as its owner for the rest of the week. The engine
  -- was never fooled (it verifies through auth.getUser, which checks the
  -- session), only the database was. fn_caller_session_is_live closes that
  -- gap at the money door itself.
  IF NOT public.fn_caller_session_is_live() THEN
    RAISE EXCEPTION 'SESSION_REVOKED: this session is signed out - sign in again'
      USING ERRCODE = '28000';
  END IF;
  IF NOT public.fn_caller_is_engine() AND (auth.uid() IS NULL OR ( auth.uid() <> p_user_id)) THEN
    RAISE EXCEPTION 'Cannot rebuy for another player';
  END IF;

  IF p_user_id IS NULL OR p_table_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Rebuy requires a player, table and purchase key' USING ERRCODE='22023';
  END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount<=0 OR p_amount<>round(p_amount,2) THEN
    RAISE EXCEPTION 'Rebuy amount must be positive whole cents' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.transaction_idempotency_keys(key,user_id,action,amount)
  VALUES(p_idempotency_key,p_user_id,'atomic_table_rebuy',p_amount) ON CONFLICT(key) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unbound rebuy key must be resolved by the shared purchase receipt' USING ERRCODE='55000';
  END IF;

  /* ZERO-DRIFT (2026-08-31): lock the seat so it cannot vacate between this
     check and the debit below. */
  SELECT ts.id, ts.club_id INTO v_seat_id, v_seat_club
    FROM table_seats ts
   WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id AND ts.left_at IS NULL
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not seated at this table (cannot rebuy a vacated seat)';
  END IF;

  SELECT t.club_id, c.union_id INTO v_club_id, v_union_id
    FROM tables t LEFT JOIN clubs c ON c.id = t.club_id WHERE t.id = p_table_id LIMIT 1;
  IF v_club_id IS NOT NULL THEN
    SELECT id INTO v_ban_id FROM blacklists
     WHERE user_id = p_user_id AND (expires_at IS NULL OR expires_at > now())
       AND (club_id = v_club_id OR (v_union_id IS NOT NULL AND union_id = v_union_id))
     LIMIT 1;
    IF v_ban_id IS NOT NULL THEN RAISE EXCEPTION 'Banned from this club'; END IF;
  END IF;

  IF v_seat_club IS NULL THEN
    v_seat_club := public.fn_seat_club_for_user(p_user_id, p_table_id, NULL);
  END IF;
  IF v_seat_club IS NULL THEN
    RAISE EXCEPTION 'No club wallet resolves for this rebuy';
  END IF;

  SELECT jsonb_object_agg(k,coalesce(current_setting(k,true),'')) INTO v_context
   FROM unnest(array['app.money_path','app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity','app.ledger_tournament']) settings(k);
  PERFORM set_config('app.money_path','atomic_table_rebuy',true);
  PERFORM set_config('app.ledger_category','rebuy',true);
  PERFORM set_config('app.ledger_counterparty','table_stack',true);
  PERFORM set_config('app.ledger_counterparty_entity',p_table_id::text,true);
  PERFORM set_config('app.ledger_tournament','',true);
  PERFORM public.fn_ensure_club_wallet(p_user_id, v_seat_club);

  PERFORM set_config('app.cash_original_debit_ledger','',true);
  UPDATE club_members
     SET chip_balance = chip_balance - p_amount, updated_at = NOW()
   WHERE user_id = p_user_id AND club_id = v_seat_club AND chip_balance >= p_amount
   RETURNING chip_balance INTO v_new_balance;
  v_original_ledger:=NULLIF(current_setting('app.cash_original_debit_ledger',true),'')::uuid;
  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient club chips for rebuy (club %)', v_seat_club;
  END IF;

  /* CHIP STANDARD C3 (2026-09-02): the chips do NOT go onto the seat here.
     This used to be a relative `stack + p_amount` UPDATE on table_seats,
     racing the engine's absolute writes: a rebuy committing after
     loadSeatedPlayers and before the next syncStacks was erased from the felt
     while the wallet stayed debited. The debit and this row land in ONE
     transaction; the engine's resolve_pending_addon delivers the chips into its
     own memory first and only then persists, so nothing can overwrite them. */
  INSERT INTO public.table_pending_addons (table_id, user_id, amount, kind)
  VALUES (p_table_id, p_user_id, p_amount, 'rebuy')
  RETURNING id INTO v_pending;

  INSERT INTO wallet_transactions
    (user_id, wallet_type, type, amount, category, description, table_id, balance_after)
    VALUES (p_user_id, 'PLAYER', 'debit', p_amount, 'rebuy',
            'Cash game rebuy (club wallet)', p_table_id, v_new_balance) RETURNING id INTO v_original_wallet;

  PERFORM public.fn_cash_record_original_funding('rebuy',p_idempotency_key::text,p_user_id,p_table_id,
    v_original_ledger,v_original_wallet,v_seat_club,p_amount,v_new_balance,v_pending);

  FOR v_setting IN SELECT jsonb_object_keys(v_context) LOOP
    PERFORM set_config(v_setting,v_context->>v_setting,true);
  END LOOP;
  RETURN v_new_balance;
END;
$function$;
