#!/usr/bin/env python3
"""Native qualification of 20261114235606 and 20261114235607. No production access.

Club Data reads a union invoice week from the issued invoice, on the invoice's
own 02:00 America/Chicago boundary, and a renamed club keeps its old slug.
Run as an unprivileged user (initdb refuses root).
"""
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "supabase/migrations"
WEEKS = M / "20261114235606_club_data_reads_the_union_invoice_week.sql"
RENAME = M / "20261114235607_a_renamed_club_keeps_its_old_slug.sql"
FIXTURE = ROOT / "tests/fixtures/club-data-union-weeks/fixture.sql"
SCENARIO = ROOT / "tests/fixtures/club-data-union-weeks/scenario.sql"
PG = Path(os.environ.get("PG_BIN") or next((p for p in ("/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin",
                                                        "/opt/homebrew/opt/postgresql@17/bin")
                                            if (Path(p) / "initdb").exists()), "/usr/lib/postgresql/17/bin"))
ENV = {"PATH": f"{PG}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "PGTZ": "UTC"}

cluster = Path(tempfile.mkdtemp(prefix="club-data-union-weeks-", dir=os.environ.get("TMPDIR")))
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


try:
    run([PG / "initdb", "-D", data, "-U", "fixture_bootstrap", "--auth-local=trust", "--auth-host=trust", "--no-locale", "-E", "UTF8"])
    with (data / "postgresql.conf").open("a") as f:
        f.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nunix_socket_directories=''\nfsync=off\nautovacuum=off\ntimezone='UTC'\n")
    run([PG / "pg_ctl", "-D", data, "-l", cluster / "server.log", "-w", "start"])
    started = True
    q("postgres", "CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS CREATEDB CREATEROLE; CREATE ROLE anon; CREATE ROLE authenticated; "
                  "CREATE ROLE service_role; CREATE ROLE supabase_admin; GRANT anon, authenticated, service_role TO postgres;",
      user="fixture_bootstrap")
    q("postgres", "CREATE DATABASE live OWNER postgres;", user="fixture_bootstrap")
    run(psql("live"), FIXTURE.read_text())
    weeks, rename = WEEKS.read_text(), RENAME.read_text()
    before, after = SCENARIO.read_text().split("-- @@ AFTER THE RENAME TRIGGER @@", 1)

    # TODAY'S BEHAVIOUR FAILS THE LAW: without the migration nothing answers
    # the invoice week, and the old slug names nobody.
    run(psql("live"), before, expect_fail="fn_ca_accounting_day")
    require(q("live", "SELECT count(*) FROM clubs WHERE slug='club-jaqk'") == "0", "baseline: the renamed club's old slug resolves to nothing")

    run(psql("live"), rename, expect_fail="CLUB_SLUG_HISTORY_PREREQUISITE_MISSING")
    run(psql("live"), "SET ROLE authenticated;\n" + weeks, expect_fail="maintained installer")
    run(psql("live"), weeks.replace("\nCOMMIT;\n", "\nROLLBACK;\n"))
    require(q("live", "SELECT to_regprocedure('public.ca_club_data_union_weeks(uuid,date,date)') IS NULL AND to_regclass('public.club_slug_history') IS NULL") == "t",
            "a rolled-back installation leaves nothing behind")
    run(psql("live"), weeks)
    run(psql("live"), weeks, expect_fail="already installed")
    p = run(psql("live"), before)
    require("UNION INVOICE WEEK SCENARIO PASSED" in p.stdout + p.stderr,
            "02:00 Chicago day across both clock changes; every club's week equals its invoice to the cent; "
            "eight-day reading is not a week; no re-attribution; refusals; recorded rename resolves")
    require(q("live", "SELECT has_function_privilege('authenticated','public.ca_club_data_union_weeks(uuid,date,date)','execute') "
                      "AND NOT has_function_privilege('anon','public.ca_club_data_union_weeks(uuid,date,date)','execute') "
                      "AND NOT has_table_privilege('authenticated','public.club_slug_history','select') "
                      "AND has_function_privilege('authenticated','public.ca_club_id_for_slug(text)','execute')") == "t",
            "signed-in callers only; the history table is read through its function")
    # The reader holds no write and no lock a hand waits on.
    require(q("live", "SELECT provolatile FROM pg_proc WHERE oid='public.ca_club_data_union_weeks(uuid,date,date)'::regprocedure") == "s",
            "the invoice week reader is STABLE (read-only)")

    run(psql("live"), rename)
    run(psql("live"), rename, expect_fail="already exists")
    p = run(psql("live"), after)
    require("CLUB SLUG HISTORY SCENARIO PASSED" in p.stdout + p.stderr,
            "a rename files the old slug in its own statement; the current holder always wins")
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
