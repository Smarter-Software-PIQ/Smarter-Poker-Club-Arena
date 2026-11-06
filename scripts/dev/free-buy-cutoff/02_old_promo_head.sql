-- Exact production copy of the pre-change promo head (used to create legacy legs).
CREATE OR REPLACE FUNCTION public.fn_ca_midway_free_buy_promo_head(p_tournament_id uuid, p_registration_id uuid, p_return boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 t public.tournaments%ROWTYPE;
 p public.tournament_players%ROWTYPE;
 funded public.chip_ledger%ROWTYPE;
 prior public.chip_ledger%ROWTYPE;
 k text;
 n integer;
 previous_skip text;
 v_format text;
 v_bounty numeric;
 v_prize numeric;
BEGIN
 SELECT * INTO t FROM public.tournaments WHERE id=p_tournament_id FOR UPDATE;
 v_format:=public.fn_ca_midway_free_buy_format(p_tournament_id);
 IF v_format IS NULL THEN RETURN 0; END IF;
 -- 2026-11-04 rotation: the one promo chip lands by format. pko: the bounty
 -- head (unchanged). regular/aiof: the prize pool. mystery: half each.
 v_bounty:=CASE v_format WHEN 'pko' THEN 1 WHEN 'mystery' THEN 0.50 ELSE 0 END;
 v_prize:=round(1-v_bounty,2);
 SELECT * INTO p FROM public.tournament_players
 WHERE id=p_registration_id AND tournament_id=p_tournament_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Promo bounty requires its exact registration'; END IF;
 k:='tourney:'||p_tournament_id||':promo_head:'||p_registration_id;
 SELECT * INTO funded FROM public.chip_ledger WHERE idempotency_key=k;
 IF funded.id IS NOT NULL AND (funded.amount IS DISTINCT FROM 1 OR funded.category IS DISTINCT FROM 'promo_send'
   OR funded.from_type IS DISTINCT FROM 'union_wallet' OR funded.from_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
   OR funded.to_type IS DISTINCT FROM 'prize_liability' OR funded.to_entity_id IS DISTINCT FROM p_tournament_id
   OR funded.metadata->>'registration_id' IS DISTINCT FROM p_registration_id::text) THEN
   RAISE EXCEPTION 'Promo bounty funding identity conflict';
 END IF;
 IF p_return THEN
   IF funded.id IS NULL THEN RETURN 0; END IF;
   IF t.started_at IS NOT NULL OR upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING')
      OR coalesce(p.status,'') NOT IN ('registered','playing')
      OR (v_bounty>0 AND (p.current_bounty IS NULL OR p.current_bounty<v_bounty)) THEN
     RAISE EXCEPTION 'A played bounty cannot be returned as an unplayed promotion';
   END IF;
   k:=k||':return';
   SELECT * INTO prior FROM public.chip_ledger WHERE idempotency_key=k;
   IF prior.id IS NOT NULL THEN
     IF prior.amount IS DISTINCT FROM 1 OR prior.from_entity_id IS DISTINCT FROM p_tournament_id
        OR prior.category IS DISTINCT FROM 'reversal' OR prior.from_type IS DISTINCT FROM 'prize_liability'
        OR prior.to_type IS DISTINCT FROM 'union_wallet'
        OR prior.to_entity_id IS DISTINCT FROM 'fade0000-0000-0000-0000-000000000001'::uuid
        OR prior.metadata->>'funding_ledger_id' IS DISTINCT FROM funded.id::text THEN
       RAISE EXCEPTION 'Promo bounty return identity conflict';
     END IF;
     RETURN 0;
   END IF;
 ELSE
   IF funded.id IS NOT NULL THEN RETURN 0; END IF;
   IF upper(coalesce(t.status,'')) NOT IN ('ANNOUNCED','REGISTERING','RUNNING','BREAK') OR (v_bounty>0 AND p.current_bounty IS DISTINCT FROM v_bounty) THEN
     RAISE EXCEPTION 'Promo funding requires a newly registered one-chip head';
   END IF;
 END IF;
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head prelock');
 previous_skip:=current_setting('app.ledger_autoskip_union_wallets',true);
 PERFORM set_config('app.ledger_autoskip_union_wallets','1',true);
 UPDATE public.union_wallets SET
   promo_wallet=promo_wallet+CASE WHEN p_return THEN 1 ELSE -1 END,updated_at=now()
 WHERE union_id='fade0000-0000-0000-0000-000000000001'::uuid
   AND (p_return OR promo_wallet>=1);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Midway promo funds cannot fund this entry'; END IF;
 PERFORM set_config('app.ledger_autoskip_union_wallets',coalesce(previous_skip,''),true);
 INSERT INTO public.chip_ledger(
   performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
   amount,category,club_id,tournament_id,idempotency_key,description,metadata)
 VALUES(COALESCE(auth.uid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d'::uuid),CASE WHEN p_return THEN 'prize_liability' ELSE 'union_wallet' END,
   CASE WHEN p_return THEN p_tournament_id ELSE 'fade0000-0000-0000-0000-000000000001'::uuid END,
   CASE WHEN NOT p_return THEN 'union_wallets.promo_wallet' WHEN v_format='pko' THEN 'tournament_escrow.bounty_balance'
        WHEN v_format='mystery' THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   CASE WHEN p_return THEN 'union_wallet' ELSE 'prize_liability' END,
   CASE WHEN p_return THEN 'fade0000-0000-0000-0000-000000000001'::uuid ELSE p_tournament_id END,
   CASE WHEN p_return THEN 'union_wallets.promo_wallet' WHEN v_format='pko' THEN 'tournament_escrow.bounty_balance'
        WHEN v_format='mystery' THEN 'tournament_escrow.bounty_and_prize_balance' ELSE 'tournament_escrow.prize_balance' END,
   1,CASE WHEN p_return THEN 'reversal' ELSE 'promo_send' END,t.club_id,p_tournament_id,k,
   CASE WHEN p_return AND v_format='pko' THEN 'Unplayed Free Buy Bounty Returned To Midway Promo Funds'
        WHEN p_return THEN 'Unplayed Free Buy Entry Returned To Midway Promo Funds'
        WHEN v_format='pko' THEN 'Midway Promo Funds Free Buy Initial Bounty'
        ELSE 'Midway Promo Funds Free Buy Initial Entry' END,
   jsonb_build_object('kind','midway_free_buy_promo_head','registration_id',p_registration_id,
     'user_id',p.user_id,'return',p_return,'funding_ledger_id',funded.id,
     'format',v_format,'bounty_part',v_bounty,'prize_part',v_prize));
 PERFORM public.fn_ca_escrow_apply(p_tournament_id,'Midway promo head',
   p_gross_in=>CASE WHEN p_return THEN -1 ELSE 1 END,
   p_bounty_in=>CASE WHEN p_return THEN -v_bounty ELSE v_bounty END);
 IF p_return THEN
   UPDATE public.tournaments SET bounty_pool=bounty_pool-v_bounty,prize_pool=prize_pool-v_prize
    WHERE id=p_tournament_id AND bounty_pool>=v_bounty AND prize_pool>=v_prize;
   GET DIAGNOSTICS n=ROW_COUNT;
   IF n<>1 THEN RAISE EXCEPTION 'Promo return exceeds funded bounty or prize pool'; END IF;
 END IF;
 IF p_return THEN PERFORM smarter_private.free_buy_ticket_restore(p_registration_id); END IF;
 RETURN 1;
END;
$function$;
