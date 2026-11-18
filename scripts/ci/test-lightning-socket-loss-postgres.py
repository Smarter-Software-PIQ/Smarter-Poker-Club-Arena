#!/usr/bin/env python3
"""Six connection-loss regressions using owned PG17 and real engine sessions.

The subprocess must survive without an uncaughtException handler. This fixture
proves aborted/no-effect reconciliation, not committed-but-reply-lost outcomes.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
PROBE = ROOT / 'server/qualification/lightning-socket-loss/probe.ts'


def run(command, **kwargs):
    return subprocess.run([str(arg) for arg in command], check=True, timeout=90, **kwargs)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--kind', choices=('lane', 'fold'))
parser.add_argument('--mode', choices=('commit', 'idle', 'inflight'))
args = parser.parse_args()

# Use the caller's external TMPDIR on Mac; CI supplies runner.temp. A short
# socket child avoids Darwin's 104-byte Unix socket limit. TCP is disabled.
assert '17.' in subprocess.check_output([str(PG / 'postgres'), '--version'], text=True)
with tempfile.TemporaryDirectory(prefix='ll-') as directory:
    task = Path(directory)
    data, socket = task / 'd', task / 's'
    socket.mkdir()
    assert len(str(socket).encode()) < 85, 'Set TMPDIR to a shorter task-owned external directory'
    run([PG / 'initdb', '-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale'], stdout=subprocess.DEVNULL)
    started = False
    try:
        run([PG / 'pg_ctl', '-D', data, '-l', task / 'postgres.log', '-o',
             f"-F -k {socket} -c listen_addresses=''", '-w', 'start'], stdout=subprocess.DEVNULL)
        started = True
        run([PG / 'psql', '-X', '-h', socket, '-p', '5432', '-U', 'postgres', '-d', 'postgres',
             '-v', 'ON_ERROR_STOP=1', '-f', PROBE.with_name('fixture.sql')], stdout=subprocess.DEVNULL)
        for kind in ((args.kind,) if args.kind else ('lane', 'fold')):
            for mode in ((args.mode,) if args.mode else ('commit', 'idle', 'inflight')):
                run(['node', '--import', 'tsx', PROBE, kind, mode], cwd=ROOT / 'server',
                    env={**os.environ, 'LIGHTNING_FIXTURE_SOCKET': str(socket),
                         'SUPABASE_URL': 'https://supabase.invalid',
                         'SUPABASE_SERVICE_ROLE_KEY': 'fixture-placeholder-key'})
    finally:
        if started:
            run([PG / 'pg_ctl', '-D', data, '-m', 'immediate', '-w', 'stop'], stdout=subprocess.DEVNULL)
