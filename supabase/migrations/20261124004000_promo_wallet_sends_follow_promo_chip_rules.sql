-- 20261124004000_promo_wallet_sends_follow_promo_chip_rules.sql
--
-- Enforce Promo Chip Rules for every chip sent to an agent's promo wallet
-- regardless of which source wallet funded the send:
--   1. Reversing a Club Bank send whose destination was promo_wallet returns
--      chips to clubs.promo_balance (club_promo_wallet), never clubs.chip_treasury.
--   2. Sending from agent_wallet or player_wallet to a downline's promo_wallet
--      enforces the same 50-chip / 7-day downline cap (across all uplines) and
--      250-chip / 24-hour per-agent daily cap as fn_promo_wallet_send, and all
--      promo sends across all sources share one unified allowance counter and
--      member-history promo_used_after_send tally.
--   3. Locked promo chips in player_wallet or agent_wallet cannot bypass their
--      4x play-through lock by transferring, agent-sending, or agent-claiming
--      into a promo_wallet; only reversals and club-bank claims into the club's
--      own promo wallet (to_entity_id = club_id) qualify as returned principal.
--
-- Function-only migration: no hot-table DDL, no data rewrites, no locks on
-- gameplay tables.
-- @live-proof: to_regprocedure('public.fn_ca_agent_promo_downline_sent_7d(uuid,uuid,timestamptz)') IS NOT NULL AND position('clubs.promo_balance' in pg_get_functiondef('public.fn_club_bank_reverse_core_20261004(uuid,text,uuid)'::regprocedure)) > 0 AND position('fn_ca_agent_promo_downline_sent_7d' in pg_get_functiondef('public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid)'::regprocedure)) > 0 AND position('fn_ca_agent_promo_downline_sent_7d' in pg_get_functiondef('public.fn_cashier_player_wallet_send(uuid,uuid,numeric,text,text,uuid)'::regprocedure)) > 0 AND position('fn_ca_agent_promo_downline_sent_7d' in pg_get_functiondef('public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure)) > 0 AND position('fn_ca_agent_promo_downline_sent_7d' in pg_get_functiondef('public.fn_cashier_promo_allowance(uuid,uuid[])'::regprocedure)) > 0 AND position('agent_wallet_send' in pg_get_functiondef('public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure)) > 0 AND position('NEW.to_entity_id=NEW.club_id' in pg_get_functiondef('public.fn_ca_promo_play_through_on_exit()'::regprocedure)) > 0
-- @probe-exempt: public.fn_ca_promo_play_through_on_exit Trigger function cannot be invoked directly; covered by plpgsql_check and isolated PG17 proofs.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Shared 7-day rolling downline promo counter across every funding wallet:
--    promo_wallet_send (promo wallet -> any wallet) PLUS agent_wallet_send and
--    peer_transfer whose destination is promo_wallet (excluding self-moves).
CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_downline_sent_7d(
  p_club_id uuid,
  p_to_user_id uuid,
  p_at timestamptz
) RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(sum(t.amount), 0)
    FROM public.chip_transactions t
   WHERE t.club_id = p_club_id
     AND t.to_user_id = p_to_user_id
     AND (
       t.transaction_type = 'promo_wallet_send'
       OR (
         t.transaction_type IN ('agent_wallet_send', 'peer_transfer')
         AND t.metadata ->> 'destination' = 'promo_wallet'
         AND t.from_user_id IS DISTINCT FROM t.to_user_id
       )
     )
     AND t.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
     AND t.created_at > p_at - interval '168 hours';
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_agent_promo_downline_sent_7d(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_agent_promo_downline_sent_7d(uuid, uuid, timestamptz) IS
  'Gross promo chips received by one downline from all agent ranks in this club in the 168 hours before p_at across every funding wallet (promo_wallet, agent_wallet -> promo_wallet, player_wallet -> promo_wallet).';

-- 2. Shared 24-hour per-agent promo daily allowance across every funding wallet.
CREATE OR REPLACE FUNCTION public.fn_ca_agent_promo_daily_allowance(
  p_club_id uuid,
  p_agent uuid,
  p_at timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cap AS (SELECT trim_scale(round(public.fn_sp_setting('agent_promo_daily_chips', 250), 2)) AS c),
  sent AS (
    SELECT COALESCE(sum(t.amount), 0) AS s
      FROM public.chip_transactions t
     WHERE t.club_id = p_club_id AND t.from_user_id = p_agent
       AND (
         t.transaction_type = 'promo_wallet_send'
         OR (
           t.transaction_type IN ('agent_wallet_send', 'peer_transfer')
           AND t.metadata ->> 'destination' = 'promo_wallet'
           AND t.from_user_id IS DISTINCT FROM t.to_user_id
         )
       )
       AND t.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
       AND t.created_at > p_at - interval '24 hours')
  SELECT jsonb_build_object('limit_chips', cap.c, 'window_hours', 24,
                            'sent_last_24_hours', trim_scale(sent.s),
                            'remaining_chips', trim_scale(greatest(0::numeric, cap.c - sent.s)))
    FROM cap, sent;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_agent_promo_daily_allowance(uuid, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.fn_ca_agent_promo_daily_allowance(uuid, uuid, timestamptz) IS
  'Agent promo cap: promo chips one agent sent in the 24 hours before p_at across every funding wallet (promo_wallet, agent_wallet -> promo_wallet, player_wallet -> promo_wallet), against agent_promo_daily_chips.';

-- 3. Guarded in-place patches preserving exact owners, SECURITY DEFINER,
--    search_path, and ACLs on every patched function.
DO $patch$
DECLARE
  v_sig regprocedure;
  v_def text;
  v_src_md5 text;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
  v_old text;
  v_new text;
BEGIN
  -- 3a. fn_promo_wallet_send_core_20261004: read the unified 7-day counter.
  v_sig := 'public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure;
  SELECT pg_get_functiondef(v_sig), md5(prosrc), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_src_md5, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF v_src_md5 IS DISTINCT FROM 'be708b91a9ce7080e2826d2f53513cc5' THEN
    RAISE EXCEPTION 'promo_wallet_send_core preimage changed: %', v_src_md5;
  END IF;
  v_old := $old$    select coalesce(sum(t.amount), 0) into v_sent
      from public.chip_transactions t
     where t.club_id = p_club_id
       and t.to_user_id = p_to_user_id
       and t.transaction_type = 'promo_wallet_send'
       and t.metadata ->> 'actor_role' in ('super_agent', 'agent', 'sub_agent')
       and t.created_at > v_limit_time - interval '168 hours';$old$;
  v_new := $new$    v_sent := public.fn_ca_agent_promo_downline_sent_7d(p_club_id, p_to_user_id, v_limit_time);$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'promo_wallet_send_core 7d anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'promo_wallet_send_core metadata drifted'; END IF;

  -- 3b. fn_agent_wallet_send_core_20260830: enforce 50/7d and 250/24h promo caps
  --     when sending from agent_wallet to a downline's promo_wallet.
  v_sig := 'public.fn_agent_wallet_send_core_20260830(uuid,uuid,numeric,text,text,uuid)'::regprocedure;
  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF md5(v_def) IS DISTINCT FROM '572625140db9bbdc4d9d0f5583755a38' THEN
    RAISE EXCEPTION 'agent_wallet_send_core preimage changed: %', md5(v_def);
  END IF;
  v_old := '  v_until        timestamptz;';
  v_new := $new$  v_until        timestamptz;
  v_limit_time   timestamptz;
  v_promo_sent   numeric;
  v_promo_rem    numeric;
  v_agent_cap    jsonb;$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'agent_wallet_send_core declare anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  if v_dest = 'player_wallet' and v_to_role = 'admin' then
    return jsonb_build_object('success', false,
      'error', 'An Admin Does Not Hold A Player Wallet');
  end if;$old$;
  v_new := v_old || $new$

  -- Chips sent to a downline's promo wallet follow the exact same promo caps
  -- as promo_wallet sends, serialized under the club agent-agreement mutex.
  v_limit_time := clock_timestamp();
  if v_dest = 'promo_wallet' and p_to_user_id <> v_actor
     and v_actor_role in ('super_agent', 'agent', 'sub_agent') then
    if current_setting('transaction_isolation') <> 'read committed' then
      return jsonb_build_object('success', false,
        'error', 'Promo Sends Require A Fresh Read Committed Transaction',
        'error_code', 'promo_limit_snapshot');
    end if;
    v_promo_sent := public.fn_ca_agent_promo_downline_sent_7d(p_club_id, p_to_user_id, v_limit_time);
    v_promo_rem := greatest(0::numeric, 50::numeric - v_promo_sent);
    if p_amount > v_promo_rem then
      return jsonb_build_object('success', false,
        'error', format('Promo Limit: This Downline Can Receive Only 50 Chips From All Agents Combined In Any 7 Days. %s Chips Remain.', v_promo_rem),
        'error_code', 'promo_downline_seven_day_limit',
        'limit_chips', 50, 'window_hours', 168,
        'sent_last_7_days', v_promo_sent, 'remaining_chips', v_promo_rem);
    end if;
    v_agent_cap := public.fn_ca_agent_promo_daily_allowance(p_club_id, v_actor, v_limit_time);
    if p_amount > (v_agent_cap ->> 'remaining_chips')::numeric then
      return jsonb_build_object('success', false,
        'error', format('Promo Limit: An Agent Can Send Only %s Promo Chips In Any 24 Hours. %s Chips Remain.',
                        v_agent_cap ->> 'limit_chips', v_agent_cap ->> 'remaining_chips'),
        'error_code', 'promo_agent_daily_limit',
        'limit_chips', (v_agent_cap ->> 'limit_chips')::numeric, 'window_hours', 24,
        'sent_last_24_hours', (v_agent_cap ->> 'sent_last_24_hours')::numeric,
        'remaining_chips', (v_agent_cap ->> 'remaining_chips')::numeric);
    end if;
  end if;$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'agent_wallet_send_core cap anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$    (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata,
     balance_after, reversible_until)$old$;
  v_new := $new$    (club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata,
     balance_after, reversible_until, created_at)$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'agent_wallet_send_core insert cols anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := '     v_float_after, v_until)';
  v_new := '     v_float_after, v_until, v_limit_time)';
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'agent_wallet_send_core insert vals anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'agent_wallet_send_core metadata drifted'; END IF;

  -- 3c. fn_cashier_player_wallet_send: enforce 50/7d and 250/24h promo caps
  --     when sending from player_wallet to a downline's promo_wallet, record
  --     actor_role in metadata, and stamp created_at with post-mutex time.
  v_sig := 'public.fn_cashier_player_wallet_send(uuid,uuid,numeric,text,text,uuid)'::regprocedure;
  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF md5(v_def) IS DISTINCT FROM '2697ce061ec1b7436fc8ae825129d649' THEN
    RAISE EXCEPTION 'cashier_player_wallet_send preimage changed: %', md5(v_def);
  END IF;
  v_old := 'DECLARE actor uuid:=auth.uid(); actor_role text; target_role text; gate jsonb; result jsonb; before_balance numeric; after_balance numeric; target_after numeric; agent_id uuid; tx uuid; context jsonb; setting text;';
  v_new := v_old || ' limit_time timestamptz; promo_sent numeric; promo_rem numeric; agent_cap jsonb;';
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'cashier_player_wallet_send declare anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$ IF (p_destination='player_wallet' AND target_role='admin') OR (p_destination<>'player_wallet' AND target_role NOT IN ('owner','co_owner','admin','super_agent','agent','sub_agent')) THEN RETURN jsonb_build_object('success',false,'error','Recipient Does Not Hold That Wallet'); END IF;$old$;
  v_new := v_old || $new$
 limit_time:=clock_timestamp();
 IF p_destination='promo_wallet' AND actor<>p_to_user_id AND actor_role IN ('super_agent','agent','sub_agent') THEN
  IF current_setting('transaction_isolation')<>'read committed' THEN
   RETURN jsonb_build_object('success',false,'error','Promo Sends Require A Fresh Read Committed Transaction','error_code','promo_limit_snapshot');
  END IF;
  promo_sent:=public.fn_ca_agent_promo_downline_sent_7d(p_club_id,p_to_user_id,limit_time);
  promo_rem:=greatest(0::numeric,50::numeric-promo_sent);
  IF p_amount>promo_rem THEN
   RETURN jsonb_build_object('success',false,'error',format('Promo Limit: This Downline Can Receive Only 50 Chips From All Agents Combined In Any 7 Days. %s Chips Remain.',promo_rem),'error_code','promo_downline_seven_day_limit','limit_chips',50,'window_hours',168,'sent_last_7_days',promo_sent,'remaining_chips',promo_rem);
  END IF;
  agent_cap:=public.fn_ca_agent_promo_daily_allowance(p_club_id,actor,limit_time);
  IF p_amount>(agent_cap->>'remaining_chips')::numeric THEN
   RETURN jsonb_build_object('success',false,'error',format('Promo Limit: An Agent Can Send Only %s Promo Chips In Any 24 Hours. %s Chips Remain.',agent_cap->>'limit_chips',agent_cap->>'remaining_chips'),'error_code','promo_agent_daily_limit','limit_chips',(agent_cap->>'limit_chips')::numeric,'window_hours',24,'sent_last_24_hours',(agent_cap->>'sent_last_24_hours')::numeric,'remaining_chips',(agent_cap->>'remaining_chips')::numeric);
  END IF;
 END IF;$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'cashier_player_wallet_send cap anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$ INSERT INTO public.chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,notes,metadata,balance_after) VALUES(p_club_id,actor,p_to_user_id,p_amount,'peer_transfer',coalesce(p_reason,'Cashier Send Out'),jsonb_build_object('op_id',p_op_id,'source','player_wallet','destination',p_destination,'player_wallet_after',after_balance,'recipient_balance_after',target_after),after_balance) RETURNING id INTO tx;$old$;
  v_new := $new$ INSERT INTO public.chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,notes,metadata,balance_after,created_at) VALUES(p_club_id,actor,p_to_user_id,p_amount,'peer_transfer',coalesce(p_reason,'Cashier Send Out'),jsonb_build_object('op_id',p_op_id,'source','player_wallet','destination',p_destination,'actor_role',actor_role,'player_wallet_after',after_balance,'recipient_balance_after',target_after),after_balance,limit_time) RETURNING id INTO tx;$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'cashier_player_wallet_send insert anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'cashier_player_wallet_send metadata drifted'; END IF;

  -- 3d. fn_club_bank_reverse_core_20261004: reversing a Club Bank send whose
  --     destination was promo_wallet MUST return chips to clubs.promo_balance
  --     (club_promo_wallet), never back into non-promo clubs.chip_treasury.
  v_sig := 'public.fn_club_bank_reverse_core_20261004(uuid,text,uuid)'::regprocedure;
  SELECT pg_get_functiondef(v_sig), md5(prosrc), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_src_md5, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF v_src_md5 IS DISTINCT FROM '2a67b4b80c857356ef0eaca621b358c3' THEN
    RAISE EXCEPTION 'club_bank_reverse_core preimage changed: %', v_src_md5;
  END IF;

  v_old := $old$  select id into v_prior from chip_transactions
   where club_id = v_tx.club_id
     and transaction_type = 'club_bank_reversal'
     and metadata ->> 'op_id' = v_op_id::text
   limit 1;
  if found then
    return jsonb_build_object('success', true, 'replayed', true, 'transaction_id', v_prior.id);
  end if;$old$;
  v_new := $new$  select id, coalesce(metadata, '{}'::jsonb) as metadata into v_prior from chip_transactions
   where club_id = v_tx.club_id
     and transaction_type = 'club_bank_reversal'
     and metadata ->> 'op_id' = v_op_id::text
   limit 1;
  if found then
    return jsonb_build_object(
      'success', true, 'replayed', true, 'transaction_id', v_prior.id,
      'return_destination', coalesce(v_prior.metadata ->> 'return_destination', 'club_bank'));
  end if;$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'club_bank_reverse_core replay anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  perform public.fn_ca_declare_ledger('reversal', 'club_treasury', v_tx.club_id, null,
    'club_bank_reversal:' || v_op_id::text, array['clubs']);
  perform set_config('app.ledger_correlation', v_op_id::text, true);$old$;
  v_new := $new$  perform public.fn_ca_declare_ledger(
    'reversal',
    case when v_dest = 'promo_wallet' then 'promo_wallet' else 'club_treasury' end,
    v_tx.club_id, null,
    'club_bank_reversal:' || v_op_id::text, array['clubs']);
  if v_dest = 'promo_wallet' then
    perform set_config('app.ledger_counterparty_label', 'clubs.promo_balance', true);
  end if;
  perform set_config('app.ledger_correlation', v_op_id::text, true);$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'club_bank_reverse_core declare anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$  update clubs set chip_treasury = coalesce(chip_treasury, 0) + v_tx.amount, updated_at = now()
   where id = v_tx.club_id returning chip_treasury into v_bank_after;
  perform set_config('app.ledger_autoskip_clubs', '', true);$old$;
  v_new := $new$  if v_dest = 'promo_wallet' then
    update clubs set promo_balance = coalesce(promo_balance, 0) + v_tx.amount, updated_at = now()
     where id = v_tx.club_id returning promo_balance into v_bank_after;
  else
    update clubs set chip_treasury = coalesce(chip_treasury, 0) + v_tx.amount, updated_at = now()
     where id = v_tx.club_id returning chip_treasury into v_bank_after;
  end if;
  perform set_config('app.ledger_counterparty_label', '', true);
  perform set_config('app.ledger_autoskip_clubs', '', true);$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'club_bank_reverse_core credit anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$       'destination', v_dest,
       'actor_role', v_actor_role,$old$;
  v_new := $new$       'destination', v_dest,
       'return_destination', case when v_dest = 'promo_wallet' then 'club_promo_wallet' else 'club_bank' end,
       'actor_role', v_actor_role,$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'club_bank_reverse_core metadata anchor mismatch';
  END IF;
  v_def := replace(v_def, v_old, v_new);

  v_old := $old$    'amount', v_tx.amount, 'bank_after', v_bank_after,
    'recipient_balance_after', v_to_after);$old$;
  v_new := $new$    'amount', v_tx.amount, 'bank_after', v_bank_after,
    'return_destination', case when v_dest = 'promo_wallet' then 'club_promo_wallet' else 'club_bank' end,
    'recipient_balance_after', v_to_after);$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'club_bank_reverse_core return anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'club_bank_reverse_core metadata drifted'; END IF;

  -- 3e. fn_cashier_promo_allowance: read the unified 7-day counter.
  v_sig := 'public.fn_cashier_promo_allowance(uuid,uuid[])'::regprocedure;
  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF md5(v_def) IS DISTINCT FROM '7ae8c0d2d74bdbf7b43643904eed612c' THEN
    RAISE EXCEPTION 'cashier_promo_allowance preimage changed: %', md5(v_def);
  END IF;
  v_old := $old$    cross join lateral (
      select coalesce(sum(t.amount), 0) as sent
        from public.chip_transactions t
       where t.club_id = p_club_id
         and t.to_user_id = u.user_id
         and t.transaction_type = 'promo_wallet_send'
         and t.metadata ->> 'actor_role' in ('super_agent', 'agent', 'sub_agent')
         and t.created_at > v_now - interval '168 hours') s$old$;
  v_new := $new$    cross join lateral (
      select public.fn_ca_agent_promo_downline_sent_7d(p_club_id, u.user_id, v_now) as sent) s$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'cashier_promo_allowance 7d anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'cashier_promo_allowance metadata drifted'; END IF;

  -- 3f. fn_cashier_history_feed: include agent_wallet/player_wallet sends to
  --     a downline's promo_wallet in promo_used_after_send.
  v_sig := 'public.fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure;
  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  IF md5(v_def) IS DISTINCT FROM '926853d2cd2082737ab82c8a562b8534' THEN
    RAISE EXCEPTION 'cashier_history_feed preimage changed: %', md5(v_def);
  END IF;
  v_old := $old$                WHEN $11 IS NOT NULL AND ct.transaction_type = 'promo_wallet_send'
                     AND ct.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                THEN ct.metadata || jsonb_build_object('promo_used_after_send', (
                  SELECT sum(receipt.amount)::text
                    FROM public.chip_transactions receipt
                   WHERE receipt.club_id = ct.club_id AND receipt.to_user_id = ct.to_user_id
                     AND receipt.transaction_type = 'promo_wallet_send'
                     AND receipt.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                     AND receipt.created_at > ct.created_at - interval '168 hours'
                     AND (receipt.created_at, receipt.id) <= (ct.created_at, ct.id)
                ))$old$;
  v_new := $new$                WHEN $11 IS NOT NULL AND (
                       ct.transaction_type = 'promo_wallet_send'
                       OR (ct.transaction_type IN ('agent_wallet_send', 'peer_transfer')
                           AND ct.metadata ->> 'destination' = 'promo_wallet'
                           AND ct.from_user_id IS DISTINCT FROM ct.to_user_id)
                     )
                     AND ct.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                THEN ct.metadata || jsonb_build_object('promo_used_after_send', (
                  SELECT sum(receipt.amount)::text
                    FROM public.chip_transactions receipt
                   WHERE receipt.club_id = ct.club_id AND receipt.to_user_id = ct.to_user_id
                     AND (
                       receipt.transaction_type = 'promo_wallet_send'
                       OR (receipt.transaction_type IN ('agent_wallet_send', 'peer_transfer')
                           AND receipt.metadata ->> 'destination' = 'promo_wallet'
                           AND receipt.from_user_id IS DISTINCT FROM receipt.to_user_id)
                     )
                     AND receipt.metadata ->> 'actor_role' IN ('super_agent', 'agent', 'sub_agent')
                     AND receipt.created_at > ct.created_at - interval '168 hours'
                     AND (receipt.created_at, receipt.id) <= (ct.created_at, ct.id)
                ))$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'cashier_history_feed promo_used_after_send anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'cashier_history_feed metadata drifted'; END IF;

  -- 3g. fn_ca_promo_play_through_on_exit: locked promo chips cannot exit via
  --     transfer, agent_send, or agent-side claim into a promo_wallet. Only
  --     explicit reversals and club-bank claims to the club's own promo wallet
  --     (to_entity_id = club_id) qualify as returned principal.
  v_sig := 'public.fn_ca_promo_play_through_on_exit()'::regprocedure;
  SELECT pg_get_functiondef(v_sig), proacl::text, proowner, prosecdef, proconfig
    INTO v_def, v_acl, v_owner, v_definer, v_config
    FROM pg_proc WHERE oid = v_sig;
  v_old := $old$IF NEW.to_type IN('club_treasury','promo_wallet','union_wallet') THEN$old$;
  v_new := $new$IF NEW.to_type IN('club_treasury','union_wallet') OR (NEW.to_type='promo_wallet' AND (NEW.category='reversal' OR (NEW.category='club_bank_claim' AND NEW.to_entity_id=NEW.club_id))) THEN$new$;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'promo_play_through_on_exit return anchor mismatch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p WHERE p.oid = v_sig
      AND p.proacl::text IS NOT DISTINCT FROM v_acl
      AND p.proowner = v_owner AND p.prosecdef = v_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
  ) THEN RAISE EXCEPTION 'promo_play_through_on_exit metadata drifted'; END IF;
END
$patch$;

-- @probe-for: public.fn_ca_agent_promo_downline_sent_7d
DO $probe$
DECLARE v numeric;
BEGIN
  v := public.fn_ca_agent_promo_downline_sent_7d(gen_random_uuid(), gen_random_uuid(), clock_timestamp());
  IF v IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe_unexpected_downline_sent: %', v;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_agent_promo_daily_allowance
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_ca_agent_promo_daily_allowance(gen_random_uuid(), gen_random_uuid(), clock_timestamp());
  IF (r ->> 'limit_chips')::numeric IS NULL OR (r ->> 'sent_last_24_hours')::numeric IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'probe_unexpected_daily_allowance: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_promo_wallet_send_core_20261004
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_promo_wallet_send_core_20261004(gen_random_uuid(), gen_random_uuid(), 1, 'player_wallet', NULL, gen_random_uuid());
  IF (r ->> 'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'probe_unexpected_promo_send: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_agent_wallet_send_core_20260830
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_agent_wallet_send_core_20260830(gen_random_uuid(), gen_random_uuid(), 1, 'promo_wallet', NULL, gen_random_uuid());
  IF (r ->> 'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'probe_unexpected_agent_send: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_cashier_player_wallet_send
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_cashier_player_wallet_send(gen_random_uuid(), gen_random_uuid(), 1, 'promo_wallet', NULL, gen_random_uuid());
  IF (r ->> 'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'probe_unexpected_player_send: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_club_bank_reverse_core_20261004
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_club_bank_reverse_core_20261004(gen_random_uuid(), NULL, gen_random_uuid());
  IF (r ->> 'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'probe_unexpected_club_bank_reverse: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_cashier_promo_allowance
DO $probe$
DECLARE r jsonb;
BEGIN
  r := public.fn_cashier_promo_allowance(gen_random_uuid(), ARRAY[gen_random_uuid()]);
  IF (r ->> 'success')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'probe_unexpected_promo_allowance: %', r;
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_cashier_history_feed
DO $probe$
BEGIN
  PERFORM * FROM public.fn_cashier_history_feed(gen_random_uuid(), 'mine', 'all', NULL, NULL, NULL, NULL, NULL, NULL, 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
