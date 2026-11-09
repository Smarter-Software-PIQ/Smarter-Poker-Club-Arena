CREATE OR REPLACE FUNCTION public.fn_ca_horse_split_return_late_credit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_op constant uuid := '5b11c1b0-2026-1102-0000-000000000001';
  c_keys constant text[] := ARRAY['app.ledger_category', 'app.ledger_counterparty',
    'app.ledger_counterparty_entity', 'app.ledger_counterparty_label', 'app.ledger_settlement',
    'app.ledger_idempotency_key', 'app.ledger_correlation', 'app.ledger_autoskip_clubs',
    'app.ledger_autoskip_club_members'];
  v_amount numeric := coalesce(NEW.chip_balance, 0);
  v_saved text[] := ARRAY[]::text[];
  v_lock_timeout text := current_setting('lock_timeout');
  v_key uuid;
  v_bank_before numeric;
  v_bank_after numeric;
  v_after numeric;
  v_state text;
  v_message text;
  i integer;
BEGIN
  IF v_amount <= 0 OR NEW.membership_lifecycle_status IS DISTINCT FROM 'departed' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ca_horse_club_split_receipts d
                  WHERE d.operation_id = c_op AND d.kind = 'departed'
                    AND d.horse_id = NEW.user_id AND d.club_id = NEW.club_id)
     OR public.fn_ca_horse_assigned_club(NEW.user_id) IS NOT DISTINCT FROM NEW.club_id THEN
    RETURN NULL;
  END IF;

  FOR i IN 1 .. array_length(c_keys, 1) LOOP
    v_saved := v_saved || coalesce(current_setting(c_keys[i], true), '');
  END LOOP;

  BEGIN
    PERFORM set_config('lock_timeout', '200ms', true);
    v_key := md5('horse-split-late-return:' || NEW.club_id::text || ':' || NEW.user_id::text || ':'
                 || txid_current()::text || ':' || clock_timestamp()::text || ':' || v_amount::text)::uuid;
    SELECT coalesce(c.chip_treasury, 0) INTO v_bank_before FROM public.clubs c WHERE c.id = NEW.club_id FOR UPDATE;
    IF v_bank_before IS NULL THEN RAISE EXCEPTION 'horse_split_late_return_club_missing %', NEW.club_id; END IF;
    PERFORM public.fn_ca_declare_ledger('club_bank_claim', 'club_treasury', NEW.club_id, NULL,
      'club_bank_claim:' || v_key::text, ARRAY['clubs']);
    PERFORM set_config('app.ledger_correlation', v_key::text, true);
    PERFORM set_config('app.ledger_autoskip_club_members', '', true);
    UPDATE public.club_members SET chip_balance = coalesce(chip_balance, 0) - v_amount, updated_at = now()
     WHERE club_id = NEW.club_id AND user_id = NEW.user_id RETURNING chip_balance INTO v_after;
    IF v_after IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'horse_split_late_return_balance_moved % % %', NEW.club_id, NEW.user_id, v_after;
    END IF;
    UPDATE public.clubs SET chip_treasury = coalesce(chip_treasury, 0) + v_amount, updated_at = now()
     WHERE id = NEW.club_id RETURNING chip_treasury INTO v_bank_after;
    PERFORM set_config('app.ledger_autoskip_clubs', '', true);
    PERFORM set_config('app.ledger_autoskip_club_members', '', true);
    INSERT INTO public.chip_transactions(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)
    VALUES (NEW.club_id, NEW.user_id, NULL, v_amount, 'club_bank_claim',
            'Horse Club Split: Late Prize Returned To The Club Bank (Dan, 2026-11-03)',
            jsonb_build_object('op_id', v_key, 'operation', 'horse-club-split-20261102', 'operation_id', c_op,
              'leg', 'late_return', 'actor', 'horse_club_split_late_return',
              'source', 'player_wallet', 'destination', 'club_bank',
              'bank_before', v_bank_before, 'bank_after', v_bank_after,
              'holder_balance_before', v_amount, 'holder_balance_after', v_after),
            v_bank_after);
    INSERT INTO public.ca_horse_club_split_late_returns(club_id, horse_id, amount, op_id, bank_before, bank_after)
    VALUES (NEW.club_id, NEW.user_id, v_amount, v_key, v_bank_before, v_bank_after);
  EXCEPTION WHEN OTHERS THEN
    -- Everything above rolled back with this subtransaction: the credit stays
    -- on the record and fn_ca_horse_club_split_late_claims returns it later.
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
    BEGIN
      INSERT INTO public.financial_alerts(severity, source, message, context)
      VALUES ('warning', 'horse_split.late_return_deferred',
              'A late prize on a split-departed horse record stayed on the record; the split late claim returns it after its events finish.',
              jsonb_build_object('club_id', NEW.club_id, 'horse_id', NEW.user_id, 'amount', v_amount,
                                 'sqlstate', v_state, 'error', v_message));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- a note that cannot be written never blocks the payment it describes
    END;
  END;

  FOR i IN 1 .. array_length(c_keys, 1) LOOP
    PERFORM set_config(c_keys[i], v_saved[i], true);
  END LOOP;
  PERFORM set_config('lock_timeout', v_lock_timeout, true);
  RETURN NULL;
END;
$function$
