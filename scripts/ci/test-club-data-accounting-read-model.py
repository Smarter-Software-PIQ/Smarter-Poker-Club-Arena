#!/usr/bin/env python3
"""Native qualification of 20261115020010 and 20261115020011. No production access.

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
VIEWS = M / "20261115034141_club_data_accounting_reader_views.sql"
ROUTE = M / "20261115034142_club_data_readers_route_union_clubs_to_the_accounting_model.sql"
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
                "a0000000-0000-0000-0000-000000000001:2026-11-04=0.00/-3.00,a0000000-0000-0000-0000-000000000001:2026-11-08=0.00/12.00,"
                "a0000000-0000-0000-0000-000000000001:2026-11-09=0.00/-16.00,"
                "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-01=1.00/0.00,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-02=7.50/-6.40,"
                "a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-03=6.00/1.00,a41434bb-8d0c-400a-8f0d-e8b3d65afed4:2026-11-04=0.00/3.00")
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
                   '"2026-11-07", "2026-11-08"], "provisional_from": null, "not_invoice_exact_days": []}',
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

    require(q("live", "SELECT NOT has_table_privilege('authenticated','public.ca_club_acct_fact','select') "
                      "AND NOT has_table_privilege('anon','public.ca_club_acct_fact','select') "
                      "AND NOT has_function_privilege('authenticated','public.fn_ca_club_acct_seed_day(date,boolean)','execute')") == "t",
            "no signed-in caller reads the model or runs the seed directly")
    print('{"native_fixture": "passed", "production_installation": false}')
finally:
    if started:
        subprocess.run([PG / "pg_ctl", "-D", data, "-m", "immediate", "stop"], capture_output=True, env=ENV)
    shutil.rmtree(cluster, ignore_errors=True)
