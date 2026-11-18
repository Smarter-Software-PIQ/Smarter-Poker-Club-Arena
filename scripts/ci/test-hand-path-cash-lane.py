"""A hand never waits on the club bank for a departed or deleted wallet.

Proves, on a throwaway PostgreSQL cluster (no network, no production
connection), migrations 20261118161644 (on merge, no table lock) and
20261118161703 (daily window: triggers on clubs and profiles) of incident
075013fd lane H1, with
production's own texts of the four functions it replaces
(scripts/ci/fixtures/hand-path-cash-lane/, md5-equal to production on
2026-11-18) and the production trigger definitions:

  R  the hand-path reader (20261118084747 + 20261118160106) on this catalog:
     BEFORE, a cash hand's settlement credit reaches the club bank row
     (fn_ca_deleted_wallet_bank_return, fn_ca_horse_split_return_late_credit,
     and through the bank write the union ladder); AFTER, none of the five;
     after part 1 the club bank write and the horse return are gone and
     only the two edges part 2 removes remain; both parts install through
     the applier's own stale-pin and hand-path checks, with the money-RPC
     registry guard armed, and part 2 passes the window installer's static
     admission.
  W  WAIT: another session holds the club bank row. BEFORE, the hand's
     credit to a deleted account waits (the function's own 4 s lock_timeout)
     and a split-departed horse's waits 200 ms; AFTER, both complete at once:
     the credit lands, the return is deferred with a warning, nothing moves
     to the bank, and the next credit after the bank frees returns the whole
     balance. A horse split return is no longer blocked by a FOR KEY SHARE
     (an insert referencing the club).
  S  SAME: uncontended, BEFORE and AFTER write the same balances, bank,
     receipts and alerts for: a deleted account's credit (member and agent
     wallets), a split-departed horse's late credit, account deletion
     returning both wallets, the explicit return, and the not-deleted /
     unknown-source answers.
  C  CALLERS: fn_ca_deleted_wallet_bank_return still waits for a busy bank
     (and returns once it frees), account deletion still returns.
  U  UNION LADDER: a member-count change recomputes the union exactly as
     before (single and multi-row statements); a bank write no longer runs it.
"""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
FX = ROOT / 'scripts' / 'ci' / 'fixtures' / 'hand-path-cash-lane'
READER = ['20261118084747_a_hands_money_path_never_writes_a_shared_row.sql',
          '20261118160106_a_trigger_fires_only_on_the_columns_an_update_sets.sql']
PART1 = '20261118161644_a_hand_never_waits_on_the_club_bank_for_a_deleted_or_departe.sql'
PART2 = '20261118161703_account_deletion_and_union_counts_keep_their_own_triggers_of.sql'
# the projection hook, its own migration (the 20261118155509 law), installed right after part 1
PART1B = '20261118191855_the_projection_pass_banks_a_stored_wallet_return_inside_its_.sql'
PRODUCTION = {
    'fn_ca_deleted_wallet_bank_return': 'b8b056e0cd202d442da0133271814c06',
    'fn_ca_deleted_wallet_credit': '38381e35aa9804fb1e109c20855e4854',
    'fn_ca_horse_split_return_late_credit': 'b4d29a312a1d98b8a1b9c9ef7d0bb19b',
    'fn_union_totals_follow_club_counts': 'b504648fecedb704e0247a90fd476db2',
    # #11300's postimage (20261118155509), which installs before 20261118161644
    'fn_project_hand_side_effects': '94588bd7bc75f60b9b575eb396549d5c',
    'fn_ca_post_commit_lag_watch': 'e58b975340e642f0e93fdda8eff89f02',
}
AFTER_PART1 = {
    'fn_ca_deleted_wallet_bank_return|row_lock|clubs',
    'fn_apply_union_ladder|write|unions',
}
FIVE = {
    'fn_ca_deleted_wallet_bank_return|row_lock|clubs',
    'fn_ca_deleted_wallet_bank_return|write|clubs',
    'fn_ca_horse_split_return_late_credit|row_lock|clubs',
    'fn_ca_horse_split_return_late_credit|write|clubs',
    'fn_apply_union_ladder|write|unions',
}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/hand-path-cash-lane')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='hand-path-cash-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55843'
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


def node(script):
    return command(['node', '--input-type=module', '-e', script])


def applier_wrapped(name, path):
    """The migration exactly as apply-recorded-migration.mjs splices it (stale pins + hand path)."""
    return node(f"""
      import fs from 'node:fs';
      import {{ stalePinParts }} from {json.dumps(str(ROOT / 'scripts/ci/migration-stale-pins.mjs'))};
      import {{ handPathParts }} from {json.dumps(str(ROOT / 'scripts/ci/hand-path-shared-writes.mjs'))};
      const sql = fs.readFileSync({json.dumps(str(path))}, 'utf8');
      const s = stalePinParts({json.dumps(name)}, sql, sql), h = handPathParts({json.dumps(name)}, sql, sql);
      if (!h.snapshot) throw new Error('hand-path check not spliced');
      const out = sql.replace(/^([\\s\\S]*?(?:^|\\n)[ \\t]*BEGIN[ \\t]*;)([\\s\\S]*)COMMIT\\s*;\\s*$/i,
        (_w, b, m) => b + s.snapshot + h.snapshot + m + s.check + h.check + '\\nCOMMIT;');
      if (out === sql) throw new Error('could not splice');
      process.stdout.write(out);""")


C1 = '00000000-0000-0000-0000-0000000000c1'   # the club whose bank is contended
C9 = '00000000-0000-0000-0000-0000000000c9'   # the horse's assigned club
U1 = '00000000-0000-0000-0000-0000000000a1'
OWNER = '00000000-0000-0000-0000-0000000000f0'
DEL = '00000000-0000-0000-0000-0000000000d1'      # deleted account
DEL2 = '00000000-0000-0000-0000-0000000000d2'     # deleted account (agent wallet)
HORSE = '00000000-0000-0000-0000-0000000000b1'    # split-departed horse record
LIVE = '00000000-0000-0000-0000-0000000000e1'     # an ordinary live player
GONE = '00000000-0000-0000-0000-0000000000e2'     # deleted by status change
SPLIT_OP = '5b11c1b0-2026-1102-0000-000000000001'
T1 = '00000000-0000-0000-0000-0000000000a7'       # the cash table the hands are dealt at

SCHEMA = f"""
CREATE SCHEMA smarter_private;
CREATE TABLE profiles(id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active', total_hands_played int DEFAULT 0);
CREATE TABLE unions(id uuid PRIMARY KEY, member_total int NOT NULL DEFAULT 0, ladder_runs int NOT NULL DEFAULT 0);
CREATE TABLE clubs(id uuid PRIMARY KEY, asset text NOT NULL DEFAULT 'chips', lifecycle_status text NOT NULL DEFAULT 'active',
  retired_at timestamptz, chip_treasury numeric NOT NULL DEFAULT 0, owner_id uuid, member_count int DEFAULT 0,
  admin_count int DEFAULT 0, super_agent_count int DEFAULT 0, agent_count int DEFAULT 0, updated_at timestamptz);
CREATE TABLE union_clubs(union_id uuid, club_id uuid, PRIMARY KEY (union_id, club_id));
CREATE TABLE club_members(club_id uuid REFERENCES clubs(id), user_id uuid, chip_balance numeric NOT NULL DEFAULT 0,
  held_chips numeric DEFAULT 0, locked_chips numeric DEFAULT 0, membership_lifecycle_status text DEFAULT 'active',
  updated_at timestamptz, PRIMARY KEY (club_id, user_id));
CREATE TABLE agents(club_id uuid REFERENCES clubs(id), user_id uuid, agent_wallet_balance numeric NOT NULL DEFAULT 0,
  updated_at timestamptz, PRIMARY KEY (club_id, user_id));
CREATE TABLE chip_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid REFERENCES clubs(id),
  from_user_id uuid, to_user_id uuid, amount numeric, transaction_type text, notes text, metadata jsonb,
  balance_after numeric, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE financial_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text, source text, message text,
  context jsonb, created_at timestamptz DEFAULT clock_timestamp(), resolved boolean DEFAULT false,
  resolved_at timestamptz, resolution text);
CREATE TABLE tables(id uuid PRIMARY KEY, name text, club_id uuid, union_id uuid);
CREATE TABLE hand_history(id uuid PRIMARY KEY, table_id uuid, hand_number bigint, players jsonb DEFAULT '[]',
  tournament_id uuid);
CREATE TABLE hand_projection_outbox(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint,
  committed_at timestamptz DEFAULT now(), post_commit_payload jsonb, post_commit_completed_at timestamptz);
CREATE TABLE hand_bank_obligation_pending(hand_id uuid);
CREATE TABLE cash_rake_pending(hand_id uuid);
CREATE SEQUENCE hand_no;
CREATE TABLE ca_money_rpc_registry(proname text PRIMARY KEY, status text, notes text, added_at timestamptz DEFAULT now());
CREATE TABLE ca_horse_club_split_receipts(operation_id uuid, kind text, horse_id uuid, club_id uuid);
CREATE TABLE ca_horse_club_split_late_returns(id bigserial PRIMARY KEY, club_id uuid NOT NULL, horse_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0), op_id uuid NOT NULL UNIQUE, bank_before numeric NOT NULL,
  bank_after numeric NOT NULL, returned_at timestamptz NOT NULL DEFAULT clock_timestamp());

-- dependencies the production texts call, reduced to what they answer here
CREATE FUNCTION smarter_private.deleted_wallet_published_rakeback_reserve(uuid, uuid) RETURNS numeric
  LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION smarter_private.retired_club_owns_final_round(uuid, timestamptz, int[]) RETURNS boolean
  LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_ca_declare_ledger(text, text, uuid, uuid, text, text[]) RETURNS void
  LANGUAGE plpgsql AS $$ BEGIN
  PERFORM set_config('app.ledger_category', $1, true); PERFORM set_config('app.ledger_counterparty', $2, true);
  PERFORM set_config('app.ledger_counterparty_entity', COALESCE($3::text, ''), true);
  IF $5 IS NOT NULL THEN PERFORM set_config('app.ledger_idempotency_key', $5, true); END IF; END $$;
CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{}}'::jsonb $$;
CREATE FUNCTION public.fn_ca_bank_pending_cash_rake(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{{}}'::jsonb $$;
CREATE FUNCTION smarter_private.f06_wait_table_lane(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION public.fn_project_hand_side_effects_after_post_commit_20260908(p uuid) RETURNS jsonb LANGUAGE sql AS
  $$ DELETE FROM hand_projection_outbox WHERE hand_id = p; SELECT jsonb_build_object('ok', true, 'projection_applied', true) $$;
CREATE FUNCTION public.fn_ca_horse_assigned_club(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT '{C9}'::uuid $$;
CREATE FUNCTION public.fn_apply_union_ladder(p_union uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.unions u SET member_total = (SELECT COALESCE(sum(c.member_count), 0) FROM public.clubs c
           JOIN public.union_clubs uc ON uc.club_id = c.id WHERE uc.union_id = p_union),
         ladder_runs = u.ladder_runs + 1
   WHERE u.id = p_union;
END $$;
CREATE FUNCTION public.recompute_union_levels(p_union_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT id FROM public.unions WHERE p_union_id IS NULL OR id = p_union_id LOOP
    PERFORM public.fn_apply_union_ladder(v_id);
  END LOOP;
END $$;
-- the money-RPC registry guard, as production runs it
CREATE FUNCTION public.fn_ca_money_rpc_balance_columns() RETURNS text[] LANGUAGE sql AS
  $$ SELECT ARRAY['chip_balance','chip_treasury','agent_wallet_balance','held_chips','locked_chips','promo_balance'] $$;
CREATE FUNCTION public.fn_ca_money_rpc_writes_balances(p_src text) RETURNS boolean LANGUAGE sql STABLE AS $f$
  SELECT COALESCE(
    p_src ~* 'UPDATE\\s+(public\\.)?(club_members|club_wallets|union_wallets|unions|table_seats|bbj_pools|clubs|agents|wallets|spin_bonus_pools|tournament_players)\\y'
    OR p_src ~* 'INSERT\\s+INTO\\s+(public\\.)?(club_members|club_wallets|union_wallets|unions|bbj_pools|clubs|agents|wallets|spin_bonus_pools)\\y', false)
  AND COALESCE(p_src ~* ('\\y(' || array_to_string(public.fn_ca_money_rpc_balance_columns(), '|') || ')\\y'), false) $f$;
CREATE FUNCTION public.fn_ca_money_rpc_registry_guard() RETURNS event_trigger LANGUAGE plpgsql AS $g$
DECLARE obj record; v_name text; v_src text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF obj.object_type <> 'function' OR obj.schema_name IS DISTINCT FROM 'public' THEN CONTINUE; END IF;
    SELECT p.proname, p.prosrc INTO v_name, v_src FROM pg_proc p WHERE p.oid = obj.objid AND p.prokind = 'f';
    IF v_name IS NULL OR NOT public.fn_ca_money_rpc_writes_balances(v_src) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.ca_money_rpc_registry g WHERE g.proname = v_name) THEN CONTINUE; END IF;
    RAISE EXCEPTION 'REFUSED: % writes balance columns and is not in ca_money_rpc_registry', v_name USING ERRCODE = '42501';
  END LOOP;
END $g$;
INSERT INTO ca_money_rpc_registry(proname, status) VALUES
 ('fn_ca_deleted_wallet_bank_return', 'system'), ('fn_ca_deleted_wallet_credit', 'system'),
 ('fn_ca_horse_split_return_late_credit', 'approved'), ('fn_apply_union_ladder', 'system'),
 ('fn_ca_settle_hand_stacks_absolute', 'system'), ('fn_ca_commit_hand_settlement', 'system'),
 ('fn_set_member_count', 'system'), ('fn_ca_deleted_account_bank_return', 'system');
"""

HAND = """
-- the hand doors, reduced to the write that matters here: a cash hand's
-- settlement credits a seat that left mid-hand to its member wallet
-- (production: the late-seat leg of fn_ca_settle_hand_stacks_absolute declares
-- 'settlement' / 'table_stack' / the table / 'late_seat_settle:<hand>:<user>')
CREATE FUNCTION public.fn_ca_settle_hand_stacks_absolute(p_table uuid, p_club uuid, p_user uuid, p_delta numeric) RETURNS void
 LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_ca_declare_ledger('settlement', 'table_stack', p_table, NULL,
    'late_seat_settle:' || gen_random_uuid()::text || ':' || p_user::text, NULL);
  UPDATE public.club_members SET chip_balance = chip_balance + p_delta, updated_at = now()
   WHERE club_id = p_club AND user_id = p_user;
  PERFORM set_config('app.ledger_idempotency_key', '', true);
END $$;
-- the settlement door: the stack write, then (as production) the hand's outbox row and receipt
CREATE FUNCTION public.fn_ca_commit_hand_settlement(p_club uuid, p_user uuid, p_delta numeric) RETURNS uuid
 LANGUAGE plpgsql AS $$
DECLARE h uuid := gen_random_uuid(); n bigint := nextval('hand_no');
BEGIN
  PERFORM public.fn_ca_settle_hand_stacks_absolute('00000000-0000-0000-0000-0000000000a7', p_club, p_user, p_delta);
  INSERT INTO public.hand_history(id, table_id, hand_number) VALUES (h, '00000000-0000-0000-0000-0000000000a7', n);
  INSERT INTO public.hand_projection_outbox VALUES (h, '00000000-0000-0000-0000-0000000000a7', n);
  INSERT INTO public.hand_atomic_commits(hand_id, table_id, hand_number, post_commit_payload) VALUES (h, '00000000-0000-0000-0000-0000000000a7', n, '{}');
  RETURN h;
END $$;
CREATE FUNCTION public.fn_ca_commit_hand_submission() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
-- the envelope: its table try-lock, then (when the harness asks) a credit as the promo release makes one
CREATE FUNCTION public.fn_ca_process_hand_post_commit_obligations(p_hand uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.hand_atomic_commits WHERE hand_id = p_hand FOR UPDATE;
  IF c.post_commit_completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('hand-post-commit:' || c.table_id::text, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'table_busy');
  END IF;
  IF nullif(current_setting('test.envelope_credit', true), '') IS NOT NULL THEN
    UPDATE public.club_members SET chip_balance = chip_balance + 7
     WHERE club_id = '00000000-0000-0000-0000-0000000000c1' AND user_id = current_setting('test.envelope_credit')::uuid;
  END IF;
  UPDATE public.hand_atomic_commits SET post_commit_completed_at = now() WHERE hand_id = p_hand;
  RETURN jsonb_build_object('ok', true, 'already_completed', false);
END $$;
-- an agent-wallet credit and a member-count change (off the hand path)
CREATE FUNCTION public.fn_credit_agent(p_club uuid, p_user uuid, p_delta numeric) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.agents SET agent_wallet_balance = agent_wallet_balance + p_delta WHERE club_id = p_club AND user_id = p_user; END $$;
CREATE FUNCTION public.fn_set_member_count(p_club uuid, p_n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE public.clubs SET member_count = p_n WHERE id = p_club; END $$;
CREATE FUNCTION public.fn_ca_deleted_account_bank_return(p_club uuid, p_user uuid) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT public.fn_ca_deleted_wallet_bank_return(p_club,p_user,'wallets') $$;
"""

TRIGGERS = """
CREATE TRIGGER zzzz_deleted_member_credit AFTER UPDATE OF chip_balance, held_chips, locked_chips ON public.club_members FOR EACH ROW WHEN (((new.chip_balance > old.chip_balance) OR (new.held_chips < old.held_chips) OR (new.locked_chips < old.locked_chips))) EXECUTE FUNCTION fn_ca_deleted_wallet_credit();
CREATE TRIGGER zzzz_deleted_agent_credit AFTER UPDATE OF agent_wallet_balance ON public.agents FOR EACH ROW WHEN ((new.agent_wallet_balance > old.agent_wallet_balance)) EXECUTE FUNCTION fn_ca_deleted_wallet_credit();
CREATE TRIGGER zzzz_deleted_profile_bank_return AFTER UPDATE OF status ON public.profiles FOR EACH ROW WHEN (((new.status = 'deleted'::text) AND (old.status IS DISTINCT FROM 'deleted'::text))) EXECUTE FUNCTION fn_ca_deleted_wallet_credit();
CREATE TRIGGER zzzz_horse_split_late_credit_returns_to_bank AFTER UPDATE OF chip_balance ON public.club_members FOR EACH ROW WHEN (((new.membership_lifecycle_status = 'departed'::text) AND (new.chip_balance > old.chip_balance))) EXECUTE FUNCTION fn_ca_horse_split_return_late_credit();
CREATE TRIGGER trg_union_totals_follow_club_counts AFTER UPDATE ON public.clubs REFERENCING OLD TABLE AS oldrows NEW TABLE AS newrows FOR EACH STATEMENT EXECUTE FUNCTION fn_union_totals_follow_club_counts();
"""

SEED = f"""
INSERT INTO unions(id) VALUES ('{U1}');
INSERT INTO tables(id, name, club_id, union_id) VALUES ('{T1}', 'T1', '{C1}', '{U1}');
INSERT INTO clubs(id, owner_id, chip_treasury, member_count) VALUES ('{C1}', '{OWNER}', 1000, 10), ('{C9}', '{OWNER}', 0, 5);
INSERT INTO union_clubs VALUES ('{U1}', '{C1}'), ('{U1}', '{C9}');
INSERT INTO profiles(id, status) VALUES ('{DEL}', 'deleted'), ('{DEL2}', 'deleted'), ('{HORSE}', 'active'),
  ('{LIVE}', 'active'), ('{GONE}', 'active');
INSERT INTO club_members(club_id, user_id, chip_balance, membership_lifecycle_status) VALUES
  ('{C1}', '{DEL}', 0, 'active'), ('{C1}', '{DEL2}', 0, 'active'), ('{C1}', '{HORSE}', 0, 'departed'),
  ('{C1}', '{LIVE}', 50, 'active'), ('{C1}', '{GONE}', 30, 'active');
INSERT INTO agents(club_id, user_id, agent_wallet_balance) VALUES ('{C1}', '{DEL2}', 0), ('{C1}', '{GONE}', 12);
INSERT INTO ca_horse_club_split_receipts VALUES ('{SPLIT_OP}', 'departed', '{HORSE}', '{C1}');
"""


def build(db):
    run('postgres', f'CREATE DATABASE {db}')
    run(db, SCHEMA)
    for name, m5 in PRODUCTION.items():
        run(db, 'SET check_function_bodies = off;\n' + (FX / f'production-{name}.sql').read_text() + ';')
        got = run(db, f"SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.proname = '{name}'")
        check(f'{db}: {name} is the production text', got == m5, got)
    run(db, HAND + TRIGGERS + SEED)
    for f in READER:
        run(db, (MIGRATIONS / f).read_text())
    run(db, 'CREATE EVENT TRIGGER ca_money_rpc_registry_guard ON ddl_command_end '
            "WHEN TAG IN ('CREATE FUNCTION', 'ALTER FUNCTION') EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();")


def keys(db):
    a = json.loads(run(db, 'SELECT public.fn_ca_hand_path_shared_writes()'))
    return {f"{v['function']}|{v['kind']}|{v['target']}": v['path'] for v in a['violations']}


def install(db, part):
    status, _, err = attempt(db, applier_wrapped(part, MIGRATIONS / part))
    check(f'{db}: {part[:14]} installs through the applier checks (stale pins, hand path) with the registry guard armed',
          status == 0, err[-800:])
    proof = next(l for l in (MIGRATIONS / part).read_text().splitlines() if l.startswith('-- @live-proof: '))
    check(f'{db}: the live proof of {part[:14]} holds', run(db, 'SELECT ' + proof[len('-- @live-proof: '):]) == 't')
    if part == PART1:
        install(db, PART1B)


def snapshot(db):
    """Everything a return writes, with its random ids and clocks removed."""
    return json.loads(run(db, """SELECT jsonb_build_object(
      'members', (SELECT jsonb_agg(jsonb_build_array(user_id, chip_balance) ORDER BY user_id) FROM club_members),
      'agents', (SELECT jsonb_agg(jsonb_build_array(user_id, agent_wallet_balance) ORDER BY user_id) FROM agents),
      'banks', (SELECT jsonb_agg(jsonb_build_array(id, chip_treasury) ORDER BY id) FROM clubs),
      'unions', (SELECT jsonb_agg(jsonb_build_array(id, member_total) ORDER BY id) FROM unions),
      'tx', (SELECT COALESCE(jsonb_agg(jsonb_build_array(club_id, from_user_id, to_user_id, amount, transaction_type, notes,
                metadata - 'op_id', balance_after) ORDER BY created_at, amount), '[]') FROM chip_transactions),
      'late', (SELECT COALESCE(jsonb_agg(jsonb_build_array(club_id, horse_id, amount, bank_before, bank_after) ORDER BY id), '[]')
                 FROM ca_horse_club_split_late_returns),
      'alerts', (SELECT COALESCE(jsonb_agg(jsonb_build_array(severity, source) ORDER BY created_at), '[]') FROM financial_alerts))"""))


class Holder:
    """Another session holding the club bank row (or a key share on it) until released."""
    def __init__(self, db, sql):
        self.p = subprocess.Popen(list(map(str, psql(db))), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, env=env)
        self.p.stdin.write("BEGIN;\n" + sql + "\nSELECT pg_backend_pid();\n")
        self.p.stdin.flush()
        self.pid = self.p.stdout.readline().strip()

    def release(self):
        self.p.stdin.write('COMMIT;\n')
        self.p.stdin.close()
        self.p.wait(timeout=60)


def timed(db, sql):
    t = time.monotonic()
    status, outp, err = attempt(db, sql)
    return status, outp, err, time.monotonic() - t


HOLD_BANK = f"SELECT 1 FROM clubs WHERE id = '{C1}' FOR NO KEY UPDATE;"
KEY_SHARE = f"INSERT INTO chip_transactions(club_id, amount, transaction_type) VALUES ('{C1}', 0, 'fk_probe');"


def scenario_uncontended(db):
    """The same operations, in the same order, uncontended."""
    run(db, f"SELECT fn_ca_commit_hand_settlement('{C1}', '{DEL}', 25)")          # deleted account, member wallet
    run(db, f"SELECT fn_credit_agent('{C1}', '{DEL2}', 7)")                         # deleted account, agent wallet
    run(db, f"SELECT fn_ca_commit_hand_settlement('{C1}', '{HORSE}', 40)")        # split-departed horse
    run(db, f"SELECT fn_ca_commit_hand_settlement('{C1}', '{LIVE}', 5)")          # ordinary player: nothing returns
    run(db, f"UPDATE profiles SET status = 'deleted' WHERE id = '{GONE}'")         # account deletion: both wallets
    answers = {
        'explicit': json.loads(run(db, f"SELECT fn_ca_deleted_account_bank_return('{C1}', '{DEL}') - 'bank_after'")),
        'not_deleted': json.loads(run(db, f"SELECT fn_ca_deleted_wallet_bank_return('{C1}', '{LIVE}', 'wallets')")),
    }
    st, _, err = attempt(db, f"SELECT fn_ca_deleted_wallet_bank_return('{C1}', '{DEL}', 'nonsense')")
    answers['unknown_source'] = 'unknown_deleted_wallet_source' in err and st != 0
    run(db, f"SELECT fn_set_member_count('{C1}', 12)")
    run(db, f"UPDATE clubs SET member_count = member_count + 1 WHERE id IN ('{C1}', '{C9}')")
    return snapshot(db), answers


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o', f"-k {sock} -p {PORT} -c listen_addresses=''",
                        '-l', cluster / 'log', '-w', 'start'])
    run('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')

    # ── S: the same outcomes, uncontended ─────────────────────────────────
    check('part 2 passes the window installer\'s static admission; part 1 is not a window file',
          node(f"""import fs from 'node:fs';
            import {{ validateWindowMigration, declaresMaintenanceWindow }} from {json.dumps(str(ROOT / 'scripts/ci/maintenance-window-migrations.mjs'))};
            const a = fs.readFileSync({json.dumps(str(MIGRATIONS / PART1))}, 'utf8'), b = fs.readFileSync({json.dumps(str(MIGRATIONS / PART2))}, 'utf8');
            process.stdout.write(String(validateWindowMigration({json.dumps(PART2)}, b) && !declaresMaintenanceWindow(a)));""") == 'true')
    build('s_before')
    build('s_part1')
    build('s_after')
    install('s_part1', PART1)
    install('s_after', PART1)
    install('s_after', PART2)
    before_snap, before_ans = scenario_uncontended('s_before')
    part1_snap, part1_ans = scenario_uncontended('s_part1')
    after_snap, after_ans = scenario_uncontended('s_after')
    results['same'] = {'before': before_snap, 'part1': part1_snap, 'after': after_snap,
                       'answers': [before_ans, part1_ans, after_ans]}
    check('S: balances, banks, receipts, late returns and alerts are identical before, after part 1 and after both',
          before_snap == part1_snap == after_snap, {'before': before_snap, 'part1': part1_snap, 'after': after_snap})
    check('S: the explicit return, the not-deleted and the unknown-source answers are identical',
          before_ans == part1_ans == after_ans, [before_ans, part1_ans, after_ans])
    check('S: every deleted or split-departed credit went to the bank (sanity of the scenario)',
          dict((u, b) for u, b in after_snap['members']) == {DEL: 0, DEL2: 0, HORSE: 0, LIVE: 55, GONE: 0}
          and dict((u, b) for u, b in after_snap['agents']) == {DEL2: 0, GONE: 0}
          and dict(after_snap['banks'])[C1] == 1000 + 25 + 7 + 40 + 30 + 12, after_snap)
    check('U: the union total follows member counts exactly as before (single and multi-row statements)',
          dict(after_snap['unions'])[U1] == 12 + 1 + 5 + 1, after_snap['unions'])

    # ── R: the reader, before and after ──────────────────────────────────
    build('hp')
    before = keys('hp')
    results['reader_before'] = before
    check('R BEFORE: the five shared-row writes are on the cash hand path', FIVE <= set(before), sorted(before))
    check('R BEFORE: reached from a hand door through the wallet-credit trigger',
          before['fn_ca_deleted_wallet_bank_return|row_lock|clubs'].startswith(('fn_ca_commit_hand_settlement', 'fn_ca_process_hand_post_commit_obligations'))
          and '=T=> fn_ca_deleted_wallet_credit' in before['fn_ca_deleted_wallet_bank_return|row_lock|clubs'],
          before)

    # ── W BEFORE: the hand waits ──────────────────────────────────────────
    h = Holder('hp', HOLD_BANK)
    st, _, err, took = timed('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{DEL}', 25)")
    h.release()
    results['wait_before_deleted'] = {'status': st, 'seconds': took, 'error': err[-200:]}
    check('W BEFORE: a hand crediting a deleted account waits on the busy bank (its 4 s lock_timeout, then fails)',
          took >= 3.5 and st != 0 and 'lock timeout' in err, results['wait_before_deleted'])
    h = Holder('hp', KEY_SHARE)
    st, _, err, took = timed('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{HORSE}', 40)")
    h.release()
    results['wait_before_horse_key_share'] = {'status': st, 'seconds': took}
    check('W BEFORE: a split-departed horse credit waits 200 ms behind a mere FOR KEY SHARE, then defers',
          st == 0 and took >= 0.2 and run('hp', "SELECT count(*) FROM financial_alerts WHERE source = 'horse_split.late_return_deferred'") == '1',
          results['wait_before_horse_key_share'])

    # ── install, R AFTER ─────────────────────────────────────────────────
    run('hp', "DELETE FROM financial_alerts; UPDATE club_members SET chip_balance = 0 WHERE user_id IN "
              f"('{DEL}', '{HORSE}'); UPDATE clubs SET chip_treasury = 1000 WHERE id = '{C1}'; DELETE FROM chip_transactions;")
    install('hp', PART1)
    mid_keys = keys('hp')
    results['reader_part1'] = mid_keys
    check('R PART 1: the bank write and the horse return are gone; only the two edges part 2 removes remain',
          FIVE & set(mid_keys) == AFTER_PART1, sorted(FIVE & set(mid_keys)))
    check('R PART 1: nothing new appeared', set(mid_keys) <= set(before), sorted(set(mid_keys) - set(before)))

    # ── W AFTER: the hand does not wait, and the return never strands ─────
    def pending():
        return run('hp', "SELECT COALESCE(string_agg(kind || ':' || user_id, ',' ORDER BY kind), '') FROM hand_wallet_return_pending")

    def project(hand):
        return json.loads(run('hp', f"SELECT fn_project_hand_side_effects('{hand}')"))

    def outbox(hand):
        return run('hp', f"SELECT count(*) FROM hand_projection_outbox WHERE hand_id = '{hand}'") == '1'

    for who, kind, amount in ((DEL, 'deleted_player_wallet', 25), (HORSE, 'horse_split_late_credit', 40)):
        bank0 = dict(snapshot('hp')['banks'])[C1]
        h = Holder('hp', HOLD_BANK)
        st, outp, err, took = timed('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{who}', {amount})")
        hand = outp.strip()
        mid = snapshot('hp')
        check(f'W AFTER {kind}: a hand crediting it while another session holds the bank completes at once',
              st == 0 and took < 1.0, {'took': took, 'err': err[-300:]})
        check(f'W AFTER {kind}: the credit is on the record, nothing moved, the return is stored for the table',
              dict(mid['members'])[who] == amount and dict(mid['banks'])[C1] == bank0
              and pending() == f'{kind}:{who}', {'pending': pending(), 'mid': mid})
        # the lag watch (cron 569) sees a stored return older than 15 s as critical for its table
        run('hp', "UPDATE hand_wallet_return_pending SET created_at = clock_timestamp() - interval '20 seconds'")
        run('hp', 'SELECT fn_ca_post_commit_lag_watch()')
        crit = run('hp', f"SELECT count(*) FROM financial_alerts WHERE source = 'fn_ca_post_commit_lag_watch' "
                         f"AND severity = 'critical' AND NOT resolved AND context->>'table_id' = '{T1}'")
        check(f'W AFTER {kind}: the lag watch pages a stored return older than 15 s on its table', crit == '1', crit)
        passes = [project(hand) for _ in range(3)]
        check(f'W AFTER {kind}: while the bank stays busy every pass ends without banking and the outbox row stays',
              all(p.get('reason') == 'predecessor_pending' and p.get('detail') == 'wallet_returns'
                  and p['wallet_returns']['status'] == 'pending' for p in passes)
              and outbox(hand) and pending() == f'{kind}:{who}', passes)
        h.release()
        first = project(hand)
        s = snapshot('hp')
        check(f'W AFTER {kind}: the first pass after the bank frees banks the whole balance through the same claim',
              first['wallet_returns']['status'] == 'banked' and pending() == ''
              and dict(s['members'])[who] == 0 and dict(s['banks'])[C1] == bank0 + amount, {'first': first, 's': s})
        for _ in range(3):
            last = project(hand)
        check(f'W AFTER {kind}: then the hand finishes its continuation and the outbox row leaves',
              not outbox(hand), last)
        run('hp', "UPDATE financial_alerts SET resolved = true")

    # inside the post-commit envelope (the engine's direct call): the same deferral, found by the table's lock
    hand = run('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{LIVE}', 1)")
    h = Holder('hp', HOLD_BANK)
    st, _, err, took = timed('hp', f"SET test.envelope_credit = '{DEL}'; "
                                   f"SELECT fn_ca_process_hand_post_commit_obligations('{hand}')")
    check('W AFTER envelope: a credit inside the envelope under a held bank completes at once and is stored for the table',
          st == 0 and took < 1.0 and pending() == f'deleted_player_wallet:{DEL}', {'took': took, 'err': err[-300:], 'p': pending()})
    h.release()
    project(hand)
    check('W AFTER envelope: the next pass banks it', pending() == '' and dict(snapshot('hp')['members'])[DEL] == 0)

    # outside a hand nothing is stored: the caller waits as before (here 1 s), then the return is made
    h = Holder('hp', HOLD_BANK)
    threading.Timer(1.0, h.release).start()
    st, _, err, took = timed('hp', f"SELECT fn_credit_agent('{C1}', '{DEL2}', 4)")
    check('W AFTER outside a hand: the caller waits for the bank as it always did, then returns, storing nothing',
          st == 0 and 0.9 <= took < 3.5 and pending() == '' and dict(snapshot('hp')['agents'])[DEL2] == 0,
          {'took': took, 'err': err[-300:]})

    h = Holder('hp', KEY_SHARE)
    st, _, err, took = timed('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{HORSE}', 2)")
    h.release()
    s = snapshot('hp')
    check('W AFTER: a FOR KEY SHARE on the club (an insert referencing it) never delays the horse return',
          st == 0 and took < 1.0 and dict(s['members'])[HORSE] == 0 and pending() == '', {'took': took, 's': s})

    install('hp', PART2)
    after = keys('hp')
    results['reader_after'] = after
    check('R AFTER BOTH: none of the five remains on the hand path', not (FIVE & set(after)), sorted(FIVE & set(after)))
    check('R AFTER BOTH: nothing new appeared', set(after) <= set(before), sorted(set(after) - set(before)))
    h = Holder('hp', HOLD_BANK)
    st, outp, err, took = timed('hp', f"SELECT fn_ca_commit_hand_settlement('{C1}', '{DEL}', 3)")
    h.release()
    project(outp.strip())
    check('W AFTER BOTH: a deleted-account credit under a held bank completes at once and the next pass banks it',
          st == 0 and took < 1.0 and pending() == '' and dict(snapshot('hp')['members'])[DEL] == 0,
          {'took': took, 'err': err[-200:]})
    st, _, err = attempt('hp', f"UPDATE profiles SET status = 'deleted' WHERE id = '{LIVE}'")
    s = snapshot('hp')
    check('W AFTER BOTH: account deletion still returns the wallet through its own trigger',
          st == 0 and dict(s['members'])[LIVE] == 0, {'err': err[-200:], 's': s['members']})

    # ── C: the callers keep their wait ───────────────────────────────────
    # a balance already on a deleted record (as a deferred return leaves it), written without its triggers
    run('hp', f"SET session_replication_role = replica; UPDATE club_members SET chip_balance = 9 WHERE club_id = '{C1}' AND user_id = '{DEL2}'")
    h = Holder('hp', HOLD_BANK)
    p = subprocess.Popen(list(map(str, psql('hp'))), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         text=True, env=env)
    t0 = time.monotonic()
    p.stdin.write(f"SELECT (fn_ca_deleted_account_bank_return('{C1}', '{DEL2}'))->>'amount';\n")
    p.stdin.close()
    time.sleep(1.0)
    waiting = run('hp', "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%fn_ca_deleted_account_bank_return%'")
    h.release()
    o, e = p.communicate(timeout=30)
    took = time.monotonic() - t0
    check('C: the explicit return still waits for a busy bank, then returns once it frees',
          waiting == '1' and p.returncode == 0 and o.strip() == '9' and took >= 1.0, {'waiting': waiting, 'out': o, 'err': e, 'took': took})

    # ── U: a bank write no longer runs the union ladder ──────────────────
    runs = run('hp', f"SELECT ladder_runs FROM unions WHERE id = '{U1}'")
    run('hp', f"UPDATE clubs SET chip_treasury = chip_treasury + 1 WHERE id = '{C1}'")
    check('U AFTER: a bank write does not run the union ladder',
          run('hp', f"SELECT ladder_runs FROM unions WHERE id = '{U1}'") == runs)
    run('hp', f"SELECT fn_set_member_count('{C1}', 99)")
    check('U AFTER: a member-count change still does',
          run('hp', f"SELECT ladder_runs::int - {runs}::int || ':' || member_total FROM unions WHERE id = '{U1}'") == '1:104')
    check('U AFTER: the old statement function is gone and the trigger is a column-scoped row trigger',
          run('hp', "SELECT to_regprocedure('public.fn_union_totals_follow_club_counts()') IS NULL "
                    "AND (SELECT tgtype & 1 = 1 AND cardinality(tgattr::int2[]) = 4 FROM pg_trigger "
                    "WHERE tgname = 'trg_union_totals_follow_club_counts')") == 't')
    status, _, err = attempt('s_before', applier_wrapped(PART1, MIGRATIONS / PART1).replace(
        "'b4d29a312a1d98b8a1b9c9ef7d0bb19b'", "'00000000000000000000000000000000'"))
    check('install: part 1 refuses a database whose texts moved', status != 0 and 'h1_source_moved' in err, err[-300:])
    status, _, err = attempt('s_before', applier_wrapped(PART2, MIGRATIONS / PART2))
    check('install: part 2 refuses a database without part 1', status != 0 and 'h1_source_moved' in err, err[-300:])
    results['passed'] = True
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2, default=str) + '\n')

print(json.dumps({'passed': results.get('passed', False), 'checks': len(results['checks']),
                  'failed': [c for c in results['checks'] if not c['passed']]}, indent=2))
