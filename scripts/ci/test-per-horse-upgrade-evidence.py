#!/usr/bin/env python3
"""Native proof for 20261114002055_per_horse_upgrade_evidence_daily.

Runs the exact migration file against a throwaway PostgreSQL 17 cluster (never
production) and proves the writer: the function does not exist before the
migration, a batch is added, a second batch is added on top (additive upsert),
an identical resend is answered 'replayed' and adds nothing, a different
payload under the same batch id is refused, oversize, malformed, expired,
out-of-window and invalid-row payloads are refused with their own reasons and
write nothing, old receipts and daily rows older than 90 days are pruned
inside the writer in bounded steps, the daily table carries its fillfactor,
and only service_role may call it.
"""
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261114002055_per_horse_upgrade_evidence_daily.sql'

H1 = '11111111-1111-4111-8111-111111111111'
H2 = '22222222-2222-4222-8222-222222222222'
WORKER = '99999999-9999-4999-8999-999999999999'
PROOFS = 0


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL 17) is required')
    return found


def stamp(moment):
    return moment.strftime('%Y-%m-%dT%H:%M:%S.') + f'{moment.microsecond // 1000:03d}Z'


def row(horse=H1, variant='nlh', lane='cash', upgrade='upgrade_02_card_removal_blockers', decisions=10, invoked=4):
    return {'horseUserId': horse, 'gameVariant': variant, 'lane': lane, 'upgradeId': upgrade,
            'decisions': decisions, 'invoked': invoked}


def payload(rows, moment=None, sequence=1, batch=None, **override):
    moment = moment or datetime.now(timezone.utc)
    body = {'version': 1, 'batchId': batch or str(uuid.uuid4()), 'workerId': WORKER, 'sequence': sequence,
            'sourceRelease': 'c' * 40, 'day': moment.strftime('%Y-%m-%d'), 'collectedAt': stamp(moment),
            'rows': rows}
    body.update(override)
    return json.dumps(body, separators=(',', ':'))


def main():
    global PROOFS
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    os.environ['PGTZ'] = 'UTC'
    scratch = Path(tempfile.mkdtemp(prefix='horse-upgrade-evidence-',
                                    dir=os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir=os.environ.get('PG_SOCKET_ROOT') or scratch))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
    port = str(55000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses='' -c timezone=UTC",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    try:
        def run(text, role=None):
            if role:
                text = f'SET ROLE {role}; {text}'
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                                  input=text, capture_output=True, text=True)

        def sql(text, role=None):
            r = run(text, role)
            assert r.returncode == 0, f'{text[:400]}\n{r.stderr}'
            return r.stdout.strip()

        def flush(text, role='service_role'):
            # dollar-quoted with a tag no payload contains, so the bytes reach the function exactly as written
            return run(f"SELECT public.fn_horse_upgrade_evidence_flush($payload${text}$payload$);", role)

        def accepted(text, status):
            r = flush(text)
            assert r.returncode == 0, r.stderr
            ack = json.loads(r.stdout.strip())
            assert ack == {'version': 1, 'status': status, 'batchId': json.loads(text)['batchId'],
                           'payloadSha256': hashlib.sha256(text.encode()).hexdigest()}, ack

        def refused(text, reason, role='service_role'):
            before = totals()
            r = flush(text, role)
            assert r.returncode != 0 and reason in r.stderr, f'expected {reason}: {r.stdout} {r.stderr}'
            assert totals() == before, f'{reason} wrote something'

        def totals():
            return sql("SELECT coalesce(sum(decisions),0) || '/' || coalesce(sum(invoked),0) || '/' || count(*) || '/' || "
                       "(SELECT count(*) FROM public.horse_upgrade_evidence_batches) FROM public.horse_upgrade_evidence_daily")

        def cell(horse, variant, lane, upgrade):
            return sql(f"SELECT decisions || '/' || invoked FROM public.horse_upgrade_evidence_daily WHERE horse_user_id='{horse}' "
                       f"AND game_variant='{variant}' AND lane='{lane}' AND upgrade_id='{upgrade}'")

        def proven():
            global PROOFS
            PROOFS += 1

        sql('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;')

        # FAIL BEFORE: the writer does not exist until the migration is applied.
        before = flush(payload([row()]))
        assert before.returncode != 0 and 'does not exist' in before.stderr, before.stderr
        proven()

        applied = subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres', '-X', '-q',
                                  '-v', 'ON_ERROR_STOP=1', '-f', str(MIGRATION)], capture_output=True, text=True)
        assert applied.returncode == 0, applied.stderr
        proven()

        # 1. recorded, with the stated acknowledgement and the rows as sent
        now = datetime.now(timezone.utc)
        first = payload([row(), row(upgrade='upgrade_01_range_posteriors', invoked=10),
                         row(horse=H2, variant='plo5', lane='tournament', upgrade='upgrade_07_tournament_cover_and_bounty',
                             decisions=3, invoked=0)], now)
        accepted(first, 'recorded')
        assert cell(H1, 'nlh', 'cash', 'upgrade_02_card_removal_blockers') == '10/4'
        assert cell(H2, 'plo5', 'tournament', 'upgrade_07_tournament_cover_and_bounty') == '3/0'
        assert sql("SELECT DISTINCT day FROM public.horse_upgrade_evidence_daily") == now.strftime('%Y-%m-%d')
        proven()

        # 2. additive upsert: a second batch for the same cell adds to it
        accepted(payload([row(decisions=5, invoked=5)], now, sequence=2), 'recorded')
        assert cell(H1, 'nlh', 'cash', 'upgrade_02_card_removal_blockers') == '15/9'
        assert totals() == '28/19/3/2'
        proven()

        # 3. an identical resend is a replay: same acknowledgement shape, nothing added
        accepted(first, 'replayed')
        assert totals() == '28/19/3/2'
        proven()

        # 4. a different payload under the same batch id is refused
        refused(payload([row(decisions=99, invoked=1)], now, batch=json.loads(first)['batchId']),
                'HORSE_UPGRADE_EVIDENCE_BATCH_COLLISION')
        proven()

        # 5. size and shape refusals, each by its own reason, none writing anything
        refused('x' * 524289, 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD')
        refused('{not json', 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD')
        big = payload([row(horse=str(uuid.UUID(int=i)), upgrade='u' * 64, variant='v' * 32) for i in range(4096)], now)
        assert len(big) > 524288
        refused(big, 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD')
        refused(payload([row()], now, version=2), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([row()], now, batch='not-a-uuid'), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([row()], now, sequence=0), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([row()], now, sourceRelease='main'), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([row()], now, day='2026-13-45'), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([row()], now, extra=1), 'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER')
        refused(payload([], now), 'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS')
        # A row is at least 129 bytes (the uuid alone is 36), so 4,097 rows are always above the byte bound: the
        # bytes bind first and the row bound is a second fence behind them.
        short = [row(horse=str(uuid.UUID(int=i)), variant='v', upgrade='u', decisions=1, invoked=0) for i in range(4097)]
        assert len(payload(short, now)) > 524288
        refused(payload(short, now), 'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD')
        proven()

        # 6. the day window: yesterday's cells are accepted under their own day; a later day, an old day, a batch
        #    stamped ahead of the clock and an expired batch are refused
        yesterday = (now - timedelta(days=1)).strftime('%Y-%m-%d')
        accepted(payload([row(horse=H2, decisions=2, invoked=1)], now, day=yesterday), 'recorded')
        assert sql(f"SELECT decisions || '/' || invoked FROM public.horse_upgrade_evidence_daily WHERE day='{yesterday}'") == '2/1'
        refused(payload([row()], now, day=(now + timedelta(days=1)).strftime('%Y-%m-%d')), 'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS')
        refused(payload([row()], now, day=(now - timedelta(days=8)).strftime('%Y-%m-%d')), 'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS')
        refused(payload([row()], now + timedelta(days=2)), 'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS')
        refused(payload([row()], now - timedelta(days=33)), 'HORSE_UPGRADE_EVIDENCE_EXPIRED')
        proven()

        # 7. every row is validated; one bad row refuses the whole batch
        good = row(horse=H2)
        for bad in (
            row(horse='not-a-uuid'), row(lane='spin'), row(variant='NLH'), row(upgrade='Upgrade 02'),
            row(upgrade='u' * 65), row(decisions=-1), row(decisions=1.5), row(invoked=-1), row(invoked=11),
            row(decisions='10'), {**row(), 'extra': 1}, {k: v for k, v in row().items() if k != 'lane'}, 'row', None,
        ):
            refused(payload([good, bad], now), 'HORSE_UPGRADE_EVIDENCE_INVALID_ROW')
        refused(payload([row(), row(decisions=1, invoked=0)], now), 'HORSE_UPGRADE_EVIDENCE_DUPLICATE_ROW')
        proven()

        # 8. receipts are bounded inside the writer: one older than 40 days is pruned by the next accepted batch,
        #    and its batch can no longer be resent (expired) so pruning never makes a resend additive
        stale = str(uuid.uuid4())
        sql(f"INSERT INTO public.horse_upgrade_evidence_batches VALUES ('{stale}', repeat('a', 64), now() - interval '41 days')")
        accepted(payload([row(horse=H2, variant='plo4', decisions=1, invoked=1)], now, sequence=3), 'recorded')
        assert sql(f"SELECT count(*) FROM public.horse_upgrade_evidence_batches WHERE batch_id='{stale}'") == '0'
        assert sql("SELECT count(*) FROM public.horse_upgrade_evidence_batches") == '4'
        # and a large batch just inside the byte bound is accepted whole
        large = payload(short[:4000], now, sequence=4)
        assert 500000 < len(large) <= 524288
        accepted(large, 'recorded')
        assert sql("SELECT count(*) FROM public.horse_upgrade_evidence_daily WHERE upgrade_id='u'") == '4000'
        proven()

        # 9. privileges: only service_role may call the writer; the browser roles can neither call nor read, the
        #    tables carry RLS with no policy, and service_role can read the daily table but not write either one
        for role in ('anon', 'authenticated'):
            assert sql(f"SELECT has_function_privilege('{role}', 'public.fn_horse_upgrade_evidence_flush(text)', 'EXECUTE')") == 'f'
            denied = flush(payload([row()], now), role)
            assert denied.returncode != 0 and 'permission denied' in denied.stderr, denied.stderr
            for rel in ('horse_upgrade_evidence_daily', 'horse_upgrade_evidence_batches'):
                for priv in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    assert sql(f"SELECT has_table_privilege('{role}', 'public.{rel}', '{priv}')") == 'f', (role, rel, priv)
        assert sql("SELECT has_function_privilege('service_role', 'public.fn_horse_upgrade_evidence_flush(text)', 'EXECUTE')") == 't'
        assert sql("SELECT has_table_privilege('service_role', 'public.horse_upgrade_evidence_daily', 'SELECT')") == 't'
        for rel, priv in (('horse_upgrade_evidence_daily', 'INSERT'), ('horse_upgrade_evidence_daily', 'UPDATE'),
                          ('horse_upgrade_evidence_daily', 'DELETE'), ('horse_upgrade_evidence_batches', 'SELECT'),
                          ('horse_upgrade_evidence_batches', 'INSERT')):
            assert sql(f"SELECT has_table_privilege('service_role', 'public.{rel}', '{priv}')") == 'f', (rel, priv)
        assert sql("SELECT string_agg(relname || ':' || relrowsecurity, ',' ORDER BY relname) FROM pg_class "
                   "WHERE relname IN ('horse_upgrade_evidence_daily','horse_upgrade_evidence_batches')") == \
            'horse_upgrade_evidence_batches:true,horse_upgrade_evidence_daily:true'
        assert sql("SELECT count(*) FROM pg_policies WHERE tablename LIKE 'horse_upgrade_evidence_%'") == '0'
        assert sql("SELECT prosecdef::text || ' ' || array_to_string(proconfig, ',') FROM pg_proc "
                   "WHERE proname='fn_horse_upgrade_evidence_flush'").startswith('true search_path=pg_catalog, public, pg_temp')
        proven()

        # 10. the operations read returns counts only, per upgrade, against the unretired roster
        sql("""CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean NOT NULL DEFAULT false, status text);
               CREATE TABLE public.ca_horse_fleet_register (horse_id uuid PRIMARY KEY, retired_at timestamptz);
               INSERT INTO public.profiles VALUES ('%s', true, 'active'), ('%s', true, NULL),
                 ('33333333-3333-4333-8333-333333333333', true, 'active');
               INSERT INTO public.ca_horse_fleet_register VALUES ('%s', NULL), ('%s', now() - interval '1 day'),
                 ('33333333-3333-4333-8333-333333333333', NULL);""" % (H1, H2, H1, H2))
        read = (ROOT / 'scripts/ops/per-horse-upgrade-evidence-daily.sql').read_text()
        report = run(f"\\set day '{now.strftime('%Y-%m-%d')}'\n" + read)
        assert report.returncode == 0, report.stderr
        lines = {line.split('|')[0]: line.split('|')[1:] for line in report.stdout.strip().splitlines()}
        # H2 is retired, so only H1 counts; the idle third Horse is in the fleet and in neither count
        assert lines['upgrade_02_card_removal_blockers'] == ['2', '1', '1', '15', '9'], lines
        assert lines['upgrade_01_range_posteriors'] == ['2', '1', '1', '10', '10'], lines
        assert 'upgrade_07_tournament_cover_and_bounty' not in lines, lines
        assert H1 not in report.stdout and H2 not in report.stdout
        proven()

        # 11. daily rows are kept 90 days and pruned inside the writer, oldest first, at most 512 per accepted
        #     batch: 91 days before the batch day goes, 90 and 89 days stay
        def aged(days):
            return sql(f"SELECT count(*) FROM public.horse_upgrade_evidence_daily WHERE day = '{(now - timedelta(days=days)).strftime('%Y-%m-%d')}'")
        sql("INSERT INTO public.horse_upgrade_evidence_daily (day, horse_user_id, game_variant, lane, upgrade_id, decisions, invoked) "
            "SELECT current_date - d, ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(n::text, 12, '0'))::uuid, 'nlh', 'cash', 'old', 1, 0 "
            "FROM (VALUES (91, 600), (90, 3), (89, 3)) AS v(d, rows), generate_series(1, v.rows) AS n")
        assert (aged(91), aged(90), aged(89)) == ('600', '3', '3')
        refused(payload([row(decisions=-1)], now), 'HORSE_UPGRADE_EVIDENCE_INVALID_ROW')  # a refused batch prunes nothing
        assert aged(91) == '600'
        accepted(payload([row(horse=H2, variant='plo6', decisions=1, invoked=0)], now, sequence=5), 'recorded')
        assert (aged(91), aged(90), aged(89)) == ('88', '3', '3'), (aged(91), aged(90), aged(89))
        accepted(payload([row(horse=H2, variant='plo6', decisions=1, invoked=0)], now, sequence=6), 'recorded')
        assert (aged(91), aged(90), aged(89)) == ('0', '3', '3')
        # a replay prunes nothing either (it returns before the upsert), and the newest rows are untouched
        assert cell(H1, 'nlh', 'cash', 'upgrade_02_card_removal_blockers') == '15/9'
        proven()

        # 12. the daily table keeps room for its in-place additive updates, and no updated column is indexed
        assert sql("SELECT array_to_string(reloptions, ',') FROM pg_class WHERE relname = 'horse_upgrade_evidence_daily'") == 'fillfactor=85'
        assert sql("SELECT count(*) FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                   "WHERE i.indrelid = 'public.horse_upgrade_evidence_daily'::regclass "
                   "AND a.attname IN ('decisions', 'invoked', 'updated_at')") == '0'
        sql("SELECT pg_stat_force_next_flush()")
        hot_before = sql("SELECT coalesce(n_tup_hot_upd, 0) || '/' || coalesce(n_tup_upd, 0) FROM pg_stat_user_tables WHERE relname = 'horse_upgrade_evidence_daily'")
        accepted(payload([row(horse=H2, variant='plo6', decisions=1, invoked=1)], now, sequence=7), 'recorded')
        sql("SELECT pg_stat_force_next_flush()")
        import time
        time.sleep(1.5)
        hot_after = sql("SELECT coalesce(n_tup_hot_upd, 0) || '/' || coalesce(n_tup_upd, 0) FROM pg_stat_user_tables WHERE relname = 'horse_upgrade_evidence_daily'")
        hb, ub = map(int, hot_before.split('/')); ha, ua = map(int, hot_after.split('/'))
        assert ua - ub == 1 and ha - hb == 1, f'the additive update was not HOT: {hot_before} -> {hot_after}'
        proven()

        print(f'per-Horse upgrade evidence writer: {PROOFS}/14 behaviours proven')
        assert PROOFS == 14
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(sock, ignore_errors=True)
        shutil.rmtree(scratch, ignore_errors=True)


if __name__ == '__main__':
    main()
