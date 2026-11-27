"""A hand's money path never writes a shared row; post-commit lag warns early.

Proves, on a throwaway PostgreSQL cluster (no network, no production
connection), the two guards of incident 075013fd lane F:

  G1  scripts/ci/hand-path-shared-writes.mjs (the live reader
      fn_ca_hand_path_shared_writes() and the applier check):
      1. its rules on a small synthetic catalog (calls, triggers with event
         and UPDATE OF columns, NOWAIT, FOR UPDATE OF, advisory forms, the
         bankers, string literals, depth bounds, the shared-key derivation,
         a missing door);
      2. on the PRODUCTION texts the r5 harness rebuilds (fixtures
         cash-rake-pending and hand-bank-pending, md5-equal to production on
         2026-11-18): every shared write #11270 and #11266 remove is reported
         BEFORE, and is gone AFTER the four migrations
         (20261118034950, 20261118035606, 20261118071728, 20261118071736),
         each applied through the applier's own wrapping so the in-applier
         check admits them;
      3. the applier refuses, inside the migration's own transaction, a
         migration that ADDS a shared write to the hand path (nothing is
         installed), admits the same file when it declares it, and splices
         nothing into a data-only file.
  G3  (lane H2) a hand on a full spin table that busts a seat commits while
      another session holds the spin pool, club and union wallet rows; the
      diamond expiry burn a jackpot credit can reach retires the player's
      diamonds without touching a club or union row; positive controls show
      the same rows DO block a third-seat fill, a tournament status change
      and a chip burn.
  G2  fn_ca_post_commit_lag_watch() (20261118084759): warns per table when
      p95 commit->post_commit_completed_at over five minutes exceeds 2 s,
      goes critical above 15 s or for a hand pending 15 s, never raises twice
      for one table, escalates, resolves when the lag clears, and caps new
      alerts per run.
"""
import argparse
import ast
import json
import os
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
R5 = ROOT / 'scripts' / 'ci' / 'test-deadlock-lock-orders-r5.py'
MODULE = ROOT / 'scripts' / 'ci' / 'hand-path-shared-writes.mjs'
G1_FILE = '20261118084747_a_hands_money_path_never_writes_a_shared_row.sql'
# The reader as it stands: lane H2's SET-target reader (20261118155729), then
# 20261118160106, which follows an UPDATE OF trigger only when the statement's
# SET list assigns one of its columns.
G1_H2_FILE = '20261118155729_an_update_of_trigger_fires_on_a_set_target_never_a_where_col.sql'
G1_SET_FILE = '20261118160106_a_trigger_fires_only_on_the_columns_an_update_sets.sql'
G2_FILE = '20261118084759_post_commit_lag_warns_before_the_cascade.sql'
CHECKED = '20261118090000_applier_proof.sql'  # a name the applier checks

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/hand-path-shared-writes')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='hand-path-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55841'
results = {'checks': [], 'production_mutations': False}


def psql(db):
    return [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', db]


def command(args, sql=None):
    r = subprocess.run(list(map(str, args)), input=sql, text=True, capture_output=True, env=env, timeout=300)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(db, sql):
    return command(psql(db), sql)


def attempt(db, sql):
    r = subprocess.run(list(map(str, psql(db))), input=sql, text=True, capture_output=True, env=env, timeout=300)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def node(expr):
    """Evaluate a JS expression with the module imported as m; print its string result."""
    script = (f"import * as m from {json.dumps(str(MODULE))};\n"
              f"const r = await (async () => {{ {expr} }})();\nprocess.stdout.write(typeof r === 'string' ? r : JSON.stringify(r));\n")
    return command(['node', '--input-type=module', '-e', script])


def guarded(name, sql):
    """The migration exactly as the applier would send it (hand-path splice only)."""
    tmp = cluster / 'm.sql'
    tmp.write_text(sql)
    if as_owner:
        shutil.chown(tmp, 'postgres')
    return node(f"""
      const fs = await import('node:fs');
      const src = fs.readFileSync({json.dumps(str(tmp))}, 'utf8');
      return m.handPathGuardSQL({json.dumps(name)}, src, src);""")


def answer(db):
    return json.loads(run(db, 'SELECT public.fn_ca_hand_path_shared_writes()'))


def keys(a):
    return {f"{v['function']}|{v['kind']}|{v['target']}" for v in a['violations']}


# ── the r5 harness's production-shaped schema, read from its source ────────
R5_NAMES = {'RU', 'RC', 'RT1', 'RT2', 'RP1', 'RP2', 'BANK_POOL', 'RAKE_SCHEMA', 'RAKE_TRIGGERS', 'BANK_SCHEMA',
            'BANK_TRIGGERS', 'ROLES', 'RAKE_FIXTURE', 'BANK_FIXTURE', 'RAKE_PART1', 'RAKE_SWITCH', 'BANK_PART1',
            'BANK_SWITCH'}
r5 = {'ROOT': ROOT, 'pathlib': pathlib}
for node_ in ast.parse(R5.read_text()).body:
    if isinstance(node_, ast.Assign) and len(node_.targets) == 1 and isinstance(node_.targets[0], ast.Name) \
            and node_.targets[0].id in R5_NAMES:
        exec(compile(ast.Module([node_], []), str(R5), 'exec'), r5)
missing = R5_NAMES - set(r5)
if missing:
    raise SystemExit(f'r5 harness no longer defines {sorted(missing)}')


def load_fixture(db, fixture, label):
    for name, f in fixture['functions'].items():
        run(db, 'SET check_function_bodies = off;\n' + f['definition'] + ';')
        got = run(db, f"SELECT md5(pg_get_functiondef('{f['signature']}'::regprocedure))")
        check(f'{label}: {name} is the production text', got == f['md5'], got)


def production_before(db):
    """Production on 2026-11-18 for these functions: no #11256/#11266 file installed."""
    run('postgres', f'CREATE DATABASE {db}')
    run(db, r5['RAKE_SCHEMA'])
    load_fixture(db, json.loads(r5['RAKE_FIXTURE'].read_text()), 'cash rake')
    run(db, r5['RAKE_TRIGGERS'])
    run(db, r5['BANK_SCHEMA'])
    load_fixture(db, json.loads(r5['BANK_FIXTURE'].read_text()), 'hand bank')
    run(db, r5['BANK_TRIGGERS'])
    # The two commit doors are not in the fixtures (their production text
    # reaches hundreds of functions this schema does not build); empty
    # stand-ins keep the doors present, so the measurement is of the
    # post-commit envelope, which is what #11270/#11266 change.
    run(db, 'CREATE FUNCTION fn_ca_commit_hand_settlement() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;'
            'CREATE FUNCTION fn_ca_commit_hand_submission() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;')
    run(db, (MIGRATIONS / G1_FILE).read_text())
    run(db, (MIGRATIONS / G1_H2_FILE).read_text())
    run(db, (MIGRATIONS / G1_SET_FILE).read_text())


# What #11270 (re-land of #11256) and #11266 take off the hand path, as the
# reader names it on production's text.
REMOVED = {
    'atomic_distribute_rake|write|union_wallets',
    'atomic_distribute_rake|write|club_wallets',
    'bbj_record_contribution|row_lock|bbj_pools',
    'bbj_record_contribution|write|bbj_pools',
    'fn_bbj_allocate|row_lock|ca_bbj_alloc_state',
    'fn_bbj_allocate|write|ca_bbj_alloc_state',
    'fn_ca_process_hand_post_commit_obligations|advisory_lock|bbj-pool:',
    'fn_ca_process_hand_post_commit_obligations|row_lock|bbj_pools',
    'fn_ca_process_hand_post_commit_obligations|write|bbj_pools',
    'record_insurance_transaction|write|union_wallets',
    'record_insurance_transaction|write|club_wallets',
}

SYNTH = """
CREATE TABLE unions(id uuid PRIMARY KEY);
CREATE TABLE clubs(id uuid PRIMARY KEY, union_id uuid, total_rake numeric DEFAULT 0, table_count int DEFAULT 0);
CREATE TABLE union_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid UNIQUE, rake_wallet numeric DEFAULT 0);
CREATE TABLE union_rake_weekly(union_id uuid, club_id uuid, week_start date, rake numeric,
  PRIMARY KEY (union_id, club_id, week_start));
CREATE TABLE club_table_rake_totals(club_id uuid, table_id uuid, rake numeric, PRIMARY KEY (club_id, table_id));
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, stack numeric, note text);
CREATE TABLE table_seats(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, status text);
CREATE TABLE members(club_id uuid, user_id uuid, status text, promo numeric, PRIMARY KEY (club_id, user_id));

-- a call that writes the union's wallet: a violation, with its path
CREATE FUNCTION fn_synth_bank_rake(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = u; END $$;
-- NOWAIT on the same table in the same function: allowed
CREATE FUNCTION fn_synth_nowait(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM union_wallets WHERE union_id = u FOR NO KEY UPDATE NOWAIT;
      UPDATE union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = u; END $$;
-- FOR UPDATE OF a non-shared alias over a join with clubs: allowed
CREATE FUNCTION fn_synth_lock_of(t uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM tables tb JOIN clubs c ON c.id = tb.club_id WHERE tb.id = t FOR UPDATE OF tb; END $$;
-- FOR UPDATE on clubs: a violation
CREATE FUNCTION fn_synth_lock_club(c uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM clubs WHERE id = c FOR UPDATE; END $$;
-- advisory forms: blocking exclusive on a scope key is a violation; shared and try are not
CREATE FUNCTION fn_synth_adv(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('union-accounting:' || u::text, 0));
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('bbj-pool:' || u::text, 0));
  PERFORM pg_try_advisory_xact_lock(hashtextextended('insurance-bank:' || u::text, 0));
END $$;
-- a per-table row keyed (club_id, table_id) and a per-union-week row
CREATE FUNCTION fn_synth_totals(c uuid, t uuid, u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO club_table_rake_totals VALUES (c, t, 1) ON CONFLICT (club_id, table_id) DO UPDATE SET rake = club_table_rake_totals.rake + 1;
  INSERT INTO union_rake_weekly VALUES (u, c, current_date, 1) ON CONFLICT (union_id, club_id, week_start) DO UPDATE SET rake = union_rake_weekly.rake + 1;
END $$;
-- a banker: excluded with everything below it
CREATE FUNCTION fn_ca_bank_pending_cash_rake(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM fn_synth_banker_only(h); END $$;
CREATE FUNCTION fn_synth_banker_only(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = h; END $$;
-- a name inside a string literal is not a call
CREATE FUNCTION fn_synth_literal_only() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET total_rake = 0 WHERE false; END $$;
-- trigger functions
CREATE FUNCTION fn_synth_seat_stack_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = table_count WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_seat_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = NEW.id; RETURN NEW; END $$;
CREATE TRIGGER t_stack AFTER UPDATE OF stack ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_seat_stack_trg();
CREATE TRIGGER t_leave AFTER UPDATE OF left_at ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_seat_leave_trg();
-- UPDATE OF left_at is a SET-target rule (lane H2): a WHERE that compares
-- left_at fires nothing; a SET target, a quoted target and a tuple target do.
CREATE TABLE seat_where(id uuid PRIMARY KEY, stack numeric, left_at timestamptz, note text);
CREATE TABLE seat_set(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE seat_quoted(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE seat_tuple(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE seat_upsert(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE TABLE seat_unqualified_where(id uuid PRIMARY KEY, stack numeric, left_at timestamptz);
CREATE FUNCTION fn_synth_where_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 1 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_set_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 2 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_quoted_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 3 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_tuple_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 4 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_upsert_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 5 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_unqualified_leave_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = 6 WHERE id = NEW.id; RETURN NEW; END $$;
CREATE TRIGGER t_where AFTER UPDATE OF left_at ON seat_where FOR EACH ROW EXECUTE FUNCTION fn_synth_where_leave_trg();
CREATE TRIGGER t_set AFTER UPDATE OF left_at ON seat_set FOR EACH ROW EXECUTE FUNCTION fn_synth_set_leave_trg();
CREATE TRIGGER t_quoted AFTER UPDATE OF left_at ON seat_quoted FOR EACH ROW EXECUTE FUNCTION fn_synth_quoted_leave_trg();
CREATE TRIGGER t_tuple AFTER UPDATE OF left_at ON seat_tuple FOR EACH ROW EXECUTE FUNCTION fn_synth_tuple_leave_trg();
CREATE TRIGGER t_upsert AFTER UPDATE OF left_at ON seat_upsert FOR EACH ROW EXECUTE FUNCTION fn_synth_upsert_leave_trg();
CREATE TRIGGER t_unq AFTER UPDATE OF left_at ON seat_unqualified_where FOR EACH ROW EXECUTE FUNCTION fn_synth_unqualified_leave_trg();
CREATE FUNCTION fn_synth_seat_writes(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.seat_where s SET stack = 0, note = 'x' WHERE s.id = h AND s.left_at IS NULL AND s.left_at = s.left_at;
  UPDATE seat_set SET stack = 0, left_at = now() WHERE id = h;
  UPDATE seat_quoted SET "left_at" = now() WHERE id = h;
  UPDATE seat_tuple SET (stack, left_at) = (0, now()) WHERE id = h;
  INSERT INTO seat_upsert VALUES (h, 0, NULL) ON CONFLICT (id) DO UPDATE SET left_at = excluded.left_at;
  UPDATE seat_unqualified_where SET stack = 0 WHERE id = h AND left_at = now();
END $$;
-- UPDATE OF triggers whose columns a statement names only OUTSIDE its SET list
-- (WHERE, CASE) never fire; a column SET second in the list, or in the
-- multi-column form, does.
CREATE FUNCTION fn_synth_where_only_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET table_count = table_count WHERE id = NEW.club_id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_second_target_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = NEW.club_id; RETURN NEW; END $$;
CREATE FUNCTION fn_synth_tuple_target_trg() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE clubs SET total_rake = total_rake WHERE id = NEW.club_id; RETURN NEW; END $$;
CREATE TRIGGER t_where_only AFTER UPDATE OF club_id, user_id ON members FOR EACH ROW EXECUTE FUNCTION fn_synth_where_only_trg();
CREATE TRIGGER t_second AFTER UPDATE OF status ON members FOR EACH ROW EXECUTE FUNCTION fn_synth_second_target_trg();
CREATE TRIGGER t_tuple AFTER UPDATE OF status ON tables FOR EACH ROW EXECUTE FUNCTION fn_synth_tuple_target_trg();
CREATE FUNCTION fn_synth_promo_step(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE members SET promo = CASE WHEN status = 'active' THEN promo + 1 ELSE promo END
   WHERE club_id = h AND user_id = h AND status = 'active';
END $$;
CREATE FUNCTION fn_synth_promo_release(h uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE members SET promo = 0,
         status = 'released' WHERE club_id = h;
  UPDATE tables SET (club_id, status) = (club_id, 'open') WHERE id = h;
END $$;
-- a chain of 13 calls: the 13th is beyond the call bound
DO $d$ BEGIN
  EXECUTE 'CREATE FUNCTION fn_synth_deep_13() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN UPDATE unions SET id = id WHERE false; END $b$';
  FOR i IN REVERSE 12..1 LOOP
    EXECUTE format('CREATE FUNCTION fn_synth_deep_%s() RETURNS void LANGUAGE plpgsql AS $b$ BEGIN PERFORM fn_synth_deep_%s(); END $b$', i, i + 1);
  END LOOP;
END $d$;
CREATE FUNCTION fn_ca_process_hand_post_commit_obligations(h uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM fn_synth_bank_rake(h); PERFORM fn_synth_nowait(h); PERFORM fn_synth_lock_of(h);
  PERFORM fn_synth_lock_club(h); PERFORM fn_synth_adv(h); PERFORM fn_synth_totals(h, h, h);
  PERFORM fn_ca_bank_pending_cash_rake(h);
  PERFORM fn_synth_promo_step(h); PERFORM fn_synth_promo_release(h);
  RAISE NOTICE 'see fn_synth_literal_only(%)', h;  -- comment: fn_synth_literal_only()
  PERFORM 'fn_synth_literal_only()';
  UPDATE table_seats SET stack = stack - 1 WHERE id = h;
  PERFORM fn_synth_seat_writes(h);
  RETURN '{}';
END $$;
CREATE FUNCTION fn_ca_commit_hand_settlement() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM fn_synth_deep_1(); END $$;
CREATE FUNCTION fn_ca_commit_hand_submission() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
"""

LAG_SCHEMA = """
CREATE TABLE hand_atomic_commits(table_id uuid NOT NULL, hand_number bigint NOT NULL, hand_id uuid PRIMARY KEY,
  committed_at timestamptz NOT NULL, post_commit_payload jsonb, post_commit_completed_at timestamptz,
  UNIQUE (table_id, hand_number));
CREATE INDEX horse_accepted_window_time ON hand_atomic_commits(committed_at, hand_id);
CREATE INDEX idx_hand_atomic_commits_post_commit_pending ON hand_atomic_commits(table_id, hand_number)
  WHERE post_commit_payload IS NOT NULL AND post_commit_completed_at IS NULL;
CREATE TABLE tables(id uuid PRIMARY KEY, name text, club_id uuid, union_id uuid);
CREATE TABLE financial_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb DEFAULT '{}'::jsonb, resolved boolean DEFAULT false, resolved_at timestamptz,
  created_at timestamptz DEFAULT now(), resolved_by uuid, resolution text);
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
"""


def lag_hands(db, table, n, lag_s, pending=False, age_s=60, start=0):
    """n hands on one table committed age_s ago, each finished lag_s later (or pending)."""
    done = 'NULL' if pending else f"committed_at + interval '{lag_s} seconds'"
    run(db, f"""
INSERT INTO hand_atomic_commits(table_id, hand_number, hand_id, committed_at, post_commit_payload)
SELECT '{table}', {start} + g, gen_random_uuid(), now() - interval '{age_s} seconds' + g * interval '1 second', '{{}}'::jsonb
  FROM generate_series(1, {n}) g;
UPDATE hand_atomic_commits SET post_commit_completed_at = {done}
 WHERE table_id = '{table}' AND hand_number > {start} AND hand_number <= {start} + {n};""")


def lag_alerts(db):
    return json.loads(run(db, """SELECT COALESCE(jsonb_agg(jsonb_build_array(context->>'table_id', severity, resolved)
      ORDER BY context->>'table_id', created_at, severity), '[]') FROM financial_alerts
      WHERE source = 'fn_ca_post_commit_lag_watch'"""))

# ── G3: a hand on a spin / tournament table never waits on a shared row ────
# Lane H2 (incident 075013fd). The production texts of the seat-first count
# trigger chain and of the diamond expiry -> burn chain (md5-equal to
# production on 2026-11-18), and the hand's own seat and roster statements
# copied verbatim from the production commit functions (each found by strpos
# in production on 2026-11-18; the fixture names the function and its md5).
# What a hand must never reach is STUBBED TO BLOCK: fn_spin_book_entry locks
# the club's spin_bonus_pools row, and the two BEFORE UPDATE OF status guards
# on tournaments lock the club and union wallet rows, exactly the rows the
# reader names. A second session holds those rows; if the hand reached any of
# them it would wait and fail on lock_timeout. Positive controls prove the
# stubs block when their real event happens (a third seat fills; a tournament
# changes status; a chip burn), so the harness cannot pass by being blind.
G3_FIXTURE = ROOT / 'scripts' / 'ci' / 'fixtures' / 'hand-path-shared-writes' / 'tournament-spin-diamond-production.json'

G3_SCHEMA = """
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'service_role'::text $$;
CREATE SCHEMA realtime;
CREATE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void LANGUAGE sql AS $$ $$;
CREATE TABLE g3_calls(fn text, at timestamptz DEFAULT clock_timestamp());
CREATE TABLE unions(id uuid PRIMARY KEY, name text);
CREATE TABLE clubs(id uuid PRIMARY KEY, union_id uuid, name text, chip_treasury numeric DEFAULT 0);
CREATE TABLE union_wallets(union_id uuid PRIMARY KEY, chip_balance numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE spin_bonus_pools(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid UNIQUE, owner_kind text,
  balance numeric DEFAULT 0);
CREATE TABLE tournaments(id uuid PRIMARY KEY, club_id uuid, status text, format_contract text, max_players int,
  variant text, current_players int, updated_at timestamptz);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, tournament_id uuid, status text, current_players int,
  updated_at timestamptz);
CREATE TABLE table_seats(id uuid PRIMARY KEY, table_id uuid, user_id uuid, seat_number int, stack numeric,
  joined_at timestamptz, left_at timestamptz, status text, leave_pending boolean, is_sitting_out boolean,
  is_away boolean, sit_out_at timestamptz, scheduled_leave_hands int, time_bank_uses_remaining int,
  time_bank_remaining int, club_id uuid);
CREATE TABLE tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid,
  status text, chips integer, table_id uuid, seat_number int, rebuy_prompt_until timestamptz);
CREATE TABLE profiles(id uuid PRIMARY KEY, diamonds bigint DEFAULT 0, username text, full_name text, role text);
CREATE TABLE diamond_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text,
  transaction_type text, amount bigint, balance_after bigint, description text, source text, metadata jsonb,
  counterparty text, issuance_class text, reference_id text, created_at timestamptz DEFAULT now());
CREATE TABLE lifetime_vip_diamond_lots(id uuid PRIMARY KEY, user_id uuid, status text, remaining_amount int,
  consumed_amount int DEFAULT 0, expired_amount int DEFAULT 0, expires_at timestamptz, issued_at timestamptz,
  expiry_transaction_id uuid, updated_at timestamptz);
CREATE TABLE lifetime_vip_diamond_lot_allocations(transaction_id uuid, lot_id uuid, user_id uuid, amount int);
CREATE TABLE ca_op_claims(op_id text, fn_name text, claimed_by uuid, result jsonb, finalized_at timestamptz,
  PRIMARY KEY (op_id, fn_name));
CREATE TABLE ca_mint_ledger(op_id text, action text, asset text, holder_type text, holder_id uuid, holder_label text,
  amount numeric, balance_before numeric, balance_after numeric, supply_after numeric, reason text,
  performed_by uuid, performed_by_label text, chip_ledger_id uuid, diamond_tx_id uuid);
CREATE TABLE chip_transactions(club_id uuid, from_user_id uuid, to_user_id uuid, amount numeric,
  transaction_type text, notes text, balance_after numeric);
CREATE TABLE chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text);
CREATE FUNCTION fn_ca_tournament_recorded_seat_first(uuid, boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION fn_tournament_primary_table(uuid) RETURNS uuid LANGUAGE sql AS
  $$ SELECT id FROM tables WHERE tournament_id = $1 AND lower(COALESCE(status, '')) <> 'closed' ORDER BY id LIMIT 1 $$;
CREATE FUNCTION fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION fn_ca_declare_ledger(text, text, uuid, uuid, text, uuid) RETURNS void LANGUAGE sql AS $$ $$;
CREATE FUNCTION fn_ca_release_claim(text, text, jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT $3 $$;
-- What a hand must never reach, stubbed to take exactly the shared row the reader names.
CREATE FUNCTION fn_spin_book_entry(p uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO g3_calls(fn) VALUES ('fn_spin_book_entry');
  PERFORM 1 FROM spin_bonus_pools sp JOIN tournaments t ON t.club_id = sp.club_id WHERE t.id = p FOR UPDATE OF sp;
  RETURN jsonb_build_object('ok', true, 'reason', 'booked');
END $$;
CREATE FUNCTION fn_sync_tournament_current_players() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN  -- production SETs only tournaments.current_players
  INSERT INTO g3_calls(fn) VALUES ('fn_sync_tournament_current_players');
  UPDATE tournaments SET current_players = current_players WHERE id = COALESCE(NEW.tournament_id, OLD.tournament_id);
  RETURN NULL;
END $$;
CREATE FUNCTION fn_ca_fund_overlay_on_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO g3_calls(fn) VALUES ('fn_ca_fund_overlay_on_lock');
  PERFORM 1 FROM clubs WHERE id = NEW.club_id FOR UPDATE;
  PERFORM 1 FROM union_wallets w JOIN clubs c ON c.union_id = w.union_id WHERE c.id = NEW.club_id FOR UPDATE OF w;
  RETURN NEW;
END $$;
CREATE FUNCTION fn_guard_tournament_start_readiness() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO g3_calls(fn) VALUES ('fn_guard_tournament_start_readiness');
  PERFORM 1 FROM clubs WHERE id = NEW.club_id FOR UPDATE;
  PERFORM 1 FROM union_wallets w JOIN clubs c ON c.union_id = w.union_id WHERE c.id = NEW.club_id FOR UPDATE OF w;
  RETURN NEW;
END $$;
"""

G3_IDS = dict(
    U='a3000000-0000-0000-0000-000000000001', C='a3000000-0000-0000-0000-000000000002',
    T='a3000000-0000-0000-0000-000000000003', TB='a3000000-0000-0000-0000-000000000004',
    P1='a3000000-0000-0000-0000-000000000011', P2='a3000000-0000-0000-0000-000000000012',
    P3='a3000000-0000-0000-0000-000000000013', S1='a3000000-0000-0000-0000-000000000021',
    S2='a3000000-0000-0000-0000-000000000022', S3='a3000000-0000-0000-0000-000000000023',
    LOT_OLD='a3000000-0000-0000-0000-000000000031', LOT_NEW='a3000000-0000-0000-0000-000000000032')

G3_SEED = """
INSERT INTO unions VALUES ('{U}', 'Union');
INSERT INTO clubs VALUES ('{C}', '{U}', 'Club', 1000);
INSERT INTO union_wallets VALUES ('{U}', 1000, now());
INSERT INTO spin_bonus_pools(club_id, owner_kind, balance) VALUES ('{U}', 'union', 500), ('{C}', 'club', 500);
INSERT INTO tournaments VALUES ('{T}', '{C}', 'RUNNING', 'spin-v1', 3, 'spin', 3, now());
INSERT INTO tables VALUES ('{TB}', '{C}', '{T}', 'active', 3, now());
INSERT INTO table_seats(id, table_id, user_id, seat_number, stack, joined_at, status, club_id)
VALUES ('{S1}', '{TB}', '{P1}', 1, 500, now() - interval '1 minute', 'active', '{C}'),
       ('{S2}', '{TB}', '{P2}', 2, 500, now() - interval '1 minute', 'active', '{C}'),
       ('{S3}', '{TB}', '{P3}', 3, 500, now() - interval '1 minute', 'active', '{C}');
INSERT INTO tournament_players(tournament_id, user_id, status, chips, table_id, seat_number)
VALUES ('{T}', '{P1}', 'playing', 500, '{TB}', 1), ('{T}', '{P2}', 'playing', 500, '{TB}', 2),
       ('{T}', '{P3}', 'playing', 500, '{TB}', 3);
INSERT INTO profiles(id, diamonds, username, role) VALUES ('{P1}', 1000, 'p1', 'player');
INSERT INTO lifetime_vip_diamond_lots(id, user_id, status, remaining_amount, expires_at, issued_at)
VALUES ('{LOT_OLD}', '{P1}', 'active', 100, now() - interval '1 day', now() - interval '31 days'),
       ('{LOT_NEW}', '{P1}', 'active', 300, now() + interval '20 days', now() - interval '10 days');
""".format(**G3_IDS)

# One hand on the full spin table: P3 busts to P1. The seat and roster
# statements are the production texts, in the order the commit runs them.
G3_HAND = """
DO $hand$
DECLARE
  p_table_id uuid := '{TB}';
  v_tournament_id uuid := '{T}';
  v_lightning_seats jsonb := '{{}}'::jsonb;
  v_exact_seat_generation boolean := true;
  v_result jsonb := '{{}}'::jsonb;
  v_item jsonb;
  e jsonb;
  v_uid uuid;
  v_target numeric;
  v_targets jsonb := jsonb_build_object('{P1}', 1000, '{P2}', 500, '{P3}', 0);
  v_zero_stack_seat_ids uuid[] := ARRAY['{S3}'::uuid];
  v_zero_stack_vacated_at timestamptz := clock_timestamp();
  v_table_live_seat_count integer;
  v_written numeric;
  v_seat record;
  v_prompt_until timestamptz := now() + interval '10 seconds';
BEGIN
  -- the commit's time-bank write (fn_ca_commit_hand_settlement)
  FOR v_item IN SELECT jsonb_build_object('user_id', s.user_id, 'uses_remaining', 2, 'seconds_remaining', 30,
                         'seat_id', s.id, 'seat_joined_at', s.joined_at)
                  FROM table_seats s WHERE s.table_id = p_table_id AND s.left_at IS NULL LOOP
    UPDATE public.table_seats s
         SET time_bank_uses_remaining = (v_item->>'uses_remaining')::integer,
             time_bank_remaining = (v_item->>'seconds_remaining')::integer
       WHERE s.table_id = COALESCE((v_lightning_seats->>(v_item->>'user_id'))::uuid, p_table_id)
         AND s.user_id = (v_item->>'user_id')::uuid;
  END LOOP;
  -- the stack write, one per seat (fn_ca_settle_hand_stacks_absolute)
  FOR e IN SELECT jsonb_build_object('user_id', s.user_id, 'seat_id', s.id, 'seat_joined_at', s.joined_at)
             FROM table_seats s WHERE s.table_id = p_table_id AND s.left_at IS NULL ORDER BY s.id LOOP
    v_uid := (e->>'user_id')::uuid;
    v_target := (v_targets->>(v_uid::text))::numeric;
          UPDATE public.table_seats ts SET stack = v_target
           WHERE ts.id = (e->>'seat_id')::uuid
             AND ts.joined_at = (e->>'seat_joined_at')::timestamptz
             AND ts.table_id = COALESCE((v_lightning_seats->>v_uid::text)::uuid, p_table_id)
             AND ts.user_id = v_uid
             AND ts.left_at IS NULL;
  END LOOP;
      UPDATE public.tournament_players tp
         SET chips = target.stack
        FROM (
          SELECT x.key::uuid AS user_id,x.value::numeric AS stack
            FROM jsonb_each_text(v_targets) AS x(key,value)
        ) target
       WHERE tp.tournament_id = v_tournament_id
         AND tp.user_id = target.user_id
         AND tp.status::text = 'playing';
        UPDATE public.table_seats ts
           SET left_at = v_zero_stack_vacated_at,
               status = 'left',
               leave_pending = false,
               is_sitting_out = false,
               is_away = false,
               sit_out_at = NULL,
               scheduled_leave_hands = NULL
         WHERE ts.id = ANY(v_zero_stack_seat_ids)
           AND ts.table_id = p_table_id
           AND ts.left_at IS NULL
           AND ts.stack = 0;
      SELECT count(*) INTO v_table_live_seat_count
        FROM public.table_seats ts
       WHERE ts.table_id = p_table_id AND ts.left_at IS NULL;
      UPDATE public.tables tb
         SET current_players = v_table_live_seat_count,
             updated_at = now()
       WHERE tb.id = p_table_id
         AND tb.current_players IS DISTINCT FROM v_table_live_seat_count;
  -- the lease generation's roster writes (fn_ca_commit_hand_settlement_before_lease_generation)
  FOR v_seat IN SELECT * FROM table_seats s WHERE s.table_id = p_table_id AND s.left_at IS NULL LOOP
    v_uid := v_seat.user_id;
    v_written := v_seat.stack;
        UPDATE public.tournament_players tp
           SET chips=greatest(v_written,0)::integer,
               table_id=p_table_id,
               seat_number=v_seat.seat_number
         WHERE tp.tournament_id=v_tournament_id AND tp.user_id=v_uid
           AND tp.status='playing';
          UPDATE public.tournament_players tp
             SET rebuy_prompt_until=v_prompt_until
           WHERE tp.tournament_id=v_tournament_id AND tp.user_id=v_uid
             AND tp.status='playing';
  END LOOP;
END $hand$;
""".format(**G3_IDS)


def g3_hold(db, sql):
    """A second session that takes `sql`'s locks and keeps its transaction open."""
    proc = subprocess.Popen(list(map(str, psql(db))), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, env=env)
    proc.stdin.write("SET application_name = 'g3_holder';\nBEGIN;\n" + sql + "\nSELECT pg_sleep(120);\n")
    proc.stdin.flush()
    for _ in range(200):
        if run(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'g3_holder' "
                   "AND wait_event = 'PgSleep'") == '1':
            return proc
        subprocess.run(['sleep', '0.05'])
    proc.kill()
    raise RuntimeError('the holder session never took its locks')


def g3_release(db, proc):
    run(db, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'g3_holder'")
    try:
        proc.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def g3_try(db, sql):
    """Run `sql` from a third session that refuses to wait more than 2 s on any lock."""
    return attempt(db, "SET lock_timeout = '2s';\nSET statement_timeout = '20s';\n" + sql)


G3_HOLD_SHARED = """
SELECT 1 FROM spin_bonus_pools FOR UPDATE;
SELECT 1 FROM clubs FOR UPDATE;
SELECT 1 FROM union_wallets FOR UPDATE;
UPDATE union_wallets SET chip_balance = chip_balance + 1;
UPDATE clubs SET chip_treasury = chip_treasury + 1;
"""


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''",
                        '-l', cluster / 'log', '-w', 'start'])
    run('postgres', r5['ROLES'])

    # ── G1.1 the rules on a synthetic catalog ──────────────────────────────
    run('postgres', 'CREATE DATABASE synth')
    run('synth', SYNTH)
    run('synth', (MIGRATIONS / G1_FILE).read_text())
    old = keys(answer('synth'))
    check('G1 rules: the first reader followed a trigger whose column was only in the WHERE clause (the false positive)',
          'fn_synth_where_only_trg|write|clubs' in old, old)
    for f in (G1_H2_FILE, G1_SET_FILE):
        status, _, err = attempt('synth', guarded(f, (MIGRATIONS / f).read_text()))
        check(f'G1 rules: the SET-target reader {f[:14]} installs through the applier check', status == 0, err[-600:])
        proof = (MIGRATIONS / f).read_text().split('@live-proof: ', 1)[1].split('\n', 1)[0]
        check(f'G1 rules: {f[:14]} carries its live proof', run('synth', 'SELECT ' + proof) == 't', proof)
    a = answer('synth')
    k = keys(a)
    paths = {f"{v['function']}|{v['kind']}|{v['target']}": v['path'] for v in a['violations']}
    check('G1 rules: all three doors are found', sorted(a['roots']) == sorted(
        ['fn_ca_commit_hand_settlement', 'fn_ca_commit_hand_submission', 'fn_ca_process_hand_post_commit_obligations']), a['roots'])
    check('G1 rules: a call that writes the union wallet is a violation, with its path',
          paths.get('fn_synth_bank_rake|write|union_wallets') == 'fn_ca_process_hand_post_commit_obligations -> fn_synth_bank_rake', paths)
    check('G1 rules: a write after NOWAIT on the same table is allowed', not any(x.startswith('fn_synth_nowait|') for x in k), k)
    check('G1 rules: FOR UPDATE OF a non-shared alias is allowed', not any(x.startswith('fn_synth_lock_of|') for x in k), k)
    check('G1 rules: FOR UPDATE on clubs is a violation', 'fn_synth_lock_club|row_lock|clubs' in k, k)
    check('G1 rules: a blocking exclusive scope advisory lock is a violation; shared and try are not',
          {x for x in k if x.startswith('fn_synth_adv|')} == {'fn_synth_adv|advisory_lock|union-accounting:'}, k)
    check('G1 rules: a per-union-week key is shared, a per-table key is not',
          'fn_synth_totals|write|union_rake_weekly' in k and 'fn_synth_totals|write|club_table_rake_totals' not in k
          and 'union_rake_weekly' in a['shared_tables'] and 'club_table_rake_totals' not in a['shared_tables'], k)
    check('G1 rules: a banker and everything only it reaches are excluded',
          not any(x.startswith(('fn_ca_bank_pending_cash_rake|', 'fn_synth_banker_only|')) for x in k), k)
    check('G1 rules: a name in a string literal or a comment is not a call',
          not any(x.startswith('fn_synth_literal_only|') for x in k), k)
    check('G1 rules: an UPDATE OF trigger is followed only when the statement names its column',
          paths.get('fn_synth_seat_stack_trg|write|clubs') == 'fn_ca_process_hand_post_commit_obligations =T=> fn_synth_seat_stack_trg'
          and not any(x.startswith('fn_synth_seat_leave_trg|') for x in k), paths)
    leave = {x.split('|')[0] for x in k if x.startswith('fn_synth_') and x.endswith('_leave_trg|write|clubs')}
    check('G1 rules: an UPDATE OF trigger fires on a SET target (plain, quoted, tuple, upsert), never on a column '
          'only a WHERE compares, qualified or not (20261118160106)',
          leave == {'fn_synth_set_leave_trg', 'fn_synth_quoted_leave_trg', 'fn_synth_tuple_leave_trg',
                    'fn_synth_upsert_leave_trg'}, sorted(leave))
    check('G1 rules: an UPDATE OF trigger whose columns appear only in the WHERE clause or a CASE is not followed',
          not any(x.startswith('fn_synth_where_only_trg|') for x in k), k)
    check('G1 rules: a column SET second in the list fires its trigger',
          paths.get('fn_synth_second_target_trg|write|unions') ==
          'fn_ca_process_hand_post_commit_obligations -> fn_synth_promo_release =T=> fn_synth_second_target_trg', paths)
    check('G1 rules: the multi-column SET (a, b) = ... form is matched conservatively',
          'fn_synth_tuple_target_trg|write|clubs' in k, k)
    check('G1 rules: the call bound stops at 12 calls',
          not any(x.startswith('fn_synth_deep_13|') for x in k) and a['closure'] > 0, k)
    run('synth', 'ALTER FUNCTION fn_ca_commit_hand_submission() RENAME TO fn_ca_commit_hand_submission_old')
    check('G1 rules: a missing door is reported, never read as clean',
          'fn_ca_commit_hand_submission' not in answer('synth')['roots'])
    run('synth', 'ALTER FUNCTION fn_ca_commit_hand_submission_old() RENAME TO fn_ca_commit_hand_submission')

    # ── G1.3 the applier check ─────────────────────────────────────────────
    adds = """BEGIN;
CREATE FUNCTION fn_synth_new_union_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = NEW.hand_id; RETURN NEW; END $$;
CREATE TRIGGER t_new AFTER UPDATE OF stack ON table_seats FOR EACH ROW EXECUTE FUNCTION fn_synth_new_union_write();
COMMIT;
"""
    status, _, err = attempt('synth', guarded(CHECKED, adds))
    check('G1 applier: a migration that adds a shared write to the hand path is refused',
          status != 0 and 'migration_adds_a_shared_write_to_the_hand_path' in err
          and 'fn_synth_new_union_write write union_wallets' in err, err[-400:])
    check('G1 applier: nothing of the refused migration is installed',
          run('synth', "SELECT to_regprocedure('fn_synth_new_union_write()') IS NULL AND NOT EXISTS "
                       "(SELECT 1 FROM pg_trigger WHERE tgname = 't_new')") == 't')
    declared = '-- @hand-path-shared-write-ok: fn_synth_new_union_write write union_wallets proof of the declaration\n' + adds
    status, _, err = attempt('synth', guarded(CHECKED, declared))
    check('G1 applier: the same migration installs when it declares the write', status == 0, err[-400:])
    removes = 'BEGIN;\nDROP TRIGGER t_new ON table_seats;\nDROP FUNCTION fn_synth_new_union_write();\nCOMMIT;\n'
    status, _, err = attempt('synth', guarded(CHECKED, removes))
    check('G1 applier: a migration that removes a violation installs', status == 0, err[-400:])
    data_only = "BEGIN;\nUPDATE clubs SET total_rake = 0 WHERE false;\nCOMMIT;\n"
    check('G1 applier: a data-only migration carries no splice', guarded(CHECKED, data_only) == data_only.strip())
    check('G1 applier: a file before the cutover carries no splice',
          guarded('20261118000000_old.sql', adds) == adds.strip())
    drops_door = 'BEGIN;\nDROP FUNCTION fn_ca_commit_hand_submission();\nCOMMIT;\n'
    status, _, err = attempt('synth', guarded(CHECKED, drops_door))
    check('G1 applier: dropping a hand door without naming its successor is refused',
          status != 0 and 'hand_path_door_missing' in err, err[-300:])

    # ── G1.4 catalog-fingerprint fast-path soundness (no false negatives) ──
    def guarded_mode(sql):
        """Run guarded SQL and read ca.hand_path_check_mode just before COMMIT."""
        g = guarded(CHECKED, sql)
        idx = g.rfind('COMMIT;')
        assert idx != -1
        probe = g[:idx] + "SELECT current_setting('ca.hand_path_check_mode') || '|' || current_setting('search_path');\nCOMMIT;"
        return attempt('synth', probe)

    unrelated_fn = """BEGIN;
CREATE OR REPLACE FUNCTION public.fn_synth_unrelated_report() RETURNS int LANGUAGE sql AS $$ SELECT 42 $$;
COMMIT;
"""
    status, out_mode, err = guarded_mode(unrelated_fn)
    check('G1 fast-path: unrelated function DDL hits fast_path and restores search_path',
          status == 0 and out_mode.startswith('fast_path|') and 'pg_catalog' not in out_mode.split('|', 1)[1],
          f'status={status} out={out_mode!r} err={err[-300:]}')

    overload_adds = """BEGIN;
CREATE FUNCTION public.fn_synth_nowait(u uuid, extra int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = u; END $$;
COMMIT;
"""
    status, _, err = attempt('synth', guarded(CHECKED, overload_adds))
    check('G1 fast-path: adding a new overload of a reachable callee invalidates fingerprint and is refused',
          status != 0 and 'migration_adds_a_shared_write_to_the_hand_path' in err
          and 'fn_synth_nowait write unions' in err, err[-400:])

    mutate_reachable = """BEGIN;
CREATE OR REPLACE FUNCTION public.fn_synth_nowait(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE unions SET id = id WHERE id = u; END $$;
COMMIT;
"""
    status, _, err = attempt('synth', guarded(CHECKED, mutate_reachable))
    check('G1 fast-path: mutating a reachable function body invalidates fingerprint and is refused',
          status != 0 and 'migration_adds_a_shared_write_to_the_hand_path' in err
          and 'fn_synth_nowait write unions' in err, err[-400:])

    share_written_table = """BEGIN;
CREATE UNIQUE INDEX idx_synth_club_table_shared ON public.club_table_rake_totals (club_id);
COMMIT;
"""
    status, _, err = attempt('synth', guarded(CHECKED, share_written_table))
    check('G1 fast-path: adding a unique shared-scope index on a written table invalidates fingerprint and is refused',
          status != 0 and 'migration_adds_a_shared_write_to_the_hand_path' in err
          and 'fn_synth_totals write club_table_rake_totals' in err, err[-400:])

    safe_reachable_edit = """BEGIN;
CREATE OR REPLACE FUNCTION public.fn_synth_nowait(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM 1 FROM union_wallets WHERE union_id = u FOR NO KEY UPDATE NOWAIT;
      UPDATE union_wallets SET rake_wallet = rake_wallet + 2 WHERE union_id = u; END $$;
COMMIT;
"""
    status, out_mode, err = guarded_mode(safe_reachable_edit)
    check('G1 fast-path: safe edit to a reachable function runs full_bfs and installs cleanly',
          status == 0 and out_mode.startswith('full_bfs|'),
          f'status={status} out={out_mode!r} err={err[-300:]}')

    # ── G1.2 production texts, before and after #11270 / #11266 ───────────
    production_before('handpre')
    before = answer('handpre')
    results['production_before'] = before
    check('G1 production BEFORE: every shared write #11270/#11266 remove is reported',
          REMOVED <= keys(before), sorted(REMOVED - keys(before)))
    for f in (r5['RAKE_PART1'], r5['RAKE_SWITCH'], r5['BANK_PART1'], r5['BANK_SWITCH']):
        status, _, err = attempt('handpre', guarded(CHECKED, (MIGRATIONS / f).read_text()))
        check(f'G1 production: the applier check admits {f}', status == 0, err[-600:])
    after = answer('handpre')
    results['production_after'] = after
    check('G1 production AFTER: none of them remains on the hand path',
          not (REMOVED & keys(after)), sorted(REMOVED & keys(after)))
    check('G1 production AFTER: nothing new appeared', keys(after) <= keys(before), sorted(keys(after) - keys(before)))
    banker = run('handpre', "SELECT count(*) FROM pg_proc WHERE proname IN "
                            "('fn_ca_bank_pending_cash_rake', 'fn_ca_bank_pending_hand_obligations')")
    check('G1 production AFTER: both bankers are installed (and excluded by name)', banker == '2', banker)

    # ── G3 a hand on a spin / tournament table never waits on a shared row ──
    run('postgres', 'CREATE DATABASE g3')
    run('g3', G3_SCHEMA)
    g3fx = json.loads(G3_FIXTURE.read_text())
    load_fixture('g3', g3fx, 'G3 production text')
    for tdef in g3fx['triggers'].values():
        run('g3', tdef + ';')
    run('g3', G3_SEED)
    seeded = run('g3', "SELECT string_agg(DISTINCT fn, ',' ORDER BY fn) FROM g3_calls")
    check('G3 seed: the third paid seat booked the spin when it was seated (the event that owns the booking)',
          seeded == 'fn_spin_book_entry,fn_sync_tournament_current_players', seeded)
    run('g3', 'TRUNCATE g3_calls')
    holder = g3_hold('g3', G3_HOLD_SHARED)
    try:
        status, _, err = g3_try('g3', G3_HAND)
        check('G3 spin hand: a hand that busts a seat on a full spin table commits while another session holds '
              'the spin pool, the club and the union wallet rows', status == 0, err[-600:])
    finally:
        g3_release('g3', holder)
    state = run('g3', "SELECT (SELECT count(*) FROM table_seats WHERE left_at IS NULL) || '|' || "
                      "(SELECT current_players FROM tournaments) || '|' || "
                      "COALESCE((SELECT string_agg(DISTINCT fn, ',' ORDER BY fn) FROM g3_calls), '')")
    check('G3 spin hand: the seat-first count ran on the vacate (2 live seats, tournament count 2) and nothing '
          'booked, funded or readied anything', state == '2|2|', state)
    # Positive controls: the same stubs DO block when their own event happens.
    run('g3', "TRUNCATE g3_calls; UPDATE tournaments SET current_players = 2")
    holder = g3_hold('g3', G3_HOLD_SHARED)
    try:
        status, _, err = g3_try('g3', ("UPDATE table_seats SET left_at = NULL, status = 'active', stack = 500, "
                                       "joined_at = clock_timestamp() WHERE id = '{S3}'").format(**G3_IDS))
        check('G3 control: a third seat FILLING the spin table books the entry and waits on the held spin pool',
              status != 0 and 'lock timeout' in err, err[-300:])
        status, _, err = g3_try('g3', "UPDATE tournaments SET status = 'LOCKED'")
        check('G3 control: a tournament STATUS transition reaches the overlay/readiness guards and waits on the '
              'held club row', status != 0 and 'lock timeout' in err, err[-300:])
        status, _, err = g3_try('g3', ("SELECT fn_ca_burn('chips', 'club', '{C}', 1, 'a proof chip retirement', "
                                       "'g3-chips')").format(**G3_IDS))
        check('G3 control: a CHIP burn from a club waits on the held club row', status != 0 and 'lock timeout' in err,
              err[-300:])
    finally:
        g3_release('g3', holder)
    # The diamond chain: a jackpot credit to a player with an open receivable
    # writes the negative debt-settlement row (add_diamonds_to_balance), which
    # fires allocate -> expire -> fn_ca_burn('diamonds', 'player', ...).
    holder = g3_hold('g3', G3_HOLD_SHARED)
    try:
        status, _, err = g3_try('g3', ("INSERT INTO diamond_transactions(user_id, amount, transaction_type, type, "
                                       "balance_after, reference_id, counterparty, issuance_class) VALUES "
                                       "('{P1}', 50, 'arena_withdraw', 'arena_withdraw', 1050, 'bbjpay:x:1:loser:{P1}', "
                                       "'arena_custody:x', 'arena');").format(**G3_IDS))
        check('G3 diamond: a positive jackpot credit fires no spend allocation', status == 0, err[-300:])
        fired = run('g3', 'SELECT count(*) FROM lifetime_vip_diamond_lot_allocations') + '|' + \
            run('g3', "SELECT count(*) FROM ca_mint_ledger")
        check('G3 diamond: nothing allocated, nothing burned for a credit', fired == '0|0', fired)
        status, _, err = g3_try('g3', ("INSERT INTO diamond_transactions(user_id, amount, transaction_type, type, "
                                       "balance_after, reference_id, counterparty, issuance_class) VALUES "
                                       "('{P1}', -50, 'debt_settlement', 'debt_settlement', 1000, 'debt-settlement:x', "
                                       "'receivable:diamond_debts', 'spend');").format(**G3_IDS))
        check('G3 diamond: the debt-settlement row expires an overdue VIP lot through fn_ca_burn while another '
              'session holds the club and union wallet rows', status == 0, err[-600:])
    finally:
        g3_release('g3', holder)
    burned = run('g3', ("SELECT (SELECT status || ':' || expired_amount FROM lifetime_vip_diamond_lots WHERE id = '{LOT_OLD}') "
                        "|| '|' || (SELECT remaining_amount FROM lifetime_vip_diamond_lots WHERE id = '{LOT_NEW}') "
                        "|| '|' || (SELECT holder_type || ':' || amount FROM ca_mint_ledger) "
                        "|| '|' || (SELECT diamonds FROM profiles WHERE id = '{P1}') "
                        "|| '|' || (SELECT chip_treasury FROM clubs) || '|' || (SELECT chip_balance FROM union_wallets)"
                        ).format(**G3_IDS))
    check('G3 diamond: the expiry burned 100 from the player (not a club or union), allocated 50 to the live lot, '
          'and the club and union wallets are untouched', burned == 'expired:100|250|player:100|900|1000|1000', burned)

    # ── G2 the lag watch ───────────────────────────────────────────────────
    run('postgres', 'CREATE DATABASE lag')
    run('lag', LAG_SCHEMA)
    status, _, err = attempt('lag', guarded(CHECKED, (MIGRATIONS / G2_FILE).read_text()))
    check('G2: the migration installs through the applier check', status == 0, err[-600:])
    check('G2: one detector job, every minute',
          run('lag', "SELECT schedule || ' ' || command FROM cron.job WHERE jobname = 'post-commit-lag-watch-1m'")
          == '* * * * * select public.fn_ca_post_commit_lag_watch()')
    T = [f'7a000000-0000-0000-0000-0000000000{i:02d}' for i in range(1, 16)]
    run('lag', 'INSERT INTO tables(id, name) SELECT t::uuid, \'T\' || row_number() OVER () FROM unnest(ARRAY[%s]) t'
        % ','.join(f"'{t}'" for t in T))
    lag_hands('lag', T[0], 10, 0.4)                    # healthy
    lag_hands('lag', T[1], 10, 3.0)                    # p95 3 s: warning
    lag_hands('lag', T[2], 3, 1.0)                     # too few hands to judge p95
    lag_hands('lag', T[3], 1, 0, pending=True, age_s=20)  # one hand pending 20 s: critical
    first = json.loads(run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()'))
    results['lag_first'] = first
    alerts = lag_alerts('lag')
    check('G2: a healthy table and a thin sample raise nothing; 3 s p95 warns; a 20 s pending hand is critical',
          alerts == [[T[1], 'warning', False], [T[3], 'critical', False]], alerts)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    check('G2: a second run raises nothing new for the same tables', lag_alerts('lag') == alerts, lag_alerts('lag'))
    lag_hands('lag', T[1], 10, 20.0, start=100)       # the warning table goes past 15 s
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    al = lag_alerts('lag')
    check('G2: a warning table that crosses 15 s escalates: warning resolved, one critical open',
          [x for x in al if x[0] == T[1]] == [[T[1], 'warning', True], [T[1], 'critical', False]], al)
    run('lag', f"UPDATE hand_atomic_commits SET post_commit_completed_at = committed_at + interval '0.3 seconds' "
               f"WHERE table_id IN ('{T[1]}', '{T[3]}')")
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    check('G2: when the lag clears every open alert resolves',
          run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved") == '0',
          lag_alerts('lag'))
    for t in T[4:]:
        lag_hands('lag', t, 6, 4.0, start=200)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    opened = run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved")
    check('G2: a storm opens at most 10 alerts per run', opened == '10', opened)
    run('lag', 'SELECT public.fn_ca_post_commit_lag_watch()')
    opened = run('lag', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' AND NOT resolved")
    check('G2: the next run names the rest', opened == '11', opened)
    results['passed'] = True
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2, default=str) + '\n')

print(json.dumps({'passed': results.get('passed', False), 'checks': len(results['checks']),
                  'failed': [c for c in results['checks'] if not c['passed']]}, indent=2))
