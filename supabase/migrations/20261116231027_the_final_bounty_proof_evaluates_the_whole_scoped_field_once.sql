-- Original d6598869: final-two close exhausted eight requests in61s and played on.
-- Full marker proof took9620ms for1353 settled obligations/713404 buffer hits;
-- identical marker CASE in one scoped query took614ms/178378 hits.
-- Keep every historical marker, pending debt, mystery award and money-unit rule.
-- Compile the reviewed scalar proof into one query; refuse source drift both at
-- installation and invocation. No cache, timeout increase, schedule or payment.
-- @live-proof: position('Scoped complete bounty marker proof' in pg_get_functiondef('public.fn_tournament_has_unsettled_bounties(uuid)'::regprocedure))>0
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $scoped_proof$
DECLARE
 target regprocedure:='public.fn_tournament_has_unsettled_bounties(uuid)'::regprocedure;
 marker regprocedure:='public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure;
 old_target constant text:='8041a7f3d6b2886ce7d688bb5525d952';
 marker_hash constant text:='11700b51aab5116d79a8dc0078242def';
 original text; proof text; replacement text; before_meta jsonb;
BEGIN
 original:=pg_get_functiondef(target);
 IF md5(original) IS DISTINCT FROM old_target OR md5(pg_get_functiondef(marker)) IS DISTINCT FROM marker_hash THEN
  RAISE EXCEPTION 'scoped_bounty_proof_preimage_changed' USING ERRCODE='55000';
 END IF;
 SELECT to_jsonb(p)-'prosrc'-'prolang' INTO before_meta FROM pg_proc p WHERE oid=target;
 IF before_meta->>'prosecdef' IS DISTINCT FROM 'true'
 OR pg_get_userbyid((before_meta->>'proowner')::oid) IS DISTINCT FROM 'postgres'
 OR before_meta->'proacl' IS DISTINCT FROM '["postgres=X/postgres","service_role=X/postgres"]'::jsonb
 OR before_meta->'proconfig' IS DISTINCT FROM '["search_path=public, pg_temp"]'::jsonb THEN
  RAISE EXCEPTION 'scoped_bounty_proof_authority_changed' USING ERRCODE='55000';
 END IF;
 SELECT prosrc INTO proof FROM pg_proc WHERE oid=marker;
 IF (length(proof)-length(replace(proof,'SELECT COALESCE((','')))/length('SELECT COALESCE((')<>1
 OR (length(proof)-length(replace(proof,'o.id=p_obligation_id','')))/length('o.id=p_obligation_id')<>1
 OR right(btrim(proof,E' \n\r\t'),length('),false);'))<>'),false);' THEN
  RAISE EXCEPTION 'scoped_bounty_proof_shape_changed';
 END IF;
 proof:=substr(proof,strpos(proof,'SELECT COALESCE((')+length('SELECT COALESCE(('));
 proof:=left(btrim(proof,E' \n\r\t'),length(btrim(proof,E' \n\r\t'))-length('),false);'));
 proof:=replace(proof,'o.id=p_obligation_id','o.tournament_id=p_tournament_id AND o.state=''settled''');
 replacement:=$definition$CREATE OR REPLACE FUNCTION public.fn_tournament_has_unsettled_bounties(p_tournament_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 -- Scoped complete bounty marker proof; never trust a stale compiled source.
 IF md5(pg_get_functiondef('public.fn_bounty_obligation_has_complete_marker(uuid)'::regprocedure))
    IS DISTINCT FROM '11700b51aab5116d79a8dc0078242def' THEN
  RAISE EXCEPTION 'scoped_bounty_marker_source_changed' USING ERRCODE='55000';
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.tournament_bounty_obligations o
   WHERE o.tournament_id=p_tournament_id AND o.state='pending')
 OR EXISTS(SELECT 1 FROM ($definition$||proof||$definition$) complete(marker_complete)
   WHERE NOT coalesce(marker_complete,false))
 OR EXISTS(SELECT 1 FROM public.tournament_bounty_awards a
   WHERE a.tournament_id=p_tournament_id AND a.status IN ('reserved','revealed','paid'));
END;
$function$;$definition$;
 EXECUTE replacement;
 IF strpos(pg_get_functiondef(target),proof)=0 THEN
  RAISE EXCEPTION 'scoped_bounty_proof_postimage_changed';
 END IF;
 IF EXISTS(SELECT FROM pg_proc p WHERE oid=target
   AND (to_jsonb(p)-'prosrc'-'prolang') IS DISTINCT FROM before_meta) THEN
  RAISE EXCEPTION 'scoped_bounty_proof_metadata_changed';
 END IF;
END $scoped_proof$;
COMMIT;
