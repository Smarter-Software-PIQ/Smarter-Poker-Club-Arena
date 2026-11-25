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
  * an unreadable GitHub raises nothing new and keeps the cursor;
  * while Apply Merged Migration or Dispatch Merged Migrations is switched
    off (the owner-window pause) the hour page is held, for at most six
    hours; a file merged before the switch-on gets its hour from the
    switch-on, so a resume that never sent it still pages; an unreadable
    workflow state holds nothing (20261117165416, incident c1a85d20);
  * a file merged inside the nightly release schema freeze (23:45-04:15
    Central), which Dispatch Merged Migrations holds to 04:15 on purpose,
    pages one hour after 04:15, never at merge + 60; a page raised inside the
    freeze never says "dispatch it"; a refused file fixed in place resolves
    its outdated page, restarts its hour from the fixing commit and pages
    again once if still not installed (20261119064912, incident dc479141);
  * a file merged inside a three-hourly cutover deferral, which Dispatch Merged
    Migrations holds to cycle start + 10 minutes, pages one hour after that
    (20261123000830, incident ba9d1133); the deferral opens 150 minutes before
    the cycle start since O21, so a file merged 120 minutes before a cycle is
    quiet at merge + 60 and a file merged at 22:30 Central is held through the
    nightly freeze to 04:15 (O21_FIX below);
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
# The never-run marker, spelled in two pieces so this file is not read as one.
# 20261117165416: installs switched off hold the hour page (incident c1a85d20).
PAUSE_FIX = next(MIGRATIONS.glob('*_the_install_watch_holds_its_page_while_installs_are_switched*.sql'))
# 20261119064912: the hour starts when the dispatcher may send (incident dc479141).
FREEZE_FIX = next(MIGRATIONS.glob('*_the_install_watch_hour_starts_when_the_dispatcher_may_send.sql'))
# 20261123000830: the install watch follows three-hourly O3 deferral (incident ba9d1133).
O3_FIX = next(MIGRATIONS.glob('*_the_install_watch_follows_three_hourly_deferral.sql'))
# O21 (2026-11-24): the helper follows the 150 minute three-hourly deferral.
O21_FIX = next(MIGRATIONS.glob('*_the_install_watch_follows_the_150_minute_deferral.sql'))
# 20261123151024: re-read superseded edits on held rows & vanished schema_migrations holds (incident 0da46df7).
HELD_SUPERSEDED_FIX = next(MIGRATIONS.glob('*_superseded_watch_cutover_diagnosis_and_closed_arena_revoke.sql'))
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
        PRE_PAUSE = os.environ.get('MIGWATCH_PRE_FIX') == '1' or os.environ.get('MIGWATCH_PRE_PAUSE') == '1'
        print('# watch md5 before the pause fix: ' + sql("SELECT md5(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure))"))
        if not PRE_PAUSE:
            for attempt in (1, 2):
                r = psql(['-f', str(PAUSE_FIX)])
                assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', PAUSE_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'pause-fix live proof must hold after install'
            ok('the pause fix amends each anchor once, installs twice idempotently and its live proof holds')

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

        # INSTALLS SWITCHED OFF (incident c1a85d20, 2026-11-14 to 2026-11-16).
        # The owner-window playbook switches the applier (and the dispatcher)
        # off from the booking merge to SEALED; 12 of 18 pages in four days
        # said "dispatch it" while that was on purpose.
        APPLIER = f'{REPO}/actions/workflows/apply-merged-migration.yml'
        DISPATCHER = f'{REPO}/actions/workflows/dispatch-merged-migrations.yml'

        def workflows(applier, dispatcher):
            for uri, state in ((APPLIER, applier), (DISPATCHER, dispatcher)):
                if state is None:
                    sql(f"DELETE FROM mock_http WHERE pattern = '{uri}'")
                else:
                    mock(uri, {'name': uri.rsplit('/', 1)[1], 'state': state})

        P1 = 'supabase/migrations/20261111020000_merged_during_a_pause.sql'
        workflows('disabled_manually', 'active')
        merge(30, '2026-11-11T02:00:00Z', [{'filename': P1, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        r = watch('2026-11-11 02:05:00Z')
        r = watch('2026-11-11 03:10:00Z')
        assert alert_status('20261111020000') == '', f'a pause must hold the hour page: {r}'
        assert r.get('install_pause', '').startswith('paused since'), r
        ok('a pause holds the hour page for a file merged inside it')

        workflows('active', 'active')
        watch('2026-11-11 04:00:00Z')
        watch('2026-11-11 04:59:00Z')
        assert alert_status('20261111020000') == '', 'the resume gets its own hour'
        r = watch('2026-11-11 05:00:00Z')
        assert alert_status('20261111020000') == 'firing', r
        ok('a file the resume never sent pages one hour after the switch-on, never sooner')

        P2 = 'supabase/migrations/20261111043000_merged_after_the_pause.sql'
        merge(31, '2026-11-11T04:30:00Z', [{'filename': P2, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-11 05:29:00Z')
        assert alert_status('20261111043000') == ''
        watch('2026-11-11 05:30:00Z')
        assert alert_status('20261111043000') == 'firing'
        ok('a file merged after the pause keeps its own hour from its merge')

        P3 = 'supabase/migrations/20261111060000_merged_during_a_forgotten_pause.sql'
        workflows('active', 'disabled_manually')
        merge(32, '2026-11-11T06:00:00Z', [{'filename': P3, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-11 06:00:00Z')
        watch('2026-11-11 11:59:00Z')
        assert alert_status('20261111060000') == ''
        watch('2026-11-11 12:00:00Z')
        assert alert_status('20261111060000') == 'firing'
        ok('a pause still open after six hours is a forgotten pause and pages')

        workflows('active', 'active')
        watch('2026-11-11 12:10:00Z')
        workflows(None, None)
        P4 = 'supabase/migrations/20261111130000_merged_while_the_state_is_unreadable.sql'
        merge(33, '2026-11-11T13:00:00Z', [{'filename': P4, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        r = watch('2026-11-11 14:00:00Z')
        assert alert_status('20261111130000') == 'firing', r
        assert r.get('install_pause') == 'unknown', r
        assert sql("SELECT count(*) FROM mock_http_calls WHERE uri LIKE '%/actions/workflows/%' AND uri NOT IN "
                   f"('{APPLIER}', '{DISPATCHER}')") == '0'
        ok('an unreadable workflow state holds nothing and only the two workflows are read')

        # THE HOUR STARTS WHEN THE DISPATCHER MAY SEND (20261119064912,
        # incident dc479141, alert 445153). Dispatch Merged Migrations holds an
        # ordinary file merged inside the nightly release schema freeze
        # (23:45-04:15 Central) until 04:15 on purpose; a refused file fixed in
        # place is sent again from its fixing commit. The page must follow
        # both, and inside the freeze it must never say "dispatch it".
        if os.environ.get('MIGWATCH_PRE_FREEZE') != '1':
            for attempt in (1, 2):
                r = psql(['-f', str(FREEZE_FIX)])
                assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', FREEZE_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'freeze-fix live proof must hold after install'
            ok('the freeze fix amends each anchor once, installs twice idempotently and its live proof holds')
        workflows('active', 'active')

        def summary(version):
            return sql(f"SELECT payload->>'summary' FROM operational_alert_events WHERE event_key = 'uninstalled:{version}' AND status = 'firing'")

        # A file merged before the freeze and refused pages after its hour,
        # which falls inside the freeze: the page says do NOT hand-dispatch.
        R1 = 'supabase/migrations/20261112050000_refused_before_the_freeze.sql'
        merge(40, '2026-11-12T05:00:00Z', [{'filename': R1, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-12 05:05:00Z')
        watch('2026-11-12 06:00:00Z')                                   # 00:00 Central
        assert alert_status('20261112050000') == 'firing'
        assert 'do NOT hand-dispatch' in summary('20261112050000'), summary('20261112050000')
        assert 'Dispatch Apply Merged Migration for it' not in summary('20261112050000')
        ok('a page raised inside the release freeze says not to hand-dispatch, never "dispatch it"')

        # A file merged inside the freeze is held to 04:15; its hour runs from there.
        F1 = 'supabase/migrations/20261112054800_merged_inside_the_freeze.sql'
        merge(41, '2026-11-12T05:48:00Z', [{'filename': F1, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-12 05:50:00Z')
        watch('2026-11-12 06:48:00Z')                                   # merge + 60: the old false page
        watch('2026-11-12 11:14:00Z')                                   # 05:14 Central
        assert alert_status('20261112054800') == '', 'a freeze-held file must not page before 04:15 + 60'
        watch('2026-11-12 11:15:00Z')                                   # 05:15 Central
        assert alert_status('20261112054800') == 'firing'
        assert 'Dispatch Apply Merged Migration for it' in summary('20261112054800')
        ok('a file merged inside the release freeze pages one hour after 04:15, never at merge + 60')

        # The refused file is fixed in place: its page resolves with the fix
        # named, the hour restarts from the fixing commit, and it pages again
        # once if the fixed file is still not installed after that hour.
        merge(42, '2026-11-12T16:20:00Z', [{'filename': R1, 'status': 'modified', 'patch': '@@ -1 +1 @@\n-BEGIN; COMMIT;\n+BEGIN; SELECT 1; COMMIT;'}])
        mock(f'{RAW}/{sha(42)}/{R1}', 'BEGIN; SELECT 1; COMMIT;\n')
        r = watch('2026-11-12 16:30:00Z')
        assert r['state'] == 'read' and r['resolved'] >= 1, r
        assert alert_status('20261112050000') == 'resolved'
        assert sql("SELECT payload->>'resolution' FROM operational_alert_events WHERE event_key = 'uninstalled:20261112050000'").startswith(
            f'fixed in place on main by {sha(42)[:8]} at Nov 12 10:20 Central')
        assert sql("SELECT modified_at = '2026-11-12 16:20:00Z' AND modified_sha = '%s' AND alert_id IS NULL "
                   "FROM smarter_private.ca_merged_migration_watch WHERE version = '20261112050000'" % sha(42)) == 't'
        FIXKEY = f'20261112050000@{sha(42)[:12]}'
        watch('2026-11-12 17:19:00Z')
        assert alert_status('20261112050000') == 'resolved' and alert_status(FIXKEY) == ''
        watch('2026-11-12 17:20:00Z')
        assert alert_status(FIXKEY) == 'firing' and alert_status('20261112050000') == 'resolved'
        assert 'fixed in place at Nov 12 10:20 Central' in summary(FIXKEY), summary(FIXKEY)
        assert pages() >= 1 and int(sql(f"SELECT count(*) FROM operational_alert_events WHERE event_key = 'uninstalled:{FIXKEY}' AND investigation_status = 'new'")) == 1
        watch('2026-11-12 17:30:00Z')
        assert int(sql("SELECT count(*) FROM operational_alert_events WHERE event_key LIKE 'uninstalled:20261112050000%' AND status = 'firing'")) == 1
        ok('a fix in place resolves the outdated page, restarts the hour, and pages again once, under its own key, if still not installed')

        # Installing the fixed file resolves the second page too.
        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261112050000', 'refused_before_the_freeze')")
        watch('2026-11-12 17:40:00Z')
        assert alert_status(FIXKEY) == 'resolved'
        sql("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261112050000'")
        ok('installing the fixed file resolves its page')

        # THREE-HOURLY O3 DEFERRAL (20261123000830, incident ba9d1133, alerts
        # 447640/447641). Optimization O3 defers ordinary merges inside
        # [cycleStart - 90m, cycleStart + 10m) Central until cycleStart + 10m.
        if os.environ.get('MIGWATCH_PRE_O3') != '1':
            for attempt in (1, 2):
                r = psql(['-f', str(O3_FIX)])
                assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', O3_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'o3-fix live proof must hold after install'
            ok('the three-hourly O3 fix amends the anchor once, installs twice idempotently and its live proof holds')

        # Exact incident ba9d1133 scenario: merged at 15:35 CST (21:35:11Z),
        # inside the 16:00 CST O3 deferral [14:30, 16:10) CST. Must stay quiet
        # at 16:40 CST (22:40Z, the old false page) and 17:09 CST (23:09Z), and
        # page at 17:10 CST (23:10Z = 16:10 + 60m).
        O3A = 'supabase/migrations/20261122192807_merged_inside_o3_deferral.sql'
        merge(43, '2026-11-22T21:35:11Z', [{'filename': O3A, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-22 21:40:00Z')
        watch('2026-11-22 22:40:00Z')                                   # 16:40 CST: old false page
        watch('2026-11-22 23:09:00Z')                                   # 17:09 CST: 59m after 16:10 clear
        assert alert_status('20261122192807') == '', 'an O3-deferred file must not page before cycle clear + 60m'
        watch('2026-11-22 23:10:00Z')                                   # 17:10 CST: 60m after 16:10 clear
        assert alert_status('20261122192807') == 'firing'
        assert 'Dispatch Apply Merged Migration for it' in summary('20261122192807')
        ok('a file merged inside a three-hourly O3 deferral window pages one hour after cycle+10m, never at merge+60')

        # Merged at 14:00 CST (20:00Z, before 16:00 O3 deferral) and refused:
        # its 60m page fires at 15:00 CST (21:00Z), INSIDE the 16:00 O3 window,
        # so the page must say do NOT hand-dispatch (never "dispatch it").
        O3R = 'supabase/migrations/20261122200000_refused_before_o3_window.sql'
        merge(44, '2026-11-22T20:00:00Z', [{'filename': O3R, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-22 20:10:00Z')
        watch('2026-11-22 21:00:00Z')                                   # 15:00 CST: inside [14:30, 16:10)
        assert alert_status('20261122200000') == 'firing'
        assert 'do NOT hand-dispatch' in summary('20261122200000'), summary('20261122200000')
        assert '16:10 Central' in summary('20261122200000'), summary('20261122200000')
        assert 'Dispatch Apply Merged Migration for it' not in summary('20261122200000')
        ok('a page raised inside a three-hourly O3 deferral window warns do NOT hand-dispatch')

        # Merged at 23:30 CST (05:30Z): 01:00 O3 deferral clears at 01:10 CST,
        # which is inside the 23:45-04:15 nightly freeze, so due_at chains to
        # 04:15 + 60m = 05:15 CST (11:15Z).
        O3F = 'supabase/migrations/20261123053000_o3_handoff_to_nightly_freeze.sql'
        merge(45, '2026-11-23T05:30:00Z', [{'filename': O3F, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-23 05:40:00Z')
        watch('2026-11-23 08:20:00Z')                                   # 02:20 CST (past 01:10 + 60m, still in freeze)
        watch('2026-11-23 11:14:00Z')                                   # 05:14 CST
        assert alert_status('20261123053000') == '', '23:30 CST O3 deferral meeting nightly freeze must hold to 04:15 + 60m'
        watch('2026-11-23 11:15:00Z')                                   # 05:15 CST
        assert alert_status('20261123053000') == 'firing'
        ok('23:30 CST O3 deferral chains cleanly into the 23:45-04:15 nightly freeze')

        # ── 20261123151024: held row superseded then deleted from schema_migrations ──
        # Reproduces the 20261123002808 CutoverReadinessAtRisk incident:
        #   1) file merged while temporarily held in schema_migrations -> installed_seen_at stamped
        #   2) file modified on main with SUPERSEDED BY -> patch matches c_superseded -> superseded_by recorded
        #   3) another file held in schema_migrations, hold row deleted without seeing modify ->
        #      vanished-hold check clears installed_seen_at and re-reads raw file from main.
        sql("""CREATE TABLE IF NOT EXISTS public.ca_drift_incidents (id uuid PRIMARY KEY, status text);
CREATE FUNCTION public.fn_ca_closed_arena_finding_is_intended()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION smarter_private.reliability_runbook_cutover_diagnosis(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $stub$
DECLARE v_history text := 'supabase_migrations.schema_migrations'; v_version text; v_installed boolean; v_missing text[] := '{}';
BEGIN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM ' || v_history || ' m WHERE m.version = $1)'
         INTO v_installed USING v_version;
      IF NOT v_installed THEN
        v_missing := v_missing || v_version;
      END IF;
  RETURN '{}'::jsonb;
END $stub$;""")
        assert sql("SELECT has_function_privilege('anon', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE')") == 't'
        for _ in range(2):
            r = psql(['-f', str(HELD_SUPERSEDED_FIX)])
            assert r.returncode == 0, f'held-superseded fix failed:\n{r.stderr}'
        proof_hs = re.search(r'^-- @live-proof: (.+)$', HELD_SUPERSEDED_FIX.read_text(), re.M).group(1)
        assert sql(f'SELECT {proof_hs}') == 't', 'held-superseded live proof must hold'
        assert sql("SELECT has_function_privilege('anon', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE')") == 'f'
        assert sql("SELECT has_function_privilege('authenticated', 'public.fn_ca_closed_arena_finding_is_intended()', 'EXECUTE')") == 'f'
        ok('20261123151024 amends install watch idempotently and revokes closed-arena trigger from anon/authenticated')

        # Case A: file temporarily held in schema_migrations, then modified with SUPERSEDED BY.
        HELD1 = 'supabase/migrations/20261123002808_held_then_superseded.sql'
        REP1 = 'supabase/migrations/20261123024924_replacement_for_held.sql'
        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261123002808', 'held_then_superseded')")
        merge(46, '2026-11-23T02:43:46Z', [{'filename': HELD1, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-23 02:50:00Z')
        assert sql("SELECT installed_seen_at IS NOT NULL FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123002808'") == 't'
        merge(47, '2026-11-23T03:29:29Z', [
            {'filename': REP1, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'},
            {'filename': HELD1, 'status': 'modified', 'patch': '@@ -1,1 +1,2 @@\n+' + MARK + '20261123024924\n BEGIN; COMMIT;'}])
        mock(f'{RAW}/{sha(47)}/{HELD1}', MARK + '20261123024924\nBEGIN; COMMIT;\n')
        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261123024924', 'replacement_for_held')")
        watch('2026-11-23 03:40:00Z')
        assert sql("SELECT superseded_by FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123002808'") == '20261123024924'
        sql("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261123002808'")
        watch('2026-11-23 09:00:00Z')
        assert alert_status('20261123002808') == ''
        ok('a held migration modified with SUPERSEDED BY is read immediately even while held in schema_migrations')

        # Case B: a held row vanished from schema_migrations with superseded_by still NULL
        # is self-healed by re-reading its raw file at the newest read commit on main.
        HELD2 = 'supabase/migrations/20261123009999_vanished_hold.sql'
        sql("INSERT INTO supabase_migrations.schema_migrations(version, name) VALUES ('20261123009999', 'vanished_hold')")
        merge(48, '2026-11-23T12:00:00Z', [{'filename': HELD2, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-23 12:10:00Z')
        assert sql("SELECT installed_seen_at IS NOT NULL FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123009999'") == 't'
        sql("DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261123009999'")
        mock(f'{RAW}/{sha(48)}/{HELD2}', MARK + '20261123024924\nBEGIN; COMMIT;\n')
        watch('2026-11-23 12:20:00Z')
        assert sql("SELECT superseded_by FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123009999'") == '20261123024924'
        assert sql("SELECT installed_seen_at IS NULL FROM smarter_private.ca_merged_migration_watch WHERE version = '20261123009999'") == 't'
        assert alert_status('20261123009999') == ''
        ok('a vanished schema_migrations hold row clears installed_seen_at and reads SUPERSEDED BY from main')

        # THE 150 MINUTE DEFERRAL (O21, 2026-11-24). The dispatcher is to hold
        # ordinary merges inside [cycleStart - 150m, cycleStart + 10m), so they
        # install only in the 20 minutes after a cycle clears. The watch's
        # helper moves first: with it installed, a file merged in
        # [cycleStart - 150m, cycleStart - 90m) is never paged before the
        # dispatcher may send it. MIGWATCH_PRE_O21=1 leaves the helper at 90
        # minutes, and the first scenario then fails with the false page.
        if os.environ.get('MIGWATCH_PRE_O21') != '1':
            pre_acl = sql("SELECT COALESCE(proacl::text, '<default>') || ' ' || proowner::regrole::text FROM pg_proc "
                          "WHERE oid = 'smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)'::regprocedure")
            assert sql("SELECT md5(pg_get_functiondef('smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)'::regprocedure))") \
                == re.search(r'^-- @replaces-md5: \S+\(timestamp with time zone\)=([0-9a-f]{32})$', O21_FIX.read_text(), re.M).group(1), \
                'the O21 file must pin the helper exactly as 20261123000830 leaves it'
            for attempt in (1, 2):
                r = psql(['-f', str(O21_FIX)])
                assert r.returncode == 0, r.stderr
            proof = re.search(r'^-- @live-proof: (.+)$', O21_FIX.read_text(), re.M).group(1)
            assert sql(f'SELECT {proof}') == 't', 'o21 live proof must hold after install'
            assert sql("SELECT COALESCE(proacl::text, '<default>') || ' ' || proowner::regrole::text FROM pg_proc "
                       "WHERE oid = 'smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)'::regprocedure") == pre_acl
            # A helper that is neither the pinned body nor this file's own result is refused, and nothing changes.
            sql("ALTER FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(timestamptz) RENAME TO ca_three_hourly_deferral_clears_at_o21_kept")
            sql("CREATE FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(p_at timestamptz) RETURNS timestamptz "
                "LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $f$ SELECT NULL::timestamptz $f$")
            r = psql(['-f', str(O21_FIX)])
            assert r.returncode != 0 and 'THREE_HOURLY_DEFERRAL_150_PREIMAGE_DRIFT' in r.stderr, r.stderr
            assert sql("SELECT smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 21:35:11+00') IS NULL") == 't'
            sql("DROP FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)")
            sql("ALTER FUNCTION smarter_private.ca_three_hourly_deferral_clears_at_o21_kept(timestamptz) RENAME TO ca_three_hourly_deferral_clears_at")
            assert sql(f'SELECT {proof}') == 't'
            ok('the 150 minute helper installs twice idempotently, keeps its grants and owner, holds its live proof and refuses a drifted helper')

        # Merged at 14:00 CST (20:00Z), 120 minutes before the 16:00 cycle:
        # inside [13:30, 16:10) now, outside the old [14:30, 16:10). Quiet at
        # 15:00 CST (merge + 60, the page the 90 minute helper raised) and at
        # 17:09 CST; pages at 17:10 CST (16:10 + 60m). 17:10 is inside the
        # 19:00 cycle's deferral [16:30, 19:10), so the page says do NOT
        # hand-dispatch and names 19:10 Central.
        O21A = 'supabase/migrations/20261125200000_merged_120_minutes_before_a_cycle.sql'
        # 20261112050000 above was recorded installed and then removed from the
        # ledger, so since 20261123151024 the watch reads its raw file again at
        # each newest commit; unanswered, that read leaves the run 'unknown'
        # and nothing new is raised. Answer it for the commits below.
        mock(f'{RAW}/%/{R1}', 'BEGIN; COMMIT;\n')
        merge(49, '2026-11-25T20:00:00Z', [{'filename': O21A, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-25 20:10:00Z')
        watch('2026-11-25 21:00:00Z')                                   # 15:00 CST: merge + 60m
        assert alert_status('20261125200000') == '', 'a file held by the 150 minute deferral must not page at merge + 60m'
        watch('2026-11-25 23:09:00Z')                                   # 17:09 CST
        assert alert_status('20261125200000') == ''
        watch('2026-11-25 23:10:00Z')                                   # 17:10 CST
        assert alert_status('20261125200000') == 'firing'
        assert 'do NOT hand-dispatch' in summary('20261125200000'), summary('20261125200000')
        assert '19:10 Central' in summary('20261125200000'), summary('20261125200000')
        assert 'Dispatch Apply Merged Migration for it' not in summary('20261125200000')
        ok('a file merged 120 minutes before a cycle pages one hour after cycle+10m, never at merge+60')

        # Merged at 13:15 CST (19:15Z 2026-11-26), inside the 13:10-13:30
        # install window: the dispatcher sends it at once, so its hour runs
        # from the merge. It pages at 14:15 CST, inside [13:30, 16:10).
        O21B = 'supabase/migrations/20261126191500_merged_in_the_install_window.sql'
        merge(50, '2026-11-26T19:15:00Z', [{'filename': O21B, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-26 19:20:00Z')
        watch('2026-11-26 20:14:00Z')
        assert alert_status('20261126191500') == ''
        watch('2026-11-26 20:15:00Z')
        assert alert_status('20261126191500') == 'firing', 'a file merged in the install window keeps the plain 60 minute hour'
        assert '16:10 Central' in summary('20261126191500'), summary('20261126191500')
        ok('a file merged in the 20 minute install window pages at merge+60, as before')

        # Merged at 22:30 CST (04:30Z 2026-11-27) = 01:00 - 150m: released at
        # 01:10 CST, inside the nightly freeze, so the hour starts at 04:15.
        # Quiet at 23:30 CST (merge + 60) and 05:14 CST; pages at 05:15 CST,
        # inside the 07:00 cycle's deferral [04:30, 07:10).
        O21C = 'supabase/migrations/20261127043000_merged_at_2230_central.sql'
        merge(51, '2026-11-27T04:30:00Z', [{'filename': O21C, 'status': 'added', 'patch': '@@ -0,0 +1,1 @@\n+BEGIN; COMMIT;'}])
        watch('2026-11-27 04:40:00Z')
        watch('2026-11-27 05:30:00Z')                                   # 23:30 CST: merge + 60m
        assert alert_status('20261127043000') == '', 'a 22:30 Central merge must not page at merge + 60m'
        watch('2026-11-27 11:14:00Z')                                   # 05:14 CST
        assert alert_status('20261127043000') == ''
        watch('2026-11-27 11:15:00Z')                                   # 05:15 CST
        assert alert_status('20261127043000') == 'firing'
        assert '07:10 Central' in summary('20261127043000'), summary('20261127043000')
        ok('a 22:30 Central merge is held through the nightly freeze to 04:15 + 60m')

        # Release and migration pages keep their own episode clocks.
        sql("SELECT public.fn_record_operational_alert('engine-cutover-watch', 'missed:2026-11-10', 'EngineCutoverMissed', 'firing', 'critical', "
            "jsonb_build_object('summary', 'The 4 AM engine update did not happen.'))")
        assert pages('Engine Update Missed At 4 AM') == 1
        ok('a migration page does not hold back an engine release page')

        assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations") == '3'  # 3 inserted by this test (20261123024924 added)
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
