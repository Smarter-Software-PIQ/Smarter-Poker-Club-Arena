-- Exercise the same escrow_hold/player_wallet-to-escrow ledger exit as the real cashout request.
BEGIN;
DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.rake_attributions'::regclass
    AND tgname='ca_promo_profit_original_cash_fee') THEN
    ALTER TABLE public.rake_attributions DISABLE TRIGGER ca_promo_profit_original_cash_fee;
  END IF;
END $test$;
UPDATE public.ca_promo_play_through_settings SET enforced_from=clock_timestamp()-interval '1 minute' WHERE id;
UPDATE public.club_members SET chip_balance=100 WHERE user_id=:'member' AND club_id IN(:'source_club',:'wallet_club');
SELECT public.fn_ca_promo_play_through_record_grant(
  :'source_club',:'member',50,'club_promo','cashout-source-test',NULL,'promo_wallet',:'source_club',NULL);
INSERT INTO public.ca_promo_profit_custody(grant_id,club_id,user_id,kind,entity_id,amount)
SELECT id,:'wallet_club',:'member','player_wallet',:'member',40
FROM public.ca_promo_play_through_grants WHERE source_ref='cashout-source-test';

CREATE FUNCTION pg_temp.original_fee(p_hand uuid,p_table uuid,p_club uuid,p_user uuid,p_amount numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.ca_promo_cash_hand_clocks(hand_id,table_id,hand_number,accepted_at)
  VALUES(p_hand,p_table,1,clock_timestamp());
  INSERT INTO public.rake_attributions(hand_id,club_id,player_id,rake_amount)
  VALUES(p_hand,p_club,p_user,p_amount);
END $$;
CREATE FUNCTION pg_temp.cashier_hold(p_club uuid,p_user uuid,p_after numeric,p_expected_hint text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_balance numeric;actual_hint text;
BEGIN
  SELECT chip_balance INTO STRICT before_balance FROM public.club_members
   WHERE club_id=p_club AND user_id=p_user FOR UPDATE;
  BEGIN
    UPDATE public.club_members SET chip_balance=p_after WHERE club_id=p_club AND user_id=p_user;
    INSERT INTO public.chip_ledger(id,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id)
    VALUES(gen_random_uuid(),'player_wallet',p_user,'escrow',gen_random_uuid(),before_balance-p_after,'escrow_hold',p_club);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS actual_hint=PG_EXCEPTION_HINT;
    IF actual_hint IS DISTINCT FROM p_expected_hint THEN RAISE; END IF;
    RETURN;
  END;
  IF p_expected_hint IS NOT NULL THEN RAISE EXCEPTION 'expected cashier refusal %',p_expected_hint;END IF;
END $$;
SELECT pg_temp.original_fee(md5('initial-fee')::uuid,:'table',:'source_club',:'member',80);
SELECT pg_temp.cashier_hold(:'wallet_club',:'member',:after_balance,'promo_winnings_play_through_locked');
SELECT pg_temp.original_fee(md5('qualifying-fee')::uuid,:'table',:'source_club',:'member',20);
SELECT pg_temp.cashier_hold(:'wallet_club',:'member',:after_balance,
  CASE WHEN :fixed THEN NULL ELSE 'promo_winnings_play_through_locked' END);
CREATE FUNCTION pg_temp.assert_result(fixed boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE earned boolean;closed boolean;
BEGIN
  SELECT w.unlocked_at IS NOT NULL,g.closed_at IS NOT NULL INTO STRICT earned,closed
  FROM public.ca_promo_play_through_grants g JOIN public.ca_promo_profit_gates w ON w.grant_id=g.id
  WHERE g.source_ref='cashout-source-test';
  IF earned IS DISTINCT FROM fixed OR closed THEN RAISE EXCEPTION 'wrong winnings or principal state';END IF;
END $$;
SELECT pg_temp.assert_result(:fixed);
SELECT pg_temp.cashier_hold(:'wallet_club',:'member',45,'promo_play_through_locked')
WHERE :fixed AND :'wallet_club'::uuid=:'source_club'::uuid;
ROLLBACK;
