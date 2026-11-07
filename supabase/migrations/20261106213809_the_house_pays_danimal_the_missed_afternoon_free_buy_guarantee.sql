-- Afternoon Free Buy (NLH) 74ba8130 (2026-11-05 22:30 UTC) was built from the
-- wrong format: promo bounty-only PKO with no guarantee, instead of its schedule
-- 9a1b9e88 (all-in-or-fold, 500 chip guarantee, no bounty). The build defect was
-- fixed by 20261106004622_a_built_midway_free_buy_matches_its_schedule.
-- Danimal (9b027798), the only human, finished 24th of 236. The event's own stored
-- 36-place ladder pays place 24 = 1.35% of 500 = 6.75 chips. Owner Dan approved
-- this make-good in chat 2026-11-06 15:36 CT ("YES PAY IT AND CLOSE IT OUT").
-- Danimal keeps the 4.37 bounty chips he won; no clawback. Same audited door as
-- 20261026172816: manual adjustment + union bank debit + idempotent credit + one ledger leg.
DO $settle$
DECLARE
  c_mig constant text := '20261106214500_the_house_pays_danimal_the_missed_afternoon_free_buy_guarantee';
  c_event constant uuid := '74ba8130-3ec5-48c2-b94b-409b7fb14a6b';
  c_user constant uuid := '9b027798-9532-403f-a5c1-15554ce2959c';
  c_club constant uuid := 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
  c_union constant uuid := 'fade0000-0000-0000-0000-000000000001';
  c_key constant text := 'free-buy-format-make-good:74ba8130-3ec5-48c2-b94b-409b7fb14a6b:9b027798-9532-403f-a5c1-15554ce2959c';
  c_amount constant numeric := 6.75;
  v_bank numeric; v_wallet numeric; v_after numeric; v_adj uuid; v_leg uuid; v_reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(c_key,0)) THEN
    RAISE EXCEPTION 'make-good already owned';
  END IF;
  IF EXISTS(SELECT 1 FROM public.wallet_credit_idempotency WHERE key=c_key) THEN
    RAISE EXCEPTION 'make-good already paid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tournaments WHERE id=c_event AND status='COMPLETED'
      AND prize_pool=0 AND coalesce(guaranteed_prize,0)=0 AND is_pko AND union_id=c_union
      AND schedule_id='9a1b9e88-0bee-4f24-a0b6-f4dee36be24b')
    OR NOT EXISTS(SELECT 1 FROM public.tournament_players WHERE tournament_id=c_event
      AND user_id=c_user AND position=24 AND coalesce(prize,0)=0)
    OR EXISTS(SELECT 1 FROM public.tournament_payouts WHERE tournament_id=c_event)
    OR EXISTS(SELECT 1 FROM public.ca_manual_adjustments WHERE tournament_id=c_event AND target_id=c_user) THEN
    RAISE EXCEPTION 'incident witness changed';
  END IF;
  IF public.fn_player_home_club(c_user,NULL) IS DISTINCT FROM c_club THEN
    RAISE EXCEPTION 'wallet routing changed';
  END IF;
  SELECT chip_balance INTO v_wallet FROM public.club_members WHERE user_id=c_user AND club_id=c_club FOR NO KEY UPDATE;
  SELECT chip_balance INTO v_bank FROM public.union_wallets WHERE union_id=c_union FOR UPDATE;
  IF v_wallet IS NULL OR v_bank IS NULL OR v_bank < c_amount THEN RAISE EXCEPTION 'settlement wallet missing or unfunded'; END IF;

  v_reason := 'Danimal (9b027798-9532-403f-a5c1-15554ce2959c) finished 24th of 236 in Afternoon Free Buy (NLH) 74ba8130 on 2026-11-05. '
    ||'The event was built from the wrong format (bounty-only promo PKO with no guarantee) instead of its schedule (all-in-or-fold, 500 chip guarantee). '
    ||'Its stored 36-place ladder pays place 24 at 1.35 percent of 500, which is 6.75 chips. Danimal was the only human entrant. '
    ||'Owner Dan approved this house make-good in chat on 2026-11-06. Danimal keeps the 4.37 bounty chips already won; no other player or record is changed. Migration '||c_mig;
  v_adj := public.fn_ca_adjustment_under_10_9(c_event,c_user,c_amount,v_reason,c_mig,
    'Claude under owner approval 2026-11-06: missed Free Buy guarantee');
  PERFORM public.fn_ca_declare_ledger('settlement','union_bank',c_union,NULL,c_key,ARRAY['union_wallets']);
  PERFORM set_config('app.ledger_correlation',v_adj::text,true);
  UPDATE public.union_wallets SET chip_balance=chip_balance-c_amount,updated_at=now()
    WHERE union_id=c_union AND chip_balance>=c_amount;
  IF NOT FOUND THEN RAISE EXCEPTION 'union bank refused settlement'; END IF;
  IF public.fn_credit_and_log(c_user,c_amount,c_key,'settlement',
    'House Make-Good For The Afternoon Free Buy Guarantee',NULL) IS NOT TRUE THEN
    RAISE EXCEPTION 'credit door did not pay';
  END IF;
  PERFORM set_config('app.ledger_autoskip_union_wallets','',true);
  PERFORM set_config('app.ledger_counterparty','',true);
  PERFORM set_config('app.ledger_counterparty_entity','',true);
  PERFORM set_config('app.ledger_category','',true);
  PERFORM set_config('app.ledger_idempotency_key','',true);
  PERFORM set_config('app.ledger_correlation','',true);
  SELECT chip_balance INTO v_after FROM public.club_members WHERE user_id=c_user AND club_id=c_club;
  IF v_after - v_wallet <> c_amount
     OR (SELECT chip_balance FROM public.union_wallets WHERE union_id=c_union) <> v_bank - c_amount THEN
    RAISE EXCEPTION 'conservation failed';
  END IF;
  IF (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key=c_key) <> 1 THEN
    RAISE EXCEPTION 'ledger leg count wrong';
  END IF;
  SELECT id INTO STRICT v_leg FROM public.chip_ledger WHERE idempotency_key=c_key AND amount=c_amount
    AND from_type='union_bank' AND to_type='player_wallet' AND to_entity_id=c_user;
  UPDATE public.ca_manual_adjustments SET status='settled' WHERE id=v_adj AND status='approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'adjustment did not settle'; END IF;
  INSERT INTO public.financial_alerts(severity,source,message,context,resolved,resolved_at,resolution)
  VALUES('warning','free_buy_format_mismatch','Missed Free Buy Guarantee Settled By The House',
    jsonb_build_object('tournament_id',c_event,'user_id',c_user,'amount',c_amount,'adjustment_id',v_adj,
      'ledger_id',v_leg,'idempotency_key',c_key,'migration',c_mig),true,now(),v_reason);
END $settle$;