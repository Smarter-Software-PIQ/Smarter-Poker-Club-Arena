-- 20261116141640_club_data_accounting_days_use_pacific_midnight.sql
-- Reserved by scripts/new-migration.mjs.
-- Owner 2026-11-16: reporting days close at 23:59:59 Pacific; weeks end Sunday.
-- Chicago 02:00 differs from Pacific midnight on fall-back Sunday. For example,
-- 2026-11-01 07:30Z is November 1 in Pacific, not October 31. Weekly invoice
-- boundaries already use Pacific midnight and are preserved.
-- No wallet, payout, game or settlement is changed. Historical affected days
-- are explicitly marked not loaded until the maintained, finite accounting
-- history loader re-materializes them under the corrected source definition.
-- @live-proof: public.fn_ca_accounting_day(timestamptz '2026-11-01 07:30Z') = date '2026-11-01'
-- @live-proof: public.fn_ca_accounting_day_start(date '2026-11-01') = timestamptz '2026-11-01 07:00Z'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '10s';

CREATE OR REPLACE FUNCTION public.fn_ca_accounting_day(p_at timestamptz)
RETURNS date LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public AS $function$
  SELECT (p_at AT TIME ZONE 'America/Los_Angeles')::date;
$function$;
CREATE OR REPLACE FUNCTION public.fn_ca_accounting_day_start(p_day date)
RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public AS $function$
  SELECT p_day::timestamp AT TIME ZONE 'America/Los_Angeles';
$function$;
COMMENT ON FUNCTION public.fn_ca_accounting_day(timestamptz) IS
  'The Pacific calendar date for Club Data accounting. Every viewer uses the same midnight boundary, including daylight-saving transition days.';
COMMENT ON FUNCTION public.fn_ca_accounting_day_start(date) IS
  'Pacific midnight starting a Club Data accounting date. Monday is the union invoice week boundary.';

DO $metadata$
DECLARE signature text; body text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)',
    'public.ca_club_data_snapshot_v2_union_basis(uuid,date,date,text,text,text,integer)',
    'public.ca_club_data_player_totals_union_basis(uuid,date,date,text,text,text)',
    'public.fn_ca_club_acct_coverage(uuid,date,date)',
    'public.ca_club_data_union_weeks(uuid,date,date)'
  ] LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'Pacific reporting prerequisite missing: %', signature;
    END IF;
    body := pg_get_functiondef(to_regprocedure(signature));
    body := replace(body, $old$'America/Chicago 02:00'$old$, $new$'America/Los_Angeles 00:00'$new$);
    body := replace(body, $old$'day_boundary', '02:00'$old$, $new$'day_boundary', '00:00'$new$);
    body := replace(body, $old$'day_zone', 'America/Chicago'$old$, $new$'day_zone', 'America/Los_Angeles'$new$);
    EXECUTE body;
  END LOOP;
END $metadata$;

-- A seed receipt certifies a date boundary as well as its source inputs.
-- Invalidate only seeded days whose old boundary differs. The established
-- loader rebuilds those days; coverage already reports absent receipts as
-- incomplete, so stale history cannot be presented as certified Pacific data.
DELETE FROM public.ca_club_acct_seed_log l
 WHERE (l.acct_day::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago'
         IS DISTINCT FROM public.fn_ca_accounting_day_start(l.acct_day)
    OR ((l.acct_day + 1)::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago'
         IS DISTINCT FROM public.fn_ca_accounting_day_start(l.acct_day + 1);

DO $proof$
DECLARE d date;
BEGIN
  FOR d IN SELECT g::date FROM generate_series(date '2025-01-06', date '2028-12-25', interval '7 days') g LOOP
    IF public.fn_ca_accounting_day_start(d) IS DISTINCT FROM public.fn_union_week_start(public.fn_ca_accounting_day_start(d))
       OR public.fn_ca_accounting_day(public.fn_ca_accounting_day_start(d)) IS DISTINCT FROM d
       OR public.fn_ca_accounting_day(public.fn_ca_accounting_day_start(d) - interval '1 microsecond') IS DISTINCT FROM d - 1 THEN
      RAISE EXCEPTION 'Pacific reporting week boundary disagrees on %', d;
    END IF;
  END LOOP;
END $proof$;
COMMIT;
