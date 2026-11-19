-- 20261119175941_prize_payouts_never_settle_promo_progress_on_ledger.sql
--
-- PRIZE PAYOUTS NEVER SETTLE PROMO PROGRESS ON THE LEDGER
-- (incident 075013fd, lane 4).
--
-- OWNER RULINGS (Dan): promo chips can not and should not ever cause payout
-- issues with tournaments or cash games (2026-11-17); promo progress is not
-- checked after every hand, it is updated once per hour and only for accounts
-- with active promo chips, and checked at the cashier on a cash-out
-- (2026-11-18 13:40 America/Chicago).
--
-- WHAT WAS STILL RECHECKING PROMO PROGRESS INSIDE PAYOUTS AFTER #11361
--
-- Migration 20261119053144 (#11361) removed fn_ca_promo_profit_settle from
-- fn_ca_promo_profit_credit_owned and fn_ca_promo_profit_finish_entry_fee.
-- Four remaining payout-path functions STILL invoked
-- fn_ca_promo_play_through_settle on every prize, bounty, satellite award, or
-- tournament refund credit:
--
--   1. public.fn_ca_promo_custody_on_ledger() (trigger zzz_ca_promo_custody
--      AFTER INSERT ON public.chip_ledger): for EVERY credit where
--      NEW.to_type='player_wallet' AND NEW.from_type='prize_liability'
--      (every tournament prize payout, every bounty payout including inside
--      process_tournament_rebuy's R(id) lane, and every tournament refund),
--      it unconditionally called fn_ca_promo_play_through_settle(NEW.club_id,
--      uid). For any open-grant holder whose hourly snapshot was missing or
--      stale, that locked club_members and ran fn_ca_promo_shared_fee_state_live
--      (1.1 s mean, 15.6 s max) inside the payout transaction.
--   2. public.fn_ca_promo_realize_event_principal(uuid): called
--      fn_ca_promo_play_through_settle(l.club_id, l.to_entity_id) a second
--      time on tournament refunds and legacy/unbound prize or bounty credits.
--   3. public.fn_ca_promo_roll_event_principal(uuid, uuid, text): called
--      fn_ca_promo_play_through_settle(earning_club, p_user) on satellite
--      seat and ticket awards.
--   4. public.fn_ca_promo_profit_return_entitlement_ticket(uuid, uuid): called
--      fn_ca_promo_play_through_settle(scope_club, e.user_id) on returned
--      tournament entry-entitlement tickets.
--
-- WHAT CHANGES
--
-- None of these four payout-path functions settles promo play-through progress.
-- Each decides on the stored grant state (ca_promo_play_through_grants.closed_at
-- IS NULL):
--   - Already-closed grants are skipped identically.
--   - Open grants not yet met move their principal custody from 'event' to
--     'player_wallet' / 'event' / 'ticket' identically.
--   - Open grants whose fee target was met since the last hourly sweep move
--     their principal custody under the still-open grant; NOTHING is released
--     early. sp_ca_promo_profit_hourly_sweep (hourly) and
--     fn_ca_promo_play_through_on_exit (live at cash-out) close the grant and
--     release those chips immediately.
-- Cash table cashouts (NEW.category = 'table_cashout') keep their existing
-- settle call in fn_ca_promo_custody_on_ledger unchanged.
--
-- LOCK FOOTPRINT. CREATE OR REPLACE FUNCTION only (anchored rewrite of four
-- existing functions); no table or row lock.
--
-- @live-proof: (SELECT position('20261119175941' in pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure)) > 0 AND position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_realize_event_principal(uuid)'::regprocedure)) = 0 AND position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_roll_event_principal(uuid,uuid,text)'::regprocedure)) = 0 AND position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid)'::regprocedure)) = 0)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

-- @probe-exempt: public.fn_ca_promo_custody_on_ledger trigger function cannot be called directly; covered by plpgsql_check and native PG proof
DO $rewrite$
DECLARE
  r record;
  v_sig regprocedure;
  v_def text;
  v_new_def text;
  v_n integer;
  v_acl text;
  v_owner oid;
  v_definer boolean;
  v_config text[];
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      (
        'public.fn_ca_promo_custody_on_ledger()',
        E'  IF NEW.category=''table_cashout'' THEN PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,''table_stack'',NEW.from_entity_id);END IF;\n  PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);',
        E'  -- 20261119175941: tournament prize, bounty and refund credits (dest=''event'')\n  -- never settle promo progress inside a payout; hourly sweep and live cash-out release.\n  IF NEW.category=''table_cashout'' THEN\n   PERFORM public.fn_ca_promo_profit_prelock_source(NEW.club_id,uid,''table_stack'',NEW.from_entity_id);\n   PERFORM public.fn_ca_promo_play_through_settle(NEW.club_id,uid);\n  END IF;'
      ),
      (
        'public.fn_ca_promo_realize_event_principal(uuid)',
        E' PERFORM public.fn_ca_promo_play_through_settle(l.club_id,l.to_entity_id);',
        E' -- 20261119175941: prize/bounty/refund realization decides on stored grant state; hourly sweep and live cash-out release.'
      ),
      (
        'public.fn_ca_promo_roll_event_principal(uuid,uuid,text)',
        E' PERFORM public.fn_ca_promo_play_through_settle(earning_club,p_user);',
        E' -- 20261119175941: satellite/event principal roll decides on stored grant state; hourly sweep and live cash-out release.'
      ),
      (
        'public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid)',
        E' PERFORM public.fn_ca_promo_play_through_settle(scope_club,e.user_id);',
        E' -- 20261119175941: returned entitlement ticket decides on stored grant state; hourly sweep and live cash-out release.'
      )
    ) AS s(signature, old_text, new_text)
  LOOP
    v_sig := r.signature::regprocedure;
    v_def := pg_get_functiondef(v_sig);
    v_n := (length(v_def) - length(replace(v_def, r.old_text, ''))) / length(r.old_text);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '20261119175941: anchor in % found % times, expected 1 (revalidate before applying)', r.signature, v_n;
    END IF;
    SELECT p.proacl::text, p.proowner, p.prosecdef, p.proconfig
      INTO v_acl, v_owner, v_definer, v_config
      FROM pg_proc p WHERE p.oid = v_sig;
    v_new_def := replace(v_def, r.old_text, r.new_text);
    EXECUTE v_new_def;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
       WHERE p.oid = v_sig
         AND p.proacl::text IS NOT DISTINCT FROM v_acl
         AND p.proowner = v_owner
         AND p.prosecdef = v_definer
         AND p.proconfig IS NOT DISTINCT FROM v_config
    ) THEN
      RAISE EXCEPTION '20261119175941: metadata changed on %', r.signature;
    END IF;
  END LOOP;

  IF position('20261119175941' in pg_get_functiondef('public.fn_ca_promo_custody_on_ledger()'::regprocedure)) = 0
     OR position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_realize_event_principal(uuid)'::regprocedure)) > 0
     OR position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_roll_event_principal(uuid,uuid,text)'::regprocedure)) > 0
     OR position('fn_ca_promo_play_through_settle(' in pg_get_functiondef('public.fn_ca_promo_profit_return_entitlement_ticket(uuid,uuid)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION '20261119175941: post-install verification failed';
  END IF;
END
$rewrite$;

-- @probe-for: public.fn_ca_promo_realize_event_principal
DO $probe$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_realize_event_principal(gen_random_uuid());
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_promo_event_realization' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_roll_event_principal
DO $probe$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_roll_event_principal(gen_random_uuid(), gen_random_uuid(), 'ticket');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'invalid_promo_event_roll' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

-- @probe-for: public.fn_ca_promo_profit_return_entitlement_ticket
DO $probe$
BEGIN
  BEGIN
    PERFORM public.fn_ca_promo_profit_return_entitlement_ticket(gen_random_uuid(), gen_random_uuid());
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
