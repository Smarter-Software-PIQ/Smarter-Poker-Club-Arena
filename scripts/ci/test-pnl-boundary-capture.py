#!/usr/bin/env python3
"""Native qualification of 20261115015159. No production access.

Every ready pnl_boundary certificate is copied at install, each later one in
the statement that writes it, a recertified boundary keeps its earlier value,
the copy survives the certificate's eight-day retirement, nothing else is
copied, the copy never refuses the certificate, every guard is ENABLE ALWAYS,
fn_ca_union_pnl_boundary_for_invoice returns the version an invoice used (or
NULL), and nobody but the owner can read or change the copy. Run as an unprivileged user (initdb refuses root).
"""
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261115015159_union_pnl_boundary_certificates_are_kept.sql"
FIXTURE = ROOT / "tests/fixtures/pnl-boundary-capture/fixture.sql"
PG = Path(os.environ.get("PG_BIN") or next((p for p in ("/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin",
                                                        "/opt/homebrew/opt/postgresql@17/bin")
                                            if (Path(p) / "initdb").exists()), "/usr/lib/postgresql/17/bin"))
ENV = {"PATH": f"{PG}:/usr/bin:/bin", "LANG": "C", "LC_ALL": "C", "PGTZ": "UTC"}

cluster = Path(tempfile.mkdtemp(prefix="pnl-boundary-capture-", dir=os.environ.get("TMPDIR")))
data = cluster / "data"
with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]
started = False


def psql(user="postgres"):
    return [str(PG / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", str(PORT), "-U", user, "-d", "live"]


def run(sql, user="postgres", expect_fail=None):
    p = subprocess.run(psql(user), input=sql, capture_output=True, text=True, env=ENV, timeout=120)
    if expect_fail is not None:
        if p.returncode == 0 or expect_fail not in p.stderr:
            raise AssertionError(f"expected failure containing {expect_fail!r}\n{p.stdout}\n{p.stderr[-2000:]}")
        return p
    if p.returncode:
        raise RuntimeError(p.stdout[-2000:] + p.stderr[-2000:])
    return p


def q(sql, user="postgres"):
    return run(sql, user).stdout.strip()


def require(cond, label):
    if not cond:
        raise AssertionError("FAIL: " + label)
    print("PASS: " + label, flush=True)


try:
    subprocess.run([PG / "initdb", "-D", data, "-U", "fixture_bootstrap", "--auth-local=trust", "--auth-host=trust",
                    "--no-locale", "-E", "UTF8"], check=True, capture_output=True, env=ENV)
    with (data / "postgresql.conf").open("a") as f:
        f.write(f"\nlisten_addresses='127.0.0.1'\nport={PORT}\nunix_socket_directories=''\nfsync=off\ntimezone='UTC'\n")
    subprocess.run([PG / "pg_ctl", "-D", data, "-l", cluster / "server.log", "-w", "start"], check=True,
                   capture_output=True, env=ENV)
    started = True
    boot = [str(PG / "psql"), "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", str(PORT),
            "-U", "fixture_bootstrap", "-d", "postgres"]
    subprocess.run(boot, input="CREATE ROLE postgres LOGIN NOSUPERUSER BYPASSRLS CREATEDB CREATEROLE; CREATE ROLE anon; "
                               "CREATE ROLE authenticated LOGIN; CREATE ROLE service_role LOGIN; CREATE ROLE supabase_admin; "
                               "GRANT anon, authenticated, service_role TO postgres; CREATE DATABASE live OWNER postgres;",
                   check=True, capture_output=True, text=True, env=ENV)
    run(FIXTURE.read_text())
    sql = MIGRATION.read_text()

    run("SET ROLE authenticated;\n" + sql, expect_fail="maintained installer")
    run(sql.replace("\nCOMMIT;\n", "\nROLLBACK;\n"))
    require(q("SELECT to_regclass('public.ca_union_pnl_boundary_capture') IS NULL") == "t",
            "a rolled-back installation leaves nothing behind")
    run(sql)
    run(sql, expect_fail="already installed")
    require(q("SELECT string_agg(boundary::text, ',' ORDER BY boundary) FROM ca_union_pnl_boundary_capture")
            == "2026-11-02 08:00:00+00,2026-11-09 08:00:00+00",
            "every ready pnl_boundary certificate is kept at install, and nothing else")
    require(q("SELECT bool_and(k.value = c.value AND k.certified_at = c.certified_at) FROM ca_union_pnl_boundary_capture k "
              "JOIN accounting_close_certificates c ON c.kind = 'pnl_boundary' AND c.union_id = k.union_id "
              "AND c.period_start = k.boundary") == "t", "each kept value is the certificate's, byte for byte")

    # A later certificate, a recertification, a blocked one, and the retirement.
    run("INSERT INTO accounting_close_certificates (kind, union_id, period_start, period_end, value, certified_at) VALUES "
        "('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-11-16 08:00+00', '2026-11-16 08:00+00', "
        "'{\"status\":\"ready\",\"holdings\":[]}', '2026-11-18 02:00+00');")
    run("UPDATE accounting_close_certificates SET value = '{\"status\":\"ready\",\"holdings\":[{\"amount\":1}]}', "
        "certified_at = '2026-11-12 00:00+00' WHERE kind = 'pnl_boundary' AND period_start = '2026-11-09 08:00+00';")
    run("INSERT INTO accounting_close_certificates (kind, union_id, period_start, period_end, value) VALUES "
        "('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-11-23 08:00+00', '2026-11-23 08:00+00', "
        "'{\"status\":\"blocked\"}');")
    run("DELETE FROM accounting_close_certificates WHERE certified_at < '2026-11-12 00:00+00';")
    require(q("SELECT count(*) FROM ca_union_pnl_boundary_capture") == "4",
            "a later certificate and a recertified value are kept; a blocked one is not")
    require(q("SELECT count(*) FROM ca_union_pnl_boundary_capture WHERE boundary = '2026-11-09 08:00+00'") == "2",
            "a recertified boundary keeps its earlier value beside the new one")
    require(q("SELECT count(*) FROM ca_union_pnl_boundary_capture WHERE boundary = '2026-11-02 08:00+00'") == "1",
            "the copy outlives the certificate's eight-day retirement")

    run("UPDATE ca_union_pnl_boundary_capture SET value = '{}' ;", expect_fail="append-only")
    run("DELETE FROM ca_union_pnl_boundary_capture;", expect_fail="append-only")
    run("TRUNCATE ca_union_pnl_boundary_capture;", expect_fail="append-only")

    # A copy that raises never refuses the certificate: the failure is recorded.
    run("ALTER TABLE ca_union_pnl_boundary_capture ADD CONSTRAINT fixture_refuses CHECK (boundary <> '2026-11-30 08:00+00');")
    run("INSERT INTO accounting_close_certificates (kind, union_id, period_start, period_end, value) VALUES "
        "('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-11-30 08:00+00', '2026-11-30 08:00+00', "
        "'{\"status\":\"ready\"}');")
    require(q("SELECT count(*) FROM accounting_close_certificates WHERE period_start = '2026-11-30 08:00+00'") == "1"
            and q("SELECT count(*) FROM ca_union_pnl_boundary_capture_failures WHERE boundary = '2026-11-30 08:00+00' "
                  "AND value = '{\"status\":\"ready\"}' AND certified_at IS NOT NULL") == "1",
            "a copy that raises is recorded with its value and the certificate still commits")
    run("DELETE FROM ca_union_pnl_boundary_capture_failures;", expect_fail="append-only")
    # The installer cannot switch session_replication_role here, so the
    # replica case is asserted on the catalogue: every guard and the copy fire
    # in every replication role ('A' = ENABLE ALWAYS).
    require(q("SELECT string_agg(tgname || '=' || tgenabled::text, ',' ORDER BY tgname) FROM pg_trigger "
              "WHERE NOT tgisinternal AND tgrelid IN ('public.ca_union_pnl_boundary_capture'::regclass, "
              "'public.ca_union_pnl_boundary_capture_failures'::regclass, 'public.accounting_close_certificates'::regclass)")
            == "ca_union_pnl_boundary_capture_failures_immutable=A,ca_union_pnl_boundary_capture_failures_no_truncate=A,"
               "ca_union_pnl_boundary_capture_immutable=A,ca_union_pnl_boundary_capture_no_truncate=A,"
               "trg_ca_union_pnl_boundary_capture=A",
            "the four append-only guards and the copy are ENABLE ALWAYS (they hold under session_replication_role = replica)")

    # Which version an invoice used: fn_ca_union_pnl_boundary_for_invoice.
    U, B = "'fade0000-0000-0000-0000-000000000001'", "'2026-12-07 08:00+00'"
    def version(issued):
        return q(f"SELECT COALESCE((SELECT v->>'v' FROM (SELECT (fn_ca_union_pnl_boundary_for_invoice({U}, {B}, {issued})).value AS v) x), 'NULL')")
    run(f"INSERT INTO accounting_close_certificates (kind, union_id, period_start, period_end, value, certified_at) VALUES "
        f"('pnl_boundary', {U}, {B}, {B}, '{{\"status\":\"ready\",\"v\":\"A\"}}', '2026-12-08 01:00+00');")
    require(version("'2026-12-08 00:59+00'") == "NULL", "an invoice issued before every kept version is not invoice-exact (NULL)")
    run(f"UPDATE accounting_close_certificates SET value = '{{\"status\":\"ready\",\"v\":\"B\"}}', "
        f"certified_at = '2026-12-09 01:00+00' WHERE kind = 'pnl_boundary' AND period_start = {B};")
    require(version("'2026-12-08 12:00+00'") == "A", "one version before and one after the invoice: the earlier one is used")
    run(f"UPDATE accounting_close_certificates SET value = '{{\"status\":\"ready\",\"v\":\"A\"}}', "
        f"certified_at = '2026-12-10 01:00+00' WHERE kind = 'pnl_boundary' AND period_start = {B};")
    require(q(f"SELECT count(*) FROM ca_union_pnl_boundary_capture WHERE boundary = {B}") == "3"
            and version("'2026-12-09 12:00+00'") == "B" and version("'2026-12-10 01:00+00'") == "A"
            and version("'infinity'") == "A" and version("NULL") == "NULL",
            "a value that goes A -> B -> A is three versions, each invoice gets the one certified at or before it")

    for role in ("authenticated", "service_role"):
        run(f"SET ROLE {role}; SELECT count(*) FROM public.ca_union_pnl_boundary_capture;", expect_fail="permission denied")
    require(True, "no API role reads the kept certificates")
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
