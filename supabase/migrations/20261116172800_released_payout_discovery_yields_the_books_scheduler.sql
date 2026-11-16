-- @live-proof: position('released_week_discovery' in pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='5s';
DO $install$
DECLARE
  runner text := pg_get_functiondef('smarter_private.weekly_payout_next_round()'::regprocedure);
  scheduler_lock constant text := ' IF NOT pg_try_advisory_xact_lock(hashtextextended(''union-accounting-scheduler'',0))';
BEGIN
  IF md5(runner)<>'fc62ec7a0659a4a0f4d2595d44fae578' OR strpos(runner,scheduler_lock)=0 THEN
    RAISE EXCEPTION 'released_week_payout_runner_preimage_changed';
  END IF;
  EXECUTE replace(runner,scheduler_lock,$probe$
 -- released_week_discovery: the payout runner already owns its own lane.
 -- A released week with no new scopes has no work for the shared books lane.
 IF (SELECT bool_and(p.phase='released') FROM public.weekly_accounting_payout_pauses p
     WHERE p.period_end=e AND p.instance_id='weekly-payout-rounds') THEN
  plan:=smarter_private.weekly_payout_scope_plan(e,n);
  IF plan IS NULL OR jsonb_array_length(plan)=0 THEN RETURN NULL; END IF;
 END IF;
 -- Re-read the active run and recompute any new plan under BOTH original
 -- locks before preparation or booking. The unlocked read never admits work.
$probe$||scheduler_lock);
END
$install$;
COMMIT;
