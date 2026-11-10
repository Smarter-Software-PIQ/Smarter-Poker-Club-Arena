-- Isolated funded owner, owner credit, and house excess, through the
-- authenticated card-pick RPC and the service-managed daily settlement.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'isolated financial fixture required'; END IF;
END $$;
\ir ../fixtures/accounting-delivery/diamond-games/wheel-prize-funding-dependencies.sql
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"service_role"}';
DO $$
DECLARE player uuid:='d1000000-0000-4000-8000-000000000005';
 owner_id_fixture uuid:='d1000000-0000-4000-8000-000000000002'; club uuid:='d1000000-0000-4000-8000-000000000003';
 award uuid; initial_player bigint; initial_owner bigint; initial_house bigint:=20000;
 financing public.wheel_prize_financing; result jsonb; again jsonb;
 yesterday date:=(clock_timestamp() AT TIME ZONE 'America/Chicago')::date-1;
BEGIN
 SELECT diamonds INTO STRICT initial_player FROM public.profiles WHERE id=player;
 SELECT diamonds INTO STRICT initial_owner FROM public.profiles WHERE id=owner_id_fixture;
 -- Leave one spendable diamond with the owner. The rest remains in
 -- the fixture and the writes roll back after both settlements are checked.
 result:=public.add_diamonds_to_balance(owner_id_fixture,-(initial_owner-1)::integer,'transfer','Test Funding','credit-test:initial-owner',player);
 IF (result->>'success') IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Owner setup failed: %',result; END IF;
 PERFORM public.fn_diamond_spin_book(owner_id_fixture,club,club,'club',player,'diamond_prize',-7500,'credit-test:opening-draw','Opening fixture custody');
 INSERT INTO public.ca_diamond_house(id,balance) VALUES(1,initial_house)
 ON CONFLICT(id) DO UPDATE SET balance=EXCLUDED.balance;
 PERFORM public.fn_diamond_spin_book(owner_id_fixture,club,club,'club',player,'entry',12500,'credit-test:closed-day','Closed Day Intake',yesterday);
 -- The pending award and past day retain the old owner across a club sale.
 UPDATE public.clubs SET owner_id=player WHERE id=club;
 BEGIN
  PERFORM public.fn_diamond_spin_book(owner_id_fixture,club,club,'club',player,'diamond_prize',-1,'forged-owner-change','Unsealed expense');
  RAISE EXCEPTION 'Unsealed old-owner debit accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Diamond Spin Custody Does Not Match The Current Host Owner' THEN RAISE; END IF;
 END;
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 FOR idx IN 1..2 LOOP
  INSERT INTO public.wheel_card_awards(spin_id,user_id,club_id,host_id,host_kind,owner_id,risk_diamonds,half_diamonds,
   permutation,roll,nonce,server_seed,server_seed_hash,client_seed)
  VALUES(gen_random_uuid(),player,club,club,'club',owner_id_fixture,2500,1250,0,0,idx,'test-prize','test-hash','test-client')
  RETURNING id INTO award;
  SET LOCAL ROLE authenticated;
  result:=public.fn_wheel_diamond_cards_pick(award,3::smallint);
  again:=public.fn_wheel_diamond_cards_pick(award,3::smallint);
  RESET ROLE;
  SELECT * INTO STRICT financing FROM public.wheel_prize_financing WHERE award_id=award;
  IF result->>'ok' IS DISTINCT FROM 'true' OR (result->>'paid_diamonds')::integer<>7500 OR again->>'replayed' IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Card failed or did not replay once: % / %',result,again; END IF;
  IF idx=1 AND (financing.owner_cash,financing.owner_advance,financing.platform_expense) IS DISTINCT FROM (1::bigint,7499::bigint,0::bigint) THEN
   RAISE EXCEPTION 'Owner shortfall split differed: %',financing; END IF;
  IF idx=2 AND (financing.owner_cash,financing.owner_advance,financing.platform_expense) IS DISTINCT FROM (0::bigint,2501::bigint,4999::bigint) THEN
   RAISE EXCEPTION 'Platform excess split differed: %',financing; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE user_id=owner_id_fixture AND data->>'award_id'=award::text)<>1 THEN
   RAISE EXCEPTION 'Expected one owner shortage alert per paid award'; END IF;
 END LOOP;
 IF (SELECT diamonds FROM public.profiles WHERE id=player)<>initial_player+15000
  OR (SELECT outstanding FROM public.wheel_owner_credit WHERE owner_id=owner_id_fixture)<>10000
  OR (SELECT balance FROM public.ca_diamond_house WHERE id=1)<>initial_house-14999
  OR (SELECT diamonds FROM public.profiles WHERE id=owner_id_fixture)<0 THEN
  RAISE EXCEPTION 'Player, owner or platform did not reconcile after both cards'; END IF;

 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.fn_diamond_spin_settle_day(owner_id_fixture,yesterday);
 again:=public.fn_diamond_spin_settle_day(owner_id_fixture,yesterday);
 IF result->>'ok' IS DISTINCT FROM 'true' OR again->>'replayed' IS DISTINCT FROM 'true'
  OR (SELECT outstanding FROM public.wheel_owner_credit WHERE owner_id=owner_id_fixture)<>0
  OR (SELECT balance FROM public.ca_diamond_house WHERE id=1)<>initial_house-4999
  OR (SELECT amount FROM public.wheel_owner_credit_repayments WHERE owner_id=owner_id_fixture AND day=yesterday)<>10000
  OR (result->>'credited_net')::bigint<>2000 THEN
  RAISE EXCEPTION 'Daily repayment or replay failed: % / %',result,again; END IF;
 UPDATE public.clubs SET owner_id=owner_id_fixture WHERE id=club;
END $$;
-- A one-billion stake can seal a three-billion prize. A player's balance,
-- every mirror, the permanent receipt and the ordinary debit still agree.
DO $$
DECLARE player uuid:='d1000000-0000-4000-8000-000000000005';
 owner_id_fixture uuid:='d1000000-0000-4000-8000-000000000002'; club uuid:='d1000000-0000-4000-8000-000000000003';
 award uuid; prior_balance bigint; expected bigint; result jsonb; replay jsonb;
BEGIN
 SELECT diamonds INTO STRICT prior_balance FROM public.profiles WHERE id=player;
 UPDATE public.ca_diamond_house SET balance=5000000000 WHERE id=1;
 INSERT INTO public.wheel_card_awards(spin_id,user_id,club_id,host_id,host_kind,owner_id,risk_diamonds,half_diamonds,
  permutation,roll,nonce,server_seed,server_seed_hash,client_seed)
 VALUES(gen_random_uuid(),player,club,club,'club',owner_id_fixture,1000000000,500000000,0,0,3,'wide-prize','test-hash','wide-client')
 RETURNING id INTO award;
 PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 result:=public.fn_wheel_diamond_cards_pick(award,3::smallint);
 replay:=public.fn_wheel_diamond_cards_pick(award,1::smallint);
 RESET ROLE;
 expected:=prior_balance+3000000000;
 IF result->>'ok' IS DISTINCT FROM 'true' OR replay->>'replayed' IS DISTINCT FROM 'true'
  OR (result->>'paid_diamonds')::bigint<>3000000000 OR (replay->>'paid_diamonds')::bigint<>3000000000
  OR (SELECT diamonds FROM public.profiles WHERE id=player) IS DISTINCT FROM expected
  OR (SELECT balance FROM public.user_diamonds WHERE user_id=player) IS DISTINCT FROM expected
  OR (SELECT balance FROM public.diamond_wallets WHERE user_id=player) IS DISTINCT FROM expected
  OR (SELECT balance FROM public.user_diamond_balance WHERE user_id=player) IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Wide card or wallet mirrors did not match: % / %', result,replay; END IF;
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 result:=public.deduct_diamonds(player,expected+1,'Too much','wheel_spin','wheel_spin',
  jsonb_build_object('recipient_id',owner_id_fixture),'wide-test:excess',0);
 IF result->>'success' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Excess debit admitted'; END IF;
 result:=public.deduct_diamonds(player,expected,'Full wallet','wheel_spin','wheel_spin',
  jsonb_build_object('recipient_id',owner_id_fixture),'wide-test:full',0);
 IF result->>'success' IS DISTINCT FROM 'true' OR (SELECT diamonds FROM public.profiles WHERE id=player)<>0
  OR (SELECT amount FROM public.diamond_transactions WHERE reference_id='wide-test:full') IS DISTINCT FROM -expected THEN
  RAISE EXCEPTION 'Wide debit lost money: %',result; END IF;
END $$;
-- A zero spendable house balance may include funds earmarked for others.
-- The frozen path leaves the same card unpicked. Its retry pays once.
DO $$
DECLARE player uuid:='d1000000-0000-4000-8000-000000000005';
 owner_uuid uuid:='d1000000-0000-4000-8000-000000000002'; club uuid:='d1000000-0000-4000-8000-000000000003';
 award uuid; funded public.wheel_prize_financing; result jsonb; credit_row public.diamond_transactions;
 before_wallet bigint; risk bigint;
BEGIN
 UPDATE public.ca_diamond_house SET balance=5000 WHERE id=1;
 INSERT INTO public.ca_diamond_house_earmarks(entry,earmark_key,purpose,amount,reason)
 VALUES('open','prize-test:other-jackpot','jackpot_seed',5000,'Unrelated jackpot');
 IF public.fn_ca_diamond_house_available()<>0 THEN RAISE EXCEPTION 'Fixture earmark not reserved'; END IF;
 INSERT INTO public.diamond_engine_daily_caps(engine,max_per_user_per_day) VALUES('wheel',1)
 ON CONFLICT(engine) DO UPDATE SET max_per_user_per_day=1,max_per_user_per_day_vip=1;
 INSERT INTO public.ca_diamond_rule_modes(rule,mode,flip_after,clean_days_required)
 VALUES('DR7:user_over_daily_cap','refuse',now(),1)
 ON CONFLICT(rule) DO UPDATE SET mode='refuse';
 -- With the owner fully drawn, an earmarked house and a zero-wallet player
 -- the sealed card can still be honoured entirely by platform issuance.
 FOREACH risk IN ARRAY ARRAY[1::bigint,25::bigint] LOOP
  INSERT INTO public.wheel_card_awards(spin_id,user_id,club_id,host_id,host_kind,owner_id,risk_diamonds,half_diamonds,
   permutation,roll,nonce,server_seed,server_seed_hash,client_seed)
  VALUES(gen_random_uuid(),player,club,club,'club',owner_uuid,risk,(risk+1)/2,0,0,4,'odd-prize','test-hash','odd-client')
  RETURNING id INTO award;
  SELECT diamonds INTO STRICT before_wallet FROM public.profiles WHERE id=player;
  PERFORM set_config('request.jwt.claims','{"role":"authenticated"}',true);
  UPDATE public.ca_emergency_stops SET stopped=true WHERE path='positive_issuance';
  BEGIN
   SET LOCAL ROLE authenticated;
   result:=public.fn_wheel_diamond_cards_pick(award,1::smallint);
   RESET ROLE;
   RAISE EXCEPTION 'Positive issuance stop was bypassed: %',result;
  EXCEPTION WHEN SQLSTATE 'P0410' THEN NULL;
  END;
  IF (SELECT status FROM public.wheel_card_awards WHERE id=award)<>'pending'
   OR EXISTS(SELECT 1 FROM public.wheel_prize_financing WHERE award_id=award) THEN
   RAISE EXCEPTION 'Failed issuance left a partial payout'; END IF;
  UPDATE public.ca_emergency_stops SET stopped=false WHERE path='positive_issuance';
  SET LOCAL ROLE authenticated;
  result:=public.fn_wheel_diamond_cards_pick(award,1::smallint);
  PERFORM public.fn_wheel_diamond_cards_pick(award,3::smallint);
  RESET ROLE;
  SELECT * INTO STRICT funded FROM public.wheel_prize_financing WHERE award_id=award;
  SELECT * INTO STRICT credit_row FROM public.diamond_transactions WHERE reference_id='wheel-cards:'||award||':issued';
  IF result ? 'payout_rules_version' THEN RAISE EXCEPTION 'A legacy card acquired new payout terms'; END IF;
  IF (result->>'paid_diamonds')::bigint<>(risk+1)/2 OR funded.house_cash<>0 OR funded.issued<>(risk+1)/2
   OR credit_row.amount<>funded.issued OR credit_row.issuance_class<>'earned'
   OR (SELECT count(*) FROM public.ca_mint_ledger WHERE diamond_tx_id=credit_row.id AND action='mint' AND amount=funded.issued)<>1
   OR (SELECT diamonds FROM public.profiles WHERE id=player)<>before_wallet+funded.issued
   OR (SELECT balance FROM public.ca_diamond_house WHERE id=1)<>5000 THEN
   RAISE EXCEPTION 'Unfunded card did not mint and pay exactly once at its sealed value: %',funded; END IF;
 END LOOP;
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
