-- 20261119053144_a_promo_winnings_credit_never_settles_promo_progress_inside_.sql
--
-- A PROMO WINNINGS CREDIT NEVER SETTLES PROMO PROGRESS INSIDE A PAYOUT
-- (incident 075013fd, lane E3).
--
-- OWNER RULINGS (Dan): promo chips can not and should not ever cause payout
-- issues with tournaments or cash games (2026-11-17); promo progress is not
-- checked after every hand, it is updated once per hour and only for accounts
-- with active promo chips, and checked at the cashier on a cash-out
-- (2026-11-18 13:40 America/Chicago).
--
-- WHAT WAS LEFT
--
-- 1. fn_ca_promo_profit_credit_owned (every tournament prize, bounty, cash
--    win, BBJ and stake refund of a promo holder) ran fn_ca_promo_profit_settle
--    for the holder before it decided whether the credit is restricted. The
--    settle locks every grant row of the account and, whenever the hourly
--    snapshot is not current or shows a gate as met, recomputes the account's
--    whole fee history (fn_ca_promo_shared_fee_state_live; hourly sweep on
--    production 2026-11-19: 1,110 ms mean, 15.6 s max per account). Read on
--    production at 05:25 UTC: 826 accounts hold a locked winnings gate and 412
--    of them had no current snapshot, so a final table paying ten such
--    holders could spend ten seconds and more of promo arithmetic while it
--    holds the event's terminal lane.
-- 2. fn_ca_promo_profit_finish_entry_fee was rewritten by 20261119002717 (the
--    satellite seat) from the body that predates 20261119001629, so the
--    settle #11329 removed from every paid entry fee came back for every
--    charge that is not a satellite seat (production md5 345276d5...).
--
-- WHAT CHANGES
--
-- Neither function settles. The credit decides on the gate as it is stored
-- (ca_promo_profit_gates.unlocked_at, overrides), which is the hourly answer:
-- sp_ca_promo_profit_hourly_sweep refreshes and releases every account that
-- holds a locked gate once per hour, and the wallet exit trigger
-- (fn_ca_promo_play_through_on_exit) settles live before any chip leaves.
-- The entry fee keeps its consumption, exactly once, and returns.
--
-- WHY THE RESTRICTION DECISION IS UNCHANGED WHERE PRODUCTION DECIDED CHEAPLY
--
-- A winnings credit adds no fee progress, and the settle only ever releases
-- (stamps unlocked_at); it never locks. So the gate the credit needs is the
-- stored gate, plus whatever the settle would have released now:
--   gate already released or overridden   unrestricted, before and after;
--   gate locked, snapshot current, nothing met   restricted, before and after
--     (the settle returned without touching the gate);
--   gate locked, target met since the last hourly look, snapshot stale or
--     showing it met   before: a live recomputation inside the payout, then
--     unrestricted; after: restricted under the still-locked gate. The next
--     hourly pass or the holder's next cash-out (live) releases the gate, and
--     fn_ca_promo_profit_locked_at counts custody only under a locked gate,
--     so those chips are free the moment the gate is. This is the path the
--     hourly snapshot (20261119002019) already takes for a stale "locked"
--     answer. Nothing is ever released early: a release is still decided
--     only on the live fee history.
-- No receipt, custody row, phase or chip movement changes shape. Proof:
-- scripts/ci/test-promo-winnings-credit-never-settles-progress.py (native
-- PostgreSQL 16, production bodies).
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only; no table or row lock.
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric)'::regprocedure)) = '9ddb2d43ea9d3311c64c3391b07fec0a' AND md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure)) = 'f3c623672f20ce7223c2354356fa5fae')
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric)'::regprocedure))
     <> '194f2cc0e53d6735f1b3e9057f9200cb' THEN
    RAISE EXCEPTION 'promo winnings credit changed; revalidate before removing its settle';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure))
     <> '345276d56957bf1e181d713b1c2bf758' THEN
    RAISE EXCEPTION 'promo entry-fee finish changed; revalidate before removing its settle';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_credit_owned(p_source_kind text, p_source uuid, p_grant uuid, p_club uuid, p_user uuid, p_kind text, p_entity uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE g public.ca_promo_play_through_grants%ROWTYPE;prior public.ca_promo_profit_realization_receipts%ROWTYPE;
 phase uuid;restricted numeric:=0;
BEGIN
 IF p_source_kind NOT IN('cash_win','tournament_win','bbj','stake_refund') OR p_source IS NULL OR p_club IS NULL OR p_user IS NULL OR p_entity IS NULL
 OR p_kind NOT IN('player_wallet','agent_wallet','table_stack','pending_addon','event','ticket') OR p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2)
 OR p_amount::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'invalid_original_winnings_realization';END IF;
 SELECT * INTO STRICT g FROM public.ca_promo_play_through_grants WHERE id=p_grant FOR UPDATE;
 IF g.user_id IS DISTINCT FROM p_user THEN RAISE EXCEPTION 'original_winnings_recipient_mismatch';END IF;
 SELECT * INTO prior FROM public.ca_promo_profit_realization_receipts WHERE source_kind=p_source_kind AND source_id=p_source AND grant_id=p_grant;
 IF FOUND THEN
  IF ROW(prior.club_id,prior.user_id,prior.kind,prior.entity_id,prior.amount) IS DISTINCT FROM ROW(p_club,p_user,p_kind,p_entity,p_amount) THEN RAISE EXCEPTION 'original_winnings_realization_identity_reused';END IF;
  RETURN prior.restricted;
 END IF;
 -- 20261119053144: a credit adds no fee progress and decides on the gate as
 -- stored. The hourly sweep and the live cash-out settle release it; a
 -- payout never recomputes promo progress.
 IF p_amount>0 AND EXISTS(SELECT 1 FROM public.ca_promo_profit_gates w WHERE w.grant_id=p_grant AND w.unlocked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_overrides o WHERE o.grant_id=p_grant) THEN
  -- Expiry ends an empty original potential-W phase; a later exact original
  -- asset activates only now, behind all intervening gift blocks.
  IF g.expires_at<=clock_timestamp() AND NOT EXISTS(SELECT 1 FROM public.ca_promo_profit_custody c WHERE c.grant_id=p_grant AND c.amount>0) THEN
   UPDATE public.ca_promo_profit_fee_phases SET closed_at=g.expires_at WHERE grant_id=p_grant AND source_kind='gift' AND closed_at IS NULL;
  END IF;
  SELECT f.id INTO phase FROM public.ca_promo_profit_fee_phases f WHERE f.grant_id=p_grant AND f.closed_at IS NULL;
  IF phase IS NULL THEN
   INSERT INTO public.ca_promo_profit_fee_phases(grant_id,source_kind,source_id) VALUES(p_grant,p_source_kind,p_source) RETURNING id INTO phase;
  END IF;
  restricted:=p_amount;
  INSERT INTO public.ca_promo_profit_custody VALUES(p_grant,p_club,p_user,p_kind,p_entity,p_amount)
  ON CONFLICT(grant_id,club_id,user_id,kind,entity_id) DO UPDATE SET amount=public.ca_promo_profit_custody.amount+EXCLUDED.amount;
 END IF;
 INSERT INTO public.ca_promo_profit_realization_receipts(source_kind,source_id,grant_id,club_id,user_id,kind,entity_id,amount,restricted,phase_id)
 VALUES(p_source_kind,p_source,p_grant,p_club,p_user,p_kind,p_entity,p_amount,restricted,phase);
 RETURN restricted;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_credit_owned(text,uuid,uuid,uuid,uuid,text,uuid,numeric) FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_profit_credit_owned
DO $probe$
DECLARE v_grant uuid := gen_random_uuid(); v_user uuid := gen_random_uuid(); v_club uuid := gen_random_uuid();
BEGIN
  -- An orphan fixture grant (no profile, so no notice is delivered); its
  -- seed triggers write its gate and gift phase. Undone with the probe.
  INSERT INTO public.ca_promo_play_through_grants(id,club_id,user_id,amount,remaining,multiplier,source_kind,source_ref,cycle_started_at,expires_at)
  VALUES(v_grant,v_club,v_user,1,1,4,'club_promo','probe:20261119053144:'||v_grant::text,now(),now()+interval '30 days');
  PERFORM public.fn_ca_promo_profit_credit_owned('tournament_win',gen_random_uuid(),v_grant,v_club,v_user,'player_wallet',v_user,1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_finish_entry_fee(p_charge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- 20261119053144 (restores 20261119001629 over 20261119002717): every entry
 -- fee, a satellite seat or a paid entry, is consumed exactly once and never
 -- settles promo progress. The hourly sweep and the live cash-out do.
 IF NOT public.fn_ca_promo_profit_consume_entry_fee(p_charge) THEN RETURN;END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_entry_fee(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- @probe-for: public.fn_ca_promo_profit_finish_entry_fee
DO $probe$
BEGIN
  PERFORM public.fn_ca_promo_profit_finish_entry_fee(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
