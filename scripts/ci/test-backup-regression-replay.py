#!/usr/bin/env python3
"""Native proof for the Backup regression replay (server/standby/standby-trials.sh
trial_regression_replay; PostgreSQL 17, never production).

The replay's own bash runs end to end with psql_db pointed at a throwaway
cluster that carries production's definitions of every function it reads
(scripts/ci/fixtures/backup-regression-replay-production.json, read
2026-11-19), the columns and constraints it writes, and this checkout as the
candidate source:

  * with no fix installed, the three migration-armed checks say not_armed and
    the certificate is not withheld; the grader check still runs;
  * with every fix installed (the drill fix applied by its own migration file)
    all four pass, on data where the door and the picker read agree;
  * each of today's incidents, put back, fails its check and the trial: a
    picker read at another threshold, a door counting other promises, data
    the two disagree on, a grader that grades a maintenance break, a
    tournament break or hand-for-hand, a cutover watch owing another build or
    reading a clock the candidate does not, a drill that stops recording;
  * a candidate whose picker ignores the budget read fails;
  * nothing is written: no hand, event, break or interval survives, no
    trigger fires, and the run takes seconds.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TRIALS = ROOT / 'server/standby/standby-trials.sh'
FIXTURE = json.loads((ROOT / 'scripts/ci/fixtures/backup-regression-replay-production.json').read_text())
DRILL_FIX = ROOT / 'supabase/migrations/20261119231718_the_drill_records_its_completed_run_again.sql'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


SCHEMA = r"""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA smarter_private;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, buy_in_amount numeric NOT NULL,
  buy_in_fee numeric NOT NULL, start_time timestamptz NOT NULL, ban_chat boolean NOT NULL, status text NOT NULL DEFAULT 'ANNOUNCED',
  started_at timestamptz, break_started_at timestamptz, break_ends_at timestamptz, prize_pool_finalized boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT tournaments_status_check CHECK (status = ANY (ARRAY['ANNOUNCED','REGISTERING','LATE_REG','RUNNING','COMPLETING','COMPLETED','CANCELLED','BAGGED'])),
  CONSTRAINT tournaments_rake_within_10_pct CHECK (COALESCE(buy_in_fee, 0) <= (COALESCE(buy_in_amount, 0) + COALESCE(buy_in_fee, 0)) * 0.1 + 0.000000001));
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean DEFAULT false);
CREATE TABLE public.tournament_players (tournament_id uuid NOT NULL REFERENCES public.tournaments(id), user_id uuid NOT NULL,
  status text DEFAULT 'registered');
CREATE TABLE public.hand_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, tournament_id uuid,
  started_at timestamptz DEFAULT now(), ended_at timestamptz, created_at timestamptz DEFAULT now(), actions jsonb DEFAULT '[]',
  players jsonb DEFAULT '[]', pots jsonb, rit_boards jsonb, showdown jsonb, bbj_amount numeric NOT NULL DEFAULT 0,
  reported boolean NOT NULL DEFAULT false, horse_exploit_recorded boolean NOT NULL DEFAULT false);
CREATE TABLE public.lightning_hand (hand_history_id uuid);
CREATE TABLE public.engine_maintenance_break_log (break_started_at timestamptz NOT NULL, break_ended_at timestamptz NOT NULL,
  unparked_at_countdown integer NOT NULL, peak_unparked integer NOT NULL, tables_resumed integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), engine_version text, thaw_ok boolean);
CREATE TABLE public.ca_detector_runs (id bigserial PRIMARY KEY, detector text NOT NULL, ran_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb);
-- The live tables' own triggers (stats, missions, achievements) must never
-- run for a replay hand: this one would fail the replay if it did.
CREATE TABLE public.trigger_fired (at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION public.hand_history_side_effect() RETURNS trigger LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO public.trigger_fired DEFAULT VALUES; RETURN NEW; END $$;
CREATE TRIGGER hand_history_side_effect AFTER INSERT ON public.hand_history FOR EACH ROW EXECUTE FUNCTION public.hand_history_side_effect();
CREATE TRIGGER tournaments_side_effect AFTER INSERT ON public.tournaments FOR EACH ROW EXECUTE FUNCTION public.hand_history_side_effect();
"""

# 20261119211558 (hand-for-hand is an owed wait), applied when a case arms it.
H4H = r"""
CREATE TABLE IF NOT EXISTS public.ca_tournament_hand_for_hand (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz,
  PRIMARY KEY (tournament_id, started_at));
DO $e$
DECLARE v text := pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamp with time zone, integer)'::regprocedure);
BEGIN
  EXECUTE replace(v, 'AND NOT EXISTS (SELECT 1 FROM tournaments t',
    'AND NOT EXISTS (SELECT 1 FROM ca_tournament_hand_for_hand h4h' || chr(10)
    || '                      WHERE h4h.tournament_id = p.tournament_id AND h4h.started_at < nx.started_at' || chr(10)
    || '                        AND COALESCE(h4h.ended_at, ''infinity'') > p.ended_at)' || chr(10)
    || '     AND NOT EXISTS (SELECT 1 FROM tournaments t');
END $e$;
INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20261119211558') ON CONFLICT DO NOTHING;
"""


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='replay-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    env = dict(os.environ, PGOPTIONS='-c check_function_bodies=off')
    psql_cmd = [pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres']
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run([*psql_cmd, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                                  input=text, capture_output=True, text=True, env=env)

        def sql(text):
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def define(text):
            r = psql([], text if text.rstrip().endswith(';') else text + ';')
            assert r.returncode == 0, r.stderr

        def ok(name):
            passed.append(name)
            print(f'ok - {name}')

        sql(SCHEMA)
        for sig, body in FIXTURE.items():
            if not sig.startswith('_'):
                define(body)

        state = scratch / 'state'
        state.mkdir()
        head = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
        candidate = {'sha': head, 'repo': str(ROOT)}

        def replay():
            """The trial itself, from standby-trials.sh, with psql_db on the throwaway cluster."""
            script = f"""
set -Eeuo pipefail  # exactly as standby-engine.sh runs the trial
die() {{ echo "$*" >&2; exit 1; }}
valid_sha() {{ [[ "$1" =~ ^[0-9a-f]{{40}}$ ]] || die "not a 40-hex sha: $1"; }}
psql_db() {{ PGOPTIONS='-c check_function_bodies=off' {' '.join(psql_cmd)} -v ON_ERROR_STOP=1 "$@"; }}
STATE_DIR={state}
REPO_DIR={candidate['repo']}
. {TRIALS}
trial_regression_replay {candidate['sha']}
"""
            t0 = time.monotonic()
            r = subprocess.run(['bash', '-c', script], capture_output=True, text=True)
            took = time.monotonic() - t0
            line = [l for l in r.stdout.splitlines() if l.startswith('{"trial":"regression-replay"')]
            assert len(line) == 1, f'no verdict line\nstdout={r.stdout}\nstderr={r.stderr}'
            v = json.loads(line[0])
            assert (r.returncode == 0) == (v['verdict'] == 'pass'), (r.returncode, v)
            assert took < 20, f'the replay took {took:.1f}s'
            v['_by'] = {c['check']: c for c in v.get('checks', [])}
            return v

        def by(v, check):
            return v['_by'][check]['verdict']

        def untouched():
            assert sql('SELECT count(*) FROM hand_history') == '0'
            assert sql("SELECT count(*) FROM tournaments WHERE name = 'regression replay'") == '0'
            assert sql('SELECT count(*) FROM engine_maintenance_break_log') == '0'
            assert sql('SELECT count(*) FROM trigger_fired') == '0'
            if sql("SELECT to_regclass('public.ca_tournament_hand_for_hand') IS NOT NULL") == 't':
                assert sql('SELECT count(*) FROM ca_tournament_hand_for_hand') == '0'

        def install(version):
            sql(f"INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('{version}') ON CONFLICT DO NOTHING")

        # ---- nothing armed.
        v = replay()
        assert v['verdict'] == 'pass', v
        assert by(v, 'spin_reservation_budget') == by(v, 'cutover_owes_baseline') == by(v, 'drill_records_its_run') == 'not_armed', v
        assert by(v, 'hand_gap_owed_waits') == 'pass' and 'hand-for-hand not armed' in v['_by']['hand_gap_owed_waits']['detail'], v
        untouched()
        ok('with no fix installed the armed checks wait, the grader check runs, and the certificate is not withheld')

        # ---- every fix installed, on data the door and the read agree on.
        r = subprocess.run([*psql_cmd, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', str(DRILL_FIX)], capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stderr
        sql(H4H)
        for version in ('20261119181143', '20261119182637', '20261119231718'):
            install(version)
        h1, h2, human = 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001'
        sql(f"INSERT INTO profiles VALUES ('{h1}', true), ('{h2}', true), ('{human}', false)")
        sql("INSERT INTO tournaments(name, buy_in_amount, buy_in_fee, start_time, ban_chat, status) "
            "SELECT 'mtt ' || g, 10, 1, now() + g * interval '1 hour', false, 'REGISTERING' FROM generate_series(1, 5) g")
        sql("INSERT INTO tournaments(name, buy_in_amount, buy_in_fee, start_time, ban_chat, status) VALUES ('done', 10, 1, now(), false, 'COMPLETED')")
        sql(f"INSERT INTO tournament_players SELECT id, '{h1}', 'registered' FROM tournaments WHERE name LIKE 'mtt %' AND name <= 'mtt 4'")
        sql(f"INSERT INTO tournament_players SELECT id, '{h2}', 'registered' FROM tournaments WHERE name IN ('mtt 1', 'mtt 2', 'mtt 3', 'done')")
        sql(f"INSERT INTO tournament_players SELECT id, '{human}', 'registered' FROM tournaments WHERE name LIKE 'mtt %'")
        sql('TRUNCATE trigger_fired')
        v = replay()
        assert v['verdict'] == 'pass' and all(c['verdict'] == 'pass' for c in v['checks']), v
        assert v['_by']['spin_reservation_budget']['detail'].startswith('1 horse(s) at the budget'), v
        assert 'tournament break, hand-for-hand left out' in v['_by']['hand_gap_owed_waits']['detail'], v
        assert v['clock'] == '-15 30', v
        untouched()
        ok('with every fix installed all four checks pass on agreeing data, reading the candidate\'s own clock')

        def regress(name, check, broken, restore):
            sql(broken)
            v = replay()
            assert v['verdict'] == 'fail' and by(v, check) == 'fail' and check in v['reasons'], (name, v)
            sql(restore)
            assert replay()['verdict'] == 'pass', f'{name}: restore'
            untouched()
            ok(f'{name} fails {check} and withholds the certificate')

        read = FIXTURE['fn_horses_at_tournament_reservation_budget()']
        door = FIXTURE['fn_seat_horse_in_seat_first_game(uuid,uuid)']
        regress('a picker read at another threshold', 'spin_reservation_budget',
                read.replace('>= 4', '>= 5'), read)
        regress('a door that counts other promises', 'spin_reservation_budget',
                door.replace("promise.status IN ('registered','playing')", "promise.status IN ('registered','playing','reserved')"), door)
        regress('data the door and the read disagree on', 'spin_reservation_budget',
                read.replace("JOIN public.profiles h ON h.id = promise.user_id AND h.is_horse IS TRUE",
                             "JOIN public.profiles h ON h.id = promise.user_id AND h.is_horse IS TRUE AND h.id <> 'aaaaaaaa-0000-0000-0000-000000000001'"), read)

        grader = sql("SELECT pg_get_functiondef('public.fn_ca_hand_gap_unintended_delay(timestamptz,integer)'::regprocedure)")
        maint = re.search(r"\n\s*AND NOT EXISTS \(SELECT 1 FROM engine_maintenance_break_log b.*?> p\.ended_at\)", grader, re.S).group(0)
        tbreak = re.search(r"\n\s*AND NOT EXISTS \(SELECT 1 FROM tournaments t.*?> p\.ended_at\)", grader, re.S).group(0)
        h4h = re.search(r"\n\s*AND NOT EXISTS \(SELECT 1 FROM ca_tournament_hand_for_hand h4h.*?> p\.ended_at\)", grader, re.S).group(0)
        regress('a grader that grades a maintenance break', 'hand_gap_owed_waits', grader.replace(maint, ''), grader)
        regress('a grader that grades a tournament break', 'hand_gap_owed_waits', grader.replace(tbreak, ''), grader)
        regress('a grader that grades hand-for-hand', 'hand_gap_owed_waits', grader.replace(h4h, ''), grader)
        regress('a grader that grades nothing', 'hand_gap_owed_waits',
                grader.replace("nx.started_at - p.ended_at < interval '60 seconds'", "nx.started_at - p.ended_at < interval '0 seconds'"), grader)

        watch = FIXTURE['fn_ca_engine_cutover_watch(timestamp with time zone)']
        regress('a cutover watch owing another build', 'cutover_owes_baseline',
                watch.replace("interval '-45 minutes'", "interval '-15 minutes'"), watch)
        regress('a cutover watch owing the 03:30 build again', 'cutover_owes_baseline',
                watch.replace("least(v_cutoff, (v_day::timestamp + interval '-45 minutes') AT TIME ZONE c_tz)", 'v_cutoff'), watch)
        readiness_ok = ("CREATE FUNCTION public.fn_ca_cutover_readiness_watch(p_at timestamptz, p_dry_run boolean) RETURNS jsonb LANGUAGE plpgsql AS $f$\n"
                        "DECLARE c_freeze_offset constant interval := interval '-15 minutes';\n  c_settle constant interval := interval '30 minutes';\nBEGIN RETURN '{}'; END $f$")
        sql(readiness_ok)
        assert replay()['verdict'] == 'pass'
        regress('a readiness check on another freeze clock', 'cutover_owes_baseline',
                readiness_ok.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace("'-15 minutes'", "'45 minutes'"),
                readiness_ok.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'))

        fixed = sql("SELECT pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure)")
        regress('a drill that stops recording its run', 'drill_records_its_run', FIXTURE['fn_ca_alarm_drill()'], fixed)

        # ---- a candidate whose picker ignores the budget read.
        cand = scratch / 'cand'
        subprocess.run(['git', '-C', str(ROOT), 'worktree', 'add', '-q', '--detach', str(cand), head], check=True, capture_output=True)
        try:
            svc = cand / 'server/src/services/TournamentRecurringService.ts'
            svc.write_text(svc.read_text().replace('this.horseReservationBudget.atBudget()', '(async () => [])()'))
            subprocess.run(['git', '-C', str(cand), '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-am', 'regress', '--no-verify'],
                           check=True, capture_output=True)
            candidate['sha'] = subprocess.run(['git', '-C', str(cand), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
            v = replay()
            assert v['verdict'] == 'fail' and 'picker_ignores_reservation_budget' in v['reasons'], v
            ok('a candidate whose free-horse picker ignores the budget read fails')
        finally:
            candidate['sha'] = head
            subprocess.run(['git', '-C', str(ROOT), 'worktree', 'remove', '--force', str(cand)], capture_output=True)

        assert sql('SELECT count(*) FROM tournaments') == '6'
        untouched()
        ok('nothing the replay writes survives, and no live-table trigger ever ran')

        # ---- the restored Backup copy carries no migration history (Backup
        # certify 44673040919, 2026-11-20 04:15 UTC): every history-armed check
        # waits, and the replay never errors.
        sql('ALTER SCHEMA supabase_migrations RENAME TO supabase_migrations_hidden')
        try:
            v = replay()
            assert v['verdict'] != 'fail', v
            assert by(v, 'spin_reservation_budget') == 'not_armed', v
            ok('a copy with no supabase_migrations schema arms nothing by history and does not withhold the certificate')
        finally:
            sql('ALTER SCHEMA supabase_migrations_hidden RENAME TO supabase_migrations')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    print(f'{len(passed)} passed')


if __name__ == '__main__':
    main()
