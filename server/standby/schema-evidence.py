#!/usr/bin/env python3
"""Capture and compare bounded, read-only Backup schema evidence."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

SIGNATURES = (
    'public.fn_ca_guarantee_funding(uuid)',
    'public.fn_ca_guarantee_house_supplements(uuid)',
    'public.fn_ca_fund_union_guarantee_promo_locked(uuid)',
    'public.fn_tournament_late_registration_open(uuid)',
    'public.fn_register_horse_for_tournament(uuid,uuid)',
    'public.fn_register_horse_for_tournament(uuid,uuid,boolean)',
    'public.fn_register_horse_for_tournament_to_target(uuid,uuid,boolean,bigint)',
    'smarter_private.weekly_payout_next_round()',
)
SCHEMA = 'club-arena-schema-evidence/v1'


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def validate(evidence, body_only=False):
    if not isinstance(evidence, dict) or evidence.get('schema') != SCHEMA:
        raise ValueError('Unsupported schema evidence')
    functions = evidence.get('functions')
    if not isinstance(functions, dict) or set(functions) != set(SIGNATURES):
        raise ValueError('Required function signatures differ')
    for value in functions.values():
        if not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value):
            raise ValueError('Invalid function definition hash')
    migrations = evidence.get('migrations')
    if migrations is None:
        if not body_only:
            raise ValueError('Installed migration evidence is missing')
    else:
        if not isinstance(migrations, list) or not migrations:
            raise ValueError('Installed migration evidence is empty')
        for row in migrations:
            if (not isinstance(row, list) or len(row) != 2
                    or not isinstance(row[0], str) or not row[0] or len(row[0]) > 200
                    or (row[1] is not None and not isinstance(row[1], str))):
                raise ValueError('Malformed installed migration evidence')
        if len({row[0] for row in migrations}) != len(migrations) or migrations != sorted(migrations):
            raise ValueError('Installed migration evidence is not canonical')
    dump = evidence.get('dumpSha256')
    if dump is not None and (not isinstance(dump, str) or not re.fullmatch('[0-9a-f]{64}', dump)):
        raise ValueError('Invalid dump hash')
    return evidence


def capture(container=None, body_only=False):
    signatures = ','.join("'" + signature + "'" for signature in SIGNATURES)
    migrations = 'NULL' if body_only else "(SELECT json_agg(json_build_array(version,name) ORDER BY version,name) FROM supabase_migrations.schema_migrations)"
    sql = f"""SELECT json_build_object('migrations', {migrations}, 'functions',
      (SELECT json_object_agg(signature, pg_get_functiondef(to_regprocedure(signature)))
       FROM unnest(ARRAY[{signatures}]) AS signatures(signature)));"""
    options = '-c default_transaction_read_only=on -c statement_timeout=15000 -c lock_timeout=2000'
    command = ['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1']
    environment = dict(os.environ, PGOPTIONS=options, PGCONNECT_TIMEOUT='15')
    if container:
        if container != 'supabase_db_standby':
            raise ValueError('Only the isolated standby database container is supported')
        command = ['docker', 'exec', '-i', '-e', 'PGOPTIONS=' + options, container,
                   *command, '-U', 'supabase_admin', '-d', 'postgres']
    elif os.environ.get('DATABASE_URL'):
        # psql expands a URI only through its explicit dbname argument.
        # Provider diagnostics are suppressed below so they cannot expose it.
        command.extend(['--dbname', os.environ['DATABASE_URL']])
    try:
        result = subprocess.run(command, input=sql, text=True, capture_output=True,
                                env=environment, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Schema evidence query could not complete') from None
    if result.returncode:
        raise ValueError('Schema evidence query failed')
    try:
        rows = json.loads(result.stdout)
        definitions = rows['functions']
        if set(definitions) != set(SIGNATURES) or any(
                not isinstance(body, str) or not body for body in definitions.values()):
            raise ValueError('Required function definition is missing')
        evidence = {'schema': SCHEMA, 'capturedAt': datetime.now(timezone.utc).isoformat(),
                    'migrations': sorted(rows['migrations']) if rows['migrations'] is not None else None,
                    'functions': {signature: hashlib.sha256(body.encode()).hexdigest()
                                  for signature, body in definitions.items()}}
        return validate(evidence, body_only)
    except (KeyError, TypeError, json.JSONDecodeError):
        raise ValueError('Malformed schema query result') from None


def compare(expected, actual, body_only=False, dump=None):
    validate(expected, body_only)
    validate(actual, body_only)
    if expected['functions'] != actual['functions']:
        raise ValueError('Function definitions changed')
    if not body_only and expected['migrations'] != actual['migrations']:
        raise ValueError('Installed migration set changed')
    if (expected.get('dumpSha256') is not None and actual.get('dumpSha256') is not None
            and expected['dumpSha256'] != actual['dumpSha256']):
        raise ValueError('Evidence dump bindings differ')
    if dump and expected.get('dumpSha256') != digest_file(dump):
        raise ValueError('Dump does not match schema evidence')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    take = commands.add_parser('capture')
    take.add_argument('--container')
    take.add_argument('--body-only', action='store_true')
    take.add_argument('--dump')
    take.add_argument('--output', required=True)
    check = commands.add_parser('compare')
    check.add_argument('expected')
    check.add_argument('actual')
    check.add_argument('--body-only', action='store_true')
    check.add_argument('--dump')
    verify = commands.add_parser('verify-dump')
    verify.add_argument('evidence')
    verify.add_argument('dump')
    args = parser.parse_args()
    try:
        if args.command == 'verify-dump':
            evidence = validate(json.loads(Path(args.evidence).read_text()))
            if evidence.get('dumpSha256') != digest_file(args.dump):
                raise ValueError('Dump does not match schema evidence')
            print('Dump matches schema evidence')
            return
        if args.command == 'compare':
            compare(json.loads(Path(args.expected).read_text()),
                    json.loads(Path(args.actual).read_text()), args.body_only, args.dump)
            print('Schema evidence matches')
            return
        evidence = capture(args.container, args.body_only)
        if args.dump:
            digest = digest_file(args.dump)
            if evidence.get('dumpSha256') not in (None, digest):
                raise ValueError('Evidence is already bound to a different dump')
            evidence['dumpSha256'] = digest
        with open(args.output, 'x') as output:
            json.dump(evidence, output, sort_keys=True, indent=2)
            output.write('\n')
    except (ValueError, OSError):
        # Neither provider diagnostics nor function bodies belong in logs.
        print('Schema evidence refused; capture, signatures, migration set or dump binding invalid', file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
