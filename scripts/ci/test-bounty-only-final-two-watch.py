#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261106032337 (the bounty only final two payout is watched).

Owner rule (Dan, 2026-11-05): a bounty only PKO ends with two players and both
keep the bounty on their own head. The EXACT migration runs over a minimal
schema shaped like production's and proves the watch:

  * a clean close (second paid his head, champion's residual is his head, pool
    closed exactly, no knockout after the close) raises nothing;
  * each breach kind is found and raises one critical financial alert:
    runner_up_not_paid_own_head, winner_not_paid_own_head,
    pool_not_closed_exactly, runner_up_knocked_out_after_close,
    not_completed_after_close, closed_without_final_two (the missing row);
  * a second scan raises no second alert while the first is unresolved, and a
    resolved alert lets a still-open breach alert again;
  * events before the rule went live, other formats and single-entrant events
    are not judged; nothing in the watch moves chips;
  * only service_role may execute it and the cron job is registered.
"""
from pathlib import Path
import os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
MIG = ROOT / 'supabase/migrations/20261106032337_bounty_only_final_two_payout_is_watched.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='final-two-watch-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(39000 + (os.getpid() + 31) % 9000)
started = False


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql).strip()


SCHEMA = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.tournaments(
  id uuid PRIMARY KEY, name text, status text, is_pko boolean, is_mystery_bounty boolean,
  buy_in_amount numeric, guaranteed_prize numeric, prize_pool numeric,
  bounty_pool numeric(15,2), bounty_pool_paid numeric(15,2), ended_at timestamptz,
  updated_at timestamptz DEFAULT now());
CREATE TABLE public.tournament_players(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, user_id uuid);
CREATE TABLE public.ca_bounty_only_final_two(
  tournament_id uuid PRIMARY KEY, winner_user_id uuid, runner_up_user_id uuid,
  winner_head numeric(15,2), runner_up_head numeric(15,2), created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.tournament_obligations(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, kind text, place integer,
  user_id uuid, amount_owed numeric(15,2), amount_paid numeric(15,2));
CREATE TABLE public.tournament_bounty_completion_receipts(
  tournament_id uuid PRIMARY KEY, winner_user_id uuid, pool_finalized_at timestamptz, pool_result jsonb);
CREATE TABLE public.tournament_bounties(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id uuid, eliminated_player_id uuid,
  collector_player_id uuid, created_at timestamptz DEFAULT clock_timestamp());
CREATE TABLE public.wallet_transactions(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), related_entity_id uuid, category text, type text, amount numeric(15,2));
CREATE TABLE public.financial_alerts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), severity text NOT NULL CHECK (severity IN ('critical','warning','info')),
  source text NOT NULL, message text NOT NULL, context jsonb DEFAULT '{}', resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
  LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
  LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_jobid RETURNING true$$;
"""

W, R, X = ('aa000000-0000-0000-0000-000000000001', 'bb000000-0000-0000-0000-000000000002',
           'cc000000-0000-0000-0000-000000000003')
LIVE = "now()"
n = [0]


def event(status='COMPLETED', ended=LIVE, pool=10, paid=10, wallet=10, entrants=(W, R, X), **over):
    n[0] += 1
    t = '7f000000-0000-0000-0000-0000000000%02d' % n[0]
    cols = dict(is_pko='true', is_mystery_bounty='false', buy_in_amount='0', guaranteed_prize='0', prize_pool='0')
    cols.update(over)
    q(f"""INSERT INTO tournaments(id,name,status,bounty_pool,bounty_pool_paid,ended_at,{','.join(cols)})
          VALUES ('{t}','Free Buy {n[0]}','{status}',{pool},{paid},{ended},{','.join(cols.values())});""")
    for u in entrants:
        q(f"INSERT INTO tournament_players(tournament_id,user_id) VALUES ('{t}','{u}');")
    if wallet:
        q(f"INSERT INTO wallet_transactions(related_entity_id,category,type,amount) VALUES ('{t}','bounty','credit',{wallet});")
    return t


def close(t, w_head=4, r_head=3, r_paid=3, residual=4, receipt=True, closed_at='clock_timestamp()'):
    q(f"""INSERT INTO ca_bounty_only_final_two(tournament_id,winner_user_id,runner_up_user_id,winner_head,runner_up_head,created_at)
          VALUES ('{t}','{W}','{R}',{w_head},{r_head},{closed_at});""")
    if r_paid is not None:
        q(f"""INSERT INTO tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid)
              VALUES ('{t}','bounty_residual',NULL,'{R}',{r_paid},{r_paid});""")
    if receipt:
        q(f"""INSERT INTO tournament_bounty_completion_receipts(tournament_id,winner_user_id,pool_finalized_at,pool_result)
              VALUES ('{t}','{W}',now(),jsonb_build_object('ok',true,'residual',{residual},'paid_to','{W}'));""")


def scan():
    # The rule's go-live is a constant in the function; the proof pins its own.
    return int(q("SELECT public.fn_ca_bounty_only_final_two_watch(now() - interval '1 hour');"))


def breaches(t):
    return q(f"SELECT string_agg(breach, ',' ORDER BY breach) FROM ca_bounty_only_final_two_breaches WHERE tournament_id='{t}';")


def alerts(t):
    return int(q(f"""SELECT count(*) FROM financial_alerts WHERE source='fn_ca_bounty_only_final_two_watch'
                      AND severity='critical' AND context->>'tournament_id'='{t}';"""))


try:
    shutil.rmtree(work / 'data', ignore_errors=True)
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'createdb', '-h', sock, '-p', port, '-U', 'postgres', 'w'])
    q(SCHEMA)
    q(MIG.read_text())

    # Clean close: nothing to report.
    clean = event(); close(clean)
    # Each breach kind.
    unpaid = event(); close(unpaid, r_paid=1.5)
    winner = event(); close(winner, residual=7)
    no_receipt = event(); close(no_receipt, receipt=False)
    pool = event(paid=9, wallet=9); close(pool)
    late_ko = event(); close(late_ko, closed_at="now() - interval '1 minute'")
    q(f"INSERT INTO tournament_bounties(tournament_id,eliminated_player_id,collector_player_id) VALUES ('{late_ko}','{R}','{W}');")
    stuck = event(status='RUNNING', ended='NULL'); close(stuck, receipt=False, closed_at="now() - interval '11 minutes'")
    fresh = event(status='RUNNING', ended='NULL'); close(fresh, receipt=False)  # just closed, terminal still running
    missing = event()  # completed after the rule with no close row
    # Not judged: before the rule, other formats, a lone entrant.
    before = event(ended="now() - interval '2 hours'")
    mystery = event(is_mystery_bounty='true')
    paid_entry = event(buy_in_amount='5')
    lone = event(entrants=(W,))

    found = scan()
    assert breaches(clean) is None or breaches(clean) == '', breaches(clean)
    assert breaches(unpaid) == 'runner_up_not_paid_own_head', breaches(unpaid)
    assert breaches(winner) == 'winner_not_paid_own_head', breaches(winner)
    assert breaches(no_receipt) == 'winner_not_paid_own_head', breaches(no_receipt)
    assert breaches(pool) == 'pool_not_closed_exactly', breaches(pool)
    assert breaches(late_ko) == 'runner_up_knocked_out_after_close', breaches(late_ko)
    assert breaches(stuck) == 'not_completed_after_close', breaches(stuck)
    assert not breaches(fresh), breaches(fresh)
    assert breaches(missing) == 'closed_without_final_two', breaches(missing)
    for t in (before, mystery, paid_entry, lone):
        assert not breaches(t), (t, breaches(t))
    assert found == 7, found
    for t in (unpaid, winner, no_receipt, pool, late_ko, stuck, missing):
        assert alerts(t) == 1, (t, alerts(t))
    assert alerts(clean) == 0 and alerts(fresh) == 0

    # Dedupe: a second scan raises nothing new while the alert is open.
    assert scan() == 7
    assert int(q("SELECT count(*) FROM financial_alerts")) == 7
    # A resolved alert lets a breach that is still there alert again.
    q(f"UPDATE financial_alerts SET resolved=true WHERE context->>'tournament_id'='{unpaid}';")
    scan()
    assert alerts(unpaid) == 2
    # A repaired breach stops being found (the table keeps its history).
    q(f"UPDATE tournament_obligations SET amount_paid=3 WHERE tournament_id='{unpaid}';")
    assert scan() == 6

    # Read-only toward money.
    assert q("SELECT sum(amount) FROM wallet_transactions") == "129.00"
    # The default go-live is the first opening after the engine release.
    assert "'2026-11-06 12:00:00+00'" in MIG.read_text()
    # Authority.
    assert q("SELECT has_function_privilege('service_role','public.fn_ca_bounty_only_final_two_watch(timestamptz)','execute')") == 't'
    for role in ('anon', 'authenticated'):
        assert q(f"SELECT has_function_privilege('{role}','public.fn_ca_bounty_only_final_two_watch(timestamptz)','execute')") == 'f'
    assert q("SELECT has_table_privilege('authenticated','public.ca_bounty_only_final_two_breaches','select')") == 'f'
    assert q("SELECT count(*) FROM cron.job WHERE jobname='ca-bounty-only-final-two-watch-5m'") == '1'
    # The migration refuses a second install.
    try:
        q(MIG.read_text())
        raise AssertionError('second install was accepted')
    except RuntimeError as error:
        assert 'already installed' in str(error), str(error)
    print('bounty only final two payout watch: clean close quiet, six breach kinds alert once, read-only - OK')
finally:
    if started:
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'data'), '-m', 'immediate', 'stop'], capture_output=True)
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
