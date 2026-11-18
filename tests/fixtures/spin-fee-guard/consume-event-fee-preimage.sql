CREATE OR REPLACE FUNCTION public.fn_ca_promo_consume_event_fee(p_fee_source_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE f public.accounting_tournament_fee_sources%ROWTYPE;r public.ca_promo_event_fee_consumption_receipts%ROWTYPE;spent numeric;
BEGIN
 SELECT * INTO STRICT f FROM public.accounting_tournament_fee_sources WHERE id=p_fee_source_id;
 IF f.source_charge_ledger_id IS NULL THEN RETURN 0; END IF;
 SELECT * INTO r FROM public.ca_promo_event_fee_consumption_receipts WHERE charge_ledger_id=f.source_charge_ledger_id;
 IF NOT FOUND THEN
  IF (SELECT created_at FROM public.chip_ledger WHERE id=f.source_charge_ledger_id)>=(SELECT enforced_from FROM public.ca_promo_play_through_settings WHERE id) THEN RAISE EXCEPTION 'promo_original_entry_fee_receipt_missing'; END IF;
  RETURN 0;
 END IF;
 spent:=r.principal;
 IF r.entitlement_id IS DISTINCT FROM f.source_entitlement_id OR r.gross_fee IS DISTINCT FROM f.rake_credit OR r.club_id IS DISTINCT FROM f.club_id OR r.player_id IS DISTINCT FROM f.player_id THEN RAISE EXCEPTION 'promo_canonical_fee_lost_original_entitlement'; END IF;
 INSERT INTO public.ca_promo_event_fee_source_links VALUES(f.id,r.charge_ledger_id) ON CONFLICT(fee_source_id) DO NOTHING;
 RETURN spent;
END $function$
