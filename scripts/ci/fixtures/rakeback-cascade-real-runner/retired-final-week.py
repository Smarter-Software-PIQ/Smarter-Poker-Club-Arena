# Branch the partly paid board. Preserve the union receipt and add the separate,
# retired standalone scope and its pre-retirement tournament fee.
settings = q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0").stdout.splitlines()
q("CREATE DATABASE retired_week TEMPLATE postgres;")
for setting in settings:
    name, value = setting.split('=', 1)
    q("ALTER DATABASE retired_week SET " + name + " TO " + (value if name=='search_path' else "$v$"+value+"$v$"))
DB = 'retired_week'
try:
    q("""
      SELECT rr.person('retired-owner');
      INSERT INTO public.clubs(id,name,owner_id,chip_treasury)
      VALUES(rr.u('retired'),'Retired test club',rr.u('retired-owner'),0);
      INSERT INTO public.tournament_rake_settlements(tournament_id,club_id,amount,destination,settled_at)
      VALUES(rr.u('final-tournament'),rr.u('retired'),0.20,'chip_retirement:'||rr.u('retired'),rr.we()-interval '2 days');
      BEGIN;
      SET LOCAL app.club_retirement_write='on';
      UPDATE public.clubs SET lifecycle_status='retired',retired_at=rr.we()-interval '1 day',
        retired_by=rr.u('retired-owner'),retirement_reason='Fixture final week' WHERE id=rr.u('retired');
      COMMIT;
      UPDATE public.weekly_accounting_payout_pauses SET scope_plan=scope_plan||jsonb_build_array(
        jsonb_build_object('kind','club','id',rr.u('retired'),'period_start',rr.ws(),'period_end',rr.we()))
      WHERE phase='paying';
    """)
    owner = f"""
      INSERT INTO smarter_private.weekly_payout_owned_transactions(backend_pid,transaction_id,run_id,scope_kind,scope_id,period_start,period_end,round_no)
      VALUES(pg_backend_pid(),txid_current(),'{RUN_ID_PROBE}','club',rr.u('retired'),rr.ws(),rr.we(),1);
    """
    bank = "SELECT public.fn_bank_standalone_week_rake(rr.u('retired'),rr.ws(),rr.we());"
    before = q('BEGIN;'+owner+bank+'ROLLBACK;',check=False)
    assert before.returncode and 'CLUB_RETIRED' in before.stderr, before.stderr
    migration = R/'supabase/migrations/20261116131652_retired_clubs_settle_their_final_earned_week.sql'
    q(migration.read_text())
    q('BEGIN;'+owner+bank+bank+
      ok("rr.bank('retired')=0.20 AND (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key LIKE 'standalone-rake-bank:%')=1","last week credited once")+
      ok("(SELECT count(*) FROM smarter_private.weekly_payout_round_receipts WHERE round_no=1 AND scope_kind='union')=1","original union receipt retained")+
      'COMMIT;')
    wallet = "SELECT smarter_private.ensure_owner_routing_wallet(rr.u('retired'));"
    refused = q('BEGIN;'+wallet+'ROLLBACK;', check=False)
    assert refused.returncode and 'CLUB_RETIRED' in refused.stderr, refused.stderr
    round2 = owner.replace("rr.we(),1);","rr.we(),2);")
    q('BEGIN;'+round2+wallet+wallet+
      ok("(SELECT count(*) FROM public.agents WHERE club_id=rr.u('retired') AND status='wallet_only' AND agent_wallet_balance=0)=1","one empty owner routing wallet")+
      'COMMIT;')
    case('retired final week: a pre-retirement fee uses the owned bank and ledger once, with the original paid union receipt intact')
finally:
    DB = 'postgres'
    q("DROP DATABASE retired_week")
