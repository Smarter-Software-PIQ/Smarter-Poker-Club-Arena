# Cases for test-rakeback-cascade-real-guards-postgres.py (exec'd by the harness).
D1="(rg.ws() AT TIME ZONE 'America/Los_Angeles')::date"
ROUNDS=["SELECT rg.round1();","SELECT rg.round2();","SELECT rg.book_run();"]
# every cascade or round 3 leg has exactly one paid receipt from the real receipt trigger, of the right kind and amount
RECEIPTS=ok("""NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE (l.metadata->>'cascade'='rakeback-funding-v1' OR l.category IN('rakeback','commission'))
  AND (SELECT count(*) FROM public.settlement_invoices i WHERE i.source_ledger_id=l.id AND i.status='paid' AND i.chips_transferred AND i.message_sent AND i.invoice_number IS NOT NULL
        AND i.gross_amount=l.amount AND i.net_amount=l.amount AND i.deductions=0
        AND i.invoice_type=CASE WHEN l.from_type='union_wallet' THEN 'union_to_club' WHEN l.from_type='club_treasury' AND l.to_type='agent_wallet' THEN 'club_to_agent'
           WHEN l.from_type='agent_wallet' AND l.to_type='agent_wallet' THEN 'agent_to_subagent' WHEN l.from_type='agent_wallet' AND l.to_type='player_wallet' THEN 'agent_to_player' ELSE 'transaction_receipt' END)<>1)""",
  "every funding, commission and rakeback leg has exactly one paid receipt of the right kind and amount")+ok("(SELECT count(*) FROM public.settlement_invoices)=(SELECT count(*) FROM public.chip_ledger WHERE from_type<>'system_mint')","no leg has a second receipt and no receipt lacks a leg")
# what the journal says moved equals what each balance holds (every store this fixture touches), and the commit-time invariant recorded nothing
BOOKS=ok("""NOT EXISTS(SELECT 1 FROM(
   SELECT 'agent_wallet' t,a.user_id e,a.club_id c,a.agent_wallet_balance b FROM public.agents a UNION ALL
   SELECT 'club_treasury',c.id,c.id,c.chip_treasury FROM public.clubs c UNION ALL
   SELECT 'player_wallet',m.user_id,m.club_id,m.chip_balance FROM public.club_members m UNION ALL
   SELECT 'union_wallet',w.union_id,NULL,w.rake_wallet FROM public.union_wallets w)s
  WHERE s.b IS DISTINCT FROM COALESCE((SELECT sum(CASE WHEN l.to_type=s.t AND l.to_entity_id=s.e THEN l.amount ELSE 0 END)-sum(CASE WHEN l.from_type=s.t AND l.from_entity_id=s.e THEN l.amount ELSE 0 END)
     FROM public.chip_ledger l WHERE (l.to_type=s.t AND l.to_entity_id=s.e OR l.from_type=s.t AND l.from_entity_id=s.e) AND (s.t IN('club_treasury','union_wallet') OR l.club_id=s.c)),0))""",
  "every wallet, bank and union balance equals the net of its journal legs")+ok("(SELECT count(*) FROM public.ca_ledger_invariant_findings)=0 AND (SELECT count(*) FROM public.ca_ledger_invariant_refusals)=0","the commit-time ledger invariant found and refused nothing")
CONSERVED=ok("rg.money()=(SELECT sum(amount) FROM public.chip_ledger WHERE from_type='system_mint')","no chip was created or destroyed")
VALID=ok("""(SELECT bool_and(CASE WHEN c.payer_kind='split' OR EXISTS(SELECT 1 FROM public.accounting_rakeback_payer_transfers t WHERE t.payout_id=p.id) THEN smarter_private.split_rakeback_payout_complete(p.id,c.id) ELSE true END
   AND CASE WHEN EXISTS(SELECT 1 FROM public.accounting_rakeback_wallet_transfers t WHERE t.payout_id=p.id) THEN smarter_private.rakeback_wallet_payout_complete(p.id,c.id) ELSE true END)
  FROM public.rakeback_period_payouts p JOIN LATERAL(SELECT x.* FROM public.accounting_rakeback_period_calculations x WHERE x.period_id=p.rakeback_period_id ORDER BY x.id DESC LIMIT 1)c ON true)""","the production payout validators accept every payout of the week")
ALLPAID=ok("NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE status<>'paid') AND (SELECT count(*) FROM public.rakeback_period_payouts)=(SELECT count(*) FROM public.rakeback_periods)","every period is paid once")\
  +ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0 OR released_at IS NULL)","every players' share reserved for the week was released by round 3 (20261111132447)")
# (viii) the production reconciliation readers find nothing: the nightly club treasury positions, the member chip drift, the negative-balance sweep
RECON=ok("NOT EXISTS(SELECT 1 FROM public.fn_ca_treasury_positions() p WHERE p.severity<>'ok' OR p.unbaselined) AND (SELECT count(*) FROM public.fn_ca_treasury_positions())=(SELECT count(*) FROM public.clubs WHERE chip_treasury<>0)","fn_ca_treasury_positions: every club bank equals its baseline plus its journal")\
  +ok("NOT EXISTS(SELECT 1 FROM public.fn_chip_drift_since_baseline() d WHERE d.drift<>0) AND (SELECT count(*) FROM public.fn_chip_drift_since_baseline())=(SELECT count(*) FROM public.club_members)","fn_chip_drift_since_baseline: no member wallet drifts from its journal")\

RECON_READERS=RECON
RECON=RECON_READERS+ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE agent_wallet_balance<0 OR agent_wallet_balance IS DISTINCT FROM business_balance) AND NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE description LIKE 'auto-ledgered%' OR from_type='settlement_suspense' OR to_type='settlement_suspense')","no negative or unsynced agent wallet; no auto-journalled or suspense leg")
CHECKS=RECEIPTS+BOOKS+CONSERVED+VALID+ALLPAID+RECON
# The same checks for a board that holds deleted uplines. The fixture's round 2 credits a deleted agent its commission without the
# real stage's pinned recipients, so production's own deleted-wallet return (fn_ca_deleted_wallet_bank_return) sends that commission
# back to the club bank through the autoledger. Those returns, from exactly the deleted accounts, are the only auto-journalled legs allowed.
def CHECKS_GONE(*dead):
  ids=','.join(f"rg.u('{d}')" for d in dead)
  return RECEIPTS+BOOKS+CONSERVED+VALID+ALLPAID+RECON_READERS+ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE agent_wallet_balance<0 OR agent_wallet_balance IS DISTINCT FROM business_balance) AND NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.from_type='settlement_suspense' OR l.to_type='settlement_suspense' OR (l.description LIKE 'auto-ledgered%' AND NOT(l.category='club_bank_claim' AND l.from_type='agent_wallet' AND l.to_type='club_treasury' AND l.from_entity_id IN("+ids+") AND l.metadata->>'cascade' IS NULL)))"
    +" AND (SELECT COALESCE(sum(l.amount),0) FROM public.chip_ledger l WHERE l.description LIKE 'auto-ledgered%')=(SELECT COALESCE(sum(l.amount),0) FROM public.chip_ledger l WHERE l.category='commission' AND l.to_type='agent_wallet' AND l.to_entity_id IN("+ids+"))",
    "no negative or unsynced agent wallet, no suspense leg; the only auto-journalled legs return the deleted accounts' own round 2 commission to the club bank, in full")
def U(min=0.20): return f"SELECT rg.onion('U',{min});"
def players(club,ps): return ''.join(f"SELECT rg.member('{club}','{p}',{('NULL' if up is None else repr(up))},{pct});SELECT rg.source('{club}','{p}',{rake});" for p,up,pct,rake in ps)+f"SELECT rg.certify('{club}',p) FROM unnest(ARRAY[{','.join(repr(p[0]) for p in ps)}])p;"

# (i) zero-percent top-level agent with players
case('i. zero-percent top-level agent: club bank -> agent -> players',[U(0)+"SELECT rg.club('Z');SELECT rg.agent('Z','ZA',NULL,0);"+players('Z',[('ZP1','ZA',0.30,100),('ZP2','ZA',0.10,50)])]+ROUNDS+[TICK,
  ok("rg.leg('Z',NULL,'ZA')=35.00 AND (SELECT count(*) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')=1","one club bank -> agent leg for the whole need")
  +ok("(SELECT category||'/'||from_type||'/'||to_type FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')='club_bank_send/club_treasury/agent_wallet'","the leg is a club_bank_send from the club bank")
  +ok("rg.wallet('Z','ZA')=0 AND rg.chips('Z','ZP1')=30 AND rg.chips('Z','ZP2')=5 AND rg.bank('Z')=135-35","the agent retains nothing; players are paid; the bank paid only the need")+CHECKS])

# (ii) three tiers with the need at the bottom
case('ii. three tiers: club bank -> super agent -> agent -> sub agent -> players',[U()+"SELECT rg.club('T');SELECT rg.agent('T','SA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('T','AG','SA',0.20);SELECT rg.agent('T','SUB','AG',0.20,'2026-10-20 12:00+00','sub_agent');"
  +players('T',[('TP','SUB',0.50,100)])]+ROUNDS+[TICK,
  ok("rg.leg('T',NULL,'SA')=30 AND rg.leg('T','SA','AG')=30 AND rg.leg('T','AG','SUB')=30","the 30.00 need travels bank -> SA -> AG -> SUB, one leg per edge")
  +ok("(SELECT string_agg(category,',' ORDER BY created_at,chain_seq) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')='club_bank_send,agent_send,agent_send'","parents are funded before children")
  +ok("rg.wallet('T','SUB')=0 AND rg.wallet('T','AG')=16 AND rg.wallet('T','SA')=19.2 AND rg.chips('T','TP')=50","each agent retains exactly its own commission; the player is paid 50.00")+CHECKS])

OWNER_LEGS="(SELECT count(*) FROM public.chip_ledger l WHERE l.category='rakeback' AND l.metadata->>'cascade_route'='owner_wallet')"
# (iii) owner upline, the owner already has an active agent row
case('iii. owner upline with an existing active owner row: club bank -> owner agent wallet -> players',[U()+"SELECT rg.club('O');SELECT rg.agent('O','O.owner',NULL,0.20,'2026-10-20 12:00+00','super_agent');"
  +players('O',[('OP1','O.owner',0.70,100),('OP2','O.owner',0.70,40)])]+ROUNDS+[
  "CREATE TABLE rg.before AS SELECT to_jsonb(a)-'agent_wallet_balance'-'business_balance'-'updated_at' j FROM public.agents a WHERE club_id=rg.u('O');",TICK,
  ok("rg.leg('O',NULL,'O.owner')=98.00","the club bank funds the owner agent wallet with everything its players are owed")
  +ok(OWNER_LEGS+"=2 AND NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.category='rakeback' AND l.to_type='player_wallet' AND (l.from_type<>'agent_wallet' OR l.from_entity_id<>rg.u('O.owner')))","round 3 pays both players from the owner agent wallet")
  +ok("rg.wallet('O','O.owner')=0 AND rg.chips('O','OP1')=70 AND rg.chips('O','OP2')=28 AND rg.bank('O')=126-98","nothing rests in the owner wallet; the bank keeps the owner tier")
  +ok("(SELECT j FROM rg.before)=(SELECT to_jsonb(a)-'agent_wallet_balance'-'business_balance'-'updated_at' FROM public.agents a WHERE club_id=rg.u('O'))","the owner's existing agreement row is untouched")+CHECKS])

# (iv) owner upline, no owner row: the real ensure function creates wallet_only under the real agents trigger stack
case('iv. owner upline with no owner row: wallet_only created, funded, then debited by round 3',[U()+"SELECT rg.club('W');"+players('W',[('WP1','W.owner',0.30,100),('WP2','W.owner',0.25,80)])]+ROUNDS+[
  ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=rg.u('W'))","the owner has no agent row before the run"),TICK,
  ok("(SELECT status||'/'||commission_rate||'/'||player_rakeback_rate||'/'||role||'/'||COALESCE(parent_agent_id::text,'-')||'/'||is_prepaid FROM public.agents WHERE club_id=rg.u('W') AND user_id=rg.u('W.owner'))='wallet_only/0.0000/0.0000/super_agent/-/true'","the real ensure function created a wallet_only row that earns nothing")
  +ok("(SELECT count(*) FROM public.accounting_agreement_history WHERE entity_type='agents' AND club_id=rg.u('W') AND after_terms->>'status'='wallet_only')=1","the real agreement capture recorded the wallet_only row")
  +ok("rg.leg('W',NULL,'W.owner')=50.00 AND "+OWNER_LEGS+"=2 AND rg.wallet('W','W.owner')=0 AND rg.chips('W','WP1')=30 AND rg.chips('W','WP2')=20 AND rg.bank('W')=162-50","funded 50.00, both players paid from the owner wallet, which ends empty")
  +CHECKS,("SELECT public.fn_accounting_agent_terms_at(rg.u('W'),rg.u('W.owner'),now());",'accounting_terms_not_active')])

# (v) unassigned player keeps the club bank route
case('v. unassigned player: club bank -> player, no funding leg',[U()+"SELECT rg.club('N');"+players('N',[('NP',None,0.05,200)])]+ROUNDS+[TICK,
  ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1') AND NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=rg.u('N'))","nothing is funded and no owner wallet is created")
  +ok("(SELECT from_type||'/'||from_entity_id FROM public.chip_ledger WHERE category='rakeback' AND to_type='player_wallet')='club_treasury/'||rg.u('N') AND rg.chips('N','NP')=10 AND "+OWNER_LEGS+"=0","the player is paid from the club bank, unmarked")+CHECKS])

# (vi) rerun and resume
SEED_MIX=U(0)+"SELECT rg.club('M');SELECT rg.agent('M','MA',NULL,0);"+players('M',[('MP1','MA',0.30,100),('MP2','M.owner',0.40,100),('MP3',None,0.05,100)])
SNAP="(SELECT md5(string_agg(l.id::text||l.amount::text,',' ORDER BY l.id))||(SELECT count(*) FROM public.settlement_invoices)||':'||rg.money()||':'||(SELECT string_agg(agent_wallet_balance::text,',' ORDER BY user_id) FROM public.agents) FROM public.chip_ledger l)"
case('vi-a. rerun: a second unit for a paid week is a duplicate and moves nothing',[SEED_MIX]+ROUNDS+[TICK,"CREATE TABLE rg.snap AS SELECT "+SNAP+" v;",
  "SELECT rg.ok((rg.tick3()->'receipt'->>'duplicate')='true','the second round 3 is the recorded duplicate');",
  ok("(SELECT v FROM rg.snap)="+SNAP,"no leg, receipt or balance changed on the rerun")+CHECKS])
FUNDONLY="SELECT smarter_private.weekly_payout_fund_agent_shortfalls((SELECT run_id FROM public.weekly_accounting_payout_pauses),'union',rg.u('U'),rg.ws(),rg.we());"
case('vi-b. resume: funding committed alone, then the unit resumes without funding twice',[SEED_MIX]+ROUNDS+[FUNDONLY,
  ok("rg.wallet('M','MA')=30 AND rg.wallet('M','M.owner')=40 AND (SELECT count(*) FROM public.rakeback_period_payouts)=0","funding is committed and nothing is paid yet")+RECEIPTS+BOOKS+CONSERVED,
  "SELECT rg.ok((SELECT bool_and(e->>'state'='already_funded') FROM jsonb_array_elements(rg.tick3()->'funding'->'edges')e),'every edge is already funded on resume');",
  ok("(SELECT count(*) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')=2 AND rg.wallet('M','MA')=0 AND rg.wallet('M','M.owner')=0 AND rg.chips('M','MP1')=30 AND rg.chips('M','MP2')=40 AND rg.chips('M','MP3')=5","each edge was funded once and every player is paid")+CHECKS])
SKIP_FUNDS="SELECT set_config('app.ledger_autoskip_clubs','1',true),set_config('app.ledger_autoskip_agents','1',true);"
case('vi-d. reserve under the real trigger stack: funding committed alone reserves each paying wallet\'s players\' share; a debit of it is refused with the specific error; the unit then pays and releases it',[SEED_MIX]+ROUNDS+[FUNDONLY,
  ok("(SELECT count(*)=2 AND sum(remaining)=70 AND bool_and(set_by='funding') FROM smarter_private.weekly_payout_wallet_reserves) AND (SELECT remaining FROM smarter_private.weekly_payout_wallet_reserves WHERE user_id=rg.u('MA'))=30 AND (SELECT remaining FROM smarter_private.weekly_payout_wallet_reserves WHERE user_id=rg.u('M.owner'))=40","MA reserves 30.00 for MP1, the owner wallet 40.00 for MP2; nothing for the bank-paid MP3"),
  (SKIP_FUNDS+"UPDATE public.clubs SET chip_treasury=chip_treasury+1 WHERE id=rg.u('M');UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-1 WHERE club_id=rg.u('M') AND user_id=rg.u('MA');","agent_wallet_weekly_rakeback_reserved: agent "),
  (SKIP_FUNDS+"UPDATE public.clubs SET chip_treasury=chip_treasury+40 WHERE id=rg.u('M');UPDATE public.agents SET agent_wallet_balance=0 WHERE club_id=rg.u('M') AND user_id=rg.u('M.owner');","at most 0.00 can leave this wallet"),
  "SELECT rg.ok((SELECT bool_and(e->>'state'='already_funded') FROM jsonb_array_elements(rg.tick3()->'funding'->'edges')e),'the unit funds nothing twice');",
  ok("rg.chips('M','MP1')=30 AND rg.chips('M','MP2')=40 AND rg.wallet('M','MA')=0 AND rg.wallet('M','M.owner')=0","players paid from the reserved wallets")+CHECKS])
case('vi-c. partial failure: round 3 refused after funding rolls the whole unit back, then it resumes',[SEED_MIX]+ROUNDS+[
  ("SET LOCAL app.weekly_accounting_scope_deadline='not-a-timestamp';"+TICK,'invalid input syntax for type timestamp'),
  ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1') AND NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=rg.u('M') AND user_id=rg.u('M.owner')) AND rg.wallet('M','MA')=0","the refused unit left no funding leg and no owner wallet"),
  TICK,CHECKS])

# (vii) the maintenance freeze
FREEZE="INSERT INTO public.engine_maintenance_break(phase,announced_at,break_started_at,break_ends_at,enforce_freeze,ownership_token) VALUES('counting_down',clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes',true,gen_random_uuid());SELECT rg.ok(public.fn_platform_frozen(),'the platform is frozen');"
THAW="DELETE FROM public.engine_maintenance_break;"
case('vii-a. frozen while funding is attempted: refused whole, then pays after the thaw',[SEED_MIX]+ROUNDS+[FREEZE,(TICK,'PLATFORM_FROZEN'),
  ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1' OR category='rakeback' AND to_type='player_wallet') AND NOT EXISTS(SELECT 1 FROM public.agents WHERE user_id=rg.u('M.owner'))","the frozen unit committed nothing"),
  THAW,TICK,CHECKS])
case('vii-b. frozen with nothing to fund: round 3 alone runs under the weekly run capability',[U()+"SELECT rg.club('N');"+players('N',[('NP',None,0.05,200)])]+ROUNDS+[FREEZE,TICK,
  ok("rg.chips('N','NP')=10","round 3, inside its owned transaction, paid during the freeze")+CHECKS])

# (d) a payer or an upline whose profile is deleted (fn_ca_deleted_wallet_credit is live on agents)
GONE=lambda who,club:f"UPDATE public.agents SET status='suspended' WHERE club_id=rg.u('{club}') AND user_id=rg.u('{who}');UPDATE public.profiles SET status='deleted' WHERE id=rg.u('{who}');"
case('d-1. deleted direct payer: funded, held by the published-rakeback reserve, and pays its player',[U()+"SELECT rg.club('D');SELECT rg.agent('D','DA',NULL,0.20);"+players('D',[('DP','DA',0.50,100)]),"SELECT rg.round1();",GONE('DA','D'),"SELECT rg.round2();","SELECT rg.book_run();",
  ok("rg.wallet('D','DA')=20","the deleted payer's commission is held back for the rakeback it has published"),TICK,
  ok("rg.leg('D',NULL,'DA')=30 AND rg.wallet('D','DA')=0 AND rg.chips('D','DP')=50 AND rg.bank('D')=40","funding stayed in the deleted payer's wallet until round 3 paid the player from it")+CHECKS])
# A deleted upline is routed around: the path skips it and continues to its nearest live upline, or the club bank (owner decision 2026-11-09).
NO_DEAD=lambda club,*dead:ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger l WHERE l.metadata->>'cascade'='rakeback-funding-v1' AND (l.to_entity_id IN("+','.join(f"rg.u('{d}')" for d in dead)+") OR l.from_entity_id IN("+','.join(f"rg.u('{d}')" for d in dead)+"))) AND "+' AND '.join(f"rg.wallet('{club}','{d}')=0" for d in dead),"no funding leg enters or leaves a deleted account, and its wallet holds nothing")
FUND_LEGS=lambda n:ok(f"(SELECT count(*) FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')={n}",f"exactly {n} funding leg(s), one per live edge")
SKIPPED=lambda *dead:"SELECT rg.ok((SELECT array_agg(e->>'user_id' ORDER BY e->>'user_id') FROM jsonb_array_elements(f->'skipped_deleted_uplines')e)=(SELECT array_agg(x::text ORDER BY x::text) FROM unnest(ARRAY["+','.join(f"rg.u('{d}')" for d in dead)+"])x),'the plan names the deleted uplines it skipped') FROM(SELECT smarter_private.weekly_payout_fund_agent_shortfalls((SELECT run_id FROM public.weekly_accounting_payout_pauses),'union',rg.u('U'),rg.ws(),rg.we()) f)z;"
RERUN=["CREATE TABLE rg.snap AS SELECT "+SNAP+" v;","SELECT rg.ok((rg.tick3()->'receipt'->>'duplicate')='true','the second unit is the recorded duplicate');",ok("(SELECT v FROM rg.snap)="+SNAP,"no leg, receipt or balance changed on the rerun")]
# d-2: the deleted account sits in the MIDDLE: super agent (live) -> agent (deleted) -> sub agent (payer)
MID=[U()+"SELECT rg.club('E');SELECT rg.agent('E','ESA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('E','EAG','ESA',0.20);SELECT rg.agent('E','ESUB','EAG',0.20,'2026-10-20 12:00+00','sub_agent');"
  +players('E',[('EP','ESUB',0.50,100)]),"SELECT rg.round1();",GONE('EAG','E'),"SELECT rg.round2();","SELECT rg.book_run();"]
case('d-2. deleted upline in the middle of the chain: routed around it, bank -> super agent -> sub agent, players paid',MID+[
  ok("rg.wallet('E','EAG')=0 AND rg.wallet('E','ESA')=19.2 AND rg.wallet('E','ESUB')=20 AND rg.bank('E')=90-19.2-20","before funding: the deleted agent's own commission already went back to the club bank; the live tiers hold theirs"),
  SKIPPED('EAG'),
  ok("rg.leg('E',NULL,'ESA')=30 AND rg.leg('E','ESA','ESUB')=30 AND rg.leg('E','ESA','EAG') IS NULL AND rg.leg('E','EAG','ESUB') IS NULL AND rg.leg('E',NULL,'ESUB') IS NULL","the 30.00 need travels bank -> ESA -> ESUB; each live hop receives exactly what passes through it")
  +FUND_LEGS(2)+NO_DEAD('E','EAG')
  +ok("rg.wallet('E','ESA')=19.2+30-30 AND rg.wallet('E','ESUB')=50 AND rg.bank('E')=50.8-30 AND (SELECT count(*) FROM public.rakeback_period_payouts)=0","funding committed alone: the super agent keeps only its commission, the payer holds what its player is owed")+RECEIPTS+BOOKS+CONSERVED,
  "SELECT rg.ok((SELECT bool_and(e->>'state'='already_funded') AND count(*)=2 FROM jsonb_array_elements(rg.tick3()->'funding'->'edges')e),'on resume both edges are already funded and nothing is sent twice');",
  FUND_LEGS(2)+NO_DEAD('E','EAG')+ok("rg.wallet('E','ESUB')=0 AND rg.wallet('E','ESA')=19.2 AND rg.chips('E','EP')=50 AND rg.bank('E')=20.8","the player is paid 50.00 by its agent; the bank paid the 30.00 need once")+CHECKS_GONE('EAG')]+RERUN+[CHECKS_GONE('EAG')])
# d-3: two consecutive uplines are deleted: super agent (live) -> agent (deleted) -> agent (deleted) -> sub agent (payer)
TWO=[U()+"SELECT rg.club('G');SELECT rg.agent('G','GSA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('G','GA1','GSA',0.20);SELECT rg.agent('G','GA2','GA1',0.20);SELECT rg.agent('G','GSUB','GA2',0.20,'2026-10-20 12:00+00','sub_agent');"
  +players('G',[('GP','GSUB',0.30,100)]),"SELECT rg.round1();",GONE('GA1','G'),GONE('GA2','G'),"SELECT rg.round2();","SELECT rg.book_run();"]
case('d-3. two consecutive deleted uplines: both skipped, bank -> super agent -> sub agent',TWO+[
  "CREATE TABLE rg.pre AS SELECT rg.wallet('G','GSA') sa,rg.wallet('G','GSUB') sub,rg.bank('G') bank;",
  ok("rg.wallet('G','GA1')=0 AND rg.wallet('G','GA2')=0 AND (SELECT sub FROM rg.pre)=20","before funding: both deleted wallets are empty; the payer holds its 20.00 commission"),
  SKIPPED('GA1','GA2'),
  ok("rg.leg('G',NULL,'GSA')=10 AND rg.leg('G','GSA','GSUB')=10 AND rg.leg('G',NULL,'GSUB') IS NULL","bank -> GSA 10.00, GSA -> GSUB 10.00 (30.00 owed, 20.00 covered by the payer's own commission)")+FUND_LEGS(2)+NO_DEAD('G','GA1','GA2'),
  TICK,
  FUND_LEGS(2)+NO_DEAD('G','GA1','GA2')+ok("rg.wallet('G','GSUB')=0 AND rg.wallet('G','GSA')=(SELECT sa FROM rg.pre) AND rg.chips('G','GP')=30 AND rg.bank('G')=(SELECT bank FROM rg.pre)-10","the player is paid; the live super agent retains exactly its commission; the bank paid the need once")+CHECKS_GONE('GA1','GA2')]+RERUN+[CHECKS_GONE('GA1','GA2')])
# d-4: the TOP-LEVEL upline is deleted: the club bank pays the next live agent directly
TOP=[U()+"SELECT rg.club('E');SELECT rg.agent('E','ESA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('E','EAG','ESA',0.20);"+players('E',[('EP','EAG',0.50,100)]),"SELECT rg.round1();",GONE('ESA','E'),"SELECT rg.round2();","SELECT rg.book_run();"]
case('d-4. deleted top-level upline: the club bank funds the next live agent directly',TOP+[
  ok("rg.wallet('E','ESA')=0 AND rg.bank('E')=70 AND rg.wallet('E','EAG')=20","the deleted upline's own commission already went back to the club bank"),
  TICK,
  ok("rg.leg('E',NULL,'EAG')=30 AND rg.leg('E',NULL,'ESA') IS NULL AND rg.leg('E','ESA','EAG') IS NULL","one leg: club bank -> EAG 30.00")+FUND_LEGS(1)+NO_DEAD('E','ESA')
  +ok("(SELECT category||'/'||from_type FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')='club_bank_send/club_treasury'","it is a club_bank_send from the club bank")
  +ok("rg.wallet('E','EAG')=0 AND rg.chips('E','EP')=50 AND rg.bank('E')=40","the player is paid 50.00; the bank paid the 30.00 need once")+CHECKS_GONE('ESA')]+RERUN+[CHECKS_GONE('ESA')])
# d-5: the one shape that cannot be routed: the upline passed this week's funding down, and was deleted afterwards
case('d-5. an upline deleted AFTER it passed the week\'s funding down: refused, naming it, and nothing is sent twice',[U()+"SELECT rg.club('E');SELECT rg.agent('E','ESA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('E','EAG','ESA',0.20);"+players('E',[('EP','EAG',0.50,100)])]+ROUNDS+[FUNDONLY,
  ok("rg.leg('E',NULL,'ESA')=30 AND rg.leg('E','ESA','EAG')=30 AND rg.wallet('E','EAG')=50","funded through the live upline"),
  GONE('ESA','E'),"CREATE TABLE rg.snap AS SELECT "+SNAP+" v;",
  (TICK,'rakeback_cascade_upline_deleted_after_funding'),
  ok("(SELECT v FROM rg.snap)="+SNAP+" AND rg.leg('E',NULL,'EAG') IS NULL AND rg.wallet('E','EAG')=50","nothing moved: the agent was not funded a second time")+RECEIPTS+BOOKS+CONSERVED])

# (x) a week settled by the production round 3 BEFORE the cascade migration: validators and replay unchanged after it
LEG_SEED=U()+"SELECT rg.club('L');SELECT rg.agent('L','L.owner',NULL,0.20,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('L','LA',NULL,0.30);"+players('L',[('LP1','L.owner',0.70,100),('LP2','LA',0.10,100),('LP3',None,0.05,40)])\
  +"SELECT rg.member('L','LP4','L.owner',0.70);SELECT rg.source('L','LP4',100,'2026-11-03 12:00+00');SELECT rg.member('L','LP4','LA',0.10,'2026-11-05 00:00+00');SELECT rg.source('L','LP4',100,'2026-11-06 12:00+00');SELECT rg.certify('L','LP4');"
VSTR="(SELECT string_agg(p.user_id::text||'='||smarter_private.split_rakeback_payout_complete(p.id,c.id)::text||'/'||smarter_private.rakeback_wallet_payout_complete(p.id,c.id)::text,',' ORDER BY p.user_id) FROM public.rakeback_period_payouts p JOIN public.accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id)"
LSTR="(SELECT md5(string_agg(to_jsonb(l)::text,'|' ORDER BY l.id)) FROM public.chip_ledger l)"
case('x. legacy week paid by the production round 3 before the migration: validators, legs and replay unchanged after it',[LEG_SEED]+ROUNDS+["SELECT rg.tick3_round3_only();",
  ok("(SELECT count(*) FROM public.accounting_rakeback_period_calculations WHERE payer_kind='split')=1 AND (SELECT count(*) FROM public.rakeback_period_payouts)=4 AND NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata ? 'cascade_route')","four legacy payouts, one of them split, none marked")+RECEIPTS+BOOKS+CONSERVED,
  "CREATE TABLE rg.legacy AS SELECT "+VSTR+" v,"+LSTR+" l;",INSTALL_B,INSTALL_G,
  ok("(SELECT v FROM rg.legacy)="+VSTR+" AND (SELECT l FROM rg.legacy)="+LSTR,"both validators answer exactly as before the migration for every legacy payout, and no leg changed")
  +ok("(SELECT smarter_private.split_rakeback_payout_complete(p.id,c.id) FROM public.rakeback_period_payouts p JOIN public.accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id WHERE c.payer_kind='split') AND (SELECT count(*) FROM regexp_matches("+VSTR+",'=true/','g'))=1","the legacy split payout is complete under the patched split validator; it answers false for the three payouts that are not split, as before"),
  "SELECT rg.ok((rg.tick3()->'receipt'->>'duplicate')='true','the paid week replays as the recorded duplicate');",
  ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1') AND (SELECT l FROM rg.legacy)="+LSTR,"a paid week is never funded and no leg changed")+CHECKS],template='pre')

# (b) the journal guards are live in this fixture, and what they do to a leg written the wrong way
MOVE="UPDATE public.clubs SET chip_treasury=chip_treasury-5 WHERE id=rg.u('Z');UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+5 WHERE club_id=rg.u('Z') AND user_id=rg.u('ZA');"
LEG=lambda cat,key="'fixture-b'",ft="'club_treasury'":f"INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,idempotency_key) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d',{ft},rg.u('Z'),'agent_wallet',rg.u('ZA'),5,'{cat}',rg.u('Z'),{key});"
SKIP="SELECT set_config('app.ledger_autoskip_clubs','1',true),set_config('app.ledger_autoskip_agents','1',true);"
BSEED=[U(0)+"SELECT rg.club('Z');SELECT rg.agent('Z','ZA',NULL,0);"+players('Z',[('ZP1','ZA',0.30,100)]),"SELECT rg.round1();"]
case('b-1. autoskip with no leg: the commit-time invariant refuses the transaction',BSEED+[(SKIP+MOVE,'balance_moved_without_its_ledger_row')])
case('b-2. an explicit leg WITHOUT autoskip: the autoledger journals the same move again and the commit is refused',BSEED+[(MOVE+LEG('club_bank_send'),'REFUSED: balance_moved_')])
case('b-3. autoskip with the explicit club_bank_send leg: one leg, one receipt, committed',BSEED+[SKIP+MOVE+LEG('club_bank_send'),
  ok("(SELECT count(*) FROM public.chip_ledger WHERE club_id=rg.u('Z') AND to_type='agent_wallet')=1 AND (SELECT count(*) FROM public.settlement_invoices i JOIN public.chip_ledger l ON l.id=i.source_ledger_id WHERE l.idempotency_key='fixture-b' AND i.invoice_type='club_to_agent' AND i.status='paid')=1","exactly one journal leg and one paid receipt")+BOOKS+RECON])
case('b-4. a second leg under the same idempotency key is refused',BSEED+[SKIP+MOVE+LEG('club_bank_send'),(SKIP+MOVE+LEG('club_bank_send'),'duplicate key value')])
case('b-5. an undeclared chip store is refused by the store coverage guard',BSEED+[(SKIP+MOVE+LEG('club_bank_send',"'fixture-b'","'weekly_funding_pool'"),'is not declared in ca_chip_store_coverage')])
case('b-6. an agent_send leg between two agent wallets under autoskip: one leg, an agent_to_subagent receipt',[U()+"SELECT rg.club('T');SELECT rg.agent('T','SA',NULL,0.30,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('T','AG','SA',0.20);"+players('T',[('TP','AG',0.10,100)]),"SELECT rg.round1();","SELECT rg.round2();",
  "SELECT set_config('app.ledger_autoskip_agents','1',true);UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-5 WHERE club_id=rg.u('T') AND user_id=rg.u('SA');UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+5 WHERE club_id=rg.u('T') AND user_id=rg.u('AG');"
  +"INSERT INTO public.chip_ledger(performed_by,from_type,from_entity_id,to_type,to_entity_id,amount,category,club_id,idempotency_key) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','agent_wallet',rg.u('SA'),'agent_wallet',rg.u('AG'),5,'agent_send',rg.u('T'),'fixture-b6');",
  ok("(SELECT i.invoice_type||'/'||i.status||'/'||i.net_amount FROM public.settlement_invoices i JOIN public.chip_ledger l ON l.id=i.source_ledger_id WHERE l.idempotency_key='fixture-b6')='agent_to_subagent/paid/5.00'","one paid agent_to_subagent receipt")+BOOKS+RECON])

# (c) who may move these balances
case('c-1. the unit under a service_role request (PostgREST claims) passes the actor guards',[SEED_MIX]+ROUNDS+["SET LOCAL request.jwt.claims='{\"role\":\"service_role\"}';"+TICK,CHECKS])
case('c-2. the unit under an authenticated request is refused whole (round 3 requires the engine)',[SEED_MIX]+ROUNDS+[("SELECT set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',rg.u('MP1'))::text,true);"+TICK,'service_role_required'),
  ok("NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE metadata->>'cascade'='rakeback-funding-v1')","the funding it had written rolled back with it")])

# D5 under the real certificate triggers: only the latest certificate of a period is funded
case('D5. a superseded certificate is never funded: the latest certificate of the period decides',[U(0)+"SELECT rg.club('Z');SELECT rg.agent('Z','ZA',NULL,0);"+players('Z',[('ZP1','ZA',0.30,100)])+"SELECT rg.source('Z','ZP1',50);SELECT rg.certify('Z','ZP1');"]+ROUNDS+[
  ok("(SELECT count(*) FROM public.accounting_rakeback_period_calculations)=2 AND (SELECT sum(rakeback_amount) FROM public.accounting_rakeback_period_calculations)=75","two certificate versions exist for the period (30.00 then 45.00)"),TICK,
  ok("rg.leg('Z',NULL,'ZA')=45.00 AND rg.chips('Z','ZP1')=45 AND rg.wallet('Z','ZA')=0","funded and paid the latest certificate only")+CHECKS])

# (x) the validators on the new route: a split certificate with one share on the owner wallet route
case('x-2. split certificate, owner share paid from the owner wallet: the split validator accepts it',[U()+"SELECT rg.club('S');SELECT rg.agent('S','S.owner',NULL,0.20,'2026-10-20 12:00+00','super_agent');SELECT rg.agent('S','SG',NULL,0.30);"
  +"SELECT rg.member('S','SP','S.owner',0.70);SELECT rg.source('S','SP',100,'2026-11-03 12:00+00');SELECT rg.member('S','SP','SG',0.10,'2026-11-05 00:00+00');SELECT rg.source('S','SP',100,'2026-11-06 12:00+00');SELECT rg.certify('S','SP');"]+ROUNDS+[TICK,
  ok("(SELECT payer_kind FROM public.accounting_rakeback_period_calculations)='split' AND rg.leg('S',NULL,'S.owner')=70 AND rg.leg('S',NULL,'SG') IS NULL","a split certificate: 70.00 funded to the owner wallet, the agent share covered by its own commission")
  +ok("(SELECT string_agg(l.from_type||':'||l.amount||':'||COALESCE(l.metadata->>'cascade_route','-'),',' ORDER BY l.amount) FROM public.chip_ledger l WHERE l.category='rakeback' AND l.to_type='player_wallet')='agent_wallet:10.00:-,agent_wallet:70.00:owner_wallet'","two legs: the agent's from its wallet, the owner share from the owner wallet with its marker")
  +ok("(SELECT smarter_private.split_rakeback_payout_complete(p.id,c.id) FROM public.rakeback_period_payouts p JOIN public.accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id)","the production split validator, patched, accepts the payout")+CHECKS,
  # a marked leg whose funding leg is not the one it names is refused by the validator
  ok("(SELECT NOT smarter_private.rakeback_cascade_owner_leg_paid(l.id,l.club_id,'club',NULL) FROM public.chip_ledger l WHERE l.category='rakeback' AND l.metadata->>'cascade_route' IS NULL AND l.to_type='player_wallet')","an unmarked leg is never accepted as an owner route leg")])

# (x) the typed (own-agent-v1) validator on the new route: one certificate with an own agent wallet share and a player wallet share under the owner
case('x-3. typed certificate: the own agent wallet share stays on the club bank route, the player wallet share goes through the owner wallet; the wallet validator accepts it',[U()+"SELECT rg.club('Y');"
  +"SELECT rg.member('Y','YA','Y.owner',0.30);SELECT rg.source('Y','YA',100,'2026-11-03 12:00+00');SELECT rg.promote('Y','YA',0.20,'2026-11-04 12:00+00');SELECT rg.source('Y','YA',100,'2026-11-05 12:00+00');SELECT rg.certify('Y','YA');"]+ROUNDS+[
  ok("(SELECT count(*) FROM public.accounting_rakeback_wallet_contracts)=2","the production trigger recorded two typed wallet contracts (player wallet 30.00, own agent wallet 70.00)"),TICK,
  ok("(SELECT string_agg(l.from_type||'>'||l.to_type||':'||l.amount||':'||COALESCE(l.metadata->>'cascade_route','-'),',' ORDER BY l.amount) FROM public.chip_ledger l WHERE l.category='rakeback' AND l.from_type<>'union_wallet')='agent_wallet>player_wallet:30.00:owner_wallet,club_treasury>agent_wallet:70.00:-'","player wallet share from the owner wallet, own agent wallet share from the club bank")
  +ok("rg.leg('Y',NULL,'Y.owner')=30 AND rg.wallet('Y','Y.owner')=0 AND rg.wallet('Y','YA')=70 AND rg.chips('Y','YA')=30","funded 30.00 only; the owner wallet ends empty")
  +ok("(SELECT smarter_private.rakeback_wallet_payout_complete(p.id,c.id) FROM public.rakeback_period_payouts p JOIN public.accounting_rakeback_period_calculations c ON c.period_id=p.rakeback_period_id)","the production typed wallet validator, patched, accepts the payout")+CHECKS])

# the production guards named in the brief were actually executed by the unit (track_functions=all)
GUARDS=['fn_ca_autoledger','fn_ca_balance_has_its_ledger_row','fn_ca_tally_store_move','fn_ca_tally_balance_move','fn_ca_tally_ledger_leg','fn_ca_chip_store_declared','fn_ca_chip_ledger_enrich','enforce_chip_ledger_performed_by',
 'zz_chip_ledger_key_is_claimed_once','fn_refuse_while_frozen','fn_platform_frozen','fn_cashier_balance_actor_guard','fn_cashier_assert_active_actor','fn_cashier_operation_mutex_guard','guard_agent_wallet_direct_update','sync_agent_wallet_columns',
 'fn_ca_refuse_replica_money_write','fn_ca_deleted_wallet_credit','fn_accounting_transfer_document_on_insert','fn_invoice_accounting_ledger_transfer','fn_deliver_accounting_invoice','fn_ca_rakeback_payout_leg_is_documented',
 'fn_publish_agent_wallet_change','fn_publish_member_record_row','fn_accounting_agreement_capture','fn_guard_owner_routing_wallet','fn_enforce_agent_commission_bounds','fn_guard_agent_agreement','fn_guard_retired_club_mutation','fn_block_browser_balance_writes',
 'fn_ca_journal_append_only','fn_accounting_document_immutable','ensure_owner_routing_wallet','weekly_payout_require_round','weekly_payout_owns_round','weekly_payout_owned_money_write']
case('guards. every production guard named above ran inside the unit',[U()+"SELECT rg.club('W');"+players('W',[('WP1','W.owner',0.30,100)])]+ROUNDS+[FREEZE,THAW,"SELECT pg_stat_reset();",TICK,
  "SELECT rg.ok((SELECT array_agg(g ORDER BY g) FROM unnest(ARRAY["+','.join(repr(g) for g in GUARDS)+"])g WHERE NOT EXISTS(SELECT 1 FROM pg_stat_user_functions f WHERE f.funcname=g AND f.calls>0)) IS NULL,'guards that never ran: '||COALESCE((SELECT string_agg(g,',') FROM unnest(ARRAY["+','.join(repr(g) for g in GUARDS)+"])g WHERE NOT EXISTS(SELECT 1 FROM pg_stat_user_functions f WHERE f.funcname=g AND f.calls>0)),''));"])
