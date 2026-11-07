#!/usr/bin/env python3
"""Private PostgreSQL proof of what arming zzzz_freeze_finalized_tournament_prize_pool
would and would not refuse.

The trigger on public.tournaments has been tgenabled='D' since 2026-09-08: it
was created by 20260908042400 and disabled in the same migration, and the
second stage that arms it has never run. The hold was recorded on the reading
that "the satellite-seat overlay writes the prize pool at lock, and the
function has no door for that". This proof installs production's guard body
BYTE-EXACT (md5(prosrc)=830423022877226ecdb6f417ae001ec1, read 2026-11-07),
attaches it with production's EXACT column list, arms it, and runs the real
statement shapes. It establishes:

  * the lock write is INVISIBLE to the trigger. The statement
    fn_complete_tournament_launch_before_lease_generation issues names only
    status and started_at; fn_ca_fund_overlay_on_lock assigns NEW.prize_pool
    from a BEFORE UPDATE OF status trigger on that statement; and a
    BEFORE UPDATE OF <cols> trigger fires on the columns the STATEMENT names.
    So no door is needed for the overlay at lock, and the recorded reason for
    the hold does not hold;

  * the same overlay IS refused when the statement names a guarded column, so
    the finding above is a fact about the column list and not a dead trigger;

  * the four original refusals (reopening finalization, payout_structure,
    spin_multiplier, guaranteed_prize) and the pool itself still refuse;

  * two OTHER real write paths are refused, and they are the actual blockers:
    the cancel/abort/retire statement that zeroes a finalized pool (production
    did it to 130 funded finalized events on 2026-11-05 and 2 on 2026-09-27),
    and an owner-approved guarantee overlay paid into an already-finalized
    pool (Morning Free Buy (NLH) 930eee14, 2026-11-05 20:15:01 UTC, pool
    0 -> 250, ledger leg 1b10c373, entry closed 15:30:00);

  * the satellite-settlement door installed by 20261102052012 still admits its
    one provable debit and still refuses the wrong state, a hitchhiking second
    column, an unannounced debit and a replay.

No production row is read or written.
"""
from pathlib import Path
import os
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'tests/sql/finalized-pool-freeze-arming-fixture.sql'
CHECK = ROOT / 'tests/sql/finalized-pool-freeze-arming-check.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
parent = os.environ.get('TMPDIR') or os.environ.get('RUNNER_TEMP')
if not parent:
    raise SystemExit('Set TMPDIR to owned scratch (RUNNER_TEMP in CI)')
work = Path(tempfile.mkdtemp(prefix='freeze-arming-', dir=parent))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', parent)))
port = None
tcp_guard = socket.socket()
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True,
                       capture_output=True, timeout=timeout)
    if r.returncode:
        log = work / 'postgres.log'
        raise RuntimeError(r.stderr + '\n' + (log.read_text() if log.exists() else ''))
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock,
                '-p', port, '-U', 'postgres', '-d', 'w'], sql)


try:
    # Every client uses our own Unix socket; the TCP port is held occupied so
    # an unnecessary TCP listener would fail here.
    tcp_guard.bind(('127.0.0.1', 0))
    port = str(tcp_guard.getsockname()[1])
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust',
         '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log',
         '-o', f"-k {sock} -p {port} -c listen_addresses=''", '-w', 'start'])
    started = True
    run([PG / 'psql', '-X', '-qAt', '-h', sock, '-p', port, '-U', 'postgres',
         '-d', 'postgres'], 'CREATE DATABASE w;')
    q(FIXTURE.read_text())
    out = q(CHECK.read_text()).strip()
    if not out.startswith('PASS'):
        raise SystemExit('the proof did not report PASS: %r' % out)
    print(out)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', 'stop'])
    tcp_guard.close()
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
