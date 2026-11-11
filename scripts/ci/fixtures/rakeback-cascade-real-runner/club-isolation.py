# Club isolation (20261111174403), exec'd by the harness after cases.py on the same board.
# Owner decision (Dan, 2026-11-11): pay independently valid, fully funded clubs when another club refuses;
# fail closed only for the affected scope; never invent allocations, borrow another club's funds or mark the
# union complete early. Two more union weeks run through the REAL runner, one cron tick per minute:
#   week 2 (paid Monday 2026-11-23): round 1 is interrupted once (the whole union fails closed), then club W's bank
#     is emptied by its owner through the real club bank send door after round 1, so W cannot fund its week. O and
#     T are paid in rounds 2 and 3; W is held, untouched, retried every minute; finalize stays closed. W's owner then
#     deposits chips (STAND-IN: a fixture mint, the same door the fixture uses for rake) and W is paid exactly once.
#   week 3 (paid Monday 2026-11-30): a new club V whose upline is recorded in club O (a cross-club dependency;
#     STAND-IN: one agreement-history row inserted after preparation, since production's agents guard refuses a
#     cross-club parent today) holds both V and O in round 2; after round 2 pays T and W, T's middle agent AG is
#     deleted (STAND-IN: profiles.status set directly), so T's round 3 refuses (upline_deleted_after_funding) for T
#     alone. W is paid in full; the union week is never finalized.
def minute_on(day,h,m): return f"{day} {h:02d}:{m:02d}:20+00"
def jobs_at(day,h,m):
    out=[tick(s,minute_on(day,h,m)) for s in SHARDS]; out.append(tick(RUNNER,minute_on(day,h,m))); return out
def J_(r): return json.loads(r['out']) if r['out'] else None
def prepare(day):
    pre=[jobs_at(day,8,0),jobs_at(day,8,1),jobs_at(day,9,29)]; pre.append([tick('weekly-payout-readiness-0330',minute_on(day,9,30))]); pre.append(jobs_at(day,9,59))
    assert all(r['rc']==0 for g in pre for r in g),[r for g in pre for r in g if r['rc']!=0]
    assert all(g[-1]['out']=='' for g in pre if g[-1]['job']==RUNNER)
CR="smarter_private.weekly_payout_club_rounds"
def cr(club,rnd,ws): return f"(SELECT row_to_json(w)::jsonb FROM {CR} w WHERE w.club_id=rr.u('{club}') AND w.round_no={rnd} AND w.period_start='{ws}'::timestamptz)"
def wk(ts): return one(f"SELECT public.fn_union_week_start('{ts}'::timestamptz)")
DIG_PAID=lambda clubs,mark: ("SELECT md5(jsonb_build_array("
  f"(SELECT jsonb_agg(jsonb_build_array(id,chip_treasury) ORDER BY id) FROM public.clubs WHERE id IN({clubs})),"
  f"(SELECT jsonb_agg(jsonb_build_array(id,agent_wallet_balance) ORDER BY id) FROM public.agents WHERE club_id IN({clubs})),"
  f"(SELECT jsonb_agg(jsonb_build_array(club_id,user_id,chip_balance) ORDER BY club_id,user_id) FROM public.club_members WHERE club_id IN({clubs})),"
  f"(SELECT jsonb_build_array(count(*),sum(amount)) FROM public.chip_ledger WHERE club_id IN({clubs}) AND chain_seq>{mark}),"
  f"(SELECT jsonb_build_array(count(*),sum(remaining)) FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id IN({clubs})),"
  f"(SELECT jsonb_build_array(count(*),sum(payout_amount)) FROM public.rakeback_period_payouts WHERE club_id IN({clubs})))::text)")
OT="rr.u('O'),rr.u('T')"
U=lambda n: one(f"SELECT rr.u('{n}')")
# ================================================================ WEEK 2
clock('2026-11-17 06:00:00+00')
HANDS2=[('O','OP1',100,'2026-11-17 03:10:00+00'),('W','WP1',60,'2026-11-17 04:40:00+00'),('W','WP2',50,'2026-11-18 13:00:00+00'),
        ('T','TP',70,'2026-11-18 15:10:00+00'),('T','TR',50,'2026-11-19 19:30:00+00'),('T','TQ',60,'2026-11-20 01:40:00+00'),('T','TN',200,'2026-11-21 07:30:00+00')]
clock('2026-11-23 07:00:00+00')
for c,p,rake,at in HANDS2: q(f"SELECT rr.hand('{c}','{p}',{rake},'{at}');")
WS2=wk('2026-11-18 12:00+00'); WE2=wk('2026-11-26 12:00+00'); DAY2='2026-11-23'
MARK2=one("SELECT max(chain_seq) FROM public.chip_ledger")
BANK2_OT=one(f"SELECT sum(chip_treasury) FROM public.clubs WHERE id IN({OT})")
prepare(DAY2)
assert one(f"SELECT count(*) FROM public.accounting_rakeback_period_calculations c JOIN public.rakeback_periods p ON p.id=c.period_id WHERE p.period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date")=='7'
seq2=[];i=0;r1_failed=False;drained=False;held_ticks=[]
def tk():
    global i; g=jobs_at(DAY2,10+i//60,i%60); i+=1; return g[-1]
# 10:00 onward until round 1 is booked; then ROUND 1 FAILS ONCE: the whole union fails closed.
while True:
    r=tk(); s=stage(r)
    if s=='rounds_booked': RUN2=J_(r)['run_id']; break
    assert r['rc']==0 and s in('rounds_waiting_for_preparation','maintenance_frozen',None),r
before=one("SELECT rr.digest()")
q(arm("NEW.from_type='union_wallet' AND NEW.to_type='club_treasury' AND NEW.to_entity_id=rr.u('O')",'round 1 killed at its club O credit'))
r=tk(); q(DISARM)
assert r['rc']!=0 and 'lane_i_interrupted' in r['err'] and one("SELECT rr.digest()")==before and one(f"SELECT count(*) FROM {CR} WHERE period_start='{WS2}'")=='0',r
case('club isolation, round 1 is shared: a round 1 failure at one club\'s credit rolls the whole union back (no club credited, nothing recorded per club); the union rake pool and its retained share are one unit')
r=tk(); assert stage(r)=='round_paid' and J_(r)['round']==1,r
# W's owner empties its bank through the real club bank send door after round 1 credited it.
bank_w=float(one("SELECT rr.bank('W')"))
send=round(bank_w-10,2)
res=json.loads(one("SELECT set_config('request.jwt.claims',jsonb_build_object('sub',rr.u('W.owner'),'role','authenticated')::text,false);"
  f"SELECT public.fn_club_bank_send_core_20261004(rr.u('W'),rr.u('WP2'),{send},'player_wallet','lane j: owner empties the bank',rr.u('op-w-drain'))::text;"))
assert res.get('success') is True and D2(one("SELECT rr.bank('W')"))==10,res
case(f'week 2: round 1 pays each club its share; W\'s owner then sends {send:.2f} out of W\'s bank through the real club bank send door, leaving 10.00, less than W must fund this week')
# ROUND 2: O and T are paid, W is held untouched.
r=tk(); j=J_(r) if r["rc"]==0 else None
assert r["rc"]==0,r
assert r['rc']==0 and stage(r)=='round_clubs_held' and j['round']==2 and [h['code'] for h in j['receipt']['held_clubs']]==['routed_commission_club_funding_shortfall'],r
assert sorted(j['receipt']['paid_now'])==sorted([U('O'),U('T')]),j
W2=f"(SELECT id FROM public.rakeback_periods WHERE club_id=rr.u('W') AND period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date)"
case('round 2 holds only W: the pass pays O and T (one leg per edge, each with its receipt) and records W refused (routed_commission_club_funding_shortfall) with one critical financial alert; W has no leg, no reserve and no settlement; the union\'s round 2 has no receipt and no settlement run row',
  ok(f"NOT EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARK2} AND club_id=rr.u('W') AND stage IN('r2','fund','r3'))","no week 2 round 2 leg for W")
  +ok(f"EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARK2} AND club_id=rr.u('T') AND stage='r2') AND EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARK2} AND club_id=rr.u('O') AND stage='fund')","O and T legs sent")
  +ok(f"(SELECT count(*)=count(DISTINCT (club_id,from_entity_id,to_entity_id)) FROM rr.legs WHERE chain_seq>{MARK2} AND stage IN('r2','fund'))","one leg per edge")
  +ok(f"NOT EXISTS(SELECT 1 FROM rr.legs l WHERE l.chain_seq>{MARK2} AND l.stage IN('r2','fund') AND (SELECT count(*) FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid' AND i.gross_amount=l.amount)<>1)","each leg one paid receipt")
  +ok(f"NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('W') AND period_start='{WS2}') AND EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('T') AND period_start='{WS2}' AND remaining>0)","W reserves nothing; T's players' share is reserved")
  +ok(f"NOT EXISTS(SELECT 1 FROM public.agent_commission_settlements WHERE club_id=rr.u('W') AND period_start='{WS2}') AND rr.bank('W')=10","W untouched")
  +ok(f"({cr('W',2,WS2)}->>'status')='refused' AND ({cr('W',2,WS2)}->>'attempts')::int=1 AND ({cr('O',2,WS2)}->>'status')='paid' AND ({cr('T',2,WS2)}->>'status')='paid'","per-club rows")
  +ok(f"(SELECT count(*)=1 AND bool_and(severity='critical' AND NOT resolved AND message LIKE 'Weekly rakeback for Club W%held in round 2%' AND position(chr(8212) in message)=0) FROM public.financial_alerts WHERE source='weekly_payout_club_refused')","one critical alert, no em dash")
  +ok(f"NOT EXISTS(SELECT 1 FROM public.accounting_routed_settlement_runs WHERE period_start='{WS2}') AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_round_receipts WHERE run_id='{RUN2}' AND round_no=2)","union round 2 open"))
# ROUND 3 (first pass) RACING two other sessions: a second runner tick, and SA staking its whole unreserved
# balance through the real self stake door. Round 3 is slowed at its TQ leg (SA pays TQ) so both arrive while
# it holds SA's wallet and the runner's lock.
import threading,time
q(LOAD_DEBIT)  # the production self stake door, byte-exact, committed for the race
SA_BEFORE=D2(one("SELECT rr.wallet('T','SA')")); SA_RES=D2(one("SELECT COALESCE(sum(remaining),0) FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('T') AND user_id=rr.u('SA') AND remaining>0"))
X=round(SA_BEFORE-SA_RES,2); assert SA_RES>0 and X>0,(SA_BEFORE,SA_RES)
bad=q("BEGIN;"+AS_SA+f"SELECT public.fn_agent_wallet_self_stake(rr.u('T'),{X+0.01},'lane j race',rr.u('op-race-bad'));COMMIT;",check=False)
assert bad.returncode!=0 and 'agent_wallet_weekly_rakeback_reserved' in bad.stderr and D2(one("SELECT rr.wallet('T','SA')"))==SA_BEFORE,bad.stderr[-400:]
q("CREATE FUNCTION rr.nap() RETURNS trigger LANGUAGE plpgsql AS $n$BEGIN PERFORM pg_sleep(3);RETURN NULL;END$n$;"
  "CREATE TRIGGER zz_lane_j_nap AFTER INSERT ON public.chip_ledger FOR EACH ROW WHEN (NEW.category='rakeback' AND NEW.to_type='player_wallet' AND NEW.to_entity_id=rr.u('TQ')) EXECUTE FUNCTION rr.nap();")
RACE={}
def _b1(): RACE['b1']=tk()
def _b2(): RACE['b2']=cron(RUNNER)
def _st(): RACE['stake']=q("BEGIN;"+AS_SA+f"SELECT public.fn_agent_wallet_self_stake(rr.u('T'),{X},'lane j race',rr.u('op-race-ok'))::text;COMMIT;",check=False)
t1=threading.Thread(target=_b1); t1.start(); time.sleep(0.8)
t2=threading.Thread(target=_b2); t3=threading.Thread(target=_st); t2.start(); t3.start(); t1.join(); t2.join(); t3.join()
q("DROP TRIGGER zz_lane_j_nap ON public.chip_ledger; DROP FUNCTION rr.nap();")
r=RACE['b1']; j=J_(r) if r["rc"]==0 else None
assert r["rc"]==0,r
assert RACE['b2'][0]==0 and json.loads(RACE['b2'][1])['stage']=='rounds_busy',RACE['b2']
st=RACE['stake']; assert st.returncode==0 and json.loads(st.stdout.strip().split('\n')[-1])['success'] is True,(st.stdout[-400:],st.stderr[-400:])
order=one(f"SELECT CASE WHEN (SELECT min(chain_seq) FROM public.chip_ledger WHERE chain_seq>{MARK2} AND category='rakeback' AND to_entity_id=rr.u('TQ'))<(SELECT min(chain_seq) FROM public.chip_ledger WHERE chain_seq>{MARK2} AND idempotency_key LIKE '%op-race%' OR (chain_seq>{MARK2} AND category='agent_send' AND from_entity_id=rr.u('SA'))) THEN 'round 3 first' ELSE 'stake first' END")
case(f'concurrency: while round 3 holds SA\'s wallet and the runner lock, a second runner tick answers rounds_busy and pays nothing, and SA\'s stake of its whole unreserved {X:.2f} waits for the lock and then moves ({order}); a stake of {X+0.01:.2f} (one cent of the reserve) was refused before; TQ is paid once, the reserve released, SA ends at 0.00 with nothing negative or stranded',
  ok(f"(SELECT count(*) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r3' AND to_entity_id=rr.u('TQ'))=1 AND rr.wallet('T','SA')=0","TQ paid once; SA at 0.00")
  +ok(f"NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('T') AND user_id=rr.u('SA') AND remaining>0) AND NOT EXISTS(SELECT 1 FROM public.agents WHERE agent_wallet_balance<0)","SA's reserve released; no negative wallet")
  +ok("(SELECT count(*) FROM public.ca_ledger_invariant_findings)=0","ledger invariant clean"))
assert r['rc']==0 and stage(r)=='round_clubs_held' and j['round']==3 and [h['code'] for h in j['receipt']['held_clubs']]==['weekly_payout_club_round2_not_paid'] and j['funding']['version']=='rakeback-funding-v1',r
assert not any(e['club_id']==one("SELECT rr.u('W')") for e in j['funding']['edges']),j['funding']
case('round 3 holds only W: the funding step plans only clubs round 2 paid, every O and T player is paid once and their reserves are released; W\'s players are untouched (period pending, no payout)',
  ok(f"NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE club_id IN({OT}) AND period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date AND status<>'paid')","O and T periods paid")
  +ok(f"NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE id IN{W2} AND status<>'pending') AND NOT EXISTS(SELECT 1 FROM public.rakeback_period_payouts WHERE rakeback_period_id IN{W2})","W periods pending, unpaid")
  +ok(f"NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE period_start='{WS2}' AND remaining>0)","no reserve left for paid clubs")
  +ok(f"({cr('W',3,WS2)}->>'status')='refused' AND ({cr('O',3,WS2)}->>'status')='paid' AND ({cr('T',3,WS2)}->>'status')='paid'","round 3 rows"))
# Every later tick retries W alone and moves nothing for O and T; finalize stays closed.
paid_before=one(DIG_PAID(OT,MARK2)); all_before=one("SELECT rr.digest()")
for _ in range(4):
    r=tk(); j=J_(r); held_ticks.append(r)
    assert r['rc']==0 and stage(r)=='round_clubs_held' and j['round']==2,('a held club must be retried in round 2 while round 2 holds it',r)
assert one(DIG_PAID(OT,MARK2))==paid_before and one("SELECT rr.digest()")==all_before,'a retry moved something'
_att=one(f"SELECT ({cr('W',2,WS2)}->>'attempts')::int"); _al=one("SELECT count(*) FROM public.financial_alerts WHERE source='weekly_payout_club_refused'")
assert _att=='5' and _al=='1',(_att,_al)
fin=q(f"BEGIN;SELECT smarter_private.weekly_payout_finalize('{RUN2}');ROLLBACK;",check=False)
assert fin.returncode!=0 and 'weekly_payout_club_still_held' in fin.stderr,fin.stderr[-500:]
assert one(f"SELECT phase FROM public.weekly_accounting_payout_pauses WHERE run_id='{RUN2}'")=='paying'
case('while W is short every tick retries W alone (attempts 5, one alert): balances, journal, receipts, payouts, reserves, run and round rows unchanged for O, T and everything else; finalize refuses (weekly_payout_club_still_held) and the run stays paying; what was paid conserves (no chip created, every bank and wallet equals its journal, the ledger invariant found nothing)',
  ok("rr.money()=(SELECT sum(amount) FROM public.chip_ledger WHERE from_type='system_mint')","no chip created or destroyed")
  +ok("(SELECT count(*) FROM public.ca_ledger_invariant_findings)=0 AND (SELECT count(*) FROM public.ca_ledger_invariant_refusals)=0","ledger invariant clean")
  +ok("NOT EXISTS(SELECT 1 FROM public.fn_ca_treasury_positions() p WHERE p.severity<>'ok' OR p.unbaselined)","every club bank equals its baseline plus its journal")
  +ok(f"(SELECT sum(chip_treasury) FROM public.clubs WHERE id IN({OT}))={BANK2_OT}+(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r1' AND to_entity_id IN({OT}))-(SELECT COALESCE(sum(amount),0) FROM rr.legs WHERE chain_seq>{MARK2} AND from_type='club_treasury' AND from_entity_id IN({OT}))"
     +f" AND (SELECT COALESCE(sum(amount),0) FROM rr.legs WHERE chain_seq>{MARK2} AND from_type='club_treasury' AND from_entity_id IN({OT}))<=(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r1' AND to_entity_id IN({OT}))","O and T paid only out of their own week 2 credit; nothing borrowed"))
# W's owner deposits chips (stand-in mint); the next ticks pay W exactly once and the union week completes.
q(f"""DO $d$DECLARE b numeric;l uuid;BEGIN
 PERFORM set_config('app.ledger_autoskip_clubs','1',true);
 UPDATE public.clubs SET chip_treasury=chip_treasury+500 WHERE id=rr.u('W') RETURNING chip_treasury INTO b;
 INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,description,idempotency_key,pre_to_balance,post_to_balance,to_label)
 VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','system_mint',NULL,'club_treasury',rr.u('W'),500,'mint',rr.u('W'),'Fixture owner deposit to the club bank','fixture-deposit:w',b-500,b,'clubs.chip_treasury') RETURNING id INTO l;
 INSERT INTO public.ca_mint_ledger(op_id,action,asset,holder_type,holder_id,holder_label,amount,balance_before,balance_after,supply_after,reason,performed_by,chip_ledger_id)
 VALUES('fixture-deposit:'||l,'mint','chips','club',rr.u('W'),'W',500,b-500,b,b,'Fixture owner deposit','2d1cd6c3-5700-4af9-a271-d4863fdab20d',l);
 PERFORM set_config('app.ledger_autoskip_clubs','',true);END$d$;""")
fin_seq=[]
for _ in range(6):
    r=tk(); fin_seq.append(r); assert r['rc']==0,r
    if stage(r)=='weekly_payout_finalized': break
assert [(stage(r),(J_(r) or {}).get('round')) for r in fin_seq]==[('round_paid',2),('round_paid',3),('weekly_payout_finalized',None)],[(stage(r),r['out'][:200]) for r in fin_seq]
R2W=J_(fin_seq[0])['receipt']; R3W=J_(fin_seq[1])['receipt']; FW=J_(fin_seq[1])['funding']
WOWED=one(f"SELECT sum(rakeback_amount) FROM public.accounting_rakeback_period_calculations c WHERE c.period_id IN{W2}")
case(f'W funded later: round 2 pays W (one funding leg bank -> W.owner {WOWED}) and only W, completes the union round with the whole week\'s totals; round 3 pays W\'s two players once; finalize completes the union week',
  ok(f"(SELECT count(*)=1 AND sum(amount)={WOWED} FROM rr.legs WHERE chain_seq>{MARK2} AND club_id=rr.u('W') AND stage='fund' AND to_entity_id=rr.u('W.owner'))","one W funding leg")
  +ok(f"(SELECT count(*)=2 AND sum(amount)={WOWED} FROM rr.legs WHERE chain_seq>{MARK2} AND club_id=rr.u('W') AND stage='r3')","W players paid once")
  +ok(f"(SELECT count(*)=count(DISTINCT idempotency_key) FROM public.chip_ledger) AND (SELECT count(*)=count(DISTINCT (club_id,from_entity_id,to_entity_id)) FROM rr.legs WHERE chain_seq>{MARK2} AND stage IN('r2','fund'))","no key twice; one leg per edge across both passes")
  +ok(f"NOT EXISTS(SELECT 1 FROM rr.legs l WHERE l.chain_seq>{MARK2} AND l.stage IN('r2','fund','r3') AND (SELECT count(*) FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid' AND i.gross_amount=l.amount)<>1)","one receipt each")
  +ok(f"NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date AND status<>'paid') AND (SELECT count(*) FROM public.rakeback_period_payouts pp JOIN public.rakeback_periods p ON p.id=pp.rakeback_period_id WHERE p.period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date)=7","every week 2 period paid once")
  +ok(f"NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0)","every reserve released")
  +ok(f"NOT EXISTS(SELECT 1 FROM {CR} WHERE status='refused') AND (SELECT bool_and(resolved AND resolution LIKE 'Paid by the weekly payout runner in round 2 after 5 refused attempt%') FROM public.financial_alerts WHERE source='weekly_payout_club_refused')","no club held; the alert resolved")
  +ok(f"(SELECT phase='released' FROM public.weekly_accounting_payout_pauses WHERE run_id='{RUN2}') AND (SELECT array_agg(round_no ORDER BY round_no) FROM public.accounting_routed_settlement_runs WHERE period_start='{WS2}')=ARRAY[2,3]","run released; one settlement run row per round"))
# Union-wide conservation for week 2, and the union receipts equal the whole week (single-pass totals).
T2=json.loads(one(f"""SELECT jsonb_build_object('r1',(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r1'),'kept',(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r1_retained'),
 'debited',(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND from_type='union_wallet'),
 'r3',(SELECT sum(amount) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r3'),'owed',(SELECT sum(c.rakeback_amount) FROM public.accounting_rakeback_period_calculations c JOIN public.rakeback_periods p ON p.id=c.period_id
   WHERE p.period_start=(TIMESTAMPTZ '{WS2}' AT TIME ZONE 'America/Los_Angeles')::date AND c.id=(SELECT max(z.id) FROM public.accounting_rakeback_period_calculations z WHERE z.period_id=c.period_id)),
 'r2_commission',(SELECT sum(amount-COALESCE((metadata->>'rakeback_funding')::numeric,0)) FROM rr.legs WHERE chain_seq>{MARK2} AND stage='r2' AND from_type='club_treasury'),
 'fund_from_bank',(SELECT sum(CASE WHEN stage='fund' THEN amount ELSE COALESCE((metadata->>'rakeback_funding')::numeric,0) END) FROM rr.legs WHERE chain_seq>{MARK2} AND stage IN('r2','fund') AND from_type='club_treasury'))::text"""))
assert D2(T2['debited'])==float(sum(h[2] for h in HANDS2))==round(D2(T2['r1'])+D2(T2['kept']),2) and D2(T2['r3'])==D2(T2['owed']),T2
assert D2(R3W['amount'])==D2(T2['owed']) and R3W['payees']==7 and D2(R2W['amount'])==D2(T2['r2_commission']),(R2W,R3W,T2)
assert D2(R2W['rakeback_cascade']['funding_from_bank'])==D2(T2['fund_from_bank']) and R2W['rakeback_cascade']['reserve_rows_added']==6,R2W['rakeback_cascade']
assert FW['ledger_ids']==[] and all(e['state']=='already_funded' for e in FW['edges']),FW
case('week 2 conserves union-wide: union debit = club credits + union retained = rake banked; players received exactly the latest certificates; the union round 2 receipt is the whole week (commission, funding from banks and reserve rows of every club, both passes), round 3 the whole week (7 payees), and the funding step sent nothing twice')
case('interruption and retries: for every released reserve (week 1, where round 2 and round 3 were each killed once and rerun, and week 2, paid over two passes per round) what was reserved equals exactly what round 3 then paid that player from that wallet',
  ok("""NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves w JOIN public.rakeback_periods p ON p.id=w.period_id
   WHERE w.reserved IS DISTINCT FROM (SELECT sum(l.amount) FROM public.chip_ledger l WHERE l.category='rakeback' AND l.to_type='player_wallet' AND l.from_type='agent_wallet'
     AND l.from_entity_id=w.user_id AND l.to_entity_id=p.user_id AND l.club_id=w.club_id AND l.metadata->>'period_id'=w.period_id::text)
    OR w.remaining<>0)""","reserved = paid, per period and wallet; nothing remains")
  +ok("(SELECT count(*) FROM smarter_private.weekly_payout_wallet_reserves)>=13","both weeks' reserves are compared"))
# ================================================================ WEEK 3
clock('2026-11-23 12:00:00+00')
q("""SELECT rr.club('V'); SELECT rr.agent('V','VA',NULL,0.30,'super_agent'); SELECT rr.agent('V','VB','VA',0,'agent'); SELECT rr.member('V','VP','VB',0.50);""")
clock('2026-11-30 07:00:00+00')
HANDS3=[('O','OP1',100,'2026-11-24 03:10:00+00'),('W','WP1',60,'2026-11-24 04:40:00+00'),('W','WP2',50,'2026-11-25 13:00:00+00'),
        ('T','TP',70,'2026-11-25 15:10:00+00'),('T','TR',50,'2026-11-26 19:30:00+00'),('V','VP',100,'2026-11-27 10:00:00+00')]
for c,p,rake,at in HANDS3: q(f"SELECT rr.hand('{c}','{p}',{rake},'{at}');")
WS3=wk('2026-11-25 12:00+00'); DAY3='2026-11-30'
MARK3=one("SELECT max(chain_seq) FROM public.chip_ledger")
DAY2=DAY3; i=0
prepare(DAY3)
# The cross-club dependency: V's upline VA recorded in club O at the agreement time (one inserted history row).
q("""INSERT INTO public.accounting_agreement_history OVERRIDING SYSTEM VALUE SELECT (jsonb_populate_record(NULL::public.accounting_agreement_history,
   to_jsonb(h)||jsonb_build_object('id',(SELECT max(id)+1 FROM public.accounting_agreement_history),'after_terms',h.after_terms||jsonb_build_object('club_id',rr.u('O')),'transaction_id',h.transaction_id::text||'9'))).*
  FROM public.accounting_agreement_history h WHERE h.entity_type='agents' AND h.entity_key=(SELECT id::text FROM public.agents WHERE club_id=rr.u('V') AND user_id=rr.u('VA')) ORDER BY h.observed_at DESC,h.id DESC LIMIT 1;""")
while True:
    r=tk(); s=stage(r)
    if s=='rounds_booked': RUN3=J_(r)['run_id']; break
    assert r['rc']==0,r
r=tk(); assert stage(r)=='round_paid' and J_(r)['round']==1,r
MARKR2=one("SELECT max(chain_seq) FROM public.chip_ledger")
r=tk(); j=J_(r) if r["rc"]==0 else None
assert r["rc"]==0,r
held={h['club_id']:h['code'] for h in j['receipt']['held_clubs']}
assert stage(r)=='round_clubs_held' and held=={U('V'):'rakeback_cascade_parent_outside_club',U('O'):'rakeback_cascade_parent_outside_club'} and sorted(j['receipt']['paid_now'])==sorted([U('T'),U('W')]),r
case('cross-club dependency: V\'s plan finds its upline recorded in club O, so V AND O are both held in round 2 (rakeback_cascade_parent_outside_club, detail names both); T and W are planned on their own and paid',
  ok(f"NOT EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARKR2} AND club_id IN(rr.u('V'),rr.u('O')))","no leg for V or O")
  +ok(f"NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id IN(rr.u('V'),rr.u('O')) AND period_start='{WS3}')","no reserve for V or O")
  +ok(f"({cr('O',2,WS3)}->'detail'->'clubs') @> to_jsonb(ARRAY[rr.u('V'),rr.u('O')]) AND ({cr('O',2,WS3)}->'detail'->>'planned_club')=rr.u('V')::text","O held by V's refusal")
  +ok(f"EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARKR2} AND club_id=rr.u('T') AND stage='r2') AND EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARKR2} AND club_id=rr.u('W') AND stage='fund')","T and W paid"))
# AG's account is deleted after round 2 passed T's funding through it.
q("UPDATE public.profiles SET status='deleted' WHERE id=rr.u('AG');")
r=tk(); j=J_(r) if r["rc"]==0 else None
assert r["rc"]==0,r
held3={h['club_id']:h['code'] for h in j['receipt']['held_clubs']}
assert stage(r)=='round_clubs_held' and j['round']==3 and held3=={U('T'):'rakeback_cascade_upline_deleted_after_funding',U('V'):'weekly_payout_club_round2_not_paid',U('O'):'weekly_payout_club_round2_not_paid'} and j['receipt']['paid_now']==[U('W')],r
WS3D=f"(TIMESTAMPTZ '{WS3}' AT TIME ZONE 'America/Los_Angeles')::date"
case('deleted upline in one club: after round 2 funded T through AG, AG\'s account is deleted; round 3 holds T alone (rakeback_cascade_upline_deleted_after_funding), pays W\'s players in full and keeps T\'s players\' share reserved; V and O stay held from round 2',
  ok(f"NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE club_id=rr.u('W') AND period_start={WS3D} AND status<>'paid') AND NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE club_id IN(rr.u('T'),rr.u('V'),rr.u('O')) AND period_start={WS3D} AND status<>'pending')","only W's periods paid")
  +ok(f"NOT EXISTS(SELECT 1 FROM rr.legs WHERE chain_seq>{MARKR2} AND stage='r3' AND club_id<>rr.u('W'))","no round 3 leg outside W")
  +ok(f"(SELECT sum(remaining) FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('T') AND period_start='{WS3}')>0 AND NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE club_id=rr.u('W') AND remaining>0)","T reserved, W released"))
w_paid=one(DIG_PAID("rr.u('W')",MARK3)); alld=one("SELECT rr.digest()")
rounds=[]
for _ in range(4):
    r=tk(); assert r['rc']==0 and stage(r)=='round_clubs_held',r; rounds.append(J_(r)['round'])
assert sorted(set(rounds))==[2,3] and one(DIG_PAID("rr.u('W')",MARK3))==w_paid and one("SELECT rr.digest()")==alld,(rounds,'a retry moved something')
fin=q(f"BEGIN;SELECT smarter_private.weekly_payout_finalize('{RUN3}');ROLLBACK;",check=False)
assert fin.returncode!=0 and 'weekly_payout_club_still_held' in fin.stderr
assert one(f"SELECT count(*) FROM public.financial_alerts WHERE source='weekly_payout_club_refused' AND NOT resolved")=='3'
case('week 3 held: later ticks alternate the two held units (round 2 for V and O, round 3 for T, least recently tried first) and move nothing; W stays paid; three open alerts (V and O in round 2, T in round 3; a round 3 hold inherited from round 2 is not alerted twice); finalize refuses and the union week is never marked complete')
