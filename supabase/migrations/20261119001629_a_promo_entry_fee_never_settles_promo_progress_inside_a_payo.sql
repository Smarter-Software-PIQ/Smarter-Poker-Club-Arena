-- A PROMO ENTRY FEE NEVER SETTLES PROMO PROGRESS INSIDE A PAYOUT (incident 075013fd, 2026-11-19).
--
-- Owner rulings (2026-11-17/18): promo chips never cause payout issues with
-- tournaments or cash games; promo progress is not checked after every hand,
-- it is updated once per hour (sp_ca_promo_profit_hourly_sweep) and at
-- cash-out. 20261118001328 / the owner-ruling body of
-- fn_ca_promo_profit_after_original_fee took the per-hand settle off the cash
-- fee. The tournament entry-fee door still ran it: every
-- tournament_refund_entitlements insert (ca_promo_entry_fee_entitlement) and
-- every promo event charge reaches fn_ca_promo_profit_finish_entry_fee, which
-- ran fn_ca_promo_profit_settle for each holder (production sweep: mean 874 ms,
-- p95 2.7 s, max 16.3 s per account).
--
-- Measured on production 2026-11-18 23:05Z-00:05Z: the capped satellite
-- qualifier settlement of "Satellite Into 25 Chip Bankroll Builder" (#1 and
-- #2, 19-20 qualifiers each) writes one seat entitlement per qualifier, so it
-- settled promo progress up to 20 times inside one transaction and was
-- cancelled at 8 s every attempt (30-44 cancels per 5 min, ~80% inside
-- fn_ca_promo_fee_events), re-prepared every ~9 s and never committed. Each
-- attempt held the finish lane F and both tournaments' T keys EXCLUSIVELY for
-- 8 s: the target's hands queued on T (fn_f06_retain_hand_continuation,
-- insert_hole_cards, hand-number allocation), every satellite's qualifier
-- read and every ordinary finish queued on F (315 waits >= 1 s on
-- fn_get_satellite_qualifier_state alone), and the satellites' own tables
-- stayed parked on their held qualifier boundary. That is the 10-30 s
-- tournament between-hands tail.
--
-- The entry fee keeps its consumption (the lots and receipts the later settle
-- reads). It no longer settles: the hourly sweep does, cash-out does, and every
-- winnings credit (fn_ca_promo_profit_credit_owned) and ticket snapshot still
-- settle the holder first, so no restriction decision reads a stale gate.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure)) = '76cc2188511d632815be14d018e3f8e1')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure))
     <> '4ccc31895ec4d184df900708e29b2c1a' THEN
    RAISE EXCEPTION 'promo entry-fee finish changed; revalidate before removing its settle';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_finish_entry_fee(p_charge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- Owner ruling 2026-11-18: promo progress is never settled per charge.
 -- sp_ca_promo_profit_hourly_sweep settles each account that still holds a
 -- locked winnings gate once per hour; cash-out and every winnings credit
 -- settle the holder before they read a gate.
 PERFORM public.fn_ca_promo_profit_consume_entry_fee(p_charge);
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_entry_fee(uuid) FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
