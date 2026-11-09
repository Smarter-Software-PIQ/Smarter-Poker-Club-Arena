#!/usr/bin/env python3
"""PG17 scope-plan ordering: the 2026-11-09 ready-at-four miss (an
earlier-period backlog scope prepared ahead of the due union week) fails
before the repair and the union's weeks lead the plan after it, with every
scope's own weeks kept oldest-first. Actual captured production function;
no production writes."""
import argparse,base64,json,os,shutil,socket,subprocess,tempfile
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--pg-bin',type=Path,required=True);p.add_argument('--scratch-root',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
r=Path(__file__).resolve().parents[2]; f=Path(__file__).parent/'fixtures/union-prepares-first'
m=r/'supabase/migrations/20261109143736_the_due_union_week_prepares_and_pays_first.sql'
PRE='1546f676967f07f809050b210e006a65';POST='ec30840469438a995d15dbbbefafefb0'
e={k:v for k,v in os.environ.items() if not k.startswith('PG')};e['TMPDIR']=str(a.scratch_root)
w=Path(tempfile.mkdtemp(prefix='prep-order-',dir=a.scratch_root));d=w/'data';started=False
with socket.socket() as s:s.bind(('127.0.0.1',0));port=str(s.getsockname()[1])
def cmd(args):return subprocess.run(list(map(str,args)),env=e,text=True,capture_output=True,check=True)
def q(s,ok=True):
 z=subprocess.run([str(a.pg_bin/'psql'),'-XqAt','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres'],input=s,env=e,text=True,capture_output=True)
 if ok and z.returncode:raise RuntimeError(z.stderr)
 return z
def fn_md5():return q("SELECT md5(pg_get_functiondef('smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure));").stdout.strip()
def plan():return json.loads(q("SELECT smarter_private.weekly_payout_scope_plan('2026-11-09 08:00Z','2026-11-09 08:20Z');").stdout.strip())
def seed(union_first_week):
 q(f"""TRUNCATE smarter_private.eligible_scopes_stub;
INSERT INTO smarter_private.eligible_scopes_stub VALUES
 ('club', md5('backlog-club')::uuid, '2026-10-26 08:00Z'),
 ('union', md5('midway-union')::uuid, '{union_first_week}');""")
cases=[]
try:
 assert '17.' in cmd([a.pg_bin/'postgres','--version']).stdout
 cmd([a.pg_bin/'initdb','-D',d,'-U','postgres','-A','trust','--no-locale'])
 cmd([a.pg_bin/'pg_ctl','-D',d,'-l',w/'log','-w','start','-o',f"-k '' -h 127.0.0.1 -p {port} -c fsync=off -c full_page_writes=off -c wal_level=minimal -c max_wal_senders=0"]);started=True
 q((f/'schema.sql').read_text())
 body=base64.b64decode((f/'actual-function.b64').read_text()).decode()
 q('SET check_function_bodies=off;'+body)
 assert fn_md5()==PRE,'captured fixture drifted from the pinned preimage'
 metadata="SELECT jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'security',prosecdef,'volatile',provolatile)::text FROM pg_proc WHERE oid='smarter_private.weekly_payout_scope_plan(timestamptz,timestamptz)'::regprocedure;"
 original_metadata=q(metadata).stdout.strip()
 # 1. The demonstrated defect: the backlog scope's earlier week leads the
 #    plan and the due union week waits behind it (union-first only applied
 #    within one period_start).
 seed('2026-11-02 08:00Z');pl=plan()
 assert [(x['kind'],x['period_start'][:10]) for x in pl]==[('club','2026-10-26'),('union','2026-11-02'),('club','2026-11-02')],pl
 cases.append({'case':'preimage-backlog-starves-the-due-union-week','order':[x['kind'] for x in pl],'passed':True})
 # 2. The repair installs on its exact preimage and never replays.
 q(m.read_text());assert fn_md5()==POST,'postimage md5'
 z=q(m.read_text(),False);assert z.returncode and 'scope_plan_preimage_changed' in z.stderr,'replay refused'
 cases.append({'case':'repair-installs-once-and-never-replays','passed':True})
 # 3. The union's week leads; the backlog keeps its own oldest-first order.
 pl=plan()
 assert [x['kind'] for x in pl]==['union','club','club'],pl
 assert pl[1]['period_start'].startswith('2026-10-26') and pl[2]['period_start'].startswith('2026-11-02'),pl
 cases.append({'case':'due-union-week-leads-and-backlog-stays-oldest-first','order':[(x['kind'],x['period_start'][:10]) for x in pl],'passed':True})
 # 4. A union owing two weeks still pays its own older week first.
 seed('2026-10-26 08:00Z');pl=plan()
 assert [(x['kind'],x['period_start'][:10]) for x in pl]==[('union','2026-10-26'),('union','2026-11-02'),('club','2026-10-26'),('club','2026-11-02')],pl
 cases.append({'case':'union-own-weeks-stay-oldest-first','passed':True})
 # 5. Settled weeks still leave the plan; the set is unchanged by ordering.
 q("INSERT INTO smarter_private.weekly_payout_financial_receipts VALUES('club',md5('backlog-club')::uuid,'2026-10-26 08:00Z','2026-11-02 08:00Z');")
 pl=plan()
 assert [(x['kind'],x['period_start'][:10]) for x in pl]==[('union','2026-10-26'),('union','2026-11-02'),('club','2026-11-02')],pl
 cases.append({'case':'receipted-week-leaves-the-plan','passed':True})
 # 6. The function's authority surface is exactly what it was.
 assert q(metadata).stdout.strip()==original_metadata,'metadata changed'
 cases.append({'case':'owner-acl-security-unchanged','passed':True})
 a.output.write_text(json.dumps({'passed':True,'cases':cases,'postimage':fn_md5(),'limits':'Actual captured scope-plan function over stubbed eligibility inputs; ordering only. No production writes.'},indent=2)+'\n');print('passed',len(cases),'cases; postimage',fn_md5())
finally:
 if started:subprocess.run([str(a.pg_bin/'pg_ctl'),'-D',str(d),'-m','immediate','stop'],env=e,capture_output=True)
 shutil.rmtree(w)
