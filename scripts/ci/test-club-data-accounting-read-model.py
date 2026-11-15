#!/usr/bin/env python3
"""Native qualification of 20261115020010, 20261115020011, 20261115063000 and 20261115075440. No production access.

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
    parts = ",".join('{"earning_club_id": "2a1132b9-5ba2-42e6-9f01-30a7fcffebe3", '
                     f'"user_id": "22222222-0000-0000-0000-{i:012d}", "observed_stack_delta": 0.01}}' for i in range(40))
    run(psql("live"), "INSERT INTO union_pnl_cash_outcomes (table_id, hand_number, hand_id, recognized_at, payload_hash, game_scope, evidence) "
        "VALUES ('c0000000-0000-0000-0000-000000000002', 40, gen_random_uuid(), '2026-11-05 12:00+00', 'c40', "
        "'{\"game_union_id\": \"fade0000-0000-0000-0000-000000000001\"}', '{\"status\": \"ready\"}'); "
        "INSERT INTO union_pnl_cash_outcome_touches VALUES ('c0000000-0000-0000-0000-000000000002', 40, '2026-11-05 12:00+00', "
        f"'fade0000-0000-0000-0000-000000000001', false, '1', '[{parts}]');")
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
    run(psql("live"), "ALTER TABLE ca_club_acct_projection_failures ADD CONSTRAINT fixture_refuses CHECK (false) NOT VALID; "
                      "INSERT INTO fixture_bbj_outage VALUES (true);")
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
    run(psql("live"), "ALTER TABLE ca_club_acct_projection_failures DROP CONSTRAINT fixture_refuses;")

    require(q("live", "SELECT NOT has_table_privilege('authenticated','public.ca_club_acct_fact','select') "
                      "AND NOT has_table_privilege('anon','public.ca_club_acct_fact','select') "
                      "AND NOT has_function_privilege('authenticated','public.fn_ca_club_acct_seed_day(date,boolean)','execute')") == "t",
            "no signed-in caller reads the model or runs the seed directly")
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
