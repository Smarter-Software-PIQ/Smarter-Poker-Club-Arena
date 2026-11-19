#!/usr/bin/env python3
"""Native PostgreSQL proof: a retained prepared original is cancelled, not fenced.

Hand delay, 2026-11-19. The engine now saves the prepared original (the seq-0
fn_f06_retain_hand_continuation) under the between-hands rest, and releases a
saved original that a pause meets before it starts through the new
fn_f06_cancel_retained_prepared_hand (migration 20261119053155). This installs
production's exact bodies (scripts/ci/fixtures/f06-retained-prepared-cancel-
production-bodies.sql, md5 of pg_get_functiondef equal to production on
2026-11-19), applies the migration file byte for byte (its own pre-image
guards included) on a throwaway native cluster, and proves:

  * the hazard it removes is real: fn_f06_cancel_prepared_hand on a saved
    original is refused (HAND_CONTINUATION_UNSETTLED) and changes nothing;
  * exactly once: the retained cancel deletes the unstarted capsule, writes one
    receipt and closes the permit never_started; a replay returns the same
    receipt and writes nothing; the plain cancel replays it too;
  * a save still in flight after the cancel is refused by the save itself,
    and a cancel racing an uncommitted save waits for it and then deletes it;
  * no strand: the table's next permit reserves and its seq-0 save lands;
  * refusals change nothing: a started or sequenced capsule, a successor's
    capsule, start evidence, a frozen platform, a changed identity;
  * a permit whose save never landed is cancelled the same way;
  * only service_role may call it.

Lease authority (f06_authority, f06_prefix) is stubbed: proved by its own
suites. This file is about the permit, the capsule and the dispositions.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
PORT = os.environ.get('PG_PORT', '55793')
MIGRATION = ROOT / 'supabase/migrations/20261119053155_a_retained_prepared_hand_is_cancelled_under_the_rest.sql'
BODIES = ROOT / 'scripts/ci/fixtures/f06-retained-prepared-cancel-production-bodies.sql'
PRODUCTION_MD5 = {
    'public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)': '6cea02b2f02dc4e238e7ae17ad0bf9c8',
    'smarter_private.lock_hand_continuation_maintenance_lane()': '60116a44e2044188759e8002b3c80470',
    'smarter_private.assert_hand_continuation_disposition(uuid,bigint)': 'a90dfca8a70260d6fdbeae5ef4ef3830',
    'smarter_private.f06_retained_submission_guard()': '44902103e4c5f0feba7d19081af4325e',
    'public.fn_f06_cancel_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)': '2eaabb545cbc3251be0cef438b08f989',
    'public.fn_f06_retain_hand_continuation(uuid,uuid,uuid,bigint,bigint,text,text)': '64833fbf30f5e2011550f6f59f8a7fab',
}
T = '00000000-0000-4000-8000-0000000000a1'
G = '00000000-0000-4000-8000-0000000000d1'
G2 = '00000000-0000-4000-8000-0000000000d2'
TB = '00000000-0000-4000-8000-0000000000b1'
CUS = '00000000-0000-4000-8000-0000000000e1'
SEATS = [('00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000f001'),
         ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000f002')]
JOINED = '2026-11-19T00:00:00+00:00'
SCHEMA = f"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA smarter_private; CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto SCHEMA extensions;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, f06_lifecycle bigint,
  status text NOT NULL DEFAULT 'running', is_deleted boolean DEFAULT false);
CREATE TABLE public.table_seats(id uuid PRIMARY KEY, table_id uuid, user_id uuid, left_at timestamptz,
  joined_at timestamptz, stack numeric);
CREATE TABLE public.hand_atomic_commits(table_id uuid, hand_number bigint, hand_id uuid, post_commit_completed_at timestamptz);
CREATE TABLE public.hand_history(table_id uuid, hand_number bigint);
CREATE TABLE public.hand_state_snapshots(table_id uuid, hand_number bigint, is_complete boolean);
CREATE TABLE public.hand_private_state(table_id uuid, hand_number bigint);
CREATE TABLE public.table_hole_cards(table_id uuid, hand_number bigint);
CREATE TABLE public.proof_freeze(frozen boolean NOT NULL);
INSERT INTO public.proof_freeze VALUES (false);
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT frozen FROM public.proof_freeze $$;
CREATE TABLE smarter_private.f06_hand_permits(permit_id uuid PRIMARY KEY, tournament_id uuid,
  table_id uuid REFERENCES public.tables(id), lifecycle bigint, hand_number bigint, custody_id uuid,
  generation uuid, state text DEFAULT 'reserved'
  CHECK (state IN ('reserved','accepted','never_started','aborted_unsettled')), evidence_id uuid,
  UNIQUE (table_id, hand_number));
CREATE UNIQUE INDEX f06_one_hand ON smarter_private.f06_hand_permits(table_id) WHERE state='reserved';
CREATE TABLE smarter_private.f06_prepared_hand_cancellations(permit_id uuid PRIMARY KEY, tournament_id uuid,
  generation uuid, table_id uuid, lifecycle bigint, hand_number bigint, custody_id uuid,
  created_at timestamptz DEFAULT clock_timestamp(), UNIQUE (table_id, hand_number));
CREATE TABLE smarter_private.f06_hand_dispatch(permit_id uuid);
CREATE TABLE smarter_private.hand_submissions(table_id uuid, hand_number bigint);
CREATE TABLE smarter_private.hand_submission_dispositions(table_id uuid, hand_number bigint, permit_id uuid,
  disposition text, submission_id uuid, PRIMARY KEY (table_id, hand_number));
CREATE TABLE smarter_private.tournament_abort_hand_dispositions(receipt_id uuid, permit_id uuid, table_id uuid,
  hand_number bigint, original jsonb, boundary jsonb);
-- Same shape as 20261028233353_durable_private_hand_continuation.
CREATE TABLE smarter_private.hand_continuations (
  table_id uuid NOT NULL, hand_number bigint NOT NULL CHECK (hand_number > 0), tournament_id uuid NOT NULL,
  permit_id uuid NOT NULL UNIQUE, original_generation uuid NOT NULL, writer_generation uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence >= 0), payload text NOT NULL CHECK (octet_length(payload) <= 1048576),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{{64}}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (table_id, hand_number));
CREATE UNIQUE INDEX hand_continuation_one_open ON smarter_private.hand_continuations (table_id);
CREATE TABLE smarter_private.hand_continuation_dispositions (
  table_id uuid NOT NULL, hand_number bigint NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('retained', 'disposed')), PRIMARY KEY (table_id, hand_number));
-- The production trigger function also admits two horse-retention rewrites
-- of hand_submissions; on dispositions it always refuses, which is all this needs.
CREATE FUNCTION smarter_private.hand_submission_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'HAND_SUBMISSION_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER hand_continuation_disposition_immutable BEFORE UPDATE OR DELETE ON smarter_private.hand_continuation_dispositions
 FOR EACH ROW EXECUTE FUNCTION smarter_private.hand_submission_immutable();
CREATE FUNCTION smarter_private.f06_authority(t uuid, g uuid, fresh boolean DEFAULT true)
  RETURNS void LANGUAGE sql AS $$ SELECT $$;
CREATE FUNCTION smarter_private.f06_prefix(t uuid, g uuid, users uuid[], ids uuid[])
  RETURNS void LANGUAGE sql AS $$ SELECT 1 FROM public.tables WHERE id=ANY(ids) ORDER BY id FOR UPDATE $$;
INSERT INTO public.tournaments VALUES ('{T}','RUNNING');
INSERT INTO public.tables VALUES ('{TB}','{T}',7);
INSERT INTO public.table_seats VALUES ('{SEATS[0][0]}','{TB}','{SEATS[0][1]}',NULL,'{JOINED}',1000),
  ('{SEATS[1][0]}','{TB}','{SEATS[1][1]}',NULL,'{JOINED}',1000);
"""
TRIGGER = """
CREATE TRIGGER f06_retained_submission_guard AFTER UPDATE OF state ON smarter_private.f06_hand_permits
 FOR EACH ROW EXECUTE FUNCTION smarter_private.f06_retained_submission_guard();
"""


def permit(n):
    return f'00000000-0000-4000-8000-{n:012d}'


def lit(text):
    return "'" + text.replace("'", "''") + "'"


class Cluster:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix='f06-retained-cancel-'))
        self.sock = self.dir / 'sock'
        self.sock.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        self.env['LC_ALL'] = 'C'
        user = []
        if os.geteuid() == 0:
            shutil.chown(self.dir, 'postgres')
            shutil.chown(self.sock, 'postgres')
            user = ['runuser', '-u', 'postgres', '--']
        self.user = user
        subprocess.run(user + [str(PG / 'initdb'), '-D', str(self.dir / 'data'), '-U', 'postgres', '-A', 'trust'],
                       check=True, capture_output=True, env=self.env)
        subprocess.run(user + [str(PG / 'pg_ctl'), '-D', str(self.dir / 'data'), '-w', '-l', str(self.dir / 'log'),
                               '-o', f'-p {PORT} -k {self.sock} -c listen_addresses=', 'start'],
                       check=True, capture_output=True, env=self.env)
        self.cmd = [str(PG / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', str(self.sock), '-p', PORT,
                    '-U', 'postgres', '-d', 'postgres']

    def sql(self, text, ok=True):
        r = subprocess.run(self.cmd, input=text, text=True, capture_output=True, env=self.env, timeout=30)
        if ok and r.returncode != 0:
            raise RuntimeError(r.stderr)
        return r

    def popen(self):
        return subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=self.env)

    def stop(self):
        subprocess.run(self.user + [str(PG / 'pg_ctl'), '-D', str(self.dir / 'data'), '-m', 'immediate', 'stop'],
                       capture_output=True, env=self.env)
        shutil.rmtree(self.dir, ignore_errors=True)


def reserve(n, hand, gen=G):
    return (f"INSERT INTO smarter_private.f06_hand_permits(permit_id,tournament_id,table_id,lifecycle,hand_number,"
            f"custody_id,generation) VALUES ('{permit(n)}','{T}','{TB}',7,{hand},'{CUS}','{gen}');")


def payload(n, hand, seq=0, events=None, started=False):
    return json.dumps({
        'version': 1,
        'original': {'tournament_id': T, 'table_id': TB, 'hand_number': str(hand), 'permit_id': permit(n),
                     'lifecycle': '7', 'custody_id': CUS, 'lease_generation': G},
        'seats': [{'user_id': u, 'seat_id': s, 'seat_joined_at': JOINED, 'stack_before': 1000} for s, u in SEATS],
        'batch': {'version': 1, 'sequence': seq, 'events': events or [], 'engine': {},
                  'controller': json.dumps({'handStarted': started, 'state': {}})},
    }, separators=(',', ':'))


def retain(n, hand, seq=0, events=None, started=False):
    p = payload(n, hand, seq, events, started)
    return (f"SELECT public.fn_f06_retain_hand_continuation('{T}','{G}','{TB}',{hand},{seq},{lit(p)},"
            f"'{hashlib.sha256(p.encode()).hexdigest()}');")


def cancel_retained(n, hand, gen=G, custody=CUS):
    return (f"SELECT public.fn_f06_cancel_retained_prepared_hand('{T}','{gen}','{TB}',7,'{permit(n)}',{hand},'{custody}');")


def cancel_plain(n, hand):
    return f"SELECT public.fn_f06_cancel_prepared_hand('{T}','{G}','{TB}',7,'{permit(n)}',{hand},'{CUS}');"


def main():
    results = []

    def case(name, ok, detail=''):
        results.append({'name': name, 'passed': bool(ok)})
        print(('PASS ' if ok else 'FAIL ') + name + (('  ' + detail) if (detail and not ok) else ''))

    c = Cluster()
    try:
        c.sql(SCHEMA)
        c.sql(BODIES.read_text())
        c.sql(TRIGGER)
        for sig, want in PRODUCTION_MD5.items():
            got = c.sql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
            case('installed ' + sig + ' is the production body', got == want, f'got {got} want {want}')
        r = c.sql(MIGRATION.read_text(), ok=False)
        case('the migration applies byte for byte, its pre-image guards included', r.returncode == 0, r.stderr)
        post = c.sql("SELECT md5(pg_get_functiondef('smarter_private.f06_retained_submission_guard()'::regprocedure)) || ' ' || "
                     "md5(pg_get_functiondef('public.fn_f06_cancel_retained_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)'::regprocedure));").stdout.strip()
        # Production must hold exactly these after the install (post-image).
        case('the post-image md5s are the ones production is checked against',
             post == '9988e9e0293cb44a5a5634fbbbe86948 f4dc105c38a0bc92cb969c7eed4f52d8', post)
        r = c.sql(MIGRATION.read_text(), ok=False)
        case('a second apply is refused by its own guard and changes nothing',
             r.returncode != 0 and 'RETAINED_PREPARED_CANCEL' in r.stderr)

        j = lambda r: json.loads(r.stdout.strip().splitlines()[-1])
        one = lambda q: c.sql(q).stdout.strip()
        state = lambda n: one(f"SELECT state||':'||coalesce(evidence_id::text,'-') FROM smarter_private.f06_hand_permits WHERE permit_id='{permit(n)}';")
        capsules = lambda: int(one('SELECT count(*) FROM smarter_private.hand_continuations;'))
        receipts = lambda: int(one('SELECT count(*) FROM smarter_private.f06_prepared_hand_cancellations;'))

        # The saved, never-started original of hand 100.
        c.sql(reserve(1, 100))
        r = j(c.sql(retain(1, 100)))
        case('the seq-0 save lands a capsule and the retained disposition',
             r['ok'] is True and capsules() == 1 and
             one(f"SELECT disposition FROM smarter_private.hand_continuation_dispositions WHERE hand_number=100;") == 'retained')

        bad = c.sql(cancel_plain(1, 100), ok=False)
        case('the hazard: the plain cancel refuses a saved original and changes nothing',
             bad.returncode != 0 and 'HAND_CONTINUATION_UNSETTLED' in bad.stderr
             and state(1) == 'reserved:-' and capsules() == 1 and receipts() == 0, bad.stderr)

        r1 = j(c.sql(cancel_retained(1, 100)))
        case('the retained cancel closes the permit never_started with its own receipt',
             r1['ok'] is True and r1['state'] == 'never_started' and r1['evidence_id'] == permit(1)
             and r1['hand_number'] == '100' and r1['lifecycle'] == '7' and r1['permit_id'] == permit(1)
             and r1['generation'] == G and r1['custody_id'] == CUS)
        case('the unstarted capsule is gone, one receipt, the hand disposed',
             capsules() == 0 and receipts() == 1 and
             one("SELECT disposition FROM smarter_private.hand_submission_dispositions WHERE hand_number=100;") == 'disposed'
             and one("SELECT disposition FROM smarter_private.hand_continuation_dispositions WHERE hand_number=100;") == 'retained')
        r2 = j(c.sql(cancel_retained(1, 100)))
        case('a replay returns the same receipt and writes nothing', r2 == r1 and receipts() == 1 and capsules() == 0)
        r3 = j(c.sql(cancel_plain(1, 100)))
        case('the plain cancel replays the same receipt', r3 == r1 and receipts() == 1)
        late = c.sql(retain(1, 100), ok=False)
        case('a save arriving after the cancel is refused and lands nothing',
             late.returncode != 0 and 'HAND_CONTINUATION_ORIGINAL_UNPROVEN' in late.stderr and capsules() == 0)

        # No strand: the next number reserves and its save lands.
        c.sql(reserve(2, 101))
        r = j(c.sql(retain(2, 101)))
        case('no strand: the table reserves its next hand and that save lands', r['ok'] is True and capsules() == 1)

        # Refusals change nothing.
        def refused(q, code, n):
            before = (state(n), capsules(), receipts())
            out = c.sql(q, ok=False)
            return out.returncode != 0 and code in out.stderr and (state(n), capsules(), receipts()) == before

        case('a changed identity is refused', refused(cancel_retained(2, 101, custody=permit(77)), 'F06_PREPARED_ORIGINAL_REQUIRED', 2))
        c.sql("UPDATE public.proof_freeze SET frozen=true;")
        case('a frozen platform keeps the capsule', refused(cancel_retained(2, 101), 'PLATFORM_FROZEN', 2))
        c.sql("UPDATE public.proof_freeze SET frozen=false;")
        c.sql(f"INSERT INTO public.hand_history VALUES ('{TB}',101);")
        case('start evidence refuses', refused(cancel_retained(2, 101), 'F06_PREPARED_START_EVIDENCE', 2))
        c.sql("DELETE FROM public.hand_history;")
        c.sql(f"INSERT INTO smarter_private.hand_submissions VALUES ('{TB}',101);")
        case('a submitted hand refuses', refused(cancel_retained(2, 101), 'F06_PREPARED_START_EVIDENCE', 2))
        c.sql("DELETE FROM smarter_private.hand_submissions;")
        j(c.sql(retain(2, 101, seq=1, events=[{'type': 'HAND_START'}], started=True)))
        case('a capsule that carries events (a started hand) refuses',
             refused(cancel_retained(2, 101), 'F06_RETAINED_ORIGINAL_NOT_PREPARED', 2))
        c.sql(f"DELETE FROM smarter_private.hand_continuations;")
        c.sql(f"""INSERT INTO smarter_private.hand_continuations(table_id,hand_number,tournament_id,permit_id,original_generation,
          writer_generation,sequence,payload,payload_sha256) VALUES ('{TB}',101,'{T}','{permit(2)}','{G}','{G}',0,
          {lit(payload(2, 101, started=True))},'{hashlib.sha256(payload(2, 101, started=True).encode()).hexdigest()}');""")
        case('a seq-0 capsule whose controller started refuses',
             refused(cancel_retained(2, 101), 'F06_RETAINED_ORIGINAL_NOT_PREPARED', 2))
        c.sql(f"UPDATE smarter_private.hand_continuations SET writer_generation='{G2}', payload={lit(payload(2, 101))};")
        case("a successor's claimed capsule refuses",
             refused(cancel_retained(2, 101), 'F06_RETAINED_ORIGINAL_NOT_PREPARED', 2))
        c.sql(f"UPDATE smarter_private.hand_continuations SET writer_generation='{G}';")
        r = j(c.sql(cancel_retained(2, 101)))
        case('the same permit, back to its unstarted save, is then released',
             r['state'] == 'never_started' and capsules() == 0 and receipts() == 2)

        # A permit whose save never landed (a lost or refused save).
        c.sql(reserve(3, 102))
        r = j(c.sql(cancel_retained(3, 102)))
        case('a permit whose save never landed is released the same way',
             r['state'] == 'never_started' and receipts() == 3 and capsules() == 0)

        # Races, both orders, on the table lane.
        def race(first, second):
            holder = c.popen()
            holder.stdin.write('BEGIN;\n' + first + '\nSELECT pg_advisory_lock(777);\n')
            holder.stdin.flush()
            deadline = time.monotonic() + 5
            while one("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=777 AND granted);") != 't':
                if time.monotonic() > deadline:
                    raise RuntimeError('holder never reached its barrier')
                time.sleep(0.02)
            racer = c.popen()
            racer.stdin.write(second + '\n')
            racer.stdin.close()
            time.sleep(0.5)
            waited = racer.poll() is None
            holder.stdin.write('COMMIT;\n')
            holder.stdin.close()
            holder.wait(timeout=10)
            out, err = racer.communicate(timeout=10)
            return waited, racer.returncode, out, err

        c.sql(reserve(4, 103))
        waited, code, out, err = race(retain(4, 103), cancel_retained(4, 103))
        case('a cancel racing an uncommitted save waits for it, then deletes it',
             waited and code == 0 and state(4) == f'never_started:{permit(4)}' and capsules() == 0, err)
        c.sql(reserve(5, 104))
        waited, code, out, err = race(cancel_retained(5, 104), retain(5, 104))
        case('a save racing an uncommitted cancel waits, then is refused',
             waited and code != 0 and 'HAND_CONTINUATION_ORIGINAL_UNPROVEN' in err and capsules() == 0
             and state(5) == f'never_started:{permit(5)}', err)

        acl = one("SELECT proacl::text FROM pg_proc WHERE proname='fn_f06_cancel_retained_prepared_hand';")
        case('only service_role may execute it', 'service_role=X' in acl and 'anon' not in acl
             and 'authenticated' not in acl and not acl.startswith('{=X'), acl)
        case('after every case no permit is left reserved and no capsule stranded',
             one("SELECT count(*) FROM smarter_private.f06_hand_permits WHERE state='reserved';") == '0' and capsules() == 0)
    finally:
        c.stop()
    failed = [r for r in results if not r['passed']]
    print(json.dumps({'cases': len(results), 'failed': len(failed)}))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
