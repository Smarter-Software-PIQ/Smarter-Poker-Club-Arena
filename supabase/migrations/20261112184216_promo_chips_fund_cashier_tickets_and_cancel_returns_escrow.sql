-- 20261112184216_promo_chips_fund_cashier_tickets_and_cancel_returns_escrow.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Owner November 12: "IN THE CASHIER, YOU AREN'T ALLOWED TO USE PROMO CHIPS TO
-- SEND A TICKET... AGENTS SHOULD BE ABLE TO SEND TICKETS TO THEIR DOWNLINES
-- USING PROMO CHIPS (50 MAX)".
--
-- 1. fn_cashier_promo_ticket_send: a cashier value ticket funded by the
--    sender's own promo wallet (agents.promo_wallet_balance). The promo float
--    is journaled to the ticket escrow by the existing autoledger, exactly as
--    the player wallet ticket door journals its own debit. Its receipt is a
--    promo_wallet_send row with destination tournament_ticket, so the existing
--    allowance (50 chips per downline from all agents combined in any seven
--    days, 20261112050118) counts promo tickets and promo sends as one total
--    in both doors without a second counter.
--
-- 2. fn_cancel_tournament_ticket:
--    a. A cancelled promo ticket returns its escrow to the issuer's promo
--       wallet, never to a player wallet, so a ticket can never turn promo
--       chips into the agent's own cashable chips.
--    b. ROOT CAUSE FIX. The door journaled its release under escrow_release,
--       which fn_ca_tally_ledger_leg counts as cashout custody. Every cancel
--       was therefore refused at commit (ticket_escrow moved, no ticket_escrow
--       leg; measured November 12 in a rolled back probe, and no cancel
--       receipt has ever been written). The release is now journaled as
--       ticket_redeem, the ticket float's own category.
--
-- No table is altered and no balance or history is rewritten.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure)) <> 'd3f65b7702d4b7f543891dd87c149353' AND to_regprocedure('public.fn_cashier_promo_ticket_send(uuid,uuid,numeric,text)') IS NOT NULL)

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
VALUES ('fn_cashier_promo_ticket_send', 'approved',
        'Cashier value ticket funded by the sender''s promo wallet: promo float to ticket escrow, receipt promo_wallet_send with destination tournament_ticket, sharing the 50 chips per downline seven day agent allowance.')
ON CONFLICT (proname) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.fn_cashier_promo_ticket_send(
  p_club_id uuid,
  p_holder_id uuid,
  p_value numeric,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me           uuid := auth.uid();
  v_key          text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_role         text;
  v_holder_role  text;
  v_prior        record;
  v_sender_id    uuid;
  v_promo        numeric;
  v_after        numeric;
  v_limit_time   timestamptz;
  v_sent         numeric;
  v_remaining    numeric;
  v_ticket_id    uuid;
  v_context      jsonb;
  v_setting      text;
begin
  if v_me is null then
    return jsonb_build_object('success', false, 'error', 'Not Authenticated');
  end if;
  if v_key is null or length(v_key) > 300 then
    return jsonb_build_object('success', false, 'error', 'A Retry Key Is Required For Every Ticket');
  end if;
  if p_club_id is null or p_holder_id is null or p_holder_id = v_me then
    return jsonb_build_object('success', false, 'error', 'Choose Another Active Member');
  end if;
  if p_value is null or p_value <= 0 or p_value > 1e9 or p_value <> round(p_value, 2) then
    return jsonb_build_object('success', false, 'error', 'Enter A Valid Ticket Value');
  end if;

  -- The cashier lock order every wallet door uses: the club's agent agreement
  -- mutex (which serializes every promo core and so the shared allowance),
  -- then the club hierarchy, then the retry key.
  perform pg_advisory_xact_lock(hashtextextended('agent-agreement:' || p_club_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:' || p_club_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('ticket:' || v_key, 0));

  select ct.* into v_prior
    from public.chip_transactions ct
   where ct.metadata ->> 'idempotency_key' = v_key
   limit 1;
  if found then
    if v_prior.club_id is distinct from p_club_id
       or v_prior.from_user_id is distinct from v_me
       or v_prior.to_user_id is distinct from p_holder_id
       or v_prior.amount is distinct from p_value
       or v_prior.metadata ->> 'ticket_id' is null
       or not (v_prior.transaction_type = 'tournament_ticket_issue'
               or (v_prior.transaction_type = 'promo_wallet_send'
                   and v_prior.metadata ->> 'destination' = 'tournament_ticket')) then
      return jsonb_build_object('success', false, 'error', 'That Retry Key Belongs To A Different Ticket');
    end if;
    return jsonb_build_object('success', true, 'replayed', true,
      'ticket_id', v_prior.metadata ->> 'ticket_id',
      'transaction_id', v_prior.id,
      'source', case when v_prior.transaction_type = 'promo_wallet_send'
                     then 'promo_wallet' else 'player_wallet' end,
      'sender_promo_after', (v_prior.metadata ->> 'sender_promo_after')::numeric);
  end if;

  v_role := public.fn_club_bank_role(p_club_id);
  if v_role is null
     or v_role not in ('owner', 'co_owner', 'admin', 'super_agent', 'agent', 'sub_agent') then
    return jsonb_build_object('success', false,
      'error', 'Only An Agent Or Club Staff May Send From A Promo Wallet');
  end if;
  if not public.fn_club_cashier_can_transact(p_club_id, v_me, p_holder_id) then
    return jsonb_build_object('success', false, 'error', 'That Member Is Not In Your Downline');
  end if;

  select a.id, coalesce(a.promo_wallet_balance, 0)
    into v_sender_id, v_promo
    from public.agents a
   where a.club_id = p_club_id and a.user_id = v_me
   for update;
  if v_sender_id is null then
    return jsonb_build_object('success', false,
      'error', 'You Do Not Hold A Promo Wallet In This Club');
  end if;
  if v_promo < p_value then
    return jsonb_build_object('success', false, 'error', 'Insufficient Promo Wallet Balance',
      'balance', v_promo, 'requested', p_value);
  end if;

  select cm.role into v_holder_role
    from public.club_members cm
   where cm.club_id = p_club_id
     and cm.user_id = p_holder_id
     and coalesce(cm.status, 'active') in ('active', 'approved')
   for update;
  if v_holder_role is null then
    return jsonb_build_object('success', false, 'error', 'Recipient Is Not An Active Member Of This Club');
  end if;
  if v_holder_role = 'admin' then
    return jsonb_build_object('success', false, 'error', 'An Admin Does Not Hold A Player Wallet');
  end if;

  -- The one allowance fn_promo_wallet_send_core_20261004 enforces, read the
  -- same way: gross promo receipts to this downline from every agent rank in
  -- the last 168 hours. A promo ticket's receipt is one of those rows.
  v_limit_time := clock_timestamp();
  if v_role in ('super_agent', 'agent', 'sub_agent') then
    if current_setting('transaction_isolation') <> 'read committed' then
      return jsonb_build_object('success', false,
        'error', 'Promo Sends Require A Fresh Read Committed Transaction',
        'error_code', 'promo_limit_snapshot');
    end if;
    select coalesce(sum(t.amount), 0) into v_sent
      from public.chip_transactions t
     where t.club_id = p_club_id
       and t.to_user_id = p_holder_id
       and t.transaction_type = 'promo_wallet_send'
       and t.metadata ->> 'actor_role' in ('super_agent', 'agent', 'sub_agent')
       and t.created_at > v_limit_time - interval '168 hours';
    v_remaining := greatest(0::numeric, 50::numeric - v_sent);
    if p_value > v_remaining then
      return jsonb_build_object('success', false,
        'error', format('Promo Limit: This Downline Can Receive Only 50 Chips From All Agents Combined In Any 7 Days. %s Chips Remain.', v_remaining),
        'error_code', 'promo_downline_seven_day_limit',
        'limit_chips', 50, 'window_hours', 168,
        'sent_last_7_days', v_sent, 'remaining_chips', v_remaining);
    end if;
  end if;

  -- Promo float to the ticket escrow. The agents autoledger writes the one
  -- leg (promo_wallet -> escrow, ticket_issue) from this declaration, and the
  -- issued ticket row is the escrow balance it names.
  v_ticket_id := gen_random_uuid();
  select jsonb_object_agg(k, coalesce(current_setting(k, true), '')) into v_context
    from unnest(array['app.ledger_category', 'app.ledger_counterparty',
                      'app.ledger_counterparty_entity', 'app.ledger_counterparty_label',
                      'app.ledger_tournament', 'app.ledger_autoskip_agents']) settings(k);
  perform set_config('app.ledger_tournament', '', true);
  perform set_config('app.ledger_category', 'ticket_issue', true);
  perform set_config('app.ledger_counterparty', 'escrow', true);
  perform set_config('app.ledger_counterparty_entity', v_ticket_id::text, true);
  perform set_config('app.ledger_counterparty_label', '', true);
  perform set_config('app.ledger_autoskip_agents', '', true);
  update public.agents
     set promo_wallet_balance = coalesce(promo_wallet_balance, 0) - p_value,
         updated_at = now()
   where id = v_sender_id
     and coalesce(promo_wallet_balance, 0) >= p_value
   returning promo_wallet_balance into v_after;
  for v_setting in select jsonb_object_keys(v_context) loop
    perform set_config(v_setting, v_context ->> v_setting, true);
  end loop;
  if v_after is null then
    return jsonb_build_object('success', false, 'error', 'Insufficient Promo Wallet Balance');
  end if;

  insert into public.tournament_tickets (id, club_id, issued_by, holder_id, value, note)
  values (v_ticket_id, p_club_id, v_me, p_holder_id, p_value, 'Cashier Ticket');

  insert into public.chip_transactions
    (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after, created_at)
  values
    (p_club_id, v_me, p_holder_id, p_value, 'promo_wallet_send', 'Promo Ticket Issued',
     jsonb_build_object(
       'idempotency_key', v_key,
       'destination', 'tournament_ticket',
       'source', 'promo_wallet',
       'actor_role', v_role,
       'recipient_role', v_holder_role,
       'ticket_id', v_ticket_id,
       'escrow_entity_id', v_ticket_id,
       'issuer_id', v_me,
       'holder_id', p_holder_id,
       'value', p_value,
       'sender_promo_after', v_after),
     null, v_limit_time);

  return jsonb_build_object('success', true, 'replayed', false,
    'ticket_id', v_ticket_id, 'source', 'promo_wallet',
    'sender_promo_after', v_after);
end
$function$;

REVOKE ALL ON FUNCTION public.fn_cashier_promo_ticket_send(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_promo_ticket_send(uuid, uuid, numeric, text) TO authenticated, service_role;

DO $patch$
DECLARE
  d text := pg_get_functiondef('public.fn_cancel_tournament_ticket(uuid)'::regprocedure);
  n text;
BEGIN
  IF md5(d) <> 'd3f65b7702d4b7f543891dd87c149353' THEN
    RAISE EXCEPTION 'Unexpected ticket cancel preimage';
  END IF;
  n := replace(d, '  v_escrow_entity uuid;
BEGIN', '  v_escrow_entity uuid;
  v_promo boolean := false;
BEGIN');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel patch 1 did not match'; END IF;
  d := n;
  -- The ticket float's own category: escrow_release is cashout custody.
  n := replace(d, '  PERFORM set_config(''app.ledger_category'',''escrow_release'',true);',
                  '  PERFORM set_config(''app.ledger_category'',''ticket_redeem'',true);');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel patch 2 did not match'; END IF;
  d := n;
  n := replace(d, '  UPDATE public.club_members
     SET chip_balance=COALESCE(chip_balance,0)+v_t.value,updated_at=now()
   WHERE club_id=v_t.club_id AND user_id=v_me
     AND COALESCE(status,''active'') IN (''active'',''approved'')
   RETURNING chip_balance INTO v_after;', $refund$  -- A promo funded ticket returns to the promo wallet that paid for it.
  v_promo := EXISTS (
    SELECT 1 FROM public.chip_transactions p
     WHERE p.transaction_type='promo_wallet_send'
       AND p.metadata->>'ticket_id'=p_ticket_id::text
       AND p.metadata->>'destination'='tournament_ticket'
       AND p.club_id=v_t.club_id AND p.from_user_id=v_t.issued_by
       AND p.to_user_id=v_t.holder_id AND p.amount=v_t.value);
  IF v_promo THEN
    PERFORM set_config('app.ledger_counterparty_entity',p_ticket_id::text,true);
    UPDATE public.agents
       SET promo_wallet_balance=COALESCE(promo_wallet_balance,0)+v_t.value,updated_at=now()
     WHERE club_id=v_t.club_id AND user_id=v_me
     RETURNING promo_wallet_balance INTO v_after;
  ELSE
    UPDATE public.club_members
       SET chip_balance=COALESCE(chip_balance,0)+v_t.value,updated_at=now()
     WHERE club_id=v_t.club_id AND user_id=v_me
       AND COALESCE(status,'active') IN ('active','approved')
     RETURNING chip_balance INTO v_after;
  END IF;$refund$);
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel patch 3 did not match'; END IF;
  d := n;
  n := replace(d, '''holder_id'',v_t.holder_id,''escrow_action'',''refund_to_issuer'',',
                  '''holder_id'',v_t.holder_id,''escrow_action'',''refund_to_issuer'',
      ''refund_wallet'',CASE WHEN v_promo THEN ''promo_wallet'' ELSE ''player_wallet'' END,');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel patch 4 did not match'; END IF;
  d := n;
  n := replace(d, '    ''your_balance'',v_after,''transaction_id'',v_receipt.id);
END;', '    ''your_balance'',v_after,''transaction_id'',v_receipt.id,
    ''refund_wallet'',CASE WHEN v_promo THEN ''promo_wallet'' ELSE ''player_wallet'' END);
END;');
  IF n = d THEN RAISE EXCEPTION 'Ticket cancel patch 5 did not match'; END IF;
  d := n;
  IF position('escrow_release' in d) <> 0
     OR position('promo_wallet_balance=COALESCE(promo_wallet_balance,0)+v_t.value' in d) = 0 THEN
    RAISE EXCEPTION 'Ticket cancel patch did not produce its successor';
  END IF;
  EXECUTE d;
END
$patch$;

COMMIT;
