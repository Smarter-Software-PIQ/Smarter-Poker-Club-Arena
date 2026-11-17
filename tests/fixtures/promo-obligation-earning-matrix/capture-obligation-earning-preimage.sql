CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_capture_obligation_earning() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE lo numeric;gid uuid;club uuid;ids uuid[];bounty uuid;bo public.tournament_bounty_obligations%ROWTYPE;hand public.ca_promo_profit_tournament_hand_clocks%ROWTYPE;hs public.ca_promo_profit_tournament_hand_sources%ROWTYPE;r public.tournament_players%ROWTYPE;earned timestamptz;ctx jsonb;enabled timestamptz;legacy_clock timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_promo_play_through_settings WHERE id AND enforced_from IS NOT NULL) OR NEW.kind='refund' THEN RETURN NULL;END IF;
 lo:=CASE WHEN TG_OP='INSERT' THEN NEW.amount_paid ELSE OLD.amount_owed END;
 IF NEW.amount_owed<=lo THEN RETURN NULL;END IF;
 IF NEW.amount_owed::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'original_earning_amount_invalid';END IF;
 IF NEW.kind IN('bounty_residual','own_bounty') THEN
  PERFORM public.fn_ca_promo_profit_capture_residual_head(NEW.id,NEW.tournament_id,NEW.user_id,lo,NEW.amount_owed);
  RETURN NULL;
 END IF;
 IF NEW.kind IN('bounty','mystery_bounty') THEN
  bounty:=NULLIF(current_setting('app.bounty_obligation_id',true),'')::uuid;
  IF bounty IS NULL THEN RAISE EXCEPTION 'original_bounty_earning_hand_missing';END IF;
  SELECT * INTO STRICT bo FROM public.tournament_bounty_obligations WHERE id=bounty AND tournament_id=NEW.tournament_id;
  IF bo.knocker_user_id IS DISTINCT FROM NEW.user_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bo.claimants) c WHERE c->>'user_id'=NEW.user_id::text) THEN RAISE EXCEPTION 'original_bounty_earning_recipient_mismatch';END IF;
  SELECT * INTO hand FROM public.ca_promo_profit_tournament_hand_clocks WHERE hand_id=bo.hand_id AND table_id=bo.table_id AND tournament_id=NEW.tournament_id;
  IF NOT FOUND THEN
   SELECT enforced_from INTO enabled FROM public.ca_promo_play_through_settings WHERE id;
   SELECT committed_at INTO legacy_clock FROM public.hand_atomic_commits WHERE hand_id=bo.hand_id AND table_id=bo.table_id;
   IF COALESCE(legacy_clock,bo.created_at)>=enabled OR COALESCE(legacy_clock,bo.created_at) IS NULL THEN RAISE EXCEPTION 'original_bounty_earning_hand_missing';END IF;
   SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=NEW.tournament_id AND user_id=NEW.user_id;
   INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
   VALUES(NEW.id,NEW.tournament_id,NEW.user_id,r.club_id,NULL,'{}',lo,NEW.amount_owed,NEW.kind,bounty,COALESCE(legacy_clock,bo.created_at));
   RETURN NULL;
  END IF;
  IF NOT NEW.user_id=ANY(hand.participant_ids) THEN RAISE EXCEPTION 'original_bounty_earning_participant_missing';END IF;
  club:=(hand.participant_scope->NEW.user_id::text->>'club_id')::uuid;
  gid:=(hand.participant_scope->NEW.user_id::text->>'generation_id')::uuid;
  SELECT * INTO hs FROM public.ca_promo_profit_tournament_hand_sources WHERE hand_id=hand.hand_id AND user_id=NEW.user_id;
  ids:=COALESCE(hs.charge_ledger_ids,'{}'::uuid[]);earned:=hand.earned_at;
 ELSE
  SELECT * INTO STRICT r FROM public.tournament_players WHERE tournament_id=NEW.tournament_id AND user_id=NEW.user_id;
  gid:=public.fn_ca_promo_profit_apply_generation(r.id);club:=r.club_id;earned:=clock_timestamp();
  SELECT COALESCE(array_agg(DISTINCT charge_ledger_id ORDER BY charge_ledger_id),'{}'::uuid[]) INTO ids FROM public.ca_promo_profit_charge_generations WHERE generation_id=gid;
 END IF;
 INSERT INTO public.ca_promo_profit_obligation_earnings(obligation_id,tournament_id,user_id,earning_club_id,generation_id,charge_ledger_ids,amount_from,amount_to,source_kind,source_bounty_obligation_id,earned_at)
 VALUES(NEW.id,NEW.tournament_id,NEW.user_id,club,gid,ids,lo,NEW.amount_owed,NEW.kind,bounty,earned);
 RETURN NULL;
END $$;
