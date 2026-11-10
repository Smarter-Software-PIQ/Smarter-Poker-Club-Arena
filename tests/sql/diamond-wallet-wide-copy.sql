\set ON_ERROR_STOP on
BEGIN;
DO $probe$
DECLARE r jsonb; journal_id uuid; audit_id bigint;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ca_financial_epochs WHERE name='Isolated Diamond financial probe' AND is_current) THEN
  RAISE EXCEPTION 'Private financial fixture required'; END IF;
 IF has_function_privilege('authenticated','public.fn_wheel_copy_wide_journal_batch(integer)','execute') OR
    has_function_privilege('anon','public.fn_wheel_verify_wide_journal_copy()','execute') THEN RAISE EXCEPTION 'Public copy access'; END IF;
 BEGIN
  PERFORM public.fn_wheel_verify_wide_journal_copy();
  RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='An unfinished copy was allowed';
 EXCEPTION WHEN RAISE_EXCEPTION THEN NULL;
 END;
 -- Rows committed after the frozen upper bound and updates during copying
 -- already carry the equivalent wide value. The original wallet entry rolls back.
 BEGIN
  PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
  r:=public.add_diamonds_to_balance('d1000000-0000-4000-8000-000000000005',1,'transfer','Wide copy fixture',
   'wide-copy:concurrent-write','d1000000-0000-4000-8000-000000000002');
  SELECT id INTO STRICT journal_id FROM public.diamond_transactions WHERE reference_id='wide-copy:concurrent-write' AND amount=1 AND wheel_amount64=1 AND wheel_balance_after64=balance_after;
  SELECT id INTO STRICT audit_id FROM public.ca_diamond_balance_audit WHERE user_id='d1000000-0000-4000-8000-000000000005' AND wheel_delta64=1 AND wheel_new64=new_diamonds ORDER BY id DESC LIMIT 1;
  UPDATE public.diamond_transactions SET wheel_amount64=-9 WHERE id=journal_id;
  IF (SELECT wheel_amount64 FROM public.diamond_transactions WHERE id=journal_id)<>1 THEN RAISE EXCEPTION 'Staged amount diverged'; END IF;
  RAISE EXCEPTION USING ERRCODE='P0099',MESSAGE='restore test wallet and journal';
 EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
 END;
 FOR i IN 1..1000 LOOP
  r:=public.fn_wheel_copy_wide_journal_batch(1);
  EXIT WHEN (r->>'complete')::boolean;
 END LOOP;
 IF NOT (r->>'complete')::boolean OR public.fn_wheel_copy_wide_journal_batch(100) IS DISTINCT FROM r
  THEN RAISE EXCEPTION 'Incomplete or non-idempotent copy'; END IF;
 IF public.fn_wheel_verify_wide_journal_copy()->>'verified_at' IS NULL THEN RAISE EXCEPTION 'No verified copy'; END IF;
 IF EXISTS(SELECT 1 FROM public.diamond_transactions WHERE (amount::bigint,balance_after::bigint) IS DISTINCT FROM (wheel_amount64,wheel_balance_after64))
  OR EXISTS(SELECT 1 FROM public.ca_diamond_balance_audit WHERE (old_diamonds::bigint,new_diamonds::bigint,delta::bigint) IS DISTINCT FROM (wheel_old64,wheel_new64,wheel_delta64))
  THEN RAISE EXCEPTION 'Economic values changed during the copy'; END IF;
END $probe$;
COMMIT;
