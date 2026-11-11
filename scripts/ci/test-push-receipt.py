#!/usr/bin/env python3
"""Native proof for 20261111132958_reliability_push_device_receipts.

Applies the exact migration to a throwaway PostgreSQL cluster (never
production) over minimal copies of the columns it reads from
public.push_outbox, public.push_subscriptions and
smarter_private.reliability_notifications, and proves:

  * a token is minted only for a reliability_* row the dispatcher holds
    ('processing') and only for an active subscription of that row's recipient;
  * a receipt with the right token records received/displayed once, a repeat
    is 'duplicate' and keeps the first timestamps;
  * a wrong token, another device's token, a token for another outbox row and
    an unknown outbox id are all the same 'not_found' and write nothing;
  * a resend replaces the token only while the device has not acknowledged;
  * the view reports device_received / displayed and otherwise push_state;
  * anon and authenticated can execute neither function and read neither the
    table nor the view; service_role can execute both and read neither.
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261111132958_reliability_push_device_receipts.sql'

OWNER = '47965354-0e56-43ef-931c-ddaab82af765'
OTHER = '11111111-1111-4111-8111-111111111111'
PUSH = 'aaaaaaaa-0000-4000-8000-000000000001'
PUSH_SENT = 'aaaaaaaa-0000-4000-8000-000000000002'
PUSH_OTHER_EVENT = 'aaaaaaaa-0000-4000-8000-000000000003'
PUSH_PENDING = 'aaaaaaaa-0000-4000-8000-000000000004'
PUSH_UNKNOWN = 'aaaaaaaa-0000-4000-8000-0000000000ff'
PHONE = 'bbbbbbbb-0000-4000-8000-000000000001'
MAC = 'bbbbbbbb-0000-4000-8000-000000000002'
RETIRED = 'bbbbbbbb-0000-4000-8000-000000000003'
STRANGER = 'bbbbbbbb-0000-4000-8000-000000000004'
T_PHONE = 'a' * 64
T_MAC = 'b' * 64
T_STRANGER = 'c' * 64
T_RESEND = 'd' * 64
FORGED = 'e' * 64

FIXTURE = f"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA smarter_private;
-- Production grants USAGE on smarter_private to all three API roles.
GRANT USAGE ON SCHEMA smarter_private TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's default ACL hands EXECUTE on every new public function to anon
-- and authenticated; the migration must revoke it explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.push_outbox (
  id uuid PRIMARY KEY, recipient_user_id uuid, event text, status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, endpoint text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE smarter_private.reliability_notifications (
  id bigint PRIMARY KEY, incident_id uuid, kind text NOT NULL, push_outbox_id uuid,
  push_state text NOT NULL DEFAULT 'not_requested', created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.push_outbox (id, recipient_user_id, event, status) VALUES
  ('{PUSH}', '{OWNER}', 'reliability_escalation', 'processing'),
  ('{PUSH_SENT}', '{OWNER}', 'reliability_escalation', 'sent'),
  ('{PUSH_OTHER_EVENT}', '{OWNER}', 'new_message', 'processing'),
  ('{PUSH_PENDING}', '{OWNER}', 'reliability_escalation', 'pending');
INSERT INTO public.push_subscriptions (id, user_id, endpoint, is_active) VALUES
  ('{PHONE}', '{OWNER}', 'https://web.push.apple.com/x', true),
  ('{MAC}', '{OWNER}', 'https://fcm.googleapis.com/x', true),
  ('{RETIRED}', '{OWNER}', 'https://fcm.googleapis.com/y', false),
  ('{STRANGER}', '{OTHER}', 'https://fcm.googleapis.com/z', true);
INSERT INTO smarter_private.reliability_notifications (id, kind, push_outbox_id, push_state) VALUES
  (1, 'escalation', '{PUSH}', 'claimed'),
  (2, 'escalation', '{PUSH_SENT}', 'provider_accepted'),
  (3, 'escalation', NULL, 'not_requested');
"""


def pg_bin(name):
    for candidate in (os.environ.get('PG_BIN'), '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'):
        if candidate and Path(candidate, name).exists():
            return str(Path(candidate, name))
    found = shutil.which(name)
    if not found:
        raise SystemExit(f'{name} (PostgreSQL) is required')
    return found


def main():
    os.environ.setdefault('LC_ALL', 'C')
    os.environ.setdefault('LANG', 'C')
    scratch = Path(tempfile.mkdtemp(prefix='push-receipt-', dir=os.environ.get('RUNNER_TEMP') or os.environ.get('TMPDIR')))
    data = scratch / 'data'
    sock = Path(tempfile.mkdtemp(prefix='pgs', dir='/tmp'))
    subprocess.run([pg_bin('initdb'), '-D', str(data), '-U', 'postgres', '-A', 'trust', '--no-locale', '-E', 'UTF8'],
                   check=True, capture_output=True)
    port = str(50000 + os.getpid() % 5000)
    subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-o', f"-k {sock} -p {port} -c listen_addresses=''",
                    '-l', str(scratch / 'log'), '-w', 'start'], check=True, capture_output=True)
    passed = []
    try:
        def psql(args, text=None):
            return subprocess.run([pg_bin('psql'), '-h', str(sock), '-p', port, '-U', 'postgres', '-d', 'postgres',
                                   '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', *args],
                                  input=text, capture_output=True, text=True)

        def sql(text):
            r = psql(['-c', text])
            assert r.returncode == 0, f'{text}\n{r.stderr}'
            return r.stdout.strip()

        def as_role(role, text):
            return psql(['-c', f'SET ROLE {role}; {text}'])

        def mint(outbox, sub, token):
            return sql(f"SELECT public.fn_mint_push_receipt('{outbox}', '{sub}', '{token}')")

        def record(outbox, token, stage='displayed'):
            return json.loads(sql(f"SELECT public.fn_record_push_receipt('{outbox}', '{token}', '{stage}')::text"))

        def rows():
            return int(sql('SELECT count(*) FROM smarter_private.push_device_receipts'))

        def ok(name):
            passed.append(name)

        r = psql(['-f', '-'], FIXTURE)
        assert r.returncode == 0, r.stderr
        r = psql(['-f', str(MIGRATION)])
        assert r.returncode == 0, r.stderr
        ok('migration installs over the production shape and its postimage checks pass')

        assert sql('SELECT string_agg(delivery_state, \',\' ORDER BY notification_id) FROM smarter_private.reliability_notification_device_receipts') == 'claimed,provider_accepted,not_requested'
        ok('before any receipt delivery_state is exactly push_state')

        # ---- minting
        assert mint(PUSH, PHONE, T_PHONE) == 't'
        assert mint(PUSH, MAC, T_MAC) == 't'
        assert mint(PUSH_SENT, PHONE, 'f' * 64) == 'f', 'a row the dispatcher no longer holds is not minted'
        assert mint(PUSH_PENDING, PHONE, 'f' * 64) == 'f', 'an unclaimed row is not minted'
        assert mint(PUSH_OTHER_EVENT, PHONE, 'f' * 64) == 'f', 'only reliability_* events are minted'
        assert mint(PUSH, RETIRED, 'f' * 64) == 'f', 'a retired subscription is not minted'
        assert mint(PUSH, STRANGER, T_STRANGER) == 'f', "another user's device is not minted"
        assert mint(PUSH_UNKNOWN, PHONE, 'f' * 64) == 'f'
        assert mint(PUSH, PHONE, 'not-a-sha') == 'f' and mint(PUSH, PHONE, 'A' * 64) == 'f'
        assert rows() == 2
        ok('mint: only a claimed reliability row, only an active device of its own recipient, only a sha256')

        # ---- forged / unknown are one answer and write nothing
        nf = {'ok': False, 'result': 'not_found'}
        assert record(PUSH, FORGED) == nf
        assert record(PUSH, T_STRANGER) == nf
        assert record(PUSH_UNKNOWN, T_PHONE) == nf, 'a real token on an unknown id'
        assert record(PUSH_SENT, T_PHONE) == nf, 'a real token on another outbox row'
        assert record(PUSH, 'zz') == nf
        assert record(PUSH, T_PHONE, 'read') == {'ok': False, 'result': 'invalid'}
        assert sql('SELECT count(*) FROM smarter_private.push_device_receipts WHERE received_at IS NOT NULL OR ack_count > 0') == '0'
        ok('a forged token, a stranger token, an unknown id and a cross-row token are the same not_found and write nothing')

        # ---- received then displayed, idempotent
        assert record(PUSH, T_MAC, 'received') == {'ok': True, 'result': 'recorded', 'stage': 'received'}
        assert sql('SELECT delivery_state FROM smarter_private.reliability_notification_device_receipts WHERE notification_id = 1') == 'device_received'
        assert record(PUSH, T_MAC, 'received') == {'ok': True, 'result': 'duplicate', 'stage': 'received'}
        first = sql(f"SELECT received_at FROM smarter_private.push_device_receipts WHERE subscription_id = '{MAC}'")
        assert record(PUSH, T_PHONE, 'displayed') == {'ok': True, 'result': 'recorded', 'stage': 'displayed'}
        disp = sql(f"SELECT displayed_at FROM smarter_private.push_device_receipts WHERE subscription_id = '{PHONE}'")
        assert record(PUSH, T_PHONE, 'displayed') == {'ok': True, 'result': 'duplicate', 'stage': 'displayed'}
        assert record(PUSH, T_PHONE, 'received') == {'ok': True, 'result': 'duplicate', 'stage': 'displayed'}
        assert sql(f"SELECT displayed_at FROM smarter_private.push_device_receipts WHERE subscription_id = '{PHONE}'") == disp
        assert sql(f"SELECT received_at FROM smarter_private.push_device_receipts WHERE subscription_id = '{MAC}'") == first
        assert sql(f"SELECT ack_count FROM smarter_private.push_device_receipts WHERE subscription_id = '{PHONE}'") == '3'
        assert record(PUSH, T_MAC, 'displayed') == {'ok': True, 'result': 'recorded', 'stage': 'displayed'}
        ok('receipts are idempotent: first received_at and displayed_at are kept, repeats answer duplicate')

        v = sql("SELECT delivery_state || ' ' || push_state || ' ' || devices_minted || ' ' || devices_received || ' ' || devices_displayed "
                "FROM smarter_private.reliability_notification_device_receipts WHERE notification_id = 1")
        assert v == 'displayed claimed 2 2 2', v
        assert sql("SELECT delivery_state || ' ' || devices_minted FROM smarter_private.reliability_notification_device_receipts WHERE notification_id = 2") == 'provider_accepted 0'
        assert sql("SELECT delivery_state FROM smarter_private.reliability_notification_device_receipts WHERE notification_id = 3") == 'not_requested'
        assert sql("SELECT push_state FROM smarter_private.reliability_notifications WHERE id = 1") == 'claimed', 'the mirror table is never written'
        ok('the view reports displayed / device_received and never writes reliability_notifications')

        # ---- resend: token replaced only while unacknowledged
        sql(f"INSERT INTO public.push_subscriptions (id, user_id, is_active) VALUES ('bbbbbbbb-0000-4000-8000-000000000005', '{OWNER}', true)")
        assert mint(PUSH, 'bbbbbbbb-0000-4000-8000-000000000005', '1' * 64) == 't'
        assert mint(PUSH, 'bbbbbbbb-0000-4000-8000-000000000005', T_RESEND) == 't'
        assert record(PUSH, '1' * 64) == nf, 'the superseded token is dead'
        assert record(PUSH, T_RESEND)['result'] == 'recorded'
        assert mint(PUSH, PHONE, '2' * 64) == 'f', 'an acknowledged device keeps its receipt'
        assert record(PUSH, T_PHONE)['result'] == 'duplicate'
        ok('a resend replaces the token only while the device has not acknowledged')

        # ---- grants
        for role in ('anon', 'authenticated'):
            for call in (f"SELECT public.fn_record_push_receipt('{PUSH}', '{T_PHONE}', 'displayed')",
                         f"SELECT public.fn_mint_push_receipt('{PUSH}', '{PHONE}', '{'3' * 64}')",
                         'SELECT count(*) FROM smarter_private.push_device_receipts',
                         'SELECT count(*) FROM smarter_private.reliability_notification_device_receipts'):
                r = as_role(role, call)
                assert r.returncode != 0 and 'permission denied' in r.stderr, (role, call, r.stdout, r.stderr)
        r = as_role('service_role', f"SELECT public.fn_record_push_receipt('{PUSH}', '{T_PHONE}', 'displayed')::text")
        assert r.returncode == 0 and '"duplicate"' in r.stdout, r.stderr
        r = as_role('service_role', 'SELECT count(*) FROM smarter_private.push_device_receipts')
        assert r.returncode != 0 and 'permission denied' in r.stderr
        assert sql("SELECT count(*) FROM pg_proc WHERE proname IN ('fn_record_push_receipt', 'fn_mint_push_receipt') AND prosecdef") == '2'
        ok('anon and authenticated execute and read nothing; service_role executes both functions only')

        # ---- the @live-proof expression holds on the installed shape
        proof = next(l for l in MIGRATION.read_text().splitlines() if l.startswith('-- @live-proof: '))[len('-- @live-proof: '):]
        assert sql(f'SELECT {proof}') == 't'
        ok('@live-proof evaluates true')
    finally:
        subprocess.run([pg_bin('pg_ctl'), '-D', str(data), '-m', 'immediate', 'stop'], capture_output=True)
        shutil.rmtree(scratch, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    for name in passed:
        print(f'PASS {name}')
    print(f'{len(passed)} checks passed')


if __name__ == '__main__':
    main()
