-- A place payout was re-reading a player's complete fee history to check that
-- credited physical chips cover restrictions. The entire amount of original
-- principal already bounds the amount a fee calculation can still restrict.
-- Inconclusive bounds and invalid intersections use the original exact guard.
-- @live-proof: (SELECT count(*)=2 FROM (VALUES ('public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid)','f323eb392776524f557025581f5ee17b'),('public.fn_ca_promo_restrictions_exceed_capacity(uuid,uuid,text,uuid,numeric)','7c435814b4c1f5b57d1aabed27a66e90')) v(signature,body) JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(v.signature) WHERE md5(pg_catalog.pg_get_functiondef(p.oid))=v.body AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres}')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $pre$
BEGIN
 IF to_regprocedure('public.fn_ca_promo_restrictions_exceed_capacity(uuid,uuid,text,uuid,numeric)') IS NOT NULL OR NOT (SELECT count(*)=4 FROM (VALUES
      ('public.fn_ca_promo_locked_at(uuid,uuid,text,uuid)','216896f6641f4805b65e7f40e28e511f'),
      ('public.fn_ca_promo_play_through_state(uuid,uuid)','a2a8c0a6f916b3634a0494a4f75c8f79'),
      ('public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid)','76678653f7e77b07151b031e804374b0'),
      ('public.fn_ca_promo_restricted_at(uuid,uuid,text,uuid)','61d309076cfd290ddc6a398caf984c58')
 ) v(signature,body) JOIN pg_proc p ON p.oid=to_regprocedure(v.signature)
 WHERE md5(pg_get_functiondef(p.oid))=v.body AND p.prosecdef AND p.proowner='postgres'::regrole) THEN
  RAISE EXCEPTION 'original tournament restriction authority changed';
 END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_promo_restrictions_exceed_capacity(p_club uuid, p_user uuid, p_kind text, p_entity uuid, p_capacity numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 principal_upper numeric;
 profit numeric;
 review numeric;
 overlap numeric;
 other_restrictions numeric;
BEGIN
 profit:=public.fn_ca_promo_profit_locked_at(p_club,p_user,p_kind,p_entity);
 review:=public.fn_ca_promo_integrity_locked_at(p_club,p_user,p_kind,p_entity);
 overlap:=public.fn_ca_promo_profit_overlap_at(p_club,p_user,p_kind,p_entity);
 other_restrictions:=profit+review-overlap;

 -- Only open grants can contribute locked or expired principal. Counting
 -- every positive original custody row also includes principal whose fees
 -- are already earned, giving a conservative bound without reading history.
 SELECT COALESCE(sum(c.amount),0) INTO principal_upper
 FROM public.ca_promo_principal_custody c
 JOIN public.ca_promo_play_through_grants g ON g.id=c.grant_id
 WHERE c.kind=p_kind AND c.entity_id=p_entity AND c.amount>0
   AND g.club_id=p_club AND g.user_id=p_user AND g.closed_at IS NULL;
 IF overlap BETWEEN 0 AND LEAST(profit,review)
    AND principal_upper+other_restrictions<=p_capacity THEN RETURN false;END IF;

 -- Original authority owns ambiguous balances and invalid overlap errors.
 RETURN public.fn_ca_promo_restricted_at(p_club,p_user,p_kind,p_entity)>p_capacity;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_restrictions_exceed_capacity(uuid,uuid,text,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
DO $replace$
DECLARE original text:=pg_get_functiondef('public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid)'::regprocedure);
BEGIN
 IF length(original)-length(replace(original,'public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT chip_balance FROM public.club_members m WHERE m.club_id=club AND m.user_id=v_user)',''))<>length('public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT chip_balance FROM public.club_members m WHERE m.club_id=club AND m.user_id=v_user)') THEN
  RAISE EXCEPTION 'original wallet capacity expression changed';
 END IF;
 original:=replace(original,'public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT chip_balance FROM public.club_members m WHERE m.club_id=club AND m.user_id=v_user)','public.fn_ca_promo_restrictions_exceed_capacity(club,v_user,dest_kind,dest_id,(SELECT chip_balance FROM public.club_members m WHERE m.club_id=club AND m.user_id=v_user))');
 IF length(original)-length(replace(original,'public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT CASE WHEN t.status=''issued'' THEN t.value ELSE 0 END FROM public.tournament_tickets t WHERE t.id=dest_id AND t.holder_id=v_user)',''))<>length('public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT CASE WHEN t.status=''issued'' THEN t.value ELSE 0 END FROM public.tournament_tickets t WHERE t.id=dest_id AND t.holder_id=v_user)') THEN
  RAISE EXCEPTION 'original ticket capacity expression changed';
 END IF;
 original:=replace(original,'public.fn_ca_promo_restricted_at(club,v_user,dest_kind,dest_id)>(SELECT CASE WHEN t.status=''issued'' THEN t.value ELSE 0 END FROM public.tournament_tickets t WHERE t.id=dest_id AND t.holder_id=v_user)','public.fn_ca_promo_restrictions_exceed_capacity(club,v_user,dest_kind,dest_id,(SELECT CASE WHEN t.status=''issued'' THEN t.value ELSE 0 END FROM public.tournament_tickets t WHERE t.id=dest_id AND t.holder_id=v_user))');
 EXECUTE original;
END $replace$;
REVOKE ALL ON FUNCTION public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $post$
BEGIN
 IF NOT (SELECT count(*)=2 FROM (VALUES ('public.fn_ca_promo_profit_realize_event(uuid,uuid,text,uuid)','f323eb392776524f557025581f5ee17b'),('public.fn_ca_promo_restrictions_exceed_capacity(uuid,uuid,text,uuid,numeric)','7c435814b4c1f5b57d1aabed27a66e90')) v(signature,body) JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(v.signature) WHERE md5(pg_catalog.pg_get_functiondef(p.oid))=v.body AND p.proowner='postgres'::regrole AND p.prosecdef AND p.proacl::text='{postgres=X/postgres}') THEN RAISE EXCEPTION 'original tournament capacity postimage mismatch';END IF;
END $post$;
COMMIT;
