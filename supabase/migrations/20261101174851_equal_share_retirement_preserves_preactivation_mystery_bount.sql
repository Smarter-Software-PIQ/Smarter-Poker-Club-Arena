-- Version 20261101174851 reserved by scripts/new-migration.mjs.
-- Only a pre-activation chests-only mystery head is an unearned cache.
-- Its value stays in the remaining bank under the installed claim contract.
-- Preserve pre_abort_roster, all prior awards, elimination witnesses and chips.
-- @live-proof: md5(pg_get_functiondef('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)'::regprocedure))='ef3c8122a5fccc4f90630c1672080240' AND has_function_privilege('service_role','public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)','EXECUTE')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $migration$
DECLARE
 source text;
 needle constant text := $old$ UPDATE public.tournament_players SET status='eliminated',chips=0,current_bounty=0 WHERE tournament_id=p_tournament_id AND status::text<>'eliminated';$old$;
 addition constant text := $new$
 -- equal_share_preactivation_mystery_cache: these busts earned no bounty.
 -- The original roster above retains every head and elimination witness.
 IF t.is_mystery_bounty IS TRUE AND coalesce(t.is_pko,false)=false
 AND t.mystery_bounty_stage='pending' AND t.mystery_bounty_regular_pool_percent=0 THEN
  UPDATE public.tournament_players SET current_bounty=0
   WHERE tournament_id=p_tournament_id AND status::text='eliminated'
   AND chips=0 AND current_bounty>0
   AND current_bounty::text NOT IN('NaN','Infinity','-Infinity');
 END IF;
$new$;
BEGIN
 source:=pg_get_functiondef('public.fn_ca_settle_tournament_abort_equal_share(uuid,uuid,text)'::regprocedure);
 IF md5(source) IS DISTINCT FROM 'b88bcee008774d5e9eab175bc87d3b04'
 OR (length(source)-length(replace(source,needle,'')))/length(needle)<>1
 THEN RAISE EXCEPTION 'equal_share_mystery_retirement_exact_preimage_required' USING ERRCODE='55000';END IF;
 EXECUTE replace(source,needle,needle||addition);
END $migration$;
COMMIT;
