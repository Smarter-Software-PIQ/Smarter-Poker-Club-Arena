#!/usr/bin/env python3
"""Private PostgreSQL proof of 20261105233808 (guarantee funding is watched both ways).

Production's definitions of fn_ca_guarantee_funding, fn_tournament_guarantee_check
and fn_ca_backpay_guarantee_shortfalls (captured 2026-11-05 into
scripts/ci/fixtures/guarantee-funding-watch/preimages.json, md5-checked here)
are installed over the rotation fixture's schema and the EXACT migration runs:

  * the legacy back-pay can no longer be run by service_role;
  * the guarantee check does not report an event whose players' full
    payments (places + bounties + rake) met G, and still reports a real short;
  * the variance scan records an overfunded (+32) and an underfunded (-30)
    finalized event and nothing for an exactly funded one (H = 100).
"""
from pathlib import Path
import json, os, shutil, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
ROT = ROOT / 'scripts/ci/fixtures/midway-free-buy-rotation'
FIX = ROOT / 'scripts/ci/fixtures/guarantee-funding-watch'
MIG = ROOT / 'supabase/migrations/20261105233808_guarantee_funding_is_watched_both_ways.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='gtd-watch-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(38000 + (os.getpid() + 13) % 10000)
started = False
U = 'fade0000-0000-0000-0000-000000000001'
ACTOR = '2d1cd6c3-5700-4af9-a271-d4863fdab20d'


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'w'], sql)


def must_fail(sql, needle):
    try:
        q(sql)
    except RuntimeError as error:
        assert needle in str(error), str(error)
        return
    raise AssertionError('expected a refusal containing %r' % needle)


def event(eid, entries, house, g=500, status='COMPLETED', paid_places=None, rake_per=4, bounty_per=10, prize_per=26):
    """entries x 40 paid from wallets (26/10/4), plus `house` overlay posted."""
    legs = ',\n'.join(
        f"('{ACTOR}','player_wallet','{ACTOR}','prize_liability','{eid}',40,'tournament_buyin','{eid}','buy-{eid}-{i}')"
        for i in range(entries))
    if house:
        legs += f",\n('{ACTOR}','union_bank','{U}','prize_liability','{eid}',{house},'overlay','{eid}','ov-{eid}')"
    pp = prize_per * entries + house
    q(f"""INSERT INTO tournaments(id,name,status,guaranteed_prize,prize_pool,bounty_pool,bounty_pool_paid,total_rake,
            prize_pool_finalized,start_time,ended_at,variant,tournament_type)
          VALUES('{eid}','Event {eid[-4:]}','{status}',{g},{pp},{bounty_per*entries},{bounty_per*entries},
            {rake_per*entries},true,now(),now(),'mtt','MTT');
          INSERT INTO chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,tournament_id,idempotency_key)
          VALUES {legs};
          INSERT INTO tournament_payouts(id,tournament_id,amount,source)
          VALUES(gen_random_uuid(),'{eid}',{pp if paid_places is None else paid_places},'structure');""")


try:
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'psql', '-X', '-qAt', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'postgres'],
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE DATABASE w;')
    q("""CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 """ + (ROT / 'schema.sql').read_text() + """
 ALTER TABLE tournaments ADD PRIMARY KEY(id);
 ALTER TABLE chip_ledger ADD COLUMN IF NOT EXISTS status text;
 CREATE TABLE financial_alerts(id uuid DEFAULT gen_random_uuid(), severity text, source text, message text,
   context jsonb, created_at timestamptz DEFAULT now(), resolved boolean);
 CREATE SCHEMA cron;
 CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
 CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
  LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
 CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
  LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_jobid RETURNING true$$;
 GRANT USAGE ON SCHEMA public TO service_role;""")
    pre = json.loads((FIX / 'preimages.json').read_text())
    q('SET check_function_bodies=off;\n' + '\n'.join(p['definition'] + ';' for p in pre)
      + "\nGRANT EXECUTE ON FUNCTION public.fn_ca_backpay_guarantee_shortfalls(boolean,integer) TO service_role;")
    for p in pre:
        got = q(f"SELECT md5(pg_get_functiondef('public.{p['signature']}'::regprocedure))").strip()
        assert got == p['md5'], (p['signature'], got, p['md5'])
    print('PASS: %d production definitions installed at their production md5' % len(pre), flush=True)

    # Before: the guarantee check reports a met gross guarantee as short.
    event('10000000-0000-0000-0000-000000000013', 13, 0)   # C 520 >= 500, places+bounties paid 468
    r = json.loads(q("SELECT fn_tournament_guarantee_check(24)").strip())
    assert r['short_of_guarantee'] == 1, r
    q("DELETE FROM financial_alerts")
    print('PASS: reproduced: 13 x 40 against 500 (C 520) was reported short by the old check', flush=True)

    q(MIG.read_text())
    print('PASS: exact migration installed', flush=True)

    must_fail("SET ROLE service_role; SELECT fn_ca_backpay_guarantee_shortfalls(true, 10)", 'permission denied')
    print('PASS: no role but the owner can run the legacy back-pay', flush=True)

    r = json.loads(q("SELECT fn_tournament_guarantee_check(24)").strip())
    assert r['short_of_guarantee'] == 0 and r['alerts_raised'] == 0, r
    event('10000000-0000-0000-0000-000000000005', 5, 0, paid_places=100)   # paid 100 + 50 bounties + 20 rake < 500
    r = json.loads(q("SELECT fn_tournament_guarantee_check(24)").strip())
    assert r['short_of_guarantee'] == 1, r
    sf = q("SELECT context->>'shortfall' FROM financial_alerts").strip()
    assert sf == '330.00', sf
    print('PASS: a met gross guarantee is not reported; a real short is (500 - 100 - 50 - 20 = 330)', flush=True)

    event('20000000-0000-0000-0000-000000000010', 10, 100)   # exact: H 100
    event('20000000-0000-0000-0000-000000000113', 13, 32)    # overfunded by 32
    event('20000000-0000-0000-0000-000000000210', 10, 70)    # underfunded by 30
    n = int(q("SELECT fn_ca_guarantee_funding_variance_scan('2000-01-01')").strip())
    rows = q("SELECT right(tournament_id::text,4)||':'||variance FROM ca_guarantee_funding_variances ORDER BY 1").split()
    # 0005 is the 5-entry event above: C 200, H 300, nothing posted.
    assert rows == ['0005:-300.00', '0113:32.00', '0210:-30.00'], rows
    print('PASS: the scan records +32 (overfunded), -30 and -300 (underfunded), nothing for the exact 100', flush=True)
    assert q("SELECT count(*) FROM cron.job WHERE jobname='ca-guarantee-funding-variance-15m'").strip() == '1'
    must_fail(MIG.read_text(), 'Inspected definition changed')
    print('PASS: a second install is refused', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
