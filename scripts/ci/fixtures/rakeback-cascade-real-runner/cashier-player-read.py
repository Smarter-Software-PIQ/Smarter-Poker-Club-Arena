# Fork the paid R2 board. Exercise the actual browser wallet RPC while an
# unchanged R3 proof is in flight, then after that round commits.
from concurrent.futures import ThreadPoolExecutor
settings=q("SELECT unnest(setconfig) FROM pg_db_role_setting WHERE setdatabase=(SELECT oid FROM pg_database WHERE datname=current_database()) AND setrole=0").stdout.splitlines()
source=(F/'cashier-player-read-source.sql').read_text()
fix=next((R/'supabase/migrations').glob('20261116163408_*.sql')).read_text()
source_barrier="""DO $probe$ DECLARE s text:=pg_get_functiondef('public.fn_settle_accounting_rakeback_stage(text,uuid,timestamptz,timestamptz)'::regprocedure);
 marker text:='THEN RAISE EXCEPTION ''routed_rakeback_player_period_missing'' USING ERRCODE=''55000''; END IF;';
 BEGIN
 IF position(marker in s)=0 THEN RAISE EXCEPTION 'missing source-proof marker'; END IF;
 EXECUTE replace(s,marker,marker||' PERFORM set_config(''application_name'',''native-r3-history-read'',true); PERFORM pg_sleep(5);');
 END $probe$;"""
def cashier_send(amount,op):
    return q("BEGIN; SET LOCAL lock_timeout='550ms'; SET LOCAL statement_timeout='1600ms';"+AS_SA+
             f"SELECT public.fn_agent_wallet_send(rr.u('T'),rr.u('TQ'),{amount},'player_wallet','cashier while history reads',rr.u('{op}')); COMMIT;",check=False)
for patched in [False,True]:
    q("CREATE DATABASE cashier_source TEMPLATE postgres")
    try:
        for setting in settings:
            name,value=setting.split('=',1)
            q("ALTER DATABASE cashier_source SET "+name+" TO "+(value if name=='search_path' else "$v$"+value+"$v$"))
        DB='cashier_source'
        q(LOAD_DEBIT+source)
        if patched:
            q(fix)
        q(source_barrier)
        with ThreadPoolExecutor(max_workers=1) as worker:
            active=worker.submit(cron,RUNNER)
            for _ in range(200):
                if one("SELECT EXISTS(SELECT FROM pg_stat_activity WHERE application_name='native-r3-history-read' AND wait_event='PgSleep')")=='t':
                    break
                if active.done():
                    raise AssertionError(('R3 did not reach its original-source proof',active.result()))
                time.sleep(.02)
            else:
                raise AssertionError('R3 never reached the source-proof barrier')
            if patched:
                reserved=cashier_send(49,'reserved-before-r3')
                assert reserved.returncode and 'agent_wallet_weekly_rakeback_reserved' in reserved.stderr,reserved.stderr
            spend=cashier_send(1,'available-before-r3')
            if patched:
                assert spend.returncode==0 and '"success": true' in spend.stdout,spend.stderr or spend.stdout
                assert not active.done(),'cashier completed only after R3'
            else:
                assert spend.returncode and 'lock timeout' in spend.stderr and 'public.clubs where id=p_club_id for update' in spend.stderr,spend.stderr
            rc,out,err=active.result(timeout=30)
            assert rc==0 and json.loads(out)['round']==3,(out,err)
        if patched:
            assert one("SELECT rr.wallet('T','SA')=47 AND rr.chips('T','TQ')=7")=='t'
            assert one("SELECT count(*)=8 AND sum(payout_amount)=131.50 FROM public.rakeback_period_payouts")=='t'
            assert one("SELECT bool_and(remaining=0 AND released_at IS NOT NULL) FROM smarter_private.weekly_payout_wallet_reserves")=='t'
            rc,out,err=cron(RUNNER)
            assert rc==0 and json.loads(out)['stage']=='weekly_payout_finalized',(out,err)
            after=cashier_send(1,'available-after-release')
            replay=cashier_send(1,'available-after-release')
            assert after.returncode==0 and '"success": true' in after.stdout,after.stderr or after.stdout
            assert replay.returncode==0 and '"replayed": true' in replay.stdout,replay.stderr or replay.stdout
            assert one("SELECT rr.wallet('T','SA')=46 AND rr.chips('T','TQ')=8")=='t'
    finally:
        DB='postgres'
        q("DROP DATABASE cashier_source")
# Leave the owner installed on the main disposable board too. Its remaining
# cases interrupt and retry R3, isolate held clubs, back deferred shortfalls,
# and reconcile every released reserve and the original funding receipt.
q(fix)
case('agent cashier during weekly R3: reproduce the actual club-row timeout, then send unreserved chips during source proof, refuse the reserved share, retain all eight payouts, and send/replay once after release')
