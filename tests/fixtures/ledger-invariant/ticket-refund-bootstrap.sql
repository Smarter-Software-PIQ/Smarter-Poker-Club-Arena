\set ON_ERROR_STOP on
-- A cancelled ticket's refund books to ticket escrow (2026-11-12, incidents
-- 9aaed91e / 496bda61). The fixture gains what the two REAL issuer-refund
-- functions read, then installs their production bodies as they stood before
-- 20261112184950 (read live with pg_get_functiondef on 2026-11-12). The
-- regression proves the old bodies are refused at commit, then runs the
-- migration file itself, which rewrites these installed bodies exactly as it
-- rewrites production's.

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

ALTER TABLE public.club_members
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.tournament_tickets
  ADD COLUMN IF NOT EXISTS issued_by uuid,
  ADD COLUMN IF NOT EXISTS redemption_mode text NOT NULL DEFAULT 'wallet_chips',
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE public.chip_transactions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid,
  from_user_id     uuid,
  to_user_id       uuid,
  amount           numeric,
  transaction_type text,
  notes            text,
  balance_after    numeric,
  metadata         jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tournament_ticket_entry_targets (
  ticket_id     uuid PRIMARY KEY,
  tournament_id uuid NOT NULL
);
CREATE TABLE public.financial_alerts (
  id       bigserial PRIMARY KEY,
  severity text, source text, message text, context jsonb
);
CREATE TABLE public.wallet_transactions (
  id bigserial PRIMARY KEY,
  user_id uuid, wallet_type text, type text, amount numeric,
  category text, description text, balance_after numeric
);
-- Every target in this fixture is closed; the real predicate is not under test.
CREATE OR REPLACE FUNCTION public.fn_ca_satellite_ticket_target_is_closed(p_target uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

-- ---------------------------------------------------------------------------
-- Production bodies before 20261112184950 (verbatim).
-- ---------------------------------------------------------------------------
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
  PERFORM set_config('app.ledger_category','escrow_release',true);
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

      PERFORM set_config('app.ledger_category','escrow_release',true);
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

-- Fixture people and tickets. Club 1111..., issuer A1 (agent), holder A2, and
-- a departed holder A3 for the closed-target issuer return.
UPDATE public.club_members SET status = 'departed'
 WHERE club_id = '11111111-1111-1111-1111-111111111111'
   AND user_id = 'aaaaaaaa-0000-0000-0000-000000000003';
