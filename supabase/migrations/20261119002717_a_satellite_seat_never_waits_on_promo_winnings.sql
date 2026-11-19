-- 20261119002717_a_satellite_seat_never_waits_on_promo_winnings.sql
-- @live-proof: (SELECT prosrc LIKE '%satellite_seat%' FROM pg_proc WHERE oid='public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure)
--
-- A SATELLITE SEAT NEVER WAITS ON PROMO WINNINGS (2026-11-19).
--
-- OWNER RULINGS (Dan): promo chips can not and should not ever cause payout
-- issues with tournaments or cash games (2026-11-17); promo progress is not
-- checked inline, it is updated once per hour and only for accounts with
-- active promo chips (2026-11-18 13:40 America/Chicago).
--
-- WHAT HAPPENED. 2026-11-18 23:02 to 2026-11-19 00:10 UTC, satellites
-- 30e72de6 and 6cfaaadc into the 25 Chip Bankroll Builder reached their
-- qualifier boundary with 20 and 19 players. Every seat the settlement awards
-- inserts a tournament_refund_entitlements row; its trigger
-- (fn_ca_promo_entry_fee_entitlement) ran this function, which ran
-- fn_ca_promo_profit_settle for the seat holder: a full re-evaluation of that
-- account's promo fee history, inside the satellite's settlement transaction,
-- under the finish lane and both events' lanes. All 39 qualifiers held promo
-- grants. Measured read-only on production during the fault, that evaluation
-- alone cost 10.4 s and 9.7 s per satellite (29 ms to 1.3 s per account), so
-- the settlement could not fit service_role's 8 s statement: about 500
-- attempts were cancelled, every one at the satellite_seat award insert
-- (fn_ca_settle_satellite_cohort line 1067), each holding the lanes for 8 s.
-- Migration 20261118233000 gave the executor 45 s and both events then settled
-- exactly once; the seat path still spent 10 s and more of lane time on promo
-- arithmetic, and a larger field would outgrow 45 s the same way.
--
-- WHAT CHANGES. A satellite seat charge has its promo entry fee consumed
-- exactly as before (the money rows are untouched) and then returns. It no
-- longer runs the winnings settle. Paid entries are unchanged.
--
-- WHY THIS CANNOT LET LOCKED PROMO OUT. fn_ca_promo_profit_settle does one
-- thing: it stamps ca_promo_profit_gates.unlocked_at when the fee target is
-- met. Not running it can only delay a release, never grant one. The account
-- is still settled by sp_ca_promo_profit_hourly_sweep (every account with a
-- locked gate, hourly) and by fn_ca_promo_play_through_on_exit at the moment
-- chips leave the wallet, so a cash-out always sees a fresh answer.
--
-- Replaces one function body; takes no table lock.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_finish_entry_fee(p_charge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
 IF NOT public.fn_ca_promo_profit_consume_entry_fee(p_charge) THEN RETURN;END IF;
 -- A satellite seat is awarded inside the satellite's settlement, under the
 -- finish lane. Its fee is consumed above; the winnings settle (a release
 -- only) belongs to the hourly sweep and the cash-out path, never to a seat.
 IF EXISTS(SELECT 1 FROM public.tournament_refund_entitlements e
            WHERE e.source_ledger_id=p_charge AND e.entitlement_kind='satellite_seat') THEN
  RETURN;
 END IF;
 FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_play_through_grants g WHERE g.id IN(SELECT grant_id FROM public.ca_promo_profit_event_lots WHERE charge_ledger_id=p_charge UNION SELECT grant_id FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id=p_charge)
 UNION SELECT p.club_id,p.player_id FROM public.ca_promo_event_fee_consumption_receipts p WHERE p.charge_ledger_id=p_charge LOOP
  PERFORM public.fn_ca_promo_profit_settle(r.club_id,r.user_id);
 END LOOP;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_finish_entry_fee(uuid) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
