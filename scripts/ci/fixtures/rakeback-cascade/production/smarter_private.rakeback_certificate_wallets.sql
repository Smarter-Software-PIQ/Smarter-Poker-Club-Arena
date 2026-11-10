CREATE OR REPLACE FUNCTION smarter_private.rakeback_certificate_wallets(p_calculation bigint)
 RETURNS TABLE(payer_kind text, payer_user uuid, payer_entity uuid, owed numeric, destination_kind text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE c public.accounting_rakeback_period_calculations%ROWTYPE;plan jsonb;
BEGIN
 SELECT*INTO STRICT c FROM public.accounting_rakeback_period_calculations WHERE id=p_calculation;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(c.source_allocations)a WHERE a?'destination_kind')THEN
  RETURN QUERY SELECT g.payer_kind,g.payer_user,g.payer_entity,g.owed,'player_wallet'::text FROM smarter_private.rakeback_certificate_payers(p_calculation)g;RETURN;
 END IF;
 -- Preserve and verify the original per-payer contract and cent allocation.
 PERFORM*FROM smarter_private.rakeback_certificate_payers(p_calculation);
 plan:=smarter_private.rakeback_wallet_plan(c.source_allocations,c.rakeback_amount);
 IF(SELECT count(*)FROM public.accounting_rakeback_wallet_contracts w WHERE w.calculation_id=c.id)<>jsonb_array_length(plan)
 OR EXISTS(SELECT FROM jsonb_array_elements(plan)p LEFT JOIN public.accounting_rakeback_wallet_contracts w ON w.calculation_id=c.id AND w.payer_kind=p->>'payer_kind'AND w.payer_entity_id=coalesce(NULLIF(p->>'payer_user_id','')::uuid,c.club_id)AND w.destination_kind=p->>'destination_kind'WHERE w.calculation_id IS NULL OR w.amount IS DISTINCT FROM(p->>'amount')::numeric OR w.unrounded IS DISTINCT FROM(p->>'unrounded')::numeric OR w.rake IS DISTINCT FROM(p->>'rake')::numeric OR w.source_count IS DISTINCT FROM(p->>'source_count')::bigint OR w.source_fingerprint IS DISTINCT FROM c.source_fingerprint OR w.payer_user_id=c.player_id)
 THEN RAISE EXCEPTION 'typed_wallet_contract_disagrees' USING ERRCODE='23514';END IF;
 RETURN QUERY SELECT w.payer_kind,w.payer_user_id,w.payer_entity_id,w.amount,w.destination_kind FROM public.accounting_rakeback_wallet_contracts w WHERE w.calculation_id=c.id ORDER BY w.payer_kind,w.payer_entity_id,w.destination_kind;
END $function$
