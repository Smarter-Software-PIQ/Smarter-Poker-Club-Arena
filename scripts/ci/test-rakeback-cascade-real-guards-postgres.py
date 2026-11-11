#!/usr/bin/env python3
"""PG17: the weekly rakeback funding cascade under the REAL production money guards.

Lane B's harness (test-rakeback-cascade-funding-postgres.py) proves the cascade's
arithmetic on stand-in tables. This one runs the same two migrations
(20261109231325 wallet-only owner row, 20261109231855 funding cascade + round 3
owner route + validators), installed whole, on production's own tables,
triggers and functions, so a refusal the first real run would meet is met here.

WHAT IS REAL (fixtures/rakeback-cascade-real-guards, read from production
2026-11-09 with SELECT only; md5 of every function in manifest.json and
asserted byte-exact after loading):
  * 96 relations with production's columns, defaults, generated columns, CHECK,
    UNIQUE and PRIMARY KEY constraints and indexes (production-relations.json);
  * 206 functions (production-functions.json), among them the whole journal
    stack: fn_ca_autoledger, fn_ca_tally_*, fn_ca_balance_has_its_ledger_row
    (deferred, at COMMIT), fn_ca_chip_store_declared, fn_ca_chip_ledger_enrich,
    zz_chip_ledger_key_is_claimed_once, fn_refuse_while_frozen and
    fn_platform_frozen, fn_cashier_balance_actor_guard, guard_agent_wallet_direct_update,
    fn_ca_refuse_replica_money_write, fn_ca_deleted_wallet_credit and its bank
    return, the receipt chain (fn_invoice_accounting_ledger_transfer,
    fn_deliver_accounting_invoice), fn_ca_rakeback_payout_leg_is_documented,
    round 3 itself, both payout validators, weekly_payout_require_round /
    owns_round / owned_money_write, the certificate contract triggers, the
    agreement capture, and the reconciliation readers fn_ca_treasury_positions
    and fn_chip_drift_since_baseline;
  * every production trigger on chip_ledger (30), agents (27), settlement_invoices,
    rakeback_period_payouts, rakeback_periods, wallet_transactions,
    chip_transactions, union_wallets, the accounting_rakeback_* contract and
    transfer tables, accounting_routed_settlement_runs and
    accounting_agreement_history; on clubs and club_members every trigger that
    can fire on UPDATE (the cascade never inserts or deletes there), plus
    trg_ca_club_gets_a_baseline;
  * the configuration rows the guards read: ca_chip_store_coverage, the ledger
    invariant modes (all 'refuse'), the weekly payout phase configuration, and
    the weekly runner's own session settings (cron job weekly-payout-rounds).
Every case runs in its own database and every step is a COMMITTED transaction,
so the deferred commit-time guards fire exactly where production fires them.

STAND-INS (stubs.sql; the harness fails if any other production function differs):
  * public.fn_accounting_union_earned_plan: round 3 PERFORMs it and discards the
    result; it re-derives the union's earned plan from rake records;
  * smarter_private.assert_own_agent_scope_interpreted: a precondition on the
    weekly preparation job's versions, which the fixture does not run.
SINKS (platform.sql): realtime.send (broadcast only). auth.uid/role/jwt are
Supabase's published definitions. dblink exists but has no server to reach, so
fn_ca_ledger_refusal_record's out-of-band copy of a refusal is not written (the
function swallows that by design; the refusal itself is raised).

NOT LOADED, AND WHAT STANDS IN (scenarios.sql, each marked there):
  * rounds 1 and 2: their leg-writing statements are copied from
    fn_union_weekly_rakeback_close and fn_settle_accounting_commission_stage and
    run under the real guards; the stages' own planning is not loaded;
  * weekly_payout_next_round: gated on the Monday wall clock and on week
    preparation. rg.tick3 runs its round 3 unit statement for statement
    (funding call, owned-transaction row, round 3, receipt test, release);
  * the certificate calculator: certificates are written by the fixture and
    must pass the real certificate triggers;
  * opening chips: the fixture is the mint door (balance, keyed leg, register row);
  * accounting_agreement_history.observed_at reads a fixture clock so agreements
    predate the settled week; the capture and immutability triggers are real;
  * foreign keys (96 dropped), row level security, grants and function ACLs are
    not modelled; the session is a superuser named postgres (production's
    postgres is BYPASSRLS, not superuser);
  * INSERT-only and DELETE-only triggers on clubs and club_members (25) and all
    triggers on tables the unit does not write (profiles, unions, union_clubs,
    agent_commissions, the earning source tables) are not wired.

--scale PLAYERS:ALLOCATIONS times the funding function and the whole unit on a
production-sized board (1400:1300 is week 2026-11-02's size). It is not a case.
"""
import argparse, json, os, re, shutil, socket, subprocess, sys, tempfile, time
from pathlib import Path
P=argparse.ArgumentParser()
P.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')))
P.add_argument('--scratch',type=Path,default=Path(os.environ.get('RUNNER_TEMP',tempfile.gettempdir())))
P.add_argument('--output',type=Path,default=None)
P.add_argument('--keep',action='store_true',help='author aid: leave the cluster running and print its port')
P.add_argument('--cascade-migration',type=Path,default=None,help='author aid: a mutated copy of the cascade migration, to prove a case fails')
P.add_argument('--scale',default=None,help='PLAYERS:ALLOCATIONS, e.g. 1400:1300. Times the funding function and the unit on a production-sized board; not a case')
P.add_argument('--usage-out',type=Path,default=None,help='author aid: write the production functions and relations the cases actually touched')
P.add_argument('--write-manifest',type=Path,default=None,help='author aid: write the manifest of what was loaded to this path (copy it over fixtures/.../manifest.json) and stop')
P.add_argument('--stop-after',default=None,help='author aid: boot|install')
A=P.parse_args()
R=Path(__file__).resolve().parents[2]; F=R/'scripts/ci/fixtures/rakeback-cascade-real-guards'
sys.path.insert(0,str(F)); import world
MIG_A=next((R/'supabase/migrations').glob('20261109231325_*.sql')); MIG_B=A.cascade_migration or next((R/'supabase/migrations').glob('20261109231855_*.sql'))
MIG_G=next((R/'supabase/migrations').glob('20261111132447_*.sql'))
FUNCS=json.loads((F/'production-functions.json').read_text()); REL=json.loads((F/'production-relations.json').read_text()); CFG=json.loads((F/'production-config.json').read_text())
E={k:v for k,v in os.environ.items() if not k.startswith('PG')};E.update(LC_ALL='C',LANG='C',PGTZ='UTC')
A.scratch.mkdir(parents=True,exist_ok=True)
W=Path(tempfile.mkdtemp(prefix='cascade-real-',dir=A.scratch));DATA=W/'data';started=False;results=[]
with socket.socket() as sk: sk.bind(('127.0.0.1',0)); port=str(sk.getsockname()[1])
def cmd(a): return subprocess.run(list(map(str,a)),env=E,text=True,capture_output=True,check=True,timeout=180)
def q(sql,check=True,stop=True,timeout=900):
    with tempfile.TemporaryFile(mode='w+',dir=W) as f:
        f.write(sql); f.seek(0)
        r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP='+('1' if stop else '0'),'-U','postgres','-h','127.0.0.1','-p',port,'-d','postgres'],env=E,text=True,stdin=f,capture_output=True,timeout=timeout)
    if check and r.returncode: raise RuntimeError(r.stderr[-8000:])
    return r
PRE="""
SET check_function_bodies=off;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator NOLOGIN; CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE ca_ledger_refusal_recorder NOLOGIN; CREATE ROLE engine_lightning_fold NOLOGIN; CREATE ROLE dashboard_user NOLOGIN; CREATE ROLE supabase_read_only_user NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION dblink SCHEMA extensions; CREATE EXTENSION pg_trgm SCHEMA extensions;
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
SET search_path TO "$user", public, extensions;
"""
def load_world():
    seqs,tabs,defaults,cons,idx,views,dropped_fk=world.tables_sql(REL)
    q(PRE+(F/'platform.sql').read_text()+'\n'.join(seqs)+'\n'+'\n'.join(tabs))
    r=q('SET check_function_bodies=off;\n'+'\n'.join(v['def'].rstrip()+';' for k,v in sorted(FUNCS.items())),stop=False)
    got=dict(l.split('\t') for l in q("SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||E'\\t'||md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','smarter_private') AND p.prokind='f';").stdout.strip().split('\n'))
    missing=sorted(k for k in FUNCS if k not in got); wrong=sorted(k for k in FUNCS if k in got and got[k]!=FUNCS[k]['md5'])
    assert not wrong,('production definitions did not load byte-exact',wrong)
    r2=q('\n'.join(defaults+cons+idx),stop=False)
    r3=q('\n'.join(v for _,v in views),stop=False)
    wired,skipped=world.triggers(REL)
    r4=q('\n'.join(t['sql'] for t in wired),stop=False)
    # two independent production readouts must agree: the md5 each trigger reported for its function, and the function we loaded
    byname={k.split('(')[0]:v['md5'] for k,v in FUNCS.items()}
    bad=[(t['table'],t['name'],t['function']) for t in wired if byname.get(t['function'])!=t['function_md5']]
    assert not bad,('a wired trigger names a function whose loaded definition is not the one production reported',bad)
    return dict(missing=missing,func_err=r.stderr,ddl_err=r2.stderr,view_err=r3.stderr,trg_err=r4.stderr,wired=wired,skipped=skipped,dropped_fk=dropped_fk)

SIGS="SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||E'\\t'||md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','smarter_private') AND p.prokind='f';"
def changed(db='postgres'):
    got=dict(l.split('\t') for l in tx(db,SIGS).stdout.strip().split('\n') if '\t' in l)
    return sorted(k.split('(')[0] for k in FUNCS if got.get(k)!=FUNCS[k]['md5'])
USED={'functions':set(),'relations':set()}
def collect(db):
    r=tx(db,"SELECT 'F'||E'\\t'||schemaname||'.'||funcname FROM pg_stat_user_functions WHERE calls>0 UNION ALL SELECT 'R'||E'\\t'||schemaname||'.'||relname FROM pg_stat_user_tables WHERE COALESCE(seq_scan,0)+COALESCE(idx_scan,0)+n_tup_ins+n_tup_upd+n_tup_del>0;").stdout
    for l in r.strip().split('\n'):
        if '\t' in l: k,v=l.split('\t'); USED['functions' if k=='F' else 'relations'].add(v)
def manifest(L):
    return {'source':'production kuklfnapbkmacvwxktbh, read 2026-11-09 (SELECT only)','functions':{k:v['md5'] for k,v in sorted(FUNCS.items())},
      'wired_triggers':[[t['table'],t['name'],t['function'],t['function_md5']] for t in L['wired']],
      'triggers_not_wired_on_clubs_and_club_members':[[t['table'],t['name'],t['events']] for t in L['skipped'] if t['table'] in('public.clubs','public.club_members')],
      'relations':sorted(REL),'foreign_keys_dropped':len(L['dropped_fk']),
      'stand_ins':{'public.fn_accounting_union_earned_plan':[v['md5'] for k,v in FUNCS.items() if k.startswith('public.fn_accounting_union_earned_plan(')][0],
                   'smarter_private.assert_own_agent_scope_interpreted':[v['md5'] for k,v in FUNCS.items() if k.startswith('smarter_private.assert_own_agent_scope_interpreted(')][0]},
      'fixture_files_md5':{n:__import__('hashlib').md5((F/n).read_bytes()).hexdigest() for n in('production-functions.json','production-relations.json','production-config.json')}}
def cfg_rows(table,rows): return f"INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},$cfg${json.dumps(rows)}$cfg$::jsonb);\n"
def load_config():
    q(cfg_rows('public.ca_chip_store_coverage',CFG['coverage'])+cfg_rows('public.ca_ledger_invariant_store_mode',CFG['store_mode'])+cfg_rows('public.ca_ledger_invariant_mode',CFG['mode'])
      +cfg_rows('smarter_private.weekly_payout_phase_configuration',CFG['phase_cfg'])+cfg_rows('smarter_private.weekly_payout_rounds_config',CFG['rounds_cfg'])
      +cfg_rows('smarter_private.daily_window_policy',CFG['window_policy'])+cfg_rows('public.accounting_cash_accrual_cutover',[CFG['cutover']]))
def tx(db,sql,refusal=None,name=''):
    """One committed transaction on the runner's connection settings (postgres, 1500s statements, 30s locks)."""
    runner=CFG['weekly_runner']['command'].split(';')[0]+';\n'
    with tempfile.TemporaryFile(mode='w+',dir=W) as f:
        f.write(runner+'BEGIN;\n'+sql+'\nCOMMIT;\n'); f.seek(0)
        r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h','127.0.0.1','-p',port,'-d',db],env=E,text=True,stdin=f,capture_output=True,timeout=1800)
    if refusal:
        assert r.returncode and refusal in r.stderr,(name,'expected refusal',refusal,r.stdout[-800:],r.stderr[-3000:])
        notes[name]=[l for l in r.stderr.split('\n') if l.startswith('ERROR')][0][:400]+' | '+' <- '.join(re.findall(r'PL/pgSQL function ([a-z_.0-9]+)\(',r.stderr)[:6])
    else: assert r.returncode==0,(name,r.stdout[-1500:],'\n'.join(l for l in r.stderr.split('\n') if not l.startswith('WARNING'))[-6000:])
    return r
INSTALL_B=MIG_B.read_text().replace('BEGIN;','SET check_function_bodies=off;',1).replace('COMMIT;','',1)  # run inside tx()'s own transaction
INSTALL_G=MIG_G.read_text().replace('BEGIN;','SET check_function_bodies=off;',1).replace('COMMIT;','',1)
def one(db,sql): return tx(db,sql).stdout.strip().split('\n')[-1]
ncase=[0]; notes={}
def case(name,steps,template='postgres'):
    ncase[0]+=1; db=f"c{ncase[0]}"
    q(f"CREATE DATABASE {db} TEMPLATE {template};")
    try:
        for i,st in enumerate(steps):
            sql,ref=(st,None) if isinstance(st,str) else st
            tx(db,sql,ref,f"{name} step {i+1}")
    finally:
        if A.usage_out: collect(db)
        if not A.keep: q(f"DROP DATABASE {db} WITH (FORCE);")
    results.append({'case':name,'passed':True}); print('PASS',name,flush=True)
def ok(cond,msg): return f"SELECT rg.ok(({cond}),$m${msg}$m$);\n"
TICK="SELECT rg.tick3();\n"
try:
    assert '17.' in cmd([A.pg_bin/'postgres','--version']).stdout,'PostgreSQL 17 required'
    cmd([A.pg_bin/'initdb','-D',DATA,'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
    cmd([A.pg_bin/'pg_ctl','-D',DATA,'-l',W/'server.log','-w','start','-o',f"-k '' -p {port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c track_functions=all -c max_locks_per_transaction=512"]);started=True
    q("ALTER DATABASE postgres SET TimeZone='UTC';")
    L=load_world()
    for k in('func_err','ddl_err','view_err','trg_err'): assert 'ERROR' not in L[k],(k,L[k][-3000:])
    assert not L['missing'],L['missing']
    M=manifest(L)
    if A.write_manifest: A.write_manifest.write_text(json.dumps(M,indent=0,sort_keys=True)); raise SystemExit(0)
    assert json.loads((F/'manifest.json').read_text())==json.loads(json.dumps(M)),'the loaded world is not the one manifest.json records (rerun with --write-manifest after a deliberate fixture change)'
    if A.stop_after=='boot':
        print('MISSING FUNCS',len(L['missing']),L['missing'][:80]);
        for k in('func_err','ddl_err','view_err','trg_err'):
            errs=[l for l in L[k].split('\n') if 'ERROR' in l]; print(k,len(errs)); print('\n'.join(sorted(set(e[:300] for e in errs))[:60]))
        raise SystemExit(0)

    load_config(); q((F/'stubs.sql').read_text()); q('SET check_function_bodies=off;\n'+(F/'scenarios.sql').read_text())
    STAND_INS=['public.fn_accounting_union_earned_plan','smarter_private.assert_own_agent_scope_interpreted']
    assert changed()==sorted(STAND_INS),('stand-ins must be exactly the listed ones',changed())
    # check_function_bodies=off: fn_club_opening_checklist_complete declares %ROWTYPE variables of opening-checklist tables this pruned world does not carry (no case calls it)
    WALLET_FILE=['public.fn_enforce_agent_commission_bounds','public.fn_ca_agent_payables','public.get_club_agents','public.fn_club_opening_checklist_complete']
    q('SET check_function_bodies=off;\n'+MIG_A.read_text())
    assert changed()==sorted(STAND_INS+WALLET_FILE),changed()
    # 20261111132447 also replaces round 2, finalize and the zero-standalone validator. This world never runs them (round 2 is
    # the fixture's rg.round2), so their production definitions are loaded only so the file installs on exactly what it pins.
    RUNNER_FUNCS=json.loads((R/'scripts/ci/fixtures/rakeback-cascade-real-runner/production-functions.json').read_text())
    G_PRE={'public.fn_settle_accounting_commission_stage(':'ce1a9dd4344c7987918dcf8a82427ef5','smarter_private.weekly_payout_finalize(':'5b83618b59f043376c87361c986adca8',
      'smarter_private.zero_standalone_foreign_commissions_proven(':'69099f3bac93cb29fad83cb82cb1fe4a'}
    for pre_sig,pre_md5 in G_PRE.items():
        k,v=next((k,v) for k,v in RUNNER_FUNCS.items() if k.startswith(pre_sig)); assert v['md5']==pre_md5,(k,v['md5'])
        q('SET check_function_bodies=off;\n'+v['def'].rstrip()+';')
        assert tx('postgres',f"SELECT md5(pg_get_functiondef('{k.split('(')[0]}'::regproc));").stdout.strip().split('\n')[-1]==pre_md5,k
    q("CREATE DATABASE pre TEMPLATE postgres;")  # the world before the cascade migration: production round 3 and validators, unpatched
    q('SET check_function_bodies=off;\n'+MIG_B.read_text())
    MIGRATED=WALLET_FILE+['public.fn_settle_accounting_rakeback_stage','smarter_private.rakeback_wallet_payout_complete','smarter_private.split_rakeback_payout_complete','smarter_private.weekly_payout_fund_agent_shortfalls']
    assert changed()==sorted(STAND_INS+MIGRATED),('only the two stand-ins and the eight functions the two migrations replace may differ from production',changed())
    q('SET check_function_bodies=off;\n'+MIG_G.read_text())
    assert changed()==sorted(STAND_INS+MIGRATED),('20261111132447 may change, among the functions this world loads, only the funding function and round 3',changed())
    assert tx('postgres',"SELECT count(*) FROM pg_trigger WHERE tgrelid='public.agents'::regclass AND tgname='zzzzz_agent_wallet_keeps_weekly_reserve';").stdout.strip().split('\n')[-1]=='1'
    if A.stop_after=='install': raise SystemExit(0)
    if A.scale:
        exec((F/'cases.py').read_text().split('# (i) zero-percent')[0])
        np,na=map(int,A.scale.split(':')); q("CREATE DATABASE scale TEMPLATE postgres;"); T={}
        def timed(label,sql):
            t0=time.time(); r=tx('scale',sql,name=label); T[label]=round(time.time()-t0,2); print('TIMED',label,T[label],'s',flush=True); return r
        timed('build board',f"SELECT rg.bulk({np},{na});"); tx('scale',"ANALYZE;".replace('ANALYZE;','SELECT 1;'))
        q_an=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-U','postgres','-h','127.0.0.1','-p',port,'-d','scale','-c','ANALYZE'],env=E,capture_output=True,text=True)
        print(tx('scale',"SELECT jsonb_build_object('certificates',count(*),'allocations',sum(jsonb_array_length(source_allocations)),'owed',sum(rakeback_amount),'bytes',pg_size_pretty(pg_total_relation_size('public.accounting_rakeback_period_calculations'))) FROM public.accounting_rakeback_period_calculations;").stdout.strip().split('\n')[-1],flush=True)
        timed('round 1 (fixture)',"SELECT rg.round1();"); timed('round 2 (fixture)',"SELECT rg.round2();"); tx('scale',"SELECT rg.book_run();")
        timed('owner-upline test over every certificate',"SELECT count(*) FILTER(WHERE smarter_private.rakeback_cascade_owner_upline(c.id,cl.owner_id,NULL)) FROM public.accounting_rakeback_period_calculations c JOIN public.clubs cl ON cl.id=c.club_id;")
        timed('funding function alone (rolled back)',"SAVEPOINT s;SELECT jsonb_array_length(smarter_private.weekly_payout_fund_agent_shortfalls((SELECT run_id FROM public.weekly_accounting_payout_pauses),'union',rg.u('U'),rg.ws(),rg.we())->'edges');ROLLBACK TO s;")
        timed('whole round 3 unit: funding + round 3',"SELECT (rg.tick3()->'funding'->'edges')::text;")
        print(tx('scale',CHECKS+"SELECT jsonb_build_object('funding_legs',(SELECT count(*) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1'),'funded',(SELECT sum(amount) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1'),'owner_route_legs',(SELECT count(*) FROM public.chip_ledger WHERE metadata->>'cascade_route'='owner_wallet'),'payouts',(SELECT count(*) FROM public.rakeback_period_payouts));").stdout.strip().split('\n')[-1],flush=True)
        print(json.dumps({'scale':A.scale,'seconds':T}),flush=True)
        if not A.keep: q("DROP DATABASE scale WITH (FORCE);")
        raise SystemExit(0)
    exec((F/'cases.py').read_text())
    if A.usage_out: A.usage_out.write_text(json.dumps({k:sorted(v) for k,v in USED.items()},indent=0))
    out={'status':'passed','cases':len(results)}
    if A.output: A.output.write_text(json.dumps({**out,'results':results,'refusals_observed':notes},indent=1))
    print(json.dumps(out))
finally:
    if A.keep and started: print('KEPT port',port,'dir',W,flush=True)
    else:
        if started: subprocess.run([str(A.pg_bin/'pg_ctl'),'-D',str(DATA),'-m','immediate','-w','stop'],env=E,capture_output=True)
        shutil.rmtree(W,ignore_errors=True)
