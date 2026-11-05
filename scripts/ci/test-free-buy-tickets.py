#!/usr/bin/env python3
"""Private PostgreSQL rehearsal of the 2026-11-05 Free Buy ticket and cutoff rules.

No production URL is accepted. The rotation fixture (captured live preimages,
md5-checked, plus the captured accounting triggers over a synthetic schema) is
built exactly as scripts/ci/test-midway-free-buy-rotation.py builds it and the
rotation migration is installed, which reproduces production's current
definitions of every function the candidate replaces (asserted by md5). Then
pre-ticket registrations are written, the EXACT candidate migration runs, and
cases.sql plus the concurrency cases below exercise every rule.
"""
from pathlib import Path
import json, os, re, shutil, subprocess, tempfile, time, threading

ROOT = Path(__file__).resolve().parents[2]
ROT = ROOT / 'scripts/ci/fixtures/midway-free-buy-rotation'
FIX = ROOT / 'scripts/ci/fixtures/free-buy-tickets'
MIGS = ROOT / 'supabase/migrations'
ROTATION = MIGS / '20261105035220_midway_free_buy_rotation_formats_and_promo_funded_entries.sql'
CANDIDATE = MIGS / '20261105204917_free_buy_tickets_and_guarantees_fund_at_the_final_cutoff.sql'
WATCH = MIGS / '20261105204918_midway_free_buy_watch_reads_the_schedule_not_event_ids.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='free-buy-tickets-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(36000 + (os.getpid() + 7) % 10000)
started = False

# Production md5s (read 2026-11-05) of the definitions the candidate guards.
LIVE = {
    'fn_ca_midway_free_buy_promo_head(uuid,uuid,boolean)': '06d23281112741c264d32ad820016914',
    'fn_register_for_tournament_before_atomic_capacity_20260907(uuid,boolean)': '6663ababb3cb55bdac1ada33492c281f',
    'fn_register_horse_for_tournament_before_maintenance_gate(uuid,uuid)': 'bc2a3c2c25cb278b4d3b96684fdb9607',
    'fn_apply_prize_guarantee(uuid,text)': '8a2517fe8bdbff92348821650c418507',
}


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def psql_args(db):
    return [PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', db]


def query(db, sql, timeout=120):
    return run(psql_args(db), sql, timeout)


def must_fail(db, sql, needle):
    try:
        query(db, sql)
    except RuntimeError as error:
        assert needle in str(error), str(error)
        return str(error)
    raise AssertionError('expected a refusal containing %r' % needle)


try:
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    query('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
    query('postgres', 'CREATE DATABASE tickets')
    db = 'tickets'
    # ── the rotation fixture, exactly as its own runner builds it ──────────────
    setup = """CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULLIF(current_setting('fixture.uid',true),'')::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 """ + (ROT / 'schema.sql').read_text() + """
 ALTER TABLE tournament_escrow ADD PRIMARY KEY(tournament_id);
 ALTER TABLE chip_ledger ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON chip_ledger(idempotency_key);
 ALTER TABLE tournaments ADD PRIMARY KEY(id); ALTER TABLE union_wallets ADD UNIQUE(union_id);
 ALTER TABLE tournament_players ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON tournament_players(tournament_id,user_id);
 CREATE TABLE ca_ledger_invariant_store_mode(store text,mode text);
 CREATE TABLE ca_ledger_invariant_mode(mode text); INSERT INTO ca_ledger_invariant_mode VALUES('refuse');
 """
    setup += '\n'.join(v for k, v in json.loads((ROT / 'accounting-functions.json').read_text()).items()
                       if k != 'fn_ca_tournament_purchase_fee_ratio')
    query(db, setup)
    pre = json.loads((ROT / 'preimages.json').read_text())
    query(db, 'SET check_function_bodies=off;' + ';\n'.join(p['definition'] for p in pre) + ';')
    query(db, (ROT / 'stubs.sql').read_text() + """
 CREATE TRIGGER mystery_contract BEFORE INSERT OR UPDATE OF is_mystery_bounty, mystery_bounty_profile, mystery_bounty_activation, mystery_bounty_activation_value, mystery_bounty_pool_percent, mystery_bounty_regular_pool_percent, mystery_bounty_top_percent ON tournaments FOR EACH ROW EXECUTE FUNCTION fn_guard_tournament_mystery_creation_contract();
 CREATE TRIGGER zz_freerolls_are_free_buy BEFORE INSERT OR UPDATE OF buy_in_amount, buy_in_fee, tournament_type, variant, is_rebuy, add_on_available, rebuy_cost, addon_cost, rebuy_chips, addon_chips, rebuy_levels, addon_levels, max_rebuys ON tournaments FOR EACH ROW WHEN ((COALESCE(new.buy_in_amount, (0)::numeric) = (0)::numeric)) EXECUTE FUNCTION fn_freerolls_are_free_buy();
 CREATE TRIGGER zzzz_freeze_registered_tournament_settlement_contract BEFORE UPDATE OF variant, tournament_type, satellite_target_id, bubble_protection, buy_in_amount, guaranteed_prize ON tournaments FOR EACH ROW EXECUTE FUNCTION trg_freeze_registered_tournament_settlement_contract();
 CREATE TRIGGER aa_ca_capture_tournament_charge_entitlement AFTER INSERT ON chip_ledger FOR EACH ROW WHEN (((new.tournament_id IS NOT NULL) AND (new.from_type = 'player_wallet'::text) AND (new.to_type = 'prize_liability'::text))) EXECUTE FUNCTION fn_ca_capture_tournament_charge_entitlement();
 CREATE TRIGGER zz_ca_escrow_wallet_tx AFTER INSERT ON wallet_transactions FOR EACH ROW WHEN ((new.related_entity_id IS NOT NULL)) EXECUTE FUNCTION fn_ca_escrow_on_wallet_tx();
 CREATE TRIGGER actor BEFORE INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION enforce_chip_ledger_performed_by();
 CREATE TRIGGER balance_tally AFTER UPDATE ON union_wallets FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
 CREATE TRIGGER member_tally AFTER UPDATE ON club_members FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_balance_move();
 CREATE TRIGGER escrow_tally AFTER UPDATE ON tournament_escrow FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_store_move();
 CREATE TRIGGER ledger_tally AFTER INSERT ON chip_ledger FOR EACH ROW EXECUTE FUNCTION fn_ca_tally_ledger_leg();
 CREATE CONSTRAINT TRIGGER money_invariant AFTER INSERT ON chip_ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_ca_balance_has_its_ledger_row();
 GRANT USAGE ON SCHEMA public,auth TO service_role;
 GRANT SELECT,UPDATE,INSERT ON ALL TABLES IN SCHEMA public TO service_role;
 """)
    query(db, (ROT / 'opening.sql').read_text())
    query(db, "INSERT INTO ca_money_rpc_registry(proname,status,notes) VALUES('fn_ca_process_tournament_chip_purchase_money_v1','system','production row'),('fn_ca_tournament_escrow_chips','system','production row');")
    guard = (MIGS / '20260911160817_a_money_writing_function_is_registered_before_it_exists.sql').read_text()
    parts = []
    for name in ['fn_ca_money_rpc_balance_columns', 'fn_ca_money_rpc_writes_balances', 'fn_ca_money_rpc_registry_guard']:
        match = re.search(r'CREATE OR REPLACE FUNCTION public\.' + name + r'\(.*?AS (\$[a-z_]*\$).*?\1;', guard, re.S)
        assert match, name
        parts.append(match.group(0))
    query(db, '\n'.join(parts) + '''
 CREATE EVENT TRIGGER ab_ca_money_rpc_registered ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION')
 EXECUTE FUNCTION public.fn_ca_money_rpc_registry_guard();''')
    query(db, ROTATION.read_text())
    # ── this rehearsal's collaborators and production's guarantee entry point ─
    query(db, (FIX / 'stubs.sql').read_text())
    query(db, ';\n'.join(p['definition'] for p in json.loads((FIX / 'preimages.json').read_text())) + ';')
    for sig, md5 in LIVE.items():
        got = query(db, f"SELECT md5(pg_get_functiondef('public.{sig}'::regprocedure))").strip()
        assert got == md5, (sig, got, md5)
    print('PASS: every definition the candidate replaces reproduces its production md5 here', flush=True)
    query(db, (FIX / 'legacy.sql').read_text())
    print('PASS: pre-ticket registrations written under the rotation-era 1-chip promo funding', flush=True)

    began = time.monotonic()
    query(db, CANDIDATE.read_text())
    took = time.monotonic() - began
    assert took < 8, took
    print('PASS: exact candidate migration installed in %.2fs' % took, flush=True)

    print(query(db, (FIX / 'cases.sql').read_text(), timeout=300), flush=True)

    # A guaranteed Free Buy counts the players' FULL payments toward G (owner
    # 2026-11-05): bounty and rake shares count in C, only the prize share is
    # in the pool. 160 paid = 120 prize + 30 bounty + 10 rake against 500:
    # U = 340 (not 380), P = 120 + 340 = 460; at C >= G the sponsor adds 0.
    got = query(db, """SELECT string_agg(prize_pool||'/'||promo_support, ' ' ORDER BY k) FROM (
      SELECT 1 k, * FROM fn_ca_free_buy_cutoff_terms(500, 120, 250, 1, 160)
      UNION ALL SELECT 2, * FROM fn_ca_free_buy_cutoff_terms(500, 390, 250, 1, 520)
      UNION ALL SELECT 3, * FROM fn_ca_free_buy_cutoff_terms(500, 160, 250, 1, NULL)
      UNION ALL SELECT 4, * FROM fn_ca_free_buy_cutoff_terms(0, 120, 250, 1, 160)) x""").strip()
    assert got == '460.00/340.00 390.00/0 500.00/340.00 370.00/250.00', got
    must_fail(db, "SELECT * FROM fn_ca_free_buy_cutoff_terms(500, 200, 0, 1, 150)", 'finite non-negative')
    print('PASS: guaranteed Free Buy: C is the full payment (160 = 120 prize + 30 bounty + 10 rake -> U 340, P 460; 520 -> U 0); '
          'non-guaranteed still P = V + c, U = V', flush=True)

    # ── concurrency: real separate sessions ────────────────────────────────────
    def session(sql, out, key):
        try:
            out[key] = ('ok', query(db, sql, timeout=60))
        except RuntimeError as error:
            out[key] = ('error', str(error))

    # (a) The same player registers for the same Free Buy from two sessions at once.
    query(db, "SELECT fixture_event('50000000-0000-0000-0000-0000000000c1','Morning Free Buy (NLH)','regular','2026-11-22 08:30 America/Chicago');")
    reg = lambda u: f"BEGIN; SELECT pg_sleep(0.3); SELECT fixture_register('50000000-0000-0000-0000-0000000000c1','{u}'); COMMIT;"
    out = {}
    threads = [threading.Thread(target=session, args=(reg('40000000-0000-0000-0000-000000000201'), out, i)) for i in range(2)]
    [t.start() for t in threads]; [t.join() for t in threads]
    wins = [k for k, v in out.items() if v[0] == 'ok']
    assert len(wins) == 1, out
    got = query(db, """SELECT (SELECT count(*) FROM tournament_players WHERE tournament_id='50000000-0000-0000-0000-0000000000c1')||','||
      (SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE tournament_id='50000000-0000-0000-0000-0000000000c1')||','||
      (SELECT count(*) FROM ca_free_buy_ticket_events WHERE tournament_id='50000000-0000-0000-0000-0000000000c1')""").strip()
    assert got == '1,1,1', got
    print('PASS: two simultaneous registrations of one player create one entry, one redemption, one history row', flush=True)

    # (b) A player with one ticket left registers for two Free Buys at once: one wins.
    query(db, """SELECT fixture_event(('50000000-0000-0000-0000-0000000000d'||g)::uuid,'Morning Free Buy (NLH)','regular',
                   '2026-11-23 08:30 America/Chicago'::timestamptz+make_interval(hours=>g)) FROM generate_series(1,6) g;
                 SELECT fixture_register(('50000000-0000-0000-0000-0000000000d'||g)::uuid,'40000000-0000-0000-0000-000000000202')
                   FROM generate_series(1,4) g;""")
    out = {}
    threads = [threading.Thread(target=session, args=(
        f"BEGIN; SELECT pg_sleep(0.3); SELECT fixture_register('50000000-0000-0000-0000-0000000000d{g}','40000000-0000-0000-0000-000000000202'); COMMIT;",
        out, g)) for g in (5, 6)]
    [t.start() for t in threads]; [t.join() for t in threads]
    wins = [k for k, v in out.items() if v[0] == 'ok']
    assert len(wins) == 1, out
    assert any('free_buy_ticket_unavailable' in v[1] for v in out.values() if v[0] == 'error'), out
    got = query(db, """SELECT count(*) FROM ca_free_buy_ticket_redemptions WHERE user_id='40000000-0000-0000-0000-000000000202'
      AND status='redeemed' AND kind='ticket' AND ticket_day='2026-11-23'""").strip()
    assert got == '5', got
    print('PASS: the fifth ticket is spent once when two registrations race for it', flush=True)

    # (c) A registration arrives while the final funding transaction is open. It
    # waits on the event row and is refused once the pool is finalized; the
    # cutoff counted exactly the entries that existed, and moved promo once.
    query(db, """SELECT fixture_event('50000000-0000-0000-0000-0000000000e1','Morning Free Buy (NLH)','regular','2026-11-24 08:30 America/Chicago');
      SELECT fixture_register('50000000-0000-0000-0000-0000000000e1',('40000000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid) FROM generate_series(210,212) g;
      UPDATE tournaments SET status='RUNNING',started_at=now(),current_level=4 WHERE id='50000000-0000-0000-0000-0000000000e1';
      -- The door's own late-registration read still says open (a request that
      -- passed it just before the close), so the race is decided where it is
      -- in production: at the event row, by the finalized-entry refusal.
      CREATE OR REPLACE FUNCTION public.fn_tournament_late_registration_open(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
      CREATE OR REPLACE FUNCTION public.fn_seat_late_registrant(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;""")
    before = query(db, "SELECT promo_wallet FROM union_wallets").strip()
    out = {}
    a = threading.Thread(target=session, args=(
        "BEGIN; SELECT fn_apply_prize_guarantee('50000000-0000-0000-0000-0000000000e1','fixture'); SELECT pg_sleep(1.5); COMMIT;", out, 'cutoff'))
    a.start(); time.sleep(0.5)
    began = time.monotonic()
    session("SELECT fixture_register('50000000-0000-0000-0000-0000000000e1','40000000-0000-0000-0000-000000000213');", out, 'late')
    waited = time.monotonic() - began
    a.join()
    assert out['cutoff'][0] == 'ok', out
    assert out['late'][0] == 'error' and 'prize pool is finalized' in out['late'][1], out
    assert waited > 0.5, waited
    got = query(db, """SELECT valid_tickets||','||prize_pool||','||promo_support||','||moved FROM ca_free_buy_cutoff_fundings
      WHERE tournament_id='50000000-0000-0000-0000-0000000000e1'""").strip()
    assert got == '3,250.00,250.00,250.00', got
    after = query(db, "SELECT promo_wallet FROM union_wallets").strip()
    assert float(before) - float(after) == 250, (before, after)
    print('PASS: a registration racing the final funding waits, is refused after finalization, and is not counted (waited %.2fs)' % waited, flush=True)

    # ── the watch reads the schedule, not event ids ─────────────────────────────
    watch_sql = WATCH.read_text()
    m = re.search(r'CREATE OR REPLACE FUNCTION public\.fn_ca_midway_free_buy_slot_format\(.*?\$f\$;', watch_sql, re.S)
    w = re.search(r'CREATE OR REPLACE FUNCTION public\.fn_sp_midway_free_buy_watch\(.*?\$function\$;', watch_sql, re.S)
    assert m and w
    assert not re.search(r"'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'::uuid\s*,?\s*--", w.group(0))
    query(db, m.group(0) + '\n' + w.group(0))
    items = json.loads(query(db, "SELECT fn_sp_midway_free_buy_watch('2026-11-20 06:00 America/Chicago')").strip())
    assert isinstance(items, list), items
    rules = {i['rule'] for i in items}
    assert rules <= {'midway_free_buy_missing', 'midway_free_buy_wrong_format', 'midway_free_buy_wrong_settings', 'midway_promo_runway_low'}, rules
    print('PASS: the Free Buy watch runs from the schedule and names no event (%d items)' % len(items), flush=True)

    # ── a second install changes nothing ───────────────────────────────────────
    must_fail(db, CANDIDATE.read_text(), 'Inspected definition changed')
    print('PASS: a second install is refused by its preimage guards', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
