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
  * an empty or blank body is unreadable, never an absent header;
  * a file marked superseded after its merge (a 'modified' commit) is read
    again from its raw text, never paged, and an alert already raised for it
    resolves; an added file that arrives superseded is never paged; a marker
    naming no file on main is ignored; an unreadable modification is retried
    (20261112035143, alert 376926);
  * a window file still uninstalled fifteen minutes after the 04:05 Central
    thaw of a window it was eligible for is raised ONCE as a private warning
    (never an owner page), a file merged after that window's 03:30 cutoff is
    not, and installing it resolves the warning (20261112105047);
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
# 20261112035143: a superseded file is never paged; a modified waiting file is re-read.
SUPERSEDED_FIX = next(MIGRATIONS.glob('*_the_install_watch_reads_a_superseded_migration_as_never_to_b*.sql'))
# 20261112105047: a window file a daily window left uninstalled is raised once.
WINDOW_FIX = next(MIGRATIONS.glob('*_the_install_watch_flags_a_window_file_a_daily_window_left_un*.sql'))
# The never-run marker, spelled in two pieces so this file is not read as one.
MARK = '-- SUPER' + 'SEDED BY '
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
        if os.environ.get('MIGWATCH_PRE_FIX') != '1':
            r = psql(['-f', str(SUPERSEDED_FIX)])
            assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', SUPERSEDED_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'superseded-fix live proof must hold after install'
            ok('the superseded fix installs over the exact installed watch (md5 preimage) and its live proof holds')
        if os.environ.get('MIGWATCH_PRE_FIX') != '1' and os.environ.get('MIGWATCH_PRE_WINDOW') != '1':
            r = psql(['-f', str(WINDOW_FIX)])
            assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', WINDOW_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'window-fix live proof must hold after install'
            ok('the window-file fix installs over the exact installed watch (md5 preimage) and its live proof holds')

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

        # An EMPTY body is unreadable, not an absent header (20261110194917).
        # GitHub can answer 200 with nothing, and ca_migration_watch_raw hands
        # back that '' rather than NULL, so reading it as "no window header"
        # would put a window file on the ordinary route and page it - the same
        # false page this file exists to stop.
        OLDE = 'supabase/migrations/20261110162000_renamed_empty.sql'
        NEWE = 'supabase/migrations/20261110172000_renamed_empty.sql'
        merge(12, '2026-11-10T16:50:00Z', [{'filename': OLDE, 'status': 'added',
                                            'patch': '@@ -0,0 +1,1 @@\n+-- @install-window: daily-maintenance'}])
        merge(13, '2026-11-10T17:00:00Z', [{'filename': NEWE, 'previous_filename': OLDE, 'status': 'renamed',
                                            'patch': '@@ -2,1 +2,1 @@\n-x\n+y'}])
        mock(f'{RAW}/{sha(13)}/{NEWE}', '')
        r = watch('2026-11-10 19:00:00Z')
        assert r['state'] == 'unknown', r
        assert sql(f"SELECT count(*) FROM smarter_private.ca_merged_migration_watch_commits WHERE sha = '{sha(13)}'") == '0'
        assert sql("SELECT count(*) FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110172000'") == '0'
        mock(f'{RAW}/{sha(13)}/{NEWE}', '   \n\t\n')
        r = watch('2026-11-10 19:10:00Z')
        assert r['state'] == 'unknown', r
        assert sql("SELECT count(*) FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110172000'") == '0'
        mock(f'{RAW}/{sha(13)}/{NEWE}', '-- @install-window: daily-maintenance\ny\n')
        r = watch('2026-11-10 19:20:00Z')
        assert r['state'] == 'read', r
        assert sql("SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110172000'") == 't'
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:20261110172000'") == '0'
        ok('an empty or blank raw body is unreadable and retried, never read as an absent window header')

        # An ADDED file whose patch GitHub returned empty is read from the raw
        # file rather than judged on nothing.
        ADDE = 'supabase/migrations/20261110163000_added_empty_patch.sql'
        merge(14, '2026-11-10T17:10:00Z', [{'filename': ADDE, 'status': 'added', 'patch': ''}])
        mock(f'{RAW}/{sha(14)}/{ADDE}', '-- @install-window: daily-maintenance\nBEGIN; COMMIT;\n')
        r = watch('2026-11-10 19:30:00Z')
        assert r['state'] == 'read', r
        assert sql("SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110163000'") == 't'
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:20261110163000'") == '0'
        ok('an added file with an empty patch is read from its raw text, not judged on nothing')

        def alert_status(version):
            return sql(f"SELECT coalesce(string_agg(status, ','), '') FROM operational_alert_events WHERE event_key = 'uninstalled:{version}'")

        # A FILE MARKED SUPERSEDED AFTER ITS MERGE (20261112013714 by #10561,
        # 2026-11-12, alert 376926). The marking commit MODIFIES the file; the
        # watch must read it again, resolve the alert it already raised, and
        # never page it again. The applier refuses a superseded file by design.
        ORD2 = 'supabase/migrations/20261110200000_replaced_later.sql'
        SUPN = 'supabase/migrations/20261110210500_the_replacement.sql'
        merge(15, '2026-11-10T20:00:00Z', [{'filename': ORD2, 'status': 'added', 'patch': '@@ -0,0 +1,2 @@\n+-- replaced later\n+BEGIN; COMMIT;'}])
        watch('2026-11-10 21:00:00Z')
        assert alert_status('20261110200000') == 'firing'
        merge(16, '2026-11-10T21:05:00Z', [
            {'filename': SUPN, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'},
            {'filename': ORD2, 'status': 'modified', 'patch': '@@ -1,1 +1,2 @@\n+' + MARK + '20261110210500\n -- replaced later'}])
        mock(f'{RAW}/{sha(16)}/{ORD2}', MARK + '20261110210500\n-- replaced later\nBEGIN; COMMIT;\n')
        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261110210500', 'the_replacement')")
        r = watch('2026-11-10 21:10:00Z')
        assert r['state'] == 'read', r
        assert alert_status('20261110200000') == 'resolved', r
        assert sql("SELECT superseded_by FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110200000'") == '20261110210500'
        assert sql("SELECT payload->>'resolution' FROM operational_alert_events WHERE event_key = 'uninstalled:20261110200000'") == \
            'superseded on main by 20261110210500; it must never install'
        watch('2026-11-10 23:00:00Z')
        assert alert_status('20261110200000') == 'resolved'
        ok('a file marked superseded after its merge is read again, its alert resolves, and it is never paged again')

        # An ADDED file that arrives already superseded, naming a file on main
        # (remembered, not yet installed), is never paged.
        SUPA = 'supabase/migrations/20261110220000_arrives_superseded.sql'
        SUPB = 'supabase/migrations/20261110220500_its_replacement.sql'
        merge(17, '2026-11-10T22:00:00Z', [
            {'filename': SUPA, 'status': 'added', 'patch': '@@ -0,0 +1,2 @@\n+' + MARK + '20261110220500\n+BEGIN; COMMIT;'},
            {'filename': SUPB, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+-- @install-window: daily-maintenance'}])
        watch('2026-11-11 01:00:00Z')
        assert sql("SELECT superseded_by FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110220000'") == '20261110220500'
        assert alert_status('20261110220000') == '' and alert_status('20261110220500') == ''
        ok('an added file that arrives superseded by a file on main is never paged')

        # A marker naming a version that is neither on main nor installed is
        # ignored, exactly as the applier and CI ignore it: the file pages.
        LIAR = 'supabase/migrations/20261110230000_names_nothing.sql'
        merge(18, '2026-11-10T23:00:00Z', [{'filename': LIAR, 'status': 'added',
                                            'patch': '@@ -0,0 +1,2 @@\n+' + MARK + '20261110239999\n+BEGIN; COMMIT;'}])
        watch('2026-11-11 00:05:00Z')
        assert alert_status('20261110230000') == 'firing'
        ok('a marker naming no file on main is ignored and the file is paged')

        # A marker past the first 400 characters is not the marker, as for the applier.
        DEEP = 'supabase/migrations/20261110231000_marker_too_deep.sql'
        merge(19, '2026-11-10T23:10:00Z', [{'filename': DEEP, 'status': 'added',
                                            'patch': '@@ -0,0 +1,3 @@\n+' + ('-' * 450) + '\n+' + MARK + '20261110210500\n+BEGIN; COMMIT;'}])
        watch('2026-11-11 00:15:00Z')
        assert alert_status('20261110231000') == 'firing'
        ok('a marker beyond the first 400 characters of the file does not count')

        # A modification whose raw text cannot be read is retried, never guessed.
        ORD3 = 'supabase/migrations/20261110232000_modified_unreadable.sql'
        merge(20, '2026-11-10T23:20:00Z', [{'filename': ORD3, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-10 23:25:00Z')
        merge(21, '2026-11-10T23:30:00Z', [{'filename': ORD3, 'status': 'modified', 'patch': '@@ -1,1 +1,2 @@\n+' + MARK + '20261110210500'}])
        mock(f'{RAW}/{sha(21)}/{ORD3}', 'not found', status=404)
        r = watch('2026-11-10 23:35:00Z')
        assert r['state'] == 'unknown', r
        assert sql(f"SELECT count(*) FROM smarter_private.ca_merged_migration_watch_commits WHERE sha = '{sha(21)}'") == '0'
        mock(f'{RAW}/{sha(21)}/{ORD3}', MARK + '20261110210500\nBEGIN; COMMIT;\n')
        r = watch('2026-11-11 01:00:00Z')
        assert r['state'] == 'read', r
        assert alert_status('20261110232000') == ''
        ok('a modification whose raw text cannot be read is retried, never guessed')

        # A modification to a file nothing waits on costs no fetch.
        merge(22, '2026-11-11T01:10:00Z', [{'filename': 'supabase/migrations/20261110100000_ordinary_change.sql', 'status': 'modified', 'patch': '@@ -1 +1 @@\n-x\n+y'}])
        watch('2026-11-11 01:15:00Z')
        assert sql(f"SELECT count(*) FROM mock_http_calls WHERE uri = '{RAW}/{sha(22)}/supabase/migrations/20261110100000_ordinary_change.sql'") == '0'
        ok('a modification to an installed file is not fetched')

        # A WINDOW FILE A DAILY WINDOW LEFT UNINSTALLED (2026-11-10..12: the
        # installer job was skipped three days running and nothing said so).
        # On main before the 03:30 Central cutoff of the Nov 11 window, still
        # uninstalled at 04:20 Central: raised once, privately; a file merged
        # after the cutoff is not raised for that window.
        WINW = 'supabase/migrations/20261111080000_window_left_behind.sql'
        WINL = 'supabase/migrations/20261111094000_window_after_cutoff.sql'
        merge(23, '2026-11-11T08:00:00Z', [{'filename': WINW, 'status': 'added',
                                            'patch': '@@ -0,0 +1,1 @@\n+-- @install-window: daily-maintenance'}])
        merge(24, '2026-11-11T09:40:00Z', [{'filename': WINL, 'status': 'added',
                                            'patch': '@@ -0,0 +1,1 @@\n+-- @install-window: daily-maintenance'}])

        def window_alert(version):
            return sql(f"SELECT coalesce(string_agg(status || ':' || severity, ','), '') FROM operational_alert_events "
                       f"WHERE event_key = 'window-missed:{version}'")

        owner_pages_before = int(sql("SELECT count(*) FROM notifications_sent"))
        watch('2026-11-11 10:15:00Z')  # 04:15 Central: inside the grace after the 04:05 thaw
        assert window_alert('20261111080000') == '', 'raised before 04:20 Central'
        r = watch('2026-11-11 10:20:00Z')  # 04:20 Central
        assert window_alert('20261111080000') == 'firing:warning', r
        assert window_alert('20261111094000') == '', 'a file merged after the 03:30 cutoff missed no window'
        summary = sql("SELECT payload->>'summary' FROM operational_alert_events WHERE event_key = 'window-missed:20261111080000'")
        assert summary.startswith('20261111080000_window_left_behind.sql (daily-maintenance window file) merged at Nov 11 02:00 Central') \
            and 'after the Nov 11 04:00 Central window' in summary, summary
        assert sql("SELECT payload->>'target_task_id' FROM operational_alert_events WHERE event_key = 'window-missed:20261111080000'") == \
            '01a09b86-5ba8-7290-8657-1041f13dd3ca'
        assert sql("SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:20261111080000'") == '0'
        assert int(sql("SELECT count(*) FROM notifications_sent")) == owner_pages_before
        raised = int(sql("SELECT count(*) FROM operational_alert_events WHERE event_key LIKE 'window-missed:%'"))
        watch('2026-11-11 10:30:00Z')
        watch('2026-11-11 12:00:00Z')
        assert int(sql("SELECT count(*) FROM operational_alert_events WHERE event_key LIKE 'window-missed:%'")) == raised
        ok('a window file a daily window left uninstalled is raised once as a private warning, never paged to the owner')

        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261111080000', 'window_left_behind')")
        watch('2026-11-11 12:10:00Z')
        assert window_alert('20261111080000') == 'resolved:warning'
        assert sql("SELECT payload->>'resolution' FROM operational_alert_events WHERE event_key = 'window-missed:20261111080000'") == \
            'installed in production'
        watch('2026-11-12 10:20:00Z')  # the next window: the later file is now raised, the installed one is not
        assert window_alert('20261111094000') == 'firing:warning'
        assert window_alert('20261111080000') == 'resolved:warning'
        ok('installing the window file resolves its warning; the next window raises the file that missed it')

        # Release and migration pages keep their own episode clocks.
        sql("SELECT public.fn_record_operational_alert('engine-cutover-watch', 'missed:2026-11-10', 'EngineCutoverMissed', 'firing', 'critical', "
            "jsonb_build_object('summary', 'The 4 AM engine update did not happen.'))")
        assert pages('Engine Update Missed At 4 AM') == 1
        ok('a migration page does not hold back an engine release page')

        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations") == '3'  # all inserted by this test
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
