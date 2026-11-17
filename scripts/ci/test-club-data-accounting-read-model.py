#!/usr/bin/env python3
"""Native qualification of 20261115020010, 20261115020011, 20261115063000, 20261115075440 and 20261115205153. No production access.

Club Data's accounting read model carries the union invoice's own records,
keyed by the 02:00 America/Chicago accounting day: the live projection writes
every source row inserted after the cutover (src 0, aggregate rows under a
try-lock or insert-only journal rows), a day load writes the whole day minus
the src 0 aggregate in one snapshot and folds the day's journal (src 1), the
kept pnl_boundary certificates the deferred entries in the version each
week's invoice used (src 2), and nothing is counted twice, whenever a row
was inserted relative to the cutover or a load. Two sessions prove that a
live write never waits on another's projection row and that a load beside
live commits counts each hand once.
Run as an unprivileged user (initdb refuses root).
"""
import os
import json
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "supabase/migrations"
WEEKS = M / "20261114235606_club_data_reads_the_union_invoice_week.sql"
CAPTURE = M / "20261115015159_union_pnl_boundary_certificates_are_kept.sql"
MODEL = M / "20261115020010_club_data_accounting_read_model.sql"
LIVE = M / "20261115020011_club_data_accounting_read_model_goes_live.sql"
VIEWS = M / "20261115034141_club_data_accounting_reader_views.sql"
ROUTE = M / "20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model.sql"
RECONCILE = M / "20261115080136_club_data_boundary_side_reconciled_to_its_invoice.sql"
PARTS = M / "20261115063000_club_data_history_loads_a_day_in_bounded_parts.sql"
ONCE = M / "20261115075440_club_data_history_load_reads_each_row_once.sql"
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


def parts(day, rebuild=False, between=""):
    """A day loaded the way the history load does it: begin (REPEATABLE READ),
    then two-hour slices and finish in their own transactions."""
    return (f"BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_acct_seed_begin('{day}', {'true' if rebuild else 'false'})->>'snapshot' AS snap \\gset\nCOMMIT;\n"
            + between +
            "CREATE TEMP TABLE seed_parts AS SELECT fn_ca_club_acct_seed_slice("
            f"'{day}', g, LEAST(g + interval '2 hours', fn_ca_accounting_day_start('{day}'::date + 1)), :'snap') r "
            f"FROM generate_series(fn_ca_accounting_day_start('{day}'), fn_ca_accounting_day_start('{day}'::date + 1) - interval '1 microsecond', interval '2 hours') g;\n"
            f"SELECT fn_ca_club_acct_seed_finish('{day}', :'snap', (SELECT sum((r->>'unclassified_flows')::bigint)::bigint FROM seed_parts), "
            "(SELECT sum((r->>'fact_inputs')::bigint)::bigint FROM seed_parts), (SELECT sum((r->>'hand_inputs')::bigint)::bigint FROM seed_parts)) IS NOT NULL;\n"
            "DROP TABLE seed_parts;\n")


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
    run(psql("live"), CAPTURE.read_text())
    model, live = MODEL.read_text(), LIVE.read_text()

    run(psql("live"), live, expect_fail="CLUB_ACCT_PREREQUISITE_MISSING")
    run(psql("live"), "SET ROLE authenticated;\n" + model, expect_fail="maintained installer")
    run(psql("live"), model.replace("\nCOMMIT;\n", "\nROLLBACK;\n"))
    require(q("live", "SELECT to_regclass('public.ca_club_acct_fact') IS NULL") == "t", "a rolled-back installation leaves nothing behind")
    run(psql("live"), model)
    run(psql("live"), model, expect_fail="already installed")
    run(psql("live"), load("2026-11-02"), expect_fail="waits for the live projection")
    require(q("live", "SELECT string_agg(tgrelid::regclass || '.' || tgname, ',') FROM pg_trigger WHERE tgname LIKE 'ca_club_acct_%'")
            == "ca_union_pnl_boundary_capture.ca_club_acct_boundary",
            "the read model alone attaches nothing to a money table (only the boundary loader to the kept certificates)")

    run(psql("live"), (FIX / "pre.sql").read_text())
    require(q("live", "SELECT count(*) FILTER (WHERE src <> 2) || '/' || count(*) FILTER (WHERE src = 2) FROM ca_club_acct_fact") == "0/3",
            "nothing projects before the cutover except the kept boundaries, which load themselves")
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
    require(q("live", "SELECT string_agg(source || ':' || acct_day, ',' ORDER BY id) FROM ca_club_acct_projection_failures "
                      "WHERE resolved_at IS NOT NULL") == "tournament_flow_unclassified:2026-11-02,bbj_award:2026-11-03,"
                                                    "tournament_flow_unclassified:2026-11-03,tournament_flow_unclassified:2026-11-03",
            "loading a day again resolves its recorded failures; an unclassified flow is recorded again")
    p = run(psql("live"), (FIX / "check.sql").read_text())
    require("PASSED" in p.stdout + p.stderr, "the figures hold after the rebuild")

    # 20261115063000: the same days loaded in bounded parts give the same rows.
    run(psql("live"), PARTS.read_text())
    run(psql("live"), ONCE.read_text())
    run(psql("live"), parts("2026-11-02", True) + parts("2026-11-03", True))
    parted = q("live", "SELECT md5(string_agg(f::text, ',' ORDER BY club_id, acct_day, game_id, user_id, src)) FROM ca_club_acct_fact f")
    require(parted == after, "a day loaded in bounded parts holds exactly the rows of the one-transaction load")
    run(psql("live"), "SELECT fn_ca_club_acct_seed_begin('2026-11-02');", expect_fail="REPEATABLE READ")
    run(psql("live"), "SELECT fn_ca_club_acct_seed_slice('2026-11-02', '2026-11-02 07:00+00', '2026-11-02 09:00+00', pg_current_snapshot());",
        expect_fail="not inside accounting day")
    run(psql("live"), "SELECT fn_ca_club_acct_seed_slice('2026-11-02', '2026-11-02 08:00+00', '2026-11-02 10:00+00', pg_current_snapshot());",
        expect_fail="already loaded")
    p = run(psql("live"), (FIX / "check.sql").read_text())
    require("PASSED" in p.stdout + p.stderr, "the figures hold after the parted load")

    # Two sessions. Hands on a fresh accounting day (2026-11-04), each in its
    # own transaction, K u1 +1 and F u2 -1 at table T1, as production writes them.
    def hand(n):
        return ("INSERT INTO union_pnl_cash_outcomes (table_id, hand_number, hand_id, recognized_at, payload_hash, game_scope, evidence) "
                f"VALUES ('c0000000-0000-0000-0000-000000000001', {n}, gen_random_uuid(), '2026-11-04 12:00+00', 'c{n}', "
                "'{\"game_union_id\": \"fade0000-0000-0000-0000-000000000001\"}', '{\"status\": \"ready\"}'); "
                "INSERT INTO union_pnl_cash_outcome_touches VALUES ('c0000000-0000-0000-0000-000000000001', "
                f"{n}, '2026-11-04 12:00+00', 'fade0000-0000-0000-0000-000000000001', false, '1', "
                "'[{\"earning_club_id\": \"a41434bb-8d0c-400a-8f0d-e8b3d65afed4\", \"user_id\": \"11111111-0000-0000-0000-000000000001\", \"observed_stack_delta\": 1}, "
                "{\"earning_club_id\": \"a0000000-0000-0000-0000-000000000001\", \"user_id\": \"11111111-0000-0000-0000-000000000002\", \"observed_stack_delta\": -1}]'); ")

    def background():
        return subprocess.Popen(psql("live"), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=ENV)

    def finish(proc, sql):
        out, err = proc.communicate(sql, timeout=120)
        if proc.returncode:
            raise RuntimeError(out[-2000:] + err[-2000:])
        return out

    # (1) Session A commits hand 10 and holds its transaction open; session B
    # commits hand 11 on the same projection rows meanwhile. B must not wait:
    # it journals, and A keeps its aggregate rows.
    a = background()
    a_sql = ("BEGIN; " + hand(10) +
             "SELECT 'locks:' || count(*) FILTER (WHERE objsubid = 1) || ':' || count(*) FILTER (WHERE objsubid <> 1) "
             "FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid(); SELECT pg_sleep(4); COMMIT;\n")
    a.stdin.write(a_sql)
    a.stdin.flush()
    time.sleep(1.0)
    t0 = time.monotonic()
    run(psql("live"), hand(11))
    waited = time.monotonic() - t0
    a_out = finish(a, "")
    require(waited < 2.0 and a.returncode == 0,
            f"a live write beside another open projection of the same rows never waits ({waited:.2f} s)")
    held = [l for l in a_out.splitlines() if l.startswith("locks:")]
    require(held and held[0].split(":")[2] == "0" and int(held[0].split(":")[1]) > 0,
            "the projection's row locks are one-key advisory locks only (" + (held[0] if held else "none") + ")")
    require(q("live", "SELECT count(*) FROM ca_club_acct_fact_journal WHERE acct_day = '2026-11-04'") == "2"
            and q("live", "SELECT count(*) FROM ca_club_acct_hands_journal WHERE acct_day = '2026-11-04'") == "2",
            "the second writer appended insert-only journal rows instead")

    # (2) A day load beside a live commit: hand 12 commits after the load's
    # snapshot and before the load commits.
    a = background()
    a.stdin.write("BEGIN; " + hand(12) + "SELECT pg_sleep(3); COMMIT;\n")
    a.stdin.flush()
    time.sleep(1.0)
    b_out = run(psql("live"), "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT clock_timestamp() AS t0 \\gset\n"
                "SELECT fn_ca_club_acct_seed_day('2026-11-04') IS NOT NULL; "
                "SELECT 'load:' || extract(epoch FROM clock_timestamp() - :'t0'::timestamptz); SELECT pg_sleep(4); COMMIT;").stdout
    finish(a, "")
    took = float([l for l in b_out.splitlines() if l.startswith("load:")][0][5:])
    require(took < 2.0, f"a day load never waits on a live commit ({took:.2f} s)")
    totals = q("live", "SELECT string_agg(club_id || '=' || r || '/' || h, ',' ORDER BY club_id) FROM ("
                       "SELECT club_id, sum(result) r, sum(hands) h FROM (SELECT club_id, result, hands FROM ca_club_acct_fact "
                       "WHERE acct_day = '2026-11-04' UNION ALL SELECT club_id, result, hands FROM ca_club_acct_fact_journal "
                       "WHERE acct_day = '2026-11-04') x GROUP BY 1) y")
    tables = q("live", "SELECT string_agg(club_id || '=' || h, ',' ORDER BY club_id) FROM (SELECT club_id, sum(hands) h FROM ("
                       "SELECT club_id, hands FROM ca_club_acct_hands WHERE acct_day = '2026-11-04' UNION ALL "
                       "SELECT club_id, hands FROM ca_club_acct_hands_journal WHERE acct_day = '2026-11-04') x GROUP BY 1) y")
    require(totals == "a0000000-0000-0000-0000-000000000001=-3/3,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=3/3"
            and tables == "a0000000-0000-0000-0000-000000000001=3,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=3",
            f"three hands, each counted once across the live rows, the journal and the load ({totals}; {tables})")
    require(q("live", "SELECT count(*) FROM ca_club_acct_fact_journal WHERE acct_day = '2026-11-04'") == "0",
            "the load folded the day's journal rows it read")

    # (2b) The same day loaded again in parts, with hand 13 committed after the
    # parts' snapshot and before their slices: every hand still counted once,
    # and the rows equal a one-transaction rebuild of the day.
    run(psql("live"), parts("2026-11-04", True, between=hand(13)))
    totals = q("live", "SELECT string_agg(club_id || '=' || r || '/' || h, ',' ORDER BY club_id) FROM ("
                       "SELECT club_id, sum(result) r, sum(hands) h FROM (SELECT club_id, result, hands FROM ca_club_acct_fact "
                       "WHERE acct_day = '2026-11-04' UNION ALL SELECT club_id, result, hands FROM ca_club_acct_fact_journal "
                       "WHERE acct_day = '2026-11-04') x GROUP BY 1) y")
    require(totals == "a0000000-0000-0000-0000-000000000001=-4/4,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=4/4",
            f"a hand committed between a parted load's snapshot and its slices is counted once ({totals})")
    sums = ("SELECT string_agg(club_id || '=' || r || '/' || h, ',' ORDER BY club_id) FROM (SELECT club_id, sum(result) r, sum(hands) h "
            "FROM (SELECT club_id, result, hands FROM ca_club_acct_fact WHERE acct_day = '2026-11-04' UNION ALL "
            "SELECT club_id, result, hands FROM ca_club_acct_fact_journal WHERE acct_day = '2026-11-04') x GROUP BY 1) y")
    run(psql("live"), load("2026-11-04", True))
    require(q("live", sums) == totals, "a one-transaction rebuild of that day gives the same figures")

    # (2c) 20261115075440, D2: a hand written inside a SUBtransaction whose
    # parent is still open at the parted load's snapshot, committed before
    # the slices run. Its subtransaction xid is not in the snapshot's
    # in-progress list; it must be counted once (by the live projection).
    def hand_on(n, at):
        return hand(n).replace("2026-11-04 12:00+00", at)

    a = background()
    a.stdin.write("BEGIN; SELECT txid_current(); SAVEPOINT s1; " + hand_on(20, "2026-11-07 12:00+00")
                  + "RELEASE SAVEPOINT s1; SELECT pg_sleep(3); COMMIT;\n")
    a.stdin.flush()
    time.sleep(1.0)
    run(psql("live"), parts("2026-11-07", between="SELECT pg_sleep(4);\n"))
    finish(a, "")
    d7 = sums.replace("2026-11-04", "2026-11-07")
    require(q("live", d7) == "a0000000-0000-0000-0000-000000000001=-1/1,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=1/1",
            "a row written in a subtransaction whose parent was open at the load's snapshot is counted once (" + q("live", d7) + ")")
    run(psql("live"), load("2026-11-07", True))
    require(q("live", d7) == "a0000000-0000-0000-0000-000000000001=-1/1,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=1/1",
            "a one-transaction rebuild of that day agrees")

    # D3: a slice sent twice, a finish without every slice, a day after the
    # live projection's day, and a slice whose begin is not on record.
    begin7 = ("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_acct_seed_begin('2026-11-07', true)->>'snapshot' AS snap \\gset\nCOMMIT;\n")
    slice1 = "SELECT fn_ca_club_acct_seed_slice('2026-11-07', fn_ca_accounting_day_start('2026-11-07'), fn_ca_accounting_day_start('2026-11-07') + interval '2 hours', :'snap') IS NOT NULL;\n"
    run(psql("live"), begin7 + slice1 + slice1, expect_fail="duplicate key")
    run(psql("live"), begin7 + slice1 + "SELECT fn_ca_club_acct_seed_finish('2026-11-07', :'snap', 0, 0, 0);",
        expect_fail="not covered exactly")
    require(q("live", "SELECT count(*) FROM ca_club_acct_seed_log WHERE acct_day = '2026-11-07'") == "0",
            "a day whose slices do not cover it is not logged loaded")
    run(psql("live"), "SELECT fn_ca_club_acct_seed_slice('2026-11-07', fn_ca_accounting_day_start('2026-11-07'), "
        "fn_ca_accounting_day_start('2026-11-07') + interval '2 hours', pg_current_snapshot());", expect_fail="no load begun")
    run(psql("live"), "BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT fn_ca_club_acct_seed_begin('2099-01-01'); COMMIT;",
        expect_fail="after the live projection")
    run(psql("live"), parts("2026-11-07", True))
    require(q("live", d7) == "a0000000-0000-0000-0000-000000000001=-1/1,a41434bb-8d0c-400a-8f0d-e8b3d65afed4=1/1"
            and q("live", "SELECT fact_rows > 0 FROM ca_club_acct_seed_log WHERE acct_day = '2026-11-07'") in ("t", "f"),
            "a complete parted load after the refusals logs the day with the same figures")

    # (3) The 32-lock budget: one hand with 40 players takes 32 row locks; the
    # rest of its rows go to the journal, and the figures are whole.
    participant_rows = ",".join('{"earning_club_id": "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3", '
                     f'"user_id": "22222222-0000-0000-0000-{i:012d}", "observed_stack_delta": 0.01}}' for i in range(40))
    run(psql("live"), "INSERT INTO union_pnl_cash_outcomes (table_id, hand_number, hand_id, recognized_at, payload_hash, game_scope, evidence) "
        "VALUES ('c0000000-0000-0000-0000-000000000002', 40, gen_random_uuid(), '2026-11-05 12:00+00', 'c40', "
        "'{\"game_union_id\": \"fade0000-0000-0000-0000-000000000001\"}', '{\"status\": \"ready\"}'); "
        "INSERT INTO union_pnl_cash_outcome_touches VALUES ('c0000000-0000-0000-0000-000000000002', 40, '2026-11-05 12:00+00', "
        f"'fade0000-0000-0000-0000-000000000001', false, '1', '[{participant_rows}]');")
    require(q("live", "SELECT (SELECT count(*) FROM ca_club_acct_fact WHERE acct_day = '2026-11-05') || '/' || "
                      "(SELECT count(*) FROM ca_club_acct_fact_journal WHERE acct_day = '2026-11-05') || '/' || "
                      "(SELECT count(*) FROM ca_club_acct_hands_journal WHERE acct_day = '2026-11-05') || '/' || "
                      "(SELECT sum(result) FROM (SELECT result FROM ca_club_acct_fact WHERE acct_day = '2026-11-05' UNION ALL "
                      "SELECT result FROM ca_club_acct_fact_journal WHERE acct_day = '2026-11-05') x)") == "32/8/1/0.40",
            "a transaction holds at most 32 projection locks; the rest journal and the figures stay whole")

    # (4) A boundary version arriving while another transaction loads that
    # boundary: the capture never waits, both boundary days are recorded as
    # failures, and the next load of the boundary resolves them.
    a = background()
    a.stdin.write("BEGIN; SELECT fn_ca_club_acct_load_boundary('fade0000-0000-0000-0000-000000000001', "
                  "'2026-11-09 08:00+00') IS NOT NULL; SELECT pg_sleep(3); COMMIT;\n")
    a.stdin.flush()
    time.sleep(1.0)
    t0 = time.monotonic()
    run(psql("live"), "UPDATE accounting_close_certificates SET value = jsonb_build_object('status', 'ready', 'holdings', "
        "jsonb_build_array(jsonb_build_object('kind', 'deferred_tournament_result', 'club_id', 'a0000000-0000-0000-0000-000000000001', "
        "'user_id', '11111111-0000-0000-0000-000000000002', 'amount', 16.00, 'source_id', 'f0000000-0000-0000-0000-000000000001'))), "
        "certified_at = '2026-11-13 00:00+00' WHERE kind = 'pnl_boundary' AND period_start = '2026-11-09 08:00+00';")
    waited = time.monotonic() - t0
    finish(a, "")
    require(waited < 2.0 and q("live", "SELECT string_agg(acct_day::text, ',' ORDER BY acct_day) FROM ca_club_acct_projection_failures "
                                       "WHERE source = 'pnl_boundary_busy' AND resolved_at IS NULL") == "2026-11-08,2026-11-09",
            f"a boundary version arriving during another load of it never waits and records both its days ({waited:.2f} s)")
    run(psql("live"), BOUNDARIES)
    require(q("live", "SELECT count(*) FROM ca_club_acct_projection_failures WHERE source = 'pnl_boundary_busy' AND resolved_at IS NULL") == "0"
            and q("live", "SELECT sum(result) FROM ca_club_acct_fact WHERE src = 2 AND acct_day = '2026-11-09'") == "-16.00",
            "the next load of the boundary takes the new version and resolves both days")

    # (5) A projection fails at commit AND its failure cannot be recorded: the
    # money writes still commit (the record becomes a WARNING).
    run(psql("live"), "CREATE FUNCTION fixture_refuses() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN "
                      "RAISE EXCEPTION 'fixture_refuses a new failure row'; END $f$; "
                      "CREATE TRIGGER fixture_refuses BEFORE INSERT ON ca_club_acct_projection_failures "
                      "FOR EACH ROW EXECUTE FUNCTION fixture_refuses(); INSERT INTO fixture_bbj_outage VALUES (true);")
    p5 = run(psql("live"),
        "INSERT INTO bbj_payouts VALUES ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 5, "
        "'2026-11-06 12:01+00'); INSERT INTO bbj_payout_recipients (payout_id, user_id, amount, created_at) VALUES "
        "('b0000000-0000-0000-0000-000000000003', 'bbb00000-0000-0000-0000-0000000000fe', 1.00, '2026-11-06 12:01+00'); "
        "INSERT INTO union_pnl_original_flows VALUES ('f1000000-0000-0000-0000-00000000000c', NULL, '2026-11-06 13:00+00', "
        "'{\"game_union_id\": \"fade0000-0000-0000-0000-000000000001\", \"tournament_id\": \"d0000000-0000-0000-0000-000000000001\"}', "
        "'{\"status\": \"posted\", \"club_id\": \"a41434bb-8d0c-400a-8f0d-e8b3d65afed4\", \"amount\": 3, \"from_type\": \"prize_liability\", "
        "\"to_type\": \"player_wallet\", \"category\": \"tournament_prize\"}');")
    require(q("live", "SELECT (SELECT count(*) FROM bbj_payout_recipients WHERE user_id = 'bbb00000-0000-0000-0000-0000000000fe') || '/' || "
                      "(SELECT count(*) FROM union_pnl_original_flows WHERE ledger_id = 'f1000000-0000-0000-0000-00000000000c') || '/' || "
                      "(SELECT count(*) FROM ca_club_acct_projection_failures WHERE acct_day = '2026-11-06')") == "1/1/0"
            and "could not be recorded" in p5.stderr,
            "a projection whose failure cannot be recorded still never refuses the money write")
    # A day load never swallows its own failure record: it aborts instead.
    run(psql("live"), "DELETE FROM fixture_bbj_outage;")
    before_log = q("live", "SELECT seeded_at FROM ca_club_acct_seed_log WHERE acct_day = '2026-11-02'")
    run(psql("live"), load("2026-11-02", True), expect_fail="fixture_refuses")
    require(q("live", "SELECT seeded_at FROM ca_club_acct_seed_log WHERE acct_day = '2026-11-02'") == before_log,
            "a day load whose failure record cannot be written aborts and leaves the day as it was")
    run(psql("live"), "DROP TRIGGER fixture_refuses ON ca_club_acct_projection_failures;")

    # (6) Stage 2 (a): the readers' views add every writer's rows exactly
    # once (live aggregate src 0, journal src 0, day load src 1, boundaries
    # src 2), and the coverage report names what the model does not hold.
    run(psql("live"), """
      CREATE TABLE public.club_members (club_id uuid, user_id uuid, agent_id uuid, role text, status text);
      CREATE FUNCTION public.fn_ca_club_data_downline(p_club_id uuid, p_user uuid)
      RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $f$
        WITH RECURSIVE edges AS MATERIALIZED (
          SELECT cm.user_id AS child, cm.agent_id AS parent FROM public.club_members cm
           WHERE cm.club_id = p_club_id AND cm.agent_id IS NOT NULL AND cm.agent_id <> cm.user_id
        ), tree(uid) AS (SELECT p_user WHERE p_user IS NOT NULL UNION SELECT e.child FROM tree t JOIN edges e ON e.parent = t.uid)
        SELECT COALESCE(array_agg(DISTINCT uid), ARRAY[]::uuid[]) FROM tree; $f$;
      INSERT INTO public.club_members VALUES
        ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '11111111-0000-0000-0000-000000000001', NULL, 'agent', 'active'),
        ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '11111111-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001', 'member', 'active');
      -- Deep Stack Society joins its union on accounting day 2026-11-03.
      ALTER TABLE public.union_clubs ADD COLUMN joined_at timestamptz NOT NULL DEFAULT '2026-01-01 00:00+00';
      UPDATE public.union_clubs SET joined_at = '2026-11-03 14:00+00' WHERE club_id = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3';
      -- A failure 20261115020010 recorded with no day, and another union's
      -- boundary failure.
      INSERT INTO public.ca_club_acct_projection_failures (source, acct_day, detail, failed_at)
        VALUES ('cash_hand', NULL, 'legacy', '2026-11-06 12:00+00');
      INSERT INTO public.ca_club_acct_projection_failures (source, source_key, acct_day, detail)
        VALUES ('pnl_boundary', 'bbbb0000-0000-0000-0000-000000000001:1762761600', '2026-11-04', 'another union');""")
    run(psql("live"), "SET ROLE authenticated;\n" + VIEWS.read_text(), expect_fail="maintained installer")
    run(psql("live"), VIEWS.read_text())
    run(psql("live"), VIEWS.read_text(), expect_fail="already installed")
    expected = ("2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02=3.25/2.00,2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-03=2.00/-1.20,"
                "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-05=0.00/0.40,"
                "a0000000-0000-0000-0000-000000000001:2026-11-02=0.00/3.50,a0000000-0000-0000-0000-000000000001:2026-11-03=4.00/2.00,"
                "a0000000-0000-0000-0000-000000000001:2026-11-04=0.00/-4.00,a0000000-0000-0000-0000-000000000001:2026-11-07=0.00/-1.00,"
                "a0000000-0000-0000-0000-000000000001:2026-11-08=0.00/12.00,"
                "a0000000-0000-0000-0000-000000000001:2026-11-09=0.00/-16.00,"
                "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-01=1.00/0.00,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02=7.50/-6.40,"
                "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03=6.00/1.00,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-04=0.00/4.00,"
                "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-07=0.00/1.00")
    got = q("live", "SELECT string_agg(club_id || ':' || stat_date || '=' || f || '/' || r, ',' ORDER BY club_id, stat_date) FROM ("
                    "SELECT club_id, stat_date, sum(fee)::numeric(20,2) f, sum(winnings)::numeric(20,2) r FROM ca_club_acct_fact_ct GROUP BY 1, 2 "
                    "HAVING sum(fee) <> 0 OR sum(winnings) <> 0) x")
    srcs = q("live", "SELECT string_agg(DISTINCT s, ',' ORDER BY s) FROM (SELECT 'fact' || src s FROM ca_club_acct_fact UNION ALL "
                     "SELECT 'journal' FROM ca_club_acct_fact_journal) x")
    require(got == expected and srcs == "fact0,fact1,fact2,journal",
            f"the readers' per-player view is live rows + journal + day load + boundary rows, each once ({srcs}): {got}")
    require(q("live", "SELECT to_regclass('public.ca_club_acct_game_ct') IS NULL") == "t"
            and q("live", "SELECT (SELECT sum(hands) FROM ca_club_acct_hands_ct) = (SELECT sum(hands) FROM ca_club_acct_hands) + "
                          "(SELECT sum(hands) FROM ca_club_acct_hands_journal)") == "t"
            and q("live", "SELECT sum(hands) FROM ca_club_acct_hands_ct WHERE stat_date = '2026-11-05'") == "1",
            "no grouped per-game view; the per-table view counts every hand row once, journal included")
    require(q("live", "SELECT count(*) FROM ca_club_acct_projection_failures WHERE acct_day IS NULL") == "0"
            and q("live", "SELECT acct_day FROM ca_club_acct_projection_failures WHERE detail LIKE 'legacy%'") == "2026-11-06"
            and q("live", "SELECT fn_ca_club_acct_fail('cash_fee', NULL, 'no day'); SELECT acct_day = fn_ca_accounting_day(now()) "
                          "FROM ca_club_acct_projection_failures WHERE detail LIKE 'no day%'") == "t",
            "a failure always carries a day: a legacy row gets the day it failed on, a new one the day it fails")
    require(q("live", "SELECT string_agg(user_id || '=' || cash_fees || '/' || tournament_fees || '/' || total_fees, ',') FROM "
                      "fn_ca_club_acct_member_fee_totals('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-11-02', '2026-11-03', "
                      "'11111111-0000-0000-0000-000000000001')") == "11111111-0000-0000-0000-000000000001=8.50/5.00/13.50",
            "a downline's fees come from the same records on the same accounting day")
    cov = q("live", "SELECT fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-11-02', '2026-11-08') - 'window_start' - 'window_end'")
    require(cov == '{"source": "ca_club_acct_fact", "complete": false, "day_zone": "America/Chicago", "failed_days": ["2026-11-02", '
                   '"2026-11-03", "2026-11-06"], "provisional": false, "day_boundary": "02:00", "missing_days": ["2026-11-05", "2026-11-06", '
                   '"2026-11-08"], "provisional_from": null, "awaiting_boundary_days": [], "not_invoice_exact_days": []}',
            "coverage of the invoice week names its unloaded and failed days, not another union's boundary failure: " + cov)
    require(q("live", "SELECT fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-10-30', '2026-11-01')->'not_invoice_exact_days'")
            == '["2026-11-01"]'
            and q("live", "SELECT (fn_ca_club_acct_coverage('fade0000-0000-0000-0000-000000000001', '2026-11-09', '2026-11-10') "
                          "->> 'provisional_from')") == "2026-11-09"
            and q("live", "SELECT fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-11-02', '2026-11-02') "
                          "->> 'window_start'") == "2026-11-02T08:00:00+00:00"
            and q("live", "SELECT fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-10-12', '2026-10-13') "
                          "->> 'provisional'") == "false",
            "a boundary side no invoice version covers, and the open week after the last invoice (provisional; a week before "
            "the first invoice is not), are reported")
    g4 = q("live", "BEGIN; DELETE FROM ca_club_acct_boundary_log WHERE boundary = '2026-11-09 08:00+00'; "
                   "DELETE FROM settlement_invoices si USING settlement_periods sp WHERE sp.id = si.period_id AND sp.start_at = '2026-11-02 08:00+00'; "
                   "SELECT (c->'awaiting_boundary_days')::text || '|' || (c->'not_invoice_exact_days')::text || '|' || (c->>'complete') "
                   "|| '|' || (c->>'provisional') FROM (SELECT fn_ca_club_acct_coverage('fade0000-0000-0000-0000-000000000001', "
                   "'2026-11-08', '2026-11-09') c) x; ROLLBACK;")
    require(g4.split('|')[0:2] + g4.split('|')[3:] == ['["2026-11-08", "2026-11-09"]', '[]', 'true'],
            "a week boundary whose certificate has not arrived, before its week is invoiced, is provisional, not incomplete (G4): " + g4)
    require(q("live", "SELECT string_agg(c || ':' || d || '=' || fn_ca_club_data_reads_union_basis(c::uuid, d::date, d::date), ',' ORDER BY c, d) "
                      "FROM (VALUES ('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'), ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'), "
                      "('fade0000-0000-0000-0000-000000000001'), ('5ca1ab1e-0000-0000-0000-000000000001')) cc(c), "
                      "(VALUES ('2026-10-31'), ('2026-11-02'), ('2026-11-03')) dd(d)")
            == "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-10-31=false,2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02=false,"
               "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-03=true,5ca1ab1e-0000-0000-0000-000000000001:2026-10-31=false,"
               "5ca1ab1e-0000-0000-0000-000000000001:2026-11-02=false,5ca1ab1e-0000-0000-0000-000000000001:2026-11-03=false,"
               "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-10-31=false,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02=true,"
               "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03=true,fade0000-0000-0000-0000-000000000001:2026-10-31=false,"
               "fade0000-0000-0000-0000-000000000001:2026-11-02=true,fade0000-0000-0000-0000-000000000001:2026-11-03=true",
            "a window reads the union basis only from the later of the day its club joined and the model's first day (2026-11-01 here): "
            + q("live", "SELECT string_agg(c || ':' || d || '=' || fn_ca_club_data_reads_union_basis(c::uuid, d::date, d::date), ',' ORDER BY c, d) "
                        "FROM (VALUES ('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'), ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'), "
                        "('fade0000-0000-0000-0000-000000000001'), ('5ca1ab1e-0000-0000-0000-000000000001')) cc(c), "
                        "(VALUES ('2026-10-31'), ('2026-11-02'), ('2026-11-03')) dd(d)") + " facts_from=" + q("live", "SELECT fn_ca_club_acct_facts_from()"))
    require(q("live", "SELECT fn_ca_club_data_union_basis('a41434bb-8d0c-400a-8f0d-e8b3d65afed4') AND "
                      "fn_ca_club_data_union_basis('fade0000-0000-0000-0000-000000000001') AND "
                      "NOT fn_ca_club_data_union_basis('5ca1ab1e-0000-0000-0000-000000000001')") == "t"
            and q("live", "SELECT NOT has_table_privilege('authenticated', 'public.ca_club_acct_fact_ct', 'select') AND "
                          "NOT has_function_privilege('authenticated', 'public.fn_ca_club_acct_coverage(uuid,date,date)', 'execute') AND "
                          "NOT has_function_privilege('authenticated', 'public.fn_ca_club_data_reads_union_basis(uuid,date,date)', 'execute') AND "
                          "NOT has_function_privilege('authenticated', 'public.fn_ca_club_data_union_basis(uuid)', 'execute') AND "
                          "NOT has_function_privilege('anon', 'public.fn_ca_club_acct_coverage(uuid,date,date)', 'execute')") == "t",
            "union clubs and the union read the model, other clubs do not; no signed-in caller runs the helpers around the readers")

    # (7) Stage 2 (b): a reader becomes a router on its club argument. The
    # whole file refuses while the history is not loaded; its own per-reader
    # helper, run on fn_ca_club_cash_felt exactly as installed on production,
    # produces the copy whose md5 the file pins, keeps the installed reader
    # byte for byte under its new name, and gives the router the reader's own
    # arguments and grants. A union club reads 02:00 accounting days, any
    # other club the Chicago midnight day it read before.
    route = ROUTE.read_text()
    run(psql("live"), route, expect_fail="CLUB_ACCT_READERS_HISTORY_NOT_LOADED")
    helper = route[route.index("-- @route-reader-begin"):route.index("-- @route-reader-end")]
    run(psql("live"), """
      ALTER TABLE public.tables ADD COLUMN tournament_id uuid, ADD COLUMN created_by uuid,
        ADD COLUMN game_variant text, ADD COLUMN game_mode text, ADD COLUMN big_blind numeric, ADD COLUMN name text;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text);
      CREATE TABLE public.table_seats (table_id uuid, user_id uuid, stack numeric, left_at timestamptz, status text,
        joined_at timestamptz, club_id uuid);
      CREATE FUNCTION public.fn_ca_cash_reporting_club(p_union uuid, p_club uuid, p_user uuid) RETURNS uuid
        LANGUAGE sql STABLE AS $f$ SELECT p_club $f$;
      CREATE FUNCTION public.fn_ca_launch_accounting_accepts(p_club uuid, p_at timestamptz) RETURNS boolean
        LANGUAGE sql STABLE AS $f$ SELECT true $f$;
      INSERT INTO public.tables (id, union_id, club_id, name) VALUES
        ('7ab1e000-0000-0000-0000-000000000001', NULL, '5ca1ab1e-0000-0000-0000-000000000001', 'plain'),
        ('7ab1e000-0000-0000-0000-000000000002', 'fade0000-0000-0000-0000-000000000001', 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4', 'union');
      -- 07:59:59 UTC is 01:59:59 CST (Chicago day Nov 2, accounting day Nov 1);
      -- 08:00:00 UTC is exactly 02:00 CST (accounting day Nov 2).
      INSERT INTO public.table_seats VALUES
        ('7ab1e000-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000003', 10, NULL, 'active', '2026-11-02 07:59:59+00', NULL),
        ('7ab1e000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004', 20, NULL, 'active', '2026-11-02 07:59:59+00', NULL),
        ('7ab1e000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000005', 40, NULL, 'active', '2026-11-02 08:00:00+00', NULL),
        -- Deep Stack Society's seat before it joined (accounting day 2026-11-03).
        ('7ab1e000-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000006', 30, NULL, 'active', '2026-11-02 07:59:59+00',
         '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3');""")
    run(psql("live"), (FIX / "reader-cash-felt.sql").read_text())
    felt = ("SELECT string_agg(c || ':' || d || '=' || coalesce((SELECT sum(x.felt)::text FROM public.fn_ca_club_cash_felt(c::uuid, d::date, d::date) x), '-'), ',' "
            "ORDER BY c, d) FROM (VALUES ('5ca1ab1e-0000-0000-0000-000000000001'), ('a41434bb-8d0c-400a-8f0d-e8b3d65afed4'), "
            "('2a1132b9-5ba2-42e6-9f01-30a7fcffebe3')) cc(c), "
            "(VALUES ('2026-11-01'), ('2026-11-02')) dd(d)")
    before = q("live", felt)
    src_before = q("live", "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)'::regprocedure")
    run(psql("live"), helper + "\nSELECT pg_temp.ca_club_data_route_reader('fn_ca_club_cash_felt', "
        "'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)', 'd9f01b07584e5ca17c7912101b62db13', 'not-the-copy', 'plain');",
        expect_fail="is not the qualified text")
    run(psql("live"), helper + "\nSELECT pg_temp.ca_club_data_route_reader('fn_ca_club_cash_felt', "
        "'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)', '00000000000000000000000000000000', 'x', 'plain');",
        expect_fail="preimage changed")
    pinned = route.split("'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)',")[1].split("'")[3]
    run(psql("live"), helper + "\nSELECT pg_temp.ca_club_data_route_reader('fn_ca_club_cash_felt', "
        f"'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)', 'd9f01b07584e5ca17c7912101b62db13', '{pinned}', 'plain');")
    after = q("live", felt)
    require(before == "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-01=-,2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02=30,"
                      "5ca1ab1e-0000-0000-0000-000000000001:2026-11-01=-,5ca1ab1e-0000-0000-0000-000000000001:2026-11-02=10,"
                      "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-01=-,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02=60"
            and after == "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-01=-,2a1132b9-5ba2-42e6-9f01-30a7fcffebe3:2026-11-02=30,"
                         "5ca1ab1e-0000-0000-0000-000000000001:2026-11-01=-,5ca1ab1e-0000-0000-0000-000000000001:2026-11-02=10,"
                         "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-01=20,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02=40",
            f"a union club's seats fall on 02:00 accounting days (01:59:59 CST on the day before, 02:00:00 on the day); "
            f"a club in no union, and a union club's window before it joined, keep the Chicago day: before {before} / after {after}")
    require(q("live", "SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.fn_ca_club_cash_felt_chicago_basis(uuid,date,date,text,text,text)'::regprocedure") == src_before
            and q("live", "SELECT pg_get_function_arguments('public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)'::regprocedure)")
            == "p_club_id uuid, p_start date, p_end date, p_game text DEFAULT 'ALL'::text, p_stakes text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text"
            and q("live", "SELECT has_function_privilege('service_role', 'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)', 'execute') "
                          "AND NOT has_function_privilege('authenticated', 'public.fn_ca_club_cash_felt(uuid,date,date,text,text,text)', 'execute') "
                          "AND NOT has_function_privilege('service_role', 'public.fn_ca_club_cash_felt_union_basis(uuid,date,date,text,text,text)', 'execute') "
                          "AND NOT has_function_privilege('service_role', 'public.fn_ca_club_cash_felt_chicago_basis(uuid,date,date,text,text,text)', 'execute')") == "t",
            "the installed reader is kept byte for byte; the router has its arguments, defaults and grants; neither basis is callable around it")

    # 20261115080136 (audit D1): a boundary side certified only after its
    # week's invoice is loaded when it reconciles the week to the invoice per
    # club to the cent, and never otherwise.
    run(psql("live"), RECONCILE.read_text())
    for d in ("2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"):
        if q("live", f"SELECT count(*) FROM ca_club_acct_seed_log WHERE acct_day = '{d}'") == "0":
            run(psql("live"), load(d))
    # The week's invoices now predate both kept versions of its closing side.
    run(psql("live"), "UPDATE settlement_invoices si SET created_at = '2026-11-10 00:00+00' FROM settlement_periods sp "
                      "WHERE sp.id = si.period_id AND sp.start_at = '2026-11-02 08:00+00';")
    run(psql("live"), BOUNDARIES)
    require(q("live", "SELECT closing_exact::text || '/' || coalesce(closing_basis, '-') FROM ca_club_acct_boundary_log "
                      "WHERE boundary = '2026-11-09 08:00+00'") == "false/-"
            and '"days_not_whole"' in q("live", "SELECT fn_ca_club_acct_verify_week('fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00')"),
            "a side whose kept versions all follow its week's invoice loads nothing, and a week with an open projection failure is never reconciled")
    # The fixture's deliberate failures of that week are set aside.
    run(psql("live"), "UPDATE ca_club_acct_projection_failures SET resolved_at = now() WHERE resolved_at IS NULL "
                      "AND acct_day BETWEEN '2026-11-02' AND '2026-11-08';")
    model = ("SELECT club_id, round(sum(result), 2) r FROM (SELECT club_id, result FROM ca_club_acct_fact WHERE union_id = "
             "'fade0000-0000-0000-0000-000000000001' AND acct_day BETWEEN '2026-11-02' AND '2026-11-08' UNION ALL "
             "SELECT club_id, result FROM ca_club_acct_fact_journal WHERE union_id = 'fade0000-0000-0000-0000-000000000001' "
             "AND acct_day BETWEEN '2026-11-02' AND '2026-11-08' UNION ALL "
             "SELECT (h->>'club_id')::uuid, (h->>'amount')::numeric FROM ca_union_pnl_boundary_capture k, "
             "jsonb_array_elements(k.value->'holdings') h WHERE k.boundary = '2026-11-09 08:00+00' AND h->>'kind' = "
             "'deferred_tournament_result' AND k.certified_at = (SELECT min(certified_at) FROM ca_union_pnl_boundary_capture "
             "WHERE boundary = '2026-11-09 08:00+00') UNION ALL "
             "SELECT (h->>'club_id')::uuid, -(h->>'amount')::numeric FROM ca_union_pnl_boundary_capture k, "
             "jsonb_array_elements(k.value->'holdings') h WHERE k.boundary = '2026-11-02 08:00+00' AND h->>'kind' = "
             "'deferred_tournament_result' AND k.certified_at = (SELECT min(certified_at) FROM ca_union_pnl_boundary_capture "
             "WHERE boundary = '2026-11-02 08:00+00')) x GROUP BY 1")
    # Every club of the model gets an invoice holding its total; one is a cent off.
    run(psql("live"), f"""
      INSERT INTO settlement_periods (club_id, union_id, start_at, end_at, status)
        SELECT m.club_id, 'fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00', '2026-11-09 08:00+00', 'processing'
          FROM ({model}) m WHERE NOT EXISTS (SELECT 1 FROM settlement_invoices si JOIN settlement_periods sp ON sp.id = si.period_id
            WHERE si.club_id = m.club_id AND sp.start_at = '2026-11-02 08:00+00');
      INSERT INTO settlement_invoices (club_id, period_id, invoice_type, invoice_number, status, breakdown, created_at)
        SELECT sp.club_id, sp.id, 'union_weekly_squareup', 'FX-' || left(sp.club_id::text, 4), 'generated', '{{}}'::jsonb,
               '2026-11-10 00:00+00'
          FROM settlement_periods sp WHERE sp.start_at = '2026-11-02 08:00+00'
           AND NOT EXISTS (SELECT 1 FROM settlement_invoices si WHERE si.period_id = sp.id);
      UPDATE settlement_invoices si SET breakdown = si.breakdown || jsonb_build_object('players_won',
             COALESCE((SELECT m.r FROM ({model}) m WHERE m.club_id = si.club_id), 0)
             + CASE WHEN si.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4' THEN 0.01 ELSE 0 END)
        FROM settlement_periods sp WHERE sp.id = si.period_id AND sp.start_at = '2026-11-02 08:00+00';""")
    v = q("live", "SELECT fn_ca_club_acct_verify_week('fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00')")
    require('"verified": false' in v and '"does_not_reconcile"' in v
            and q("live", "SELECT closing_exact::text FROM ca_club_acct_boundary_log WHERE boundary = '2026-11-09 08:00+00'") == "false",
            "a kept version that leaves any club a cent away from its invoice is not loaded: " + v[:300])
    run(psql("live"), "UPDATE settlement_invoices si SET breakdown = si.breakdown || jsonb_build_object('players_won', "
                      "(si.breakdown->>'players_won')::numeric - 0.01) FROM settlement_periods sp WHERE sp.id = si.period_id "
                      "AND sp.start_at = '2026-11-02 08:00+00' AND si.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';")
    run(psql("live"), BOUNDARIES)
    require(q("live", "SELECT closing_exact::text || '/' || closing_basis || '/' || (closing_md5 = (SELECT value_md5 FROM "
                      "ca_union_pnl_boundary_capture WHERE boundary = '2026-11-09 08:00+00' ORDER BY certified_at LIMIT 1))::text "
                      "FROM ca_club_acct_boundary_log WHERE boundary = '2026-11-09 08:00+00'") == "true/reconciled_to_invoice/true"
            and q("live", "SELECT opening_exact::text || '/' || opening_basis FROM ca_club_acct_boundary_log "
                          "WHERE boundary = '2026-11-02 08:00+00'") == "true/reconciled_to_invoice"
            and q("live", "SELECT sum(result) FROM ca_club_acct_fact WHERE src = 2 AND acct_day = '2026-11-08' "
                          "AND last_at = '2026-11-09 08:00+00'") == "12.00",
            "reloading the boundary loads the earliest kept version once the week reconciles to its invoice to the cent")

    # 20261115205153: the union's own Club Data screen gives each club. The
    # union-basis screen as installed (20261115164547) is installed here from
    # its own file behind a stand-in router; the new file then replaces it
    # through its own md5 guard. Every club's answer is unchanged, the union's
    # answer gains only `clubs`, and its rows add up to the page totals and
    # equal each club's own answer for the same window and filters.
    run(psql("live"), """
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
      ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS status text, ADD COLUMN IF NOT EXISTS created_at timestamptz,
        ADD COLUMN IF NOT EXISTS small_blind numeric;
      CREATE TABLE IF NOT EXISTS public.club_members (club_id uuid, user_id uuid, role text);
      CREATE OR REPLACE FUNCTION public.fn_club_role_rank(p_role text) RETURNS int LANGUAGE sql IMMUTABLE AS $f$ SELECT 0 $f$;
      CREATE TABLE IF NOT EXISTS public.tournaments (id uuid PRIMARY KEY, name text, tournament_type text, status text,
        variant text, game_type text, start_time timestamptz);
      CREATE OR REPLACE FUNCTION public.fn_ca_club_data_scope(p_club_id uuid) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT 'club' $f$;""")
    run(psql("live"), "INSERT INTO public.tournaments (id, name, tournament_type, status) SELECT DISTINCT game_id, 'T', 'MTT', "
                      "'COMPLETED' FROM ca_club_acct_fact_ct WHERE kind = 'TOURNAMENT' ON CONFLICT DO NOTHING;")
    LONG = M / "20261115164547_club_data_union_screen_reads_the_window_twice_not_six_times.sql"
    BYCLUB = M / "20261115205153_club_data_union_screen_shows_each_club.sql"
    long_sql = LONG.read_text()
    fn = long_sql[long_sql.index("CREATE OR REPLACE FUNCTION public.ca_club_data_screen_union_basis"):long_sql.index("REVOKE ALL ON FUNCTION public.ca_club_data_screen_union_basis")]
    run(psql("live"), fn + "\nREVOKE ALL ON FUNCTION public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer) "
        "FROM PUBLIC, anon, authenticated, service_role;\n"
        "CREATE OR REPLACE FUNCTION public.ca_club_data_screen(p_club_id uuid, p_start date DEFAULT NULL, p_end date DEFAULT NULL, "
        "p_game text DEFAULT 'ALL', p_stakes text DEFAULT 'ALL', p_search text DEFAULT NULL, p_limit integer DEFAULT 200) "
        "RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT public.ca_club_data_screen_union_basis(p_club_id, p_start, p_end, "
        "p_game, p_stakes, p_search, p_limit) $f$;")
    UNION = "fade0000-0000-0000-0000-000000000001"
    MEMBERS = ["a41434bb-8d0c-400a-8f0d-e8b3d65afed4", "a0000000-0000-0000-0000-000000000001",
               "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3", "946747c6-b991-4220-b0cb-effbea46ecd2"]
    SCREENS = [("ALL", "ALL", "NULL"), ("HOLDEM", "ALL", "NULL"), ("MTT", "ALL", "NULL"), ("ALL", "MICRO", "NULL")]

    def screen(club, g, s, qq):
        # A seated table with no fact in the window is dated now() (its
        # activity_at); that one clock reading is set aside with generated_at.
        return q("live", f"SELECT (jsonb_set(a, '{{rows}}', COALESCE((SELECT jsonb_agg(CASE WHEN r->>'on_felt' IS NOT NULL "
                         "AND (r->>'fee')::numeric = 0 AND (r->>'winnings')::numeric = 0 THEN r - 'activity_at' ELSE r END ORDER BY o) "
                         "FROM jsonb_array_elements(a->'rows') WITH ORDINALITY x(r, o)), '[]'::jsonb)) - 'generated_at')::text "
                         f"FROM (SELECT ca_club_data_screen_union_basis('{club}', '2026-11-02', '2026-11-08', '{g}', '{s}', {qq}, 200) a) y")

    before = {(c, sc): screen(c, *sc) for c in [UNION] + MEMBERS + ["5ca1ab1e-0000-0000-0000-000000000001"] for sc in SCREENS}
    require(q("live", "SELECT md5(pg_get_functiondef('public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure))")
            == "5e488a363b5555fa4bee8c20d8b5f67a",
            "the union-basis screen installed from 20261115164547 has production's md5 (the new file's preimage)")
    by_club = BYCLUB.read_text()
    run(psql("live"), "SET ROLE authenticated;\n" + by_club, expect_fail="maintained installer")
    run(psql("live"), by_club)
    run(psql("live"), by_club, expect_fail="already shows each club")
    after = {k: screen(k[0], *k[1]) for k in before}
    require(all(after[k] == before[k] for k in before if k[0] != UNION),
            "every club's answer is the same jsonb, screen for screen (plain, Hold'em, MTT, micro stakes)"
            + "".join(f"\nDIFF {k}:\n{before[k]}\n{after[k]}" for k in before if k[0] != UNION and after[k] != before[k])[:4000])
    for sc in SCREENS:
        k = (UNION, sc)
        require(q("live", f"SELECT ($${after[k]}$$::jsonb - 'clubs')::text") == before[k]
                and q("live", f"SELECT jsonb_typeof($${after[k]}$$::jsonb -> 'clubs')") == "array",
                f"the union's {sc[0]}/{sc[1]} answer gains only its clubs; every other key is unchanged")
        rows = q("live", f"SELECT string_agg((r->>'union_account') || ':' || (r->>'club_id') || '=' || (r->>'fee') || '/' || (r->>'total_winnings'), ',' "
                         f"ORDER BY o) FROM jsonb_array_elements($${after[k]}$$::jsonb -> 'clubs') WITH ORDINALITY x(r, o)")
        sums = q("live", f"SELECT (SELECT sum((r->>'fee')::numeric) FROM jsonb_array_elements(a->'clubs') r) = (a->'summary'->>'fee')::numeric "
                         f"AND (SELECT sum((r->>'total_winnings')::numeric) FROM jsonb_array_elements(a->'clubs') r) = (a->'summary'->>'total_winnings')::numeric "
                         f"AND jsonb_array_length(a->'clubs') = 5 FROM (SELECT $${after[k]}$$::jsonb a) x")
        own = ",".join(f"false:{c}=" + q("live", f"SELECT (a->'summary'->>'fee') || '/' || (a->'summary'->>'total_winnings') "
                                               f"FROM (SELECT $${after[(c, sc)]}$$::jsonb a) x") for c in MEMBERS)
        mine = ",".join(r for r in rows.split(",") if r.startswith("false:"))
        require(sums == "t" and sorted(mine.split(",")) == sorted(own.split(","))
                and rows.split(",")[-1].startswith(f"true:{UNION}="),
                f"the union's {sc[0]}/{sc[1]} clubs add up to its totals, each member club's row is that club's own answer, "
                f"and the union account is last: {rows}")
    nonzero = q("live", f"SELECT count(*) FROM jsonb_array_elements($${after[(UNION, SCREENS[0])]}$$::jsonb -> 'clubs') r "
                        "WHERE (r->>'fee')::numeric <> 0 OR (r->>'total_winnings')::numeric <> 0")
    require(int(nonzero) >= 2, f"the fixture's union week has figures in more than one club ({nonzero})")
    require(q("live", "SELECT p.provolatile::text || CASE WHEN p.prosecdef THEN 's' ELSE 'i' END || "
                      "(NOT has_function_privilege('authenticated', p.oid, 'execute'))::text FROM pg_proc p "
                      "WHERE p.oid = 'public.ca_club_data_screen_union_basis(uuid,date,date,text,text,text,integer)'::regprocedure") == "sstrue",
            "the replaced screen stays STABLE SECURITY DEFINER and is not callable around its router")

    require(q("live", "SELECT NOT has_table_privilege('authenticated','public.ca_club_acct_fact','select') "
                      "AND NOT has_table_privilege('anon','public.ca_club_acct_fact','select') "
                      "AND NOT has_function_privilege('authenticated','public.fn_ca_club_acct_seed_day(date,boolean)','execute')") == "t",
            "no signed-in caller reads the model or runs the seed directly")
    # Owner 2026-11-16: Pacific midnight, including fall-back Sunday. Exercise
    # the real projection, stale seed receipts, the maintained rebuild, the
    # screen and coverage on PostgreSQL; never install a production probe.
    run(psql("live"), """
      CREATE FUNCTION public.ca_club_data_snapshot_v2_union_basis(uuid,date,date,text,text,text,integer)
        RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{"day_basis":"America/Chicago 02:00"}'::jsonb $f$;
      CREATE FUNCTION public.ca_club_data_player_totals_union_basis(uuid,date,date,text,text,text)
        RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT '{"day_basis":"America/Chicago 02:00"}'::jsonb $f$;
      INSERT INTO public.accounting_cash_rake_sources
        (id,rake_record_id,player_id,club_id,union_id,earned_at,rake_credit) VALUES
        ('5c000000-0000-0000-0000-000000009001','e0000000-0000-0000-0000-000000000001',
         '11111111-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         'fade0000-0000-0000-0000-000000000001','2026-11-01 06:59:59.999999+00',1),
        ('5c000000-0000-0000-0000-000000009002','e0000000-0000-0000-0000-000000000001',
         '11111111-0000-0000-0000-000000000001','a41434bb-8d0c-400a-8f0d-e8b3d65afed4',
         'fade0000-0000-0000-0000-000000000001','2026-11-01 07:00:00+00',2);
    """)
    require(q("live", "SELECT fn_ca_accounting_day('2026-11-01 07:30+00')") == "2026-10-31",
            "preimage reproduces the wrong date for Pacific November 1 at 00:30")
    run(psql("live"), load("2026-10-31", True))
    pacific = (M / "20261116141640_club_data_accounting_days_use_pacific_midnight.sql").read_text()
    run(psql("live"), pacific)
    require(q("live", "SELECT fn_ca_accounting_day('2026-11-01 07:30+00') = date '2026-11-01' "
                      "AND fn_ca_accounting_day_start('2026-11-01') = timestamptz '2026-11-01 07:00+00' "
                      "AND fn_ca_accounting_day_start('2026-11-02') - fn_ca_accounting_day_start('2026-11-01') = interval '25 hours'") == "t",
            "Pacific midnight and its 25-hour fall-back day agree with the zone database")
    require(q("live", "SELECT NOT EXISTS(SELECT FROM ca_club_acct_seed_log WHERE acct_day IN ('2026-10-31','2026-11-01')) "
                      "AND EXISTS(SELECT FROM ca_club_acct_seed_log WHERE acct_day='2026-11-02')") == "t",
            "only receipts whose day boundaries changed are invalidated; unrelated history stays certified")
    require(q("live", "SELECT fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-10-31','2026-11-01')->>'complete'") == "false",
            "affected history is explicitly incomplete until rebuilt from source")
    run(psql("live"), load("2026-10-31", True) + load("2026-11-01", True))
    require(q("live", "SELECT string_agg(acct_day::text || ':' || fee, ',' ORDER BY acct_day) FROM "
                      "(SELECT acct_day,sum(fee) fee FROM ca_club_acct_fact WHERE club_id='a41434bb-8d0c-400a-8f0d-e8b3d65afed4' "
                      "AND acct_day IN ('2026-10-31','2026-11-01') GROUP BY 1) s") == "2026-10-31:1,2026-11-01:3.00",
            "maintained history rebuild moves the boundary event exactly once and preserves the pair's total")
    require(q("live", "SELECT ca_club_data_screen_union_basis('a41434bb-8d0c-400a-8f0d-e8b3d65afed4', '2026-11-02','2026-11-08')->>'day_basis'")
            == "America/Los_Angeles 00:00",
            "the real screen states the Pacific basis after metadata replacement")
    require(q("live", "SELECT (fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-02','2026-11-08')->>'day_zone') "
                      "|| '/' || (fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-02','2026-11-08')->>'day_boundary')")
            == "America/Los_Angeles/00:00", "coverage states the real Pacific boundary")
    # Original-source BBJ reporting extends this same aggregate/journal and
    # finite history route. Exact production preimages, no financial replay.
    recon = ROOT / 'tests/fixtures/club-data-reconciliation'
    defs = json.loads((recon / 'preimages.json').read_text())
    run(psql('live'), '\n'.join(line for line in (ROOT / 'tests/fixtures/club-data-report-db/rake-v2-fixture.sql').read_text().splitlines()
                               if line.startswith(('CREATE TABLE ca_club_data_exports', 'CREATE TABLE ca_club_data_export_rows'))))
    run(psql('live'), 'SET check_function_bodies=false;' + '\n'.join(x['definition'] + ';' for x in defs))
    run(psql('live'), (recon / 'before.sql').read_text())
    accepted_defs = json.loads((recon / 'accepted-fee-preimages.json').read_text())
    run(psql('live'), 'SET check_function_bodies=false;' + '\n'.join(x['definition']+';' for x in accepted_defs))
    # Execute the exact DB fee-presence/amount validator in a private isolation;
    # full financial bodies are installed byte-exact above for source guards.
    fee_contract = json.loads((recon / 'accepted-fee-contract.json').read_text())
    assert fee_contract['guard'] in next(x['definition'] for x in accepted_defs if x['proname']=='fn_ca_commit_hand_settlement'), 'isolated validator must be exact original production source'
    contract_sources = {x['proname']: ''.join(x['definition'].split()) for x in accepted_defs}
    require('RETURNpublic.fn_ca_commit_hand_settlement_before_lease_generation(p_table_id,p_hand_number,p_stacks,p_rake,p_bbj,' in contract_sources['fn_ca_commit_hand_settlement_exact_before_obligations']
            and 'v_stack_result:=public.fn_ca_settle_hand_stacks_absolute(p_table_id,p_hand_number,v_normalized_stacks,p_rake,p_bbj,' in contract_sources['fn_ca_commit_hand_settlement_before_lease_generation']
            and 'VALUES(p_table_id,p_hand_number,v_hand_id,v_commit_hash,v_stack_result)' in contract_sources['fn_ca_commit_hand_settlement_before_lease_generation']
            and "'net_deltas',round(v_delta_sum,2),'rake',p_rake,'bbj',p_bbj" in contract_sources['fn_ca_settle_hand_stacks_absolute'],
            'byte-exact original settlement forwards and persists the same accepted rake and BBJ numeric amounts')
    run(psql('live'), "CREATE FUNCTION pg_temp.check_accepted_fee(p_rake numeric,p_bbj numeric,p_post_commit_obligations jsonb,v_diamond boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $isolated$ DECLARE p_hand_row jsonb:='{\"pot_size\":10,\"big_blind\":1,\"_accepted_post_commit_facts\":{\"contributions\":{},\"returned_uncalled\":{}}}';BEGIN " + fee_contract['guard'] + " END $isolated$; SELECT pg_temp.check_accepted_fee(0,1,'{\"rake\":null,\"bbj_contribution\":{\"amount\":1,\"big_blind\":1}}');")
    # pg_temp is session-owned, so create and exercise each isolated validator
    # together; no fixture function is made browser-reachable.
    isolated = "CREATE FUNCTION pg_temp.check_accepted_fee(p_rake numeric,p_bbj numeric,p_post_commit_obligations jsonb,v_diamond boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $isolated$ DECLARE p_hand_row jsonb:='{\"pot_size\":10,\"big_blind\":1,\"_accepted_post_commit_facts\":{\"contributions\":{},\"returned_uncalled\":{}}}';BEGIN " + fee_contract['guard'] + " END $isolated$;"
    for rake, bbj, payload in [(0,0,'{"rake":null,"bbj_contribution":{"amount":1,"big_blind":1}}'), (0,1,'{"rake":null,"bbj_contribution":null}'), (0,1,'{"rake":null,"bbj_contribution":{"amount":2,"big_blind":1}}'), (1,0,'{"rake":null,"bbj_contribution":null}')]:
        run(psql('live'), isolated + f"SELECT pg_temp.check_accepted_fee({rake},{bbj},'{payload}');", expect_fail='post_commit_fee_mismatch')
    require(True, 'actual accepted-hand DB validator refuses fee presence and amount contradictions before compact receipt qualification')
    upgrade = (M / '20261116230906_data_reconciliation_exposes_original_bbj_contributions_and_a.sql').read_text()
    split = json.loads(run([shutil.which('node'), '--input-type=module', '-e',
        "import {readFileSync} from 'node:fs';import {splitConcurrentPreamble} from './scripts/ci/migration-concurrent-preamble.mjs';console.log(JSON.stringify(splitConcurrentPreamble(readFileSync(process.argv[1],'utf8'))));",
        str(M / '20261116230906_data_reconciliation_exposes_original_bbj_contributions_and_a.sql')]).stdout)
    require(split['ok'] and len(split['indexes']) == 1, 'the maintained concurrent preamble selects exactly one sparse report index')
    run(psql('live'), split['body'], expect_fail='CLUB_DATA_BBJ_SPARSE_INDEX_NOT_QUALIFIED')
    run(psql('live'), "CREATE INDEX CONCURRENTLY ca_club_bbj_only_commit_span ON hand_atomic_commits ((1/(hand_number-hand_number)));", expect_fail='division by zero')
    require(q('live', "SELECT NOT indisvalid FROM pg_index WHERE indexrelid='ca_club_bbj_only_commit_span'::regclass") == 't', 'failed concurrent build leaves its original INVALID catalog receipt visible')
    run(psql('live'), split['body'], expect_fail='CLUB_DATA_BBJ_SPARSE_INDEX_NOT_QUALIFIED')
    require(q('live', "SELECT to_regprocedure('public.fn_ca_club_acct_bbj_gap_days(uuid,date,date)') IS NULL AND NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='ca_club_acct_fact' AND column_name='bbj_gross')") == 't', 'an absent or INVALID sparse index refuses before installing fields or readers')
    # Retain both failed previous indexes as the production recovery does.
    run(psql('live'), "CREATE INDEX CONCURRENTLY ca_club_bbj_only_commit_span_nov9 ON hand_atomic_commits ((1/(hand_number-hand_number)));", expect_fail='division by zero')
    for index in split['indexes']:
        run(psql('live'), index['statement'])
    require(q('live', "SELECT NOT indisvalid FROM pg_index WHERE indexrelid='ca_club_bbj_only_commit_span'::regclass") == 't', 'qualified replacement preserves the failed original index artifact')
    original_accept = next(x['definition'] for x in accepted_defs if x['proname']=='fn_ca_commit_hand_settlement')
    run(psql('live'), 'SET check_function_bodies=false;' + original_accept.replace('DECLARE', '-- qualification drift\nDECLARE', 1))
    run(psql('live'), split['body'], expect_fail='CLUB_DATA_BBJ_ACCEPTED_FEE_CONTRACT_CHANGED')
    run(psql('live'), 'SET check_function_bodies=false;' + original_accept)
    require(True, 'changed original DB fee authority refuses before report feature installation')
    old_recon = background()
    old_recon.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT pg_current_xact_id(); SELECT count(*) FROM clubs;\n\\echo RECON_SNAPSHOT\n")
    old_recon.stdin.flush()
    while old_recon.stdout.readline().strip() != 'RECON_SNAPSHOT':
        if old_recon.poll() is not None:
            raise AssertionError('pre-attachment BBJ snapshot did not open')
    run(psql('live'), "SET TIME ZONE 'America/Chicago';" + split['body'])
    run(psql('live'), parts('2026-11-10', True), expect_fail='CLUB_DATA_BBJ_PREATTACHMENT_TRANSACTION_STILL_OPEN')
    finish(old_recon, 'COMMIT;')
    require(True, 'BBJ history waits for every pre-attachment original-source snapshot')
    run(psql('live'), (recon / 'after.sql').read_text())
    require(q('live', "SELECT fn_ca_club_acct_reconciliation('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-10','2026-11-10','{}')->>'complete'") == 'false',
            'old BBJ projection defaults never certify zero contributions')
    bbj_delta = "SELECT fn_ca_club_acct_put(jsonb_build_array(jsonb_build_object('club_id','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','acct_day','2026-11-10','kind','CASH','game_id','c0000000-0000-0000-0000-000000000001','user_id','11111111-0000-0000-0000-000000000001','bbj_gross',%s,'at','2026-11-10 12:00Z')),0::smallint);"
    holder = background()
    holder.stdin.write('BEGIN;' + bbj_delta % '.25' + '\n\\echo BBJ_LOCKED\n')
    holder.stdin.flush()
    while holder.stdout.readline().strip() != 'BBJ_LOCKED':
        if holder.poll() is not None:
            raise AssertionError('BBJ projection owner did not open')
    run(psql('live'), "SET lock_timeout='50ms';" + bbj_delta % '.75')
    require(q('live', "SELECT EXISTS(SELECT 1 FROM ca_club_acct_fact_journal WHERE acct_day='2026-11-10' AND bbj_gross=.75)") == 't',
            'BBJ aggregate contention journals immediately rather than waiting on another writer')
    finish(holder, 'COMMIT;')
    during_rebuild = """DO $test$ BEGIN
      IF fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-10','2026-11-10')->>'complete' <> 'false'
       OR NOT (fn_ca_club_acct_coverage('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-10','2026-11-10')->'missing_days' @> '["2026-11-10"]') THEN
       RAISE EXCEPTION 'owning accounting coverage certified a partial rebuild';END IF;
      BEGIN PERFORM fn_ca_club_acct_reconciliation('a41434bb-8d0c-400a-8f0d-e8b3d65afed4','2026-11-10','2026-11-10','{}');
       RAISE EXCEPTION 'partial accounting rebuild answered a headline';
      EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE:%' THEN RAISE; END IF; END;
    END $test$;"""
    run(psql('live'), parts('2026-11-10', True, between=during_rebuild))
    run(psql('live'), (recon / 'check.sql').read_text())
    require(q('live', "SELECT bbj_version FROM ca_club_acct_seed_log WHERE acct_day='2026-11-10'") == '1',
            'the existing finite snapshot loader qualifies the new BBJ basis')
    before_recon = q('live', "SELECT md5(string_agg(f::text,',' ORDER BY club_id,acct_day,game_id,user_id,src)) FROM ca_club_acct_fact f WHERE acct_day='2026-11-10'")
    run(psql('live'), parts('2026-11-10', True))
    require(q('live', "SELECT md5(string_agg(f::text,',' ORDER BY club_id,acct_day,game_id,user_id,src)) FROM ca_club_acct_fact f WHERE acct_day='2026-11-10'") == before_recon,
            'versioned BBJ rebuild subtracts live and journal once and is idempotent')
    run(psql('live'), (recon / 'check.sql').read_text())
    require(q('live', "SELECT NOT has_function_privilege('authenticated','fn_ca_club_acct_reconciliation(uuid,date,date,jsonb,uuid[],uuid[])','EXECUTE') AND NOT has_function_privilege('service_role','fn_ca_club_acct_bbj_source_missing(uuid,uuid)','EXECUTE')") == 't',
            'no browser or service role bypasses reconciliation reader scope')
    run(psql('live'), (recon / 'bbj-only.sql').read_text())
    require(True, 'BBJ-only source gaps mask only reconciliation on original accepted/bank dates, keeping posted headlines unchanged')
    predicate = split['indexes'][0]['statement'].split(' WHERE ', 1)[1].rstrip(';')
    plan = json.loads(q('live', "EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT hand_id FROM hand_atomic_commits WHERE " + predicate +
        " AND tstzrange(committed_at,coalesce(post_commit_completed_at,'infinity'::timestamptz),'[]') && tstzrange('2026-11-10 08:00Z','2026-11-11 08:00Z','[)')"))
    require('ca_club_bbj_only_commit_receipt_span' in json.dumps(plan), 'normal planner scopes the sparse BBJ interval index with 20k regular and 1k older sparse decoys')
    require(q('live', "SELECT NOT has_function_privilege('authenticated','fn_ca_club_acct_bbj_gap_days(uuid,date,date)','EXECUTE')") == 't',
            'the sparse original-source qualification helper remains private')
    print('BBJ sparse candidate plan: ' + json.dumps(plan), flush=True)
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
