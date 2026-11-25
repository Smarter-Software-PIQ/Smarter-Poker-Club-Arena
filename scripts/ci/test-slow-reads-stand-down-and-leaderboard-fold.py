#!/usr/bin/env python3
"""Native PostgreSQL proof for the two 2026-11-25 statement-timeout fixes.

20261125022315  a certification spawn stands down while its club is retired
20261125022320  the club tournament leaderboard reads a folded total

Builds a throwaway cluster on a Unix socket (no network, no production) and
installs the EXACT live bodies captured on 2026-11-25 from
scripts/ci/fixtures/slow-reads/, pinned by the md5 each migration checks.

Spawn stand-down, with a second session holding the club row:
  BEFORE  a claim for a certification club held FOR UPDATE waits and is
          cancelled by its statement timeout (57014), as in production;
  AFTER   the same claim stands down at once with 23505
          CERT_FIXTURE_BEING_RETIRED; a real club held FOR UPDATE still
          waits exactly as before; a certification club under an ordinary
          FOR NO KEY UPDATE write, or not locked at all, still claims.

Leaderboard fold:
  - before any fold runs the new reader equals the old reader;
  - after a fold it still equals it, including unfinished, just-finished and
    private tournaments (the live tail) and players with no profile;
  - a prize corrected in a folded tournament is reflected by the next fold;
  - a second fold with nothing changed writes 0 rows and removes 0;
  - a player whose entries carry two usernames is one row (the old reader
    split them);
  - on a club with 200,000 finished tournaments the new reader answers in
    under 300 ms while the old reader reads every entry;
  - the folded totals are not readable by anon or authenticated, and the
    migration refuses a second run on its pre-image pin.

Leaderboard tail by index (20261125053826):
  - the folded reader installs as the exact body production runs, which the
    follow-up pins;
  - with statistics shaped like production (thousands of clubs), the
    two-range tail reads only the unfolded tournaments of a club with 200,000
    finished ones (on production the one-OR tail read all 836,174 of Midway
    Union's under its generic plan; that walk depends on the plan, so it is
    printed, not asserted);
  - every club's answer equals the one-OR reader's, page by page;
  - the follow-up refuses a second run on its pre-image pin.

Usage: PG_BIN=/usr/lib/postgresql/17/bin python3 scripts/ci/test-slow-reads-stand-down-and-leaderboard-fold.py
"""
import os
import pathlib
import random
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / 'scripts/ci/fixtures/slow-reads'
SPAWN_MIGRATION = ROOT / 'supabase/migrations/20261125022315_a_certification_spawn_stands_down_while_its_club_is_retired.sql'
BOARD_MIGRATION = ROOT / 'supabase/migrations/20261125022320_the_club_tournament_leaderboard_reads_a_folded_total.sql'
TAIL_MIGRATION = ROOT / 'supabase/migrations/20261125053826_the_leaderboard_reads_its_unfolded_tail_by_index.sql'
PG_BIN = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))

CERT_OWNER = 'a1000000-0000-0000-0000-000000000001'
REAL_OWNER = 'a1000000-0000-0000-0000-000000000002'
CERT_CLUB = 'c1000000-0000-0000-0000-000000000001'
REAL_CLUB = 'c1000000-0000-0000-0000-000000000002'
CERT_SCHEDULE = 'd1000000-0000-0000-0000-000000000001'
REAL_SCHEDULE = 'd1000000-0000-0000-0000-000000000002'

BASE = """
CREATE SCHEMA smarter_private;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (p_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, arena_avatar_url text, email text,
  is_horse boolean DEFAULT false, is_admin boolean DEFAULT false);
CREATE TABLE public.clubs(id uuid PRIMARY KEY, owner_id uuid, created_at timestamptz DEFAULT now(), name text);
"""

SPAWN_SCHEMA = f"""
CREATE TABLE public.tournament_schedules(id uuid PRIMARY KEY, club_id uuid);
CREATE TABLE public.tournament_schedule_spawns(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.tournament_schedules(id) ON DELETE CASCADE, spawn_key text UNIQUE);
CREATE FUNCTION public.fn_ca_reserved_certification_identity(p_user_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id
     AND (p.email LIKE 'ca-customization-cert-postdeploy-%@example.invalid' OR p.email LIKE 'club-create-cert-%@smarter-poker.invalid')
     AND NOT COALESCE(p.is_horse, false) AND NOT COALESCE(p.is_admin, false)) $$;
CREATE FUNCTION public.fn_ca_certification_schedule_past_its_run(p_schedule_id uuid, p_at timestamptz DEFAULT now()) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM public.tournament_schedules s JOIN public.clubs c ON c.id = s.club_id
     WHERE s.id = p_schedule_id AND c.created_at <= p_at - interval '162 minutes'
       AND public.fn_ca_reserved_certification_identity(c.owner_id)) $$;
-- The waiting part of the live fn_guard_retired_club_mutation (line 114).
CREATE FUNCTION public.fn_guard_retired_club_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_club_id uuid;
BEGIN
  SELECT s.club_id INTO v_club_id FROM public.tournament_schedules s WHERE s.id = NEW.schedule_id;
  PERFORM 1 FROM public.clubs c WHERE c.id IN (v_club_id) ORDER BY c.id FOR KEY SHARE;
  RETURN NEW;
END $$;
INSERT INTO public.profiles(id, username, email) VALUES
  ('{CERT_OWNER}', 'cert', 'club-create-cert-1@smarter-poker.invalid'),
  ('{REAL_OWNER}', 'owner', 'owner@example.com');
INSERT INTO public.clubs(id, owner_id, created_at) VALUES
  ('{CERT_CLUB}', '{CERT_OWNER}', now() - interval '20 minutes'),
  ('{REAL_CLUB}', '{REAL_OWNER}', now() - interval '400 days');
INSERT INTO public.tournament_schedules VALUES ('{CERT_SCHEDULE}', '{CERT_CLUB}'), ('{REAL_SCHEDULE}', '{REAL_CLUB}');
"""

SPAWN_TRIGGERS = """
REVOKE ALL ON FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run() TO service_role;
CREATE TRIGGER trg_ca_certification_fixture_spawns_only_during_its_run BEFORE INSERT ON public.tournament_schedule_spawns
  FOR EACH ROW EXECUTE FUNCTION public.fn_ca_certification_fixture_spawns_only_during_its_run();
CREATE TRIGGER trg_guard_retired_club_mutation BEFORE INSERT OR UPDATE OR DELETE ON public.tournament_schedule_spawns
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_retired_club_mutation();
"""

BOARD_SCHEMA = """
CREATE TABLE public.tournaments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid, is_private boolean,
  ended_at timestamptz, buy_in_amount numeric, buy_in_fee numeric);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  username text, status text, position integer, prize numeric, UNIQUE (tournament_id, user_id));
CREATE INDEX ON public.tournaments(club_id);
CREATE INDEX ON public.tournament_players(tournament_id);
-- Production's readers see these three tables (their row security is not
-- modelled here; the fold helper only returns non-private tournaments).
GRANT SELECT ON public.tournaments, public.tournament_players, public.profiles TO anon, authenticated;
"""
BOARD_GRANTS = """
REVOKE ALL ON FUNCTION public.fn_club_tournament_stats(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_club_tournament_stats(uuid,integer,integer) TO PUBLIC, anon, authenticated, service_role;
"""

STATUSES = ['eliminated', 'winner', 'playing', 'registered', 'unregistered']


class Cluster:
    def __init__(self):
        self.dir = pathlib.Path(tempfile.mkdtemp(prefix='slow-reads-'))
        self.data = self.dir / 'data'
        self.sock = self.dir / 'sock'
        self.sock.mkdir()

    def start(self):
        subprocess.run([str(PG_BIN / 'initdb'), '-D', str(self.data), '-A', 'trust', '-U', 'postgres',
                        '--no-sync', '-E', 'UTF8'], check=True, capture_output=True)
        subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(self.data), '-w', '-l', str(self.dir / 'log'),
                        '-o', f"-k {self.sock} -c listen_addresses='' -c fsync=off -c jit=off", 'start'],
                       check=True, capture_output=True)

    def stop(self):
        subprocess.run([str(PG_BIN / 'pg_ctl'), '-D', str(self.data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(self.dir, ignore_errors=True)

    def args(self, db):
        return [str(PG_BIN / 'psql'), '-h', str(self.sock), '-U', 'postgres', '-d', db,
                '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At']

    def psql(self, sql, db='postgres'):
        return subprocess.run(self.args(db), input=sql, capture_output=True, text=True)

    def ok(self, sql, db):
        r = self.psql(sql, db)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    def holder(self, db, lock_sql):
        """A second session that holds a lock until released."""
        p = subprocess.Popen(self.args(db), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        p.stdin.write('BEGIN;\n' + lock_sql + '\nSELECT pg_sleep(0);\n')
        p.stdin.flush()
        time.sleep(0.5)
        return p

    @staticmethod
    def release(p):
        p.stdin.write('ROLLBACK;\n')
        p.stdin.close()
        p.wait(timeout=10)


FAILS = []


def check(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  [{detail}]'))
    if not cond:
        FAILS.append(name)


def claim(c, db, schedule, key):
    r = c.psql(f"SET statement_timeout='2s'; INSERT INTO public.tournament_schedule_spawns(schedule_id, spawn_key) VALUES ('{schedule}', '{key}');", db)
    if r.returncode == 0:
        return 'claimed'
    if 'CERT_FIXTURE_BEING_RETIRED' in r.stderr:
        return 'stood-down'
    if 'statement timeout' in r.stderr:
        return 'timeout'
    return 'error: ' + r.stderr.strip()


def spawn_proof(c):
    db = 'spawn'
    c.ok(f'CREATE DATABASE {db};', 'postgres')
    c.ok(BASE + SPAWN_SCHEMA + (FIX / 'live-certification-spawn-guard-20261125.sql').read_text() + ';' + SPAWN_TRIGGERS, db)
    live = c.ok("SELECT md5(pg_get_functiondef('public.fn_ca_certification_fixture_spawns_only_during_its_run()'::regprocedure));", db)
    check('spawn guard fixture is the exact live body', live == 'f03e8db6f3de841921c04e459254efc2', live)

    h = c.holder(db, f"SELECT 1 FROM public.clubs WHERE id='{CERT_CLUB}' FOR UPDATE;")
    check('BEFORE: a claim for a certification club held FOR UPDATE times out', claim(c, db, CERT_SCHEDULE, 'b1') == 'timeout')
    c.release(h)

    r = c.psql(SPAWN_MIGRATION.read_text(), db)
    check('spawn migration installs', r.returncode == 0, r.stderr.strip())

    h = c.holder(db, f"SELECT 1 FROM public.clubs WHERE id='{CERT_CLUB}' FOR UPDATE;")
    t0 = time.time()
    got = claim(c, db, CERT_SCHEDULE, 'a1')
    check('AFTER: the same claim stands down at once with 23505', got == 'stood-down' and time.time() - t0 < 1.5, got)
    c.release(h)

    h = c.holder(db, f"SELECT 1 FROM public.clubs WHERE id='{REAL_CLUB}' FOR UPDATE;")
    check('AFTER: a real club held FOR UPDATE still waits as before', claim(c, db, REAL_SCHEDULE, 'a2') == 'timeout')
    c.release(h)

    h = c.holder(db, f"UPDATE public.clubs SET name='x' WHERE id='{CERT_CLUB}';")
    check('AFTER: an ordinary write on a certification club does not stand a claim down',
          claim(c, db, CERT_SCHEDULE, 'a3') == 'claimed')
    c.release(h)

    check('AFTER: an unlocked certification club still claims', claim(c, db, CERT_SCHEDULE, 'a4') == 'claimed')
    check('AFTER: an unlocked real club still claims', claim(c, db, REAL_SCHEDULE, 'a5') == 'claimed')
    again = c.psql(SPAWN_MIGRATION.read_text(), db)
    check('spawn migration refuses a second run on its pre-image pin',
          again.returncode != 0 and 'changed since 2026-11-25' in again.stderr, again.stderr.strip())


def seed_board(c, db, rng):
    clubs = ['e1000000-0000-0000-0000-00000000000%d' % i for i in range(1, 4)]
    users = ['f1000000-0000-0000-0000-%012d' % i for i in range(1, 41)]
    rows_t, rows_p = [], []
    for n in range(400):
        tid = '%08x-0000-4000-8000-%012d' % (0x70000000 + n, n)
        club = rng.choice(clubs)
        kind = rng.random()
        if kind < 0.70:
            ended = "now() - interval '%d hours'" % rng.randint(2, 4000)
        elif kind < 0.80:
            ended = "now() - interval '%d minutes'" % rng.randint(0, 9)
        elif kind < 0.90:
            ended = 'NULL'
        else:
            ended = "now() - interval '%d days'" % rng.randint(1, 30)
        private = 'true' if rng.random() < 0.05 else rng.choice(['false', 'NULL'])
        buy = rng.choice(['NULL', '0', '5', '10.50', '100'])
        fee = rng.choice(['NULL', '0', '1', '2.25'])
        rows_t.append(f"('{tid}','{club}',{private},{ended},{buy},{fee})")
        for pos, u in enumerate(rng.sample(users, rng.randint(2, 9)), start=1):
            st = rng.choices(STATUSES, weights=[60, 8, 10, 10, 12])[0]
            prize = rng.choice(['NULL', '0', '0', str(rng.randint(1, 500)), '%d.75' % rng.randint(1, 50)])
            position = str(pos) if rng.random() < 0.8 else 'NULL'
            rows_p.append(f"('{tid}','{u}','name-{u[-3:]}','{st}',{position},{prize})")
    c.ok('INSERT INTO public.tournaments(id,club_id,is_private,ended_at,buy_in_amount,buy_in_fee) VALUES '
         + ','.join(rows_t) + ';', db)
    c.ok('INSERT INTO public.tournament_players(tournament_id,user_id,username,status,position,prize) VALUES '
         + ','.join(rows_p) + ';', db)
    prof = ','.join(f"('{u}','profile-{u[-3:]}','https://a/{u[-3:]}')" for u in users[:30])
    c.ok(f'INSERT INTO public.profiles(id,username,arena_avatar_url) VALUES {prof};', db)
    return clubs


def board(c, db, fn_sql, club):
    return c.ok(f"SELECT string_agg(r::text, E'\\n' ORDER BY ord) FROM (SELECT row_number() OVER () ord, x AS r FROM "
                f"({fn_sql.format(club=club)}) x) z;", db)


def board_proof(c):
    db = 'board'
    rng = random.Random(20261125)
    c.ok(f'CREATE DATABASE {db};', 'postgres')
    c.ok(BASE + BOARD_SCHEMA + (FIX / 'live-club-tournament-stats-20261125.sql').read_text() + ';' + BOARD_GRANTS, db)
    live = c.ok("SELECT md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure));", db)
    check('leaderboard fixture is the exact live body', live == '627eccb4daed89a26feeda113eab0118', live)
    clubs = seed_board(c, db, rng)

    old = {k: board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 1000, 0)", k) for k in clubs}
    # Keep the old body under another name for the after-migration comparisons.
    c.ok((FIX / 'live-club-tournament-stats-20261125.sql').read_text()
         .replace('public.fn_club_tournament_stats(', 'public.old_club_tournament_stats(', 1) + ';', db)

    r = c.psql(BOARD_MIGRATION.read_text(), db)
    check('leaderboard migration installs', r.returncode == 0, r.stderr.strip())
    if r.returncode != 0:
        return

    def same(label):
        for k in clubs:
            a = board(c, db, "SELECT * FROM public.old_club_tournament_stats('{club}', 1000, 0)", k)
            b = board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 1000, 0)", k)
            if a != b:
                check(label, False, f'club {k}\nold:\n{a[:600]}\nnew:\n{b[:600]}')
                return
        check(label, True)

    check('the installed reader matches the pre-migration answer before any fold',
          all(old[k] == board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 1000, 0)", k) for k in clubs))
    same('before any fold the new reader equals the old reader')
    out = c.ok('SELECT smarter_private.refresh_club_tournament_leaderboard_totals();', db)
    check('the first fold writes rows', '"rows_written": 0' not in out, out)
    same('after a fold the new reader equals the old reader (live tail, private, no profile)')
    pages = all(
        board(c, db, "SELECT * FROM public.old_club_tournament_stats('{club}', 7, 7)", k)
        == board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 7, 7)", k) for k in clubs)
    check('a middle page is the same page', pages)

    out = c.ok('SELECT smarter_private.refresh_club_tournament_leaderboard_totals();', db)
    check('a fold with nothing changed writes 0 rows and removes 0',
          '"rows_written": 0' in out and '"rows_removed": 0' in out, out)

    c.ok("""UPDATE public.tournament_players tp SET prize = COALESCE(tp.prize,0) + 1000
             WHERE tp.id = (SELECT tp2.id FROM public.tournament_players tp2 JOIN public.tournaments t ON t.id=tp2.tournament_id
                             WHERE t.ended_at < now() - interval '1 day' AND t.is_private IS NOT TRUE AND tp2.status='eliminated'
                             ORDER BY tp2.id LIMIT 1);""", db)
    stale = any(
        board(c, db, "SELECT * FROM public.old_club_tournament_stats('{club}', 1000, 0)", k)
        != board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 1000, 0)", k) for k in clubs)
    check('a prize corrected in a folded tournament waits for the next fold', stale)
    out = c.ok('SELECT smarter_private.refresh_club_tournament_leaderboard_totals();', db)
    check('the next fold rewrites only the corrected player', '"rows_written": 1,' in out or '"rows_written": 1}' in out, out)
    same('after the next fold the correction is reflected')

    c.ok(f"""INSERT INTO public.tournaments(id,club_id,ended_at,buy_in_amount) VALUES
               ('99999999-0000-4000-8000-000000000001','{clubs[0]}',now(),10),
               ('99999999-0000-4000-8000-000000000002','{clubs[0]}',NULL,10);
             INSERT INTO public.tournament_players(tournament_id,user_id,username,status,position,prize) VALUES
               ('99999999-0000-4000-8000-000000000001','f1000000-0000-0000-0000-000000000001','n','winner',1,77),
               ('99999999-0000-4000-8000-000000000002','f1000000-0000-0000-0000-000000000002','n','eliminated',3,5);""", db)
    same('a tournament finished after the fold counts at once, through the live tail')

    split_user = 'f2000000-0000-0000-0000-000000000001'
    c.ok(f"""INSERT INTO public.tournaments(id,club_id,ended_at,buy_in_amount) VALUES
               ('99999999-0000-4000-8000-000000000003','{clubs[1]}',now()-interval '3 days',10),
               ('99999999-0000-4000-8000-000000000004','{clubs[1]}',now()-interval '3 days',10);
             INSERT INTO public.tournament_players(tournament_id,user_id,username,status,position,prize) VALUES
               ('99999999-0000-4000-8000-000000000003','{split_user}','first-name','eliminated',4,0),
               ('99999999-0000-4000-8000-000000000004','{split_user}','second-name','eliminated',5,0);""", db)
    c.ok('SELECT smarter_private.refresh_club_tournament_leaderboard_totals();', db)
    n_old = c.ok(f"SELECT count(*) FROM public.old_club_tournament_stats('{clubs[1]}',1000,0) x WHERE x.\"userId\"='{split_user}';", db)
    n_new = c.ok(f"SELECT count(*) FROM public.fn_club_tournament_stats('{clubs[1]}',1000,0) x WHERE x.\"userId\"='{split_user}';", db)
    check('a player with two usernames is one row (the old reader split them)', n_old == '2' and n_new == '1', f'{n_old} {n_new}')

    for role in ('anon', 'authenticated'):
        r = c.psql(f'SET ROLE {role}; SELECT count(*) FROM smarter_private.club_tournament_leaderboard_totals;', db)
        check(f'{role} cannot read the folded totals directly', r.returncode != 0)
    r = c.psql(f"SET ROLE anon; SELECT count(*) FROM public.fn_club_tournament_stats('{clubs[0]}',5,0);", db)
    check('anon still reads the leaderboard through the reader', r.returncode == 0, r.stderr.strip())
    job = c.ok("SELECT schedule || ' ' || command FROM cron.job WHERE jobname='club-tournament-leaderboard-fold';", db)
    check('the fold is scheduled twice an hour with its own timeout',
          job.startswith('7,37 * * * * ') and "statement_timeout = '120s'" in job, job)

    big = 'e9000000-0000-0000-0000-000000000001'
    c.ok(f"""INSERT INTO public.tournaments(id,club_id,ended_at,buy_in_amount,buy_in_fee)
               SELECT gen_random_uuid(),'{big}',now()-(g||' minutes')::interval-interval '1 day',10,1 FROM generate_series(1,200000) g;
             INSERT INTO public.tournament_players(tournament_id,user_id,username,status,position,prize)
               SELECT t.id,('f3000000-0000-0000-0000-'||lpad((k%300)::text,12,'0'))::uuid,'h','eliminated',k,
                      CASE WHEN k=1 THEN 25 END
                 FROM public.tournaments t CROSS JOIN generate_series(1,3) k WHERE t.club_id='{big}'
               ON CONFLICT DO NOTHING;
             ANALYZE;""", db)
    c.ok('SELECT smarter_private.refresh_club_tournament_leaderboard_totals();', db)
    c.ok(f"SELECT count(*) FROM public.fn_club_tournament_stats('{big}',50,0);", db)
    t0 = time.time()
    c.ok(f"SELECT count(*) FROM public.fn_club_tournament_stats('{big}',50,0);", db)
    new_ms = (time.time() - t0) * 1000
    t0 = time.time()
    c.ok(f"SELECT count(*) FROM public.old_club_tournament_stats('{big}',50,0);", db)
    old_ms = (time.time() - t0) * 1000
    print(f'     200,000 finished tournaments: new reader {new_ms:.0f} ms, old reader {old_ms:.0f} ms')
    check('a club with 200,000 finished tournaments answers in under 300 ms', new_ms < 300, f'{new_ms:.0f} ms')
    same_big = (board(c, db, "SELECT * FROM public.old_club_tournament_stats('{club}', 1000, 0)", big)
                == board(c, db, "SELECT * FROM public.fn_club_tournament_stats('{club}', 1000, 0)", big))
    check('and gives the same answer as the old reader', same_big)

    again = c.psql(BOARD_MIGRATION.read_text(), db)
    check('leaderboard migration refuses a second run on its pre-image pin',
          again.returncode != 0 and 'changed since 2026-11-25' in again.stderr, again.stderr.strip())

    tail_proof(c, db, clubs + [big])


def tournament_reads(c, db, call):
    """Rows of public.tournaments one call reads: sequential tuples plus index tuples on every index."""
    reads = ("SELECT (SELECT COALESCE(seq_tup_read,0) FROM pg_stat_user_tables WHERE relid='public.tournaments'::regclass)"
             " + (SELECT COALESCE(sum(idx_tup_read),0) FROM pg_stat_user_indexes WHERE relid='public.tournaments'::regclass);")
    out = c.ok(reads + '\n' + call + ';\nSELECT pg_stat_force_next_flush();\nSELECT pg_sleep(0.05);\n' + reads, db)
    lines = [l for l in out.splitlines() if l.strip()]
    return int(lines[-1]) - int(lines[0])


def tail_proof(c, db, clubs):
    big = clubs[-1]
    interim = c.ok("SELECT md5(pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure));", db)
    check('the folded reader installs as the exact body the follow-up pins', interim == '9159627c91761041d511d910fd94c923', interim)
    c.ok(f"""INSERT INTO public.tournaments(id,club_id,ended_at,buy_in_amount)
               SELECT gen_random_uuid(),'{big}',CASE WHEN g<=5 THEN NULL ELSE now() END,10 FROM generate_series(1,10) g;
             INSERT INTO public.tournament_players(tournament_id,user_id,username,status,position,prize)
               SELECT t.id,'f3000000-0000-0000-0000-000000000007','h','eliminated',2,3 FROM public.tournaments t
                WHERE t.club_id='{big}' AND (t.ended_at IS NULL OR t.ended_at > now()-interval '1 minute');""", db)
    # Production holds thousands of clubs, so a generic plan expects few rows per
    # club; give the cluster the same shape before it plans the readers.
    c.ok("""INSERT INTO public.tournaments(id,club_id,ended_at,buy_in_amount)
               SELECT gen_random_uuid(),('e8000000-0000-0000-0000-'||lpad((g%2000)::text,12,'0'))::uuid,
                      now()-(g||' minutes')::interval,10 FROM generate_series(1,200000) g;
             ANALYZE;""", db)
    # Keep the folded reader (one OR in its tail) to compare against after the follow-up.
    c.ok(c.ok("SELECT pg_get_functiondef('public.fn_club_tournament_stats(uuid,integer,integer)'::regprocedure);", db)
         .replace('public.fn_club_tournament_stats(', 'public.or_tail_club_tournament_stats(', 1) + ';', db)
    call = f"SELECT count(*) FROM public.fn_club_tournament_stats('{big}',50,0)"
    unfolded = int(c.ok(f"""SELECT count(*) FROM public.tournaments t, smarter_private.club_tournament_leaderboard_state b
                             WHERE t.club_id='{big}' AND ((CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END) IS NULL
                                OR (CASE WHEN t.is_private IS TRUE THEN NULL::timestamptz ELSE t.ended_at END) >= b.folded_before);""", db))
    before = tournament_reads(c, db, call)
    # Whether the one-OR tail walks the club depends on the plan the statistics
    # produce; on production it did (Midway Union: 836,174 rows, 1.2 s, under a
    # generic plan). It is printed, not asserted; what is asserted is that the
    # two-range tail never reads more than the unfolded rows.
    print(f'     200,000 finished tournaments, {unfolded} unfolded: the one-OR tail read {before} tournament rows')

    r = c.psql(TAIL_MIGRATION.read_text(), db)
    check('tail migration installs', r.returncode == 0, r.stderr.strip())
    if r.returncode != 0:
        return
    after = tournament_reads(c, db, call)
    print(f'     after: the tail reads {after} tournament rows per call')
    check('AFTER: the tail reads only the unfolded tournaments', after <= unfolded + 10, f'{after} rows, {unfolded} unfolded')

    for k in clubs:
        for limit, offset in ((1000, 0), (7, 7)):
            sql = "SELECT * FROM public.{fn}('{club}', %d, %d)" % (limit, offset)
            a = board(c, db, sql.replace('{fn}', 'or_tail_club_tournament_stats'), k)
            b = board(c, db, sql.replace('{fn}', 'fn_club_tournament_stats'), k)
            if a != b:
                check('AFTER: every club gives the same answer as the OR tail, page by page', False, f'club {k} page {limit},{offset}')
                break
        else:
            continue
        break
    else:
        check('AFTER: every club gives the same answer as the OR tail, page by page', True)

    r = c.psql(f"SET ROLE anon; SELECT count(*) FROM public.fn_club_tournament_stats('{clubs[0]}',5,0);", db)
    check('AFTER: anon still reads the leaderboard', r.returncode == 0, r.stderr.strip())
    again = c.psql(TAIL_MIGRATION.read_text(), db)
    check('tail migration refuses a second run on its pre-image pin',
          again.returncode != 0 and 'changed since 20261125022320' in again.stderr, again.stderr.strip())


def main():
    c = Cluster()
    c.start()
    try:
        c.ok('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;', 'postgres')
        spawn_proof(c)
        board_proof(c)
    finally:
        c.stop()
    if FAILS:
        print(f'{len(FAILS)} FAILED')
        sys.exit(1)
    print('ALL PASS')


if __name__ == '__main__':
    main()
