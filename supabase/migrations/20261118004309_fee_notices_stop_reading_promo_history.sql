-- Retire the optional halfway/near progress observer. The original fee remains
-- an input to the on-demand meter. While older schemas retain its deferred
-- triggers, observing a newly earned fee requires no history or wallet access.
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_ca_promo_fee_notice()'::regprocedure))='b36196865d51e7d71cdcf672fdf7a491')
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';
DO $guard$
BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_promo_fee_notice()'::regprocedure))
    <> '140f4415cbb7dcbdb907391e31ec706e' THEN
  RAISE EXCEPTION 'promo fee notice owner changed; requalify retirement';
 END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_fee_notice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 RETURN NEW;
END;
$function$;
COMMIT;
