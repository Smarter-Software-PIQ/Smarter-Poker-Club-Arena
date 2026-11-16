# Fork the booked board after the agent transfers have posted.
settings = q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0").stdout.splitlines()
q("CREATE DATABASE stale_window TEMPLATE postgres")
try:
    for setting in settings:
        name, value = setting.split('=', 1)
        q("ALTER DATABASE stale_window SET " + name + " TO " + (value if name=='search_path' else "$v$"+value+"$v$"))
    DB = 'stale_window'
    probe = """
      SET app.weekly_accounting_chunked='on';
      SET app.weekly_accounting_scope_deadline='2026-11-17 06:00+00';
      SELECT public.fn_settle_accounting_rakeback_plan_get('union',rr.u('U'),rr.ws(),rr.we(),
        ARRAY(SELECT jsonb_array_elements_text(value->'club_ids')::uuid FROM public.accounting_close_partials
              WHERE kind='round3_union_plan'),rr.u('U'),NULL,false) IS NULL;
    """
    assert one(probe)=='f', 'fixture needs a usable stored plan'
    damage = """
      UPDATE public.accounting_close_partials SET value=jsonb_set(value,'{pairs,0,2}',to_jsonb((value#>>'{pairs,0,2}')::bigint-1))
      WHERE kind='round3_union_window' AND window_start=(SELECT min(window_start) FROM public.accounting_close_partials
        WHERE kind='round3_union_window' AND jsonb_array_length(value->'pairs')>0);
    """
    migration = (R/'supabase/migrations/20261116145019_validate_player_round_windows_before_reusing_the_plan.sql').read_text()
    healthy = q(migration.rsplit('COMMIT;',1)[0] + probe + 'ROLLBACK;')
    assert healthy.stdout.strip().splitlines()[-1]=='f', 'current windows still use the cached plan'
    q(damage)
    assert one(probe)=='f','reproduce the stale window accepted by the old reader'
    q(migration)
    assert one(probe)=='t', 'a contradictory count must force validation against the original earning rows'
    rc, out, err = cron(RUNNER)
    assert rc==0 and json.loads(out)['round']==3,(out,err)
    case('stale player-source window: original runner pays the player round from current sources and preserves the earlier agent and club receipts',
         ok("(SELECT count(*) FROM smarter_private.weekly_payout_round_receipts)=3","three original round receipts")
        +ok("(SELECT count(*)=8 AND sum(payout_amount)=131.50 FROM public.rakeback_period_payouts)","all eight player payments once"))
finally:
    DB = 'postgres'
    q("DROP DATABASE stale_window")
