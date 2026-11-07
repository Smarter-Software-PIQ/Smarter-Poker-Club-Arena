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

Then 20261106194903 (Free Buy vouchers and ticket books are watched), over
production's fn_ca_midway_free_buy_format and fn_raise_server_financial_alert
(scripts/ci/fixtures/guarantee-funding-watch/free-buy-preimages.json):

  * the owner's acceptance rows are silent: no guarantee, 250 tickets and 160
    player chips hold promo V = 250; G 500 with 250 tickets and 160 chips
    holds H = 340 in total; the same event funded 340 on top of the tickets
    is found +250;
  * guarantee (+32/-30/-300) and voucher (+1/-1) variances and five ticket
    book defects each raise one alert, money critical, none on a second pass;
  * a corrected finding closes and resolves its alert; no chip ever moves.
"""
from pathlib import Path
import json, os, shutil, socket, subprocess, tempfile

ROOT = Path(__file__).resolve().parents[2]
ROT = ROOT / 'scripts/ci/fixtures/midway-free-buy-rotation'
FIX = ROOT / 'scripts/ci/fixtures/guarantee-funding-watch'
MIG = ROOT / 'supabase/migrations/20261105233808_guarantee_funding_is_watched_both_ways.sql'
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
work = Path(tempfile.mkdtemp(prefix='gtd-watch-', dir=os.environ.get('TMPDIR')))
sock = Path(tempfile.mkdtemp(prefix='s-', dir=os.environ.get('CA_PG_SOCKET_ROOT', os.environ.get('TMPDIR'))))
port = None
tcp_guard = socket.socket()
started = False
U = 'fade0000-0000-0000-0000-000000000001'
ACTOR = '2d1cd6c3-5700-4af9-a271-d4863fdab20d'


def run(args, sql=None, timeout=120):
    r = subprocess.run([str(a) for a in args], input=sql, text=True, capture_output=True, timeout=timeout)
    if r.returncode:
        startup_log = work / 'postgres.log'
        diagnostic = startup_log.read_text() if startup_log.exists() else ''
        raise RuntimeError(r.stderr + '\n' + diagnostic)
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
    # Every client uses our unique Unix socket. Hold the TCP port occupied as
    # a regression guard: adding an unnecessary TCP listener must fail here.
    tcp_guard.bind(('127.0.0.1', 0))
    port = str(tcp_guard.getsockname()[1])
    run([PG / 'initdb', '-D', work / 'data', '-U', 'postgres', '-A', 'trust', '--no-locale'])
    run([PG / 'pg_ctl', '-D', work / 'data', '-l', work / 'postgres.log', '-o', f"-k {sock} -p {port} -c listen_addresses=''", '-w', 'start'])
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

    # ── 20261106194903: Free Buy vouchers and ticket books are watched, and
    #    every funding variance reaches Production Alerts. ──────────────────
    fb_pre = json.loads((FIX / 'free-buy-preimages.json').read_text())
    q("ALTER TABLE financial_alerts ADD COLUMN resolved_at timestamptz, ADD COLUMN resolution text;"
      " DELETE FROM financial_alerts;"
      # The ticket books exactly as 20261105223835 creates them.
      " CREATE TABLE smarter_private.free_buy_ticket_days (user_id uuid NOT NULL, gaming_day date NOT NULL,"
      "  allotment smallint NOT NULL DEFAULT 5 CHECK (allotment = 5),"
      "  used smallint NOT NULL DEFAULT 0 CHECK (used >= 0 AND used <= allotment),"
      "  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (user_id, gaming_day));"
      " CREATE TABLE smarter_private.free_buy_ticket_redemptions (registration_id uuid PRIMARY KEY,"
      "  user_id uuid NOT NULL, tournament_id uuid NOT NULL, gaming_day date NOT NULL,"
      "  redeemed_at timestamptz NOT NULL DEFAULT clock_timestamp(), returned_at timestamptz);"
      " CREATE UNIQUE INDEX free_buy_ticket_one_live_per_event ON smarter_private.free_buy_ticket_redemptions"
      "  (user_id, tournament_id) WHERE returned_at IS NULL;\n"
      + '\n'.join(p['definition'] + ';' for p in fb_pre))
    for p in fb_pre:
        got = q(f"SELECT md5(pg_get_functiondef('public.{p['signature']}'::regprocedure))").strip()
        assert got == p['md5'], (p['signature'], got, p['md5'])
    FB_MIG = ROOT / 'supabase/migrations/20261106194903_free_buy_vouchers_and_ticket_books_are_watched_and_every_fun.sql'
    q(FB_MIG.read_text())
    print('PASS: %d more production definitions at their md5; the exact Free Buy watch migration installed' % len(fb_pre), flush=True)

    DAY = q("SELECT (now() AT TIME ZONE 'America/Chicago')::date").strip()

    def free_buy(eid, fmt, entries, promo, g=0, wallet=0, house=0, tickets=True, status='COMPLETED', fee=0):
        """A finalized Midway Free Buy: `entries` first entries, `promo` one-chip
        promo heads posted (net), `wallet` player chips, `house` overlay."""
        flags = {'pko': "is_pko=true, bounty_amount=1", 'mystery': "is_mystery_bounty=true, bounty_amount=0.50",
                 'aiof': "all_in_or_fold=true", 'regular': "is_pko=false"}[fmt]
        q(f"""INSERT INTO tournaments(id,name,status,guaranteed_prize,prize_pool,prize_pool_finalized,start_time,
                ended_at,variant,tournament_type,union_id,club_id,free_buy,buy_in_amount,buy_in_fee)
              VALUES('{eid}','Free Buy {eid[-4:]}','{status}',{g},0,true,now(),now(),'freezeout','MTT',
                '{U}','{U}',true,{fee},0);
              UPDATE tournaments SET {flags} WHERE id='{eid}';
              INSERT INTO tournament_players(id,tournament_id,user_id,status,registered_at)
              SELECT ('{eid[:19]}{eid[-4:]}-'||lpad(i::text,12,'0'))::uuid,'{eid}',
                     ('a{eid[1:19]}{eid[-4:]}-'||lpad(i::text,12,'0'))::uuid,'registered',now()-interval '10 minutes'
                FROM generate_series(1,{entries}) i;""")
        if tickets:
            q(f"""INSERT INTO smarter_private.free_buy_ticket_redemptions(registration_id,user_id,tournament_id,gaming_day,redeemed_at)
                  SELECT p.id,p.user_id,p.tournament_id,'{DAY}',now()-interval '10 minutes'
                    FROM tournament_players p WHERE p.tournament_id='{eid}';
                  INSERT INTO smarter_private.free_buy_ticket_days(user_id,gaming_day,used)
                  SELECT p.user_id,'{DAY}',1 FROM tournament_players p WHERE p.tournament_id='{eid}';""")
        legs = []
        if promo:
            legs.append(f"SELECT '{ACTOR}'::uuid,'union_wallet','{U}'::uuid,'union_wallets.promo_wallet','prize_liability','{eid}'::uuid,"
                        f"'tournament_escrow.prize_balance',1::numeric,'promo_send','{eid}'::uuid,'head-{eid}-'||i FROM generate_series(1,{promo}) i")
        if wallet:
            legs.append(f"SELECT '{ACTOR}'::uuid,'player_wallet','{ACTOR}'::uuid,NULL,'prize_liability','{eid}'::uuid,NULL,"
                        f"{wallet}::numeric,'rebuy','{eid}'::uuid,'wallet-{eid}'")
        if house:
            legs.append(f"SELECT '{ACTOR}'::uuid,'union_bank','{U}'::uuid,NULL,'prize_liability','{eid}'::uuid,NULL,"
                        f"{house}::numeric,'overlay','{eid}'::uuid,'ov-{eid}'")
        if legs:
            q("INSERT INTO chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,"
              "amount,category,tournament_id,idempotency_key)\n" + '\nUNION ALL\n'.join(legs))

    # The owner's acceptance rows: a Free Buy without a guarantee, 250 tickets
    # and 160 player chips, holds promo V = 250 (total 410): exact.
    free_buy('30000000-0000-0000-0000-000000000250', 'pko', 250, 250, wallet=160)
    # Guaranteed Free Buy, G 500, 250 tickets, 160 player chips: H = 340 in
    # total (250 heads + 90 overlay): exact. The same event funded 340 ON TOP
    # of the 250 heads is the extra ticket funding the rule forbids: +250.
    free_buy('30000000-0000-0000-0000-000000000340', 'aiof', 250, 250, g=500, wallet=160, house=90)
    free_buy('30000000-0000-0000-0000-000000000590', 'aiof', 250, 250, g=500, wallet=160, house=340)
    # Vouchers: one head too many, one head missing.
    free_buy('30000000-0000-0000-0000-000000000004', 'mystery', 3, 4)
    free_buy('30000000-0000-0000-0000-000000000002', 'pko', 3, 2)
    # Ticket books: an entry that bypassed the ticket, a spent ticket with no
    # entry, a ticket kept on a cancelled event, a day counter that disagrees,
    # and a Midway Free Buy whose format reads NULL (it takes a fee).
    free_buy('30000000-0000-0000-0000-00000000e0e0', 'pko', 2, 2, tickets=False)
    q(f"""INSERT INTO smarter_private.free_buy_ticket_redemptions(registration_id,user_id,tournament_id,gaming_day,redeemed_at)
          VALUES('30000000-0000-0000-0000-0000000000aa','b0000000-0000-0000-0000-0000000000aa',
                 '30000000-0000-0000-0000-000000000250','{DAY}',now()-interval '10 minutes');
          INSERT INTO smarter_private.free_buy_ticket_days(user_id,gaming_day,used)
          VALUES('b0000000-0000-0000-0000-0000000000aa','{DAY}',1);
          UPDATE smarter_private.free_buy_ticket_days SET used=2
           WHERE user_id=(SELECT user_id FROM tournament_players WHERE tournament_id='30000000-0000-0000-0000-000000000002' LIMIT 1);""")
    free_buy('30000000-0000-0000-0000-00000000cccc', 'pko', 1, 0, status='CANCELLED')
    free_buy('30000000-0000-0000-0000-00000000fee0', 'pko', 1, 0, tickets=False, status='REGISTERING', fee=1)

    r = json.loads(q("SELECT fn_ca_free_buy_funding_watch()").strip())
    got = sorted(q("SELECT kind||':'||right(subject,4) FROM ca_free_buy_watch_findings WHERE cleared_at IS NULL").split())
    want = sorted(['guarantee_underfunded:0005', 'guarantee_overfunded:0113', 'guarantee_underfunded:0210',
                   'guarantee_overfunded:0590', 'voucher_overfunded:0004', 'voucher_underfunded:0002',
                   'entry_without_ticket:0001', 'entry_without_ticket:0002', 'ticket_without_entry:00aa',
                   'ticket_on_cancelled_event:0001', 'ticket_day_mismatch:' + DAY[-4:], 'free_buy_without_format:fee0'])
    assert got == want, (got, want)
    assert r == {'open': 12, 'new': 12, 'closed': 0}, r
    v = q("SELECT detail->>'variance' FROM ca_free_buy_watch_findings WHERE subject LIKE '%0590'").strip()
    assert v == '250.00', v
    print('PASS: the owner acceptance rows are silent (V 250 / total 410; guaranteed H 340 with no extra ticket funding)', flush=True)
    print('PASS: +250 extra ticket funding, +32/-30/-300 guarantees, +1/-1 vouchers and five ticket-book defects are found', flush=True)

    alerts = q("SELECT severity||':'||(context->>'kind') FROM financial_alerts WHERE source='fn_ca_free_buy_funding_watch' ORDER BY 1").split()
    assert len(alerts) == 12, alerts
    assert all(a.startswith('critical:') == (a.split(':')[1].startswith(('guarantee_', 'voucher_'))) for a in alerts), alerts
    r = json.loads(q("SELECT fn_ca_free_buy_funding_watch()").strip())
    assert r == {'open': 12, 'new': 0, 'closed': 0}, r
    assert q("SELECT count(*) FROM financial_alerts WHERE source='fn_ca_free_buy_funding_watch'").strip() == '12'
    print('PASS: each finding raises one alert (money critical, ticket books warning) and a second pass raises none', flush=True)

    # Correct two findings the authorized way (outside the watch): the missing
    # head is posted and the day counter is fixed. Both close; the alerts resolve.
    q(f"""INSERT INTO chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,tournament_id,idempotency_key)
          VALUES('{ACTOR}','union_wallet','{U}','prize_liability','30000000-0000-0000-0000-000000000002',1,'promo_send',
                 '30000000-0000-0000-0000-000000000002','head-fix');
          UPDATE smarter_private.free_buy_ticket_days SET used=1 WHERE used=2;""")
    r = json.loads(q("SELECT fn_ca_free_buy_funding_watch()").strip())
    assert r == {'open': 10, 'new': 0, 'closed': 2}, r
    closed = q("SELECT count(*) FROM financial_alerts WHERE source='fn_ca_free_buy_funding_watch' AND resolved AND resolved_at IS NOT NULL").strip()
    assert closed == '2', closed
    chips_before = q("SELECT sum(amount) FROM chip_ledger").strip()
    q("SELECT fn_ca_free_buy_funding_watch()")
    assert q("SELECT sum(amount) FROM chip_ledger").strip() == chips_before
    print('PASS: a corrected finding closes and resolves its alert; the watch never moves a chip', flush=True)

    must_fail("SET ROLE authenticated; SELECT fn_ca_free_buy_funding_watch()", 'permission denied')
    must_fail("SET ROLE authenticated; SELECT * FROM ca_free_buy_watch_findings", 'permission denied')
    assert q("SELECT count(*) FROM cron.job WHERE jobname='ca-free-buy-funding-watch-15m'").strip() == '1'
    must_fail(FB_MIG.read_text(), 'already installed')
    print('PASS: players cannot run or read the watch; it is scheduled; a second install is refused', flush=True)

    # ── 20261106205705: the pre-ticket entries are a record, not a clock. ──
    # A Free Buy with 906 entries registered before tickets went live, each
    # with its legacy one-chip head and no ticket (35 inside the install gap),
    # one pre-install entry with NO head (a door that skipped the promo
    # writer: the clock exempted it), and one ticketless entry registered
    # after tickets went live.
    RO = '40000000-0000-0000-0000-000000000011'
    q(f"""INSERT INTO tournaments(id,name,status,guaranteed_prize,prize_pool,prize_pool_finalized,start_time,
            variant,tournament_type,union_id,club_id,free_buy,buy_in_amount,buy_in_fee,is_pko,bounty_amount)
          VALUES('{RO}','Rollout Free Buy','RUNNING',0,0,false,now(),'freezeout','MTT','{U}','{U}',true,0,0,true,1);
          INSERT INTO tournament_players(id,tournament_id,user_id,status,registered_at)
          SELECT ('40000000-0000-0000-0011-'||lpad(i::text,12,'0'))::uuid,'{RO}',
                 ('c0000000-0000-0000-0011-'||lpad(i::text,12,'0'))::uuid,'registered',
                 CASE WHEN i <= 35 THEN '2026-11-05 23:00:00+00'::timestamptz ELSE '2026-11-05 21:00:00+00' END
            FROM generate_series(1,906) i;
          INSERT INTO chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
                                  amount,category,tournament_id,idempotency_key)
          SELECT '{ACTOR}','union_wallet','{U}','union_wallets.promo_wallet','prize_liability','{RO}',
                 'tournament_escrow.bounty_balance',1,'promo_send','{RO}','tourney:{RO}:promo_head:'||p.id
            FROM tournament_players p WHERE p.tournament_id='{RO}';
          INSERT INTO tournament_players(id,tournament_id,user_id,status,registered_at) VALUES
           ('40000000-0000-0000-0011-00000000a0a0','{RO}','c0000000-0000-0000-0011-00000000a0a0','registered','2026-11-05 23:05:00+00'),
           ('40000000-0000-0000-0011-00000000b0b0','{RO}','c0000000-0000-0000-0011-00000000b0b0','registered','2026-11-05 23:30:00+00');""")
    q("SELECT fn_ca_free_buy_funding_watch()")
    before = sorted(q(f"SELECT right(subject,4) FROM ca_free_buy_watch_findings WHERE kind='entry_without_ticket' AND tournament_id='{RO}' AND cleared_at IS NULL").split())
    assert before == ['b0b0'], before
    print('PASS: reproduced: the clock exempted a pre-install entry with no promo head (a0a0); only b0b0 was reported', flush=True)

    RO_MIG = ROOT / 'supabase/migrations/20261106205705_free_buy_rollout_entries_are_recorded_and_exempt_from_ticket.sql'
    q(RO_MIG.read_text())
    rec = q("SELECT count(*)||':'||count(*) FILTER (WHERE in_install_gap) FROM smarter_private.free_buy_rollout_entries").strip()
    assert rec == '906:35', rec
    assert q("SELECT count(*) FROM smarter_private.free_buy_rollout_entries WHERE right(registration_id::text,4) IN ('a0a0','b0b0')").strip() == '0'
    q("SELECT fn_ca_free_buy_funding_watch()")
    after = sorted(q(f"SELECT right(subject,4) FROM ca_free_buy_watch_findings WHERE kind='entry_without_ticket' AND tournament_id='{RO}' AND cleared_at IS NULL").split())
    assert after == ['a0a0', 'b0b0'], after
    still = sorted(q("SELECT right(subject,4) FROM ca_free_buy_watch_findings WHERE kind='entry_without_ticket' AND tournament_id='30000000-0000-0000-0000-00000000e0e0' AND cleared_at IS NULL").split())
    assert still == ['0001', '0002'], still
    print('PASS: 906 rollout entries recorded (35 in the install gap) and exempt; a0a0 and b0b0 and the earlier bypass entries are reported', flush=True)

    must_fail("SET ROLE service_role; DELETE FROM smarter_private.free_buy_rollout_entries", 'permission denied')
    must_fail("SET ROLE service_role; UPDATE smarter_private.free_buy_rollout_entries SET in_install_gap=false", 'permission denied')
    must_fail(RO_MIG.read_text(), 'Inspected definition changed')
    print('PASS: the record is append-only for every role; a second install is refused', flush=True)

    # ── 20261107041909: funding accuracy is a digest line, and a prize promo
    #    posted while registration is open is watched. ─────────────────────
    PROD_WATCH_MD5 = '44fc0264d2fc445ab2a9b696468d7add'
    got = q("SELECT md5(pg_get_functiondef('public.fn_ca_free_buy_funding_watch()'::regprocedure))").strip()
    assert got == PROD_WATCH_MD5, got
    print('PASS: the watch rebuilt from the merged migrations is byte-identical to production (%s)' % got, flush=True)

    DG_MIG = ROOT / 'supabase/migrations/20261107041909_free_buy_and_guarantee_funding_is_in_the_daily_digest_and_ea.sql'
    q(DG_MIG.read_text())
    print('PASS: exact digest and early-prize-promo migration installed', flush=True)

    # Two unfinalized mystery Free Buys. EP1: a sign-up head with a prize part
    # after the cutoff went live (reported), one with prize_part 0 (silent),
    # and a pre-cutoff legacy head with a prize part (silent: the record of
    # how the rollout funded it). EP2: its cutoff funding is posted while the
    # event is still open (reported), then the event finalizes (closes).
    EP1, EP2 = '50000000-0000-0000-0000-0000000000e1', '50000000-0000-0000-0000-0000000000e2'
    for e in (EP1, EP2):
        free_buy(e, 'mystery', 2, 0, status='REGISTERING')
        q(f"UPDATE tournaments SET prize_pool_finalized=false WHERE id='{e}'")

    def head(eid, key, amount, prize, at="now()"):
        q(f"""INSERT INTO chip_ledger(performed_by,from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,
                amount,category,tournament_id,idempotency_key,status,created_at,metadata)
              VALUES('{ACTOR}','union_wallet','{U}','union_wallets.promo_wallet','prize_liability','{eid}',
                'tournament_escrow.prize_balance',{amount},'promo_send','{eid}','{key}','posted',{at},
                jsonb_build_object('kind','midway_free_buy_promo_head','prize_part',{prize},'bounty_part',{amount}-{prize}))""")
    head(EP1, f'tourney:{EP1}:promo_head:early', 1, 0.5)
    head(EP1, f'tourney:{EP1}:promo_head:bounty', 0.5, 0)
    head(EP1, f'tourney:{EP1}:promo_head:legacy', 1, 1, at="'2026-11-06 21:05:26+00'")
    head(EP2, f'tourney:{EP2}:promo_head:b1', 0.5, 0)
    head(EP2, f'tourney:{EP2}:promo_head:b2', 0.5, 0)
    head(EP2, f'tourney:{EP2}:free_buy_cutoff_funding', 1, 1)
    q("SELECT fn_ca_free_buy_funding_watch()")
    early = q("""SELECT right(tournament_id::text,2)||':'||(detail->>'idempotency_key') FROM ca_free_buy_watch_findings
                  WHERE kind='early_prize_promo' AND cleared_at IS NULL ORDER BY 1""").split()
    assert early == [f'e1:tourney:{EP1}:promo_head:early', f'e2:tourney:{EP2}:free_buy_cutoff_funding'], early
    sev = q("SELECT string_agg(DISTINCT severity, ',') FROM financial_alerts WHERE context->>'kind'='early_prize_promo'").strip()
    assert sev == 'critical', sev
    print('PASS: a prize promo posted while registration is open is found (a late prize head, an early cutoff leg), critical', flush=True)
    print('PASS: a bounty-only head and a pre-cutoff legacy prize head are not reported', flush=True)

    q(f"UPDATE tournaments SET prize_pool_finalized=true WHERE id='{EP2}'")
    r = json.loads(q("SELECT fn_ca_free_buy_funding_watch()").strip())
    assert r['closed'] == 1, r
    left = q("SELECT right(tournament_id::text,2) FROM ca_free_buy_watch_findings WHERE kind='early_prize_promo' AND cleared_at IS NULL").split()
    assert left == ['e1'], left
    # EP2 is now a finalized mystery Free Buy holding V = 2 (two 0.50 bounty heads + 1 at cutoff): exact.
    assert q(f"SELECT count(*) FROM ca_free_buy_watch_findings WHERE tournament_id='{EP2}' AND cleared_at IS NULL").strip() == '0'
    print('PASS: once the event finalizes its cutoff leg is no longer early, and V = 2 is exact', flush=True)

    # The digest line. Every fixture event starts today (Central).
    q(f"""INSERT INTO smarter_private.free_buy_ticket_days(user_id,gaming_day,used)
          VALUES('d0000000-0000-0000-0000-000000000005','{DAY}',5)""")
    d = json.loads(q(f"SET ROLE service_role; SELECT fn_sp_digest_free_buy_funding('{DAY}')").strip())
    byid = {e['tournament_id'][-4:]: e for e in d['free_buy']}
    assert byid['0250']['verdict'] == 'exact' and byid['0250']['required'] == 250 and byid['0250']['promo'] == 250, byid['0250']
    assert byid['0340']['verdict'] == 'exact' and byid['0340']['required'] == 340, byid['0340']
    assert byid['0340']['promo'] == 250 and byid['0340']['house'] == 90 and byid['0340']['player_coverage'] == 160, byid['0340']
    assert byid['0590']['verdict'] == 'over' and byid['0590']['variance'] == 250, byid['0590']
    assert byid['0004']['verdict'] == 'over' and byid['0002']['verdict'] == 'exact', (byid['0004'], byid['0002'])
    assert byid['00e2']['verdict'] == 'exact' and byid['00e1']['verdict'] == 'pending', (byid['00e2'], byid['00e1'])
    assert 'cccc' not in byid and 'fee0' not in byid, sorted(byid)
    off = sorted(e['tournament_id'][-4:] + ':' + e['verdict'] for e in d['off'])
    assert off == ['0004:over', '0005:under', '0113:over', '0210:under', '0590:over'], off
    assert (d['over'], d['under']) == (3, 2), d
    assert d['events'] == d['exact'] + d['over'] + d['under'] + d['pending'], d
    assert d['tickets']['players_at_limit'] == 1 and d['tickets']['allotment'] == 5, d['tickets']
    open_now = int(q("SELECT count(*) FROM ca_free_buy_watch_findings WHERE cleared_at IS NULL").strip())
    assert d['open_findings']['total'] == open_now and d['open_findings']['by_kind'].get('early_prize_promo') == 1, d['open_findings']
    print('PASS: the digest line reads exact, over, under and pending per event, keeps promo, house and player parts apart', flush=True)
    print('PASS: it reports the gaming day tickets (one player used all five) and every open watch finding', flush=True)

    must_fail(f"SET ROLE authenticated; SELECT fn_sp_digest_free_buy_funding('{DAY}')", 'permission denied')
    ledger_rows = q("SELECT count(*) FROM chip_ledger").strip()
    q(f"SELECT fn_sp_digest_free_buy_funding('{DAY}'); SELECT fn_ca_free_buy_funding_watch();")
    assert q("SELECT count(*) FROM chip_ledger").strip() == ledger_rows
    must_fail(DG_MIG.read_text(), 'Inspected definition changed')
    print('PASS: players cannot read the digest line; neither function writes a ledger row; a second install is refused', flush=True)
finally:
    if started:
        run([PG / 'pg_ctl', '-D', work / 'data', '-m', 'immediate', '-w', 'stop'])
    shutil.rmtree(work, ignore_errors=True)
    shutil.rmtree(sock, ignore_errors=True)
    tcp_guard.close()
