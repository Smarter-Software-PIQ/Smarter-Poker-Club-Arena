-- 20261112050118_agent_promo_sends_are_capped_at_fifty_chips_per_downline_in_.sql
-- Owner November 11: 50 total across all uplines per downline per seven days.
-- Agent promo grants share a recipient allowance across all agent ranks and
-- destination wallets in this club. Gross sends count even after a claim-back.
-- Existing history is counted immediately; no balances or history are rewritten.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $patch$
DECLARE
  d text := pg_get_functiondef('public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure);
BEGIN
  IF md5(d) <> '9902bccc4d422766b3611e050eeec770' THEN
    RAISE EXCEPTION 'Unexpected promo send preimage';
  END IF;
  d := replace(d, '  v_tx_id          uuid;', '  v_tx_id          uuid;
  v_limit_time     timestamptz;
  v_sent          numeric;
  v_remaining     numeric;');
  d := replace(d, '  -- CHIP STANDARD 2.4 (2026-09-03):', $guard$
  -- The existing agent-agreement club mutex serializes every promo core,
  -- including batch sends and different uplines. READ COMMITTED sees the
  -- previous holder's receipt; a stale transaction snapshot must fail closed.
  v_limit_time := clock_timestamp();
  if v_actor_role in ('super_agent', 'agent', 'sub_agent') then
    if current_setting('transaction_isolation') <> 'read committed' then
      return jsonb_build_object('success', false,
        'error', 'Promo Sends Require A Fresh Read Committed Transaction',
        'error_code', 'promo_limit_snapshot');
    end if;
    select coalesce(sum(t.amount), 0) into v_sent
      from public.chip_transactions t
     where t.club_id = p_club_id
       and t.to_user_id = p_to_user_id
       and t.transaction_type = 'promo_wallet_send'
       and t.metadata ->> 'actor_role' in ('super_agent', 'agent', 'sub_agent')
       and t.created_at > v_limit_time - interval '168 hours';
    v_remaining := greatest(0::numeric, 50::numeric - v_sent);
    if p_amount > v_remaining then
      return jsonb_build_object('success', false,
        'error', format('Promo Limit: This Downline Can Receive Only 50 Chips From All Agents Combined In Any 7 Days. %s Chips Remain.', v_remaining),
        'error_code', 'promo_downline_seven_day_limit',
        'limit_chips', 50, 'window_hours', 168,
        'sent_last_7_days', v_sent, 'remaining_chips', v_remaining);
    end if;
  end if;

  -- CHIP STANDARD 2.4 (2026-09-03):$guard$);
  -- Stamp the actual admission time after waiting for the existing mutex.
  -- now() would backdate a send to when a long caller transaction began.
  d := replace(d,
    '(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after)',
    '(club_id, from_user_id, to_user_id, amount, transaction_type, notes, metadata, balance_after, created_at)');
  d := replace(d, '     null)
  returning id into v_tx_id;',
    '     null, v_limit_time)
  returning id into v_tx_id;');
  IF position('promo_downline_seven_day_limit' in d) = 0
     OR position('null, v_limit_time)' in d) = 0 THEN
    RAISE EXCEPTION 'Promo limit patch did not match its core';
  END IF;
  EXECUTE d;
END
$patch$;

COMMIT;

-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_promo_wallet_send_core_20261004(uuid,uuid,numeric,text,text,uuid)'::regprocedure)) = '667d740fae94896fb96c35bad67b2bbc')
