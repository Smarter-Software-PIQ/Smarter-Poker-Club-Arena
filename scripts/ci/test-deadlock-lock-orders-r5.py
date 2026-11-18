"""Isolated two-session PostgreSQL regression for three production deadlocks.

Each case rebuilds the exact production definition from the migrations that
wrote it (pg_get_functiondef md5 equal to production on 2026-10-15), drives
the two transactions that deadlocked on production in the order the
postgres_logs show, proves the live text deadlocks (40P01 in the server log),
applies the candidate migration, proves the same interleaving completes with
no deadlock, and proves nothing credited changes.

  bbj   fn_sweep_bbj_promo_all vs the hand post-commit path
        (rake writes union_wallets, then the BBJ leg locks the pool).
        Migration 20261015094402: the sweep never waits while holding a pool.
  proj  fn_project_hand_side_effects vs itself, two hands sharing players
        (promo pass and projection pass touch player_stats in two orders).
        Migration 20261015094418: one player order for the whole transaction.
  sat   fn_ensure_scheduled_mtt_satellite vs a feeder registration
        (the registration's satellite_target_id foreign-key check needs
        FOR KEY SHARE on the target the board held FOR UPDATE).
        Migration 20261015094435: the board locks the target FOR NO KEY UPDATE.

An empty throwaway cluster on a Unix socket; no network, no production
connection.
"""
import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'artifacts/deadlock-lock-orders-r5')
out = parser.parse_args().output.resolve()
out.mkdir(parents=True, exist_ok=True)
pg = pathlib.Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/17/bin'))
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
as_owner = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
cluster = pathlib.Path(tempfile.mkdtemp(prefix='deadlock-r5-'))
sock = cluster / 'socket'
sock.mkdir(mode=0o700)
if as_owner:
    shutil.chown(cluster, 'postgres')
    shutil.chown(sock, 'postgres')
PORT = '55829'
LOG = cluster / 'log'
results = {'checks': [], 'production_mutations': False}

LIVE = {
    'bbj': ('20260902220500_the_undeclared_legs_name_their_counterparty.sql', 'fn_sweep_bbj_promo_all',
            'public.fn_sweep_bbj_promo_all()', '11c5feb40c252909a4281e8faf31c9ac',
            '20261015094402_bbj_promo_sweep_never_waits_while_holding_a_pool.sql',
            'ff0157072680c056f3beddec28db5bb7'),
    'proj': ('20260908155252_hand_projection_takes_post_commit_lock_first.sql', 'fn_project_hand_side_effects',
             'public.fn_project_hand_side_effects(uuid)', 'fefbd3c58b8de6ba3c21c8acea1de884',
             '20261015094418_every_hand_projection_takes_its_players_in_one_order.sql',
             '5dbf4d0b1717a7ad0497f26c99ab2767'),
    'sat': ('20261002082303_satellite_board_stands_down_for_a_scheduled_series_and_orpha.sql',
            'fn_ensure_scheduled_mtt_satellite', 'public.fn_ensure_scheduled_mtt_satellite(jsonb)',
            '1760f4d9077253a29ed4243f0d16717b',
            '20261015094435_the_satellite_board_never_blocks_a_feeder_s_foreign_key_chec.sql',
            '7d2692a9dd3ba29538636bb35029ace0'),
}

U = 'fade0000-0000-0000-0000-000000000001'
C = 'a0000000-0000-0000-0000-000000000001'
POOL = 'b0000000-0000-0000-0000-000000000001'
A = '10000000-0000-0000-0000-00000000000a'
B = '20000000-0000-0000-0000-00000000000b'
T = 'c0000000-0000-0000-0000-0000000000a1'
F = 'c0000000-0000-0000-0000-0000000000f1'


def psql(db):
    return [pg / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', PORT, '-U', 'postgres', '-d', db]


def command(args, sql=None):
    r = subprocess.run(list(map(str, args)), input=sql, text=True, capture_output=True, env=env, timeout=120)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout.strip()


def run(db, sql):
    return command(psql(db), sql)


def spawn(db, sql=None):
    p = subprocess.Popen(list(map(str, psql(db))), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, env=env)
    if sql is not None:
        p.stdin.write(sql)
        p.stdin.flush()
    return p


def send(p, sql):
    p.stdin.write(sql)
    p.stdin.flush()


def finish(p):
    if not p.stdin.closed:
        p.stdin.close()
    p.wait(timeout=120)
    return p.returncode, p.stdout.read().strip(), p.stderr.read().strip()


def check(name, passed, detail=None):
    results['checks'].append({'name': name, 'passed': bool(passed), 'detail': detail})
    if not passed:
        raise AssertionError(f'{name}: {detail}')


def deadlocks():
    return LOG.read_text(errors='replace').count('deadlock detected')


def definition(file, name):
    source = (MIGRATIONS / file).read_text()
    found = list(re.finditer(r'CREATE OR REPLACE FUNCTION public\.' + re.escape(name)
                             + r'\(.*?AS (\$[A-Za-z_0-9]*\$).*?\1\s*;', source, re.S))
    if not found:
        raise ValueError('missing definition: ' + name + ' in ' + file)
    return found[-1].group(0)


def md5(db, sig):
    return run(db, f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))")


def load_live(db, key):
    file, name, sig, live_md5, _, _ = LIVE[key]
    run(db, definition(file, name))
    run(db, f'REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated; '
            f'GRANT EXECUTE ON FUNCTION {sig} TO service_role;')
    check(f'{key}: the rebuilt definition is the production text', md5(db, sig) == live_md5)


def apply_candidate(db, key):
    _, _, sig, _, migration, post_md5 = LIVE[key]
    run(db, (MIGRATIONS / migration).read_text())
    check(f'{key}: the migration reproduces the postimage derived on production', md5(db, sig) == post_md5)


ROLES = 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;'
COMMON = """
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
"""

BBJ_SCHEMA = f"""
CREATE TABLE unions(id uuid PRIMARY KEY, promo_funded_from_bbj numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE clubs(id uuid PRIMARY KEY, union_id uuid REFERENCES unions(id), promo_balance numeric DEFAULT 0,
  chip_treasury numeric DEFAULT 0, updated_at timestamptz);
CREATE TABLE union_wallets(union_id uuid PRIMARY KEY REFERENCES unions(id), promo_wallet numeric DEFAULT 0,
  rake_wallet numeric DEFAULT 0);
CREATE TABLE bbj_pools(id uuid PRIMARY KEY, club_id uuid REFERENCES clubs(id), union_id uuid REFERENCES unions(id),
  main_balance numeric DEFAULT 0, promo_balance numeric DEFAULT 0, status text, created_at timestamptz DEFAULT now(),
  updated_at timestamptz);
CREATE TABLE union_wallet_transactions(id uuid PRIMARY KEY, union_id uuid REFERENCES unions(id), wallet text,
  direction text, amount numeric, balance_after numeric, tx_type text, club_id uuid REFERENCES clubs(id),
  notes text, created_at timestamptz);
CREATE TABLE chip_transactions(id uuid PRIMARY KEY, club_id uuid, from_user_id uuid, to_user_id uuid,
  amount numeric, transaction_type text, notes text, balance_after numeric, created_at timestamptz);
CREATE FUNCTION fn_ca_declare_ledger(text, text, uuid, uuid, text, text[]) RETURNS void LANGUAGE sql AS '';
INSERT INTO unions(id) VALUES ('{U}');
INSERT INTO clubs(id, union_id) VALUES ('{C}', '{U}');
INSERT INTO union_wallets(union_id) VALUES ('{U}');
INSERT INTO bbj_pools(id, union_id, promo_balance, status) VALUES ('{POOL}', '{U}', 37.25, 'active');
"""

# The hand post-commit path's lock order, statement for statement:
# atomic_distribute_rake's union wallet leg, then the BBJ leg's pool lock
# (fn_ca_process_hand_post_commit_obligations line 169 on production).
HAND_RAKE = f"BEGIN;\nUPDATE union_wallets SET rake_wallet = rake_wallet + 1 WHERE union_id = '{U}';\n"
HAND_BBJ = (f"SELECT p.id FROM public.bbj_pools p WHERE p.union_id = '{U}' AND p.status = 'active' "
            "ORDER BY p.created_at, p.id LIMIT 1 FOR UPDATE;\n"
            f"UPDATE bbj_pools SET main_balance = main_balance + 1 WHERE id = '{POOL}';\nSELECT 'hand-done';\nCOMMIT;\n")


def bbj_round(db):
    """The hand holds the wallet; the sweep starts; the hand asks for the pool."""
    before = deadlocks()
    hand = spawn(db, HAND_RAKE)
    time.sleep(0.4)
    sweep = spawn(db, 'SELECT public.fn_sweep_bbj_promo_all();\n')
    sweep.stdin.close()
    time.sleep(0.6)
    send(hand, HAND_BBJ)
    hand.stdin.close()
    h = finish(hand)
    s = finish(sweep)
    return deadlocks() - before, h, s


PROJ_SCHEMA = f"""
CREATE TABLE hand_projection_outbox(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint);
CREATE TABLE hand_history(id uuid PRIMARY KEY, table_id uuid, hand_number bigint, players jsonb);
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint);
CREATE TABLE hand_promo(hand_id uuid, user_id uuid);
CREATE TABLE player_stats(user_id uuid, club_id uuid, hands_dealt integer DEFAULT 0,
  total_losses numeric DEFAULT 0, updated_at timestamptz DEFAULT now(), UNIQUE (user_id, club_id));
CREATE INDEX ON player_stats(updated_at);
INSERT INTO player_stats(user_id, club_id) VALUES ('{A}', '{C}'), ('{B}', '{C}');
-- The promo pass (promo_apply_playthrough, per promo player in user order).
CREATE FUNCTION public.fn_ca_process_hand_post_commit_obligations(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id FROM hand_promo WHERE hand_id = p_hand_id ORDER BY user_id LOOP
    INSERT INTO player_stats AS ps(user_id, club_id, total_losses) VALUES (r.user_id, '{C}', 1)
    ON CONFLICT (user_id, club_id) DO UPDATE SET total_losses = ps.total_losses + 1, updated_at = now();
  END LOOP;
  RETURN jsonb_build_object('ok', true);
END $$;
-- The projection pass (Projection 2, every seated player in uuid order). The
-- shared advisory gate lets the test hold both hands between the passes.
CREATE FUNCTION public.fn_project_hand_side_effects_after_post_commit_20260908(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_lock_shared(4242);
  PERFORM pg_advisory_unlock_shared(4242);
  INSERT INTO player_stats AS ps(user_id, club_id, hands_dealt)
  SELECT DISTINCT (pl->>'userId')::uuid, '{C}'::uuid, 1
    FROM hand_history h, jsonb_array_elements(h.players) pl WHERE h.id = p_hand_id
   ORDER BY 1
  ON CONFLICT (user_id, club_id) DO UPDATE SET hands_dealt = ps.hands_dealt + 1, updated_at = now();
  DELETE FROM hand_projection_outbox WHERE hand_id = p_hand_id;
  RETURN jsonb_build_object('ok', true, 'hand_id', p_hand_id);
END $$;
"""


def proj_hands(db, n):
    """Two hands at two tables with the same two players; each promo pass touches the other's second player."""
    h1, h2 = f'd{n}000000-0000-0000-0000-000000000001', f'd{n}000000-0000-0000-0000-000000000002'
    t1, t2 = 'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000002'
    players = json.dumps([{'userId': A}, {'userId': B}])
    run(db, f"""
INSERT INTO hand_projection_outbox VALUES ('{h1}', '{t1}', {n}), ('{h2}', '{t2}', {n});
INSERT INTO hand_history VALUES ('{h1}', '{t1}', {n}, '{players}'), ('{h2}', '{t2}', {n}, '{players}');
INSERT INTO hand_atomic_commits VALUES ('{h1}', '{t1}', {n}), ('{h2}', '{t2}', {n});
INSERT INTO hand_promo VALUES ('{h1}', '{B}'), ('{h2}', '{A}');
""")
    return h1, h2


def proj_round(db, n):
    h1, h2 = proj_hands(db, n)
    before = deadlocks()
    gate = spawn(db, 'SELECT pg_advisory_lock(4242);\n')
    time.sleep(0.3)
    s1 = spawn(db, f"SELECT public.fn_project_hand_side_effects('{h1}');\n")
    s1.stdin.close()
    time.sleep(0.5)
    s2 = spawn(db, f"SELECT public.fn_project_hand_side_effects('{h2}');\n")
    s2.stdin.close()
    time.sleep(0.5)
    send(gate, 'SELECT pg_advisory_unlock(4242);\n')
    gate.stdin.close()
    finish(gate)
    r1, r2 = finish(s1), finish(s2)
    return deadlocks() - before, r1, r2



def prove_projection_transaction_boundary(db):
    """A blocked statistics writer must not roll back or hold a rake credit."""
    sig = LIVE['proj'][2]
    lane_migration = next(MIGRATIONS.glob('20261019151125_*.sql')).read_text()
    patch = lane_migration.split("('public.fn_project_hand_side_effects(uuid)',", 1)[1]
    old = patch.split('$old$')[1]
    new = patch.split('$new$')[1]
    original = run(db, f"SELECT pg_get_functiondef('{sig}'::regprocedure)") + '\n'
    run(db, """
CREATE SCHEMA smarter_private;
CREATE FUNCTION smarter_private.f06_wait_table_lane(uuid) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE TABLE union_wallets (rake integer);
INSERT INTO union_wallets VALUES (0);
CREATE TABLE post_commit_receipts (hand_id uuid PRIMARY KEY);
CREATE TABLE projection_gate (id integer PRIMARY KEY);
INSERT INTO projection_gate VALUES (1);

CREATE OR REPLACE FUNCTION public.fn_ca_process_hand_post_commit_obligations(p_hand_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO post_commit_receipts VALUES (p_hand_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;
  UPDATE union_wallets SET rake = rake + 1;
  RETURN jsonb_build_object('ok', true, 'already_completed', false);
END $$;

CREATE OR REPLACE FUNCTION public.fn_project_hand_side_effects_after_post_commit_20260908(p_hand_id uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM projection_gate WHERE id = 1 FOR UPDATE NOWAIT;
  DELETE FROM hand_projection_outbox WHERE hand_id = p_hand_id;
  RETURN jsonb_build_object('ok', true);
END $$;
""")
    run(db, original.replace(old, new))
    check('cash boundary: exact installed projection preimage',
          md5(db, sig) == 'e1402cc728a46730f2c478ef2e397317')
    hand, _ = proj_hands(db, 3)
    call = f"SELECT public.fn_project_hand_side_effects('{hand}')"
    state = ("SELECT rake, (SELECT count(*) FROM post_commit_receipts), "
             f"(SELECT count(*) FROM hand_projection_outbox WHERE hand_id = '{hand}') FROM union_wallets")
    gate = spawn(db, "BEGIN; SELECT id FROM projection_gate FOR UPDATE;\n")
    try:
        check('cash boundary: statistics row is held', gate.stdout.readline().strip() == '1')
        before = spawn(db, call + ';\n')
        status, _, error = finish(before)
        check('cash boundary: old projection failure rolls back the rake credit',
              status != 0 and 'could not obtain lock' in error and run(db, state) == '0|0|1')
        run(db, (MIGRATIONS / '20261117225600_commit_hand_obligations_before_stats_projection.sql').read_text())
        result = json.loads(run(db, call))
        check('cash boundary: financial receipt commits with statistics still blocked',
              result.get('ok') is False and result.get('reason') == 'predecessor_pending'
              and result.get('hand_id') == hand and run(db, state) == '1|1|1', result)
        check('cash boundary: another table can take the wallet before statistics finish',
              run(db, 'SELECT rake FROM union_wallets FOR UPDATE NOWAIT') == '1')
        blocked = spawn(db, call + ';\n')
        status, _, error = finish(blocked)
        check('cash boundary: a separate statistics rollback leaves the credit intact',
              status != 0 and 'could not obtain lock' in error and run(db, state) == '1|1|1')
    finally:
        send(gate, 'ROLLBACK;\n')
        finish(gate)
    check('cash boundary: continuation projects once and never recredits',
          json.loads(run(db, call)).get('ok') is True and run(db, state) == '1|1|0'
          and json.loads(run(db, call)).get('reason') == 'not_pending')


SAT_SCHEMA = f"""
CREATE TABLE public.tournaments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, game_type text,
  variant text, buy_in_amount numeric(15,2), buy_in_fee numeric(15,2), guaranteed_prize numeric(15,2),
  start_time timestamptz, status text, current_players integer, max_players integer, late_reg_mins integer,
  starting_chips integer, blind_structure text, payout_structure text, club_id uuid, prize_pool numeric(18,2),
  min_players integer, tournament_type text, union_id uuid, prize_pool_finalized boolean, is_turbo boolean,
  blind_speed text, total_rake numeric(18,2), late_reg_levels integer, satellite_target uuid,
  satellite_target_id uuid REFERENCES public.tournaments(id), bounty_pool numeric(18,2), short_description text,
  table_size integer, synchronized_breaks boolean, satellite_seats integer, schedule_id uuid,
  format_contract text, restart_source_id uuid REFERENCES public.tournaments(id));
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, is_deleted boolean, status text,
  club_id uuid, max_players integer);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid REFERENCES public.tournaments(id), user_id uuid, status text DEFAULT 'registered');
-- trg_sync_tournament_current_players: the roster insert refreshes the cache.
CREATE FUNCTION fn_sync_tournament_current_players() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.tournaments SET current_players = (SELECT count(*) FROM public.tournament_players
                                                     WHERE tournament_id = NEW.tournament_id)
   WHERE id = NEW.tournament_id;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sync_tournament_current_players AFTER INSERT ON public.tournament_players
  FOR EACH ROW EXECUTE FUNCTION fn_sync_tournament_current_players();
CREATE FUNCTION public.fn_ca_mtt_blind_contract(text, integer) RETURNS jsonb LANGUAGE sql AS $$SELECT '{{}}'::jsonb$$;
CREATE FUNCTION public.fn_ca_lock_mtt_admission_contract() RETURNS text LANGUAGE sql AS $$SELECT 'unlimited-mtt-v2'::text$$;
CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
CREATE FUNCTION public.fn_ca_satellite_target_accepts_new_feeder(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
INSERT INTO public.tournaments(id, name, club_id, status, current_players, buy_in_amount, buy_in_fee, start_time)
VALUES ('{T}', 'Target', '{C}', 'REGISTERING', 0, 180, 20, now() + interval '1 day');
INSERT INTO public.tournaments(id, name, club_id, status, current_players, satellite_target_id, format_contract,
  game_type, tournament_type, start_time)
VALUES ('{F}', 'Feeder', '{C}', 'REGISTERING', 0, '{T}', 'mtt-v2', 'NLH', 'SATELLITE', now() + interval '2 hours');
"""

SAT_COMMON = {'club_id': C, 'satellite_target_id': T, 'name': 'Feeder', 'game_type': 'NLH',
              'tournament_type': 'SATELLITE', 'status': 'REGISTERING', 'current_players': 0,
              'starting_chips': 1000, 'blind_structure': '[{"level":1}]',
              'payout_structure': '[{"place":1,"percentage":100}]', 'satellite_seats': 1,
              'guaranteed_prize': 0, 'late_reg_levels': 0, 'late_reg_mins': 0,
              'start_time': '2099-01-01T00:00:00Z'}
SAT_CONFIG = json.dumps({
    'legacy_config': dict(SAT_COMMON, variant='sng', max_players=2, min_players=2, table_size=2,
                          buy_in_amount=19, buy_in_fee=1),
    'scheduled_config': dict(SAT_COMMON, variant='satellite', min_players=3, table_size=6,
                             synchronized_breaks=True, buy_in_amount=18, buy_in_fee=2),
})


def sat_round(db, n):
    """The registration holds the feeder; the board locks the target; the registration's UPDATE re-checks the FK."""
    before = deadlocks()
    reg = spawn(db, f"""BEGIN;
SELECT id FROM public.tournaments WHERE id = '{F}' FOR UPDATE;
INSERT INTO public.tournament_players(tournament_id, user_id) VALUES ('{F}', gen_random_uuid());
""")
    time.sleep(0.4)
    board = spawn(db, f"SELECT public.fn_ensure_scheduled_mtt_satellite('{SAT_CONFIG}'::jsonb)->>'outcome';\n")
    board.stdin.close()
    time.sleep(0.6)
    send(reg, f"""UPDATE public.tournaments
   SET current_players = {n}, prize_pool = COALESCE(prize_pool, 0) + 18, total_rake = COALESCE(total_rake, 0) + 2
 WHERE id = '{F}';
SELECT 'registration-done';
COMMIT;
""")
    reg.stdin.close()
    r = finish(reg)
    b = finish(board)
    return deadlocks() - before, r, b



# ---- cash rake pending (20261118034950 + 20261118035606) --------------------
RAKE_FIXTURE = ROOT / 'scripts/ci/fixtures/cash-rake-pending/live-definitions.json'
RAKE_PART1 = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql'
RAKE_SWITCH = '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql'
RAKE_POST = {
    'fn_ca_tally_balance_move': 'c8c24d5a2c098d3189127e9e870601a3',
    'fn_ca_supply_snapshot': '549b78dd66f1596b0942db37cef95298',
    'fn_ca_account_balance': 'f100348cb3e5e641017819066fa18d40',
    'fn_rake_bbj_invariants': 'd23a4053d2578ce628381f87e9c20652',
    'fn_project_hand_side_effects': '16dea593b5f2c2b22052c8752d9aba7c',
    'trg_finish_hand_post_commit_obligations': 'bcd517670b65faed6e30ac80bef50e98',
    'fn_ca_process_hand_post_commit_obligations': 'da123635a0f1cdb035bd9b518ebf07f0',
}
RU = 'fade0000-0000-0000-0000-000000000001'
RC = 'a0000000-0000-0000-0000-0000000000c1'
RT1 = 'c0000000-0000-0000-0000-0000000000a1'
RT2 = 'c0000000-0000-0000-0000-0000000000a2'
RP1 = '10000000-0000-0000-0000-00000000000a'
RP2 = '20000000-0000-0000-0000-00000000000b'
# hand id, table, hand number, rake, pot, contributions
RAKE_HANDS = [
    ('d0000000-0000-0000-0000-000000000001', RT1, 101, '1.25', '25.00', {RP1: 12.5, RP2: 12.5}),
    ('d0000000-0000-0000-0000-000000000002', RT2, 201, '0.37', '7.40', {RP1: 2.4, RP2: 5.0}),
    ('d0000000-0000-0000-0000-000000000003', RT1, 102, '3.00', '90.00', {RP1: 60.0, RP2: 30.0}),
]

# The tables and helpers the real functions touch, with production's column
# names. Money triggers are the real ones: the autoledger, both tally triggers
# and the deferred ledger invariant, in refuse mode as on production.
RAKE_SCHEMA = f"""
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
CREATE FUNCTION smarter_private.f06_wait_table_lane(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
CREATE TABLE unions(id uuid PRIMARY KEY);
CREATE TABLE clubs(id uuid PRIMARY KEY, name text, union_id uuid, asset text NOT NULL DEFAULT 'chips');
CREATE TABLE tournaments(id uuid PRIMARY KEY, is_private boolean, union_id uuid);
CREATE TABLE tables(id uuid PRIMARY KEY, club_id uuid, union_id uuid, is_private boolean DEFAULT false,
  tournament_id uuid);
CREATE TABLE table_seats(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid,
  stack numeric, left_at timestamptz);
CREATE TABLE hand_history(id uuid PRIMARY KEY, table_id uuid, hand_number bigint, players jsonb,
  created_at timestamptz DEFAULT now());
CREATE TABLE hand_atomic_commits(table_id uuid NOT NULL, hand_number bigint NOT NULL, hand_id uuid PRIMARY KEY,
  payload_hash text NOT NULL, stack_result jsonb NOT NULL, committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  post_commit_payload jsonb, post_commit_request_hash text, post_commit_payload_hash text,
  post_commit_completed_at timestamptz, post_commit_result jsonb);
CREATE TABLE hand_projection_outbox(hand_id uuid PRIMARY KEY, table_id uuid, hand_number bigint);
CREATE TABLE table_pending_addons(id uuid PRIMARY KEY, table_id uuid, amount numeric, resolved_at timestamptz,
  applied_to_stack numeric, refunded numeric);
CREATE TABLE rake_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_id uuid, table_id uuid, club_id uuid,
  rake_amount numeric NOT NULL DEFAULT 0, bbj_contribution numeric DEFAULT 0, pot_size numeric, num_players integer,
  created_at timestamptz DEFAULT now(), player_contributions jsonb, is_tournament boolean NOT NULL DEFAULT false,
  tournament_id uuid, source text DEFAULT 'cash_game', metadata jsonb, rake_method text NOT NULL DEFAULT 'DEALT_EQUAL',
  returned_uncalled jsonb);
CREATE UNIQUE INDEX uq_rake_records_hand_id ON rake_records(hand_id) WHERE hand_id IS NOT NULL;
CREATE TABLE rake_attributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hand_id uuid NOT NULL,
  player_id uuid NOT NULL, rake_amount numeric NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  rake_record_id uuid, table_id uuid, club_id uuid, gross_contribution numeric,
  returned_uncalled numeric NOT NULL DEFAULT 0, eligible_contribution numeric, contribution_weight numeric,
  weighted_rake_credit numeric, bbj_attributed_contribution numeric NOT NULL DEFAULT 0, rake_method text,
  UNIQUE (hand_id, player_id));
CREATE TABLE rake_distribution_legs(leg_key uuid NOT NULL, leg text NOT NULL, club_id uuid, union_id uuid,
  amount numeric, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (leg_key, leg));
CREATE TABLE club_table_rake_totals(club_id uuid NOT NULL, table_id uuid NOT NULL,
  rake_collected numeric NOT NULL DEFAULT 0, bbj_contribution numeric NOT NULL DEFAULT 0, hands bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, table_id));
CREATE TABLE club_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL UNIQUE,
  chip_balance numeric NOT NULL DEFAULT 0);
CREATE TABLE club_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid NOT NULL,
  type text NOT NULL, amount numeric NOT NULL, balance_after numeric NOT NULL, related_id uuid, reason text,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE union_wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid NOT NULL UNIQUE,
  chip_balance numeric NOT NULL DEFAULT 0, rake_wallet numeric DEFAULT 0, bbj_wallet numeric DEFAULT 0,
  promo_wallet numeric DEFAULT 0, insurance_wallet numeric DEFAULT 0, total_rake_collected numeric DEFAULT 0,
  total_settlements numeric DEFAULT 0, updated_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now(),
  spin_reserve_wallet numeric NOT NULL DEFAULT 0);
CREATE TABLE union_wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), union_id uuid NOT NULL,
  wallet text NOT NULL, direction text NOT NULL, amount numeric NOT NULL, balance_after numeric, tx_type text NOT NULL,
  club_id uuid, notes text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE accounting_cash_bank_receipts(rake_record_id uuid NOT NULL REFERENCES rake_records(id), union_id uuid,
  club_id uuid NOT NULL, union_transaction_id uuid REFERENCES union_wallet_transactions(id), club_ledger_id uuid,
  banked_at timestamptz NOT NULL, amount numeric NOT NULL);
CREATE TABLE chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), performed_by uuid, from_type text NOT NULL,
  from_entity_id uuid, from_label text, to_type text NOT NULL, to_entity_id uuid, to_label text, amount numeric NOT NULL,
  category text NOT NULL DEFAULT 'transfer', description text, club_id uuid, union_id uuid, table_id uuid, hand_id uuid,
  tournament_id uuid, created_at timestamptz NOT NULL DEFAULT now(), pre_from_balance numeric, post_from_balance numeric,
  pre_to_balance numeric, post_to_balance numeric, status text NOT NULL DEFAULT 'posted', metadata jsonb);
CREATE TABLE financial_alerts(id bigserial PRIMARY KEY, severity text, source text, message text, context jsonb);
CREATE TABLE accounting_routed_settlement_runs(period_start timestamptz, period_end timestamptz, union_id uuid,
  standalone_club_id uuid);
CREATE TABLE union_rakeback_log(union_id uuid, period_start timestamptz, period_end timestamptz);
CREATE TABLE ca_ledger_invariant_mode(mode text NOT NULL);
INSERT INTO ca_ledger_invariant_mode VALUES ('refuse');
CREATE TABLE ca_ledger_invariant_store_mode(store text PRIMARY KEY, mode text NOT NULL);
CREATE TABLE ca_ledger_invariant_findings(txid xid8, account_key text, balance_delta numeric, ledger_net numeric,
  mode text, actor_service text, db_role text, statement text, found_at timestamptz DEFAULT now(),
  PRIMARY KEY (txid, account_key));
CREATE TABLE ca_declared_money_triggers(table_name text, trigger_name text, declared_at timestamptz DEFAULT now(),
  note text, PRIMARY KEY (table_name, trigger_name));
CREATE TABLE guard_redefinitions(proname text, ref text);
-- Production's money-RPC registry (fn_ca_money_rpc_registry_guard): a
-- migration registers a balance-writing function before it creates it.
CREATE TABLE ca_money_rpc_registry(proname text PRIMARY KEY, status text, notes text);
CREATE TABLE union_pnl_cash_outcomes(table_id uuid, hand_number bigint, evidence jsonb);

CREATE FUNCTION fn_ca_ledger_refusal_record(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION fn_ca_declare_guard_redefinition(p_proname text, p_ref text) RETURNS text LANGUAGE sql
  AS $$ INSERT INTO guard_redefinitions VALUES (p_proname, p_ref) RETURNING p_proname $$;
CREATE FUNCTION fn_ca_refuse_replica_money_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
CREATE FUNCTION fn_ca_block_browser_money_table() RETURNS trigger LANGUAGE plpgsql
  AS $$ BEGIN RETURN COALESCE(NEW, OLD); END $$;
CREATE FUNCTION fn_cash_earning_club(uuid, uuid, uuid, p_club uuid, uuid) RETURNS uuid LANGUAGE sql
  AS $$ SELECT p_club $$;
CREATE FUNCTION fn_project_hand_side_effects_after_post_commit_20260908(p_hand_id uuid) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM hand_projection_outbox WHERE hand_id = p_hand_id;
  RETURN jsonb_build_object('ok', true, 'hand_id', p_hand_id);
END $$;

INSERT INTO unions VALUES ('{RU}');
INSERT INTO clubs(id, name, union_id) VALUES ('{RC}', 'Harness Club', '{RU}');
INSERT INTO tables(id, club_id, union_id) VALUES ('{RT1}', '{RC}', '{RU}'), ('{RT2}', '{RC}', '{RU}');
INSERT INTO club_wallets(club_id, chip_balance) VALUES ('{RC}', 50);
"""

# Attached after the real functions exist. Seeding balances happens with the
# triggers in place and a declared mint, so the opening state is journalled.
RAKE_TRIGGERS = f"""
CREATE TRIGGER trg_ca_autoledger AFTER INSERT OR UPDATE OF chip_balance, rake_wallet, bbj_wallet, promo_wallet,
  insurance_wallet, spin_reserve_wallet ON union_wallets FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger(
  'chip_balance=union_bank', 'rake_wallet=union_wallet', 'bbj_wallet=union_wallet', 'promo_wallet=union_wallet',
  'insurance_wallet=union_wallet', 'spin_reserve_wallet=union_wallet');
CREATE TRIGGER zy_ca_tally_balance_move AFTER INSERT OR DELETE OR UPDATE OF chip_balance, rake_wallet, bbj_wallet,
  promo_wallet, insurance_wallet, spin_reserve_wallet, union_id ON union_wallets
  FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER INSERT OR DELETE OR UPDATE OF chip_balance,
  rake_wallet, bbj_wallet, promo_wallet, insurance_wallet, spin_reserve_wallet, union_id ON union_wallets
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER zy_ca_tally_ledger_leg AFTER INSERT ON chip_ledger
  FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
CREATE CONSTRAINT TRIGGER zz_ca_ledger_row_has_its_balance AFTER INSERT ON chip_ledger
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER zy_ca_tally_balance_move AFTER INSERT OR UPDATE OF post_commit_payload, post_commit_completed_at,
  stack_result, table_id OR DELETE ON hand_atomic_commits FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER INSERT OR UPDATE OF post_commit_payload,
  post_commit_completed_at, stack_result, table_id OR DELETE ON hand_atomic_commits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER zy_ca_tally_balance_move AFTER INSERT OR DELETE OR UPDATE OF stack, left_at, table_id ON table_seats
  FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER INSERT OR DELETE OR UPDATE OF stack, left_at,
  table_id ON table_seats DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
CREATE TRIGGER a0_finish_hand_post_commit_obligations BEFORE DELETE ON hand_projection_outbox
  FOR EACH ROW EXECUTE FUNCTION trg_finish_hand_post_commit_obligations();

BEGIN;
SELECT set_config('app.ledger_category', 'mint', true), set_config('app.ledger_counterparty', 'system_mint', true);
INSERT INTO union_wallets(union_id, rake_wallet, promo_wallet, total_rake_collected) VALUES ('{RU}', 100, 1000, 100);
INSERT INTO chip_ledger(from_type, to_type, to_entity_id, amount, category, table_id)
VALUES ('system_mint', 'table_stack', '{RT1}', 500, 'mint', '{RT1}'),
       ('system_mint', 'table_stack', '{RT2}', 500, 'mint', '{RT2}');
INSERT INTO table_seats(table_id, user_id, stack) VALUES ('{RT1}', '{RP1}', 500), ('{RT2}', '{RP1}', 500);
COMMIT;
"""


def rake_accept(db, hand):
    """The accepted-hand transaction: the seats pay the rake, the receipt
    carries it as felt, the outbox row is the continuation."""
    hand_id, table, number, rake, pot, contributions = hand
    payload = json.dumps({
        'time_banks': [], 'bbj_contribution': None, 'promo_playthrough': [], 'insurance': [], 'pending_addons': None,
        'rake': {'amount': float(rake), 'club_id': RC, 'bbj': 0, 'pot': pot, 'num_players': 2,
                 'contributions': contributions, 'returned_uncalled': {}, 'method': 'WEIGHTED_CONTRIBUTED'}})
    run(db, f"""
BEGIN;
INSERT INTO hand_history(id, table_id, hand_number, players)
VALUES ('{hand_id}', '{table}', {number}, '[{{"userId":"{RP1}"}},{{"userId":"{RP2}"}}]');
UPDATE table_seats SET stack = stack - {rake} WHERE table_id = '{table}';
INSERT INTO hand_atomic_commits(table_id, hand_number, hand_id, payload_hash, stack_result, post_commit_payload,
  post_commit_payload_hash)
SELECT '{table}', {number}, '{hand_id}', 'h', jsonb_build_object('rake', {rake}, 'bbj', 0, 'inflow', 0), p,
       encode(extensions.digest(convert_to(p::text, 'UTF8'), 'sha256'), 'hex')
  FROM (SELECT $j${payload}$j$::jsonb AS p) x;
INSERT INTO hand_projection_outbox VALUES ('{hand_id}', '{table}', {number});
COMMIT;
""")


RAKE_BOOKS = f"""
SELECT jsonb_build_object(
 'wallet', (SELECT jsonb_build_array(rake_wallet, total_rake_collected, promo_wallet, chip_balance)
              FROM union_wallets WHERE union_id = '{RU}'),
 'rake_records', (SELECT jsonb_agg(jsonb_build_array(hand_id, table_id, club_id, rake_amount, bbj_contribution,
     pot_size, num_players, player_contributions, is_tournament, source, metadata, rake_method, returned_uncalled)
     ORDER BY hand_id) FROM rake_records),
 'attributions', (SELECT jsonb_agg(jsonb_build_array(hand_id, player_id, rake_amount, table_id, club_id,
     gross_contribution, returned_uncalled, eligible_contribution, contribution_weight, weighted_rake_credit,
     bbj_attributed_contribution, rake_method, rake_record_id IS NOT NULL) ORDER BY hand_id, player_id)
     FROM rake_attributions),
 'legs', (SELECT jsonb_agg(jsonb_build_array(leg_key, leg, club_id, union_id, amount) ORDER BY leg_key, leg)
     FROM rake_distribution_legs),
 'table_totals', (SELECT jsonb_agg(jsonb_build_array(club_id, table_id, rake_collected, bbj_contribution, hands)
     ORDER BY table_id) FROM club_table_rake_totals),
 'club_transactions', (SELECT jsonb_agg(jsonb_build_array(club_id, type, amount, balance_after, related_id, reason)
     ORDER BY related_id) FROM club_wallet_transactions),
 'union_transactions', (SELECT jsonb_agg(jsonb_build_array(t.union_id, t.club_id, t.amount, t.tx_type, t.wallet,
     t.direction, t.balance_after, t.notes, r.hand_id) ORDER BY r.hand_id)
     FROM union_wallet_transactions t
     JOIN accounting_cash_bank_receipts b ON b.union_transaction_id = t.id
     JOIN rake_records r ON r.id = b.rake_record_id),
 'bank_receipts', (SELECT jsonb_agg(jsonb_build_array(r.hand_id, b.union_id, b.club_id, b.amount, b.club_ledger_id,
     b.banked_at = t.created_at, b.banked_at = r.created_at) ORDER BY r.hand_id)
     FROM accounting_cash_bank_receipts b
     JOIN rake_records r ON r.id = b.rake_record_id
     LEFT JOIN union_wallet_transactions t ON t.id = b.union_transaction_id),
 'ledger', (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT jsonb_build_array(from_type, from_entity_id, from_label,
     to_type, to_entity_id = (SELECT id FROM union_wallets WHERE union_id = '{RU}'), to_label, amount, category,
     club_id, union_id, description, pre_from_balance, post_from_balance,
     pre_to_balance, post_to_balance) AS x
     FROM chip_ledger WHERE category = 'rake') l),
 'ledger_rake_total', (SELECT sum(amount) FROM chip_ledger WHERE category = 'rake'),
 'envelopes', (SELECT jsonb_agg(jsonb_build_array(hand_id, post_commit_completed_at IS NOT NULL,
     post_commit_result - 'hand_id') ORDER BY hand_id) FROM hand_atomic_commits),
 'outbox', (SELECT count(*) FROM hand_projection_outbox),
 'felt', (SELECT sum(stack) FROM table_seats),
 'alerts', (SELECT count(*) FROM financial_alerts),
 'findings', (SELECT count(*) FROM ca_ledger_invariant_findings))::text
"""


def rake_database(db, fixture):
    run('postgres', f'CREATE DATABASE {db}')
    run(db, RAKE_SCHEMA)
    for name, f in fixture['functions'].items():
        # Bodies are the production text; the readers reference tables this
        # proof does not build, and are only replaced here, never run.
        run(db, 'SET check_function_bodies = off;\n' + f['definition'] + ';')
        run(db, f"REVOKE ALL ON FUNCTION {f['signature']} FROM PUBLIC;")
        for grantee in re.findall(r'(\w+)=X/', f['acl'] or ''):
            run(db, f"GRANT EXECUTE ON FUNCTION {f['signature']} TO {grantee};")
        check(f"cash rake: {name} is the production text", md5(db, f['signature']) == f['md5'])
    run(db, RAKE_TRIGGERS)


def rake_hold_wallet(db):
    """A long transaction that has touched the union's wallet row, as the
    tournament settlement did (it debits promo_wallet early and stays open)."""
    holder = spawn(db, f"BEGIN; SELECT 'held' FROM union_wallets WHERE union_id = '{RU}' FOR NO KEY UPDATE;\n")
    check('cash rake: the wallet row is held', holder.stdout.readline().strip() == 'held')
    return holder


def prove_cash_rake_never_waits_on_the_union_wallet():
    fixture = json.loads(RAKE_FIXTURE.read_text())
    envelope = "SELECT public.fn_ca_process_hand_post_commit_obligations('{}')"
    project = "SELECT public.fn_project_hand_side_effects('{}')"
    h1, h2, h3 = RAKE_HANDS

    # BEFORE: the installed functions. A held wallet row stops the envelope.
    rake_database('rakepre', fixture)
    for hand in RAKE_HANDS:
        rake_accept('rakepre', hand)
    holder = rake_hold_wallet('rakepre')
    try:
        waiting = spawn('rakepre', "SET lock_timeout = '1500ms';\n" + envelope.format(h1[0]) + ';\n')
        status, _, error = finish(waiting)
        check('cash rake: BEFORE, the hand envelope waits on the held wallet row and gives up',
              status != 0 and 'lock timeout' in error
              and run('rakepre', 'SELECT count(*) FROM hand_atomic_commits WHERE post_commit_completed_at IS NOT NULL') == '0',
              error[-300:])
    finally:
        send(holder, 'ROLLBACK;\n')
        finish(holder)
    # The uncontended run on the installed functions is the reference books.
    for hand in (h2, h1, h3):  # the order the AFTER run banks in
        result = json.loads(run('rakepre', envelope.format(hand[0])))
        check('cash rake: BEFORE, uncontended envelope banks the rake', result.get('ok') is True and result.get('rake') is True, result)
        while True:
            projected = json.loads(run('rakepre', project.format(hand[0])))
            if projected.get('reason') != 'predecessor_pending':
                break
        check('cash rake: BEFORE, the hand projects', projected.get('ok') is True, projected)
    reference = json.loads(run('rakepre', RAKE_BOOKS))
    check('cash rake: the reference run banked every hand exactly once',
          reference['wallet'][0] == 104.62 and reference['wallet'][1] == 104.62 and reference['ledger_rake_total'] == 4.62
          and len(reference['rake_records']) == 3 and len(reference['union_transactions']) == 3
          and all(row[5] and row[6] for row in reference['bank_receipts'])
          and reference['outbox'] == 0 and reference['findings'] == 0, reference)

    # AFTER: both migrations, exactly as written.
    rake_database('rakepost', fixture)
    run('rakepost', (MIGRATIONS / RAKE_PART1).read_text())
    for name in list(RAKE_POST)[:6]:
        check(f'cash rake: part 1 reproduces the postimage of {name}',
              md5('rakepost', fixture['functions'][name]['signature']) == RAKE_POST[name])
    refused = subprocess.run(list(map(str, psql('rakepost'))), input=(MIGRATIONS / RAKE_PART1).read_text(),
                             text=True, capture_output=True, env=env)
    check('cash rake: part 1 refuses a second run', refused.returncode != 0)
    check('cash rake: the guard redefinitions are declared',
          run('rakepost', "SELECT string_agg(proname, ',' ORDER BY proname) FROM guard_redefinitions")
          == 'fn_ca_supply_snapshot,fn_ca_tally_balance_move')
    for hand in RAKE_HANDS:
        rake_accept('rakepost', hand)

    # Part 1 alone is inert: the envelope still banks, nothing is stored.
    inert = json.loads(run('rakepost', envelope.format(h2[0])))
    check('cash rake: part 1 alone changes nothing (the envelope still banks, no row is stored)',
          inert.get('ok') is True and run('rakepost', 'SELECT count(*) FROM cash_rake_pending') == '0'
          and run('rakepost', f"SELECT rake_wallet FROM union_wallets WHERE union_id = '{RU}'") == '100.37')
    while json.loads(run('rakepost', project.format(h2[0]))).get('reason') == 'predecessor_pending':
        pass

    run('rakepost', (MIGRATIONS / RAKE_SWITCH).read_text())
    check('cash rake: the switch reproduces the postimage derived from production',
          md5('rakepost', fixture['functions']['fn_ca_process_hand_post_commit_obligations']['signature'])
          == RAKE_POST['fn_ca_process_hand_post_commit_obligations'])

    holder = rake_hold_wallet('rakepost')
    try:
        started = time.monotonic()
        held = spawn('rakepost', "SET lock_timeout = '1500ms';\n" + envelope.format(h1[0]) + ';\n')
        status, output, error = finish(held)
        elapsed = time.monotonic() - started
        result = json.loads(output) if status == 0 and output else {}
        check('cash rake: AFTER, the hand envelope completes while the wallet row is held',
              status == 0 and result.get('ok') is True and result.get('rake') is True and elapsed < 1.0,
              {'status': status, 'seconds': elapsed, 'error': error[-300:], 'result': result})
        check('cash rake: the rake is stored on the felt, not banked, and nothing else moved',
              run('rakepost', "SELECT string_agg(hand_id || ':' || amount, ',') FROM cash_rake_pending")
              == f'{h1[0]}:1.25'
              and run('rakepost', f"SELECT count(*) FROM rake_records WHERE hand_id = '{h1[0]}'") == '0')
        started = time.monotonic()
        busy = json.loads(run('rakepost', project.format(h1[0])))
        check('cash rake: the continuation does not wait for the held wallet either, and keeps the obligation',
              busy.get('ok') is False and busy.get('reason') == 'predecessor_pending'
              and busy.get('detail') == 'cash_rake_pending' and busy['cash_rake']['status'] == 'busy'
              and time.monotonic() - started < 1.0
              and run('rakepost', 'SELECT count(*) FROM cash_rake_pending') == '1'
              and run('rakepost', 'SELECT count(*) FROM hand_projection_outbox') == '2', busy)
        started = time.monotonic()
        nxt = json.loads(run('rakepost', "SET lock_timeout = '1500ms'; " + envelope.format(h3[0])))
        check('cash rake: the next hand at the same table is not delayed either',
              nxt.get('ok') is True and time.monotonic() - started < 1.0
              and run('rakepost', 'SELECT count(*), sum(amount) FROM cash_rake_pending') == '2|4.25', nxt)
        guarded = subprocess.run(list(map(str, psql('rakepost'))), text=True, capture_output=True, env=env,
                                 input=f"DELETE FROM hand_projection_outbox WHERE hand_id = '{h1[0]}';")
        check('cash rake: the outbox row cannot leave while its rake is pending',
              guarded.returncode != 0 and 'hand rake remains pending' in guarded.stderr
              and run('rakepost', 'SELECT count(*) FROM hand_projection_outbox') == '2', guarded.stderr[-300:])
    finally:
        send(holder, 'ROLLBACK;\n')
        finish(holder)

    for hand in (h1, h3):
        banked = json.loads(run('rakepost', project.format(hand[0])))
        check('cash rake: once the wallet is free the continuation banks the stored rake and ends its pass',
              banked.get('reason') == 'predecessor_pending'
              and banked.get('detail') == 'cash_rake_banked_in_this_transaction'
              and banked['cash_rake']['status'] == 'banked' and banked['cash_rake']['applied'] is True, banked)
        check('cash rake: the wallet is free again before statistics run',
              run('rakepost', f"SELECT 1 FROM union_wallets WHERE union_id = '{RU}' FOR NO KEY UPDATE NOWAIT") == '1')
        again = json.loads(run('rakepost', f"SELECT public.fn_ca_bank_pending_cash_rake('{hand[0]}')"))
        check('cash rake: banking is once per hand', again.get('status') == 'absent', again)
        projected = json.loads(run('rakepost', project.format(hand[0])))
        check('cash rake: the next pass projects the hand', projected.get('ok') is True, projected)
    after = json.loads(run('rakepost', RAKE_BOOKS))
    check('cash rake: nothing is left pending', run('rakepost', 'SELECT count(*) FROM cash_rake_pending') == '0')
    differing = sorted(k for k in reference if reference[k] != after[k])
    check('cash rake: wallet, ledger, union transactions, bank receipts and every other row equal the '
          'uncontended reference exactly', not differing,
          {k: {'reference': reference[k], 'after': after[k]} for k in differing})


# ---- hand bank obligations (20261118071728 + 20261118071736) ---------------
BANK_FIXTURE = ROOT / 'scripts/ci/fixtures/hand-bank-pending/live-definitions.json'
BANK_PART1 = '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql'
BANK_SWITCH = '20261118071736_a_cash_hand_never_waits_on_the_union_bbj_pool_or_insurance_b.sql'
BANK_POST = {
    'fn_ca_tally_balance_move': '710154d55d4cb9fb1d425f3df13087c4',
    'fn_ca_supply_snapshot': 'c14f15b5933a8ee0e24f1f918bdc6d6f',
    'fn_ca_account_balance': 'abe021e4c5a42b02f3b4c00c8bd1ffc9',
    'fn_rake_bbj_invariants': '2a8c79452ced863cfb15364d1e62a40c',
    'fn_project_hand_side_effects': '39d043cda727119e0a6d883a3fb25d50',
    'trg_finish_hand_post_commit_obligations': '2d9d0d7cab537e608da36be3319e347e',
    'fn_ca_process_hand_post_commit_obligations': '7a796358fa28fda910e0f28ded72ff79',
}
BANK_POST_EXTRA = {
    'fn_post_commit_stranded_watchdog': 'a16ceda2073f0dbb3cd28feb841106e9',
    'fn_union_debit_wallet_zd3core': 'c0f1ac2ac14a3790e563b8aec961d297',
    'record_insurance_transaction': '6724ca97c0afc65959b02f24caffa106',
}


def bank_insurance_repair_sql():
    """Only the record_insurance_transaction repair of part 1, with its pinned
    substitution helper: the reference run needs a payout that can be paid."""
    part1 = (MIGRATIONS / BANK_PART1).read_text()
    helper = part1[part1.index('CREATE FUNCTION pg_temp.ca_bank_subst'):part1.index('END $h$;') + len('END $h$;')]
    start = part1.index("SELECT pg_temp.ca_bank_subst(\n  'public.record_insurance_transaction(")
    return 'BEGIN;\n' + helper + '\n' + part1[start:part1.index('\n);\n', start) + 4] + 'COMMIT;\n'
BANK_POOL = 'b0000000-0000-0000-0000-0000000000b1'
# hand id, table, hand number, rake, bbj drop, pot, contributions, insurance legs (premium, payout)
BANK_HANDS = [
    ('e0000000-0000-0000-0000-000000000001', RT1, 301, '1.25', '0.50', '25.00', {RP1: 12.5, RP2: 12.5},
     [('2.00', '0.00')]),
    ('e0000000-0000-0000-0000-000000000002', RT2, 401, '0.37', '0.20', '7.40', {RP1: 2.4, RP2: 5.0}, []),
    ('e0000000-0000-0000-0000-000000000003', RT1, 302, '3.00', '1.00', '90.00', {RP1: 60.0, RP2: 30.0},
     [('1.00', '5.00')]),
]

# The union's BBJ pool, its allocator and the insurance receipts, with
# production's column names; the pool's money triggers are the real ones.
BANK_SCHEMA = f"""
CREATE TABLE ca_bbj_policy(id integer PRIMARY KEY, pivot_threshold numeric NOT NULL, standard_main numeric NOT NULL,
  standard_backup numeric NOT NULL, pivot_main numeric NOT NULL, pivot_backup numeric NOT NULL, note text,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ca_bbj_pool_policy(pool_id uuid PRIMARY KEY, standard_main numeric NOT NULL, standard_backup numeric NOT NULL,
  pivot_main numeric NOT NULL, pivot_backup numeric NOT NULL, note text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ca_bbj_alloc_state(pool_id uuid PRIMARY KEY, main_residue numeric NOT NULL DEFAULT 0,
  backup_residue numeric NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE bbj_pools(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), club_id uuid UNIQUE, union_id uuid,
  hands_contributed bigint DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  main_balance numeric(14,2) NOT NULL DEFAULT 0, backup_balance numeric(14,2) NOT NULL DEFAULT 0,
  promo_balance numeric(14,2) NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'active', total_contributed numeric DEFAULT 0,
  alloc_cum_amount numeric(14,4) NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX uq_bbj_pools_union_active ON bbj_pools(union_id)
  WHERE club_id IS NULL AND union_id IS NOT NULL AND status = 'active';
CREATE TABLE bbj_contributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pool_id uuid, club_id uuid, table_id uuid,
  hand_number bigint DEFAULT 0, amount numeric(14,2) NOT NULL, big_blind numeric(10,2), created_at timestamptz DEFAULT now(),
  main_portion numeric(10,4), backup_portion numeric(10,4), promo_portion numeric(10,4), hand_id uuid);
CREATE UNIQUE INDEX uq_bbj_contributions_pool_hand ON bbj_contributions(pool_id, hand_id) WHERE hand_id IS NOT NULL;
CREATE TABLE insurance_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid NOT NULL, club_id uuid NOT NULL,
  union_id uuid, hand_number integer NOT NULL, player_id uuid NOT NULL, equity_percent numeric(5,2) NOT NULL,
  premium numeric(10,2) NOT NULL, insured_amount numeric(10,2) NOT NULL, payout numeric(10,2) NOT NULL DEFAULT 0.00,
  player_won boolean NOT NULL DEFAULT false, net_result numeric(10,2) NOT NULL, bank_type varchar(10) NOT NULL,
  bank_entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), kind varchar(16) NOT NULL DEFAULT 'insurance');
CREATE UNIQUE INDEX insurance_transactions_table_hand_player_uidx ON insurance_transactions(table_id, hand_number, player_id);
ALTER TABLE financial_alerts ADD COLUMN resolved boolean NOT NULL DEFAULT false,
  ADD COLUMN resolved_at timestamptz, ADD COLUMN resolution text;
ALTER TABLE union_wallets ADD CONSTRAINT union_wallets_insurance_wallet_nonneg CHECK (insurance_wallet >= 0);
INSERT INTO ca_bbj_policy VALUES (1, 100000, 0.5, 0.3, 0.3, 0.3, 'harness', now());
INSERT INTO ca_bbj_pool_policy VALUES ('{BANK_POOL}', 0.05, 0.20, 0.05, 0.20, 'the Midway Union rule', now());
INSERT INTO bbj_pools(id, union_id) VALUES ('{BANK_POOL}', '{RU}');
"""
BANK_TRIGGERS = """
CREATE TRIGGER trg_ca_autoledger AFTER INSERT OR UPDATE OF main_balance, backup_balance, promo_balance ON bbj_pools
  FOR EACH ROW EXECUTE FUNCTION fn_ca_autoledger('main_balance=bbj_pool', 'backup_balance=bbj_pool', 'promo_balance=bbj_pool');
CREATE TRIGGER zy_ca_tally_balance_move AFTER INSERT OR DELETE OR UPDATE OF main_balance, backup_balance, promo_balance
  ON bbj_pools FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
CREATE CONSTRAINT TRIGGER zz_ca_balance_has_its_ledger_row AFTER INSERT OR DELETE OR UPDATE OF main_balance,
  backup_balance, promo_balance ON bbj_pools DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
"""


def bank_database(db, fixture, extra):
    rake_database(db, fixture)
    run(db, BANK_SCHEMA)
    for name, f in extra['functions'].items():
        run(db, 'SET check_function_bodies = off;\n' + f['definition'] + ';')
        run(db, f"REVOKE ALL ON FUNCTION {f['signature']} FROM PUBLIC;")
        for grantee in re.findall(r'(\w+)=X/', f['acl'] or ''):
            run(db, f"GRANT EXECUTE ON FUNCTION {f['signature']} TO {grantee};")
        check(f'hand bank: {name} is the production text', md5(db, f['signature']) == f['md5'])
    run(db, BANK_TRIGGERS)
    # The union's insurance bank holds 10.00, minted with its journal row.
    run(db, f"""
BEGIN;
SELECT set_config('app.ledger_category', 'mint', true), set_config('app.ledger_counterparty', 'system_mint', true);
UPDATE union_wallets SET insurance_wallet = 10 WHERE union_id = '{RU}';
COMMIT;""")
    # #11256 is installed: it is what production runs from 2026-11-18.
    run(db, (MIGRATIONS / RAKE_PART1).read_text())
    run(db, (MIGRATIONS / RAKE_SWITCH).read_text())


def bank_accept(db, hand, mutate=None):
    run(db, 'BEGIN;\n' + bank_accept_sql(hand, mutate) + '\nCOMMIT;')


def bank_accept_sql(hand, mutate=None):
    """The accepted-hand transaction: the seats pay rake + drop + premium -
    payout, the receipt carries it as felt, the outbox row is the
    continuation."""
    hand_id, table, number, rake, drop, pot, contributions, legs = hand
    inflow = sum(float(pay) - float(prem) for prem, pay in legs)
    body = ({
        'time_banks': [], 'promo_playthrough': [], 'pending_addons': None,
        'bbj_contribution': {'amount': float(drop), 'club_id': RC, 'big_blind': 0.5},
        'insurance': [{'club_id': RC, 'player_id': RP1, 'premium': float(prem), 'payout': float(pay),
                       'insured_amount': 10, 'equity_percent': 20, 'player_won': float(pay) > 0, 'kind': 'insurance'}
                      for prem, pay in legs],
        'rake': {'amount': float(rake), 'club_id': RC, 'bbj': float(drop), 'pot': pot, 'num_players': 2,
                 'contributions': contributions, 'returned_uncalled': {}, 'method': 'WEIGHTED_CONTRIBUTED'}})
    if mutate:
        mutate(body)
    payload = json.dumps(body)
    return f"""
INSERT INTO hand_history(id, table_id, hand_number, players)
VALUES ('{hand_id}', '{table}', {number}, '[{{"userId":"{RP1}"}},{{"userId":"{RP2}"}}]');
UPDATE table_seats SET stack = stack - ({rake} + {drop} - ({inflow})) WHERE table_id = '{table}';
INSERT INTO hand_atomic_commits(table_id, hand_number, hand_id, payload_hash, stack_result, post_commit_payload,
  post_commit_payload_hash)
SELECT '{table}', {number}, '{hand_id}', 'h', jsonb_build_object('rake', {rake}, 'bbj', {drop}, 'inflow', {inflow}), p,
       encode(extensions.digest(convert_to(p::text, 'UTF8'), 'sha256'), 'hex')
  FROM (SELECT $j${payload}$j$::jsonb AS p) x;
INSERT INTO hand_projection_outbox VALUES ('{hand_id}', '{table}', {number});
"""


BANK_BOOKS = f"""
SELECT jsonb_build_object(
 'wallet', (SELECT jsonb_build_array(rake_wallet, total_rake_collected, promo_wallet, chip_balance, insurance_wallet)
              FROM union_wallets WHERE union_id = '{RU}'),
 'pool', (SELECT jsonb_build_array(main_balance, backup_balance, promo_balance, total_contributed, alloc_cum_amount,
              hands_contributed) FROM bbj_pools WHERE id = '{BANK_POOL}'),
 'pools', (SELECT count(*) FROM bbj_pools),
 'alloc_state', (SELECT jsonb_agg(jsonb_build_array(pool_id, main_residue, backup_residue)) FROM ca_bbj_alloc_state),
 'contributions', (SELECT jsonb_agg(jsonb_build_array(pool_id, hand_id, table_id, club_id, hand_number, amount, big_blind,
     main_portion, backup_portion, promo_portion) ORDER BY hand_id) FROM bbj_contributions),
 'insurance', (SELECT jsonb_agg(jsonb_build_array(table_id, club_id, union_id, hand_number, player_id, equity_percent,
     premium, insured_amount, payout, player_won, net_result, bank_type, bank_entity_id, kind) ORDER BY hand_number)
     FROM insurance_transactions),
 'rake_records', (SELECT jsonb_agg(jsonb_build_array(hand_id, rake_amount, bbj_contribution) ORDER BY hand_id)
     FROM rake_records),
 'ledger', (SELECT jsonb_agg(x ORDER BY x) FROM (SELECT jsonb_build_array(from_type,
     CASE WHEN from_entity_id = (SELECT id FROM union_wallets WHERE union_id = '{RU}') THEN 'the union wallet row'
          ELSE from_entity_id::text END, from_label,
     to_type, to_label, amount, category, club_id, union_id, description) AS x
     FROM chip_ledger WHERE category IN ('rake', 'bbj_contribution', 'insurance')) l),
 'ledger_totals', (SELECT jsonb_object_agg(category, total) FROM (SELECT category, sum(amount) AS total
     FROM chip_ledger WHERE category IN ('rake', 'bbj_contribution', 'insurance') GROUP BY category) t),
 'envelopes', (SELECT jsonb_agg(jsonb_build_array(hand_id, post_commit_completed_at IS NOT NULL,
     post_commit_result - 'hand_id') ORDER BY hand_id) FROM hand_atomic_commits),
 'outbox', (SELECT count(*) FROM hand_projection_outbox),
 'felt', (SELECT sum(stack) FROM table_seats),
 'alerts', (SELECT count(*) FROM financial_alerts),
 'findings', (SELECT count(*) FROM ca_ledger_invariant_findings))::text
"""


def bank_hold(db):
    """A long transaction holding the union's BBJ pool (its lock and its row)
    and the union's wallet row: fn_union_promo_send holds both, a tournament
    settlement held the wallet for 45 s on 2026-11-17."""
    holder = spawn(db, f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('bbj-pool:{RU}', 0)); "
                       f"SELECT 1 FROM union_wallets WHERE union_id = '{RU}' FOR NO KEY UPDATE; "
                       f"SELECT 'held' FROM bbj_pools WHERE id = '{BANK_POOL}' FOR UPDATE;\n")
    lines = [holder.stdout.readline().strip() for _ in range(3)]
    check('hand bank: the pool lock, the pool row and the wallet row are held', lines[-1] == 'held', lines)
    return holder


def drain(db, hand_id):
    """The hand's own continuation, pass after pass, as the worker drives it."""
    passes = []
    for _ in range(6):
        r = json.loads(run(db, f"SELECT public.fn_project_hand_side_effects('{hand_id}')"))
        passes.append(r)
        if r.get('reason') != 'predecessor_pending':
            return r, passes
    return r, passes


def prove_hand_bank_never_waits_on_the_union_pool():
    fixture = json.loads(RAKE_FIXTURE.read_text())
    extra = json.loads(BANK_FIXTURE.read_text())
    envelope = "SELECT public.fn_ca_process_hand_post_commit_obligations('{}')"
    project = "SELECT public.fn_project_hand_side_effects('{}')"
    h1, h2, h3 = BANK_HANDS

    # BEFORE: #11256 installed. A held pool stops a BBJ hand's envelope.
    bank_database('bankpre', fixture, extra)
    # The reference pays h3's payout, which production's text cannot (see
    # prove_bad_obligations_still_fail_the_envelope): only that repair is added.
    run('bankpre', bank_insurance_repair_sql())
    check('hand bank: the reference carries only the insurance repair',
          md5('bankpre', extra['functions']['record_insurance_transaction']['signature'])
          == BANK_POST_EXTRA['record_insurance_transaction'])
    for hand in BANK_HANDS:
        bank_accept('bankpre', hand)
    holder = bank_hold('bankpre')
    try:
        waiting = spawn('bankpre', "SET lock_timeout = '1500ms';\n" + envelope.format(h1[0]) + ';\n')
        status, _, error = finish(waiting)
        check('hand bank: BEFORE, with #11256 installed the BBJ hand envelope waits on the held pool and gives up',
              status != 0 and 'lock timeout' in error
              and run('bankpre', 'SELECT count(*) FROM hand_atomic_commits WHERE post_commit_completed_at IS NOT NULL') == '0',
              error[-300:])
    finally:
        send(holder, 'ROLLBACK;\n')
        finish(holder)
    for hand in (h2, h1, h3):
        result = json.loads(run('bankpre', envelope.format(hand[0])))
        check('hand bank: BEFORE, the uncontended envelope banks drop and insurance',
              result.get('ok') is True and result.get('bbj_contribution') is True
              and result.get('insurance') == len(hand[7]), result)
        projected, passes = drain('bankpre', hand[0])
        check('hand bank: BEFORE, the hand projects', projected.get('ok') is True, passes)
    reference = json.loads(run('bankpre', BANK_BOOKS))
    check('hand bank: the reference run banked every drop and leg exactly once',
          reference['pool'][3] == 1.7 and len(reference['contributions']) == 3 and len(reference['insurance']) == 2
          and reference['wallet'][4] == 8 and reference['outbox'] == 0 and reference['findings'] == 0, reference)

    # AFTER: both files, exactly as written, on top of #11256.
    bank_database('bankpost', fixture, extra)
    run('bankpost', (MIGRATIONS / BANK_PART1).read_text())
    for name in list(BANK_POST)[:6]:
        check(f'hand bank: part 1 reproduces the postimage of {name}',
              md5('bankpost', fixture['functions'][name]['signature']) == BANK_POST[name])
    for name, want in BANK_POST_EXTRA.items():
        check(f'hand bank: part 1 reproduces the postimage of {name}',
              md5('bankpost', extra['functions'][name]['signature']) == want)
    refused = subprocess.run(list(map(str, psql('bankpost'))), input=(MIGRATIONS / BANK_PART1).read_text(),
                             text=True, capture_output=True, env=env)
    check('hand bank: part 1 refuses a second run', refused.returncode != 0)
    for hand in BANK_HANDS:
        bank_accept('bankpost', hand)

    inert = json.loads(run('bankpost', envelope.format(h2[0])))
    check('hand bank: part 1 alone changes nothing (the envelope still banks the drop, no row is stored)',
          inert.get('ok') is True and run('bankpost', 'SELECT count(*) FROM hand_bank_obligation_pending') == '0'
          and run('bankpost', 'SELECT count(*) FROM bbj_contributions') == '1')
    drain('bankpost', h2[0])

    run('bankpost', (MIGRATIONS / BANK_SWITCH).read_text())
    check('hand bank: the switch reproduces the postimage derived from production',
          md5('bankpost', fixture['functions']['fn_ca_process_hand_post_commit_obligations']['signature'])
          == BANK_POST['fn_ca_process_hand_post_commit_obligations'])

    holder = bank_hold('bankpost')
    try:
        started = time.monotonic()
        held = spawn('bankpost', "SET lock_timeout = '1500ms';\n" + envelope.format(h1[0]) + ';\n')
        status, output, error = finish(held)
        elapsed = time.monotonic() - started
        result = json.loads(output) if status == 0 and output else {}
        check('hand bank: AFTER, the BBJ hand envelope completes while the pool and the wallet are held',
              status == 0 and result.get('ok') is True and result.get('bbj_contribution') is True
              and result.get('insurance') == 1 and elapsed < 1.0,
              {'status': status, 'seconds': elapsed, 'error': error[-300:], 'result': result})
        check('hand bank: the drop and the insurance leg are stored on the felt, not banked',
              run('bankpost', "SELECT string_agg(kind || ':' || round(felt_amount, 2), ',' ORDER BY kind) "
                              "FROM hand_bank_obligation_pending") == 'bbj_contribution:0.50,insurance:2.00'
              and run('bankpost', f"SELECT count(*) FROM bbj_contributions WHERE hand_id = '{h1[0]}'") == '0'
              and run('bankpost', 'SELECT count(*) FROM insurance_transactions') == '0')
        started = time.monotonic()
        busy = json.loads(run('bankpost', project.format(h1[0])))
        check('hand bank: the continuation does not wait for the held pool or bank either, and keeps the obligations',
              busy.get('ok') is False and busy.get('reason') == 'predecessor_pending'
              and time.monotonic() - started < 1.0
              and run('bankpost', 'SELECT count(*) FROM hand_bank_obligation_pending') == '2'
              and run('bankpost', 'SELECT count(*) FROM cash_rake_pending') == '1', busy)
        bank = json.loads(run('bankpost', f"SELECT public.fn_ca_bank_pending_hand_obligations('{h1[0]}')"))
        check('hand bank: a held pool or bank reads busy, never refused',
              bank.get('status') == 'busy' and {i['status'] for i in bank['items']} == {'busy'}
              and run('bankpost', 'SELECT max(attempts) FROM hand_bank_obligation_pending') == '0', bank)
        started = time.monotonic()
        nxt = json.loads(run('bankpost', "SET lock_timeout = '1500ms'; " + envelope.format(h3[0])))
        check('hand bank: the next hand at the same table is not delayed either',
              nxt.get('ok') is True and time.monotonic() - started < 1.0
              and run('bankpost', 'SELECT count(*), round(sum(felt_amount), 2) FROM hand_bank_obligation_pending') == '4|-0.50',
              nxt)
        guarded = subprocess.run(list(map(str, psql('bankpost'))), text=True, capture_output=True, env=env,
                                 input=f"DELETE FROM hand_projection_outbox WHERE hand_id = '{h1[0]}';")
        check('hand bank: the outbox row cannot leave while its obligations are pending',
              guarded.returncode != 0 and 'remains pending' in guarded.stderr
              and run('bankpost', 'SELECT count(*) FROM hand_projection_outbox') == '2', guarded.stderr[-300:])
        quiet = json.loads(run('bankpost', 'SELECT public.fn_post_commit_stranded_watchdog()'))
        check('hand bank: within the grace the stranded watchdog stays quiet',
              quiet.get('pending_obligations') == 0
              and run('bankpost', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_post_commit_stranded_watchdog'") == '0',
              quiet)
        run('bankpost', """
ALTER TABLE hand_bank_obligation_pending DISABLE TRIGGER hand_bank_obligation_is_immutable;
ALTER TABLE cash_rake_pending DISABLE TRIGGER cash_rake_pending_is_immutable;
UPDATE hand_bank_obligation_pending SET created_at = created_at - interval '11 minutes';
UPDATE cash_rake_pending SET created_at = created_at - interval '11 minutes';
ALTER TABLE hand_bank_obligation_pending ENABLE TRIGGER hand_bank_obligation_is_immutable;
ALTER TABLE cash_rake_pending ENABLE TRIGGER cash_rake_pending_is_immutable;""")
        paged = json.loads(run('bankpost', 'SELECT public.fn_post_commit_stranded_watchdog()'))
        alert = json.loads(run('bankpost', "SELECT jsonb_build_object('severity', severity, 'context', context) "
                                           "FROM financial_alerts WHERE source = 'fn_post_commit_stranded_watchdog' "
                                           "AND NOT resolved"))
        check('hand bank: a stored rake, drop or leg past the grace pages CRITICAL with its attempts and last error',
              paged.get('pending_obligations') == 6 and alert['severity'] == 'critical'
              and alert['context']['pending_obligations'] == 6
              and {o['obligation'] for o in alert['context']['pending_sample']} == {'rake', 'bbj_contribution', 'insurance'}
              and all('attempts' in o and 'last_error' in o for o in alert['context']['pending_sample']),
              {'watchdog': paged, 'alert': alert})
        meters = run('bankpost', "SELECT round((SELECT sum(felt_amount) FROM hand_bank_obligation_pending) "
                                 "+ (SELECT sum(amount) FROM cash_rake_pending), 2)")
        check('hand bank: while held, what is stored is exactly what the receipts released', meters == '3.75', meters)
    finally:
        send(holder, 'ROLLBACK;\n')
        finish(holder)

    # The wallet is free again; the payout stored for h3 (4.00) is still owed from it.
    door = json.loads(run('bankpost', f"SELECT public.fn_union_debit_wallet_zd3core('{RU}', 'insurance', 7, "
                                       "'withdrawal', NULL, NULL, 'test', NULL)"))
    check('hand bank: a stored insurance payout is reserved at the wallet\'s debit door',
          door.get('success') is False and door.get('error') == 'insufficient balance'
          and float(door.get('reserved_for_pending_payouts')) == 4.0 and float(door.get('balance')) == 10.0, door)

    for hand in (h1, h3):
        projected, passes = drain('bankpost', hand[0])
        check('hand bank: once the pool and bank are free the continuation banks them and the hand projects',
              projected.get('ok') is True
              and any(p.get('hand_bank', {}).get('status') == 'banked' for p in passes), passes)
        again = json.loads(run('bankpost', f"SELECT public.fn_ca_bank_pending_hand_obligations('{hand[0]}')"))
        check('hand bank: banking is once per obligation', again.get('status') == 'absent', again)
    resolved = json.loads(run('bankpost', 'SELECT public.fn_post_commit_stranded_watchdog()'))
    check('hand bank: the stranded alert resolves once nothing is left',
          resolved.get('pending_obligations') == 0 and resolved.get('stranded') == 0
          and run('bankpost', "SELECT count(*) FROM financial_alerts WHERE source = 'fn_post_commit_stranded_watchdog' "
                              "AND NOT resolved") == '0', resolved)
    run('bankpost', "DELETE FROM financial_alerts WHERE source = 'fn_post_commit_stranded_watchdog'")
    after = json.loads(run('bankpost', BANK_BOOKS))
    check('hand bank: nothing is left pending',
          run('bankpost', 'SELECT count(*) FROM hand_bank_obligation_pending') == '0'
          and run('bankpost', 'SELECT count(*) FROM cash_rake_pending') == '0')
    differing = sorted(k for k in reference if reference[k] != after[k])
    check('hand bank: pool, allocator, contributions, insurance receipts, wallet, ledger and every other row '
          'equal the uncontended reference exactly', not differing,
          {k: {'reference': reference[k], 'after': after[k]} for k in differing})



def prove_bad_obligations_still_fail_the_envelope():
    """Everything the deferred calls would refuse about an obligation is
    refused by the envelope itself, as before: nothing malformed is stored to
    fail later behind a completed envelope."""
    fixture = json.loads(RAKE_FIXTURE.read_text())
    extra = json.loads(BANK_FIXTURE.read_text())
    bank_database('bankbad', fixture, extra)
    payout = ('f0000000-0000-0000-0000-0000000000aa', RT2, 700, '1.00', '0.50', '20.00', {RP1: 10.0, RP2: 10.0},
              [('1.00', '5.00')])
    r = subprocess.run(list(map(str, psql('bankbad'))), text=True, capture_output=True, env=env,
                       input='BEGIN;\n' + bank_accept_sql(payout)
                             + f"\nSELECT public.fn_ca_process_hand_post_commit_obligations('{payout[0]}');\nCOMMIT;\n")
    check('hand bank: on the production text a covered insurance payout is refused by the CHECK on the '
          'proposed INSERT row (the defect part 1 repairs)',
          r.returncode != 0 and 'union_wallets_insurance_wallet_nonneg' in r.stderr
          and run('bankbad', f"SELECT insurance_wallet FROM union_wallets WHERE union_id = '{RU}'") == '10',
          r.stderr[-300:])
    run('bankbad', (MIGRATIONS / BANK_PART1).read_text())
    run('bankbad', (MIGRATIONS / BANK_SWITCH).read_text())
    leg = {'club_id': RC, 'player_id': RP1, 'premium': 1.0, 'payout': 0, 'insured_amount': 10,
           'equity_percent': 20, 'player_won': False, 'kind': 'insurance'}
    cases = [
        ('a drop that is not whole cents', lambda b: b['bbj_contribution'].update(amount=0.505),
         'positive whole-cent amount'),
        ('two legs for one player (the receipt identity)',
         lambda b: b.update(insurance=[dict(leg), dict(leg, kind='ev_cashout', premium=2.0)]),
         'Insurance identity reused with a different payment payload'),
        ('equity above 100', lambda b: b.update(insurance=[dict(leg, equity_percent=150)]),
         'Invalid insurance payment identity or amounts'),
        ('a negative amount', lambda b: b.update(insurance=[dict(leg, premium=-1)]),
         'Invalid insurance payment identity or amounts'),
        ('an unknown kind', lambda b: b.update(insurance=[dict(leg, kind='side_bet')]),
         'Invalid insurance payment identity or amounts'),
        ('a table of another club',
         lambda b: b.update(insurance=[dict(leg, club_id='a0000000-0000-0000-0000-0000000000c9')]),
         'Insurance table does not belong to supplied club'),
        ('a payout the bank cannot cover', lambda b: b.update(insurance=[dict(leg, premium=0, payout=10.01)]),
         'insurance payout exceeds the union insurance bank'),
    ]
    for n, (what, mutate, message) in enumerate(cases):
        hand = ('f0000000-0000-0000-0000-00000000000' + str(n), RT1, 500 + n, '1.00', '0.50', '20.00',
                {RP1: 10.0, RP2: 10.0}, [])
        r = subprocess.run(list(map(str, psql('bankbad'))), text=True, capture_output=True, env=env,
                           input='BEGIN;\n' + bank_accept_sql(hand, mutate)
                                 + f"\nSELECT public.fn_ca_process_hand_post_commit_obligations('{hand[0]}');\nCOMMIT;\n")
        check(f'hand bank: the envelope still refuses {what}', r.returncode != 0 and message in r.stderr,
              r.stderr[-400:])
    check('hand bank: nothing malformed was stored',
          run('bankbad', 'SELECT count(*) FROM hand_bank_obligation_pending') == '0')
    same = [dict(leg), dict(leg)]
    hand = ('f0000000-0000-0000-0000-0000000000ff', RT1, 600, '1.00', '0.50', '20.00', {RP1: 10.0, RP2: 10.0},
            [('1.00', '0.00')])
    bank_accept('bankbad', hand, lambda b: b.update(insurance=same))
    ok = json.loads(run('bankbad', f"SELECT public.fn_ca_process_hand_post_commit_obligations('{hand[0]}')"))
    r = subprocess.run(list(map(str, psql('bankbad'))), text=True, capture_output=True, env=env,
                       input='BEGIN;\n' + bank_accept_sql(payout)
                             + f"\nSELECT public.fn_ca_process_hand_post_commit_obligations('{payout[0]}');"
                             + f"\nSELECT public.fn_ca_bank_pending_hand_obligations('{payout[0]}')->>'status';\n"
                             + f"SELECT insurance_wallet FROM union_wallets WHERE union_id = '{RU}';\nROLLBACK;\n")
    check('hand bank: after part 1 the same covered payout is stored and banks',
          r.returncode == 0 and r.stdout.strip().splitlines()[-2:] == ['banked', '6.00'], (r.stdout[-300:], r.stderr[-300:]))
    moved = ('f0000000-0000-0000-0000-0000000000bb', RT2, 701, '1.00', '0.50', '20.00', {RP1: 10.0, RP2: 10.0}, [])
    r = subprocess.run(list(map(str, psql('bankbad'))), text=True, capture_output=True, env=env,
                       input='BEGIN;\n' + bank_accept_sql(moved)
                             + f"\nSELECT public.fn_ca_process_hand_post_commit_obligations('{moved[0]}');"
                             + f"\nUPDATE clubs SET union_id = NULL WHERE id = '{RC}';"
                             + f"\nSELECT public.fn_ca_bank_pending_hand_obligations('{moved[0]}')->>'status';"
                             + f"\nSELECT (p.id = '{BANK_POOL}')::text FROM bbj_contributions b"
                             + f" JOIN bbj_pools p ON p.id = b.pool_id WHERE b.hand_id = '{moved[0]}';\nROLLBACK;\n")
    check('hand bank: UNION LAW, a drop banks to the union of the game at hand time even if the club left it '
          'while the drop waited',
          r.returncode == 0 and r.stdout.strip().splitlines()[-2:] == ['banked', 'true'],
          (r.stdout[-300:], r.stderr[-300:]))
    closed = ('f0000000-0000-0000-0000-0000000000bc', RT2, 702, '1.00', '0.50', '20.00', {RP1: 10.0, RP2: 10.0}, [])
    r = subprocess.run(list(map(str, psql('bankbad'))), text=True, capture_output=True, env=env,
                       input=f"BEGIN;\nUPDATE clubs SET union_id = NULL WHERE id = '{RC}';\n"
                             + f"INSERT INTO bbj_pools(club_id, status) VALUES ('{RC}', 'active');\n"
                             + bank_accept_sql(closed)
                             + f"\nSELECT public.fn_ca_process_hand_post_commit_obligations('{closed[0]}')->>'ok';"
                             # the club joins the union: its pool is retired into its treasury
                             + f"\nUPDATE bbj_pools SET status = 'retired' WHERE club_id = '{RC}';"
                             + f"\nUPDATE clubs SET union_id = '{RU}' WHERE id = '{RC}';"
                             + f"\nSELECT b->>'status', b->'items'->0->>'error' FROM "
                             + f"public.fn_ca_bank_pending_hand_obligations('{closed[0]}') b;"
                             + "\nSELECT count(*) FROM bbj_pools WHERE status = 'active' AND club_id IS NOT NULL;\nROLLBACK;\n")
    lines = r.stdout.strip().splitlines()
    check('hand bank: a standalone club\'s drop whose pool was retired on joining a union is refused by name, '
          'never banked to a new orphan pool',
          r.returncode == 0 and lines[-3] == 'true' and lines[-2].startswith('refused|bbj_club_pool_closed_on_union_join')
          and lines[-1] == '0', (r.stdout[-400:], r.stderr[-300:]))
    check('hand bank: the same leg repeated is one receipt, as the call returned it before',
          ok.get('ok') is True and run('bankbad', "SELECT count(*) FROM hand_bank_obligation_pending "
                                                  "WHERE kind = 'insurance'") == '1', ok)


def prove_first_insurance_legs_still_merge():
    """record_insurance_transaction updates the union bank row first; a union
    with no row yet still takes the old upsert, so two first legs racing in two
    sessions merge instead of one failing on the union's unique key."""
    fixture = json.loads(RAKE_FIXTURE.read_text())
    extra = json.loads(BANK_FIXTURE.read_text())
    db = 'bankrace'
    bank_database(db, fixture, extra)
    run(db, (MIGRATIONS / BANK_PART1).read_text())
    check('hand bank race: the repaired insurance function is installed',
          md5(db, extra['functions']['record_insurance_transaction']['signature'])
          == BANK_POST_EXTRA['record_insurance_transaction'])
    u2, c2, t2 = ('fade0000-0000-0000-0000-0000000000f2', 'a0000000-0000-0000-0000-0000000000f2',
                  'c0000000-0000-0000-0000-0000000000f2')
    run(db, f"""
INSERT INTO unions VALUES ('{u2}');
INSERT INTO clubs(id, name, union_id) VALUES ('{c2}', 'Race Club', '{u2}');
INSERT INTO tables(id, club_id, union_id) VALUES ('{t2}', '{c2}', '{u2}');
BEGIN;
SELECT set_config('app.ledger_category', 'mint', true), set_config('app.ledger_counterparty', 'system_mint', true);
INSERT INTO chip_ledger(from_type, to_type, to_entity_id, amount, category, table_id)
VALUES ('system_mint', 'table_stack', '{t2}', 100, 'mint', '{t2}');
INSERT INTO table_seats(table_id, user_id, stack) VALUES ('{t2}', '{RP1}', 100);
COMMIT;""")
    check('hand bank race: the union has no bank row yet',
          run(db, f"SELECT count(*) FROM union_wallets WHERE union_id = '{u2}'") == '0')

    def leg(hand_number):
        # The leg and the felt it leaves, so each transaction balances on its own.
        return (f"BEGIN;\nSELECT 'leg:' || (r.id IS NOT NULL) FROM public.record_insurance_transaction("
                f"'{t2}', '{c2}', {hand_number}, '{RP1}', 20, 1.00, 10, 0, false, 'insurance') r;\n"
                f"UPDATE table_seats SET stack = stack - 1.00 WHERE table_id = '{t2}';\n")
    first = spawn(db, leg(1))
    check('hand bank race: the first session holds its new bank row', first.stdout.readline().strip() == 'leg:true')
    second = spawn(db, leg(2) + 'COMMIT;\n')
    time.sleep(1.0)
    check('hand bank race: the second session waits for the first one\'s row', second.poll() is None)
    send(first, 'COMMIT;\n')
    first_result = finish(first)
    second_result = finish(second)
    check('hand bank race: two first insurance legs for a union with no bank row merge, as the old upsert did',
          first_result[0] == 0 and second_result[0] == 0 and 'leg:true' in second_result[1]
          and run(db, f"SELECT count(*) || '|' || sum(insurance_wallet) FROM union_wallets WHERE union_id = '{u2}'")
          == '1|2.00'
          and run(db, f"SELECT count(*) FROM insurance_transactions WHERE union_id = '{u2}'") == '2'
          and run(db, 'SELECT count(*) FROM ca_ledger_invariant_findings') == '0',
          {'first': first_result, 'second': second_result})
    refused = subprocess.run(list(map(str, psql(db))), text=True, capture_output=True, env=env,
                             input="BEGIN;\nSELECT public.record_insurance_transaction("
                                   "'c0000000-0000-0000-0000-0000000000a1', '" + RC + "', 9001, '" + RP1
                                   + "', 20, 0, 10, 99999, true, 'insurance');\nROLLBACK;\n")
    check('hand bank race: a payout the bank row cannot cover is still refused by the CHECK',
          refused.returncode != 0 and 'union_wallets_insurance_wallet_nonneg' in refused.stderr, refused.stderr[-300:])


INS_STUBS = """
ALTER TABLE union_wallet_transactions ADD COLUMN period_id uuid, ADD COLUMN created_by uuid;
CREATE FUNCTION fn_ca_union_wallet_ledger_shape(p_tx_type text, OUT category text, OUT counterparty text)
LANGUAGE sql AS $$ SELECT 'withdrawal'::text, 'system_mint'::text $$;
CREATE FUNCTION fn_ca_declare_ledger(p_category text, p_counterparty text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('app.ledger_category', p_category, true), set_config('app.ledger_counterparty', p_counterparty, true);
  SELECT NULL::void $$;
"""


def insurance_database(db):
    fixture = json.loads(RAKE_FIXTURE.read_text())
    extra = json.loads(BANK_FIXTURE.read_text())
    bank_database(db, fixture, extra)
    run(db, (MIGRATIONS / BANK_PART1).read_text())
    run(db, (MIGRATIONS / BANK_SWITCH).read_text())
    run(db, INS_STUBS)


def payout_hand(n, table, number):
    # A net payout of 8.00 from the union's insurance bank (which holds 10.00).
    return ('f1000000-0000-0000-0000-00000000000' + str(n), table, number, '1.00', '0.50', '20.00',
            {RP1: 10.0, RP2: 10.0}, [('0.00', '8.00')])


ENVELOPE_SQL = "SELECT public.fn_ca_process_hand_post_commit_obligations('{}')"
DEBIT_SQL = (f"SELECT public.fn_union_debit_wallet_zd3core('{RU}', 'insurance', 10, 'withdrawal', NULL, NULL, "
             "'operator debit', NULL)")


def prove_insurance_payouts_never_overcommit_the_bank():
    """The envelope's coverage check, the bank's debit door and the banker
    decide one at a time per union ('insurance-bank:' lock). A payout that
    loses the race is refused AT THE ENVELOPE, never stored to fail later."""
    deadlocks_before = deadlocks()
    # 1. The operator's debit decides first; the envelope finds it busy, then refuses on the committed balance.
    insurance_database('insdoor')
    h = payout_hand(1, RT1, 801)
    bank_accept('insdoor', h)
    door = spawn('insdoor', 'BEGIN;\n' + DEBIT_SQL + ";\n")
    first = json.loads(door.stdout.readline())
    check('hand bank insurance: the operator debit holds the bank', first.get('success') is True, first)
    started = time.monotonic()
    busy = subprocess.run(list(map(str, psql('insdoor'))), text=True, capture_output=True, env=env,
                          input=ENVELOPE_SQL.format(h[0]) + ';')
    check('hand bank insurance: the envelope never waits for the bank, it is told busy',
          busy.returncode != 0 and 'is busy deciding another payout or debit' in busy.stderr
          and time.monotonic() - started < 1.0, busy.stderr[-300:])
    send(door, 'COMMIT;\n')
    finish(door)
    again = subprocess.run(list(map(str, psql('insdoor'))), text=True, capture_output=True, env=env,
                           input=ENVELOPE_SQL.format(h[0]) + ';')
    check('hand bank insurance: debit first, then the payout is refused at the envelope (nothing stored to fail later)',
          again.returncode != 0 and 'exceeds the union insurance bank' in again.stderr
          and run('insdoor', 'SELECT count(*) FROM hand_bank_obligation_pending') == '0'
          and run('insdoor', f"SELECT round(insurance_wallet, 2) FROM union_wallets WHERE union_id = '{RU}'") == '0.00',
          again.stderr[-300:])
    check('hand bank insurance: the refused hand is a stranded envelope, as before #11256 (the watchdog pages it)',
          run('insdoor', f"SELECT post_commit_completed_at IS NULL FROM hand_atomic_commits WHERE hand_id = '{h[0]}'")
          == 't')

    # 2. The envelope decides first; the operator debit waits for it and then sees the stored payout reserved.
    insurance_database('insenv')
    h = payout_hand(2, RT1, 802)
    bank_accept('insenv', h)
    env1 = spawn('insenv', 'BEGIN;\n' + ENVELOPE_SQL.format(h[0]) + ";\n")
    stored = json.loads(env1.stdout.readline())
    check('hand bank insurance: the envelope stores the payout and holds the bank decision',
          stored.get('ok') is True and stored.get('insurance') == 1, stored)
    debit = spawn('insenv', DEBIT_SQL + ';\n')
    time.sleep(1.0)
    check('hand bank insurance: the operator debit waits for the envelope deciding the same bank',
          debit.poll() is None)
    send(env1, 'COMMIT;\n')
    finish(env1)
    status, out, err = finish(debit)
    refused = json.loads(out) if status == 0 and out else {}
    check('hand bank insurance: payout first, then the debit sees it reserved and is refused',
          refused.get('success') is False and refused.get('error') == 'insufficient balance'
          and float(refused.get('reserved_for_pending_payouts', 0)) == 8.0, {'out': out, 'err': err[-300:]})
    banked = json.loads(run('insenv', f"SELECT public.fn_ca_bank_pending_hand_obligations('{h[0]}')"))
    check('hand bank insurance: the stored payout banks',
          banked.get('status') == 'banked'
          and run('insenv', f"SELECT round(insurance_wallet, 2) FROM union_wallets WHERE union_id = '{RU}'") == '2.00', banked)

    # 3. Two tables each pay 8.00 against a 10.00 bank: the second is refused at its envelope.
    insurance_database('instwo')
    ha, hb = payout_hand(3, RT1, 803), payout_hand(4, RT2, 804)
    bank_accept('instwo', ha)
    bank_accept('instwo', hb)
    env_a = spawn('instwo', 'BEGIN;\n' + ENVELOPE_SQL.format(ha[0]) + ";\n")
    check('hand bank insurance: table 1 stores its payout', json.loads(env_a.stdout.readline()).get('ok') is True)
    started = time.monotonic()
    busy = subprocess.run(list(map(str, psql('instwo'))), text=True, capture_output=True, env=env,
                          input=ENVELOPE_SQL.format(hb[0]) + ';')
    check('hand bank insurance: table 2 is told busy at once, not made to wait',
          busy.returncode != 0 and 'is busy deciding' in busy.stderr and time.monotonic() - started < 1.0,
          busy.stderr[-300:])
    send(env_a, 'COMMIT;\n')
    finish(env_a)
    again = subprocess.run(list(map(str, psql('instwo'))), text=True, capture_output=True, env=env,
                           input=ENVELOPE_SQL.format(hb[0]) + ';')
    check('hand bank insurance: table 2 is refused at its envelope, the bank is never overcommitted',
          again.returncode != 0 and 'exceeds the union insurance bank' in again.stderr
          and run('instwo', "SELECT count(*), round(sum(felt_amount), 2) FROM hand_bank_obligation_pending WHERE kind = 'insurance'") == '1|-8.00',
          again.stderr[-300:])
    banked = json.loads(run('instwo', f"SELECT public.fn_ca_bank_pending_hand_obligations('{ha[0]}')"))
    check('hand bank insurance: the one stored payout banks, and none of these runs deadlocked',
          banked.get('status') == 'banked' and deadlocks() == deadlocks_before
          and run('instwo', f"SELECT round(insurance_wallet, 2) FROM union_wallets WHERE union_id = '{RU}'") == '2.00', banked)


try:
    command(as_owner + [pg / 'initdb', '-D', cluster / 'data', '-A', 'trust', '-U', 'postgres'])
    command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-o',
                        f"-k {sock} -p {PORT} -c listen_addresses='' -c deadlock_timeout=200ms",
                        '-l', LOG, '-w', 'start'])
    run('postgres', ROLES)
    for db in ('bbj', 'proj', 'sat'):
        run('postgres', f'CREATE DATABASE {db}')
    for db in ('bbj', 'proj', 'sat'):
        run(db, COMMON)
    run('bbj', BBJ_SCHEMA)
    run('proj', PROJ_SCHEMA)
    run('sat', SAT_SCHEMA)

    # ---- bbj ------------------------------------------------------------
    load_live('bbj', 'bbj')
    n, h, s = bbj_round('bbj')
    check('bbj: the live sweep deadlocks with the hand path', n >= 1, {'deadlocks': n, 'hand': h, 'sweep': s})
    # Reset the pool and wallet to the same starting point.
    run('bbj', f"UPDATE bbj_pools SET promo_balance = 37.25 WHERE id = '{POOL}'; "
               f"UPDATE union_wallets SET promo_wallet = 0 WHERE union_id = '{U}'; "
               "DELETE FROM union_wallet_transactions; UPDATE unions SET promo_funded_from_bbj = 0;")
    apply_candidate('bbj', 'bbj')
    n, h, s = bbj_round('bbj')
    sweep_result = json.loads(s[1]) if s[0] == 0 and s[1] else None
    check('bbj: after the fix the same interleaving does not deadlock', n == 0 and h[0] == 0 and s[0] == 0,
          {'deadlocks': n, 'hand': h, 'sweep': s})
    check('bbj: the busy pool is left for the next run, not counted as an error',
          sweep_result is not None and sweep_result.get('busy_retry_next_run') == 1
          and sweep_result.get('errors') == 0 and sweep_result.get('pools_swept') == 0, sweep_result)
    check('bbj: the promo slice is still in the pool',
          run('bbj', f"SELECT promo_balance FROM bbj_pools WHERE id = '{POOL}'") == '37.25')
    nxt = json.loads(run('bbj', 'SELECT public.fn_sweep_bbj_promo_all()'))
    money = run('bbj', f"SELECT (SELECT promo_wallet FROM union_wallets WHERE union_id = '{U}') || '|' || "
                       f"(SELECT promo_balance FROM bbj_pools WHERE id = '{POOL}') || '|' || "
                       f"(SELECT promo_funded_from_bbj FROM unions WHERE id = '{U}') || '|' || "
                       "(SELECT count(*) FROM union_wallet_transactions)")
    check('bbj: the next run sweeps exactly the same amount to the same wallet',
          nxt.get('pools_swept') == 1 and money == '37.25|0|37.25|1', {'next': nxt, 'money': money})

    # ---- proj -----------------------------------------------------------
    load_live('proj', 'proj')
    n, r1, r2 = proj_round('proj', 1)
    check('proj: the live projection deadlocks between its passes', n >= 1, {'deadlocks': n, 's1': r1, 's2': r2})
    run('proj', f"UPDATE player_stats SET hands_dealt = 0, total_losses = 0; DELETE FROM hand_projection_outbox;")
    apply_candidate('proj', 'proj')
    n, r1, r2 = proj_round('proj', 2)
    check('proj: after the fix two hands sharing players do not deadlock',
          n == 0 and r1[0] == 0 and r2[0] == 0, {'deadlocks': n, 's1': r1, 's2': r2})
    stats = run('proj', "SELECT string_agg(user_id || ':' || hands_dealt || ':' || total_losses, ',' ORDER BY user_id) "
                        "FROM player_stats")
    check('proj: both hands wrote every pass exactly once', stats == f'{A}:2:1,{B}:2:1', stats)

    prove_projection_transaction_boundary('proj')

    # ---- cash rake pending ---------------------------------------------
    prove_cash_rake_never_waits_on_the_union_wallet()

    # ---- hand bank obligations ------------------------------------------
    prove_hand_bank_never_waits_on_the_union_pool()
    prove_bad_obligations_still_fail_the_envelope()
    prove_first_insurance_legs_still_merge()
    prove_insurance_payouts_never_overcommit_the_bank()

    # ---- sat ------------------------------------------------------------
    load_live('sat', 'sat')
    n, r, b = sat_round('sat', 1)
    check('sat: the live board deadlocks with a feeder registration', n >= 1, {'deadlocks': n, 'reg': r, 'board': b})
    apply_candidate('sat', 'sat')
    n, r, b = sat_round('sat', 2)
    check('sat: after the fix the registration commits and the board answers',
          n == 0 and r[0] == 0 and 'registration-done' in r[1] and b[0] == 0 and b[1] == 'existing_active',
          {'deadlocks': n, 'reg': r, 'board': b})
    check('sat: the board still refuses a writer to the target while it decides',
          run('sat', "SELECT 'FOR NO KEY UPDATE' = substring(pg_get_functiondef("
                     "'public.fn_ensure_scheduled_mtt_satellite(jsonb)'::regprocedure) "
                     "FROM 'v_row.satellite_target_id (FOR NO KEY UPDATE);')") == 't')
    results['passed'] = True
finally:
    try:
        command(as_owner + [pg / 'pg_ctl', '-D', cluster / 'data', '-m', 'immediate', 'stop'])
    except Exception:
        pass
    (out / 'RESULTS.json').write_text(json.dumps(results, indent=2) + '\n')

print(json.dumps(results, indent=2))
