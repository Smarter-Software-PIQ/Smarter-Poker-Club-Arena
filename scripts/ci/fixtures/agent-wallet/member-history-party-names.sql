-- Bridge the existing cashier fixture from its October 27 feed to the exact
-- November 14 preimage required by the indexed-book migration. The deployed
-- name projection changed independently; both downstream migrations check
-- the full function hash before applying. The test exercises profile names,
-- not the separate organization-label lookup.
CREATE FUNCTION public.fn_ca_transaction_party_name(text,text,jsonb,uuid,text)
RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;
DO $fixture$
DECLARE
  definition text := pg_get_functiondef('fn_cashier_history_feed(uuid,text,text,timestamptz,timestamptz,uuid,text,timestamptz,uuid,integer)'::regprocedure);
BEGIN
  definition := replace(definition,'pf.full_name) END,',$patch$pf.full_name)
                ELSE public.fn_ca_transaction_party_name('from', ct.transaction_type, ct.metadata, ct.club_id, ct.notes) END,$patch$);
  EXECUTE replace(definition,'pt.full_name) END,',$patch$pt.full_name)
                ELSE public.fn_ca_transaction_party_name('to', ct.transaction_type, ct.metadata, ct.club_id, ct.notes) END,$patch$);
END
$fixture$;
