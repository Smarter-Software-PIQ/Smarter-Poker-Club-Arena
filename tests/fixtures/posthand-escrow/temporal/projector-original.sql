CREATE OR REPLACE FUNCTION smarter_private.posthand_escrow_project_evidence(p_evidence jsonb, p_proof jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT p_evidence||jsonb_build_object('status','ready','basis_certified',true,'payment_authorized',false,'issues','[]'::jsonb,
  'participants',(SELECT jsonb_agg(o.participant||jsonb_build_object('earning_club_id',p.participant->'earning_club_id','ownership_certified',true) ORDER BY o.n)
   FROM jsonb_array_elements(p_evidence->'participants') WITH ORDINALITY o(participant,n)
   JOIN LATERAL jsonb_array_elements(p_proof->'participants') p(participant) ON p.participant->>'user_id'=o.participant->>'user_id'),
  'qualified_basis',p_proof->>'resolution_kind');
$function$

