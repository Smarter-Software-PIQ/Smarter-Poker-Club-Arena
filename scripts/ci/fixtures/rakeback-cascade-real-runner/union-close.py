# The union's weekly close, EXECUTED end to end (exec'd by the harness after union-books.py). On its own copy of the paid
# and released week (database `close`, CREATE DATABASE ... TEMPLATE postgres, dropped afterwards so club-isolation.py
# continues on the untouched board), job 564 (weekly-union-books) ticks every two minutes with its exact command and
# drives the real close: smarter_private.weekly_union_books_due -> fn_process_weekly_accounting(NULL) ->
# fn_process_weekly_accounting_scope and everything it executes, until the books are complete.
#
# REAL (read from production kuklfnapbkmacvwxktbh 2026-11-15 and 2026-11-16 with SELECT only, md5 asserted):
#   union-close.json            every function the close executes, its triggers, constraints and views use, and the
#                               functions those bodies name (byte-exact pg_get_functiondef), now through the post-paid
#                               settlement: ECO terms and record, square-up statements, their numbering and delivery, the
#                               club weekly statement. Where the main fixture holds an older body of the same function
#                               (read 2026-11-09), the close database carries production's current one.
#   union-close-relations.json  the close's relations (catalog readout, the format of production-relations.json), and
#                               today's readout of the fixture relations whose triggers the close needs.
#   union-close-config.json     the configuration singleton the close reads (union_pnl_weekly_capture), production's
#                               EXECUTE grants (pg_proc.proacl) on every function loaded, and the two ECO capture triggers
#                               on public.unions.
# THE FIX (finding C1): 20261116033831, installed whole from disk on production's bodies. Before it, for a union other
#   than Midway the earned-plan advance carried a NULL original inventory generation, weekly_hand_parts_read answered NULL
#   for it, and every attempt stayed 'certifying' (the previous version of this file asserted that boundary).
# STAND-INS: Midway's union wallet row (promo 0.00, as union-books.py); the generation source and the sources check's pin
#   of it (this fixture carries none of the 245 original restoration certificates). Notification sinks stay unwired.
# SEEDED: the settler watermark, the union's ECO terms at week start (through production's capture triggers) and one
#   original hand capture per hand (each hand's stack delta 0: the board has no tables or seats).
# NOT COVERED: a second union closing in the same database (its week would need its own paid rounds); a week whose ECO
#   terms change mid-week (production refuses to close it, asserted); cash P&L with real buy-ins, cash-outs or seated
#   boundaries; the rake rollup warm-up (fn_union_rake_rollup_refresh_day is not carried; production logs and continues).
import datetime
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
# ---------------------------------------------------------------- THE FIX (finding C1), whole from disk
# fn_accounting_union_earned_plan_advance, fn_union_pnl_evidence_report and fn_accounting_close_report_memo_key resolved the
# original inventory generation only for Midway; 20261116033831 resolves it for every union from the same source
# (smarter_private.original_inventory_basis_generation(), which takes no union) and re-pins the two md5s
# original_inventory_proof_sources_match holds for the advance and the report. The preimages are production's bodies,
# loaded byte-exact above (md5 re-read 2026-11-16).
MIG_C1=next((R/'supabase/migrations').glob('20261116033831_*.sql')); mig_c1=MIG_C1.read_text()
_by={k.split('(')[0]:k for k in UC['functions']}
C1_FN={'report':'public.fn_union_pnl_evidence_report','memo_key':'public.fn_accounting_close_report_memo_key',
  'advance':'public.fn_accounting_union_earned_plan_advance','sources_match':'smarter_private.original_inventory_proof_sources_match'}
C1_OLD={x:UC['functions'][_by[n]]['def'] for x,n in C1_FN.items()}
assert {x:hashlib.md5(d.encode()).hexdigest() for x,d in C1_OLD.items()}=={'report':'26cb0f6e4912cd3e8980f657bb52d50c','memo_key':'28364d8f001236b1d0aefdf4aa2246fa',
  'advance':'276a23e5aaa880abab19217a33a8f69d','sources_match':'2115cc50e91b586e152baa0ba6395b58'}
FNDEF="SELECT pg_get_functiondef('%s'::regproc)"
q('SET check_function_bodies=off;\n'+mig_c1)
C1_NEW={x:q(FNDEF%n).stdout[:-1] for x,n in C1_FN.items()}
# Byte for byte, the only changes: the Midway test leaves the generation condition (and a two-line note says so), the
# advance's pin of the report moves to the new report, and the sources' two pins move to the new advance and report. For
# Midway `p_union_id=Midway AND p_end>=boundary` and `p_end>=boundary` are the same predicate: Midway's results cannot change.
_mid="p_union_id='fade0000-0000-0000-0000-000000000001'::uuid AND "
_note=" -- ANY UNION (20261116033831): the original inventory generation is the one\n -- smarter_private.original_inventory_basis_generation() answers, for every union.\n"
def _fix(d,cond): o=f" IF {_mid}{cond} THEN\n"; assert d.count(o)==1; return d.replace(o,_note+f" IF {cond} THEN\n")
_m=lambda s:hashlib.md5(s.encode()).hexdigest()
_exp={'report':_fix(C1_OLD['report'],"p_end>='2026-10-12 07:00:00Z'::timestamptz"),'memo_key':_fix(C1_OLD['memo_key'],"p_end>='2026-10-12 07:00:00Z'::timestamptz")}
_exp['advance']=_fix(C1_OLD['advance'],"p_end>='2026-10-12 07:00Z'::timestamptz").replace(_m(C1_OLD['report']),_m(_exp['report']))
_exp['sources_match']=C1_OLD['sources_match'].replace(_m(C1_OLD['report']),_m(_exp['report'])).replace(_m(C1_OLD['advance']),_m(_exp['advance']))
assert C1_NEW==_exp,('20261116033831 changed more than the generation condition and its pins',[x for x in C1_NEW if C1_NEW[x]!=_exp[x]])
assert sum(d.count('fade0000-0000-0000-0000-000000000001') for d in C1_NEW.values())==0 and sum(d.count('fade0000-0000-0000-0000-000000000001') for d in C1_OLD.values())==3
assert set(sigs().items())-set(_g.items())=={(_by[n],_m(C1_NEW[x])) for x,n in C1_FN.items()},'20261116033831 replaced something else'
proofs_c1=[l.split(': ',1)[1] for l in mig_c1.splitlines() if l.startswith('-- @live-proof: ')]
assert len(proofs_c1)==5 and all(one('SELECT '+p+';')=='t' for p in proofs_c1),'a live proof of 20261116033831 is false after install'
again_c1=q('SET check_function_bodies=off;\n'+mig_c1,check=False)
assert again_c1.returncode and 'ANY_UNION_GENERATION_PREIMAGE_CHANGED' in again_c1.stderr,again_c1.stderr[-600:]
assert one(ACL_SQL%_acl)==str(len(UC_CFG['function_acl'])),'20261116033831 moved a grant'
# The real generation source, after the fix: every reviewed source matches (the re-pinned sources included), and the
# fixture's generation is NULL only because it carries none of the 245 original restoration certificates.
assert one("SELECT smarter_private.original_inventory_proof_sources_match()")=='t'
assert one("SELECT (SELECT count(*) FROM smarter_private.original_inventory_restoration_cases)||'|'||(smarter_private.original_inventory_basis_generation() IS NULL)")=='0|true'
case("union close, the fix (finding C1): 20261116033831 installs whole from disk on production's four bodies (md5 26cb0f6e/28364d8f/276a23e5/2115cc50, re-read 2026-11-16); byte for byte it only drops the Midway test from the generation condition of fn_accounting_union_earned_plan_advance, fn_union_pnl_evidence_report and fn_accounting_close_report_memo_key (for Midway the same predicate) and moves the advance's and the sources' pins to the new bodies; its five live proofs are true, every grant is production's, a second install refuses, and original_inventory_proof_sources_match() is still true")
# STAND-INS (two, for the generation only). Production answers a real generation (original-inventory-245-v1:...); this
# fixture cannot carry the 245 restoration certificates, so the generation source answers a fixed value of the same form,
# and the sources check pins that stand-in instead of production's body. Every other pin of the sources check (68,
# including the two 20261116033831 moved) is still checked live, by the hand witness, on every proof below.
q("CREATE OR REPLACE FUNCTION smarter_private.original_inventory_basis_generation() RETURNS text LANGUAGE sql STABLE SET search_path TO 'pg_catalog' AS $$SELECT 'original-inventory-245-v1:'||md5('rakeback-cascade-real-runner fixture generation')$$;")
_gen_md5=one("SELECT md5(pg_get_functiondef('smarter_private.original_inventory_basis_generation()'::regprocedure))")
assert C1_NEW['sources_match'].count('58dc20e1ba380ccb9b9dee8809731d33')==1
q(C1_NEW['sources_match'].replace('58dc20e1ba380ccb9b9dee8809731d33',_gen_md5)+';\n')
assert one("SELECT smarter_private.original_inventory_proof_sources_match()")=='t'
GEN=one("SELECT smarter_private.original_inventory_basis_generation()")
# ---------------------------------------------------------------- SEEDED (what the fixture lacked to close)
# 1. The settler watermark (the engine's rakeback settler daemon writes it): the week's last rake record, as production
#    holds its own (daemon_state 'rakeback_settler': high_water_mark and its record id).
q("INSERT INTO public.daemon_state(daemon,high_water_mark,high_water_mark_id) SELECT 'rakeback_settler',created_at,id FROM public.rake_records ORDER BY created_at DESC,id DESC LIMIT 1;")
# 2. The union's commercial (ECO) terms at week start, through production's own capture: both ECO triggers on public.unions
#    (union-close-config.json, triggers) and one owner settings write on Wednesday 2026-11-04 12:00Z, before the week, with
#    Midway's ECO values (cash and tournament ECO on at 10%, club cash profit, horses included). The history row is the
#    opening coverage; the v2 terms take effect from the next book (2026-11-09 08:00Z).
for t in UC_CFG['triggers']:
    assert _byname.get(t['f'])==t['fm'] and t['e']=='O',t
    q(t['def']+';')
q("BEGIN;SELECT set_config('rf.clock_offset',(extract(epoch FROM ('2026-11-04 12:00:00+00'::timestamptz-pg_catalog.rf_real_clock()))::numeric(20,3))::text||' seconds',true);"
  "UPDATE public.unions SET settings=settings||'{\"eco_enabled\":true,\"eco_base_mode\":\"club_cash_profit\",\"eco_rate\":0.10,\"eco_include_horses\":true,"
  "\"eco_cash_enabled\":true,\"eco_cash_rate\":0.10,\"eco_tournament_enabled\":true,\"eco_tournament_rate\":0.10}'::jsonb WHERE id=rr.u('U');COMMIT;")
assert one("SELECT count(*)||'|'||min(event_type)||'|'||min(observed_at)::text FROM public.accounting_agreement_history WHERE entity_type='unions' AND union_id=rr.u('U')").startswith('1|UPDATE|2026-11-04 12:00:00')
assert one("SELECT count(*)||'|'||min(effective_from)::text FROM smarter_private.union_eco_v2_terms WHERE union_id=rr.u('U')")=='1|2026-11-09 08:00:00+00'
# Terms that change during the week are refused by production, by design (the report's
# eco_intraweek_changed_terms_require_original_allocation): a second write on Thursday 2026-11-12, in a rolled-back
# transaction, makes the week's terms two segments, so such a week can never close as it stands.
assert one("BEGIN;SELECT set_config('rf.clock_offset',(extract(epoch FROM ('2026-11-12 12:00:00+00'::timestamptz-pg_catalog.rf_real_clock()))::numeric(20,3))::text||' seconds',true);"
  "UPDATE public.unions SET settings=settings||'{\"eco_rate\":0.20}'::jsonb WHERE id=rr.u('U');SELECT set_config('rf.clock_offset',(extract(epoch FROM ('2026-11-16 12:00:00+00'::timestamptz-pg_catalog.rf_real_clock()))::numeric(20,3))::text||' seconds',true);"
  "SELECT (SELECT count(DISTINCT x->'terms') FROM jsonb_array_elements(e->'segments') x)||'|'||(e->>'status') FROM (SELECT public.fn_union_eco_terms_evidence(rr.u('U'),rr.ws(),rr.we()) e) z;ROLLBACK;")=='2|ready'
assert one("SELECT count(*) FROM public.accounting_agreement_history WHERE entity_type='unions'")=='1'
# 3. The engine's original hand capture: one union_pnl_cash_outcomes row per hand (what the capture trigger on
#    hand_atomic_commits records for an accepted hand), in the hand's own transaction frame at the hand's instant, accepted
#    rake equal to the hand's rake record. This fixture's hands carry no tables, seats or stacks (scenario.sql seeds rake
#    records only), so each hand's one participant shows a stack delta of 0: the cash P&L is reconciled only in that
#    degenerate shape (no buy-ins, no cash-outs, no seated boundary). Production's touch trigger writes the touch rows.
_seed=q("SELECT format($f$BEGIN;SELECT set_config('rf.clock_offset',(extract(epoch FROM (%L::timestamptz-pg_catalog.rf_real_clock()))::numeric(20,3))::text||' seconds',true);"
  "INSERT INTO public.union_pnl_cash_outcomes SELECT %L::uuid,1,%L::uuid,f.transaction_id,f.observed_at,md5(%L),s.scope,"
  "jsonb_build_object('status','ready','basis_certified',true,'all_players_included',true,'game_scope',s.scope,'accepted_rake',%L,'accepted_bbj','0.00','accepted_external_net','0.00',"
  "'participants',jsonb_build_array(jsonb_build_object('earning_club_id',%L,'user_id',%L,'observed_stack_delta',0))) FROM public.fn_union_pnl_original_frame() f,"
  "(SELECT jsonb_build_object('host_club_id',%L,'game_union_id',%L,'is_private',false,'tournament_id',NULL,'asset','chips','unit_scale',2) scope) s;COMMIT;$f$,"
  "r.created_at,md5('table:'||r.id::text)::uuid,r.hand_id,r.hand_id::text,r.rake_amount::numeric(18,2)::text,r.club_id,a.player_id,r.club_id,rr.u('U')) "
  "FROM public.rake_records r JOIN public.rake_attributions a ON a.rake_record_id=r.id ORDER BY r.created_at;").stdout
q(_seed)
assert one("SELECT count(*)||'|'||sum((evidence->>'accepted_rake')::numeric)||'|'||(SELECT count(*) FROM public.union_pnl_cash_outcome_touches) FROM public.union_pnl_cash_outcomes")=='10|740.00|10'
assert one("SELECT sum(rake_credit) FROM public.accounting_payable_earning_sources WHERE union_id=rr.u('U') AND earned_at>=rr.ws() AND earned_at<rr.we()")=='740'
case(f"union close, the seeds: the settler watermark at the week's last rake record; the union's ECO terms at week start through production's two capture triggers on unions (one owner write on 2026-11-04, Midway's values: cash and tournament ECO 10%, horses included; v2 terms effective 2026-11-09 08:00Z); a second write mid-week (rolled back) splits the week's terms in two, which production refuses to close by design; one original hand capture per hand (10 hands, accepted rake 740.00 = the 740.00 the earning sources hold); the generation stand-in answers {GEN[:30]}...")
# ---------------------------------------------------------------- the close, tick by tick, until the books are complete
STMT="SELECT COALESCE(string_agg(c.name||':'||i.invoice_number||':'||i.from_entity_type||'>'||i.to_entity_type||':'||i.net_amount::text||':'||(i.breakdown->>'direction')||':'||(i.breakdown->>'eco_amount'),',' ORDER BY i.invoice_number),'') FROM public.settlement_invoices i JOIN public.clubs c ON c.id=i.club_id WHERE i.invoice_type='union_weekly_squareup'"
SNAP=("SELECT md5(jsonb_build_array((SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.settlement_invoices i),(SELECT jsonb_agg(to_jsonb(d) ORDER BY invoice_id,recipient_id) FROM public.accounting_invoice_deliveries d),"
  "(SELECT jsonb_agg(to_jsonb(c) ORDER BY union_id,year) FROM public.union_invoice_counters c),(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.chip_ledger l),(SELECT count(*) FROM public.union_wallet_transactions),"
  "(SELECT count(*) FROM public.social_messages),(SELECT count(*) FROM public.notifications),(SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM smarter_private.union_eco_components e),"
  "(SELECT jsonb_agg(jsonb_build_array(status,result) ORDER BY union_id) FROM public.union_accounting_runs))::text)")
RUN_DONE="SELECT COALESCE((SELECT status FROM public.union_accounting_runs WHERE union_id=rr.u('U') AND period_start=rr.ws() AND period_end=rr.we()),'')"
PSQL_ARGS=lambda:[str(A.pg_bin/'psql'),'-X','-qAt','-U','postgres','-h','127.0.0.1','-p',port,'-d',DB]
def _popen(extra): return subprocess.Popen(PSQL_ARGS()+extra,env=E,text=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def _close_tick(at,interrupt=False):
    """One job 564 tick. With interrupt, a second session holds the statement counter table, and if this tick reaches
    it (only the tick that numbers the square-up statements does), its backend is terminated mid-close."""
    clock(at); blk=None
    if interrupt:
        blk=_popen([]); blk.stdin.write("BEGIN;LOCK TABLE public.union_invoice_counters IN ACCESS EXCLUSIVE MODE;\n"); blk.stdin.flush()
        for _ in range(100):
            if one("SELECT count(*) FROM pg_locks WHERE relation='public.union_invoice_counters'::regclass AND mode='AccessExclusiveLock' AND granted")=='1': break
            time.sleep(0.1)
        else: raise SystemExit('the counter table could not be held')
    p=_popen(['-c',CRON[BOOKS]]); killed=False
    while p.poll() is None:
        if interrupt and not killed:
            pid=one("SELECT COALESCE(min(pid),0) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%weekly_union_books_due%' AND pid<>pg_backend_pid()")
            if pid!='0': killed=one(f"SELECT pg_terminate_backend({pid})")=='t'
        time.sleep(0.2)
    out,err=p.communicate()
    if blk: blk.stdin.write('ROLLBACK;\n'); blk.stdin.close(); blk.wait()
    lines=out.strip().split('\n'); rec={'at':at,'job':BOOKS,'rc':p.returncode,'out':lines[-1][:20000] if lines else '','err':err[:3000],'interrupted':killed}
    record.append(rec); return rec
_mid_wallet=one("SELECT to_jsonb(w)::text FROM public.union_wallets w WHERE union_id='fade0000-0000-0000-0000-000000000001'")
closes=[]; interrupted=None; t0=datetime.datetime(2026,11,16,12,8,20,tzinfo=datetime.timezone.utc)
for i in range(90):  # one job 564 tick every two minutes from 12:08Z
    at=(t0+datetime.timedelta(minutes=2*i)).strftime('%Y-%m-%d %H:%M:%S+00')
    r=_close_tick(at,interrupt=interrupted is None)
    if A.verbose: print('CLOSE',at,r['rc'],r['interrupted'],r['out'][-600:],r['err'][:600],flush=True)
    if r['interrupted']:
        # RETRY: the tick was cut off inside the close (at the statement numbering); everything it did rolled back.
        assert r['rc']!=0 and one(STMT)=='' and one("SELECT count(*) FROM public.union_invoice_counters")=='0' and one("SELECT count(*) FROM public.accounting_invoice_deliveries")=='0',r
        assert one(RUN_DONE)!='complete' and one(CMONEY)==cmoney0,r
        interrupted=r; continue
    r['parts']=one(PARTS); r['run']=one(RUN) if one("SELECT count(*) FROM public.union_accounting_runs WHERE union_id=rr.u('U')")=='1' else None; closes.append(r)
    assert r['rc']==0 and 'ERROR' not in r['err'],('a close tick raised',r)
    assert one(CMONEY)==cmoney0,('the close moved money or paid something again',r)
    if one(RUN_DONE)=='complete': break
assert interrupted is not None,'no tick reached the statement numbering'
assert one(RUN_DONE)=='complete',('the close did not finish',[c['run'] for c in closes[-5:]])
# 12:08 the promo; 12:10 to 12:26 the original inventory is sealed one week a tick (as before the fix).
j,t=detail(closes[0]); assert t['weekly_horse_promo']['reason']=='no_eligible_wallets',closes[0]
seals=[detail(r)[1]['inventory_seal'] for r in closes[1:10]]
assert [x['sealed'][0]['boundary'][:10] for x in seals]==['2026-09-21','2026-09-28','2026-10-05','2026-10-12','2026-10-19','2026-10-26','2026-11-02','2026-11-09','2026-11-16'],seals
assert all(x['sealed'][0]['status']=='sealed' and x['sealed'][0]['issue_count']==0 for x in seals) and seals[-1]['status']=='ready' and all(x['status']=='sealing' for x in seals[:-1])
assert one("SELECT count(*) FROM public.union_pnl_inventory_checkpoints")=='9'
case('union close, executed: after the paid and released week, job 564\'s exact command enters the REAL close (union-close.json: every function it reaches, byte-exact from production 2026-11-15/16, its relations, triggers and grants); the original P&L inventory is sealed one week per tick from the capture boundary (2026-09-21) to this Monday (9 checkpoints, no issues); '+(f"production's current body replaces the fixture's older one for: {', '.join(x.split('.')[1] for x in UC_NEWER)}" if UC_NEWER else 'no fixture body is replaced'))
visits=closes[10:]
stages=[]
for r in visits:
    j,t=detail(r); d=t.get('detail') or []
    if not d: stages.append('idle'); continue
    assert t['failed']==0 and len(d)==1 and d[0]['union_id']==one("SELECT rr.u('U')::text"),r
    res=d[0]['result']; stages.append(res.get('stage') or ('complete' if res.get('success') else '?'))
# The paid week's post-paid qualification proves its flows, linked units and hand parts window by window under the
# generation (the C1 boundary is passed: the advance's hand-parts read answers), the report turns ready, each club's
# statement evidence is its own step, then one tick runs the post-paid settlement: ECO recorded, square-up statements
# numbered and delivered, the club weekly statements issued, the books complete.
assert 'pnl_flows_window:84:' in visits[-1]['parts'] and 'pnl_hands_window:84:' in visits[-1]['parts'],visits[-1]['parts']
_first_ready=next(i for i,r in enumerate(visits) if (detail(r)[1].get('detail') or [{}])[0].get('result',{}).get('pnl_evidence')=={'issues':[],'status':'ready'})
assert all(s=='certifying' for s in stages[:_first_ready+1]) and stages[_first_ready+1:_first_ready+4]==['statement_evidence']*3 and stages[-1]=='complete',stages
_ev=[(detail(r)[1]['detail'][0]['result']['club_id']) for r in visits[_first_ready+1:_first_ready+4]]
assert sorted(_ev)==sorted(one("SELECT string_agg(club_id::text,',') FROM public.union_clubs WHERE union_id=rr.u('U')").split(','))
_fin=detail(visits[-1])[1]['detail'][0]['result']
assert _fin['success'] is True and _fin['eco_recorded']=={'clubs':3,'success':True,'components':6,'period_end':'2026-11-16T08:00:00+00:00','eco_version':2,'period_start':'2026-11-09T08:00:00+00:00','eco_base_mode':'separate_club_profit'},_fin
# Per club, the square-up statement: direction and amount (ECO 10% of the club's cash profit: rake earned 162.00 /
# 369.00 / 135.00 less a player P&L of 0), numbered from the union's own counter in the statement order (club name).
assert one(STMT)==('Club O:UNIONU-2026-000001:club>union:16.20:club owes union:-16.20,Club T:UNIONU-2026-000002:club>union:36.90:club owes union:-36.90,'
  'Club W:UNIONU-2026-000003:club>union:13.50:club owes union:-13.50'),one(STMT)
assert one("SELECT string_agg(union_id::text||':'||year||':'||next_seq,',') FROM public.union_invoice_counters")==one("SELECT rr.u('U')::text")+':2026:4'
assert one("SELECT count(*) FROM public.settlement_invoices WHERE invoice_type='union_weekly_squareup' AND (status<>'generated' OR NOT message_sent OR from_entity_id<>club_id::text OR to_entity_id<>rr.u('U')::text OR period_id NOT IN(SELECT id FROM public.settlement_periods WHERE union_id=rr.u('U') AND start_at=rr.ws() AND end_at=rr.we()))")=='0'
# Delivery: every statement exactly once to each of its two parties (the club's owner and the union's owner), each a
# message and a notification, and nothing else delivered.
assert one("SELECT string_agg(c.name||'>'||CASE WHEN d.recipient_id=u.owner_id THEN 'union' WHEN d.recipient_id=cm.user_id THEN 'club' ELSE '?' END,',' ORDER BY c.name,d.recipient_id=u.owner_id) FROM public.accounting_invoice_deliveries d JOIN public.settlement_invoices i ON i.id=d.invoice_id JOIN public.clubs c ON c.id=i.club_id JOIN public.unions u ON u.id=rr.u('U') LEFT JOIN public.club_members cm ON cm.club_id=i.club_id AND cm.role='owner' AND cm.user_id=d.recipient_id WHERE d.message_id IS NOT NULL AND d.notification_id IS NOT NULL")=='Club O>club,Club O>union,Club T>club,Club T>union,Club W>club,Club W>union'
assert one("SELECT count(*)||'|'||count(DISTINCT (invoice_id,recipient_id)) FROM public.accounting_invoice_deliveries")=='6|6'
assert one("SELECT count(*) FROM public.settlement_invoices WHERE invoice_type='club_weekly_accounting'")=='3'
assert one("SELECT count(*) FROM public.chip_ledger WHERE category='rakeback'")==RAKEBACK_ROWS
# Nothing of the close is Midway's: no statement, counter, delivery, ECO record or run for Midway's id, and Midway's
# union wallet row (the stand-in) is as it was.
MID="'fade0000-0000-0000-0000-000000000001'::uuid"
assert one(f"SELECT (SELECT count(*) FROM public.settlement_invoices WHERE club_id={MID} OR breakdown->>'union_id'={MID}::text)+(SELECT count(*) FROM public.union_invoice_counters WHERE union_id={MID})"
  f"+(SELECT count(*) FROM smarter_private.union_eco_components WHERE union_id={MID})+(SELECT count(*) FROM public.union_accounting_runs WHERE union_id={MID})+(SELECT count(*) FROM public.settlement_periods WHERE union_id={MID})")=='0'
assert one(f"SELECT to_jsonb(w)::text FROM public.union_wallets w WHERE union_id={MID}")==_mid_wallet
case(f"union close, end to end: past the C1 boundary every hand window is read under the generation, the paid week's report turns ready at visit {_first_ready+1}, each club's statement evidence is its own step, and at {visits[-1]['at'][11:16]}Z one tick records ECO (3 clubs, 6 activity components), issues the square-up statements and the club weekly statements and completes the books: Club O, Club T and Club W each owe the union 16.20 / 36.90 / 13.50 (10% of club cash profit), numbered UNIONU-2026-000001..3 from the union's own counter (next 4), each delivered exactly once to the club owner and once to the union owner (6 deliveries, message and notification each); no money moved on any tick, the chip ledger keeps its {RAKEBACK_ROWS} rakeback rows, and nothing was written for Midway's id")
case(f"union close, retry: the tick at {interrupted['at'][11:16]}Z was terminated mid-close at the statement numbering (a second session held the counter table); it left no statement, counter, delivery or money movement and the books were not complete; the next tick resumed and finished with exactly one statement per club and no numbering gap")
# ---------------------------------------------------------------- duplicate execution after completion
snap0=one(SNAP); _done_at=datetime.datetime.fromisoformat(visits[-1]['at'].replace('+00','+00:00'))
for k in range(1,4):  # three more ticks, one after another
    r=_close_tick((_done_at+datetime.timedelta(minutes=2*k)).strftime('%Y-%m-%d %H:%M:%S+00')); assert r['rc']==0 and 'ERROR' not in r['err'],r
    assert one(SNAP)==snap0 and one(CMONEY)==cmoney0,('a tick after completion changed the books',r)
clock((_done_at+datetime.timedelta(minutes=8)).strftime('%Y-%m-%d %H:%M:%S+00'))
ps=[_popen(['-c',CRON[BOOKS]]) for _ in range(4)]  # four at the same instant
res=[(p.wait(),p.communicate()) for p in ps]
assert all(rc==0 and 'ERROR' not in e for rc,(o,e) in res),res
assert one(SNAP)==snap0 and one(CMONEY)==cmoney0,'concurrent ticks after completion changed the books'
# And the issuance itself called again for the closed week (as the safety net calls it): every statement is already
# delivered, so it restates nothing, takes no number and delivers nothing.
_again=json.loads(one("SELECT public.fn_union_issue_weekly_invoices(rr.u('U'),rr.ws(),rr.we())::text"))
assert _again['success'] is True and _again['invoices']==3 and _again['notified']==0 and all(x['already_sent'] for x in _again['detail']),_again
assert one(SNAP)==snap0 and one(CMONEY)==cmoney0,'a repeated issuance changed the books'
case('union close, duplicate execution: after completion three sequential ticks, four concurrent ticks at one instant and a direct repeat of the statement issuance create no statement, number, delivery, message, notification, ECO record or ledger row, and move no money (every table compared whole)')
_used={k for k in usage()['functions']}
_unshifted={k.split('(')[0] for k,v in UC['functions'].items() if re.search(r'\b(CURRENT_DATE|CURRENT_TIMESTAMP|CURRENT_TIME|LOCALTIMESTAMP|LOCALTIME)\b',v['def'],re.I)}&_used
assert not _unshifted,('a close function that reads a clock form the fixture clock does not shift was executed',sorted(_unshifted))
record.append({'union_close':[{k:r.get(k) for k in ('at','rc','out','err','parts','run','interrupted')} for r in closes+[interrupted]]})
DB='postgres'
if not A.keep: q("DROP DATABASE close;")  # author aid: --keep leaves it for inspection
