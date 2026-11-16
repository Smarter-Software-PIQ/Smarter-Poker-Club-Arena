# The payout-day union books tick (cron job 564, weekly-union-books), exec'd by the harness after cases.py: the week of
# 2026-11-09 is paid by the real runner and RELEASED, and the ticks below run on a copy of that board (database `books`,
# CREATE DATABASE ... TEMPLATE, the per-database settings and the fixture clock carried over) that is dropped afterwards,
# so club-isolation.py continues on the untouched board.
#
# REAL (union-books.json, read from production 2026-11-15 with SELECT only, byte-exact, md5 asserted after loading):
#   cron job 564's command exactly as cron.job has it; fn_union_settlement_cascade_due (job 272's entry, which the
#   pre-fix tick called); fn_midway_weekly_horse_promo_due and fn_midway_weekly_horse_promo (the first post-money step).
#   The pre-fix weekly_union_books_due is the CREATE FUNCTION of 20261114163249, read from that file at run time (its
#   md5 is the preimage 20261115181339 pins); the fix is 20261115181339 installed whole from disk. Everything else on
#   the path (weekly_payout_due, weekly_payout_prepare_due, weekly_payout_scope_plan and eligible_scopes,
#   fn_accounting_close_windows_advance_due, fn_process_weekly_accounting and _scope) is the fixture's production body,
#   whose md5 equals production's today (re-read 2026-11-15).
#   Two relations the promo writes (union-books-relations.json, production catalog, built by lane C's world builder).
# STAND-INS (each marked below): Midway's union wallet row (promo 0.00; the promo function is hard-wired to Midway's id);
#   one bare unions row (a second union whose week is still owed); one complete union_accounting_runs row for union U
#   (the close's outcome, which this fixture cannot compute).
# NOT COVERED: the union's close itself. fn_process_weekly_accounting_scope reaches about 357 production functions
#   (1.5 MB of source: the settlement cascade rounds 1-4, P&L certification and inventory seal, tournament proofs, ECO,
#   square-up invoices and their delivery) that this fixture does not carry; the tick that reaches it stops at the first
#   of them (fn_accounting_close_seal_held), past every statement-budget and scheduler check in front of the close.
UB=json.loads((F/'union-books.json').read_text()); UB_REL=json.loads((F/'union-books-relations.json').read_text())
MIG_U=next((R/'supabase/migrations').glob('20261114163249_*.sql')); MIG_V=next((R/'supabase/migrations').glob('20261115181339_*.sql'))
BOOKS='weekly-union-books'; CRON[BOOKS]=UB['cron'][BOOKS]['command']
assert UB['cron'][BOOKS]['jobid']==564 and "set_config('statement_timeout','900s',false)" in CRON[BOOKS]
BOOKS_SIG="smarter_private.weekly_union_books_due()"
def books_md5(): return one(f"SELECT md5(pg_get_functiondef('{BOOKS_SIG}'::regprocedure))")
# ---------------------------------------------------------------- a copy of the paid board
_cfg=[l for l in q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setrole=0 AND setdatabase=(SELECT oid FROM pg_database WHERE datname='postgres');").stdout.split('\n') if '=' in l]
q("CREATE DATABASE books TEMPLATE postgres;\n"+''.join(f"ALTER DATABASE books SET {c.split('=',1)[0]}=$c${c.split('=',1)[1]}$c$;\n" for c in _cfg))
DB='books'
_s,_t,_d,_c,_i,_v,_f=world.tables_sql(UB_REL)
q('SET check_function_bodies=off;\n'+'\n'.join(_t+_d+_c+_i)+'\n'+''.join(v['def'].rstrip()+';\n' for v in UB['functions'].values())
  +''.join(ok(f"md5(pg_get_functiondef('{k.split('(')[0]}'::regproc))='{v['md5']}'",f"{k.split('(')[0]} loaded byte-exact") for k,v in UB['functions'].items()))
PATH_MD5={'smarter_private.weekly_payout_due()':'b33273e0047cfaa12aac8ba2979b6aaa','smarter_private.weekly_payout_prepare_due()':'b74ade398c53fc375940a941997d5ae6',
  'smarter_private.weekly_payout_scope_plan(p_end timestamp with time zone, p_now timestamp with time zone)':'ec30840469438a995d15dbbbefafefb0',
  'smarter_private.weekly_payout_eligible_scopes(p_end timestamp with time zone, p_now timestamp with time zone)':'f1a135b2555d4dfee67836d0b43af390',
  'public.fn_accounting_close_windows_advance_due()':'701d0c2c2bed0549ad3789e4a8923aa6','public.fn_process_weekly_accounting(p_union_id uuid)':'5aec6700bf043463e9db2933ca63bca1',
  'public.fn_process_weekly_accounting_scope(p_union_id uuid, p_club_id uuid)':'4179282ab83f30094d4c3b2885102917'}
_g=sigs(); assert all(_g.get(k)==v for k,v in PATH_MD5.items()),('the path the tick takes is not what production runs today (md5 re-read 2026-11-15)',{k:_g.get(k) for k in PATH_MD5})
assert one(f"SELECT to_regprocedure('{BOOKS_SIG}') IS NULL")=='t'
# The board's state the tick must never change (money) and everything it could write.
MONEY=("SELECT md5(jsonb_build_array((SELECT jsonb_build_array(count(*),sum(amount),max(chain_seq),count(*) FILTER(WHERE category='rakeback'),sum(amount) FILTER(WHERE category='rakeback')) FROM public.chip_ledger),"
  "(SELECT jsonb_build_array(count(*),sum(payout_amount)) FROM public.rakeback_period_payouts),(SELECT jsonb_build_array(count(*),sum(net_amount)) FROM public.settlement_invoices),"
  "(SELECT jsonb_agg(jsonb_build_array(id,status) ORDER BY id) FROM public.rakeback_periods),rr.money())::text)")
ALL="SELECT rr.digest()||'|'||(SELECT count(*) FROM public.union_weekly_horse_promo_runs)||'|'||(SELECT count(*)||':'||COALESCE(md5(string_agg(md5(r::text),',' ORDER BY r::text)),'') FROM public.union_accounting_runs r)||'|'||(SELECT count(*) FROM public.accounting_close_partials)"
money0=one(MONEY)  # rakeback rows: round 1's three union -> club legs and round 3's eight player legs
RAKEBACK_ROWS=one("SELECT count(*) FROM public.chip_ledger WHERE category='rakeback'")
assert RAKEBACK_ROWS=='11' and one("SELECT phase FROM public.weekly_accounting_payout_pauses WHERE instance_id='weekly-payout-rounds'")=='released' and one("SELECT jsonb_array_length(smarter_private.weekly_payout_scope_plan(rr.we(),'2026-11-16 12:00:00+00'))")=='0'
def books(at):
    before=one(ALL); r=tick(BOOKS,at); r['stage']=stage(r) if r['rc']==0 else None; r['changed']=one(ALL)!=before
    assert one(MONEY)==money0,('the books tick moved money or paid something again',r)
    return r
# ---------------------------------------------------------------- (a) the body production ran until 20261115181339
mu=MIG_U.read_text(); _a=mu.index(f'CREATE OR REPLACE FUNCTION {BOOKS_SIG}'); _b=mu.index('$function$;',_a)+len('$function$;')
q('SET check_function_bodies=off;\n'+mu[_a:_b]+f"\nREVOKE ALL ON FUNCTION {BOOKS_SIG} FROM PUBLIC, anon, authenticated, service_role;\n")
assert books_md5()=='fd1fe5b44d1359d08ec9b4a17fba7add',books_md5()
old=[books('2026-11-16 12:00:20+00'),books('2026-11-16 12:02:20+00')]
for r in old:
    assert r['rc']!=0 and 'ERROR:  weekly_payout_original_bounded_tick_required' in r['err'] and not r['changed'],r
    assert [l.split(' line ')[0].split('function ')[-1] for l in r['err'].split('\n') if l.lstrip().startswith(('CONTEXT','PL/pgSQL'))]==['smarter_private.weekly_payout_prepare_due()','smarter_private.weekly_payout_due()','fn_union_settlement_cascade_due()','smarter_private.weekly_union_books_due()'],r['err']
case("union books tick, before the fix: with 20261114163249's weekly_union_books_due (md5 fd1fe5b4, the preimage 20261115181339 pins) and job 564's exact command, every tick after the week is paid and released raises weekly_payout_original_bounded_tick_required (books_due -> fn_union_settlement_cascade_due -> weekly_payout_due -> weekly_payout_prepare_due) and writes nothing")
# ---------------------------------------------------------------- (b) 20261115181339 whole, from disk
acl_before=one(f"SELECT proowner::regrole::text||' '||COALESCE(proacl::text,'default') FROM pg_proc WHERE oid='{BOOKS_SIG}'::regprocedure")
q(MIG_V.read_text())
assert books_md5()=='79347a20359977ac7b203eac9ac25c87',books_md5()  # what production runs (read 2026-11-15)
assert one(f"SELECT proowner::regrole::text||' '||COALESCE(proacl::text,'default') FROM pg_proc WHERE oid='{BOOKS_SIG}'::regprocedure")==acl_before
assert one("SELECT "+re.search(r'^-- @live-proof: (.*)$',MIG_V.read_text(),re.M).group(1))=='t'
again_v=q(MIG_V.read_text(),check=False)
assert again_v.returncode and 'WEEKLY_UNION_BOOKS_PREIMAGE_CHANGED' in again_v.stderr and books_md5()=='79347a20359977ac7b203eac9ac25c87',again_v.stderr[-600:]
q(f"SET check_function_bodies=on;SELECT plpgsql_validator('{BOOKS_SIG}'::regprocedure);")
assert sigs()=={**_g,BOOKS_SIG:'79347a20359977ac7b203eac9ac25c87'},'20261115181339 replaced something besides weekly_union_books_due'
case('20261115181339 installs whole on the pre-fix body: postimage md5 79347a20 (what production runs), owner and ACL unchanged, nothing else replaced, its live proof true, a second install refuses (WEEKLY_UNION_BOOKS_PREIMAGE_CHANGED)')
# (c) while a scope is still owed. STAND-IN: a second union with no payout and no close for the week, so the week's scope plan owes it.
q("INSERT INTO public.unions(id,name,owner_id,slug) VALUES(rr.u('X'),'Union X',rr.u('X.boss'),'union-x');")
owed=json.loads(one("SELECT smarter_private.weekly_payout_scope_plan(rr.we(),'2026-11-16 12:04:00+00')::text"))
assert [(o['kind'],o['id']) for o in owed]==[('union',one("SELECT rr.u('X')"))],owed
r=books('2026-11-16 12:04:20+00'); j=json.loads(r['out'])
assert r['rc']==0 and r['stage']=='weekly_union_books_waiting_for_owed_scopes' and not r['changed'] and j['owed']==owed and j['open_unions']==[one("SELECT rr.u('U')")],r
q("DELETE FROM public.unions WHERE id=rr.u('X');")
case('union books tick, fixed, while the week still owes a scope (a second union with no payout): returns weekly_union_books_waiting_for_owed_scopes naming the owed scope and the open union, and writes nothing')
# The scheduler lock: held by another session (job 272 or the runner), the tick takes nothing and writes nothing.
q("INSERT INTO public.union_wallets(union_id) VALUES('fade0000-0000-0000-0000-000000000001');")  # STAND-IN: Midway's union wallet, promo 0.00
holder=subprocess.Popen([str(A.pg_bin/'psql'),'-X','-qAt','-U','postgres','-h','127.0.0.1','-p',port,'-d','books'],env=E,text=True,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
holder.stdin.write("BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('union-accounting-scheduler',0));\n"); holder.stdin.flush()
for _ in range(200):
    if one("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted AND pid<>pg_backend_pid()")=='1': break
    time.sleep(0.05)
else: raise AssertionError('the holder session did not take the scheduler lock')
r=books('2026-11-16 12:06:20+00'); holder.stdin.write("COMMIT;\n"); holder.stdin.close(); holder.wait(timeout=60)
assert r['rc']==0 and json.loads(r['out'])=={'stage':'weekly_union_books_scheduler_busy','open_unions':[one("SELECT rr.u('U')")]} and not r['changed'],r
case('union books tick, fixed, while another session holds the union accounting scheduler lock: returns weekly_union_books_scheduler_busy and writes nothing')
# The post-money steps, one job 564 tick every two minutes.
t1=books('2026-11-16 12:08:20+00'); j1=json.loads(t1['out'])
assert t1['rc']==0 and t1['stage']=='weekly_union_books' and j1['open_unions']==[one("SELECT rr.u('U')")] and j1['tick']['advanced'] is True and j1['tick']['owns_tick'] is True,t1
assert j1['tick']['weekly_horse_promo']['reason']=='no_eligible_wallets' and one("SELECT count(*) FROM public.union_weekly_horse_promo_runs WHERE period_end=rr.we() AND paid=0")=='1'
assert one("SELECT count(*) FROM public.notifications WHERE type='weekly_horse_promo_report'")=='1'
case('union books tick, fixed, first tick after the release with job 564\'s exact command: does not raise, returns stage weekly_union_books and runs the first post-money step (the real Midway weekly horse promo, recorded once with its receipt), and pays nothing (chip_ledger, payouts, receipts, periods unchanged)')
later=[books(f'2026-11-16 12:{m:02d}:20+00') for m in (10,12,14)]
for r in later:
    assert 'weekly_payout_original_bounded_tick_required' not in r['err'] and not r['changed'],r
    # The fixture boundary: the close's body needs functions this fixture does not carry (see the header).
    assert r['rc']!=0 and 'function public.fn_accounting_close_seal_held(timestamp with time zone) does not exist' in r['err'] and 'fn_process_weekly_accounting_scope(uuid,uuid) line 66' in r['err'] and 'weekly_union_books_due() line 58' in r['err'],r
assert one("SELECT count(*) FROM public.union_weekly_horse_promo_runs")=='1' and one("SELECT count(*) FROM public.notifications WHERE type='weekly_horse_promo_report'")=='1'
case('union books tick, fixed, next ticks: the promo is not run again; the window advance finds nothing; the tick enters the close itself (fn_process_weekly_accounting(NULL) -> fn_process_weekly_accounting_scope, past its engine, scope, scheduler-lock, freeze and budget checks, under the 900 s statement) and never raises the bounded-tick pin; in this fixture it stops at the close\'s first uncarried function and rolls back, writing and paying nothing')
# STAND-IN: the union's close for the week is complete (the close's own outcome).
q("INSERT INTO public.union_accounting_runs(union_id,period_start,period_end,scheduled_at,status,attempts,started_at,finished_at,result) VALUES(rr.u('U'),rr.ws(),rr.we(),'2026-11-16 10:00:00+00','complete',1,'2026-11-16 12:15:00+00','2026-11-16 12:15:30+00',jsonb_build_object('success',true,'accounting_version','3'));")
done=[books(f'2026-11-16 {h:02d}:{m:02d}:20+00') for h,m in ((12,16),(12,18),(21,58))]
assert all(r['rc']==0 and r['out']=='' and not r['changed'] for r in done),done
assert books('2026-11-16 22:00:20+00')['out']=='' and one("SELECT count(*) FROM public.chip_ledger WHERE category='rakeback'")==RAKEBACK_ROWS
case(f'union books tick, fixed, once the union\'s close for the week is complete: every tick (to the end of the twelve-hour window and after it) returns NULL and writes nothing; across all {len(old)+len(later)+len(done)+5} ticks the chip ledger keeps its {RAKEBACK_ROWS} rakeback rows and no payout, receipt or period changes')
record.append({'union_books':[{k:r[k] for k in ('at','rc','stage','out','err')} for r in old+[t1]+later+done]})
exec((F/'union-member-week.py').read_text())
DB='postgres'; q("DROP DATABASE books;")
