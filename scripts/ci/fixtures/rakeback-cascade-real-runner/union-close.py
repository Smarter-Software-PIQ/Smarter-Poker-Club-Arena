# The union's weekly close, EXECUTED (exec'd by the harness after union-books.py). On its own copy of the paid and
# released week (database `close`, CREATE DATABASE ... TEMPLATE postgres, dropped afterwards so club-isolation.py
# continues on the untouched board), job 564 (weekly-union-books) ticks every two minutes with its exact command and
# drives the real close: smarter_private.weekly_union_books_due -> fn_process_weekly_accounting(NULL) ->
# fn_process_weekly_accounting_scope and everything it executes.
#
# REAL (read from production kuklfnapbkmacvwxktbh 2026-11-15 with SELECT only, one object per query, md5 asserted):
#   union-close.json            every function the close executes, its triggers, constraints and views use, and the
#                               functions those bodies name (byte-exact pg_get_functiondef). Where the main fixture holds
#                               an older body of the same function (read 2026-11-09), the close database carries
#                               production's current one (the list is in the first close case).
#   union-close-relations.json  the close's relations (catalog readout, the format of production-relations.json), and
#                               today's readout of the fixture relations whose triggers the close needs (their columns are
#                               asserted equal to the fixture's); every production trigger on them is wired.
#   union-close-config.json     the configuration singleton the close reads (union_pnl_weekly_capture) and production's
#                               EXECUTE grants (pg_proc.proacl) on every function loaded (the hand-parts owner check reads
#                               them; written to the catalog so the aclitem order is production's).
# STAND-INS: Midway's union wallet row (promo 0.00), as union-books.py. Notification triggers stay unwired (sinks).
# THE BOUNDARY (finding C1, production code, not fixed here): see the last case. For a union other than Midway the
#   post-paid P&L qualification can never finish, so this fixture's union never reaches the square-up statements
#   (fn_union_issue_weekly_invoices) or their delivery (fn_deliver_accounting_invoice); the test asserts exactly where it
#   stops, that nothing is paid or issued, and what the report names past the boundary.
UC=json.loads((F/'union-close.json').read_text()); UC_REL=json.loads((F/'union-close-relations.json').read_text())
# The database settings are carried over as postgres has them (search_path as a list, not as one quoted name).
q("CREATE DATABASE close TEMPLATE postgres;\n"+''.join(f"ALTER DATABASE close SET {c.split('=',1)[0]} TO "+(c.split('=',1)[1] if c.startswith('search_path=') else f"$c${c.split('=',1)[1]}$c$")+";\n" for c in _cfg))
DB='close'
# Everything union-books.py installs: its two relations, its three functions, the pre-fix body and the fix.
q('SET check_function_bodies=off;\n'+'\n'.join(_t+_d+_c+_i)+'\n'+''.join(v['def'].rstrip()+';\n' for v in UB['functions'].values()))
q('SET check_function_bodies=off;\n'+mu[_a:_b]+f"\nREVOKE ALL ON FUNCTION {BOOKS_SIG} FROM PUBLIC, anon, authenticated, service_role;\n"); q(MIG_V.read_text())
assert books_md5()=='79347a20359977ac7b203eac9ac25c87'
# The close's relations and functions (union-close-relations.json, union-close.json).
COLS="SELECT jsonb_agg(jsonb_build_array(a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull) ORDER BY a.attnum)::text FROM pg_attribute a WHERE a.attrelid='%s'::regclass AND a.attnum>0 AND NOT a.attisdropped"
_present={k for k in UC_REL if one(f"SELECT to_regclass('{k}') IS NOT NULL")=='t'}
for k in _present:  # created by a migration this harness installed: it must be production's relation
    assert json.loads(one(COLS%k))==[[c['n'],c['ty'],c['nn']] for c in UC_REL[k]['cols']],('a relation a migration created differs from production',k)
_cs,_ct,_cd,_cc,_ci,_cv,_cf=world.tables_sql({k:v for k,v in UC_REL.items() if k not in _present})
r=q('SET check_function_bodies=off;\n'+'\n'.join(_cs+_ct),stop=False); assert 'ERROR' not in r.stderr,r.stderr[-3000:]
_g0=sigs(); UC_NEWER=sorted(k.split('(')[0] for k in UC['functions'] if k in _g0 and _g0[k]!=UC['functions'][k]['md5'])
r=q('SET check_function_bodies=off;\n'+''.join(v['def'].rstrip()+';\n' for v in UC['functions'].values()),stop=False); assert 'ERROR' not in r.stderr,r.stderr[-3000:]
r=q('\n'.join(_cd+_cc+_ci),stop=False); assert 'ERROR' not in r.stderr,r.stderr[-3000:]
r=q('\n'.join(v for _,v in _cv),stop=False); assert 'ERROR' not in r.stderr,r.stderr[-3000:]
_g=sigs(); _bad={k:(_g.get(k),v['md5']) for k,v in UC['functions'].items() if _g.get(k)!=v['md5']}
assert not _bad,('the close definitions did not load byte-exact',_bad)
# Every production trigger on the close's own relations, as production has it (the close checks some of them).
_byname={k.split('(')[0]:v for k,v in _g.items()}
UC_TRG=[]
for k in sorted(UC_REL):
    if k in _present: continue
    for t in UC_REL[k]['trg'] or []:
        assert _byname.get(t['f'])==t['fm'],('a close trigger names a function whose loaded definition is not production\'s',k,t['n'],t['f'])
        sql=t['def']+';'
        if t['e']=='A': sql+=f"\nALTER TABLE {k.split('.')[0]}.{world.qi(UC_REL[k]['t'])} ENABLE ALWAYS TRIGGER {world.qi(t['n'])};"
        elif t['e']=='D': sql+=f"\nALTER TABLE {k.split('.')[0]}.{world.qi(UC_REL[k]['t'])} DISABLE TRIGGER {world.qi(t['n'])};"
        elif t['e']!='O': raise SystemExit(('unexpected trigger state',k,t['n'],t['e']))
        UC_TRG.append(sql)
# And every production trigger, as production has it today, on the fixture relations the close writes or checks, which the
# main harness leaves unwired (the hand-parts witness refuses to run unless the four P&L outcome tables and the escrow
# certificates carry their append-only triggers).
CLOSE_WIRED=['public.union_pnl_cash_outcomes','public.union_pnl_cash_outcome_touches','public.union_pnl_cash_outcome_link_resolutions',
  'public.union_pnl_cash_outcome_resolutions','smarter_private.posthand_escrow_certificates','public.union_accounting_runs',
  'public.accounting_close_partials','public.accounting_close_certificates','public.weekly_accounting_scheduler_visits']
assert set(CLOSE_WIRED)<=_present
for k in CLOSE_WIRED:
    for t in UC_REL[k]['trg'] or []:
        assert _byname.get(t['f'])==t['fm'] and t['e'] in 'OA',('a close trigger names a function whose loaded definition is not production\'s',k,t['n'],t['f'])
        UC_TRG.append(t['def']+';'+(f"\nALTER TABLE {k.split('.')[0]}.{world.qi(UC_REL[k]['t'])} ENABLE ALWAYS TRIGGER {world.qi(t['n'])};" if t['e']=='A' else ''))
r=q('\n'.join(UC_TRG),stop=False); assert 'ERROR' not in r.stderr,r.stderr[-3000:]
UC_CFG=json.loads((F/'union-close-config.json').read_text())
q(''.join(cfg_rows(t,rows) for t,rows in UC_CFG['rows'].items()))
# Production's EXECUTE grants on every function the close can reach, as pg_proc.proacl holds them (the hand-parts owner
# check reads them). Written to the catalog (allow_system_table_mods) so that the aclitem order is production's.
ACL_SQL=("SELECT count(*) FROM (SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig,p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace) p "
  "JOIN jsonb_each(%s::jsonb) x ON x.key=p.sig WHERE p.acl IS NOT DISTINCT FROM (x.value#>>'{}')")
_acl="$acl$"+json.dumps(UC_CFG['function_acl'])+"$acl$"
q("UPDATE pg_catalog.pg_proc p SET proacl=(x.value#>>'{}')::aclitem[] FROM pg_namespace n,jsonb_each("+_acl+"::jsonb) x WHERE n.oid=p.pronamespace AND x.key=n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')';")
assert one(ACL_SQL%_acl)==str(len(UC_CFG['function_acl'])),('production grants not in place',one(ACL_SQL%_acl),len(UC_CFG['function_acl']))
q("INSERT INTO public.union_wallets(union_id) VALUES('fade0000-0000-0000-0000-000000000001');")  # STAND-IN: Midway's union wallet, promo 0.00 (as union-books.py)
CMONEY=("SELECT md5(jsonb_build_array((SELECT jsonb_build_array(count(*),sum(amount),max(chain_seq),count(*) FILTER(WHERE category='rakeback'),sum(amount) FILTER(WHERE category='rakeback')) FROM public.chip_ledger),"
  "(SELECT jsonb_build_array(count(*),sum(payout_amount)) FROM public.rakeback_period_payouts),(SELECT jsonb_agg(jsonb_build_array(id,status) ORDER BY id) FROM public.rakeback_periods),rr.money())::text)")
cmoney0=one(CMONEY)
CLOSE_SIGS=set(UC['functions'])
PARTS="SELECT COALESCE(string_agg(kind||':'||n||':'||c,',' ORDER BY kind),'') FROM (SELECT kind,count(*) n,md5(string_agg(md5(value::text)||computed_at::text,',' ORDER BY window_start)) c FROM public.accounting_close_partials GROUP BY kind) x"
RUN="SELECT status||'|'||attempts||'|'||COALESCE(result->>'stage','')||'|'||COALESCE(result->>'purpose','') FROM public.union_accounting_runs WHERE union_id=rr.u('U') AND period_start=rr.ws() AND period_end=rr.we()"
def detail(r):
    j=json.loads(r['out']); return j,(j.get('tick') or {})
closes=[]
for i in range(30):  # one job 564 tick every two minutes, 12:08Z to 13:06Z
    at=f'2026-11-16 {12+(8+2*i)//60:02d}:{(8+2*i)%60:02d}:20+00'
    r=tick(BOOKS,at); r['parts']=one(PARTS); r['run']=one(RUN) if one("SELECT count(*) FROM public.union_accounting_runs WHERE union_id=rr.u('U')")=='1' else None; closes.append(r)
    if A.verbose: print('CLOSE',at,r['rc'],r['out'][-600:],r['err'][:600],flush=True)
    assert r['rc']==0 and 'ERROR' not in r['err'],('a close tick raised',r)
    assert one(CMONEY)==cmoney0,('the close moved money or paid something again',r)
# 12:08 the promo (as union-books.py); 12:10 to 12:26 the original inventory is sealed one week a tick, from the capture
# boundary to this Monday; then the week's book is visited.
j,t=detail(closes[0]); assert t['weekly_horse_promo']['reason']=='no_eligible_wallets',closes[0]
seals=[detail(r)[1]['inventory_seal'] for r in closes[1:10]]
assert [x['sealed'][0]['boundary'][:10] for x in seals]==['2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16'],seals
assert all(x['sealed'][0]['status']=='sealed' and x['sealed'][0]['issue_count']==0 for x in seals) and seals[-1]['status']=='ready' and all(x['status']=='sealing' for x in seals[:-1])
assert one("SELECT count(*) FROM public.union_pnl_inventory_checkpoints")=='9'
case('union close, executed: after the paid and released week, job 564\'s exact command enters the REAL close (union-close.json: every function it reaches, byte-exact from production 2026-11-15, its relations, triggers and grants); the original P&L inventory is sealed one week per tick from the capture boundary (2026-09-21) to this Monday (9 checkpoints, no issues) and no scope is visited while it seals; '+(f"production's current body replaces the fixture's older one for: {', '.join(x.split('.')[1] for x in UC_NEWER)}" if UC_NEWER else 'no fixture body is replaced'))
visits=closes[10:]
for r in visits:
    j,t=detail(r); d=t['detail']
    assert t['checked']==1 and t['failed']==0 and len(d)==1 and d[0]['union_id']==one("SELECT rr.u('U')::text"),r
    res=d[0]['result']; assert res['stage']=='certifying' and res['purpose']=='club_settlements' and res['chunk_committed'] is True and res['committed_round']==0,r
    assert res['pnl_evidence']=={'issues':['union_pnl_certification_in_progress'],'reason':'union_pnl_basis_uncertified','status':'blocked'},r
# The book is the already-paid week (preparation answers paid_scope_replay), so the visit is the post-paid qualification:
# the earned plan is reused, the week's original flows are proved two hours a window (84 windows), then its hand parts.
assert 'pnl_flows_window:84:' in visits[-1]['parts'] and 'pnl_hands_window:84:' in visits[-1]['parts'],visits[-1]['parts']
grown=[i for i in range(1,len(visits)) if visits[i]['parts']!=visits[i-1]['parts']]
last=max(grown) if grown else 0
assert last<=3 and len(visits)-last>=15,('the certification kept moving, or stopped too early to tell',[v['parts'] for v in visits])
assert all(v['run'].startswith('running|') and v['run'].endswith('|certifying|club_settlements') for v in visits)
assert [int(v['run'].split('|')[1]) for v in visits]==list(range(int(visits[0]['run'].split('|')[1]),int(visits[0]['run'].split('|')[1])+len(visits)))
# THE BOUNDARY (finding C1, production code, not fixed here): from the visit that proved the hand windows on, every tick
# returns the same 'certifying' step and proves nothing new. fn_accounting_union_earned_plan_advance sets the original
# inventory generation only for Midway (fade0000-...-0001) and, for any other union, reaches the hand-parts branch with
# a NULL generation; smarter_private.weekly_hand_parts_read returns NULL for a NULL generation, so the advance answers
# false (more to prove) on every attempt and the evidence report stays 'warming'. Reproduced directly below.
REPRO=("BEGIN;SELECT set_config('statement_timeout','900s',false),set_config('app.weekly_accounting_attempt_budget','1',false),"
  "set_config('app.weekly_accounting_scope_budget','8 minutes',false),set_config('app.weekly_accounting_chunked','on',false);"
  "SELECT public.fn_weekly_accounting_attempt_begin(true);"
  "SELECT (SELECT count(*) FROM public.accounting_close_partials WHERE kind='pnl_hands_window' AND union_id=rr.u('U') AND period_start=rr.ws() AND period_end=rr.we())"
  "||'|'||(smarter_private.weekly_hand_parts_read(rr.u('U'),rr.ws(),rr.we(),NULL,public.fn_union_pnl_projection_ready('cash_outcome_touches')) IS NULL)"
  "||'|'||public.fn_accounting_union_earned_plan_advance(rr.u('U'),rr.ws(),rr.we())||'|'||public.fn_accounting_union_earned_plan_advance(rr.u('U'),rr.ws(),rr.we())"
  "||'|'||(public.fn_union_pnl_close_quality(rr.u('U'),rr.ws(),rr.we())->>'issues');ROLLBACK;")
parts_before=one(PARTS)
assert one(REPRO)=='84|true|false|false|["union_pnl_certification_in_progress"]' and one(PARTS)==parts_before
# What the close would meet next, past the boundary: the same report read unchunked names the basis this fixture does not
# carry (the union's ECO terms and the engine's original P&L hand capture).
NEXT=json.loads(one("SELECT public.fn_union_pnl_close_quality(rr.u('U'),rr.ws(),rr.we())::text"))
assert NEXT=={'issues':[{'reason':'eco_commercial_basis_incomplete','evidence':{'issues':['eco_terms_opening_coverage_missing'],'status':'blocked'}},
  'eco_intraweek_changed_terms_require_original_allocation','accepted_cash_rake_does_not_match_original_earning_and_bank_basis'],'reason':'union_pnl_basis_uncertified','status':'blocked'},NEXT
assert one("SELECT count(*) FROM public.settlement_invoices WHERE invoice_type='union_weekly_squareup'")=='0' and one("SELECT count(*) FROM public.accounting_invoice_deliveries")=='0'
assert one("SELECT count(*) FROM public.chip_ledger WHERE category='rakeback'")==RAKEBACK_ROWS
_used={k for k in usage()['functions']}
_unshifted={k.split('(')[0] for k,v in UC['functions'].items() if re.search(r'\b(CURRENT_DATE|CURRENT_TIMESTAMP|CURRENT_TIME|LOCALTIMESTAMP|LOCALTIME)\b',v['def'],re.I)}&_used
assert not _unshifted,('a close function that reads a clock form the fixture clock does not shift was executed',sorted(_unshifted))
case(f"union close, executed, the boundary (finding C1): the paid week's visit is the post-paid P&L qualification; it proves the week's original flows (84 windows) and hand parts (84 windows), then every later tick to 13:06Z ({len(visits)-last-1} ticks) returns the same certifying step, proves nothing new and pays nothing: for a union other than Midway the earned-plan advance carries a NULL inventory generation and weekly_hand_parts_read answers NULL for it, so the advance is false on every attempt (reproduced in one attempt). No square-up statement is issued, no delivery is recorded, the chip ledger keeps its {RAKEBACK_ROWS} rakeback rows. Past the boundary the report names ECO terms and original hand capture this fixture does not carry")
record.append({'union_close':[{k:r.get(k) for k in ('at','rc','out','err','parts','run')} for r in closes]})
exec((F/'weekly-invoices-promo.py').read_text())
exec((F/'weekly-kings-welcome.py').read_text())
exec((F/'weekly-agent-statements.py').read_text())
DB='postgres'
if not A.keep: q("DROP DATABASE close;")  # author aid: --keep leaves it for inspection
