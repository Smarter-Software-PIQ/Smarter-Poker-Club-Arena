#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261108215333 (horses are refunded exactly as humans).

Owner hard rule, Dan, 2026-11-08: "HORSES GET REFUNDED EXACTLY THE SAME AS A HUMAN
100% OF THE TIME!" The exact migration bytes run over the captured production
preimage of smarter_private.owner_retirement_transfer_pools and over the pinned
production rows it was written against (scripts/ci/fixtures/horse-refund-parity/,
read only on 2026-11-08: 114 events, 2,224 paid wallet charges, 4 owner credits).

This proves:
  * the defect first: the PREIMAGE lets a horse-only event's custody move while
    every horse's paid entry is unrefunded (it only asked about humans);
  * the fix: the replacement refuses that same event with
    owner_retirement_unrefunded_entry, never reads horse identity, and passes
    once every charge has a refund receipt;
  * install refuses a changed preimage;
  * the back-refund previews 2,220 charges / 17,931.00 and moves nothing at 0;
  * every refusal moves nothing: a changed pinned set, an already-refunded
    entitlement that changes the owed set, a charge that is not a player-wallet
    debit, a prior partial refund (it subtracts, never pays past the charge),
    the break window, a frozen platform, an unbounded caller and a non-operator;
  * the payment: in batches of 10, every charge exactly once to the exact club
    wallet charged, Midway Main Bank conserved to the chip, one adjustment, one
    journal leg, one wallet receipt and one immutable receipt per charge; credits
    on split-departed horse records go on to their club bank by the existing
    club-split trigger;
  * the replay: a further call pays nothing and moves nothing; receipts are immutable.
"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261108215333_horses_are_refunded_exactly_as_humans.sql'
FX = ROOT / 'scripts/ci/fixtures/horse-refund-parity'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='horse-parity-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 113) % 9000)
started = False
UNION = 'fade0000-0000-0000-0000-000000000001'
BANK0 = '146630676.83'


def run(args, sql=None, timeout=300):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        log = work / 'postgres.log'
        raise RuntimeError(r.stderr + (log.read_text()[-2000:] if 'pg_ctl' in str(args[0]) and log.exists() else ''))
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql)


def one(sql):
    return q(sql).strip()


def must_fail(sql, needle):
    try:
        q(sql)
    except RuntimeError as error:
        assert needle in str(error), 'expected %r, got: %s' % (needle, error)
        return
    raise AssertionError('expected a refusal containing %r' % needle)


SCHEMA = r"""
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
CREATE TABLE public.fx_switch(k text PRIMARY KEY, v text);
INSERT INTO public.fx_switch VALUES ('role',NULL),('frozen','false'),('clock','2026-11-09 00:20:00+00');
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT v FROM public.fx_switch WHERE k='role' $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT v::boolean FROM public.fx_switch WHERE k='frozen' $$;
CREATE FUNCTION smarter_private.bulk_closure_clock() RETURNS timestamptz LANGUAGE sql AS $$ SELECT v::timestamptz FROM public.fx_switch WHERE k='clock' $$;
CREATE FUNCTION public.fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION smarter_private.cancellation_lane(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION smarter_private.assert_tournament_abort_quiesced(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION smarter_private.owner_manual_refund_receipt(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
CREATE FUNCTION smarter_private.owner_retirement_bank_refund_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 RAISE EXCEPTION 'owner_retirement_bank_refund_receipt_is_immutable' USING ERRCODE='55000';END$$;

CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, is_horse boolean, status text DEFAULT 'active');
CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text, union_id uuid, chip_treasury numeric(15,2) DEFAULT 0);
CREATE TABLE public.club_members(user_id uuid, club_id uuid, chip_balance numeric(15,2), membership_lifecycle_status text,
  updated_at timestamptz, PRIMARY KEY(user_id, club_id));
CREATE TABLE public.union_wallets(id uuid DEFAULT gen_random_uuid(), union_id uuid PRIMARY KEY, chip_balance numeric(15,2), updated_at timestamptz);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, name text, status text, union_id uuid, club_id uuid, started_at timestamptz);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid);
CREATE TABLE public.tournament_obligations(tournament_id uuid, amount_owed numeric, amount_paid numeric);
CREATE TABLE public.tournament_refund_entitlements(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, entitlement_kind text,
  charge_category text, refund_wallet_club_id uuid, gross numeric(15,2), refund_prize numeric(15,2), refund_bounty numeric(15,2),
  refund_fee numeric(15,2), source_ledger_id uuid);
CREATE TABLE public.tournament_refund_tranches(entitlement_id uuid, amount_paid_now numeric, credit_ledger_id uuid);
CREATE TABLE public.tournament_tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_refund_entitlement_id uuid);
CREATE TABLE public.poker_diamond_lot_reservations(custody_id uuid, released_at timestamptz, amount numeric, consumed numeric);
CREATE TABLE public.poker_diamond_custody(id uuid, target_id uuid);
CREATE TABLE public.chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), from_type text, from_entity_id uuid, to_type text,
  to_entity_id uuid, amount numeric(15,2), category text, club_id uuid, tournament_id uuid, idempotency_key text, correlation_id uuid,
  created_at timestamptz DEFAULT now());
CREATE TABLE public.wallet_credit_idempotency(key text PRIMARY KEY, user_id uuid, amount numeric(15,2));
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, wallet_type text, amount numeric(15,2),
  type text, category text, description text, related_entity_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ca_manual_adjustments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor uuid, actor_label text, approver uuid,
  approver_label text, reason text, amount numeric(15,2), target_kind text, target_id uuid, tournament_id uuid, status text,
  approved_at timestamptz, decision_note text, asset text);
CREATE TABLE public.split_late_returns(club_id uuid, horse_id uuid, amount numeric(15,2));
CREATE TABLE smarter_private.owner_tournament_deletion_intents(tournament_id uuid PRIMARY KEY, original_started_at timestamptz,
  asset text, destination_id uuid, owner_chat_id uuid, requested_at timestamptz DEFAULT now());
CREATE TABLE smarter_private.owner_retirement_pool_transfers(tournament_id uuid PRIMARY KEY);
CREATE TABLE smarter_private.owner_retirement_manual_refunds(entitlement_id uuid PRIMARY KEY, tournament_id uuid, user_id uuid,
  credit_ledger_id uuid, amount numeric);
CREATE TABLE smarter_private.owner_retirement_bank_refunds(entitlement_id uuid PRIMARY KEY, tournament_id uuid, receipt jsonb);

-- The production checks of the audited 10.9 door, verbatim in substance.
CREATE FUNCTION public.fn_ca_adjustment_under_10_9(p_tournament_id uuid, p_user_id uuid, p_amount numeric, p_reason text,
  p_migration text, p_actor_label text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (current_user IN ('postgres','supabase_admin') OR COALESCE(auth.role(),'')='service_role') THEN
    RAISE EXCEPTION 'fn_ca_adjustment_under_10_9 is service only'; END IF;
  IF length(btrim(COALESCE(p_reason,''))) < 200 THEN RAISE EXCEPTION 'a 10.9 adjustment carries the paragraph'; END IF;
  IF COALESCE(p_migration,'') !~ '^\d{14}_[a-z0-9_]+$' THEN RAISE EXCEPTION 'a 10.9 adjustment names the migration'; END IF;
  IF p_reason NOT LIKE '%' || p_migration || '%' THEN RAISE EXCEPTION 'the reason must name the migration'; END IF;
  INSERT INTO public.ca_manual_adjustments(actor, actor_label, approver, approver_label, reason, amount, target_kind, target_id,
    tournament_id, status, approved_at, decision_note, asset)
  VALUES ('00000000-0000-0000-0000-00000000c1a9', p_actor_label, '2d1cd6c3-5700-4af9-a271-d4863fdab20d', 'Dan, 10.9',
    btrim(p_reason), round(p_amount,2), 'player_wallet', p_user_id, p_tournament_id, 'approved', now(), 'migration ' || p_migration, 'chips')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE FUNCTION public.fn_ca_declare_ledger(p_category text, p_counterparty text, p_counterparty_entity uuid, p_settlement_id uuid,
  p_idempotency_key text, p_autoskip_tables text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  PERFORM set_config('app.ledger_category', p_category, true);
  PERFORM set_config('app.ledger_counterparty', p_counterparty, true);
  PERFORM set_config('app.ledger_counterparty_entity', COALESCE(p_counterparty_entity::text,''), true);
  PERFORM set_config('app.ledger_idempotency_key', p_idempotency_key, true);
  FOREACH t IN ARRAY COALESCE(p_autoskip_tables, ARRAY[]::text[]) LOOP PERFORM set_config('app.ledger_autoskip_'||t,'1',true); END LOOP;
END $$;
CREATE FUNCTION public.log_wallet_transaction(p_user_id uuid, p_wallet_type text, p_amount numeric, p_type text, p_category text,
  p_description text, p_table uuid, p_hand uuid, p_related uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.wallet_transactions(user_id, wallet_type, amount, type, category, description, related_entity_id)
  VALUES (p_user_id, p_wallet_type, p_amount, p_type, p_category, p_description, p_related) $$;
-- Stand-in for the club_members autoledger: one journal leg from the declared counterparty.
CREATE FUNCTION public.fx_autoledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.chip_balance > OLD.chip_balance AND NULLIF(current_setting('app.ledger_counterparty',true),'') IS NOT NULL THEN
    INSERT INTO public.chip_ledger(from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id, idempotency_key, correlation_id)
    VALUES (current_setting('app.ledger_counterparty'), NULLIF(current_setting('app.ledger_counterparty_entity',true),'')::uuid,
      'player_wallet', NEW.user_id, NEW.chip_balance-OLD.chip_balance, current_setting('app.ledger_category'), NEW.club_id,
      NULLIF(current_setting('app.ledger_idempotency_key',true),''), NULLIF(current_setting('app.ledger_correlation',true),'')::uuid);
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_ca_autoledger AFTER UPDATE OF chip_balance ON public.club_members FOR EACH ROW EXECUTE FUNCTION public.fx_autoledger();
-- Stand-in for zzzz_horse_split_late_credit_returns_to_bank (Dan, 2026-11-02/03).
CREATE FUNCTION public.fx_split_late_return() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.club_members SET chip_balance = 0 WHERE user_id = NEW.user_id AND club_id = NEW.club_id;
  UPDATE public.clubs SET chip_treasury = chip_treasury + NEW.chip_balance WHERE id = NEW.club_id;
  INSERT INTO public.split_late_returns VALUES (NEW.club_id, NEW.user_id, NEW.chip_balance);
  RETURN NULL;
END $$;
CREATE TRIGGER zzzz_horse_split_late_credit_returns_to_bank AFTER UPDATE OF chip_balance ON public.club_members FOR EACH ROW
 WHEN (NEW.membership_lifecycle_status = 'departed' AND NEW.chip_balance > OLD.chip_balance)
 EXECUTE FUNCTION public.fx_split_late_return();
"""


def lit(v):
    return 'NULL' if v is None else "'" + str(v).replace("'", "''") + "'"


def seed():
    fx = json.loads((FX / 'pinned-set.json').read_text())
    s = ["INSERT INTO union_wallets(union_id, chip_balance) VALUES ('%s', %s);" % (UNION, BANK0)]
    clubs = sorted({e['c'] for e in fx['entitlements']})
    s += ["INSERT INTO clubs(id, name, union_id) VALUES ('%s','club %d','%s');" % (c, i, UNION) for i, c in enumerate(clubs)]
    for ev in fx['events']:
        s.append("INSERT INTO tournaments VALUES (%s,%s,%s,'%s','%s','2026-10-30 00:00+00');"
                 % (lit(ev['id']), lit(ev['name']), lit(ev['status']), UNION, clubs[0]))
        s.append("INSERT INTO smarter_private.owner_tournament_deletion_intents VALUES (%s,'2026-10-30 00:00+00','chips','%s',"
                 "'01a19ccc-894e-75e2-a9e7-fe0d2df6c326');" % (lit(ev['id']), UNION))
        if ev['transferred']:
            s.append("INSERT INTO smarter_private.owner_retirement_pool_transfers VALUES (%s);" % lit(ev['id']))
    users = {}
    for e in fx['entitlements']:
        users.setdefault((e['u'], e['c']), e)
    for (u, c), e in users.items():
        s.append("INSERT INTO profiles(id, username, is_horse) VALUES (%s,%s,true) ON CONFLICT DO NOTHING;" % (lit(u), lit(u[:8])))
        s.append("INSERT INTO club_members VALUES (%s,%s,%s,%s,now());" % (lit(u), lit(c), e['bal'] if e['bal'] is not None else 0, lit(e['life'])))
    for e in fx['entitlements']:
        s.append("INSERT INTO chip_ledger(id, from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id, tournament_id)"
                 " VALUES (%s,'player_wallet',%s,'prize_liability',%s,%s,%s,%s,%s);"
                 % (lit(e['src']), lit(e['u']), lit(e['t']), e['g'], lit(e['cat']), lit(e['c']), lit(e['t'])))
        s.append("INSERT INTO tournament_refund_entitlements VALUES (%s,%s,%s,'wallet_charge',%s,%s,%s,%s,%s,%s,%s);"
                 % (lit(e['id']), lit(e['t']), lit(e['u']), lit(e['cat']), lit(e['c']), e['g'], e['p'], e['b'], e['f'], lit(e['src'])))
    for m in fx['manual']:
        s.append("INSERT INTO smarter_private.owner_retirement_manual_refunds VALUES (%s,%s,%s,%s,%s);"
                 % (lit(m['e']), lit(m['t']), lit(m['u']), lit(m['l']), m['a']))
        s.append("UPDATE profiles SET is_horse = false WHERE id = %s;" % lit(m['u']))
    q('\n'.join(s))
    return fx


def snapshot():
    return one("SELECT md5(string_agg(x, '|' ORDER BY x)) FROM ("
               "SELECT 'm'||user_id||club_id||chip_balance x FROM club_members UNION ALL "
               "SELECT 'b'||chip_balance FROM union_wallets UNION ALL SELECT 'c'||id||chip_treasury FROM clubs UNION ALL "
               "SELECT 'l'||count(*) FROM chip_ledger UNION ALL SELECT 'a'||count(*) FROM ca_manual_adjustments UNION ALL "
               "SELECT 'k'||count(*) FROM wallet_credit_idempotency UNION ALL "
               "SELECT 'r'||count(*) FROM smarter_private.horse_refund_parity_receipts) s")


CALL = "BEGIN; SET LOCAL statement_timeout='2s'; SELECT smarter_private.horse_refund_parity_back_refund(%d); COMMIT;"

try:
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', '-k %s -p %s -c listen_addresses=' % (sock, port), '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    pre = (FX / 'owner-retirement-transfer-pools-preimage.sql').read_text()
    q(pre)
    assert one("SELECT md5(prosrc) FROM pg_proc WHERE proname='owner_retirement_transfer_pools'") == '74617e15d176bb1d4428a084d8918af1'
    fx = seed()
    assert one("SELECT count(*) FROM tournament_refund_entitlements") == '2224'

    # THE DEFECT: the preimage moves a horse-only event's custody with every paid horse entry unrefunded.
    ev = next(e for e in fx['events'] if e['transferred'] and e['status'] == 'CANCELLED')['id']
    q("INSERT INTO tournament_players(tournament_id, user_id) SELECT DISTINCT tournament_id, user_id FROM tournament_refund_entitlements WHERE tournament_id='%s';" % ev)
    q("DELETE FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id='%s';" % ev)
    q("UPDATE fx_switch SET v='true' WHERE k='frozen';")
    must_fail("SELECT smarter_private.owner_retirement_transfer_pools(gen_random_uuid(), '%s');" % ev, 'owner_retirement_platform_frozen')

    # Install refuses a changed preimage, then installs over the exact one.
    mig = MIG.read_text()
    must_fail(mig.replace("IS DISTINCT FROM '74617e15d176bb1d4428a084d8918af1'", "IS DISTINCT FROM '00000000000000000000000000000000'", 1), 'horse_refund_parity_transfer_pools_preimage_changed')
    q(mig)
    src = one("SELECT prosrc FROM pg_proc WHERE proname='owner_retirement_transfer_pools'")
    assert 'is_horse' not in src and 'owner_retirement_unrefunded_entry' in src

    # THE FIX: the same event is refused until its horses' paid entries are refunded.
    must_fail("SELECT smarter_private.owner_retirement_transfer_pools(gen_random_uuid(), '%s');" % ev, 'owner_retirement_unrefunded_entry')
    q("UPDATE profiles SET is_horse = false;")  # identity is not read: a human field is refused the same way
    must_fail("SELECT smarter_private.owner_retirement_transfer_pools(gen_random_uuid(), '%s');" % ev, 'owner_retirement_unrefunded_entry')
    q("UPDATE profiles SET is_horse = true WHERE id NOT IN (SELECT user_id FROM smarter_private.owner_retirement_manual_refunds);")
    must_fail("BEGIN; INSERT INTO tournament_refund_tranches(entitlement_id) SELECT id FROM tournament_refund_entitlements WHERE tournament_id='%s';"
              " SELECT smarter_private.owner_retirement_transfer_pools(gen_random_uuid(), '%s'); COMMIT;" % (ev, ev), 'owner_retirement_platform_frozen')
    q("UPDATE fx_switch SET v='false' WHERE k='frozen'; INSERT INTO smarter_private.owner_retirement_pool_transfers VALUES ('%s');" % ev)

    # PREVIEW moves nothing.
    s0 = snapshot()
    p = json.loads(one("BEGIN; SET LOCAL statement_timeout='2s'; SELECT smarter_private.horse_refund_parity_back_refund(0); COMMIT;"))
    assert (p['mode'], p['owed_charges'], p['owed_chips'], p['remaining_charges'], p['remaining_chips']) == ('preview', 2220, 17931.00, 2220, 17931.00), p
    assert snapshot() == s0

    # EVERY REFUSAL MOVES NOTHING.
    victim = one("SELECT id FROM tournament_refund_entitlements e WHERE NOT EXISTS (SELECT 1 FROM smarter_private.owner_retirement_manual_refunds m WHERE m.entitlement_id=e.id) ORDER BY tournament_id, user_id, id LIMIT 1")
    vt, vu, vc, vg = one("SELECT tournament_id||','||user_id||','||refund_wallet_club_id||','||gross FROM tournament_refund_entitlements WHERE id='%s'" % victim).split(',')
    cases = [
        ("INSERT INTO tournament_refund_entitlements SELECT gen_random_uuid(), tournament_id, user_id, entitlement_kind, charge_category, refund_wallet_club_id, gross, refund_prize, refund_bounty, refund_fee, source_ledger_id FROM tournament_refund_entitlements WHERE id='%s';" % victim, 'horse_refund_parity_entitlements_changed'),
        ("INSERT INTO tournament_refund_tranches(entitlement_id) VALUES ('%s');" % victim, 'horse_refund_parity_owed_set_changed'),
        ("UPDATE chip_ledger SET from_type='promo_wallet' WHERE id=(SELECT source_ledger_id FROM tournament_refund_entitlements WHERE id='%s');" % victim, 'horse_refund_parity_source_not_a_player_wallet_charge'),
        ("INSERT INTO chip_ledger(from_type, from_entity_id, to_type, to_entity_id, amount, category, club_id, tournament_id) VALUES ('prize_liability','%s','player_wallet','%s',(SELECT sum(amount) FROM chip_ledger WHERE tournament_id='%s' AND club_id='%s' AND from_entity_id='%s'),'refund','%s','%s');" % (vt, vu, vt, vc, vu, vc, vt), 'horse_refund_parity_partial_prior_refund'),
        ("UPDATE fx_switch SET v='2026-11-09 00:55:00+00' WHERE k='clock';", 'horse_refund_parity_break_window'),
        ("UPDATE fx_switch SET v='true' WHERE k='frozen';", 'horse_refund_parity_platform_frozen'),
        ("UPDATE fx_switch SET v='service_role' WHERE k='role';", 'horse_refund_parity_operator_session_required'),
    ]
    for setup, needle in cases:
        must_fail("BEGIN; %s SET LOCAL statement_timeout='2s'; SELECT smarter_private.horse_refund_parity_back_refund(10); COMMIT;" % setup, needle)
        assert snapshot() == s0, needle
    must_fail("BEGIN; SET LOCAL statement_timeout='5s'; SELECT smarter_private.horse_refund_parity_back_refund(10); COMMIT;", 'horse_refund_parity_unbounded_caller')
    must_fail("BEGIN; SET LOCAL statement_timeout='2s'; SELECT smarter_private.horse_refund_parity_back_refund(11); COMMIT;", 'horse_refund_parity_limit_is_0_to_10')
    assert snapshot() == s0

    # THE PAYMENT, in batches of ten, each its own transaction.
    before = {r.split('|')[0]: r.split('|')[1] for r in q("SELECT user_id||':'||club_id||'|'||chip_balance FROM club_members").split()}
    treasury0 = one("SELECT sum(chip_treasury) FROM clubs")
    calls = 0
    while True:
        r = json.loads(one(CALL % 10))
        calls += 1
        if r['refunded_charges'] == 0:
            break
        assert r['refunded_charges'] <= 10 and calls < 400
    assert r['total_refunded_charges'] == 2220 and r['total_refunded_chips'] == 17931.00 and r['remaining_charges'] == 0, r
    assert one("SELECT round(%s - chip_balance, 2) FROM union_wallets" % BANK0) == '17931.00'
    assert one("SELECT count(*)||'/'||sum(amount) FROM smarter_private.horse_refund_parity_receipts") == '2220/17931.00'
    assert one("SELECT count(*) FROM smarter_private.horse_refund_parity_receipts p JOIN tournament_refund_entitlements e ON e.id=p.entitlement_id"
               " WHERE p.amount=e.gross AND p.club_id=e.refund_wallet_club_id AND p.user_id=e.user_id") == '2220'
    assert one("SELECT count(*) FROM smarter_private.horse_refund_parity_receipts p JOIN smarter_private.owner_retirement_manual_refunds m USING (entitlement_id)") == '0'
    assert one("SELECT count(*)||'/'||sum(amount) FROM chip_ledger WHERE idempotency_key LIKE 'horse-refund-parity-20261108:%%' AND from_type='union_bank' AND from_entity_id='%s'" % UNION) == '2220/17931.00'
    assert one("SELECT count(*) FROM (SELECT idempotency_key FROM chip_ledger WHERE idempotency_key LIKE 'horse-refund-parity-20261108:%' GROUP BY 1 HAVING count(*)<>1) d") == '0'
    assert one("SELECT count(*)||'/'||sum(amount) FROM ca_manual_adjustments WHERE status='settled' AND decision_note='migration 20261108215333_horses_are_refunded_exactly_as_humans'") == '2220/17931.00'
    assert one("SELECT count(*)||'/'||sum(amount) FROM wallet_transactions WHERE type='credit' AND category='settlement'") == '2220/17931.00'
    # Active wallets hold their refunds; split-departed records passed theirs to the club bank.
    owed_active = one("SELECT sum(gross) FROM tournament_refund_entitlements e JOIN club_members m ON m.user_id=e.user_id AND m.club_id=e.refund_wallet_club_id"
                      " WHERE m.membership_lifecycle_status='active' AND NOT EXISTS (SELECT 1 FROM smarter_private.owner_retirement_manual_refunds x WHERE x.entitlement_id=e.id)")
    gained = sum(float(v.split('|')[1]) - float(before[v.split('|')[0]]) for v in q("SELECT user_id||':'||club_id||'|'||chip_balance FROM club_members WHERE membership_lifecycle_status='active'").split())
    assert round(gained, 2) == float(owed_active), (gained, owed_active)
    # The club-split trigger returns a departed record's whole balance (its refund plus whatever sat there before).
    departed_refunds = float(one("SELECT sum(gross) FROM tournament_refund_entitlements e JOIN club_members m ON m.user_id=e.user_id AND m.club_id=e.refund_wallet_club_id WHERE m.membership_lifecycle_status='departed'"))
    departed_before = sum(float(before[k]) for k in before if k in set(q("SELECT user_id||':'||club_id FROM club_members WHERE membership_lifecycle_status='departed'").split()))
    assert departed_refunds == 4445.00, departed_refunds
    assert round(float(one("SELECT sum(amount) FROM split_late_returns")), 2) == round(departed_refunds + departed_before, 2)
    assert one("SELECT count(*) FROM club_members WHERE membership_lifecycle_status='departed' AND chip_balance<>0") == '0'
    assert round(float(one("SELECT sum(chip_treasury) FROM clubs")) - float(treasury0), 2) == float(one("SELECT sum(amount) FROM split_late_returns"))

    # THE REPLAY pays nothing; receipts are immutable.
    s1 = snapshot()
    r = json.loads(one(CALL % 10))
    assert r['refunded_charges'] == 0 and r['refunded_chips'] == 0 and snapshot() == s1
    p = json.loads(one("BEGIN; SET LOCAL statement_timeout='2s'; SELECT smarter_private.horse_refund_parity_back_refund(0); COMMIT;"))
    assert p['remaining_charges'] == 0 and p['already_refunded_chips'] == 17931.00, p
    must_fail("DELETE FROM smarter_private.horse_refund_parity_receipts;", 'immutable')
    # Retirement passes the refund gate once every entry is refunded.
    q("DELETE FROM smarter_private.owner_retirement_pool_transfers WHERE tournament_id='%s'; UPDATE fx_switch SET v='true' WHERE k='frozen';" % ev)
    must_fail("SELECT smarter_private.owner_retirement_transfer_pools(gen_random_uuid(), '%s');" % ev, 'owner_retirement_platform_frozen')
    print('horse refund parity: OK (%d batch calls, 2220 charges, 17931.00 chips)' % calls)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
