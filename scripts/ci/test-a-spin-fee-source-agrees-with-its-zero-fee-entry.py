#!/usr/bin/env python3
"""Native PG17 proof for 20261117165223 (incident 002a0deb, SpinFleetProducingNothing).

fn_ca_promo_consume_event_fee runs when a tournament's canonical fee row is
recognised. Its production preimage (md5 c14abcc7..., captured 2026-11-17 and
kept in tests/fixtures/spin-fee-guard) required the entry receipt's gross_fee
(the entitlement's refund_fee) to equal the fee row's rake_credit. A Spin entry
carries refund_fee 0 and its rake is recognised at the draw, so every Spin with
an entrant seated after Promo Play Through enforcement refused to start.

This throwaway cluster installs the exact preimage on minimal typed relations,
shows the Spin refusal, applies the migration and proves:
  * the designed Spin shape (gross_fee 0, principal 0) is recognised once, returns 0;
  * a Spin receipt claiming a disagreeing entry fee or spent principal still refuses;
  * a Spin with a different entitlement, club or player still refuses;
  * every other variant keeps gross_fee = rake_credit exactly;
  * the migration is idempotent and its @live-proof holds.
No production endpoint or credentials are accepted.
"""
import argparse, hashlib, os, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PREIMAGE = ROOT / 'tests/fixtures/spin-fee-guard/consume-event-fee-preimage.sql'
PREIMAGE_MD5 = 'c14abcc7a3f6981aa247c97b5dc0d465'
MIGRATION = ROOT / 'supabase/migrations/20261117165223_a_spin_fee_source_agrees_with_its_zero_fee_entry.sql'
REFUSAL = 'promo_canonical_fee_lost_original_entitlement'

CLUB = 'c0000000-0000-0000-0000-000000000001'
OTHER_CLUB = 'c0000000-0000-0000-0000-000000000002'
PLAYER = 'a0000000-0000-0000-0000-000000000001'
OTHER_PLAYER = 'a0000000-0000-0000-0000-000000000002'


def uid(label):
    return str(__import__('uuid').UUID(hashlib.md5(label.encode()).hexdigest()))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--pg-bin', type=Path, required=True)
    ap.add_argument('--skip-fix', action='store_true',
                    help='prove the preimage alone (the regression must fail)')
    a = ap.parse_args()
    if os.environ.get('DATABASE_URL'):
        raise SystemExit('remote database forbidden')
    pg = a.pg_bin.resolve()
    scratch = Path(tempfile.mkdtemp(prefix='sfg-'))
    port = '54437'
    started = False

    def q(sql, error=None):
        p = subprocess.run([str(pg / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(scratch),
                            '-p', port, '-U', 'postgres', '-d', 'postgres'],
                           input=sql, text=True, capture_output=True, timeout=60)
        if error:
            if p.returncode == 0 or error not in p.stderr:
                raise AssertionError(f'expected {error!r}; rc={p.returncode} out={p.stdout} err={p.stderr}')
            return ''
        if p.returncode:
            raise RuntimeError(p.stderr + '\n' + sql[:400])
        return p.stdout.strip()

    def check(label, ok):
        print(('PASS ' if ok else 'FAIL ') + label, flush=True)
        if not ok:
            raise AssertionError(label)

    def fee_row(label, variant, rake, gross, principal, club=CLUB, player=PLAYER, same_entitlement=True):
        t, ledger, ent, fs = uid(label + 't'), uid(label + 'l'), uid(label + 'e'), uid(label + 'f')
        q(f"""INSERT INTO tournaments VALUES('{t}','{variant}');
INSERT INTO chip_ledger VALUES('{ledger}', now());
INSERT INTO ca_promo_event_fee_consumption_receipts(charge_ledger_id,entitlement_id,gross_fee,original_promo,charge_amount,principal,club_id,player_id)
 VALUES('{ledger}','{ent}',{gross},0,5,{principal},'{CLUB}','{PLAYER}');
INSERT INTO accounting_tournament_fee_sources(id,tournament_id,player_id,club_id,rake_credit,source_charge_ledger_id,source_entitlement_id)
 VALUES('{fs}','{t}','{player}','{club}',{rake},'{ledger}','{ent if same_entitlement else uid(label + 'other')}');""")
        return fs

    try:
        subprocess.run([pg / 'initdb', '-D', scratch / 'data', '-U', 'postgres', '-A', 'trust'], check=True, capture_output=True)
        subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-w', '-o', f"-p {port} -k {scratch} -c listen_addresses=''",
                        '-l', scratch / 'server.log', 'start'], check=True, capture_output=True)
        started = True
        q("""CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE tournaments(id uuid PRIMARY KEY, variant text NOT NULL);
CREATE TABLE chip_ledger(id uuid PRIMARY KEY, created_at timestamptz NOT NULL);
CREATE TABLE ca_promo_play_through_settings(id boolean PRIMARY KEY, enforced_from timestamptz);
INSERT INTO ca_promo_play_through_settings VALUES(true, now() - interval '1 hour');
CREATE TABLE ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid PRIMARY KEY, entitlement_id uuid, gross_fee numeric,
 original_promo numeric, charge_amount numeric, principal numeric, club_id uuid, player_id uuid);
CREATE TABLE accounting_tournament_fee_sources(id uuid PRIMARY KEY, tournament_id uuid, player_id uuid, club_id uuid,
 rake_credit numeric, source_charge_ledger_id uuid, source_entitlement_id uuid);
CREATE TABLE ca_promo_event_fee_source_links(fee_source_id uuid PRIMARY KEY, charge_ledger_id uuid);""")
        q(PREIMAGE.read_text())
        check('installed preimage is the production definition',
              q("SELECT md5(pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure))") == PREIMAGE_MD5)

        spin_before = fee_row('spin-before', 'spin', 0.40, 0, 0)
        q(f"SELECT fn_ca_promo_consume_event_fee('{spin_before}')", error=REFUSAL)
        check('preimage refuses the designed zero-fee Spin entry (the incident)', True)

        if not a.skip_fix:
            q(MIGRATION.read_text())
        spin = fee_row('spin', 'spin', 0.40, 0, 0)
        try:
            spent = q(f"SELECT fn_ca_promo_consume_event_fee('{spin}')")
        except RuntimeError as e:
            check(f'a zero-fee Spin entry is recognised after the fix ({str(e).splitlines()[0]})', False)
        check('a zero-fee Spin entry is recognised and spends nothing', spent == '0' or float(spent) == 0)
        check('the Spin fee row is linked once',
              q(f"SELECT count(*) FROM ca_promo_event_fee_source_links WHERE fee_source_id='{spin}'") == '1')
        check('the refused pre-fix Spin row now recognises too',
              float(q(f"SELECT fn_ca_promo_consume_event_fee('{spin_before}')")) == 0)

        q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row('spin-fee', 'spin', 0.40, 0.20, 0)}')", error=REFUSAL)
        check('a Spin receipt that claims a disagreeing entry fee still refuses', True)
        q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row('spin-principal', 'spin', 0.40, 0, 0.10)}')", error=REFUSAL)
        check('a Spin receipt that spent principal still refuses', True)
        q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row('spin-ent', 'spin', 0.40, 0, 0, same_entitlement=False)}')", error=REFUSAL)
        check('a Spin with another entitlement still refuses', True)
        q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row('spin-club', 'spin', 0.40, 0, 0, club=OTHER_CLUB)}')", error=REFUSAL)
        check('a Spin with another club still refuses', True)
        q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row('spin-player', 'spin', 0.40, 0, 0, player=OTHER_PLAYER)}')", error=REFUSAL)
        check('a Spin with another player still refuses', True)

        for variant in ('freezeout', 'sng', 'satellite', 'bounty'):
            q(f"SELECT fn_ca_promo_consume_event_fee('{fee_row(variant + '-zero', variant, 0.40, 0, 0)}')", error=REFUSAL)
            check(f'{variant}: a zero-fee receipt against a positive rake still refuses', True)
            ok = fee_row(variant + '-eq', variant, 0.40, 0.40, 0.10)
            check(f'{variant}: gross_fee = rake_credit is recognised and returns the spent principal',
                  float(q(f"SELECT fn_ca_promo_consume_event_fee('{ok}')")) == 0.10)

        before = q("SELECT md5(pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure))")
        q(MIGRATION.read_text())
        check('the migration is idempotent',
              q("SELECT md5(pg_get_functiondef('public.fn_ca_promo_consume_event_fee(uuid)'::regprocedure))") == before)
        proof = re.search(r'^-- @live-proof: (.+)$', MIGRATION.read_text(), re.M).group(1)
        check('the @live-proof holds', q(f'SELECT {proof}') == 't')
        print('ALL PASS')
    finally:
        if started:
            subprocess.run([pg / 'pg_ctl', '-D', scratch / 'data', '-m', 'fast', '-w', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()
