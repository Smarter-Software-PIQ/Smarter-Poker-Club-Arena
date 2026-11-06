INSERT INTO public.union_wallets VALUES ('fade0000-0000-0000-0000-000000000001', 100000, now());

CREATE FUNCTION public.t_new(p_fmt text, p_g numeric) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid := gen_random_uuid();
BEGIN
 INSERT INTO public.tournaments(id, union_id, status, guaranteed_prize, is_pko, is_bounty, is_mystery_bounty, all_in_or_fold, bounty_amount)
 VALUES (v, 'fade0000-0000-0000-0000-000000000001', 'REGISTERING', p_g,
   p_fmt='pko', p_fmt='pko', p_fmt='mystery', p_fmt='aiof',
   CASE p_fmt WHEN 'pko' THEN 1 WHEN 'mystery' THEN 0.50 ELSE 0 END);
 RETURN v;
END $$;

-- What a registration door does for a Free Buy: roster row with the door's
-- bounty head, ticket redemption, promo head, pools by the door's split.
CREATE FUNCTION public.t_register(p_tid uuid, p_n integer, p_horse boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i integer; v_reg uuid; v_user uuid; s jsonb;
BEGIN
 FOR i IN 1..p_n LOOP
   v_reg := gen_random_uuid(); v_user := gen_random_uuid();
   s := CASE WHEN p_horse THEN public.fn_register_horse_for_tournament_before_maintenance_gate(p_tid, v_user)
             ELSE public.fn_register_for_tournament_before_atomic_capacity_20260907(p_tid, false) END;
   INSERT INTO public.tournament_players VALUES (v_reg, p_tid, v_user, 'registered', (s->>'bounty')::numeric);
   INSERT INTO smarter_private.free_buy_ticket_days(user_id, gaming_day, used) VALUES (v_user, current_date, 1);
   INSERT INTO smarter_private.free_buy_ticket_redemptions(registration_id, user_id, tournament_id, gaming_day)
   VALUES (v_reg, v_user, p_tid, current_date);
   PERFORM public.fn_ca_midway_free_buy_promo_head(p_tid, v_reg, false);
   UPDATE public.tournaments SET prize_pool = prize_pool + (s->>'prize')::numeric,
     bounty_pool = bounty_pool + (s->>'bounty')::numeric WHERE id = p_tid;
 END LOOP;
END $$;

CREATE FUNCTION public.t_wallet(p_tid uuid, p_amount numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_amount <= 0 THEN RETURN; END IF;
 INSERT INTO public.chip_ledger(from_type, to_type, to_entity_id, amount, category, tournament_id, idempotency_key)
 VALUES ('player_wallet', 'prize_liability', p_tid, p_amount, 'rebuy', p_tid, 'rebuy:'||gen_random_uuid());
 PERFORM public.fn_ca_escrow_apply(p_tid, 'rebuy', p_amount, 0);
 UPDATE public.tournaments SET prize_pool = prize_pool + p_amount WHERE id = p_tid;
END $$;

CREATE FUNCTION public.t_promo_net(p_tid uuid) RETURNS numeric LANGUAGE sql AS $$
 SELECT coalesce(sum(CASE WHEN to_entity_id = p_tid AND category = 'promo_send' THEN amount
                          WHEN from_entity_id = p_tid AND category = 'reversal' AND to_type = 'union_wallet' THEN -amount ELSE 0 END), 0)
   FROM public.chip_ledger WHERE tournament_id = p_tid $$;
CREATE FUNCTION public.t_overlay(p_tid uuid) RETURNS numeric LANGUAGE sql AS $$
 SELECT coalesce(sum(amount), 0) FROM public.chip_ledger WHERE tournament_id = p_tid AND category = 'overlay' $$;

CREATE FUNCTION public.t_check(p_label text, p_tid uuid, p_pool numeric, p_promo numeric, p_bounty numeric DEFAULT NULL) RETURNS text LANGUAGE plpgsql AS $$
DECLARE t public.tournaments%ROWTYPE; e public.tournament_escrow%ROWTYPE; v_promo numeric; v_ov numeric;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id = p_tid;
 SELECT * INTO e FROM public.tournament_escrow WHERE tournament_id = p_tid;
 v_promo := public.t_promo_net(p_tid); v_ov := public.t_overlay(p_tid);
 IF round(t.prize_pool,2) <> p_pool OR round(v_promo,2) <> p_promo OR v_ov <> 0
    OR (p_bounty IS NOT NULL AND round(t.bounty_pool,2) <> p_bounty)
    OR round(coalesce(e.prize_balance,0),2) <> round(t.prize_pool,2)
    OR round(coalesce(e.bounty_balance,0),2) <> round(t.bounty_pool,2) THEN
   RAISE EXCEPTION '% FAIL: pool % (want %), promo % (want %), overlay %, bounty % (want %), escrow prize % bounty %',
     p_label, t.prize_pool, p_pool, v_promo, p_promo, v_ov, t.bounty_pool, p_bounty, e.prize_balance, e.bounty_balance;
 END IF;
 RETURN p_label || ' PASS: P=' || t.prize_pool || ' U=' || v_promo || ' bounty=' || t.bounty_pool;
END $$;
