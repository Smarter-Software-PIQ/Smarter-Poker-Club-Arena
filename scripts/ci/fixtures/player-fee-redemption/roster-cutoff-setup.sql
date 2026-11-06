-- Isolated fixture only: count boundary reads without time-dependent budgets.
CREATE SEQUENCE public.cutoff_reads;
CREATE TABLE public.fixture_cutoff(value timestamptz);
INSERT INTO public.fixture_cutoff VALUES(NULL);
CREATE FUNCTION public.fn_ca_launch_accounting_cutoff(text,uuid) RETURNS timestamptz
 LANGUAGE plpgsql STABLE AS $$ BEGIN
 PERFORM nextval('public.cutoff_reads');
 RETURN (SELECT value FROM public.fixture_cutoff);
END $$;
CREATE OR REPLACE FUNCTION public.fn_ca_launch_accounting_accepts(p_club_id uuid, p_earned_at timestamp with time zone)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT CASE WHEN b.cutoff IS NULL THEN true ELSE p_earned_at IS NOT NULL AND isfinite(p_earned_at) AND p_earned_at>=b.cutoff END
 FROM (SELECT public.fn_ca_launch_accounting_cutoff('club',p_club_id) cutoff)b
$function$;
-- Preserve the actual old reader as an independent output oracle.
DO $$ BEGIN EXECUTE replace(pg_get_functiondef('ca_club_member_fee_totals(uuid,date,date,uuid)'::regprocedure),
 'public.ca_club_member_fee_totals(', 'public.fixture_old_fee_totals('); END $$;
-- Rake-record times, not attribution times, decide launch eligibility.
INSERT INTO rake_records VALUES
 ('90000000-0000-0000-0000-000000000001','2026-10-24 00:00Z'),
 ('90000000-0000-0000-0000-000000000002','2026-10-25 00:00Z'),
 ('90000000-0000-0000-0000-000000000003','infinity'),
 ('90000000-0000-0000-0000-000000000004',NULL);
INSERT INTO rake_attributions(player_id,club_id,rake_amount,created_at,rake_record_id)
 SELECT '69f2cefa-017d-49f3-ac3e-61505633747c','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',1.01,'2026-10-25 12:00Z',id FROM rake_records;
