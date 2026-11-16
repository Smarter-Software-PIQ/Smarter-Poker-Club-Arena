-- 20261115164547_club_data_union_screen_reads_the_window_twice_not_six_times
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 16:45:47 UTC.
--
-- THE CLUB DATA SCREEN ON THE UNION BASIS READS ITS WINDOW TWICE, NOT SIX
-- TIMES (report-only; the figures are the same to the cent).
--
-- WHAT WAS WRONG (measured on production 2026-11-15, read-only). The Club
-- Data screen for a union club or the union (ca_club_data_screen ->
-- ca_club_data_screen_union_basis, 20261115034142) timed out for long
-- windows: Midway Union 7 days 1.3 s, 30 days 7.5 s, KINGS CLUB 30 days 15 s
-- (38 s under load), the union's 93 days 61 s - past the page's budget, so the
-- 93-day screen never arrived. The union's 93-day window is 2,326,577 rows
-- of ca_club_acct_fact (every union club's every player's every game-day;
-- 695,000 distinct games), and the plain screen read every one of them SIX
-- times over:
--
--   1. the totals: count(DISTINCT game_id) over the per-player rows planned
--      as an external merge sort of 2.3 M rows to disk (107 MB; 7.0 s alone);
--   2. the MTT / running-MTT split: a second pass over the window joined to
--      tournaments;
--   3. the seated tables with no fact in the window (NOT EXISTS), 4. the
--      running tournaments the club played in (EXISTS), 5. the day loop that
--      picks the page's games, and 6. the page's own per-game sums: each
--      written over a UNION ALL of fn_ca_club_acct_fact_window(...) and
--      ca_club_acct_fact_ct behind `p_club_id IS [NOT] DISTINCT FROM <KINGS>`
--      (inherited from the Chicago-basis reader's horse routing, 20261106074830,
--      which the accounting model made redundant: both arms are the same
--      rows), with public.fn_ca_club_data_clubs(p_club_id) re-evaluated
--      inside every predicate; the planner could not see the club list or the
--      key, so a lookup that should seek the primary key (club, day, game)
--      became another scan of the window (the page's sums alone: 4.8 s).
--
-- WHAT THIS CHANGES. ca_club_data_screen_union_basis is replaced (same name,
-- arguments, defaults, result, grants, STABLE SECURITY DEFINER, search_path,
-- work_mem). The router ca_club_data_screen is untouched and still sends a
-- union club or the union here (fn_ca_club_data_reads_union_basis). Inside:
--
--   * the reporting clubs are read once into v_clubs; every read is of
--     public.ca_club_acct_fact_ct by v_clubs and the window (the
--     fn_ca_club_acct_fact_window arm was that very query: same rows);
--   * pass 1: one aggregate over the window gives the cash and tournament
--     fee and winnings AND the MTT split, the rows LEFT JOINed by key to the
--     8,205 MTT tournaments (hash join; tournaments.id is the primary key,
--     so no row is counted twice; a row of no MTT is in neither split, as
--     before);
--   * pass 2: the number of distinct games is a hash over the game ids
--     (GROUP BY game_id, counted), never a sort;
--   * the seated-table, running-tournament and page-row lookups seek the
--     primary key by (club = ANY(v_clubs), day = ANY(v_days), game = ANY(...));
--   * plan_cache_mode = force_custom_plan, so the planner always sees the
--     club list, the dates and the game ids it is given (a generic plan for
--     "club = ANY($1) AND day BETWEEN $2 AND $3" guesses 0.5% of the table);
--   * the filtered screen (a game class, stakes or a search) reads the same
--     view through v_clubs; its shape is otherwise unchanged.
--
-- The page's candidate walk (newest day first, every fact's last_at on its
-- own stat_date), the ordering, the rounding, the felt (on_felt, live,
-- seated), the coverage, the member_fees and every key of the answer are as
-- they were.
--
-- PROOF THE FIGURES ARE UNCHANGED (production, one REPEATABLE READ snapshot,
-- 2026-11-15 ~17:00Z, the new body installed as a pg_temp function and rolled
-- back; the installed function and the new one compared whole, minus
-- generated_at):
--   Midway Union  7 days (11-09..11-15): identical; games 5,600, fee 788,735.80,
--                 total_winnings -991,272.00; 0.43 s -> 0.23 s
--   Midway Union 30 days (10-17..11-15): identical; games 315,312,
--                 fee 6,688,601.05, total_winnings -7,445,345.07; 3.45 s -> 1.69 s
--   KINGS CLUB   30 days (10-17..11-15): identical; games 142,144,
--                 fee 1,520,279.67, total_winnings -1,648,783.03; 38.1 s -> 0.44 s
--   Midway Union 93 days (08-15..11-15): identical; games 695,258,
--                 fee 12,152,340.55, total_winnings -13,072,823.66,
--                 mtt_winnings -128,546.32; 6.7 s (61 s cold) -> 3.5 s
--   (stage times of the new 93-day read: pass 1 1.5 s, pass 2 1.3 s, page
--   rows 0.25 s, felt 0.02 s, seated/running lookups 0.01 s, loop 0.02 s)
-- A reader comparison across two statements of a READ COMMITTED transaction
-- differs by the live day's new facts (the projection writes as the tables
-- deal); the comparison above holds one snapshot.
--
-- Not a hot-table change: one function is replaced. No money, ledger, rake,
-- invoice, settlement or accounting row is read for update or written. The
-- installed text is pinned by md5 (preimage) and refused if it is not the
-- 20261115034142 copy as installed; CI's stale-pin check finds no installed
-- function pinning the old body (verified: 0 on production).
--
-- @live-proof: position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: position('fn_ca_club_acct_fact_window' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0
-- @live-proof: position('ca_club_data_screen_union_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: (public.ca_club_data_screen('fade0000-0000-0000-0000-000000000001', public.fn_ca_accounting_day(now()) - 1, public.fn_ca_accounting_day(now()) - 1, 'ALL', 'ALL', NULL, 5)->>'accounting_basis') = 'union_invoice_accounting'
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data reader replacement requires the maintained installer';
  END IF;
  IF to_regprocedure('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)') IS NULL
     OR to_regprocedure('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)') IS NULL
     OR position('ca_club_data_screen_union_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: install 20261115034142 first';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure));
  IF position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'club data union screen already reads the window twice';
  END IF;
  IF v_md5 <> '19cdb05ef2048d4e0ef7bb4a1c56cbea' THEN
    RAISE EXCEPTION 'Club Data reader ca_club_data_screen_union_basis preimage changed (md5 %)', v_md5;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ca_club_data_screen_union_basis(p_club_id uuid, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date, p_game text DEFAULT 'ALL'::text, p_stakes text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET work_mem TO '64MB'
 SET plan_cache_mode TO 'force_custom_plan'
AS $function$
DECLARE
  v_today date := public.fn_ca_accounting_day(now());
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
  v_clubs uuid[];
  v_zero constant uuid := '00000000-0000-0000-0000-000000000000';
  v_games bigint; v_cash_fee numeric; v_tour_fee numeric; v_cash_win numeric; v_tour_win numeric;
  v_felt_ids uuid[]; v_felt_amt numeric[]; v_felt_seated int[]; v_felt_sum numeric;
  v_live_t uuid[]; v_cands uuid[]; v_need int; v_day date;
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  IF v_start < v_end - 92 THEN v_start := v_end - 92; END IF;
  IF v_start > v_end THEN v_start := v_end; END IF;
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
  v_facts_from := public.fn_ca_club_acct_facts_from();
  v_days := ARRAY(SELECT gs::date FROM generate_series(v_start, v_end, interval '1 day') gs);
  -- 20261115164547: the reporting clubs once, as a value the planner sees.
  -- Every read below is of the accounting records (ca_club_acct_fact_ct) by
  -- these clubs and this window; KINGS CLUB and the horse clubs read the same
  -- rows the same way (the KINGS CLUB window-function arm was that very query).
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);

  IF v_scope = 'downline' THEN
    SELECT jsonb_build_object('cash_fees', coalesce(sum(f.cash_fees),0),
      'tournament_fees', coalesce(sum(f.tournament_fees),0),
      'total_fees', coalesce(sum(f.total_fees),0), 'day_basis', 'America/Chicago 02:00', 'definition', 'downline_accounting_fees', 'source', 'ca_club_acct_fact')
      INTO v_member_fees
      FROM public.fn_ca_club_acct_member_fee_totals(p_club_id, v_start, v_end, auth.uid()) f;
  END IF;
  IF v_game = 'ALL' AND v_stakes = 'ALL' AND v_q IS NULL THEN
    -- THE PLAIN SCREEN (20261017221938; 20261115164547). The union's 93-day
    -- window is 2.3 million accounting rows. Measured on production
    -- 2026-11-15 (read-only): the screen read them six times over - the
    -- totals (a 2.3M-row external sort for count(DISTINCT game_id), 7 s),
    -- the MTT split (a second pass, joined to tournaments), and the page's
    -- rows, the seated tables and the running tournaments each by a scan of
    -- the window - 61 s in all for the union, 15 s for KINGS CLUB over 30
    -- days. Here the window is read twice, both passes hash-based and
    -- sort-free:
    --   * pass 1: every total and the MTT split in one aggregate over the
    --     rows (the MTTs joined by key, 8,205 in all);
    --   * pass 2: the number of distinct games (a hash over the game ids);
    --   * the page's rows are chosen from the most recent days first - every
    --     fact's last_at falls on its own stat_date, so a game seen on a later
    --     day outranks every game seen only earlier, and the order is exact;
    --   * only those rows are totalled, counted and described, and a seated
    --     table or a running tournament is looked up, by exact
    --     (club, day, game) keys of ca_club_acct_fact's primary key.
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
           AND public.fn_ca_accounting_day(s.joined_at) BETWEEN v_start AND v_end
           AND COALESCE(s.club_id, public.fn_ca_cash_reporting_club(t.union_id, t.club_id, s.user_id)) = ANY (v_clubs)
           AND (v_users IS NULL OR s.user_id = ANY (v_users))
         GROUP BY s.table_id) x;
    v_felt_ids := COALESCE(v_felt_ids, ARRAY[]::uuid[]);

    -- Pass 1: the totals by kind, and (20261022120121) MTT Winnings as
    -- FINISHED MTTs only (tournaments.status COMPLETED or CANCELLED); every
    -- other MTT's entries and payouts so far are Running MTT Entries. Both
    -- stay inside tournament_winnings, so total = cash + tournament still
    -- holds. A row joins its MTT by key (tournaments.id is the primary key,
    -- so no row is counted twice); a row of no MTT is in neither split.
    SELECT COALESCE(SUM(d.fee) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.fee) FILTER (WHERE d.kind <> 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind = 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE d.kind <> 'CASH'), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE mt.finished), 0),
           COALESCE(SUM(d.fee) FILTER (WHERE mt.finished), 0),
           COALESCE(SUM(d.winnings) FILTER (WHERE NOT mt.finished), 0),
           COALESCE(SUM(d.fee) FILTER (WHERE NOT mt.finished), 0)
      INTO v_cash_fee, v_tour_fee, v_cash_win, v_tour_win, v_mtt_win, v_mtt_fee, v_run_win, v_run_fee
      FROM public.ca_club_acct_fact_ct d
      LEFT JOIN (SELECT tr.id, COALESCE(tr.status IN ('COMPLETED','CANCELLED'), false) AS finished
                   FROM public.tournaments tr WHERE tr.tournament_type = 'MTT') mt
        ON d.kind = 'TOURNAMENT' AND mt.id = d.game_id
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users));

    -- Pass 2: the games of the window, each once, however many clubs, days
    -- and players saw it (a hash over the game ids; never a sort).
    SELECT count(*) INTO v_games
      FROM (SELECT d.game_id FROM public.ca_club_acct_fact_ct d
             WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
               AND (v_users IS NULL OR d.user_id = ANY (v_users))
             GROUP BY d.game_id) g;

    -- A seated table with no fact in the window is still a game on the screen.
    v_games := v_games + (SELECT count(*) FROM unnest(v_felt_ids) ft(id)
      WHERE NOT EXISTS (SELECT 1 FROM public.ca_club_acct_fact_ct f
                         WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = ft.id
                           AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- Running tournaments this club (or this agent's downline) played in.
    v_live_t := ARRAY(
      SELECT tr.id FROM public.tournaments tr
       WHERE tr.status = 'RUNNING'
         AND EXISTS (SELECT 1 FROM public.ca_club_acct_fact_ct f
                      WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = tr.id
                        AND (v_users IS NULL OR f.user_id = ANY (v_users))));

    -- The page: every live game, then the most recently active, newest day first.
    v_cands := v_felt_ids || v_live_t;
    v_need := v_lim;
    FOR v_day IN SELECT u.d FROM unnest(v_days) u(d) ORDER BY u.d DESC LOOP
      v_cands := v_cands || ARRAY(
        SELECT f.game_id FROM public.ca_club_acct_fact_ct f
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
        FROM public.ca_club_acct_fact_ct f
       WHERE f.club_id = ANY (v_clubs) AND f.stat_date = ANY (v_days) AND f.game_id = ANY (v_cands)
         AND (v_users IS NULL OR f.user_id = ANY (v_users))
       GROUP BY f.kind, f.game_id
    ), fe AS (
      SELECT x.table_id, x.felt, x.seated
        FROM unnest(v_felt_ids, COALESCE(v_felt_amt, ARRAY[]::numeric[]), COALESCE(v_felt_seated, ARRAY[]::int[])) AS x(table_id, felt, seated)
    ), rows_ AS (
      SELECT COALESCE(c.kind, 'CASH') AS k, COALESCE(c.game_id, fe.table_id) AS game_id,
             COALESCE(c.fee, 0) AS fee, COALESCE(c.winnings, 0) AS winnings,
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
      'total_winnings', round(v_cash_win + v_tour_win, 2),
      'mtt_winnings', round(v_mtt_win, 2), 'tournament_winnings', round(v_tour_win,2),
      'running_mtt_entries', round(v_run_win, 2), 'running_mtt_fee', round(v_run_fee, 2),
      'cash_winnings', round(v_cash_win, 2),
      'fee', round(v_cash_fee + v_tour_fee, 2),
      'cash_fee', round(v_cash_fee, 2),
      'mtt_fee', round(v_mtt_fee, 2), 'tournament_fee', round(v_tour_fee,2),
      'on_felt', round(v_felt_sum, 2),
      'live_games', cardinality(v_felt_ids) + cardinality(v_live_t));

    RETURN jsonb_build_object(
      'range', jsonb_build_object('start', v_start, 'end', v_end, 'days', (v_end - v_start) + 1),
      'filters', jsonb_build_object('game', v_game, 'stakes', v_stakes, 'search', v_q),
      'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'union_invoice_accounting', 'day_basis', 'America/Chicago 02:00', 'accounting_coverage', public.fn_ca_club_acct_coverage(p_club_id, v_start, v_end), 'viewer_role', v_role, 'club_name', v_club_name, 'facts_from', v_facts_from,
      'member_fees', v_member_fees, 'summary', v_sum, 'rows', v_rows, 'row_count', (v_sum->>'games')::int,
      'union_id', v_union, 'generated_at', now());
  END IF;

  -- A FILTERED SCREEN (a game class, stakes, or a search): every game's
  -- attributes are read, as before; the players are counted for the page's
  -- rows by exact (club, day, game) lookups.

  WITH g AS MATERIALIZED (
    SELECT d.kind, d.game_id, SUM(d.fee) AS fee, SUM(d.winnings) AS winnings, max(d.last_at) AS activity_at
      FROM public.ca_club_acct_fact_ct d
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users))
       AND (v_game = 'ALL'
            OR (v_game IN ('HOLDEM', 'OMAHA', 'MIXED') AND d.kind = 'CASH')
            OR (v_game IN ('MTT', 'SNG') AND d.kind = 'TOURNAMENT'))
       AND (v_stakes = 'ALL' OR d.kind = 'CASH')
     GROUP BY d.kind, d.game_id
  ), felt AS MATERIALIZED (
    -- Chips still in front of this club's seated players: part of the result,
    -- not a loss. The seat's own club, as the money was.
    SELECT s.table_id, SUM(s.stack) AS felt, count(*)::int AS seated
      FROM public.table_seats s
      JOIN public.tables t ON t.id = s.table_id AND t.tournament_id IS NULL
     WHERE s.left_at IS NULL AND s.user_id IS NOT NULL
       AND COALESCE(s.status, 'active') <> 'left' AND COALESCE(s.stack, 0) > 0
       AND public.fn_ca_accounting_day(s.joined_at) BETWEEN v_start AND v_end
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
           COALESCE(gg.winnings, 0) AS winnings,
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
      FROM public.ca_club_acct_fact_ct f
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
    'scope', v_scope, 'reporting_scope', CASE WHEN v_union=p_club_id THEN 'union' ELSE 'club' END, 'reporting_club_count', cardinality(v_clubs), 'accounting_basis', 'union_invoice_accounting', 'day_basis', 'America/Chicago 02:00', 'accounting_coverage', public.fn_ca_club_acct_coverage(p_club_id, v_start, v_end),
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

REVOKE ALL ON FUNCTION public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) IS
  'Club Data reader ca_club_data_screen on the union invoice''s accounting basis (20261115034142; 20261115164547 reads the window twice, not six times): read through the router ca_club_data_screen for a union club or a union only.';

DO $after$
DECLARE d text := pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure);
BEGIN
  IF position('fn_ca_club_acct_fact_window' IN d) > 0 OR position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN d) = 0 THEN
    RAISE EXCEPTION 'club data union screen was not replaced as written';
  END IF;
  IF (SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END FROM pg_proc p
       WHERE p.oid = 'public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure) <> 'ss' THEN
    RAISE EXCEPTION 'club data union screen lost STABLE SECURITY DEFINER';
  END IF;
END $after$;

COMMIT;
