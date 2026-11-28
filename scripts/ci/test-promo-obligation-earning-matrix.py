#!/usr/bin/env python3
"""Every tournament obligation kind x context x recipient through the promo earning trigger.

Promo Play Through (enforced 2026-11-17 14:28Z) attaches an earning trigger,
fn_ca_promo_profit_capture_obligation_earning, to every increase of every
tournament obligation. Four outages that day came from promo guards that held
for the common tournament shape and refused a real one. This matrix drives the
trigger through every obligation kind production writes, with and without a
knockout context, for the champion and for anyone else, for a human and for a
Horse, on insert and on a later top-up, and checks each outcome against the
product rule written independently below (EXPECTED), not against the function.

It installs the production preimage (md5 53819ac2..., captured from the live
definition and from migration 20261116200638), reproduces the Mystery Bounty
champion residual refusal, applies 20261117184500 and proves the fixed matrix.
Collaborators the trigger delegates to (generation and PKO residual head) are
recording stubs: the routing decision is what is under test here; their own
financial behaviour is proven by test-promo-tournament-earning-generation.py.

The equal-share kinds (equal_share, equal_share_bounty) come from migration
20261124171000, which pays an aborted event's equal shares through the
tournament obligation door. That migration widens the kind CHECK and the door;
it does not redefine the earning trigger under test. The stub table here carries
no kind CHECK, so these cases hold whether that migration has merged or not.
No production endpoint or credentials are accepted.
"""
import argparse, hashlib, itertools, json, os, re, subprocess, sys, tempfile, uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREIMAGE = ROOT / 'tests/fixtures/promo-obligation-earning-matrix/capture-obligation-earning-preimage.sql'
PREIMAGE_MD5 = '53819ac20e4f87659df84d05fb442d19'
MIGRATION = ROOT / 'supabase/migrations/20261117184500_mystery_champion_residual_earns_from_the_champions_own_entry.sql'

KINDS = ['place', 'bubble_protection', 'final_table_deal', 'seat', 'satellite_remainder',
         'refund', 'bounty_residual', 'own_bounty', 'bounty', 'mystery_bounty',
         'equal_share', 'equal_share_bounty']
CONTEXTS = ['knockout', 'none']
RECIPIENTS = ['champion', 'other']
PLAYERS = ['human', 'horse']
OPS = ['insert', 'topup']


def expected(kind, ctx, recipient, fixed):
    """Product rule, derived from the payout owners, not from the trigger.

    - A refund returns an entry; it earns nothing.
    - PKO residual heads (bounty_residual, own_bounty) earn through the head.
    - A knockout bounty or mystery chest earns from the knockout hand's entry.
      With no knockout it is unearned and must refuse.
    - The Mystery Bounty champion residual (fn_mystery_bounty_settle) has no
      knockout: the sole winner earned it by winning, like a place prize.
    - An equal share of an aborted event's prize or bounty bank (equal_share,
      equal_share_bounty) is tournament winnings and earns exactly like a
      place prize, from the recipient's own entry, knockout context or not
      (owner ruling 2026-11-24: done exactly like anything else is done).
    - Every other prize earns from the recipient's own current entry.
    A Horse earns exactly as a human does.
    """
    if kind == 'refund':
        return 'none'
    if kind in ('bounty_residual', 'own_bounty'):
        return 'residual_head'
    if kind in ('bounty', 'mystery_bounty'):
        if ctx == 'knockout':
            return 'hand'
        if kind == 'mystery_bounty' and recipient == 'champion' and fixed:
            return 'own_entry'
        return 'refuse'
    return 'own_entry'


def uid(label):
    return str(uuid.UUID(hashlib.md5(label.encode()).hexdigest()))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, required=True)
    ap.add_argument('--skip-fix', action='store_true', help='run the matrix on the preimage only (must fail)')
    a = ap.parse_args()
    if os.environ.get('DATABASE_URL'):
        raise SystemExit('remote database forbidden')
    pg = a.pg_bin.resolve()
    scratch = Path(tempfile.mkdtemp(prefix='poem-'))
    port = '54439'
    started = False
    results = []

    def q(sql):
        p = subprocess.run([str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(scratch), '-p', port,
                            '-U', 'postgres', '-d', 'postgres'], input=sql, text=True, capture_output=True, timeout=60)
        return p

    def ok(sql):
        p = q(sql)
        if p.returncode:
            raise RuntimeError(p.stderr + '\n' + sql[:400])
        return p.stdout.strip()

    def check(label, good):
        results.append({'check': label, 'ok': bool(good)})
        print(('PASS ' if good else 'FAIL ') + label, flush=True)
        return good

    def outcome(ob):
        rows = ok(f"SELECT coalesce(string_agg(DISTINCT CASE WHEN source_bounty_obligation_id IS NOT NULL THEN 'hand' ELSE 'own_entry' END, ','), '') FROM ca_promo_profit_obligation_earnings WHERE obligation_id='{ob}'")
        head = ok(f"SELECT count(*) FROM stub_calls WHERE fn='residual_head' AND obligation_id='{ob}'")
        if head != '0':
            return 'residual_head' if rows == '' else 'conflict'
        return rows or 'none'

    def run_case(kind, ctx, recipient, player, op, fixed):
        label = f'{kind}/{ctx}/{recipient}/{player}/{op}' + ('' if fixed else ' (preimage)')
        t, win, oth = uid(label + 't'), uid(label + 'w'), uid(label + 'o')
        user = win if recipient == 'champion' else oth
        reg_w, reg_o = uid(label + 'rw'), uid(label + 'ro')
        hand, table, bo, ob = uid(label + 'h'), uid(label + 'tb'), uid(label + 'bo'), uid(label + 'ob')
        horse = 'true' if player == 'horse' else 'false'
        ok(f"""INSERT INTO tournament_players(id,tournament_id,user_id,club_id,status,position,is_horse) VALUES
 ('{reg_w}','{t}','{win}','{uid('club')}','winner',1,{horse}),('{reg_o}','{t}','{oth}','{uid('club')}','eliminated',7,{horse});
INSERT INTO ca_promo_profit_tournament_hand_clocks VALUES('{hand}','{table}','{t}',1,clock_timestamp(),ARRAY['{win}','{oth}']::uuid[],
 jsonb_build_object('{win}',jsonb_build_object('club_id','{uid('club')}','generation_id','{reg_w}'),'{oth}',jsonb_build_object('club_id','{uid('club')}','generation_id','{reg_o}')));
INSERT INTO tournament_bounty_obligations VALUES('{bo}','{t}','{user}','[]','{hand}','{table}');""")
        setctx = f"SET app.bounty_obligation_id='{bo}';" if ctx == 'knockout' else "SET app.bounty_obligation_id='';"
        if op == 'insert':
            sql = f"{setctx}INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{user}','{kind}',NULL,0,10,'matrix');"
        else:
            ok(f"SET app.bounty_obligation_id='{bo}';ALTER TABLE tournament_obligations DISABLE TRIGGER zzzz_promo_original_obligation_earning;INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{user}','{kind}',NULL,0,10,'fn_mystery_bounty_pay');ALTER TABLE tournament_obligations ENABLE TRIGGER zzzz_promo_original_obligation_earning;")
            sql = f"{setctx}UPDATE tournament_obligations SET amount_owed=15 WHERE id='{ob}';"
        p = q(sql)
        got = 'refuse' if p.returncode else outcome(ob)
        if p.returncode and 'original_bounty_earning_hand_missing' not in p.stderr:
            got = 'error:' + p.stderr.strip().splitlines()[-1][:120]
        want = expected(kind, ctx, recipient, fixed)
        return check(f'{label}: expected {want}, got {got}', got == want)

    try:
        env = dict(os.environ, LC_ALL=os.environ.get('LC_ALL', 'C'))
        subprocess.run([pg / 'initdb', '-D', scratch / 'data', '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True, env=env)
        subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-w', '-o', f"-p {port} -k {scratch} -c listen_addresses=''",
                        '-l', scratch / 'server.log', 'start'], check=True, capture_output=True, env=env)
        started = True
        ok("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY, enforced_from timestamptz);
INSERT INTO ca_promo_play_through_settings VALUES(true, clock_timestamp() - interval '1 hour');
CREATE TABLE tournament_players(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, club_id uuid, status text, position integer, is_horse boolean);
CREATE TABLE tournament_obligations(id uuid PRIMARY KEY, tournament_id uuid, user_id uuid, kind text, place integer,
 amount_paid numeric, amount_owed numeric, source text, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE tournament_bounty_obligations(id uuid PRIMARY KEY, tournament_id uuid, knocker_user_id uuid, claimants jsonb, hand_id uuid, table_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE hand_atomic_commits(hand_id uuid PRIMARY KEY, table_id uuid, committed_at timestamptz);
CREATE TABLE ca_promo_profit_tournament_hand_clocks(hand_id uuid PRIMARY KEY, table_id uuid, tournament_id uuid, hand_number bigint,
 earned_at timestamptz, participant_ids uuid[], participant_scope jsonb);
CREATE TABLE ca_promo_profit_tournament_hand_sources(hand_id uuid, user_id uuid, club_id uuid, generation_id uuid, charge_ledger_ids uuid[]);
CREATE TABLE ca_promo_profit_charge_generations(charge_ledger_id uuid, generation_id uuid);
CREATE TABLE ca_promo_profit_obligation_earnings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), obligation_id uuid, tournament_id uuid, user_id uuid,
 earning_club_id uuid, generation_id uuid, charge_ledger_ids uuid[], amount_from numeric, amount_to numeric, source_kind text,
 source_bounty_obligation_id uuid, earned_at timestamptz);
CREATE TABLE stub_calls(fn text, obligation_id uuid, registration_id uuid);
CREATE FUNCTION fn_ca_promo_profit_capture_residual_head(p_obligation uuid, p_tournament uuid, p_user uuid, p_from numeric, p_to numeric)
 RETURNS void LANGUAGE sql AS $$ INSERT INTO stub_calls VALUES('residual_head', p_obligation, NULL) $$;
CREATE FUNCTION fn_ca_promo_profit_apply_generation(p_registration uuid, p_context jsonb DEFAULT NULL)
 RETURNS uuid LANGUAGE sql AS $$ INSERT INTO stub_calls VALUES('apply_generation', NULL, p_registration) RETURNING p_registration $$;""")
        ok(PREIMAGE.read_text())
        ok("CREATE TRIGGER zzzz_promo_original_obligation_earning AFTER INSERT OR UPDATE OF amount_owed ON tournament_obligations FOR EACH ROW EXECUTE FUNCTION fn_ca_promo_profit_capture_obligation_earning();")
        good = check('installed preimage is the production definition',
                     ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))") == PREIMAGE_MD5)

        # The incident: the preimage refuses the champion residual.
        good &= run_case('mystery_bounty', 'none', 'champion', 'human', 'topup', fixed=False)
        good &= run_case('mystery_bounty', 'none', 'champion', 'human', 'insert', fixed=False)

        fixed = not a.skip_fix
        if fixed:
            ok(MIGRATION.read_text())
        for kind, ctx, recipient, player, op in itertools.product(KINDS, CONTEXTS, RECIPIENTS, PLAYERS, OPS):
            good &= run_case(kind, ctx, recipient, player, op, fixed=True)

        # Boundaries that must keep refusing after the fix.
        t, w1, w2, ob = uid('tie-t'), uid('tie-w1'), uid('tie-w2'), uid('tie-ob')
        ok(f"INSERT INTO tournament_players(id,tournament_id,user_id,club_id,status,position) VALUES('{uid('tie-r1')}','{t}','{w1}','{uid('club')}','winner',1),('{uid('tie-r2')}','{t}','{w2}','{uid('club')}','winner',1);")
        p = q(f"SET app.bounty_obligation_id='';INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{w1}','mystery_bounty',NULL,0,5,'x');")
        good &= check('two recorded winners: a context-free mystery amount still refuses', p.returncode != 0 and 'original_bounty_earning_hand_missing' in p.stderr)
        t, w, ob = uid('pl-t'), uid('pl-w'), uid('pl-ob')
        ok(f"INSERT INTO tournament_players(id,tournament_id,user_id,club_id,status,position) VALUES('{uid('pl-r')}','{t}','{w}','{uid('club')}','winner',1);")
        p = q(f"SET app.bounty_obligation_id='';INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{w}','mystery_bounty',1,0,5,'x');")
        good &= check('a placed mystery amount without context still refuses', p.returncode != 0)
        t, w, ob = uid('b-t'), uid('b-w'), uid('b-ob')
        ok(f"INSERT INTO tournament_players(id,tournament_id,user_id,club_id,status,position) VALUES('{uid('b-r')}','{t}','{w}','{uid('club')}','winner',1);")
        p = q(f"SET app.bounty_obligation_id='';INSERT INTO tournament_obligations(id,tournament_id,user_id,kind,place,amount_paid,amount_owed,source) VALUES('{ob}','{t}','{w}','bounty',NULL,0,5,'x');")
        good &= check("a champion's PKO bounty without its knockout still refuses", p.returncode != 0)

        if fixed:
            before = ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))")
            ok(MIGRATION.read_text())
            good &= check('the migration is idempotent', ok("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_capture_obligation_earning()'::regprocedure))") == before)
            ok("ALTER FUNCTION fn_ca_promo_profit_capture_obligation_earning() SECURITY DEFINER; REVOKE ALL ON FUNCTION fn_ca_promo_profit_capture_obligation_earning() FROM PUBLIC;")
            proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
            good &= check('the @live-proof holds', ok(f'SELECT {proof}') == 't')
        n = sum(1 for r in results)
        print(json.dumps({'status': 'passed' if good else 'failed', 'checks': n, 'failed': [r['check'] for r in results if not r['ok']]}))
        if not good:
            sys.exit(1)
    finally:
        if started:
            subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
