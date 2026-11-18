#!/usr/bin/env python3
"""PG17: the weekly rakeback funding cascade, round 3 and its validators.

Installs migration 20261109231855 whole on the exact production definitions it
patches and proves the cascade on an isolated board. No production access.

LOADED BYTE-EXACT FROM PRODUCTION (md5 asserted, fixtures/rakeback-cascade/production):
  round 3 stage, both payout validators, the funding function it replaces,
  fn_resolve_accounting_routing_scope, fn_union_week_start, rakeback_payer_plan,
  rakeback_certificate_wallets, rakeback_wallet_plan, rakeback_certificate_payers.

STAND-INS (fixtures/rakeback-cascade/world.sql), none of them changed by the migration:
  * smarter_private.ensure_owner_routing_wallet: lane A's door (20261109231325),
    reduced to its stated interface;
  * rounds 1 and 2 (rc_rounds_1_2): the bank receives its share under the union
    close key and each non-owner commission tier moves bank -> agent wallet
    under the round 2 key; neither real stage is loaded;
  * the receipt trigger (one paid settlement invoice per posted leg) in place of
    fn_invoice_accounting_ledger_transfer;
  * accounting_payable_earning_sources as a plain view over cash sources;
  * weekly_payout_require_round / owns_round (always owned), the chunked plan
    reader (no plan), existing-transfer discharge (none), deleted-account and
    departed-member paths (refuse), launch waiver (none), certificate
    interpretation assert (no-op), fn_lock_rakeback_payer_clubs (no-op),
    deleted_reserve_certificate_payers (delegates to rakeback_certificate_payers);
  * the balance/ledger tally, freeze, store-coverage and journal triggers on
    chip_ledger, agents and clubs are NOT modelled.
"""
import argparse, json, os, re, shutil, socket, subprocess, tempfile
from pathlib import Path
P=argparse.ArgumentParser()
P.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')))
P.add_argument('--scratch',type=Path,default=Path(os.environ.get('RUNNER_TEMP',tempfile.gettempdir())))
P.add_argument('--output',type=Path,default=None)
P.add_argument('--derive-pins',action='store_true',help='author aid: print the postimage md5s instead of asserting them')
A=P.parse_args()
R=Path(__file__).resolve().parents[2]; F=R/'scripts/ci/fixtures/rakeback-cascade'
MIG=next((R/'supabase/migrations').glob('20261109231855_*.sql'))
MIG_G=next((R/'supabase/migrations').glob('20261111132447_*.sql'))
PROD={ # signature -> production md5 (2026-11-09)
 'public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)':'21409a0d24523597e10b5da44c252840',
 'smarter_private.rakeback_wallet_payout_complete(uuid,bigint)':'0f5fbe00efb06f9a49dcfae37d5830cc',
 'smarter_private.split_rakeback_payout_complete(uuid,bigint)':'516cd5a271fd21f4b2fe6f98e503dc75',
 'smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)':'018a0fcbad1fabcf1b5427b9fa454028',
 'public.fn_resolve_accounting_routing_scope(text,uuid,timestamptz,timestamptz)':'e773d469ebeb010df4ac46757fca724e',
 'public.fn_union_week_start(timestamptz)':'103f192a228084dad0e4268c36c82c4b',
 'smarter_private.rakeback_payer_plan(jsonb,numeric)':'02296e698ad2377afa9dc4ee18315d68',
 'smarter_private.rakeback_certificate_payers(bigint)':'89b7297462b6cd4ba6bf145c7d5fa261',
 'smarter_private.rakeback_wallet_plan(jsonb,numeric)':'48f1c18a1e83272bad0d0b1e1371ce42',
 'smarter_private.rakeback_certificate_wallets(bigint)':'984721591c0295a6ca5c5552ec7bfae0',
 # loaded only so 20261111132447 installs on exactly what it pins (round 2 is still the stand-in rc_rounds_1_2); unchanged on production 2026-11-11
 'public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)':'ce1a9dd4344c7987918dcf8a82427ef5',
 'smarter_private.weekly_payout_finalize(uuid)':'5b83618b59f043376c87361c986adca8',
 'smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)':'69099f3bac93cb29fad83cb82cb1fe4a'}
# what production runs today (read 2026-11-11, both cascade files installed there 10:40Z): the fixture after 20261109231855 must equal it
INSTALLED={list(PROD)[3]:'dddb67b5024a01bb4f2dadc0ba1009f2',list(PROD)[0]:'db6ba33eed8762b2534d349024e4219f',list(PROD)[1]:'c2b4cfdbc811adfae751d47fd5b298e6',list(PROD)[2]:'47519877eefe45ac6ab39f6519bfb0e8'}
ORDER=['public.fn_union_week_start','public.fn_resolve_accounting_routing_scope','smarter_private.rakeback_payer_plan','smarter_private.rakeback_certificate_payers','smarter_private.rakeback_wallet_plan',
 'smarter_private.rakeback_certificate_wallets','smarter_private.rakeback_wallet_payout_complete','smarter_private.split_rakeback_payout_complete','smarter_private.weekly_payout_fund_agent_shortfalls','public.fn_settle_accounting_rakeback_stage',
 'public.fn_settle_accounting_commission_stage','smarter_private.weekly_payout_finalize','smarter_private.zero_standalone_foreign_commissions_proven']
E={k:v for k,v in os.environ.items() if not k.startswith('PG')};E.update(LC_ALL='C',LANG='C',PGTZ='UTC')
A.scratch.mkdir(parents=True,exist_ok=True)
W=Path(tempfile.mkdtemp(prefix='cascade-funding-',dir=A.scratch));DATA=W/'data';started=False;results=[]
with socket.socket() as sk: sk.bind(('127.0.0.1',0)); port=str(sk.getsockname()[1])
def cmd(a): return subprocess.run(list(map(str,a)),env=E,text=True,capture_output=True,check=True,timeout=120)
def q(sql,check=True):
    with tempfile.TemporaryFile(mode='w+',dir=W) as f:
        f.write(sql); f.seek(0)
        r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h','127.0.0.1','-p',port,'-d','postgres'],env=E,text=True,stdin=f,capture_output=True,timeout=300)
    if check and r.returncode: raise RuntimeError(r.stderr[-6000:])
    return r
WK="'2026-10-05 07:00+00','2026-10-12 07:00+00'"
def FUND(u='U',run='run1'): return f"smarter_private.weekly_payout_fund_agent_shortfalls(rc_u('{run}'),'union',rc_u('{u}'),{WK})"
def R3(u='U'): return f"public.fn_settle_accounting_rakeback_stage('union',rc_u('{u}'),{WK})"
def ok(cond,msg):
    cond=cond.replace("FROM chip_ledger","FROM rc_ledger").replace("FROM agents","FROM rc_agents")
    return f"SELECT rc_assert(({cond}),$m${msg}$m$);\n"
PREP="SELECT rc_rounds_1_2();CREATE TEMP TABLE rc_open AS SELECT rc_money() v;\n"
CONSERVED=ok("(SELECT v FROM rc_open)=rc_money()","no chip was created or destroyed")+"SET CONSTRAINTS ALL IMMEDIATE;\n"
def case(name,sql,refusal=None):
    before=q("SELECT rc_money()||':'||(SELECT count(*) FROM chip_ledger)||':'||(SELECT count(*) FROM agents);").stdout.strip()
    r=q('BEGIN;\n'+sql+'\nROLLBACK;\n',check=False)
    if refusal: assert r.returncode and refusal in r.stderr,(name,r.stdout[-1500:],r.stderr[-3000:])
    else: assert r.returncode==0,(name,r.stdout[-1500:],r.stderr[-5000:])
    assert q("SELECT rc_money()||':'||(SELECT count(*) FROM chip_ledger)||':'||(SELECT count(*) FROM agents);").stdout.strip()==before,(name,'a rolled-back case left rows behind')
    results.append({'case':name,'passed':True,'expected_refusal':refusal}); print('PASS',name,flush=True)
    return r
def chain(club,agents,player='P',pct=0.5,rake=100):
    """agents: [(name,rate)] top first; the player sits under the last one."""
    s=f"SELECT rc_club('{club}');"
    for i,(n,rate) in enumerate(agents): s+=f"SELECT rc_agent('{club}','{n}',{repr(agents[i-1][0]) if i else 'NULL'},{rate});"
    return s+f"SELECT rc_member('{club}','{player}','{agents[-1][0]}',{pct});SELECT rc_source('{club}','{player}',{rake});SELECT rc_certify('{club}','{player}');\n"
try:
    assert '17.' in cmd([A.pg_bin/'postgres','--version']).stdout,'PostgreSQL 17 required'
    cmd([A.pg_bin/'initdb','-D',DATA,'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
    cmd([A.pg_bin/'pg_ctl','-D',DATA,'-l',W/'server.log','-w','start','-o',f"-k '' -p {port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off"]);started=True
    q("ALTER DATABASE postgres SET TimeZone='UTC';"); q((F/'world.sql').read_text())
    for n in ORDER:
        q('SET check_function_bodies=off;\n'+(F/'production'/f'{n}.sql').read_text())
    for sig,md in PROD.items():
        got=q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()
        assert got==md,('production definition did not load byte-exact',sig,got,md)
    # ---- a week settled BEFORE the migration, by the exact production round 3 (union UL) ----
    q("SELECT rc_club('L','UL');SELECT rc_agent('L','L.owner',NULL,0.20);SELECT rc_agent('L','LA',NULL,0.30);"
      "SELECT rc_member('L','LP1','L.owner',0.70);SELECT rc_source('L','LP1',100,'2026-10-06 12:00+00','UL');"          # owner 0.70 deal, club-paid
      "SELECT rc_member('L','LP1','LA',0.10,'2026-10-08');SELECT rc_source('L','LP1',100,'2026-10-09 12:00+00','UL');"  # then under LA: a split certificate
      "SELECT rc_member('L','LP2','L.owner',0.10);SELECT rc_source('L','LP2',50,'2026-10-06 12:00+00','UL');"           # owner as recorded agent payer
      "SELECT rc_member('L','LP3',NULL,0.05);SELECT rc_source('L','LP3',40,'2026-10-06 12:00+00','UL');"                # unassigned
      "SELECT rc_certify('L',p,'v1','UL') FROM unnest(ARRAY['LP1','LP2','LP3'])p;SELECT rc_rounds_1_2(0.90,'UL');")
    q("SELECT "+R3('UL')+";")
    LEGACY="SELECT string_agg(p.id::text||'='||smarter_private.split_rakeback_payout_complete(p.id,c.id)::text||'/'||smarter_private.rakeback_wallet_payout_complete(p.id,c.id)::text,',' ORDER BY p.id) FROM rakeback_period_payouts p JOIN accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id"
    legacy_before=q(LEGACY+';').stdout.strip()
    assert legacy_before.count('=true/')==1 and legacy_before.count('=')==3,legacy_before
    legs_before=q("SELECT md5(string_agg(l::text,'|' ORDER BY id)) FROM chip_ledger l;").stdout.strip()
    # ---- install the migration file whole ----
    mig=MIG.read_text()
    if A.derive_pins:
        q('SET check_function_bodies=off;\n'+re.sub(r"IS DISTINCT FROM '[^']*' THEN RAISE EXCEPTION '(rakeback_cascade_[a-z0-9_]+_postimage_changed)'",r"IS NULL THEN RAISE EXCEPTION '\1'",mig))
        print(json.dumps({t:q(f"SELECT md5(pg_get_functiondef('{s}'::regprocedure));").stdout.strip() for t,s in [('fund',list(PROD)[3]),('wallet_validator',list(PROD)[1]),('split_validator',list(PROD)[2]),('round3',list(PROD)[0])]}))
        raise SystemExit(0)
    assert 'PENDING_' not in mig,'postimage pins missing'
    q('SET check_function_bodies=off;\n'+mig)
    proof=[l for l in mig.splitlines() if l.startswith('-- @live-proof: ')]
    assert len(proof)==1 and q('SELECT '+proof[0].split(': ',1)[1]+';').stdout.strip()=='t','live proof false after install'
    replay=q('SET check_function_bodies=off;\n'+mig,check=False)
    assert replay.returncode and 'rakeback_cascade_fund_preimage_changed' in replay.stderr,'replay must refuse on the changed preimage'
    q('ROLLBACK;',check=False)
    assert q("SELECT count(*) FROM chip_ledger l WHERE NOT EXISTS(SELECT 1 FROM settlement_invoices i WHERE i.source_ledger_id=l.id);").stdout.strip()=='0'
    # ---- settled week: every validator answers as before, nothing replayed ----
    assert q(LEGACY+';').stdout.strip()==legacy_before,'a settled payout validates differently after the migration'
    assert q("SELECT ("+R3('UL')+")->>'duplicate';").stdout.strip()=='true','settled round 3 must be a duplicate'
    assert q("SELECT ("+FUND('UL')+")->'edges';").stdout.strip()=='[]','a settled week is never funded'
    assert q("SELECT md5(string_agg(l::text,'|' ORDER BY id)) FROM chip_ledger l;").stdout.strip()==legs_before,'settled legs changed'
    results.append({'case':'legacy-paid-week-validates-unchanged-and-is-never-funded','passed':True,'expected_refusal':None}); print('PASS legacy-paid-week',flush=True)
    # ---- 20261111132447 (one transfer per edge, players' share reserved), whole, on what production runs today ----
    for sig,md in INSTALLED.items():
        assert q(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure));").stdout.strip()==md,('after 20261109231855 the fixture must equal production today',sig)
    mig_g=MIG_G.read_text(); assert 'PENDING_' not in mig_g
    q('SET check_function_bodies=off;\n'+mig_g)
    gproof=[l.split(': ',1)[1] for l in mig_g.splitlines() if l.startswith('-- @live-proof: ')]
    assert len(gproof)==6 and all(q('SELECT '+x+';').stdout.strip()=='t' for x in gproof),'a live proof of 20261111132447 is false after install'
    gre=q('SET check_function_bodies=off;\n'+mig_g,check=False)
    assert gre.returncode and 'rakeback_gross_fund_preimage_changed' in gre.stderr,'a second install must refuse'
    assert q(LEGACY+';').stdout.strip()==legacy_before,'a settled payout validates differently after 20261111132447'
    assert q("SELECT ("+R3('UL')+")->>'duplicate';").stdout.strip()=='true' and q("SELECT ("+FUND('UL')+")->'edges';").stdout.strip()=='[]'
    assert q("SELECT md5(string_agg(l::text,'|' ORDER BY id)) FROM chip_ledger l;").stdout.strip()==legs_before and q("SELECT count(*) FROM smarter_private.weekly_payout_wallet_reserves;").stdout.strip()=='0'
    results.append({'case':'gross-transfer-file-installs-whole-and-the-settled-week-is-unchanged','passed':True,'expected_refusal':None}); print('PASS gross-transfer install, settled week unchanged',flush=True)

    PAID_ALL=ok("(SELECT bool_and(status='paid') FROM rakeback_periods WHERE club_id<>rc_u('E'))","every period paid")
    NOMARK=ok("NOT EXISTS(SELECT 1 FROM chip_ledger WHERE metadata ? 'cascade_route')","no owner-wallet marker")
    case('unassigned-player-stays-club-bank-to-player',
      "SELECT rc_club('C');SELECT rc_member('C','P',NULL,0.10);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+PREP+
      ok(f"({FUND()})->'edges'='[]'::jsonb","no funding edge for an unassigned player")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=10 AND rc_bank('C')=80","bank paid the player 10")+ok("(SELECT count(*)=1 FROM chip_ledger WHERE category='rakeback' AND from_type='club_treasury' AND to_entity_id=rc_u('P') AND amount=10)","one bank leg")+
      ok("NOT EXISTS(SELECT 1 FROM agents)","no agent wallet was created for an unassigned player")+NOMARK+PAID_ALL+CONSERVED)
    OWNER_PAY=(ok("rc_leg('C',NULL,'C.owner')=70","bank funded the owner wallet with exactly what its players are owed")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=70","player paid 70")+ok("rc_bank('C')=20","bank kept 90-70")+
      ok("(SELECT count(*)=1 FROM chip_ledger WHERE category='rakeback' AND from_type='agent_wallet' AND from_entity_id=rc_u('C.owner') AND to_entity_id=rc_u('P') AND amount=70 AND metadata->>'cascade_route'='owner_wallet' AND metadata->>'paid_from'='agent_wallet')","paid from the owner agent wallet with the route marker")+
      ok("(SELECT bool_and(smarter_private.rakeback_cascade_owner_leg_paid(id,club_id,'club',NULL)) FROM chip_ledger WHERE metadata ? 'cascade_route')","owner-wallet leg names its funding")+
      ok("(SELECT count(*) FROM settlement_invoices i JOIN chip_ledger l ON l.id=i.source_ledger_id WHERE l.metadata->>'cascade'='rakeback-funding-v1')=1","funding leg has its receipt")+PAID_ALL+CONSERVED)
    case('owner-upline-existing-active-owner-row',
      "SELECT rc_club('C');SELECT rc_agent('C','C.owner',NULL,0.20);UPDATE agents SET agent_wallet_balance=500 WHERE user_id=rc_u('C.owner');SELECT rc_member('C','P','C.owner',0.70);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+PREP+
      f"SELECT {FUND()};"+OWNER_PAY+ok("rc_wallet('C','C.owner')=500 AND (SELECT status='active' AND commission_rate=0.20 FROM agents WHERE user_id=rc_u('C.owner'))","existing owner row unchanged, pass-through retained nothing"))
    case('owner-upline-no-row-creates-wallet-only',
      "SELECT rc_club('C');SELECT rc_member('C','P','C.owner',0.70);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+PREP+
      f"SELECT {FUND()};"+ok("(SELECT status='wallet_only' AND commission_rate=0 FROM agents WHERE club_id=rc_u('C') AND user_id=rc_u('C.owner'))","wallet_only owner row created at rate 0")+OWNER_PAY+ok("rc_wallet('C','C.owner')=0","wallet_only owner retains zero"))
    case('owner-upline-without-funding-keeps-existing-bank-route',
      "SELECT rc_club('C');SELECT rc_member('C','P','C.owner',0.70);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+PREP+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=70 AND rc_bank('C')=20","bank paid directly")+ok("(SELECT count(*)=1 FROM chip_ledger WHERE category='rakeback' AND from_type='club_treasury')","club treasury leg")+NOMARK+ok("NOT EXISTS(SELECT 1 FROM agents)","no wallet created")+CONSERVED)
    case('owner-as-recorded-agent-payer-routes-through-owner-wallet',
      "SELECT rc_club('C');SELECT rc_agent('C','C.owner',NULL,0.20);SELECT rc_member('C','P','C.owner',0.10);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'C.owner')=10","owner funded 10")+f"SELECT {R3()};"+ok("rc_chips('C','P')=10 AND rc_wallet('C','C.owner')=0 AND rc_bank('C')=80","owner tier stays in bank, player paid from owner wallet")+
      ok("(SELECT metadata->>'cascade_route'='owner_wallet' AND metadata->>'owner_share_payer' IS NULL FROM chip_ledger WHERE category='rakeback' AND to_entity_id=rc_u('P'))","marker, no owner_share_payer")+CONSERVED)
    case('one-tier-agent-rate-covers-player-rate-needs-nothing',
      chain('C',[('A',0.30)],pct=0.10)+PREP+ok(f"({FUND()})->'edges'='[]'::jsonb","rate >= player rate needs no funding")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=10 AND rc_wallet('C','A')=20 AND rc_bank('C')=60","agent paid 10 from its own 30")+NOMARK+CONSERVED)
    case('player-rate-above-agent-rate-is-funded-the-difference',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {FUND()};"+ok("rc_leg('C',NULL,'A')=50","bank -> A 50 (70 owed, 20 covered)")+
      ok("(SELECT category='club_bank_send' AND from_type='club_treasury' AND to_type='agent_wallet' AND post_to_balance-pre_to_balance=50 AND pre_from_balance-post_from_balance=50 FROM chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')","keyed bank leg with balances")+
      f"SELECT {R3()};"+ok("rc_chips('C','P')=70 AND rc_wallet('C','A')=0 AND rc_bank('C')=20","A retains nothing it did not earn")+NOMARK+CONSERVED)
    case('two-tiers',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};"+ok("rc_leg('C',NULL,'S')=30 AND rc_leg('C','S','A')=30","bank -> S 30 -> A 30")+
      ok("(SELECT category='agent_send' AND from_type='agent_wallet' FROM chip_ledger WHERE idempotency_key=smarter_private.rakeback_cascade_key(rc_u('C'),'2026-10-05',rc_u('S'),rc_u('A')))","agent hop is its own leg")+
      ok("(SELECT min(created_at) FILTER(WHERE from_type='club_treasury')<min(created_at) FILTER(WHERE from_type='agent_wallet') FROM chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')","parent funded before child")+
      f"SELECT {R3()};"+ok("rc_chips('C','P')=50 AND rc_wallet('C','A')=0 AND rc_wallet('C','S')=8 AND rc_bank('C')=32","S keeps its own 8 only")+CONSERVED)
    case('three-tiers',
      chain('C',[('T1',0.05),('T2',0.10),('T3',0.10)],pct=0.60)+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'T1')=50 AND rc_leg('C','T1','T2')=50 AND rc_leg('C','T2','T3')=50","50 passes down three tiers")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=60 AND rc_wallet('C','T3')=0 AND rc_wallet('C','T2')=9 AND rc_wallet('C','T1')=4.05","each tier keeps its own entitlement")+CONSERVED)
    five=[('F1',0.02),('F2',0.03),('F3',0.05),('F4',0.05),('F5',0.10)]
    r=case('five-tiers-with-tier-by-tier-reconciliation',
      chain('C',five,pct=0.55)+PREP+f"CREATE TEMP TABLE rc_plan AS SELECT {FUND()} j;"+
      ok("(SELECT count(*)=5 AND bool_and(amount=45) FROM chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')","five legs of 45")+
      ok("(SELECT bool_and((n->>'inflow')::numeric-(n->>'to_children')::numeric-(n->>'players_need')::numeric=0) AND count(*)=5 AND max((n->>'tier')::int)=5 FROM rc_plan,jsonb_array_elements(j->'nodes')n)","every tier passes on exactly what it received for others")+
      ok("(SELECT (c->>'funding_from_bank')::numeric=45 AND (c->>'received_for_week')::numeric=90 FROM rc_plan,jsonb_array_elements(j->'clubs')c)","club reconciliation")+
      f"SELECT {R3()};"+ok("rc_chips('C','P')=55 AND rc_wallet('C','F5')=0","player paid, payer keeps nothing extra")+
      ok("(SELECT sum(amount) FROM chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1' AND from_type='club_treasury')=(SELECT sum(l.amount) FROM chip_ledger l WHERE l.category='rakeback' AND l.from_type='agent_wallet')-10","bank funding = player credits routed through agents minus the payer's own 10")+CONSERVED+
      "SELECT 'RECON '||(SELECT jsonb_agg(jsonb_build_object('tier',n->'tier','inflow',n->'inflow','to_children',n->'to_children','players_need',n->'players_need','covered',n->'covered_by_own_commission') ORDER BY (n->>'tier')::int) FROM rc_plan,jsonb_array_elements(j->'nodes')n)::text;")
    recon=[l for l in r.stdout.splitlines() if l.startswith('RECON ')][0][6:]
    case('zero-percent-top-agent',
      chain('C',[('Z',0),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};"+ok("rc_leg('C',NULL,'Z')=30 AND rc_leg('C','Z','A')=30","passes through a zero-percent top agent")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=50 AND rc_wallet('C','Z')=0 AND rc_wallet('C','A')=0 AND rc_bank('C')=40","zero-percent agent retains zero")+CONSERVED)
    case('zero-percent-agent-under-a-super-agent',
      chain('C',[('S',0.25),('Z',0)],pct=0.30)+PREP+f"SELECT {FUND()};"+ok("rc_leg('C',NULL,'S')=30 AND rc_leg('C','S','Z')=30","full 30 reaches the zero-percent payer through S")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=30 AND rc_wallet('C','Z')=0 AND rc_wallet('C','S')=25 AND rc_bank('C')=35","S keeps exactly its 25")+CONSERVED)
    case('superseded-certificates-never-contribute-D5',
      chain('C',[('A',0.20)],pct=0.70)+"SELECT rc_certify('C','P','v2');SELECT rc_certify('C','P','v3');"
      "UPDATE accounting_rakeback_period_calculations SET rakeback_amount=rakeback_amount*3 WHERE player_id=rc_u('P') AND id<(SELECT max(id) FROM accounting_rakeback_period_calculations WHERE player_id=rc_u('P'));"+
      ok("(SELECT count(*)=3 AND sum(rakeback_amount)=490 FROM accounting_rakeback_period_calculations WHERE player_id=rc_u('P'))","three versions, the two old ones larger")+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'A')=50","funded from the latest certificate only (50, not 470)")+f"SELECT {R3()};"+ok("rc_chips('C','P')=70 AND rc_wallet('C','A')=0","nothing left over in the agent wallet")+CONSERVED)
    case('one-user-agent-in-two-clubs-is-two-nodes',
      chain('C',[('X',0.20)],pct=0.70)+"SELECT rc_club('D');SELECT rc_agent('D','X',NULL,0.20);SELECT rc_member('D','Q','X',0.50);SELECT rc_source('D','Q',100);SELECT rc_certify('D','Q');"
      "SELECT rc_club('E','U2');SELECT rc_agent('E','X',NULL,0.20);SELECT rc_member('E','Q2','X',0.70);SELECT rc_source('E','Q2',100,'2026-10-06 12:00+00','U2');SELECT rc_certify('E','Q2','v1','U2');"+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'X')=50 AND rc_leg('D',NULL,'X')=30","each club funds its own node")+ok("rc_wallet('C','X')=70 AND rc_wallet('D','X')=50 AND rc_wallet('E','X')=0","no cross-club leakage; another union's club untouched")+
      ok("rc_leg('E',NULL,'X') IS NULL AND rc_bank('E')=0","out-of-scope club not funded")+f"SELECT {R3()};"+ok("rc_chips('C','P')=70 AND rc_chips('D','Q')=50 AND rc_wallet('C','X')=0 AND rc_wallet('D','X')=0","both paid")+CONSERVED)
    case('mid-week-upline-change-follows-each-source-path',
      "SELECT rc_club('C');SELECT rc_agent('C','S1',NULL,0.05);SELECT rc_agent('C','S2',NULL,0.05);SELECT rc_agent('C','A','S1',0.20);SELECT rc_member('C','P','A',0.70);SELECT rc_source('C','P',100,'2026-10-06 12:00+00');"
      "SELECT rc_agent('C','A','S2',0.20,'2026-10-08');SELECT rc_source('C','P',60,'2026-10-09 12:00+00');SELECT rc_certify('C','P');"+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'S1')=50 AND rc_leg('C','S1','A')=50 AND rc_leg('C',NULL,'S2')=30 AND rc_leg('C','S2','A')=30","need 80 split 50/30 by the unrounded rakeback earned under each upline")+f"SELECT {R3()};"+
      ok("rc_chips('C','P')=112 AND rc_wallet('C','A')=0 AND rc_wallet('C','S1')=4 AND rc_wallet('C','S2')=2.4","conserved across both paths")+CONSERVED)
    case('split-certificate-owner-then-agent-uses-both-routes',
      "SELECT rc_club('C');SELECT rc_agent('C','A',NULL,0.20);SELECT rc_member('C','P','C.owner',0.70);SELECT rc_source('C','P',100,'2026-10-06 12:00+00');"
      "SELECT rc_member('C','P','A',0.50,'2026-10-08');SELECT rc_source('C','P',100,'2026-10-09 12:00+00');SELECT rc_certify('C','P');"+PREP+f"SELECT {FUND()};"+
      ok("rc_leg('C',NULL,'C.owner')=70 AND rc_leg('C',NULL,'A')=30","owner share and agent shortfall funded separately")+f"SELECT {R3()};"+ok("rc_chips('C','P')=120 AND rc_wallet('C','A')=0 AND rc_wallet('C','C.owner')=0","both legs paid")+
      ok("(SELECT smarter_private.split_rakeback_payout_complete(p.id,c.id) FROM rakeback_period_payouts p JOIN accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id WHERE p.user_id=rc_u('P'))","split validator accepts the owner-wallet leg")+
      "UPDATE chip_ledger SET metadata=metadata-'cascade_funding_key' WHERE metadata ? 'cascade_route';"+
      ok("NOT (SELECT smarter_private.split_rakeback_payout_complete(p.id,c.id) FROM rakeback_period_payouts p JOIN accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id WHERE p.user_id=rc_u('P'))","a marked leg with no funding leg behind it is refused")+CONSERVED)
    case('club-leg-mixing-unassigned-and-owner-upline-stays-on-the-bank',
      "SELECT rc_club('C');SELECT rc_member('C','P',NULL,0.10);SELECT rc_source('C','P',100,'2026-10-06 12:00+00');SELECT rc_member('C','P','C.owner',0.70,'2026-10-08');SELECT rc_source('C','P',100,'2026-10-09 12:00+00');SELECT rc_certify('C','P');"+PREP+
      ok(f"({FUND()})->'edges'='[]'::jsonb","mixed leg is not routed")+f"SELECT {R3()};"+ok("rc_chips('C','P')=80 AND rc_bank('C')=100","bank paid")+NOMARK+CONSERVED)
    case('affordability-refused-above-what-the-club-received',
      chain('C',[('S',0.05),('A',0.20)],pct=0.92)+PREP+f"SELECT {FUND()};",'rakeback_cascade_club_cannot_afford_week: club '+q("SELECT md5('rc:C')::uuid;").stdout.strip()+' received 90.00 for the week but owes 96.00')
    case('bank-short-is-refused-before-any-transfer',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+"UPDATE clubs SET chip_treasury=5 WHERE id=rc_u('C');"+f"SELECT {FUND()};",'rakeback_cascade_club_bank_short')
    case('hierarchy-cycle-is-refused',
      "SELECT rc_club('C');SELECT rc_agent('C','A','B',0.20);SELECT rc_agent('C','B','A',0.05);SELECT rc_member('C','P','A',0.70);"
      "INSERT INTO accounting_cash_rake_sources(id,player_id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract) SELECT rc_u('src'),rc_u('P'),rc_u('C'),rc_u('U'),rc_u('U'),'2026-10-06 12:00+00',100,"
      "jsonb_build_object('club_id',rc_u('C'),'membership',jsonb_build_object('history_id',h.id,'terms',h.after_terms),'tiers',jsonb_build_array(jsonb_build_object('agreement',jsonb_build_object('history_id',(SELECT max(id) FROM accounting_agreement_history WHERE subject_user_id=rc_u('A') AND entity_type='agents'))))) FROM accounting_agreement_history h WHERE h.entity_type='club_members' AND h.subject_user_id=rc_u('P');"
      "SELECT rc_certify('C','P');"+f"SELECT {FUND()};",'rakeback_cascade_hierarchy_cycle')
    case('parent-outside-the-club-is-refused',
      "SELECT rc_club('C');SELECT rc_club('D');SELECT rc_agent('D','B',NULL,0.05);SELECT rc_agent('C','A',NULL,0.20);UPDATE agents SET parent_agent_id=(SELECT id FROM agents WHERE user_id=rc_u('B')) WHERE user_id=rc_u('A');"
      "UPDATE accounting_agreement_history SET after_terms=after_terms||jsonb_build_object('parent_agent_id',(SELECT id FROM agents WHERE user_id=rc_u('B'))) WHERE subject_user_id=rc_u('A');"
      "SELECT rc_member('C','P','A',0.70);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+f"SELECT {FUND()};",'rakeback_cascade_parent_outside_club')
    case('missing-hierarchy-is-refused',
      "SELECT rc_club('C');SELECT rc_agent('C','A',NULL,0.20);UPDATE accounting_agreement_history SET after_terms=after_terms||jsonb_build_object('parent_agent_id',gen_random_uuid()) WHERE subject_user_id=rc_u('A');"
      "SELECT rc_member('C','P','A',0.70);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+f"SELECT {FUND()};",'rakeback_cascade_hierarchy_missing')
    case('missing-owner-is-refused',
      "SELECT rc_club('C','U','');SELECT rc_member('C','P',NULL,0.10);SELECT rc_source('C','P',100);SELECT rc_certify('C','P');"+f"SELECT {FUND()};",'rakeback_cascade_club_owner_missing')
    case('round3-without-funding-refuses-the-short-agent-wallet',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {R3()};",'routed_rakeback_agent_funding_shortfall')
    case('rerun-sends-nothing-twice',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};CREATE TEMP TABLE rc_snap AS SELECT rc_wallet('C','S') s,rc_wallet('C','A') a,rc_bank('C') b,(SELECT count(*) FROM rc_ledger) n;"+
      ok(f"(SELECT bool_and(e->>'state'='already_funded') AND count(*)=2 FROM jsonb_array_elements(({FUND('U','run2')})->'edges')e)","second run, even under another run id, finds both legs already funded")+
      ok("(SELECT s=rc_wallet('C','S') AND a=rc_wallet('C','A') AND b=rc_bank('C') AND n=(SELECT count(*) FROM chip_ledger) FROM rc_snap)","nothing moved on the rerun")+f"SELECT {R3()};"+
      ok(f"({FUND()})->'edges'='[]'::jsonb","after round 3 nothing is pending, nothing is funded")+CONSERVED)
    UNDO_CHILD=("DELETE FROM settlement_invoices WHERE source_ledger_id IN(SELECT id FROM chip_ledger WHERE idempotency_key=smarter_private.rakeback_cascade_key(rc_u('C'),'2026-10-05',rc_u('S'),rc_u('A')));"
      "DELETE FROM chip_ledger WHERE idempotency_key=smarter_private.rakeback_cascade_key(rc_u('C'),'2026-10-05',rc_u('S'),rc_u('A'));"
      "DELETE FROM smarter_private.weekly_payout_wallet_reserves;"  # the real step reserves after its last leg, in the same transaction: a half-committed step has none
      "UPDATE agents SET agent_wallet_balance=agent_wallet_balance-30 WHERE user_id=rc_u('A');UPDATE agents SET agent_wallet_balance=agent_wallet_balance+30 WHERE user_id=rc_u('S');")
    case('partial-failure-then-resume-completes-without-duplication',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};"+UNDO_CHILD+ok("rc_wallet('C','S')=38 AND rc_wallet('C','A')=20","state as if only the bank leg had committed")+
      ok(f"(SELECT string_agg(e->>'state',',' ORDER BY (e->>'tier')::int)='already_funded,to_send' FROM jsonb_array_elements(({FUND()})->'edges')e)","resume sends only the missing hop")+
      ok("(SELECT count(*)=2 AND sum(amount)=60 FROM chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1') AND rc_wallet('C','S')=8 AND rc_wallet('C','A')=50","no duplicate leg")+f"SELECT {R3()};"+CONSERVED)
    case('upstream-wallet-short-on-a-hop-is-refused',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};"+UNDO_CHILD+"UPDATE agents SET agent_wallet_balance=5 WHERE user_id=rc_u('S');"+f"SELECT {FUND()};",'rakeback_cascade_upstream_wallet_short')
    case('receipt-incomplete-is-refused',
      chain('C',[('A',0.20)],pct=0.70)+PREP+"SET LOCAL rc.no_receipt='1';"+f"SELECT {FUND()};",'rakeback_cascade_receipt_incomplete')
    case('certificate-grown-after-funding-is-refused',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {FUND()};"+"SELECT rc_source('C','P',10,'2026-10-07 12:00+00');SELECT rc_certify('C','P','v2');"+f"SELECT {FUND()};",'rakeback_cascade_funded_amount_changed')
    case('frozen-agent-as-payer-is-funded-and-pays-like-round-3-today',
      chain('C',[('A',0.20)],pct=0.70)+PREP+"UPDATE agents SET status='frozen' WHERE user_id=rc_u('A');"+f"SELECT {FUND()};"+ok("rc_leg('C',NULL,'A')=50","frozen payer funded: round 3 pays from the wallet row whatever its status")+
      f"SELECT {R3()};"+ok("rc_chips('C','P')=70 AND rc_wallet('C','A')=0 AND (SELECT status='frozen' FROM agents WHERE user_id=rc_u('A'))","paid, status untouched")+CONSERVED)
    RES=lambda who,amt:ok(f"(SELECT sum(remaining) FROM smarter_private.weekly_payout_wallet_reserves WHERE user_id=rc_u('{who}'))={amt}",f"{who} reserves {amt}")
    RELEASED=ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0 OR released_at IS NULL) AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves)","round 3 released every reserve")
    REFUSED='agent_wallet_weekly_rakeback_reserved: agent '
    case('reserve-is-owed-not-only-pass-through-and-round-3-releases-it',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+f"SELECT {FUND()};"+RES('A',50)+ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE user_id=rc_u('S'))","S pays no player, so reserves nothing")+
      ok("(SELECT set_by='funding' AND reserved=50 FROM smarter_private.weekly_payout_wallet_reserves)","set by the funding step for a scope round 2 did not carry")+f"SELECT {R3()};"+RELEASED+ok("rc_chips('C','P')=50 AND rc_wallet('C','A')=0","paid")+CONSERVED)
    case('a-debit-of-the-reserved-part-is-refused-with-the-specific-error',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {FUND()};"+RES('A',70)+"UPDATE agents SET agent_wallet_balance=agent_wallet_balance-0.01 WHERE user_id=rc_u('A');",REFUSED+q("SELECT md5('rc:A')::uuid;").stdout.strip())
    case('own-commission-covering-the-player-is-reserved-too-and-the-surplus-still-moves',
      chain('C',[('A',0.30)],pct=0.10)+PREP+f"SELECT {FUND()};"+ok("rc_wallet('C','A')=30","A holds its 30 commission")+RES('A',10)+
      "UPDATE agents SET agent_wallet_balance=agent_wallet_balance-20 WHERE user_id=rc_u('A');UPDATE clubs SET chip_treasury=chip_treasury+20 WHERE id=rc_u('C');"+ok("rc_wallet('C','A')=10","the unreserved 20 left the wallet")+
      f"SELECT {R3()};"+RELEASED+ok("rc_chips('C','P')=10 AND rc_wallet('C','A')=0","the reserved 10 paid the player"))
    case('own-commission-reserve-refuses-the-reserved-part',
      chain('C',[('A',0.30)],pct=0.10)+PREP+f"SELECT {FUND()};"+"UPDATE agents SET agent_wallet_balance=agent_wallet_balance-20.01 WHERE user_id=rc_u('A');",'at most 20.00 can leave this wallet')
    case('a-frozen-payer-keeps-its-players-share-reserved',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {FUND()};"+"UPDATE agents SET status='frozen' WHERE user_id=rc_u('A');UPDATE agents SET agent_wallet_balance=0 WHERE user_id=rc_u('A');",REFUSED)
    case('deleting-a-reserving-wallet-is-refused',
      chain('C',[('A',0.20)],pct=0.70)+PREP+f"SELECT {FUND()};"+"DELETE FROM agents WHERE user_id=rc_u('A');",REFUSED)
    CARRY=("UPDATE chip_ledger SET amount=amount+30,metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('commission_amount',amount,'rakeback_funding',30,'rakeback_funding_key',smarter_private.rakeback_cascade_key(rc_u('C'),'2026-10-05',NULL,rc_u('S')),'rakeback_funding_version','rakeback-funding-v1') "
      "WHERE category='commission' AND to_entity_id=rc_u('S') AND club_id=rc_u('C');UPDATE clubs SET chip_treasury=chip_treasury-30 WHERE id=rc_u('C');UPDATE agents SET agent_wallet_balance=agent_wallet_balance+30 WHERE user_id=rc_u('S');")
    case('an-edge-round-2-carried-in-its-commission-leg-is-not-funded-again',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+CARRY+f"CREATE TEMP TABLE rc_f AS SELECT {FUND()} j;"+
      ok("(SELECT string_agg(e->>'state',',' ORDER BY (e->>'tier')::int) FROM rc_f,jsonb_array_elements(j->'edges')e)='already_funded,to_send'","bank -> S was carried by the round 2 leg; only S -> A is sent")+
      ok("rc_leg('C',NULL,'S') IS NULL AND rc_leg('C','S','A')=30","no second leg on the carried edge")+
      ok("(SELECT (c->>'commission_from_bank')::numeric+(c->>'funding_from_bank')::numeric<=90 AND (c->>'funding_from_bank')::numeric=30 FROM rc_f,jsonb_array_elements(j->'clubs')c)","affordability counts the carried 30 once, as funding")+
      f"SELECT {R3()};"+ok("rc_chips('C','P')=50 AND rc_wallet('C','A')=0","paid")+RELEASED+CONSERVED)
    case('a-carried-split-smaller-than-the-plan-is-refused',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+CARRY.replace("'rakeback_funding',30","'rakeback_funding',29").replace("amount+30","amount+29")+f"SELECT {FUND()};",'rakeback_cascade_funded_amount_changed')
    case('a-week-round-2-carried-has-nothing-left-to-send',
      chain('C',[('S',0.10),('A',0.20)],pct=0.50)+PREP+"INSERT INTO accounting_routed_settlement_runs(union_id,period_start,period_end,round_no,result) VALUES(rc_u('U'),'2026-10-05 07:00+00','2026-10-12 07:00+00',2,'{\"rakeback_cascade\":{\"version\":\"rakeback-funding-v1\"}}');"+f"SELECT {FUND()};",'rakeback_cascade_round2_left_edge_unfunded')
    case('horse-and-human-are-not-told-apart',
      "SELECT "+ok("NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (p.proname LIKE 'rakeback_cascade%' OR p.proname='weekly_payout_fund_agent_shortfalls') AND pg_get_functiondef(p.oid) ILIKE '%is_horse%')","no is_horse in the cascade")[7:])
    out={'status':'passed','migration':MIG.name,'cases':len(results),'results':results,'tier_reconciliation_five_tiers':json.loads(recon)}
    if A.output: A.output.parent.mkdir(parents=True,exist_ok=True); A.output.write_text(json.dumps(out,indent=2)+'\n')
    print('tier reconciliation (five tiers):',recon)
    print(json.dumps({'status':'passed','cases':len(results)}))
finally:
    if started: subprocess.run([str(A.pg_bin/'pg_ctl'),'-D',str(DATA),'-m','immediate','stop'],env=E,capture_output=True)
    shutil.rmtree(W,ignore_errors=True)
