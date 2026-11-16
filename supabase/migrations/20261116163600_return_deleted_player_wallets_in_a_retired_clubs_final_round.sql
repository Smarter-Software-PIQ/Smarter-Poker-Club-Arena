-- @live-proof: position('retired_club_owns_final_round' in pg_get_functiondef('public.fn_ca_deleted_wallet_bank_return(uuid,uuid,text)'::regprocedure))>0 AND position('deleted_account_bank_return:' in pg_get_functiondef('public.fn_guard_club_lifecycle_write()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DO $patch$
DECLARE
  src text:=pg_get_functiondef('public.fn_ca_deleted_wallet_bank_return(uuid,uuid,text)'::regprocedure);
  anchor text:='AND lifecycle_status=''active'' FOR NO KEY UPDATE';
BEGIN
  IF md5(src)<>'b1938403621af2397590c6ce004faf3b' OR strpos(src,anchor)=0 THEN RAISE EXCEPTION 'deleted_final_week_return_preimage_changed'; END IF;
  src:=replace(src,anchor,$allow$AND (lifecycle_status='active' OR
    (lifecycle_status='retired' AND p_source IN ('player_wallet','agent_wallet')
     AND smarter_private.retired_club_owns_final_round(p_club,retired_at,ARRAY[3]))) FOR NO KEY UPDATE$allow$);
  -- The journal writer consumes the debit key. Bind the following bank update
  -- to this helper's operation and transaction, including nested subtransactions.
  anchor:='  UPDATE public.clubs SET chip_treasury=coalesce(chip_treasury,0)+v_amount';
  IF strpos(src,anchor)=0 THEN RAISE EXCEPTION 'missing_deleted_wallet_return_debit'; END IF;
  src:=replace(src,'''app.ledger_autoskip_agents''];','''app.ledger_autoskip_agents'',''app.deleted_wallet_return_operation''];');
  EXECUTE replace(src,anchor,$context$  PERFORM set_config('app.deleted_wallet_return_operation',txid_current()::text||':'||v_op::text,true);
$context$||anchor);
  src:=pg_get_functiondef('public.fn_guard_club_lifecycle_write()'::regprocedure);
  anchor:='CASE WHEN NEW.chip_treasury>OLD.chip_treasury THEN ARRAY[1] ELSE ARRAY[2,3] END';
  IF md5(src)<>'bab76fbbd976c09b6e23957697379159' OR strpos(src,anchor)=0 THEN RAISE EXCEPTION 'retired_final_week_bank_preimage_changed'; END IF;
  -- The existing return debits the deleted wallet before updating the club.
  -- Require that same transaction's posted debit, amount, club and operation.
  EXECUTE replace(src,anchor,$allow$CASE WHEN NEW.chip_treasury>OLD.chip_treasury THEN
     CASE WHEN current_setting('app.ledger_category',true)='club_bank_claim' AND EXISTS (
       SELECT FROM public.chip_ledger l WHERE l.idempotency_key='deleted_account_bank_return:'||current_setting('app.ledger_correlation',true)
       AND l.idempotency_key='deleted_account_bank_return:'||l.correlation_id::text
       AND l.correlation_id::text=current_setting('app.ledger_correlation',true) AND l.club_id=OLD.id
       AND current_setting('app.deleted_wallet_return_operation',true)=txid_current()::text||':'||l.correlation_id::text AND l.status='posted'
       AND l.category='club_bank_claim' AND l.from_type IN ('player_wallet','agent_wallet')
       AND l.to_type='club_treasury' AND l.to_entity_id=OLD.id AND l.amount=NEW.chip_treasury-OLD.chip_treasury
     ) THEN ARRAY[1,3] ELSE ARRAY[1] END ELSE ARRAY[2,3] END$allow$);
END
$patch$;
COMMIT;
