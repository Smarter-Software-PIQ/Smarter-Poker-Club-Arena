#!/usr/bin/env python3
"""Native proof for 20261109024836_a_missed_engine_cutover_and_a_failing_lobby_close_page_the_o.

Runs the exact migration against a throwaway PostgreSQL 17 cluster (never
production). The owner page route is installed from the production
definitions captured in scripts/ci/fixtures/engine-cutover-preimages.json
(the migration checks their md5 before patching them). GitHub and
engine.smarter.poker/health are served by a fake extensions.http that answers
from a table, so every outcome is driven by data:

  * the alarm fires at 04:30 Chicago in CST and in CDT, and not at 04:25;
  * it stays quiet when nothing was owed and when the cutover sealed;
  * it names the reason: no preparation run, refused selection, a refused or
    failed release;
  * it closes itself once production holds the owed build;
  * "could not tell" raises nothing;
  * the lobby close pages after 15 minutes of failures, once, and resolves;
  * the digest line reports the live build, since when, and the verdict.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261109024836_a_missed_engine_cutover_and_a_failing_lobby_close_page_the_o.sql'
PREIMAGES = json.loads((ROOT / 'scripts/ci/fixtures/engine-cutover-preimages.json').read_text())

SERVING = '391f7bc0d57c71637bd4af5181f70520661e3593'
OWED = '8bd8eef384947fcbf6432f834d741c6160ab4573'
NEWER = 'c4370778460f1e25847583bec0aaf84ca682592b'
REPO = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'


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
CREATE SCHEMA smarter_private; CREATE SCHEMA extensions; CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(n text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = n RETURNING true $$;

-- A fake extensions.http answering from a table: the first pattern that matches wins.
CREATE TYPE extensions.http_header AS (field text, value text);
CREATE TYPE extensions.http_request AS (method text, uri text, headers extensions.http_header[], content_type text, content text);
CREATE TYPE extensions.http_response AS (status integer, content_type text, headers extensions.http_header[], content text);
CREATE FUNCTION extensions.http_header(f text, v text) RETURNS extensions.http_header LANGUAGE sql AS $$ SELECT ROW(f, v)::extensions.http_header $$;
CREATE FUNCTION extensions.http_set_curlopt(a text, b text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE TABLE public.mock_http (pattern text PRIMARY KEY, status integer, body text);
CREATE TABLE public.mock_http_calls (uri text, at timestamptz DEFAULT clock_timestamp());
CREATE FUNCTION extensions.http(r extensions.http_request) RETURNS extensions.http_response LANGUAGE plpgsql AS $$
DECLARE m public.mock_http%ROWTYPE;
BEGIN
  INSERT INTO public.mock_http_calls(uri) VALUES (r.uri);
  SELECT * INTO m FROM public.mock_http WHERE r.uri LIKE pattern ORDER BY length(pattern) DESC LIMIT 1;
  IF NOT FOUND THEN RETURN ROW(404, 'application/json', NULL, '{}')::extensions.http_response; END IF;
  RETURN ROW(m.status, 'application/json', NULL, m.body)::extensions.http_response;
END $$;

CREATE TABLE public.engine_leader (id boolean PRIMARY KEY DEFAULT true, instance_id text, engine_version text,
  acquired_at timestamptz, heartbeat_at timestamptz);
CREATE TABLE public.engine_deploy_exit_paths (id bigserial PRIMARY KEY, recorded_at timestamptz NOT NULL DEFAULT now(),
  run_id text, target_sha text, stage text, outcome text, error text, release_result text);
CREATE TABLE public.operational_alert_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, source text NOT NULL,
  event_key text NOT NULL, alertname text NOT NULL, status text NOT NULL CHECK (status IN ('firing','resolved','info')),
  severity text NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_received_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivery_count bigint NOT NULL DEFAULT 1,
  investigation_status text NOT NULL DEFAULT 'new', investigation jsonb NOT NULL DEFAULT '{}'::jsonb, UNIQUE (source, event_key));
CREATE TABLE public.ca_owner_page_state (kind text PRIMARY KEY, last_firing_at timestamptz, last_paged_at timestamptz,
  held_since_page integer NOT NULL DEFAULT 0, pages_sent bigint NOT NULL DEFAULT 0,
  CONSTRAINT ca_owner_page_state_kind_check CHECK (kind IN ('dealing', 'restarts', 'money')));
INSERT INTO public.ca_owner_page_state(kind) VALUES ('dealing'), ('restarts'), ('money');
CREATE TABLE public.ca_incident_recipients (user_id uuid, scope text, active boolean, senior boolean);
INSERT INTO public.ca_incident_recipients VALUES ('47965354-0e56-43ef-931c-ddaab82af765', 'platform', true, true);
CREATE TABLE public.notifications_sent (user_id uuid, type text, title text, body text, link text, data jsonb);
CREATE FUNCTION public.fn_raise_notification(u uuid, t text, ti text, b text, l text, d jsonb) RETURNS uuid LANGUAGE sql AS
  $$ INSERT INTO public.notifications_sent VALUES (u, t, ti, b, l, d); SELECT gen_random_uuid() $$;
CREATE FUNCTION public.fn_ca_stall_watch_confirms_people_stuck() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_ca_horse_roster_digest(d date) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE TABLE public.sp_daily_metrics (day date PRIMARY KEY, metrics jsonb, attention jsonb, computed_at timestamptz, compute_ms integer);
"""


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='cutover-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                                  input=text, capture_output=True, text=True)

        def sql(text):
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def ok(name):
            passed.append(name)
            print(f'ok - {name}')

        sql(SCHEMA)
        for sig in ('fn_record_operational_alert(text,text,text,text,text,jsonb)', 'fn_ca_owner_page_kind(text,text,text)',
                    'fn_ca_a_real_alert_reaches_the_owner()', 'fn_sp_daily_digest(date,boolean)'):
            r = psql([], PREIMAGES[sig] + ';')
            assert r.returncode == 0, f'{sig}: {r.stderr}'
        sql("CREATE TRIGGER zz_a_real_alert_reaches_the_owner AFTER INSERT ON public.operational_alert_events "
            "FOR EACH ROW WHEN (NEW.status = 'firing') EXECUTE FUNCTION public.fn_ca_a_real_alert_reaches_the_owner()")
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        ok('the exact migration installs over the production definitions and its live proof holds')

        def mock(pattern, body, status=200):
            sql("INSERT INTO mock_http VALUES ($m$%s$m$, %d, $m$%s$m$) ON CONFLICT (pattern) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body"
                % (pattern, status, body if isinstance(body, str) else json.dumps(body)))

        def unmock(pattern):
            sql(f"DELETE FROM mock_http WHERE pattern = $m${pattern}$m$")

        def watch(at):
            return json.loads(sql(f"SELECT public.fn_ca_engine_cutover_watch('{at}'::timestamptz)"))

        def alerts(status='firing'):
            return int(sql(f"SELECT count(*) FROM operational_alert_events WHERE source='engine-cutover-watch' AND status='{status}'"))

        def pages(title):
            return int(sql(f"SELECT count(*) FROM notifications_sent WHERE title = '{title}'"))

        def world(serving, owed_status, runs=0):
            """serving = what /health says; owed_status = compare(owed...serving)."""
            sql(f"DELETE FROM engine_leader; INSERT INTO engine_leader VALUES (true, '1-a22c325d', '{serving[:8]}', '2026-11-07 21:20:17Z', clock_timestamp())")
            mock('https://engine.smarter.poker/health', {'releaseSha': serving, 'status': 'ok'})
            mock(f'{REPO}/commits?sha=main&path=server&until=%', [
                {'sha': NEWER + '', 'commit': {'committer': {'date': '2026-11-09T02:00:00Z'}}},
                {'sha': OWED, 'commit': {'committer': {'date': '2026-11-09T01:50:55Z'}}},
                {'sha': SERVING, 'commit': {'committer': {'date': '2026-11-07T20:00:00Z'}}}])
            mock(f'{REPO}/commits/{NEWER}', {'files': [{'filename': 'server/src/foo.test.ts'}]})
            mock(f'{REPO}/commits/{OWED}', {'files': [{'filename': 'server/src/GameServer.ts'}]})
            mock(f'{REPO}/compare/{OWED}...%', {'status': owed_status})
            mock(f'{REPO}/actions/artifacts?name=daily-engine-selection-%', {'total_count': runs, 'artifacts': []})

        # ---- CST (UTC-6): 2026-11-10, the window is 10:00Z, the alarm 10:30Z.
        world(SERVING, 'diverged')
        assert watch('2026-11-10 10:25:00Z')['state'] == 'before_0430' and alerts() == 0
        ok('CST: nothing is raised at 04:25 Chicago')
        r = watch('2026-11-10 10:30:00Z')
        assert r['state'] == 'missed' and alerts() == 1, r
        row = json.loads(sql("SELECT payload FROM operational_alert_events WHERE event_key='missed:2026-11-10'"))
        assert row['serving_sha'] == SERVING and row['owed_sha'] == OWED, row
        assert 'no preparation run' in row['reason'], row
        assert 'Still serving 391f7bc0' in row['summary'] and 'owed 8bd8eef3' in row['summary'], row['summary']
        assert sql("SELECT severity FROM operational_alert_events WHERE event_key='missed:2026-11-10'") == 'critical'
        assert pages('Engine Update Missed At 4 AM') == 1
        assert sql("SELECT body FROM notifications_sent WHERE title='Engine Update Missed At 4 AM'").startswith('The 4 AM engine update did not happen on Nov 10.')
        ok('CST: at 04:30 Chicago one critical alert names the serving build, the owed build and "no preparation run", and pages the owner')
        r = watch('2026-11-10 10:35:00Z')
        assert r['state'] == 'missed' and alerts() == 1 and pages('Engine Update Missed At 4 AM') == 1
        ok('a missed cutover is raised once, not every five minutes')
        world(OWED, 'identical')
        sql("INSERT INTO engine_deploy_exit_paths(recorded_at, run_id, target_sha, stage, outcome) VALUES ('2026-11-11 10:01:30Z', '9-1', '%s', 'complete', 'shipped')" % OWED)
        r = watch('2026-11-10 16:00:00Z')
        assert r['state'] == 'resolved' and alerts() == 0 and alerts('resolved') == 1, r
        assert sql("SELECT resolved_at IS NOT NULL FROM smarter_private.ca_engine_cutover_days WHERE chicago_day='2026-11-10'") == 't'
        ok('it closes itself once production holds the owed build')

        # ---- the next morning sealed: quiet.
        r = watch('2026-11-11 10:30:00Z')
        assert r['state'] == 'sealed' and alerts() == 0, r
        ok('quiet when the cutover sealed')

        # ---- CDT (UTC-5): 2026-10-15, the alarm at 09:30Z.
        world(SERVING, 'diverged', runs=1)
        sql("UPDATE smarter_private.ca_engine_cutover_days SET verdict = verdict")  # no-op
        assert watch('2026-10-15 09:25:00Z')['state'] == 'before_0430' and alerts() == 0
        r = watch('2026-10-15 09:30:00Z')
        assert r['state'] == 'missed' and alerts() == 1, r
        assert 'refused selection' in r['reason'], r
        ok('CDT: the alarm fires at 04:30 Chicago (09:30Z), not 04:25, and names a refused selection when the preparation ran but sent nothing')

        # ---- a refused release and a failed release are named from the receipt.
        sql("INSERT INTO engine_deploy_exit_paths(recorded_at, run_id, target_sha, stage, outcome, error) VALUES "
            "('2026-10-16 08:53:20Z', '42360536751-1', '%s', 'engine-doors', 'failure', 'missing database functions fn_x()')" % OWED)
        r = watch('2026-10-16 09:30:00Z')
        assert 'refused at engine-doors' in r['reason'] and 'missing database functions' in r['reason'], r
        sql("INSERT INTO engine_deploy_exit_paths(recorded_at, run_id, target_sha, stage, outcome, error) VALUES "
            "('2026-10-17 09:01:20Z', '42389189340-1', '%s', 'release', 'failure', 'release failed at observe (exit 1)')" % OWED)
        r = watch('2026-10-17 09:30:00Z')
        assert 'failed at release' in r['reason'] and 'observe' in r['reason'], r
        assert alerts() == 3
        ok('a refused release and a failed release are named from the receiver receipt')
        world(OWED, 'ahead')
        r = watch('2026-10-17 12:00:00Z')
        assert alerts() == 0 and alerts('resolved') == 4, (r, alerts(), alerts('resolved'))
        ok('every open day closes when the owed build is held')

        # ---- nothing owed: the serving build contains the newest engine commit.
        world(SERVING, 'ahead')
        r = watch('2026-11-12 10:30:00Z')
        assert r['state'] == 'not_owed' and alerts() == 0, r
        mock(f'{REPO}/commits?sha=main&path=server&until=%', [{'sha': SERVING, 'commit': {'committer': {'date': '2026-11-07T20:00:00Z'}}}])
        r = watch('2026-11-13 10:30:00Z')
        assert r['state'] == 'not_owed' and alerts() == 0, r
        ok('quiet when nothing was owed')

        # ---- could not tell: GitHub or /health unreadable raises nothing.
        world(SERVING, 'diverged')
        mock(f'{REPO}/commits?sha=main&path=server&until=%', '{"message":"API rate limit exceeded"}', 403)
        r = watch('2026-11-14 10:30:00Z')
        assert r['state'] == 'unknown' and alerts() == 0, r
        mock('https://engine.smarter.poker/health', '{}', 503)
        r = watch('2026-11-15 10:30:00Z')
        assert r['state'] == 'unknown' and alerts() == 0, r
        ok('an unreadable GitHub or /health is "unknown" and raises nothing')
        calls = int(sql("SELECT count(*) FROM mock_http_calls"))
        watch('2026-11-12 11:00:00Z')
        assert int(sql("SELECT count(*) FROM mock_http_calls")) == calls
        ok('a decided day asks nothing outside the database')

        # ---- the digest line.
        world(OWED, 'identical')
        d = json.loads(sql("SELECT public.fn_sp_digest_engine_cutover('2026-11-10')"))
        assert d['live_build'] == OWED[:8] and d['live_since_ct'] == 'Nov 11 04:01' and d['cutover'] == 'sealed', d
        d = json.loads(sql("SELECT public.fn_sp_digest_engine_cutover('2026-11-09')"))
        assert d['cutover'] == 'missed' and d['owed_build'] == OWED[:8] and d['resolved_at'], d
        d = json.loads(sql("SELECT public.fn_sp_digest_engine_cutover('2026-11-20')"))
        assert d['cutover'] == 'not_checked', d
        assert "'engine_cutover', public.fn_sp_digest_engine_cutover(v_day)" in sql(
            "SELECT pg_get_functiondef('public.fn_sp_daily_digest(date,boolean)'::regprocedure)")
        assert sql("SELECT has_function_privilege('authenticated','public.fn_sp_digest_engine_cutover(date)','EXECUTE')") == 'f'
        ok('the digest line reports the live build, since its sealed release, and the cutover verdict for the next morning')

        # ---- the lobby close pages after 15 minutes (Nov 8 shape: 03:00 CST = 09:00Z).
        def lobby_fail(lobby, at):
            sql(f"SELECT public.fn_record_operational_alert('daily-window', 'lobby-close-failed:{lobby}', 'DailyWindowLobbyCloseFailed', "
                f"'firing', 'warning', jsonb_build_object('error', 'record \"old\" has no field \"late_reg_levels\"'))")
            sql(f"UPDATE operational_alert_events SET received_at = LEAST(received_at, '{at}'::timestamptz), last_received_at = '{at}' "
                f"WHERE event_key = 'lobby-close-failed:{lobby}'")

        def page(at):
            return json.loads(sql(f"SELECT public.fn_ca_daily_window_lobby_close_page('{at}'::timestamptz)"))

        def lobby_alerts(status='firing'):
            return int(sql(f"SELECT count(*) FROM operational_alert_events WHERE alertname='DailyWindowLobbyCloseKeepsFailing' AND status='{status}'"))

        for minute in range(0, 15):
            for lobby in ('b9dd67fe', '7b96e697', 'b28b6b5d'):
                lobby_fail(lobby, f'2026-11-08 09:{minute:02d}:12Z')
        r = page('2026-11-08 09:14:30Z')
        assert r['state'] == 'failing_under_15_minutes' and lobby_alerts() == 0, r
        ok('fourteen minutes of lobby close failures do not page')
        lobby_fail('b9dd67fe', '2026-11-08 09:15:12Z')
        r = page('2026-11-08 09:15:30Z')
        assert r['state'] == 'paged' and lobby_alerts() == 1, r
        p = json.loads(sql("SELECT payload FROM operational_alert_events WHERE alertname='DailyWindowLobbyCloseKeepsFailing'"))
        assert p['lobbies'] == 3 and p['failures'] >= 45 and 'late_reg_levels' in p['latest_error'], p
        assert sql("SELECT severity FROM operational_alert_events WHERE alertname='DailyWindowLobbyCloseKeepsFailing'") == 'critical'
        assert pages('3 AM Lobby Close Keeps Failing') == 1
        ok('fifteen minutes of failures page the owner once, critical, with the count, the lobbies and the error')
        lobby_fail('b9dd67fe', '2026-11-08 09:20:12Z')
        assert page('2026-11-08 09:20:30Z')['state'] == 'still_failing' and lobby_alerts() == 1
        assert pages('3 AM Lobby Close Keeps Failing') == 1
        ok('a continuing failure does not page again')
        assert page('2026-11-08 09:31:00Z')['state'] == 'resolved' and lobby_alerts() == 0 and lobby_alerts('resolved') == 1
        ok('ten quiet minutes resolve the lobby close page')
        assert page('2026-11-08 13:00:00Z')['state'] == 'outside_hours'
        ok('outside 03:00-06:15 Chicago the lobby close page reads nothing')

        assert sql("SELECT count(*) FROM cron.job WHERE jobname IN ('ca-engine-cutover-watch-5m','ca-daily-window-lobby-close-page-5m')") == '2'
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode != 0, 'a second install must be refused'
        ok('a second install is refused')
        print(f'{len(passed)}/{len(passed)} behaviours proven')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
