-- 20261105233808_guarantee_funding_is_watched_both_ways
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-05.
--
-- GUARANTEE FUNDING IS WATCHED BOTH WAYS, AND NO LEGACY PATH CAN PAY IT AGAIN
-- (owner rule 2026-11-05: a buy-in guarantee counts the full player payment;
-- the house/promo funding of an event is H = max(0, G - C) in total and zero
-- once C >= G, on every path, including legacy jobs.)
--
-- 20261105222502 made the close-out and every settlement guard fund and check
-- H through fn_ca_guarantee_funding (C read from the event's own ledger,
-- verified 2026-11-05 against prize + bounty + rake on the live events). Three
-- things were still outside it, read from production the same day:
--
--  1. fn_ca_backpay_guarantee_shortfalls (service_role can execute it) still
--     decides that a completed event is "short" when prizes plus bounties
--     paid are below the FULL guarantee, ignoring the rake the players paid,
--     and moves bank chips for the difference. Nothing schedules or calls it
--     (no cron job, no function, no client), so its last grant is removed:
--     no role can run it. The body is unchanged.
--  2. fn_tournament_guarantee_check raises "paid out less than its advertised
--     guaranteed prize" when places plus bounties paid are below G. Under the
--     rule, rake counts toward the guarantee, so an event whose players' full
--     payments met G was reported short. It now adds the event's rake.
--  3. Nothing watched for over- or under-funding after the close-out.
--     ca_guarantee_funding_variances records, every 15 minutes, any finalized
--     guaranteed event (started from 2026-11-05 22:25 UTC, when the gross rule
--     shipped) whose posted house/promo funding is above H (overfunded) or
--     below it (underfunded), straight from fn_ca_guarantee_funding.
--     Detection only: it moves no chips and sends no alert.
--
-- @live-proof: NOT has_function_privilege('service_role','public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)','execute') AND position('r.paid + r.rake' IN pg_get_functiondef('public.fn_tournament_guarantee_check(integer)'::regprocedure))>0 AND to_regclass('public.ca_guarantee_funding_variances') IS NOT NULL AND EXISTS(SELECT 1 FROM cron.job WHERE jobname='ca-guarantee-funding-variance-15m')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)'::regprocedure))
     IS DISTINCT FROM 'd0475144024b89319445e54857fcf562' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_backpay_guarantee_shortfalls';
  END IF;
  IF md5(pg_get_functiondef('public.fn_tournament_guarantee_check(integer)'::regprocedure))
     IS DISTINCT FROM '787d0f9fc35a63caa76b464e1bd57c1d' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_tournament_guarantee_check';
  END IF;
  IF md5(pg_get_functiondef('public.fn_ca_guarantee_funding(uuid)'::regprocedure))
     IS DISTINCT FROM '6d99e12842f473688ef656d577561863' THEN
    RAISE EXCEPTION 'Inspected definition changed: fn_ca_guarantee_funding';
  END IF;
  IF to_regclass('public.ca_guarantee_funding_variances') IS NOT NULL THEN
    RAISE EXCEPTION 'guarantee funding watch already installed';
  END IF;
END $pre$;

-- ── 1. The legacy back-pay can no longer be run by any role ─────────────────
REVOKE ALL ON FUNCTION public.fn_ca_backpay_guarantee_shortfalls(boolean,integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- ── 2. The guarantee check counts the rake the players paid toward it ───────
DO $check$
DECLARE
  v_def text := pg_get_functiondef('public.fn_tournament_guarantee_check(integer)'::regprocedure);
  a text[] := ARRAY[
    E'      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,\n             COALESCE(t.prize_pool, 0) AS pool,',
    E'    CONTINUE WHEN round(r.paid, 2) >= round(r.guaranteed_prize, 2);',
    E'    v_chips := v_chips + (r.guaranteed_prize - r.paid);',
    E'          ''shortfall'',        round(r.guaranteed_prize - r.paid, 2),'];
  b text[] := ARRAY[
    E'      SELECT t.id, t.name, t.club_id, t.guaranteed_prize,\n             COALESCE(t.total_rake, 0) AS rake,\n             COALESCE(t.prize_pool, 0) AS pool,',
    E'    -- A BUY-IN GUARANTEE COUNTS THE WHOLE PLAYER PAYMENT (owner\n    -- 2026-11-05): the rake the players paid is part of what met it.\n    CONTINUE WHEN round(r.paid + r.rake, 2) >= round(r.guaranteed_prize, 2);',
    E'    v_chips := v_chips + (r.guaranteed_prize - r.paid - r.rake);',
    E'          ''shortfall'',        round(r.guaranteed_prize - r.paid - r.rake, 2),\n          ''rake'',             r.rake,'];
  i int;
BEGIN
  FOR i IN 1..4 LOOP
    IF (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]) <> 1 THEN
      RAISE EXCEPTION 'fn_tournament_guarantee_check anchor % not found exactly once', i;
    END IF;
    v_def := replace(v_def, a[i], b[i]);
  END LOOP;
  EXECUTE v_def;
END
$check$;
REVOKE ALL ON FUNCTION public.fn_tournament_guarantee_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_guarantee_check(integer) TO service_role;

-- ── 3. Over- and under-funding are recorded, never silently repaired ───────
CREATE TABLE public.ca_guarantee_funding_variances(
  tournament_id uuid NOT NULL PRIMARY KEY,
  name text,
  guarantee numeric(18,2) NOT NULL,
  gross_coverage numeric(18,2) NOT NULL,
  house_required numeric(18,2) NOT NULL,
  house_posted numeric(18,2) NOT NULL,
  variance numeric(18,2) NOT NULL,
  detail jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp());
COMMENT ON TABLE public.ca_guarantee_funding_variances IS
 'Finalized guaranteed events whose posted house/promo funding differs from H = max(0, G - C) (owner rule 2026-11-05). variance = posted - H: positive is overfunded, negative is underfunded. Detection only; nothing here moves chips.';
ALTER TABLE public.ca_guarantee_funding_variances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_guarantee_funding_variances FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_guarantee_funding_variances TO service_role;

CREATE FUNCTION public.fn_ca_guarantee_funding_variance_scan(p_since timestamptz DEFAULT NULL)
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
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_guarantee_funding_variance_scan(timestamptz) TO service_role;

-- periodic-work: the owner requires that a guarantee is never under- or over-funded (H = max(0, G - C)); this records any finalized guaranteed event whose posted house funding differs from H within 15 minutes. Read-only toward money.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ca-guarantee-funding-variance-15m';
SELECT cron.schedule('ca-guarantee-funding-variance-15m', '7,22,37,52 * * * *',
  $c$SET statement_timeout = '60s'; SELECT public.fn_ca_guarantee_funding_variance_scan();$c$);

COMMIT;
