#!/usr/bin/env python3
"""A promo entry fee never settles promo progress inside a payout (incident 075013fd).

Native PostgreSQL 16 proof for migration
20261119001629_a_promo_entry_fee_never_settles_promo_progress_inside_a_payo.sql.

Fixture: the production body of fn_ca_promo_profit_finish_entry_fee (md5 pinned
by the migration's guard), with fn_ca_promo_profit_consume_entry_fee and
fn_ca_promo_profit_settle replaced by recorders. Proves, on a disposable
cluster:
  1. before: one charge held by two promo accounts settles both (the defect:
     a 20-qualifier satellite settlement ran the settle 20 times in one
     transaction and was cancelled at 8 s on every attempt);
  2. the migration installs against exactly that body;
  3. after: the charge is still consumed, exactly once, and nothing settles;
  4. the guard refuses a second apply (the body it pins is gone), atomically.
Prints the installed definition's md5 for the migration's @live-proof.

Usage: PG_BIN=/usr/lib/postgresql/16/bin python3 scripts/ci/test-promo-entry-fee-never-settles-progress.py
"""
import os, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = next((ROOT / 'supabase/migrations').glob('20261119001629_*.sql'))
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
OLD_MD5 = '4ccc31895ec4d184df900708e29b2c1a'

FIXTURE = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.ca_promo_play_through_grants(id uuid PRIMARY KEY, club_id uuid, user_id uuid);
CREATE TABLE public.ca_promo_profit_event_lots(grant_id uuid, charge_ledger_id uuid);
CREATE TABLE public.ca_promo_event_principal_lots(grant_id uuid, charge_ledger_id uuid);
CREATE TABLE public.ca_promo_event_fee_consumption_receipts(charge_ledger_id uuid, club_id uuid, player_id uuid);
CREATE TABLE public.calls(fn text, a uuid, b uuid);
CREATE FUNCTION public.fn_ca_promo_profit_consume_entry_fee(p_charge uuid) RETURNS boolean
LANGUAGE sql AS $$ INSERT INTO public.calls VALUES('consume', p_charge, NULL) RETURNING true $$;
CREATE FUNCTION public.fn_ca_promo_profit_settle(p_club uuid, p_user uuid) RETURNS void
LANGUAGE sql AS $$ INSERT INTO public.calls VALUES('settle', p_club, p_user) $$;
-- Production body, byte for byte (pg_get_functiondef 2026-11-19).
CREATE OR REPLACE FUNCTION public.fn_ca_promo_profit_finish_entry_fee(p_charge uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
 IF NOT public.fn_ca_promo_profit_consume_entry_fee(p_charge) THEN RETURN;END IF;
 FOR r IN SELECT DISTINCT g.club_id,g.user_id FROM public.ca_promo_play_through_grants g WHERE g.id IN(SELECT grant_id FROM public.ca_promo_profit_event_lots WHERE charge_ledger_id=p_charge UNION SELECT grant_id FROM public.ca_promo_event_principal_lots WHERE charge_ledger_id=p_charge)
 UNION SELECT p.club_id,p.player_id FROM public.ca_promo_event_fee_consumption_receipts p WHERE p.charge_ledger_id=p_charge LOOP
  PERFORM public.fn_ca_promo_profit_settle(r.club_id,r.user_id);
 END LOOP;
END $function$
;
INSERT INTO public.ca_promo_play_through_grants VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000b1');
"""

def main():
    if not (PG / 'initdb').exists():
        sys.exit(f'PostgreSQL 16 binaries not found at {PG}; set PG_BIN')
    tmp = Path(tempfile.mkdtemp(prefix='promo-entry-fee-'))
    data, sock = tmp / 'data', tmp / 'sock'
    sock.mkdir()
    # initdb refuses root: a root container runs the cluster as postgres.
    as_user = []
    if os.geteuid() == 0:
        as_user = ['runuser', '-u', 'postgres', '--']
        subprocess.run(['chown', '-R', 'postgres', str(tmp)], check=True)
    run = lambda *a, **k: subprocess.run(as_user + [str(x) for x in a], check=True, capture_output=True, text=True, **k)
    run(PG / 'initdb', '-D', data, '-U', 'postgres', '--auth=trust')
    with open(data / 'postgresql.conf', 'a') as f:
        f.write(f"\nlisten_addresses=''\nunix_socket_directories='{sock}'\nport=55441\n")
    run(PG / 'pg_ctl', '-D', data, '-l', tmp / 'log', '-w', 'start')
    psql = lambda sql=None, file=None, ok=True: subprocess.run(
        as_user + [str(PG / 'psql'), '-h', str(sock), '-p', '55441', '-U', 'postgres', '-X', '-q', '-At',
         '-v', 'ON_ERROR_STOP=1'] + (['-f', str(file)] if file else ['-c', sql]),
        capture_output=True, text=True, check=ok)
    asserts = 0
    try:
        psql(FIXTURE)
        psql("INSERT INTO public.ca_promo_profit_event_lots VALUES('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000c0de');"
             "INSERT INTO public.ca_promo_event_fee_consumption_receipts VALUES('00000000-0000-0000-0000-00000000c0de','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b2');")
        md5 = psql("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure))").stdout.strip()
        assert md5 == OLD_MD5, f'fixture body md5 {md5} is not production {OLD_MD5}'; asserts += 1

        psql("SELECT public.fn_ca_promo_profit_finish_entry_fee('00000000-0000-0000-0000-00000000c0de')")
        before = psql("SELECT fn||':'||count(*) FROM public.calls GROUP BY fn ORDER BY fn").stdout.split()
        assert before == ['consume:1', 'settle:2'], before; asserts += 1
        psql('TRUNCATE public.calls')

        psql(file=MIGRATION)
        psql("SELECT public.fn_ca_promo_profit_finish_entry_fee('00000000-0000-0000-0000-00000000c0de')")
        after = psql("SELECT fn||':'||count(*) FROM public.calls GROUP BY fn ORDER BY fn").stdout.split()
        assert after == ['consume:1'], after; asserts += 1
        acl = psql("SELECT coalesce(proacl::text,'') FROM pg_proc WHERE oid='public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure").stdout.strip()
        assert 'anon=' not in acl and 'authenticated=' not in acl and 'service_role=' not in acl \
            and not any(e.startswith('=') for e in acl.strip('{}').split(',')), acl; asserts += 1
        new_md5 = psql("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure))").stdout.strip()
        live = MIGRATION.read_text()
        assert f"= '{new_md5}'" in live, f'@live-proof must pin {new_md5}'; asserts += 1

        again = psql(file=MIGRATION, ok=False)
        assert again.returncode != 0 and 'revalidate before removing its settle' in again.stderr, again.stderr; asserts += 1
        still = psql("SELECT md5(pg_get_functiondef('public.fn_ca_promo_profit_finish_entry_fee(uuid)'::regprocedure))").stdout.strip()
        assert still == new_md5; asserts += 1
        print(f'PASS {asserts} assertions; installed definition md5 {new_md5}')
    finally:
        subprocess.run(as_user + [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)

if __name__ == '__main__':
    main()
