CREATE OR REPLACE FUNCTION smarter_private.rakeback_wallet_plan(p_allocations jsonb, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE original jsonb;result jsonb;
BEGIN
 original:=smarter_private.rakeback_payer_plan(p_allocations,p_amount);
 IF EXISTS(SELECT FROM jsonb_array_elements(p_allocations)a WHERE a?'destination_kind'AND(a->>'destination_kind'IS DISTINCT FROM'agent_wallet'OR a->>'interpretation_version'IS DISTINCT FROM'own-agent-v1'OR jsonb_typeof(a->'destination_agreement')IS DISTINCT FROM'object'))THEN RAISE EXCEPTION 'rakeback_wallet_destination_invalid' USING ERRCODE='23514';END IF;
 WITH groups AS(
  SELECT a->>'payer_kind'kind,NULLIF(a->>'payer_user_id','')::uuid payer,coalesce(a->>'destination_kind','player_wallet')destination,
   sum((a->>'rake_credit')::numeric)rake,sum((a->>'rake_credit')::numeric*(a->>'rate')::numeric)unrounded,count(*)n
  FROM jsonb_array_elements(p_allocations)a GROUP BY 1,2,3
 ),cents AS(
  SELECT g.*,floor(g.unrounded*100)whole,row_number()OVER(PARTITION BY g.kind,g.payer ORDER BY g.unrounded*100-floor(g.unrounded*100)DESC,g.destination)rank,
   (p->>'amount')::numeric*100-sum(floor(g.unrounded*100))OVER(PARTITION BY g.kind,g.payer)extra
  FROM groups g JOIN jsonb_array_elements(original)p ON p->>'payer_kind'=g.kind AND NULLIF(p->>'payer_user_id','')::uuid IS NOT DISTINCT FROM g.payer
 )SELECT jsonb_agg(jsonb_build_object('payer_kind',kind,'payer_user_id',payer,'destination_kind',destination,'rake',rake,'unrounded',unrounded,'source_count',n,'amount',(whole+CASE WHEN rank<=extra THEN 1 ELSE 0 END)/100)ORDER BY kind,payer NULLS FIRST,destination)INTO result FROM cents;
 IF(SELECT sum((p->>'amount')::numeric)FROM jsonb_array_elements(result)p)IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'rakeback_wallet_plan_not_conserved' USING ERRCODE='23514';END IF;
 RETURN result;
END $function$
