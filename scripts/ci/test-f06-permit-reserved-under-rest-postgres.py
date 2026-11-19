#!/usr/bin/env python3
"""Native PostgreSQL proof for the F06 permit lifecycle a deal reserves under the rest.

Hand delay, 2026-11-18. The engine now calls fn_f06_hand_number_state and
fn_f06_begin_hand inside the last second of the between-hands rest, and
releases a permit it reserved and did not deal through
fn_f06_cancel_prepared_hand. It also treats a begin refusal that names a
reason as proof that no permit exists (F06HandPermit.PRE_INSERT_REFUSALS).
This runs the repository's own function bodies (latest migration defining
each) on a throwaway native cluster and proves:

  * every named refusal returns before the insert: no row, no permit_id key;
  * the reasons SQL can return are exactly the engine's PRE_INSERT_REFUSALS;
  * an exact replay of a committed begin is FOUND (ok, no reason), and an
    existing row in another state carries no reason - never a refusal;
  * a replay racing an uncommitted begin of the same permit waits on the
    table lane and then sees the row: a refusal can never be read while the
    permit is being inserted;
  * one reserved permit per table; the cancellation releases it exactly once,
    a replay returns the same receipt, a second cancellation row is impossible,
    and the slot is free for the next number;
  * cancellation refuses a permit with start evidence and changes nothing;
  * hand_number_state reports the unresolved permit and the break exclusion
    the engine's admission reads.

Lease authority (smarter_private.f06_authority) is stubbed to a no-op: it is
proved by its own suites; this file is about the permit row.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/usr/lib/postgresql/16/bin'))
PORT = os.environ.get('PG_PORT', '55791')
SOURCES = {
    'public.fn_ca_lock_settlement_lane_for_tournament':
        '20260910173147_the_settlement_lane_is_per_tournament_for_rolling_authorities.sql',
    'smarter_private.f06_prefix':
        '20260912100322_tournament_break_original_custody_and_hand_authority.sql',
    'public.fn_ca_f06_share_table_lane':
        '20261003230910_a_tournament_table_s_hand_does_not_wait_for_its_sibling_tabl.sql',
    'public.fn_f06_hand_number_state':
        '20260918053310_interrupted_sng_hands_keep_stacks_and_fence_their_original_writers.sql',
    'public.fn_f06_begin_hand':
        '20261031161513_tournament_original_twenty_can_withdraw_unsettled_abort.sql',
    'public.fn_f06_cancel_prepared_hand':
        '20260918071546_f06_original_preparation_cancellations_survive_maintenance_r.sql',
}
# Later migrations that rewrite a body in place (EXECUTE replace(...)) rather
# than re-declare it; applied to the extracted text in the same way.
TRANSFORMS = {
    'public.fn_f06_hand_number_state': [
        # 20261003230910_a_tournament_table_s_hand_does_not_wait_for_its_sibling_tabl.sql
        (" PERFORM smarter_private.f06_prefix(p_tournament_id,p_lease_generation,'{}',ARRAY[p_table_id]);\n",
         " /* A TABLE'S HAND DOES NOT WAIT FOR ITS SIBLING TABLES (2026-10-03): the\n"
         "    tournament lane T(id) shared, then this table and its seats FOR\n"
         "    UPDATE. See fn_ca_f06_share_table_lane. */\n"
         " PERFORM public.fn_ca_f06_share_table_lane(p_tournament_id,p_lease_generation,p_table_id);\n"),
        # 20261029062111_project_the_original_f06_permit_evidence_identity.sql
        ("'generation',h.generation,'state',h.state)",
         "'generation',h.generation,'state',h.state,'evidence_id',h.evidence_id)"),
    ],
}
SIGNATURES = {
    'public.fn_f06_hand_number_state': 'public.fn_f06_hand_number_state(uuid,uuid,uuid)',
}


def lit(text):
    return "'" + text.replace("'", "''") + "'"


PRODUCTION_MD5 = {
    'public.fn_f06_begin_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)': '903c9322cc0069ecf8ad9291408d18d6',
    'public.fn_f06_cancel_prepared_hand(uuid,uuid,uuid,bigint,uuid,bigint,uuid)': '2eaabb545cbc3251be0cef438b08f989',
    'public.fn_f06_hand_number_state(uuid,uuid,uuid)': '570441684fd001cd76d4591e04194b98',
    'public.fn_ca_f06_share_table_lane(uuid,uuid,uuid)': '7ac5aeac3454c71ded85ff88655a3357',
    'public.fn_ca_lock_settlement_lane_for_tournament(uuid,uuid)': '9877846ffabee004690e6b24a3ddcee2',
    'smarter_private.f06_prefix(uuid,uuid,uuid[],uuid[])': 'dae9d5b5f71a68362f202dfdf89c8fae',
}
SCHEMA = """
CREATE SCHEMA smarter_private;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY, status text NOT NULL);
CREATE TABLE public.tables(id uuid PRIMARY KEY, tournament_id uuid, club_id uuid, f06_lifecycle bigint,
  status text NOT NULL DEFAULT 'active', is_deleted boolean DEFAULT false);
CREATE TABLE public.table_seats(id bigint PRIMARY KEY, table_id uuid, user_id uuid, stack numeric);
CREATE TABLE public.tournament_players(id bigint PRIMARY KEY, tournament_id uuid, user_id uuid);
CREATE TABLE public.hand_atomic_commits(table_id uuid, hand_number bigint, hand_id uuid, post_commit_completed_at timestamptz);
CREATE TABLE public.hand_history(table_id uuid, hand_number bigint);
CREATE TABLE public.hand_state_snapshots(table_id uuid, hand_number bigint, is_complete boolean);
CREATE TABLE public.hand_private_state(table_id uuid, hand_number bigint);
CREATE TABLE public.table_hole_cards(table_id uuid, hand_number bigint);
CREATE TABLE public.ca_diamond_arena_owner_closure(club_id uuid, closed boolean);
CREATE TABLE smarter_private.f06_hand_permits(permit_id uuid PRIMARY KEY, tournament_id uuid,
  table_id uuid REFERENCES public.tables(id), lifecycle bigint, hand_number bigint, custody_id uuid,
  generation uuid, state text DEFAULT 'reserved'
  CHECK (state IN ('reserved','accepted','never_started','aborted_unsettled')), evidence_id uuid,
  UNIQUE (table_id, hand_number));
CREATE UNIQUE INDEX f06_one_hand ON smarter_private.f06_hand_permits(table_id) WHERE state='reserved';
CREATE TABLE smarter_private.f06_prepared_hand_cancellations(permit_id uuid PRIMARY KEY, tournament_id uuid,
  generation uuid, table_id uuid, lifecycle bigint, hand_number bigint, custody_id uuid,
  created_at timestamptz DEFAULT clock_timestamp(), UNIQUE (table_id, hand_number));
CREATE TABLE smarter_private.f06_absent_permit_releases(permit_id uuid);
CREATE TABLE smarter_private.f06_operations(source_table_id uuid, state text, lifecycle bigint,
  custody_id uuid, custody_generation uuid, revision int);
CREATE TABLE smarter_private.tournament_abort_targets(tournament_id uuid, operation_id uuid);
CREATE TABLE smarter_private.tournament_abort_recoveries(tournament_id uuid, operation_id uuid);
CREATE TABLE smarter_private.f06_hand_dispatch(permit_id uuid);
CREATE FUNCTION smarter_private.f06_authority(t uuid, g uuid, fresh boolean DEFAULT true)
  RETURNS void LANGUAGE sql AS $$ SELECT $$;
INSERT INTO public.tournaments VALUES ('00000000-0000-4000-8000-0000000000a1','RUNNING');
INSERT INTO public.tables VALUES ('00000000-0000-4000-8000-0000000000b1','00000000-0000-4000-8000-0000000000a1',
  '00000000-0000-4000-8000-0000000000c1',7);
INSERT INTO public.table_seats VALUES (1,'00000000-0000-4000-8000-0000000000b1',NULL,100);
"""
T = '00000000-0000-4000-8000-0000000000a1'
G = '00000000-0000-4000-8000-0000000000d1'
TB = '00000000-0000-4000-8000-0000000000b1'
CUS = '00000000-0000-4000-8000-0000000000e1'


def permit(n):
    return f'00000000-0000-4000-8000-{n:012d}'


def function_sql(name, file):
    text = (ROOT / 'supabase/migrations' / file).read_text()
    bare = name.split('.')[-1]
    m = None
    for m in re.finditer(r'CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.|smarter_private\.)?' + re.escape(bare) + r'\s*\(', text):
        pass
    if not m:
        raise RuntimeError(f'{name} not defined in {file}')
    start = m.start()
    tag = re.search(r'AS\s+(\$[A-Za-z0-9_]*\$)', text[start:])
    if not tag:
        raise RuntimeError(f'{name}: no dollar-quoted body')
    body_start = start + tag.end()
    end = text.index(tag.group(1), body_start) + len(tag.group(1))
    # A body may be wrapped in an outer EXECUTE $owner_...$ ... $owner_...$;
    # the function ends at its own closing tag either way.
    sql = text[start:end] + ';'
    if name.startswith('smarter_private.') and 'smarter_private.' + bare not in sql[:200]:
        sql = sql.replace('FUNCTION ' + bare, 'FUNCTION smarter_private.' + bare, 1)
    return sql


class Cluster:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix='f06-under-rest-'))
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

    def stop(self):
        subprocess.run(self.user + [str(PG / 'pg_ctl'), '-D', str(self.dir / 'data'), '-m', 'immediate', 'stop'],
                       capture_output=True, env=self.env)
        shutil.rmtree(self.dir, ignore_errors=True)


def begin(n, hand):
    return (f"SELECT public.fn_f06_begin_hand('{T}','{G}','{TB}',7,'{permit(n)}',{hand},'{CUS}');")


def cancel(n, hand):
    return (f"SELECT public.fn_f06_cancel_prepared_hand('{T}','{G}','{TB}',7,'{permit(n)}',{hand},'{CUS}');")


def main():
    results = []

    def case(name, ok, detail=''):
        results.append({'name': name, 'passed': bool(ok)})
        print(('PASS ' if ok else 'FAIL ') + name + (('  ' + detail) if (detail and not ok) else ''))

    c = Cluster()
    try:
        c.sql(SCHEMA)
        for name, file in SOURCES.items():
            c.sql(function_sql(name, file))
            # Migrations that rewrote a body in place did it on
            # pg_get_functiondef: replay them the same way.
            for old, new in TRANSFORMS.get(name, []):
                sig = SIGNATURES[name]
                c.sql(f"""DO $t$ DECLARE d text := pg_get_functiondef('{sig}'::regprocedure); BEGIN
  IF (length(d) - length(replace(d, {lit(old)}, ''))) / length({lit(old)}) <> 1 THEN
    RAISE EXCEPTION 'transform pre-image not found exactly once for {sig}'; END IF;
  EXECUTE replace(d, {lit(old)}, {lit(new)}); END $t$;""")
        # The bodies installed here are byte-for-byte production's: the md5 of
        # pg_get_functiondef read from production kuklfnapbkmacvwxktbh on
        # 2026-11-18 (fn_f06_begin_hand's also equals the post-image its own
        # migration asserts). A later migration that changes one of them must
        # update this file, or this proof is no longer about production.
        for sig, want in PRODUCTION_MD5.items():
            got = c.sql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
            case('installed ' + sig + ' is the production body', got == want, f'got {got} want {want}')
        rows = lambda: int(c.sql('SELECT count(*) FROM smarter_private.f06_hand_permits;').stdout)
        j = lambda r: json.loads(r.stdout.strip().splitlines()[-1])

        state = j(c.sql(f"SELECT public.fn_f06_hand_number_state('{T}','{G}','{TB}');"))
        case('a fresh table can reserve', state['can_reserve'] is True and state['blocked_reason'] is None)

        r = j(c.sql(begin(1, 100)))
        case('begin reserves', r['ok'] is True and r['state'] == 'reserved' and rows() == 1)
        r = j(c.sql(begin(1, 100)))
        case('an exact replay is FOUND, not refused', r['ok'] is True and 'reason' not in r and rows() == 1)
        state = j(c.sql(f"SELECT public.fn_f06_hand_number_state('{T}','{G}','{TB}');"))
        case('the admission read reports the unresolved permit',
             state['blocked_reason'] == 'hand_permit_unresolved' and state['can_reserve'] is False)
        r = j(c.sql(begin(2, 101)))
        case('a second permit is refused before insert',
             r == {'ok': False, 'reason': 'hand_permit_unresolved'} and rows() == 1)

        r = j(c.sql(cancel(1, 100)))
        case('cancellation releases the reserved permit',
             r['ok'] is True and r['state'] == 'never_started' and r['evidence_id'] == permit(1))
        r2 = j(c.sql(cancel(1, 100)))
        n_cancel = int(c.sql('SELECT count(*) FROM smarter_private.f06_prepared_hand_cancellations;').stdout)
        case('a replayed cancellation returns the same receipt, once', r2 == r and n_cancel == 1)
        r = j(c.sql(begin(1, 100)))
        case('the released permit replays as a row with no reason (never a refusal)',
             r['ok'] is False and 'reason' not in r and r['permit_id'] == permit(1))
        r = j(c.sql(begin(3, 100)))
        case('a used number is refused before insert', r == {'ok': False, 'reason': 'hand_number_already_used'})
        r = j(c.sql(begin(3, 101)))
        case('the slot is free for the next number', r['ok'] is True and rows() == 2)
        c.sql(cancel(3, 101))

        # Each refusal reason: returned before the insert, no permit_id key, no row.
        def refused(setup, teardown, reason, n, hand):
            c.sql(setup)
            before = rows()
            out = j(c.sql(begin(n, hand)))
            c.sql(teardown)
            return out == {'ok': False, 'reason': reason} and rows() == before

        case('source_excluded is refused before insert', refused(
            f"INSERT INTO smarter_private.f06_operations VALUES ('{TB}','begun',7,NULL,NULL,0);",
            'DELETE FROM smarter_private.f06_operations;', 'source_excluded', 4, 102))
        case('diamond_arena_closed is refused before insert', refused(
            "INSERT INTO public.ca_diamond_arena_owner_closure VALUES ('00000000-0000-4000-8000-0000000000c1',true);",
            'DELETE FROM public.ca_diamond_arena_owner_closure;', 'diamond_arena_closed', 5, 102))
        case('permit_released_absent is refused before insert', refused(
            f"INSERT INTO smarter_private.f06_absent_permit_releases VALUES ('{permit(6)}');",
            'DELETE FROM smarter_private.f06_absent_permit_releases;', 'permit_released_absent', 6, 102))
        case('operator_abort_stopped is refused before insert', refused(
            f"INSERT INTO smarter_private.tournament_abort_targets VALUES ('{T}','{permit(99)}');",
            'DELETE FROM smarter_private.tournament_abort_targets;', 'operator_abort_stopped', 7, 102))
        state_sql = f"INSERT INTO smarter_private.f06_operations VALUES ('{TB}','begun',7,NULL,NULL,0);"
        c.sql(state_sql)
        state = j(c.sql(f"SELECT public.fn_f06_hand_number_state('{T}','{G}','{TB}');"))
        c.sql('DELETE FROM smarter_private.f06_operations;')
        case('the admission read reports a break source exclusion', state['blocked_reason'] == 'source_excluded')

        body = function_sql('public.fn_f06_begin_hand', SOURCES['public.fn_f06_begin_hand'])
        sql_reasons = set(re.findall(r"'reason','([a-z_]+)'", body))
        ts = (ROOT / 'server/src/services/F06HandPermit.ts').read_text()
        block = ts[ts.index('PRE_INSERT_REFUSALS: ReadonlySet<string> = new Set(['):]
        block = block[:block.index(']);')]
        ts_reasons = set(re.findall(r"'([a-z_]+)'", block))
        case('SQL refusal reasons equal the engine PRE_INSERT_REFUSALS', sql_reasons == ts_reasons,
             f'sql={sorted(sql_reasons)} ts={sorted(ts_reasons)}')

        # Start evidence refuses a cancellation and changes nothing.
        r = j(c.sql(begin(8, 103)))
        c.sql(f"INSERT INTO public.hand_history VALUES ('{TB}',103);")
        bad = c.sql(cancel(8, 103), ok=False)
        st = c.sql(f"SELECT state FROM smarter_private.f06_hand_permits WHERE permit_id='{permit(8)}';").stdout.strip()
        case('cancellation refuses a permit with start evidence and changes nothing',
             bad.returncode != 0 and 'F06_PREPARED_START_EVIDENCE' in bad.stderr and st == 'reserved')
        c.sql(f"DELETE FROM public.hand_history; UPDATE smarter_private.f06_hand_permits SET state='never_started', evidence_id=permit_id WHERE permit_id='{permit(8)}';")

        # A replay racing an uncommitted begin of the same permit waits on the
        # table lane and then sees the row: it can never read a refusal.
        holder = subprocess.Popen(c.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, env=c.env)
        holder.stdin.write('BEGIN;\n' + begin(9, 104) + '\nSELECT pg_advisory_lock(777);\n')
        holder.stdin.flush()
        deadline = time.monotonic() + 5
        while c.sql("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=777 AND granted);").stdout.strip() != 't':
            if time.monotonic() > deadline:
                raise RuntimeError('holder never reached its barrier')
            time.sleep(0.02)
        racer = subprocess.Popen(c.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=c.env)
        racer.stdin.write(begin(9, 104) + '\n')
        racer.stdin.close()
        time.sleep(0.5)
        waited = racer.poll() is None
        holder.stdin.write('COMMIT;\n')
        holder.stdin.close()
        holder.wait(timeout=10)
        out, err = racer.communicate(timeout=10)
        raced = json.loads(out.strip().splitlines()[-1])
        case('a replay racing an uncommitted begin waits, then sees the row',
             waited and raced['ok'] is True and raced['permit_id'] == permit(9) and 'reason' not in raced, err)
        c.sql(cancel(9, 104))
        case('after every case no permit is left reserved',
             c.sql("SELECT count(*) FROM smarter_private.f06_hand_permits WHERE state='reserved';").stdout.strip() == '0')
    finally:
        c.stop()
    failed = [r for r in results if not r['passed']]
    print(json.dumps({'cases': len(results), 'failed': len(failed)}))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
