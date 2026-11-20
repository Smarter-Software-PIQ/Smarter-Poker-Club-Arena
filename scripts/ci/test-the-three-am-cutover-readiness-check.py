#!/usr/bin/env python3
"""Native proof for 20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship
(PostgreSQL 17, never production).

The owner page route is built exactly as production has it: the definitions
in scripts/ci/fixtures/engine-cutover-preimages.json, then the installed
migrations 20261109024836 and 20261109182123, and the result is checked
against production's md5 of every function this migration edits before it
installs. GitHub and engine /health are served by a fake extensions.http that
answers from a table, so every outcome is data:

  * outside 03:00-03:30 Chicago nothing is read, in CST and in CDT;
  * a certified freeze baseline with its migrations installed is `ready`,
    raises nothing, and is not asked again that night;
  * a serving build that holds the baseline is `not_owed`;
  * no certificate written after the freeze began is `not_ready`: ONE
    critical CutoverReadinessAtRisk pages the owner as "4 AM Engine Update At
    Risk", naming the baseline, once; a later run that finds a certificate
    resolves it; the next night's finding pages again;
  * a newer certified build whose migration is uninstalled is not taken; once
    installed it is;
  * an uninstalled pre-freeze migration, a Spin past the 8,400 s envelope, a
    tournament stuck RUNNING, an unhealthy or silent engine: each is a reason;
  * an unreadable GitHub is `unknown` and pages nothing;
  * a dry run writes nothing, and before the freeze says `pending`;
  * a readiness page and a 04:30 release page do not hold each other back;
  * the digest carries the verdict; an earlier night's alarm closes;
  * a run never makes more than 10 outside requests.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
CUTOVER = MIGRATIONS / '20261109024836_a_missed_engine_cutover_and_a_failing_lobby_close_page_the_o.sql'
INSTALL_WATCH = MIGRATIONS / '20261109182123_a_merged_migration_still_uninstalled_after_an_hour_pages_the.sql'
MIGRATION = MIGRATIONS / '20261119234116_the_3_am_check_says_whether_the_4_am_cutover_will_ship.sql'
PREIMAGES = json.loads((ROOT / 'scripts/ci/fixtures/engine-cutover-preimages.json').read_text())
REPO = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
TITLE = '4 AM Engine Update At Risk'
# Production, read 2026-11-19 23:30 UTC: md5(pg_get_functiondef(...)) of each
# function this migration edits. The chain below must rebuild exactly these.
PRODUCTION_MD5 = {
    'fn_ca_owner_page_kind(text,text,text)': 'ceb0c03a2697915cecebece41ed09927',
    'fn_ca_a_real_alert_reaches_the_owner()': '7d7fa41a1301729059749dd81f97789b',
    'fn_sp_digest_engine_cutover(date)': 'c5a8b97de3df30eeb2a197685388cd73',
}

SERVING = 'aec0d93b40cd02d6cae87fd4a11ddbdb5519d553'
BASE = '1111111111111111111111111111111111111111'
NEWER = '2222222222222222222222222222222222222222'
NEWEST = '3333333333333333333333333333333333333333'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


CUTOVER_TEST = (ROOT / 'scripts/ci/test-a-missed-engine-cutover-is-paged.py').read_text()
SCHEMA = re.search(r'^SCHEMA = r"""(.*?)"""', CUTOVER_TEST, re.S | re.M).group(1) + r"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
CREATE FUNCTION cron.unschedule(j bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = j RETURNING true $$;
CREATE FUNCTION public.fn_ca_installed_migration_listing() RETURNS json LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'pg_temp' AS $$
  SELECT coalesce(json_agg(json_build_array(m.version, m.name) ORDER BY m.version, m.name), '[]'::json)
    FROM supabase_migrations.schema_migrations m $$;
CREATE TABLE public.v_spin_unfilled_waits (tournament_id uuid, name text, longest_wait interval);
CREATE TABLE public.tournaments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, status text, started_at timestamptz);
CREATE TABLE public.sp_settings (key text PRIMARY KEY, value numeric);
CREATE FUNCTION public.fn_sp_setting(k text, d numeric) RETURNS numeric LANGUAGE sql STABLE AS
  $$ SELECT COALESCE((SELECT value FROM public.sp_settings WHERE key = k), d) $$;
"""


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='readiness-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
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
        for f in (CUTOVER, INSTALL_WATCH):
            r = psql(['-f', str(f)])
            assert r.returncode == 0, f'{f.name}: {r.stderr}'
        # Columns later install-watch fixes added (20261112035143, 20261117165416).
        sql("ALTER TABLE smarter_private.ca_merged_migration_watch ADD COLUMN IF NOT EXISTS superseded_by text, "
            "ADD COLUMN IF NOT EXISTS modified_at timestamptz, ADD COLUMN IF NOT EXISTS modified_sha text")
        for sig, want in PRODUCTION_MD5.items():
            got = sql(f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure))")
            assert got == want, f'{sig}: rebuilt md5 {got} differs from production {want}'
        ok("the chain rebuilds production's exact text of every function the migration edits")

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

        def calls():
            return int(sql('SELECT count(*) FROM mock_http_calls'))

        def watch(at, dry=False):
            before = calls()
            r = json.loads(sql(f"SELECT public.fn_ca_cutover_readiness_watch('{at}'::timestamptz, {str(dry).lower()})"))
            r['_calls'] = calls() - before
            assert r['_calls'] <= 10, f'a run made {r["_calls"]} outside requests'
            return r

        def alerts(status='firing'):
            return int(sql(f"SELECT count(*) FROM operational_alert_events WHERE source='cutover-readiness-watch' AND status='{status}'"))

        def pages(title=TITLE):
            return int(sql(f"SELECT count(*) FROM notifications_sent WHERE title = '{title}'"))

        def runs(day):
            return int(sql(f"SELECT count(*) FROM smarter_private.ca_cutover_readiness_runs WHERE cutover_day = '{day}'"))

        def status(sha, state, at):
            return {'context': 'backup-engine/certified', 'state': state, 'created_at': at}

        def world(*, serving=SERVING, compare='ahead', base_statuses=(), files=(), newer=(), health=None):
            sql(f"DELETE FROM engine_leader; INSERT INTO engine_leader VALUES (true, '1-a', '{serving[:8]}', now(), clock_timestamp())")
            mock('https://engine.smarter.poker/health', health if health is not None else {
                'releaseSha': serving, 'status': 'ok', 'liveness': 'ok', 'settlementStatus': 'ok',
                'wholeFleetStalled': False, 'dealerPrerequisitesReady': True})
            mock(f'{REPO}/commits?sha=main&path=server&per_page=1&until=%',
                 [{'sha': BASE, 'commit': {'committer': {'date': '2026-11-20T05:00:00Z'}}}])
            mock(f'{REPO}/commits?sha=main&path=server&per_page=4&since=%',
                 [{'sha': s, 'commit': {'committer': {'date': '2026-11-20T06:00:00Z'}}} for s, _, _ in newer])
            mock(f'{REPO}/compare/{serving}...{BASE}', {'status': compare, 'files': list(files)})
            mock(f'{REPO}/commits/{BASE}/statuses?per_page=100', list(base_statuses))
            for s, sts, fls in newer:
                mock(f'{REPO}/commits/{s}/statuses?per_page=100', list(sts))
                mock(f'{REPO}/compare/{serving}...{s}', {'status': 'ahead', 'files': list(fls)})
            mock(f'{REPO}/actions/workflows/backup-engine.yml/runs?per_page=1',
                 {'workflow_runs': [{'id': 777, 'status': 'in_progress', 'conclusion': None, 'head_sha': BASE, 'created_at': '2026-11-20T07:10:00Z'}]})

        mig = lambda v: {'filename': f'supabase/migrations/{v}_a_change.sql', 'status': 'added'}
        sql("INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20261119200000')")
        CERT_AFTER = '2026-11-20T07:05:00Z'   # 01:05 CST, after the 23:45 freeze (05:45Z)
        CERT_BEFORE = '2026-11-20T04:00:00Z'  # 22:00 CST the evening before

        # ---- CST: cutover 2026-11-20, 03:00 Chicago = 09:00Z.
        world(base_statuses=[status(BASE, 'success', CERT_AFTER)], files=[mig('20261119200000')])
        r = watch('2026-11-20 08:55:00Z')
        assert r['state'] == 'outside' and r['_calls'] == 0 and runs('2026-11-20') == 0, r
        ok('CST: at 02:55 Chicago nothing is read and nothing is recorded')
        r = watch('2026-11-20 09:00:00Z')
        assert r['state'] == 'ready' and r['candidate'] == BASE[:8] and alerts() == 0 and runs('2026-11-20') == 1, r
        ok('a freeze baseline certified after the freeze, its migrations installed, is ready and raises nothing')
        r = watch('2026-11-20 09:15:00Z')
        assert r['state'] == 'ready' and r['_calls'] == 0 and runs('2026-11-20') == 1, r
        ok('a night found ready is not asked again')
        d = json.loads(sql("SELECT public.fn_sp_digest_engine_cutover('2026-11-19')"))
        assert d['readiness']['verdict'] == 'ready' and d['readiness']['checked_at_ct'] == '03:00', d
        ok('the digest line carries the 03:00 verdict for the cutover it reports')

        # ---- not owed.
        world(compare='behind')
        r = watch('2026-11-21 09:00:00Z')
        assert r['state'] == 'not_owed' and alerts() == 0, r
        ok('a serving build that already holds the baseline is not owed')

        # ---- not ready: no certificate after the freeze; then one arrives.
        world(base_statuses=[status(BASE, 'pending', '2026-11-22T07:30:00Z'), status(BASE, 'success', '2026-11-22T04:00:00Z')])
        r = watch('2026-11-22 09:00:00Z')
        assert r['state'] == 'not_ready' and alerts() == 1 and pages() == 1, r
        body = sql(f"SELECT body FROM notifications_sent WHERE title = '{TITLE}'")
        assert body.startswith('The 4 AM engine update on Nov 22 is at risk (checked 03:00 Central). no Backup-certified build'), body
        assert BASE[:8] in body and 'pending' in body, body
        assert sql("SELECT severity FROM operational_alert_events WHERE source='cutover-readiness-watch'") == 'critical'
        payload = json.loads(sql("SELECT payload FROM operational_alert_events WHERE source='cutover-readiness-watch'"))
        assert payload['facts']['latest_backup_run']['id'] == 777, payload
        ok('no certificate after the freeze: one critical alert pages the owner, naming the baseline and the Backup run')
        r = watch('2026-11-22 09:15:00Z')
        assert r['state'] == 'not_ready' and alerts() == 1 and pages() == 1 and runs('2026-11-22') == 2, r
        ok('a repeat finding pages nothing more')
        world(base_statuses=[status(BASE, 'success', '2026-11-22T09:20:00Z')])
        r = watch('2026-11-22 09:25:00Z')
        assert r['state'] == 'ready' and alerts() == 0 and alerts('resolved') == 1, r
        ok('a later run that finds the certificate resolves the alarm in place')

        def next_night():
            # The owner route's episode clock reads the real clock; a night is a day apart.
            sql("UPDATE ca_owner_page_state SET last_firing_at = now() - interval '1 day', "
                "last_paged_at = now() - interval '1 day' WHERE kind IN ('cutover_readiness', 'releases')")

        # ---- a newer certified build with an uninstalled migration is not taken.
        next_night()
        world(newer=[(NEWER, [status(NEWER, 'success', '2026-11-23T08:00:00Z')], [mig('20261123011500')])])
        r = watch('2026-11-23 09:00:00Z')
        assert r['state'] == 'not_ready' and '20261123011500' in json.dumps(r['reasons']), r
        sql("INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20261123011500')")
        r = watch('2026-11-23 09:15:00Z')
        assert r['state'] == 'ready' and r['candidate'] == NEWER[:8], r
        ok('a newer certified build is taken only once every migration it adds is installed')
        assert pages() == 2, 'the re-fire on a new night pages again'

        # ---- each other reason.
        cert = [status(BASE, 'success', '2026-11-24T07:00:00Z')]
        world(base_statuses=cert)
        sql("INSERT INTO smarter_private.ca_merged_migration_watch(version, file, merge_sha, merged_at, window_install, first_seen_at) "
            "VALUES ('20261124020000', 'supabase/migrations/20261124020000_x.sql', '%s', '2026-11-24 02:00Z', false, now())" % BASE)
        r = watch('2026-11-24 09:00:00Z')
        assert r['state'] == 'not_ready' and 'merged migration(s) from before the freeze are not installed: 20261124020000' in json.dumps(r['reasons']), r
        sql("UPDATE smarter_private.ca_merged_migration_watch SET window_install = true WHERE version = '20261124020000'")
        cert = [status(BASE, 'success', '2026-11-25T07:00:00Z')]
        world(base_statuses=cert)
        r = watch('2026-11-25 09:00:00Z')
        assert r['state'] == 'ready', r
        ok('an uninstalled pre-freeze ordinary migration is a reason; a window file is not')

        cert = [status(BASE, 'success', '2026-11-26T07:00:00Z')]
        world(base_statuses=cert)
        sql("INSERT INTO v_spin_unfilled_waits VALUES ('a059fedf-0000-0000-0000-000000000000', 'Spin 5', interval '8401 seconds')")
        sql("INSERT INTO tournaments(name, status, started_at) VALUES ('Nightly 20K', 'RUNNING', '2026-11-25 10:00Z')")
        r = watch('2026-11-26 09:00:00Z')
        txt = json.dumps(r['reasons'])
        assert r['state'] == 'not_ready' and '8400 s envelope' in txt and 'a059fedf' in txt and 'stuck RUNNING' in txt, r
        sql("DELETE FROM v_spin_unfilled_waits; INSERT INTO v_spin_unfilled_waits VALUES (gen_random_uuid(), 'Spin 6', interval '8400 seconds')")
        sql("UPDATE tournaments SET status = 'COMPLETED'")
        cert = [status(BASE, 'success', '2026-11-27T07:00:00Z')]
        world(base_statuses=cert)
        assert watch('2026-11-27 09:00:00Z')['state'] == 'ready'
        ok('a Spin past the 8,400 s envelope and a tournament stuck RUNNING are reasons; at the envelope is not')

        cert = [status(BASE, 'success', '2026-11-28T07:00:00Z')]
        world(base_statuses=cert, health={'releaseSha': SERVING, 'status': 'ok', 'liveness': 'dead', 'settlementStatus': 'ok'})
        r = watch('2026-11-28 09:00:00Z')
        assert r['state'] == 'not_ready' and 'liveness dead' in json.dumps(r['reasons']), r
        cert = [status(BASE, 'success', '2026-11-29T07:00:00Z')]
        world(base_statuses=cert)
        mock('https://engine.smarter.poker/health', '{}', 503)
        r = watch('2026-11-29 09:00:00Z')
        assert r['state'] == 'not_ready' and 'engine /health did not answer' in json.dumps(r['reasons']), r
        ok('an unhealthy or silent engine is a reason')

        # ---- GitHub unreadable: unknown, no page.
        world()
        sql('DELETE FROM operational_alert_events')
        before = pages()
        unmock(f'{REPO}/commits?sha=main&path=server&per_page=1&until=%')
        r = watch('2026-11-30 09:00:00Z')
        assert r['state'] == 'unknown' and alerts() == 0 and pages() == before, r
        ok('an unreadable GitHub is unknown and pages nothing')

        # ---- an earlier night's alarm closes on the next night's first run.
        sql("INSERT INTO operational_alert_events(source, event_key, alertname, status, severity, payload) VALUES "
            "('cutover-readiness-watch', 'readiness:2026-11-30', 'CutoverReadinessAtRisk', 'firing', 'critical', '{\"cutover_day\":\"2026-11-30\"}')")
        world(base_statuses=[status(BASE, 'success', '2026-12-01T07:00:00Z')])
        r = watch('2026-12-01 09:00:00Z')
        assert r['state'] == 'ready' and alerts() == 0, r
        ok("an earlier night's alarm is closed by the next night's run")

        # ---- dry runs.
        n = int(sql('SELECT count(*) FROM smarter_private.ca_cutover_readiness_runs'))
        r = watch('2026-12-01 23:40:00Z', dry=True)   # 17:40 CST: tonight's freeze not begun
        assert r['state'] == 'pending' and r['facts']['cutover_day'] == '2026-12-02', r
        world(base_statuses=[])
        r = watch('2026-12-02 09:00:00Z', dry=True)
        assert r['state'] == 'not_ready', r
        assert int(sql('SELECT count(*) FROM smarter_private.ca_cutover_readiness_runs')) == n and alerts() == 0
        ok('a dry run writes nothing, and before the freeze says pending')

        # ---- CDT (UTC-5): 03:00 Chicago is 08:00Z; 09:00Z is 04:00 and outside.
        world(base_statuses=[status(BASE, 'success', '2026-10-15T06:00:00Z')])
        r = watch('2026-10-15 09:00:00Z')
        assert r['state'] == 'outside' and r['_calls'] == 0, r
        r = watch('2026-10-15 08:00:00Z')
        assert r['state'] == 'ready' and r['cutover_day'] == '2026-10-15', r
        ok('CDT: it runs at 08:00Z (03:00 Chicago) and not at 09:00Z (04:00)')

        # ---- a readiness page does not hold back the 04:30 release page.
        next_night()
        world(base_statuses=[])
        before_r, before_m = pages(), pages('Engine Update Missed At 4 AM')
        r = watch('2026-12-03 09:00:00Z')
        assert r['state'] == 'not_ready' and pages() == before_r + 1, r
        sql("SELECT public.fn_record_operational_alert('engine-cutover-watch', 'missed:2026-12-03', 'EngineCutoverMissed', 'firing', 'critical', "
            "'{\"summary\":\"The 4 AM engine update did not happen on Dec 3.\"}'::jsonb)")
        assert pages('Engine Update Missed At 4 AM') == before_m + 1
        ok('a readiness page and a release page each page on their own clock')

        assert sql("SELECT schedule FROM cron.job WHERE jobname = 'ca-cutover-readiness-watch-3am'") == '0,15,25 8,9 * * *'
        assert sql("SELECT count(*) FROM mock_http_calls WHERE uri NOT LIKE 'https://engine.smarter.poker/health' AND uri NOT LIKE 'https://api.github.com/%'") == '0'
        ok('the schedule is registered, and the watch reads only GitHub and engine /health')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    print(f'{len(passed)} passed')


if __name__ == '__main__':
    main()
