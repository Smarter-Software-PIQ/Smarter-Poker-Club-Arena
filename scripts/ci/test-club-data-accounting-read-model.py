#!/usr/bin/env python3
"""Native qualification of 20261115004729 and 20261115010436. No production access.

Club Data's accounting read model carries the union invoice's own records,
keyed by the 02:00 America/Chicago accounting day: the live projection writes
every source row inserted after the cutover (src 0), a day load writes the
whole day minus src 0 in one snapshot (src 1), the pnl_boundary certificates
the deferred entries (src 2), and nothing is counted twice, whenever a row
was inserted relative to the cutover or a load.
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
MODEL = M / "20261115004729_club_data_accounting_read_model.sql"
LIVE = M / "20261115010436_club_data_accounting_read_model_goes_live.sql"
BASE = ROOT / "tests/fixtures/club-data-union-weeks/fixture.sql"
FIX = ROOT / "tests/fixtures/club-data-accounting"
PG = Path(os.environ.get("PG_BIN") or next((p for p in ("/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin",
                                                        "/opt/homebrew/opt/postgresql@17/bin")
                                            if (Path(p) / "initdb").exists()), "/usr/lib/postgresql/17/bin"))
ENV = {"PATH": f"{PG}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "PGTZ": "UTC"}

cluster = Path(tempfile.mkdtemp(prefix="club-data-accounting-", dir=os.environ.get("TMPDIR")))
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


def load(day, rebuild=False):
    return (f"BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_acct_seed_day('{day}'"
            + (", true" if rebuild else "") + "); COMMIT;")


# Nov 1 and Nov 2 load before the live rows arrive (a later escrow
# certificate then corrects a loaded hand in src 0); Nov 3 loads after them
# (its live rows are subtracted, never counted twice).
EARLY = load("2026-11-01") + load("2026-11-02")
LATE = load("2026-11-03")
BOUNDARIES = ("SELECT fn_ca_club_acct_load_boundary('fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00'); "
              "SELECT fn_ca_club_acct_load_boundary('fade0000-0000-0000-0000-000000000001', '2026-11-09 08:00+00');")

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
    run(psql("live"), BASE.read_text())
    run(psql("live"), WEEKS.read_text())
    run(psql("live"), (FIX / "fixture.sql").read_text())
    model, live = MODEL.read_text(), LIVE.read_text()

    run(psql("live"), live, expect_fail="CLUB_ACCT_PREREQUISITE_MISSING")
    run(psql("live"), "SET ROLE authenticated;\n" + model, expect_fail="maintained installer")
    run(psql("live"), model.replace("\nCOMMIT;\n", "\nROLLBACK;\n"))
    require(q("live", "SELECT to_regclass('public.ca_club_acct_fact') IS NULL") == "t", "a rolled-back installation leaves nothing behind")
    run(psql("live"), model)
    run(psql("live"), model, expect_fail="already installed")
    run(psql("live"), load("2026-11-02"), expect_fail="waits for the live projection")
    require(q("live", "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'ca_club_acct_%'") == "0",
            "the read model alone attaches nothing to a money table")

    run(psql("live"), (FIX / "pre.sql").read_text())
    require(q("live", "SELECT count(*) FROM ca_club_acct_fact") == "0", "nothing projects before the cutover")
    run(psql("live"), live)
    run(psql("live"), live, expect_fail="CLUB_ACCT_ALREADY_LIVE")
    require(q("live", "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'ca_club_acct_%' AND NOT tgisinternal") == "9",
            "the window file attaches the nine projections")
    run(psql("live"), "SELECT fn_ca_club_acct_seed_day('2026-11-01');", expect_fail="REPEATABLE READ")
    run(psql("live"), EARLY)
    run(psql("live"), (FIX / "post.sql").read_text())
    run(psql("live"), BOUNDARIES)
    run(psql("live"), LATE)
    run(psql("live"), load("2026-11-02"), expect_fail="already loaded")
    p = run(psql("live"), (FIX / "check.sql").read_text())
    require("CLUB DATA ACCOUNTING READ MODEL SCENARIO PASSED" in p.stdout + p.stderr,
            "fees, hand results, BBJ, tournament flows and carried entries per club and 02:00 day, to the cent; "
            "a load and the live projection never overlap; a moved fee and a reshaped "
            "hand follow; a failed projection is recorded")

    # Rebuilding a day is idempotent.
    before = q("live", "SELECT md5(string_agg(f::text, ',' ORDER BY club_id, acct_day, game_id, user_id, src)) FROM ca_club_acct_fact f")
    run(psql("live"), load("2026-11-02", True) + load("2026-11-03", True))
    run(psql("live"), BOUNDARIES)
    after = q("live", "SELECT md5(string_agg(f::text, ',' ORDER BY club_id, acct_day, game_id, user_id, src)) FROM ca_club_acct_fact f")
    require(before == after, "loading a day again and reloading a boundary changes nothing")
    require(q("live", "SELECT count(*) FROM ca_club_acct_projection_failures WHERE resolved_at IS NOT NULL") == "1",
            "loading the day again marks its recorded failure resolved")
    p = run(psql("live"), (FIX / "check.sql").read_text())
    require("PASSED" in p.stdout + p.stderr, "the figures hold after the rebuild")

    require(q("live", "SELECT NOT has_table_privilege('authenticated','public.ca_club_acct_fact','select') "
                      "AND NOT has_table_privilege('anon','public.ca_club_acct_fact','select') "
                      "AND NOT has_function_privilege('authenticated','public.fn_ca_club_acct_seed_day(date,boolean)','execute')") == "t",
            "no signed-in caller reads the model or runs the seed directly")
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
