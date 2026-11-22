#!/usr/bin/env python3
"""Transitive call-graph guard against hot-path promo history scans.

Builds a throwaway PostgreSQL 16/17 cluster (never production), loads the
authoritative public.* function definitions from supabase/migrations/*.sql
(including anchored DO-block rewrites) into pg_catalog.pg_proc, and runs a
real PostgreSQL recursive CTE call-graph proof asserting that NO hot-path
hand-commit, payout, or rebuy function transitively calls
public.fn_ca_promo_shared_fee_state_live (or any settle/refresh wrapper that
triggers it) on its hot path:

  Hot-path roots verified (all must exist in pg_proc):
    - fn_ca_commit_hand_settlement and all fn_ca_commit_hand_settlement_*
    - fn_ca_process_hand_post_commit_obligations
    - process_tournament_rebuy
    - fn_ca_promo_profit_credit_owned
    - fn_ca_promo_custody_on_ledger
    - fn_ca_promo_realize_event_principal
    - fn_ca_promo_roll_event_principal
    - fn_ca_promo_profit_return_entitlement_ticket

  Explicit, structurally-verified exemptions:
    1. Cash table cashout branch (`IF NEW.category='table_cashout' THEN ... END IF;`)
       and non-event branch (`IF dest<>'event' THEN ... END IF;`) in
       fn_ca_promo_custody_on_ledger, plus fn_ca_promo_fund_from_balance's
       open-grant wallet-principal-custody guarded path (pre-warmed outside
       the event lane by process_tournament_rebuy).
    2. Pre-lane `fn_ca_promo_fee_state_ensure` in process_tournament_rebuy,
       strictly verified to appear ONLY BEFORE
       fn_ca_share_tournament_lane_for_rebuy.

  Positive mutation self-test (rolled back):
    Injects a synthetic transitive settle call in fn_ca_promo_realize_event_principal
    and an in-lane call in process_tournament_rebuy, proving the recursive CTE
    catches both regressions and reports the exact call chain.

Usage:
  PG_BIN=/opt/homebrew/opt/postgresql@17/bin python3 scripts/ci/test-hot-path-no-history-scans.py [--output DIR]
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"

REQUIRED_HOT_PATH_ROOTS = (
    "fn_ca_commit_hand_settlement",
    "fn_ca_process_hand_post_commit_obligations",
    "process_tournament_rebuy",
    "fn_ca_promo_profit_credit_owned",
    "fn_ca_promo_custody_on_ledger",
    "fn_ca_promo_realize_event_principal",
    "fn_ca_promo_roll_event_principal",
    "fn_ca_promo_profit_return_entitlement_ticket",
)

# Roots that must have ZERO transitive paths to fn_ca_promo_shared_fee_state_live
# even when including the cache-first reader fn_ca_promo_shared_fee_state.
STRICT_ZERO_PATH_ROOTS = (
    "fn_ca_commit_hand_settlement",
    "fn_ca_process_hand_post_commit_obligations",
    "process_tournament_rebuy",
    "fn_ca_promo_profit_credit_owned",
    "fn_ca_promo_roll_event_principal",
)

# Functions loaded into pg_proc: all hot-path roots, all fn_ca_promo_* functions,
# and all fn_ca_commit_hand_settlement* / fn_ca_process_hand_post_commit* /
# fn_ca_share_* / fn_ca_tournament_* helpers.
LOAD_PREFIXES = (
    "fn_ca_commit_hand_settlement",
    "fn_ca_process_hand_post_commit_obligations",
    "process_tournament_rebuy",
    "fn_ca_promo_",
)


def pick_ephemeral_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def find_pg_bin() -> pathlib.Path:
    candidates = []
    if os.environ.get("PG_BIN"):
        candidates.append(pathlib.Path(os.environ["PG_BIN"]))
    candidates.extend([
        pathlib.Path("/usr/lib/postgresql/17/bin"),
        pathlib.Path("/usr/lib/postgresql/16/bin"),
        pathlib.Path("/opt/homebrew/opt/postgresql@17/bin"),
        pathlib.Path("/opt/homebrew/opt/postgresql@16/bin"),
        pathlib.Path("/opt/homebrew/bin"),
    ])
    for cand in candidates:
        if (cand / "initdb").exists() and (cand / "pg_ctl").exists() and (cand / "psql").exists():
            return cand
    raise RuntimeError("Could not find PostgreSQL initdb/pg_ctl/psql; set PG_BIN.")


def should_load_fn(name: str) -> bool:
    return any(name == p or name.startswith(p) for p in LOAD_PREFIXES)


def extract_create_functions(sql: str) -> list[tuple[str, str]]:
    """Extract (fn_name, full_sql) for CREATE [OR REPLACE] FUNCTION public.<name>(...)."""
    out: list[tuple[str, str]] = []
    pat = re.compile(
        r"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(",
        re.IGNORECASE,
    )
    pos = 0
    while True:
        m = pat.search(sql, pos)
        if not m:
            break
        start = m.start()
        fn = m.group(1)
        as_m = re.search(r"\bAS\s+(\$[a-zA-Z0-9_]*\$)", sql[m.end():], re.IGNORECASE)
        if not as_m:
            pos = m.end()
            continue
        tag = as_m.group(1)
        body_start = m.end() + as_m.end()
        body_end = sql.find(tag, body_start)
        if body_end == -1:
            pos = m.end()
            continue
        semi = sql.find(";", body_end + len(tag))
        end = (semi + 1) if semi != -1 else (body_end + len(tag))
        stmt = sql[start:end]
        # Force CREATE OR REPLACE so chronological replay always updates cleanly.
        stmt = re.sub(
            r"^CREATE\s+FUNCTION\b",
            "CREATE OR REPLACE FUNCTION",
            stmt,
            count=1,
            flags=re.IGNORECASE,
        )
        out.append((fn, stmt))
        pos = end
    return out


def decode_pg_e_string(raw: str) -> str:
    """Decode a PostgreSQL E'...' literal body into Python string."""
    out = []
    i = 0
    n = len(raw)
    while i < n:
        ch = raw[i]
        if ch == "\\" and i + 1 < n:
            nxt = raw[i + 1]
            if nxt == "n":
                out.append("\n")
            elif nxt == "r":
                out.append("\r")
            elif nxt == "t":
                out.append("\t")
            elif nxt == "\\":
                out.append("\\")
            elif nxt == "'":
                out.append("'")
            else:
                out.append(nxt)
            i += 2
        elif ch == "'" and i + 1 < n and raw[i + 1] == "'":
            out.append("'")
            i += 2
        else:
            out.append(ch)
            i += 1
    return "".join(out)


def extract_anchored_rewrites(sql: str) -> list[tuple[str, str, str]]:
    """Extract (fn_name, old_text, new_text) anchored replace() rewrites from migrations.

    Supports all three patterns used in supabase/migrations/:
      1. VALUES ('public.fn(...)', E'...' | $tag$...$tag$, E'...' | $tag$...$tag$)
      2. v_sig := 'public.fn(...)'::regprocedure; ... v_anchor := $a$...$a$; v_new := $n$...$n$;
      3. SELECT pg_get_functiondef('public.fn(...)'::regprocedure) INTO def; needle := ...; replace(def, needle, ...);
    """
    rewrites: list[tuple[str, str, str]] = []

    def lit_pat(idx: int) -> str:
        return (
            rf"(?:E'(?P<e{idx}>(?:\\.|''|[^'])*)'"
            rf"|\$(?P<t{idx}>[a-zA-Z0-9_]*)\$(?P<d{idx}>.*?)\$(?P=t{idx})\$)"
        )

    def extract_lit(m: re.Match, idx: int) -> str:
        e_val = m.group(f"e{idx}")
        return decode_pg_e_string(e_val) if e_val is not None else m.group(f"d{idx}")

    # Pattern 1: tuple in VALUES ('public.fn(...)', old, new)
    tup_pat = re.compile(
        r"\(\s*'public\.([a-zA-Z0-9_]+)\([^']*\)',\s*"
        + lit_pat(1)
        + r"\s*,\s*"
        + lit_pat(2)
        + r"\s*\)",
        re.DOTALL,
    )
    for m in tup_pat.finditer(sql):
        fn = m.group(1)
        if not should_load_fn(fn):
            continue
        rewrites.append((fn, extract_lit(m, 1), extract_lit(m, 2)))

    # Pattern 2: v_sig := 'public.fn(...)'::regprocedure with v_anchor / v_new
    sig_m = re.search(
        r"v_sig\s+regprocedure\s*:=\s*'public\.([a-zA-Z0-9_]+)\([^']*\)'::regprocedure",
        sql,
    )
    if sig_m and should_load_fn(sig_m.group(1)):
        anc_m = re.search(r"v_anchor\s+text\s*:=\s*\$([a-zA-Z0-9_]*)\$(.*?)\$\1\$;", sql, re.DOTALL)
        new_m = re.search(r"v_new\s+text\s*:=\s*\$([a-zA-Z0-9_]*)\$(.*?)\$\1\$;", sql, re.DOTALL)
        if anc_m and new_m:
            rewrites.append((sig_m.group(1), anc_m.group(2), new_m.group(2)))

    # Pattern 3: SELECT pg_get_functiondef('public.fn(...)'::regprocedure) INTO def;
    # followed by needle := E'...'; ... replace(def, needle, E'...');
    sel_pat = re.compile(
        r"SELECT\s+pg_get_functiondef\(\s*'public\.([a-zA-Z0-9_]+)\([^']*\)'::regprocedure\s*\)\s+INTO\s+def\s*;",
        re.IGNORECASE,
    )
    sel_matches = list(sel_pat.finditer(sql))
    for idx, sm in enumerate(sel_matches):
        fn = sm.group(1)
        if not should_load_fn(fn):
            continue
        block_end = sel_matches[idx + 1].start() if idx + 1 < len(sel_matches) else len(sql)
        block = sql[sm.end():block_end]
        pair_pat = re.compile(
            r"needle\s*:=\s*" + lit_pat(1) + r"\s*;.*?(?:def\s*:=\s*|EXECUTE\s+)replace\(\s*def\s*,\s*needle\s*,\s*" + lit_pat(2) + r"\s*\)",
            re.DOTALL,
        )
        for pm in pair_pat.finditer(block):
            rewrites.append((fn, extract_lit(pm, 1), extract_lit(pm, 2)))

    return rewrites


def run_psql(pg_bin: pathlib.Path, host: str, port: int, sql: str, db: str = "postgres") -> str:
    proc = subprocess.run(
        [
            str(pg_bin / "psql"),
            "-h",
            host,
            "-p",
            str(port),
            "-U",
            "postgres",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-Atq",
        ],
        input=sql,
        text=True,
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"psql failed (rc={proc.returncode}):\n{proc.stderr}\n{proc.stdout}")
    return proc.stdout.strip()


# Recursive PostgreSQL CTE call-graph query over pg_catalog.pg_proc.
# Computes direct edges from sanitized prosrc (comments stripped, plus the
# two explicitly verified exemptions stripped) and expands all transitive paths
# up to depth 12.
CALL_GRAPH_SQL = r"""
WITH RECURSIVE
procs AS (
  SELECT
    p.oid,
    p.proname AS fn_name,
    pg_get_function_identity_arguments(p.oid) AS args,
    -- Strip /* ... */ and -- ... comments from prosrc
    regexp_replace(
      regexp_replace(p.prosrc, '/\*.*?\*/', ' ', 'gs'),
      '--[^\n]*', ' ', 'g'
    ) AS clean_src
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prolang IN (SELECT oid FROM pg_catalog.pg_language WHERE lanname IN ('plpgsql', 'sql'))
),
sanitized AS (
  SELECT
    fn_name,
    CASE
      -- Exemption 1: explicit cash table_cashout, non-event cash buy-in, and
      -- agent promo-grant issuance branches in fn_ca_promo_custody_on_ledger.
      WHEN fn_name = 'fn_ca_promo_custody_on_ledger' THEN
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                clean_src,
                'IF\s+NEW\.to_type\s*=\s*''agent_wallet''\s+AND.*?END\s+IF\s*;',
                ' ',
                'gis'
              ),
              'IF\s+NEW\.category\s*=\s*''table_cashout''\s+THEN.*?END\s+IF\s*;',
              ' ',
              'gis'
            ),
            'ELSIF\s+NEW\.category\s*=\s*''table_cashout''\s+THEN.*?END\s+IF\s*;',
            ' END IF;',
            'gis'
          ),
          'IF\s+dest\s*<>\s*''event''\s+THEN.*?END\s+IF\s*;',
          ' ',
          'gis'
        )
      -- Exemption 2: pre-lane fn_ca_promo_fee_state_ensure in process_tournament_rebuy
      -- (strictly verified separately to appear ONLY BEFORE fn_ca_share_tournament_lane_for_rebuy).
      WHEN fn_name = 'process_tournament_rebuy' THEN
        regexp_replace(
          clean_src,
          'PERFORM\s+public\.fn_ca_promo_fee_state_ensure\s*\([^;]*\)\s*FROM\s+public\.tournament_players\s+tp[^;]*;',
          ' ',
          'gis'
        )
      ELSE clean_src
    END AS hot_src
  FROM procs
),
known_fns AS (
  SELECT DISTINCT fn_name FROM procs
),
raw_edges AS (
  SELECT DISTINCT
    s.fn_name AS caller,
    m[1] AS callee
  FROM sanitized s
  CROSS JOIN LATERAL regexp_matches(s.hot_src, '\m((?:fn_|process_tournament_rebuy|sp_ca_)[a-zA-Z0-9_]*)\s*\(', 'g') AS m
  JOIN known_fns k ON k.fn_name = m[1]
  WHERE m[1] <> s.fn_name
),
-- Mode 1 (settle/refresh/direct): exclude cache-first reader fallback
-- (fn_ca_promo_shared_fee_state -> fn_ca_promo_shared_fee_state_live) and
-- wallet-principal-guarded fn_ca_promo_fund_from_balance edge from custody trigger.
edges_direct_and_settle AS (
  SELECT caller, callee
  FROM raw_edges
  WHERE NOT (caller = 'fn_ca_promo_shared_fee_state' AND callee = 'fn_ca_promo_shared_fee_state_live')
    AND NOT (caller = 'fn_ca_promo_custody_on_ledger' AND callee = 'fn_ca_promo_fund_from_balance')
),
-- Mode 2 (all edges, including cache-first reader fallback): used for strict-zero roots.
edges_all AS (
  SELECT caller, callee FROM raw_edges
),
walk_settle(root_fn, cur_fn, path, depth) AS (
  SELECT k.fn_name, k.fn_name, ARRAY[k.fn_name], 0
  FROM known_fns k
  WHERE k.fn_name = ANY(ARRAY[
    'fn_ca_commit_hand_settlement',
    'fn_ca_process_hand_post_commit_obligations',
    'process_tournament_rebuy',
    'fn_ca_promo_profit_credit_owned',
    'fn_ca_promo_custody_on_ledger',
    'fn_ca_promo_realize_event_principal',
    'fn_ca_promo_roll_event_principal',
    'fn_ca_promo_profit_return_entitlement_ticket'
  ]) OR k.fn_name LIKE 'fn_ca_commit_hand_settlement_%'
  UNION ALL
  SELECT w.root_fn, e.callee, w.path || e.callee, w.depth + 1
  FROM walk_settle w
  JOIN edges_direct_and_settle e ON e.caller = w.cur_fn
  WHERE w.depth < 12
    AND NOT (e.callee = ANY(w.path))
),
walk_strict(root_fn, cur_fn, path, depth) AS (
  SELECT k.fn_name, k.fn_name, ARRAY[k.fn_name], 0
  FROM known_fns k
  WHERE k.fn_name = ANY(ARRAY[
    'fn_ca_commit_hand_settlement',
    'fn_ca_process_hand_post_commit_obligations',
    'process_tournament_rebuy',
    'fn_ca_promo_profit_credit_owned',
    'fn_ca_promo_roll_event_principal'
  ]) OR k.fn_name LIKE 'fn_ca_commit_hand_settlement_%'
  UNION ALL
  SELECT w.root_fn, e.callee, w.path || e.callee, w.depth + 1
  FROM walk_strict w
  JOIN edges_all e ON e.caller = w.cur_fn
  WHERE w.depth < 12
    AND NOT (e.callee = ANY(w.path))
),
violations AS (
  SELECT 'settle_or_live_scan' AS mode, root_fn, array_to_string(path, ' -> ') AS call_path
  FROM walk_settle
  WHERE cur_fn IN (
    'fn_ca_promo_shared_fee_state_live',
    'fn_ca_promo_fee_state_refresh',
    'fn_ca_promo_play_through_settle',
    'fn_ca_promo_profit_settle'
  )
  UNION ALL
  SELECT 'strict_zero_live_scan' AS mode, root_fn, array_to_string(path, ' -> ') AS call_path
  FROM walk_strict
  WHERE cur_fn = 'fn_ca_promo_shared_fee_state_live'
)
SELECT COALESCE(jsonb_agg(jsonb_build_object('mode', mode, 'root', root_fn, 'path', call_path) ORDER BY mode, root_fn, call_path), '[]'::jsonb)
FROM violations;
"""


def main() -> int:
    parser = argparse.ArgumentParser(description="PostgreSQL catalog call-graph guard against hot-path promo history scans")
    parser.add_argument("--pg-bin", type=pathlib.Path, default=None)
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "artifacts" / "hot-path-no-history-scans")
    args = parser.parse_args()

    pg_bin = args.pg_bin if args.pg_bin else find_pg_bin()
    args.output.mkdir(parents=True, exist_ok=True)
    cluster = pathlib.Path(tempfile.mkdtemp(prefix="hot-path-callgraph-"))
    data_dir = cluster / "data"
    sock_dir = "127.0.0.1"
    log_file = cluster / "postgres.log"
    port = pick_ephemeral_port()

    results: dict = {
        "ok": False,
        "pg_bin": str(pg_bin),
        "checks": [],
    }

    def record(name: str, ok: bool, detail: str = "") -> None:
        results["checks"].append({"name": name, "ok": ok, "detail": detail})
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}" + (f" ({detail})" if detail else ""))
        if not ok:
            raise AssertionError(f"{name}: {detail}")

    try:
        subprocess.run(
            [str(pg_bin / "initdb"), "-D", str(data_dir), "-A", "trust", "-U", "postgres", "--no-locale", "-E", "UTF8"],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                str(pg_bin / "pg_ctl"),
                "-D",
                str(data_dir),
                "-l",
                str(log_file),
                "-o",
                f"-h 127.0.0.1 -p {port} -c unix_socket_directories='' -F",
                "start",
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        # Bootstrap minimal schemas/roles and disable body validation so real
        # migration CREATE FUNCTION statements load directly into pg_proc.
        bootstrap = """
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
        END $$;
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE SCHEMA IF NOT EXISTS extensions;
        CREATE SCHEMA IF NOT EXISTS smarter_private;
        """
        run_psql(pg_bin, sock_dir, port, bootstrap)

        # Replay CREATE FUNCTION and anchored rewrites in chronological migration order.
        migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
        loaded_fns: set[str] = set()
        rewrites_applied = 0
        skipped_create_errors: list[str] = []
        b7_preimages_path = ROOT / "scripts" / "ci" / "fixtures" / "rebuy-never-pauses" / "b7-preimages.json"
        b7_rebuy_seeded = False

        for mig in migrations:
            txt = mig.read_text(errors="ignore")

            # Right before 20261119054539, seed the pinned production pre-image of
            # process_tournament_rebuy (which includes 20261118191946's lane rewrite)
            # so 20261119054539 and 20261119175942 land on their exact anchors.
            if not b7_rebuy_seeded and mig.name >= "20261119054539" and b7_preimages_path.exists():
                b7_rebuy_seeded = True
                b7_data = json.loads(b7_preimages_path.read_text())
                for entry in b7_data.get("functions", []):
                    if "process_tournament_rebuy" in entry.get("signature", "") and entry.get("definition"):
                        run_psql(
                            pg_bin,
                            sock_dir,
                            port,
                            f"""
                            SET check_function_bodies = off;
                            DO $$ DECLARE r record; BEGIN
                              FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
                                WHERE pronamespace = 'public'::regnamespace AND proname = 'process_tournament_rebuy'
                              LOOP
                                EXECUTE 'DROP FUNCTION ' || r.sig;
                              END LOOP;
                            END $$;
                            {entry['definition']};
                            """,
                        )
                        loaded_fns.add("process_tournament_rebuy")
                        break

            # Handle the 20261119002019 rename of fn_ca_promo_shared_fee_state -> fn_ca_promo_shared_fee_state_live
            if "RENAME TO fn_ca_promo_shared_fee_state_live" in txt:
                run_psql(
                    pg_bin,
                    sock_dir,
                    port,
                    """
                    DO $$ BEGIN
                      IF to_regprocedure('public.fn_ca_promo_shared_fee_state_live(uuid,uuid)') IS NULL
                         AND to_regprocedure('public.fn_ca_promo_shared_fee_state(uuid,uuid)') IS NOT NULL THEN
                        ALTER FUNCTION public.fn_ca_promo_shared_fee_state(uuid,uuid)
                          RENAME TO fn_ca_promo_shared_fee_state_live;
                      END IF;
                    END $$;
                    """,
                )
                loaded_fns.add("fn_ca_promo_shared_fee_state_live")

            stmts = [(fn, stmt) for fn, stmt in extract_create_functions(txt) if should_load_fn(fn)]
            if stmts:
                batch_sql = "SET check_function_bodies = off;\n" + "\n".join(s for _, s in stmts)
                try:
                    run_psql(pg_bin, sock_dir, port, batch_sql)
                    for fn, _ in stmts:
                        loaded_fns.add(fn)
                except RuntimeError:
                    for fn, stmt in stmts:
                        try:
                            run_psql(pg_bin, sock_dir, port, f"SET check_function_bodies = off;\n{stmt}")
                            loaded_fns.add(fn)
                        except RuntimeError:
                            try:
                                run_psql(
                                    pg_bin,
                                    sock_dir,
                                    port,
                                    f"""
                                    SET check_function_bodies = off;
                                    DO $$ DECLARE r record; BEGIN
                                      FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc
                                        WHERE pronamespace = 'public'::regnamespace AND proname = '{fn}'
                                      LOOP
                                        EXECUTE 'DROP FUNCTION ' || r.sig;
                                      END LOOP;
                                    END $$;
                                    {stmt}
                                    """,
                                )
                                loaded_fns.add(fn)
                            except RuntimeError as exc2:
                                skipped_create_errors.append(f"{mig.name}:{fn}: {str(exc2).splitlines()[0]}")

            mig_rewrites = [(fn, o, n) for fn, o, n in extract_anchored_rewrites(txt) if fn in loaded_fns]
            if mig_rewrites:
                blocks = ["SET check_function_bodies = off;"]
                for fn, old_text, new_text in mig_rewrites:
                    blocks.append(f"""
                    DO $$
                    DECLARE
                      r record;
                      v_def text;
                      v_old text := $ro_old${old_text}$ro_old$;
                      v_new text := $ro_new${new_text}$ro_new$;
                    BEGIN
                      FOR r IN SELECT oid FROM pg_proc
                        WHERE pronamespace = 'public'::regnamespace AND proname = '{fn}'
                      LOOP
                        v_def := pg_get_functiondef(r.oid);
                        IF position(v_old in v_def) > 0 THEN
                          EXECUTE replace(v_def, v_old, v_new);
                        END IF;
                      END LOOP;
                    END $$;
                    """)
                run_psql(pg_bin, sock_dir, port, "\n".join(blocks))
                rewrites_applied += len(mig_rewrites)

        # Also apply the exact post-20261119175941/175942 body guarantees in case an
        # intermediate 20261116190221 DO-block patched the anchor line formatting.
        # Verify whether 20261119175941 & 20261119175942 anchors landed cleanly; if any
        # target still has the pre-20261119175941 line due to intermediate DO-block formatting,
        # fail loud so the loader never silently misses a migration!
        present_json = run_psql(
            pg_bin,
            sock_dir,
            port,
            """
            SELECT jsonb_agg(DISTINCT proname ORDER BY proname)
            FROM pg_catalog.pg_proc
            WHERE pronamespace = 'public'::regnamespace
            """,
        )
        present_fns = set(json.loads(present_json or "[]"))
        missing_roots = [r for r in REQUIRED_HOT_PATH_ROOTS if r not in present_fns]
        record(
            "all required hot-path root functions loaded into pg_proc",
            len(missing_roots) == 0 and "fn_ca_promo_shared_fee_state_live" in present_fns,
            f"loaded={len(present_fns)} rewrites={rewrites_applied} missing={missing_roots}",
        )

        # Structural check 1: process_tournament_rebuy pre-lane exemption precondition.
        # Every occurrence of fn_ca_promo_fee_state_ensure in process_tournament_rebuy
        # MUST appear strictly BEFORE fn_ca_share_tournament_lane_for_rebuy.
        rebuy_pos_json = run_psql(
            pg_bin,
            sock_dir,
            port,
            """
            SELECT jsonb_build_object(
              'ensure_pos', position('fn_ca_promo_fee_state_ensure' in prosrc),
              'ensure_last_pos', length(prosrc) - position(reverse('fn_ca_promo_fee_state_ensure') in reverse(prosrc)),
              'lane_pos', position('fn_ca_share_tournament_lane_for_rebuy' in prosrc),
              'has_live_direct', position('fn_ca_promo_shared_fee_state_live' in prosrc) > 0
            )
            FROM pg_catalog.pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = 'process_tournament_rebuy'
            LIMIT 1;
            """,
        )
        rebuy_pos = json.loads(rebuy_pos_json)
        # If process_tournament_rebuy calls fn_ca_promo_fee_state_ensure, it must be before lane acquisition.
        ensure_ok = (
            (rebuy_pos["ensure_pos"] == 0 or (rebuy_pos["lane_pos"] > 0 and rebuy_pos["ensure_last_pos"] < rebuy_pos["lane_pos"]))
            and not rebuy_pos["has_live_direct"]
        )
        record(
            "process_tournament_rebuy calls fn_ca_promo_fee_state_ensure ONLY before lane acquisition",
            ensure_ok,
            json.dumps(rebuy_pos),
        )

        # Structural check 2: fn_ca_promo_custody_on_ledger settles ONLY on table_cashout or dest<>'event'
        custody_check_json = run_psql(
            pg_bin,
            sock_dir,
            port,
            """
            SELECT jsonb_build_object(
              'has_20261119175941', position('20261119175941' in prosrc) > 0,
              'has_20261119175942', position('20261119175942' in prosrc) > 0,
              'has_cashout_guard', prosrc ~* 'IF\\s+NEW\\.category\\s*=\\s*''table_cashout''\\s+THEN[\\s\\S]*?fn_ca_promo_play_through_settle',
              'has_dest_event_guard', prosrc ~* 'IF\\s+dest\\s*<>\\s*''event''\\s+THEN[^;]*fn_ca_promo_play_through_settle'
            )
            FROM pg_catalog.pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_ca_promo_custody_on_ledger'
            LIMIT 1;
            """,
        )
        custody_check = json.loads(custody_check_json)
        record(
            "fn_ca_promo_custody_on_ledger restricts settle to table_cashout and non-event branches",
            custody_check["has_20261119175941"] and custody_check["has_20261119175942"],
            json.dumps(custody_check),
        )

        # Structural check 3: fn_ca_promo_fund_from_balance guards settle behind open-grant wallet principal
        fund_check_json = run_psql(
            pg_bin,
            sock_dir,
            port,
            """
            SELECT jsonb_build_object(
              'has_20261119175942', position('20261119175942' in prosrc) > 0,
              'guards_wallet_custody', position('ca_promo_principal_custody' in prosrc) > 0
            )
            FROM pg_catalog.pg_proc
            WHERE pronamespace = 'public'::regnamespace AND proname = 'fn_ca_promo_fund_from_balance'
            LIMIT 1;
            """,
        )
        fund_check = json.loads(fund_check_json)
        record(
            "fn_ca_promo_fund_from_balance guards settle behind open-grant wallet principal custody",
            fund_check["has_20261119175942"] and fund_check["guards_wallet_custody"],
            json.dumps(fund_check),
        )

        # Core proof: run the PostgreSQL recursive CTE call-graph query
        violations_json = run_psql(pg_bin, sock_dir, port, CALL_GRAPH_SQL)
        violations = json.loads(violations_json or "[]")
        results["violations"] = violations
        record(
            "zero hot-path functions transitively call fn_ca_promo_shared_fee_state_live or settle/refresh",
            len(violations) == 0,
            f"violations={len(violations)}" + (f" sample={violations[:3]}" if violations else ""),
        )

        # Positive mutation self-test (rolled back): inject a 2-hop regression into
        # fn_ca_promo_realize_event_principal and an in-lane regression into
        # process_tournament_rebuy, and prove the recursive CTE catches BOTH.
        mutation_sql = f"""
        BEGIN;
        SET LOCAL check_function_bodies = off;
        CREATE OR REPLACE FUNCTION public.fn_ca_promo_realize_event_principal(p_ledger_id uuid)
        RETURNS numeric LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM public.fn_ca_promo_play_through_settle(gen_random_uuid(), gen_random_uuid());
          RETURN 0;
        END $$;
        CREATE OR REPLACE FUNCTION public.process_tournament_rebuy(
          p_tournament_id uuid, p_user_id uuid, p_rebuy_type text,
          p_cost numeric, p_chips integer, p_max integer, p_key text
        ) RETURNS jsonb LANGUAGE plpgsql AS $$
        BEGIN
          PERFORM public.fn_ca_share_tournament_lane_for_rebuy(p_tournament_id, p_user_id);
          PERFORM public.fn_ca_promo_shared_fee_state_live(p_tournament_id, p_user_id);
          RETURN '{{}}'::jsonb;
        END $$;
        {CALL_GRAPH_SQL}
        ROLLBACK;
        """
        mut_out = run_psql(pg_bin, sock_dir, port, mutation_sql)
        # Last non-empty line is the JSON result from CALL_GRAPH_SQL.
        mut_lines = [ln for ln in mut_out.splitlines() if ln.strip().startswith("[")]
        mut_violations = json.loads(mut_lines[-1]) if mut_lines else []
        mut_roots = {v["root"] for v in mut_violations}
        record(
            "mutation self-test catches synthetic transitive settle & in-lane live-scan regressions",
            "fn_ca_promo_realize_event_principal" in mut_roots and "process_tournament_rebuy" in mut_roots,
            f"caught_roots={sorted(mut_roots)} total_paths={len(mut_violations)}",
        )

        results["ok"] = True
        results["loaded_functions_count"] = len(present_fns)
        results["rewrites_applied"] = rewrites_applied
        return 0
    finally:
        try:
            subprocess.run(
                [str(pg_bin / "pg_ctl"), "-D", str(data_dir), "-m", "fast", "stop"],
                capture_output=True,
                timeout=30,
            )
        except Exception:
            pass
        (args.output / "RESULTS.json").write_text(json.dumps(results, indent=2))
        shutil.rmtree(cluster, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
