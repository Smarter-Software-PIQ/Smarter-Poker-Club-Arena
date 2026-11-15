#!/usr/bin/env python3
"""Promo play-through lock ledger and fee meter (owner ruling 2026-11-15).

Applies the real migration to a throwaway PostgreSQL cluster, never
production, over a minimal stand-in for the four relations it reads, and
proves the rule: a promo grant locks its own amount until the holder has paid
amount x multiplier in fees, profit above the locked amount stays cashable,
fees fill the oldest grant first, refunded fees leave the meter, and promo
received before go-live is never locked.

Usage: python3 scripts/ci/test-promo-play-through.py [--output DIR]
  PG_BIN            directory holding initdb/pg_ctl (default: newest under
                    /usr/lib/postgresql)
  PROMO_PT_SOCKET   use an already running server at this socket directory
  PROMO_PT_PORT     its port (default 5432)
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = sorted(
    glob.glob(os.path.join(ROOT, "supabase", "migrations", "*_promo_play_through_lock_ledger_and_fee_meter.sql"))
)

CLUB = "c0000000-0000-0000-0000-000000000001"
OTHER_CLUB = "c0000000-0000-0000-0000-000000000002"
ALICE = "a0000000-0000-0000-0000-000000000001"
BOB = "b0000000-0000-0000-0000-000000000002"
CARL = "d0000000-0000-0000-0000-000000000003"
TOUR_A = "70000000-0000-0000-0000-00000000000a"
TOUR_B = "70000000-0000-0000-0000-00000000000b"

STUB = f"""
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.club_members (
  club_id uuid NOT NULL, user_id uuid NOT NULL, chip_balance numeric DEFAULT 0,
  PRIMARY KEY (club_id, user_id));
CREATE TABLE public.rake_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, club_id uuid,
  rake_amount numeric, created_at timestamptz DEFAULT now());
CREATE TABLE public.accounting_tournament_fee_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, player_id uuid,
  club_id uuid, rake_credit numeric, charged_at timestamptz DEFAULT now());
CREATE TABLE public.rake_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid,
  is_tournament boolean, rake_amount numeric, metadata jsonb,
  created_at timestamptz DEFAULT now());
INSERT INTO public.club_members VALUES
  ('{CLUB}', '{ALICE}', 80), ('{CLUB}', '{BOB}', 500), ('{OTHER_CLUB}', '{ALICE}', 10);
"""


class Db:
    def __init__(self, socket, port, name):
        self.socket, self.port, self.name = socket, str(port), name

    def run(self, sql, db=None, check=True):
        proc = subprocess.run(
            ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
             "-h", self.socket, "-p", self.port, "-U", "postgres", "-d", db or self.name],
            input=sql, capture_output=True, text=True)
        if check and proc.returncode != 0:
            raise RuntimeError(f"psql failed:\n{sql[:400]}\n{proc.stderr}")
        return proc

    def one(self, sql):
        return self.run(sql).stdout.strip()

    def json(self, sql):
        return json.loads(self.one(sql))


def pg_bin():
    if os.environ.get("PG_BIN"):
        return os.environ["PG_BIN"]
    found = sorted(glob.glob("/usr/lib/postgresql/*/bin"), key=lambda p: int(p.split("/")[-2]))
    if not found:
        raise SystemExit("no PostgreSQL binaries found; set PG_BIN")
    return found[-1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    if len(MIGRATIONS) != 1:
        raise SystemExit(f"expected exactly one promo play-through migration, found {MIGRATIONS}")

    tmp = None
    socket = os.environ.get("PROMO_PT_SOCKET")
    port = int(os.environ.get("PROMO_PT_PORT", "5432"))
    started = False
    if not socket:
        tmp = tempfile.mkdtemp(prefix="promo-pt-")
        socket, port = tmp, 54417
        binaries = pg_bin()
        subprocess.run([os.path.join(binaries, "initdb"), "-D", os.path.join(tmp, "data"),
                        "-U", "postgres", "-A", "trust"], check=True, capture_output=True)
        subprocess.run([os.path.join(binaries, "pg_ctl"), "-D", os.path.join(tmp, "data"), "-w",
                        "-o", f"-p {port} -k {tmp} -c listen_addresses=''",
                        "-l", os.path.join(tmp, "log"), "start"], check=True, capture_output=True)
        started = True

    name = f"promo_pt_{os.getpid()}"
    db = Db(socket, port, name)
    results = []

    def check(label, actual, expected):
        ok = actual == expected
        results.append({"check": label, "ok": ok, "actual": actual, "expected": expected})
        print(("PASS " if ok else "FAIL ") + label + ("" if ok else f"\n     actual   {actual}\n     expected {expected}"))

    def summary(user=ALICE, club=CLUB):
        raw = db.json(f"SELECT public.fn_ca_promo_play_through_summary('{club}', '{user}')")
        return {k: (float(v) if isinstance(v, (int, float)) and k != "open_grants" else v)
                for k, v in raw.items() if k != "next_expiry_at"}

    def grant(ref, amount, user=ALICE, club=CLUB, multiplier="NULL"):
        return db.one(
            f"SELECT public.fn_ca_promo_play_through_record_grant('{club}', '{user}', {amount}, "
            f"'union_promo', '{ref}', NULL, 'union_wallet', NULL, {multiplier})")

    def cash_fee(amount, user=ALICE, club=CLUB, at="clock_timestamp()"):
        db.run(f"INSERT INTO public.rake_attributions (player_id, club_id, rake_amount, created_at) "
               f"VALUES ('{user}', '{club}', {amount}, {at})")

    try:
        db.run(f"CREATE DATABASE {name}", db="postgres")
        db.run(STUB)
        with open(MIGRATIONS[0]) as handle:
            db.run(handle.read())

        # 1. Before go-live nothing is recorded, so nothing is ever locked.
        check("before go-live a grant records nothing", grant("pre-live-1", 50), "")
        check("before go-live the wallet is fully cashable", summary(),
              {"locked": 0.0, "open_grants": 0, "fee_target": 0.0, "fee_progress": 0.0,
               "fee_remaining": 0.0, "percent": 100.0, "wallet": 80.0, "cashable": 80.0})

        db.run("UPDATE public.ca_promo_play_through_settings SET enforced_from = clock_timestamp() - interval '1 second'")

        # 2. Fees paid before the grant never count toward it.
        cash_fee(999, at="clock_timestamp() - interval '1 hour'")

        # 3. 50 promo chips lock 50 and need 200 in fees; profit stays cashable.
        first = grant("union-send-1", 50)
        check("a grant is recorded after go-live", len(first), 36)
        check("the same source never records twice", grant("union-send-1", 50), first)
        check("50 promo locks 50 against a 200 fee target", summary(),
              {"locked": 50.0, "open_grants": 1, "fee_target": 200.0, "fee_progress": 0.0,
               "fee_remaining": 200.0, "percent": 0.0, "wallet": 80.0, "cashable": 30.0})

        # 4. Cash rake share and tournament fees both count; a refunded fee,
        #    another member's refund and another club's fees do not.
        cash_fee(100)
        cash_fee(40, club=OTHER_CLUB)
        cash_fee(77, user=BOB)
        db.run(f"""
          INSERT INTO public.accounting_tournament_fee_sources (tournament_id, player_id, club_id, rake_credit)
          VALUES ('{TOUR_A}', '{ALICE}', '{CLUB}', 24), ('{TOUR_B}', '{ALICE}', '{CLUB}', 10);
          INSERT INTO public.rake_records (tournament_id, is_tournament, rake_amount, metadata) VALUES
            ('{TOUR_B}', true, -10, jsonb_build_object('kind', 'tournament_fee_refund', 'user_id', '{ALICE}')),
            ('{TOUR_A}', true, -24, jsonb_build_object('kind', 'tournament_fee_refund', 'user_id', '{BOB}'));
        """)
        check("fees count from cash and tournaments, net of the member's own refunds", summary(),
              {"locked": 50.0, "open_grants": 1, "fee_target": 200.0, "fee_progress": 124.0,
               "fee_remaining": 76.0, "percent": 62.0, "wallet": 80.0, "cashable": 30.0})
        check("the member's own door returns the same figure",
              db.json(f"SET test.uid = '{ALICE}'; SELECT public.fn_ca_my_promo_play_through('{CLUB}')")["fee_progress"], 124)
        check("a non-member is refused",
              db.json(f"SET test.uid = '{CARL}'; SELECT public.fn_ca_my_promo_play_through('{CLUB}')")["success"], False)

        # 5. A second grant joins the cycle; fees fill the oldest first.
        grant("agent-send-2", 25)
        check("a second grant adds its own lock and target", summary(),
              {"locked": 75.0, "open_grants": 2, "fee_target": 300.0, "fee_progress": 124.0,
               "fee_remaining": 176.0, "percent": 41.0, "wallet": 80.0, "cashable": 5.0})
        cash_fee(126)
        check("250 in fees meets the first grant and leaves the second locked", summary(),
              {"locked": 25.0, "open_grants": 1, "fee_target": 300.0, "fee_progress": 250.0,
               "fee_remaining": 50.0, "percent": 83.0, "wallet": 80.0, "cashable": 55.0})
        check("settle stamps exactly the met grant",
              db.one(f"SELECT public.fn_ca_promo_play_through_settle('{CLUB}', '{ALICE}')"), "1")
        check("settle is idempotent",
              db.one(f"SELECT public.fn_ca_promo_play_through_settle('{CLUB}', '{ALICE}')"), "0")
        check("the figure is unchanged by stamping", summary()["locked"], 25.0)

        # 6. The whole requirement met: everything unlocks.
        cash_fee(50)
        check("the full target unlocks the whole wallet", summary(),
              {"locked": 0.0, "open_grants": 0, "fee_target": 300.0, "fee_progress": 300.0,
               "fee_remaining": 0.0, "percent": 100.0, "wallet": 80.0, "cashable": 80.0})

        # 7. A new grant after a finished cycle starts from zero.
        grant("union-send-3", 10, multiplier="2")
        check("a finished cycle lends no fees to a new grant, and the multiplier is the grant's own", summary(),
              {"locked": 10.0, "open_grants": 1, "fee_target": 20.0, "fee_progress": 0.0,
               "fee_remaining": 20.0, "percent": 0.0, "wallet": 80.0, "cashable": 70.0})
        check("the finished cycle's grants are closed as met",
              db.one("SELECT count(*) FROM public.ca_promo_play_through_grants WHERE close_reason = 'met'"), "2")

        # 8. Expiry: unmet at expiry stays unmet even if fees arrive later;
        #    met before expiry is met.
        grant("bob-send-1", 20, user=BOB)
        db.run(f"""UPDATE public.ca_promo_play_through_grants
                      SET cycle_started_at = clock_timestamp() - interval '3 days',
                          granted_at = clock_timestamp() - interval '3 days',
                          expires_at = clock_timestamp() - interval '1 day'
                    WHERE source_ref = 'bob-send-1'""")
        cash_fee(80, user=BOB)
        check("fees paid after expiry do not rescue an expired grant",
              db.one(f"SELECT state FROM public.fn_ca_promo_play_through_state('{CLUB}', '{BOB}')"), "expired_pending")
        check("an expired, unreturned grant is still locked", summary(user=BOB)["locked"], 20.0)
        db.run("DELETE FROM public.rake_attributions WHERE rake_amount = 80")
        cash_fee(80, user=BOB, at="clock_timestamp() - interval '2 days'")
        check("fees paid before expiry meet the grant",
              db.one(f"SELECT state FROM public.fn_ca_promo_play_through_state('{CLUB}', '{BOB}')"), "met_pending")

        # 9. A browser role reaches only its own door.
        denied = db.run("SET ROLE authenticated; SELECT count(*) FROM public.ca_promo_play_through_grants", check=False)
        check("a browser cannot read the grant table", denied.returncode != 0, True)
        denied = db.run(f"SET ROLE authenticated; SELECT public.fn_ca_promo_play_through_record_grant("
                        f"'{CLUB}', '{ALICE}', 5, 'union_promo', 'forged', NULL, NULL, NULL, NULL)", check=False)
        check("a browser cannot record a grant", denied.returncode != 0, True)
        allowed = db.run(f"SET test.uid = '{ALICE}'; SET ROLE authenticated; "
                         f"SELECT public.fn_ca_my_promo_play_through('{CLUB}')", check=False)
        check("a browser can read its own figure", allowed.returncode, 0)
    finally:
        db.run(f"DROP DATABASE IF EXISTS {name}", db="postgres", check=False)
        if started:
            subprocess.run([os.path.join(pg_bin(), "pg_ctl"), "-D", os.path.join(tmp, "data"), "-m", "fast", "stop"],
                           capture_output=True)
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)

    failed = [r for r in results if not r["ok"]]
    if args.output:
        os.makedirs(args.output, exist_ok=True)
        with open(os.path.join(args.output, "RESULTS.json"), "w") as handle:
            json.dump({"migration": os.path.basename(MIGRATIONS[0]), "checks": results,
                       "passed": len(results) - len(failed), "failed": len(failed)}, handle, indent=2)
    print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
