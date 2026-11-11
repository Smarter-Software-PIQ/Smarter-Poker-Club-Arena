# Exec'd by cases.py right after the runner's round 2 tick and before its round 3 tick (20261111132447).
# Every probe below is its own transaction and is rolled back; cases.py checks the board is unchanged afterwards.
DEBIT=json.loads((F/'debit-paths.json').read_text())  # production definitions (md5 read 2026-11-11) of the debit and credit doors (and their callees) the fixture does not load
# Lane K: the three tables the remaining doors need that the fixture world does not build (credit_payments,
# ca_manual_adjustments, ca_emergency_stops), read from production's catalog with SELECT only, built by lane C's world builder like
# every other relation (foreign keys dropped as everywhere in this harness). Their only trigger, credit_payments'
# accounting_credit_payment_document (the payment's document, a side-effect sink), is not wired.
DEBIT_REL=json.loads((F/'debit-paths-relations.json').read_text())
_s,_t,_d,_c,_i,_v,_f=world.tables_sql(DEBIT_REL)
LOAD_DEBIT='SET check_function_bodies=off;\n'+'\n'.join(_t+_d+_c+_i)+'\n'+''.join(v['def'].rstrip()+';\n' for v in DEBIT.values())+''.join(
  f"SELECT rr.ok(md5(pg_get_functiondef('{k.split('(')[0]}'::regproc))='{v['md5']}','debit door {k.split('(')[0]} loaded byte-exact');\n" for k,v in DEBIT.items())
def probe(name,sql,refusal=None):
    r=q('BEGIN;\n'+LOAD_DEBIT+sql+'\nROLLBACK;\n',check=False)
    if refusal: assert r.returncode!=0 and refusal in r.stderr,(name,r.stdout[-800:],r.stderr[-1500:])
    else: assert r.returncode==0,(name,r.stdout[-800:],r.stderr[-3000:])
    return r
AS_SA="SELECT set_config('request.jwt.claims',jsonb_build_object('sub',rr.u('SA'),'role','authenticated')::text,true);\n"
REFUSED='agent_wallet_weekly_rakeback_reserved: agent '
SA_REF=REFUSED+one("SELECT rr.u('SA')")+' in club '+one("SELECT rr.u('T')")+' holds 54.00 in its agent wallet and 6.00 of it is owed to its players'
SUB_REF=REFUSED+one("SELECT rr.u('SUB')")+' in club '+one("SELECT rr.u('T')")+' holds 50.00 in its agent wallet and 50.00 of it is owed to its players'
RES=[('TQ','SA',6),('TR','AG',5),('TP','SUB',50),('OP1','O.owner',10),('OP2','O.owner',8),('WP1','W.owner',30),('WP2','W.owner',12.5)]
RES_VALUES=','.join(f"(rr.u('{p}'),rr.u('{w}'),{a}::numeric)" for p,w,a in RES)
case('between round 2 and round 3: round 2 sent one leg per edge (bank -> SA 134.00, SA -> AG 80.00 carrying commission and funding; bank -> O.owner 18.00, bank -> W.owner 42.50, AG -> SUB 50.00 funding only) and reserved each paying wallet\'s players\' share, owed not only pass-through: 7 rows, 121.50',
  ok("(SELECT string_agg(stage||':'||round(amount,2),',' ORDER BY stage,amount) FROM rr.legs WHERE stage IN('r2','fund','r3'))='fund:18.00,fund:42.50,fund:50.00,r2:80.00,r2:134.00'","exactly five legs, all written by round 2, none by round 3 yet")
  +ok("rr.wallet('T','SA')=54 AND rr.wallet('T','AG')=30 AND rr.wallet('T','SUB')=50 AND rr.wallet('O','O.owner')=18 AND rr.wallet('W','W.owner')=42.5","each wallet holds what reached it")
  +ok(f"NOT EXISTS((SELECT p.user_id,w.user_id,w.remaining FROM smarter_private.weekly_payout_wallet_reserves w JOIN public.rakeback_periods p ON p.id=w.period_id) EXCEPT (VALUES {RES_VALUES})) AND NOT EXISTS((VALUES {RES_VALUES}) EXCEPT (SELECT p.user_id,w.user_id,w.remaining FROM smarter_private.weekly_payout_wallet_reserves w JOIN public.rakeback_periods p ON p.id=w.period_id))","the reserve per player and paying wallet is exactly what that wallet owes the player")
  +ok("(SELECT bool_and(set_by='round2' AND reserved=remaining AND released_at IS NULL AND scope_kind='union' AND scope_id=rr.u('U') AND period_start=rr.ws() AND period_end=rr.we()) FROM smarter_private.weekly_payout_wallet_reserves)","every reserve was set by round 2 for this scope and week"))
# THE GUARD on the real debit doors: the reserved part is refused with the specific error, the unreserved part moves.
probe('real agent send of 49.00 from SA (54.00 held, 6.00 reserved)',AS_SA+"SELECT public.fn_agent_wallet_send_core_20260830(rr.u('T'),rr.u('TQ'),49,'player_wallet','lane i probe',rr.u('op-send-49'));",SA_REF)
probe('real agent send of 48.00 from SA moves',AS_SA+"CREATE TEMP TABLE pr AS SELECT public.fn_agent_wallet_send_core_20260830(rr.u('T'),rr.u('TQ'),48,'player_wallet','lane i probe',rr.u('op-send-48')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SA')=6 AND rr.chips('T','TQ')=48","the unreserved 48.00 left SA's wallet; 6.00 stays for TQ"))
probe('real self stake of 49.00 by SA',AS_SA+"SELECT public.fn_agent_wallet_self_stake(rr.u('T'),49,'lane i probe',rr.u('op-stake-49'));",SA_REF)
probe('real self stake of 48.00 by SA moves',AS_SA+"CREATE TEMP TABLE pr AS SELECT public.fn_agent_wallet_self_stake(rr.u('T'),48,'lane i probe',rr.u('op-stake-48')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SA')=6","the unreserved 48.00 was staked; 6.00 stays"))
AS_TOWNER="SELECT set_config('request.jwt.claims',jsonb_build_object('sub',rr.u('T.owner'),'role','authenticated')::text,true);\n"
AS_SUB="SELECT set_config('request.jwt.claims',jsonb_build_object('sub',rr.u('SUB'),'role','authenticated')::text,true);\n"
# Lane J (20261111174403): four more production debit doors, byte-exact (debit-paths.json, md5 read 2026-11-11).
probe('real club bank claim of 49.00 from SA by the owner',AS_TOWNER+"SELECT public.fn_club_bank_claim_core_20261004(rr.u('T'),rr.u('SA'),49,'agent_wallet','lane j probe',rr.u('op-claim-49'));",SA_REF)
probe('real club bank claim of 48.00 from SA by the owner moves',AS_TOWNER+"CREATE TEMP TABLE pr AS SELECT public.fn_club_bank_claim_core_20261004(rr.u('T'),rr.u('SA'),48,'agent_wallet','lane j probe',rr.u('op-claim-48')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SA')=6","the unreserved 48.00 returned to the bank; 6.00 stays"))
probe('real horse club split agent wallet claim of 0.01 from SUB',"SELECT public.fn_ca_horse_split_wallet_leg(rr.u('op-split-1'),'agent_wallet_claim',rr.u('T'),rr.u('SUB'),0.01);",SUB_REF)
probe('real horse club split agent wallet claim of 48.00 from SA moves',"CREATE TEMP TABLE pr AS SELECT public.fn_ca_horse_split_wallet_leg(rr.u('op-split-2'),'agent_wallet_claim',rr.u('T'),rr.u('SA'),48) j;"
  +ok("(SELECT (j->>'wallet_after')::numeric FROM pr)=6 AND rr.wallet('T','SA')=6","the unreserved 48.00 moved; 6.00 stays"))
probe('real club bank reversal that would reach SUB\'s reserved share (send 10.00, SUB stakes the unreserved 10.00, the owner reverses the send)',
  AS_TOWNER+"CREATE TEMP TABLE s1 AS SELECT public.fn_club_bank_send_core_20261004(rr.u('T'),rr.u('SUB'),10,'agent_wallet','lane j probe',rr.u('op-rev-send')) j;"
  +ok("(SELECT j->>'success' FROM s1)='true' AND rr.wallet('T','SUB')=60","sent")
  +AS_SUB+"CREATE TEMP TABLE s2 AS SELECT public.fn_agent_wallet_self_stake(rr.u('T'),10,'lane j probe',rr.u('op-rev-stake')) j;"
  +ok("(SELECT j->>'success' FROM s2)='true' AND rr.wallet('T','SUB')=50","the unreserved 10.00 moved")
  +AS_TOWNER+"SELECT public.fn_club_bank_reverse_core_20261004((SELECT (j->>'transaction_id')::uuid FROM s1),'lane j probe',rr.u('op-rev'));",REFUSED+one("SELECT rr.u('SUB')"))
probe('real club bank reversal of an unspent send moves',
  AS_TOWNER+"CREATE TEMP TABLE s1 AS SELECT public.fn_club_bank_send_core_20261004(rr.u('T'),rr.u('SUB'),10,'agent_wallet','lane j probe',rr.u('op-rev-send2')) j;"
  +"CREATE TEMP TABLE s3 AS SELECT public.fn_club_bank_reverse_core_20261004((SELECT (j->>'transaction_id')::uuid FROM s1),'lane j probe',rr.u('op-rev2')) j;"
  +ok("(SELECT j->>'success' FROM s3)='true' AND rr.wallet('T','SUB')=50","reversed; the reserved 50.00 untouched"))
probe('a direct debit of a zero-rate pass-through wallet (SUB, all 50.00 reserved)',"UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-0.01 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('the business_balance spelling of the same debit',"UPDATE public.agents SET business_balance=business_balance-0.01 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('deleting a wallet that reserves anything',"DELETE FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",REFUSED)
probe('a suspended or frozen payer still keeps its players\' share',"UPDATE public.agents SET status='frozen' WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-1 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('a credit to a reserved wallet is never refused',"UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+1 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');"+ok("rr.wallet('T','SUB')=51","credited"))
probe('a client role cannot lower a reserve',"SET LOCAL ROLE authenticated;UPDATE smarter_private.weekly_payout_wallet_reserves SET remaining=0;",'permission denied')
probe('a client role cannot call the release',"SET LOCAL ROLE service_role;SELECT smarter_private.weekly_payout_reserve_close(gen_random_uuid());",'permission denied')
# RESERVE RELEASE (lane J): release clamps at what is held; a paid or discharged period closes its reserve whatever is left
# (a certificate that shrank after round 2 cannot strand a reserve); a payer deleted between the rounds still pays its player.
TQP="(SELECT id FROM public.rakeback_periods WHERE club_id=rr.u('T') AND user_id=rr.u('TQ'))"
TPP="(SELECT id FROM public.rakeback_periods WHERE club_id=rr.u('T') AND user_id=rr.u('TP'))"
probe('reserve release by a smaller payment, then the period closes',
  f"SELECT smarter_private.weekly_payout_reserve_release({TQP},rr.u('T'),rr.u('SA'),4);"
  +ok(f"(SELECT remaining=2 AND released_at IS NULL FROM smarter_private.weekly_payout_wallet_reserves WHERE period_id={TQP})","4.00 of 6.00 released; 2.00 still held")
  +f"SELECT smarter_private.weekly_payout_reserve_close({TQP});"
  +ok(f"(SELECT remaining=0 AND released_at IS NOT NULL FROM smarter_private.weekly_payout_wallet_reserves WHERE period_id={TQP}) AND rr.wallet('T','SA')=54","a paid period leaves nothing held; the wallet is untouched by the release itself")
  +f"SELECT smarter_private.weekly_payout_reserve_release({TPP},rr.u('T'),rr.u('SUB'),80);"
  +ok(f"(SELECT remaining=0 AND released_at IS NOT NULL FROM smarter_private.weekly_payout_wallet_reserves WHERE period_id={TPP})","a release larger than the reserve clamps at zero, never negative"))
probe('a payer deleted between round 2 and round 3 still pays its player and leaves nothing reserved or stranded',
  "UPDATE public.profiles SET status='deleted' WHERE id=rr.u('SUB');"
  "INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no) "
  f"VALUES(pg_backend_pid(),txid_current(),'{RUN_ID_PROBE}','union',rr.u('U'),rr.ws(),rr.we(),3);"
  "CREATE TEMP TABLE pr AS SELECT public.fn_settle_accounting_rakeback_stage('union',rr.u('U'),rr.ws(),rr.we()) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.chips('T','TP')=50 AND rr.wallet('T','SUB')=0","TP paid 50.00 from the deleted payer's wallet")
  +ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0)","every reserve released"))
# LEGACY CALLERS (fn_process_weekly_accounting_scope, weekly_payout_execute) run round 3 straight after round 2 and never
# the funding step. Round 2 now carries the funding, so round 3 alone pays every player and releases every reserve.
probe('legacy path: round 3 alone after round 2 pays all eight players from the wallets round 2 funded and releases every reserve',
  "INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no) "
  f"VALUES(pg_backend_pid(),txid_current(),'{RUN_ID_PROBE}','union',rr.u('U'),rr.ws(),rr.we(),3);"
  "CREATE TEMP TABLE pr AS SELECT public.fn_settle_accounting_rakeback_stage('union',rr.u('U'),rr.ws(),rr.we()) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE status<>'paid') AND (SELECT sum(chip_balance) FROM public.club_members)=131.50","every period paid, 131.50 to players")
  +ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0) AND rr.wallet('T','SUB')=0 AND rr.wallet('W','W.owner')=0 AND rr.wallet('O','O.owner')=0 AND rr.wallet('T','SA')=48 AND rr.wallet('T','AG')=25","every reserve released; each wallet ends at its entitlement"))
case('the guard: on the real agent send, self stake, club bank claim, horse split wallet claim and club bank reversal doors (lane J: four more production doors byte-exact), and on the direct and business_balance debit forms, the reserved part is refused with agent_wallet_weekly_rakeback_reserved naming the agent, the club, what it holds and what is reserved, while the unreserved part (48.00 of SA\'s 54.00) moves; a delete of a reserving wallet and a debit of a frozen payer are refused; a credit is not; no client role can lower or release a reserve; a release clamps and a paid period closes its reserve (a smaller certificate strands nothing); a payer deleted between the rounds still pays its player; round 3 alone (the legacy callers\' order) pays everyone and releases every reserve')
# LANE K (2026-11-11): every remaining door that writes public.agents.agent_wallet_balance, byte-exact from production
# (debit-paths.json; md5 re-read on production 2026-11-11), plus the FK cascade deletes. Stand-ins are marked STAND-IN.
AS_TQ="SELECT set_config('request.jwt.claims',jsonb_build_object('sub',rr.u('TQ'),'role','authenticated')::text,true);\n"
AS_SERVICE="SELECT set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);\n"
# The club owner funds its own agent wallet from the bank (real fn_club_bank_send_core_20261004, which mints the owner's
# agents row through fn_ensure_agent_row) and sends 10.00 of it to SUB's agent wallet (real agent send core): the owner's
# cashier scope reaches every member, and the send is inside its ten minute claim back window.
SEND_SUB10=(AS_TOWNER+"CREATE TEMP TABLE s0 AS SELECT public.fn_club_bank_send_core_20261004(rr.u('T'),rr.u('T.owner'),10,'agent_wallet','lane k probe',rr.u('op-k-fund')) j;"
  +"CREATE TEMP TABLE s1 AS SELECT public.fn_agent_wallet_send_core_20260830(rr.u('T'),rr.u('SUB'),10,'agent_wallet','lane k probe',rr.u('op-k-send')) j;"
  +ok("(SELECT j->>'success' FROM s0)='true' AND (SELECT j->>'success' FROM s1)='true' AND rr.wallet('T','T.owner')=0 AND rr.wallet('T','SUB')=60","the owner sent 10.00 to SUB's agent wallet, which now holds 60.00 with 50.00 reserved"))
CLAIM=lambda amt,op: AS_TOWNER+f"CREATE TEMP TABLE c_{op} AS SELECT public.fn_agent_wallet_claim_back_phase2_core_20260831(rr.u('T'),(SELECT (j->>'transaction_id')::uuid FROM s1),{amt},'lane k probe',rr.u('op-k-{op}')) j;"
# 1. fn_agent_wallet_claim_back_phase2_core_20260831 (c8c794a0): an upline takes chips back out of a downline AGENT wallet.
probe('real agent wallet claim back reaching SUB\'s reserved share (the owner sends SUB 10.00, SUB stakes 4.00 of it, the owner claims 7.00 back)',
  SEND_SUB10+AS_SUB+"SELECT public.fn_agent_wallet_self_stake(rr.u('T'),4,'lane k probe',rr.u('op-k-stake'));"
  +CLAIM(7,'claim7'),SUB_REF.replace('holds 50.00','holds 56.00'))
probe('real agent wallet claim back of the unreserved part moves (claim 6.00 of the 10.00 after SUB staked 4.00)',
  SEND_SUB10+AS_SUB+"SELECT public.fn_agent_wallet_self_stake(rr.u('T'),4,'lane k probe',rr.u('op-k-stake'));"
  +CLAIM(6,'claim6')+ok("(SELECT j->>'success' FROM c_claim6)='true' AND rr.wallet('T','SUB')=50 AND rr.wallet('T','T.owner')=6","6.00 came back to the owner; SUB keeps exactly its reserved 50.00"))
probe('real agent wallet claim back of an unspent send moves whole',
  SEND_SUB10+CLAIM('NULL','claimall')+ok("(SELECT j->>'success' FROM c_claimall)='true' AND (SELECT (j->>'amount')::numeric FROM c_claimall)=10 AND rr.wallet('T','SUB')=50 AND rr.wallet('T','T.owner')=10","10.00 came back to the owner; SUB at its reserve"))
# CREDIT-ONLY DOORS. Each of these writes agents.agent_wallet_balance only upward; what it debits is a player wallet,
# the club bank, the club or union promo pot, the union wallet or an agent PROMO wallet, none of which a reserve covers.
# Executed against SUB, whose whole 50.00 is reserved: every credit lands, nothing below the reserve moves.
OWNER_CHIPS=AS_TOWNER+"CREATE TEMP TABLE o0 AS SELECT public.fn_club_bank_send_core_20261004(rr.u('T'),rr.u('T.owner'),10,'player_wallet','lane k probe',rr.u('op-k-owner-chips')) j;"+ok("(SELECT j->>'success' FROM o0)='true' AND rr.chips('T','T.owner')=10","the owner holds 10.00 in its player wallet")
# 2. fn_cashier_player_wallet_send (2697ce06): debits the sender's PLAYER wallet, credits the recipient's agent wallet.
probe('real cashier player wallet send into a fully reserved agent wallet is a credit and lands',
  OWNER_CHIPS+"CREATE TEMP TABLE pr AS SELECT public.fn_cashier_player_wallet_send(rr.u('T'),rr.u('SUB'),5,'agent_wallet','lane k probe',rr.u('op-k-cps')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SUB')=55 AND rr.chips('T','T.owner')=5","SUB 50.00 -> 55.00; the owner's player wallet paid"))
# 3. fn_club_promo_send_core_20261004 (8a3e7bf2): debits clubs.promo_balance. STAND-IN: 10.00 placed in T's promo pot
# (journal autoskipped; the probe rolls back before the commit-time ledger check).
PROMO_POT="SELECT set_config('app.ledger_autoskip_clubs','1',true);UPDATE public.clubs SET promo_balance=10 WHERE id=rr.u('T');SELECT set_config('app.ledger_autoskip_clubs','',true);\n"
probe('real club promo send into a fully reserved agent wallet (and into SA\'s promo wallet) is a credit and lands',
  PROMO_POT+AS_TOWNER+"CREATE TEMP TABLE pr AS SELECT public.fn_club_promo_send_core_20261004(rr.u('T'),rr.u('SUB'),4,'cashier_agent_wallet','lane k probe',rr.u('op-k-cpromo')) j;"
  +"CREATE TEMP TABLE pr2 AS SELECT public.fn_club_promo_send_core_20261004(rr.u('T'),rr.u('SA'),5,'cashier_promo_wallet','lane k probe',rr.u('op-k-cpromo2')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND (SELECT j->>'success' FROM pr2)='true' AND rr.wallet('T','SUB')=54 AND (SELECT promo_wallet_balance FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SA'))=5 AND rr.wallet('T','SA')=54","SUB 50.00 -> 54.00; SA's promo wallet 5.00, its agent wallet unchanged"))
# 4. fn_promo_wallet_send_core_20261004 (9902bccc): debits the sender's PROMO wallet, never agent_wallet_balance.
probe('real promo wallet send by a reserving agent moves its promo chips and leaves its reserved agent wallet whole',
  PROMO_POT+AS_TOWNER+"SELECT public.fn_club_promo_send_core_20261004(rr.u('T'),rr.u('SA'),5,'cashier_promo_wallet','lane k probe',rr.u('op-k-cpromo2'));"
  +AS_SA+"CREATE TEMP TABLE pr AS SELECT public.fn_promo_wallet_send_core_20261004(rr.u('T'),rr.u('TQ'),5,'player_wallet','lane k probe',rr.u('op-k-promo')) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND (SELECT promo_wallet_balance FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SA'))=0 AND rr.chips('T','TQ')=5 AND rr.wallet('T','SA')=54","SA's promo 5.00 reached TQ; SA's agent wallet (6.00 reserved) untouched at 54.00"))
# 5. fn_union_send_to_member_zd3core (b90deb83): debits a union wallet, credits the member's agent wallet.
probe('real union send to a fully reserved agent wallet is a credit and lands',
  AS_SERVICE+"CREATE TEMP TABLE pr AS SELECT public.fn_union_send_to_member_zd3core(rr.u('U'),rr.u('SUB'),'chips',1,'chips','lane k probe') j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND (SELECT j->>'destination' FROM pr)='agent_wallet' AND rr.wallet('T','SUB')=51","SUB 50.00 -> 51.00 from the union chip wallet"))
# 6. fn_process_credit_invoice_payment (e99cfa87): on a tracked credit week, an external payment moves club bank -> agent
# wallet. STAND-IN: one credit invoice and its weekly credit basis for SUB (the invoice generator is not loaded).
INVOICE=("INSERT INTO public.agent_credit_weekly_basis(agent_id,club_id,period_start,period_end,credit_line,agent_wallet_before_rakeback) SELECT id,club_id,rr.ws(),rr.we(),10,0 FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');"
  "INSERT INTO public.credit_invoices(id,agent_id,period_start,period_end,debt_owed,amount_paid,amount_remaining,status,due_date) SELECT rr.u('inv-k'),id,rr.ws(),rr.we(),10,0,10,'pending',rr.we()+interval '7 days' FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');\n")
probe('real credit invoice payment into a fully reserved agent wallet is a credit and lands',
  INVOICE+AS_TOWNER+"CREATE TEMP TABLE pr AS SELECT public.fn_process_credit_invoice_payment(rr.u('inv-k'),3,'external',rr.u('op-k-inv'),'lane k probe reference') j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SUB')=53","SUB 50.00 -> 53.00 from the club bank"))
# 7. fn_ca_settle_approved_agent_adjustment (d94aa86c): club bank -> agent wallet for an approved adjustment.
# STAND-IN: one approved adjustment row (four eyes: actor T.owner, approver U.boss).
ADJ=("INSERT INTO public.ca_manual_adjustments(id,actor,approver,reason,amount,target_kind,target_id,status,approved_at,asset) "
  "VALUES(rr.u('adj-k'),rr.u('T.owner'),rr.u('U.boss'),'Lane K probe of an approved agent wallet adjustment',2,'agent_wallet',rr.u('SUB'),'approved',now(),'chips');\n")
probe('real approved agent adjustment into a fully reserved agent wallet is a credit and lands',
  ADJ+"CREATE TEMP TABLE pr AS SELECT public.fn_ca_settle_approved_agent_adjustment(rr.u('adj-k'),rr.u('T'),(SELECT jsonb_build_object('club_id',rr.u('T'),'approved_adjustment',to_jsonb(a)-'status') FROM public.ca_manual_adjustments a WHERE id=rr.u('adj-k'))) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND rr.wallet('T','SUB')=52","SUB 50.00 -> 52.00 from the club bank"))
# 8. fn_cashier_cashout_transition (80327110): a player's cash out is held from its PLAYER wallet into escrow; the
# cashier's approval releases the escrow INTO the cashier's agent wallet. Its only agents write is that credit.
# Wired for this probe, byte-exact from production: every cashout_requests, accounting_cashier_events and chip_escrow
# trigger the harness does not already wire (the messenger thread, append-only, launch boundary, emergency stop and
# store-ledger checks among them) and ca_emergency_stops with production's cashout row (stopped=false).
_wired={(t['table'],t['name']) for t in L['wired']}
CASHIER_TRG=''.join(t['def']+';\n'+(f"ALTER TABLE {k} ENABLE ALWAYS TRIGGER {t['n']};\n" if t['e']=='A' else '') for k in('public.cashout_requests','public.accounting_cashier_events','public.chip_escrow') for t in REL[k]['trg'] or [] if (k,t['n']) not in _wired)
ESTOP="INSERT INTO public.ca_emergency_stops(path,stopped,version) VALUES('cashout',false,0);\n"
probe('real cash out approval releasing escrow into a reserving agent wallet is a credit and lands (the hold debits the player wallet only)',
  CASHIER_TRG+ESTOP+AS_SA+"SELECT public.fn_agent_wallet_send_core_20260830(rr.u('T'),rr.u('TQ'),10,'player_wallet','lane k probe',rr.u('op-k-tq'));"
  +AS_TQ+"CREATE TEMP TABLE h AS SELECT public.fn_cashier_cashout_transition('hold',rr.u('T'),NULL,10,rr.u('TQ'),rr.u('op-k-hold'),'lane k probe') j;"
  +ok("(SELECT j->>'success' FROM h)='true' AND rr.chips('T','TQ')=0 AND rr.wallet('T','SA')=44","TQ's 10.00 is held in escrow; SA's agent wallet (6.00 reserved) is at 44.00")
  +AS_SA+"CREATE TEMP TABLE a AS SELECT public.fn_cashier_cashout_transition('approval',rr.u('T'),(SELECT (j->'request'->>'id')::uuid FROM h),10,rr.u('SA'),rr.u('op-k-approve'),'lane k probe') j;"
  +ok("(SELECT j->>'success' FROM a)='true' AND rr.wallet('T','SA')=54","the approval released the escrow into SA's agent wallet: 44.00 -> 54.00"))
# 8. FK CASCADES. Production's agents_club_id_fkey and fk_agents_user_id_profiles are ON DELETE CASCADE (this harness drops
# every foreign key; these two are added back byte-exact from production's pg_get_constraintdef, read 2026-11-11).
FKS="ALTER TABLE public.agents ADD CONSTRAINT agents_club_id_fkey FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;ALTER TABLE public.agents ADD CONSTRAINT fk_agents_user_id_profiles FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;\n"
CLOSE_T="SELECT smarter_private.weekly_payout_reserve_close(w.period_id) FROM smarter_private.weekly_payout_wallet_reserves w WHERE w.club_id=rr.u('T') AND w.remaining>0;\n"
probe('deleting the profile of a reserving agent cascades into its agents row and is refused',FKS+"DELETE FROM public.profiles WHERE id=rr.u('SUB');",SUB_REF)
# A club row is deleted only on the maintenance path of the real clubs lifecycle guard (fn_guard_club_lifecycle_write,
# 63847089, wired): without it the delete stops there; with it the cascade reaches agents and the reserve refuses it.
MAINT="SELECT set_config('app.club_retirement_maintenance','on',true);\n"
probe('deleting a club outside the maintenance path is refused by the club lifecycle guard before any cascade',FKS+"DELETE FROM public.clubs WHERE id=rr.u('T');",'CLUB_RECORD_RETAINED')
probe('deleting the club of reserving agents on the maintenance path cascades into their agents rows and is refused',FKS+MAINT+"DELETE FROM public.clubs WHERE id=rr.u('T');",REFUSED)
probe('the same cascades go through once the reserves are released (so the refusal above is the guard, not the cascade)',
  FKS+CLOSE_T+"DELETE FROM public.profiles WHERE id=rr.u('SUB');"+ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SUB'))","SUB's agents row cascaded away")
  +MAINT+"DELETE FROM public.clubs WHERE id=rr.u('T');"+ok("NOT EXISTS(SELECT 1 FROM public.agents WHERE club_id=rr.u('T'))","every T agents row cascaded away"))
case('the guard on every remaining door (lane K, all byte-exact from production, md5 re-read 2026-11-11): the agent wallet claim back (c8c794a0) is refused for the reserved part and moves the unreserved part and an unspent send whole; the credit-only doors (cashier player wallet send 2697ce06, club promo send 8a3e7bf2, promo wallet send 9902bccc, union send b90deb83, credit invoice payment e99cfa87, approved agent adjustment d94aa86c, cash out approval 80327110) land on reserving wallets and never lower agent_wallet_balance; deleting a reserving agent\'s profile or its club (maintenance path) cascades into agents and is refused, and goes through once the reserves are released')
