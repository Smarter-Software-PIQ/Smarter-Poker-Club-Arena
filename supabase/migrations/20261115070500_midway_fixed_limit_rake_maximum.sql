-- Read-only price projections for the Midway v3 dealer. Existing hand receipts retain their dealt prices.
BEGIN;
CREATE OR REPLACE FUNCTION public.fn_cash_rake_policy(p_table_id uuid)
RETURNS TABLE(scope text, percent numeric, cap_bb numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $fn$
  WITH p AS (
    SELECT CASE WHEN t.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid
                     OR c.union_id = 'fade0000-0000-0000-0000-000000000001'::uuid THEN 'midway'
                WHEN t.union_id IS NULL AND c.id IS NOT NULL AND c.union_id IS NULL THEN 'standalone'
                ELSE 'standard' END AS scope, t.big_blind, t.game_variant,
           COALESCE(CASE WHEN t.rake_percent >= 0 THEN t.rake_percent END,
                    CASE WHEN c.default_rake_percent >= 0 THEN c.default_rake_percent END, 10) AS pct,
           COALESCE(CASE WHEN t.rake_cap_bb >= 0 THEN t.rake_cap_bb END,
                    CASE WHEN c.rake_cap >= 0 THEN c.rake_cap END, 2.5) AS cap
      FROM public.tables t LEFT JOIN public.clubs c ON c.id=t.club_id
     WHERE t.id=p_table_id AND t.tournament_id IS NULL
  ) SELECT scope, LEAST(pct, CASE WHEN scope='standalone' THEN 100 ELSE 10 END),
           CASE WHEN scope='midway' AND big_blind > 0 THEN LEAST(cap,2.5,(CASE WHEN lower(game_variant::text) IN ('flh','flo4','flo5','flo6','flo8') THEN 5.0 ELSE 12.5 END) / big_blind)
                WHEN scope='standalone' THEN cap ELSE LEAST(cap,2.5) END FROM p;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_effective_rake_config(p_table_id uuid)
 RETURNS TABLE(table_id uuid, club_name text, source text, effective_percent numeric, effective_cap_bb numeric, note text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public, pg_temp AS $function$
 SELECT t.id,c.name,p.scope || ' cash policy',p.percent,p.cap_bb,
        'Midway fixed-limit maximum 5 chips and other cash maximum 12.5 chips require serving cashRakePolicyVersion=3; BBJ is independent.'
 FROM public.tables t LEFT JOIN public.clubs c ON c.id=t.club_id
 CROSS JOIN LATERAL public.fn_cash_rake_policy(t.id) p WHERE t.id=p_table_id;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_rake_policy(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_rake_policy(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_effective_rake_config(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_effective_rake_config(uuid) TO authenticated, service_role;
COMMIT;
