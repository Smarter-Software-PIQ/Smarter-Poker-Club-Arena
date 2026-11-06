-- After the migration. Owner acceptance table (Dan, 2026-11-05 14:24 CT) plus
-- legacy reconciliation, retries, PKO, mystery and unregistration.
CREATE FUNCTION pg_temp.run(p_fmt text, p_g numeric, p_tickets integer, p_c numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_want numeric;
BEGIN
 v_want := CASE p_fmt WHEN 'pko' THEN p_tickets WHEN 'mystery' THEN p_tickets * 0.5 ELSE 0 END;
 v := public.t_new(p_fmt, p_g);
 PERFORM public.t_register(v, p_tickets / 2);
 PERFORM public.t_register(v, p_tickets - p_tickets / 2, true);  -- horses use the same door rules
 -- During the window: no promo money in the prize pool, ever.
 IF public.t_promo_net(v) <> v_want
    OR (SELECT prize_pool FROM public.tournaments WHERE id = v) <> 0 THEN
   RAISE EXCEPTION '% G% window FAIL: promo % pool %', p_fmt, p_g, public.t_promo_net(v), (SELECT prize_pool FROM public.tournaments WHERE id = v);
 END IF;
 PERFORM public.t_wallet(v, p_c);
 PERFORM public.fn_apply_prize_guarantee(v, 'test');
 RETURN v;
END $$;

-- Guaranteed rows: P = max(G, C), U = max(0, G - C).
SELECT public.t_check('G500 T250 C160', pg_temp.run('aiof', 500, 250, 160), 500, 340);
SELECT public.t_check('G500 T250 C0',   pg_temp.run('aiof', 500, 250, 0),   500, 500);
SELECT public.t_check('G500 T250 C500', pg_temp.run('regular', 500, 250, 500), 500, 0);
SELECT public.t_check('G500 T250 C650', pg_temp.run('regular', 500, 250, 650), 650, 0);
-- Non-guaranteed rows: P = V + C, U = V.
SELECT public.t_check('NG T250 C160', pg_temp.run('regular', 0, 250, 160), 410, 250);
SELECT public.t_check('NG T250 C0',   pg_temp.run('regular', 0, 250, 0),   250, 250);
-- Mystery 50/50: bounty half at entry, prize half at the cutoff.
SELECT public.t_check('Mystery T250 C160', pg_temp.run('mystery', 0, 250, 160), 285, 250, 125);
-- PKO: the head is the whole promo chip; nothing at the cutoff.
SELECT public.t_check('PKO T250 C0', pg_temp.run('pko', 0, 250, 0), 0, 250, 250);

-- Retry: finalizing twice and funding the cutoff twice posts nothing more.
DO $$
DECLARE v uuid; before numeric;
BEGIN
 v := pg_temp.run('aiof', 500, 250, 160);
 before := public.t_promo_net(v);
 PERFORM public.fn_apply_prize_guarantee(v, 'retry');
 PERFORM public.fn_ca_fund_free_buy_at_cutoff_locked(v);
 IF public.t_promo_net(v) <> before OR (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key = 'tourney:'||v||':free_buy_cutoff_funding') <> 1 THEN
   RAISE EXCEPTION 'retry FAIL';
 END IF;
 -- Unfinalized double call of the cutoff fund alone is also once.
 v := public.t_new('regular', 0); PERFORM public.t_register(v, 10);
 PERFORM public.fn_ca_fund_free_buy_at_cutoff_locked(v);
 PERFORM public.fn_ca_fund_free_buy_at_cutoff_locked(v);
 IF public.t_promo_net(v) <> 10 THEN RAISE EXCEPTION 'double cutoff FAIL %', public.t_promo_net(v); END IF;
 RAISE NOTICE 'retry PASS';
END $$;

-- Legacy L1: 124 legacy heads + 100 new entries, players pay 50: U = 450 total.
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L1'), 100);
SELECT public.t_wallet((SELECT id FROM t_ids WHERE label='L1'), 50);
SELECT public.fn_apply_prize_guarantee((SELECT id FROM t_ids WHERE label='L1'), 'test');
SELECT public.t_check('Legacy aiof G500 124+100 C50', (SELECT id FROM t_ids WHERE label='L1'), 500, 450);
-- Legacy L2: 189 legacy heads, players pay 351 > 250: P 351, the 189 go back, U 0.
SELECT public.t_wallet((SELECT id FROM t_ids WHERE label='L2'), 351);
SELECT public.fn_apply_prize_guarantee((SELECT id FROM t_ids WHERE label='L2'), 'test');
SELECT public.t_check('Legacy regular G250 189 C351', (SELECT id FROM t_ids WHERE label='L2'), 351, 0);
-- Legacy L3: 143 legacy (0.5 prize each posted) + 57 new; prize half of 200 = 100; bounty 100.
SELECT public.t_register((SELECT id FROM t_ids WHERE label='L3'), 57);
SELECT public.fn_apply_prize_guarantee((SELECT id FROM t_ids WHERE label='L3'), 'test');
SELECT public.t_check('Legacy mystery 143+57', (SELECT id FROM t_ids WHERE label='L3'), 100, 200, 100);

-- Unregistration: a legacy mystery leg returns its whole chip; a new mystery
-- leg returns its half; a new regular entry returns no money and its ticket.
DO $$
DECLARE v uuid; r uuid; w0 numeric; w1 numeric; used0 integer;
BEGIN
 v := (SELECT id FROM t_ids WHERE label='L4');
 SELECT id INTO r FROM public.tournament_players WHERE tournament_id = v LIMIT 1;
 SELECT promo_wallet INTO w0 FROM public.union_wallets;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);
 SELECT promo_wallet INTO w1 FROM public.union_wallets;
 IF w1 - w0 <> 1 OR (SELECT prize_pool FROM public.tournaments WHERE id=v) <> 1 OR (SELECT bounty_pool FROM public.tournaments WHERE id=v) <> 1
    OR (SELECT returned_at FROM smarter_private.free_buy_ticket_redemptions WHERE registration_id=r) IS NULL THEN
   RAISE EXCEPTION 'legacy mystery return FAIL';
 END IF;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);  -- second return is a no-op
 IF (SELECT promo_wallet FROM public.union_wallets) <> w1 THEN RAISE EXCEPTION 'legacy return retry FAIL'; END IF;

 v := public.t_new('mystery', 0); PERFORM public.t_register(v, 2);
 SELECT id INTO r FROM public.tournament_players WHERE tournament_id = v LIMIT 1;
 SELECT promo_wallet INTO w0 FROM public.union_wallets;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);
 IF (SELECT promo_wallet FROM public.union_wallets) - w0 <> 0.5 OR (SELECT bounty_pool FROM public.tournaments WHERE id=v) <> 0.5
    OR (SELECT prize_pool FROM public.tournaments WHERE id=v) <> 0 THEN
   RAISE EXCEPTION 'new mystery return FAIL';
 END IF;

 v := public.t_new('regular', 250); PERFORM public.t_register(v, 2);
 SELECT id INTO r FROM public.tournament_players WHERE tournament_id = v LIMIT 1;
 SELECT d.used INTO used0 FROM smarter_private.free_buy_ticket_days d JOIN public.tournament_players p ON p.user_id = d.user_id WHERE p.id = r;
 SELECT promo_wallet INTO w0 FROM public.union_wallets;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);
 IF (SELECT promo_wallet FROM public.union_wallets) <> w0
    OR (SELECT returned_at FROM smarter_private.free_buy_ticket_redemptions WHERE registration_id=r) IS NULL
    OR (SELECT d.used FROM smarter_private.free_buy_ticket_days d JOIN public.tournament_players p ON p.user_id = d.user_id WHERE p.id = r) <> used0 - 1 THEN
   RAISE EXCEPTION 'new regular return FAIL';
 END IF;
 -- The returned entry no longer counts at the cutoff (non-guaranteed V).
 v := public.t_new('regular', 0); PERFORM public.t_register(v, 3);
 SELECT id INTO r FROM public.tournament_players WHERE tournament_id = v LIMIT 1;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);
 UPDATE public.tournament_players SET status='unregistered' WHERE id = r;
 PERFORM public.fn_apply_prize_guarantee(v, 'test');
 IF (SELECT prize_pool FROM public.tournaments WHERE id=v) <> 2 THEN RAISE EXCEPTION 'returned entry counted FAIL'; END IF;
 RAISE NOTICE 'unregistration PASS';
END $$;

-- A started event never returns a ticket for an entry with no posted money.
DO $$
DECLARE v uuid; r uuid;
BEGIN
 v := public.t_new('regular', 250); PERFORM public.t_register(v, 1);
 UPDATE public.tournaments SET status='RUNNING', started_at=now() WHERE id=v;
 SELECT id INTO r FROM public.tournament_players WHERE tournament_id = v;
 PERFORM public.fn_ca_midway_free_buy_promo_head(v, r, true);
 IF (SELECT returned_at FROM smarter_private.free_buy_ticket_redemptions WHERE registration_id=r) IS NOT NULL THEN
   RAISE EXCEPTION 'started return FAIL';
 END IF;
 RAISE NOTICE 'started PASS';
END $$;

-- Non-Midway events are untouched.
DO $$
DECLARE v uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.tournaments(id, status, guaranteed_prize, prize_pool) VALUES (v, 'RUNNING', 500, 100);
 IF public.fn_ca_fund_free_buy_at_cutoff_locked(v) <> 0 THEN RAISE EXCEPTION 'non-midway FAIL'; END IF;
 RAISE NOTICE 'non-midway PASS';
END $$;

-- Promo wallet conservation: every promo chip that left the wallet is in a pool.
SELECT CASE WHEN round(100000 - promo_wallet, 2) = (SELECT round(sum(public.t_promo_net(id)), 2) FROM public.tournaments)
  THEN 'promo conservation PASS' ELSE 'promo conservation FAIL' END FROM public.union_wallets;
