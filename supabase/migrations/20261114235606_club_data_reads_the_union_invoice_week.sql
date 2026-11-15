-- 20261114235606_club_data_reads_the_union_invoice_week
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-14 23:56:06 UTC.
--
-- CLUB DATA READS THE UNION INVOICE WEEK FROM THE INVOICE (owner, 2026-11-14)
--
-- "The data page display data starts and stops at the same 2AM time that the
-- invoices are appearing as; the data on this page should match the invoices
-- 1:1."
--
-- WHAT WAS WRONG (measured on production, read-only, 2026-11-14; union
-- fade0000-0000-0000-0000-000000000001, week 2026-11-02 08:00Z to 2026-11-09
-- 08:00Z):
--
--   club                 invoice rake   page fee     invoice loss   page winnings
--   KINGS CLUB              25,854.24     1,568.03      37,160.83      -5,502.27
--   The Felt Society       455,510.12   523,814.66     473,091.31    -532,270.46
--   Deep Stack Society     452,206.43   500,175.35     562,209.57    -593,784.65
--
-- The page and the invoice are two pipelines:
--
--   1. Window. Club Data facts are keyed by the America/Chicago calendar day
--      (midnight) and the page's end date is inclusive, so "Nov 2 to Nov 9" is
--      eight midnight days. The invoice week is fn_union_week_start: Monday
--      00:00 America/Los_Angeles, which is Monday 02:00 America/Chicago on
--      every Monday of the year (both zones change clocks on a Sunday).
--   2. Club. The facts take a hand's club from the seat and the table funding
--      receipt (trg_ca_club_data_fact_rake), then the readers move every
--      horse to its CURRENT ca_horse_club_assignments club at display time
--      (20261102215504, fn_ca_club_data_fact_window). The invoice takes it
--      from the accounting record of the hand: accounting_payable_earning_sources
--      .club_id for rake, and each hand participant's earning_club_id for the
--      result. Sampled on 2026-11-05: three horse facts booked to KINGS CLUB
--      by their table funding receipt are recorded for The Felt Society and
--      Deep Stack Society in accounting_cash_rake_sources.
--   3. Definition. Page winnings are wallet cash-outs minus buy-ins plus chips
--      on the felt, tournament entries on the day they were paid. The invoice
--      is the hand-by-hand stack change for cash plus the union's tournament
--      result, which is deferred until the tournament settles. Page fee counts
--      a tournament fee when it is charged; the invoice counts it when it is
--      recognized.
--
-- The invoice basis was re-derived to the cent from its own sources:
-- sum(accounting_payable_earning_sources.rake_credit) for the week is
-- 16,469.67 + 9,384.57 = 25,854.24 (KINGS), 311,670.47 + 143,839.65 =
-- 455,510.12 (Felt) and 306,944.47 + 145,261.96 = 452,206.43 (Deep Stack);
-- smarter_private.union_eco_components holds cash/tournament player results
-- -19,148.89/-18,011.94, -371,464.54/-101,626.77 and -366,655.46/-195,554.11,
-- which sum to the three invoiced losses.
--
-- WHAT THIS CHANGES (report-only: no money, ledger, rake, invoice, settlement
-- or weekly-accounting row or rule is read for update or written)
--
--   1. public.fn_ca_accounting_day(timestamptz) and
--      public.fn_ca_accounting_day_start(date): the one Club Data accounting
--      day, 02:00 to 02:00 America/Chicago, daylight saving included. On every
--      Monday fn_ca_accounting_day_start(monday) is fn_union_week_start of
--      that instant, so a window built from these functions starts and stops
--      on the invoice's own boundary.
--   2. public.ca_club_data_union_weeks(club, start, end): for a union member
--      club (or the union), the issued union_weekly_squareup invoices whose
--      period lies inside [02:00 start, 02:00 end). The end date is the
--      boundary, not a last day: Nov 2 to Nov 9 is exactly the invoice week.
--      Fee is the invoice's rake_generated and the player result is its
--      players_won, read from the issued document itself, so the page cannot
--      disagree with the invoice: it is the same row. Nothing is recomputed,
--      nothing consults ca_horse_club_assignments. covers_window says whether
--      the invoiced weeks tile the window exactly; when they do not, open_from
--      is the first instant no issued invoice covers.
--   3. public.club_slug_history and public.ca_club_id_for_slug(text): a
--      renamed club's former slug keeps resolving. clubs.slug club-jaqk was
--      renamed to the-felt-society in production on 2026-11-14 by a direct
--      update and /clubs/club-jaqk stopped resolving; that rename is recorded
--      here. 20261114235607 (daily maintenance window) records every later
--      rename in the statement that makes it.
--
-- WHAT THIS DOES NOT DO. It does not re-key the Club Data facts to the 02:00
-- day and does not give an open week a figure on the invoice basis: the
-- invoice's cash reader (smarter_private.weekly_hand_parts_reduce) did not
-- finish one day in 70 s on production, a rake source's club can still move
-- through accounting_cash_funding_contract_admissions after the hand, and a
-- tournament result is deferred until it settles. See
-- docs/changelog/2026-11-14-club-data-reads-the-union-invoice-week.md.
--
-- No lock on a table a hand writes: two new functions, one new RPC, one new
-- table with no foreign key (a foreign key to clubs would take SHARE ROW
-- EXCLUSIVE on clubs).
--
-- @live-proof: to_regprocedure('public.ca_club_data_union_weeks(uuid,date,date)') IS NOT NULL
-- @live-proof: public.fn_ca_accounting_day_start(date '2026-11-02') = public.fn_union_week_start(timestamptz '2026-11-02 08:00:00+00')
-- @live-proof: public.fn_ca_accounting_day(timestamptz '2026-11-09 07:59:59+00') = date '2026-11-08'
-- @live-proof: to_regclass('public.club_slug_history') IS NOT NULL

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '30s';

DO $guard$ BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data migration requires the maintained installer';
  END IF;
  IF to_regprocedure('public.ca_club_data_union_weeks(uuid,date,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Club Data union invoice weeks already installed';
  END IF;
  IF to_regprocedure('public.fn_union_week_start(timestamp with time zone)') IS NULL
     OR to_regprocedure('public.ca_can_view_whole_club_report(uuid)') IS NULL
     OR to_regprocedure('public.fn_ca_club_data_clubs(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Club Data union invoice weeks prerequisite missing';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. The accounting day: 02:00 to 02:00 America/Chicago.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.fn_ca_accounting_day(p_at timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $function$
  SELECT ((p_at AT TIME ZONE 'America/Chicago') - interval '2 hours')::date;
$function$;
COMMENT ON FUNCTION public.fn_ca_accounting_day(timestamptz) IS
  'The Club Data accounting day of an instant: 02:00 to 02:00 America/Chicago, daylight saving included. Monday''s day starts at fn_union_week_start, the union weekly invoice boundary.';

CREATE FUNCTION public.fn_ca_accounting_day_start(p_day date)
RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $function$
  SELECT (p_day::timestamp + interval '2 hours') AT TIME ZONE 'America/Chicago';
$function$;
COMMENT ON FUNCTION public.fn_ca_accounting_day_start(date) IS
  'The instant a Club Data accounting day starts: 02:00 America/Chicago of that date (03:00 on the spring-forward Sunday, when 02:00 does not exist).';

REVOKE ALL ON FUNCTION public.fn_ca_accounting_day(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_ca_accounting_day_start(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_accounting_day(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_ca_accounting_day_start(date) TO authenticated, service_role;

DO $boundary$
DECLARE d date;
BEGIN
  -- Every Monday for two years either side of this migration, both clock
  -- changes included: the accounting day starts on the invoice week boundary.
  FOR d IN SELECT g::date FROM generate_series(date '2025-01-06', date '2028-12-25', interval '7 days') g LOOP
    IF public.fn_ca_accounting_day_start(d)
         IS DISTINCT FROM public.fn_union_week_start(public.fn_ca_accounting_day_start(d))
       OR public.fn_ca_accounting_day(public.fn_ca_accounting_day_start(d)) IS DISTINCT FROM d
       OR public.fn_ca_accounting_day(public.fn_ca_accounting_day_start(d) - interval '1 microsecond') IS DISTINCT FROM d - 1 THEN
      RAISE EXCEPTION 'accounting day does not start on the union week boundary on %', d;
    END IF;
  END LOOP;
END $boundary$;

-- ---------------------------------------------------------------------------
-- 2. The union invoice weeks of a Club Data window, read from the invoices.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.ca_club_data_union_weeks(p_club_id uuid, p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $function$
DECLARE
  v_from timestamptz;
  v_to timestamptz;
  v_union uuid;
  v_clubs uuid[];
  v_weeks jsonb := '[]'::jsonb;
  v_cover timestamptz;
  v_gap boolean := false;
  v_n int := 0;
  v_fee numeric := 0;
  v_loss numeric := 0;
  v_cash numeric := 0;
  v_tour numeric := 0;
  v_rakeback numeric := 0;
  v_split boolean := true;
  r record;
BEGIN
  IF NOT public.ca_can_view_whole_club_report(p_club_id) THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start OR p_end - p_start > 93 THEN
    RAISE EXCEPTION 'invalid Club Data window' USING ERRCODE = '22023';
  END IF;
  -- The end date is the boundary the window stops at, never a last day.
  v_from := public.fn_ca_accounting_day_start(p_start);
  v_to := public.fn_ca_accounting_day_start(p_end);
  v_cover := v_from;

  IF EXISTS (SELECT 1 FROM public.unions u WHERE u.id = p_club_id) THEN
    v_union := p_club_id;
  ELSE
    SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id = p_club_id LIMIT 1;
  END IF;
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);

  IF v_union IS NOT NULL THEN
    FOR r IN
      SELECT sp.start_at, sp.end_at,
             sum((si.breakdown->>'rake_generated')::numeric) AS fee,
             sum(-(si.breakdown->>'players_won')::numeric) AS loss,
             sum((si.breakdown#>>'{weekly_player_results,cash_net_loss}')::numeric) AS cash,
             sum((si.breakdown#>>'{weekly_player_results,tournament_net_loss}')::numeric) AS tour,
             sum((si.breakdown->>'rakeback_due')::numeric) AS rakeback,
             bool_and(si.breakdown ? 'weekly_player_results') AS split,
             jsonb_agg(jsonb_build_object(
               'invoice_id', si.id, 'invoice_number', si.invoice_number, 'status', si.status,
               'club_id', si.club_id, 'club_name', si.breakdown->>'club_name',
               'fee', (si.breakdown->>'rake_generated')::numeric,
               'player_net_loss', -(si.breakdown->>'players_won')::numeric,
               'cash_net_loss', (si.breakdown#>>'{weekly_player_results,cash_net_loss}')::numeric,
               'tournament_net_loss', (si.breakdown#>>'{weekly_player_results,tournament_net_loss}')::numeric,
               'rakeback_credit', (si.breakdown->>'rakeback_due')::numeric)
               ORDER BY si.breakdown->>'club_name', si.club_id) AS invoices
        FROM public.settlement_invoices si
        JOIN public.settlement_periods sp ON sp.id = si.period_id
       WHERE si.club_id = ANY (v_clubs)
         AND si.invoice_type = 'union_weekly_squareup'
         AND si.status <> 'cancelled'
         AND sp.union_id = v_union
         AND sp.start_at >= v_from AND sp.end_at <= v_to
         -- The document must state the period it is filed under.
         AND (si.breakdown->>'period_start')::timestamptz = sp.start_at
         AND (si.breakdown->>'period_end')::timestamptz = sp.end_at
         AND si.breakdown ? 'rake_generated' AND si.breakdown ? 'players_won'
       GROUP BY sp.start_at, sp.end_at
       ORDER BY sp.start_at, sp.end_at
    LOOP
      IF r.start_at = v_cover THEN v_cover := r.end_at; ELSE v_gap := true; END IF;
      v_n := v_n + 1;
      v_fee := v_fee + r.fee;
      v_loss := v_loss + r.loss;
      v_split := v_split AND r.split;
      v_cash := v_cash + COALESCE(r.cash, 0);
      v_tour := v_tour + COALESCE(r.tour, 0);
      v_rakeback := v_rakeback + r.rakeback;
      v_weeks := v_weeks || jsonb_build_object(
        'period_start', r.start_at, 'period_end', r.end_at,
        'fee', r.fee, 'player_net_loss', r.loss,
        'cash_net_loss', CASE WHEN r.split THEN r.cash END,
        'tournament_net_loss', CASE WHEN r.split THEN r.tour END,
        'rakeback_credit', r.rakeback, 'invoices', r.invoices);
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'union_id', v_union,
    'reporting_scope', CASE WHEN v_union = p_club_id THEN 'union' ELSE 'club' END,
    'day_boundary', '02:00', 'day_zone', 'America/Chicago',
    'window_start', v_from, 'window_end', v_to,
    'weeks', v_weeks, 'week_count', v_n,
    -- One or more issued invoice weeks, end to end, and nothing else.
    'covers_window', (v_n > 0 AND NOT v_gap AND v_cover = v_to),
    'open_from', CASE WHEN v_gap OR v_cover < v_to THEN v_cover END,
    'fee', CASE WHEN v_n > 0 THEN v_fee END,
    'player_net_loss', CASE WHEN v_n > 0 THEN v_loss END,
    'cash_net_loss', CASE WHEN v_n > 0 AND v_split THEN v_cash END,
    'tournament_net_loss', CASE WHEN v_n > 0 AND v_split THEN v_tour END,
    'rakeback_credit', CASE WHEN v_n > 0 THEN v_rakeback END,
    'source', 'settlement_invoices.union_weekly_squareup',
    'generated_at', now());
END;
$function$;
COMMENT ON FUNCTION public.ca_club_data_union_weeks(uuid, date, date) IS
  'Club Data: the issued union weekly invoices inside [02:00 America/Chicago of p_start, 02:00 of p_end). Fee is the invoice rake_generated and the player result its players_won, read from the issued settlement_invoices row, never recomputed and never re-attributed.';
REVOKE ALL ON FUNCTION public.ca_club_data_union_weeks(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_club_data_union_weeks(uuid, date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A renamed club's former slug keeps resolving.
-- ---------------------------------------------------------------------------
CREATE TABLE public.club_slug_history (
  former_slug text PRIMARY KEY CHECK (former_slug <> ''),
  club_id     uuid NOT NULL,
  renamed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX club_slug_history_club_idx ON public.club_slug_history (club_id);
ALTER TABLE public.club_slug_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_slug_history FROM PUBLIC, anon, authenticated, service_role;
-- A former slug names a club exactly as its current slug does, so a signed-in
-- caller may read the row the same way it reads clubs.slug. The client
-- resolver reads it as a table: an RPC there would add a function call to
-- every route that resolves a club and shift every caller's own RPC sequence.
-- Nobody but the rename trigger (owner rights) writes it.
GRANT SELECT ON public.club_slug_history TO authenticated, service_role;
CREATE POLICY club_slug_history_signed_in_read ON public.club_slug_history
  FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.club_slug_history IS
  'Former clubs.slug values and the club that held them, written by trg_club_slug_keeps_its_history in the statement that renames the club. Read-only to signed-in callers; ca_club_id_for_slug answers current-or-former in one call. A slug a club currently holds is never listed here.';

CREATE FUNCTION public.ca_club_id_for_slug(p_slug text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $function$
  -- The club that holds the slug now, else the club that used to.
  SELECT COALESCE(
    (SELECT c.id FROM public.clubs c WHERE c.slug = p_slug LIMIT 1),
    (SELECT h.club_id FROM public.club_slug_history h
       JOIN public.clubs c ON c.id = h.club_id
      WHERE h.former_slug = p_slug));
$function$;
COMMENT ON FUNCTION public.ca_club_id_for_slug(text) IS
  'The id of the club a slug names: the current holder, else the club that formerly held it (club_slug_history).';
REVOKE ALL ON FUNCTION public.ca_club_id_for_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_club_id_for_slug(text) TO authenticated, service_role;

-- The 2026-11-14 production rename, recorded only where it happened.
INSERT INTO public.club_slug_history (former_slug, club_id, renamed_at)
SELECT 'club-jaqk', c.id, timestamptz '2026-11-14 00:00:00+00'
  FROM public.clubs c
 WHERE c.id = 'a0000000-0000-0000-0000-000000000001'::uuid
   AND c.slug = 'the-felt-society'
   AND NOT EXISTS (SELECT 1 FROM public.clubs x WHERE x.slug = 'club-jaqk');

COMMIT;
