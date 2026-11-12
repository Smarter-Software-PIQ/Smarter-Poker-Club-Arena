-- PROMO TICKETS: ONE BATCH CALL, A READABLE ALLOWANCE, RECOVERABLE RECEIPTS,
-- AND A REDEEM LEG THAT NAMES ITS TICKET.
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Follow-up to 20261112184216 (owner November 12: agents send tickets to their
-- downlines using promo chips, 50 max).
--
-- 1. fn_cashier_promo_allowance: what the cap will answer, before the send.
--    For an agent rank it returns, per downline the caller may transact with,
--    the promo chips received from all agents in the last 168 hours and what
--    remains of 50, read exactly as both promo doors read it. Staff are not
--    capped and are told so. It moves nothing.
-- 2. fn_cashier_promo_ticket_batch: up to 25 promo tickets in one round trip.
--    Each item runs fn_cashier_promo_ticket_send in its own subtransaction
--    with its own retry key, as fn_cashier_batch_transfer does for its doors.
-- 3. fn_cashier_promo_ticket_receipts: the receipt of a promo ticket by its
--    retry key, for the cashier's uncertain-outcome recovery. It reads only
--    the caller's own receipts.
-- 4. fn_redeem_tournament_ticket: finds a promo ticket's issue receipt, so the
--    holder's redeem leg names the ticket as its escrow entity instead of
--    writing an unnamed escrow side. No balance rule changes.
--
-- No table is altered and no balance or history is rewritten.
-- @live-proof: (SELECT to_regprocedure('public.fn_cashier_promo_ticket_batch(uuid,jsonb,uuid)') IS NOT NULL AND to_regprocedure('public.fn_cashier_promo_allowance(uuid,uuid[])') IS NOT NULL AND to_regprocedure('public.fn_cashier_promo_ticket_receipts(uuid,text[])') IS NOT NULL AND md5(pg_get_functiondef('public.fn_redeem_tournament_ticket(uuid)'::regprocedure)) = '49cb942d53af3521ff14a6502520924c')

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

INSERT INTO public.ca_money_rpc_registry (proname, status, notes)
VALUES ('fn_cashier_promo_ticket_batch', 'approved',
        'Bounded batch over fn_cashier_promo_ticket_send: one subtransaction and one retry key per recipient, at most 25. Moves nothing itself.')
ON CONFLICT (proname) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes;

CREATE OR REPLACE FUNCTION public.fn_cashier_promo_allowance(
  p_club_id uuid,
  p_user_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me    uuid := auth.uid();
  v_role  text;
  v_now   timestamptz := clock_timestamp();
  v_rows  jsonb;
begin
  if v_me is null then
    return jsonb_build_object('success', false, 'error', 'Not Authenticated');
  end if;
  if p_club_id is null or p_user_ids is null
     or cardinality(p_user_ids) < 1 or cardinality(p_user_ids) > 100 then
    return jsonb_build_object('success', false, 'error', 'Choose Between 1 And 100 Members');
  end if;
  v_role := public.fn_club_bank_role(p_club_id);
  if v_role is null
     or v_role not in ('owner', 'co_owner', 'admin', 'super_agent', 'agent', 'sub_agent') then
    return jsonb_build_object('success', false,
      'error', 'Only An Agent Or Club Staff May Send From A Promo Wallet');
  end if;
  if v_role not in ('super_agent', 'agent', 'sub_agent') then
    -- Staff promo is not capped by either door.
    return jsonb_build_object('success', true, 'capped', false,
      'limit_chips', 50, 'window_hours', 168, 'allowances', '[]'::jsonb);
  end if;

  -- The sum both promo doors enforce: gross promo receipts to the downline
  -- from every agent rank in this club in the last 168 hours.
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', u.user_id,
           'sent_last_7_days', s.sent,
           'remaining_chips', greatest(0::numeric, 50::numeric - s.sent))), '[]'::jsonb)
    into v_rows
    from (select distinct x as user_id from unnest(p_user_ids) x where x is not null) u
    cross join lateral (
      select coalesce(sum(t.amount), 0) as sent
        from public.chip_transactions t
       where t.club_id = p_club_id
         and t.to_user_id = u.user_id
         and t.transaction_type = 'promo_wallet_send'
         and t.metadata ->> 'actor_role' in ('super_agent', 'agent', 'sub_agent')
         and t.created_at > v_now - interval '168 hours') s
   where u.user_id <> v_me
     and public.fn_club_cashier_can_transact(p_club_id, v_me, u.user_id);

  return jsonb_build_object('success', true, 'capped', true,
    'limit_chips', 50, 'window_hours', 168, 'allowances', v_rows);
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_cashier_promo_ticket_batch(
  p_club_id uuid,
  p_items jsonb,
  p_batch_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_item    jsonb;
  v_result  jsonb;
  v_results jsonb := '[]'::jsonb;
  v_user_id uuid;
  v_amount  numeric;
  v_seen    uuid[] := '{}'::uuid[];
begin
  if v_me is null then
    return jsonb_build_object('success', false, 'error', 'Not Authenticated');
  end if;
  if p_club_id is null or p_batch_id is null then
    return jsonb_build_object('success', false, 'error', 'Club And Batch Retry Key Are Required');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 25 then
    return jsonb_build_object('success', false, 'error', 'A Batch Must Contain Between 1 And 25 Recipients');
  end if;

  -- Validate the complete envelope before the first item can move money.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'user_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or coalesce(v_item ->> 'amount', '') !~ '^[0-9]+([.][0-9]+)?$' then
      return jsonb_build_object('success', false, 'error', 'Every Batch Item Needs A Valid Recipient And Amount');
    end if;
    v_user_id := (v_item ->> 'user_id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    if v_user_id = any(v_seen) then
      return jsonb_build_object('success', false, 'error', 'A Recipient May Appear Only Once Per Batch');
    end if;
    v_seen := array_append(v_seen, v_user_id);
    if v_amount <= 0 or v_amount > 1e9 or v_amount <> round(v_amount, 2) then
      return jsonb_build_object('success', false, 'error', 'Every Amount Must Be Positive And Use Hundredths At Most');
    end if;
    if nullif(btrim(coalesce(v_item ->> 'idempotency_key', '')), '') is null then
      return jsonb_build_object('success', false, 'error', 'Every Ticket Needs Its Own Retry Key');
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_user_id := (v_item ->> 'user_id')::uuid;
    v_amount := (v_item ->> 'amount')::numeric;
    begin
      v_result := public.fn_cashier_promo_ticket_send(
        p_club_id, v_user_id, v_amount, v_item ->> 'idempotency_key');
    exception when others then
      v_result := jsonb_build_object(
        'success', false, 'error', 'Transfer Failed', 'error_code', sqlstate);
    end;
    v_results := v_results || jsonb_build_array(
      jsonb_build_object('user_id', v_user_id) || coalesce(v_result, '{}'::jsonb));
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'results', v_results,
    'processed', jsonb_array_length(v_results));
end
$function$;

CREATE OR REPLACE FUNCTION public.fn_cashier_promo_ticket_receipts(
  p_club_id uuid,
  p_ticket_keys text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_tickets jsonb;
begin
  if v_me is null then
    raise exception 'Not Authenticated' using errcode = '42501';
  end if;
  if p_club_id is null or p_ticket_keys is null
     or cardinality(p_ticket_keys) > 25
     or exists (select 1 from unnest(p_ticket_keys) k where k is null or length(k) > 300) then
    raise exception 'Choose At Most 25 Original Requests' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'ticket_key', t.metadata ->> 'idempotency_key',
           'receipt', jsonb_build_object('success', true, 'replayed', true,
             'ticket_id', t.metadata ->> 'ticket_id', 'transaction_id', t.id,
             'source', 'promo_wallet'))), '[]'::jsonb)
    into v_tickets
    from public.chip_transactions t
   where t.club_id = p_club_id
     and t.from_user_id = v_me
     and t.transaction_type = 'promo_wallet_send'
     and t.metadata ->> 'destination' = 'tournament_ticket'
     and t.metadata ->> 'ticket_id' is not null
     and t.metadata ->> 'idempotency_key' = any(p_ticket_keys);
  return jsonb_build_object('tickets', v_tickets);
end
$function$;

REVOKE ALL ON FUNCTION public.fn_cashier_promo_allowance(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cashier_promo_ticket_batch(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_cashier_promo_ticket_receipts(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cashier_promo_allowance(uuid, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cashier_promo_ticket_batch(uuid, jsonb, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_cashier_promo_ticket_receipts(uuid, text[]) TO authenticated, service_role;

DO $patch$
DECLARE
  d text := pg_get_functiondef('public.fn_redeem_tournament_ticket(uuid)'::regprocedure);
  n text;
BEGIN
  IF md5(d) <> '0bb17681b38164a7a2746e17d07597b3' THEN
    RAISE EXCEPTION 'Unexpected ticket redeem preimage';
  END IF;
  n := replace(d, '  SELECT * INTO v_issue FROM public.chip_transactions
   WHERE transaction_type=''tournament_ticket_issue''
     AND metadata->>''ticket_id''=p_ticket_id::text LIMIT 1;',
'  -- A promo funded ticket''s issue receipt is its promo_wallet_send row.
  SELECT * INTO v_issue FROM public.chip_transactions
   WHERE (transaction_type=''tournament_ticket_issue''
          OR (transaction_type=''promo_wallet_send''
              AND metadata->>''destination''=''tournament_ticket''))
     AND metadata->>''ticket_id''=p_ticket_id::text LIMIT 1;');
  IF n = d THEN RAISE EXCEPTION 'Ticket redeem patch did not match'; END IF;
  EXECUTE n;
END
$patch$;

COMMIT;
