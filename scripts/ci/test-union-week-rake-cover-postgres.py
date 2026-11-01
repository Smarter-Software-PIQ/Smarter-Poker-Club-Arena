#!/usr/bin/env python3
"""Isolated PG17 qualification of the original union-week rake read and one covering index.
The report's own "rake" source aggregation (fn_union_pnl_evidence_report, before
the pnl_clubs certificate) is run through the exact production source views
before and after the ACTUAL migration. No production access; this harness owns,
stops and removes its private cluster.
"""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,tempfile,uuid
os.environ.update(LC_ALL="C",LANG="C")
p=argparse.ArgumentParser();p.add_argument('--pg-bin',type=Path,required=True);p.add_argument('--scratch',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
p.add_argument('--candidate',type=Path,required=True);p.add_argument('--rows',type=int,default=400000);a=p.parse_args()
R=Path(__file__).resolve().parents[2]
SCHEMA=(R/'scripts/ci/fixtures/union-week-rake-cover/schema.sql').read_text()
M=a.candidate.read_text();candidate_sha=hashlib.sha256(M.encode()).hexdigest()
INDEX='accounting_cash_union_week_rake_cover'
assert M.count('CREATE INDEX CONCURRENTLY IF NOT EXISTS '+INDEX)==1 and M.rstrip().endswith('COMMIT;')
body=M.split('BEGIN;',1)[1].rsplit('COMMIT;',1)[0]
U='fade0000-0000-0000-0000-000000000001';V='fade0000-0000-0000-0000-000000000002';S='2026-10-19 07:00Z';E='2026-10-26 07:00Z'
# The report's rake CTE source read, verbatim except parameters ($1 union, $2 start, $3 end).
QUERY=("SELECT s.club_id,sum(s.rake_credit) generated,sum(s.rake_credit) FILTER(WHERE s.source_type='cash_rake_accrual') cash_rake,"
 "sum(s.rake_credit) FILTER(WHERE s.source_type='tournament_fee_accrual') tournament_rake,count(*) n "
 "FROM public.accounting_payable_earning_sources s WHERE s.union_id=$1 AND s.earned_at>=$2 AND s.earned_at<$3 GROUP BY s.club_id")
O=Path(tempfile.mkdtemp(prefix='urc-',dir=a.scratch));data=O/'d';sock=Path(tempfile.mkdtemp(prefix='urs',dir='/tmp'));port='55491'
started=False;cases=[];plans={}
def call(sql):return subprocess.run([str(a.pg_bin/'psql'),'-XqAt','-h',str(sock),'-p',port,'-U','postgres','-v','ON_ERROR_STOP=1'],input=sql,capture_output=True,text=True,timeout=600)
def q(sql):
 r=call(sql);assert r.returncode==0,r.stderr[-3000:]+'\n'+r.stdout[-2000:];return r.stdout.strip()
PREP="PREPARE rake(uuid,timestamptz,timestamptz) AS "+QUERY+";"
ARGS="('"+U+"','"+S+"','"+E+"')"
def bag(name):q(PREP+"CREATE TABLE public.r_"+name+" AS EXECUTE rake"+ARGS+";")
def same(x,y):
 q("DO $$BEGIN IF EXISTS((SELECT to_jsonb(b) FROM public.r_"+x+" b EXCEPT ALL SELECT to_jsonb(c) FROM public.r_"+y+" c) UNION ALL (SELECT to_jsonb(c) FROM public.r_"+y+" c EXCEPT ALL SELECT to_jsonb(b) FROM public.r_"+x+" b)) THEN RAISE EXCEPTION 'original_rake_bag_changed';END IF;END$$;")
def plan(analyze=False):
 x=json.loads(q(PREP+"EXPLAIN(FORMAT JSON"+(",ANALYZE TRUE,BUFFERS TRUE" if analyze else "")+")EXECUTE rake"+ARGS+";"))
 def nodes(v):
  if isinstance(v,dict):
   yield v
   for z in v.values():yield from nodes(z)
  elif isinstance(v,list):
   for z in v:yield from nodes(z)
 return x,list(nodes(x))
try:
 subprocess.run([str(a.pg_bin/'initdb'),'-D',str(data),'--no-locale','-E','UTF8','-A','trust','-U','postgres'],stdout=subprocess.DEVNULL,stderr=subprocess.STDOUT,check=True)
 subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(data),'-l',str(O/'pg.log'),'-o',f"-k {sock} -p {port} -c listen_addresses='' -c fsync=off -c shared_buffers=64MB -c autovacuum=off",'-w','start'],stdout=subprocess.DEVNULL,check=True);started=True
 q("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA smarter_private;"
   "CREATE FUNCTION public.fn_platform_frozen()RETURNS boolean LANGUAGE sql AS $$SELECT false$$;"
   "CREATE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;"
   "CREATE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql AS $$SELECT 'original-inventory-245-v1:05f51b14eb6ebcb361fd88f7ba7a7343'::text$$;")
 q(SCHEMA)
 for v,h in [('accounting_payable_earning_sources','c71b1095aacf430538f9247f350dfd54'),('accounting_effective_cash_rake_sources','141fcabcfe9af1057fdb16fad212d65c'),('accounting_effective_tournament_fee_sources','0cfaf19d80c2371877064502abd15dfa')]:
  assert q("SELECT md5(pg_get_viewdef('public."+v+"'::regclass));")==h,('production view text not reproduced',v)
 cases.append('three_source_views_reproduce_production_md5')
 # The report text is pinned by the guard; natively a stand-in with the pinned md5 is impossible, so the guard's
 # report pin is exercised by substituting the expected md5 for this harness's stand-in only.
 q("CREATE FUNCTION public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;")
 stand=q("SELECT md5(pg_get_functiondef('public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)'::regprocedure));")
 Mn=M.replace("'ca8931142b7e8ad6bbac07bd0913d268'","'"+stand+"'");assert Mn!=M;bodyn=Mn.split('BEGIN;',1)[1].rsplit('COMMIT;',1)[0]
 n=a.rows
 q(f"""INSERT INTO public.ca_launch_accounting_boundaries VALUES('club','c0000000-0000-0000-0000-000000000003',gen_random_uuid(),'2026-10-21 00:00Z',now(),NULL,NULL);
 INSERT INTO public.accounting_cash_rake_sources(id,rake_record_id,player_id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract,recorded_at)
 SELECT md5('src'||g)::uuid,md5('rec'||g)::uuid,md5('pl'||(g%5000))::uuid,
  ('c0000000-0000-0000-0000-00000000000'||(1+g%4))::uuid,
  CASE WHEN g%10<8 THEN '{U}'::uuid WHEN g%10=8 THEN '{V}'::uuid END,
  CASE WHEN g%10<8 THEN '{U}'::uuid END,
  timestamptz '2026-10-12 07:00Z'+(g%(21*24*60))*interval '1 minute',
  round((g%997)/100.0,2),jsonb_build_object('tiers','[]'::jsonb,'club_id',('c0000000-0000-0000-0000-00000000000'||(1+g%4))),now()
 FROM generate_series(1,{n}) g;
 INSERT INTO public.accounting_cash_funding_contract_admissions(source_id,admitted_contract,funding_club_id,admitted_at)
  SELECT id,contract,'c0000000-0000-0000-0000-000000000009',now() FROM public.accounting_cash_rake_sources WHERE (hashtext(id::text)%97)=0;
 INSERT INTO public.accounting_cash_atomic_contract_admissions(source_id,admitted_contract,admitted_at)
  SELECT id,contract,now() FROM public.accounting_cash_rake_sources WHERE (hashtext(id::text)%89)=0;
 INSERT INTO public.accounting_tournament_fee_recognitions(tournament_id,recognized_at,status,union_id)
  SELECT md5('t'||g)::uuid,timestamptz '2026-10-20 07:00Z'+g*interval '1 hour','recognized','{U}' FROM generate_series(1,40) g;
 INSERT INTO public.accounting_tournament_fee_sources(id,rake_record_id,tournament_id,player_id,club_id,union_id,coordinator_union_id,charged_at,rake_credit,contract)
  SELECT md5('ts'||g)::uuid,md5('tr'||g)::uuid,md5('t'||(1+g%40))::uuid,md5('pl'||g)::uuid,('c0000000-0000-0000-0000-00000000000'||(1+g%4))::uuid,'{U}','{U}',
   timestamptz '2026-10-20 06:00Z',2.5,'{{}}' FROM generate_series(1,4000) g;
 INSERT INTO public.accounting_tournament_recognized_sources(source_id,tournament_id,recognized_at,disposition,rake_credit)
  SELECT s.id,s.tournament_id,r.recognized_at,CASE WHEN hashtext(s.id::text)%13=0 THEN 'refunded' ELSE 'earned' END,s.rake_credit
  FROM public.accounting_tournament_fee_sources s JOIN public.accounting_tournament_fee_recognitions r USING(tournament_id);
 VACUUM ANALYZE;""")
 bag('before');px,nodes=plan(True);plans['before']=px
 assert not any(x.get('Index Name')==INDEX for x in nodes)
 assert int(q("SELECT sum(n) FROM public.r_before;"))>0 and int(q("SELECT count(*) FROM public.r_before WHERE tournament_rake>0;"))>0
 q(Mn);cases.append('actual_migration_concurrent_index_and_exact_shape_installed')
 q("ANALYZE public.accounting_cash_rake_sources;")
 bag('after');same('before','after');px,nodes=plan(True);plans['after']=px
 cover=[x for x in nodes if x.get('Index Name')==INDEX]
 assert cover and all(x.get('Node Type')=='Index Only Scan' for x in cover),'original rake read did not use the covering Index Only Scan'
 cases.append('original_rake_bag_exact_and_unforced_covering_index_only_scan')
 # Committed changes without VACUUM: index-only access must fall back to the heap and stay exact.
 q("UPDATE public.accounting_cash_rake_sources SET rake_credit=rake_credit+1 WHERE (hashtext(id::text)%31)=0 AND union_id='"+U+"';"
   "INSERT INTO public.accounting_cash_rake_sources(id,club_id,union_id,coordinator_union_id,earned_at,rake_credit,contract) VALUES(gen_random_uuid(),'c0000000-0000-0000-0000-000000000001','"+U+"','"+U+"','2026-10-22 00:00Z',5,'{}');")
 bag('changed_with_cover')
 q("SET enable_indexonlyscan=off;"+PREP+"CREATE TABLE public.r_changed_without_cover AS EXECUTE rake"+ARGS+";")
 same('changed_without_cover','changed_with_cover')
 px,nodes=plan(True);cover=[x for x in nodes if x.get('Index Name')==INDEX and x.get('Node Type')=='Index Only Scan']
 assert cover and sum(x.get('Heap Fetches',0) for x in cover)>0,'no visibility fallback was demonstrated'
 plans['visibility_fallback']=px;cases.append('committed_changes_heap_fallback_exact')
 # The ACTUAL migration refuses wrong leftovers and changed authorities.
 for ddl,label in [('(earned_at, union_id) INCLUDE(id, club_id, rake_credit) WHERE (union_id IS NOT NULL)','wrong_key_order'),
                   ('(union_id, earned_at) INCLUDE(id, club_id) WHERE (union_id IS NOT NULL)','missing_rake_credit'),
                   ('(union_id, earned_at) INCLUDE(id, club_id, rake_credit)','missing_predicate')]:
  q("DROP INDEX public."+INDEX+";CREATE INDEX "+INDEX+" ON public.accounting_cash_rake_sources "+ddl+";")
  r=call(Mn);assert r.returncode!=0 and 'union_week_rake_cover_exact_valid_shape_required' in r.stderr,(label,r.stderr)
  cases.append('actual_migration_'+label+'_leftover_refused')
 q("DROP INDEX public."+INDEX+";");q(Mn)
 for field in ['indisvalid','indisready','indislive']:
  r=call("BEGIN;UPDATE pg_index SET "+field+"=false WHERE indexrelid='public."+INDEX+"'::regclass;"+bodyn+"ROLLBACK;")
  assert r.returncode!=0 and 'union_week_rake_cover_exact_valid_shape_required' in r.stderr,r.stderr;cases.append('catalog_'+field+'_false_refused')
 for label,change,expected in [
  ('generation_changed',"CREATE OR REPLACE FUNCTION smarter_private.original_inventory_basis_generation()RETURNS text LANGUAGE sql AS $$SELECT 'other'::text$$;",'union_week_rake_cover_original_authority_changed'),
  ('proof_sources_false',"CREATE OR REPLACE FUNCTION smarter_private.original_inventory_proof_sources_match()RETURNS boolean LANGUAGE sql AS $$SELECT false$$;",'union_week_rake_cover_original_authority_changed'),
  ('report_changed',"CREATE OR REPLACE FUNCTION public.fn_union_pnl_evidence_report(uuid,timestamptz,timestamptz)RETURNS jsonb LANGUAGE sql AS $$SELECT '{}'::jsonb$$;",'union_week_rake_cover_original_authority_changed'),
  ('view_changed',"CREATE OR REPLACE VIEW public.accounting_effective_tournament_fee_sources AS SELECT * FROM public.accounting_effective_tournament_fee_sources;",None),
  ('frozen',"CREATE OR REPLACE FUNCTION public.fn_platform_frozen()RETURNS boolean LANGUAGE sql AS $$SELECT true$$;",'union_week_rake_cover_operator_or_freeze_refused'),
  ('jwt_present',"SET LOCAL request.jwt.claims='{\"role\":\"x\"}';",'union_week_rake_cover_operator_or_freeze_refused')]:
  if expected is None:continue
  r=call("BEGIN;"+change+bodyn+"ROLLBACK;");assert r.returncode!=0 and expected in r.stderr,(label,r.stderr);cases.append('actual_migration_'+label+'_refused')
 r=call("BEGIN;CREATE OR REPLACE VIEW public.accounting_effective_tournament_fee_sources AS "+open(R/'scripts/ci/fixtures/union-week-rake-cover/schema.sql').read().split('CREATE VIEW public.accounting_effective_tournament_fee_sources AS',1)[1].split('CREATE VIEW',1)[0].rstrip().rstrip(';').replace('s.recorded_at, a.admitted_at)','a.admitted_at, s.recorded_at)')+";"+bodyn+"ROLLBACK;")
 assert r.returncode!=0 and 'union_week_rake_cover_original_authority_changed' in r.stderr,r.stderr;cases.append('actual_migration_view_changed_refused')
 counts=json.loads(q("SELECT jsonb_build_object('clubs',(SELECT count(*) FROM public.r_after),'sources',(SELECT sum(n) FROM public.r_after),'tournament_clubs',(SELECT count(*) FROM public.r_after WHERE tournament_rake>0));"))
 out={'passed':True,'native_only_not_production_capacity_proof':True,'candidate':str(a.candidate),'candidate_sha256':candidate_sha,'rows_seeded':n,'counts':counts,'cases':cases,'plans':plans,
  'limitation':'Native plans prove an isolated, unforced covering access path and exact results; production speed is verified after installation on the original close.'}
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(out,indent=1)+'\n');print(json.dumps({'passed':True,'cases':len(cases),'counts':counts}))
finally:
 if started:subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],stdout=subprocess.DEVNULL)
 shutil.rmtree(O,ignore_errors=True);shutil.rmtree(sock,ignore_errors=True)
