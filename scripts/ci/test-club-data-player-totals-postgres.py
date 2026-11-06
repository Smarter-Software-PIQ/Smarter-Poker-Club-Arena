#!/usr/bin/env python3
"""Private native qualification for union/MTT Club Data correction. No production access."""
import os
import shutil
import socket
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/club-data-fact-db/fixture.sql"
PG = Path(os.environ.get("PG_BIN") or next((p for p in ("/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin",
                                                        "/opt/homebrew/opt/postgresql@17/bin")
                                            if (Path(p) / "initdb").exists()), "/usr/lib/postgresql/17/bin"))
ENV = {"PATH": f"{PG}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "PGTZ": "UTC"}

cluster = Path(tempfile.mkdtemp(prefix="club-data-player-totals-", dir=os.environ.get("TMPDIR")))
data = cluster / "data"
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]
started = False


def psql(db, user="postgres"):
    return [str(PG / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", str(PORT), "-U", user, "-d", db]


def run(argv, text=None, expect_fail=None):
    p = subprocess.run(argv, input=text, capture_output=True, text=True, env=ENV, timeout=300)
    if expect_fail is not None:
        if p.returncode == 0 or expect_fail not in p.stderr:
            raise AssertionError(f"expected failure containing {expect_fail!r}\n{p.stdout}\n{p.stderr[-3000:]}")
        return p
    if p.returncode:
        raise RuntimeError(p.stdout[-3000:] + p.stderr[-3000:])
    return p


def q(db, sql, user="postgres"):
    return run(psql(db, user), sql).stdout.strip()


def require(cond, label):
    if not cond:
        raise AssertionError("FAIL: " + label)
    print("PASS: " + label, flush=True)


def installed(db):
    return q(db, "SELECT to_regclass('public.ca_club_data_fact') IS NOT NULL") == "t"

try:
    run([PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust', '--no-locale', '-E', 'UTF8'])
    with (data / 'postgresql.conf').open('a') as f:
        f.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nunix_socket_directories=''\nfsync=off\ntimezone='UTC'\n")
    run([PG / 'pg_ctl', '-D', data, '-l', cluster / 'server.log', '-w', 'start'])
    started = True
    q('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated LOGIN; CREATE ROLE service_role; CREATE ROLE supabase_admin;')
    run(psql('postgres'), FIXTURE.read_text())
    run(psql('postgres'), (ROOT / 'tests/fixtures/club-data-player-totals/setup.sql').read_text())
    run(psql('postgres'), (ROOT / 'tests/fixtures/club-data-player-totals/screen-before.sql').read_text())
    migration = next((ROOT / 'supabase/migrations').glob('*_club_data_selectable_ranges_and_player_totals.sql'))
    run(psql('postgres'), migration.read_text())
    run(psql('postgres'), (ROOT / 'tests/fixtures/club-data-player-totals/scenario.sql').read_text())
    require(True, 'Chicago date bounds, complete player totals, fees, finished MTTs, felt, filters, attribution and summary agreement')
    run(psql('postgres', 'authenticated'), "SELECT ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05');", expect_fail='not authorized')
    require(True, 'unauthorized caller refused')
    run(psql('postgres', 'authenticated'), "SET test.uid='10000000-0000-0000-0000-000000000001'; SELECT ca_club_data_player_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-05','2026-11-05');")
    require(True, 'authorized caller receives the report')
finally:
    if started:
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    shutil.rmtree(cluster)
