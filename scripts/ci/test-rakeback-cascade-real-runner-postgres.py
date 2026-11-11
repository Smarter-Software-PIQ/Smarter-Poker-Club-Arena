#!/usr/bin/env python3
"""PG17: one union week through the REAL weekly runner, tick by tick, with the cascade installed.

Lane C's harness (test-rakeback-cascade-real-guards-postgres.py) proves the
funding legs and round 3 under the production trigger stack, but it copies the
leg statements of rounds 1 and 2 and runs round 3 as a hand-written unit. This
one closes that gate without a Backup host: the two cascade migrations are read
from disk at run time and installed whole on production's own definitions, and
ONE union week is then driven by the cron commands production runs, in the
order and at the (fixture) minutes production runs them:

  weekly-prep-shard-0..3   CALL smarter_private.weekly_prep_shard(n,4)
  weekly-payout-readiness  SELECT smarter_private.weekly_payout_readiness_check()
  weekly-payout-rounds     SELECT set_config('statement_timeout','1500s',false),
                           set_config('lock_timeout','30s',false);
                           SELECT smarter_private.weekly_payout_next_round();

Each command is sent as one simple-query string on a new connection as user
postgres, which is what pg_cron does (fixtures/.../production-config.json holds
the commands exactly as cron.job has them).

WHAT IS REAL (fixtures/rakeback-cascade-real-runner; read from production with
SELECT only; md5 of every function in manifest.json, asserted after loading):
  * the runner smarter_private.weekly_payout_next_round and everything it
    executes: weekly_payout_scope_plan / eligible_scopes, fn_prepare_accounting_week,
    fn_accounting_close_windows_pending, the round ownership capability
    (weekly_payout_require_round / owns_round / owned_money_write),
    weekly_payout_finalize;
  * REAL round 1 fn_union_weekly_rakeback_close (earned plan combined from its
    proved windows, fn_union_club_rake_basis, fn_credit_treasury,
    fn_union_close_post_rake_debit, its conservation test, the ca_settlements
    state walk under its real transition guard);
  * REAL round 2 fn_settle_accounting_commission_stage (window combine path);
  * the funding cascade and REAL round 3 fn_settle_accounting_rakeback_stage
    with both payout validators, as the two migrations on disk define them;
  * the REAL preparation job (weekly_prep_shard / weekly_prep_unit): own-agent
    clean windows, earned-plan windows, the split calculator (players, tq,
    counts, check, write) that writes the certificates, round 2 and round 3
    windows; and the REAL readiness check;
  * the REAL earning producer for every hand: fn_accrue_cash_hand_commissions
    -> fn_accounting_cash_commission_plan -> fn_accounting_earning_contract ->
    accounting_cash_rake_sources + agent_commissions;
  * the money guard stack on every table the run writes (see manifest.json:
    wired_triggers), the commit-time ledger invariant, the receipt chain, the
    reconciliation readers, and smarter_private.assert_own_agent_scope_interpreted
    (a stand-in in lane C's harness; real here because preparation is real).

SEEDED, NOT COMPUTED (scenario.sql, each marked there):
  * people, the union, clubs, memberships and agent rows (agreements are
    captured by the real capture triggers at a fixture instant before the week);
  * each hand's rake_records and rake_attributions rows (the engine writes
    them), and the bank side of each hand: the union rake wallet credit, its
    union_wallet_transactions row, its chip_ledger mint leg and its
    accounting_cash_bank_receipts row (the engine's rake settlement writes
    them; the fixture is the mint door);
  * configuration singletons the path reads (production-config.json).

THE BOARD (cases.py): one union, three clubs, one accounting week (2026-11-09 to
2026-11-16 America/Los_Angeles):
  O  the owner is the recorded upline of two players and has an active agents row;
  W  the owner is the recorded upline of two players and has no agents row
     (the funding step creates the wallet_only row);
  T  super agent -> agent -> sub agent, the bottom agent at 0 percent owing its
     player 50 percent (pass-through down three hops), plus one unassigned player.

STAND-INS (one):
  1. The fixture clock (fixtures/.../clock.sql): now(), clock_timestamp(),
     statement_timestamp() and transaction_timestamp() answer the real instant
     plus a per-database offset the harness moves between ticks, so that Monday
     2026-11-16 arrives.
Nothing in any production function is edited or replaced by the harness.
PREPARATION SHARD (finding P1): production's smarter_private.weekly_prep_shard
cannot record a prepared unit (`UPDATE ... SET units=units+1` is ambiguous
between its variable and the column; cron.job_run_details shows the same
failure on production on 2026-11-09). The harness first runs the production
body and asserts that failure, then installs migration
20261110053814_weekly_preparation_shard_records_its_units.sql whole from disk
on that production preimage, and asserts a second install is refused.
SINKS: realtime.send (lane C's platform.sql). Notification, reporting and
P&L-observation triggers are not wired (manifest.json lists every trigger
that is and is not).

CLUB ISOLATION (20261111174403, fixtures/.../club-isolation.py): after the week above, two more union weeks on
the same board: a club that cannot fund its week is held while the others are paid and is paid once when funded
(round 1 still fails the whole union closed); a cross-club upline holds both clubs; an upline deleted after round 2
holds its club alone in round 3; a second runner tick and an agent's stake race round 3. Stand-ins there (each
marked in that file): one owner deposit minted to a club bank, one agreement-history row inserted after
preparation, one profile status set to deleted.

DEBIT DOORS (fixtures/.../between-rounds.py and before-round2.py, lanes I, J and K): every production function that
writes agents.agent_wallet_balance outside the weekly rounds, byte-exact (debit-paths.json), executed against the
reserves round 2 sets: debits refused for the reserved part and moving for the rest, credit-only doors landing, the
v3 commission fallback, and the two ON DELETE CASCADE foreign keys into agents. Stand-ins there are marked.

NOT RUN: job 272 union-weekly-rakeback-close (the post-money books: P&L,
documents, invoices; the runner owns the money), tournaments, standalone
clubs, row level security, grants, foreign keys.

The last stdout line is the verdict: {"status":"passed","cases":N}.
"""
import argparse, hashlib, json, os, re, shutil, socket, subprocess, sys, tempfile, time
from pathlib import Path
P=argparse.ArgumentParser()
P.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')))
P.add_argument('--scratch',type=Path,default=Path(os.environ.get('RUNNER_TEMP',tempfile.gettempdir())))
P.add_argument('--output',type=Path,default=None,help='write the tick-by-tick record here')
P.add_argument('--keep',action='store_true',help='author aid: leave the cluster running and print its port')
P.add_argument('--store',type=Path,default=None,help='author aid: read production-functions.json / production-relations.json from this directory (an unpruned readout)')
P.add_argument('--usage-out',type=Path,default=None,help='author aid: write the functions and relations the run touched')
P.add_argument('--write-manifest',type=Path,default=None,help='author aid: write the manifest of what was loaded and stop')
P.add_argument('--stop-after',default=None,help='author aid: boot|install|seed|prep')
P.add_argument('--verbose',action='store_true')
A=P.parse_args()
R=Path(__file__).resolve().parents[2]; F=R/'scripts/ci/fixtures/rakeback-cascade-real-runner'; G=R/'scripts/ci/fixtures/rakeback-cascade-real-guards'
sys.path.insert(0,str(G)); import world  # lane C's catalog-to-DDL builder, reused unchanged
MIG_A=next((R/'supabase/migrations').glob('20261109231325_*.sql')); MIG_B=next((R/'supabase/migrations').glob('20261109231855_*.sql')); MIG_P=next((R/'supabase/migrations').glob('20261110053814_*.sql'))
MIG_G=next((R/'supabase/migrations').glob('20261111132447_*.sql')); MIG_J=next((R/'supabase/migrations').glob('20261111174403_*.sql'))
S=A.store or F
FUNCS=json.loads((S/'production-functions.json').read_text()); REL=json.loads((S/'production-relations.json').read_text()); CFG=json.loads((F/'production-config.json').read_text())
CRON={j['jobname']:j['command'] for j in CFG['cron']}
E={k:v for k,v in os.environ.items() if not k.startswith('PG')};E.update(LC_ALL='C',LANG='C',PGTZ='UTC')
A.scratch.mkdir(parents=True,exist_ok=True)
W=Path(tempfile.mkdtemp(prefix='cascade-runner-',dir=A.scratch));DATA=W/'data';started=False;results=[];record=[]
with socket.socket() as sk: sk.bind(('127.0.0.1',0)); port=str(sk.getsockname()[1])
DB='postgres'
def cmd(a): return subprocess.run(list(map(str,a)),env=E,text=True,capture_output=True,check=True,timeout=180)
def q(sql,check=True,stop=True,timeout=1800):
    with tempfile.TemporaryFile(mode='w+',dir=W) as f:
        f.write(sql); f.seek(0)
        r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP='+('1' if stop else '0'),'-U','postgres','-h','127.0.0.1','-p',port,'-d',DB],env=E,text=True,stdin=f,capture_output=True,timeout=timeout)
    if check and r.returncode: raise RuntimeError('\n'.join(l for l in r.stderr.split('\n') if not l.startswith(('WARNING','NOTICE')))[-9000:])
    return r
def one(sql): return q(sql).stdout.strip().split('\n')[-1]
def cron(job):
    """One pg_cron run: the job's command as ONE simple-query string on a new connection as postgres."""
    r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-U','postgres','-h','127.0.0.1','-p',port,'-d',DB,'-c',CRON[job]],env=E,text=True,capture_output=True,timeout=1800)
    err='\n'.join(l for l in r.stderr.split('\n') if l.startswith(('ERROR','DETAIL','CONTEXT','PL/pgSQL')) or 'ERROR' in l)
    lines=r.stdout[:-1].split('\n') if r.stdout.endswith('\n') else r.stdout.split('\n')  # one line per row; SQL NULL is an empty line
    return r.returncode,lines[-1] if lines else '',err
def clock(ts):
    """Move the database clock: every new connection reads `ts` as now."""
    q(f"DO $$BEGIN EXECUTE format('ALTER DATABASE {DB} SET rf.clock_offset=%L',(extract(epoch FROM ('{ts}'::timestamptz-pg_catalog.rf_real_clock()))::numeric(20,3))::text||' seconds');END$$;")
def ok(cond,msg): return f"SELECT rr.ok(({cond}),$m${msg}$m$);\n"
def case(name,sql=None):
    if sql: q(sql)
    results.append(name); print('PASS',name,flush=True)
PRE="""
SET check_function_bodies=off;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE ROLE authenticator NOLOGIN; CREATE ROLE supabase_admin NOLOGIN; CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE ca_ledger_refusal_recorder NOLOGIN; CREATE ROLE engine_lightning_fold NOLOGIN; CREATE ROLE dashboard_user NOLOGIN; CREATE ROLE supabase_read_only_user NOLOGIN;
CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA smarter_private;
CREATE EXTENSION pgcrypto SCHEMA extensions; CREATE EXTENSION "uuid-ossp" SCHEMA extensions; CREATE EXTENSION dblink SCHEMA extensions; CREATE EXTENSION pg_trgm SCHEMA extensions;
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
ALTER DATABASE postgres SET TimeZone='UTC';
SET search_path TO "$user", public, extensions;
"""
# Triggers: every production trigger on the tables below (FULL), every trigger that can fire on UPDATE on clubs and
# club_members (the run never inserts or deletes there after seeding), and the named single triggers (EXTRA).
FULL=set(world.WIRED_FULL)|{'union_wallet_transactions','agent_commissions','agent_commission_settlements','ca_settlements','accounting_cash_rake_sources',
  'accounting_cash_accrual_batches','accounting_cash_bank_receipts','accounting_own_agent_preparation_versions','accounting_own_agent_source_reviews'}
UPDATE_ONLY=set(world.WIRED_UPDATE)
EXTRA=set(world.WIRED_EXTRA)|{('public.union_clubs','accounting_agreement_history')}
def triggers():
    wired=[];skipped=[]
    for k in sorted(REL):
        x=REL[k]
        for t in x['trg'] or []:
            ev=world.events(t['def'])
            if (x['s']=='public' and (x['t'] in FULL or (x['t'] in UPDATE_ONLY and 'UPDATE' in ev))) or (k,t['n']) in EXTRA:
                sql=t['def']+';'
                if t['e']=='A': sql+=f"\nALTER TABLE {x['s']}.{world.qi(x['t'])} ENABLE ALWAYS TRIGGER {world.qi(t['n'])};"
                elif t['e']!='O': raise SystemExit(('unexpected trigger state',k,t['n'],t['e']))
                wired.append({'table':k,'name':t['n'],'function':t['f'],'function_md5':t['fm'],'sql':sql})
            else: skipped.append({'table':k,'name':t['n'],'function':t['f'],'events':ev})
    return wired,skipped
SIGS="SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||E'\\t'||md5(pg_get_functiondef(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','smarter_private') AND p.prokind IN('f','p');"
def sigs(): return dict(l.split('\t') for l in q(SIGS).stdout.strip().split('\n') if '\t' in l)
def changed():
    got=sigs(); return sorted(k.split('(')[0] for k in FUNCS if got.get(k)!=FUNCS[k]['md5'])
def load_world():
    seqs,tabs,defaults,cons,idx,views,dropped_fk=world.tables_sql(REL)
    q(PRE+(F/'clock.sql').read_text()+(G/'platform.sql').read_text()+'\n'.join(seqs)+'\n'+'\n'.join(tabs))
    r=q('SET check_function_bodies=off;\n'+'\n'.join(v['def'].rstrip()+';' for k,v in sorted(FUNCS.items())),stop=False)
    got=sigs(); missing=sorted(k for k in FUNCS if k not in got); wrong=sorted(k for k in FUNCS if k in got and got[k]!=FUNCS[k]['md5'])
    assert not wrong,('production definitions did not load byte-exact',wrong)
    r2=q('\n'.join(defaults+cons+idx),stop=False); r3=q('\n'.join(v for _,v in views),stop=False)
    wired,skipped=triggers()
    byname={k.split('(')[0]:v['md5'] for k,v in FUNCS.items()}
    bad=[(t['table'],t['name'],t['function']) for t in wired if byname.get(t['function'])!=t['function_md5']]
    assert not bad,('a wired trigger names a function whose loaded definition is not the one production reported',bad)
    r4=q('\n'.join(t['sql'] for t in wired),stop=False)
    return dict(missing=missing,func_err=r.stderr,ddl_err=r2.stderr,view_err=r3.stderr,trg_err=r4.stderr,wired=wired,skipped=skipped,dropped_fk=dropped_fk)
def manifest(L):
    return {'source':'production kuklfnapbkmacvwxktbh (SELECT only): definitions read 2026-11-09','functions':{k:v['md5'] for k,v in sorted(FUNCS.items())},
      'wired_triggers':[[t['table'],t['name'],t['function'],t['function_md5']] for t in L['wired']],
      'triggers_not_wired':[[t['table'],t['name'],t['events']] for t in L['skipped']],
      'relations':sorted(REL),'foreign_keys_dropped':len(L['dropped_fk']),
      'stand_ins':{},
      'fixture_files_md5':{n:hashlib.md5(((S if n.startswith('production-f') or n.startswith('production-r') else F)/n).read_bytes()).hexdigest() for n in('production-functions.json','production-relations.json','production-config.json','clock.sql')}}
def cfg_rows(table,rows): return f"INSERT INTO {table} SELECT * FROM jsonb_populate_recordset(NULL::{table},$cfg${json.dumps(rows)}$cfg$::jsonb);\n"
def load_config():
    q(cfg_rows('public.ca_chip_store_coverage',CFG['coverage'])+cfg_rows('public.ca_ledger_invariant_store_mode',CFG['store_mode'])+cfg_rows('public.ca_ledger_invariant_mode',CFG['mode'])
      +cfg_rows('smarter_private.weekly_payout_phase_configuration',CFG['phase_cfg'])+cfg_rows('smarter_private.weekly_payout_rounds_config',CFG['rounds_cfg'])
      +cfg_rows('smarter_private.daily_window_policy',CFG['window_policy'])+cfg_rows('public.accounting_cash_accrual_cutover',[CFG['cutover']])+cfg_rows('public.union_pnl_inventory_capture',[CFG['pnl_capture']])
      +''.join(f"ALTER ROLE {x['role']} SET {c.split('=',1)[0]}='{c.split('=',1)[1]}';\n" for x in CFG['role_settings'] if x['role']=='postgres' for c in x['cfg'] if c.startswith('statement_timeout')))
def usage():
    r=q("SELECT 'F'||E'\\t'||schemaname||'.'||funcname FROM pg_stat_user_functions WHERE calls>0 UNION ALL SELECT 'R'||E'\\t'||schemaname||'.'||relname FROM pg_stat_user_tables WHERE COALESCE(seq_scan,0)+COALESCE(idx_scan,0)+n_tup_ins+n_tup_upd+n_tup_del>0;").stdout
    u={'functions':set(),'relations':set()}
    for l in r.strip().split('\n'):
        if '\t' in l: k,v=l.split('\t'); u['functions' if k=='F' else 'relations'].add(v)
    return {k:sorted(v) for k,v in u.items()}
def tick(job,at,note=''):
    clock(at); t0=time.monotonic(); rc,out,err=cron(job); ms=round((time.monotonic()-t0)*1000,1)
    rec={'at':at,'job':job,'rc':rc,'ms':ms,'out':out[:20000],'err':err[:3000]}; record.append(rec)
    if A.verbose: print('TICK',at,job,rc,out[:300],err[:600],flush=True)
    return rec
try:
    assert '17.' in cmd([A.pg_bin/'postgres','--version']).stdout,'PostgreSQL 17 required'
    cmd([A.pg_bin/'initdb','-D',DATA,'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
    cmd([A.pg_bin/'pg_ctl','-D',DATA,'-l',W/'server.log','-w','start','-o',f"-k '' -p {port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c track_functions=all -c max_locks_per_transaction=512 -c allow_system_table_mods=on"]);started=True
    L=load_world()
    if A.stop_after=='boot':
        print('MISSING FUNCS',len(L['missing']),L['missing'][:80])
        for k in('func_err','ddl_err','view_err','trg_err'):
            errs=[l for l in L[k].split('\n') if 'ERROR' in l]; print(k,len(errs)); print('\n'.join(sorted(set(e[:300] for e in errs))[:60]))
        raise SystemExit(0)
    for k in('func_err','ddl_err','view_err','trg_err'): assert 'ERROR' not in L[k],(k,[l for l in L[k].split('\n') if 'ERROR' in l][:20])
    assert not L['missing'],L['missing']
    M=manifest(L)
    if A.write_manifest: A.write_manifest.write_text(json.dumps(M,indent=0,sort_keys=True)); raise SystemExit(0)
    if not A.store: assert json.loads((F/'manifest.json').read_text())==json.loads(json.dumps(M)),'the loaded world is not the one manifest.json records (rerun with --write-manifest after a deliberate fixture change)'
    load_config(); q('SET check_function_bodies=off;\n'+(F/'scenario.sql').read_text())
    assert changed()==[],('every production function must be byte-exact before the migrations',changed())
    case(f"production definitions load byte-exact ({len(FUNCS)} functions, {len(L['wired'])} triggers wired) and no stand-in replaces any of them")
    # Both migrations, whole, from disk, as they are at run time.
    q('SET check_function_bodies=off;\n'+MIG_A.read_text()); after_a=changed()
    q('SET check_function_bodies=off;\n'+MIG_B.read_text()); after_b=changed()
    # What the two migrations may replace (lane C's list); everything else, the runner and rounds 1 and 2 included, stays production's.
    MAY_REPLACE={'public.fn_enforce_agent_commission_bounds','public.fn_ca_agent_payables','public.get_club_agents','public.fn_club_opening_checklist_complete',
      'public.fn_settle_accounting_rakeback_stage','smarter_private.rakeback_wallet_payout_complete','smarter_private.split_rakeback_payout_complete','smarter_private.weekly_payout_fund_agent_shortfalls'}
    assert set(after_a)<=MAY_REPLACE and set(after_b)<=MAY_REPLACE,('a migration replaced a production function outside the cascade change',sorted(set(after_a+after_b)-MAY_REPLACE))
    assert 'smarter_private.weekly_payout_fund_agent_shortfalls' in after_b,'the cascade migration did not replace the funding function'
    # What production runs today (read 2026-11-11, after both cascade files installed there at 10:40Z): the cascade's
    # postimages are byte-equal to what this fixture holds after the two files.
    INSTALLED={'smarter_private.weekly_payout_fund_agent_shortfalls(p_run uuid, p_kind text, p_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)':'dddb67b5024a01bb4f2dadc0ba1009f2',
      'public.fn_settle_accounting_rakeback_stage(p_scope_kind text, p_scope_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone)':'db6ba33eed8762b2534d349024e4219f',
      'smarter_private.rakeback_wallet_payout_complete(p_payout uuid, p_calculation bigint)':'c2b4cfdbc811adfae751d47fd5b298e6',
      'smarter_private.split_rakeback_payout_complete(p_payout uuid, p_calculation bigint)':'47519877eefe45ac6ab39f6519bfb0e8',
      'public.fn_settle_accounting_commission_stage(p_scope_kind text, p_scope_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone)':'ce1a9dd4344c7987918dcf8a82427ef5',
      'smarter_private.weekly_payout_finalize(p_run uuid)':'5b83618b59f043376c87361c986adca8',
      'smarter_private.zero_standalone_foreign_commissions_proven(p_club uuid, p_start timestamp with time zone, p_end timestamp with time zone)':'69099f3bac93cb29fad83cb82cb1fe4a',
      'smarter_private.weekly_payout_next_round()':'332b762a004a779e32dc3fd2d1aef60d'}
    got=sigs(); assert all(got.get(k)==v for k,v in INSTALLED.items()),('after the two cascade files the fixture must equal what production runs today',{k:got.get(k) for k in INSTALLED})
    # ONE TRANSFER PER EDGE AND THE RESERVE (20261111132447), whole from disk, on exactly those definitions.
    mig_g=MIG_G.read_text()
    q('SET check_function_bodies=off;\n'+mig_g); after_g=changed()
    G_MAY={'public.fn_settle_accounting_commission_stage','public.fn_settle_accounting_rakeback_stage','smarter_private.weekly_payout_fund_agent_shortfalls',
      'smarter_private.weekly_payout_finalize','smarter_private.zero_standalone_foreign_commissions_proven'}
    assert set(after_g)-set(after_b)<=G_MAY and G_MAY<=set(after_g),('the gross-transfer file replaced a production function outside its change',sorted(set(after_g)-set(after_b)-G_MAY))
    proofs=[l.split(': ',1)[1] for l in mig_g.splitlines() if l.startswith('-- @live-proof: ')]
    assert len(proofs)==6 and all(one('SELECT '+p+';')=='t' for p in proofs),'a live proof of 20261111132447 is false after install'
    again_g=q('SET check_function_bodies=off;\n'+mig_g,check=False)
    assert again_g.returncode and 'rakeback_gross_fund_preimage_changed' in again_g.stderr,again_g.stderr[-600:]
    # Every function the file creates or replaces compiles against the real relations (check_function_bodies on).
    NEW_FUNCS=['smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz)','smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)',
      'smarter_private.rakeback_cascade_round2_open()','smarter_private.rakeback_cascade_round2_settle(text,uuid,timestamptz,timestamptz)',
      'smarter_private.weekly_payout_reserve_players_share(text,uuid,timestamptz,timestamptz,text)','smarter_private.agent_wallet_keeps_weekly_reserve()',
      'smarter_private.weekly_payout_fund_agent_shortfalls(uuid,text,uuid,timestamptz,timestamptz)','public.fn_settle_accounting_commission_stage(text,uuid,timestamptz,timestamptz)',
      'public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)','smarter_private.weekly_payout_finalize(uuid)','smarter_private.zero_standalone_foreign_commissions_proven(uuid,timestamptz,timestamptz)']
    q('SET check_function_bodies=on;\n'+''.join(f"SELECT plpgsql_validator('{f}'::regprocedure);\n" for f in NEW_FUNCS))
    acl=one("SELECT bool_and(NOT has_function_privilege(r,p,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r,unnest(ARRAY["+','.join(f"'{f}'" for f in NEW_FUNCS[:6])+"]::regprocedure[]) p")
    assert acl=='t' and one("SELECT NOT has_table_privilege('authenticated','smarter_private.weekly_payout_wallet_reserves','SELECT') AND NOT has_table_privilege('service_role','smarter_private.weekly_payout_wallet_reserves','UPDATE')")=='t'
    # CLUB ISOLATION (20261111174403), whole from disk, on exactly 20261111132447's postimages.
    mig_j=MIG_J.read_text()
    q('SET check_function_bodies=off;\n'+mig_j); after_j=changed()
    # Of production's functions it replaces only the runner beyond what 20261111132447 already replaced (rounds 2 and 3, the
    # funding step and finalize are re-patched in place; the planner overload and the new helpers are not production functions).
    assert set(after_j)==set(after_g)|{'smarter_private.weekly_payout_next_round'},('the club isolation file replaced a production function outside its change',sorted(set(after_j)^set(after_g)))
    assert all(sigs()[k]!=v for k,v in INSTALLED.items() if k.split('(')[0] in('public.fn_settle_accounting_commission_stage','public.fn_settle_accounting_rakeback_stage','smarter_private.weekly_payout_fund_agent_shortfalls','smarter_private.weekly_payout_finalize','smarter_private.weekly_payout_next_round'))
    proofs_j=[l.split(': ',1)[1] for l in mig_j.splitlines() if l.startswith('-- @live-proof: ')]
    assert len(proofs_j)==8 and all(one('SELECT '+p+';')=='t' for p in proofs_j),'a live proof of 20261111174403 is false after install'
    again_j=q('SET check_function_bodies=off;\n'+mig_j,check=False)
    assert again_j.returncode and 'club_isolation_' in again_j.stderr and '_preimage_changed' in again_j.stderr,again_j.stderr[-600:]
    J_FUNCS=['smarter_private.rakeback_cascade_plan(text,uuid,timestamptz,timestamptz,uuid)','smarter_private.weekly_payout_club_refuse(text,uuid,timestamptz,timestamptz,int,uuid,text,text,jsonb)',
      'smarter_private.weekly_payout_club_plan(text,uuid,timestamptz,timestamptz,int)','smarter_private.weekly_payout_round2_clubs(text,uuid,timestamptz,timestamptz,text)',
      'smarter_private.weekly_payout_round2_planned()','smarter_private.weekly_payout_round3_clubs(text,uuid,timestamptz,timestamptz)',
      'smarter_private.weekly_payout_round3_funding_holds(text,uuid,timestamptz,timestamptz)','smarter_private.weekly_payout_fund_club_holds(text,uuid,timestamptz,timestamptz)',
      'smarter_private.weekly_payout_club_round_close(text,uuid,timestamptz,timestamptz,int,text)','smarter_private.weekly_payout_unit_waits(uuid,text,uuid,timestamptz,timestamptz,int)',
      'smarter_private.rakeback_cascade_round2_plan(text,uuid,timestamptz,timestamptz)','smarter_private.weekly_payout_next_round()']
    q('SET check_function_bodies=on;\n'+''.join(f"SELECT plpgsql_validator('{f}'::regprocedure);\n" for f in J_FUNCS+NEW_FUNCS))
    acl_j=one("SELECT bool_and(NOT has_function_privilege(r,p,'EXECUTE')) FROM unnest(ARRAY['anon','authenticated','service_role']) r,unnest(ARRAY["+','.join(f"'{f}'" for f in J_FUNCS[:10]+['smarter_private.weekly_payout_club_isolated(text,uuid,timestamptz,timestamptz,int)'])+"]::regprocedure[]) p")
    assert acl_j=='t' and one("SELECT NOT has_table_privilege('authenticated','smarter_private.weekly_payout_club_rounds','SELECT') AND NOT has_table_privilege('service_role','smarter_private.weekly_payout_club_rounds','UPDATE')")=='t'
    MIGRATED=after_j
    case('20261111174403 (club isolation) installs whole on exactly 20261111132447\'s postimages, replaces only rounds 2 and 3, the funding step, finalize and the runner, compiles against the real relations, its eight live proofs are true, a second install refuses, and no client role may call its functions or read its club rows')
    case('the three migrations install whole from disk on production definitions (after the first two the fixture equals what production runs today, md5 read 2026-11-11); they replace only: '+', '.join(x.split('.')[1] for x in MIGRATED)+'; 20261111132447 compiles against the real relations, its six live proofs are true, a second install refuses, and no client role may call its functions or read its reserves')
    if A.stop_after=='install': raise SystemExit(0)
    exec((F/'cases.py').read_text())
    exec((F/'club-isolation.py').read_text())
    if A.usage_out: A.usage_out.write_text(json.dumps(usage(),indent=0))
    unshifted={k.split('(')[0] for k,v in FUNCS.items() if re.search(r'\b(CURRENT_DATE|CURRENT_TIMESTAMP|CURRENT_TIME|LOCALTIMESTAMP|LOCALTIME)\b',v['def'],re.I)}&set(usage()['functions'])
    assert not unshifted,('a function that reads a clock form the fixture clock does not shift was executed',sorted(unshifted))
    for r in record:
        if r.get('job')=='weekly-payout-rounds' and r['at']>='2026-11-16 10:00':
            try: j=json.loads(r['out']) if r['out'] else None
            except Exception: j={'stage':'?'}
            print('TICK',r['at'],f"{r['ms']:8.1f} ms",'NULL' if j is None else j.get('stage')+(f" round {j['round']}" if 'round' in j else ''),flush=True)
    out={'status':'passed','cases':len(results)}
    if A.output: A.output.write_text(json.dumps({**out,'migrations':{MIG_A.name:hashlib.md5(MIG_A.read_bytes()).hexdigest(),MIG_B.name:hashlib.md5(MIG_B.read_bytes()).hexdigest(),MIG_P.name:hashlib.md5(MIG_P.read_bytes()).hexdigest(),MIG_G.name:hashlib.md5(MIG_G.read_bytes()).hexdigest()},'replaced_by_migrations':MIGRATED,'results':results,'ticks':record},indent=1))
    print(json.dumps(out))
finally:
    if A.usage_out and started and not A.usage_out.exists():
        try: A.usage_out.write_text(json.dumps(usage(),indent=0))
        except Exception: pass
    if A.keep and started: print('KEPT port',port,'dir',W,flush=True)
    else:
        if started: subprocess.run([str(A.pg_bin/'pg_ctl'),'-D',str(DATA),'-m','immediate','-w','stop'],env=E,capture_output=True)
        shutil.rmtree(W,ignore_errors=True)
