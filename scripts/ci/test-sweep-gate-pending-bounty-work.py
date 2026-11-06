#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261106034328 (the sweep gate reads pending bounty work).

The EXACT migration runs over a minimal schema. The marker prover and the full
re-proof are stand-ins with the production signatures: the marker stand-in
COUNTS its calls, which is what this proves the new gate does not do on every
settled obligation.

  * pending obligation -> true; open mystery award (reserved, revealed, paid) -> true;
  * settled obligations with complete markers -> false, without proving them;
  * a settled obligation whose marker is incomplete and that settled in the last
    ten minutes -> true (fresh drift is still caught by the gate);
  * an older drifted marker -> false here, and the untouched full re-proof
    (fn_tournament_has_unsettled_bounties) still answers true, so every finish
    that calls it still refuses;
  * another tournament's work never answers for this one;
  * only service_role may execute it; a replay of the migration is refused.
"""
from pathlib import Path
import os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261106034328_the_sweep_gate_reads_pending_bounty_work_not_every_marker.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='sweep-gate-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 41) % 9000)
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql)


SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournament_bounty_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, state text,
  settled_at timestamptz, marker_complete boolean DEFAULT true);
CREATE TABLE public.tournament_bounty_awards(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, status text);
CREATE TABLE public.marker_calls(n integer);
INSERT INTO public.marker_calls VALUES (0);
CREATE FUNCTION public.fn_bounty_obligation_has_complete_marker(p_obligation_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  UPDATE public.marker_calls SET n = n + 1;
  RETURN (SELECT marker_complete FROM public.tournament_bounty_obligations WHERE id = p_obligation_id);
END $$;
-- The production full re-proof, verbatim in shape: every settled row is proved.
CREATE FUNCTION public.fn_tournament_has_unsettled_bounties(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.tournament_bounty_obligations o
                  WHERE o.tournament_id=p_tournament_id AND o.state='pending')
      OR EXISTS (SELECT 1 FROM public.tournament_bounty_obligations o
                  WHERE o.tournament_id=p_tournament_id AND o.state='settled'
                    AND NOT public.fn_bounty_obligation_has_complete_marker(o.id))
      OR EXISTS (SELECT 1 FROM public.tournament_bounty_awards a
                  WHERE a.tournament_id=p_tournament_id AND a.status IN ('reserved','revealed','paid'));
$$;
"""

T = '7e000000-0000-0000-0000-0000000000%02d'


def gate(t):
    return q(f"SELECT public.fn_tournament_has_pending_bounty_work('{t}');").strip()


def full(t):
    return q(f"SELECT public.fn_tournament_has_unsettled_bounties('{t}');").strip()


def calls():
    return int(q("SELECT n FROM marker_calls;").strip())


def settled(t, n, age='1 hour', complete=True):
    q(f"""INSERT INTO tournament_bounty_obligations(tournament_id,state,settled_at,marker_complete)
          SELECT '{t}','settled',clock_timestamp() - interval '{age}',{str(complete).lower()}
            FROM generate_series(1,{n});""")


try:
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    q(MIG.read_text())

    # 400 paid knockouts, all complete: no work, and not one marker re-proved.
    t1 = T % 1
    settled(t1, 400)
    before = calls()
    assert gate(t1) == 'f'
    assert calls() == before, 'the gate re-proved settled markers'
    # The full re-proof still walks every one (the cost the gate no longer pays).
    assert full(t1) == 'f' and calls() - before == 400

    # Pending work answers true.
    t2 = T % 2
    settled(t2, 3)
    q(f"INSERT INTO tournament_bounty_obligations(tournament_id,state) VALUES ('{t2}','pending');")
    assert gate(t2) == 't'
    for status, expect in (('reserved', 't'), ('revealed', 't'), ('paid', 't'), ('settled', 'f'), ('void', 'f')):
        t = T % (10 + len(status))
        q(f"DELETE FROM tournament_bounty_awards; INSERT INTO tournament_bounty_awards(tournament_id,status) VALUES ('{t}','{status}');")
        assert gate(t) == expect, (status, gate(t))

    # Fresh drift is caught by the gate; older drift is left to every finish.
    t3 = T % 3
    settled(t3, 50)
    settled(t3, 1, age='2 minutes', complete=False)
    assert gate(t3) == 't'
    t4 = T % 4
    settled(t4, 50)
    settled(t4, 1, age='3 hours', complete=False)
    assert gate(t4) == 'f'
    assert full(t4) == 't', 'the finish re-proof must still refuse older drift'

    # Another tournament's work never answers for this one.
    t5 = T % 5
    assert gate(t5) == 'f'

    grants = q("""SELECT has_function_privilege('authenticated','public.fn_tournament_has_pending_bounty_work(uuid)','execute')
                  ||'|'||has_function_privilege('anon','public.fn_tournament_has_pending_bounty_work(uuid)','execute')
                  ||'|'||has_function_privilege('service_role','public.fn_tournament_has_pending_bounty_work(uuid)','execute');""").strip()
    assert grants == 'false|false|true', grants
    try:
        q(MIG.read_text())
        raise AssertionError('a replay of the migration was accepted')
    except RuntimeError as error:
        assert 'already installed' in str(error), str(error)
    print('sweep gate: pending work, open awards and fresh drift answer true; 400 settled markers proved 0 times - OK')
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
