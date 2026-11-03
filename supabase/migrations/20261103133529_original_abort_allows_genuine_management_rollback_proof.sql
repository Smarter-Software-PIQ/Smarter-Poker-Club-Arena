-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_tournament_abort(uuid,uuid,text)'::regprocedure))='41bd8459f2927155ad9613d9f0a52dbb' AND md5(pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure))='766aeba0ff5dc94d3bcaf9676a819003' AND md5(pg_get_functiondef('smarter_private.equal_share_retirement_must_close()'::regprocedure))='f3ed4b1332e78c2626ee1d4ac0e7f77b'
-- Genuine management sessions must be able to prove the original refund in one
-- self-aborting transaction. Preserve the service path and every original
-- custody, generation, money-hash, disposition and financial guard.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE definition text; old_guard constant text :=
 'IF auth.role() IS DISTINCT FROM ''service_role'' THEN RAISE EXCEPTION ''operator_abort_service_required'' USING ERRCODE=''42501'';END IF;';
BEGIN
 definition:=pg_get_functiondef('public.fn_ca_settle_tournament_abort(uuid,uuid,text)'::regprocedure);
 IF md5(definition) IS DISTINCT FROM '090507a16c1bb346b512a10a272273b5' THEN
  RAISE EXCEPTION 'original_abort_management_preimage_changed';
 END IF;
 IF position(old_guard in definition)=0 THEN RAISE EXCEPTION 'original_abort_management_guard_missing';END IF;
 definition:=replace(definition,old_guard,$guard$IF auth.role() IS DISTINCT FROM 'service_role'
 AND NOT (session_user='postgres'
  AND coalesce(current_setting('role',true),'none') IN ('none','postgres')
  AND auth.role() IS NULL)
 THEN RAISE EXCEPTION 'operator_abort_service_required' USING ERRCODE='42501';END IF;$guard$);
 definition:=replace(definition,' UPDATE public.tournaments SET status=''CANCELLED'',ended_at=settled',
 $admission$ -- The existing deferred admission constraint requires this transaction's
 -- complete canonical receipt; this is not standalone terminal-edit authority.
 UPDATE smarter_private.tournament_abort_targets
 SET receipt=jsonb_build_object('mode','started_operator_abort_admission','transaction_id',txid_current())
 WHERE operation_id=p_operation_id AND tournament_id=p_tournament_id AND state='quiesced';
 UPDATE public.tournaments SET status='CANCELLED',ended_at=settled$admission$);
 EXECUTE definition;
 definition:=pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure);
 IF md5(definition) IS DISTINCT FROM 'ed66b41ac0103ded266e0a866d5eaad1' THEN RAISE EXCEPTION 'original_abort_lifecycle_preimage_changed';END IF;
 definition:=replace(definition,'  v_key text;','  v_original_abort_admission boolean := false;
  v_key text;');
 definition:=replace(definition,E'BEGIN\n', $admission$BEGIN
  IF TG_TABLE_NAME='tournaments' AND session_user='postgres' AND current_user='postgres'
     AND coalesce(current_setting('role',true),'none') IN ('none','postgres') AND auth.role() IS NULL
     AND NEW.status='CANCELLED' THEN
    SELECT EXISTS(SELECT 1 FROM smarter_private.tournament_abort_targets a
      JOIN public.engine_tournament_leases l ON l.tournament_id=a.tournament_id
      JOIN public.tournament_escrow e ON e.tournament_id=a.tournament_id
      WHERE a.tournament_id=NEW.id AND a.state='quiesced'
        AND ((a.receipt->>'mode'='started_operator_abort_admission' AND OLD.status IN ('RUNNING','BREAK','LATE_REG'))
          OR (a.receipt->>'mode'='owner_retirement_admission' AND OLD.status='COMPLETING'))
        AND (a.receipt->>'transaction_id')::bigint=txid_current()
        AND l.protocol_version=2 AND l.heartbeat_at>=clock_timestamp()-make_interval(secs=>public.fn_engine_lease_stale_seconds())
        AND a.quiescence->>'generation'=l.lease_generation::text
        AND e.enforced AND e.closed_at IS NOT NULL
        AND e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0)
    INTO v_original_abort_admission;
  END IF;
$admission$);
 definition:=replace(definition,E'    IF NOT v_is_engine\n       AND upper(COALESCE(NEW.status, ''''))',E'    IF NOT v_is_engine\n       AND NOT v_original_abort_admission\n       AND upper(COALESCE(NEW.status, ''''))');
 definition:=replace(definition,E'  IF NOT v_is_engine\n     AND NOT v_managed_command',E'  IF NOT v_is_engine\n     AND NOT v_original_abort_admission\n     AND NOT v_managed_command');
 EXECUTE definition;
 definition:=pg_get_functiondef('smarter_private.equal_share_retirement_must_close()'::regprocedure);
 IF md5(definition) IS DISTINCT FROM '429488ebf38f5fd3cc08e16e48519470' THEN RAISE EXCEPTION 'original_abort_admission_preimage_changed';END IF;
 definition:=replace(definition,' RETURN NULL;', $admission$ IF NEW.receipt->>'mode'='started_operator_abort_admission' THEN
  PERFORM smarter_private.tournament_abort_receipt(NEW.tournament_id,NULL);
 END IF;
 RETURN NULL;$admission$);
 EXECUTE definition;
 IF NOT (md5(pg_get_functiondef('public.fn_ca_settle_tournament_abort(uuid,uuid,text)'::regprocedure))='41bd8459f2927155ad9613d9f0a52dbb' AND md5(pg_get_functiondef('public.fn_guard_managed_game_lifecycle()'::regprocedure))='766aeba0ff5dc94d3bcaf9676a819003' AND md5(pg_get_functiondef('smarter_private.equal_share_retirement_must_close()'::regprocedure))='f3ed4b1332e78c2626ee1d4ac0e7f77b') THEN RAISE EXCEPTION 'original_abort_management_postimage_changed';END IF;
 IF clock_timestamp()-transaction_timestamp()>interval '8 seconds' THEN RAISE EXCEPTION 'original_abort_management_install_budget';END IF;
END $migration$;
COMMIT;
