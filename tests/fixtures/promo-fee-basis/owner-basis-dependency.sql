CREATE OR REPLACE FUNCTION public.fn_accounting_tournament_owner_basis_terms_at(p_tournament_id uuid, p_charged_at timestamp with time zone, p_contract jsonb)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT COALESCE((SELECT b.completed_at FROM public.accounting_tournament_fee_owner_bases b
   WHERE b.tournament_id=p_tournament_id
    AND b.operation_id::text=p_contract->'owner_basis'->>'operation_id'
    AND b.basis_kind=p_contract->'owner_basis'->>'basis_kind'
    AND (p_contract->'owner_basis'->>'terms_at')::timestamptz=b.completed_at
    AND (p_contract->'owner_basis'->>'original_terms_at')::timestamptz=p_charged_at
    AND b.completed_at>=p_charged_at),p_charged_at)
$function$;

DO $$ BEGIN IF md5(pg_get_functiondef('public.fn_accounting_tournament_owner_basis_terms_at(uuid,timestamptz,jsonb)'::regprocedure))<>'bc3aea770a35ea4897d5ac195b86f532' THEN RAISE EXCEPTION 'captured_owner_basis_dependency_changed'; END IF; END $$;
