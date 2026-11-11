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
finally:
 if started:subprocess.run([str(PG/'pg_ctl'),'-D',str(w/'data'),'-m','immediate','stop'],capture_output=True,env=env)
 shutil.rmtree(w)
