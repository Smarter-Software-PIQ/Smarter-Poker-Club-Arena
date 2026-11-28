-- 20261116021023_club_data_chicago_screen_reads_long_windows_in_one_pass
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-16 02:10:23 UTC.
--
-- THE CHICAGO-BASIS CLUB DATA SCREEN READS A LONG WINDOW IN ONE PASS
-- (report-only; every figure is the same to the cent).
--
-- WHERE THIS READER RUNS. ca_club_data_screen is a router (20261115034142).
-- A window that starts before the union accounting records begin
-- (2026-09-19) or before the club joined the union - every 93-day window of
-- Midway Union or its clubs, and any window reaching back into September -
-- is answered by ca_club_data_screen_chicago_basis (the reader as installed
-- before 20261115034142; basis_reason 'window_starts_before_union_basis').
--
-- WHAT WAS WRONG (production, read-only, 2026-11-15). Midway Union's 93 days
-- took ~31 s cold (9.7-11.2 s warm), KINGS CLUB's 93 days did not finish in
-- 58 s, KINGS 30 days ~6.3 s and 7 days ~4.6 s. Both run the reader's horse
-- branch (KINGS by name, the union because its clubs have horses), which
-- read the window's ca_club_data_fact_ct rows (union 93 days: 2,694,598 rows,
-- 830,490 games) through a UNION ALL of fn_ca_club_data_fact_window(...)
-- (KINGS) and ca_stats_club_data_fact_ct (everyone else), with
-- public.fn_ca_club_data_clubs(p_club_id) written inside every predicate:
--   1. the totals: count(DISTINCT game_id) over every row, planned as an
--      external merge sort to disk (125 MB) after an index scan of the whole
--      window through the primary key (1.6 M buffers: the planner could not
--      see the club list, so it never chose the 45,000-page sequential
--      scan): 24.5 s cold for the union's 93 days, the bulk of the 31 s;
--   2. the MTT / running-MTT split: a second full pass, again through the
--      primary key (1.6 M buffers, 2.8 s warm);
--   3. KINGS: fn_ca_club_data_fact_window carries SET search_path, so it is
--      never inlined - every reference materialised KINGS's whole window and
--      then re-tested each row against fn_ca_club_data_clubs(p_club_id), a
--      SECURITY DEFINER SQL function evaluated per row (the running-
--      tournament lookup alone did that once per running tournament: KINGS
--      93 days was cancelled there at 58 s);
--   4. the filtered screen for MTT grouped every tournament of the window
--      (824,297 games, spilled 178 MB) to keep 3,729 MTTs.
--
-- WHAT THIS CHANGES. ca_club_data_screen_chicago_basis is replaced (same
-- name, arguments, defaults, result, owner, grants, comment, STABLE SECURITY
-- DEFINER, search_path, work_mem 64MB; plan_cache_mode force_custom_plan is
-- added, as on the union-basis reader, so the planner sees the club list,
-- the dates and the game ids it is given). The router is untouched.
--   * the reporting clubs are read once into v_clubs; every read is of
--     public.ca_club_data_fact_ct by v_clubs and the window. Both former arms
--     are exactly those rows: since 20261115145150 (every club reads its own
--     records, horses included) fn_ca_club_data_fact_window is that very
--     query and ca_stats_club_data_fact_ct is the table as it is. The guard
--     below refuses to install if either has changed since (md5 of each as
--     installed on production);
--   * horse branch totals: ONE pass gives the cash and tournament fee and
--     winnings AND the MTT split (rows LEFT JOINed by key to the 8,255 MTT
--     tournaments; tournaments.id is the primary key, so no row is counted
--     twice; a row of no MTT is in neither split, as the inner join left
--     it); a second pass counts the distinct games as a hash over the game
--     ids (82 MB in memory), never a sort;
--   * the seated-table, running-tournament, day-loop and page-row lookups
--     read the table by (club = ANY(v_clubs), game / day) through its keys;
--   * the MTT filter groups only the MTTs (game_class is 'MTT' exactly when
--     tournament_type is 'MTT'; every other tournament was dropped after
--     the grouping). The SNG filter is left as it was (pushing it down was
--     measured slower: SNG tournaments are many).
-- The plain-screen branch for clubs without horses (ca_club_data_game_ct),
-- the candidate walk, ordering, rounding, felt, member_fees and every key of
-- the answer are as they were.
--
-- PROOF (production, 2026-11-16 ~02:30Z; the new body installed as a pg_temp
-- function in a transaction made read-only after the CREATE and rolled back;
-- the installed reader and the new one called in ONE REPEATABLE READ
-- snapshot and compared whole, md5 of (answer - 'generated_at'); warm cache):
--   Midway Union 93 days (08-15..11-15)   identical; games 830,495,
--                fee 13,948,460.88, total_winnings -12,221,190.63;
--                9.87 s -> 3.71 s (new read first: 4.09 s; ~31 s cold before)
--   Midway Union 30 days (08-27..09-25)   identical; 0.49 s -> 0.23 s
--   KINGS CLUB   30 days (08-27..09-25)   identical; 1.64 s -> 0.12 s
--                (6.3 s on an earlier, colder run)
--   KINGS CLUB    7 days (09-15..09-21)   identical; 1.38 s -> 0.22 s
--                (4.6-7.1 s on earlier runs)
--   Midway Union 93 days, game MTT        identical; games 3,729;
--                10.70 s -> 1.24 s
--   Midway Union 30 days, game SNG        identical; 0.81 s -> 0.59 s
--   KINGS CLUB   93 days (08-15..11-15)   identical (two calls); 44.2 s
--                (once cancelled at 58 s) -> 1.62 s
-- The native fixture (scripts/ci/test-club-data-reads-each-window-once.py)
-- installs production's fact view and window helper (20261115145150), renames
-- the screen as 20261115034142 does (md5 = this file's preimage), and proves
-- every probe screen (KINGS, a horse club, an ordinary club, the union, NULL
-- scope; plain, MTT, SNG, Hold'em, small stakes and a search; 2, 14 and
-- 93-day windows; limits 1, 100 and 200) the same jsonb before and after.
--
-- Not a hot-table change: one function is replaced. No index, no money,
-- ledger, rake, invoice, settlement or accounting row is read for update or
-- written. The installed text is pinned by md5 (preimage
-- c16222f69900e75fb34c23a27bc96789 on production, both search paths) and
-- refused otherwise; no installed function pins that body (0 on production).
--
-- @live-proof: md5(pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) = '05c45328e954959ce504f31437be82e5'
-- @live-proof: position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: position('fn_ca_club_data_fact_window(' IN pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0
-- @live-proof: (SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END FROM pg_proc p WHERE p.oid = 'public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure) = 'ss'
-- @live-proof: position('ca_club_data_screen_chicago_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: (public.ca_club_data_screen_chicago_basis('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-09-15', '2026-09-21', 'ALL', 'ALL', NULL, 5)->'summary'->>'games')::bigint > 0
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data reader replacement requires the maintained installer';
  END IF;
  IF to_regprocedure('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)') IS NULL
     OR to_regprocedure('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)') IS NULL
     OR position('ca_club_data_screen_chicago_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: install 20261115034142 first (the router reads ca_club_data_screen_chicago_basis)';
  END IF;
  IF position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'club data chicago screen already reads long windows in one pass';
  END IF;
  -- The two sources the reader reads today are the table as it is
  -- (20261115145150); reading the table directly is the same rows only while
  -- that holds.
  IF md5(pg_get_viewdef('public.ca_stats_club_data_fact_ct'::regclass)) <> 'f3abab6fbfaa7383b78627b97b6b9b61'
     OR md5(pg_get_functiondef('public.fn_ca_club_data_fact_window(uuid[],date,date)'::regprocedure)) <> '12c37b7a1b8ad13ea2dd5db59329ef78' THEN
    RAISE EXCEPTION 'CLUB_DATA_FACT_SOURCES_CHANGED: ca_stats_club_data_fact_ct or fn_ca_club_data_fact_window is not the 20261115145150 text';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure));
  IF v_md5 <> 'c16222f69900e75fb34c23a27bc96789' THEN
    RAISE EXCEPTION 'Club Data reader ca_club_data_screen_chicago_basis preimage changed (md5 %)', v_md5;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ca_club_data_screen_chicago_basis(p_club_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_game text DEFAULT 'ALL'::text, p_stakes text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '64MB'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'America/Chicago')::date;
  v_end date := LEAST(COALESCE(p_end, v_today), v_today);
  v_start date := COALESCE(p_start, v_end);
  v_game text := UPPER(COALESCE(NULLIF(p_game, ''), 'ALL'));
  v_stakes text := UPPER(COALESCE(NULLIF(p_stakes, ''), 'ALL'));
  v_q text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_lim int := GREATEST(LEAST(COALESCE(p_limit, 200), 500), 1);
  v_scope text := public.fn_ca_club_data_scope(p_club_id);
  v_attrs boolean;
  v_mtt_win numeric; v_mtt_fee numeric; v_run_win numeric; v_run_fee numeric;
  v_users uuid[];
  v_role text;
  v_club_name text;
  v_union uuid;
  v_facts_from date;
  v_member_fees jsonb;
  v_sum jsonb;
  v_rows jsonb;
  v_days date[];
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_games bigint; v_cash_fee numeric; v_tour_fee numeric; v_cash_win numeric; v_tour_win numeric;
  v_felt_ids uuid[]; v_felt_amt numeric[]; v_felt_seated int[]; v_felt_sum numeric;
  v_live_t uuid[]; v_cands uuid[]; v_need int; v_day date;
  v_clubs uuid[];
  v_game_ct boolean;
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  IF v_start < v_end - 92 THEN v_start := v_end - 92; END IF;
  IF v_start > v_end THEN v_start := v_end; END IF;
  -- 20261116021023: the reporting clubs are read once; every read below is
  -- by this list, so the planner sees it (and seeks or scans accordingly).
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);
  IF v_scope = 'downline' THEN
    v_users := public.fn_ca_club_data_downline(p_club_id, auth.uid());
  END IF;
  -- Tournament attributes for every game only when a filter reads them.
  v_attrs := v_game IN ('MTT', 'SNG') OR v_q IS NOT NULL;
  SELECT c.name INTO v_club_name FROM public.clubs c WHERE c.id = p_club_id;
  SELECT cm.role INTO v_role FROM public.club_members cm
   WHERE cm.club_id = p_club_id AND cm.user_id = auth.uid()
   ORDER BY public.fn_club_role_rank(cm.role) DESC LIMIT 1;
  SELECT uc.union_id INTO v_union FROM public.union_clubs uc WHERE uc.club_id = p_club_id LIMIT 1;
  IF EXISTS(SELECT 1 FROM public.unions u WHERE u.id=p_club_id) THEN v_union:=p_club_id; END IF;
  v_facts_from := public.fn_ca_club_data_facts_from();
  v_days := ARRAY(SELECT gs::date FROM generate_series(v_start, v_end, interval '1 day') gs);

  IF v_scope = 'downline' THEN
    SELECT jsonb_build_object('cash_fees', coalesce(sum(f.cash_fees),0),
      'tournament_fees', coalesce(sum(f.tournament_fees),0),
      'total_fees', coalesce(sum(f.total_fees),0), 'day_basis', 'UTC')
      INTO v_member_fees
      FROM public.ca_club_member_fee_totals(p_club_id, v_start, v_end, auth.uid()) f;
  END IF;
  IF v_game = 'ALL' AND v_stakes = 'ALL' AND v_q IS NULL THEN
    -- THE PLAIN SCREEN (20261017221938). Measured on production at 22:20 UTC,
    -- Club JAQK, 14 days: 3.79 s through the one-query form below, because
    -- the totals grouped 450,000 fact rows into 248,000 games to pick 200 of
    -- them, and the per-game player count was planned as a range scan per
    -- game. Here:
    --   * the totals are one aggregate over the window, never grouped by game;
    --   * the page's rows are chosen from the most recent days first - every
    --     fact's last_at falls on its own stat_date, so a game seen on a later
    --     day outranks every game seen only earlier, and the order is exact;
    --   * only those rows are totalled, counted and described, by exact
    --     (club, day, game) lookups.
    SELECT array_agg(x.table_id), array_agg(x.felt), array_agg(x.seated), COALESCE(SUM(x.felt), 0)
      INTO v_felt_ids, v_felt_amt, v_felt_seated, v_felt_sum
      FROM (
        -- Chips still in front of this club's seated players: part of the
        -- result, not a loss. The seat's own club, as the money was.
        SELECT s.table_id, SUM(s.stack) AS felt, count(*)::int AS seated
          FROM public.table_seats s
          JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
         WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
           AND COALESCE(s.status, 'active') <> 'left' AND COALESCE(s.stack, 0) > 0
           AND (s.joined_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_start AND v_end
           AND COALESCE(s.club_id, public.fn_ca_cash_reporting_club(t.union_id, t.club_id, s.user_id)) = ANY (v_clubs)
           AND (v_users IS NULL OR s.user_id = ANY (v_users))
         GROUP BY s.table_id) x;
    v_felt_ids := COALESCE(v_felt_ids, ARRAY[]::uuid[]);

    -- 20261022165130: without a downline filter the totals are the per-game
    -- rows' (ca_club_data_game_ct is ca_club_data_fact_ct summed over players,
    -- written by the same statement): a third of the rows, the same sums and
    -- the same games.
    v_game_ct := v_users IS NULL AND NOT (
    p_club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4'::uuid OR
    EXISTS (SELECT 1 FROM public.ca_horse_club_assignments a WHERE a.club_id=ANY(v_clubs))
  );
    IF v_game_ct THEN
    SELECT count(DISTINCT d.game_id),
           COALESCE(SUM(d.fee) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.fee) FILTER (WHERE d.kind <> 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind <> 'CASH'), 0)
      INTO v_games, v_cash_fee, v_tour_fee, v_cash_win, v_tour_win
      FROM public.ca_club_data_game_ct d
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end;
    ELSE
    -- 20261116021023: ONE pass over the window gives the cash and tournament
    -- fee and winnings AND the MTT / running-MTT split (the rows LEFT JOINed
    -- by key to the MTT tournaments: tournaments.id is the primary key, so no
    -- row is counted twice, and a row of no MTT is in neither split, as the
    -- inner join left it). The second pass counts the distinct games as a
    -- hash over the game ids, never a sort of every row to disk. Same rows as
    -- before: since 20261115145150 both fn_ca_club_data_fact_window (KINGS
    -- CLUB's arm) and ca_stats_club_data_fact_ct (everyone else's) read
    -- ca_club_data_fact_ct as it is, by club and day.
    SELECT COALESCE(SUM(d.fee) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.fee) FILTER (WHERE d.kind <> 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind <> 'CASH'), 0),
           coalesce(sum(d.winnings) FILTER (WHERE tr.id IS NOT NULL AND COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.fee) FILTER (WHERE tr.id IS NOT NULL AND COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.winnings) FILTER (WHERE tr.id IS NOT NULL AND NOT COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.fee) FILTER (WHERE tr.id IS NOT NULL AND NOT COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0)
      INTO v_cash_fee, v_tour_fee, v_cash_win, v_tour_win, v_mtt_win, v_mtt_fee, v_run_win, v_run_fee
      FROM public.ca_club_data_fact_ct d
      LEFT JOIN public.tournaments tr ON tr.id = d.game_id AND d.kind = 'TOURNAMENT' AND tr.tournament_type = 'MTT'
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users));
    SELECT count(x.game_id) INTO v_games
      FROM (SELECT d.game_id FROM public.ca_club_data_fact_ct d
             WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
               AND (v_users IS NULL OR d.user_id = ANY (v_users))
             GROUP BY d.game_id) x;
    END IF;
    -- 20261022120121: MTT Winnings are FINISHED MTTs only (tournaments.status
    -- COMPLETED or CANCELLED); every other MTT's entries and payouts so far are
    -- Running MTT Entries. Both stay inside tournament_winnings, so
    -- total = cash + tournament still holds.
    -- 20261022165130: without a downline filter, from the MTTs (6,000 in all)
    -- to their per-game rows by key, instead of every tournament row of the
    -- window to tournaments (200,000 probes a fortnight for a large club).
    IF v_game_ct THEN
    SELECT coalesce(sum(d.winnings) FILTER (WHERE COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.fee) FILTER (WHERE COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.winnings) FILTER (WHERE NOT COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0),
           coalesce(sum(d.fee) FILTER (WHERE NOT COALESCE(tr.status IN ('COMPLETED','CANCELLED'),false)),0)
      INTO v_mtt_win,v_mtt_fee,v_run_win,v_run_fee
      FROM public.tournaments tr JOIN public.ca_club_data_game_ct d ON d.game_id=tr.id AND d.kind='TOURNAMENT'
           AND d.club_id=ANY(v_clubs) AND d.stat_date BETWEEN v_start AND v_end
     WHERE tr.tournament_type='MTT';
    -- (otherwise the MTT split came with the totals' one pass above)
    END IF;
    -- A seated table with no fact in the window is still a game on the screen.
    v_games := v_games + (SELECT count(*) FROM unnest(v_felt_ids) ft(id)
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_club_data_fact_ct f
                         WHERE f.club_id = ANY (v_clubs) AND f.stat_date BETWEEN v_start AND v_end AND f.game_id = ft.id
                           AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- Running tournaments this club (or this agent's downline) played in.
    v_live_t := ARRAY(
      SELECT tr.id FROM public.tournaments tr
       WHERE tr.status = 'RUNNING'
         AND EXISTS (SELECT 1 FROM public.ca_club_data_fact_ct f
                      WHERE f.club_id = ANY (v_clubs) AND f.stat_date BETWEEN v_start AND v_end AND f.game_id = tr.id
                        AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- The page: every live game, then the most recently active, newest day first.
    v_cands := v_felt_ids || v_live_t;
    v_need := v_lim;
    FOR v_day IN SELECT u.d FROM unnest(v_days) u(d) ORDER BY u.d DESC LOOP
      v_cands := v_cands || ARRAY(
        SELECT f.game_id FROM public.ca_club_data_fact_ct f
         WHERE f.club_id = ANY (v_clubs) AND f.stat_date = v_day
           AND (v_users IS NULL OR f.user_id = ANY (v_users))
           AND NOT (f.game_id = ANY (v_cands))
         GROUP BY f.game_id ORDER BY max(f.last_at) DESC LIMIT v_need);
      v_need := v_lim - (cardinality(v_cands) - cardinality(v_felt_ids) - cardinality(v_live_t));
      EXIT WHEN v_need <= 0;
    END LOOP;

    WITH c AS (
      SELECT f.kind, f.game_id, SUM(f.fee) AS fee, SUM(f.winnings) AS winnings, max(f.last_at) AS activity_at,
             count(DISTINCT f.user_id) FILTER (WHERE f.user_id <> v_zero) AS players
        FROM public.ca_club_data_fact_ct f
       WHERE f.club_id = ANY (v_clubs) AND f.stat_date BETWEEN v_start AND v_end AND f.game_id = ANY (v_cands)
         AND (v_users IS NULL OR f.user_id = ANY (v_users))
       GROUP BY f.kind, f.game_id
    ), fe AS (
      SELECT x.table_id, x.felt, x.seated
        FROM unnest(v_felt_ids, COALESCE(v_felt_amt, ARRAY[]::numeric[]), COALESCE(v_felt_seated, ARRAY[]::int[])) AS x(table_id, felt, seated)
    ), rows_ AS (
      SELECT COALESCE(c.kind, 'CASH') AS k, COALESCE(c.game_id, fe.table_id) AS game_id,
             COALESCE(c.fee, 0) AS fee, COALESCE(c.winnings, 0) + COALESCE(fe.felt, 0) AS winnings,
             COALESCE(c.activity_at, now()) AS activity_at,
             (fe.table_id IS NOT NULL OR (c.kind = 'TOURNAMENT' AND c.game_id = ANY (v_live_t))) AS live,
             fe.seated, fe.felt AS on_felt, COALESCE(c.players, 0) AS players
        FROM c FULL JOIN fe ON fe.table_id = c.game_id
    ), top AS (
      SELECT * FROM rows_ ORDER BY live DESC, activity_at DESC NULLS LAST, k, game_id LIMIT v_lim
    ), described AS (
      SELECT CASE WHEN tp.k = 'CASH' THEN 'CASH'
                  WHEN tr.tournament_type = 'SPIN' THEN 'SPIN'
                  WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS kind,
             tp.game_id::text AS id,
             CASE WHEN tp.k = 'CASH' THEN COALESCE(t.name, 'Unnamed') ELSE COALESCE(tr.name, 'Tournament') END AS name,
             CASE WHEN tp.k = 'CASH' THEN UPPER(COALESCE(t.game_variant, 'nlh'))
                  ELSE UPPER(COALESCE(tr.variant, tr.game_type, 'nlh')) END AS variant,
             CASE WHEN tp.k = 'CASH' THEN
                    CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                         WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                         ELSE 'HOLDEM' END
                  WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class,
             CASE WHEN tp.k <> 'CASH' THEN 'NA'
                  WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                  WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                  WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
             CASE WHEN tp.k = 'CASH' AND COALESCE(t.big_blind,0) > 0 THEN
               trim(trailing '.' from trim(trailing '0' from COALESCE(t.small_blind,0)::text)) || '/' ||
               trim(trailing '.' from trim(trailing '0' from t.big_blind::text)) END AS blinds,
             CASE WHEN tp.k = 'CASH' THEN t.created_at ELSE tr.start_time END AS started_at,
             CASE WHEN tp.k = 'CASH' THEN t.status ELSE tr.status END AS status,
             CASE WHEN tp.k = 'CASH' THEN COALESCE(pr.username, '') ELSE '' END AS creator_name,
             round(tp.fee, 2) AS fee, round(tp.winnings, 2) AS winnings,
             GREATEST(tp.players, COALESCE(tp.seated, 0))::int AS players,
             tp.activity_at, tp.live, tp.seated, round(tp.on_felt, 2) AS on_felt, tp.k
        FROM top tp
        LEFT JOIN public.tables t ON tp.k = 'CASH' AND t.id = tp.game_id
        LEFT JOIN public.profiles pr ON pr.id = t.created_by
        LEFT JOIN public.tournaments tr ON tp.k = 'TOURNAMENT' AND tr.id = tp.game_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'kind', kind, 'id', id, 'name', name, 'variant', variant,
             'game_class', game_class, 'stakes_tier', stakes_tier, 'blinds', blinds,
             'started_at', started_at, 'activity_at', activity_at, 'status', status,
             'creator_name', NULLIF(creator_name, ''), 'fee', COALESCE(fee, 0),
             'winnings', COALESCE(winnings, 0), 'players', COALESCE(players, 0),
             'live', live, 'seated', seated, 'on_felt', on_felt)
             ORDER BY live DESC, activity_at DESC NULLS LAST, k, id), '[]'::jsonb)
      INTO v_rows FROM described;

    v_sum := jsonb_build_object(
      'games', v_games,
      'total_winnings', round(v_cash_win + v_tour_win + v_felt_sum, 2),
      'mtt_winnings', round(v_mtt_win, 2), 'tournament_winnings', round(v_tour_win,2),
      'running_mtt_entries', round(v_run_win, 2), 'running_mtt_fee', round(v_run_fee, 2),
      'cash_winnings', round(v_cash_win + v_felt_sum, 2),
      'fee', round(v_cash_fee + v_tour_fee, 2),
      'cash_fee', round(v_cash_fee, 2),
      'mtt_fee', round(v_mtt_fee, 2), 'tournament_fee', round(v_tour_fee,2),
      'on_felt', round(v_felt_sum, 2),
      'live_games', cardinality(v_felt_ids) + cardinality(v_live_t));

    RETURN jsonb_build_object(
      'range', jsonb_build_object('start', v_start, 'end', v_end, 'days', (v_end - v_start) + 1),
      'filters', jsonb_build_object('game', v_game, 'stakes', v_stakes, 'search', v_q),
      'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'chicago_net_money_flow', 'day_basis', 'America/Chicago', 'viewer_role', v_role, 'club_name', v_club_name, 'facts_from', v_facts_from,
      'member_fees', v_member_fees, 'summary', v_sum, 'rows', v_rows, 'row_count', (v_sum->>'games')::int,
      'union_id', v_union, 'generated_at', now());
  END IF;

  -- A FILTERED SCREEN (a game class, stakes, or a search): every game's
  -- attributes are read, as before; the players are counted for the page's
  -- rows by exact (club, day, game) lookups.

  WITH g AS MATERIALIZED (
    SELECT d.kind, d.game_id, SUM(d.fee) AS fee, SUM(d.winnings) AS winnings, max(d.last_at) AS activity_at
      FROM public.ca_club_data_fact_ct d
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users))
       AND (v_game = 'ALL'
            OR (v_game IN ('HOLDEM', 'OMAHA', 'MIXED') AND d.kind = 'CASH')
            OR (v_game IN ('MTT', 'SNG') AND d.kind = 'TOURNAMENT'))
       AND (v_stakes = 'ALL' OR d.kind = 'CASH')
       -- 20261116021023: the MTT filter keeps only the MTTs (game_class is
       -- 'MTT' exactly when tournament_type is 'MTT'), so only those few
       -- thousand games are grouped - not every tournament of the window, to
       -- be dropped after the grouping.
       AND (v_game <> 'MTT'
            OR d.game_id IN (SELECT mt.id FROM public.tournaments mt WHERE mt.tournament_type = 'MTT'))
     GROUP BY d.kind, d.game_id
  ), felt AS MATERIALIZED (
    -- Chips still in front of this club's seated players: part of the result,
    -- not a loss. The seat's own club, as the money was.
    SELECT s.table_id, SUM(s.stack) AS felt, count(*)::int AS seated
      FROM public.table_seats s
      JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
     WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
       AND COALESCE(s.status, 'active') <> 'left' AND COALESCE(s.stack, 0) > 0
       AND (s.joined_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_start AND v_end
       AND COALESCE(s.club_id, public.fn_ca_cash_reporting_club(t.union_id, t.club_id, s.user_id)) = ANY (v_clubs)
       AND (v_users IS NULL OR s.user_id = ANY (v_users))
       AND v_game IN ('ALL', 'HOLDEM', 'OMAHA', 'MIXED')
     GROUP BY s.table_id
  ), running AS MATERIALIZED (
    SELECT tr.id FROM public.tournaments tr WHERE tr.status = 'RUNNING'
  ), cash AS (
    -- Cash games are few; every one is described.
    SELECT t.id AS game_id, COALESCE(t.name, 'Unnamed') AS name,
           CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                ELSE 'HOLDEM' END AS game_class,
           CASE WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
           COALESCE(pr.username, '') AS creator_name,
           COALESCE(gg.fee, 0) AS fee,
           COALESCE(gg.winnings, 0) + COALESCE(fe.felt, 0) AS winnings,
           COALESCE(gg.activity_at, now()) AS activity_at,
           (fe.felt IS NOT NULL) AS live, fe.seated, fe.felt AS on_felt
      FROM (SELECT * FROM g WHERE g.kind = 'CASH') gg
      FULL JOIN felt fe ON fe.table_id = gg.game_id
      JOIN public.tables t ON t.id = COALESCE(gg.game_id, fe.table_id)
      LEFT JOIN public.profiles pr ON pr.id = t.created_by
  ), tour AS (
    SELECT g.game_id, g.fee, g.winnings, g.activity_at,
           (g.game_id IN (SELECT r.id FROM running r)) AS live
      FROM g WHERE g.kind = 'TOURNAMENT'
  ), tour_described AS (
    -- Read only when a filter needs it: v_attrs is a one-time filter, so the
    -- tournaments join is never executed for the plain screen.
    SELECT tu.*, COALESCE(tr.name, 'Tournament') AS name,
           CASE WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class
      FROM tour tu JOIN public.tournaments tr ON tr.id = tu.game_id
     WHERE v_attrs
  ), filtered AS (
    SELECT 'CASH'::text AS k, c.game_id, c.fee, c.winnings, c.activity_at, c.live, c.seated, c.on_felt
      FROM cash c
     WHERE (v_game = 'ALL' OR c.game_class = v_game)
       AND (v_stakes = 'ALL' OR c.stakes_tier = v_stakes)
       AND (v_q IS NULL OR c.name ILIKE '%' || v_q || '%' OR c.game_id::text ILIKE '%' || v_q || '%'
            OR c.creator_name ILIKE '%' || v_q || '%')
    UNION ALL
    SELECT 'TOURNAMENT', tu.game_id, tu.fee, tu.winnings, tu.activity_at, tu.live, NULL::int, NULL::numeric
      FROM tour tu WHERE NOT v_attrs
    UNION ALL
    SELECT 'TOURNAMENT', td.game_id, td.fee, td.winnings, td.activity_at, td.live, NULL::int, NULL::numeric
      FROM tour_described td
     WHERE v_attrs
       AND (v_game = 'ALL' OR td.game_class = v_game)
       AND (v_q IS NULL OR td.name ILIKE '%' || v_q || '%' OR td.game_id::text ILIKE '%' || v_q || '%')
  ), summary AS (
    SELECT jsonb_build_object(
      'games', count(*),
      'total_winnings', round(COALESCE(SUM(winnings), 0), 2),
      'mtt_winnings', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'running_mtt_entries', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND NOT COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'running_mtt_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND NOT COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))), 0), 2),
      'cash_winnings', round(COALESCE(SUM(winnings) FILTER (WHERE k = 'CASH'), 0), 2),
      'fee', round(COALESCE(SUM(fee), 0), 2),
      'cash_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'CASH'), 0), 2),
      'mtt_fee', round(COALESCE(SUM(fee) FILTER (WHERE k = 'TOURNAMENT' AND EXISTS(SELECT 1 FROM public.tournaments mt WHERE mt.id=filtered.game_id AND mt.tournament_type='MTT' AND COALESCE(mt.status IN ('COMPLETED','CANCELLED'),false))),0),2), 'tournament_fee',round(COALESCE(SUM(fee) FILTER(WHERE k <> 'CASH'),0),2), 'tournament_winnings',round(COALESCE(SUM(winnings) FILTER(WHERE k <> 'CASH'),0),2),
      'on_felt', round(COALESCE(SUM(on_felt), 0), 2),
      'live_games', count(*) FILTER (WHERE live)) AS s
      FROM filtered
  ), top AS MATERIALIZED (
    SELECT * FROM filtered ORDER BY live DESC, activity_at DESC NULLS LAST, k, game_id LIMIT v_lim
  ), pl AS (
    SELECT f.game_id, count(DISTINCT f.user_id) AS n
      FROM public.ca_club_data_fact_ct f
     WHERE f.club_id = ANY (v_clubs) AND f.stat_date BETWEEN v_start AND v_end
       AND f.user_id <> '00000000-0000-0000-0000-000000000000'::uuid
       AND (v_users IS NULL OR f.user_id = ANY (v_users))
       AND f.game_id IN (SELECT tp.game_id FROM top tp)
     GROUP BY f.game_id
  ), described AS (
    SELECT CASE WHEN tp.k = 'CASH' THEN 'CASH'
                WHEN tr.tournament_type = 'SPIN' THEN 'SPIN'
                WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS kind,
           tp.game_id::text AS id,
           CASE WHEN tp.k = 'CASH' THEN COALESCE(t.name, 'Unnamed') ELSE COALESCE(tr.name, 'Tournament') END AS name,
           CASE WHEN tp.k = 'CASH' THEN UPPER(COALESCE(t.game_variant, 'nlh'))
                ELSE UPPER(COALESCE(tr.variant, tr.game_type, 'nlh')) END AS variant,
           CASE WHEN tp.k = 'CASH' THEN
                  CASE WHEN COALESCE(t.game_variant,'') ILIKE '%plo%' OR COALESCE(t.game_variant,'') ILIKE '%omaha%' THEN 'OMAHA'
                       WHEN COALESCE(t.game_variant,'') ILIKE '%mixed%' OR COALESCE(t.game_mode,'') ILIKE '%mixed%' THEN 'MIXED'
                       ELSE 'HOLDEM' END
                WHEN tr.tournament_type = 'SPIN' THEN 'SPIN' WHEN tr.tournament_type = 'SNG' THEN 'SNG' WHEN tr.tournament_type='MTT' THEN 'MTT' ELSE coalesce(tr.tournament_type,'TOURNAMENT') END AS game_class,
           CASE WHEN tp.k <> 'CASH' THEN 'NA'
                WHEN COALESCE(t.big_blind,0) < 1 THEN 'MICRO'
                WHEN COALESCE(t.big_blind,0) < 5 THEN 'SMALL'
                WHEN COALESCE(t.big_blind,0) < 25 THEN 'MID' ELSE 'HIGH' END AS stakes_tier,
           CASE WHEN tp.k = 'CASH' AND COALESCE(t.big_blind,0) > 0 THEN
             trim(trailing '.' from trim(trailing '0' from COALESCE(t.small_blind,0)::text)) || '/' ||
             trim(trailing '.' from trim(trailing '0' from t.big_blind::text)) END AS blinds,
           CASE WHEN tp.k = 'CASH' THEN t.created_at ELSE tr.start_time END AS started_at,
           CASE WHEN tp.k = 'CASH' THEN t.status ELSE tr.status END AS status,
           CASE WHEN tp.k = 'CASH' THEN COALESCE(pr.username, '') ELSE '' END AS creator_name,
           round(tp.fee, 2) AS fee, round(tp.winnings, 2) AS winnings,
           GREATEST(COALESCE(pl.n, 0), COALESCE(tp.seated, 0))::int AS players,
           tp.activity_at, tp.live, tp.seated, round(tp.on_felt, 2) AS on_felt, tp.k
      FROM top tp
      LEFT JOIN public.tables t ON tp.k = 'CASH' AND t.id = tp.game_id
      LEFT JOIN public.profiles pr ON pr.id = t.created_by
      LEFT JOIN public.tournaments tr ON tp.k = 'TOURNAMENT' AND tr.id = tp.game_id
      LEFT JOIN pl ON pl.game_id = tp.game_id
  )
  SELECT (SELECT s FROM summary),
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
           'kind', kind, 'id', id, 'name', name, 'variant', variant,
           'game_class', game_class, 'stakes_tier', stakes_tier, 'blinds', blinds,
           'started_at', started_at, 'activity_at', activity_at, 'status', status,
           'creator_name', NULLIF(creator_name, ''), 'fee', COALESCE(fee, 0),
           'winnings', COALESCE(winnings, 0), 'players', COALESCE(players, 0),
           'live', live, 'seated', seated, 'on_felt', on_felt)
           ORDER BY live DESC, activity_at DESC NULLS LAST, k, id) FROM described), '[]'::jsonb)
    INTO v_sum, v_rows;

  RETURN jsonb_build_object(
    'range', jsonb_build_object('start', v_start, 'end', v_end, 'days', (v_end - v_start) + 1),
    'filters', jsonb_build_object('game', v_game, 'stakes', v_stakes, 'search', v_q),
    'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'chicago_net_money_flow', 'day_basis', 'America/Chicago',
    'viewer_role', v_role,
    'club_name', v_club_name,
    'facts_from', v_facts_from,
    'member_fees', v_member_fees, 'summary', v_sum,
    'rows', v_rows,
    'row_count', (v_sum->>'games')::int,
    'union_id', v_union,
    'generated_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;

DO $after$
DECLARE d text := pg_get_functiondef('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure);
BEGIN
  IF md5(d) <> '05c45328e954959ce504f31437be82e5' THEN
    RAISE EXCEPTION 'club data chicago screen is not the qualified text (md5 %)', md5(d);
  END IF;
  IF position('fn_ca_club_data_fact_window(' IN d) > 0
     OR position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN d) = 0
     OR position('LEFT JOIN public.tournaments tr ON tr.id = d.game_id AND d.kind = ''TOURNAMENT'' AND tr.tournament_type = ''MTT''' IN d) = 0 THEN
    RAISE EXCEPTION 'club data chicago screen was not replaced as written';
  END IF;
  IF (SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END || pg_get_userbyid(p.proowner)
        || array_to_string(p.proconfig, ',') FROM pg_proc p
       WHERE p.oid = 'public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)'::regprocedure)
     <> 'sspostgressearch_path=public,work_mem=64MB,plan_cache_mode=force_custom_plan' THEN
    RAISE EXCEPTION 'club data chicago screen lost STABLE SECURITY DEFINER, its owner or its settings';
  END IF;
  IF position('ca_club_data_screen_chicago_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'club data screen router no longer reads the chicago basis';
  END IF;
END $after$;

COMMIT;
