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
  * the cron job is the one 20261119052955's live proof names;
  * then, on the production pre-image of the owner page route
    (scripts/ci/fixtures/owner-page-route-preimage-20261120.sql),
    20261120034809 installs and its live proof holds; the watch sends NO
    notification of its own on open or on clear (the defect above: one push
    per flap), and a flapping episode pages the owner ONCE through the page
    route (kind hand_delay) while the second open is held and counted;
  * 20261119211558 (hand-for-hand is owed) is applied in its production order,
    and 20261121000757 then re-creates the grader from that text by anchors:
    the hand-for-hand exclusion survives, the grade splits graded hands by a
    bust on the previous hand and a tournament seat move inside the gap, the
    history keeps the split, the opened alert names it in one sentence
    (windows recorded before the upgrade are left out, never counted as
    zero), and the owner's page carries that sentence.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
BASE_FILE = '20261119052955_an_unintended_delay_between_hands_pages_within_minutes.sql'
FILE = '20261119180500_sustained_hand_delay_alerts_and_cadence_grading.sql'
BASE_MIGRATION = ROOT / 'supabase' / 'migrations' / BASE_FILE
MIGRATION = ROOT / 'supabase' / 'migrations' / FILE
ROUTE_FILE = '20261120034809_a_hand_delay_pages_through_the_owner_page_route.sql'
ROUTE_MIGRATION = ROOT / 'supabase' / 'migrations' / ROUTE_FILE
ROUTE_PREIMAGE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'owner-page-route-preimage-20261120.sql'
H4H_FILE = '20261119211558_a_hand_for_hand_wait_is_an_owed_wait.sql'
H4H_MIGRATION = ROOT / 'supabase' / 'migrations' / H4H_FILE
SPLIT_FILE = '20261121000757_the_hand_delay_alert_names_where_the_delay_comes_from.sql'
SPLIT_MIGRATION = ROOT / 'supabase' / 'migrations' / SPLIT_FILE
OWED_WAITS_FILE = '20261122054826_mystery_bounty_and_addon_break_are_owed_waits.sql'
OWED_WAITS_MIGRATION = ROOT / 'supabase' / 'migrations' / OWED_WAITS_FILE
PARITY_FILE = '20261122095254_all_in_showdown_sweep_and_award_groups_parity.sql'
PARITY_MIGRATION = ROOT / 'supabase' / 'migrations' / PARITY_FILE
WORST_FILE = '20261124171043_the_hand_gap_grade_names_its_worst_hands.sql'
WORST_MIGRATION = ROOT / 'supabase' / 'migrations' / WORST_FILE
FELT_FILE = '20261120000047_player_felt_latency_is_recorded_hourly.sql'
FELT_MIGRATION = ROOT / 'supabase' / 'migrations' / FELT_FILE
BREAK_PREDICATE_FILE = '20261126031922_hand_gap_tournament_break_predicate_requires_active_break.sql'
BREAK_PREDICATE_MIGRATION = ROOT / 'supabase' / 'migrations' / BREAK_PREDICATE_FILE
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
CREATE TABLE tournaments(id uuid PRIMARY KEY, on_break boolean DEFAULT false, break_started_at timestamptz, break_ends_at timestamptz,
  addon_period_started_at timestamptz, addon_period_ends_at timestamptz,
  addon_break_minutes integer NOT NULL DEFAULT 1,
  is_rebuy boolean DEFAULT false, is_reentry boolean DEFAULT false,
  created_at timestamptz DEFAULT now());
CREATE TABLE tournament_bounty_awards(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  table_id uuid, hand_id text, reserved_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_bounty_awards_tournament ON tournament_bounty_awards(tournament_id, reserved_at);
CREATE SCHEMA smarter_private;
CREATE TABLE tournament_seat_move_receipts(request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid NOT NULL,
  user_id uuid, source_table_id uuid NOT NULL, destination_table_id uuid NOT NULL, moved_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX idx_tsmr_tournament_moved_at ON tournament_seat_move_receipts(tournament_id, moved_at DESC);
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


def payload(shape, bust=False):
    shown = [{'user_id': U1}, {'user_id': U2}]
    players = [{'userId': U1, 'stack': 100}, {'userId': U2, 'stack': 0 if bust else 100}]
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


def table(shape, extra_ms, windows, tournament=None, lightning=False, gap_ms=None, cadence=None, base_owed_ms=None,
          bust=False):
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
    p = payload(shape, bust)
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
    run(H4H_MIGRATION.read_text())
    check('migration 20261119211558 (hand-for-hand is owed) edits the grader as on production',
          run("SELECT strpos(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'"
              "::regprocedure), 'FROM ca_tournament_hand_for_hand h4h') > 0") == 't')
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

    # Phase 2 (20261120034809): the watch pages through the owner page route, not around it.
    run(ROUTE_PREIMAGE.read_text())
    pre = run("SELECT md5(pg_get_functiondef('public.fn_ca_owner_page_kind(text,text,text)'::regprocedure)) || ','"
              " || md5(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure))")
    check('route fixture is byte-equal to the production pre-image (md5 of pg_get_functiondef)',
          pre == '0b2e47d5b999a429faa4ad1346c90f52,587e68783be087a0a059d674377a7cc9', pre)
    direct_before = len(notifs())
    run(ROUTE_MIGRATION.read_text())
    route_proof = ROUTE_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261120034809 installs on the pre-image and its live proof holds',
          run('SELECT ' + route_proof) == 't', route_proof)

    def pages():
        return json.loads(run("""SELECT COALESCE(jsonb_agg(jsonb_build_array(user_id::text, title, message,
          data->>'kind', data->>'alert', (data->>'held_since_last_page')::int) ORDER BY created_at, id), '[]')
          FROM notifications WHERE data->>'source' = 'owner-real-alert'"""))

    tour2 = str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id) VALUES ('{tour2}')")
    late = (21, 22, 23, 26, 27, 28)
    table('fold', lambda k: 600 if k in late else 40, list(range(21, 30)), tournament=tour2)
    r21, r22, r23 = watch(21), watch(22), watch(23)
    check('route: the 15-minute breach opens ONE alert and the watch itself notifies nobody',
          r23['opened'] == 1 and r23.get('paged_via') == 'operational_alert_events'
          and 'notified_open' not in r23 and len(notifs()) == direct_before, [r21, r22, r23, notifs()])
    check('route: the open reaches the store once as financial-alerts-backfill/fn_ca_hand_gap_watch/critical',
          run("SELECT count(*) FROM operational_alert_events WHERE source = 'financial-alerts-backfill' "
              "AND alertname = 'fn_ca_hand_gap_watch' AND severity = 'critical' AND status = 'firing'") == '1')
    p1 = pages()
    check('route: the owner is paged ONCE, titled and summarised from the alert, by the page route',
          len(p1) == 1 and p1[0][0] == OWNER and p1[0][1] == 'Unintended Delay Between Hands'
          and p1[0][2] == 'tournament fold hands have been delayed for 15 minutes (p95 +600 ms over the 250 ms budget).'
          and p1[0][3] == 'hand_delay' and p1[0][4] == 'fn_ca_hand_gap_watch', p1)
    r24, r25 = watch(24), watch(25)
    check('route: the clear resolves the alert and pages nobody (no recovery push)',
          r24['resolved'] == 1 and r25['resolved'] == 0 and len(notifs()) == direct_before and len(pages()) == 1,
          [r24, r25, pages()])
    r26, r27, r28 = watch(26), watch(27), watch(28)
    check('route: the flap re-opens the alert, which is held and counted, not paged again',
          r28['opened'] == 1 and len(pages()) == 1 and len(notifs()) == direct_before
          and run("SELECT held_since_page FROM ca_owner_page_state WHERE kind = 'hand_delay'") == '1',
          [r28, pages()])
    check('route: a hand delay never touches the dealing clock a stopped table needs',
          run("SELECT last_firing_at IS NULL AND pages_sent = 0 FROM ca_owner_page_state WHERE kind = 'dealing'") == 't')
    # Phase 3 (20261121000757): the alert names where the delay comes from.
    # Tournament all_in_showdown, windows 30..32: table X busts a player every
    # hand and balances (a seat-move receipt inside every gap), 1500 ms late;
    # table Y busts a player every hand without a move, 1200 ms late; table Z
    # busts nobody and is 100 ms late (inside the budget). Window 30 is
    # recorded BEFORE the upgrade, so it carries no split.
    tour3 = str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id) VALUES ('{tour3}')")
    split_w = [30, 31, 32]
    tx = table('all_in_showdown', lambda k: 1500, split_w, tournament=tour3, bust=True)
    table('all_in_showdown', lambda k: 1200, split_w, tournament=tour3, bust=True)
    table('all_in_showdown', lambda k: 100, split_w, tournament=tour3)
    other = str(uuid.uuid4())
    run(f"""INSERT INTO tournament_seat_move_receipts(tournament_id, source_table_id, destination_table_id, moved_at)
      SELECT '{tour3}', table_id, '{other}', next_start - interval '100 milliseconds'
        FROM (SELECT table_id, lead(started_at) OVER (ORDER BY started_at) AS next_start
                FROM hand_history WHERE table_id = '{tx}') g WHERE next_start IS NOT NULL""")
    w30 = watch(30)
    check('split: the window recorded before the upgrade opens nothing', w30['opened'] == 0, w30)
    pre3 = run("SELECT md5(pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure))"
               " || ',' || md5(pg_get_functiondef('public.fn_ca_hand_gap_watch(timestamp with time zone)'::regprocedure))"
               " || ',' || md5(pg_get_functiondef('public.fn_ca_a_real_alert_reaches_the_owner()'::regprocedure))")
    results['split_preimage_md5'] = pre3
    check('split: the grader, watch and page route here are byte-equal to production before 20261121000757 (md5 of pg_get_functiondef, read 2026-11-21)',
          pre3 == 'af9240f68db8e5ee82e56785c5044f58,c4055ac1f91c17038a340ba938121fb1,cd785681c14f0ba6ae38fe944069e6ab', pre3)
    run(SPLIT_MIGRATION.read_text())
    split_proof = SPLIT_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261121000757 installs on the production text and its live proof holds',
          run('SELECT ' + split_proof) == 't', split_proof)
    check('split: the re-created grader keeps the hand-for-hand, break and Lightning exclusions and stays STABLE',
          run("SELECT strpos(d, 'FROM ca_tournament_hand_for_hand h4h') > 0 AND strpos(d, 'FROM tournaments t') > 0"
              " AND strpos(d, 'FROM engine_maintenance_break_log b') > 0 AND strpos(d, 'FROM lightning_hand lh') > 0"
              " FROM (SELECT pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'"
              "::regprocedure) d) x") == 't'
          and run("SELECT provolatile FROM pg_proc WHERE proname = 'fn_ca_hand_gap_unintended_delay'") == 's')
    check('split: the grader is still service_role only after its re-creation',
          run("SELECT has_function_privilege('service_role', 'public.fn_ca_hand_gap_unintended_delay(timestamptz,integer)', 'EXECUTE')"
              " AND NOT has_function_privilege('anon', 'public.fn_ca_hand_gap_unintended_delay(timestamptz,integer)', 'EXECUTE')"
              " AND NOT has_function_privilege('authenticated', 'public.fn_ca_hand_gap_unintended_delay(timestamptz,integer)', 'EXECUTE')") == 't')
    g31 = grade(31)[('tournament', 'all_in_showdown')]
    n_x = g31['after_seat_move']
    check('split: the grade splits graded hands by a bust and a seat move inside the gap',
          g31['graded'] and g31['after_bust'] == g31['after_bust_over_budget'] == g31['over_budget']
          and 5 <= n_x == g31['after_seat_move_over_budget'] == g31['after_bust_and_seat_move_over_budget'] < g31['over_budget']
          and g31['after_bust_unintended_p95_ms'] == 1500 and g31['after_seat_move_unintended_p95_ms'] == 1500
          and g31['neither_unintended_p95_ms'] == 100 and g31['hands'] > g31['after_bust'], g31)
    on_time_g = grade(31).get(('cash', 'fold')) or grade(2).get(('cash', 'fold'))
    check('split: a table with no bust and no move reports zero split counts, never NULL',
          on_time_g and on_time_g['after_bust'] == 0 and on_time_g['after_seat_move'] == 0
          and on_time_g['after_bust_unintended_p95_ms'] is None, on_time_g)
    run("UPDATE ca_owner_page_state SET last_firing_at = NULL, last_paged_at = NULL, held_since_page = 0 WHERE kind = 'hand_delay'")
    pages_before = len(pages())
    w31, w32 = watch(31), watch(32)
    check('split: the 15-minute breach still opens ONE alert per kind x shape (identity unchanged)',
          w31['opened'] == 0 and w32['opened'] == 1, [w31, w32])
    sctx = json.loads(run("SELECT context FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch' "
                          "AND NOT resolved AND context->>'shape' = 'all_in_showdown'"))
    hist = json.loads(run("SELECT jsonb_agg(to_jsonb(h) ORDER BY window_end) FROM ca_hand_gap_watch_history h "
                          "WHERE kind = 'tournament' AND shape = 'all_in_showdown' AND window_end >= "
                          f"'{(T0 + dt.timedelta(minutes=150)).isoformat()}'"))
    check('split: the history keeps the split for windows after the upgrade and NULL before it',
          len(hist) == 3 and hist[0]['after_bust'] is None
          and hist[1]['after_bust_over_budget'] == hist[1]['over_budget']
          and hist[2]['after_seat_move_over_budget'] >= 5, hist)
    over_split = hist[1]['over_budget'] + hist[2]['over_budget']
    moved_split = hist[1]['after_seat_move_over_budget'] + hist[2]['after_seat_move_over_budget']
    move_pct = round(100.0 * moved_split / over_split)
    want = (f'Over budget in 10 min: {over_split} hands; 100% after a bust, {move_pct}% after a tournament seat move, '
            f'{move_pct}% both. Latest 5 min p95 +1500 ms after a bust, +100 ms after neither.')
    check('split: the alert names where the delay comes from, leaving out the window recorded before the upgrade',
          sctx['attribution'] == want and sctx['attribution_minutes'] == 10
          and sctx['over_budget_attributed'] == over_split and sctx['over_budget_after_bust'] == over_split
          and sctx['over_budget_after_seat_move'] == moved_split
          and sctx['over_budget_after_bust_and_seat_move'] == moved_split
          and sctx['after_bust_unintended_p95_ms'] == 1500 and sctx['neither_unintended_p95_ms'] == 100
          and sctx['unintended_p95_ms'] == 1500 and sctx['budget_ms'] == 250 and sctx['sustained_minutes'] == 15,
          [want, sctx])
    p3 = pages()
    check('split: the owner page carries the attribution sentence after the delay sentence',
          len(p3) == pages_before + 1 and p3[-1][1] == 'Unintended Delay Between Hands'
          and p3[-1][2] == 'tournament all_in_showdown hands have been delayed for 15 minutes '
                           '(p95 +1500 ms over the 250 ms budget). ' + want
          and p3[-1][3] == 'hand_delay', p3[-1:])
    check('split: the alert message stays constant, so one cause is still one incident',
          run("SELECT count(DISTINCT message) FROM financial_alerts WHERE source = 'fn_ca_hand_gap_watch'") == '1')
    run(SCRIPT_SQL.read_text())
    check('scripts/sql/hand-gap-unintended-delay.sql executes cleanly with the split', True)

    # Phase 4 (20261122054826): Mystery Bounty chest reveals and add-on breaks
    # are owed waits; the hand-gap classification runbook scans 15 minutes,
    # classifies mystery_bounty and addon_break as intended, and never labels a
    # tournament bust in a rebuy event as an intended rebuy wait.
    run(OWED_WAITS_MIGRATION.read_text())
    owed_proof = OWED_WAITS_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261122054826 installs as written and its live proof holds',
          run('SELECT ' + owed_proof) == 't', owed_proof)

    # 4a. Mystery Bounty chest reveals on table_mb are excluded; a sibling table
    # in the same tournament without a chest award is still graded over budget.
    w40_start = T0 + dt.timedelta(minutes=5 * 39)
    w40_end_dt = T0 + dt.timedelta(minutes=5 * 40)
    tour_mb = str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id, is_rebuy) VALUES ('{tour_mb}', true)")
    t_mb_chest = table('all_in_showdown', lambda k: 14_000, [40], tournament=tour_mb, bust=True)
    t_mb_plain = table('all_in_showdown', lambda k: 1_800, [40], tournament=tour_mb, bust=True)
    run(f"""INSERT INTO tournament_bounty_awards(tournament_id, table_id, hand_id, reserved_at)
            SELECT tournament_id, table_id, id::text, ended_at + interval '2 seconds'
              FROM hand_history WHERE table_id = '{t_mb_chest}'""")
    g40 = grade(40).get(('tournament', 'all_in_showdown'))
    plain_pairs = int(run(
        f"SELECT count(*) FROM hand_history WHERE table_id = '{t_mb_plain}' "
        f"AND created_at >= '{w40_start.isoformat()}' AND created_at < '{w40_end_dt.isoformat()}'"))
    check('mystery bounty: chest-reveal gaps are excluded while non-chest gaps on the same tournament stay graded',
          g40 and g40['hands'] == plain_pairs and g40['unintended_p95_ms'] == 1800,
          {'g40': g40, 'plain_pairs': plain_pairs})

    # 4b. Add-on break: only the final addon_break_minutes of an addon_from_start
    # window is excluded; slow hands during earlier open play remain graded.
    w42_start = T0 + dt.timedelta(minutes=5 * 41)
    w42_end = T0 + dt.timedelta(minutes=5 * 42)
    tour_addon = str(uuid.uuid4())
    run(f"""INSERT INTO tournaments(id, addon_period_started_at, addon_period_ends_at, addon_break_minutes)
            VALUES ('{tour_addon}', '{(w42_start - dt.timedelta(minutes=30)).isoformat()}',
                    '{w42_end.isoformat()}', 1)""")
    t_addon = table('showdown_checked_river', lambda k: 2_500, [42], tournament=tour_addon)
    g42 = grade(42).get(('tournament', 'showdown_checked_river'))
    total_addon_pairs = int(run(
        f"SELECT count(*) FROM hand_history WHERE table_id = '{t_addon}' "
        f"AND created_at >= '{w42_start.isoformat()}' AND created_at < '{w42_end.isoformat()}'"))
    check('add-on break: only the final addon_break_minutes pause is excluded, not earlier addon_from_start play',
          g42 and 0 < g42['hands'] < total_addon_pairs and g42['unintended_p95_ms'] == 2500,
          {'g42': g42, 'total_addon_pairs': total_addon_pairs})

    # 4c. Hand-gap classification runbook: tournament bust in a rebuy tournament
    # is classified as 'other' (never 'rebuy') and does NOT auto-resolve; an alert
    # whose slow hands are all mystery_bounty / addon_break DOES auto-resolve; and
    # a slow hand 12 minutes before window_end (inside 15m, outside 10m) is seen.
    run("UPDATE financial_alerts SET resolved = true WHERE source = 'fn_ca_hand_gap_watch' AND NOT resolved")
    w40_end = (T0 + dt.timedelta(minutes=5 * 40)).isoformat()
    fa_rebuy = run(
        "INSERT INTO financial_alerts(severity, source, message, context) VALUES "
        "('critical', 'fn_ca_hand_gap_watch', 'gap', "
        f"jsonb_build_object('kind', 'tournament', 'shape', 'all_in_showdown', 'window_end', '{w40_end}', 'budget_ms', 250)) "
        "RETURNING id")
    rb_res = json.loads(run(
        f"SELECT smarter_private.reliability_runbook_hand_gap_classification('{uuid.uuid4()}', false, '{{}}'::jsonb, now())"))
    al_rb = rb_res['alerts'][0]
    plain_pairs_15m = int(run(f"SELECT count(*) - 1 FROM hand_history WHERE table_id = '{t_mb_plain}'"))
    check('runbook: tournament bust in a rebuy event is other (never intended rebuy) and alert stays open',
          rb_res['outcome'] == 'diagnosed'
          and al_rb['by_class'].get('rebuy') is None
          and al_rb['by_class'].get('mystery_bounty', 0) > 0
          and al_rb['by_class'].get('other', 0) == plain_pairs_15m
          and not al_rb['all_intended']
          and run(f"SELECT resolved FROM financial_alerts WHERE id = '{fa_rebuy}'") == 'f',
          rb_res)

    # Now alert covering ONLY mystery_bounty slow hands (remove plain table rows)
    # plus a slow mystery_bounty hand 12 minutes before window_end (proving 15m window).
    run(f"DELETE FROM hand_history WHERE table_id = '{t_mb_plain}'")
    fa_mb_only = run(
        "INSERT INTO financial_alerts(severity, source, message, context) VALUES "
        "('critical', 'fn_ca_hand_gap_watch', 'gap', "
        f"jsonb_build_object('kind', 'tournament', 'shape', 'all_in_showdown', 'window_end', '{(T0 + dt.timedelta(minutes=5 * 42)).isoformat()}', 'budget_ms', 250)) "
        "RETURNING id")
    run(f"UPDATE financial_alerts SET resolved = true WHERE id = '{fa_rebuy}'")
    rb_mb = json.loads(run(
        f"SELECT smarter_private.reliability_runbook_hand_gap_classification('{uuid.uuid4()}', false, '{{}}'::jsonb, now())"))
    al_mb = rb_mb['alerts'][0]
    check('runbook: 15-minute window sees mystery_bounty hands 10-15m prior and resolves when all waits are intended',
          rb_mb['outcome'] == 'resolved_producer'
          and al_mb['by_class'].get('mystery_bounty', 0) > 0
          and al_mb['all_intended']
          and run(f"SELECT resolved FROM financial_alerts WHERE id = '{fa_mb_only}'") == 't',
          rb_mb)

    # Phase 5 (20261122095254): all-in call/blind showdowns, conservative
    # bets_sweep_owed holds, and chopped-pot DISTINCT award_groups stay in exact
    # parity between handCompletionHoldMs, fn_ca_hand_gap_unintended_delay,
    # scripts/sql/hand-gap-unintended-delay.sql, and the classification runbook.
    run(PARITY_MIGRATION.read_text())
    parity_proof = PARITY_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261122095254 installs as written and its live proof holds',
          run('SELECT ' + parity_proof) == 't', parity_proof)
    # Idempotency: running 20261122095254 a second time is a safe no-op.
    run(PARITY_MIGRATION.read_text())
    check('migration 20261122095254 is idempotent',
          run('SELECT ' + parity_proof) == 't', parity_proof)

    def insert_custom_pairs(window_idx, count, *, tournament_id=None, actions_json='[]',
                            players_json=None, pots_json='[]', gap_ms=6250, cadence_json=None):
        tid = str(uuid.uuid4())
        w_start = T0 + dt.timedelta(minutes=5 * (window_idx - 1))
        if players_json is None:
            players_json = json.dumps([{'userId': 'u1', 'stack': 100}, {'userId': 'u2', 'stack': 100}])
        shown_json = json.dumps([{'user_id': 'u1', 'seat': 1}, {'user_id': 'u2', 'seat': 2}])
        tour_sql = f"'{tournament_id}'" if tournament_id else 'NULL'
        cad_sql = f"'{cadence_json}'::jsonb" if cadence_json else 'NULL'
        cur_t = w_start + dt.timedelta(seconds=5)
        for i in range(count + 1):
            st = cur_t
            en = st + dt.timedelta(seconds=10)
            cr = en
            # Stamp cadence on the NEXT hand (i > 0) for the prior pair (i - 1 -> i).
            row_cad = cad_sql if i > 0 else 'NULL'
            run(f"""INSERT INTO hand_history(id, table_id, tournament_id, started_at, ended_at, created_at,
                                             actions, players, pots, showdown, cadence)
                    VALUES ('{uuid.uuid4()}', '{tid}', {tour_sql}, '{st.isoformat()}', '{en.isoformat()}', '{cr.isoformat()}',
                            '{actions_json}'::jsonb, '{players_json}'::jsonb, '{pots_json}'::jsonb,
                            '{shown_json}'::jsonb, {row_cad})""")
            cur_t = en + dt.timedelta(milliseconds=gap_ms)
        return tid

    # 5a. Cash all-in CALL where caller WINS (stack > 0, no 'all_in' action,
    # cadence.all_in_showdown = true, gap = 6250 ms = 1400+2000+0+1100+250+1500).
    # Exact reproduction of Backup Engine 44997134858 refusal (unintended_p95=499):
    # must grade as all_in_showdown with 0 ms unintended and 0 over_budget.
    call_action = json.dumps([{'stage': 'turn', 'action': 'call', 'amount': 50, 'userId': 'u1'}])
    allin_cadence = json.dumps({'hold_ms': 4750, 'rest_ms': 1500, 'rebuy_pause_ms': 0,
                                'all_in_showdown': True, 'bets_sweep_owed': False})
    insert_custom_pairs(44, 6, actions_json=call_action, gap_ms=6250, cadence_json=allin_cadence)
    g44_ai = grade(44).get(('cash', 'all_in_showdown'))
    g44_chk = grade(44).get(('cash', 'showdown_checked_river'))
    check('parity: cash all-in call winner with cadence.all_in_showdown grades all_in_showdown at 0 ms unintended',
          g44_ai and g44_ai['hands'] == 6 and g44_ai['unintended_p95_ms'] == 0
          and g44_ai['over_budget'] == 0 and g44_chk is None,
          {'g44_ai': g44_ai, 'g44_chk': g44_chk})

    # 5b. Legacy tournament all-in CALL where caller BUSTS (stack = 0, NO cadence,
    # no 'all_in' action, gap = 6250 ms). Exact reproduction of prod 06:55Z hand
    # 6e9da799 on serving c2d6e45e3bcc: must grade all_in_showdown at 0 ms unintended.
    tour_p5 = str(uuid.uuid4())
    run(f"INSERT INTO tournaments(id) VALUES ('{tour_p5}')")
    busted_players = json.dumps([{'userId': 'u1', 'stack': 0}, {'userId': 'u2', 'stack': 200}])
    insert_custom_pairs(45, 6, tournament_id=tour_p5, actions_json=call_action,
                        players_json=busted_players, gap_ms=6250, cadence_json=None)
    g45_ai = grade(45).get(('tournament', 'all_in_showdown'))
    g45_chk = grade(45).get(('tournament', 'showdown_checked_river'))
    check('parity: legacy tournament all-in call bust (zero-stack shown player, no cadence) grades all_in_showdown at 0 ms',
          g45_ai and g45_ai['hands'] == 6 and g45_ai['unintended_p95_ms'] == 0
          and g45_ai['over_budget'] == 0 and g45_chk is None,
          {'g45_ai': g45_ai, 'g45_chk': g45_chk})

    # 5c. Conservative bets_sweep_owed = true with no river chip action (gap = 6250 ms
    # = 1400+1500+500+1100+250+1500): must grade showdown_river_chips at 0 ms unintended.
    sweep_cadence = json.dumps({'hold_ms': 4750, 'rest_ms': 1500, 'rebuy_pause_ms': 0,
                                'all_in_showdown': False, 'bets_sweep_owed': True})
    insert_custom_pairs(46, 6, actions_json=call_action, gap_ms=6250, cadence_json=sweep_cadence)
    g46_rc = grade(46).get(('cash', 'showdown_river_chips'))
    check('parity: conservative cadence.bets_sweep_owed grades showdown_river_chips at 0 ms unintended',
          g46_rc and g46_rc['hands'] == 6 and g46_rc['unintended_p95_ms'] == 0
          and g46_rc['over_budget'] == 0,
          {'g46_rc': g46_rc})

    # 5d. Chopped main pot (2 winners sharing board=1, potIndex=0, low=false):
    # countAwardGroups is 1 (owed = 5750 ms), NOT 2 (6650 ms). A real +900 ms
    # unintended delay (gap = 6650 ms) MUST be caught, never hidden by count(*).
    chopped_pots = json.dumps([{
        'index': 0,
        'awards': [
            {'userId': 'u1', 'amount': 50, 'potIndex': 0, 'low': False, 'board': 1},
            {'userId': 'u2', 'amount': 50, 'potIndex': 0, 'low': False, 'board': 1},
        ],
    }])
    plain_cadence = json.dumps({'hold_ms': 4250, 'rest_ms': 1500, 'rebuy_pause_ms': 0,
                                'all_in_showdown': False, 'bets_sweep_owed': False})
    insert_custom_pairs(47, 6, actions_json=call_action, pots_json=chopped_pots,
                        gap_ms=6650, cadence_json=plain_cadence)
    g47_chk = grade(47).get(('cash', 'showdown_checked_river'))
    check('parity: chopped pot counts as 1 award group (matching countAwardGroups), catching a +900 ms real delay',
          g47_chk and g47_chk['hands'] == 6 and g47_chk['owed_p50_ms'] == 5750
          and g47_chk['unintended_p95_ms'] == 900 and g47_chk['over_budget'] == 6,
          {'g47_chk': g47_chk})

    # 5e. Tamper-resistance: an inflated cadence.hold_ms = 25000 with
    # all_in_showdown = false and bets_sweep_owed = false cannot hide a real
    # +2000 ms delay (gap = 7750 ms vs owed = 5750 ms).
    bogus_cadence = json.dumps({'hold_ms': 25000, 'rest_ms': 1500, 'rebuy_pause_ms': 0,
                                'all_in_showdown': False, 'bets_sweep_owed': False})
    insert_custom_pairs(48, 6, actions_json=call_action, gap_ms=7750, cadence_json=bogus_cadence)
    g48_chk = grade(48).get(('cash', 'showdown_checked_river'))
    check('parity: bogus cadence.hold_ms cannot mask a real +2000 ms unintended delay',
          g48_chk and g48_chk['hands'] == 6 and g48_chk['owed_p50_ms'] == 5750
          and g48_chk['unintended_p95_ms'] == 2000 and g48_chk['over_budget'] == 6,
          {'g48_chk': g48_chk})

    # Phase 6 (20261124171043_the_hand_gap_grade_names_its_worst_hands): the grade names its slowest hands, and Backup's
    # sample judge (server/standby/standby-engine.sh check_soak_hand_gap_delay)
    # reads them. The judge runs for real here, against this cluster, on hands
    # written in the last few minutes (it grades the window ending now()).
    STANDBY = ROOT / 'server' / 'standby' / 'standby-engine.sh'
    plain_owed = 5750  # 1400 + 1500 + 1100 + 250 + 1500, as phase 5d proves

    def insert_recent_pairs(gaps_ms, start):
        tid = str(uuid.uuid4())
        ids, cur = [], start
        for i in range(len(gaps_ms) + 1):
            hid = str(uuid.uuid4())
            ids.append(hid)
            st, en = cur, cur + dt.timedelta(seconds=10)
            row_cad = f"'{plain_cadence}'::jsonb" if i > 0 else 'NULL'
            run(f"""INSERT INTO hand_history(id, table_id, tournament_id, started_at, ended_at, created_at,
                                             actions, players, pots, showdown, cadence)
                    VALUES ('{hid}', '{tid}', NULL, '{st.isoformat()}', '{en.isoformat()}', '{en.isoformat()}',
                            '{call_action}'::jsonb,
                            '[{{"userId": "u1", "stack": 100}}, {{"userId": "u2", "stack": 100}}]'::jsonb,
                            '[]'::jsonb, '[{{"user_id": "u1", "seat": 1}}, {{"user_id": "u2", "seat": 2}}]'::jsonb,
                            {row_cad})""")
            if i < len(gaps_ms):
                cur = en + dt.timedelta(milliseconds=gaps_ms[i])
        return tid, ids

    def judge(since):
        script = (f'set -Eeuo pipefail; source {shlex.quote(str(STANDBY))}; '
                  f'psql_db() {{ {shlex.quote(str(pg / "psql"))} -X -v ON_ERROR_STOP=1 -h {shlex.quote(str(sock))} '
                  f'-p {PORT} -U postgres -d postgres "$@"; }}; '
                  f'check_soak_hand_gap_delay {since} 15')
        r = subprocess.run(['bash', '-c', script], text=True, capture_output=True, env=env, timeout=120)
        return r.returncode, (json.loads(r.stdout) if r.stdout.strip() else None), r.stderr

    now = dt.datetime.now(dt.timezone.utc)
    since = int((now - dt.timedelta(minutes=14)).timestamp())
    # 2026-11-24 12:47Z refusal of 19203b9a1f0b: 14 cash showdown_checked_river
    # pairs, 13 on time and ONE 1,422 ms late.
    gaps_1247 = [plain_owed + 1] * 13 + [plain_owed + 1422]
    t1247, ids1247 = insert_recent_pairs(gaps_1247, now - dt.timedelta(minutes=8))
    rc, verdict, err = judge(since)
    cell1247 = next((c for c in (verdict or {}).get('cells', [])
                     if c['kind'] == 'cash' and c['shape'] == 'showdown_checked_river'), None)
    check('judge on the grader before 20261124171043_the_hand_gap_grade_names_its_worst_hands: the 12:47Z sample (one 1,422 ms hand of 14) passes, ids unavailable',
          rc == 0 and verdict['status'] == 'pass' and verdict['extremesAvailable'] is False
          and cell1247 and cell1247['n'] == 14 and cell1247['overBudget'] == 1 and cell1247['maxMs'] is None,
          {'rc': rc, 'verdict': verdict, 'stderr': err})

    run(WORST_MIGRATION.read_text())
    worst_proof = WORST_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261124171043_the_hand_gap_grade_names_its_worst_hands installs as written and its live proof holds',
          run('SELECT ' + worst_proof) == 't', worst_proof)
    run(WORST_MIGRATION.read_text())
    check('migration 20261124171043_the_hand_gap_grade_names_its_worst_hands is idempotent', run('SELECT ' + worst_proof) == 't', worst_proof)
    check('the grader keeps its security, owner grants and comment after the re-create',
          run("SELECT prosecdef AND provolatile = 's' AND has_function_privilege('service_role', oid, 'EXECUTE')"
              " AND NOT has_function_privilege('anon', oid, 'EXECUTE')"
              " AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')"
              " FROM pg_proc WHERE oid = 'public.fn_ca_hand_gap_unintended_delay(timestamp with time zone,integer)'::regprocedure") == 't')

    g47_after = grade(47).get(('cash', 'showdown_checked_river'))
    check('every existing column grades exactly as before; the new ones name the slowest hands',
          g47_after and all(g47_after[k] == g47_chk[k] for k in g47_chk)
          and g47_after['unintended_max_ms'] == 900 and len(g47_after['worst_hands']) == 5
          and all(w['unintended_ms'] == 900 for w in g47_after['worst_hands']),
          {'before': g47_chk, 'after': g47_after})

    insert_custom_pairs(49, 6, actions_json=call_action, gap_ms=6250, cadence_json=plain_cadence)
    history_before = int(run('SELECT count(*) FROM ca_hand_gap_watch_history'))
    watch(49)
    history_after = int(run('SELECT count(*) FROM ca_hand_gap_watch_history'))
    check('fn_ca_hand_gap_watch still records its window through the re-created grader',
          history_after > history_before, {'before': history_before, 'after': history_after})

    rc, verdict, err = judge(since)
    cell1247 = next((c for c in (verdict or {}).get('cells', [])
                     if c['kind'] == 'cash' and c['shape'] == 'showdown_checked_river'), None)
    check('judge after 20261124171043_the_hand_gap_grade_names_its_worst_hands: the 12:47Z sample still passes and now names its slowest hand',
          rc == 0 and verdict['status'] == 'pass' and verdict['extremesAvailable'] is True
          and cell1247 and cell1247['maxMs'] == 1422
          and cell1247['worstHands'][0]['hand_id'] == ids1247[13]
          and cell1247['worstHands'][0]['unintended_ms'] == 1422,
          {'rc': rc, 'verdict': verdict, 'stderr': err, 'slow_hand': ids1247[13]})

    tstall, idsstall = insert_recent_pairs([plain_owed + 2, plain_owed + 6100], now - dt.timedelta(minutes=9))
    rc, verdict, err = judge(since)
    check('judge after 20261124171043_the_hand_gap_grade_names_its_worst_hands: one 6,100 ms stall fails on the hard ceiling and the verdict names that hand',
          rc == 1 and verdict['status'] == 'fail'
          and [b['rule'] for b in verdict['breaches']] == ['hard_ceiling']
          and 'kind=cash shape=showdown_checked_river n=16 rule=hard_ceiling max_ms=6100 > ceiling_ms=5000' in err
          and f'{idsstall[1]}:6100ms' in err,
          {'rc': rc, 'verdict': verdict, 'stderr': err, 'stall_hand': idsstall[1]})

    # Phase 7 (20261126031922, incident 1e532243): TournamentManagerBase.resumeFromBreak()
    # clears on_break=false and break_ends_at=NULL while leaving break_started_at set.
    # Prove fail-before and pass-after across fn_ca_hand_gap_unintended_delay,
    # reliability_runbook_hand_gap_classification, and fn_ca_felt_latency for all
    # 4 tournament break states.
    felt_src = FELT_MIGRATION.read_text()
    felt_start = felt_src.index('CREATE OR REPLACE FUNCTION public.fn_ca_felt_latency(')
    felt_end = felt_src.index('$function$;', felt_start) + len('$function$;')
    run(felt_src[felt_start:felt_end])

    w52_start = T0 + dt.timedelta(minutes=5 * 51)
    w52_end = T0 + dt.timedelta(minutes=5 * 52)
    tour_resumed = str(uuid.uuid4())
    tour_active_open = str(uuid.uuid4())
    tour_countdown = str(uuid.uuid4())
    tour_short_resumed = str(uuid.uuid4())
    # 1. Resumed 25 minutes earlier: on_break=false, break_ends_at=NULL, old break_started_at
    run(f"""INSERT INTO tournaments(id, on_break, break_started_at, break_ends_at)
            VALUES ('{tour_resumed}', false, '{(w52_start - dt.timedelta(minutes=25)).isoformat()}', NULL)""")
    # 2. Active pre-countdown break: on_break=true, break_ends_at=NULL, started 2 minutes ago
    run(f"""INSERT INTO tournaments(id, on_break, break_started_at, break_ends_at)
            VALUES ('{tour_active_open}', true, '{(w52_start - dt.timedelta(minutes=2)).isoformat()}', NULL)""")
    # 3. Active countdown break: break_ends_at IS NOT NULL covering window 52
    run(f"""INSERT INTO tournaments(id, on_break, break_started_at, break_ends_at)
            VALUES ('{tour_countdown}', true, '{(w52_start - dt.timedelta(minutes=1)).isoformat()}',
                    '{(w52_end + dt.timedelta(minutes=1)).isoformat()}')""")
    # 4. Short (<60s) break that already resumed: on_break=false, break_ends_at=NULL,
    #    break_started_at stamped inside the hand gap
    short_h1_start = w52_start + dt.timedelta(seconds=10)
    short_h1_end = short_h1_start + dt.timedelta(seconds=10)
    short_break_at = short_h1_end + dt.timedelta(seconds=2)
    short_h2_start = short_h1_end + dt.timedelta(seconds=25)
    short_h2_end = short_h2_start + dt.timedelta(seconds=10)
    run(f"""INSERT INTO tournaments(id, on_break, break_started_at, break_ends_at)
            VALUES ('{tour_short_resumed}', false, '{short_break_at.isoformat()}', NULL)""")

    t_resumed = table('fold', lambda k: 1200, [52], tournament=tour_resumed)
    t_active_open = table('showdown_checked_river', lambda k: 2200, [52], tournament=tour_active_open)
    t_countdown = table('showdown_river_chips', lambda k: 2400, [52], tournament=tour_countdown)
    t_short = str(uuid.uuid4())
    run(f"""INSERT INTO hand_history(id, table_id, tournament_id, created_at, started_at, ended_at, actions, players, pots, showdown)
            VALUES
              ('{uuid.uuid4()}', '{t_short}', '{tour_short_resumed}', '{short_h1_end.isoformat()}', '{short_h1_start.isoformat()}', '{short_h1_end.isoformat()}', '[]'::jsonb, '[{{"userId":"{U1}","stack":100}},{{"userId":"{U2}","stack":100}}]'::jsonb, '[]'::jsonb, '[]'::jsonb),
              ('{uuid.uuid4()}', '{t_short}', '{tour_short_resumed}', '{short_h2_end.isoformat()}', '{short_h2_start.isoformat()}', '{short_h2_end.isoformat()}', '[]'::jsonb, '[{{"userId":"{U1}","stack":100}},{{"userId":"{U2}","stack":100}}]'::jsonb, '[]'::jsonb, '[]'::jsonb)""")

    # Fail-before proof: BEFORE 20261126031922, all 3 functions treat tour_resumed as on break forever!
    g52_before = grade(52)
    felt_before = int(run(
        f"SELECT count(*) FROM public.fn_ca_felt_latency('{w52_start.isoformat()}', '{w52_end.isoformat()}') "
        f"WHERE table_id = '{t_resumed}' AND excluded = 'break'"))
    run("UPDATE financial_alerts SET resolved = true WHERE source = 'fn_ca_hand_gap_watch' AND NOT resolved")
    fa_resumed = run(
        "INSERT INTO financial_alerts(severity, source, message, context) VALUES "
        "('critical', 'fn_ca_hand_gap_watch', 'gap', "
        f"jsonb_build_object('kind', 'tournament', 'shape', 'fold', 'window_end', '{w52_end.isoformat()}', 'budget_ms', 250)) "
        "RETURNING id")
    rb_before = json.loads(run(
        f"SELECT smarter_private.reliability_runbook_hand_gap_classification('{uuid.uuid4()}', true, '{{}}'::jsonb, now())"))
    check('before 20261126031922: resumed post-break tournament is falsely excluded/classified as break across all 3 functions',
          ('tournament', 'fold') not in g52_before
          and felt_before > 0
          and rb_before['alerts'][0]['by_class'].get('tournament_break', 0) > 0
          and rb_before['alerts'][0]['by_class'].get('other') is None,
          {'g52_before': list(g52_before.values()), 'felt_before': felt_before, 'rb_before': rb_before})

    # Install 20261126031922 and verify @live-proof + idempotency.
    run(BREAK_PREDICATE_MIGRATION.read_text())
    break_proof = BREAK_PREDICATE_MIGRATION.read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
    check('migration 20261126031922 installs as written and its live proof holds',
          run('SELECT ' + break_proof) == 't', break_proof)
    run(BREAK_PREDICATE_MIGRATION.read_text())
    check('migration 20261126031922 is idempotent',
          run('SELECT ' + break_proof) == 't', break_proof)

    # Pass-after proof: resumed tournament is NOW graded and classified 'other' (alert stays open),
    # while active pre-countdown break, active countdown break, and short resumed break remain excluded.
    g52_after = grade(52)
    resumed_pairs_15m = int(run(f"SELECT count(*) - 1 FROM hand_history WHERE table_id = '{t_resumed}'"))
    felt_resumed_after = json.loads(run(
        f"SELECT jsonb_build_object("
        f"'graded', count(*) FILTER (WHERE excluded IS NULL), "
        f"'break', count(*) FILTER (WHERE excluded = 'break')) "
        f"FROM public.fn_ca_felt_latency('{w52_start.isoformat()}', '{w52_end.isoformat()}') "
        f"WHERE table_id = '{t_resumed}'"))
    felt_active_break = int(run(
        f"SELECT count(*) FROM public.fn_ca_felt_latency('{w52_start.isoformat()}', '{w52_end.isoformat()}') "
        f"WHERE table_id IN ('{t_active_open}', '{t_countdown}', '{t_short}') AND excluded IS NULL"))
    rb_after = json.loads(run(
        f"SELECT smarter_private.reliability_runbook_hand_gap_classification('{uuid.uuid4()}', false, '{{}}'::jsonb, now())"))
    al_after = rb_after['alerts'][0]
    check('after 20261126031922: resumed post-break tournament is graded, classified other (alert stays open), and included in felt latency',
          ('tournament', 'fold') in g52_after
          and g52_after[('tournament', 'fold')]['unintended_p95_ms'] == 1200
          and al_after['by_class'].get('other', 0) == resumed_pairs_15m
          and al_after['by_class'].get('tournament_break') == 1  # only tour_short_resumed's 1 in-gap break hand
          and not al_after['all_intended']
          and run(f"SELECT resolved FROM financial_alerts WHERE id = '{fa_resumed}'") == 'f'
          and felt_resumed_after['graded'] > 0 and felt_resumed_after['break'] == 0,
          {'g52_after': list(g52_after.values()), 'al_after': al_after, 'felt_resumed_after': felt_resumed_after})
    check('after 20261126031922: active open-ended break, countdown break, and short in-gap resumed break remain excluded across grader and felt latency',
          ('tournament', 'showdown_checked_river') not in g52_after
          and ('tournament', 'showdown_river_chips') not in g52_after
          and felt_active_break == 0,
          {'g52_after': list(g52_after.values()), 'felt_active_break': felt_active_break})

    # Re-run diagnostic script against the final upgraded schema.
    run(SCRIPT_SQL.read_text())
    check('scripts/sql/hand-gap-unintended-delay.sql executes cleanly after 20261126031922', True)

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
