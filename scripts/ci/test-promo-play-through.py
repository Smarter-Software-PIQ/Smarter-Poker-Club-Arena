#!/usr/bin/env python3
"""Promo play-through (owner ruling 2026-11-15).

Applies the real migrations, in order, to a throwaway PostgreSQL cluster,
never production, over a minimal stand-in for the relations they read, and
proves the rule: a promo grant locks its own amount until the holder has paid
amount x multiplier in fees, profit above the locked amount stays cashable,
fees fill the oldest grant first, refunded fees leave the meter, and promo
received before go-live is never locked. Phase 2: a promo chip's own ledger row records its grant, in
the crediting transaction, whichever door sent it. Phase 3: a cash-out
request, agent claim-back or player transfer that would take locked chips is
refused at commit and moves nothing; play is never refused; a club-bank claim
is allowed and reduces the lock; the owner can unlock with a reason.

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
    glob.glob(os.path.join(ROOT, "supabase", "migrations", "*_promo_play_through_*.sql"))
)

CLUB = "c0000000-0000-0000-0000-000000000001"
OTHER_CLUB = "c0000000-0000-0000-0000-000000000002"
ALICE = "a0000000-0000-0000-0000-000000000001"
BOB = "b0000000-0000-0000-0000-000000000002"
CARL = "d0000000-0000-0000-0000-000000000003"
STRANGER = "e0000000-0000-0000-0000-000000000004"
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
  role text DEFAULT 'member', PRIMARY KEY (club_id, user_id));
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
CREATE TABLE public.chip_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_type text, from_entity_id uuid,
  from_label text, to_type text, to_entity_id uuid, to_label text, amount numeric,
  category text, club_id uuid, status text DEFAULT 'posted', metadata jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.ca_declared_money_triggers (
  table_name text, trigger_name text, note text, PRIMARY KEY (table_name, trigger_name));
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
    if len(MIGRATIONS) < 2:
        raise SystemExit(f"expected the promo play-through migrations, found {MIGRATIONS}")

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
        for migration in MIGRATIONS:
            with open(migration) as handle:
                db.run(handle.read())

        def ledger(from_type, from_label, to_type, category, amount, user=CARL, metadata="NULL"):
            label = "NULL" if from_label is None else f"'{from_label}'"
            db.run(f"INSERT INTO public.chip_ledger (from_type, from_label, to_type, to_entity_id, amount, "
                   f"category, club_id, metadata) VALUES ('{from_type}', {label}, '{to_type}', '{user}', "
                   f"{amount}, '{category}', '{CLUB}', {metadata})")

        def carl_grants():
            return db.one("SELECT COALESCE(string_agg(source_kind || ':' || amount::text, ',' ORDER BY granted_at, id), '') "
                          f"FROM public.ca_promo_play_through_grants WHERE user_id = '{CARL}'")

        # 0. Before go-live a promo ledger row records nothing.
        db.run(f"INSERT INTO public.club_members VALUES ('{CLUB}', '{CARL}', 0)")
        ledger("union_wallet", "union_wallets.promo_wallet", "player_wallet", "promo", 25)
        check("before go-live a promo ledger row records no grant", carl_grants(), "")

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
              db.json(f"SET test.uid = '{STRANGER}'; SELECT public.fn_ca_my_promo_play_through('{CLUB}')")["success"], False)

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

        # 9. Phase 2: the promo chip's own ledger row records its grant.
        ledger("union_wallet", "union_wallets.promo_wallet", "player_wallet", "promo", 25)
        ledger("union_wallet", "union_wallets.promo_wallet", "player_wallet", "wheel_prize", 7.5)
        ledger("union_wallet", "union_wallets.promo_wallet", "player_wallet", "plinko_prize", 3)
        ledger("promo_wallet", "clubs.promo_balance", "player_wallet", "promo_send", 50)
        ledger("promo_wallet", None, "player_wallet", "promo_send", 10,
               metadata="jsonb_build_object('actor_role', 'agent')")
        check("every promo door records its grant from the ledger row", carl_grants(),
              "union_promo:25,wheel_prize:7.5,other_promo:3,club_promo:50,agent_promo:10")
        ledger("union_wallet", "union_wallets.promo_wallet", "player_wallet", "settlement", 9)
        ledger("union_wallet", "union_wallets.bank", "player_wallet", "promo", 40)
        ledger("club_treasury", None, "player_wallet", "treasury_transfer", 100)
        ledger("table_stack", None, "player_wallet", "cashout", 60)
        ledger("promo_wallet", None, "agent_wallet", "promo_send", 20)
        ledger("promo_wallet", None, "player_wallet", "reversal", 5)
        check("winnings, real chips, table chips and non-gift rows record nothing", carl_grants(),
              "union_promo:25,wheel_prize:7.5,other_promo:3,club_promo:50,agent_promo:10")
        check("the recorded grants lock their total at four times in fees",
              {k: summary(user=CARL)[k] for k in ("locked", "fee_target", "open_grants")},
              {"locked": 95.5, "fee_target": 382.0, "open_grants": 5})
        check("the ledger trigger is declared as a money trigger",
              db.one("SELECT count(*) FROM public.ca_declared_money_triggers WHERE trigger_name = 'zz_ca_promo_play_through_grant'"), "1")

        # 10. Phase 3: the exits. Carl holds 95.5 locked.
        def leave(wallet_after, to_type, category, amount, to_user="NULL"):
            target = "NULL" if to_user == "NULL" else f"'{to_user}'"
            return db.run(
                f"BEGIN; UPDATE public.club_members SET chip_balance = {wallet_after} "
                f"WHERE club_id = '{CLUB}' AND user_id = '{CARL}'; "
                f"INSERT INTO public.chip_ledger (from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id) "
                f"VALUES ('player_wallet', '{CARL}', '{to_type}', {target}, {amount}, '{category}', '{CLUB}'); COMMIT;",
                check=False)

        def carl_wallet():
            return db.one(f"SELECT chip_balance FROM public.club_members WHERE club_id = '{CLUB}' AND user_id = '{CARL}'")

        db.run(f"UPDATE public.club_members SET chip_balance = 120 WHERE club_id = '{CLUB}' AND user_id = '{CARL}'")
        check("profit above the lock can be cashed out", leave(100, "escrow", "escrow_hold", 20).returncode, 0)
        refused = leave(90, "escrow", "escrow_hold", 10)
        check("a cash-out request into the locked chips is refused",
              (refused.returncode != 0, "Promo Play Through" in refused.stderr), (True, True))
        check("a refused cash-out moves nothing", carl_wallet(), "100")
        check("an agent claim-back into the locked chips is refused",
              leave(50, "agent_wallet", "club_bank_claim", 50, BOB).returncode != 0, True)
        check("a transfer to another player into the locked chips is refused",
              leave(50, "player_wallet", "transfer", 50, BOB).returncode != 0, True)
        check("a refused claim-back and transfer move nothing", carl_wallet(), "100")
        check("buying into a table with locked chips is never refused",
              leave(0, "table_stack", "buyin", 100).returncode, 0)
        check("entering a tournament with locked chips is never refused",
              leave(0, "prize_liability", "tournament_buyin", 0.01).returncode, 0)
        db.run(f"UPDATE public.club_members SET chip_balance = 100 WHERE club_id = '{CLUB}' AND user_id = '{CARL}'")
        check("the club bank's claim is allowed", leave(40, "club_treasury", "club_bank_claim", 60).returncode, 0)
        check("the club bank's claim returns the newest promo first and leaves the rest locked",
              (summary(user=CARL)["locked"],
               db.one("SELECT string_agg(source_kind || ':' || remaining::text || ':' || COALESCE(close_reason, 'open'), ',' "
                      f"ORDER BY granted_at, id) FROM public.ca_promo_play_through_grants WHERE user_id = '{CARL}'")),
              (40.0, "union_promo:25:open,wheel_prize:7.5:open,other_promo:3:open,club_promo:4.5:open,agent_promo:0:returned"))
        db.run(f"UPDATE public.club_members SET role = 'owner' WHERE club_id = '{CLUB}' AND user_id = '{ALICE}'")
        check("a member cannot unlock promo chips",
              db.json(f"SET test.uid = '{BOB}'; SELECT public.fn_ca_promo_play_through_override('{CLUB}', '{CARL}', 'support case')")["success"], False)
        check("the owner cannot unlock without a reason",
              db.json(f"SET test.uid = '{ALICE}'; SELECT public.fn_ca_promo_play_through_override('{CLUB}', '{CARL}', ' ')")["success"], False)
        check("the owner unlocks with a reason, recorded on the grants",
              (db.json(f"SET test.uid = '{ALICE}'; SELECT public.fn_ca_promo_play_through_override('{CLUB}', '{CARL}', 'support case 41')")["unlocked_grants"],
               summary(user=CARL)["locked"],
               db.one(f"SELECT count(*) FROM public.ca_promo_play_through_grants WHERE user_id = '{CARL}' "
                      f"AND close_reason = 'override' AND closed_by = '{ALICE}' AND close_note = 'support case 41'")),
              (4, 0.0, "4"))
        check("after the unlock the whole wallet can leave", leave(0, "escrow", "escrow_hold", 40).returncode, 0)
        check("a member with no promo is never refused",
              db.run(f"BEGIN; UPDATE public.club_members SET chip_balance = 0 WHERE club_id = '{OTHER_CLUB}' AND user_id = '{ALICE}'; "
                     f"INSERT INTO public.chip_ledger (from_type, from_entity_id, to_type, amount, category, club_id) "
                     f"VALUES ('player_wallet', '{ALICE}', 'escrow', 10, 'escrow_hold', '{OTHER_CLUB}'); COMMIT;", check=False).returncode, 0)
        check("the exit trigger is declared as a money trigger",
              db.one("SELECT count(*) FROM public.ca_declared_money_triggers WHERE trigger_name = 'zz_ca_promo_play_through_exit'"), "1")

        # 11. A browser role reaches only its own door.
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
            json.dump({"migrations": [os.path.basename(m) for m in MIGRATIONS], "checks": results,
                       "passed": len(results) - len(failed), "failed": len(failed)}, handle, indent=2)
    print(f"{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
