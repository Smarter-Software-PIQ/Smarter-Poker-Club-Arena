"""An unintended delay between hands pages after 15 minutes and grades cadence (incident 075013fd, lane 3).

Proves, on a throwaway PostgreSQL cluster (no network, no production
connection), migrations 20261119052955 and 20261119180500 exactly as on disk:

  * hand_history.cadence jsonb is added (nullable, no default) and both
    migrations' @live-proof queries evaluate to true;
  * fn_ca_hand_gap_unintended_delay grades synthetic hand_history rows by
    shape the way scripts/sql/hand-gap-unintended-delay.sql does: a hand
    whose gap is exactly its owed beats grades 0 ms unintended (fold, river
    chips, checked river, all-in), and the window counts each pair once;
  * legacy cash_bust and rit rows without cadence remain ungraded and never
    alert, while cash_bust and rit rows WITH recorded cadence are graded
    accurately (with rebuy_pause_ms clamped to 5000 ms and rit_reveal_ms
    clamped to 30000 ms so an engine hang cannot excuse itself);
  * Lightning hands, gaps of 60 s or more, a recorded maintenance break and
    a tournament break are not graded;
  * fn_ca_hand_gap_watch records one history row per window x kind x shape,
    opens nothing on 1 or 2 consecutive breached windows (5 or 10 minutes),
    opens ONE critical financial_alerts row and sends ONE owner notification
    on the 3rd consecutive breached window (15 minutes), adds none on a
    re-run or 4th breached window, resolves and sends ONE clear notification
    when the shape returns within budget, and sends no duplicate clear
    notification on subsequent windows or re-runs;
  * the cron job is the one 20261119052955's live proof names.
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
BASE_FILE = '20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql'
FILE = '20261119180500_sustained_hand_delay_alerts_and_cadence_grading.sql'
BASE_MIGRATION = ROOT / 'supabase' / 'migrations' / BASE_FILE
MIGRATION = ROOT / 'supabase' / 'migrations' / FILE
SCRIPT_SQL = ROOT / 'scripts' / 'sql' / 'hand-gap-unintended-delay.sql'

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


OWNER = '47965354-0e56-43ef-931c-ddaab82af765'
JUNIOR = '47965354-0e56-43ef-931c-ddaab82af766'

SCHEMA = f"""
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
  context jsonb DEFAULT '{{}}'::jsonb, resolved boolean DEFAULT false, resolved_at timestamptz,
  created_at timestamptz DEFAULT now(), resolved_by uuid, resolution text);
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text,
  title text, message text, link text, data jsonb DEFAULT '{{}}'::jsonb, created_at timestamptz DEFAULT now());
CREATE TABLE ca_incident_recipients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
  scope text, active boolean, senior boolean);
INSERT INTO ca_incident_recipients(user_id, scope, active, senior) VALUES
  ('{OWNER}', 'platform', true, true),
  ('{JUNIOR}', 'platform', true, false),
  ('{JUNIOR}', 'platform', false, true);
CREATE FUNCTION public.fn_raise_notification(p_user_id uuid, p_type text, p_title text, p_message text,
  p_link text DEFAULT NULL, p_data jsonb DEFAULT '{{}}'::jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.notifications(user_id, type, title, message, link, data)
  VALUES (p_user_id, p_type, p_title, p_message, p_link, COALESCE(p_data, '{{}}'::jsonb)) $$;
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


def table(shape, extra_ms, windows, tournament=None, lightning=False, gap_ms=None, cadence=None, base_owed_ms=None):
    """A table dealing `shape` hands across `windows` (list of window ends, as k), with
    extra_ms(k) unintended delay on the hands whose NEXT hand is written in window k."""
    tid = str(uuid.uuid4())
    owed = base_owed_ms if base_owed_ms is not None else OWED.get(shape, OWED['fold'])
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
    cad_sql = f"'{json.dumps(cadence)}'::jsonb" if cadence is not None else 'NULL'
    vals = []
    for idx, (s, e) in enumerate(rows):
        hid = str(uuid.uuid4())
        # Cadence is written on the NEXT hand (rows 1..N-1 carry the prior hand's cadence).
        row_cad = cad_sql if idx > 0 else 'NULL'
        vals.append("('%s','%s',%s,'%s','%s','%s','%s','%s','%s','%s',%s,%s)" % (
            hid, tid, f"'{tournament}'" if tournament else 'NULL', (e + dt.timedelta(milliseconds=200)).isoformat(),
            s.isoformat(), e.isoformat(), json.dumps(p['actions']), json.dumps(p['players']), json.dumps(p['pots']),
            json.dumps(p['showdown']), f"'{json.dumps(p['rit_boards'])}'" if p['rit_boards'] else 'NULL', row_cad))
    run('INSERT INTO hand_history(id, table_id, tournament_id, created_at, started_at, ended_at, actions, players,'
        ' pots, showdown, rit_boards, cadence) VALUES ' + ','.join(vals))
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


def notifs():
    return json.loads(run("""SELECT COALESCE(jsonb_agg(jsonb_build_array(user_id::text, title,
      data->>'event', data->>'kind', data->>'shape') ORDER BY created_at, id), '[]')
      FROM notifications WHERE data->>'source' = 'fn_ca_hand_gap_watch'"""))


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''",
                        '-l', cluster / 'log', '-w', 'start'])
    results['server_version'] = run('SHOW server_version')
    run(SCHEMA)
    run(BASE_MIGRATION.read_text())
    base_proof = BASE_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('base migration 20261119052955 installs and its live proof holds', run('SELECT ' + base_proof) == 't', base_proof)

    run(MIGRATION.read_text())
    proof = MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261119180500 installs as written and its live proof holds', run('SELECT ' + proof) == 't', proof)
    check('the grade is STABLE and the watch is not',
          run("SELECT string_agg(proname || ':' || provolatile::text, ',' ORDER BY proname) FROM pg_proc "
              "WHERE proname IN ('fn_ca_hand_gap_unintended_delay', 'fn_ca_hand_gap_watch')")
          == 'fn_ca_hand_gap_unintended_delay:s,fn_ca_hand_gap_watch:v')

    # Window 1: every graded shape on its owed beats, plus legacy ungraded cash_bust & rit, plus exclusions.
    on_time = lambda k: 0
    for shape in OWED:
        table(shape, on_time, [1])
    table('cash_bust', lambda k: 4000, [1])   # legacy row (cadence IS NULL) -> ungraded
    table('rit', lambda k: 4000, [1])         # legacy row (cadence IS NULL) -> ungraded
    table('fold', lambda k: 3000, [1], lightning=True)
    table('fold', lambda k: 0, [1], gap_ms=61_000)
    g = grade(1)
    for shape in OWED:
        r = g.get(('cash', shape))
        check(f'grade: a {shape} hand on its owed beats is 0 ms unintended',
              r and r['graded'] and r['unintended_p95_ms'] == 0 and r['owed_p50_ms'] == OWED[shape]
              and r['over_budget'] == 0, r)
    r = g.get(('cash', 'cash_bust'))
    check('grade: a legacy cash bust without cadence is ungraded and never over budget',
          r and not r['graded'] and r['over_budget'] is None and r['unintended_p50_ms'] >= 4000, r)
    r = g.get(('cash', 'rit'))
    check('grade: a legacy run-it-twice hand without cadence is ungraded',
          r and not r['graded'] and r['over_budget'] is None, r)
    hands = sum(r['hands'] for r in g.values())
    fold = g[('cash', 'fold')]['hands']
    check('grade: Lightning hands and gaps of 60 s or more are not graded (only the on-time fold table counts)',
          g[('cash', 'fold')]['unintended_p99_ms'] == 0 and 15 <= fold <= 25, {'fold_hands': fold, 'all': hands})
    w = watch(1)
    check('watch: window 1 is recorded, one row per kind x shape, and nothing alerts or notifies',
          w['recorded'] == len(g) and w['opened'] == 0 and w['notified_open'] == 0
          and alerts() == [] and notifs() == [], w)
    check('watch: a re-run of the same window records nothing new',
          watch(1)['recorded'] == 0 and run('SELECT count(*) FROM ca_hand_gap_watch_history') == str(len(g)))

    # Windows 2..7: 15-minute sustained delay (3 consecutive 5-minute windows = windows 2, 3, 4)
    # on tournament fold (600 ms late in windows 2..5, back to 40 ms in windows 6..7),
    # plus an on-time cash table, a legacy cash_bust table (always ungraded), and a tournament-break table.
    tour, tbreak = str(uuid.uuid4()), str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id) VALUES ('{tour}');"
        f"INSERT INTO tournaments(id, break_started_at, break_ends_at) VALUES ('{tbreak}', '{T0.isoformat()}', "
        f"'{(T0 + dt.timedelta(hours=2)).isoformat()}')")
    table('fold', on_time, [2, 3, 4, 5, 6, 7])
    table('fold', lambda k: 600 if k in (2, 3, 4, 5) else 40, [2, 3, 4, 5, 6, 7], tournament=tour)
    table('cash_bust', lambda k: 4000, [2, 3, 4, 5, 6, 7])  # legacy without cadence
    table('showdown_river_chips', lambda k: 3000, [2, 3, 4, 5, 6, 7], tournament=tbreak)

    g2 = grade(2)
    check('grade: gaps inside the tournament break are not graded',
          ('tournament', 'showdown_river_chips') not in g2, sorted(g2))
    w2 = watch(2)
    check('watch: 1st breached window (5 min) opens nothing and sends no notification',
          w2['opened'] == 0 and w2['notified_open'] == 0 and alerts() == [] and notifs() == []
          and g2[('tournament', 'fold')]['unintended_p95_ms'] == 600, w2)
    w3 = watch(3)
    check('watch: 2nd consecutive breached window (10 min) STILL opens nothing and sends no notification',
          w3['opened'] == 0 and w3['notified_open'] == 0 and alerts() == [] and notifs() == [], w3)
    w4 = watch(4)
    check('watch: 3rd consecutive breached window (15 min) opens ONE critical alert and notifies owner ONCE',
          w4['opened'] == 1 and w4['notified_open'] == 1
          and alerts() == [['tournament', 'fold', 'critical', False]]
          and notifs() == [[OWNER, 'Unintended Delay Between Hands', 'opened', 'tournament', 'fold']],
          [w4, alerts(), notifs()])
    ctx = json.loads(run("SELECT context FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'"))
    check('watch: the alert names the shape, all 3 consecutive windows (15 min), and the budget',
          ctx['consecutive_windows'] == 3 and ctx['sustained_minutes'] == 15
          and ctx['unintended_p95_ms'] == 600 and ctx['previous_window_p95_ms'] == 600
          and ctx['two_windows_ago_p95_ms'] == 600 and ctx['budget_ms'] == 250 and ctx['hands'] >= 5, ctx)
    w4b = watch(4)
    w5 = watch(5)
    check('watch: a re-run and a 4th breached window add no second alert or open notification (deduplicated)',
          w4b['opened'] == 0 and w4b['notified_open'] == 0
          and w5['opened'] == 0 and w5['notified_open'] == 0 and w5['breaching'] == 1
          and len(alerts()) == 1 and len(notifs()) == 1, [w4b, w5, alerts(), notifs()])
    check('watch: legacy cash bust without cadence is recorded and never alerts',
          run("SELECT bool_and(NOT graded AND over_budget IS NULL) AND count(*) = 5 FROM ca_hand_gap_watch_history "
              "WHERE kind = 'cash' AND shape = 'cash_bust'") == 't')
    w6 = watch(6)
    check('watch: when the delay clears, the alert resolves and notifies owner ONCE',
          w6['resolved'] == 1 and w6['notified_clear'] == 1
          and alerts() == [['tournament', 'fold', 'critical', True]]
          and notifs() == [
              [OWNER, 'Unintended Delay Between Hands', 'opened', 'tournament', 'fold'],
              [OWNER, 'Hand Delay Cleared', 'cleared', 'tournament', 'fold'],
          ], [w6, alerts(), notifs()])
    w6b = watch(6)
    w7 = watch(7)
    check('watch: a re-run and subsequent healthy window send no duplicate clear notification',
          w6b['resolved'] == 0 and w6b['notified_clear'] == 0
          and w7['resolved'] == 0 and w7['notified_clear'] == 0
          and len(notifs()) == 2, [w6b, w7, notifs()])

    # Window 9: maintenance break recorded across the whole window grades nothing.
    run(f"INSERT INTO engine_maintenance_break_log VALUES ('{(T0 + dt.timedelta(minutes=39)).isoformat()}', "
        f"'{(T0 + dt.timedelta(minutes=46)).isoformat()}')")
    table('all_in_showdown', lambda k: 3000, [9])
    check('grade: gaps inside a recorded maintenance break are not graded', grade(9) == {}, sorted(grade(9)))

    # Window 11: cash_bust and rit WITH recorded cadence are graded accurately (0 ms unintended when on time).
    # cash_bust fold with 4000 ms rebuy pause: hold = 1850, max(1500, 4000) = 4000 -> owed = 5850.
    table('cash_bust', on_time, [11], base_owed_ms=1850 + 4000,
          cadence={'hold_ms': 1850, 'rest_ms': 1500, 'rebuy_pause_ms': 4000})
    # 2-run flop RIT (2 streets: turn + river): rit_reveal_ms = 600 + 2*2*1400 + 1800 + 900 + 2*4100 = 17100,
    # push = 500 + 1100 + 250 = 1850, rest = 1500 -> owed = 20450.
    table('rit', on_time, [11], base_owed_ms=17100 + 1850 + 1500,
          cadence={'hold_ms': 17100 + 1850, 'rest_ms': 1500, 'rebuy_pause_ms': 0, 'rit_reveal_ms': 17100})
    g11 = grade(11)
    r_bust = g11.get(('cash', 'cash_bust'))
    check('grade: cash_bust with recorded cadence is graded and 0 ms unintended when on time',
          r_bust and r_bust['graded'] and r_bust['owed_p50_ms'] == 5850
          and r_bust['unintended_p95_ms'] == 0 and r_bust['over_budget'] == 0, r_bust)
    r_rit = g11.get(('cash', 'rit'))
    check('grade: rit with recorded cadence is graded and 0 ms unintended when on time',
          r_rit and r_rit['graded'] and r_rit['owed_p50_ms'] == 20450
          and r_rit['unintended_p95_ms'] == 0 and r_rit['over_budget'] == 0, r_rit)

    # Window 12: clamping proof — an engine hang in rebuy_pause_ms (>5000) or rit_reveal_ms (>30000)
    # cannot excuse itself as owed time; it is caught as unintended delay.
    table('cash_bust', on_time, [12], base_owed_ms=1850 + 8000,
          cadence={'hold_ms': 1850, 'rest_ms': 1500, 'rebuy_pause_ms': 8000})
    table('rit', on_time, [12], base_owed_ms=32000 + 1850 + 1500,
          cadence={'hold_ms': 32000 + 1850, 'rest_ms': 1500, 'rebuy_pause_ms': 0, 'rit_reveal_ms': 32000})
    g12 = grade(12)
    r_bust_clamp = g12.get(('cash', 'cash_bust'))
    check('grade: cash_bust rebuy_pause_ms is clamped to 5000 ms so a hang is caught as unintended delay',
          r_bust_clamp and r_bust_clamp['graded'] and r_bust_clamp['owed_p50_ms'] == 6850
          and r_bust_clamp['unintended_p95_ms'] == 3000 and r_bust_clamp['over_budget'] >= 5, r_bust_clamp)
    r_rit_clamp = g12.get(('cash', 'rit'))
    check('grade: rit rit_reveal_ms is clamped to 30000 ms so a hang is caught as unintended delay',
          r_rit_clamp and r_rit_clamp['graded'] and r_rit_clamp['owed_p50_ms'] == 33350
          and r_rit_clamp['unintended_p95_ms'] == 2000 and r_rit_clamp['over_budget'] >= 5, r_rit_clamp)

    # Standalone read-only script executes cleanly against the upgraded schema.
    run(SCRIPT_SQL.read_text())
    check('scripts/sql/hand-gap-unintended-delay.sql executes cleanly on PostgreSQL', True)

    msgs = run("SELECT count(DISTINCT message) FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'")
    check('watch: the alert message is constant, so one cause is one incident', msgs == '1', msgs)
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
