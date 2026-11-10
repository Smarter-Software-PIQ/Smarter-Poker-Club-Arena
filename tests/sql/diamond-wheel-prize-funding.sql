DO $$
DECLARE example record; actual record;
BEGIN
 FOR example IN SELECT * FROM (VALUES
  (100, 75, 75, 0, 0),
  (100, 101, 101, 0, 1),
  (0, 10000, 10000, 0, 10000),
  (-9999, 4, 1, 3, 10000),
  (-10000, 3000000, 0, 3000000, 10000)
 ) AS cases(balance, prize, owner_part, platform_part, shortage)
 LOOP
  SELECT * INTO STRICT actual FROM public.fn_wheel_prize_funding(example.balance, example.prize);
  IF (actual.owner_diamonds, actual.platform_diamonds, actual.owner_shortfall)
     IS DISTINCT FROM (example.owner_part::bigint, example.platform_part::bigint, example.shortage::bigint)
     OR actual.owner_diamonds + actual.platform_diamonds <> example.prize THEN
   RAISE EXCEPTION 'Incorrect funding for balance %, prize %', example.balance, example.prize;
  END IF;
 END LOOP;
END $$;

-- Exercise both actual funding wallets and the player debit in the private fixture.
BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"service_role"}';
DO $$
DECLARE
 club uuid := '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
 host uuid := 'd1000000-0000-4000-8000-000000000004';
 player uuid := 'd1000000-0000-4000-8000-000000000001';
 owner_id_fixture uuid; statement_before numeric;
 payout_day date:=(now() AT TIME ZONE 'America/Chicago')::date;
 promo numeric; union_bank numeric; club_bank numeric; member_balance numeric; pay record;
BEGIN
 IF current_database() <> 'diamond_games_probe' THEN RAISE EXCEPTION 'private Diamond fixture required'; END IF;
 SELECT promo_wallet,chip_balance INTO STRICT promo,union_bank FROM public.union_wallets WHERE union_id=host;
 SELECT chip_treasury INTO STRICT club_bank FROM public.clubs WHERE id=club;
 SELECT chip_balance INTO STRICT member_balance FROM public.club_members WHERE club_id=club AND user_id=player;
 SELECT owner_id INTO STRICT owner_id_fixture FROM public.unions WHERE id=host;
 SELECT public.fn_diamond_spin_chip_payouts(owner_id_fixture,payout_day) INTO statement_before;
 SELECT * INTO STRICT pay FROM public.fn_diamond_game_pay_chips('wheel_prize',host,'union',club,player,
  promo+1,'wheel-test:union-split','Wheel split test','{}');
 IF pay.from_bank IS DISTINCT FROM 1::numeric OR pay.from_promo IS DISTINCT FROM promo
  OR public.fn_diamond_spin_chip_payouts(owner_id_fixture,payout_day) IS DISTINCT FROM statement_before+promo+1
  OR pay.member_after IS DISTINCT FROM member_balance+promo+1
  OR (SELECT chip_balance FROM public.union_wallets WHERE union_id=host) IS DISTINCT FROM union_bank
  OR (SELECT chip_treasury FROM public.clubs WHERE id=club) IS DISTINCT FROM club_bank-1 THEN
  RAISE EXCEPTION 'Incorrect union promo / club wallet fallback';
 END IF;
END $$;
ROLLBACK;
