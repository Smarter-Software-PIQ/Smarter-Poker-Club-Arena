-- Cash and Lightning rake, accounting entry fees and original paid-entry
-- receipts feed the on-demand wallet meter. Their insertion must never scan
-- a member's prior fees to send halfway or near-completion notices.
-- @locks: public.rake_attributions, public.accounting_tournament_fee_sources, public.ca_promo_event_fee_consumption_receipts
-- @live-proof: NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.rake_attributions'::regclass,'public.accounting_tournament_fee_sources'::regclass,'public.ca_promo_event_fee_consumption_receipts'::regclass) AND tgfoid='public.fn_ca_promo_fee_notice()'::regprocedure)
BEGIN;
SET LOCAL search_path TO public, pg_catalog;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

-- Acquire every DDL lock before changing any admission. A busy producer keeps
-- its transaction and all three previous notice triggers remain intact.
LOCK TABLE public.rake_attributions, public.accounting_tournament_fee_sources,
 public.ca_promo_event_fee_consumption_receipts IN ACCESS EXCLUSIVE MODE NOWAIT;

DO $guard$
BEGIN
 IF EXISTS (
  SELECT 1 FROM (VALUES
   ('public.rake_attributions'::regclass,'ca_promo_fee_notice','899bf028fdd5a790b78bf41003f71597'),
   ('public.accounting_tournament_fee_sources'::regclass,'ca_promo_entry_notice','5e060dd62d9915475a54e20ce1bb0e40'),
   ('public.ca_promo_event_fee_consumption_receipts'::regclass,'ca_promo_paid_entry_notice','ecc9ab97c6f97ae9df018ba904c7428e')
  ) expected(relation,name,signature)
  LEFT JOIN pg_trigger t ON t.tgrelid=expected.relation AND t.tgname=expected.name
  WHERE t.tgenabled IS DISTINCT FROM 'O' OR md5(pg_get_triggerdef(t.oid)) IS DISTINCT FROM expected.signature
 ) THEN
  RAISE EXCEPTION 'promo fee notice trigger changed; requalify notice removal';
 END IF;
END $guard$;

DROP TRIGGER ca_promo_fee_notice ON public.rake_attributions;
DROP TRIGGER ca_promo_entry_notice ON public.accounting_tournament_fee_sources;
DROP TRIGGER ca_promo_paid_entry_notice ON public.ca_promo_event_fee_consumption_receipts;

COMMIT;
