CREATE OR REPLACE FUNCTION smarter_private.rakeback_payer_plan(p_allocations jsonb, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE result jsonb;expected numeric;
BEGIN
 IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allocations)=0
 OR p_amount IS NULL OR p_amount<0 OR p_amount<>round(p_amount,2) OR p_amount::text IN('NaN','Infinity','-Infinity')
 THEN RAISE EXCEPTION 'rakeback_payer_plan_invalid' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations)a
  WHERE a->>'payer_kind' IS NULL OR a->>'payer_kind' NOT IN('club','agent')
   OR (a->>'payer_kind'='agent') IS DISTINCT FROM(NULLIF(a->>'payer_user_id','') IS NOT NULL)
   OR (a->>'rake_credit')::numeric IS NULL OR (a->>'rake_credit')::numeric<0
   OR (a->>'rake_credit')::numeric<>round((a->>'rake_credit')::numeric,2)
   OR (a->>'rate')::numeric IS NULL OR (a->>'rate')::numeric<0 OR (a->>'rate')::numeric>1
   OR (a->>'rake_credit')::numeric::text IN('NaN','Infinity','-Infinity')
   OR (a->>'rate')::numeric::text IN('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'rakeback_payer_allocation_invalid' USING ERRCODE='23514'; END IF;
 SELECT round(sum((a->>'rake_credit')::numeric*(a->>'rate')::numeric),2) INTO expected
 FROM jsonb_array_elements(p_allocations)a;
 IF expected IS DISTINCT FROM p_amount THEN RAISE EXCEPTION 'rakeback_payer_total_disagrees' USING ERRCODE='23514'; END IF;
 WITH g AS(
  SELECT a->>'payer_kind' kind,NULLIF(a->>'payer_user_id','')::uuid payer,
   sum((a->>'rake_credit')::numeric) rake,sum((a->>'rake_credit')::numeric*(a->>'rate')::numeric) unrounded,count(*) n
  FROM jsonb_array_elements(p_allocations)a GROUP BY a->>'payer_kind',NULLIF(a->>'payer_user_id','')::uuid
 ), cents AS(
  SELECT g.*,floor(unrounded*100) whole,
   row_number() OVER(ORDER BY unrounded*100-floor(unrounded*100) DESC,kind,payer NULLS FIRST) remainder_rank,
   p_amount*100-sum(floor(unrounded*100)) OVER() extra FROM g
 )SELECT jsonb_agg(jsonb_build_object('payer_kind',kind,'payer_user_id',payer,'rake',rake,
   'unrounded',unrounded,'source_count',n,'amount',(whole+CASE WHEN remainder_rank<=extra THEN 1 ELSE 0 END)/100)
   ORDER BY kind,payer NULLS FIRST) INTO result FROM cents;
 RETURN result;
END $function$
