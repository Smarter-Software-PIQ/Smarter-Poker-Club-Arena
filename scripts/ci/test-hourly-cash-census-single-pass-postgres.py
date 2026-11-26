#!/usr/bin/env python3
"""HOURLY CASH CENSUS SINGLE-PASS & FAST CLOSE (20261125040442, incident 1e532243),
proved on a disposable PostgreSQL.

Rebuilds production's exact installed chain from the repository:
  20261116153902 -> 20261116194028 -> 20261112105743 -> 20261116200642 ->
  20261121174545 -> 20261123013241
then verifies:
1. Exact live preimage MD5s for all 4 replaced functions before applying 20261125040442.
2. RED before / GREEN after buffer-cost proof: with 600 historical closed tables in
   a Lightning cluster, `fn_cash_hourly_table_census()` scans those closed tables before
   the migration and eliminates that waste via single-pass open-table aggregation after;
   closure-paced `fn_cash_hourly_table_drain_candidate()` and human-occupied/paced
   `fn_cash_hourly_table_close()` short-circuit without scanning the floor.
3. Exact behavioral equivalence on standalone cash, Lightning cross-table human
   protection, human-started above-cap exclusion, over-cap horse-only drain + replay
   idempotency, opening-feeder slot reservation in `fn_cash_hourly_table_admissions()`,
   `fn_lightning_admission_policy()` dynamic `hourly_fingerprint`, private ACLs, and
   fail-closed migration replay rejection. No production connection is made.
"""
import ast, json, os, pathlib, re, shutil, subprocess, tempfile

P = pathlib.Path
ROOT = P(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations'
FIX = ROOT / 'scripts/ci/fixtures'
CANDIDATE = MIG / '20261125040442_hourly_cash_census_single_pass_open_tables_and_fast_close.sql'
SIBLING = ROOT / 'scripts/ci/test-a-called-name-keeps-its-place-postgres.py'

if os.environ.get('PG_BIN'):
    PG = P(os.environ['PG_BIN'])
elif os.uname().sysname == 'Darwin':
    PG = P('/opt/homebrew/opt/postgresql@17/bin')
else:
    installed = sorted(
        P('/usr/lib/postgresql').glob('*/bin'),
        key=lambda p: int(p.parent.name) if p.parent.name.isdigit() else -1,
        reverse=True,
    )
    PG = next((p for p in [P('/usr/lib/postgresql/17/bin'), *installed] if (p / 'initdb').is_file()), None)
    if PG is None:
        raise SystemExit('PostgreSQL server binaries unavailable; provide PG_BIN')

parent = P(os.environ.get('TMPDIR', str(ROOT / 'work')))
parent.mkdir(exist_ok=True)
w = P(tempfile.mkdtemp(prefix='hc-perf-', dir=parent))
sock = w / 's'
sock.mkdir()
env = {'PATH': str(PG) + ':/usr/bin:/bin', 'LC_ALL': 'C', 'LANG': 'C'}
passed = []


def run(args, sql=None):
    r = subprocess.run([str(x) for x in args], input=sql, text=True, capture_output=True, env=env, timeout=90)
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-U', 'postgres', '-d', 'postgres'], sql)


def check(ok, label):
    if not ok:
        raise AssertionError(label)
    passed.append(label)
    print('PASS', label, flush=True)


def attempt(sql):
    try:
        q(sql)
        return None
    except RuntimeError as e:
        return str(e)


def function_block(path, name, terminator):
    text = path.read_text()
    start = text.index('CREATE OR REPLACE FUNCTION public.' + name + '(')
    end = text.index(terminator, start) + len(terminator)
    return text[start:end]


def sibling_schema():
    tree = ast.parse(SIBLING.read_text())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', None) == 'SCHEMA' for t in node.targets):
            return ast.literal_eval(node.value)
    raise SystemExit('SCHEMA not found in ' + str(SIBLING))


def measure_warm_call(sql):
    """Run one warm-up call to load catalog caches, then measure warm EXPLAIN buffers + table/seat tuple-read deltas."""
    q('SELECT pg_stat_force_next_flush();')
    stat_sql = """SELECT json_build_object(
                 'seats_tuples', coalesce(pg_stat_get_tuples_returned('table_seats'::regclass), 0)
                                 + coalesce(pg_stat_get_tuples_fetched('table_seats'::regclass), 0)
                                 + coalesce(pg_stat_get_tuples_returned('idx_table_seats_active_tbl'::regclass), 0),
                 'tables_tuples', coalesce(pg_stat_get_tuples_returned('tables'::regclass), 0)
                                  + coalesce(pg_stat_get_tuples_fetched('tables'::regclass), 0)
                                  + coalesce(pg_stat_get_tuples_returned('tables_pkey'::regclass), 0)
                                  + coalesce(pg_stat_get_tuples_returned('idx_tables_cluster_id'::regclass), 0)
                                  + coalesce(pg_stat_get_tuples_returned('idx_tables_status'::regclass), 0)
               );"""
    before = json.loads(q(stat_sql))
    raw = q(
        f"""
        SET enable_seqscan = off;
        DO $$ BEGIN PERFORM ({sql.replace('SELECT * FROM ', 'SELECT count(*) FROM ')}); END $$;
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql};
        SELECT pg_stat_force_next_flush();
        """
    )
    plan_text = '\n'.join(
        ln for ln in raw.splitlines()
        if ln.strip() and not ln.strip().startswith(('DO', 'SET'))
    )
    plan = json.loads(plan_text)[0]['Plan']
    bufs = int(plan.get('Shared Hit Blocks', 0)) + int(plan.get('Shared Read Blocks', 0))
    after = json.loads(q(stat_sql))
    return {
        'buffers': bufs,
        'seats_tuples': (int(after['seats_tuples']) - int(before['seats_tuples'])) // 2,
        'tables_tuples': (int(after['tables_tuples']) - int(before['tables_tuples'])) // 2,
    }


def query_sets():
    census = json.loads(
        q(
            """SELECT coalesce(json_agg(row_to_json(c) ORDER BY c.table_id), '[]'::json)
               FROM public.fn_cash_hourly_table_census() c;"""
        )
    )
    admissions = json.loads(
        q(
            """SELECT coalesce(json_agg(row_to_json(a) ORDER BY a.table_id), '[]'::json)
               FROM public.fn_cash_hourly_table_admissions() a;"""
        )
    )
    drain = q('SELECT coalesce(public.fn_cash_hourly_table_drain_candidate()::text, \'\');')
    return census, admissions, drain


try:
    run([PG / 'initdb', '-D', w / 'd', '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'])
    run([PG / 'pg_ctl', '-D', w / 'd', '-l', w / 'pg.log', '-o', f"-h '' -k {sock}", '-w', 'start'])
    q(sibling_schema())
    # Real occupancy cashout fixture so closure + replay are also proved.
    q(
        """
        CREATE TABLE test_cashouts(occupancy_id uuid PRIMARY KEY, amount numeric, receipt jsonb);
        CREATE OR REPLACE FUNCTION public.fn_cashout_seat_occupancy(
          p_user_id uuid, p_table_id uuid, p_seat_number integer, p_occupancy_id uuid, p_leave_mode text DEFAULT NULL
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        DECLARE s public.table_seats%ROWTYPE; r jsonb;
        BEGIN
          SELECT receipt INTO r FROM public.test_cashouts WHERE occupancy_id = p_occupancy_id;
          IF FOUND THEN RETURN r; END IF;
          SELECT * INTO STRICT s FROM public.table_seats
           WHERE occupancy_id = p_occupancy_id AND table_id = p_table_id
             AND user_id = p_user_id AND seat_number = p_seat_number AND left_at IS NULL FOR UPDATE;
          r := jsonb_build_object('ok', true, 'stack', s.stack, 'credited', true,
                                  'seat_number', p_seat_number, 'occupancy_id', p_occupancy_id,
                                  'user_id', p_user_id, 'table_id', p_table_id);
          UPDATE public.profiles SET balance = balance + s.stack WHERE id = p_user_id;
          UPDATE public.table_seats SET left_at = clock_timestamp() WHERE id = s.id;
          INSERT INTO public.test_cashouts VALUES (p_occupancy_id, s.stack, r);
          RETURN r;
        END $$;
        """
    )
    for fixture in [
        'hourly-cash-caps/roster.sql',
        'hourly-cash-caps/lightning-legality.sql',
        'unattended-offer-preimage.sql',
    ]:
        q((FIX / fixture).read_text())
    q(
        'CREATE TRIGGER roster_guard BEFORE INSERT OR UPDATE OF user_id,table_id,left_at ON table_seats '
        'FOR EACH ROW WHEN(NEW.left_at IS NULL) EXECUTE FUNCTION fn_ca_horse_roster_seat_guard();'
    )
    for name in [
        '20261116153902_enforce_owner_hourly_cash_table_caps_with_human_expansion.sql',
        '20261116194028_human_started_cash_games_remain_additional_hourly_capacity.sql',
        '20261112105743_lightning_throughput_baseline_names_the_installed_admission_.sql',
        '20261116200642_cash_throughput_cohorts_name_the_adopted_hourly_admission_co.sql',
        '20261020201931_unattended_cash_game_offers.sql',
        '20261023094000_a_lapsed_game_seat_offer_leaves_the_waitlist.sql',
    ]:
        q((MIG / name).read_text())
    q(
        'BEGIN;'
        + function_block(
            MIG / '20261121174545_full_ring_feeder_and_opening_count_honour_hourly_cap.sql',
            'fn_cash_hourly_feeder_admissible',
            '$f$;',
        )
        + 'COMMIT;'
    )
    q((MIG / '20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql').read_text())

    # 1. Verify exact live preimage MD5s pinned by the candidate migration.
    digests = json.loads(
        q(
            """SELECT json_object_agg(s, md5(pg_get_functiondef(('public.' || s)::regprocedure)))
               FROM unnest(ARRAY[
                 'fn_cash_hourly_table_census()',
                 'fn_cash_hourly_table_drain_candidate()',
                 'fn_cash_hourly_table_close(uuid,uuid,text,uuid)',
                 'fn_cash_hourly_table_admissions()'
               ]) s;"""
        )
    )
    pinned = dict(
        re.findall(r"\('(fn_cash_hourly_table_[a-z_]+\([a-z,]*\))',\s*'([0-9a-f]{32})'\)", CANDIDATE.read_text())
    )
    check(len(pinned) == 4, 'migration pins all 4 hourly cash functions')
    for sig, digest in pinned.items():
        check(digests.get(sig) == digest, f'preimage digest matches installed {sig}')

    old_cohort = q('SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy();')
    cap = int(q('SELECT table_cap FROM public.fn_cash_hourly_table_range();'))

    # Seed realistic floor:
    # - 1 Lightning cluster with 600 historical closed tables + 2 open tables (1 human + 1 horse-only)
    # - cap + 1 additional standalone horse-only tables (pushes floor over cap)
    # - 1 human-started standalone table (exempt additional capacity)
    # - 1 empty opening feeder (20261123013241 reservation)
    # - 1 empty open cash table
    q(
        f"""
        ALTER TABLE table_seats DISABLE TRIGGER roster_guard;
        INSERT INTO profiles(id, is_horse)
          SELECT md5('horse' || i)::uuid, true FROM generate_series(1, 200) i;
        INSERT INTO ca_horse_active_roster SELECT id FROM profiles;
        INSERT INTO profiles(id, is_horse) VALUES
          (md5('human-ltg')::uuid, false),
          (md5('human-start')::uuid, false);

        INSERT INTO cash_games(id, cluster_mode) VALUES
          (md5('ltg-cluster')::uuid, 'lightning'),
          (md5('ltg-horse-cluster')::uuid, 'lightning'),
          (md5('mm-cluster')::uuid, 'must_move');

        -- 600 historical closed tables in a horse-only Lightning cluster (with closed seats)
        -- Reproduces production SubPlan 3 worst case where EXISTS returns FALSE only after
        -- scanning every historical closed table in the cluster for each open table.
        INSERT INTO tables(id, cluster_id, status, lifecycle, created_at)
          SELECT md5('closed-ltg-' || i)::uuid, md5('ltg-horse-cluster')::uuid, 'closed', 'closed',
                 now() - (i || ' minutes')::interval
          FROM generate_series(1, 600) i;
        INSERT INTO table_seats(table_id, user_id, seat_number, left_at)
          SELECT md5('closed-ltg-' || i)::uuid, md5('horse' || ((i % 50) + 1))::uuid, 1, now() - interval '1 hour'
          FROM generate_series(1, 600) i;

        -- 6 open horse-only tables in ltg-horse-cluster (0 humans)
        INSERT INTO tables(id, cluster_id, status, lifecycle, created_at)
          SELECT md5('open-ltg-h-' || i)::uuid, md5('ltg-horse-cluster')::uuid, 'running', 'live',
                 now() - (40 + i || ' minutes')::interval
          FROM generate_series(1, 6) i;
        INSERT INTO table_seats(table_id, user_id, seat_number)
          SELECT md5('open-ltg-h-' || i)::uuid, md5('horse' || (100 + i))::uuid, 1
          FROM generate_series(1, 6) i;

        -- 2 open Lightning tables: ltg-human has a human, ltg-horses has only horses (protected by cluster!)
        INSERT INTO tables(id, cluster_id, status, lifecycle, created_at) VALUES
          (md5('ltg-human')::uuid, md5('ltg-cluster')::uuid, 'running', 'live', now() - interval '30 minutes'),
          (md5('ltg-horses')::uuid, md5('ltg-cluster')::uuid, 'running', 'live', now() - interval '25 minutes');
        INSERT INTO table_seats(table_id, user_id, seat_number) VALUES
          (md5('ltg-human')::uuid, md5('human-ltg')::uuid, 1),
          (md5('ltg-horses')::uuid, md5('horse1')::uuid, 1),
          (md5('ltg-horses')::uuid, md5('horse2')::uuid, 2);

        -- cap + 1 standalone horse-only tables (makes newest table excess)
        INSERT INTO tables(id, status, lifecycle, created_at)
          SELECT md5('horse-tbl-' || i)::uuid, 'running', 'live', now() + i * interval '1 second'
          FROM generate_series(1, {cap + 1}) i;
        INSERT INTO table_seats(table_id, user_id, seat_number)
          SELECT md5('horse-tbl-' || i)::uuid, md5('horse' || (10 + i))::uuid, 1
          FROM generate_series(1, {cap + 1}) i;

        -- 1 human-started table above cap (exempt additional capacity)
        INSERT INTO tables(id, status, lifecycle, created_at) VALUES
          (md5('human-started')::uuid, 'running', 'live', now() + interval '5 minutes');
        INSERT INTO table_seats(table_id, user_id, seat_number) VALUES
          (md5('human-started')::uuid, md5('human-start')::uuid, 1);
        INSERT INTO cash_hourly_table_origins(table_id, human_started) VALUES
          (md5('human-started')::uuid, true);

        -- 50 active tournament tables x 8 seats = 400 active tournament seats (mirrors production peak
        -- where active tournament seats outnumber cluster tables so SubPlan 3 drives from cluster_id).
        INSERT INTO tables(id, tournament_id, status, lifecycle, created_at)
          SELECT md5('tourn-tbl-' || i)::uuid, md5('tourn-1')::uuid, 'running', 'live', now()
          FROM generate_series(1, 50) i;
        INSERT INTO table_seats(table_id, user_id, seat_number)
          SELECT md5('tourn-tbl-' || t)::uuid, md5('horse' || ((t + s) % 180 + 1))::uuid, s
          FROM generate_series(1, 50) t, generate_series(1, 8) s;

        -- 1 empty opening feeder + 1 empty cash table
        INSERT INTO tables(id, cluster_id, role, status, lifecycle, created_at) VALUES
          (md5('opening-feeder')::uuid, md5('mm-cluster')::uuid, 'feeder', 'waiting', 'opening', now()),
          (md5('empty-cash')::uuid, NULL, 'main', 'waiting', 'live', now());

        INSERT INTO engine_table_leases
          SELECT id, 'engine', md5('lease')::uuid FROM tables WHERE status IN ('waiting', 'running');
        UPDATE cash_hourly_table_pacing
          SET enabled_instance_id = 'engine', next_open_at = '-infinity', next_close_at = '-infinity'
          WHERE scope = 'floor';
        ALTER TABLE table_seats ENABLE TRIGGER roster_guard;
        CREATE INDEX idx_tables_cluster_id ON tables(cluster_id);
        CREATE INDEX idx_tables_status ON tables(status);
        CREATE INDEX idx_table_seats_active_tbl ON table_seats(table_id) WHERE left_at IS NULL;
        ANALYZE tables, table_seats, profiles, cash_games;
        """
    )

    # Capture BEFORE-migration exact result sets and warm probe/buffer counts (RED proof).
    before_census, before_admissions, before_drain = query_sets()
    before_census_m = measure_warm_call('SELECT * FROM public.fn_cash_hourly_table_census()')
    before_adm_m = measure_warm_call('SELECT * FROM public.fn_cash_hourly_table_admissions()')

    # Human-occupied close BEFORE migration (when floor is not closure-paced) still scans entire floor.
    op_human_before = q('SELECT gen_random_uuid();')
    before_human_close_m = measure_warm_call(
        f"SELECT public.fn_cash_hourly_table_close(md5('ltg-human')::uuid, '{op_human_before}', 'engine', md5('lease')::uuid)"
    )

    # Paced drain_candidate BEFORE migration returns NULL.
    q("UPDATE cash_hourly_table_pacing SET next_close_at = clock_timestamp() + interval '5 minutes' WHERE scope = 'floor';")
    before_paced_drain = q("SELECT coalesce(public.fn_cash_hourly_table_drain_candidate()::text, '');")
    q("UPDATE cash_hourly_table_pacing SET next_close_at = '-infinity' WHERE scope = 'floor';")

    check(before_drain == q(f"SELECT md5('horse-tbl-{cap + 1}')::uuid;"), 'before: newest horse-only table is excess drain candidate')
    check(before_paced_drain == '', 'before: paced drain candidate is NULL')
    check(
        before_census_m['seats_tuples'] + before_census_m['tables_tuples'] >= 600,
        f"RED before: census scanned closed cluster tables/seats ({before_census_m})",
    )
    check(
        before_human_close_m['seats_tuples'] + before_human_close_m['tables_tuples'] >= 600,
        f"RED before: human-occupied table close still scanned whole floor ({before_human_close_m})",
    )

    # 2. Apply candidate migration.
    q(CANDIDATE.read_text())

    # 3. Verify AFTER-migration exact set equality + massive tuple/buffer drop (GREEN proof).
    after_census, after_admissions, after_drain = query_sets()
    check(after_census == before_census, 'GREEN: fn_cash_hourly_table_census() output is 100% identical')
    check(after_admissions == before_admissions, 'GREEN: fn_cash_hourly_table_admissions() output is 100% identical')
    check(after_drain == before_drain, 'GREEN: fn_cash_hourly_table_drain_candidate() output is 100% identical')

    # Confirm Lightning horse-only table is protected by human on ltg-human.
    ltg_horse_row = next(r for r in after_census if r['table_id'] == q("SELECT md5('ltg-horses')::uuid;"))
    check(ltg_horse_row['humans'] == 1, 'Lightning cross-table human protection preserved')

    after_census_m = measure_warm_call('SELECT * FROM public.fn_cash_hourly_table_census()')
    after_adm_m = measure_warm_call('SELECT * FROM public.fn_cash_hourly_table_admissions()')
    before_census_work = before_census_m['seats_tuples'] + before_census_m['tables_tuples']
    after_census_work = after_census_m['seats_tuples'] + after_census_m['tables_tuples']
    check(
        after_census_work * 1.5 < before_census_work
        and after_census_m['buffers'] * 1.5 < before_census_m['buffers'],
        f"GREEN: census tuple reads & buffers dropped >1.5x ({before_census_m} -> {after_census_m})",
    )
    before_adm_work = before_adm_m['seats_tuples'] + before_adm_m['tables_tuples']
    after_adm_work = after_adm_m['seats_tuples'] + after_adm_m['tables_tuples']
    check(
        after_adm_work * 2 < before_adm_work and after_adm_m['buffers'] * 1.5 < before_adm_m['buffers'],
        f"GREEN: admissions tuple reads (>2x) & buffers (>1.5x) dropped ({before_adm_m} -> {after_adm_m})",
    )

    # Verify closure-paced drain_candidate short-circuits without touching census.
    q("UPDATE cash_hourly_table_pacing SET next_close_at = clock_timestamp() + interval '5 minutes' WHERE scope = 'floor';")
    check(q("SELECT public.fn_cash_hourly_table_drain_candidate() IS NULL;") == 't', 'paced drain_candidate returns NULL')
    after_paced_drain_m = measure_warm_call('SELECT public.fn_cash_hourly_table_drain_candidate()')
    check(
        after_paced_drain_m['tables_tuples'] == 0 and after_paced_drain_m['seats_tuples'] == 0,
        f"GREEN: paced drain_candidate reads 0 table/seat tuples ({after_paced_drain_m})",
    )

    # Verify fn_cash_hourly_table_close fast-paths (paced, human-occupied, empty).
    op_paced = q('SELECT gen_random_uuid();')
    res_paced = json.loads(
        q(f"SELECT public.fn_cash_hourly_table_close(md5('horse-tbl-1')::uuid, '{op_paced}', 'engine', md5('lease')::uuid);")
    )
    check(res_paced == {'closed': False, 'reason': 'within_cap_or_human'}, 'close fast-path on paced floor')

    q("UPDATE cash_hourly_table_pacing SET next_close_at = '-infinity' WHERE scope = 'floor';")
    op_human = q('SELECT gen_random_uuid();')
    human_close_m = measure_warm_call(
        f"SELECT public.fn_cash_hourly_table_close(md5('ltg-human')::uuid, '{op_human}', 'engine', md5('lease')::uuid)"
    )
    res_human = json.loads(
        q(f"SELECT public.fn_cash_hourly_table_close(md5('ltg-human')::uuid, '{op_human}', 'engine', md5('lease')::uuid);")
    )
    check(res_human == {'closed': False, 'reason': 'within_cap_or_human'}, 'close fast-path on human-occupied table')
    check(
        human_close_m['tables_tuples'] <= 2 and human_close_m['seats_tuples'] <= 4,
        f"GREEN: human-occupied close fast-path avoids floor scan ({human_close_m})",
    )

    op_empty = q('SELECT gen_random_uuid();')
    res_empty = json.loads(
        q(f"SELECT public.fn_cash_hourly_table_close(md5('empty-cash')::uuid, '{op_empty}', 'engine', md5('lease')::uuid);")
    )
    check(res_empty == {'closed': False, 'reason': 'within_cap_or_human'}, 'close fast-path on empty table')

    # Verify real over-cap close + idempotent replay still work identically.
    op_close = q('SELECT gen_random_uuid();')
    close_sql = f"SELECT public.fn_cash_hourly_table_close('{after_drain}', '{op_close}', 'engine', md5('lease')::uuid);"
    receipt = json.loads(q(close_sql))
    check(receipt['closed'] is True and len(receipt['departures']) == 1, 'over-cap horse-only table closes cleanly')
    replay_receipt = json.loads(q(close_sql))
    check(replay_receipt == receipt, 'close operation replay returns original receipt even while paced')
    check(int(q('SELECT count(*) FROM public.test_cashouts;')) == 1, 'replay executes zero duplicate cashouts')

    # Verify throughput cohort producer rotates cleanly and never goes NULL.
    new_cohort = q('SELECT hourly_fingerprint FROM public.fn_lightning_admission_policy();')
    check(new_cohort != '' and new_cohort != old_cohort, 'fn_lightning_admission_policy() rotates cleanly')

    # Verify ACLs and SECURITY DEFINER preserved on all 4 functions.
    for sig in [
        'fn_cash_hourly_table_census()',
        'fn_cash_hourly_table_drain_candidate()',
        'fn_cash_hourly_table_close(uuid,uuid,text,uuid)',
        'fn_cash_hourly_table_admissions()',
    ]:
        for role in ['anon', 'authenticated']:
            check(
                q(f"SELECT has_function_privilege('{role}', 'public.{sig}', 'EXECUTE');") == 'f',
                f'{sig} private from {role}',
            )
        check(
            q(f"SELECT has_function_privilege('service_role', 'public.{sig}', 'EXECUTE');") == 't',
            f'{sig} executable by service_role',
        )
        check(
            q(f"SELECT prosecdef FROM pg_proc WHERE oid = 'public.{sig}'::regprocedure;") == 't',
            f'{sig} keeps SECURITY DEFINER',
        )

    # Verify @live-proof SQL evaluates TRUE.
    m = re.search(r'^--\s*@live-proof:\s*(.+)$', CANDIDATE.read_text(), re.M)
    check(m is not None, 'migration declares @live-proof')
    check(q(f'SELECT ({m.group(1)}) IS TRUE;') == 't', '@live-proof evaluates TRUE')

    # Verify re-applying migration fails closed on preimage mismatch.
    replay_err = attempt(CANDIDATE.read_text())
    check(
        replay_err is not None and 'cash_hourly_census_perf_predecessor_changed' in replay_err,
        're-applying migration fails closed on changed preimage',
    )

    print(
        json.dumps(
            {
                'passed': len(passed),
                'postgres_version_num': q('SHOW server_version_num;'),
                'before_census': before_census_m,
                'after_census': after_census_m,
                'before_admissions': before_adm_m,
                'after_admissions': after_adm_m,
                'before_human_close': before_human_close_m,
                'after_human_close': human_close_m,
                'after_paced_drain': after_paced_drain_m,
            }
        )
    )
finally:
    if (w / 'd/postmaster.pid').exists():
        run([PG / 'pg_ctl', '-D', w / 'd', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(w)
