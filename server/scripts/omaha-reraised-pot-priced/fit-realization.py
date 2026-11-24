import json,sys,numpy as np
H=3.0; C=0.45
rows=[]
for f in sys.argv[1:]:
    name=f.split('/')[-1]; seats=int(name.split('-')[1]); stack=int(name.split('-')[2].split('.')[0])
    for l in open(f):
        r=json.loads(l)
        if 'flop' not in r or 'share' not in r['flop']: continue
        fl=r['flop']; P=fl['pot']; seers=fl['seers']; n=len(seers)
        if P<=0: continue
        D=r['dealer']; key=lambda i:(i-D)%seats  # seatIdx i is seat i+1; order (seat-dealer) mod seats, dealer last
        last=max(seers,key=key)
        raisers=[a[0] for a in r['pre'] if a[1] in('raise','bet') or (a[1]=='all_in' and a[3]<a[2])]
        lastr=raisers[-1] if raisers else -1
        behind={i:stack*2-fl['pre'][k] for k,i in enumerate(seers)}
        for k,i in enumerate(seers):
            others=[behind[j] for j in seers if j!=i]
            spr=max(0,min(behind[i],max(others)))/P
            if spr<=1e-9: continue
            rows.append((f,n,i==last,i==lastr,fl['eq'][k],P,r['net'][i]+fl['pre'][k],fl['share'][k],spr))
A=np.array([[x[1],x[2],x[3],x[4],x[5],x[6],x[7],x[8]] for x in rows],dtype=float)
n,ip,agg,eq,P,y,sh,spr=A.T
x=eq*P; Z=(sh-eq)*P
# control variate beta
beta=((y-y.mean())*(Z-Z.mean())).sum()/((Z-Z.mean())**2).sum()
ya=y-beta*Z
print('rows',len(rows),'beta',round(beta,3),'var reduction',round(1-ya.var()/y.var(),3))
d=spr/(spr+H)
cols=[]; names=[]
for role,rm in (('caller',agg==0),('agg',agg==1)):
    for side,sm in (('ip',ip==1),('oop',ip==0)):
        m=(rm&sm).astype(float)
        cols.append(-x*d*m); names.append(f'depth_{role}_{side}')
        cols.append(x*(eq-C)*d*m); names.append(f'eqslope_{role}_{side}')
cols.append(-x*(n-2)*np.minimum(1,spr)); names.append('extraPlayer')
X=np.array(cols).T; t=ya-x; w=1/P**2
Xw=X*np.sqrt(w)[:,None]; tw=t*np.sqrt(w)
coef,*_=np.linalg.lstsq(Xw,tw,rcond=None)
res=tw-Xw@coef; s2=(res**2).sum()/(len(tw)-len(coef))
cov=s2*np.linalg.inv(Xw.T@Xw)
for nm,c,se in zip(names,coef,np.sqrt(np.diag(cov))): print(f'{nm:22s} {c:7.3f}  SE {se:.3f}')
# bucket check
def ratio(m):
    return int(m.sum()), round(ya[m].sum()/x[m].sum(),3), round(np.sqrt(((ya[m]-ya[m].sum()/x[m].sum()*x[m])**2).sum())/x[m].sum(),3)
for role in (0,1):
  for side in (1,0):
    for lo,hi in ((0,1.5),(1.5,4),(4,8),(8,99)):
      for nn in ((2,),(3,4,5,6)):
        m=(agg==role)&(ip==side)&(spr>=lo)&(spr<hi)&np.isin(n,nn)
        if m.sum()>=30: print('agg' if role else 'caller','ip' if side else 'oop',(lo,hi),'n',nn[0] if len(nn)==1 else '3+',ratio(m))
