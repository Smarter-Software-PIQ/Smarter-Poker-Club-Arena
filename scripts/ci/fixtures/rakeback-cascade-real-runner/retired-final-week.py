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
      SELECT rr.person('retired-deleted');
      INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance)
        VALUES(rr.u('retired'),rr.u('retired-deleted'),'player','active',0);
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
    round3 = owner.replace("rr.we(),1);","rr.we(),3);")
    refund = "SELECT public.fn_ca_deleted_wallet_bank_return(rr.u('retired'),rr.u('retired-deleted'),'player_wallet')"
    # A real one-cent journal credit from the already-funded bank. Set the
    # profile's status after the credit so the return is exercised explicitly.
    q('BEGIN;'+round3+"""
      SELECT public.fn_ca_declare_ledger('club_bank_send','club_treasury',rr.u('retired'),NULL,'retired-fixture-cent',ARRAY['clubs']);
      UPDATE public.club_members SET chip_balance=chip_balance+0.01 WHERE club_id=rr.u('retired') AND user_id=rr.u('retired-deleted');
      UPDATE public.clubs SET chip_treasury=chip_treasury-0.01 WHERE id=rr.u('retired');
      UPDATE public.profiles SET status='deleted' WHERE id=rr.u('retired-deleted');
      COMMIT;""")
    assert 'not_active_chip_club' in q('BEGIN;'+round3+refund+';ROLLBACK;').stdout
    q((R/'supabase/migrations/20261116163600_return_deleted_player_wallets_in_a_retired_clubs_final_round.sql').read_text())
    assert 'not_active_chip_club' in q(refund).stdout
    q('BEGIN;'+round3+refund+';'+refund+';'+
      ok("rr.bank('retired')=0.20 AND (SELECT chip_balance FROM public.club_members WHERE user_id=rr.u('retired-deleted'))=0","retired bank receives the deleted wallet cent once")+
      ok("(SELECT count(*) FROM public.chip_ledger WHERE club_id=rr.u('retired') AND category='club_bank_claim' AND amount=0.01)=1","exactly one matching bank return debit")+ 'COMMIT;')
    case('retired final week: a pre-retirement fee uses the owned bank and ledger once, with the original paid union receipt intact')
finally:
    DB = 'postgres'
    q("DROP DATABASE retired_week")
