# Exec'd by cases.py right after the runner's round 2 tick and before its round 3 tick (20261111132447).
# Every probe below is its own transaction and is rolled back; cases.py checks the board is unchanged afterwards.
DEBIT=json.loads((F/'debit-paths.json').read_text())  # production definitions (md5 read 2026-11-11) of two debit doors the fixture does not load
LOAD_DEBIT='SET check_function_bodies=off;\n'+''.join(v['def'].rstrip()+';\n' for v in DEBIT.values())+''.join(
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
probe('a direct debit of a zero-rate pass-through wallet (SUB, all 50.00 reserved)',"UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-0.01 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('the business_balance spelling of the same debit',"UPDATE public.agents SET business_balance=business_balance-0.01 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('deleting a wallet that reserves anything',"DELETE FROM public.agents WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",REFUSED)
probe('a suspended or frozen payer still keeps its players\' share',"UPDATE public.agents SET status='frozen' WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance-1 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');",SUB_REF)
probe('a credit to a reserved wallet is never refused',"UPDATE public.agents SET agent_wallet_balance=agent_wallet_balance+1 WHERE club_id=rr.u('T') AND user_id=rr.u('SUB');"+ok("rr.wallet('T','SUB')=51","credited"))
probe('a client role cannot lower a reserve',"SET LOCAL ROLE authenticated;UPDATE smarter_private.weekly_payout_wallet_reserves SET remaining=0;",'permission denied')
probe('a client role cannot call the release',"SET LOCAL ROLE service_role;SELECT smarter_private.weekly_payout_reserve_close(gen_random_uuid());",'permission denied')
# LEGACY CALLERS (fn_process_weekly_accounting_scope, weekly_payout_execute) run round 3 straight after round 2 and never
# the funding step. Round 2 now carries the funding, so round 3 alone pays every player and releases every reserve.
probe('legacy path: round 3 alone after round 2 pays all eight players from the wallets round 2 funded and releases every reserve',
  "INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no) "
  f"VALUES(pg_backend_pid(),txid_current(),'{RUN_ID_PROBE}','union',rr.u('U'),rr.ws(),rr.we(),3);"
  "CREATE TEMP TABLE pr AS SELECT public.fn_settle_accounting_rakeback_stage('union',rr.u('U'),rr.ws(),rr.we()) j;"
  +ok("(SELECT j->>'success' FROM pr)='true' AND NOT EXISTS(SELECT 1 FROM public.rakeback_periods WHERE status<>'paid') AND (SELECT sum(chip_balance) FROM public.club_members)=131.50","every period paid, 131.50 to players")
  +ok("NOT EXISTS(SELECT 1 FROM smarter_private.weekly_payout_wallet_reserves WHERE remaining>0) AND rr.wallet('T','SUB')=0 AND rr.wallet('W','W.owner')=0 AND rr.wallet('O','O.owner')=0 AND rr.wallet('T','SA')=48 AND rr.wallet('T','AG')=25","every reserve released; each wallet ends at its entitlement"))
case('the guard: on the real agent send and self stake doors, and on the direct and business_balance debit forms, the reserved part is refused with agent_wallet_weekly_rakeback_reserved naming the agent, the club, what it holds and what is reserved, while the unreserved part (48.00 of SA\'s 54.00) moves; a delete of a reserving wallet and a debit of a frozen payer are refused; a credit is not; no client role can lower or release a reserve; round 3 alone (the legacy callers\' order) pays everyone and releases every reserve')
