-- 20261112185222_ticket_escrow_returns_are_journalled_as_ticket_escrow.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_cancel_tournament_ticket','fn_ca_settle_closed_cashier_entry_tickets') AND p.prosrc ~ '''escrow_(release|hold)''')
--
-- WHAT THIS CHANGES, AND WHY:
--
-- A cashier ticket's value sits in ticket escrow while the ticket is issued
-- (fn_ca_ticket_escrow_float, store ticket_escrow). Two doors hand that value
-- back to the ISSUER: fn_cancel_tournament_ticket (the issuer cancels) and the
-- issuer-return branch of fn_ca_settle_closed_cashier_entry_tickets (the
-- target closed and the holder is no longer an active member). Both declared
-- the journal leg as category 'escrow_release', counterparty 'escrow'.
--
-- Since 20261006140948 fn_ca_tally_ledger_leg counts every escrow leg whose
-- category is 'escrow_hold' or 'escrow_release' against CASHOUT custody
-- ('cashout_escrow:<entity>'), never against ticket_escrow. So the ticket
-- store saw its balance fall by the ticket's value with no ledger leg, and
-- fn_ca_balance_has_its_ledger_row refused the whole transaction at COMMIT:
--   REFUSED: balance_moved_without_its_ledger_row account=ticket_escrow
--   balance_delta=-35.00 ledger_net=0.00
-- (ca_ledger_invariant_refusals 70, drift incident 16ef8334, operational
-- alert rows 377197/377198/377199/377200/377201, 2026-11-12 18:41 UTC).
-- Every issuer cancel since 2026-10-06 was refused: chip_transactions holds
-- no tournament_ticket_cancel row after 2026-09-20. For the closed-target
-- branch the refusal is worse, because it is raised at COMMIT, outside the
-- function's per-ticket EXCEPTION block, and so rolls back the whole
-- transaction that closes the tournament.
--
-- No chip moved wrongly: the invariant refused, so every refused cancel left
-- the ticket issued and its value in escrow. Nothing is repaid or rewritten.
--
-- The fix is the leg's category. An escrow -> player_wallet return to the
-- issuer is a 'refund' (the function's own receipt says "Escrow Refunded").
-- 'refund' is outside the cashout routing, so fn_ca_ledger_tally_key('escrow')
-- resolves it to ticket_escrow and the two sides meet. Every reader of
-- category 'refund' filters on tournament_id IS NOT NULL or to/from
-- prize_liability; this leg has neither, so no report moves. The redeem
-- branch of the settle function already uses 'ticket_redeem' and is
-- unchanged. Both bodies are otherwise byte-for-byte the production bodies,
-- pinned below by md5 so this aborts if either moved underneath it.
--
-- Pinned by tests/a-ticket-escrow-return-is-journalled-as-ticket-escrow.law.test.ts.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure))
       <> 'd3f65b7702d4b7f543891dd87c149353'
     OR md5(pg_get_functiondef('public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)'::regprocedure))
       <> 'cf968d9b75ae8ae510c4a2a3fb58e337'
  THEN
    RAISE EXCEPTION 'ticket_escrow_return_preimage_changed';
  END IF;
  -- The routing this fix depends on: escrow_release goes to cashout custody,
  -- refund resolves through fn_ca_ledger_tally_key to ticket_escrow.
  IF position('''escrow_hold'', ''escrow_release''' IN
       pg_get_functiondef('public.fn_ca_tally_ledger_leg()'::regprocedure)) = 0
     OR public.fn_ca_ledger_tally_key('escrow', gen_random_uuid(), gen_random_uuid())
       IS DISTINCT FROM 'ticket_escrow'
  THEN
    RAISE EXCEPTION 'ticket_escrow_return_routing_changed';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_cancel_tournament_ticket(p_ticket_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_me uuid:=auth.uid();
  v_t public.tournament_tickets%ROWTYPE;
  v_after numeric;
  v_context jsonb;
  v_setting text;
  v_receipt public.chip_transactions%ROWTYPE;
  v_issue public.chip_transactions%ROWTYPE;
  v_escrow_entity uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','Not Authenticated');
  END IF;
  IF p_ticket_id IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','Choose A Ticket');
  END IF;

  SELECT * INTO v_t FROM public.tournament_tickets
   WHERE id=p_ticket_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','Ticket Not Found');
  END IF;
  IF v_t.redemption_mode='tournament_entry_only' THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','Returned Tournament-Entry Tickets Cannot Be Cancelled For Chips');
  END IF;
  IF v_t.issued_by IS DISTINCT FROM v_me THEN
    RETURN jsonb_build_object(
      'success',false,'error','Only The Issuer May Cancel A Ticket');
  END IF;
  IF v_t.status='cancelled' THEN
    SELECT * INTO v_receipt FROM public.chip_transactions
     WHERE transaction_type='tournament_ticket_cancel'
       AND metadata->>'ticket_id'=p_ticket_id::text LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success',true,'replayed',true,'refunded',v_t.value,
        'your_balance',(v_receipt.metadata->>'issuer_balance_after')::numeric,
        'transaction_id',v_receipt.id);
    END IF;
  END IF;
  IF v_t.status<>'issued' THEN
    RETURN jsonb_build_object(
      'success',false,'error','Ticket Already '||initcap(v_t.status));
  END IF;

  SELECT * INTO v_issue FROM public.chip_transactions
   WHERE transaction_type='tournament_ticket_issue'
     AND metadata->>'ticket_id'=p_ticket_id::text LIMIT 1;
  IF FOUND AND v_issue.metadata ? 'escrow_entity_id' THEN
    IF v_issue.club_id IS DISTINCT FROM v_t.club_id
       OR v_issue.from_user_id IS DISTINCT FROM v_t.issued_by
       OR v_issue.to_user_id IS DISTINCT FROM v_t.holder_id
       OR v_issue.amount IS DISTINCT FROM v_t.value
       OR v_issue.metadata->>'escrow_entity_id'
            IS DISTINCT FROM p_ticket_id::text THEN
      RAISE EXCEPTION 'Ticket escrow receipt does not match its entitlement'
        USING ERRCODE='22023';
    END IF;
    v_escrow_entity:=p_ticket_id;
  END IF;
  SELECT jsonb_object_agg(k,COALESCE(current_setting(k,true),''))
    INTO v_context
    FROM unnest(ARRAY[
      'app.ledger_category','app.ledger_counterparty',
      'app.ledger_counterparty_entity','app.ledger_tournament']) settings(k);
  PERFORM set_config('app.ledger_tournament','',true);
  -- TICKET ESCROW RETURNS AS A REFUND (2026-11-12): 'escrow_release' is
  -- counted against cashout custody by fn_ca_tally_ledger_leg, so this leg
  -- never met the ticket_escrow balance and every cancel was refused.
  PERFORM set_config('app.ledger_category','refund',true);
  PERFORM set_config('app.ledger_counterparty','escrow',true);
  PERFORM set_config(
    'app.ledger_counterparty_entity',COALESCE(v_escrow_entity::text,''),true);
  UPDATE public.club_members
     SET chip_balance=COALESCE(chip_balance,0)+v_t.value,updated_at=now()
   WHERE club_id=v_t.club_id AND user_id=v_me
     AND COALESCE(status,'active') IN ('active','approved')
   RETURNING chip_balance INTO v_after;
  FOR v_setting IN SELECT jsonb_object_keys(v_context) LOOP
    PERFORM set_config(v_setting,v_context->>v_setting,true);
  END LOOP;
  IF v_after IS NULL THEN
    RETURN jsonb_build_object(
      'success',false,
      'error','You Are No Longer A Member Of That Club, So The Escrow Has Nowhere To Land');
  END IF;

  UPDATE public.tournament_tickets
     SET status='cancelled',cancelled_at=now()
   WHERE id=p_ticket_id;
  INSERT INTO public.chip_transactions(
    club_id,from_user_id,to_user_id,amount,transaction_type,notes,
    balance_after,metadata)
  VALUES(
    v_t.club_id,NULL,v_me,v_t.value,'tournament_ticket_cancel',
    'Tournament Ticket Cancelled: Escrow Refunded',v_after,
    jsonb_build_object(
      'ticket_id',p_ticket_id,'issuer_id',v_t.issued_by,
      'holder_id',v_t.holder_id,'escrow_action','refund_to_issuer',
      'issuer_balance_after',v_after))
  RETURNING * INTO v_receipt;

  RETURN jsonb_build_object(
    'success',true,'replayed',false,'refunded',v_t.value,
    'your_balance',v_after,'transaction_id',v_receipt.id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ca_settle_closed_cashier_entry_tickets(p_target_id uuid, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bind public.tournament_ticket_entry_targets%ROWTYPE;
  v_tk public.tournament_tickets%ROWTYPE;
  v_context jsonb;
  v_setting text;
  v_after numeric;
  v_paid integer := 0;
  v_returned integer := 0;
  v_amount numeric := 0;
  v_unpaid jsonb := '[]'::jsonb;
BEGIN
  /* A cashier entry ticket admits its holder to ONE tournament, only while it
     still takes entries. In the transaction that finalizes, finishes or
     cancels it, every still-unused ticket for it is settled here, once: to the
     holder's wallet in the ticket's club (seat_or_cash, as a satellite seat
     whose target closed, 20261012054804), or, if the holder is no longer an
     active member, back to the issuer exactly as fn_cancel_tournament_ticket
     would. A ticket neither can receive is named on a critical alert and
     stays escrowed for the issuer to cancel. Horses are paid exactly so. */
  IF p_target_id IS NULL
     OR NOT public.fn_ca_satellite_ticket_target_is_closed(p_target_id) THEN
    RETURN jsonb_build_object('ok',true,'paid',0,'returned',0,'amount',0);
  END IF;
  FOR v_bind IN
    SELECT b.* FROM public.tournament_ticket_entry_targets b
      JOIN public.tournament_tickets tk ON tk.id = b.ticket_id
     WHERE b.tournament_id = p_target_id AND tk.status = 'issued'
     ORDER BY b.ticket_id
  LOOP
    BEGIN
      SELECT * INTO v_tk FROM public.tournament_tickets tk
       WHERE tk.id = v_bind.ticket_id FOR UPDATE;
      IF v_tk.status IS DISTINCT FROM 'issued' THEN
        CONTINUE;
      END IF;
      SELECT jsonb_object_agg(k,COALESCE(current_setting(k,true),'')) INTO v_context
        FROM unnest(ARRAY['app.ledger_category','app.ledger_counterparty',
                          'app.ledger_counterparty_entity','app.ledger_tournament']) settings(k);
      PERFORM set_config('app.ledger_tournament','',true);
      PERFORM set_config('app.ledger_counterparty','escrow',true);
      PERFORM set_config('app.ledger_counterparty_entity',v_tk.id::text,true);

      PERFORM set_config('app.ledger_category','ticket_redeem',true);
      v_after := NULL;
      UPDATE public.club_members
         SET chip_balance = COALESCE(chip_balance,0) + v_tk.value, updated_at = now()
       WHERE club_id = v_tk.club_id AND user_id = v_tk.holder_id
         AND COALESCE(status,'active') IN ('active','approved')
       RETURNING chip_balance INTO v_after;
      IF v_after IS NOT NULL THEN
        FOR v_setting IN SELECT jsonb_object_keys(v_context) LOOP
          PERFORM set_config(v_setting,v_context->>v_setting,true);
        END LOOP;
        UPDATE public.tournament_tickets
           SET status = 'redeemed', redeemed_at = now()
         WHERE id = v_tk.id AND status = 'issued';
        INSERT INTO public.chip_transactions(
          club_id,from_user_id,to_user_id,amount,transaction_type,notes,
          balance_after,metadata)
        VALUES(
          v_tk.club_id,NULL,v_tk.holder_id,v_tk.value,'tournament_ticket_redeem',
          'Tournament Ticket Paid In Cash: Entry Closed',v_after,
          jsonb_build_object(
            'ticket_id',v_tk.id,'issuer_id',v_tk.issued_by,'holder_id',v_tk.holder_id,
            'escrow_action','release_to_holder','reason','target_entry_closed',
            'target_tournament_id',p_target_id,'source',p_source,
            'holder_balance_after',v_after));
        INSERT INTO public.wallet_transactions(
          user_id,wallet_type,type,amount,category,description,balance_after)
        VALUES(
          v_tk.holder_id,'PLAYER','credit',v_tk.value,'transfer',
          'Tournament Ticket Paid In Cash: Entry Closed',v_after);
        v_paid := v_paid + 1;
        v_amount := round(v_amount + v_tk.value,2);
        CONTINUE;
      END IF;

      -- TICKET ESCROW RETURNS AS A REFUND (2026-11-12): see
      -- fn_cancel_tournament_ticket. 'escrow_release' is cashout custody, and
      -- its refusal at COMMIT would roll back the closing transaction.
      PERFORM set_config('app.ledger_category','refund',true);
      UPDATE public.club_members
         SET chip_balance = COALESCE(chip_balance,0) + v_tk.value, updated_at = now()
       WHERE club_id = v_tk.club_id AND user_id = v_tk.issued_by
         AND COALESCE(status,'active') IN ('active','approved')
       RETURNING chip_balance INTO v_after;
      FOR v_setting IN SELECT jsonb_object_keys(v_context) LOOP
        PERFORM set_config(v_setting,v_context->>v_setting,true);
      END LOOP;
      IF v_after IS NULL THEN
        v_unpaid := v_unpaid || jsonb_build_array(jsonb_build_object(
          'ticket_id',v_tk.id,'reason','holder_and_issuer_not_active'));
        INSERT INTO public.financial_alerts(severity,source,message,context)
        VALUES('critical','fn_ca_settle_closed_cashier_entry_tickets',
          'A Cashier Tournament Ticket For A Closed Tournament Has No Active Holder Or Issuer',
          jsonb_build_object('target_id',p_target_id,'ticket_id',v_tk.id,
            'holder_id',v_tk.holder_id,'issuer_id',v_tk.issued_by,'value',v_tk.value));
        CONTINUE;
      END IF;
      UPDATE public.tournament_tickets
         SET status = 'cancelled', cancelled_at = now()
       WHERE id = v_tk.id AND status = 'issued';
      INSERT INTO public.chip_transactions(
        club_id,from_user_id,to_user_id,amount,transaction_type,notes,
        balance_after,metadata)
      VALUES(
        v_tk.club_id,NULL,v_tk.issued_by,v_tk.value,'tournament_ticket_cancel',
        'Tournament Ticket Returned: Entry Closed',v_after,
        jsonb_build_object(
          'ticket_id',v_tk.id,'issuer_id',v_tk.issued_by,'holder_id',v_tk.holder_id,
          'escrow_action','refund_to_issuer','reason','target_entry_closed_holder_left',
          'target_tournament_id',p_target_id,'source',p_source,
          'issuer_balance_after',v_after));
      v_returned := v_returned + 1;
      v_amount := round(v_amount + v_tk.value,2);
    EXCEPTION WHEN OTHERS THEN
      v_unpaid := v_unpaid || jsonb_build_array(jsonb_build_object(
        'ticket_id',v_bind.ticket_id,'reason','refused',
        'sqlstate',SQLSTATE,'message',SQLERRM));
      INSERT INTO public.financial_alerts(severity,source,message,context)
      VALUES('critical','fn_ca_settle_closed_cashier_entry_tickets',
        'A Cashier Tournament Ticket For A Closed Tournament Could Not Be Settled',
        jsonb_build_object('target_id',p_target_id,'ticket_id',v_bind.ticket_id,
          'sqlstate',SQLSTATE,'message',SQLERRM));
    END;
  END LOOP;
  RETURN jsonb_build_object('ok',jsonb_array_length(v_unpaid)=0,
    'paid',v_paid,'returned',v_returned,'amount',v_amount,'unpaid',v_unpaid);
END;
$function$;

-- CREATE OR REPLACE keeps the existing ACLs; assert them rather than restate.
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.pronamespace = 'public'::regnamespace
                AND p.proname IN ('fn_cancel_tournament_ticket',
                                  'fn_ca_settle_closed_cashier_entry_tickets')
                AND p.prosrc ~ '''escrow_(release|hold)''')
  THEN
    RAISE EXCEPTION 'ticket_escrow_return_still_declares_cashout_custody';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.fn_cancel_tournament_ticket(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.fn_ca_settle_closed_cashier_entry_tickets(uuid,text)', 'EXECUTE')
  THEN
    RAISE EXCEPTION 'ticket_escrow_return_acl_changed';
  END IF;
END $post$;

COMMIT;
