"""The funding club bears its satellite seat refund (owner ruling 2026-11-11).

Runs both actual original PNL readers, exactly as installed in production
(the September readers plus the admitted-club arm, md5-checked against the
migration's own preimage pins), on the three original satellite refund
lineages of cancelled tournament f4153d52: two seats whose upstream entry was
paid from KINGS CLUB wallets and whose refunds landed in The Felt Society
after the players left KINGS CLUB, and one unchanged same-club control.

Before: the two refunds certify as The Felt Society's returns. After the
candidate: they certify as KINGS CLUB's returns (the club the wallet-funded
entry receipt names), the ledger keeps The Felt Society as its own club (the
inter-club transfer), the control is byte-identical, and every other output
column of every row is unchanged. The admitted-club arm's twenty faults, plus
four transfer faults, still refuse in both readers. Unrelated cash, treasury
and BBJ branches are empty controls, not full-book qualification. All
mutations run only on a disposable PostgreSQL 17 cluster and roll back.
"""
import json, os, pathlib, re, shutil, subprocess, tempfile
R=pathlib.Path(__file__).resolve().parents[2]
F=R/'scripts/ci/fixtures/satellite-refund-admitted-club'
OLD=json.loads((R/'scripts/ci/fixtures/ticket-refund-pnl-preimages.json').read_text())
S=json.loads((F/'preimages.json').read_text())
D=json.loads((F/'lineages.json').read_text())
PG=pathlib.Path(os.environ.get('PG_BIN','/opt/homebrew/opt/postgresql@17/bin'))
parent=pathlib.Path(os.environ['ACCOUNTING_FIXTURE_PARENT'])
w=pathlib.Path(tempfile.mkdtemp(prefix='f-',dir=parent)); sock=w/'s';sock.mkdir()
port=os.environ.get('SATELLITE_FUNDING_PG_PORT','55682');started=False
env=dict(os.environ,LC_ALL='C',LANG='C')
ADMITTED=R/'supabase/migrations/20261111010427_a_satellite_seat_refund_follows_its_admitted_club.sql'
CANDIDATE=next((R/'supabase/migrations').glob('*_a_departed_funding_club_bears_its_satellite_seat_refund.sql'))
KINGS='a41434bb-8d0c-400a-8f0d-e8b3d65afed4';FELT='a0000000-0000-0000-0000-000000000001'
def run(args,text=None):
 r=subprocess.run(args,input=text,text=True,capture_output=True,env=env,timeout=60)
 assert r.returncode==0,(r.stdout+r.stderr)[:1600]+(r.stdout+r.stderr)[-1000:]
 return r.stdout.strip()
def sql(s):
 return run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h',str(sock),'-p',port,'-d','postgres'],'SET check_function_bodies=off;'+s)
def insert(table,obj):
 v=json.dumps(obj,separators=(',',':')).replace("'","''")
 return 'INSERT INTO public.'+table+" SELECT * FROM jsonb_populate_record(NULL::public."+table+",'"+v+"'::jsonb);"
full="public.fn_union_pnl_original_flow_evidence('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z')"
window="smarter_private.union_pnl_original_flow_evidence_window('fade0000-0000-0000-0000-000000000001','2026-11-02 08:00Z','2026-11-09 08:00Z','2026-11-07 20:00Z','2026-11-07 22:00Z')"
readers={'full':('public.fn_union_pnl_original_flow_evidence(uuid,timestamptz,timestamptz)',full),
 'window':('smarter_private.union_pnl_original_flow_evidence_window(uuid,timestamptz,timestamptz,timestamptz,timestamptz)',window)}
admitted_anchor="     WHEN 'satellite_seat' THEN public.fn_union_pnl_satellite_seat_owner(t.registration_id,NULL)=t.refund_wallet_club_id\n"
cand=CANDIDATE.read_text()
pins=re.findall(r"'([0-9a-f]{32})'",cand.split('RAISE EXCEPTION \'departed_funding_club_preimage_changed\'')[0])
olds=[re.search(r'\$o%d\$(.*?)\$o%d\$'%(i,i),cand,re.S).group(1) for i in (1,2,3)]
news=[re.search(r'\$n%d\$(.*?)\$n%d\$'%(i,i),cand,re.S).group(1) for i in (1,2,3)]
rows=lambda c:sql("SELECT string_agg(concat_ws(',',ledger_id,club_id,user_id,buyins,cashouts,kind,valid),'|' ORDER BY ledger_id) FROM "+c)
try:
 run([str(PG/'initdb'),'-D',str(w/'data'),'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
 run([str(PG/'pg_ctl'),'-D',str(w/'data'),'-l',str(w/'server.log'),'-o',f"-k {sock} -p {port} -h '' -c shared_buffers=16MB -c max_wal_size=64MB",'-w','start']);started=True
 setup='CREATE SCHEMA smarter_private;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;'
 for t in OLD['schemas']+json.loads((F/'empty-bbj-schemas.json').read_text()):
  setup+='CREATE TABLE public.'+t['relname']+'('+t['columns']+');'
 for f in OLD['source40']+OLD['connected']: setup+=f['definition']+';'
 arm=ADMITTED.read_text().split('$arm$')[1]
 for f in S:
  if 'original_flow_evidence' in f['signature']:
   assert f['definition'].count(admitted_anchor)==1
   setup+=f['definition'].replace(admitted_anchor,arm)+';'
  elif 'satellite_seat_owner' in f['signature']:setup+=f['definition']+';'
 setup+=(R/'scripts/ci/fixtures/ticket-refund-pnl-cents.sql').read_text()+';'
 setup+="""
CREATE TABLE public.tournament_players(id uuid,tournament_id uuid,user_id uuid);
CREATE TABLE public.tournaments(id uuid,union_id uuid,club_id uuid,buy_in_amount numeric,buy_in_fee numeric,bounty_amount numeric,is_bounty boolean,is_pko boolean,is_mystery_bounty boolean);
CREATE OR REPLACE FUNCTION public.fn_ca_assert_satellite_value_ticket(uuid) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
CREATE OR REPLACE FUNCTION public.fn_poker_diamond_tournament(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT NULL::boolean';
CREATE OR REPLACE FUNCTION public.fn_tournament_entry_split(numeric,numeric,numeric,boolean) RETURNS TABLE(prize numeric,bounty numeric,rake numeric,charge numeric) LANGUAGE sql AS 'SELECT NULL::numeric,NULL::numeric,NULL::numeric,NULL::numeric WHERE false';
CREATE OR REPLACE FUNCTION public.fn_union_pnl_prove_late_settlement(uuid) RETURNS TABLE(club_id uuid,user_id uuid,delta numeric) LANGUAGE sql AS 'SELECT NULL::uuid,NULL::uuid,NULL::numeric WHERE false';
CREATE OR REPLACE FUNCTION public.fn_cash_original_funding_lineage(uuid,uuid,uuid,uuid,timestamptz,timestamptz,boolean) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
CREATE OR REPLACE FUNCTION smarter_private.cash_initial_funding_receipt(uuid) RETURNS boolean LANGUAGE sql AS 'SELECT false';
CREATE OR REPLACE FUNCTION smarter_private.original_treasury_gift_evidence(uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
CREATE OR REPLACE FUNCTION smarter_private.original_treasury_return_evidence(uuid) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
"""
 for n in ['original_restoration_cash_returns','original_erased_cash_discharge_returns']:
  setup+="CREATE OR REPLACE FUNCTION smarter_private."+n+"(p_union_id uuid,p_start timestamptz,p_end timestamptz) RETURNS TABLE(ledger_id uuid,club_id uuid,user_id uuid,buyins numeric,cashouts numeric,kind text,valid boolean) LANGUAGE sql AS 'SELECT NULL::uuid,NULL::uuid,NULL::uuid,0::numeric,0::numeric,NULL::text,false WHERE false';"
 sql(setup)
 # The fixture readers ARE the production preimages the candidate pins.
 for name,(sig,_) in readers.items():
  got=sql(f"SELECT md5(pg_get_functiondef('{sig}'::regprocedure))")
  assert got==pins[0 if name=='full' else 1],(name,got,pins)
 print('PASS fidelity: both fixture readers are byte-identical to the preimages the candidate pins')
 tables={'entitlements':'tournament_refund_entitlements','admissions':'chip_ledger','tranches':'tournament_refund_tranches','flows':'union_pnl_original_flows','awards':'tournament_satellite_awards','settlements':'tournament_satellite_settlements','payouts':'tournament_payouts','entries':'tournament_participant_funding_receipts','funding_ledgers':'chip_ledger','inventory':'union_pnl_inventory_events'}
 data='';seen=set()
 for k,t in tables.items():
  for o in D[k]:
   identity=t+json.dumps(o,sort_keys=True)
   if identity not in seen:data+=insert(t,o);seen.add(identity)
 sql(data)
 cross=[e for e in D['entitlements'] if e['refund_wallet_club_id']==FELT]
 control=[e for e in D['entitlements'] if e['refund_wallet_club_id']!=FELT]
 assert len(cross)==2 and len(control)==1
 crossq={next(t['credit_ledger_id'] for t in D['tranches'] if t['entitlement_id']==e['id']) for e in cross}
 before={}
 for name,(_,c) in readers.items():
  before[name]=rows(c)
  assert sql("SELECT count(*)||':'||count(*) FILTER(WHERE valid)||':'||sum(cashouts)||':'||sum(buyins) FROM "+c)=='3:3:600:0'
  assert sql("SELECT string_agg(club_id::text,',' ORDER BY ledger_id) FROM "+c+" WHERE ledger_id IN('"+"','".join(crossq)+"')")==FELT+','+FELT
 print('PASS baseline: installed readers certify both departed-club refunds as The Felt Society returns')
 for name,(sig,_) in readers.items():
  d=sql(f"SELECT pg_get_functiondef('{sig}'::regprocedure)")+'\n'
  for o,n in zip(olds,news):
   assert d.count(o)==1,(name,o[:60]);d=d.replace(o,n)
  sql(d+';')
 for name,(_,c) in readers.items():
  assert sql("SELECT count(*)||':'||count(*) FILTER(WHERE valid)||':'||sum(cashouts)||':'||sum(buyins)||':'||count(*) FILTER(WHERE kind='tournament_return') FROM "+c)=='3:3:600:0:3'
  # The two refunds belong to the club the wallet-funded entry receipt names,
  # while their ledger rows keep The Felt Society: the inter-club transfer.
  assert sql("SELECT bool_and(f.valid AND f.club_id=r.funding_club_id AND f.club_id='"+KINGS+"' AND l.ledger_snapshot->>'club_id'='"+FELT+"' AND f.user_id=e.user_id AND f.cashouts=e.gross AND f.buyins=0)||':'||count(*) FROM "+c+" f JOIN tournament_refund_tranches tr ON tr.credit_ledger_id=f.ledger_id JOIN tournament_refund_entitlements e ON e.id=tr.entitlement_id JOIN union_pnl_original_flows l ON l.ledger_id=f.ledger_id JOIN tournament_participant_funding_receipts r ON r.tournament_id=e.source_satellite_id AND r.user_id=e.user_id AND r.operation='entry' WHERE e.refund_wallet_club_id='"+FELT+"'")=='true:2'
  # Nothing else moved: every other column of every row, and the control, is identical.
  after=rows(c);b={x.split(',')[0]:x for x in before[name].split('|')};a={x.split(',')[0]:x for x in after.split('|')}
  assert b.keys()==a.keys()
  changed={k for k in b if b[k]!=a[k]}
  assert changed==crossq,(changed,crossq)
  for k in changed:
   assert b[k].replace(FELT,KINGS)==a[k],(b[k],a[k])
 print('PASS candidate: both readers attribute the two refunds (400 chips) to KINGS CLUB; ledger keeps The Felt Society; control and every other column unchanged')
 e=cross[0];eid=e['id'];aid=e['source_ledger_id'];rid=e['registration_id'];tr=next(t for t in D['tranches'] if t['entitlement_id']==eid);qid=tr['credit_ledger_id'];award=next(a for a in D['awards'] if a['registration_id']==rid)
 entry=next(r for r in D['entries'] if r['tournament_id']==e['source_satellite_id'] and r['user_id']==e['user_id'] and r['operation']=='entry')
 faults={
  'admission_club':f"UPDATE chip_ledger SET club_id=gen_random_uuid() WHERE id='{aid}'",
  'admission_hash':f"UPDATE chip_ledger SET row_hash=NULL WHERE id='{aid}'",
  'admission_amount':f"UPDATE chip_ledger SET amount=amount+.01 WHERE id='{aid}'",
  'admission_state':f"UPDATE chip_ledger SET status='reversed' WHERE id='{aid}'",
  'admission_target':f"UPDATE chip_ledger SET to_entity_id=gen_random_uuid() WHERE id='{aid}'",
  'admission_user':f"UPDATE chip_ledger SET metadata=jsonb_set(metadata,'{{user_id}}',to_jsonb(gen_random_uuid()::text)) WHERE id='{aid}'",
  'unbacked':f"UPDATE chip_ledger SET metadata=jsonb_set(metadata,'{{unbacked}}','1') WHERE id='{aid}'",
  'registered_club':f"UPDATE union_pnl_inventory_events SET after_row=jsonb_set(after_row,'{{club_id}}',to_jsonb(gen_random_uuid()::text)) WHERE row_id='{rid}'",
  'award_missing':f"DELETE FROM tournament_satellite_awards WHERE registration_id='{rid}'",
  'award_duplicate':insert('tournament_satellite_awards',award),
  'award_player':f"UPDATE tournament_satellite_awards SET user_id=gen_random_uuid() WHERE registration_id='{rid}'",
  'award_payout':f"UPDATE tournament_payouts SET amount=amount+.01 WHERE id='{award['payout_id']}'",
  'settlement_target':f"UPDATE tournament_satellite_settlements SET target_id=gen_random_uuid() WHERE tournament_id='{e['source_satellite_id']}'",
  'tranche_duplicate':insert('tournament_refund_tranches',tr),
  'tranche_transaction':f"UPDATE tournament_refund_tranches SET transaction_id=(transaction_id::text::numeric+1)::text::xid8 WHERE entitlement_id='{eid}'",
  'tranche_amount':f"UPDATE tournament_refund_tranches SET amount_paid_now=amount_paid_now-.01 WHERE entitlement_id='{eid}'",
  'entitlement_duplicate':insert('tournament_refund_entitlements',e),
  'entitlement_split':f"UPDATE tournament_refund_entitlements SET refund_fee=refund_fee+.01 WHERE id='{eid}'",
  'refund_and_ticket':f"INSERT INTO tournament_tickets(id,source_refund_entitlement_id) VALUES(gen_random_uuid(),'{eid}')",
  'funding_missing':f"DELETE FROM tournament_participant_funding_receipts WHERE tournament_id='{e['source_satellite_id']}' AND user_id='{e['user_id']}'",
  # Transfer faults: the funding club must be one proven club, and the
  # receiving ledger must be the entitlement's own wallet club.
  'funding_second_club':insert('tournament_participant_funding_receipts',dict(entry,id=None,funding_club_id='2a1132b9-5ba2-42e6-9f01-30a7fcffebe3')),
  'funding_ledger_unposted':f"UPDATE chip_ledger SET status='reversed' WHERE id='{entry['ledger_id']}'",
  'receiving_ledger_club':f"UPDATE union_pnl_original_flows SET ledger_snapshot=jsonb_set(ledger_snapshot,'{{club_id}}',to_jsonb('{KINGS}'::text)) WHERE ledger_id='{qid}'",
  'refund_wallet_club':f"UPDATE tournament_refund_entitlements SET refund_wallet_club_id='{KINGS}' WHERE id='{eid}'",
 }
 digest=lambda:sql("SELECT md5(string_agg(n||':'||v,'|' ORDER BY n)) FROM ("+' UNION ALL '.join("SELECT '"+t+"' n,COALESCE(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]')::text v FROM public."+t+' x' for t in set(tables.values()))+") z")
 before_digest=digest()
 for name,mutation in faults.items():
  for _,c in readers.values():
   got=sql('BEGIN;'+mutation+';SELECT count(*) FROM '+c+f" WHERE ledger_id='{qid}' AND valid;ROLLBACK;")
   assert got=='0',(name,got)
 assert digest()==before_digest
 print('PASS',len(faults),'faults refused in both readers; all fixture data unchanged after rollback')

 # Exercise access paths and receipt semantics without LLVM-compiling each ephemeral fixture query.
 env['PGOPTIONS']='-c jit=off'
 original_rows = {name: rows(call) for name, (_, call) in readers.items()}
 migration = next((R/'supabase/migrations').glob('20261116183213_*.sql'))
 shape = json.loads(run(['node','--input-type=module','-e',
  "import {readFileSync} from 'node:fs';import {splitConcurrentPreamble} from './scripts/ci/migration-concurrent-preamble.mjs';console.log(JSON.stringify(splitConcurrentPreamble(readFileSync(process.argv[1],'utf8'))));",str(migration)]))
 assert shape['ok'] and len(shape['indexes'])==1
 sql("""INSERT INTO public.tournament_refund_entitlements(id,tournament_id,entitlement_kind)
     SELECT md5('refund-id-'||g)::uuid,md5('tournament-'||(g%1300))::uuid,'wallet_charge' FROM generate_series(1,8000) g;
     INSERT INTO public.cash_funding_application_receipts(transaction_id,refunded)
     SELECT (10000+g)::text::xid8,1 FROM generate_series(1,4000) g;
     INSERT INTO public.cash_funding_application_receipts(transaction_id,refunded) VALUES ('42222',3),('42222',7);
     ANALYZE public.tournament_refund_entitlements; ANALYZE public.cash_funding_application_receipts;""")
 window_signature=readers['window'][0]
 window_body=sql("SELECT prosrc FROM pg_proc WHERE oid='"+window_signature+"'::regprocedure")
 arguments=['p_union_id','p_start','p_end','p_window_start','p_window_end']
 for parameter,value in zip(arguments,re.findall("'([^']+)'",window)):
  window_body=re.sub(r'\b'+parameter+r'\b',"'"+value+"'::"+('uuid' if parameter=='p_union_id' else 'timestamptz'),window_body)
 def nodes(node):
  yield node
  for child in node.get('Plans',[]): yield from nodes(child)
 def receipt_plan():
  plan=json.loads(sql('EXPLAIN (FORMAT JSON) '+window_body))[0]['Plan']
  return list(nodes(plan))
 application_query="SELECT array_agg(refunded ORDER BY refunded) FROM public.cash_funding_application_receipts WHERE transaction_id='42222'::xid8"
 assert sql(application_query)=='{3,7}'
 before_plan=receipt_plan()
 assert any(n.get('Relation Name')=='tournament_refund_entitlements' and n['Node Type']=='Seq Scan' for n in before_plan)
 for index in shape['indexes']:
  run([str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h',str(sock),'-p',port,'-d','postgres'],index['statement'])
 sql(shape['body'])
 assert sql("SELECT count(*)=1 FROM pg_stats WHERE tablename='weekly_pnl_refund_entitlement_key'")=='t'
 cash_migration=next((R/'supabase/migrations').glob('*_weekly_pnl_cash_receipt_index_recovers_its_interrupted_build.sql')).read_text()
 cash_index='public.weekly_pnl_cash_application_transaction'
 client=[str(PG/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h',str(sock),'-p',port,'-d','postgres']
 # Prove the original concurrent build's VALID=false, READY=true terminal state.
 # Keep this reader's old snapshot open during repair, like the production job.
 holder=subprocess.Popen(client,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True,env=env)
 try:
  holder.stdin.write("BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT count(*) FROM public.cash_funding_application_receipts;\n")
  holder.stdin.flush()
  assert holder.stdout.readline().strip()=='4002'
  failed=subprocess.run(client+['-c','CREATE INDEX CONCURRENTLY weekly_pnl_cash_application_transaction ON public.cash_funding_application_receipts(transaction_id)'],
    text=True,capture_output=True,timeout=5,env={**env,'PGOPTIONS':'-c statement_timeout=750ms'})
  assert failed.returncode!=0 and 'statement timeout' in failed.stderr,failed
  state="SELECT indisvalid,indisready,indislive FROM pg_index WHERE indexrelid='"+cash_index+"'::regclass"
  assert sql(state)=='f|t|t'
  sql(cash_migration)
  assert sql(state)=='t|t|t'
 finally:
  holder.communicate('ROLLBACK;\n',timeout=5)
 # A valid existing index must be reused without a rebuild; a fresh database
 # must reach the same physical definition without a prior concurrent attempt.
 file_node=lambda:sql("SELECT pg_relation_filenode('"+cash_index+"'::regclass)")
 old_node=file_node();sql(cash_migration);assert file_node()==old_node
 sql("DROP INDEX "+cash_index)
 sql(cash_migration)
 assert sql(state)=='t|t|t'
 print('PASS independent expression stats, cancelled concurrent build, bounded index repair with old snapshot, valid replay and fresh install')
 after_plan=receipt_plan()
 used={n.get('Index Name') for n in after_plan}
 assert {'weekly_pnl_refund_entitlement_key','weekly_pnl_cash_application_transaction'}<=used,used
 assert {name: rows(call) for name,(_,call) in readers.items()}==original_rows
 assert sql(application_query)=='{3,7}'
 print('PASS exact full and window P&L evidence is unchanged; real bounded reader plans both original receipt indexes')

 # SQL functions reuse generic plans. Their refund proof must remain correlated
 # to this original ledger key before evaluating financial ownership.
 env['PGOPTIONS']='-c jit=off -c track_functions=all'
 generic_body=sql("SELECT prosrc FROM pg_proc WHERE oid='"+window_signature+"'::regprocedure")
 values=re.findall("'([^']+)'",window)
 for i,parameter in enumerate(arguments,1):
  generic_body=re.sub(r'\b'+parameter+r'\b','$'+str(i)+'::'+('uuid' if i==1 else 'timestamptz'),generic_body)
 owner="public.fn_union_pnl_satellite_seat_owner(uuid,uuid)"
 def executed_plan(mode):
  sql("SELECT pg_stat_reset_single_function_counters('"+owner+"'::regprocedure)")
  statement="SET plan_cache_mode="+mode+";PREPARE original_flow(uuid,timestamptz,timestamptz,timestamptz,timestamptz) AS "+generic_body.rstrip().rstrip(';')+";EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) EXECUTE original_flow("+','.join("'"+v+"'" for v in values)+");"
  plan=json.loads(sql(statement))[0]['Plan']
  calls=int(sql("SELECT coalesce((SELECT calls FROM pg_stat_user_functions WHERE funcid='"+owner+"'::regprocedure),0)"))
  scans=[n for n in nodes(plan) if n.get('Relation Name')=='tournament_refund_entitlements']
  return plan,calls,scans
 original_generic_body=generic_body
 # The complete source guard is the maintained production preimage, not a
 # substitute that grants missing owners permission in this smaller fixture.
 pin=json.loads((R/'tests/fixtures/promo-custody-inventory-pin.json').read_text())
 sql(pin['definition']+";REVOKE ALL ON FUNCTION smarter_private.original_inventory_proof_sources_match() FROM PUBLIC,anon,authenticated,service_role;REVOKE ALL ON FUNCTION "+window_signature+" FROM PUBLIC,anon,authenticated,service_role;")
 guard='smarter_private.original_inventory_proof_sources_match()'
 assert sql("SELECT md5(pg_get_functiondef('"+guard+"'::regprocedure))")==pin['md5']
 before_window=sql("SELECT pg_get_functiondef('"+window_signature+"'::regprocedure)")
 before_guard=sql("SELECT pg_get_functiondef('"+guard+"'::regprocedure)")
 metadata=lambda:sql("SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY oid)::text FROM pg_proc p WHERE oid IN('"+window_signature+"'::regprocedure,'"+guard+"'::regprocedure)")
 original_metadata=metadata()
 fix_path=R/'supabase/migrations/20261116222207_original_flow_refund_proof_keeps_its_original_key_before_own.sql'
 fix=json.loads(run(['node','--input-type=module','-e',
  "import {readFileSync} from 'node:fs';import {stalePinGuardSQL} from './scripts/ci/migration-stale-pins.mjs';const source=readFileSync(process.argv[1],'utf8');console.log(JSON.stringify(stalePinGuardSQL(process.argv[1],source,source)));",str(fix_path)]))
 def refused_fix(reason):
  result=subprocess.run(client,input='SET check_function_bodies=off;'+fix,text=True,capture_output=True,env=env,timeout=30)
  assert result.returncode and reason in result.stderr,(reason,result.stderr)
  assert sql("SELECT pg_get_functiondef('"+window_signature+"'::regprocedure)")==before_window
 sql('GRANT EXECUTE ON FUNCTION '+window_signature+' TO authenticated')
 refused_fix('original_refund_key_authority_changed')
 sql('REVOKE EXECUTE ON FUNCTION '+window_signature+' FROM authenticated')
 sql(before_guard.replace('count(*)=69','count(*)=68'))
 refused_fix('original_refund_key_preimage_changed')
 sql(before_guard)
 # Force a failure after both replacements and prove the transaction restores
 # both exact bodies and all original metadata.
 sql("""CREATE FUNCTION public.refuse_changed_inventory_guard() RETURNS event_trigger LANGUAGE plpgsql AS $failure$
 BEGIN IF md5(pg_get_functiondef('smarter_private.original_inventory_proof_sources_match()'::regprocedure))<>'"""+pin['md5']+"""' THEN RAISE EXCEPTION 'injected_after_pin_replacement'; END IF; END $failure$;
 CREATE EVENT TRIGGER refuse_changed_inventory_guard ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.refuse_changed_inventory_guard();""")
 refused_fix('injected_after_pin_replacement')
 assert sql("SELECT pg_get_functiondef('"+guard+"'::regprocedure)")==before_guard
 assert metadata()==original_metadata
 sql('DROP EVENT TRIGGER refuse_changed_inventory_guard;DROP FUNCTION public.refuse_changed_inventory_guard();')
 sql(fix)
 after_window=sql("SELECT pg_get_functiondef('"+window_signature+"'::regprocedure)")
 after_guard=sql("SELECT pg_get_functiondef('"+guard+"'::regprocedure)")
 new_hash=sql("SELECT md5(pg_get_functiondef('"+window_signature+"'::regprocedure))")
 assert after_guard==before_guard.replace('aa5e609c6fa07876d93db86d7aa3a342',new_hash),'retain every other complete guard binding'
 assert metadata()==original_metadata
 assert sql("SELECT has_function_privilege('anon','"+window_signature+"','EXECUTE') OR has_function_privilege('authenticated','"+window_signature+"','EXECUTE') OR has_function_privilege('service_role','"+window_signature+"','EXECUTE')")=='f'
 # Prove financial refusals before unrelated performance noise is introduced.
 for name,mutation in faults.items():
  for _,call in readers.values():
   assert sql('BEGIN;'+mutation+';SELECT count(*) FROM '+call+f" WHERE ledger_id='{qid}' AND valid;ROLLBACK;")=='0',name

 # The original cash reader must prove two same-key refunds as an exact
 # multiset, without assigning either receipt arbitrarily to one journal row.
 cash_fix_path=R/'supabase/migrations/20261117002644_same_transaction_cash_refunds_prove_their_exact_original_rec.sql'
 cash_fix=json.loads(run(['node','--input-type=module','-e',
  "import {readFileSync} from 'node:fs';import {stalePinGuardSQL} from './scripts/ci/migration-stale-pins.mjs';const source=readFileSync(process.argv[1],'utf8');console.log(JSON.stringify(stalePinGuardSQL(process.argv[1],source,source)));",str(cash_fix_path)]))
 full_signature=readers['full'][0]
 sql('REVOKE ALL ON FUNCTION '+full_signature+' FROM PUBLIC,anon,authenticated,service_role;')
 advance='public.fn_accounting_union_earned_plan_advance(uuid,timestamptz,timestamptz)'
 advance_fixture=json.loads((R/'scripts/ci/fixtures/rakeback-cascade-real-runner/union-close.json').read_text())['functions']['public.fn_accounting_union_earned_plan_advance(p_union_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)']
 sql(advance_fixture['def']+';REVOKE ALL ON FUNCTION '+advance+' FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION '+advance+' TO service_role;')
 assert sql("SELECT md5(pg_get_functiondef('"+advance+"'::regprocedure))")==advance_fixture['md5']=='276a23e5aaa880abab19217a33a8f69d'
 sigs=[full_signature,window_signature,advance,guard]
 cash_before={sig:sql("SELECT pg_get_functiondef('"+sig+"'::regprocedure)") for sig in sigs}
 cash_hashes={sig:sql("SELECT md5(pg_get_functiondef('"+sig+"'::regprocedure))") for sig in sigs}
 cash_metadata=sql("SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY oid)::text FROM pg_proc p WHERE oid IN("+','.join("'"+sig+"'::regprocedure" for sig in sigs)+")")
 def cash_refused(reason):
  result=subprocess.run(client,input='SET check_function_bodies=off;'+cash_fix,text=True,capture_output=True,env=env,timeout=30)
  assert result.returncode and reason in result.stderr,(reason,result.stderr)
  assert {sig:sql("SELECT pg_get_functiondef('"+sig+"'::regprocedure)") for sig in sigs}==cash_before
 sql('GRANT EXECUTE ON FUNCTION '+full_signature+' TO authenticated')
 cash_refused('cash_refund_cardinality_reader_authority_changed')
 sql('REVOKE EXECUTE ON FUNCTION '+full_signature+' FROM authenticated')
 sql("CREATE FUNCTION public.refuse_cash_pin_change() RETURNS event_trigger LANGUAGE plpgsql AS $fail$ BEGIN IF md5(pg_get_functiondef('"+guard+"'::regprocedure))<>'a37ad1912ecb20d2a5cc59e89540cbb3' THEN RAISE EXCEPTION 'injected_cash_pin_change'; END IF; END $fail$;CREATE EVENT TRIGGER refuse_cash_pin_change ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION') EXECUTE FUNCTION public.refuse_cash_pin_change();")
 cash_refused('injected_cash_pin_change')
 sql('DROP EVENT TRIGGER refuse_cash_pin_change;DROP FUNCTION public.refuse_cash_pin_change();')
 cash_fixture="""
 INSERT INTO public.cash_participant_funding_receipts(id,table_id,user_id,funding_club_id,account_type,account_entity_id,occupancy_id,pending_addon_id)
 SELECT md5('cash-refund-funding-'||g)::uuid,'0183f083-e9cc-4951-9527-c2a114266f7c','47965354-0e56-43ef-931c-ddaab82af765','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','player_wallet','47965354-0e56-43ef-931c-ddaab82af765',md5('cash-refund-seat-'||g)::uuid,md5('cash-refund-addon-'||g)::uuid FROM generate_series(1,3) g;
 INSERT INTO public.cash_funding_application_receipts(funding_receipt_id,transaction_id,refunded,original_occupancy_id,pending_addon_id)
 SELECT id,CASE WHEN id=md5('cash-refund-funding-3')::uuid THEN '654322'::xid8 ELSE '654321'::xid8 END,400,occupancy_id,pending_addon_id FROM public.cash_participant_funding_receipts WHERE table_id='0183f083-e9cc-4951-9527-c2a114266f7c';
 INSERT INTO public.union_pnl_original_flows(ledger_id,recognized_at,transaction_id,ledger_snapshot,game_scope)
 SELECT md5('cash-refund-ledger-'||g)::uuid,'2026-11-07 21:00Z',CASE WHEN g=3 THEN '654322'::xid8 ELSE '654321'::xid8 END,
 jsonb_build_object('id',md5('cash-refund-ledger-'||g),'amount',400,'status','posted','table_id','0183f083-e9cc-4951-9527-c2a114266f7c','club_id','a41434bb-8d0c-400a-8f0d-e8b3d65afed4','from_type','table_stack','from_entity_id','0183f083-e9cc-4951-9527-c2a114266f7c','to_type','player_wallet','to_entity_id','47965354-0e56-43ef-931c-ddaab82af765','category','player_funding'),
 jsonb_build_object('game_union_id','fade0000-0000-0000-0000-000000000001','asset','chips','unit_scale',2,'tournament_id',NULL) FROM generate_series(1,3) g;
 """
 def cash_rows(call):
  return sql("SELECT count(*)||':'||count(*) FILTER(WHERE valid)||':'||sum(cashouts) FROM "+call+" WHERE ledger_id IN(md5('cash-refund-ledger-1')::uuid,md5('cash-refund-ledger-2')::uuid,md5('cash-refund-ledger-3')::uuid)")
 sql(cash_fixture)
 for _,call in readers.values(): assert cash_rows(call)=='3:1:400','baseline must refuse exactly the genuine pair'
 sql(cash_fix)
 expected_guard=cash_before[guard]
 for sig in sigs[:3]:
  old_hash=cash_hashes[sig]
  new_hash=sql("SELECT md5(pg_get_functiondef('"+sig+"'::regprocedure))")
  expected_guard=expected_guard.replace(old_hash,new_hash)
 assert sql("SELECT pg_get_functiondef('"+guard+"'::regprocedure)")==expected_guard
 assert sql("SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY oid)::text FROM pg_proc p WHERE oid IN("+','.join("'"+sig+"'::regprocedure" for sig in sigs)+")")==cash_metadata
 for _,call in readers.values(): assert cash_rows(call)=='3:3:1200'
 pair="ledger_id IN(md5('cash-refund-ledger-1')::uuid,md5('cash-refund-ledger-2')::uuid)"
 cash_faults={
  'missing_journal':"DELETE FROM union_pnl_original_flows WHERE ledger_id=md5('cash-refund-ledger-1')::uuid",
  'extra_journal':"INSERT INTO union_pnl_original_flows SELECT (jsonb_populate_record(NULL::union_pnl_original_flows,to_jsonb(f)||jsonb_build_object('ledger_id',md5('cash-refund-extra')))).* FROM union_pnl_original_flows f WHERE ledger_id=md5('cash-refund-ledger-1')::uuid",
  'missing_application':"DELETE FROM cash_funding_application_receipts WHERE funding_receipt_id=md5('cash-refund-funding-1')::uuid",
  'duplicate_application':"INSERT INTO cash_funding_application_receipts SELECT * FROM cash_funding_application_receipts WHERE funding_receipt_id=md5('cash-refund-funding-1')::uuid",
  'reused_funding_identity':"UPDATE cash_funding_application_receipts SET funding_receipt_id=md5('cash-refund-funding-1')::uuid,original_occupancy_id=md5('cash-refund-seat-1')::uuid,pending_addon_id=md5('cash-refund-addon-1')::uuid WHERE funding_receipt_id=md5('cash-refund-funding-2')::uuid",
  'wrong_occupancy':"UPDATE cash_funding_application_receipts SET original_occupancy_id=gen_random_uuid() WHERE funding_receipt_id=md5('cash-refund-funding-1')::uuid",
  'wrong_addon':"UPDATE cash_funding_application_receipts SET pending_addon_id=gen_random_uuid() WHERE funding_receipt_id=md5('cash-refund-funding-1')::uuid",
  'wrong_amount':"UPDATE cash_funding_application_receipts SET refunded=399.99 WHERE funding_receipt_id=md5('cash-refund-funding-1')::uuid",
  'wrong_owner':"UPDATE cash_participant_funding_receipts SET user_id=gen_random_uuid() WHERE id=md5('cash-refund-funding-1')::uuid",
  'wrong_club':"UPDATE cash_participant_funding_receipts SET funding_club_id=gen_random_uuid() WHERE id=md5('cash-refund-funding-1')::uuid",
 }
 for name,mutation in cash_faults.items():
  for _,call in readers.values():
   assert sql('BEGIN;'+mutation+';SELECT count(*) FROM '+call+' WHERE '+pair+' AND valid;ROLLBACK;')=='0',name
 replay=subprocess.run(client,input='SET check_function_bodies=off;'+cash_fix,text=True,capture_output=True,env=env,timeout=30)
 assert replay.returncode and 'cash_refund_cardinality_guard_preimage_changed' in replay.stderr
 sql("DELETE FROM union_pnl_original_flows WHERE ledger_snapshot->>'table_id'='0183f083-e9cc-4951-9527-c2a114266f7c';DELETE FROM cash_funding_application_receipts WHERE transaction_id IN('654321'::xid8,'654322'::xid8);DELETE FROM cash_participant_funding_receipts WHERE table_id='0183f083-e9cc-4951-9527-c2a114266f7c';")
 assert {name:rows(call) for name,(_,call) in readers.items()}==original_rows
 print('PASS same-transaction cash refunds: BEFORE 2 genuine returns refused; AFTER 2x400 plus single control exact, 10 cardinality/identity faults refuse in both readers, 69 guard pins/private metadata/atomic rollback/replay retained')
 sql("""UPDATE tournament_refund_entitlements SET entitlement_kind='satellite_seat',gross=200,refund_prize=200,refund_bounty=0,refund_fee=0,
     registration_id=md5('noise-registration-'||id)::uuid,user_id='"""+e['user_id']+"""',refund_wallet_club_id='"""+FELT+"""',charge_category='satellite_seat',evidence_kind='atomic_satellite_seat'
     WHERE id IN (SELECT md5('refund-id-'||g)::uuid FROM generate_series(1,8000) g);
     INSERT INTO union_pnl_original_flows SELECT (jsonb_populate_record(NULL::union_pnl_original_flows,to_jsonb(f)||jsonb_build_object('ledger_id',md5('old-flow-'||g)::uuid,'recognized_at','2025-01-01T00:00:00Z'))).* FROM union_pnl_original_flows f CROSS JOIN generate_series(1,50000) g WHERE f.ledger_id='"""+qid+"""';
     CREATE INDEX original_flow_scope_window_fixture ON union_pnl_original_flows((game_scope->>'game_union_id'),recognized_at);
     CREATE INDEX refund_original_ledger_fixture ON tournament_refund_entitlements(source_ledger_id);
     CREATE INDEX refund_original_ticket_fixture ON tournament_refund_entitlements(source_ticket_id);
     ANALYZE tournament_refund_entitlements; ANALYZE union_pnl_original_flows;""")
 generic_body=original_generic_body
 custom_plan,custom_calls,custom_scans=executed_plan('force_custom_plan')
 generic_plan,generic_calls,generic_scans=executed_plan('force_generic_plan')
 print('GENERIC REFUND WORK',json.dumps({'custom_ownership_calls':custom_calls,'generic_ownership_calls':generic_calls,'custom_refund_rows':sum((n['Actual Rows']+n.get('Rows Removed by Filter',0))*n['Actual Loops'] for n in custom_scans),'generic_refund_rows':sum((n['Actual Rows']+n.get('Rows Removed by Filter',0))*n['Actual Loops'] for n in generic_scans)}),flush=True)
 assert any(n['Node Type']=='Seq Scan' and n.get('Alias') not in ('duplicate','duplicate_1') for n in generic_scans)
 assert generic_calls>custom_calls+8000,'baseline must actually prove unrelated entitlement owners'
 baseline_generic_calls=generic_calls
 generic_body=sql("SELECT prosrc FROM pg_proc WHERE oid='"+window_signature+"'::regprocedure")
 for i,parameter in enumerate(arguments,1):
  generic_body=re.sub(r'\b'+parameter+r'\b','$'+str(i)+'::'+('uuid' if i==1 else 'timestamptz'),generic_body)
 fixed_custom,fixed_custom_calls,fixed_custom_scans=executed_plan('force_custom_plan')
 fixed_generic,fixed_generic_calls,fixed_generic_scans=executed_plan('force_generic_plan')
 for plan in (fixed_custom,fixed_generic):
  refund=[n for n in nodes(plan) if n.get('Relation Name')=='tournament_refund_entitlements']
  assert not any(n['Node Type']=='Seq Scan' for n in refund),refund
  keyed=[n for n in refund if n.get('Index Name')=='weekly_pnl_refund_entitlement_key']
  assert keyed and all(n['Actual Rows']*n['Actual Loops']<=3 for n in keyed)
 assert fixed_generic_calls==fixed_custom_calls==custom_calls
 assert fixed_generic_calls<baseline_generic_calls
 assert {name: rows(call) for name,(_,call) in readers.items()}==original_rows
 print('PASS custom and generic actual execution',json.dumps({'ownership_calls_before':baseline_generic_calls,'ownership_calls_after':fixed_generic_calls,'generic_refund_rows_before':sum((n['Actual Rows']+n.get('Rows Removed by Filter',0))*n['Actual Loops'] for n in generic_scans),'generic_refund_rows_after':sum((n['Actual Rows']+n.get('Rows Removed by Filter',0))*n['Actual Loops'] for n in fixed_generic_scans),'financial_rows_unchanged':True,'financial_faults':len(faults),'private_metadata_preserved':True,'complete_guard_pins_preserved':True,'installer_stale_pin_guard':True,'atomic_rollback':True}))

finally:
 if started:subprocess.run([str(PG/'pg_ctl'),'-D',str(w/'data'),'-m','immediate','stop'],capture_output=True,env=env)
 shutil.rmtree(w)
