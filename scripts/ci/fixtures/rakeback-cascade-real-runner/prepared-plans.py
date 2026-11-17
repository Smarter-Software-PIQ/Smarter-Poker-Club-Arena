# The isolated, fully seeded board remains unpaid until this test invokes the normal runner.
settings_prepared=json.loads(one("SELECT to_json(setconfig)::text FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0"))
q("CREATE DATABASE preclosed TEMPLATE postgres;"+''.join("ALTER DATABASE preclosed SET "+c.split('=',1)[0]+" TO "+(c.split('=',1)[1] if c.startswith('search_path=') else "$v$"+c.split('=',1)[1]+"$v$")+";" for c in settings_prepared))
DB='preclosed'
try:
    # These two manual contract-admission paths are outside the fixture's normal financial graph.
    # Load their actual maintained bodies, without invoking a production repair.
    for version, name in [('20261020145326','admit_cash_atomic_contracts'),('20261026161532','admit_cash_funding_contracts')]:
        original=next((R/'supabase/migrations').glob(version+'_*.sql')).read_text()
        ddl=original[original.index('CREATE FUNCTION smarter_private.'+name):].split('END $admit$;',1)[0]+'END $admit$;'
        q('SET check_function_bodies=off;'+ddl)
    for version in ('20261116145019','20261116161800','20261117001201','20261117001202'):
        q(next((R/'supabase/migrations').glob(version+'_*.sql')).read_text())
    args="'union',rr.u('U'),rr.ws(),rr.we()"
    ready_sql="SELECT smarter_private.weekly_prepared_payout_plans("+args+")"
    finance="SELECT rr.money()||':'||(SELECT count(*) FROM chip_ledger)"
    opening=one(finance)
    clock('2026-11-16 09:31Z')
    q("DELETE FROM accounting_close_certificates WHERE kind='earned_plan';DELETE FROM accounting_close_partials WHERE kind='round3_union_plan'")
    assert one(ready_sql)=='f'
    migration=next((R/'supabase/migrations').glob('20261117001202_*.sql')).read_text()
    assert one("SELECT "+re.search(r'^-- @live-proof: (.*)$',migration,re.M).group(1))=='t'
    for m in (32,34,36):
        for job in SHARDS:
            result=tick(job,minute(9,m));assert result['rc']==0,result
    assert one(ready_sql)=='t',one("SELECT jsonb_agg(x) FROM smarter_private.weekly_payout_windows("+args+") x")
    assert one(finance)==opening
    assert one("SELECT max(certified_at) < rr.we()+interval '2 hours' FROM accounting_close_certificates WHERE kind='earned_plan'")=='t'
    assert one("SELECT max(computed_at) < rr.we()+interval '2 hours' FROM accounting_close_partials WHERE kind='round3_union_plan'")=='t'
    # Recognition delivery time can differ from its closed-week effective time.
    # These original bank receipts carry no separate recorded_at. Exercise the real
    # insert trigger, and compare with an ordinary open-week recognition.
    dated=q("""BEGIN;
      INSERT INTO public.accounting_tournament_fee_recognitions
       (tournament_id,recognized_at,status,net_rake,union_id,source_fingerprint,plan)
       VALUES(gen_random_uuid(),now(),'cancelled',0,rr.u('U'),'open','{}');
      SELECT count(*) FROM smarter_private.weekly_payout_source_changes;
      INSERT INTO public.accounting_tournament_fee_recognitions
       (tournament_id,recognized_at,status,net_rake,union_id,source_fingerprint,plan)
       VALUES(gen_random_uuid(),rr.we()-interval '1 minute','cancelled',0,rr.u('U'),'closed','{}');
      SELECT count(*) FROM smarter_private.weekly_payout_source_changes WHERE scope_id=rr.u('U') AND window_start=rr.we()-interval '2 hours';
      ROLLBACK;""")
    assert dated.stdout.strip().splitlines()==['0','1'],dated.stdout
    # A complete, truly empty scope is different from an absent two-hour part.
    empty=q("""BEGIN;
      SET LOCAL app.weekly_accounting_chunked='on';
      SET LOCAL app.weekly_accounting_scope_deadline='2026-11-17 12:00Z';
      DELETE FROM public.rakeback_periods;
      UPDATE public.accounting_close_partials SET value=jsonb_set(value,'{pairs}','[]') WHERE kind='round3_union_window';
      SELECT public.fn_settle_accounting_rakeback_plan('union',rr.u('U'),rr.ws(),rr.we())->>'failed';
      SELECT public.fn_settle_accounting_rakeback_plan_get('union',rr.u('U'),rr.ws(),rr.we(),
        ARRAY(SELECT jsonb_array_elements_text(value->'club_ids')::uuid FROM public.accounting_close_partials WHERE kind='round3_union_plan'),rr.u('U'),NULL,false)->>'pairs';
      DELETE FROM public.accounting_close_partials WHERE kind='round3_union_window' AND window_start=rr.ws();
      SELECT public.fn_settle_accounting_rakeback_plan('union',rr.u('U'),rr.ws(),rr.we())->>'failed';
      ROLLBACK;""")
    assert empty.stdout.strip().splitlines()==['false','[]','true'],empty.stdout
    # Late source marks only its own two-hour slice; a concurrent payout holder
    # refuses the posting atomically, before a bank-row wait can invert lock order.
    when="'2026-11-16 07:55Z'::timestamptz"
    source="SELECT rr.hand('T','TN',20,"+when+")"
    lock="hashtextextended('union-accounting:'||rr.u('U')::text||':'||extract(epoch FROM rr.ws())::text||':'||extract(epoch FROM rr.we())::text,0)"
    holder=subprocess.Popen([str(A.pg_bin/'psql'),'-X','-qAt','-U','postgres','-h','127.0.0.1','-p',port,'-d',DB],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        holder.stdin.write("BEGIN; SELECT pg_advisory_xact_lock("+lock+"); SELECT 'held';\n");holder.stdin.flush()
        while holder.stdout.readline().strip()!='held':
            assert holder.poll() is None
        refused=q(source,check=False)
        assert refused.returncode and 'closed_week_source_waits_for_owned_payout' in refused.stderr,refused.stderr
        assert one(finance)==opening
    finally:
        holder.communicate('ROLLBACK;\n',timeout=5)
    q(source)
    assert one(ready_sql)=='f'
    q("SELECT smarter_private.weekly_refresh_changed_payout_windows("+args+")")
    assert one("SELECT count(*) FROM accounting_close_partials WHERE kind='earned_plan_window' AND union_id=rr.u('U')")=='83'
    for m in (40,42,44,46):
        for job in SHARDS:
            result=tick(job,minute(9,m));assert result['rc']==0,result
    assert one(ready_sql)=='t'
    clock('2026-11-16 10:01Z')
    rc,out,err=cron(RUNNER)
    assert rc==0 and json.loads(out)['stage']=='rounds_booked',(out,err)
    rc,out,err=cron(RUNNER)
    assert rc==0 and json.loads(out)['round']==1,(out,err)
    # A changed downstream scope may not reprice an earlier posted R1 right.
    balance_after_r1=one(finance)
    hold=q("BEGIN; SELECT smarter_private.weekly_payout_source_changed('union',rr.u('U'),"+when+"); SELECT smarter_private.weekly_payout_next_round(); ROLLBACK;")
    assert json.loads(hold.stdout.strip().splitlines()[-1])['stage']=='rounds_waiting_for_certified_sources'
    assert one(finance)==balance_after_r1 and one("SELECT count(*) FROM smarter_private.weekly_payout_round_receipts")=='1'
    for expected in (2,3):
        rc,out,err=cron(RUNNER)
        assert rc==0 and json.loads(out)['round']==expected,(out,err)
    rc,out,err=cron(RUNNER)
    assert rc==0 and json.loads(out)['stage']=='weekly_payout_finalized',(out,err)
    after=one(finance)
    assert cron(RUNNER)[0]==0 and one(finance)==after
    assert one("SELECT count(*) FROM smarter_private.weekly_payout_round_receipts")=='3'
    case('Original prep shards prepublish conserved R1 and final player certificates before 04:00, stale sources defer booking, one interval refreshes, concurrent late cash refuses atomically, posted rights remain frozen')
finally:
    DB='postgres'
    q("DROP DATABASE preclosed")
