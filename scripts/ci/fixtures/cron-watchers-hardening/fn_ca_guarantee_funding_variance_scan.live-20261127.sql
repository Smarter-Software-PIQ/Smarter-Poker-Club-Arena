CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding_variance_scan(p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  -- The gross rule shipped at 2026-11-05 22:25 UTC (20261105222502); events
  -- funded before it are reconciled in its own manifest, not here.
  v_since timestamptz := COALESCE(p_since, '2026-11-05 22:25:02+00'::timestamptz);
  n integer;
BEGIN
  WITH cov AS (
    SELECT t.id, t.name, public.fn_ca_guarantee_funding(t.id) AS f
      FROM public.tournaments t
     WHERE COALESCE(t.guaranteed_prize, 0) > 0
       AND COALESCE(t.prize_pool_finalized, false)
       AND COALESCE(t.variant, '') NOT IN ('satellite', 'spin')
       AND COALESCE(t.satellite_seats, 0) = 0
       AND t.start_time >= v_since
       AND t.start_time >= now() - interval '14 days')
  INSERT INTO public.ca_guarantee_funding_variances AS v
    (tournament_id, name, guarantee, gross_coverage, house_required, house_posted, variance, detail)
  SELECT id, name, (f->>'guarantee')::numeric, (f->>'gross_coverage')::numeric,
         (f->>'house_required')::numeric, (f->>'house_posted')::numeric,
         round((f->>'house_posted')::numeric - (f->>'house_required')::numeric, 2), f
    FROM cov
   WHERE abs((f->>'house_posted')::numeric - (f->>'house_required')::numeric) > 0.01
  ON CONFLICT (tournament_id) DO UPDATE
     SET variance = EXCLUDED.variance, house_posted = EXCLUDED.house_posted,
         house_required = EXCLUDED.house_required, gross_coverage = EXCLUDED.gross_coverage,
         detail = EXCLUDED.detail, last_seen_at = clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$function$
