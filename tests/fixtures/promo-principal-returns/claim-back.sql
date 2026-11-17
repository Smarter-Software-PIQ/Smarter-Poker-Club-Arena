CREATE OR REPLACE FUNCTION public.fn_club_wallet_claim_back(p_club_id uuid, p_from_user_id uuid, p_amount numeric, p_source text, p_destination text, p_reason text, p_op_id uuid, p_transaction_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
 actor uuid:=auth.uid(); actor_role text; holder_role text; gate jsonb; result jsonb;
 held numeric; holder_after numeric; destination_after numeric; source_agent uuid; target_agent uuid;
 original public.chip_transactions%ROWTYPE; v_amount numeric:=p_amount; claimed numeric; remaining numeric; repay numeric:=0; drawn numeric; repaid numeric; used numeric; movement_type text:=CASE WHEN p_transaction_id IS NULL THEN 'club_bank_claim' ELSE 'agent_wallet_claim_back' END;
 tx uuid; context jsonb; setting text; destination_pool text; destination_entity uuid;
BEGIN
 IF p_op_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','A Retry Key Is Required'); END IF;
 gate:=public.fn_cashier_exact_intent_begin(CASE WHEN p_transaction_id IS NULL THEN 'club_bank_claim' ELSE 'agent_wallet_claim_back' END,p_club_id,p_op_id,
  jsonb_build_object('actor',actor,'club',p_club_id,'action','club_wallet_claim','source_user',p_from_user_id,
   'amount',p_amount,'source',p_source,'destination',p_destination,'reason',p_reason,'original_transaction_id',p_transaction_id));
 IF gate->>'state'='return' THEN RETURN gate->'response'; END IF;
 IF actor IS NULL OR p_club_id IS NULL OR p_from_user_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','Choose An Active Club Member'); END IF;
 IF (p_amount IS NULL AND p_transaction_id IS NULL) OR p_amount<=0 OR p_amount>1e9 OR p_amount<>round(p_amount,2) THEN RETURN jsonb_build_object('success',false,'error','Enter A Valid Claim Amount'); END IF;
 IF p_source IS NULL OR p_source NOT IN ('player_wallet','agent_wallet','promo_wallet') OR p_destination IS NULL OR p_destination NOT IN ('club_bank','club_promo_wallet','player_wallet','agent_wallet','promo_wallet') THEN RETURN jsonb_build_object('success',false,'error','Unknown Wallet'); END IF;
 IF p_source='promo_wallet' AND p_destination NOT IN ('promo_wallet','club_promo_wallet') THEN RETURN jsonb_build_object('success',false,'error','Promo Chips Must Return To A Promo Wallet'); END IF;
 IF actor=p_from_user_id AND p_source=p_destination THEN RETURN jsonb_build_object('success',false,'error','Choose A Different Return Wallet'); END IF;
 -- Shared authority locks precede balance locks, matching existing cashier writers.
 PERFORM pg_advisory_xact_lock(hashtextextended('agent-agreement:'||p_club_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('cashier-hierarchy:'||p_club_id::text,0));
 PERFORM 1 FROM public.clubs WHERE id=p_club_id FOR UPDATE;
 PERFORM 1 FROM public.club_members WHERE club_id=p_club_id AND user_id IN (actor,p_from_user_id) ORDER BY user_id FOR UPDATE;
 actor_role:=public.fn_club_bank_role(p_club_id);
 IF actor_role IS NULL OR actor_role NOT IN ('owner','co_owner','admin','super_agent','agent','sub_agent') THEN RETURN jsonb_build_object('success',false,'error','Your Claim Authority Is Not Active'); END IF;
 IF p_transaction_id IS NULL AND actor IS DISTINCT FROM p_from_user_id AND actor_role NOT IN ('owner','co_owner','admin') THEN RETURN jsonb_build_object('success',false,'error','Choose One Of Your Recent Sends'); END IF;
 IF p_destination IN ('club_bank','club_promo_wallet') AND actor_role NOT IN ('owner','co_owner','admin') THEN RETURN jsonb_build_object('success',false,'error','Only Club Staff May Claim Into A Club Wallet'); END IF;
 IF p_transaction_id IS NOT NULL THEN
  SELECT * INTO original FROM public.chip_transactions WHERE id=p_transaction_id AND club_id=p_club_id FOR UPDATE;
  IF original.id IS NULL OR original.transaction_type<>'agent_wallet_send' OR original.from_user_id IS DISTINCT FROM actor OR original.to_user_id IS DISTINCT FROM p_from_user_id OR coalesce(original.metadata->>'destination','player_wallet') IS DISTINCT FROM p_source THEN RETURN jsonb_build_object('success',false,'error','You Can Only Claim Your Own Recent Send From Its Original Wallet'); END IF;
  IF coalesce(original.is_reversed,false) OR original.reversible_until IS NULL OR now()>original.reversible_until THEN RETURN jsonb_build_object('success',false,'error','The Ten Minute Claim Window Has Closed'); END IF;
  claimed:=coalesce((original.metadata->>'claimed_back')::numeric,0);
  repaid:=coalesce((original.metadata->>'credit_repaid')::numeric,0);
  remaining:=trunc(greatest(original.amount-claimed,0),2);
  v_amount:=coalesce(p_amount,remaining);
  IF remaining<0.01 OR v_amount>remaining THEN RETURN jsonb_build_object('success',false,'error','That Amount Is No Longer Claimable'); END IF;
 END IF;
 IF actor<>p_from_user_id AND NOT public.fn_club_cashier_can_transact(p_club_id,actor,p_from_user_id) THEN RETURN jsonb_build_object('success',false,'error','That Member Is Not In Your Downline'); END IF;
 SELECT role INTO holder_role FROM public.club_members WHERE club_id=p_club_id AND user_id=p_from_user_id AND coalesce(status,'active') IN ('active','approved');
 IF holder_role IS NULL THEN RETURN jsonb_build_object('success',false,'error','That Person Is Not An Active Member'); END IF;
 IF p_destination='player_wallet' AND actor_role='admin' THEN RETURN jsonb_build_object('success',false,'error','Admins Do Not Hold A Player Wallet'); END IF;
 IF p_source='player_wallet' THEN
  SELECT coalesce(chip_balance,0) INTO held FROM public.club_members WHERE club_id=p_club_id AND user_id=p_from_user_id;
 ELSE
  IF holder_role NOT IN ('owner','co_owner','admin','super_agent','agent','sub_agent') THEN RETURN jsonb_build_object('success',false,'error','That Member Does Not Hold That Wallet'); END IF;
  SELECT id,CASE WHEN p_source='promo_wallet' THEN coalesce(promo_wallet_balance,0) ELSE coalesce(agent_wallet_balance,0) END INTO source_agent,held FROM public.agents WHERE club_id=p_club_id AND user_id=p_from_user_id FOR UPDATE;
 END IF;
 IF held IS NULL OR held<v_amount THEN RETURN jsonb_build_object('success',false,'error','Insufficient Chips In The Selected Wallet'); END IF;
 IF p_transaction_id IS NOT NULL AND p_source<>'promo_wallet' THEN
  drawn:=coalesce((original.metadata->>'credit_drawn')::numeric,0); repaid:=coalesce((original.metadata->>'credit_repaid')::numeric,0);
  SELECT coalesce(credit_used,0) INTO used FROM public.agents WHERE club_id=p_club_id AND user_id=actor FOR UPDATE;
  repay:=least(coalesce(used,0),greatest(drawn-repaid,0),CASE WHEN original.amount-claimed-v_amount<0.01 THEN greatest(drawn-repaid,0) ELSE trunc(drawn*v_amount/original.amount,2) END);
 END IF;
 IF p_destination IN ('agent_wallet','promo_wallet') THEN target_agent:=public.fn_ensure_agent_row(p_club_id,actor,actor_role); END IF;
 destination_pool:=CASE p_destination WHEN 'club_bank' THEN 'club_treasury' WHEN 'club_promo_wallet' THEN 'promo_wallet' ELSE p_destination END;
 destination_entity:=CASE WHEN p_destination IN ('club_bank','club_promo_wallet') THEN p_club_id ELSE actor END;
 SELECT jsonb_object_agg(k,coalesce(current_setting(k,true),'')) INTO context FROM unnest(ARRAY['app.ledger_category','app.ledger_counterparty','app.ledger_counterparty_entity','app.ledger_counterparty_label','app.ledger_correlation','app.ledger_idempotency_key','app.ledger_autoskip_agents','app.ledger_autoskip_club_members','app.ledger_autoskip_clubs','app.ledger_tournament','app.ledger_settlement']) settings(k);
 PERFORM set_config('app.ledger_tournament','',true); PERFORM set_config('app.ledger_settlement','',true);
 PERFORM public.fn_ca_declare_ledger('club_bank_claim',destination_pool,destination_entity,NULL,'club_wallet_claim:'||p_op_id::text,ARRAY['club_members','agents','clubs']);
 PERFORM set_config('app.ledger_correlation',p_op_id::text,true);
 IF p_source='player_wallet' THEN UPDATE public.club_members SET chip_balance=coalesce(chip_balance,0)-v_amount,updated_at=now() WHERE club_id=p_club_id AND user_id=p_from_user_id RETURNING chip_balance INTO holder_after;
 ELSIF p_source='agent_wallet' THEN UPDATE public.agents SET agent_wallet_balance=coalesce(agent_wallet_balance,0)-v_amount,updated_at=now() WHERE id=source_agent RETURNING agent_wallet_balance INTO holder_after;
 ELSE UPDATE public.agents SET promo_wallet_balance=coalesce(promo_wallet_balance,0)-v_amount,updated_at=now() WHERE id=source_agent RETURNING promo_wallet_balance INTO holder_after; END IF;
 CASE p_destination
 WHEN 'club_bank' THEN UPDATE public.clubs SET chip_treasury=coalesce(chip_treasury,0)+(v_amount-repay),updated_at=now() WHERE id=p_club_id RETURNING chip_treasury INTO destination_after;
 WHEN 'club_promo_wallet' THEN UPDATE public.clubs SET promo_balance=coalesce(promo_balance,0)+(v_amount-repay),updated_at=now() WHERE id=p_club_id RETURNING promo_balance INTO destination_after;
 WHEN 'player_wallet' THEN UPDATE public.club_members SET chip_balance=coalesce(chip_balance,0)+(v_amount-repay),updated_at=now() WHERE club_id=p_club_id AND user_id=actor RETURNING chip_balance INTO destination_after;
 WHEN 'agent_wallet' THEN UPDATE public.agents SET agent_wallet_balance=coalesce(agent_wallet_balance,0)+(v_amount-repay),updated_at=now() WHERE id=target_agent RETURNING agent_wallet_balance INTO destination_after;
 WHEN 'promo_wallet' THEN UPDATE public.agents SET promo_wallet_balance=coalesce(promo_wallet_balance,0)+(v_amount-repay),updated_at=now() WHERE id=target_agent RETURNING promo_wallet_balance INTO destination_after;
 END CASE;
 IF repay>0 THEN UPDATE public.agents SET credit_used=credit_used-repay,updated_at=now() WHERE club_id=p_club_id AND user_id=actor; END IF;
 IF holder_after IS NULL OR destination_after IS NULL THEN RAISE EXCEPTION 'The Claim Credit Landed Nowhere'; END IF;
 PERFORM set_config('app.ledger_idempotency_key','',true);
 IF v_amount>repay AND NOT public.fn_ca_post_leg('club_bank_claim',p_source,p_from_user_id,destination_pool,destination_entity,v_amount-repay,p_club_id,'club_wallet_claim:'||p_op_id::text,'Cashier Claim Back') THEN RAISE EXCEPTION 'The Claim Journal Was Not Written'; END IF;
 IF repay>0 AND NOT public.fn_ca_post_leg('credit_repayment',p_source,p_from_user_id,'credit_facility',actor,repay,p_club_id,'club_wallet_claim:credit:'||p_op_id::text,'Claim Repays The Original Credit Draw') THEN RAISE EXCEPTION 'The Credit Repayment Journal Was Not Written'; END IF;
 IF p_transaction_id IS NOT NULL THEN
  UPDATE public.chip_transactions SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('claimed_back',claimed+v_amount,'credit_repaid',coalesce(repaid,0)+repay),is_reversed=(original.amount-claimed-v_amount<0.01),clawed_back=(original.amount-claimed-v_amount<0.01) WHERE id=p_transaction_id;
 END IF;
 FOR setting IN SELECT jsonb_object_keys(context) LOOP PERFORM set_config(setting,context->>setting,true); END LOOP;
 INSERT INTO public.chip_transactions(club_id,from_user_id,to_user_id,amount,transaction_type,notes,metadata,balance_after)
 VALUES(p_club_id,p_from_user_id,actor,v_amount,movement_type,coalesce(p_reason,'Cashier Claim Back'),jsonb_build_object('op_id',p_op_id,'source',p_source,'destination',p_destination,'original_transaction_id',p_transaction_id,'credit_repaid',repay,'returned_amount',v_amount-repay,'actor_role',actor_role,'holder_balance_after',holder_after,'destination_balance_after',destination_after),destination_after) RETURNING id INTO tx;
 result:=jsonb_build_object('success',true,'replayed',false,'transaction_id',tx,'op_id',p_op_id,'amount',v_amount,'source',p_source,'destination',p_destination,'credit_repaid',repay,'returned_amount',v_amount-repay,'holder_balance_after',holder_after,'destination_balance_after',destination_after);
 RETURN public.fn_cashier_exact_intent_finish(p_op_id,result);
END $function$
