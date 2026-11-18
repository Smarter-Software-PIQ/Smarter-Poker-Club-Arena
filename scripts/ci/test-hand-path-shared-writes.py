"""A hand's money path never writes a shared row; post-commit lag warns early.

Proves, on a throwaway PostgreSQL cluster (no network, no production
connection), the two guards of incident 075013fd lane F:

  G1  scripts/ci/hand-path-shared-writes.mjs (the live reader
      fn_ca_hand_path_shared_writes() and the applier check):
      1. its rules on a small synthetic catalog (calls, triggers with event
         and UPDATE OF columns, NOWAIT, FOR UPDATE OF, advisory forms, the
         bankers, string literals, depth bounds, the shared-key derivation,
         a missing door);
      2. on the PRODUCTION texts the r5 harness rebuilds (fixtures
         cash-rake-pending and hand-bank-pending, md5-equal to production on
         2026-11-18): every shared write #11270 and #11266 remove is reported
         BEFORE, and is gone AFTER the four migrations
         (20261118034950, 20261118035606, 20261118071728, 20261118071736),
         each applied through the applier's own wrapping so the in-applier
         check admits them;
      3. the applier refuses, inside the migration's own transaction, a
         migration that ADDS a shared write to the hand path (nothing is
         installed), admits the same file when it declares it, and splices
         nothing into a data-only file.
  G2  fn_ca_post_commit_lag_watch() (20261118084759): warns per table when
      p95 commit->post_commit_completed_at over five minutes exceeds 2 s,
      goes critical above 15 s or for a hand pending 15 s, never raises twice
      for one table, escalates, resolves when the lag clears, and caps new
      alerts per run.
"""
import argparse
import ast
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
R5 = ROOT / 'scripts' / 'ci' / 'test-deadlock-lock-orders-r5.py'
MODULE = ROOT / 'scripts' / 'ci' / 'hand-path-shared-writes.mjs'
G1_FILE = '20261118084747_a_hands_money_path_never_writes_a_shared_row.sql'
G2_FILE = '20261118084759_post_commit_lag_warns_before_the_cascade.sql'
CHECKED = '20261118090000_applier_proof.sql'  # a name the applier checks

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/hand-path-shared-writes')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='hand-path-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55841'
results = {'checks': [], 'production_mutations': False}


def psql(db):
    return [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', db]


def command(args, sql=None):
    r = subprocess.run(list(map(str, args)), input=sql, text=True, capture_output=True, env=env, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(db, sql):
    return command(psql(db), sql)


def attempt(db, sql):
    r = subprocess.run(list(map(str, psql(db))), input=sql, text=True, capture_output=True, env=env, timeout=300)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def node(expr):
    """Evaluate a JS expression with the module imported as m; print its string result."""
    script = (f"import * as m from {json.dumps(str(MODULE))};\n"
              f"const r = await (async () => {{ {expr} }})();\nprocess.stdout.write(typeof r === 'string' ? r : JSON.stringify(r));\n")
    return command(['node', '--input-type=module', '-e', script])


def guarded(name, sql):
    """The migration exactly as the applier would send it (hand-path splice only)."""
    tmp = cluster / 'm.sql'
    tmp.write_text(sql)
    if as_owner:
        shutil.chown(tmp, 'postgres')
    return node(f"""
      const fs = await import('node:fs');
      const src = fs.readFileSync({json.dumps(str(tmp))}, 'utf8');
      return m.handPathGuardSQL({json.dumps(name)}, src, src);""")


def answer(db):
    return json.loads(run(db, 'SELECT public.fn_ca_hand_path_shared_writes()'))


def keys(a):
    return {f"{v['function']}|{v['kind']}|{v['target']}" for v in a['violations']}


# ── the r5 harness's production-shaped schema, read from its source ────────
R5_NAMES = {'RU', 'RC', 'RT1', 'RT2', 'RP1', 'RP2', 'BANK_POOL', 'RAKE_SCHEMA', 'RAKE_TRIGGERS', 'BANK_SCHEMA',
            'BANK_TRIGGERS', 'ROLES', 'RAKE_FIXTURE', 'BANK_FIXTURE', 'RAKE_PART1', 'RAKE_SWITCH', 'BANK_PART1',
            'BANK_SWITCH'}
r5 = {'ROOT': ROOT, 'pathlib': pathlib}
for node_ in ast.parse(R5.read_text()).body:
    if isinstance(node_, ast.Assign) and len(node_.targets) == 1 and isinstance(node_.targets[0], ast.Name) \
            and node_.targets[0].id in R5_NAMES:
        exec(compile(ast.Module([node_], []), str(R5), 'exec'), r5)
missing = R5_NAMES - set(r5)
if missing:
    raise SystemExit(f'r5 harness no longer defines {sorted(missing)}')


def load_fixture(db, fixture, label):
    for name, f in fixture['functions'].items():
        run(db, 'SET check_function_bodies = off;\n' + f['definition'] + ';')
        got = run(db, f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))")
        check(f'{label}: {name} is the production text', got == f['md5'], got)


def production_before(db):
    """Production on 2026-11-18 for these functions: no #11256/#11266 file installed."""
    run('postgres', f'CREATE DATABASE {db}')
    run(db, r5['RAKE_SCHEMA'])
    load_fixture(db, json.loads(r5['RAKE_FIXTURE'].read_text()), 'cash rake')
    run(db, r5['RAKE_TRIGGERS'])
    run(db, r5['BANK_SCHEMA'])
    load_fixture(db, json.loads(r5['BANK_FIXTURE'].read_text()), 'hand bank')
    run(db, r5['BANK_TRIGGERS'])
    # The two commit doors are not in the fixtures (their production text
    # reaches hundreds of functions this schema does not build); empty
    # stand-ins keep the doors present, so the measurement is of the
    # post-commit envelope, which is what #11270/#11266 change.
    run(db, 'CREATE FUNCTION fn_ca_commit_hand_settlement() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;'
            'CREATE FUNCTION fn_ca_commit_hand_submission() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;')
    run(db, (MIGRATIONS / G1_FILE).read_text())


# What #11270 (re-land of #11256) and #11266 take off the hand path, as the
# reader names it on production's text.
REMOVED = {
    'atomic_distribute_rake|write|union_wallets',
    'atomic_distribute_rake|write|club_wallets',
    'bbj_record_contribution|row_lock|bbj_pools',
    'bbj_record_contribution|write|bbj_pools',
    'fn_bbj_allocate|row_lock|ca_bbj_alloc_state',
    'fn_bbj_allocate|write|ca_bbj_alloc_state',
    'fn_ca_process_hand_post_commit_obligations|advisory_lock|bbj-pool:',
    'fn_ca_process_hand_post_commit_obligations|row_lock|bbj_pools',
    'fn_ca_process_hand_post_commit_obligations|write|bbj_pools',
    'record_insurance_transaction|write|union_wallets',
    'record_insurance_transaction|write|club_wallets',
}

SYNTH = """
CREATE TABLE unions(id uuid PRIMARY KEY);
CREATE TABLE clubs(id uuid PRIMARY KEY, union_id uuid, total_rake numeric DEFAULT 0, table_count int DEFAULT 0);
CREATE TABLE union_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid UNIQUE, rake_wallet numeric DEFAULT 0);
CREATE TABLE union_rake_weekly(union_id uuid, club_id uuid, week_start date, rake numeric,
  PRIMARY KEY (union_id, club_id, week_start));
CREATE TABLE club_table_rake_totals(club_id uuid, table_id uuid, rake numeric, PRIMARY KEY (club_id, table_id));
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, stack numeric, note text);
CREATE TABLE table_seats(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, status text);

-- a call that writes the union's wallet: a violation, with its path
CREATE FUNCTION fn_synth_bank_rake(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = u; END $$;
-- NOWAIT on the same table in the same function: allowed
CREATE FUNCTION fn_synth_nowait(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM union_wallets WHERE union_id = u FOR NO KEY UPDATE NOWAIT;
      UPDATE union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = u; END $$;
-- FOR UPDATE OF a non-shared alias over a join with clubs: allowed
CREATE FUNCTION fn_synth_lock_of(t uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM tables tb JOIN clubs c ON c.id = tb.club_id WHERE tb.id = t FOR UPDATE OF tb; END $$;
-- FOR UPDATE on clubs: a violation
CREATE FUNCTION fn_synth_lock_club(c uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM clubs WHERE id = c FOR UPDATE; END $$;
-- advisory forms: blocking exclusive on a scope key is a violation; shared and try are not
CREATE FUNCTION fn_synth_adv(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('union-accounting:' || u::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('bbj-pool:' || u::text, 0));
  PERFORM pg_try_advisory_xact_lock(hashtextextended('insurance-bank:' || u::text, 0));
END $$;
-- a per-table row keyed (club_id, table_id) and a per-union-week row
CREATE FUNCTION fn_synth_totals(c uuid, t uuid, u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO club_table_rake_totals VALUES (c, t, 1) ON CONFLICT (club_id, table_id) DO UPDATE SET rake = club_table_rake_totals.rake + 1;
  INSERT INTO union_rake_weekly VALUES (u, c, current_date, 1) ON CONFLICT (union_id, club_id, week_start) DO UPDATE SET rake = union_rake_weekly.rake + 1;
END $$;
-- a banker: excluded with everything below it
CREATE FUNCTION fn_ca_bank_pending_cash_rake(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_synth_banker_only(h); END $$;
CREATE FUNCTION fn_synth_banker_only(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = h; END $$;
-- a name inside a string literal is not a call
CREATE FUNCTION fn_synth_literal_only() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET total_rake = 0 WHERE false; END $$;
-- trigger functions
CREATE FUNCTION fn_synth_seat_stack_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = table_count WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_seat_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = NEW.id; RETURN NEW; END $$;
CREATE TRIGGER t_stack AFTER UPDATE OF stack ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_seat_stack_trg();
CREATE TRIGGER t_leave AFTER UPDATE OF left_at ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_seat_leave_trg();
-- a chain of 13 calls: the 13th is beyond the call bound
DO $d$ BEGIN
  EXECUTE 'CREATE FUNCTION fn_synth_deep_13() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN UPDATE unions SET id = id WHERE false; END $b$';
  FOR i IN REVERSE 12..1 LOOP
    EXECUTE format('CREATE FUNCTION fn_synth_deep_%s() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN PERFORM fn_synth_deep_%s(); END $b$', i, i + 1);
  END LOOP;
END $d$;
CREATE FUNCTION fn_ca_process_hand_post_commit_obligations(h uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_synth_bank_rake(h); PERFORM fn_synth_nowait(h); PERFORM fn_synth_lock_of(h);
  PERFORM fn_synth_lock_club(h); PERFORM fn_synth_adv(h); PERFORM fn_synth_totals(h, h, h);
  PERFORM fn_ca_bank_pending_cash_rake(h);
  RAISE NOTICE 'see fn_synth_literal_only(%)', h;  -- comment: fn_synth_literal_only()
  PERFORM 'fn_synth_literal_only()';
  UPDATE table_seats SET stack = stack - 1 WHERE id = h;
  RETURN '{}';
END $$;
CREATE FUNCTION fn_ca_commit_hand_settlement() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM fn_synth_deep_1(); END $$;
CREATE FUNCTION fn_ca_commit_hand_submission() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
"""

LAG_SCHEMA = """
CREATE TABLE hand_atomic_commits(table_id uuid NOT NULL, hand_number bigint NOT NULL, hand_id uuid PRIMARY KEY,
  committed_at timestamptz NOT NULL, post_commit_payload jsonb, post_commit_completed_at timestamptz,
  UNIQUE (table_id, hand_number));
CREATE INDEX horse_accepted_window_time ON hand_atomic_commits(committed_at, hand_id);
CREATE INDEX idx_hand_atomic_commits_post_commit_pending ON hand_atomic_commits(table_id, hand_number)
  WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL;
CREATE TABLE tables(id uuid PRIMARY KEY, name text, club_id uuid, union_id uuid);
CREATE TABLE financial_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb DEFAULT '{}'::jsonb, resolved boolean DEFAULT false, resolved_at timestamptz,
  created_at timestamptz DEFAULT now(), resolved_by uuid, resolution text);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
"""


def lag_hands(db, table, n, lag_s, pending=False, age_s=60, start=0):
    """n hands on one table committed age_s ago, each finished lag_s later (or pending)."""
    done = 'NULL' if pending else f"committed_at + interval '{lag_s} seconds'"
    run(db, f"""
INSERT INTO hand_atomic_commits(table_id, hand_number, hand_id, committed_at, post_commit_payload)
SELECT '{table}', {start} + g, gen_random_uuid(), now() - interval '{age_s} seconds' + g * interval '1 second', '{{}}'::jsonb
  FROM generate_series(1, {n}) g;
UPDATE hand_atomic_commits SET post_commit_completed_at = {done}
 WHERE table_id = '{table}' AND hand_number > {start} AND hand_number <= {start} + {n};""")


def lag_alerts(db):
    return json.loads(run(db, """SELECT COALESCE(jsonb_agg(jsonb_build_array(context->>'table_id', severity, resolved)
      ORDER BY context->>'table_id', created_at, severity), '[]') FROM financial_alerts
      WHERE source = 'fn_ca_post_commit_lag_watch'"""))


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''",
                        '-l', cluster / 'log', '-w', 'start'])
    run('postgres', r5['ROLES'])

    # ── G1.1 the rules on a synthetic catalog ──────────────────────────────
    run('postgres', 'CREATE DATABASE synth')
    run('synth', SYNTH)
    run('synth', (MIGRATIONS / G1_FILE).read_text())
    a = answer('synth')
    k = keys(a)
    paths = {f"{v['function']}|{v['kind']}|{v['target']}": v['path'] for v in a['violations']}
    check('G1 rules: all three doors are found', sorted(a['roots']) == sorted(
        ['fn_ca_commit_hand_settlement', 'fn_ca_commit_hand_submission', 'fn_ca_process_hand_post_commit_obligations']), a['roots'])
    check('G1 rules: a call that writes the union wallet is a violation, with its path',
          paths.get('fn_synth_bank_rake|write|union_wallets') == 'fn_ca_process_hand_post_commit_obligations -> fn_synth_bank_rake', paths)
    check('G1 rules: a write after NOWAIT on the same table is allowed', not any(x.startswith('fn_synth_nowait|') for x in k), k)
    check('G1 rules: FOR UPDATE OF a non-shared alias is allowed', not any(x.startswith('fn_synth_lock_of|') for x in k), k)
    check('G1 rules: FOR UPDATE on clubs is a violation', 'fn_synth_lock_club|row_lock|clubs' in k, k)
    check('G1 rules: a blocking exclusive scope advisory lock is a violation; shared and try are not',
          {x for x in k if x.startswith('fn_synth_adv|')} == {'fn_synth_adv|advisory_lock|union-accounting:'}, k)
    check('G1 rules: a per-union-week key is shared, a per-table key is not',
          'fn_synth_totals|write|union_rake_weekly' in k and 'fn_synth_totals|write|club_table_rake_totals' not in k
          and 'union_rake_weekly' in a['shared_tables'] and 'club_table_rake_totals' not in a['shared_tables'], k)
    check('G1 rules: a banker and everything only it reaches are excluded',
          not any(x.startswith(('fn_ca_bank_pending_cash_rake|', 'fn_synth_banker_only|')) for x in k), k)
    check('G1 rules: a name in a string literal or a comment is not a call',
          not any(x.startswith('fn_synth_literal_only|') for x in k), k)
    check('G1 rules: an UPDATE OF trigger is followed only when the statement names its column',
          paths.get('fn_synth_seat_stack_trg|write|clubs') == 'fn_ca_process_hand_post_commit_obligations =T=> fn_synth_seat_stack_trg'
          and not any(x.startswith('fn_synth_seat_leave_trg|') for x in k), paths)
    check('G1 rules: the call bound stops at 12 calls',
          not any(x.startswith('fn_synth_deep_13|') for x in k) and a['closure'] > 0, k)
    run('synth', 'ALTER FUNCTION fn_ca_commit_hand_submission() RENAME TO fn_ca_commit_hand_submission_old')
    check('G1 rules: a missing door is reported, never read as clean',
          'fn_ca_commit_hand_submission' not in answer('synth')['roots'])
    run('synth', 'ALTER FUNCTION fn_ca_commit_hand_submission_old() RENAME TO fn_ca_commit_hand_submission')

    # ── G1.3 the applier check ─────────────────────────────────────────────
    adds = """BEGIN;
CREATE FUNCTION fn_synth_new_union_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = NEW.hand_id; RETURN NEW; END $$;
CREATE TRIGGER t_new AFTER UPDATE OF stack ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_new_union_write();
COMMIT;
"""
    status, _, err = attempt('synth', guarded(CHECKED, adds))
    check('G1 applier: a migration that adds a shared write to the hand path is refused',
          status != 0 and 'migration_adds_a_shared_write_to_the_hand_path' in err
          and 'fn_synth_new_union_write write union_wallets' in err, err[-400:])
    check('G1 applier: nothing of the refused migration is installed',
          run('synth', "SELECT to_regprocedure('fn_synth_new_union_write()') IS NULL AND NOT EXISTS "
                       "(SELECT 1 FROM pg_trigger WHERE tgname = 't_new')") == 't')
    declared = '-- @hand-path-shared-write-ok: fn_synth_new_union_write write union_wallets proof of the declaration\n' + adds
    status, _, err = attempt('synth', guarded(CHECKED, declared))
    check('G1 applier: the same migration installs when it declares the write', status == 0, err[-400:])
    removes = 'BEGIN;\nDROP TRIGGER t_new ON table_seats;\nDROP FUNCTION fn_synth_new_union_write();\nCOMMIT;\n'
    status, _, err = attempt('synth', guarded(CHECKED, removes))
    check('G1 applier: a migration that removes a violation installs', status == 0, err[-400:])
    data_only = "BEGIN;\nUPDATE clubs SET total_rake = 0 WHERE false;\nCOMMIT;\n"
    check('G1 applier: a data-only migration carries no splice', guarded(CHECKED, data_only) == data_only.strip())
    check('G1 applier: a file before the cutover carries no splice',
          guarded('20261118000000_old.sql', adds) == adds.strip())
    drops_door = 'BEGIN;\nDROP FUNCTION fn_ca_commit_hand_submission();\nCOMMIT;\n'
    status, _, err = attempt('synth', guarded(CHECKED, drops_door))
    check('G1 applier: dropping a hand door without naming its successor is refused',
          status != 0 and 'hand_path_door_missing' in err, err[-300:])

    # ── G1.2 production texts, before and after #11270 / #11266 ───────────
    production_before('handpre')
    before = answer('handpre')
    results['production_before'] = before
    check('G1 production BEFORE: every shared write #11270/#11266 remove is reported',
          REMOVED <= keys(before), sorted(REMOVED - keys(before)))
    for f in (r5['RAKE_PART1'], r5['RAKE_SWITCH'], r5['BANK_PART1'], r5['BANK_SWITCH']):
        status, _, err = attempt('handpre', guarded(CHECKED, (MIGRATIONS / f).read_text()))
        check(f'G1 production: the applier check admits {f}', status == 0, err[-600:])
    after = answer('handpre')
    results['production_after'] = after
    check('G1 production AFTER: none of them remains on the hand path',
          not (REMOVED & keys(after)), sorted(REMOVED & keys(after)))
    check('G1 production AFTER: nothing new appeared', keys(after) <= keys(before), sorted(keys(after) - keys(before)))
    banker = run('handpre', "SELECT count(*) FROM pg_proc WHERE proname IN "
                            "('fn_ca_bank_pending_cash_rake', 'fn_ca_bank_pending_hand_obligations')")
    check('G1 production AFTER: both bankers are installed (and excluded by name)', banker == '2', banker)

    # ── G2 the lag watch ───────────────────────────────────────────────────
    run('postgres', 'CREATE DATABASE lag')
    run('lag', LAG_SCHEMA)
    status, _, err = attempt('lag', guarded(CHECKED, (MIGRATIONS / G2_FILE).read_text()))
    check('G2: the migration installs through the applier check', status == 0, err[-600:])
    check('G2: one detector job, every minute',
          run('lag', "SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'post-commit-lag-watch-1m'")
          == '* * * * * select public.fn_ca_post_commit_lag_watch()')
    T = [f'7a000000-0000-0000-0000-0000000000{i:02d}' for i in range(1, 16)]
    run('lag', 'INSERT INTO tables(id, name) SELECT t::uuid, \'T\' || row_number() OVER () FROM unnest(ARRAY[%s]) t'
        % ','.join(f"'{t}'" for t in T))
    lag_hands('lag', T[0], 10, 0.4)                    # healthy
    lag_hands('lag', T[1], 10, 3.0)                    # p95 3 s: warning
    lag_hands('lag', T[2], 3, 1.0)                     # too few hands to judge p95
    lag_hands('lag', T[3], 1, 0, pending=True, age_s=20)  # one hand pending 20 s: critical
    first = json.loads(run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()'))
    results['lag_first'] = first
    alerts = lag_alerts('lag')
    check('G2: a healthy table and a thin sample raise nothing; 3 s p95 warns; a 20 s pending hand is critical',
          alerts == [[T[1], 'warning', False], [T[3], 'critical', False]], alerts)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    check('G2: a second run raises nothing new for the same tables', lag_alerts('lag') == alerts, lag_alerts('lag'))
    lag_hands('lag', T[1], 10, 20.0, start=100)       # the warning table goes past 15 s
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    al = lag_alerts('lag')
    check('G2: a warning table that crosses 15 s escalates: warning resolved, one critical open',
          [x for x in al if x[0] == T[1]] == [[T[1], 'warning', True], [T[1], 'critical', False]], al)
    run('lag', f"UPDATE hand_atomic_commits SET post_commit_completed_at = committed_at + interval '0.3 seconds' "
               f"WHERE table_id IN ('{T[1]}', '{T[3]}')")
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    check('G2: when the lag clears every open alert resolves',
          run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved") == '0',
          lag_alerts('lag'))
    for t in T[4:]:
        lag_hands('lag', t, 6, 4.0, start=200)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    opened = run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved")
    check('G2: a storm opens at most 10 alerts per run', opened == '10', opened)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    opened = run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved")
    check('G2: the next run names the rest', opened == '11', opened)
    results['passed'] = True
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2, default=str) + '\n')

print(json.dumps({'passed': results.get('passed', False), 'checks': len(results['checks']),
                  'failed': [c for c in results['checks'] if not c['passed']]}, indent=2))
