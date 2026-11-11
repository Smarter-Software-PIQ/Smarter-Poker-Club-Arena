# Cases for test-rakeback-cascade-real-runner-postgres.py (exec'd by the harness).
# ---------------------------------------------------------------- the board
D2=lambda x: round(float(x),2)
# Agreements are made on 2026-11-01 (before the week); hands are earned inside the week.
clock('2026-11-01 12:00:00+00')
q("""SELECT rr.onion('U',0);
SELECT rr.club('O'); SELECT rr.club('W'); SELECT rr.club('T');
-- O: the owner is the recorded upline of two players and HAS an active agents row (0.20, as three production clubs do).
SELECT rr.owner_agent('O',0.20); SELECT rr.member('O','OP1','O.owner',0.30); SELECT rr.member('O','OP2','O.owner',0.25);
-- W: the owner is the recorded upline of two players and has NO agents row (the funding step must create wallet_only).
SELECT rr.member('W','WP1','W.owner',0.30); SELECT rr.member('W','WP2','W.owner',0.25);
-- T: SA -> AG -> SUB. SA and AG earn commission; the bottom agent SUB earns none and owes its player 50 percent, so
-- its whole need must pass down bank -> SA -> AG -> SUB. (The real calculator caps a player's deal at the direct
-- agent's commission rate minus 0.10 whenever that rate is above zero, so a need can only sit under a zero-percent
-- payer.) TN has no upline at all and stays on the club-bank route.
SELECT rr.agent('T','SA',NULL,0.30,'super_agent'); SELECT rr.agent('T','AG','SA',0.20,'agent'); SELECT rr.agent('T','SUB','AG',0,'sub_agent');
SELECT rr.member('T','TP','SUB',0.50); SELECT rr.member('T','TR','AG',0.20); SELECT rr.member('T','TQ','SA',0.10); SELECT rr.member('T','TN',NULL,0.05);
""")
HANDS=[('O','OP1',100,'2026-11-10 03:10:00+00'),('O','OP2',80,'2026-11-11 05:20:00+00'),
       ('W','WP1',60,'2026-11-10 09:40:00+00'),('W','WP1',40,'2026-11-13 11:50:00+00'),('W','WP2',50,'2026-11-14 13:00:00+00'),
       ('T','TP',70,'2026-11-09 15:10:00+00'),('T','TP',30,'2026-11-15 17:20:00+00'),('T','TR',50,'2026-11-12 19:30:00+00'),('T','TQ',60,'2026-11-16 01:40:00+00'),('T','TN',200,'2026-11-12 07:30:00+00')]
clock('2026-11-16 07:00:00+00')
for c,p,rake,at in HANDS: q(f"SELECT rr.hand('{c}','{p}',{rake},'{at}');")
case('the real earning producer accrued every seeded hand (sources, contracts, commissions, recompute requests)',
  ok("(SELECT count(*) FROM public.accounting_cash_rake_sources)=10 AND (SELECT sum(rake_credit) FROM public.accounting_cash_rake_sources)=740","ten sources, 740.00 of rake")
  +ok("(SELECT round(sum(amount),2) FROM public.agent_commissions) IS NOT NULL ","commission accrued")
  +ok("(SELECT count(*) FROM public.agents a JOIN public.clubs c ON c.id=a.club_id AND c.owner_id=a.user_id)=1 AND rr.wallet('W','W.owner') IS NULL","only club O's owner has an agents row before the run"))
if A.stop_after=='seed': raise SystemExit(0)
# ---------------------------------------------------------------- Monday 2026-11-16, minute by minute
def minute(h,m): return f"2026-11-16 {h:02d}:{m:02d}:20+00"
SHARDS=['weekly-prep-shard-0','weekly-prep-shard-1','weekly-prep-shard-2','weekly-prep-shard-3']
RUNNER='weekly-payout-rounds'
def stage(r):
    try: return (json.loads(r['out']) or {}).get('stage') if r['out'] else None
    except Exception: return 'UNPARSED'
def all_jobs(h,m):
    """One cron minute: the four preparation shards, then the runner (the order is not significant; each is its own connection)."""
    out=[tick(s,minute(h,m)) for s in SHARDS]; out.append(tick(RUNNER,minute(h,m))); return out
# 08:00Z the week closes. The runner fires every minute and must do nothing before 10:00Z.
first=all_jobs(8,0)
# FINDING P1 (production, not the cascade): the preparation shard cannot record a unit. `UPDATE ... SET units=units+1`
# names both its own variable and the column, so every run that prepares a unit raises and its unit rolls back.
assert all(r['rc']!=0 and 'column reference "units" is ambiguous' in r['err'] for r in first[:4]),('expected production\'s own shard failure',first[:4])
assert one("SELECT count(*) FROM public.accounting_close_partials")=='0' and one("SELECT count(*) FROM smarter_private.own_agent_clean_windows")=='0'
case('P1: production weekly_prep_shard fails on its first unit exactly as cron.job_run_details shows for 2026-11-09 (column reference "units" is ambiguous) and prepares nothing')
# THE FIX, not a stand-in: migration 20261110053814 installed whole from disk on the production preimage it pins.
SHARD_SIG='smarter_private.weekly_prep_shard(IN p_shard integer, IN p_shards integer)'
assert sigs()[SHARD_SIG]=='c2188f253dab440846951fe852f44584'
acl_before=one("SELECT proowner::text||' '||COALESCE(proacl::text,'default') FROM pg_proc WHERE oid='smarter_private.weekly_prep_shard(integer,integer)'::regprocedure")
q(MIG_P.read_text())
assert sigs()[SHARD_SIG]=='bb29caec19261452661e3c6c4ec3bbba',sigs()[SHARD_SIG]
assert one("SELECT proowner::text||' '||COALESCE(proacl::text,'default') FROM pg_proc WHERE oid='smarter_private.weekly_prep_shard(integer,integer)'::regprocedure")==acl_before
assert one("SELECT "+re.search(r'^-- @live-proof: (.*)$',MIG_P.read_text(),re.M).group(1))=='t'
again=q(MIG_P.read_text(),check=False)
assert again.returncode!=0 and 'weekly_prep_shard_units_preimage_changed' in again.stderr and sigs()[SHARD_SIG]=='bb29caec19261452661e3c6c4ec3bbba',again.stderr[-600:]
assert changed()==sorted(MIGRATED+['smarter_private.weekly_prep_shard']),changed()
case('P1 fix: migration 20261110053814 installs whole on the production preimage, replaces only weekly_prep_shard (postimage md5 bb29caec, owner and ACL unchanged, its live proof true) and refuses a second install')
pre=[first,all_jobs(8,1),all_jobs(9,29)]
ready=tick('weekly-payout-readiness-0330',minute(9,30))
pre.append(all_jobs(9,59))

# ---------------------------------------------------------------- before the payout time
NOLEGS="(SELECT count(*) FROM public.chip_ledger WHERE from_type<>'system_mint')=0"
assert all(r['rc']==0 for g in pre[1:] for r in g) and ready['rc']==0,[r for g in pre[1:] for r in g if r['rc']!=0]
assert all(g[-1]['out']=='' for g in pre),'the runner answered before its Monday payout time'
case('with the one-reference repair the real preparation job prepares the week (8 certificates, clean windows, earned plan, round 2 and 3 windows) and before 10:00Z every runner tick returns NULL and moves nothing',
  ok(NOLEGS,"no money moved before the payout time")
  +ok("(SELECT count(*) FROM public.accounting_rakeback_period_calculations)=8 AND (SELECT sum(rakeback_amount) FROM public.accounting_rakeback_period_calculations)=131.50","the real calculator wrote 8 certificates, 131.50")
  +ok("(SELECT count(*) FROM public.accounting_rakeback_period_calculations WHERE club_id=rr.u('W') AND payer_kind='club' AND payer_user_id IS NULL)=2 AND (SELECT count(*) FROM public.accounting_rakeback_period_calculations WHERE club_id=rr.u('O') AND payer_kind='agent' AND payer_user_id=rr.u('O.owner'))=2 AND (SELECT count(*) FROM public.accounting_rakeback_period_calculations WHERE club_id=rr.u('T') AND payer_kind='club')=1","W owner-upline deals are certified payer club with no tier, O's on the owner's agent row, T's unassigned player on the club")
  +ok("NOT EXISTS(SELECT 1 FROM public.weekly_accounting_payout_pauses)","no run is booked before the payout time"))
if A.stop_after=='prep': raise SystemExit(0)
# ---------------------------------------------------------------- 10:00Z onwards: one runner tick per minute
# ONE TRANSFER PER EDGE AND THE RESERVE (20261111132447). Two interruptions are armed: round 2 is killed at its
# last leg (AG -> SUB, a funding-only leg), and round 3 is killed at a player leg after it has paid others. Each
# killed unit must leave nothing behind, and the next tick must pay once.
INTERRUPT_FN="CREATE FUNCTION rr.interrupt() RETURNS trigger LANGUAGE plpgsql AS $i$BEGIN RAISE EXCEPTION 'lane_i_interrupted: %',TG_ARGV[0];END$i$;"
def arm(when,why): return INTERRUPT_FN+f"CREATE TRIGGER zz_lane_i_interrupt AFTER INSERT ON public.chip_ledger FOR EACH ROW WHEN ({when}) EXECUTE FUNCTION rr.interrupt('{why}');"
DISARM="DROP TRIGGER zz_lane_i_interrupt ON public.chip_ledger;DROP FUNCTION rr.interrupt();"
RESERVES="(SELECT count(*)||':'||COALESCE(sum(remaining),0)||':'||COALESCE(sum(reserved),0) FROM smarter_private.weekly_payout_wallet_reserves)"
SNAP="SELECT rr.digest()||'|'||"+RESERVES
interrupts=[];armed=None;snap_r2=None
run=[];waiting=0
for i in range(0,44):
    if armed:
        before=one(SNAP); q(armed[1]); g=all_jobs(10+i//60,i%60); r=g[-1]; q(DISARM)
        assert r['rc']!=0 and 'lane_i_interrupted' in r['err'],('the armed interruption did not stop the unit',armed[0],r)
        assert one(SNAP)==before,('an interrupted unit left something behind',armed[0])
        interrupts.append(armed[0]); armed=None; continue
    g=all_jobs(10+i//60,i%60); r=g[-1]; run.append(r)
    if r['rc']!=0 or stage(r)=='weekly_payout_finalized': break
    if stage(r)=='rounds_waiting_for_preparation':
        waiting+=1; assert one("SELECT "+NOLEGS)=='t','money moved while the runner was waiting for preparation'
    if stage(r)=='rounds_booked': RUN_ID_PROBE=json.loads(r['out'])['run_id']
    if stage(r)=='round_paid' and json.loads(r['out'])['round']==1:
        snap_r1=one(SNAP); exec((F/'before-round2.py').read_text())
        assert one(SNAP)==snap_r1,'a before-round-2 probe left something behind'
        armed=('round 2 killed at its last leg, AG -> SUB',arm("NEW.to_entity_id=rr.u('SUB') AND NEW.from_type='agent_wallet'",'round 2 killed at AG to SUB'))
    if stage(r)=='round_paid' and json.loads(r['out'])['round']==2:
        snap_r2=one(SNAP); exec((F/'between-rounds.py').read_text())
        assert one(SNAP)==snap_r2,'a between-rounds probe left something behind'
        armed=('round 3 killed at the TQ player leg',arm("NEW.to_entity_id=rr.u('TQ') AND NEW.category='rakeback'",'round 3 killed at TQ'))
assert interrupts==['round 2 killed at its last leg, AG -> SUB','round 3 killed at the TQ player leg'],interrupts
case('interruption: round 2 killed at its last leg and round 3 killed after paying some players each roll back whole (balances, journal, receipts, reserves unchanged); the next tick pays each round once')
if A.stop_after=='run': raise SystemExit(0)
bad=[r for r in run if r['rc']!=0]
assert not bad,('THE REAL RUNNER REFUSED',bad)
seq=[r for r in run if stage(r)!='rounds_waiting_for_preparation']; J=[json.loads(r['out']) for r in seq]
assert [j['stage'] for j in J]==['rounds_booked','round_paid','round_paid','round_paid','weekly_payout_finalized'],[j['stage'] for j in J]
assert [j.get('round') for j in J[1:4]]==[1,2,3] and J[1]['funding'] is None and J[2]['funding'] is None and J[3]['funding']['version']=='rakeback-funding-v1'
F3=J[3]['funding']; RC=J[2]['receipt']['rakeback_cascade']
assert F3['carried_by_round2'] is True and F3['ledger_ids']==[] and F3['reserve']['rows_added']==0 and len(F3['edges'])==5 and all(e['state']=='already_funded' for e in F3['edges']),F3
assert RC['one_leg_per_edge'] is True and D2(RC['funding_amount'])==210.5 and D2(RC['funding_from_bank'])==110.5 and RC['combined_legs']==2 and RC['funding_only_legs']==3 and RC['commission_only_legs']==0 and D2(RC['reserved'])==121.5 and RC['reserve_rows_added']==7,RC
assert D2(J[2]['receipt']['amount'])==84 and D2(J[2]['receipt']['downstream_amount'])==30,'round 2 still reports commission alone'
assert all(j['scope']['kind']=='union' for j in J[1:4]) and len(J[0]['scopes'])==1
case(f"the real weekly_payout_next_round, one cron tick per minute: {waiting} waiting tick(s), then booked, round 1, round 2, round 3 (funding inside the round 3 unit), finalize; one unit per tick, none refused")
RUN_ID=J[0]['run_id']
case('round 3 unit: the funding step finds all five edges already carried by round 2 (state already_funded, nothing sent, nothing reserved again); round 2 records the split (funding 210.50, 2 combined legs, 3 funding-only legs, 121.50 reserved) and still reports 84.00 of commission')
# ---------------------------------------------------------------- order of the books
ORD=lambda a,b: f"(SELECT max(chain_seq) FROM rr.legs WHERE stage IN({a}))<(SELECT min(chain_seq) FROM rr.legs WHERE stage IN({b}))"
case('books order for the scope: round 1, then round 2 carrying commission and funding in one transaction (parents first), then round 3',
  ok(ORD("'r1','r1_retained'","'r2','fund'")+" AND "+ORD("'r2','fund'","'r3'"),"journal order r1 < round 2 (commission and funding) < r3")
  +ok("(SELECT count(DISTINCT created_at)=1 AND count(*)=5 FROM rr.legs WHERE stage IN('r2','fund'))","every commission and funding leg was written by the one round 2 transaction")
  +ok("(SELECT count(*)=count(DISTINCT (club_id,from_entity_id,to_entity_id)) FROM rr.legs WHERE stage IN('r2','fund'))","ONE LEG PER EDGE: no (club, payer, payee) has a second commission or funding leg")
  +ok("NOT EXISTS(SELECT 1 FROM rr.legs o JOIN rr.legs i ON i.club_id=o.club_id AND i.to_type='club_treasury' AND i.stage='r1' WHERE o.from_type='club_treasury' AND o.chain_seq<i.chain_seq) AND (SELECT count(DISTINCT club_id) FROM rr.legs WHERE stage='r1')=3","in each of the three clubs the union credit precedes everything the bank sends")
  +ok("NOT EXISTS(SELECT 1 FROM rr.legs c JOIN rr.legs p ON p.stage IN('r2','fund') AND p.club_id=c.club_id AND p.to_type='agent_wallet' AND p.to_entity_id=c.from_entity_id WHERE c.stage IN('r2','fund') AND c.from_type='agent_wallet' AND c.chain_seq<p.chain_seq)","a hop never precedes the hop that funds its sender")
  +ok(f"(SELECT array_agg(round_no ORDER BY paid_at) FROM smarter_private.weekly_payout_round_receipts WHERE run_id='{RUN_ID}')=ARRAY[1,2,3] AND (SELECT count(*) FROM smarter_private.weekly_payout_round_receipts WHERE funding IS NOT NULL AND round_no<>3)=0","the runner's round receipts are 1, 2, 3 in time order; funding is recorded on round 3 only")
  +ok("(SELECT array_agg(round_name ORDER BY round_no) FROM public.union_settlement_rounds WHERE union_id=rr.u('U'))=ARRAY['union_to_clubs','club_to_agents','agents_to_players'] AND (SELECT array_agg(round_no ORDER BY round_no) FROM public.accounting_routed_settlement_runs WHERE scope_id=rr.u('U'))=ARRAY[2,3]","union_settlement_rounds and the routed settlement runs record each round once"))
# ---------------------------------------------------------------- every leg once, one paid receipt each
EXPECT=[('r1','union_wallet','U','club_treasury','O',162),('r1','union_wallet','U','club_treasury','W',135),('r1','union_wallet','U','club_treasury','T',369),('r1_retained','union_wallet','U','union_bank','U',74),
 ('r2','club_treasury','T','agent_wallet','SA',134),('r2','agent_wallet','SA','agent_wallet','AG',80),
 ('fund','club_treasury','O','agent_wallet','O.owner',18),('fund','club_treasury','W','agent_wallet','W.owner',42.5),
 ('fund','agent_wallet','AG','agent_wallet','SUB',50),
 ('r3','agent_wallet','O.owner','player_wallet','OP1',10),('r3','agent_wallet','O.owner','player_wallet','OP2',8),
 ('r3','agent_wallet','W.owner','player_wallet','WP1',30),('r3','agent_wallet','W.owner','player_wallet','WP2',12.5),
 ('r3','agent_wallet','SUB','player_wallet','TP',50),('r3','agent_wallet','AG','player_wallet','TR',5),('r3','agent_wallet','SA','player_wallet','TQ',6),('r3','club_treasury','T','player_wallet','TN',10)]
VALUES=','.join(f"('{s}','{ft}',rr.u('{f}'),'{tt}',rr.u('{t}'),{amt}::numeric)" for s,ft,f,tt,t,amt in EXPECT)
case(f'every leg exists exactly once ({len(EXPECT)} legs, named one by one) and each has exactly one paid receipt of the right kind and amount',
  ok(f"NOT EXISTS((SELECT stage,from_type,from_entity_id,to_type,to_entity_id,amount FROM rr.legs WHERE stage<>'seed') EXCEPT (VALUES {VALUES})) AND NOT EXISTS((VALUES {VALUES}) EXCEPT (SELECT stage,from_type,from_entity_id,to_type,to_entity_id,amount FROM rr.legs)) AND (SELECT count(*) FROM rr.legs WHERE stage<>'seed')={len(EXPECT)}","the journal holds exactly the expected legs")
  +ok("(SELECT count(*)=count(DISTINCT idempotency_key) FROM public.chip_ledger)","no idempotency key is used twice")
  +ok("""(SELECT count(*)=2 AND bool_and((metadata->>'commission_amount')::numeric+(metadata->>'rakeback_funding')::numeric=amount AND metadata->>'rakeback_funding_version'='rakeback-funding-v1'
      AND metadata->>'rakeback_funding_key'=smarter_private.rakeback_cascade_key(club_id,rr.d1(),CASE WHEN from_type='agent_wallet' THEN from_entity_id END,to_entity_id)
      AND (metadata->>'own_commission')::numeric IS NOT NULL) FROM rr.legs WHERE stage='r2')
     AND (SELECT string_agg(round((metadata->>'commission_amount')::numeric,2)||'+'||round((metadata->>'rakeback_funding')::numeric,2),',' ORDER BY chain_seq) FROM rr.legs WHERE stage='r2')='84.00+50.00,30.00+50.00'""",
     "each combined leg records its split: bank -> SA 84.00 commission + 50.00 funding, SA -> AG 30.00 + 50.00, keyed to the cascade edge")
  +ok("(SELECT count(*)=3 AND bool_and(metadata->>'sent_in_round'='2' AND category IN('club_bank_send','agent_send') AND idempotency_key=smarter_private.rakeback_cascade_key(club_id,rr.d1(),CASE WHEN from_type='agent_wallet' THEN from_entity_id END,to_entity_id)) FROM rr.legs WHERE stage='fund')","the three edges with no commission (two owner wallets, AG -> SUB) are one funding leg each, sent by round 2 under the cascade key")
  +ok("(SELECT sum(amount) FROM public.agent_commission_settlements WHERE user_id IN(rr.u('SA'),rr.u('AG')))=84","agent_commission_settlements still records commission alone")
  +ok("""NOT EXISTS(SELECT 1 FROM rr.legs l WHERE l.stage<>'seed' AND (SELECT count(*) FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid' AND i.chips_transferred AND i.message_sent AND i.invoice_number IS NOT NULL
        AND i.gross_amount=l.amount AND i.net_amount=l.amount AND i.deductions=0
        AND i.invoice_type=CASE WHEN l.stage='r1' THEN 'union_to_club' WHEN l.from_type='club_treasury' AND l.to_type='agent_wallet' THEN 'club_to_agent'
           WHEN l.from_type='agent_wallet' AND l.to_type='agent_wallet' THEN 'agent_to_subagent' WHEN l.from_type='agent_wallet' AND l.to_type='player_wallet' THEN 'agent_to_player' ELSE 'transaction_receipt' END)<>1)""","each leg has exactly one paid receipt of the right kind and amount")
  +ok(f"(SELECT count(*) FROM public.settlement_invoices)={len(EXPECT)} AND NOT EXISTS(SELECT 1 FROM public.settlement_invoices WHERE status<>'paid')","no second receipt, no receipt without a leg, none unpaid"))
# ---------------------------------------------------------------- reconciliation, tier by tier
RECON_SQL="""SELECT jsonb_build_object(
 'union',(SELECT jsonb_build_object('rake_banked',(SELECT sum(amount) FROM rr.legs WHERE stage='seed'),'debited',(SELECT sum(amount) FROM rr.legs WHERE from_type='union_wallet'),
    'to_clubs',(SELECT sum(amount) FROM rr.legs WHERE stage='r1'),'retained_to_union_bank',(SELECT sum(amount) FROM rr.legs WHERE stage='r1_retained'),'rake_wallet_after',w.rake_wallet,'union_bank_after',w.chip_balance) FROM public.union_wallets w),
 'clubs',(SELECT jsonb_agg(jsonb_build_object('club',x.n,'received',(SELECT sum(amount) FROM rr.legs WHERE stage='r1' AND to_entity_id=rr.u(x.n)),
    'commission_legs',COALESCE((SELECT sum(amount-COALESCE((metadata->>'rakeback_funding')::numeric,0)) FROM rr.legs WHERE stage='r2' AND from_type='club_treasury' AND from_entity_id=rr.u(x.n)),0),
    'funding_legs',COALESCE((SELECT sum(CASE WHEN stage='fund' THEN amount ELSE COALESCE((metadata->>'rakeback_funding')::numeric,0) END) FROM rr.legs WHERE stage IN('r2','fund') AND from_type='club_treasury' AND from_entity_id=rr.u(x.n)),0),
    'direct_player_legs',COALESCE((SELECT sum(amount) FROM rr.legs WHERE stage='r3' AND from_type='club_treasury' AND from_entity_id=rr.u(x.n)),0),
    'retained_in_bank',rr.bank(x.n)) ORDER BY x.o) FROM (VALUES('O',1),('W',2),('T',3)) x(n,o)),
 'agents',(SELECT jsonb_agg(jsonb_build_object('agent',x.n,'club',x.c,'status',a.status,'rate',a.commission_rate,
    'in_commission',COALESCE((SELECT sum(amount-COALESCE((metadata->>'rakeback_funding')::numeric,0)) FROM rr.legs WHERE stage='r2' AND to_type='agent_wallet' AND to_entity_id=a.user_id AND club_id=a.club_id),0),
    'in_funding',COALESCE((SELECT sum(CASE WHEN stage='fund' THEN amount ELSE COALESCE((metadata->>'rakeback_funding')::numeric,0) END) FROM rr.legs WHERE stage IN('r2','fund') AND to_type='agent_wallet' AND to_entity_id=a.user_id AND club_id=a.club_id),0),
    'out_to_agents',COALESCE((SELECT sum(amount) FROM rr.legs WHERE stage IN('r2','fund') AND from_type='agent_wallet' AND from_entity_id=a.user_id AND club_id=a.club_id),0),
    'out_to_players',COALESCE((SELECT sum(amount) FROM rr.legs WHERE stage='r3' AND from_type='agent_wallet' AND from_entity_id=a.user_id AND club_id=a.club_id),0),
    'wallet_after',a.agent_wallet_balance,'own_commission_accrued',n.own,'players_owed',n.owed,'passthrough_need',n.passthrough) ORDER BY x.o)
   FROM (VALUES('O.owner','O',1),('W.owner','W',2),('SA','T',3),('AG','T',4),('SUB','T',5)) x(n,c,o) JOIN public.agents a ON a.user_id=rr.u(x.n) AND a.club_id=rr.u(x.c) JOIN rr.nodes n ON n.agent_id=a.id))"""
T=json.loads(one(RECON_SQL)); record.append({'reconciliation':T})
D=D2
u=T['union']; assert D(u['rake_banked'])==740 and D(u['debited'])==740 and D(u['to_clubs'])==666 and D(u['retained_to_union_bank'])==74 and D(u['rake_wallet_after'])==0 and D(u['union_bank_after'])==74,u
assert D(u['to_clubs'])==sum(D(c['received']) for c in T['clubs'])
for c in T['clubs']: assert D(c['received'])==round(D(c['commission_legs'])+D(c['funding_legs'])+D(c['direct_player_legs'])+D(c['retained_in_bank']),2),c
assert [(c['club'],D(c['received']),D(c['commission_legs']),D(c['funding_legs']),D(c['direct_player_legs']),D(c['retained_in_bank'])) for c in T['clubs']]==[('O',162,0,18,0,144),('W',135,0,42.5,0,92.5),('T',369,84,50,10,225)],T['clubs']
# Approved retained entitlement: commission routed to the wallet by round 2 (net of what it passes down) plus its
# pass-through need minus what it owes its players. The owner tier's commission stays in the club bank (round 2, unchanged).
ENT={'O.owner':0,'W.owner':0,'SA':48,'AG':25,'SUB':0}
fn={n['user_id']:n for n in J[3]['funding']['nodes']}
for a in T['agents']:
    net=round(D(a['in_commission'])+D(a['in_funding'])-D(a['out_to_agents'])-D(a['out_to_players']),2)
    assert net==D(a['wallet_after'])==ENT[a['agent']],a
    owner=a['agent'].endswith('.owner')
    own_in_wallet=0 if owner else D(a['own_commission_accrued'])
    need=D(a['players_owed']) if owner else D(a['passthrough_need'])  # nothing of an owner's commission reaches its wallet, so it covers nothing there
    a['passthrough_need']=need; a['retained_entitlement']=ENT[a['agent']]
    assert ENT[a['agent']]==round(own_in_wallet+need-D(a['players_owed']),2),a
    f=fn[one(f"SELECT rr.u('{a['agent']}')")]
    assert D(f['players_need'])==need and D(f['players_owed'])==D(a['players_owed']) and D(f['inflow'])==D(a['in_funding']) and D(f['to_children'])==round(D(a['out_to_agents'])-(30 if a['agent']=='SA' else 0),2),(a,f)
assert len(fn)==5 and len(J[3]['funding']['edges'])==5 and all(e['state']=='already_funded' for e in J[3]['funding']['edges'])
case('tier-by-tier reconciliation: union debit = club credits + union retained; each club received = commission + funding + direct player legs + retained; each agent inflow - outflow = wallet = approved retained entitlement',
  ok("(SELECT status='wallet_only' AND commission_rate=0 AND agent_wallet_balance=0 AND business_balance=0 FROM public.agents WHERE club_id=rr.u('W') AND user_id=rr.u('W.owner')) AND NOT EXISTS(SELECT 1 FROM public.agent_commissions WHERE club_id=rr.u('W'))","the wallet_only owner wallet was created by the funding step, earned nothing, and ends at 0")
  +ok("(SELECT sum(amount) FROM rr.legs WHERE stage='fund' AND to_entity_id=rr.u('W.owner'))=42.5 AND (SELECT sum(amount) FROM rr.legs WHERE stage='r3' AND from_entity_id=rr.u('W.owner'))=42.5","wallet_only: 42.50 in from the bank, 42.50 out to its two players")
  +ok("(SELECT status='active' AND commission_rate=0.20 AND agent_wallet_balance=0 FROM public.agents WHERE club_id=rr.u('O') AND user_id=rr.u('O.owner')) AND (SELECT count(*) FROM public.agents WHERE club_id=rr.u('O'))=1","the active owner row is used as it is; no second row"))
case('chips conserve across the whole board and the production books readers agree',
  ok("rr.money()=740 AND rr.money()=(SELECT sum(amount) FROM public.chip_ledger WHERE from_type='system_mint')","no chip was created or destroyed")
  +ok("""NOT EXISTS(SELECT 1 FROM(
   SELECT 'agent_wallet' t,a.user_id e,a.club_id c,a.agent_wallet_balance b FROM public.agents a UNION ALL
   SELECT 'club_treasury',c.id,c.id,c.chip_treasury FROM public.clubs c UNION ALL
   SELECT 'player_wallet',m.user_id,m.club_id,m.chip_balance FROM public.club_members m UNION ALL
   SELECT 'union_wallet',w.union_id,NULL,w.rake_wallet FROM public.union_wallets w UNION ALL
   SELECT 'union_bank',w.union_id,NULL,w.chip_balance FROM public.union_wallets w)s
  WHERE s.b IS DISTINCT FROM COALESCE((SELECT sum(CASE WHEN l.to_type=s.t AND l.to_entity_id=s.e THEN l.amount ELSE 0 END)-sum(CASE WHEN l.from_type=s.t AND l.from_entity_id=s.e THEN l.amount ELSE 0 END)
     FROM public.chip_ledger l WHERE (l.to_type=s.t AND l.to_entity_id=s.e OR l.from_type=s.t AND l.from_entity_id=s.e) AND (s.t IN('club_treasury','union_wallet','union_bank') OR l.club_id=s.c)),0))""","every wallet, bank and union balance equals the net of its journal legs")
  +ok("(SELECT count(*) FROM public.ca_ledger_invariant_findings)=0 AND (SELECT count(*) FROM public.ca_ledger_invariant_refusals)=0","the commit-time ledger invariant found and refused nothing")
  +ok("NOT EXISTS(SELECT 1 FROM public.fn_ca_treasury_positions() p WHERE p.severity<>'ok' OR p.unbaselined) AND (SELECT count(*) FROM public.fn_ca_treasury_positions())=3","fn_ca_treasury_positions: every club bank equals its baseline plus its journal")
  +ok("NOT EXISTS(SELECT 1 FROM public.fn_chip_drift_since_baseline() d WHERE d.drift<>0) AND (SELECT count(*) FROM public.fn_chip_drift_since_baseline())=(SELECT count(*) FROM public.club_members)","fn_chip_drift_since_baseline: no member wallet drifts")
  +ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE agent_wallet_balance<0 OR agent_wallet_balance IS DISTINCT FROM business_balance) AND NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE description LIKE 'auto-ledgered%' OR from_type='settlement_suspense' OR to_type='settlement_suspense')","no negative or unsynced agent wallet; no auto-journalled or suspense leg")
  +ok("NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE status<>'paid') AND (SELECT count(*) FROM public.rakeback_period_payouts)=8 AND (SELECT sum(payout_amount) FROM public.rakeback_period_payouts)=131.50 AND (SELECT sum(chip_balance) FROM public.club_members)=131.50","every period is paid once; players hold exactly what the certificates owe"))
# ---------------------------------------------------------------- finalize
case('the runner finalized: its finalize step and status rows say complete',
  ok(f"(SELECT phase='released' AND result->>'stage'='weekly_payout_financial_complete' AND result->>'paid'='true' AND jsonb_array_length(result->'rounds')=3 FROM public.weekly_accounting_payout_pauses WHERE run_id='{RUN_ID}') AND (SELECT count(*) FROM public.weekly_accounting_payout_pauses)=1","the run row is released with stage weekly_payout_financial_complete, paid true, three rounds")
  +ok(f"(SELECT count(*) FROM smarter_private.weekly_payout_financial_receipts WHERE run_id='{RUN_ID}' AND scope_kind='union' AND scope_id=rr.u('U') AND jsonb_array_length(original_round_receipts)=3)=1 AND (SELECT count(*) FROM smarter_private.weekly_payout_financial_receipts)=1","one financial receipt for the scope carrying its three round receipts")
  +ok("(SELECT count(*) FROM public.ca_settlements WHERE state='final')=1 AND (SELECT count(*) FROM public.ca_settlements)=1 AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_owned_transactions)","round 1's settlement is final; no owned-transaction row is left behind"))
case('the reserve is released as round 3 pays: after finalize all seven reserve rows (121.50) remain 0, each released, and finalize found none left',
  ok("(SELECT count(*)=7 AND sum(reserved)=121.50 AND bool_and(remaining=0 AND released_at IS NOT NULL AND set_by='round2') FROM smarter_private.weekly_payout_wallet_reserves)","every reserve released")
  +ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves w JOIN public.rakeback_periods p ON p.id=w.period_id WHERE p.status<>'paid')","every reserved period is paid"))
assert J[4]['stage']=='weekly_payout_finalized' and [(x['round'],D(x['amount']),x['payees']) for x in J[4]['rounds']]==[(1,666,3),(2,84,3),(3,131.5,8)],J[4]
# ---------------------------------------------------------------- a second pass moves nothing
before=one("SELECT rr.digest()||':'||rr.money()||':'||(SELECT count(*) FROM public.chip_ledger)"); last=len(run)+10*60*0
again=[]
for (h,m) in [(10,len(run)),(10,len(run)+1),(10,len(run)+2),(11,30),(16,0)]:
    g=all_jobs(h,m); again.append(g)
    if (h,m)==(10,len(run)+1): again.append([tick('weekly-payout-readiness-0330',minute(h,m))])
assert all(r['rc']==0 for g in again for r in g),[r for g in again for r in g if r['rc']!=0]
assert all(g[-1]['out']=='' for g in again if g[-1]['job']==RUNNER),[g[-1] for g in again]
assert one("SELECT rr.digest()||':'||rr.money()||':'||(SELECT count(*) FROM public.chip_ledger)")==before,'a tick after finalize changed the board'
r2again=json.loads(one("SELECT public.fn_settle_accounting_commission_stage('union',rr.u('U'),rr.ws(),rr.we())::text"))
assert r2again.get('duplicate') is True and one("SELECT rr.digest()||':'||rr.money()||':'||(SELECT count(*) FROM public.chip_ledger)")==before and one("SELECT count(*)=7 AND sum(remaining)=0 AND sum(reserved)=121.50 FROM smarter_private.weekly_payout_wallet_reserves")=='t',r2again
case('rerun: round 2 called again after finalize returns its recorded result as a duplicate and sends nothing; reserves stay released')
case('a second pass of ticks after finalize (three more minutes, 11:30Z and 16:00Z; shards, readiness, runner) answers NULL and moves nothing: balances, journal, receipts, payouts, round and run rows unchanged')
