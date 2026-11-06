"""Funded Diamond abort cases. Called only by the owned socket-only PG17 runner.
Real signup, charge, prize, overlay, refund, custody, escrow and journals execute.
Only event configuration and the physical park certificate opening are synthetic.
"""
from pathlib import Path
import hashlib,json,time
HERE=Path(__file__).resolve().parent
ARENA='46460000-0000-4000-8000-000000000002'
U1='da000000-0000-4000-8000-000000000001'
U2='da000000-0000-4000-8000-000000000002'
SERVICE="SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true),set_config('request.jwt.claim.role','service_role',true);"

def extension_sql(root):
    economics=root/'supabase/migrations/20261005151918_diamond_economics_records_the_owner_answers.sql'
    earmarks=root/'supabase/migrations/20261005152200_the_house_earmarks_what_it_has_promised.sql'
    # Exact schema/function sections. Historical migration rehearsals and copied
    # production business rows are excluded; fixture inputs below are explicit.
    sql='SET check_function_bodies=off;\n'+'\n'.join(economics.read_text().splitlines()[142:513])+'\n'
    sql+='\n'.join(earmarks.read_text().splitlines()[87:317])+'\n'
    sql+=(HERE/'ledger-schema-current.sql').read_text()+'\n'
    sql+=(HERE/'movements-schema-current.sql').read_text()+'\n'
    sql+='\n'.join(p.read_text().rstrip().rstrip(';')+';' for p in sorted((HERE/'live-defs').glob('*.sql')))
    return sql,[economics,earmarks,HERE/'ledger-schema-current.sql',HERE/'movements-schema-current.sql',*sorted((HERE/'live-defs').glob('*.sql'))]

def install_diamond_extension(e,db,root):
    sql,paths=extension_sql(root)
    p=e.output/'diamond-actual-extension.sql';p.write_text(sql)
    e.sql(db,file=p,label='diamond-actual-installed-financial-extension')
    _,out,_=e.sql(db,"SELECT jsonb_object_agg(p.proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ("+','.join("'"+p.stem+"'" for p in sorted((HERE/'live-defs').glob('*.sql')))+");",label='diamond-captured-current-definition-readback')
    actual=json.loads(out.strip())
    for p in (HERE/'live-defs').glob('*.sql'):
        raw=p.read_text();definition=raw[raw.index('CREATE OR REPLACE FUNCTION'):].rstrip()+'\n'
        if actual.get(p.stem)!=hashlib.md5(definition.encode()).hexdigest():raise AssertionError('current Diamond capture/readback mismatch: '+p.name)
    e.report.setdefault('source_sha256',{}).update({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths})

def seed(e,db):
    sql="""BEGIN;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true),set_config('request.jwt.claim.role','service_role',true);
INSERT INTO public.ca_mint_policy(id,per_operation_cap_chips,rolling_24h_cap_chips,per_operation_cap_diamonds,rolling_24h_cap_diamonds,note) VALUES(1,100000,100000,5000,50000,'Finite synthetic abort fixture') ON CONFLICT(id) DO NOTHING;
INSERT INTO public.ca_financial_epochs(name,description,is_current) VALUES('diamond-abort','Finite synthetic abort fixture',true);
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,email_confirmed_at,created_at,updated_at,is_super_admin) VALUES
('da000000-0000-4000-8000-000000000001','authenticated','authenticated','diamond-abort-one@smarter-poker.invalid','{"provider":"email","providers":["email"]}','{"full_name":"Abort Fixture One","poker_alias":"AbortFxOne"}',now(),now(),now(),false),
('da000000-0000-4000-8000-000000000002','authenticated','authenticated','diamond-abort-two@smarter-poker.invalid','{"provider":"email","providers":["email"]}','{"full_name":"Abort Fixture Two","poker_alias":"AbortFxTwo"}',now(),now(),now(),false);
DO $$ BEGIN IF (SELECT count(*) FROM public.profiles WHERE id IN('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002') AND diamonds=500)<>2 THEN RAISE EXCEPTION 'real signup did not fund both native users'; END IF;END $$;
SET LOCAL session_replication_role=replica;
UPDATE public.clubs SET owner_id='da000000-0000-4000-8000-000000000001' WHERE id='46460000-0000-4000-8000-000000000002';
SET LOCAL session_replication_role=origin;
INSERT INTO public.ca_arena_settings(id,club_id,tournaments_enabled,cash_games_enabled,settlement_window_days,note) VALUES(1,'46460000-0000-4000-8000-000000000002',true,false,14,'Explicitly local funded abort proof');
DO $$ DECLARE r jsonb;BEGIN r:=public.fn_ca_mint('diamonds','house',NULL,1000,'Synthetic local abort house funding','native-abort-house','house');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native house mint failed:%',r;END IF;END $$;
INSERT INTO public.ca_diamond_economics(name,value,units,approved_quote,basis,approved_on,recorded_by) VALUES ('guarantee_max_per_event',1000,'diamonds_per_event','Local fixture only','Finite synthetic scenario',current_date,'native-fixture'),('guarantee_max_outstanding',1000,'diamonds','Local fixture only','Finite synthetic scenario',current_date,'native-fixture');
COMMIT;"""
    p=e.output/'diamond-synthetic-seed.sql';p.write_text(sql);e.sql(db,file=p,label='diamond-real-signup-and-house-mint')

def event_sql(tid,label,free=False):
    return "BEGIN;SET LOCAL session_replication_role=replica;INSERT INTO public.tournaments(id,name,buy_in_amount,buy_in_fee,starting_chips,start_time,status,current_players,max_players,current_level,club_id,prize_pool,total_rake,bounty_pool,entry_contract_locked,is_rebuy,is_reentry,rebuy_levels,late_reg_levels,late_reg_mins) VALUES('"+tid+"','"+label+"',"+('0,0' if free else '18,2')+",1000,now()+interval '1 day','REGISTERING',0,100,1,'"+ARENA+"',0,0,0,false,true,false,5,5,60);SET LOCAL session_replication_role=origin;"+SERVICE

def charge(uid,tid,kind,gross,prize,fee,key):
    return "SELECT public.fn_poker_diamond_tournament_charge('"+uid+"','"+tid+"','"+kind+"',"+str(gross)+','+str(prize)+',0,'+str(fee)+",gen_random_uuid(),'"+key+"');"

def authenticated_payout_guard(e,db,root):
    """Real payer/wallet/profile boundary, not a full authenticated rebuy proof.

    The fixture owner calls the actual private payer with the player's JWT,
    exactly the context its SECURITY DEFINER callers preserve. No named fake
    caller or EXECUTE grant is added. The separate browser call stays denied.
    """
    capture=HERE/'authenticated-payout-guards.json'
    migration=root/'supabase/migrations/20261022145452_a_diamond_bounty_paid_during_a_rebuy_reaches_the_winner_s_wa.sql'
    rows=json.loads(capture.read_text())['functions']
    for row in rows:
        if hashlib.md5(row['definition'].encode()).hexdigest()!=row['definition_md5']:
            raise AssertionError('authenticated payout guard capture changed')
    e.report.setdefault('source_sha256',{}).update({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [capture,migration,Path(__file__)]})
    def run(label,sql,check=True):
        return e.sql(db,sql,label='diamond-authenticated-payout-'+label,check=check)
    run('current-guards','\n'.join(r['definition']+';' for r in rows))
    run('actual-trigger',"""DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.profiles'::regclass
 AND tgfoid='public.fn_guard_profile_privileged_columns()'::regprocedure AND tgenabled='O')
 THEN RAISE EXCEPTION 'real profile guard trigger absent';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.fn_poker_diamond_tournament_pay(uuid,numeric,text,text,uuid,text)'::regprocedure
 AND prosecdef AND proowner='postgres'::regrole)
 THEN RAISE EXCEPTION 'real private payer ownership differs';END IF;END$$;""")
    tid='da300000-0000-4000-8000-000000000007'
    scene=event_sql(tid,'authenticated-bounty-wallet-boundary')
    for n,uid in enumerate([U1,U2]):
        scene+="SELECT public.fn_poker_diamond_tournament_charge('"+uid+"','"+tid+"','entry',20,13,5,2,gen_random_uuid(),'authenticated-bounty-entry-"+str(n)+"');"
    run('funded-scene',scene+'COMMIT;')
    claims="BEGIN;SELECT set_config('request.jwt.claims','{\"role\":\"authenticated\",\"sub\":\""+U1+"\"}',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','"+U1+"',true);DO $$BEGIN IF public.fn_is_service_context() IS DISTINCT FROM false THEN RAISE EXCEPTION 'authenticated JWT bypassed the guard';END IF;END$$;"
    pay="SELECT public.fn_poker_diamond_tournament_pay('"+U2+"',5,'authenticated-bounty-wallet','bounty','"+tid+"','Synthetic authenticated bounty');"
    def money():
        _,out,_=run('money',"SELECT jsonb_build_object("+
          "'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p),"+
          "'custody',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM poker_diamond_custody c),"+
          "'ledger',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM poker_diamond_tournament_ledger l),"+
          "'journal',(SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM diamond_transactions j),"+
          "'keys',(SELECT jsonb_agg(to_jsonb(k) ORDER BY key) FROM wallet_credit_idempotency k),"+
          "'escrow',(SELECT jsonb_agg(to_jsonb(x) ORDER BY tournament_id) FROM tournament_escrow x));")
        return json.loads(out.strip())
    before=money()
    guard=next(r for r in rows if r['proname']=='fn_guard_profile_privileged_columns')
    admission="     -- A Diamond bounty paid to the winner (also from a rebuy that settles the bust first).\n     OR v_stack ~ 'function (public[.])?fn_poker_diamond_tournament_pay[(]'\n"
    if guard['definition'].count(admission)!=1:raise AssertionError('exact payout admission seam changed')
    # Counterfactual current guard without the single Oct22 admission, not a
    # claim that every unrelated byte equals the historical production image.
    run('red-guard',guard['definition'].replace(admission,'')+';')
    code,_,err=run('red','\\set VERBOSITY verbose\n'+claims+pay+'COMMIT;',False)
    if code==0 or '42501' not in err or 'profiles.diamonds is server-managed and cannot be modified by role postgres' not in err:
        raise AssertionError('actual payout did not reproduce profile guard refusal: '+err)
    if money()!=before:raise AssertionError('refused payout leaked wallet, custody, journal, escrow or key')
    run('exact-source-fix',migration.read_text())
    _,post,_=run('guard-postimage',"SELECT md5(pg_get_functiondef('public.fn_guard_profile_privileged_columns()'::regprocedure));")
    if post.strip()!=guard['definition_md5']:raise AssertionError('exact migration did not restore current guard')
    run('green-rollback',claims+pay+'ROLLBACK;')
    if money()!=before:raise AssertionError('successful payout rollback changed money')
    run('green',claims+pay+'COMMIT;')
    after=money()
    old_wallet={p['id']:p['diamonds'] for p in before['profiles']}
    new_wallet={p['id']:p['diamonds'] for p in after['profiles']}
    if new_wallet!={uid:value+(5 if uid==U2 else 0) for uid,value in old_wallet.items()}:
        raise AssertionError('bounty did not credit exactly the winner by five')
    run('independent-banks',"""DO $$BEGIN
 IF (SELECT bounty_balance=5 AND prize_balance=26 AND fee_balance=4 FROM public.fn_poker_diamond_tournament_escrow('"""+tid+"""')) IS DISTINCT FROM true
 OR public.fn_poker_diamond_tournament_custody('"""+tid+"""')<>35
 OR (SELECT count(*) FROM public.poker_diamond_tournament_ledger WHERE idempotency_key='poker-tournament-pay:authenticated-bounty-wallet' AND kind='bounty' AND amount=5 AND bounty_part=5 AND prize_part=0 AND fee_part=0 AND wallet_journal_id IS NOT NULL)<>1
 THEN RAISE EXCEPTION 'independent bounty bank/custody/journal oracle failed';END IF;END$$;""")
    run('replay',claims+pay+'COMMIT;')
    if money()!=after:raise AssertionError('payout replay changed money')
    # Do not grant browser access to reach a private helper. Test actual ACLs.
    code,_,err=run('browser-private-payer',claims+'SET LOCAL ROLE authenticated;'+pay+'COMMIT;',False)
    if code==0 or 'permission denied for function fn_poker_diamond_tournament_pay' not in err:
        raise AssertionError('browser private payer access was not refused: '+err)
    code,_,err=run('unnamed-privileged-write',claims+"UPDATE public.profiles SET diamonds=diamonds+1 WHERE id='"+U2+"';COMMIT;",False)
    if code==0 or 'profiles.diamonds is server-managed' not in err:
        raise AssertionError('authenticated JWT admitted unnamed privileged write: '+err)
    code,_,err=run('browser-privileged-write',claims+"SET LOCAL ROLE authenticated;UPDATE public.profiles SET diamonds=diamonds+1 WHERE id='"+U1+"';COMMIT;",False)
    # This retained financial catalog refuses at its table ACL before the
    # trigger. The owner-plus-authenticated-JWT case above exercises the guard.
    if code==0 or 'permission denied for table profiles' not in err:
        raise AssertionError('browser privileged profile write was not refused at the table ACL: '+err)
    if money()!=after:raise AssertionError('authorization refusal changed money')
    e.report['authenticated_diamond_payout_guard']={'scope':'actual private payer -> wallet -> profile under authenticated JWT; not complete rebuy API',
      'red_refused_and_rolled_back':True,'exact_migration_postimage':guard['definition_md5'],
      'green_rollback':True,'winner_credit':5,'remaining_bounty':5,'replay_unchanged':True,
      'browser_private_payer_denied':True,'unnamed_privileged_write_denied':True,'browser_privileged_write_denied':True}

def run_diamond_cases(e,db,root):
    from tournament_abort_native import prepare_quiesced
    cases=[]
    def run(label,sql):
        p=e.output/(label+'.sql');p.write_text(sql);return e.sql(db,file=p,label=label)
    def scalar(sql,label):
        _,out,_=e.sql(db,sql,label=label);return out.strip()
    def money():
        return json.loads(scalar("SELECT jsonb_build_object('wallets',(SELECT jsonb_agg(jsonb_build_array(id,diamonds) ORDER BY id) FROM profiles),'house',(SELECT balance FROM ca_diamond_house WHERE id=1),'custody',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY id),'[]') FROM poker_diamond_custody c),'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]') FROM poker_diamond_tournament_ledger l),'journals',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY id),'[]') FROM diamond_transactions d),'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY id),'[]') FROM tournament_obligations o),'receipts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY tournament_id),'[]') FROM smarter_private.diamond_tournament_abort_receipts r));",'diamond-money-snapshot'))
    for n,label,free,extra,paid,overlay in [
        (1,'paid-entry',False,False,0,0),
        (2,'free-zero',True,False,0,0),
        (3,'rebuy-addon',True,True,0,0),
        (4,'paid-award-and-unused-overlay',False,False,5,10),
        (5,'unpaid-award-refusal',False,False,0,0),
        (6,'321-original-charges',True,False,0,0),
    ]:
        tail=f'{n:012d}';tid='da300000-0000-4000-8000-'+tail;op='da400000-0000-4000-8000-'+tail;table='da500000-0000-4000-8000-'+tail
        sql=event_sql(tid,label,free)
        if free:
            for uid in [U1,U2]:sql+="SELECT public.fn_poker_diamond_tournament_free_entry('"+uid+"','"+tid+"',gen_random_uuid());"
        else:
            for i,uid in enumerate([U1,U2]):sql+=charge(uid,tid,'entry',20,18,2,label+str(i))
        if extra:
            # Each live purchase is a separate request/transaction. The custody
            # constraint observes that request's NEW row and immutable receipt.
            sql+='COMMIT;BEGIN;'+SERVICE+charge(U1,tid,'rebuy',10,10,0,label+'rebuy')+'COMMIT;BEGIN;'+SERVICE+charge(U1,tid,'addon',30,30,0,label+'addon')
        if n==6:
            sql+="COMMIT;BEGIN;"+SERVICE+"UPDATE public.ca_mint_policy SET per_operation_cap_diamonds=50000 WHERE id=1;SELECT public.fn_ca_mint('diamonds','player','"+U1+"',32100,'Finite native 321 original charge shape','native-abort-321','admin');"
            for i in range(321):sql+='COMMIT;BEGIN;'+SERVICE+charge(U1,tid,'addon',100,100,0,label+str(i))
        if overlay:
            sql+='COMMIT;BEGIN;'+SERVICE+"INSERT INTO public.ca_diamond_house_earmarks(entry,earmark_key,purpose,amount,tournament_id,reason) VALUES('open','guarantee:"+tid+"','guarantee',"+str(overlay)+",'"+tid+"','Synthetic native guarantee');SELECT public.fn_poker_diamond_tournament_settle_overlay('"+tid+"','lock',"+str(36+overlay)+");"
        if paid:
            sql+='COMMIT;BEGIN;'+SERVICE+"SELECT public.fn_poker_diamond_tournament_pay('"+U2+"',"+str(paid)+",'native-prior-prize','prize','"+tid+"','Native paid prize preserved');INSERT INTO public.tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid,source,settled_at) VALUES('"+tid+"','place',1,'"+U2+"',"+str(paid)+','+str(paid)+",'native-real-paid-prize',now());"
        run('diamond-'+label+'-funding',sql+'COMMIT;')
        money_hash=prepare_quiesced(e,db,tid,op,table)
        call="SELECT public.fn_ca_settle_tournament_abort('"+op+"','"+tid+"','"+money_hash+"');"
        prefix="BEGIN;SET LOCAL statement_timeout='8s';"+SERVICE+"SELECT smarter_private.cancellation_lane('"+tid+"');"
        before=money()
        if n==5:
            # Local synthetic owed award added after the park opening; the real
            # authority/helper must refuse before any new credit is committed.
            run('diamond-unpaid-award-local-scene',"INSERT INTO public.tournament_obligations(tournament_id,kind,place,user_id,amount_owed,amount_paid,source) VALUES('"+tid+"','place',1,'"+U2+"',5,0,'native-unpaid-award');")
            before=money()
            p=e.output/'diamond-unpaid-award-refusal.sql';p.write_text(prefix+call+'COMMIT;')
            code,_,err=e.sql(db,file=p,label='diamond-unpaid-award-refusal',check=False)
            if code==0 or not any(x in err for x in ['operator_abort_current_owner_or_boundary_changed','diamond_abort_unpaid_award','operator_abort_money_review_changed']):raise AssertionError('unpaid award was not refused by actual authority: '+err)
            if money()!=before:raise AssertionError('unpaid refusal moved money')
            cases.append(label);continue
        run('diamond-'+label+'-full-rollback',prefix+call+'ROLLBACK;')
        if money()!=before:raise AssertionError(label+' rollback moved money')
        # First delivery is committed only in this disposable native database.
        started=time.monotonic();_,out,_=run('diamond-'+label+'-commit',prefix+call+'COMMIT;')
        if n==6:e.report['diamond_321_charge_commit_seconds']=time.monotonic()-started
        receipts=[json.loads(x) for x in out.splitlines() if x.startswith('{') and 'total_refunded' in x]
        if len(receipts)!=1:raise AssertionError('one helper receipt required')
        raw_receipt=receipts[0];r=raw_receipt['financial'];expected=32100 if n==6 else 0 if free and not extra else 40
        if r['total_refunded']!=expected or r['remaining_custody']!=0 or r['house_absorbed_prior_prizes']!=paid or r['unused_overlay_returned']!=overlay:raise AssertionError(label+' receipt mismatch '+json.dumps(r))
        if r['refund_fee']!=(0 if free else 4) or r['refund_prize']!=(expected if free else 36):raise AssertionError('original bank parts changed')
        after=money()
        for uid in [U1,U2]:
            old=dict(before['wallets'])[uid];new=dict(after['wallets'])[uid]
            refund=(32100 if uid==U1 and n==6 else 40 if uid==U1 and extra else 0) if free else 20
            if new-old!=refund:raise AssertionError(label+' player refund incorrect')
        if after['house']-before['house']!=overlay-paid:raise AssertionError('house overlay/absorbed prize mismatch')
        _,out,_=run('diamond-'+label+'-replay',prefix+call+'COMMIT;')
        rr=[json.loads(x) for x in out.splitlines() if x.startswith('{') and 'total_refunded' in x]
        if rr!=[raw_receipt] or money()!=after:raise AssertionError('duplicate refund moved money or changed receipt')
        cases.extend([label+'-rollback',label+'-commit',label+'-replay'])
    run('diamond-receipt-immutable',"DO $$ DECLARE refused boolean:=false;BEGIN BEGIN UPDATE smarter_private.diamond_tournament_abort_receipts SET receipt=receipt WHERE tournament_id='da300000-0000-4000-8000-000000000001';EXCEPTION WHEN SQLSTATE '55000' THEN refused:=true;END;IF NOT refused THEN RAISE EXCEPTION 'receipt mutable';END IF;END $$;")
    run('diamond-helper-owner-only',"DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='smarter_private.diamond_tournament_abort_refunds(uuid,uuid)'::regprocedure AND a.grantee<>'postgres'::regrole) THEN RAISE EXCEPTION 'private helper exposed';END IF;END $$;")
    authenticated_payout_guard(e,db,root)
    run('diamond-local-switches-closed',"UPDATE public.ca_arena_settings SET tournaments_enabled=false,cash_games_enabled=false WHERE id=1;")
    e.report['diamond_abort_cases']=cases+['immutable-receipt','owner-only-helper','local-switches-closed']
    return e.report['diamond_abort_cases']
