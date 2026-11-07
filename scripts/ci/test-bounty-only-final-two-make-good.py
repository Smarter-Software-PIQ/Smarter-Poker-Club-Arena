#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261107140005 (the house pays the six bounty only
final two runners up their own heads).

The EXACT migration bytes run over a minimal schema that reproduces the six
events' own witness rows and carries the production signatures of the audited
house settlement door (fn_ca_adjustment_under_10_9 is the production body, so
the 200-character paragraph and the migration-naming rule are proved too).

This proves:
  * every refusal first: a drifted witness, an event already closed at two, a
    place ladder, a later knockout, a runner up who already holds a residual,
    heads that are no longer the whole open pool, a non-horse payee that needs
    its own reading, a foreign adjustment, and a bank that cannot fund - each
    aborts the migration and moves not one chip;
  * the payment: six credits totalling 105.87 from the Midway Union bank, each
    into the payee's own club wallet, one journal leg and one wallet receipt
    each, six settled adjustments, and no sealed event book rewritten;
  * the replay: running the same bytes again pays nothing and moves nothing;
  * the tamper: a key present without its exact settled receipts aborts rather
    than paying again.
"""
from pathlib import Path
import os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261107140005_the_house_pays_six_bounty_only_final_two_runners_up_their_own_heads.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='final-two-mg-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 71) % 9000)
started = False

UNION = 'fade0000-0000-0000-0000-000000000001'
DSS = '2a1132b9-5ba2-42e6-9f01-30a7fcffebe3'
FELT = 'a0000000-0000-0000-0000-000000000001'
BANK0 = 146630782.70

# event, name, day, pool, cash_halves, runner_up, head, winner, winner_head,
# winner_residual, final_ko_id, club
EVENTS = [
    ('39b5fa14-2332-472f-b0df-cde4edcdf62b', 'Midday Free Buy (NLH)', '2026-11-05', 323.00, 283.21,
     '341d4951-c3cf-4446-ac75-6f1448a9bf99', 34.56, 'e0f03a88-afc3-448f-835a-e8e323d09b57', 22.51, 39.79,
     '006eb8c9-0440-45ed-95f8-de73e212cf38', DSS),
    ('74ba8130-3ec5-48c2-b94b-409b7fb14a6b', 'Afternoon Free Buy (NLH)', '2026-11-05', 403.00, 363.68,
     '0ea03648-b12d-4ae7-ba65-aeaff4fcea34', 18.77, '01809c11-71bc-42a6-ad86-2130737d8cf9', 29.93, 39.32,
     'aa0fe537-4063-447a-a962-b3409574789f', FELT),
    ('1d115ff4-d0d5-48cc-8a3e-03ae3348d442', 'Prime Time Free Buy (NLH)', '2026-11-06', 395.00, 349.15,
     '8bdb54a1-d614-4932-84fa-795dd4728828', 16.53, '23ffb778-7059-45b8-a6e9-ce65514d1619', 37.58, 45.85,
     '85f2cb37-9984-451e-a032-dc88bfe8fef3', DSS),
    ('dce71e3f-4f77-48e7-94db-17d909bc2664', 'Midnight Free Buy (NLH)', '2026-11-06', 329.00, 281.67,
     '1fec4774-2523-4f2b-934b-db23a787f95f', 2.63, 'f69498c4-2af5-49ca-b1de-d9fa0715d57f', 46.01, 47.33,
     'e2986b0d-d420-4732-b3b9-1055dd8f5610', DSS),
    ('b3ae52ef-097c-4dcd-a438-d46ce010c021', 'Midday Free Buy (NLH)', '2026-11-06', 314.00, 298.30,
     '86468a23-14cb-4602-92f7-7e270197fc3c', 26.40, 'a0b37838-f752-469d-b41a-b999cd77b1ea', 2.50, 15.70,
     '3a345f9b-2f35-4e97-a7e1-b3d9208032a5', FELT),
    ('c1b3fa5a-85f6-4aea-8d4d-c76fc545a984', 'Midnight Free Buy (NLH)', '2026-11-07', 327.00, 286.97,
     '9b918b56-08d8-4a06-b8a0-de2bf4022303', 6.98, 'bbbe8009-75ac-4c8a-a483-9bf6b60fdf53', 36.54, 40.03,
     'a3f35659-3b4c-45c1-8814-00eb76c08052', FELT),
]
WALLET0 = 9000.00
TOTAL = 105.87


def run(args, sql=None, timeout=180):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port,
                '-U', 'postgres', '-d', 'w'], sql)


def notices(sql):
    r = subprocess.run([str(PG / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(sock),
                        '-p', port, '-U', 'postgres', '-d', 'w'], input=sql, text=True,
                       capture_output=True, timeout=180)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stderr


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
CREATE TABLE public.profiles(id uuid PRIMARY KEY, username text, is_horse boolean DEFAULT false);
CREATE TABLE public.clubs(id uuid PRIMARY KEY, name text, union_id uuid);
CREATE TABLE public.club_members(user_id uuid, club_id uuid, chip_balance numeric(15,2),
  PRIMARY KEY (user_id, club_id));
CREATE TABLE public.union_wallets(union_id uuid PRIMARY KEY, chip_balance numeric(15,2), updated_at timestamptz);
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, name text, status text, is_pko boolean,
  is_mystery_bounty boolean, buy_in_amount numeric, guaranteed_prize numeric, prize_pool numeric,
  bounty_pool numeric(15,2), bounty_pool_paid numeric(15,2), union_id uuid);
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid, user_id uuid, status text, position integer,
  current_bounty numeric(15,2) DEFAULT 0, prize numeric(15,2) DEFAULT 0);
CREATE TABLE public.tournament_payouts(tournament_id uuid, place integer);
CREATE TABLE public.tournament_bounties(id uuid PRIMARY KEY, tournament_id uuid,
  eliminated_player_id uuid, collector_player_id uuid, bounty_amount numeric(15,2),
  added_to_collector_bounty numeric(15,2), created_at timestamptz);
CREATE TABLE public.tournament_obligations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid, kind text, place integer, user_id uuid,
  amount_owed numeric(15,2), amount_paid numeric(15,2), source text);
CREATE TABLE public.ca_bounty_only_final_two(tournament_id uuid PRIMARY KEY);
CREATE TABLE public.wallet_credit_idempotency(key text PRIMARY KEY, user_id uuid,
  amount numeric(15,2), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, amount numeric(15,2), type text, category text, description text,
  related_entity_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chip_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_type text NOT NULL, from_entity_id uuid, to_type text NOT NULL, to_entity_id uuid,
  amount numeric(15,2) NOT NULL, category text NOT NULL, description text,
  club_id uuid, union_id uuid, tournament_id uuid, idempotency_key text, correlation_id uuid,
  status text NOT NULL DEFAULT 'posted', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ca_manual_adjustments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid NOT NULL, actor_label text, approver uuid, approver_label text, reason text NOT NULL,
  amount numeric(15,2) NOT NULL, target_kind text NOT NULL, target_id uuid, tournament_id uuid,
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz,
  decision_note text, asset text NOT NULL);
CREATE TABLE public.financial_alerts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text,
  source text, message text, context jsonb, resolved boolean, resolved_at timestamptz,
  resolved_by uuid, resolution text, created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION public.fn_player_home_club(p_user_id uuid, p_club_hint uuid) RETURNS uuid
 LANGUAGE sql AS $$ SELECT club_id FROM public.club_members WHERE user_id = p_user_id
                     ORDER BY club_id LIMIT 1 $$;

-- The production body, verbatim in its checks: the paragraph and the migration name.
CREATE FUNCTION public.fn_ca_adjustment_under_10_9(p_tournament_id uuid, p_user_id uuid,
  p_amount numeric, p_reason text, p_migration text,
  p_actor_label text DEFAULT 'chip standard (Claude)') RETURNS uuid
 LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) < 200 THEN
    RAISE EXCEPTION 'a 10.9 adjustment carries the paragraph: at least 200 characters naming every affected player and why (got %)', length(btrim(COALESCE(p_reason, '')));
  END IF;
  IF COALESCE(p_migration, '') !~ '^\d{14}_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'a 10.9 adjustment names the migration that carries it (got %)', p_migration;
  END IF;
  IF p_reason NOT LIKE '%' || p_migration || '%' THEN
    RAISE EXCEPTION 'the reason must name the migration %', p_migration;
  END IF;
  INSERT INTO public.ca_manual_adjustments(actor, actor_label, approver, approver_label, reason,
    amount, target_kind, target_id, tournament_id, status, approved_at, decision_note, asset)
  VALUES ('00000000-0000-0000-0000-00000000c1a9', p_actor_label,
    '2d1cd6c3-5700-4af9-a271-d4863fdab20d', 'Dan, standing written approval under CLAUDE.md 10.9',
    btrim(p_reason), round(p_amount, 2), 'player_wallet', p_user_id, p_tournament_id,
    'approved', now(), 'migration ' || p_migration, 'chips')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.fn_ca_declare_ledger(p_category text, p_counterparty text,
  p_counterparty_entity uuid, p_settlement_id uuid, p_idempotency_key text,
  p_autoskip_tables text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  PERFORM set_config('app.ledger_category', p_category, true);
  PERFORM set_config('app.ledger_counterparty', p_counterparty, true);
  PERFORM set_config('app.ledger_counterparty_entity', COALESCE(p_counterparty_entity::text, ''), true);
  PERFORM set_config('app.ledger_idempotency_key', p_idempotency_key, true);
  FOREACH t IN ARRAY COALESCE(p_autoskip_tables, ARRAY[]::text[]) LOOP
    PERFORM set_config('app.ledger_autoskip_' || t, '1', true);
  END LOOP;
END $$;

-- The idempotent wallet door: one idempotency row, one wallet receipt, ONE journal leg.
CREATE FUNCTION public.fn_credit_and_log(p_user_id uuid, p_amount numeric, p_idempotency_key text,
  p_category text, p_description text, p_related_entity_id uuid DEFAULT NULL) RETURNS boolean
 LANGUAGE plpgsql AS $$
DECLARE v_club uuid; v_cp text; v_cpe uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_credit_idempotency WHERE key = p_idempotency_key) THEN
    RETURN true;
  END IF;
  v_club := public.fn_player_home_club(p_user_id, NULL);
  v_cp := NULLIF(current_setting('app.ledger_counterparty', true), '');
  v_cpe := NULLIF(current_setting('app.ledger_counterparty_entity', true), '')::uuid;
  IF v_cp IS NULL OR v_cpe IS NULL
     OR NULLIF(current_setting('app.ledger_idempotency_key', true), '') IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'the journal was not declared for %', p_idempotency_key;
  END IF;
  INSERT INTO public.wallet_credit_idempotency(key, user_id, amount)
  VALUES (p_idempotency_key, p_user_id, round(p_amount, 2));
  UPDATE public.club_members SET chip_balance = chip_balance + round(p_amount, 2)
   WHERE user_id = p_user_id AND club_id = v_club;
  IF NOT FOUND THEN RAISE EXCEPTION 'no wallet for %', p_user_id; END IF;
  INSERT INTO public.wallet_transactions(user_id, amount, type, category, description, related_entity_id)
  VALUES (p_user_id, round(p_amount, 2), 'credit', p_category, p_description, p_related_entity_id);
  INSERT INTO public.chip_ledger(from_type, from_entity_id, to_type, to_entity_id, amount, category,
    description, club_id, union_id, tournament_id, idempotency_key, correlation_id)
  VALUES (v_cp, v_cpe, 'player_wallet', p_user_id, round(p_amount, 2),
    COALESCE(NULLIF(current_setting('app.ledger_category', true), ''), p_category),
    p_description, v_club, (SELECT union_id FROM public.clubs WHERE id = v_club), NULL,
    p_idempotency_key, NULLIF(current_setting('app.ledger_correlation', true), '')::uuid);
  RETURN true;
END $$;
"""


def seed():
    sql = [
        "INSERT INTO clubs VALUES ('%s','Deep Stack Society','%s'),('%s','The Felt Society','%s');" % (DSS, UNION, FELT, UNION),
        "INSERT INTO union_wallets VALUES ('%s',%s,now());" % (UNION, BANK0),
    ]
    for ev, name, day, pool, cash, ru, head, win, wh, res, ko, club in EVENTS:
        sql.append("INSERT INTO tournaments VALUES ('%s','%s','COMPLETED',true,false,0,0,0,%s,%s,'%s');"
                   % (ev, name, pool, pool, UNION))
        sql.append("INSERT INTO profiles VALUES ('%s','ru_%s',true) ON CONFLICT (id) DO NOTHING;" % (ru, ev[:8]))
        sql.append("INSERT INTO profiles VALUES ('%s','w_%s',true) ON CONFLICT (id) DO NOTHING;" % (win, ev[:8]))
        sql.append("INSERT INTO club_members VALUES ('%s','%s',%s) ON CONFLICT DO NOTHING;" % (ru, club, WALLET0))
        sql.append("INSERT INTO club_members VALUES ('%s','%s',%s) ON CONFLICT DO NOTHING;" % (win, club, WALLET0))
        sql.append("INSERT INTO tournament_players(tournament_id,user_id,status,position,current_bounty,prize)"
                   " VALUES ('%s','%s','eliminated',2,0,0),('%s','%s','winner',1,0,0);" % (ev, ru, ev, win))
        sql.append("INSERT INTO tournament_bounties VALUES"
                   " ('%s','%s','%s','%s',%s,%s,'%s 09:00:00+00')," % (ko, ev, ru, win, head, round(head / 2 + 0.0001, 2), day)
                   + " (gen_random_uuid(),'%s','%s','%s',4.00,2.00,'%s 08:00:00+00');" % (ev, win, ru, day))
        sql.append("INSERT INTO tournament_obligations(tournament_id,kind,user_id,amount_owed,amount_paid,source)"
                   " VALUES ('%s','bounty',NULL,%s,%s,'engine'),('%s','bounty_residual','%s',%s,%s,'engine');"
                   % (ev, cash, cash, ev, win, res, res))
    q('\n'.join(sql))


try:
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log',
         '-o', '-k %s -p %s -h 127.0.0.1' % (sock, port), '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    seed()
    MIGSQL = MIG.read_text()

    def bank():
        return one("SELECT chip_balance FROM union_wallets WHERE union_id='%s';" % UNION)

    def moved():
        return one("SELECT count(*)||'|'||count(*) FILTER (WHERE true) FROM chip_ledger;") + '|' \
            + one("SELECT count(*) FROM wallet_credit_idempotency;") + '|' \
            + one("SELECT count(*) FROM ca_manual_adjustments;") + '|' \
            + one("SELECT COALESCE(sum(chip_balance),0) FROM club_members;")

    quiet = moved()
    assert bank() == '146630782.70', bank()

    # --- EVERY REFUSAL MOVES NOTHING ------------------------------------
    E0, RU0, KO0 = EVENTS[0][0], EVENTS[0][5], EVENTS[0][10]
    cases = [
        ("UPDATE tournaments SET bounty_pool_paid=1 WHERE id='%s';" % E0,
         "UPDATE tournaments SET bounty_pool_paid=323.00 WHERE id='%s';" % E0,
         'is no longer the completed bounty only PKO'),
        ("INSERT INTO ca_bounty_only_final_two VALUES ('%s');" % E0,
         "DELETE FROM ca_bounty_only_final_two;", 'was closed at two after all'),
        ("INSERT INTO tournament_payouts VALUES ('%s',1);" % E0,
         "DELETE FROM tournament_payouts;", 'now carries a place ladder'),
        ("UPDATE tournament_players SET prize=5 WHERE tournament_id='%s' AND user_id='%s';" % (E0, RU0),
         "UPDATE tournament_players SET prize=0 WHERE tournament_id='%s' AND user_id='%s';" % (E0, RU0),
         'is no longer the eliminated second place'),
        ("UPDATE tournament_bounties SET bounty_amount=30 WHERE id='%s';" % KO0,
         "UPDATE tournament_bounties SET bounty_amount=34.56 WHERE id='%s';" % KO0,
         'no longer carries head'),
        ("INSERT INTO tournament_bounties VALUES (gen_random_uuid(),'%s','%s','%s',1,0.5,'2026-11-05 23:00:00+00');" % (E0, RU0, EVENTS[0][7]),
         "DELETE FROM tournament_bounties WHERE created_at='2026-11-05 23:00:00+00';",
         'is no longer the last knockout'),
        ("UPDATE tournament_obligations SET amount_paid=1 WHERE tournament_id='%s' AND kind='bounty_residual';" % E0,
         "UPDATE tournament_obligations SET amount_paid=39.79 WHERE tournament_id='%s' AND kind='bounty_residual';" % E0,
         'champion residual of'),
        ("INSERT INTO tournament_obligations(tournament_id,kind,user_id,amount_owed,amount_paid,source) VALUES ('%s','bounty_residual','%s',1,1,'x');" % (E0, RU0),
         "DELETE FROM tournament_obligations WHERE source='x';", 'already holds a bounty residual'),
        ("UPDATE tournament_obligations SET amount_paid=200 WHERE tournament_id='%s' AND kind='bounty';" % E0,
         "UPDATE tournament_obligations SET amount_paid=283.21 WHERE tournament_id='%s' AND kind='bounty';" % E0,
         'are no longer the whole open bounty pool'),
        ("UPDATE profiles SET is_horse=false WHERE id='%s';" % RU0,
         "UPDATE profiles SET is_horse=true WHERE id='%s';" % RU0, 'is no longer a horse'),
        ("UPDATE clubs SET union_id=gen_random_uuid() WHERE id='%s';" % DSS,
         "UPDATE clubs SET union_id='%s' WHERE id='%s';" % (UNION, DSS), 'no longer banks in'),
        ("INSERT INTO ca_manual_adjustments(actor,reason,amount,target_kind,target_id,tournament_id,status,asset,decision_note) VALUES ('%s','other',1,'player_wallet','%s','%s','approved','chips','migration something_else');" % (RU0, RU0, E0),
         "DELETE FROM ca_manual_adjustments WHERE reason='other';", 'needs inspection before payment'),
        ("UPDATE union_wallets SET chip_balance=5 WHERE union_id='%s';" % UNION,
         "UPDATE union_wallets SET chip_balance=%s WHERE union_id='%s';" % (BANK0, UNION),
         'cannot fund'),
    ]
    for mutate, undo, needle in cases:
        q(mutate)
        must_fail(MIGSQL, needle)
        q(undo)
        assert moved() == quiet, 'a refusal moved money: %s' % needle
        assert bank() == '146630782.70', bank()

    # --- THE PAYMENT ----------------------------------------------------
    before = one("SELECT COALESCE(sum(chip_balance),0) FROM club_members;")
    print('union bank before:      %s' % bank())
    for ev, name, day, pool, cash, ru, head, win, wh, res, ko, club in EVENTS:
        print('  %s  %-25s %s  wallet before %s  owed %6.2f'
              % (ev[:8], name, day,
                 one("SELECT chip_balance FROM club_members WHERE user_id='%s' AND club_id='%s';" % (ru, club)),
                 head))
    print(notices(MIGSQL).strip())
    after_bank = bank()
    assert after_bank == '146630676.83', after_bank          # 146630782.70 - 105.87
    assert one("SELECT round(%s - chip_balance,2) FROM union_wallets WHERE union_id='%s';" % (BANK0, UNION)) == '105.87'
    assert one("SELECT round(sum(chip_balance) - %s,2) FROM club_members;" % before) == '105.87'
    legs = one("SELECT count(*)||'|'||sum(amount) FROM chip_ledger WHERE idempotency_key LIKE 'bounty-only-final-two-make-good:%';")
    assert legs == '6|105.87', legs
    assert one("""SELECT count(*)||'|'||sum(amount) FROM ca_manual_adjustments
                   WHERE status='settled' AND decision_note LIKE 'migration 20261107140005%';""") == '6|105.87'
    assert one("""SELECT count(*)||'|'||sum(amount) FROM wallet_transactions
                   WHERE category='settlement' AND type='credit';""") == '6|105.87'
    assert one("""SELECT count(*) FROM chip_ledger WHERE idempotency_key LIKE 'bounty-only-final-two-make-good:%%'
                   AND (from_type<>'union_bank' OR from_entity_id<>'%s' OR to_type<>'player_wallet'
                        OR category<>'settlement' OR tournament_id IS NOT NULL OR club_id IS NULL
                        OR correlation_id IS NULL);""" % UNION) == '0'
    for ev, name, day, pool, cash, ru, head, win, wh, res, ko, club in EVENTS:
        got = one("SELECT round(chip_balance - %s,2) FROM club_members WHERE user_id='%s' AND club_id='%s';"
                  % (WALLET0, ru, club))
        assert got == ('%.2f' % head), '%s: wallet moved %s, owed %.2f' % (ru, got, head)
        assert one("SELECT round(chip_balance - %s,2) FROM club_members WHERE user_id='%s' AND club_id='%s';"
                   % (WALLET0, win, club)) == '0.00', 'the champion was touched'
        assert one("SELECT bounty_pool_paid FROM tournaments WHERE id='%s';" % ev) == ('%.2f' % pool)
    assert one("""SELECT count(*) FROM financial_alerts WHERE source='bounty_only_final_two_make_good'
                   AND resolved IS TRUE AND (context->>'paid')::numeric=105.87;""") == '1'

    # --- THE REPLAY PAYS NOTHING ----------------------------------------
    paid_state = moved()
    q(MIGSQL)
    assert moved() == paid_state, 'the replay moved money'
    assert bank() == '146630676.83', bank()
    assert one("""SELECT count(*) FROM financial_alerts WHERE source='bounty_only_final_two_make_good';""") == '1'

    # --- A KEY WITHOUT ITS EXACT RECEIPTS ABORTS ------------------------
    q("UPDATE ca_manual_adjustments SET status='approved' WHERE target_id='%s' AND decision_note LIKE 'migration 20261107140005%%';" % RU0)
    must_fail(MIGSQL, 'lacks the exact settled receipts')
    q("UPDATE ca_manual_adjustments SET status='settled' WHERE target_id='%s' AND decision_note LIKE 'migration 20261107140005%%';" % RU0)
    assert moved() == paid_state and bank() == '146630676.83'

    print('union bank after:       %s' % bank())
    for ev, name, day, pool, cash, ru, head, win, wh, res, ko, club in EVENTS:
        print('  %s  %-25s %s  wallet after  %s  paid %6.2f'
              % (ev[:8], name, day,
                 one("SELECT chip_balance FROM club_members WHERE user_id='%s' AND club_id='%s';" % (ru, club)),
                 head))
    print('final two make-good: 13 refusals move nothing; 6 runners up paid 105.87 from the union bank '
          'with one leg and one receipt each; replay and tampered receipts pay nothing - OK')
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
