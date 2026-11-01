"""Connected request/financial invariants; no financial-function doubles."""
import json,time
from satellite_qualifier_fixture import module
ACTOR='a1000000-0000-4000-8000-000000000001'
CLUB='a2000000-0000-4000-8000-000000000001'

def snapshot(e,db,label):
    tables=['clubs','union_wallets','union_wallet_transactions','spin_bonus_pools','spin_reserve_ledger','chip_ledger','smarter_private.spin_owner_command_receipts']
    query="SELECT jsonb_build_array("+','.join("(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM "+t+" r)" for t in tables)+");"
    return e.sql(db,query,label=label)[1]

def exercise(e,db,root,service,activate,deactivate):
    def refusal(label,call,message,prefix=service):
        before=snapshot(e,db,label+'-before')
        code,_,err=e.sql(db,prefix+'SELECT '+call+';',label=label,check=False)
        assert code!=0 and message in err,(label,code,err)
        assert snapshot(e,db,label+'-after')==before,label
    for label,call,message in [
        ('same-key-different-seed',activate.replace(',200,1,',',201,1,'),'request_conflict'),
        ('same-key-different-action',deactivate.replace('000000000002','000000000001'),'request_conflict'),
        ('wrong-owner',activate.replace("'"+CLUB+"','"+ACTOR,"'a2000000-0000-4000-8000-000000000099','"+ACTOR),'not_authorized'),
        ('wrong-actor',activate.replace(ACTOR,'a1000000-0000-4000-8000-000000000099'),'not_authorized'),
        ('null-actor',activate.replace("'"+ACTOR+"'",'NULL'),'invalid_identity'),
        ('negative-seed',activate.replace(',200,1,',',-1,1,'),'invalid_activation'),
        ('fractional-seed',activate.replace(',200,1,',',0.5,1,'),'invalid_activation'),
        ('nonfinite-seed',activate.replace(',200,1,',",'NaN',1,"),'invalid_activation'),
        ('wrong-wallet',activate.replace('chip_treasury','chip_balance'),'invalid_wallet')]:
        refusal(label,call,message)
    refusal('authenticated-cannot-command',activate,'permission denied',"SET ROLE authenticated;")
    # Permission is checked today, even when the requested result already exists.
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;UPDATE clubs SET owner_id=NULL WHERE id='"+CLUB+"';COMMIT;",label='withdraw-current-owner')
    refusal('revoked-owner-cannot-read-old-receipt',activate,'not_authorized')
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;UPDATE clubs SET owner_id='"+ACTOR+"' WHERE id='"+CLUB+"';COMMIT;",label='restore-synthetic-owner')
    fresh=activate.replace('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000003')
    before=snapshot(e,db,'rollback-before')
    e.sql(db,'BEGIN;'+service+'SELECT '+fresh+';ROLLBACK;',label='actual-money-and-receipt-rollback')
    assert snapshot(e,db,'rollback-after')==before
    # A deliberate late receipt failure must roll back the already-executed
    # canonical debit and every automatic ledger/pool write.
    # The fault and call share one backend/transaction; no lasting probe object.
    code,_,err=e.sql(db,"BEGIN;CREATE FUNCTION pg_temp.reject_spin_receipt() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic late receipt refusal';END$$;CREATE TRIGGER native_late_receipt BEFORE INSERT ON smarter_private.spin_owner_command_receipts FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_spin_receipt();"+service+'SELECT '+fresh+';COMMIT;',label='late-receipt-error-is-atomic',check=False)
    assert code!=0 and 'synthetic late receipt refusal' in err,err
    assert snapshot(e,db,'late-refusal-after')==before
    for operation in ('DELETE FROM smarter_private.spin_owner_command_receipts','UPDATE smarter_private.spin_owner_command_receipts SET response=response','TRUNCATE smarter_private.spin_owner_command_receipts'):
        code,_,err=e.sql(db,operation+';',label='immutable-receipt-'+operation.split()[0].lower(),check=False)
        assert code!=0 and 'spin_owner_command_receipt_is_immutable' in err,err
    assert snapshot(e,db,'immutable-receipts-unchanged')==before
    code,_,err=e.sql(db,service+'SELECT * FROM smarter_private.spin_owner_command_receipts;',label='service-cannot-read-private-receipts',check=False)
    assert code!=0 and 'permission denied' in err,err
    frozen="BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO engine_maintenance_break(id,phase,announced_at,break_started_at,break_ends_at,reason,declared_by,updated_at,enforce_freeze,ownership_token) VALUES(true,'counting_down',clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 minutes','isolated native fixture','native',clock_timestamp(),true,'a4000000-0000-4000-8000-000000000001') ON CONFLICT(id) DO UPDATE SET phase=excluded.phase,announced_at=excluded.announced_at,break_started_at=excluded.break_started_at,break_ends_at=excluded.break_ends_at,enforce_freeze=true;SET LOCAL session_replication_role=origin;"
    e.sql(db,frozen+service+"DO $$BEGIN BEGIN PERFORM "+fresh+";RAISE EXCEPTION 'freeze admitted new command';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM<>'spin_owner_command_platform_frozen' THEN RAISE;END IF;END;END$$;SELECT "+activate+';ROLLBACK;',label='real-freeze-refuses-new-command-allows-old-receipt')
    assert snapshot(e,db,'freeze-rollback-unchanged')==before
    sessions=module(root/'scripts/ci/test-tournament-cancellation-lane.py','spin_command_sessions')
    for ending in ('ROLLBACK','COMMIT'):
        left=sessions.Session(e,db);right=sessions.Session(e,db)
        request=fresh.replace('a3000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-'+('000000000004' if ending=='ROLLBACK' else '000000000005'))
        try:
            left.query('BEGIN;'+service+'SELECT '+request+';')
            right.send("BEGIN;SET LOCAL application_name='spin_command_native_wait';"+service+'SELECT '+request+';COMMIT;')
            deadline=time.monotonic()+3
            while time.monotonic()<deadline:
                _,waiting,_=e.sql(db,"SELECT count(*) FROM pg_stat_activity WHERE application_name='spin_command_native_wait' AND wait_event='advisory';",label='same-request-waits-'+ending.lower())
                if waiting.strip()=='1':break
                time.sleep(.02)
            else:raise AssertionError('same request did not wait on original transaction')
            left.query(ending+';');reply=right.read()
            assert '"ok": true' in reply,reply
        finally:left.close();right.close()
        _,money,_=e.sql(db,"SELECT jsonb_build_array(c.chip_treasury,p.balance,p.seeded_amount,p.is_active) FROM clubs c JOIN spin_bonus_pools p ON p.club_id=c.id WHERE c.id='"+CLUB+"';",label='same-request-one-financial-effect-'+ending.lower())
        assert json.loads(money)==[9800,200,200,True],money
        # Deactivate under a fresh instruction so the next scenario has an
        # actual funded activation to exercise, rather than an active refusal.
        off=deactivate.replace('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-'+('000000000014' if ending=='ROLLBACK' else '000000000015'))
        e.sql(db,service+'SELECT '+off+';',label='finish-concurrent-'+ending.lower())
        e.report['races'].append({'case':'same-key-'+ending.lower(),'passed':True})
    # Old deactivation must not shut down a subsequent activation.
    new=activate.replace('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000006')
    e.sql(db,service+'SELECT '+new+';',label='new-activation-after-previous-deactivation')
    before=snapshot(e,db,'old-deactivation-before')
    e.sql(db,service+'SELECT '+deactivate+';',label='old-deactivation-replayed')
    assert snapshot(e,db,'old-deactivation-after')==before

    # Union funding is its own real wallet owner, not the member club treasury.
    union='a2000000-0000-4000-8000-000000000021'
    child='a2000000-0000-4000-8000-000000000022'
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO public.clubs(id,club_id,name,owner_id) VALUES ('"+union+"',998182,'Native Union','"+ACTOR+"'),('"+child+"',998183,'Native Union Child','"+ACTOR+"');INSERT INTO unions(id,name,owner_id,slug) VALUES ('"+union+"','Native Union','"+ACTOR+"','native-spin-union');UPDATE clubs SET union_id='"+union+"' WHERE id='"+child+"';INSERT INTO union_wallets(union_id,chip_balance) VALUES ('"+union+"',10000);COMMIT;",label='synthetic-union-opening')
    union_call=activate.replace(CLUB,child,1).replace(CLUB,union).replace('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000021').replace('chip_treasury','chip_balance')
    refusal('member-club-owner-cannot-spend-union',union_call,'not_authorized')
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO union_admins(union_id,user_id,role) VALUES ('"+union+"','"+ACTOR+"','union_lead');COMMIT;",label='synthetic-union-lead')
    _,result,_=e.sql(db,service+'SELECT '+union_call+';',label='actual-union-wallet-activation')
    assert json.loads(result.strip().splitlines()[-1])['ok'] is True,result
    before=snapshot(e,db,'union-replay-before')
    e.sql(db,service+'SELECT '+union_call+';',label='union-command-replay')
    assert snapshot(e,db,'union-replay-after')==before
    union_off=deactivate.replace(CLUB,child,1).replace(CLUB,union).replace('a3000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000022')
    e.sql(db,service+'SELECT '+union_off+';',label='actual-union-seed-return')
    before=snapshot(e,db,'union-off-before-delayed-activation')
    e.sql(db,service+'SELECT '+union_call+';',label='union-delayed-activation-replays-original')
    assert snapshot(e,db,'union-off-after-delayed-activation')==before
    _,state,_=e.sql(db,"SELECT jsonb_build_array(w.chip_balance,p.seeded_amount,p.is_active) FROM union_wallets w JOIN spin_bonus_pools p ON p.club_id=w.union_id WHERE w.union_id='"+union+"';",label='union-money-conserved')
    assert json.loads(state)==[10000,0,False],state

    empty='a2000000-0000-4000-8000-000000000031'
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO clubs(id,club_id,name,owner_id,chip_treasury) VALUES ('"+empty+"',998184,'Native Initially Empty','"+ACTOR+"',0);COMMIT;",label='synthetic-empty-owner')
    refused=activate.replace(CLUB,empty).replace('a3000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000031')
    _,reply,_=e.sql(db,service+'SELECT '+refused+';',label='real-insufficient-wallet-terminal-refusal')
    assert json.loads(reply.strip().splitlines()[-1])['reason']=='insufficient_funds_or_no_wallet',reply
    e.sql(db,"BEGIN;SET LOCAL session_replication_role=replica;UPDATE clubs SET chip_treasury=1000 WHERE id='"+empty+"';COMMIT;",label='synthetic-new-funded-scenario')
    before=snapshot(e,db,'known-refusal-before-replay')
    _,replay,_=e.sql(db,service+'SELECT '+refused+';',label='known-refusal-is-original-result')
    assert reply==replay
    assert snapshot(e,db,'known-refusal-after-replay')==before
    _,new_reply,_=e.sql(db,service+'SELECT '+refused.replace('a3000000-0000-4000-8000-000000000031','a3000000-0000-4000-8000-000000000032')+';',label='explicit-new-command-after-refusal')
    assert json.loads(new_reply.strip().splitlines()[-1])['ok'] is True,new_reply
