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
-- the shapes they already read (the columns of ca_stats_club_data_fact_ct,
-- ca_club_data_game_ct and ca_club_data_hands_ct), and states for any window
-- whether the model holds it whole:
--
--   ca_club_acct_fact_ct    per player: fact rows UNION ALL journal rows
--                           (the columns of ca_stats_club_data_fact_ct, then hands)
--   ca_club_acct_game_ct    per game: the same rows summed over players
--   ca_club_acct_hands_ct   per table: hand rows UNION ALL hand journal rows
--   fn_ca_club_acct_fact_window(clubs, from, through)
--   fn_ca_club_acct_member_fee_totals(club, from, through, viewer): a
--     downline's fees from the same rows on the same day (replaces the
--     UTC-day member fee totals for union clubs; coordinator decision
--     2026-11-15)
--   fn_ca_club_data_union_basis(club): the club is in a union, or is one
--   fn_ca_club_acct_coverage(club, from, through): missing, failed and not
--     invoice-exact days, and whether the window reaches days no issued
--     union weekly invoice covers yet (provisional)
--
-- Nothing reads these yet; 20261115034142 routes the readers. Report-only:
-- views and functions, no table, no row written, no lock on a hot table.
--
-- @live-proof: to_regclass('public.ca_club_acct_fact_ct') IS NOT NULL
-- @live-proof: to_regprocedure('public.fn_ca_club_acct_coverage(uuid,date,date)') IS NOT NULL

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

CREATE VIEW public.ca_club_acct_game_ct AS
  SELECT x.club_id, x.stat_date, min(x.kind) AS kind, x.game_id, sum(x.fee) AS fee, sum(x.buyins) AS buyins,
         sum(x.cashouts) AS cashouts, sum(x.winnings) AS winnings, max(x.last_at) AS last_at, 0::smallint AS src
    FROM public.ca_club_acct_fact_ct x
   GROUP BY x.club_id, x.stat_date, x.game_id;
COMMENT ON VIEW public.ca_club_acct_game_ct IS
  'ca_club_acct_fact_ct summed over players per (club, accounting day, game). Columns of ca_club_data_game_ct; one row per game and day (src 0).';

CREATE VIEW public.ca_club_acct_hands_ct AS
  SELECT h.club_id, h.acct_day AS stat_date, h.table_id, h.hands, h.src
    FROM public.ca_club_acct_hands h
  UNION ALL
  SELECT j.club_id, j.acct_day, j.table_id, j.hands, 0::smallint
    FROM public.ca_club_acct_hands_journal j;
COMMENT ON VIEW public.ca_club_acct_hands_ct IS
  'Hands a club took part in per table and accounting day: ca_club_acct_hands plus ca_club_acct_hands_journal, each row once. Columns of ca_club_data_hands_ct.';

REVOKE ALL ON public.ca_club_acct_fact_ct, public.ca_club_acct_game_ct, public.ca_club_acct_hands_ct
  FROM PUBLIC, anon, authenticated, service_role;

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

REVOKE ALL ON FUNCTION public.fn_ca_club_acct_fact_window(uuid[], date, date),
  public.fn_ca_club_acct_member_fee_totals(uuid, date, date, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Which clubs read the model, and whether a window is whole.
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

-- Whether the model holds [p_from, p_through] (accounting days, inclusive)
-- whole for p_club_id's union:
--   missing_days: on or before the day the live projection was attached
--     (and not in the future) and not loaded;
--   failed_days: an unresolved failure is recorded for the day (or for no
--     named day);
--   not_invoice_exact_days: a side of a week boundary loaded from no version
--     its week's invoice could have used, or a week boundary in the window
--     the model holds no certificate for (the deferred tournament entries
--     carried across it are unknown);
--   provisional: the window reaches an accounting day no issued union weekly
--     invoice covers (the open week); provisional_from is the first such day.
CREATE FUNCTION public.fn_ca_club_acct_coverage(p_club_id uuid, p_from date, p_through date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  WITH k AS (
    SELECT public.fn_ca_club_data_union_of(p_club_id) AS union_id,
           (SELECT public.fn_ca_accounting_day(s.live_from) FROM public.ca_club_acct_state s) AS live_day,
           public.fn_ca_accounting_day(now()) AS today
  ), days AS (
    SELECT g.d::date AS d FROM generate_series(p_from, p_through, interval '1 day') g(d)
  ), missing AS (
    SELECT d.d FROM days d, k
     WHERE d.d <= k.today AND (k.live_day IS NULL OR d.d <= k.live_day)
       AND NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = d.d)
  ), failed AS (
    SELECT DISTINCT d.d FROM days d
      JOIN public.ca_club_acct_projection_failures pf
        ON pf.resolved_at IS NULL AND (pf.acct_day = d.d OR pf.acct_day IS NULL)
  ), boundaries AS (
    -- Every union week boundary from the window's first day through the
    -- day after its last, that has happened.
    SELECT public.fn_ca_accounting_day_start(d.d) AS b
      FROM (SELECT g.d::date AS d FROM generate_series(p_from, p_through + 1, interval '1 day') g(d)) d, k
     WHERE public.fn_ca_accounting_day_start(d.d) = public.fn_union_week_start(public.fn_ca_accounting_day_start(d.d))
       AND public.fn_ca_accounting_day_start(d.d) <= now()
  ), sides AS (
    SELECT public.fn_ca_accounting_day(b.b) AS d, COALESCE(g.opening_exact, false) AS exact
      FROM boundaries b CROSS JOIN k
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
    UNION ALL
    SELECT public.fn_ca_accounting_day(b.b - interval '1 microsecond'), COALESCE(g.closing_exact, false)
      FROM boundaries b CROSS JOIN k
      LEFT JOIN public.ca_club_acct_boundary_log g ON g.union_id = k.union_id AND g.boundary = b.b
  ), not_exact AS (
    SELECT DISTINCT s.d FROM sides s JOIN days d ON d.d = s.d WHERE NOT s.exact
  ), uncovered AS (
    SELECT d.d FROM days d, k
     WHERE NOT EXISTS (
       SELECT 1 FROM public.settlement_periods sp
         JOIN public.settlement_invoices si ON si.period_id = sp.id
        WHERE sp.union_id = k.union_id AND si.invoice_type = 'union_weekly_squareup' AND si.status <> 'cancelled'
          AND public.fn_ca_accounting_day_start(d.d) >= sp.start_at
          AND public.fn_ca_accounting_day_start(d.d) < sp.end_at)
  )
  SELECT jsonb_build_object(
    'complete', NOT EXISTS (SELECT 1 FROM missing) AND NOT EXISTS (SELECT 1 FROM failed)
                AND NOT EXISTS (SELECT 1 FROM not_exact),
    'missing_days', COALESCE((SELECT jsonb_agg(m.d ORDER BY m.d) FROM missing m), '[]'::jsonb),
    'failed_days', COALESCE((SELECT jsonb_agg(f.d ORDER BY f.d) FROM failed f), '[]'::jsonb),
    'not_invoice_exact_days', COALESCE((SELECT jsonb_agg(n.d ORDER BY n.d) FROM not_exact n), '[]'::jsonb),
    'provisional', EXISTS (SELECT 1 FROM uncovered),
    'provisional_from', (SELECT min(u.d) FROM uncovered u),
    'window_start', public.fn_ca_accounting_day_start(p_from),
    'window_end', public.fn_ca_accounting_day_start(p_through + 1),
    'day_boundary', '02:00', 'day_zone', 'America/Chicago',
    'source', 'ca_club_acct_fact');
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_club_data_union_of(uuid), public.fn_ca_club_data_union_basis(uuid),
  public.fn_ca_club_acct_facts_from(), public.fn_ca_club_acct_coverage(uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_ca_club_data_union_of(uuid), public.fn_ca_club_data_union_basis(uuid),
  public.fn_ca_club_acct_facts_from(), public.fn_ca_club_acct_coverage(uuid, date, date)
  TO authenticated, service_role;

COMMIT;
