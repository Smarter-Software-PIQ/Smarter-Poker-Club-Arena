-- 20261118031947_free_buy_cutoff_funding_takes_the_union_wallet_last.sql
--
-- A FREE BUY CUTOFF TAKES THE UNION WALLET LAST (2026-11-18).
--
-- Measured 2026-11-18 about 03:00Z: the finished Afternoon Free Buy
-- 4cea3f54-9fce-4bae-a5d5-78a028ed6c75 (547 entries) could not settle. Its
-- finish ran to the 45 s statement timeout on every attempt and rolled back.
-- fn_ca_fund_free_buy_at_cutoff_locked debited union_wallets.promo_wallet
-- first and only then inserted the cutoff funding leg. That insert fires
-- ca_promo_free_buy_funded, which records one promo grant per redeemed
-- registration: 547 grants, tens of seconds, all with the Midway union's one
-- wallet row locked. Every raked cash hand of the union credits that same row
-- (atomic_distribute_rake), so 2,676 cash rake postings timed out at 8 s in 25
-- minutes. Owner ruling: a tournament problem never reaches a cash game.
--
-- THE CHANGE: the same statements in a different order. The cutoff funding
-- leg (and so the per-registration grants) is posted first; the guarded
-- debit of union_wallets.promo_wallet follows it. The wallet row is locked
-- only from that debit on, not through the grant loop.
--
--  * Same money: same leg, same amount, same key, same guarded debit, same
--    escrow and prize-pool postings.
--  * Same refusal: a wallet that cannot cover the amount raises the same
--    'Midway promo funds cannot fund this Free Buy at its cutoff'. The
--    exception leaves the function, so the leg and every grant, lot and slice
--    posted before it roll back with it. A plain unlocked read of the balance
--    ahead of the leg keeps the ordinary unfunded cutoff refusing before
--    anything is posted, exactly where it refused before.
--  * Lock order. Every other writer of this row takes it before a member row:
--    a cash hand credits its rake and then locks each player's member row
--    (promo_apply_playthrough), and promo sends and weekly pay do the same.
--    The grants here hold the entrants' member rows first. So the debit never
--    queues on the wallet row for as long as the 1 s deadlock check: it asks
--    in 400 ms attempts, up to 50. A writer that holds the row while waiting
--    on an entrant ends on its own timeout; this finish is not chosen as the
--    deadlock victim. If the row is never free in that time the finish
--    raises lock_not_available and rolls back whole, to be retried.
--  * No trigger sees the order. Read on production: no chip_ledger insert
--    trigger reads or locks union_wallets (fn_ca_ledger_tally_key reads only
--    its id), the balance/leg agreement (zz_ca_balance_has_its_ledger_row) is
--    deferred to commit, the tally is commutative, and the debit still runs
--    under app.ledger_autoskip_union_wallets so it journals no leg of its own.
--
-- Function body only. No table, data, owner or setting changes. Production
-- already grants EXECUTE to service_role alone; the REVOKE and GRANT below
-- restate exactly that, and the proof refuses any other outcome.
--
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure))='5680bd93df014a8b15eeabb05577277c' AND (SELECT pg_get_userbyid(p.proowner)='postgres' AND p.prosecdef AND p.proconfig::text='{"search_path=public, pg_temp"}' AND p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' FROM pg_proc p WHERE p.oid='public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure))
    <> '84e7bb6af18317fc3ed8b5fc047ca5b1' THEN
  RAISE EXCEPTION 'Free Buy cutoff funding owner changed; requalify the union wallet ordering';
 END IF;
 PERFORM set_config('ca.free_buy_cutoff_owner_before',
   (SELECT p.proowner::text || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
      FROM pg_proc p WHERE p.oid = 'public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure), true);
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(p_tournament_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 v_format text; v_funding jsonb; v_part numeric; v_entries integer;
 v_posted numeric; v_due numeric; k text; n integer; v_prev text; v_wait text;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id = p_tournament_id FOR UPDATE;
 IF NOT FOUND OR coalesce(t.prize_pool_finalized, false) THEN RETURN 0; END IF;
 v_format := public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL OR v_format = 'pko' THEN RETURN 0; END IF;
 k := 'tourney:' || p_tournament_id::text || ':free_buy_cutoff_funding';
 IF EXISTS (SELECT 1 FROM public.chip_ledger WHERE idempotency_key = k) THEN RETURN 0; END IF;

 IF v_format IN ('regular', 'aiof') AND coalesce(t.guaranteed_prize, 0) > 0 THEN
   -- U = max(0, G - C), less any promo a legacy entry already posted.
   v_funding := public.fn_ca_guarantee_funding(p_tournament_id);
   v_due := round(coalesce((v_funding->>'house_due')::numeric, 0), 2);
 ELSE
   -- V: the prize part of every valid first entry (a live ticket redemption,
   -- or a legacy funded head that was not returned), less legacy prize parts.
   v_part := CASE v_format WHEN 'mystery' THEN 0.50 ELSE 1 END;
   SELECT count(*) INTO v_entries
     FROM public.tournament_players tp
    WHERE tp.tournament_id = p_tournament_id
      AND (EXISTS (SELECT 1 FROM smarter_private.free_buy_ticket_redemptions r
                    WHERE r.registration_id = tp.id AND r.returned_at IS NULL)
        OR (EXISTS (SELECT 1 FROM public.chip_ledger l
                     WHERE l.idempotency_key = 'tourney:' || p_tournament_id::text || ':promo_head:' || tp.id::text)
            AND NOT EXISTS (SELECT 1 FROM public.chip_ledger l
                     WHERE l.idempotency_key = 'tourney:' || p_tournament_id::text || ':promo_head:' || tp.id::text || ':return')));
   SELECT coalesce(sum(CASE WHEN l.category = 'promo_send' THEN 1 ELSE -1 END
            * coalesce((l.metadata->>'prize_part')::numeric, 0)), 0)
     INTO v_posted
     FROM public.chip_ledger l
    WHERE l.tournament_id = p_tournament_id
      AND l.metadata->>'kind' = 'midway_free_buy_promo_head'
      AND l.category IN ('promo_send', 'reversal');
   v_due := round(greatest(0, v_part * v_entries - v_posted), 2);
 END IF;
 IF v_due IS NULL OR v_due <= 0 THEN RETURN 0; END IF;

 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Free Buy cutoff funding prelock');
 -- The union wallet row is the one row every raked cash hand of the union
 -- writes. Read it here without a lock, so a cutoff that plainly cannot be
 -- funded still refuses before anything is posted; take and debit it only
 -- after the per-registration grants below, which are the long part.
 IF NOT EXISTS (SELECT 1 FROM public.union_wallets
                 WHERE union_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND promo_wallet >= v_due) THEN
   RAISE EXCEPTION 'Midway promo funds cannot fund this Free Buy at its cutoff'; END IF;
 INSERT INTO public.chip_ledger (
   performed_by, from_type, from_entity_id, from_label, to_type, to_entity_id, to_label,
   amount, category, club_id, tournament_id, idempotency_key, description, metadata)
 VALUES (
   COALESCE(auth.uid(), '2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),
   'union_wallet', 'fade0000-0000-0000-0000-000000000001'::uuid, 'union_wallets.promo_wallet',
   'prize_liability', p_tournament_id, 'tournament_escrow.prize_balance',
   v_due, 'promo_send', t.club_id, p_tournament_id, k,
   CASE WHEN coalesce(t.guaranteed_prize, 0) > 0
        THEN 'Midway Promo Funds Free Buy Guarantee At Cutoff'
        ELSE 'Midway Promo Funds Free Buy Entries At Cutoff' END,
   jsonb_build_object('kind', 'midway_free_buy_promo_head', 'stage', 'cutoff',
     'format', v_format, 'guarantee', coalesce(t.guaranteed_prize, 0),
     'entries', v_entries, 'funding', v_funding,
     'bounty_part', 0, 'prize_part', v_due));
 v_prev := current_setting('app.ledger_autoskip_union_wallets', true);
 PERFORM set_config('app.ledger_autoskip_union_wallets', '1', true);
 -- Every other writer takes this row before a member row; this one already
 -- holds its entrants' member rows. So it never queues on the row for as long
 -- as the deadlock check (1 s): it asks in short attempts, and a writer that
 -- holds the row while waiting on an entrant ends on its own timeout instead
 -- of ending this finish.
 v_wait := current_setting('lock_timeout', true);
 FOR v_try IN 1..50 LOOP
   BEGIN
     PERFORM set_config('lock_timeout', '400ms', true);
     UPDATE public.union_wallets SET promo_wallet = promo_wallet - v_due, updated_at = now()
      WHERE union_id = 'fade0000-0000-0000-0000-000000000001'::uuid AND promo_wallet >= v_due;
     GET DIAGNOSTICS n = ROW_COUNT;
     PERFORM set_config('lock_timeout', coalesce(v_wait, '0'), true);
     EXIT;
   EXCEPTION WHEN lock_not_available THEN
     IF v_try = 50 THEN RAISE; END IF;
   END;
 END LOOP;
 PERFORM set_config('app.ledger_autoskip_union_wallets', coalesce(v_prev, ''), true);
 IF n <> 1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this Free Buy at its cutoff'; END IF;
 PERFORM public.fn_ca_escrow_apply(p_tournament_id, 'Free Buy cutoff funding',
   p_gross_in => v_due, p_bounty_in => 0);
 UPDATE public.tournaments SET prize_pool = coalesce(prize_pool, 0) + v_due
  WHERE id = p_tournament_id;
 RETURN v_due;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_fund_free_buy_at_cutoff_locked(uuid) TO service_role;

DO $proof$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure))
    <> '5680bd93df014a8b15eeabb05577277c' THEN
  RAISE EXCEPTION 'Free Buy cutoff funding postimage is not the qualified one';
 END IF;
 IF current_setting('ca.free_buy_cutoff_owner_before', true) IS DISTINCT FROM
   (SELECT p.proowner::text || '|' || p.prosecdef::text || '|' || coalesce(p.proconfig::text, '')
      FROM pg_proc p WHERE p.oid = 'public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)'::regprocedure) THEN
  RAISE EXCEPTION 'Free Buy cutoff funding owner or settings changed';
 END IF;
 IF has_function_privilege('anon', 'public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.fn_ca_fund_free_buy_at_cutoff_locked(uuid)', 'EXECUTE') THEN
  RAISE EXCEPTION 'Free Buy cutoff funding must stay callable by the service role only';
 END IF;
END $proof$;

COMMIT;
