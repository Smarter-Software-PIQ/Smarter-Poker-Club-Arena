-- @live-proof: position('INTO STRICT funding FROM pg_temp._weekly_player_funding_receipt' in pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))>0 AND position('weekly_payout_fund_agent_shortfalls' in pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))>position('routed_rakeback_player_period_missing' in pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure))
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';

-- The original funding helper locks every paying club and agent for the
-- affordability snapshot, outstanding transfers and reserved player shares.
-- The source/certificate proof preceding those operations reads history only.
-- Keep both in the original transaction but acquire treasury and wallet locks
-- after that proof, so an agent can move its unreserved balance during reads.
DO $install$
DECLARE
  runner text:=pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure);
  players text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
  old_funding text:='IF rnd=3 THEN funding:=smarter_private.weekly_payout_fund_agent_shortfalls(r.run_id,k,id,ws,we); END IF;';
  old_pay text:='ELSE res:=public.fn_settle_accounting_rakeback_stage(k,id,ws,we);';
  source_verified text:='INTO fingerprint FROM pg_temp._routed_player_items i;';
BEGIN
  IF md5(runner)<>'14078b0f07d739d79b292d62096e8d7d' OR md5(players)<>'de1bb0529e631b1f230bc7670dc05e82'
     OR strpos(runner,old_funding)=0 OR strpos(runner,old_pay)=0 OR strpos(players,source_verified)=0 THEN
    RAISE EXCEPTION 'weekly_player_funding_order_preimage_changed';
  END IF;
  runner:=replace(runner,old_funding,$new$
   IF rnd=3 THEN
     CREATE TEMP TABLE IF NOT EXISTS _weekly_player_funding_receipt(run_id uuid PRIMARY KEY,receipt jsonb) ON COMMIT DROP;
     INSERT INTO pg_temp._weekly_player_funding_receipt(run_id,receipt) VALUES(r.run_id,NULL)
       ON CONFLICT(run_id) DO UPDATE SET receipt=NULL;
   END IF;$new$);
  runner:=replace(runner,old_pay,old_pay||$new$
     SELECT f.receipt INTO STRICT funding FROM pg_temp._weekly_player_funding_receipt f WHERE f.run_id=r.run_id;
     IF funding IS NULL THEN RAISE EXCEPTION 'weekly_player_funding_receipt_missing'; END IF;$new$);
  EXECUTE runner;
  -- Direct audits and ordinary book replays never create a funding request.
  -- Only the exact original owned transaction can run the same funding helper
  -- and supply the receipt the runner records against its round.
  players:=replace(players,source_verified,source_verified||$new$
 IF to_regclass('pg_temp._weekly_player_funding_receipt') IS NOT NULL THEN
   UPDATE pg_temp._weekly_player_funding_receipt f
      SET receipt=smarter_private.weekly_payout_fund_agent_shortfalls(o.run_id,o.scope_kind,o.scope_id,o.period_start,o.period_end)
     FROM smarter_private.weekly_payout_owned_transactions o
    WHERE o.backend_pid=pg_backend_pid() AND o.transaction_id=txid_current()
      AND o.run_id=f.run_id AND f.receipt IS NULL AND o.round_no=3
      AND o.scope_kind=p_scope_kind AND o.scope_id=p_scope_id
      AND o.period_start=p_period_start AND o.period_end=p_period_end;
 END IF;$new$);
  EXECUTE players;
END $install$;
COMMIT;
