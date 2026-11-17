-- @live-proof: position('satellite_remainder_original_earning' in pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure)) > 0
-- Satellite b4b67135 reached five qualifiers on 2026-11-17. Its original
-- cash remainder calls fn_credit_and_log directly, bypassing the ordinary
-- obligation payer that prepares Promo Play Through earning sources. After
-- prospective activation the ledger validator raised P0002 on the absent
-- source and rolled back every qualifier award. Preserve that validator,
-- the original fixed remainder key and the original financial transaction.
-- Only the complete unpaid remainder of its exact source obligation may use
-- the satellite key; ordinary obligations retain their tranche keys.
BEGIN;
SET LOCAL lock_timeout='1s';

DO $source_contract$
DECLARE d text; old text; replacement text; target regprocedure; item record;
BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('public.fn_ca_promo_profit_prepare_tournament_credit(uuid,text,numeric)',
  $a$p_operation IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint$a$,
  $b$(p_operation IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint
     AND NOT COALESCE(o.kind='satellite_remainder' AND o.source='engine.fn_settle_satellite_tournament'
       AND o.place>0 AND o.amount_paid=0 AND p_amount=o.amount_owed
       AND p_operation='tourney:'||o.tournament_id||':satellite_remainder:place:'||o.place,false))$b$),
 ('public.fn_ca_promo_profit_bind_earning_ledger(uuid)',
  $a$s.operation_ref IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint$a$,
  $b$(s.operation_ref IS DISTINCT FROM 'tourney:'||o.tournament_id||':obl:'||o.id||':'||round(o.amount_paid*100)::bigint
     AND NOT COALESCE(o.kind='satellite_remainder' AND o.source='engine.fn_settle_satellite_tournament'
       AND o.place>0 AND o.amount_paid=0 AND s.amount=o.amount_owed
       AND s.operation_ref='tourney:'||o.tournament_id||':satellite_remainder:place:'||o.place,false))$b$)
 ) AS changes(signature,anchor,postimage) LOOP
  target:=item.signature::regprocedure;d:=pg_get_functiondef(target);
  IF position(item.postimage IN d)>0 THEN CONTINUE;END IF;
  IF length(d)-length(replace(d,item.anchor,''))<>length(item.anchor) THEN
   RAISE EXCEPTION 'satellite remainder earning key contract changed: %',target;
  END IF;
  EXECUTE replace(d,item.anchor,item.postimage);
 END LOOP;
END $source_contract$;

DO $remainder_owner$
DECLARE d text; before_hash text; after_hash text; guard text; pin text; item record;
BEGIN
 d:=pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure);
 IF position('satellite_remainder_original_earning' IN d)>0 THEN RETURN;END IF;
 before_hash:=md5(d);
 FOR item IN SELECT * FROM (VALUES
 ($a$  v_promo_nonwallet_prior text;
  v_accounting jsonb;$a$,
  $b$  v_promo_nonwallet_prior text;
  v_promo_earning_prior text;
  v_accounting jsonb;$b$),
 ($a$    v_credited := public.fn_credit_and_log($a$,
  $b$    -- satellite_remainder_original_earning: prepare in the original payment.
    v_promo_earning_prior:=current_setting('app.ca_promo_profit_earning_source',true);
    PERFORM set_config('app.ca_promo_profit_earning_source',
      COALESCE(public.fn_ca_promo_profit_prepare_tournament_credit(
        v_obligation.id,v_payout_key,v_remainder)::text,''),true);
    v_credited := public.fn_credit_and_log($b$),
 ($a$      p_payout_source => 'satellite_remainder');$a$,
  $b$      p_payout_source => 'satellite_remainder');
    PERFORM set_config('app.ca_promo_profit_earning_source',COALESCE(v_promo_earning_prior,''),true);$b$)
 ) AS changes(anchor,postimage) LOOP
  IF length(d)-length(replace(d,item.anchor,''))<>length(item.anchor) THEN
   RAISE EXCEPTION 'satellite remainder original credit boundary changed: %',item.anchor;
  END IF;
  d:=replace(d,item.anchor,item.postimage);
 END LOOP;
 EXECUTE d;
 after_hash:=md5(pg_get_functiondef('public.fn_ca_settle_satellite_cohort(uuid,uuid[])'::regprocedure));
 -- Advance a current-body pin only. The original ABI activation snapshot
 -- may retain an older historical body; it is not a pin to this predecessor.
 guard:=pg_get_functiondef('public.fn_ca_guard_mtt_admission_contract()'::regprocedure);
 pin:='"signature":"public.fn_ca_settle_satellite_cohort(uuid,uuid[])","definition_md5":"'||before_hash||'"';
 IF position(before_hash IN guard)>0 THEN
  IF length(guard)-length(replace(guard,pin,''))<>length(pin) THEN
   RAISE EXCEPTION 'satellite remainder admission pin changed';
  END IF;
  EXECUTE replace(guard,pin,replace(pin,before_hash,after_hash));
 END IF;
END $remainder_owner$;
COMMIT;
