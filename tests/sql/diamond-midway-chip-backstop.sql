BEGIN;
SET LOCAL "test.user"='d1000000-0000-4000-8000-000000000005';
SET LOCAL "request.jwt.claims"='{"role":"service_role"}';
DO $test$
DECLARE
 host constant uuid:='fade0000-0000-0000-0000-000000000001';
 player constant uuid:='d1000000-0000-4000-8000-000000000001';
 owner_id constant uuid:='d1000000-0000-4000-8000-000000000002';
 club constant uuid:='d1000000-0000-4000-8000-000000000059';
 club_owner constant uuid:='2d1cd6c3-5700-4af9-a271-d4863fdab20d';
 k constant text:='midway-prize-test:four-sources';
 day_now date:=(now() AT TIME ZONE 'America/Chicago')::date;
 receipt record; before_statement numeric; club_before numeric; detail text; tx public.chip_transactions;
BEGIN
 INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) VALUES
 ('issuance_reserve','noncirculating','outside circulation','Canonical Mint funding source'),
 ('system_mint','noncirculating','outside circulation','Canonical house funding source') ON CONFLICT DO NOTHING;
 INSERT INTO public.unions(id,name,owner_id,slug) VALUES(host,'Synthetic Midway',owner_id,'synthetic-midway');
 INSERT INTO public.clubs(id,name,owner_id,union_id,is_union,chip_treasury) VALUES(club,'Synthetic Midway Member',club_owner,host,false,0);
 INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance) VALUES(club,player,'player','active',0);
 INSERT INTO public.union_wallets(union_id) VALUES(host);
 -- Known balances are established within this rolled-back fixture.
 PERFORM public.fn_ca_declare_ledger('mint','issuance_reserve',NULL,NULL,'midway-test:seed-club');
 UPDATE public.clubs SET chip_treasury=5 WHERE id=club;
 PERFORM public.fn_ca_declare_ledger('mint','issuance_reserve',NULL,NULL,'midway-test:seed-promo');
 UPDATE public.union_wallets SET promo_wallet=3 WHERE union_id=host;
 PERFORM public.fn_ca_declare_ledger('mint','issuance_reserve',NULL,NULL,'midway-test:seed-union');
 UPDATE public.union_wallets SET chip_balance=7 WHERE union_id=host;
 SELECT public.fn_diamond_spin_chip_payouts(owner_id,day_now),public.fn_diamond_spin_chip_payouts(club_owner,day_now) INTO before_statement,club_before;
 SELECT * INTO STRICT receipt FROM public.fn_diamond_game_pay_chips('wheel_prize',host,'union',club,player,17.25,k,'Synthetic Midway prize','{}');
 -- The same identity replays the original receipt while fresh keys still compete for real balances.
 SELECT * INTO STRICT receipt FROM public.fn_diamond_game_pay_chips('wheel_prize',host,'union',club,player,17.25,k,'Synthetic Midway replay','{}');
 SELECT * INTO STRICT tx FROM public.chip_transactions WHERE metadata->>'funding_key'=k;
 IF tx.amount<>17.25 OR tx.balance_after<>17.25 OR receipt.member_after<>17.25 OR
    (tx.metadata->>'from_promo')::numeric<>3 OR (tx.metadata->>'from_club_treasury')::numeric<>5 OR
    (tx.metadata->>'from_union_bank')::numeric<>7 OR (tx.metadata->>'from_platform')::numeric<>2.25 OR
    (SELECT chip_balance FROM public.club_members WHERE club_id=club AND user_id=player)<>17.25 OR
    (SELECT chip_treasury FROM public.clubs WHERE id=club)<>0 OR
    (SELECT chip_balance+promo_wallet FROM public.union_wallets WHERE union_id=host)<>0 OR
    (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key IN(k,k||':bank',k||':union',k||':platform') AND to_entity_id=player AND category='wheel_prize')<>4 OR
    (SELECT sum(amount) FROM public.chip_ledger WHERE idempotency_key IN(k,k||':bank',k||':union',k||':platform'))<>17.25 OR
    NOT EXISTS(SELECT 1 FROM public.ca_mint_ledger WHERE op_id=k||':platform-issue' AND asset='chips' AND action='mint' AND amount=2.25) OR
    public.fn_diamond_spin_chip_payouts(club_owner,day_now) IS DISTINCT FROM club_before OR
    public.fn_diamond_spin_chip_payouts(owner_id,day_now) IS DISTINCT FROM before_statement+17.25
 THEN RAISE EXCEPTION 'Midway split did not reconcile: %, %',row_to_json(receipt),row_to_json(tx); END IF;
 BEGIN
   PERFORM public.fn_diamond_game_pay_chips('wheel_prize',host,'union',club,player,
    (SELECT per_operation_cap_chips+1 FROM public.ca_mint_policy WHERE id=1),k||':too-large','Ceiling proof','{}');
   RAISE EXCEPTION 'Unfunded prize returned a success';
 EXCEPTION WHEN SQLSTATE 'PMW01' THEN
   GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
   IF (detail::jsonb->>'paid')::boolean IS DISTINCT FROM false OR (detail::jsonb->>'uncovered_chips')::numeric<=0 THEN
    RAISE EXCEPTION 'The uncovered obligation was not identified: %',detail;
   END IF;
 END;
 BEGIN
   UPDATE public.ca_mint_policy SET rolling_24h_cap_chips=public.fn_ca_mint_issued_24h('chips')+0.25 WHERE id=1;
   PERFORM public.fn_diamond_game_pay_chips('wheel_prize',host,'union',club,player,1.25,k||':rolling','Rolling ceiling proof','{}');
   RAISE EXCEPTION 'Rolling issuance ceiling did not bound sponsor';
 EXCEPTION WHEN SQLSTATE 'PMW01' THEN
   GET STACKED DIAGNOSTICS detail=PG_EXCEPTION_DETAIL;
   IF (detail::jsonb->>'uncovered_chips')::numeric IS DISTINCT FROM 1.00 THEN RAISE EXCEPTION 'Unexpected rolling shortfall: %',detail; END IF;
 END;
 IF EXISTS(SELECT 1 FROM public.chip_ledger WHERE idempotency_key LIKE k||':too-large%' OR idempotency_key LIKE k||':rolling%') THEN
   RAISE EXCEPTION 'Refused operation left partial funding'; END IF;
END $test$;
SET CONSTRAINTS ALL IMMEDIATE;
\if :{?midway_race_fixture}
COMMIT;
\else
ROLLBACK;
\endif
