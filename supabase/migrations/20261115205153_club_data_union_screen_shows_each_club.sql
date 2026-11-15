-- 20261115205153_club_data_union_screen_shows_each_club
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 20:51:53 UTC.
--
-- THE UNION'S CLUB DATA SCREEN SHOWS EACH CLUB (report-only; no figure moves).
--
-- WHAT WAS MISSING. The Club Data page of the union itself (Midway Union,
-- "All Member Clubs And Union Account") shows only the grand totals. For the
-- week 2026-11-02..2026-11-08 those are Fee 933,570.79 and Total Winnings
-- -1,072,249.20, the sum of the four weekly statements plus the union's own
-- account - but the page cannot say which club is which.
--
-- WHAT THIS CHANGES. ca_club_data_screen_union_basis is replaced (same name,
-- arguments, defaults, result type, grants, owner, STABLE SECURITY DEFINER,
-- search_path, work_mem, plan_cache_mode). The router ca_club_data_screen is
-- untouched. Only the union's own answer (reporting_scope 'union') gains one
-- key, `clubs`: one row per reporting club (each member club, then the union
-- account last), each {club_id, name, slug, union_account, fee,
-- total_winnings} for the same window and filters as the page. No other
-- answer gains or loses a key (a club's answer is the same jsonb).
--
--   * plain screen: pass 1 (the one aggregate over the window that gives
--     every total and the MTT split) is grouped by the row's club - at most
--     one group per reporting club - and the totals are the sums of those
--     groups. No new pass over the accounting rows.
--   * filtered screen (a game class, stakes or a search): the per-game
--     aggregate keeps each game per club for the union's screen only (a NULL
--     club key, so the same groups as before, for every other screen); a
--     club's row is its share of exactly the games the filters kept.
--   * Games are not given per club: a game a union table dealt to players of
--     two clubs is one game on the page, so per-club counts would not add up
--     to the total, and counting them would need another hash over the games.
--
-- The rows add up to the page totals to the cent: every accounting row of the
-- window is in exactly one club's group, and no accounting row carries a
-- sub-cent amount (production 2026-11-15, the union's 93 days: 2,338,033
-- rows, 0 with fee or winnings off the cent), so rounding each club and
-- rounding the total agree.
--
-- PROOF (production, read-only, 2026-11-15 ~20:50Z; the grouped pass alone):
-- Midway Union 2026-11-02..2026-11-08 by club = Deep Stack Society
-- 452,206.43 / -562,209.57, KINGS CLUB 25,854.24 / -37,160.83, The Felt
-- Society 455,510.12 / -473,091.31, Club Savage 0.00 / 0.00, Union Account
-- 0.00 / +212.51; sums 933,570.79 / -1,072,249.20 = the installed reader's
-- summary fee and total_winnings for the same window, and = the four weekly
-- statements plus the union's own.
--
-- Not a hot-table change: one function is replaced. No money, ledger, rake,
-- invoice, settlement or accounting row is read for update or written. The
-- installed text is pinned by md5 (preimage: 20261115164547 as installed,
-- 5e488a363b5555fa4bee8c20d8b5f67a on production) and refused otherwise.
--
-- @live-proof: position('''clubs'', COALESCE(v_club_rows' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: position('ca_club_data_screen_union_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: (SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END FROM pg_proc p WHERE p.oid = 'public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure) = 'ss'
-- @live-proof: jsonb_typeof(public.ca_club_data_screen('fade0000-0000-0000-0000-000000000001', public.fn_ca_accounting_day(now()) - 1, public.fn_ca_accounting_day(now()) - 1, 'ALL', 'ALL', NULL, 5)->'clubs') = 'array'
-- @live-proof: NOT (public.ca_club_data_screen('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', public.fn_ca_accounting_day(now()) - 1, public.fn_ca_accounting_day(now()) - 1, 'ALL', 'ALL', NULL, 5) ? 'clubs')
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
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: install 20261115034142 and 20261115164547 first';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure));
  IF position('''clubs'', COALESCE(v_club_rows' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'club data union screen already shows each club';
  END IF;
  IF position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: install 20261115164547 first';
  END IF;
  IF v_md5 <> '5e488a363b5555fa4bee8c20d8b5f67a' THEN
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
  v_is_union boolean;
  v_club_rows jsonb;
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
  -- 20261115205153: the union's own answer (reporting_scope 'union') also
  -- carries its figures club by club; no other answer gains a key.
  v_is_union := COALESCE(v_union = p_club_id, false);
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
    -- 20261115205153: the same single pass, grouped by the row's club (at
    -- most one group per reporting club), so the union's answer can give each
    -- member club's and the union account's Fee and Total Winnings; the page
    -- totals are the sums of those groups, the same rows added once each.
    WITH p AS (
      SELECT d.club_id,
             COALESCE(SUM(d.fee) FILTER (WHERE d.kind = 'CASH'), 0) AS cash_fee,
             COALESCE(SUM(d.fee) FILTER (WHERE d.kind <> 'CASH'), 0) AS tour_fee,
             COALESCE(SUM(d.winnings) FILTER (WHERE d.kind = 'CASH'), 0) AS cash_win,
             COALESCE(SUM(d.winnings) FILTER (WHERE d.kind <> 'CASH'), 0) AS tour_win,
             COALESCE(SUM(d.winnings) FILTER (WHERE mt.finished), 0) AS mtt_win,
             COALESCE(SUM(d.fee) FILTER (WHERE mt.finished), 0) AS mtt_fee,
             COALESCE(SUM(d.winnings) FILTER (WHERE NOT mt.finished), 0) AS run_win,
             COALESCE(SUM(d.fee) FILTER (WHERE NOT mt.finished), 0) AS run_fee
        FROM public.ca_club_acct_fact_ct d
        LEFT JOIN (SELECT tr.id, COALESCE(tr.status IN ('COMPLETED','CANCELLED'), false) AS finished
                     FROM public.tournaments tr WHERE tr.tournament_type = 'MTT') mt
          ON d.kind = 'TOURNAMENT' AND mt.id = d.game_id
       WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
         AND (v_users IS NULL OR d.user_id = ANY (v_users))
       GROUP BY d.club_id
    )
    SELECT COALESCE(SUM(p.cash_fee), 0), COALESCE(SUM(p.tour_fee), 0),
           COALESCE(SUM(p.cash_win), 0), COALESCE(SUM(p.tour_win), 0),
           COALESCE(SUM(p.mtt_win), 0), COALESCE(SUM(p.mtt_fee), 0),
           COALESCE(SUM(p.run_win), 0), COALESCE(SUM(p.run_fee), 0),
           CASE WHEN v_is_union THEN (
             SELECT jsonb_agg(jsonb_build_object(
                      'club_id', u.id, 'name', COALESCE(cl.name, 'Club'), 'slug', cl.slug,
                      'union_account', u.id = p_club_id,
                      'fee', round(COALESCE(pc.cash_fee + pc.tour_fee, 0), 2),
                      'total_winnings', round(COALESCE(pc.cash_win + pc.tour_win, 0), 2))
                    ORDER BY (u.id = p_club_id), upper(COALESCE(cl.name, '')), u.id)
               FROM unnest(v_clubs) u(id)
               LEFT JOIN p pc ON pc.club_id = u.id
               LEFT JOIN public.clubs cl ON cl.id = u.id) END
      INTO v_cash_fee, v_tour_fee, v_cash_win, v_tour_win, v_mtt_win, v_mtt_fee, v_run_win, v_run_fee, v_club_rows
      FROM p;

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
      'union_id', v_union, 'generated_at', now())
      || CASE WHEN v_is_union THEN jsonb_build_object('clubs', COALESCE(v_club_rows, '[]'::jsonb)) ELSE '{}'::jsonb END;
  END IF;

  -- A FILTERED SCREEN (a game class, stakes, or a search): every game's
  -- attributes are read, as before; the players are counted for the page's
  -- rows by exact (club, day, game) lookups.

  WITH g0 AS MATERIALIZED (
    -- 20261115205153: for the union's own screen each game's figures are kept
    -- per reporting club as well (club_key; NULL for every other screen, so
    -- a club's screen groups exactly as before); g is their sum per game.
    SELECT CASE WHEN v_is_union THEN d.club_id END AS club_key,
           d.kind, d.game_id, SUM(d.fee) AS fee, SUM(d.winnings) AS winnings, max(d.last_at) AS activity_at
      FROM public.ca_club_acct_fact_ct d
     WHERE d.club_id = ANY (v_clubs) AND d.stat_date BETWEEN v_start AND v_end
       AND (v_users IS NULL OR d.user_id = ANY (v_users))
       AND (v_game = 'ALL'
            OR (v_game IN ('HOLDEM', 'OMAHA', 'MIXED') AND d.kind = 'CASH')
            OR (v_game IN ('MTT', 'SNG') AND d.kind = 'TOURNAMENT'))
       AND (v_stakes = 'ALL' OR d.kind = 'CASH')
     GROUP BY 1, d.kind, d.game_id
  ), g AS MATERIALIZED (
    SELECT g0.kind, g0.game_id, SUM(g0.fee) AS fee, SUM(g0.winnings) AS winnings, max(g0.activity_at) AS activity_at
      FROM g0
     GROUP BY g0.kind, g0.game_id
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
  ), by_club AS (
    -- The union's screen: each reporting club's share of exactly the games
    -- the filters kept (a seated table with no fact adds no money).
    SELECT g0.club_key AS club_id, SUM(g0.fee) AS fee, SUM(g0.winnings) AS winnings
      FROM g0 JOIN filtered fl ON fl.k = g0.kind AND fl.game_id = g0.game_id
     WHERE v_is_union
     GROUP BY g0.club_key
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
           ORDER BY live DESC, activity_at DESC NULLS LAST, k, id) FROM described), '[]'::jsonb),
         CASE WHEN v_is_union THEN (
           SELECT jsonb_agg(jsonb_build_object(
                    'club_id', u.id, 'name', COALESCE(cl.name, 'Club'), 'slug', cl.slug,
                    'union_account', u.id = p_club_id,
                    'fee', round(COALESCE(bc.fee, 0), 2),
                    'total_winnings', round(COALESCE(bc.winnings, 0), 2))
                  ORDER BY (u.id = p_club_id), upper(COALESCE(cl.name, '')), u.id)
             FROM unnest(v_clubs) u(id)
             LEFT JOIN by_club bc ON bc.club_id = u.id
             LEFT JOIN public.clubs cl ON cl.id = u.id) END
    INTO v_sum, v_rows, v_club_rows;

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
    'generated_at', now())
    || CASE WHEN v_is_union THEN jsonb_build_object('clubs', COALESCE(v_club_rows, '[]'::jsonb)) ELSE '{}'::jsonb END;
END;
$function$;

REVOKE ALL ON FUNCTION public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) IS
  'Club Data reader ca_club_data_screen on the union invoice''s accounting basis (20261115034142; 20261115164547 reads the window twice, not six times; 20261115205153 gives the union''s own answer its clubs, each club''s and the union account''s Fee and Total Winnings): read through the router ca_club_data_screen for a union club or a union only.';

DO $after$
DECLARE d text := pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure);
BEGIN
  IF position('fn_ca_club_acct_fact_window' IN d) > 0 OR position('v_clubs := public.fn_ca_club_data_clubs(p_club_id)' IN d) = 0
     OR position('''clubs'', COALESCE(v_club_rows' IN d) = 0 THEN
    RAISE EXCEPTION 'club data union screen was not replaced as written';
  END IF;
  IF (SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END FROM pg_proc p
       WHERE p.oid = 'public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure) <> 'ss' THEN
    RAISE EXCEPTION 'club data union screen lost STABLE SECURITY DEFINER';
  END IF;
END $after$;

COMMIT;
