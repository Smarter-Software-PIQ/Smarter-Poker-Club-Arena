"""An unintended delay between hands pages within minutes (incident 075013fd, lane E5).

Proves, on a throwaway PostgreSQL cluster (no network, no production
connection), migration 20261119052955 exactly as it is on disk:

  * fn_ca_hand_gap_unintended_delay grades synthetic hand_history rows by
    shape the way scripts/sql/hand-gap-unintended-delay.sql does: a hand
    whose gap is exactly its owed beats grades 0 ms unintended (fold, river
    chips, checked river, all-in), and the window counts each pair once;
  * Lightning hands, gaps of 60 s or more, a recorded maintenance break and
    a tournament break are not graded; a cash bust and a run-it-twice hand
    are their own shapes, never over budget, never an alert;
  * fn_ca_hand_gap_watch records one history row per window x kind x shape,
    an on-time table gives no alert, one breached window gives no alert, two
    consecutive breached windows give ONE critical alert, a third breached
    window (and a re-run of the same window) adds none, and the alert
    resolves when the shape is back within the budget;
  * the cron job is the one the migration's live proof names.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILE = '20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql'
MIGRATION = ROOT / 'supabase' / 'migrations' / FILE

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/hand-gap-watch')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='hand-gap-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55852'
results = {'checks': [], 'production_mutations': False}


def command(args, sql=None):
    r = subprocess.run(list(map(str, args)), input=sql, text=True, capture_output=True, env=env, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(sql):
    return command([pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT,
                    '-U', 'postgres', '-d', 'postgres'], sql)


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


SCHEMA = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE hand_history(id uuid PRIMARY KEY, table_id uuid, tournament_id uuid, created_at timestamptz,
  started_at timestamptz, ended_at timestamptz, actions jsonb, players jsonb, pots jsonb, showdown jsonb,
  rit_boards jsonb);
CREATE INDEX idx_hand_history_created ON hand_history(created_at DESC);
CREATE INDEX idx_hand_history_table_created ON hand_history(table_id, created_at DESC);
CREATE TABLE lightning_hand(hand_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_history_id uuid);
CREATE INDEX idx_lightning_hand_hand_history_id ON lightning_hand(hand_history_id);
CREATE TABLE engine_maintenance_break_log(break_started_at timestamptz PRIMARY KEY, break_ended_at timestamptz);
CREATE TABLE tournaments(id uuid PRIMARY KEY, break_started_at timestamptz, break_ends_at timestamptz);
CREATE TABLE financial_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb DEFAULT '{}'::jsonb, resolved boolean DEFAULT false, resolved_at timestamptz,
  created_at timestamptz DEFAULT now(), resolved_by uuid, resolution text);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
"""

A, B = 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002'
U1, U2 = '11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002'
# Owed beats per shape, from src/config/handCompletionSpec.ts (heads-up, one pot):
OWED = {'fold': 500 + 1100 + 250 + 1500,
        'showdown_river_chips': 1400 + 1500 + 500 + 1100 + 250 + 1500,
        'showdown_checked_river': 1400 + 1500 + 1100 + 250 + 1500,
        'all_in_showdown': 1400 + 2000 + 1100 + 250 + 1500}
T0 = dt.datetime(2026, 11, 19, 12, 0, tzinfo=dt.timezone.utc)  # window k ends at T0 + 5k minutes
HAND_S = 10.0


def payload(shape):
    shown = [{'user_id': U1}, {'user_id': U2}]
    players = [{'userId': U1, 'stack': 100}, {'userId': U2, 'stack': 100}]
    actions = [{'stage': 'preflop', 'action': 'raise', 'amount': 2, 'userId': U1}]
    showdown = shown
    rit = None
    if shape == 'fold':
        showdown = []
    elif shape == 'showdown_river_chips':
        actions.append({'stage': 'river', 'action': 'bet', 'amount': 5, 'userId': U1})
    elif shape == 'all_in_showdown':
        actions.append({'stage': 'turn', 'action': 'all_in', 'amount': 98, 'userId': U2})
    elif shape == 'cash_bust':
        showdown = []
        players[1]['stack'] = 0
    elif shape == 'rit':
        rit = [['Ah'], ['Kd']]
    return {'actions': actions, 'players': players, 'showdown': showdown, 'rit_boards': rit,
            'pots': [{'awards': [{'userId': U1, 'amount': 10}]}]}


def table(shape, extra_ms, windows, tournament=None, lightning=False, gap_ms=None):
    """A table dealing `shape` hands across `windows` (list of window ends, as k), with
    extra_ms(k) unintended delay on the hands whose NEXT hand is written in window k."""
    tid = str(uuid.uuid4())
    owed = OWED.get(shape, OWED['fold'])
    start = T0 + dt.timedelta(minutes=5 * (min(windows) - 1)) - dt.timedelta(seconds=40)
    stop = T0 + dt.timedelta(minutes=5 * max(windows))
    rows, s = [], start
    while True:
        e = s + dt.timedelta(seconds=HAND_S)
        rows.append((s, e))
        guess_next_created = e + dt.timedelta(milliseconds=owed, seconds=HAND_S + 0.2)
        k = -(-int((guess_next_created - T0).total_seconds()) // 300)  # ceil to the window end index
        gap = gap_ms if gap_ms is not None else owed + extra_ms(k)
        s = e + dt.timedelta(milliseconds=gap)
        if s + dt.timedelta(seconds=HAND_S) > stop - dt.timedelta(seconds=1):
            break
    p = payload(shape)
    vals = []
    for s, e in rows:
        hid = str(uuid.uuid4())
        vals.append("('%s','%s',%s,'%s','%s','%s','%s','%s','%s','%s',%s)" % (
            hid, tid, f"'{tournament}'" if tournament else 'NULL', (e + dt.timedelta(milliseconds=200)).isoformat(),
            s.isoformat(), e.isoformat(), json.dumps(p['actions']), json.dumps(p['players']), json.dumps(p['pots']),
            json.dumps(p['showdown']), f"'{json.dumps(p['rit_boards'])}'" if p['rit_boards'] else 'NULL'))
    run('INSERT INTO hand_history(id, table_id, tournament_id, created_at, started_at, ended_at, actions, players,'
        ' pots, showdown, rit_boards) VALUES ' + ','.join(vals))
    if lightning:
        run(f"INSERT INTO lightning_hand(hand_history_id) SELECT id FROM hand_history WHERE table_id = '{tid}'")
    return tid


def grade(k):
    at = (T0 + dt.timedelta(minutes=5 * k)).isoformat()
    return {(r['kind'], r['shape']): r for r in json.loads(run(
        f"SELECT COALESCE(jsonb_agg(to_jsonb(g)), '[]') FROM fn_ca_hand_gap_unintended_delay('{at}', 5) g"))}


def watch(k):
    at = (T0 + dt.timedelta(minutes=5 * k, seconds=61)).isoformat()
    return json.loads(run(f"SELECT fn_ca_hand_gap_watch('{at}')"))


def alerts():
    return json.loads(run("""SELECT COALESCE(jsonb_agg(jsonb_build_array(context->>'kind', context->>'shape',
      severity, resolved) ORDER BY created_at), '[]') FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'"""))


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''",
                        '-l', cluster / 'log', '-w', 'start'])
    results['server_version'] = run('SHOW server_version')
    run(SCHEMA)
    run(MIGRATION.read_text())
    proof = MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('the migration installs as written and its live proof holds', run('SELECT ' + proof) == 't', proof)
    check('the grade is STABLE and the watch is not',
          run("SELECT string_agg(proname || ':' || provolatile::text, ',' ORDER BY proname) FROM pg_proc "
              "WHERE proname IN ('fn_ca_hand_gap_unintended_delay', 'fn_ca_hand_gap_watch')")
          == 'fn_ca_hand_gap_unintended_delay:s,fn_ca_hand_gap_watch:v')

    # Window 1 alone: every graded shape exactly on its owed beats, plus the exclusions.
    on_time = lambda k: 0
    for shape in OWED:
        table(shape, on_time, [1])
    tbust = table('cash_bust', lambda k: 4000, [1])
    table('rit', lambda k: 4000, [1])
    table('fold', lambda k: 3000, [1], lightning=True)
    table('fold', lambda k: 0, [1], gap_ms=61_000)
    g = grade(1)
    for shape in OWED:
        r = g.get(('cash', shape))
        check(f'grade: a {shape} hand on its owed beats is 0 ms unintended',
              r and r['graded'] and r['unintended_p95_ms'] == 0 and r['owed_p50_ms'] == OWED[shape]
              and r['over_budget'] == 0, r)
    r = g.get(('cash', 'cash_bust'))
    check('grade: a cash bust is its own shape, not graded, not over budget',
          r and not r['graded'] and r['over_budget'] is None and r['unintended_p50_ms'] >= 4000, r)
    r = g.get(('cash', 'rit'))
    check('grade: a run-it-twice hand is its own shape, not graded', r and not r['graded'] and r['over_budget'] is None, r)
    hands = sum(r['hands'] for r in g.values())
    fold = g[('cash', 'fold')]['hands']
    check('grade: Lightning hands and gaps of 60 s or more are not graded (only the on-time fold table counts)',
          g[('cash', 'fold')]['unintended_p99_ms'] == 0 and 15 <= fold <= 25, {'fold_hands': fold, 'all': hands})
    w = watch(1)
    check('watch: window 1 is recorded, one row per kind x shape, and nothing alerts',
          w['recorded'] == len(g) and w['opened'] == 0 and alerts() == [], w)
    check('watch: a re-run of the same window records nothing new',
          watch(1)['recorded'] == 0 and run('SELECT count(*) FROM ca_hand_gap_watch_history') == str(len(g)))

    # Windows 2..5: an on-time cash table, a tournament table 600 ms late in windows 2..4,
    # a cash bust table always 4 s "late", and two tournament tables whose delay sits in a break.
    tour, tbreak = str(uuid.uuid4()), str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id) VALUES ('{tour}');"
        f"INSERT INTO tournaments(id, break_started_at, break_ends_at) VALUES ('{tbreak}', '{T0.isoformat()}', "
        f"'{(T0 + dt.timedelta(hours=1)).isoformat()}')")
    table('fold', on_time, [2, 3, 4, 5])
    table('fold', lambda k: 600 if k in (2, 3, 4) else 40, [2, 3, 4, 5], tournament=tour)
    table('cash_bust', lambda k: 4000, [2, 3, 4, 5])
    table('showdown_river_chips', lambda k: 3000, [2, 3, 4, 5], tournament=tbreak)

    g2 = grade(2)
    check('grade: gaps inside the tournament break are not graded',
          ('tournament', 'showdown_river_chips') not in g2, sorted(g2))
    w2 = watch(2)
    check('watch: one breached window opens nothing',
          w2['opened'] == 0 and alerts() == [] and g2[('tournament', 'fold')]['unintended_p95_ms'] == 600, w2)
    w3 = watch(3)
    check('watch: the second consecutive breached window opens ONE critical alert, for that shape only',
          w3['opened'] == 1 and alerts() == [['tournament', 'fold', 'critical', False]], [w3, alerts()])
    ctx = json.loads(run("SELECT context FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'"))
    check('watch: the alert names the shape, both windows and the budget',
          ctx['unintended_p95_ms'] == 600 and ctx['previous_window_p95_ms'] == 600 and ctx['budget_ms'] == 250
          and ctx['hands'] >= 5, ctx)
    w3b = watch(3)
    w4 = watch(4)
    check('watch: a re-run and a third breached window add no second alert (deduplicated)',
          w3b['opened'] == 0 and w4['opened'] == 0 and w4['breaching'] == 1 and len(alerts()) == 1, [w3b, w4, alerts()])
    check('watch: the cash bust table is recorded and never alerts',
          run("SELECT bool_and(NOT graded AND over_budget IS NULL) AND count(*) = 4 FROM ca_hand_gap_watch_history "
              "WHERE kind = 'cash' AND shape = 'cash_bust'") == 't')
    w5 = watch(5)
    check('watch: the alert resolves when the shape is back within the budget',
          w5['resolved'] == 1 and alerts() == [['tournament', 'fold', 'critical', True]], [w5, alerts()])
    # Window 7: a maintenance break recorded across the whole window grades nothing.
    run(f"INSERT INTO engine_maintenance_break_log VALUES ('{(T0 + dt.timedelta(minutes=29)).isoformat()}', "
        f"'{(T0 + dt.timedelta(minutes=36)).isoformat()}')")
    table('all_in_showdown', lambda k: 3000, [7])
    check('grade: gaps inside a recorded maintenance break are not graded', grade(7) == {}, sorted(grade(7)))
    msgs = run("SELECT count(DISTINCT message) FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'")
    check('watch: the message is constant, so one cause is one incident', msgs == '1', msgs)
    results['history_rows'] = int(run('SELECT count(*) FROM ca_hand_gap_watch_history'))
    results['passed'] = True
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2, default=str) + '\n')

print(json.dumps({'passed': results.get('passed', False), 'checks': len(results['checks']),
                  'failed': [c for c in results['checks'] if not c['passed']]}, indent=2))
