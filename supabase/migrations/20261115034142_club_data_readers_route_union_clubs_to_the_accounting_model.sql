-- 20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-15 03:41:42 UTC.
--
-- BOTH CLUB DATA SCREENS READ THE UNION INVOICE'S ACCOUNTING RECORDS FOR
-- EVERY UNION CLUB AND FOR THE UNION ITSELF (stage 2, part b; owner,
-- 2026-11-14: "The Club Data page must match the union weekly invoices 1:1,
-- starting and stopping at the same 2 AM boundary the invoices use."
-- Specification sections 2-4.)
--
-- WHAT WAS WRONG (measured on production, read-only, 2026-11-14/15; union
-- fade0000-0000-0000-0000-000000000001, week 2026-11-02 08:00Z to
-- 2026-11-09 08:00Z; figures in 20261115020010's header and the evidence
-- of #10879):
--
--   1. Day. Every Club Data reader bucketed by the America/Chicago MIDNIGHT
--      day (the player readers by the UTC day); the invoice week is 02:00 to
--      02:00 America/Chicago.
--   2. Attribution. ca_stats_club_data_fact_ct / fn_ca_club_data_fact_window
--      dropped every horse from KINGS CLUB and moved horses between clubs by
--      their CURRENT ca_horse_club_assignments row (CLAUDE.md 10.5 forbids
--      leaving a horse out of a total). The invoice attributes each hand and
--      each fee by its own accounting record (earning club, rake source club).
--   3. Definition. Winnings were wallet cash-outs minus buy-ins plus chips on
--      the felt; the invoice's cash result is each hand's stack change plus
--      BBJ stack awards, and its tournament result is receipt-owned returns
--      minus funding with entries still running at a week boundary carried
--      to the week they settle in. Fees were rake_records by the seat's club;
--      the invoice fee is accounting rake credit (cash when earned,
--      tournament when recognized).
--
-- WHAT THIS CHANGES (report-only; no money, ledger, rake, invoice,
-- settlement or accounting row or rule is read for update or written):
--
-- Each of the thirteen Club Data readers keeps its name, arguments, defaults,
-- result and grants, and becomes a router on its club argument:
--
--   <reader>(p_club_id, ...)                    the name the screens call
--     fn_ca_club_data_union_basis(p_club_id)    the club is in a union, or is
--                                               a union (its house club)
--       -> <reader>_union_basis(...)            the accounting-basis copy
--       else <reader>_chicago_basis(...)        the installed reader, renamed
--                                               and otherwise untouched
--
-- So a club in no union reads exactly what it read before (the same function,
-- byte for byte), and a union club or the union reads the accounting read
-- model (20261115020010) through the views of 20261115034141. Inner calls
-- between readers go through the routers by name with the same club, so a
-- screen never mixes the two bases.
--
-- Each copy is the installed reader's exact text (md5 preimage pinned below;
-- a changed preimage refuses the whole migration) with these substitutions
-- only, and its resulting text is pinned by md5 too, so what installs is the
-- text qualified on production:
--
--   * today, and a seat's day, are 02:00 America/Chicago accounting days
--     (fn_ca_accounting_day); a union's raked-hand window is
--     [fn_ca_accounting_day_start(first day), ..._start(last day + 1));
--   * ca_stats_club_data_fact_ct / fn_ca_club_data_fact_window /
--     ca_club_data_game_ct / ca_club_data_hands_ct ->
--     ca_club_acct_fact_ct / fn_ca_club_acct_fact_window /
--     ca_club_acct_game_ct / ca_club_acct_hands_ct (every writer's rows once,
--     no horse filter, no re-attribution);
--   * chips still on the felt are shown (on_felt, live, seated) but are not
--     ADDED to winnings: the hand-by-hand result already holds them;
--   * the player readers (page, breakdown, export) read each player's cash
--     result, tournament result, fee and cash hands from the same records,
--     for every player the records attribute to the club (current
--     membership no longer decides who is listed; horses are players);
--   * a downline's fee summary (member_fees) is the downline's accounting
--     fees on the same day (fn_ca_club_acct_member_fee_totals; coordinator
--     decision 2026-11-15), labelled with its basis;
--   * the snapshot, both screen answers and the player totals state their
--     basis ('union_invoice_accounting', day_basis 'America/Chicago 02:00')
--     and the window's coverage (fn_ca_club_acct_coverage: missing, failed
--     and not invoice-exact days, and provisional = the open week no issued
--     invoice covers yet).
--
-- The date parameters keep their meaning: p_start and p_end are the first and
-- last ACCOUNTING day of the window, inclusive. The client selects boundaries
-- (Nov 2 02:00 to Nov 9 02:00) and sends the last day (Nov 8).
--
-- Requires 20261115034141 and the read model live (20261115020011) and loaded
-- from 2026-09-17 (the first accounting cash source) through the day it went
-- live; refused otherwise, so a screen never switches to a model that does
-- not hold its history. Not a hot-table change: it renames and creates
-- functions only.
--
-- @live-proof: to_regprocedure('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)') IS NOT NULL
-- @live-proof: to_regprocedure('public.ca_club_data_screen_chicago_basis(uuid,date,date,text,text,text,integer)') IS NOT NULL
-- @live-proof: position('fn_ca_club_data_union_basis' IN pg_get_functiondef('public.ca_club_data_screen(uuid,date,date,text,text,text,integer)'::regprocedure)) > 0
-- @live-proof: position('_union_basis' IN pg_get_functiondef('public.ca_club_player_export_start(uuid,date,date,text,uuid)'::regprocedure)) > 0

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE v_live date; v_missing int;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'club data reader routing requires the maintained installer';
  END IF;
  IF to_regprocedure('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'club data reader routing already installed';
  END IF;
  IF to_regclass('public.ca_club_acct_fact_ct') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_coverage(uuid,date,date)') IS NULL
     OR to_regprocedure('public.fn_ca_club_acct_member_fee_totals(uuid,date,date,uuid)') IS NULL
     OR to_regprocedure('public.fn_ca_club_data_union_basis(uuid)') IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: install 20261115034141 first';
  END IF;
  SELECT public.fn_ca_accounting_day(s.live_from) INTO v_live FROM public.ca_club_acct_state s;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_PREREQUISITE_MISSING: the live projection (20261115020011) is not attached';
  END IF;
  SELECT count(*) INTO v_missing
    FROM generate_series(date '2026-09-17', v_live, interval '1 day') g(d)
   WHERE NOT EXISTS (SELECT 1 FROM public.ca_club_acct_seed_log l WHERE l.acct_day = g.d::date);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'CLUB_ACCT_READERS_HISTORY_NOT_LOADED: % accounting day(s) from 2026-09-17 to % are not loaded', v_missing, v_live;
  END IF;
END $guard$;

-- One reader: copy, rename, route. A session-local helper (pg_temp), gone at
-- the end of this installation; tests/fixtures and the native qualification
-- (scripts/ci/test-club-data-accounting-read-model.py) run it on a reader.
-- @route-reader-begin
CREATE FUNCTION pg_temp.ca_club_data_route_reader(p_name text, p_sig text, p_preimage text, p_copy_md5 text)
RETURNS void LANGUAGE plpgsql AS $route$
DECLARE
  g record;
  d text;
  e text;
  i int;
  v_oid oid;
  v_name text;
  v_args text;
  v_ident text;
  v_res text;
  v_names text[];
  v_call text;
  v_body text;
  v_src_md5 text;
  v_acl aclitem[];
  -- (pattern, replacement), applied in order to every copy, every occurrence.
  subst text[][] := ARRAY[
    -- Today is the current accounting day (both clocks the readers used).
    ARRAY['\(now\(\) AT TIME ZONE ''(America/Chicago|UTC)''\)::date', 'public.fn_ca_accounting_day(now())'],
    -- A seat's day is its accounting day.
    ARRAY['\(s\.joined_at AT TIME ZONE ''America/Chicago''\)::date', 'public.fn_ca_accounting_day(s.joined_at)'],
    -- A union's raked-hand window: [02:00 first day, 02:00 after the last day).
    ARRAY['\(((?:\$[0-9]|p_start|p_end)\+1)\)::timestamp AT TIME ZONE ''America/Chicago''', 'public.fn_ca_accounting_day_start(\1)'],
    ARRAY['(\$[0-9]|p_start|p_end)::timestamp AT TIME ZONE ''America/Chicago''', 'public.fn_ca_accounting_day_start(\1)'],
    -- The accounting read model in the shapes the readers read.
    ARRAY['public\.ca_stats_club_data_fact_ct\M', 'public.ca_club_acct_fact_ct'],
    ARRAY['public\.fn_ca_club_data_fact_window\(', 'public.fn_ca_club_acct_fact_window('],
    ARRAY['public\.ca_club_data_game_ct\M', 'public.ca_club_acct_game_ct'],
    ARRAY['public\.ca_club_data_hands_ct\M', 'public.ca_club_acct_hands_ct'],
    ARRAY['public\.fn_ca_club_data_facts_from\(\)', 'public.fn_ca_club_acct_facts_from()'],
    -- Chips on the felt are already in the hand-by-hand result.
    ARRAY['\s*\+\s*coalesce\((f|fe)\.felt,\s*0\)', ''],
    ARRAY[' \+ v_felt_sum', ''],
    ARRAY['sum\(s\.stack\) winnings', '0::numeric winnings'],
    -- A downline's fees from the same records on the same day.
    ARRAY['public\.ca_club_member_fee_totals\(p_club_id, v_start, v_end, auth\.uid\(\)\)',
          'public.fn_ca_club_acct_member_fee_totals(p_club_id, v_start, v_end, auth.uid())'],
    ARRAY['''day_basis'', ''UTC''\)',
          '''day_basis'', ''America/Chicago 02:00'', ''definition'', ''downline_accounting_fees'', ''source'', ''ca_club_acct_fact'')'],
    -- The basis each answer states, and the window's coverage.
    ARRAY['''accounting_basis'',(\s*)''chicago_net_money_flow'',(\s*)''day_basis'',(\s*)''America/Chicago''',
          '''accounting_basis'',\1''union_invoice_accounting'',\2''day_basis'',\3''America/Chicago 02:00'',\3''accounting_coverage'',\3public.fn_ca_club_acct_coverage(p_club_id,\3v_start,\3v_end)'],
    ARRAY['''scope'',v_scope,''day_basis'',''America/Chicago'',',
          '''scope'',v_scope,''day_basis'',''America/Chicago 02:00'',''accounting_basis'',''union_invoice_accounting'',''accounting_coverage'',public.fn_ca_club_acct_coverage(p_club_id,p_start,p_end),'],
    -- The player rows: each player's accounting results, fee and hands.
    ARRAY['WITH att_club AS MATERIALIZED \(.*?\), merged AS MATERIALIZED \(', $blk$WITH acct AS MATERIALIZED (
    -- The union invoice's accounting records (ca_club_acct_fact_ct,
    -- 20261115034141): each player's cash and tournament result, fee and
    -- cash hands for the club, by the club of each record, 02:00
    -- America/Chicago accounting days. Every player the records attribute
    -- to the club is listed, member or not, horses included.
    SELECT f.user_id,
           SUM(f.winnings) FILTER (WHERE f.kind = 'CASH') AS cash_net,
           SUM(f.winnings) FILTER (WHERE f.kind = 'TOURNAMENT') AS tournament_net,
           SUM(f.fee) AS rake, SUM(f.hands)::bigint AS hands
      FROM public.ca_club_acct_fact_ct f
     WHERE f.club_id = ANY (public.fn_ca_club_data_clubs(p_club_id)) AND f.stat_date BETWEEN v_start AND v_end
       AND f.user_id <> '00000000-0000-0000-0000-000000000000'::uuid
     GROUP BY f.user_id
  ), att_club AS (SELECT a.user_id FROM acct a
  ), wallet_pnl AS (SELECT a.user_id, a.cash_net, a.tournament_net FROM acct a
  ), rake AS (SELECT a.user_id, a.rake FROM acct a
  ), hands AS (SELECT a.user_id, a.hands FROM acct a
  ), merged AS MATERIALIZED ($blk$]];
  -- What may not remain in a copy.
  forbidden text[] := ARRAY[
    'AT TIME ZONE ''(America/Chicago|UTC)''\)::date', '::timestamp AT TIME ZONE ''America/Chicago''',
    'ca_club_data_(game|hands)_ct', 'ca_stats_club_data_fact_ct', 'fn_ca_club_data_fact_window',
    'fn_ca_club_data_facts_from', '\mca_club_member_fee_totals', '\+\s*coalesce\((f|fe)\.felt',
    '\+ v_felt_sum', 'sum\(s\.stack\) winnings', 'ca_stats_member_record_daily_facts',
    'ca_stats_club_player_daily', 'chicago_net_money_flow', '''day_basis'', ''UTC'''];
BEGIN
  v_oid := p_sig::regprocedure;
  d := pg_get_functiondef(v_oid);
  IF md5(d) <> p_preimage THEN
    RAISE EXCEPTION 'Club Data reader % preimage changed (md5 %)', p_sig, md5(d);
  END IF;
  -- Input argument names only (a RETURNS TABLE reader also names its
  -- result columns in proargnames).
  SELECT ARRAY(SELECT u.n FROM unnest(p.proargnames,
                 COALESCE(p.proargmodes, array_fill('i'::"char", ARRAY[cardinality(p.proargnames)])))
                 WITH ORDINALITY u(n, m, o) WHERE u.m IN ('i', 'b', 'v') ORDER BY u.o),
         pg_get_function_arguments(p.oid), pg_get_function_identity_arguments(p.oid),
         pg_get_function_result(p.oid), md5(p.prosrc), p.proacl
    INTO v_names, v_args, v_ident, v_res, v_src_md5, v_acl
    FROM pg_proc p WHERE p.oid = v_oid;
  IF cardinality(v_names) IS DISTINCT FROM (SELECT p.pronargs::int FROM pg_proc p WHERE p.oid = v_oid) THEN
    RAISE EXCEPTION 'Club Data reader % has unnamed or variadic arguments', p_sig;
  END IF;
  IF v_names[1] IS DISTINCT FROM 'p_club_id' THEN
    RAISE EXCEPTION 'Club Data reader % does not take p_club_id first', p_sig;
  END IF;

  -- 1. The accounting-basis copy.
  e := d;
  FOR i IN 1 .. array_length(subst, 1) LOOP
    e := regexp_replace(e, subst[i][1], subst[i][2], 'gi');
  END LOOP;
  FOR i IN 1 .. array_length(forbidden, 1) LOOP
    -- Code only: a comment may still name what the reader used to read.
    IF regexp_replace(e, '--[^\n]*', '', 'g') ~* forbidden[i] THEN
      RAISE EXCEPTION 'Club Data reader copy % still holds %', p_sig, forbidden[i];
    END IF;
  END LOOP;
  e := regexp_replace(e, '^CREATE OR REPLACE FUNCTION public\.' || p_name || '\(',
                      'CREATE FUNCTION public.' || p_name || '_union_basis(');
  IF md5(e) IS DISTINCT FROM p_copy_md5 THEN
    RAISE EXCEPTION 'Club Data reader copy % is not the qualified text (md5 %)', p_sig, md5(e);
  END IF;
  EXECUTE e;
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role',
                 p_name || '_union_basis', v_ident);
  EXECUTE format('COMMENT ON FUNCTION public.%I(%s) IS %L', p_name || '_union_basis', v_ident,
                 'Club Data reader ' || p_name || ' on the union invoice''s accounting basis (20261115034142): '
                 || 'read through the router ' || p_name || ' for a union club or a union only.');

  -- 2. The installed reader, renamed and otherwise untouched.
  EXECUTE format('ALTER FUNCTION %s RENAME TO %I', p_sig, p_name || '_chicago_basis');
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role',
                 p_name || '_chicago_basis', v_ident);
  EXECUTE format('COMMENT ON FUNCTION public.%I(%s) IS %L', p_name || '_chicago_basis', v_ident,
                 'Club Data reader ' || p_name || ' as installed before 20261115034142 (Chicago day, '
                 || 'net money flow): read through the router ' || p_name || ' for a club in no union only.');

  -- 3. The router, under the reader's own name, arguments, result and grants.
  v_call := '(' || array_to_string(ARRAY(SELECT quote_ident(a) FROM unnest(v_names) a), ', ') || ')';
  IF v_res LIKE 'TABLE(%' OR v_res LIKE 'SETOF %' THEN
    v_body := format(E'BEGIN\n  IF public.fn_ca_club_data_union_basis(p_club_id) THEN\n'
                     || E'    RETURN QUERY SELECT * FROM public.%I%s;\n    RETURN;\n  END IF;\n'
                     || E'  RETURN QUERY SELECT * FROM public.%I%s;\nEND;',
                     p_name || '_union_basis', v_call, p_name || '_chicago_basis', v_call);
  ELSE
    v_body := format(E'BEGIN\n  IF public.fn_ca_club_data_union_basis(p_club_id) THEN\n'
                     || E'    RETURN public.%I%s;\n  END IF;\n  RETURN public.%I%s;\nEND;',
                     p_name || '_union_basis', v_call, p_name || '_chicago_basis', v_call);
  END IF;
  EXECUTE format(E'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql %s SECURITY DEFINER\n'
                 || E' SET search_path TO ''public'' AS %L',
                 p_name, v_args, v_res,
                 CASE (SELECT p.provolatile FROM pg_proc p WHERE p.oid = v_oid)
                   WHEN 's' THEN 'STABLE' WHEN 'i' THEN 'STABLE' ELSE 'VOLATILE' END,
                 v_body);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role', p_name, v_ident);
  FOR g IN
    SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(r.rolname) END AS who
      FROM aclexplode(v_acl) a LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> a.grantor
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO %s', p_name, v_ident, g.who);
  END LOOP;
  EXECUTE format('COMMENT ON FUNCTION public.%I(%s) IS %L', p_name, v_ident,
                 'Club Data reader router (20261115034142): a club in a union, or a union, reads '
                 || p_name || '_union_basis (the union invoice''s accounting records, 02:00 America/Chicago days); '
                 || 'any other club reads ' || p_name || '_chicago_basis, the reader as installed before.');

  -- 4. Nothing else moved: the renamed reader's text is the installed text,
  --    and the router answers to the same callers.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM v_src_md5
     OR (SELECT p.proname FROM pg_proc p WHERE p.oid = v_oid) IS DISTINCT FROM p_name || '_chicago_basis'
     OR (SELECT pg_get_function_arguments(p.oid) FROM pg_proc p WHERE p.oid = p_sig::regprocedure) IS DISTINCT FROM v_args
     OR (SELECT pg_get_function_result(p.oid) FROM pg_proc p WHERE p.oid = p_sig::regprocedure) IS DISTINCT FROM v_res
     OR (SELECT array_agg(x ORDER BY x) FROM (SELECT a.grantee::regrole::text || ':' || a.privilege_type x
           FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = p_sig::regprocedure AND a.grantee <> 0 AND a.grantee <> a.grantor) s)
        IS DISTINCT FROM
        (SELECT array_agg(x ORDER BY x) FROM (SELECT a.grantee::regrole::text || ':' || a.privilege_type x
           FROM aclexplode(v_acl) a WHERE a.grantee <> 0 AND a.grantee <> a.grantor) s) THEN
    RAISE EXCEPTION 'Club Data reader % was not routed exactly', p_sig;
  END IF;
END $route$;
-- @route-reader-end

-- The thirteen readers: each installed text pinned by md5 (preimage), and the
-- accounting-basis copy pinned by the md5 of the text qualified on production
-- (read-only probe 2026-11-15, the same substitutions on the same preimages).
DO $routes$
DECLARE t record;
BEGIN
  FOR t IN SELECT * FROM (VALUES
      ('ca_club_data_screen', 'public.ca_club_data_screen(uuid,date,date,text,text,text,integer)',
       '7578d64c439069aa294b4e24862f6af2', 'da2e6c6db1a536962034254df5d53a07'),
      ('ca_club_data_snapshot_v2', 'public.ca_club_data_snapshot_v2(uuid,date,date,text,text,text,integer)',
       '9c3d8c1b3f2feb9b779cf27ad8bcc4be', 'e4dea28dfe8b4a49f530a8127a657868'),
      ('ca_club_game_page_core_20261006', 'public.ca_club_game_page_core_20261006(uuid,date,date,text,text,text,text,jsonb,integer)',
       'ce67150bdba133c4d0de60cd380e2d60', '1dcd3feac8bb4791dfdb3f0cce18189b'),
      ('fn_ca_club_game_recent_rows', 'public.fn_ca_club_game_recent_rows(uuid,date,date,integer)',
       '3ae8c77a22d307c482cad8b2d7114f04', '5d22e714b8cd2ad8e16f6cd6c41722b2'),
      ('fn_ca_club_games_searched', 'public.fn_ca_club_games_searched(uuid,date,date,text,text,text)',
       'f4cd0a43414d5221d1ce531ae4e9a46c', 'ad801344e7e6f2b7e54720fdb8110af3'),
      ('fn_ca_club_games_unsearched', 'public.fn_ca_club_games_unsearched(uuid,date,date,text,text)',
       'dbf6a3602f84225ef66f1c689ef5453e', 'f0f4ea377ff0b9aedf0133ac361529c8'),
      ('fn_ca_club_data_hand_count', 'public.fn_ca_club_data_hand_count(uuid,date,date,text,text,text)',
       'fd63ab7384a8586e761fb92afe07f8b0', '2fd7d472d9a55a17f938050cb31de49c'),
      ('fn_ca_club_cash_felt', 'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)',
       'd9f01b07584e5ca17c7912101b62db13', 'b0072819944a706c3b967b7b3a0f0b3e'),
      ('ca_club_data_player_totals', 'public.ca_club_data_player_totals(uuid,date,date,text,text,text)',
       '57977ffed9fe5a14cf2429450d57f494', 'bf0550c0badf56982679f148bbb98ef3'),
      ('ca_club_game_export_start', 'public.ca_club_game_export_start(uuid,date,date,text,text,text,text,uuid)',
       '108bc83b08d1deedf458cc547b92bb7b', 'b39a06e3920ba3031afbe8923c4e4c10'),
      ('ca_club_player_page_core_20261006', 'public.ca_club_player_page_core_20261006(uuid,date,date,text,text,jsonb,integer)',
       '46a7e273c09b32623a42f2f26ab9338f', '06a2e6e8cb00cc722d52fe26bbffdec9'),
      ('ca_club_player_breakdown', 'public.ca_club_player_breakdown(uuid,date,date,integer)',
       '848d1a14c39743a83fbea79773c85bfa', 'e48e405b2585c704ef36f5b31f28956c'),
      ('ca_club_player_export_start', 'public.ca_club_player_export_start(uuid,date,date,text,uuid)',
       '8cbff4e575f68382f8aa1eab2d86b513', '1c8fe358efd7ec8331ea3b5463487712')
    ) v(name, sig, preimage, copy_md5)
  LOOP
    PERFORM pg_temp.ca_club_data_route_reader(t.name, t.sig, t.preimage, t.copy_md5);
  END LOOP;
END $routes$;

COMMIT;
