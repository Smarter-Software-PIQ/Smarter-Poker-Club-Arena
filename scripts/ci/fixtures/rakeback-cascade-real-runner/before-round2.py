# Exec'd by cases.py right after the runner's round 1 tick and before its round 2 tick (lane K, 2026-11-11).
# public.fn_settle_accounting_commission_stage_v3 (4e44bbba, production's byte-exact fallback that round 2 returns into
# when a source contract cannot be read the v4 way) debits a parent agent wallet for each child's commission edge. It
# is executed here, where round 2 has not run, so v3 pays the real week. Every probe is rolled back.
# STAND-IN: one reserve row on SA (round 2 writes reserves only after its own legs, so none exists yet at this point).
# v3 credits a parent before it debits it (edges in parent-first order) and ends each wallet at opening + own, so a
# reserve that the wallet already covers is never touched; a reserve above what v3 leaves behind is refused by the guard.
def v3_probe(name,reserve,refusal=None):
    sql=("BEGIN;\nINSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no) "
      f"VALUES(pg_backend_pid(),txid_current(),'{RUN_ID_PROBE}','union',rr.u('U'),rr.ws(),rr.we(),2);\n"
      "INSERT INTO smarter_private.weekly_payout_wallet_reserves(period_id,club_id,user_id,scope_kind,scope_id,period_start,period_end,reserved,remaining,set_by) "
      f"SELECT id,rr.u('T'),rr.u('SA'),'union',rr.u('U'),rr.ws(),rr.we(),{reserve},{reserve},'round2' FROM public.rakeback_periods WHERE club_id=rr.u('T') AND user_id=rr.u('TQ');\n"
      +ok("rr.wallet('T','SA')=0 AND NOT EXISTS(SELECT 1 FROM public.chip_ledger WHERE category='commission')","before round 2: SA holds nothing and no commission has moved")
      +"CREATE TEMP TABLE v3 AS SELECT public.fn_settle_accounting_commission_stage_v3('union',rr.u('U'),rr.ws(),rr.we()) j;\n"
      +("" if refusal else ok("(SELECT j->>'success' FROM v3)='true' AND (SELECT (j->>'routing_version')::int FROM v3)=3 AND rr.wallet('T','SA')=54 AND rr.wallet('T','AG')=30","v3 paid bank -> SA and SA -> AG; SA ends at 54.00, exactly its reserve"))
      +"ROLLBACK;\n")
    r=q(sql,check=False)
    if refusal: assert r.returncode!=0 and refusal in r.stderr,(name,r.stderr[-1500:])
    else: assert r.returncode==0,(name,r.stderr[-3000:])
v3_probe('v3 fallback with a reserve SA covers: pays, SA ends at its reserve',54)
v3_probe('v3 fallback with a reserve above what v3 leaves SA: the SA -> AG debit is refused',54.01,
  'agent_wallet_weekly_rakeback_reserved: agent '+one("SELECT rr.u('SA')")+' in club '+one("SELECT rr.u('T')")+' holds 84.00 in its agent wallet and 54.01 of it is owed to its players')
case('the v3 commission fallback (production 4e44bbba, executed on the real week before round 2): with a reserve its parent wallet already covers it pays bank -> SA -> AG and leaves SA exactly at the reserve; with a reserve above that, its SA -> AG debit is refused with agent_wallet_weekly_rakeback_reserved and the whole v3 transaction rolls back')
