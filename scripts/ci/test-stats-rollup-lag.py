"""Native PG17 probe for 20261111031027: the stats roll-up leaves young hands to the live projection.

No production connection. Installs the live predecessor body of
public.ca_roll_hand_stats_forward() (md5 pinned) over a minimal schema,
reproduces the wait the live post-commit projection suffered at :00/:15/:30/:45,
applies the migration and proves:
  (a) a hand younger than the margin is not inserted by the roll-up, so a
      concurrent live insert of the same (user_id, hand_id) does not wait;
  (b) a hand older than the margin is still rolled, and a young hand whose
      live row never landed is rolled once it ages past the margin;
  (c) rolled_ceil never advances past now() - 5 minutes and never moves back;
  (d) rolled_ceil never passes the start of an open writer, so no hand is
      skipped (the predecessor is shown to skip it), and it lands exactly once;
  (e) a revised (voided or corrected) player-hand is never re-inserted
      (the predecessor is shown to resurrect a voided one).
"""
import argparse
import json
import os
import pathlib
import select
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
root = pathlib.Path(__file__).resolve().parents[2]
parser.add_argument('--migration', type=pathlib.Path, default=root / 'supabase/migrations/20261111031027_the_stats_rollup_leaves_young_hands_to_the_live_projection.sql')
parser.add_argument('--output', type=pathlib.Path, default=None)
args = parser.parse_args()
PRE = (root / 'scripts/ci/probes/stats-rollup-lag/live-predecessor.sql').read_text()
PRE_MD5 = '07f9ad834d98b1944eecbab0439f63fb'
OLD2 = '    FROM public.ca_hand_player_facts(v_ceil, v_end) f\n    ORDER BY f.user_id, f.hand_id\n'
NEW2 = '    FROM public.ca_hand_player_facts(v_ceil, v_end) f\n    WHERE NOT EXISTS (SELECT 1 FROM public.ca_hand_fact_revisions r WHERE r.hand_id = f.hand_id AND r.user_id = f.user_id)\n    ORDER BY f.user_id, f.hand_id\n'
NEWL = "v_now timestamptz := least(now() - interval '5 minutes', coalesce((SELECT min(a.xact_start) FROM pg_catalog.pg_stat_activity a WHERE a.datname = current_database() AND a.backend_type = 'client backend' AND a.pid <> pg_backend_pid() AND a.xact_start IS NOT NULL), now()));"
MIGRATION = args.migration.read_text()
pg = pathlib.Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
cluster = pathlib.Path(tempfile.mkdtemp(prefix='ca-rollup-lag-', dir='/tmp'))
sock = cluster / 'socket'
sock.mkdir()
psql = [str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock),
        '-p', '55861', '-U', 'postgres', '-d', 'postgres']
sessions, checks = [], []
started = False


def run(command, source=None):
    r = subprocess.run([str(x) for x in command], input=source, text=True,
                       capture_output=True, env=env, timeout=25)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def sql(source):
    return run(psql, source)


def refused(source):
    r = subprocess.run(psql, input=source, text=True, capture_output=True, env=env, timeout=25)
    return r.returncode != 0, r.stderr


def check(name, condition):
    assert condition, name
    checks.append(name)
    print('PASS:', name, flush=True)


class Session:
    def __init__(self, name):
        self.name = name
        self.err = tempfile.TemporaryFile()
        self.process = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=self.err, env={**env, 'PGAPPNAME': name})
        self.buf, self.number = b'', 0
        sessions.append(self)

    def send(self, source):
        self.number += 1
        self.marker = ('READY_' + str(self.number)).encode()
        self.process.stdin.write((source + '\n\\echo ' + self.marker.decode() + '\n').encode())
        self.process.stdin.flush()

    def finish(self, seconds=15):
        deadline = time.monotonic() + seconds
        lines = []
        while time.monotonic() < deadline:
            while b'\n' in self.buf:
                line, self.buf = self.buf.split(b'\n', 1)
                if line == self.marker:
                    return {'ok': True, 'output': b'\n'.join(lines).decode()}
                lines.append(line)
            if self.process.poll() is not None:
                self.err.seek(0)
                return {'ok': False, 'error': self.err.read().decode()}
            if select.select([self.process.stdout], [], [], .03)[0]:
                self.buf += os.read(self.process.stdout.fileno(), 65536)
        return None

    def execute(self, source):
        self.send(source)
        r = self.finish()
        if not r or not r['ok']:
            raise RuntimeError(self.name + ': ' + str(r))
        return r['output']

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=3)
        self.err.close()


def waiting(name, event='transactionid', seconds=4):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND wait_event='{event}';") == '1':
            return True
        time.sleep(.04)
    return False


A = '00000000-0000-0000-0000-00000000000a'
B = '00000000-0000-0000-0000-00000000000b'
OLD = '00000000-0000-0000-0000-000000000001'   # 10 minutes old: past the margin
YOUNG = '00000000-0000-0000-0000-000000000002'  # 10 seconds old: projection may be in flight
FORWARD = 'SELECT public.ca_roll_hand_stats_forward();'
LIVE = (f"SET LOCAL statement_timeout='3s'; INSERT INTO ca_hand_player_stat(user_id,hand_id,created_at,profit) "
        f"SELECT '{A}',id,created_at,-1 FROM hand_history WHERE id='{YOUNG}' ON CONFLICT (user_id,hand_id) DO NOTHING;")


def seed(ceil_sql="now() - interval '1 hour'"):
    sql(f"""TRUNCATE hand_history, ca_hand_player_stat, fixture_facts;
      INSERT INTO hand_history(id,created_at) VALUES
        ('{OLD}', now() - interval '10 minutes'), ('{YOUNG}', now() - interval '10 seconds');
      INSERT INTO fixture_facts(user_id,hand_id,created_at,profit)
        SELECT u, h.id, h.created_at, 7 FROM hand_history h CROSS JOIN (VALUES ('{A}'::uuid),('{B}'::uuid)) v(u);
      UPDATE ca_hand_player_stat_state SET rolled_ceil = {ceil_sql}, updated_at = NULL;""")


def rows():
    return sql("SELECT coalesce(string_agg(hand_id::text||':'||user_id::text||':'||profit::text, ',' ORDER BY hand_id,user_id),'') FROM ca_hand_player_stat;")


def authority():
    return sql("SELECT pg_get_userbyid(proowner)||'|'||proacl::text||'|'||proconfig::text||'|'||prosecdef FROM pg_proc WHERE oid='public.ca_roll_hand_stats_forward()'::regprocedure;")


def body_md5():
    return sql("SELECT md5(pg_get_functiondef('public.ca_roll_hand_stats_forward()'::regprocedure));")


LATE = '00000000-0000-0000-0000-000000000003'


def late_writer(label, wait="5 minutes 2 seconds"):
    """A hand whose writer is still open when the roll-up's window passes its
    created_at (= the writer's transaction start). Waits `wait` of real time."""
    sql("TRUNCATE hand_history, ca_hand_player_stat, fixture_facts;"
        "UPDATE ca_hand_player_stat_state SET rolled_ceil = now() - interval '1 hour', updated_at = NULL;")
    w = Session(label + '-late-writer')
    w.execute(f"BEGIN; INSERT INTO hand_history(id,created_at) VALUES ('{LATE}', now());"
              f"INSERT INTO fixture_facts(user_id,hand_id,created_at,profit) SELECT u,'{LATE}',now(),7 "
              f"FROM (VALUES ('{A}'::uuid),('{B}'::uuid)) v(u);")
    start = w.execute('SELECT now();').strip()
    while sql(f"SELECT now() > '{start}'::timestamptz + interval '{wait}';") != 't':
        time.sleep(2)
    sql(FORWARD)
    ceil_held = sql(f"SELECT rolled_ceil <= '{start}'::timestamptz FROM ca_hand_player_stat_state;") == 't'
    unseen = f'{LATE}:' not in rows()
    w.execute('COMMIT;'); w.close()
    sql(FORWARD); sql(FORWARD)
    late_rows = sql(f"SELECT concat_ws(':', count(*), count(DISTINCT user_id), min(profit), max(profit)) FROM ca_hand_player_stat WHERE hand_id='{LATE}';")
    return ceil_held, unseen, late_rows


def revised(label):
    """A's OLD hand was voided after its live row landed; B's OLD hand was corrected to 99."""
    seed()
    sql(f"TRUNCATE ca_hand_fact_revisions; INSERT INTO ca_hand_fact_revisions(hand_id,user_id) VALUES ('{OLD}','{A}'),('{OLD}','{B}');"
        f"INSERT INTO ca_hand_player_stat(user_id,hand_id,created_at,profit) SELECT '{B}',id,created_at,99 FROM hand_history WHERE id='{OLD}';")
    sql(FORWARD)
    got = rows()
    sql('TRUNCATE ca_hand_fact_revisions;')
    return got


def race(label):
    """Roll-up holds its transaction open; a live insert of the young hand races it."""
    roll, live = Session(label + '-rollup'), Session(label + '-live')
    roll.execute('BEGIN; ' + FORWARD)
    live.send('BEGIN; ' + LIVE + ' COMMIT;')
    blocked = waiting(live.name)
    t0 = time.monotonic()
    roll.execute('COMMIT;')
    outcome = live.finish()
    roll.close(); live.close()
    return blocked, outcome, time.monotonic() - t0


try:
    version = run([pg / 'postgres', '--version'])
    check('uses PostgreSQL 17', 'PostgreSQL) 17.' in version)
    run([pg / 'initdb', '-D', cluster / 'data', '-U', 'postgres', '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'])
    run([pg / 'pg_ctl', '-D', cluster / 'data', '-l', cluster / 'log', '-o',
         f"-k {sock} -p 55861 -c listen_addresses='' -c shared_buffers=16MB -c max_connections=10", '-w', 'start'])
    started = True
    sql("""CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE TABLE hand_history(id uuid PRIMARY KEY, created_at timestamptz);
      CREATE TABLE ca_hand_player_stat(user_id uuid, hand_id uuid, created_at timestamptz, is_cash boolean, tournament_id uuid,
        game_variant text, big_blind numeric, small_blind numeric, n_players integer, seat_position text, my_blind numeric,
        won_amt numeric, is_winner boolean, invested_actions numeric, aggro_cnt integer, call_cnt integer, vpip boolean,
        pfr boolean, folded boolean, three_bet boolean, three_bet_opp boolean, faced_three_bet boolean,
        folded_to_three_bet boolean, cbet_opp boolean, cbet_made boolean, showdown boolean, hand_secs numeric,
        profit numeric, asset text NOT NULL DEFAULT 'chips', PRIMARY KEY (user_id, hand_id));
      CREATE TABLE ca_hand_player_stat_state(id boolean PRIMARY KEY CHECK (id), rolled_ceil timestamptz,
        rolled_floor timestamptz, complete boolean, updated_at timestamptz);
      INSERT INTO ca_hand_player_stat_state(id) VALUES (true);
      CREATE TABLE fixture_facts(LIKE ca_hand_player_stat INCLUDING ALL);
      CREATE TABLE ca_hand_fact_revisions(hand_id uuid, user_id uuid, created_at timestamptz DEFAULT now());
      CREATE FUNCTION ca_hand_player_facts(timestamptz, timestamptz) RETURNS SETOF ca_hand_player_stat LANGUAGE sql
        AS $$SELECT * FROM fixture_facts WHERE created_at >= $1 AND created_at < $2$$;""")
    sql(PRE)
    sql('REVOKE ALL ON FUNCTION public.ca_roll_hand_stats_forward() FROM PUBLIC; '
        'GRANT EXECUTE ON FUNCTION public.ca_roll_hand_stats_forward() TO service_role;')
    check('captured predecessor is the live body (md5 ' + PRE_MD5 + ')', body_md5() == PRE_MD5)
    initial_authority = authority()
    check('predecessor authority is the live authority',
          initial_authority == 'postgres|{postgres=X/postgres,service_role=X/postgres}|{search_path=public,statement_timeout=4min}|true')

    # The proven cause, reproduced on the live body.
    seed()
    blocked, outcome, _ = race('before')
    check('live body: a live insert of a 10 s old hand waits on the open roll-up transaction', blocked)
    check('live body: the live insert finds the roll-up row once it commits', outcome and outcome['ok'] and
          f'{YOUNG}:{A}:7' in rows())

    held, unseen, late_rows = late_writer('before', '2 seconds')
    check('live body: the roll-up closes its window past a hand whose writer is still open', not held and unseen)
    check('live body: that hand is then skipped for good', late_rows.startswith('0:'))

    got = revised('before')
    check('live body: a voided player-hand is re-inserted by the roll-up', f'{OLD}:{A}:7' in got)

    # Install.
    sql(MIGRATION)
    post = sql("SELECT pg_get_functiondef('public.ca_roll_hand_stats_forward()'::regprocedure);")
    check('migration changes exactly the two lines',
          post.count(NEWL) == 1 and 'v_now timestamptz := now();' not in post and post.count(NEW2) == 1 and OLD2 not in post)
    check('reverse substitution reproduces the live body byte for byte', sql(
        "SELECT md5(replace(replace(pg_get_functiondef('public.ca_roll_hand_stats_forward()'::regprocedure), "
        "$f$"+NEWL[len('v_now timestamptz := '):]+"$f$, 'now();'), $f$"+NEW2+"$f$, $f$"+OLD2+"$f$));") == PRE_MD5)
    check('owner, grants, proconfig and SECURITY DEFINER retained', authority() == initial_authority)
    post_md5 = body_md5()
    sql(MIGRATION)
    check('migration replays as a no-op', body_md5() == post_md5 and authority() == initial_authority)

    # (a) young hand: no wait.
    seed()
    before = time.time()
    blocked, outcome, _ = race('after')
    check('(a) a live insert of a 10 s old hand does not wait on the roll-up', not blocked and outcome and outcome['ok'])
    got = rows()
    check('(a) the young hand row is the live writer\'s, not the roll-up\'s',
          f'{YOUNG}:{A}:-1' in got and f'{YOUNG}:{B}' not in got)
    # (b) old hand still rolled.
    check('(b) a 10 minute old hand is rolled for every player', f'{OLD}:{A}:7' in got and f'{OLD}:{B}:7' in got)
    # (c) ceiling.
    check('(c) rolled_ceil stops at or before now() - 5 minutes and after the old hand',
          sql("SELECT rolled_ceil <= statement_timestamp() - interval '5 minutes' AND rolled_ceil > (SELECT created_at FROM hand_history WHERE id='"
              + OLD + "') AND rolled_ceil < (SELECT created_at FROM hand_history WHERE id='" + YOUNG + "') FROM ca_hand_player_stat_state;") == 't')

    # (b) completeness: a young hand whose live row never landed is rolled once it is old enough.
    sql(f"DELETE FROM ca_hand_player_stat WHERE hand_id='{YOUNG}';")
    ceil_before = sql('SELECT rolled_ceil FROM ca_hand_player_stat_state;')
    check('(b) before it ages past the margin, the young hand is not rolled', sql(FORWARD) is not None and f'{YOUNG}:' not in rows())
    # Six minutes pass: shift every stored time back instead of sleeping.
    sql("UPDATE hand_history SET created_at = created_at - interval '6 minutes';"
        "UPDATE fixture_facts SET created_at = created_at - interval '6 minutes';"
        "UPDATE ca_hand_player_stat SET created_at = created_at - interval '6 minutes';"
        "UPDATE ca_hand_player_stat_state SET rolled_ceil = rolled_ceil - interval '6 minutes';")
    ceil_before = sql('SELECT rolled_ceil FROM ca_hand_player_stat_state;')
    sql(FORWARD)
    got = rows()
    check('(b) once older than the margin, the hand with no live row is rolled for every player',
          f'{YOUNG}:{A}:7' in got and f'{YOUNG}:{B}:7' in got)
    check('(c) rolled_ceil advanced, still not past now() - 5 minutes',
          sql(f"SELECT rolled_ceil > '{ceil_before}'::timestamptz AND rolled_ceil <= statement_timestamp() - interval '5 minutes' FROM ca_hand_player_stat_state;") == 't')

    # (c) a ceiling the old body left ahead of the new bound is neither crossed nor moved back.
    seed("now() - interval '30 seconds'")
    ahead = sql('SELECT rolled_ceil FROM ca_hand_player_stat_state;')
    check('(c) a ceiling ahead of the bound returns 0 and writes nothing', sql(FORWARD) == '0' and rows() == '')
    check('(c) that ceiling is not moved backwards', sql('SELECT rolled_ceil FROM ca_hand_player_stat_state;') == ahead)

    # (e) revisions own their rows.
    got = revised('after')
    check('(e) a voided player-hand is not re-inserted', f'{OLD}:{A}:' not in got)
    check('(e) a corrected player-hand keeps its corrected row', f'{OLD}:{B}:99' in got and f'{OLD}:{B}:7' not in got)

    # (d) no skip: the bound never passes the start of an open writer.
    held, unseen, late_rows = late_writer('after')
    check('(d) rolled_ceil stops at the start of a writer still open', held and unseen)
    check('(d) once that writer commits, its hand is rolled exactly once for every player', late_rows == '2:2:7:7')

    # Existing behaviour kept: the bulk try-lock still defers.
    seed()
    holder = Session('bulk-holder')
    holder.execute("BEGIN; SELECT pg_advisory_xact_lock(hashtext('ca_hand_player_stat_background'));")
    check('the background advisory try-lock still returns 0 without waiting', sql(FORWARD) == '0' and rows() == '')
    holder.execute('COMMIT;'); holder.close()
    check('browser roles still cannot execute the roll-up',
          sql("SELECT NOT has_function_privilege('anon','public.ca_roll_hand_stats_forward()','EXECUTE') AND NOT has_function_privilege('authenticated','public.ca_roll_hand_stats_forward()','EXECUTE') AND has_function_privilege('service_role','public.ca_roll_hand_stats_forward()','EXECUTE');") == 't')

    # Refusals: drift and authority change abort with nothing changed.
    sql(PRE.replace('BEGIN\n', 'BEGIN\n  -- drift\n', 1))
    drifted = body_md5()
    no, err = refused(MIGRATION)
    check('a drifted body is refused and left untouched', no and 'not the pinned text' in err and body_md5() == drifted)
    sql(PRE)
    sql('GRANT EXECUTE ON FUNCTION public.ca_roll_hand_stats_forward() TO authenticated;')
    no, err = refused(MIGRATION)
    check('a changed grant is refused and the body left untouched', no and 'authority changed' in err and body_md5() == PRE_MD5)

    result = {'passed': True, 'checks': checks, 'postgres': version, 'production_connections': 0}
    print(json.dumps({'passed': True, 'checks': len(checks)}))
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
        (args.output / 'RESULT.json').write_text(json.dumps(result, indent=2))
finally:
    for s in sessions:
        try:
            s.close()
        except Exception:
            pass
    if started:
        run([pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'fast', '-w', 'stop'])
    shutil.rmtree(cluster, ignore_errors=True)
