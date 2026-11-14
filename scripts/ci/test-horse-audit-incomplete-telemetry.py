#!/usr/bin/env python3
"""Real PG17: the daily audit reports a day with a dropped Horse telemetry batch
as incomplete telemetry (migration 20261114001636), as a note and nothing more.

No DSN or remote connection accepted. Uses a private Unix socket and synthetic
counters only. The function under test is built from the repository's own
migrations (20260904224836 for the ledger table and fn_ledger_fires,
20260906150532 for the last full definition of fn_audit_data_receipts), then
patched by the candidate migration exactly as production will be.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase/migrations'
LEDGER = MIGRATIONS / '20260904224836_horse_data_ledger.sql'
BASE_AUDIT = MIGRATIONS / '20260906150532_a_receipt_deployed_after_the_audited_day_is_not_a_dark_layer.sql'
CANDIDATE = MIGRATIONS / '20261114001636_a_day_with_a_dropped_telemetry_batch_is_reported_incomplete.sql'
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
BASE = Path(os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP') or tempfile.gettempdir())
if sys.platform == 'darwin' and not str(BASE).startswith('/Volumes/SmarterWork/agent-work/'):
    raise RuntimeError('TMPDIR must be the task-owned external SSD scratch directory')
ENV = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
ENV.update(LANG='C', LC_ALL='C')
PORT = '55513'
FUNCTION = "'public.fn_audit_data_receipts(date)'::regprocedure"
# md5(pg_get_functiondef) of the 20260906150532 definition, and of it after the candidate's patch.
PREIMAGE_MD5 = '08a0db7ad46e2aeb0604fd5547fb7622'
POSTIMAGE_MD5 = '192034126a99be608a63cc2eec0a35bf'


def extract(pattern, source, what):
    found = re.search(pattern, source, re.S)
    if not found:
        raise RuntimeError('maintained ' + what + ' is missing from its migration')
    return found.group(0)


def main():
    checks = []
    if os.geteuid() == 0:
        raise RuntimeError('Run as non-root (initdb requirement)')
    with tempfile.TemporaryDirectory(prefix='horse-audit-telemetry-', dir=BASE) as raw, \
         tempfile.TemporaryDirectory(prefix='ht-', dir=BASE.parents[1]) as sock:
        data = Path(raw) / 'data'

        def command(args, sql=None):
            return subprocess.run(list(map(str, args)), input=sql, text=True,
                                  capture_output=True, env=ENV, timeout=60)

        def run(sql, ok=True):
            r = command([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock,
                         '-p', PORT, '-U', 'postgres', '-d', 'postgres'], sql)
            if (r.returncode == 0) != ok:
                raise AssertionError(r.stderr or r.stdout)
            return r.stdout.strip() if ok else r.stderr

        def check(name, condition):
            if not condition:
                raise AssertionError(name)
            checks.append(name)

        def findings(day):
            return json.loads(run(f"SELECT fn_audit_data_receipts('{day}');"))

        def md5():
            return run(f'SELECT md5(pg_get_functiondef({FUNCTION}));')

        def shape():
            return run("SELECT json_build_array(pg_get_userbyid(proowner), prosecdef, proconfig, proacl::text, "
                       f"prorettype::regtype::text, provolatile) FROM pg_proc WHERE oid = {FUNCTION};")

        r = command([PG / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'])
        if r.returncode:
            raise RuntimeError(r.stderr)
        r = command([PG / 'pg_ctl', '-D', data, '-l', Path(raw) / 'postgres.log',
                     '-o', f'-k {sock} -p {PORT} -c listen_addresses= -c fsync=off', '-w', 'start'])
        if r.returncode:
            raise RuntimeError(r.stderr)
        try:
            run('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
            run('CREATE TABLE public.horse_brain_telemetry (day date NOT NULL, feature text NOT NULL, '
                'fires bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(), '
                'PRIMARY KEY (day, feature));')
            ledger = LEDGER.read_text()
            run(extract(r'create table if not exists public\.horse_data_ledger \(.*?\n\);', ledger, 'ledger table'))
            run(extract(r'create or replace function public\.fn_ledger_fires\(.*?\n\$\$;', ledger, 'fn_ledger_fires'))
            run(BASE_AUDIT.read_text())
            check('preimage is the 20260906150532 definition', md5() == PREIMAGE_MD5)
            before_shape = shape()

            # One ledger row, so the function gets past its empty-ledger guard. The two drop counters are receipts
            # with no ratio, exactly as HorseDataLedger.ts declares them.
            run("INSERT INTO horse_data_ledger(key, kind, source, cadence, consumer) VALUES "
                "('receipt:phase15_telemetry_batch_rejected','receipt','s','c','x'),"
                "('receipt:phase15_telemetry_batch_abandoned','receipt','s','c','x'),"
                "('receipt:phase15_telemetry_batch_expired','receipt','s','c','x');")
            run("INSERT INTO horse_brain_telemetry(day, feature, fires) VALUES "
                "('2026-11-10','decide',5000),"
                "('2026-11-11','decide',5000),('2026-11-11','phase15_telemetry_batch_rejected',2),"
                "('2026-11-12','decide',5000),('2026-11-12','phase15_telemetry_batch_abandoned',1),"
                "('2026-11-13','decide',5000),('2026-11-13','phase15_telemetry_batch_expired',4),"
                "('2026-11-14','decide',5000),('2026-11-14','phase15_telemetry_batch_rejected',3),"
                "('2026-11-14','phase15_telemetry_batch_abandoned',2),('2026-11-14','phase15_telemetry_batch_expired',1);")
            days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
            check('before the migration no day is reported incomplete', all(findings(d) == [] for d in days))

            run(CANDIDATE.read_text())
            check('exact postimage', md5() == POSTIMAGE_MD5)
            check('owner, definer, search_path, ACL, return type and volatility are kept', shape() == before_shape)
            check('definer with a pinned search_path, postgres and service_role only',
                  json.loads(before_shape)[1:4] == [True, ['search_path=public'], '{postgres=X/postgres,service_role=X/postgres}'])
            check('participant roles cannot execute it', run(
                "SELECT has_function_privilege('anon', 'fn_audit_data_receipts(date)', 'execute') OR "
                "has_function_privilege('authenticated', 'fn_audit_data_receipts(date)', 'execute');") == 'f')

            check('no drop: no finding', findings('2026-11-10') == [])
            rejected = findings('2026-11-11')
            check('rejected: exactly one finding', len(rejected) == 1)
            check('rejected: a note, never a warning or a critical',
                  [rejected[0]['severity'], rejected[0]['code'], rejected[0]['category']] == ['note', 'telemetry_incomplete', 'logic'])
            check('rejected: counts in the evidence',
                  [rejected[0]['evidence']['batches_rejected'], rejected[0]['evidence']['batches_abandoned']] == [2, 0])
            check('rejected: the title names the day, the count and the lower bound', rejected[0]['title'] ==
                  "Incomplete telemetry on 2026-11-11: 2 Horse telemetry batch(es) were dropped unwritten - the day's counters are a lower bound")
            abandoned = findings('2026-11-12')
            check('abandoned on another day: one note for that day only',
                  [len(abandoned), abandoned[0]['severity'], abandoned[0]['evidence']['batches_rejected'],
                   abandoned[0]['evidence']['batches_abandoned']] == [1, 'note', 0, 1])
            check('expired alone: no finding (the affected day is more than 32 days back, not this one)',
                  findings('2026-11-13') == [])
            both = findings('2026-11-14')
            check('rejected and abandoned together: one note with both counts, expired not added',
                  [len(both), both[0]['evidence']['batches_rejected'], both[0]['evidence']['batches_abandoned'],
                   'Incomplete telemetry on 2026-11-14: 5 Horse' in both[0]['title']] == [1, 3, 2, True])
            check('a day with no telemetry at all: no finding', findings('2026-11-20') == [])
            check('no telemetry_incomplete finding is ever above a note', all(
                f['severity'] == 'note' for d in days for f in findings(d) if f['code'] == 'telemetry_incomplete'))

            # A ratio finding on an incomplete day still appears next to the note: the note explains, it does not hide.
            run("INSERT INTO horse_data_ledger(key, kind, source, cadence, consumer, ratio_of, min_ratio) VALUES "
                "('receipt:some_layer','receipt','s','c','x','decide',0.5);"
                "INSERT INTO horse_brain_telemetry(day, feature, fires) VALUES ('2026-11-01','some_layer',4000),('2026-11-11','some_layer',10);")
            mixed = findings('2026-11-11')
            check('the note sits beside the day\'s other findings and changes none of them',
                  sorted((f['code'], f['severity']) for f in mixed) == [('data_unread', 'warn'), ('telemetry_incomplete', 'note')])
            run("DELETE FROM horse_data_ledger WHERE key = 'receipt:some_layer'; DELETE FROM horse_brain_telemetry WHERE feature = 'some_layer';")

            run('BEGIN; DELETE FROM horse_data_ledger; '
                "DO $$ BEGIN IF (fn_audit_data_receipts('2026-11-11')->0->>'code') IS DISTINCT FROM 'data_ledger_missing' "
                "OR jsonb_array_length(fn_audit_data_receipts('2026-11-11')) <> 1 THEN RAISE EXCEPTION 'empty ledger guard changed'; END IF; END $$; ROLLBACK;")
            checks.append('the empty-ledger guard still returns first and alone')

            run(CANDIDATE.read_text())
            check('second run is a no-op', md5() == POSTIMAGE_MD5 and findings('2026-11-11') == rejected)

            # A body without the anchor: the migration must fail and change nothing.
            run("CREATE OR REPLACE FUNCTION public.fn_audit_data_receipts(p_day date) RETURNS jsonb LANGUAGE plpgsql "
                "SECURITY DEFINER SET search_path TO 'public' AS $f$ begin return '[]'::jsonb; end $f$;")
            unknown = md5()
            check('a body without the anchor is refused',
                  'expected exactly one final "return v_findings;"' in run(CANDIDATE.read_text(), False))
            check('a refused migration changes nothing', md5() == unknown)
            # Two anchors: also refused.
            run("CREATE OR REPLACE FUNCTION public.fn_audit_data_receipts(p_day date) RETURNS jsonb LANGUAGE plpgsql "
                "SECURITY DEFINER SET search_path TO 'public' AS $f$\ndeclare v_findings jsonb := '[]'::jsonb;\nbegin\n"
                "  if p_day is null then\n  return v_findings;\nend if;\n  return v_findings;\nend\n$f$;")
            twice = md5()
            check('a body with two anchors is refused',
                  'expected exactly one final "return v_findings;"' in run(CANDIDATE.read_text(), False))
            check('and is left unchanged', md5() == twice)
        finally:
            command([PG / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'])

    print(json.dumps(dict(passed=True, checks=checks,
                          migration_sha256=hashlib.sha256(CANDIDATE.read_bytes()).hexdigest(),
                          production_mutations=False), indent=2))


if __name__ == '__main__':
    main()
