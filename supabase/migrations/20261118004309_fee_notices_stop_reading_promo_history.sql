-- Retire the optional halfway/near progress observer. The original fee remains
-- an input to the on-demand meter. While older schemas retain its deferred
-- triggers, observing a newly earned fee requires no history or wallet access.
-- @live-proof: (CASE WHEN to_regprocedure('public.fn_ca_promo_fee_notice()') IS NOT NULL THEN md5(pg_get_functiondef(to_regprocedure('public.fn_ca_promo_fee_notice()')))='b36196865d51e7d71cdcf672fdf7a491' ELSE EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations h WHERE h.version='20261118004310' AND h.name='fee_sources_do_not_scan_promo_history_for_notices' AND cardinality(h.statements)=1 AND md5(h.statements[1])='741346566790dbc0dd730a59dfdc945f') AND to_regprocedure('public.fn_ca_promo_fee_notice()') IS NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.rake_attributions'::regclass,'public.accounting_tournament_fee_sources'::regclass,'public.ca_promo_event_fee_consumption_receipts'::regclass) AND tgname IN ('ca_promo_fee_notice','ca_promo_entry_notice','ca_promo_paid_entry_notice')) END)
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
