#!/usr/bin/env python3
"""Private PostgreSQL proof that a guarantee counts the FULL buy-in (owner rule 2026-11-05).

No production URL is accepted. Production's definitions of every function the
migration 20261105220120 replaces (captured 2026-11-05 into
scripts/ci/fixtures/guarantee-full-buy-in/preimages.json, md5-checked here)
are installed over the rotation fixture's schema, the EXACT migration runs,
and the real close-out chain (fn_apply_prize_guarantee -> excess return ->
core -> before_atomic_proof, all production code) is driven through the
owner's acceptance table:

  40 = 26 prize + 10 bounty + 4 rake, G = 500
  10 entries  -> C 400, H 100 (old floor paid 140)
  13 entries  -> C 520, H 0   (old floor paid 32)
  C == G, C > G -> H 0
  regular bounty / PKO / mystery shapes -> same C, separate allocations
  a bounty paid before the close does not reduce C
  retries and concurrent close-outs -> one funding result
  an open contribution window -> nothing funded
  a zero-prize PKO -> completes with no invented ordinary prize funding
  no role can run the legacy back-pay
"""
from pathlib import Path
import json, os, re, shutil, subprocess, tempfile, threading, time

ROOT = Path(__file__).resolve().parents[2]
ROT = ROOT / 'scripts/ci/fixtures/midway-free-buy-rotation'
FIX = ROOT / 'scripts/ci/fixtures/guarantee-full-buy-in'
MIG = ROOT / 'supabase/migrations/20261105220120_a_guarantee_counts_the_full_buy_in.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='gtd-full-buy-in-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = str(37000 + (os.getpid() + 11) % 10000)
started = False
UNION = 'fade0000-0000-0000-0000-000000000001'
CLUB = 'c1000000-0000-0000-0000-000000000001'


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stdout


def q(sql, timeout=120):
    return run([PG / 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', sock, '-p', port,
                '-U', 'postgres', '-d', 'gtd'], sql, timeout)


def must_fail(sql, needle):
    try:
        q(sql)
    except RuntimeError as error:
        assert needle in str(error), str(error)
        return
    raise AssertionError('expected a refusal containing %r' % needle)


def event(eid, entries, fmt='bounty', g=500, prize=26, bounty=10, rake=4, status='RUNNING', level=9,
          late=4, bounty_paid=0):
    """An event whose entries have all paid prize+bounty+rake; the escrow
    holds exactly what the entries brought (no house money yet)."""
    pko = fmt == 'pko'
    mystery = fmt == 'mystery'
    n = entries
    q(f"""
    INSERT INTO tournaments(id,name,club_id,union_id,status,guaranteed_prize,prize_pool,bounty_pool,
      bounty_pool_paid,total_rake,prize_pool_finalized,current_level,late_reg_levels,is_bounty,is_pko,
      is_mystery_bounty,buy_in_amount,buy_in_fee,bounty_amount,variant,tournament_type,start_time,is_private)
    VALUES('{eid}','Event {eid}','{CLUB}','{UNION}','{status}',{g},{prize*n},{bounty*n},{bounty_paid},
      {rake*n},false,{level},{late},{str(fmt=='bounty').lower()},{str(pko).lower()},{str(mystery).lower()},
      {prize+bounty},{rake},{bounty},'mtt','MTT',now(),false);
    INSERT INTO tournament_escrow(tournament_id,enforced,gross_in,fee_entries_in,bounty_in,
      prize_balance,bounty_balance,fee_balance,bounty_out)
    VALUES('{eid}',true,{(prize+bounty+rake)*n},{rake*n},{bounty*n},{prize*n},{bounty*n-bounty_paid},
      {rake*n},{bounty_paid});""")


def bank():
    return float(q(f"SELECT chip_balance FROM union_wallets WHERE union_id='{UNION}'").strip())


def close(eid):
    return json.loads(q(f"SELECT fn_apply_prize_guarantee('{eid}','proof')").strip())


try:
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o',
         f'-k {sock} -p {port} -h 127.0.0.1', '-w', 'start'])
    started = True
    run([PG / 'psql', '-X', '-qAt', '-h', sock, '-p', port, '-U', 'postgres', '-d', 'postgres'],
        'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE DATABASE gtd;')

    # ── schema: the rotation fixture's tables plus what the close-out reads ──
    q("""CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT 'service_role'::text$$;
 """ + (ROT / 'schema.sql').read_text() + """
 ALTER TABLE tournament_escrow ADD PRIMARY KEY(tournament_id);
 ALTER TABLE chip_ledger ADD PRIMARY KEY(id); CREATE UNIQUE INDEX ON chip_ledger(idempotency_key);
 ALTER TABLE tournaments ADD PRIMARY KEY(id); ALTER TABLE union_wallets ADD UNIQUE(union_id);
 ALTER TABLE clubs ADD COLUMN chip_treasury numeric(20,2) DEFAULT 0, ADD COLUMN owner_id uuid,
   ADD COLUMN updated_at timestamptz;
 DROP TABLE tournament_guarantee_overlays;
 CREATE TABLE tournament_guarantee_overlays(tournament_id uuid PRIMARY KEY, club_id uuid, amount numeric,
   pool_before numeric, pool_after numeric, treasury_after numeric, source text,
   funded_at timestamptz DEFAULT now(), bank_type varchar, bank_entity_id uuid, union_id uuid,
   terminal_closed_at timestamptz);
 CREATE TABLE unions(id uuid PRIMARY KEY, name text);
 CREATE TABLE union_wallet_transactions(union_id uuid, wallet text, direction text, amount numeric,
   balance_after numeric, tx_type text, club_id uuid, notes text);
 CREATE TABLE financial_alerts(id uuid DEFAULT gen_random_uuid(), severity text, source text, message text,
   context jsonb, created_at timestamptz DEFAULT now(), resolved boolean, resolved_at timestamptz, resolution text);
 CREATE TABLE poker_diamond_tournament_ledger(tournament_id uuid, user_id uuid, kind text, amount numeric);
 -- Row types the settlement doors declare (their rows are never read here).
 CREATE TABLE tournament_place_settlement_batches(tournament_id uuid PRIMARY KEY, mode text);
 CREATE TABLE tournament_obligations(id uuid PRIMARY KEY, tournament_id uuid);
 CREATE TABLE tournament_final_table_deal_batches(tournament_id uuid PRIMARY KEY);
 CREATE FUNCTION is_club_member(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE SCHEMA cron;
 CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
 CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text) RETURNS bigint
  LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(p_name,p_schedule,p_command) RETURNING jobid$$;
 CREATE FUNCTION cron.unschedule(p_jobid bigint) RETURNS boolean
  LANGUAGE sql AS $$DELETE FROM cron.job WHERE jobid=p_jobid RETURNING true$$;
 """)
    acc = json.loads((ROT / 'accounting-functions.json').read_text())
    q('\n'.join(acc[k] + ';' for k in ('fn_ca_escrow_apply', 'fn_ca_lock_settlement_lane_for_tournament')))
    pre = json.loads((FIX / 'preimages.json').read_text())
    q('SET check_function_bodies=off;\n' + '\n'.join(p['definition'] + ';' for p in pre))
    for p in pre:
        got = q(f"SELECT md5(pg_get_functiondef('public.{p['signature']}'::regprocedure))").strip()
        assert got == p['md5'], (p['signature'], got, p['md5'])
    q("""CREATE TRIGGER zz_ca_escrow_overlay_leg AFTER INSERT ON public.chip_ledger FOR EACH ROW
 WHEN (NEW.to_type = 'prize_liability' AND (NEW.category = 'overlay'
   OR (NEW.category = 'correction' AND NEW.from_type IN ('union_bank','club_treasury'))))
 EXECUTE FUNCTION public.fn_ca_escrow_on_overlay_leg();""")
    q(f"""INSERT INTO unions VALUES('{UNION}','Midway Union');
 INSERT INTO union_wallets(union_id,chip_balance,promo_wallet) VALUES('{UNION}',100000,5000);
 INSERT INTO clubs(id,name,asset,is_platform,union_id,chip_treasury) VALUES('{CLUB}','Kings Club','chips',false,'{UNION}',0);""")
    print('PASS: %d production definitions installed here at their production md5' % len(pre), flush=True)

    # ── the old floor, before the change: reproduce the defect ────────────────
    event('10000000-0000-0000-0000-00000000a010', 10)
    b0 = bank()
    r = close('10000000-0000-0000-0000-00000000a010')
    assert r['ok'] and float(r['overlay']) == 140, r
    assert b0 - bank() == 140
    print('PASS: reproduced on production code: 10 x 40 (26/10/4) against 500 paid a 140 overlay (rake not counted)', flush=True)
    event('10000000-0000-0000-0000-00000000a013', 13)
    r = close('10000000-0000-0000-0000-00000000a013')
    assert float(r['overlay']) == 32, r
    print('PASS: reproduced on production code: 13 x 40 (C 520 >= G 500) still paid a 32 overlay', flush=True)

    # ── install the exact migration ───────────────────────────────────────────
    began = time.monotonic()
    q(MIG.read_text())
    print('PASS: exact migration installed in %.2fs' % (time.monotonic() - began), flush=True)
    for sig in ['fn_ca_overlay_shortfall(uuid)', 'fn_ca_apply_prize_guarantee_core(uuid,text)',
                'fn_apply_prize_guarantee_before_atomic_proof(uuid,text)', 'fn_ca_return_excess_start_overlay_locked(uuid)',
                'fn_ca_fund_overlay_on_lock()', 'trg_tournament_atomic_place_completion_guard()',
                'fn_settle_tournament_places(uuid,uuid)', 'fn_settle_tournament_final_table_deal(uuid)',
                'fn_settle_tournament_places_atomic(uuid,text)', 'fn_settle_final_table_deal_atomic(uuid)',
                'fn_ca_prize_overpay_unexplained(interval)', 'fn_ca_tournament_settlement_mismatch(interval)',
                'fn_poker_diamond_tournament_effective_guarantee(uuid)']:
        d = q(f"SELECT pg_get_functiondef('public.{sig}'::regprocedure)")
        assert 'fn_ca_place_guarantee(' not in d, sig
        calls = re.findall(r'fn_ca_place_guarantee_gross\((?:[^()]|\([^()]*(?:\([^()]*\))*[^()]*\))*\)', d)
        assert calls and all('total_rake' in c for c in calls), (sig, calls)
    print('PASS: every reader of the guarantee floor passes total_rake (13 functions)', flush=True)

    # ── the acceptance table ──────────────────────────────────────────────────
    q("SELECT 1")
    cases = [  # (id suffix, entries, fmt, expected H, expected C)
        ('b010', 10, 'bounty', 100, 400),
        ('b013', 13, 'bounty', 0, 520),
        ('c010', 10, 'pko', 100, 400),
        ('d010', 10, 'mystery', 100, 400),
    ]
    for suf, n, fmt, h, c in cases:
        eid = '20000000-0000-0000-0000-00000000' + suf
        event(eid, n, fmt)
        cov = json.loads(q(f"SELECT fn_ca_guarantee_coverage('{eid}')").strip())
        assert float(cov['gross_collected']) == c and float(cov['house_required']) == h, cov
        assert (float(cov['player_prize']), float(cov['player_bounty']), float(cov['rake'])) == (26 * n, 10 * n, 4 * n), cov
        b0 = bank()
        r = close(eid)
        assert r['ok'] and float(r['overlay']) == h, (fmt, n, r)
        assert round(b0 - bank(), 2) == h
        row = q(f"SELECT prize_pool||','||bounty_pool||','||total_rake||','||prize_pool_finalized FROM tournaments WHERE id='{eid}'").strip()
        assert row == f'{26*n+h:.2f},{10*n:.2f},{4*n:.2f},true', row
        led = q(f"SELECT count(*)||','||coalesce(sum(amount),0) FROM chip_ledger WHERE tournament_id='{eid}' AND category='overlay'").strip()
        assert led == (f'1,{h:.2f}' if h else '0,0'), led
        esc = q(f"SELECT prize_balance||','||bounty_balance||','||fee_balance||','||overlay_in FROM tournament_escrow WHERE tournament_id='{eid}'").strip()
        assert [float(x) for x in esc.split(',')] == [26*n+h, 10*n, 4*n, h], esc
        cov = json.loads(q(f"SELECT fn_ca_guarantee_coverage('{eid}')").strip())
        assert float(cov['variance']) == 0 and float(cov['house_prize']) == h, cov
    print('PASS: one 40-chip payment (26/10/4) counts 40; 10 entries C 400 -> H 100, 13 entries C 520 -> H 0; '
          'regular bounty, PKO and mystery give the same C with separate prize/bounty/rake allocations', flush=True)

    for suf, n, g in (('e000', 1, 520), ('a400', 1, 400)):  # C == G and C > G
        eid = '30000000-0000-0000-0000-00000000' + suf
        event(eid, 13, 'bounty', g=g)
        b0 = bank()
        r = close(eid)
        assert float(r['overlay']) == 0 and bank() == b0, r
    print('PASS: contributions equal to and above the guarantee: zero house funding', flush=True)

    # no-deduction event: 40 straight to prize, rake 0
    eid = '30000000-0000-0000-0000-00000000f000'
    event(eid, 10, 'none', prize=40, bounty=0, rake=0)
    r = close(eid)
    assert float(r['overlay']) == 100, r
    print('PASS: a no-bounty no-rake event is funded exactly max(0, G - C) = 100', flush=True)

    # a bounty awarded before the close does not reduce C
    eid = '40000000-0000-0000-0000-00000000b001'
    event(eid, 10, 'pko', bounty_paid=60)
    r = close(eid)
    assert float(r['overlay']) == 100, r
    print('PASS: 60 in bounties awarded before the close leaves C at 400 and H at 100', flush=True)

    # retries
    b0 = bank()
    for _ in range(3):
        r = close(eid)
        assert r['ok'] and float(r['overlay']) == 0 and r.get('already_finalized'), r
    assert bank() == b0
    assert q(f"SELECT count(*) FROM chip_ledger WHERE tournament_id='{eid}' AND category='overlay'").strip() == '1'
    print('PASS: three retries of a funded close-out move nothing and write nothing', flush=True)

    # concurrent close-outs
    eid = '50000000-0000-0000-0000-00000000c001'
    event(eid, 10, 'bounty')
    b0 = bank()
    out = {}

    def worker(k):
        try:
            out[k] = json.loads(q(f"BEGIN; SELECT fn_apply_prize_guarantee('{eid}','proof'); SELECT pg_sleep(0.3); COMMIT;").split('\n')[0])
        except RuntimeError as error:
            out[k] = {'error': str(error)}
    ts = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    [t.start() for t in ts]; [t.join() for t in ts]
    assert round(b0 - bank(), 2) == 100, (b0, bank(), out)
    assert q(f"SELECT count(*) FROM chip_ledger WHERE tournament_id='{eid}' AND category='overlay'").strip() == '1'
    assert sum(1 for v in out.values() if float(v.get('overlay', 0) or 0) == 100) == 1, out
    print('PASS: four concurrent close-outs produce one funding of 100', flush=True)

    # open window: the production finalization guard refuses; nothing moves
    q("""CREATE FUNCTION public.trg_tournament_pool_finalization_window_guard() RETURNS trigger
 LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.prize_pool_finalized AND NOT COALESCE(OLD.prize_pool_finalized,false)
     AND NEW.status='RUNNING' AND COALESCE(NEW.late_reg_levels,0) > COALESCE(NEW.current_level,0) THEN
    RAISE EXCEPTION 'tournament % cannot finalize its prize pool before late registration level % closes',
      NEW.id, NEW.late_reg_levels USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zzzz_window BEFORE UPDATE OF prize_pool_finalized ON tournaments
 FOR EACH ROW EXECUTE FUNCTION trg_tournament_pool_finalization_window_guard();""")
    eid = '60000000-0000-0000-0000-00000000d001'
    event(eid, 10, 'bounty', level=2, late=4)
    b0 = bank()
    r = close(eid)
    assert r['ok'] is False and bank() == b0, r
    got = q(f"""SELECT (SELECT count(*) FROM chip_ledger WHERE tournament_id='{eid}' AND category='overlay')||','||
      prize_pool_finalized FROM tournaments WHERE id='{eid}'""").strip()
    assert got == '0,false', got
    print('PASS: while late registration is open the close-out is refused and moves nothing', flush=True)

    # zero-prize PKO (no guarantee): finalizes at 0 with bounties untouched
    eid = '70000000-0000-0000-0000-00000000e001'
    event(eid, 10, 'pko', g=0, prize=0, bounty=40, rake=0)
    b0 = bank()
    r = close(eid)
    assert r['ok'] and float(r['overlay']) == 0 and float(r['prize_pool']) == 0 and bank() == b0, r
    print('PASS: a zero-prize PKO finalizes with no ordinary prize funding and its 400 in bounties intact', flush=True)

    # the retired back-pay
    must_fail("SET ROLE service_role; SELECT fn_ca_backpay_guarantee_shortfalls(true, 10)", 'permission denied')
    acl = q("SELECT proacl::text FROM pg_proc WHERE proname='fn_ca_backpay_guarantee_shortfalls'").strip()
    assert 'service_role' not in acl and 'anon' not in acl and 'authenticated' not in acl, acl
    print('PASS: no role can run the legacy back-pay any more (%s)' % acl, flush=True)

    # monitoring: the old-floor events are seen as overfunded, the new ones are not
    n = int(q("SELECT fn_ca_guarantee_funding_variance_scan('2000-01-01')").strip())
    rows = q("SELECT tournament_id||':'||variance FROM ca_guarantee_funding_variances ORDER BY 1").split()
    assert rows == ['10000000-0000-0000-0000-00000000a010:40.00', '10000000-0000-0000-0000-00000000a013:32.00'], rows
    print('PASS: the variance scan flags exactly the two events funded under the old floor (+40, +32) and none funded since', flush=True)

    # an underfunded event is flagged too (house funding removed by hand)
    q("UPDATE tournaments SET prize_pool = prize_pool - 30 WHERE id='20000000-0000-0000-0000-00000000b010';"
      "DELETE FROM chip_ledger WHERE tournament_id='20000000-0000-0000-0000-00000000b010' AND category='overlay';"
      "INSERT INTO chip_ledger(id,performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,tournament_id,idempotency_key)"
      " VALUES(gen_random_uuid(),'2d1cd6c3-5700-4af9-a271-d4863fdab20d','union_bank','" + UNION + "','prize_liability','20000000-0000-0000-0000-00000000b010',70,'overlay','20000000-0000-0000-0000-00000000b010','under-proof');")
    q("SELECT fn_ca_guarantee_funding_variance_scan('2000-01-01')")
    v = q("SELECT variance FROM ca_guarantee_funding_variances WHERE tournament_id='20000000-0000-0000-0000-00000000b010'").strip()
    assert v == '-30.00', v
    print('PASS: an underfunded event is flagged (-30)', flush=True)

    must_fail(MIG.read_text(), 'already exists')
    print('PASS: a second install is refused', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
