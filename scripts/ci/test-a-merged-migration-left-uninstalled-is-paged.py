#!/usr/bin/env python3
"""Native proof for the merged-migration install watch (PostgreSQL 17, never production).

The owner page route is built exactly as production has it: the production
definitions in scripts/ci/fixtures/engine-cutover-preimages.json, then the
installed engine-cutover migration 20261109024836 (whose output this
migration's md5 preimage check pins), then this migration. GitHub is served by
a fake extensions.http answering from a table, so every outcome is data:

  * a file merged 59 minutes ago is quiet; at 60 minutes ONE critical alert
    pages the owner as 'Merged Migration Not Installed', and only once;
  * installing it resolves the alert; removing it from main resolves it too;
  * a daily-maintenance window file is remembered but never paged, including
    one that was RENAMED (its patch holds only the changed hunk, so the header
    is read from the raw file; 20261110194917);
  * a renamed file whose raw text cannot be read is retried, never guessed;
  * an unreadable GitHub raises nothing new and keeps the cursor;
  * a release page and a migration page do not hold each other back;
  * it never writes schema_migrations and never calls anything but GET.
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
MIGRATION = next(MIGRATIONS.glob('*_a_merged_migration_still_uninstalled_after_an_hour_pages_t*.sql'))
# 20261110194917: a renamed file's window header is read from the raw file.
RENAME_FIX = next(MIGRATIONS.glob('*_the_install_watch_reads_a_renamed_migration_s_header_from_it.sql'))
PREIMAGES = json.loads((ROOT / 'scripts/ci/fixtures/engine-cutover-preimages.json').read_text())
REPO = 'https://api.github.com/repos/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
RAW = 'https://raw.githubusercontent.com/Smarter-Software-PIQ/Smarter-Poker-Club-Arena'
TITLE = 'Merged Migration Not Installed'


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


# The cutover proof's schema, plus the migration ledger.
CUTOVER_TEST = (ROOT / 'scripts/ci/test-a-missed-engine-cutover-is-paged.py').read_text()
SCHEMA = re.search(r'^SCHEMA = r"""(.*?)"""', CUTOVER_TEST, re.S | re.M).group(1) + r"""
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[]);
"""


def sha(n):
    return f'{n:040x}'


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='migwatch-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'], check=True, capture_output=True)
    port = str(50000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
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
            print(f'ok - {name}')

        sql(SCHEMA)
        for sig in ('fn_record_operational_alert(text,text,text,text,text,jsonb)', 'fn_ca_owner_page_kind(text,text,text)',
                    'fn_ca_a_real_alert_reaches_the_owner()', 'fn_sp_daily_digest(date,boolean)'):
            r = psql([], PREIMAGES[sig] + ';')
            assert r.returncode == 0, f'{sig}: {r.stderr}'
        sql("CREATE TRIGGER zz_a_real_alert_reaches_the_owner AFTER INSERT ON public.operational_alert_events "
            "FOR EACH ROW WHEN (NEW.status = 'firing') EXECUTE FUNCTION public.fn_ca_a_real_alert_reaches_the_owner()")
        r = psql(['-f', str(CUTOVER)])
        assert r.returncode == 0, r.stderr
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'live proof must hold after install'
        ok('the exact migration installs over the installed owner page route and its live proof holds')
        r = psql(['-f', str(RENAME_FIX)])
        assert r.returncode == 0, r.stderr
        proof = re.search(r'^-- @live-proof: (.+)$', RENAME_FIX.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof}') == 't', 'rename-fix live proof must hold after install'
        ok('the rename fix installs over the exact installed watch (md5 preimage) and its live proof holds')

        def mock(pattern, body, status=200):
            sql("INSERT INTO mock_http VALUES ($m$%s$m$, %d, $m$%s$m$) ON CONFLICT (pattern) DO UPDATE SET status = EXCLUDED.status, body = EXCLUDED.body"
                % (pattern, status, body if isinstance(body, str) else json.dumps(body)))

        def watch(at):
            return json.loads(sql(f"SELECT public.fn_ca_merged_migration_install_watch('{at}'::timestamptz)"))

        def alerts(status='firing'):
            return int(sql(f"SELECT count(*) FROM operational_alert_events WHERE source='migration-install-watch' AND status='{status}'"))

        def pages(title=TITLE):
            return int(sql(f"SELECT count(*) FROM notifications_sent WHERE title = '{title}'"))

        commits = []

        def merge(n, at, files):
            commits.insert(0, {'sha': sha(n), 'commit': {'committer': {'date': at}}})
            mock(f'{REPO}/commits?sha=main&path=supabase/migrations&since=%', commits)
            mock(f'{REPO}/commits/{sha(n)}', {'files': files})

        sql("UPDATE smarter_private.ca_merged_migration_watch_cursor SET since = '2026-11-10 00:00:00Z'")
        ORD = 'supabase/migrations/20261110100000_ordinary_change.sql'
        WIN = 'supabase/migrations/20261110100500_window_change.sql'
        BIG = 'supabase/migrations/20261110101000_big_change.sql'
        merge(1, '2026-11-10T10:00:00Z', [{'filename': ORD, 'status': 'added', 'patch': '@@ -0,0 +1,2 @@\n+-- ordinary\n+BEGIN; COMMIT;'}])
        merge(2, '2026-11-10T10:05:00Z', [{'filename': WIN, 'status': 'added', 'patch': '@@ -0,0 +1,2 @@\n+-- x\n+-- @install-window: daily-maintenance'}])
        merge(3, '2026-11-10T10:10:00Z', [{'filename': BIG, 'status': 'added'}, {'filename': 'src/x.ts', 'status': 'modified'}])
        mock(f'{RAW}/{sha(3)}/{BIG}', '-- big\nBEGIN; COMMIT;')

        r = watch('2026-11-10 10:59:00Z')
        assert r['state'] == 'read' and r['new_commits'] == 3 and r['pending'] == 2 and alerts() == 0, r
        assert sql("SELECT string_agg(version || ':' || window_install, ',' ORDER BY version) FROM smarter_private.ca_merged_migration_watch") == \
            '20261110100000:false,20261110100500:true,20261110101000:false'
        ok('three merged files are remembered; nothing pages at 59 minutes; the window file is marked window')

        r = watch('2026-11-10 11:00:00Z')
        assert r['raised'] == 1 and alerts() == 1 and pages() == 1, r
        assert sql("SELECT severity FROM operational_alert_events WHERE event_key='uninstalled:20261110100000'") == 'critical'
        body = sql(f"SELECT body FROM notifications_sent WHERE title='{TITLE}'")
        assert body.startswith('20261110100000_ordinary_change.sql merged at Nov 10 04:00 Central') and 'after 60 minutes' in body, body
        assert 'new_commits' in r and r['new_commits'] == 0
        ok('at 60 minutes one critical alert names the file and merge, and pages the owner')

        r = watch('2026-11-10 11:10:00Z')
        assert r['raised'] == 1 and alerts() == 2, r  # the big file reached its hour
        r = watch('2026-11-10 11:20:00Z')
        assert r['raised'] == 0 and alerts() == 2, r
        assert int(sql("SELECT count(*) FROM operational_alert_events WHERE source='migration-install-watch'")) == 2
        ok('each file is raised once, not every ten minutes')
        assert pages() == 1 and int(sql("SELECT held_since_page FROM ca_owner_page_state WHERE kind='migrations'")) == 1
        ok('a second file inside the episode is held by the existing owner route, not paged twice')

        r = watch('2026-11-10 13:00:00Z')
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key LIKE 'uninstalled:20261110100500'") == '0'
        ok('a daily-maintenance window file is never paged by this watch')

        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261110100000', 'ordinary_change')")
        r = watch('2026-11-10 13:10:00Z')
        assert r['resolved'] == 1 and alerts() == 1 and alerts('resolved') == 1, r
        ok('installing the file resolves its alert')

        merge(4, '2026-11-10T13:15:00Z', [{'filename': BIG, 'status': 'removed'}])
        r = watch('2026-11-10 13:20:00Z')
        assert r['resolved'] == 1 and alerts() == 0, r
        ok('removing the file from main resolves its alert')

        # Unreadable GitHub: nothing new raised, cursor kept.
        merge(5, '2026-11-10T14:00:00Z', [{'filename': 'supabase/migrations/20261110140000_later.sql', 'status': 'added', 'patch': '+x'}])
        r = watch('2026-11-10 15:05:00Z')
        assert r['raised'] == 1, r
        sql("DELETE FROM operational_alert_events WHERE event_key = 'uninstalled:20261110140000'; "
            "UPDATE smarter_private.ca_merged_migration_watch SET alert_id = NULL WHERE version = '20261110140000'")
        since = sql("SELECT since FROM smarter_private.ca_merged_migration_watch_cursor")
        mock(f'{REPO}/commits?sha=main&path=supabase/migrations&since=%', '{"message":"rate limited"}', status=403)
        r = watch('2026-11-10 15:15:00Z')
        assert r['state'] == 'unknown' and r['raised'] == 0 and alerts() == 0, r
        assert sql("SELECT since FROM smarter_private.ca_merged_migration_watch_cursor") == since
        ok('an unreadable GitHub raises nothing new and keeps the cursor')

        # A detail that cannot be read is retried next run, and nothing after it is marked read.
        mock(f'{REPO}/commits?sha=main&path=supabase/migrations&since=%', commits)
        merge(6, '2026-11-10T15:20:00Z', [{'filename': 'supabase/migrations/20261110152000_a.sql', 'status': 'added', 'patch': '+x'}])
        mock(f'{REPO}/commits/{sha(6)}', '{}', status=502)
        merge(7, '2026-11-10T15:25:00Z', [{'filename': 'supabase/migrations/20261110152500_b.sql', 'status': 'added', 'patch': '+x'}])
        r = watch('2026-11-10 15:30:00Z')
        assert r['state'] == 'unknown', r
        assert sql(f"SELECT count(*) FROM smarter_private.ca_merged_migration_watch_commits WHERE sha IN ('{sha(6)}', '{sha(7)}')") == '0'
        mock(f'{REPO}/commits/{sha(6)}', {'files': [{'filename': 'supabase/migrations/20261110152000_a.sql', 'status': 'added', 'patch': '+x'}]})
        r = watch('2026-11-10 15:40:00Z')
        assert r['state'] == 'read' and r['new_commits'] == 2, r
        ok('an unreadable commit is read on the next run, with every commit after it')

        # A RENAMED window file (20261110160345 -> 20261110173033, 2026-11-10,
        # alert 376392): GitHub's patch for a rename carries only the changed
        # hunk, so the header on line 1 is not in it. The watch must read the
        # raw file, not take the partial patch for the whole file.
        OLDW = 'supabase/migrations/20261110160000_renamed_window.sql'
        NEWW = 'supabase/migrations/20261110170000_renamed_window.sql'
        merge(8, '2026-11-10T16:00:00Z', [{'filename': OLDW, 'status': 'added',
                                           'patch': '@@ -0,0 +1,3 @@\n+-- @install-window: daily-maintenance\n+-- @locks: public.t\n+-- 20261110160000_renamed_window.sql'}])
        merge(9, '2026-11-10T16:10:00Z', [{'filename': NEWW, 'previous_filename': OLDW, 'status': 'renamed',
                                           'patch': '@@ -3,1 +3,1 @@\n--- 20261110160000_renamed_window.sql\n+-- 20261110170000_renamed_window.sql'}])
        mock(f'{RAW}/{sha(9)}/{NEWW}', '-- @install-window: daily-maintenance\n-- @locks: public.t\n-- 20261110170000_renamed_window.sql\n')
        r = watch('2026-11-10 16:20:00Z')
        assert r['state'] == 'read', r
        assert sql("SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110170000'") == 't'
        r = watch('2026-11-10 18:30:00Z')
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:20261110170000'") == '0', r
        ok('a renamed daily-maintenance window file is read from its raw text and never paged')

        # A renamed file whose raw text cannot be read is not guessed ordinary:
        # its commit is left unread and read again on the next run.
        OLDX = 'supabase/migrations/20261110161000_renamed_again.sql'
        NEWX = 'supabase/migrations/20261110171000_renamed_again.sql'
        merge(10, '2026-11-10T16:30:00Z', [{'filename': OLDX, 'status': 'added',
                                            'patch': '@@ -0,0 +1,1 @@\n+-- @install-window: daily-maintenance'}])
        merge(11, '2026-11-10T16:40:00Z', [{'filename': NEWX, 'previous_filename': OLDX, 'status': 'renamed', 'patch': '@@ -2,1 +2,1 @@\n-x\n+y'}])
        mock(f'{RAW}/{sha(11)}/{NEWX}', 'not found', status=404)
        r = watch('2026-11-10 18:40:00Z')
        assert r['state'] == 'unknown', r
        assert sql(f"SELECT count(*) FROM smarter_private.ca_merged_migration_watch_commits WHERE sha = '{sha(11)}'") == '0'
        assert sql("SELECT count(*) FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110171000'") == '0'
        mock(f'{RAW}/{sha(11)}/{NEWX}', '-- @install-window: daily-maintenance\ny\n')
        r = watch('2026-11-10 18:50:00Z')
        assert r['state'] == 'read', r
        assert sql("SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110171000'") == 't'
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:20261110171000'") == '0'
        ok('a renamed file whose raw text cannot be read is retried, never guessed ordinary')

        # Release and migration pages keep their own episode clocks.
        sql("SELECT public.fn_record_operational_alert('engine-cutover-watch', 'missed:2026-11-10', 'EngineCutoverMissed', 'firing', 'critical', "
            "jsonb_build_object('summary', 'The 4 AM engine update did not happen.'))")
        assert pages('Engine Update Missed At 4 AM') == 1
        ok('a migration page does not hold back an engine release page')

        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations") == '1'
        assert sql("SELECT count(*) FROM mock_http_calls WHERE uri NOT LIKE 'https://api.github.com/%' AND uri NOT LIKE 'https://raw.githubusercontent.com/%'") == '0'
        assert sql("SELECT jobname || ' ' || schedule FROM cron.job WHERE jobname LIKE 'ca-merged-migration%'") == 'ca-merged-migration-install-watch-10m */10 * * * *'
        ok('it never writes the migration ledger and only reads GitHub')
        print('all passed')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)


if __name__ == '__main__':
    main()
