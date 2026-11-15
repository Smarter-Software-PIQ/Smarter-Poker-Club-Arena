-- 20261115034141_club_data_accounting_reader_views
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15.
--
-- THE CLUB DATA READERS' VIEW OF THE ACCOUNTING READ MODEL (stage 2, part a;
-- owner, 2026-11-14: "The Club Data page must match the union weekly
-- invoices 1:1, starting and stopping at the same 2 AM boundary the invoices
-- use.")
--
-- 20261115020010 keeps the union invoice's accounting records per club,
-- 02:00 America/Chicago accounting day, game and player, written by three
-- writers and one journal: the live projection (src 0, aggregate rows), its
-- insert-only journal (src 0, rows another open transaction's lock kept off
-- the aggregate), the day load (src 1) and the week-boundary loader (src 2).
-- Every figure a Club Data reader shows for a union club is the sum of all
-- four, each row exactly once. This migration gives the readers that sum in
-- the shapes they already read, and says which windows a club reads on it:
--
--   ca_club_acct_fact_ct    per player: fact rows UNION ALL journal rows
--                           (the columns of ca_stats_club_data_fact_ct, then
--                           hands). The readers' per-game reads (sums,
--                           EXISTS, max) read it directly: no per-game view
--                           is grouped on a hot path.
--   ca_club_acct_hands_ct   per table: raked-hand rows UNION ALL journal rows
--   fn_ca_club_acct_fact_window(clubs, from, through)
--   fn_ca_club_acct_member_fee_totals(club, from, through, viewer): a
--     downline's fees from the same rows on the same day (replaces the
--     viewer's own UTC-day earned fees for union clubs; coordinator decision
--     2026-11-15)
--   fn_ca_club_data_union_basis(club): the club is in a union, or is one
--   fn_ca_club_data_reads_union_basis(club, start, end): the WINDOW is read on
--     the union basis: the club is a union, or in one, and the window starts
--     on or after the accounting day the club joined its union and on or
--     after the first day the model holds. A window that starts earlier
--     reads the Chicago basis exactly as before (review B1: Deep Stack
--     Society joined 2026-10-12 and played 124,169 games before that, which
--     the union basis does not hold)
--   fn_ca_club_acct_coverage(club, from, through): missing, failed and not
--     invoice-exact days, and provisional = the window reaches the open week
--     after the union's last issued weekly invoice
--
-- It also closes one gap of 20261115020010: a projection failure whose day
-- could not be read was recorded with no day, and the reader then reported
-- every window of every union incomplete. fn_ca_club_acct_fail now records
-- the accounting day it failed on when its source gives none, and a legacy
-- row with no day is given the day it failed on, which the next load of that
-- day resolves. Failures are scoped to their union where the record names
-- one (a week boundary's key does).
--
-- Nothing reads these yet; 20261115034142 routes the readers. No lock on a
-- hot table: views and functions, and the failure log of this feature.
--
-- @live-proof: to_regclass('public.ca_club_acct_fact_ct') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_coverage(uuid,date,date)') IS NOT NULL
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.ca_club_acct_projection_failures WHERE acct_day IS NULL)

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$ BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data accounting reader views require the maintained installer';
  END IF;
  IF to_regclass('public.ca_club_acct_fact_ct') IS NOT NULL THEN
    RAISE EXCEPTION 'club data accounting reader views already installed';
  END IF;
  IF to_regclass('public.ca_club_acct_fact_journal') IS NULL OR to_regclass('public.ca_club_acct_hands_journal') IS NULL
     OR to_regclass('public.ca_club_acct_boundary_log') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_fail(text,date,text,text)') IS NULL
     OR to_regprocedure('public.fn_ca_club_data_clubs(uuid)') IS NULL
     OR to_regprocedure('public.fn_ca_club_data_downline(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'club data accounting reader views prerequisite missing (20261115020010)';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------
-- 1. Every row once.
-- ---------------------------------------------------------------------------
CREATE VIEW public.ca_club_acct_fact_ct AS
  SELECT f.club_id, f.acct_day AS stat_date, f.kind, f.game_id, f.user_id, f.fee, f.buyins, f.cashouts,
         f.result AS winnings, f.last_at, f.src, f.hands
    FROM public.ca_club_acct_fact f
  UNION ALL
  SELECT j.club_id, j.acct_day, j.kind, j.game_id, j.user_id, j.fee, j.buyins, j.cashouts,
         j.result, j.last_at, 0::smallint, j.hands
    FROM public.ca_club_acct_fact_journal j;
COMMENT ON VIEW public.ca_club_acct_fact_ct IS
  'Club Data per-player facts on the union invoice''s accounting records: ca_club_acct_fact (live src 0, day load src 1, week boundaries src 2) plus ca_club_acct_fact_journal (src 0), each row once. stat_date is the 02:00 America/Chicago accounting day; winnings is the accounting player result. The columns of ca_stats_club_data_fact_ct, then hands (cash hands the player took part in).';

CREATE VIEW public.ca_club_acct_hands_ct AS
  SELECT h.club_id, h.acct_day AS stat_date, h.table_id, h.hands, h.src
    FROM public.ca_club_acct_hands h
  UNION ALL
  SELECT j.club_id, j.acct_day, j.table_id, j.hands, 0::smallint
    FROM public.ca_club_acct_hands_journal j;
COMMENT ON VIEW public.ca_club_acct_hands_ct IS
  'Raked hands a club took part in per table and accounting day: ca_club_acct_hands plus ca_club_acct_hands_journal, each row once. Columns of ca_club_data_hands_ct.';

REVOKE ALL ON public.ca_club_acct_fact_ct, public.ca_club_acct_hands_ct FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.fn_ca_club_acct_fact_window(p_clubs uuid[], p_from date, p_through date)
RETURNS SETOF public.ca_club_acct_fact_ct LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT r.* FROM public.ca_club_acct_fact_ct r
   WHERE r.club_id = ANY (p_clubs) AND r.stat_date BETWEEN p_from AND p_through;
$function$;

-- A downline's fees from the same records, on the same day, as the screen's
-- totals (the union-basis counterpart of ca_club_member_fee_totals).
CREATE FUNCTION public.fn_ca_club_acct_member_fee_totals(p_club_id uuid, p_from date, p_through date, p_viewer uuid)
RETURNS TABLE(user_id uuid, cash_fees numeric, tournament_fees numeric, total_fees numeric)
LANGUAGE sql STABLE SET search_path = public AS $function$
  SELECT f.user_id,
         COALESCE(sum(f.fee) FILTER (WHERE f.kind = 'CASH'), 0),
         COALESCE(sum(f.fee) FILTER (WHERE f.kind = 'TOURNAMENT'), 0),
         COALESCE(sum(f.fee), 0)
    FROM public.ca_club_acct_fact_ct f
   WHERE f.club_id = ANY (public.fn_ca_club_data_clubs(p_club_id))
     AND f.stat_date BETWEEN p_from AND p_through
     AND f.user_id = ANY (public.fn_ca_club_data_downline(p_club_id, p_viewer))
   GROUP BY f.user_id;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Which clubs and windows read the model, and whether a window is whole.
-- ---------------------------------------------------------------------------
-- The union a club reads under: its union, or itself when it is a union (the
-- union's own house club). NULL for a club in no union.
CREATE FUNCTION public.fn_ca_club_data_union_of(p_club_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE((SELECT u.id FROM public.unions u WHERE u.id = p_club_id),
                  (SELECT uc.union_id FROM public.union_clubs uc WHERE uc.club_id = p_club_id ORDER BY uc.union_id LIMIT 1));
$function$;

CREATE FUNCTION public.fn_ca_club_data_union_basis(p_club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT public.fn_ca_club_data_union_of(p_club_id) IS NOT NULL;
$function$;

-- The first accounting day the model holds.
CREATE FUNCTION public.fn_ca_club_acct_facts_from()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE((SELECT min(l.acct_day) FROM public.ca_club_acct_seed_log l),
                  (SELECT public.fn_ca_accounting_day(s.live_from) + 1 FROM public.ca_club_acct_state s));
$function$;

-- The first accounting day a club reads on the union basis: the later of the
-- day it joined its union and the first day the model holds (a union itself:
-- the first day the model holds). NULL for a club in no union.
CREATE FUNCTION public.fn_ca_club_data_union_basis_from(p_club_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.unions u WHERE u.id = p_club_id) THEN public.fn_ca_club_acct_facts_from()
    -- No union_clubs row: NULL (GREATEST would otherwise ignore the missing
    -- join day and route a club in no union to the union basis).
    ELSE (SELECT CASE WHEN count(*) = 0 THEN NULL
                      ELSE GREATEST(min(public.fn_ca_accounting_day(uc.joined_at)), public.fn_ca_club_acct_facts_from()) END
            FROM public.union_clubs uc WHERE uc.club_id = p_club_id)
  END;
$function$;

-- Whether a reader's window is read on the union basis. p_start NULL is the
-- readers' widest default window (the last 14 days ending at p_end or today).
CREATE FUNCTION public.fn_ca_club_data_reads_union_basis(p_club_id uuid, p_start date, p_end date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE(
    COALESCE(p_start, LEAST(COALESCE(p_end, public.fn_ca_accounting_day(now())), public.fn_ca_accounting_day(now())) - 13)
      >= public.fn_ca_club_data_union_basis_from(p_club_id),
    false);
$function$;

-- Whether the model holds [p_from, p_through] (accounting days, inclusive)
-- whole for p_club_id's union:
--   missing_days: on or before the day the live projection was attached
--     (and not in the future) and not loaded;
--   failed_days: an unresolved failure is recorded for the day (a week
--     boundary's failure only for its own union);
--   not_invoice_exact_days: a side of a week boundary loaded from no version
--     its week's invoice could have used, or a week boundary in the window
--     the model holds no certificate for (the deferred tournament entries
--     carried across it are unknown), except a side still awaiting its
--     certificate before its week's invoice exists (awaiting_boundary_days:
--     provisional, not incomplete);
--   provisional: the window reaches the open week, after the end of the
--     union's last issued weekly invoice (a week before the union's first
--     invoice is not provisional); provisional_from is its first day.
CREATE FUNCTION public.fn_ca_club_acct_coverage(p_club_id uuid, p_from date, p_through date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH k AS (
    SELECT public.fn_ca_club_data_union_of(p_club_id) AS union_id,
           (SELECT public.fn_ca_accounting_day(s.live_from) FROM public.ca_club_acct_state s) AS live_day,
           public.fn_ca_accounting_day(now()) AS today
  ), invoiced AS (
    SELECT max(sp.end_at) AS through_at
      FROM k JOIN public.settlement_periods sp ON sp.union_id = k.union_id
      JOIN public.settlement_invoices si ON si.period_id = sp.id
     WHERE si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled'
  ), days AS (
    SELECT g.d::date AS d FROM generate_series(p_from, p_through, interval '1 day') g(d)
  ), missing AS (
    SELECT d.d FROM days d, k
     WHERE d.d <= k.today AND (k.live_day IS NULL OR d.d <= k.live_day)
       AND NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = d.d)
  ), failed AS (
    SELECT DISTINCT d.d FROM days d CROSS JOIN k
      JOIN public.ca_club_acct_projection_failures pf
        ON pf.resolved_at IS NULL AND pf.acct_day = d.d
       AND (pf.source NOT LIKE 'pnl_boundary%' OR split_part(COALESCE(pf.source_key, ''), ':', 1) = k.union_id::text)
  ), boundaries AS (
    -- Every union week boundary from the window's first day through the
    -- day after its last, that has happened.
    SELECT public.fn_ca_accounting_day_start(d.d) AS b
      FROM (SELECT g.d::date AS d FROM generate_series(p_from, p_through + 1, interval '1 day') g(d)) d, k
     WHERE public.fn_ca_accounting_day_start(d.d) = public.fn_union_week_start(public.fn_ca_accounting_day_start(d.d))
       AND public.fn_ca_accounting_day_start(d.d) <= now()
  ), sides AS (
    -- awaiting: no certificate of the boundary is kept yet and the side's
    -- week has no issued invoice (certificates arrive a day or two after
    -- the boundary): provisional, not incomplete (audit G4).
    SELECT public.fn_ca_accounting_day(b.b) AS d, COALESCE(g.opening_exact, false) AS exact,
           (g.union_id IS NULL AND (i.through_at IS NULL OR b.b >= i.through_at)) AS awaiting
      FROM boundaries b CROSS JOIN k CROSS JOIN invoiced i
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
    UNION ALL
    SELECT public.fn_ca_accounting_day(b.b - interval '1 microsecond'), COALESCE(g.closing_exact, false),
           (g.union_id IS NULL AND (i.through_at IS NULL OR b.b > i.through_at))
      FROM boundaries b CROSS JOIN k CROSS JOIN invoiced i
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
  ), not_exact AS (
    SELECT DISTINCT s.d FROM sides s JOIN days d ON d.d = s.d WHERE NOT s.exact AND NOT s.awaiting
  ), awaiting AS (
    SELECT DISTINCT s.d FROM sides s JOIN days d ON d.d = s.d WHERE NOT s.exact AND s.awaiting
  ), uncovered AS (
    SELECT d.d FROM days d, invoiced i
     WHERE i.through_at IS NULL OR public.fn_ca_accounting_day_start(d.d) >= i.through_at
  )
  SELECT jsonb_build_object(
    'complete', NOT EXISTS (SELECT 1 FROM missing) AND NOT EXISTS (SELECT 1 FROM failed)
                AND NOT EXISTS (SELECT 1 FROM not_exact),
    'missing_days', COALESCE((SELECT jsonb_agg(m.d ORDER BY m.d) FROM missing m), '[]'::jsonb),
    'failed_days', COALESCE((SELECT jsonb_agg(f.d ORDER BY f.d) FROM failed f), '[]'::jsonb),
    'not_invoice_exact_days', COALESCE((SELECT jsonb_agg(n.d ORDER BY n.d) FROM not_exact n), '[]'::jsonb),
    'awaiting_boundary_days', COALESCE((SELECT jsonb_agg(a.d ORDER BY a.d) FROM awaiting a), '[]'::jsonb),
    'provisional', EXISTS (SELECT 1 FROM uncovered),
    'provisional_from', (SELECT min(u.d) FROM uncovered u),
    'window_start', public.fn_ca_accounting_day_start(p_from),
    'window_end', public.fn_ca_accounting_day_start(p_through + 1),
    'day_boundary', '02:00', 'day_zone', 'America/Chicago',
    'source', 'ca_club_acct_fact');
$function$;

-- Every helper is called only by the SECURITY DEFINER readers (owner
-- postgres); nobody else needs to run them.
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_fact_window(uuid[], date, date),
  public.fn_ca_club_acct_member_fee_totals(uuid, date, date, uuid),
  public.fn_ca_club_data_union_of(uuid), public.fn_ca_club_data_union_basis(uuid),
  public.fn_ca_club_acct_facts_from(), public.fn_ca_club_data_union_basis_from(uuid),
  public.fn_ca_club_data_reads_union_basis(uuid, date, date), public.fn_ca_club_acct_coverage(uuid, date, date)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A failure always carries a day.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_ca_club_acct_fail(p_source text, p_day date, p_detail text, p_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  -- A source whose own day could not be read fails on the accounting day it
  -- failed on; a NULL day would mark every window of every union incomplete.
  INSERT INTO public.ca_club_acct_projection_failures (source, source_key, acct_day, detail)
  VALUES (p_source, p_key, COALESCE(p_day, public.fn_ca_accounting_day(clock_timestamp())),
          CASE WHEN p_day IS NULL THEN p_detail || ' (no source day; recorded on the day it failed)' ELSE p_detail END);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'club data accounting: % failure for % could not be recorded: % % (%)', p_source, p_day, SQLSTATE, SQLERRM, p_detail;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_club_acct_fail(text, date, text, text) FROM PUBLIC, anon, authenticated, service_role;

UPDATE public.ca_club_acct_projection_failures
   SET acct_day = public.fn_ca_accounting_day(failed_at),
       detail = detail || ' (no source day; given the day it failed on by 20261115034141)'
 WHERE acct_day IS NULL;

COMMIT;
