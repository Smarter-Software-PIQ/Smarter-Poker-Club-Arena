#!/usr/bin/env python3
"""PG17: the weekly cascade funding plan counts every chip once.

Isolated proof of the candidate pure plan in
scripts/ci/fixtures/rakeback-cascade/funding-plan.sql. Each case fixes a
hierarchy on 100.00 of gross rake where the union keeps 10.00 and the club
receives 90.00, with own amounts computed here, independently, by the written
rate basis (chip standard P4: a tier's rate applies to the rake remaining after
the tiers below it). No stage, wallet or production access.
"""
import argparse, json, os, shutil, socket, subprocess, tempfile
from decimal import Decimal as D, ROUND_HALF_UP
from pathlib import Path
import uuid

P=argparse.ArgumentParser()
P.add_argument('--pg-bin',type=Path,default=Path(os.environ.get('PG_BIN','/usr/lib/postgresql/17/bin')))
P.add_argument('--scratch',type=Path,default=Path(os.environ.get('RUNNER_TEMP',tempfile.gettempdir())))
P.add_argument('--output',type=Path,default=None)
A=P.parse_args()
R=Path(__file__).resolve().parents[2]; SRC=R/'scripts/ci/fixtures/rakeback-cascade/funding-plan.sql'
E={k:v for k,v in os.environ.items() if not k.startswith('PG')};E.update(LC_ALL='C',LANG='C',PGTZ='UTC')
A.scratch.mkdir(parents=True,exist_ok=True)
W=Path(tempfile.mkdtemp(prefix='cascade-plan-',dir=A.scratch));DATA=W/'data';started=False;results=[]
with socket.socket() as sk: sk.bind(('127.0.0.1',0)); port=str(sk.getsockname()[1])
def cmd(a): return subprocess.run(list(map(str,a)),env=E,text=True,capture_output=True,check=True,timeout=120)
def q(sql,check=True):
    r=subprocess.run([str(A.pg_bin/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-h','127.0.0.1','-p',port,'-d','postgres'],env=E,text=True,input=sql,capture_output=True,timeout=120)
    if check and r.returncode: raise RuntimeError(r.stderr[-4000:])
    return r
def u(name): return str(uuid.uuid5(uuid.NAMESPACE_DNS,'cascade.'+name))
def c2(x): return D(str(x)).quantize(D('0.01'),rounding=ROUND_HALF_UP)
def tiers(rake,rates):
    """Independent remaining-rake tiers, direct agent first: [(name,rate)] -> {name: own}."""
    rem=D(str(rake)); out={}
    for name,rate in rates:
        amt=c2(rem*D(str(rate))); out[name]=amt; rem-=amt
    return out
def plan(club,chain,players,distributable=90):
    """chain: [(agent,rate)] direct first; players: [(player,payer|None,rate,rake)]."""
    own={}
    nodes=[];obl=[]
    names=[n for n,_ in chain]
    for player,payer,rate,rake in players:
        t=tiers(rake,chain if payer in names else [])
        for n,a in t.items(): own[n]=own.get(n,D(0))+a
        covered=t.get(payer,D(0)) if payer else D(0)
        obl.append({'club_id':u(club),'payer_user_id':u(payer) if payer else None,'player_id':u(player),'owed':str(c2(D(str(rake))*D(str(rate)))),'covered':str(covered)})
    for i,(n,_) in enumerate(chain):
        nodes.append({'club_id':u(club),'user_id':u(n),'parent_user_id':u(chain[i+1][0]) if i+1<len(chain) else None,'own_amount':str(own.get(n,D(0)))})
    return nodes,obl,[{'club_id':u(club),'distributable':str(c2(distributable))}]
def run(nodes,obl,clubs,check=True):
    r=q("SELECT smarter_private.rakeback_cascade_funding_plan($j$%s$j$::jsonb,$j$%s$j$::jsonb,$j$%s$j$::jsonb)::text;"%(json.dumps(nodes),json.dumps(obl),json.dumps(clubs)),check)
    return json.loads(r.stdout) if r.returncode==0 else r
def edge(p,payer,payee):
    for e in p['edges']:
        if e['payer_user_id']==(u(payer) if payer else None) and e['payee_user_id']==u(payee): return D(str(e['amount']))
    return None
def node(p,name):
    return next(n for n in p['nodes'] if n['user_id']==u(name))
def ok(name,cond,detail=None):
    assert cond,(name,detail); results.append({'case':name,'passed':True}); print('PASS',name,flush=True)
def refused(name,args,needle):
    r=run(*args,check=False)
    assert not isinstance(r,dict) and needle in r.stderr,(name,getattr(r,'stderr',r)); results.append({'case':name,'passed':True,'expected_refusal':needle}); print('PASS',name,flush=True)
def whole(name,p,union=D(10),rake=D(100)):
    c=p['clubs'][0]
    total=union+D(str(c['club_keeps']))+D(str(c['retained_total']))+D(str(c['players_total']))
    assert total==rake,(name,'each chip once',total)
try:
    assert '17.' in cmd([A.pg_bin/'postgres','--version']).stdout,'PostgreSQL 17 required'
    cmd([A.pg_bin/'initdb','-D',DATA,'-U','postgres','-A','trust','--no-locale','-E','UTF8'])
    cmd([A.pg_bin/'pg_ctl','-D',DATA,'-l',W/'server.log','-w','start','-o',f"-k '' -p {port} -h 127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off"]);started=True
    q('CREATE SCHEMA smarter_private;'); q(SRC.read_text())

    p=run(*plan('a',[],[('p',None,.10,100)])); whole('A',p)
    ok('A unassigned player is paid by the club bank and no wallet is funded',p['edges']==[] and D(str(p['clubs'][0]['direct_player_outflow']))==10 and D(str(p['clubs'][0]['club_keeps']))==80,p)

    p=run(*plan('b',[],[('horse','owner',.70,100)])); whole('B',p)
    ok('B owner upline: club funds the owner wallet 70, owner pays 70 and keeps 0',edge(p,None,'owner')==70 and D(str(node(p,'owner')['retained']))==0 and D(str(node(p,'owner')['passthrough']))==70 and D(str(p['clubs'][0]['club_keeps']))==20,p)

    p=run(*plan('c',[('agent',.60)],[('p','agent',.50,100)])); whole('C',p)
    ok('C one agent: funded its own 60 once, pays 50, keeps 10, nothing added on top',edge(p,None,'agent')==60 and D(str(node(p,'agent')['passthrough']))==0 and D(str(node(p,'agent')['retained']))==10 and D(str(p['clubs'][0]['club_keeps']))==30,p)

    p=run(*plan('d',[('agent',.30),('super',.70)],[('p','agent',.20,100)])); whole('D',p)
    ok('D two tiers: club funds super 79, super passes 30, keeps 49; agent keeps 10',edge(p,None,'super')==79 and edge(p,'super','agent')==30 and D(str(node(p,'super')['retained']))==49 and D(str(node(p,'agent')['retained']))==10 and D(str(p['clubs'][0]['club_keeps']))==11,p)

    p=run(*plan('e',[('sub',.40),('agent',.50),('super',.50)],[('p','sub',.30,100)])); whole('E',p)
    ok('E three tiers: 85 in, 70 then 40 passed down, 15/30/10 retained',edge(p,None,'super')==85 and edge(p,'super','agent')==70 and edge(p,'agent','sub')==40 and [D(str(node(p,n)['retained'])) for n in('super','agent','sub')]==[15,30,10] and D(str(p['clubs'][0]['club_keeps']))==5,p)

    p=run(*plan('f',[('agent',0)],[('p','agent',.70,100)])); whole('F',p)
    ok('F zero-percent top agent: 70 passes through, agent keeps 0',edge(p,None,'agent')==70 and D(str(node(p,'agent')['retained']))==0 and p['clubs'][0]['affordable'] is True,p)

    p=run(*plan('g',[('agent',0),('super',.20)],[('p','agent',.70,100)])); whole('G',p)
    ok('G zero-percent agent under a super: club 90, super keeps 20, exactly affordable',edge(p,None,'super')==90 and edge(p,'super','agent')==70 and D(str(node(p,'super')['retained']))==20 and D(str(node(p,'agent')['retained']))==0 and p['clubs'][0]['affordable'] is True and D(str(p['clubs'][0]['from_reserves']))==0,p)

    p=run(*plan('h',[('agent',0),('super',.30)],[('p','agent',.70,100)])); whole('H',p)
    ok('H a chain at exactly 100% of gross rake exceeds the 90 the club received',D(str(p['clubs'][0]['total_outflow']))==100 and p['clubs'][0]['affordable'] is False and D(str(p['clubs'][0]['from_reserves']))==10,p)

    n,o,c=plan('i',[('agent',.60)],[('covered','agent',.50,100),('deal','agent',.70,100)],distributable=180)
    p=run(n,o,c)
    ok('I no netting: the margin on a covered player is kept, only the uncovered 10 passes through',D(str(node(p,'agent')['own']))==120 and D(str(node(p,'agent')['passthrough']))==10 and edge(p,None,'agent')==130 and D(str(node(p,'agent')['retained']))==10,p)

    chain=[('l1',.10),('l2',.10),('l3',.10),('l4',.10),('l5',.10)]
    p=run(*plan('j',chain,[('p','l1',0,100)]))
    t=tiers(100,chain); want=sum(t.values())
    ok('J five levels: one edge per recipient, each parent passes exactly its subtree',len(p['edges'])==5 and edge(p,None,'l5')==want and edge(p,'l5','l4')==want-t['l5'] and edge(p,'l2','l1')==t['l1'] and all(D(str(node(p,k)['retained']))==v for k,v in t.items()),p)

    n1,o1,c1=plan('k1',[('same',.50)],[('p1','same',.40,100)]);n2,o2,c2_=plan('k2',[('same',.20)],[('p2','same',.10,100)])
    p=run(n1+n2,o1+o2,c1+c2_)
    ok('K one user as agent in two clubs: no cross-club leakage',sorted(D(str(e['amount'])) for e in p['edges'])==[20,50] and [D(str(c['total_outflow'])) for c in p['clubs']] in ([50,20],[20,50]),p)

    n,o,c=plan('r',[('agent',.33)],[('p','agent',.20,0.65)],distributable=0.59)
    p=run(n,o,c)
    ok('L odd cents: own 0.21, owed 0.13, retained 0.08',D(str(node(p,'agent')['own']))==D('0.21') and D(str(node(p,'agent')['retained']))==D('0.08') and edge(p,None,'agent')==D('0.21'),p)

    n,o,c=plan('d',[('agent',.30),('super',.70)],[('p','agent',.20,100)])
    a=q("SELECT md5(smarter_private.rakeback_cascade_funding_plan($j$%s$j$::jsonb,$j$%s$j$::jsonb,$j$%s$j$::jsonb)::text);"%(json.dumps(n),json.dumps(o),json.dumps(c))).stdout
    b=q("SELECT md5(smarter_private.rakeback_cascade_funding_plan($j$%s$j$::jsonb,$j$%s$j$::jsonb,$j$%s$j$::jsonb)::text);"%(json.dumps(list(reversed(n))),json.dumps(o),json.dumps(c))).stdout
    ok('M the same book in any input order gives the identical plan',a==b and len(a.strip())==32)

    n,o,c=plan('x',[('a',.3),('b',.3)],[('p','a',.1,100)]); n[1]['parent_user_id']=u('a')
    refused('N a hierarchy cycle is refused',(n,o,c),'cascade_hierarchy_cycle')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)]); n[0]['parent_user_id']=u('elsewhere')
    refused('O a parent outside the club is refused',(n,o,c),'cascade_parent_outside_club_or_missing')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)])
    refused('P a recipient listed twice is refused',(n+n,o,c),'cascade_duplicate_recipient')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)]); o[0]['covered']='31.00'
    refused('Q covered above the payer own commission is refused (double count guard)',(n,o,c),'cascade_covered_exceeds_own_commission')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)]); o[0]['owed']='10.005'
    refused('R a fraction of a cent is refused',(n,o,c),'cascade_plan_amount_invalid')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)]); n[0]['own_amount']='-1.00'
    refused('S a negative amount is refused',(n,o,c),'cascade_plan_amount_invalid')
    n,o,c=plan('x',[('a',.3)],[('p','a',.1,100)])
    refused('T a club with no distributable figure is refused, never assumed',(n,o,[]),'cascade_club_distributable_missing')
    n,o,c=plan('x',[],[('p',None,.1,100)]); o[0]['covered']='1.00'
    refused('U an unassigned player cannot carry covered commission',(n,o,c),'cascade_plan_amount_invalid')
    out={'status':'passed','cases':len(results),'results':results,'pg':cmd([A.pg_bin/'postgres','--version']).stdout.strip(),
         'limits':'Pure plan only. The stages, wallets, ledger legs, receipts and certificates are not executed here.'}
    if A.output: A.output.write_text(json.dumps(out,indent=1))
    print(json.dumps({'status':'passed','cases':len(results)}))
finally:
    if started: subprocess.run([str(A.pg_bin/'pg_ctl'),'-D',str(DATA),'-m','immediate','-w','stop'],env=E,capture_output=True)
    shutil.rmtree(W,ignore_errors=True)
