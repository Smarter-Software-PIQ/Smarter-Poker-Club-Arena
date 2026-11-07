CREATE OR REPLACE FUNCTION public.fn_ca_blind_contract_number(p_value jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v numeric; t text:=p_value #>> '{}';
BEGIN
  IF jsonb_typeof(p_value) NOT IN ('number','string') OR t !~ '^[0-9]+([.][0-9]+)?$' THEN RETURN NULL; END IF;
  v:=t::numeric;
  IF v>9007199254740991 THEN RETURN NULL; END IF;
  RETURN v;
END;
$function$
