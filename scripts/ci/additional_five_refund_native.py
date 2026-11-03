"""Synthetic charge topology of five additional old events; real financial owners.
No production player rows. Opening capital/roster and physical boundary are local
fixtures. Entry requests, addon wallet debits/journals, overlay funding and original
refund/receipt are real source authorities. This is not live engine acceptance.
"""
import json, hashlib, uuid
from tournament_abort_native import sql_file, prepare_quiesced, SERVICE

def ident(name): return str(uuid.uuid5(uuid.NAMESPACE_URL, 'native-additional-five:'+name))
def qualify(e, db, root):
    club, union = ident('club'), ident('union')
    owner=ident('owner')
    shapes=[(19,12,4.5,.5,5,0,155,9.5),(9,0,9,1,0,0,90,9),(9,0,10.8,1.2,0,0,108,10.8),(14,2,27,3,30,0,480,42),(16,0,22.5,2.5,0,307.5,400,40)]
    store=json.loads((root/'scripts/ci/fixtures/tournament-abort/union-bank-store.json').read_text())[0]
    declared="INSERT INTO public.ca_chip_store_coverage(store,treatment,counted_by,notes) SELECT store,treatment,counted_by,notes FROM jsonb_to_record('"+json.dumps(store).replace("'","''")+"'::jsonb) AS x(store text,treatment text,counted_by text,notes text) ON CONFLICT(store) DO NOTHING;"
    setup='BEGIN;'+SERVICE+declared+'SET LOCAL session_replication_role=replica;'

    # Source ledger writer requires its configured system actor even for a service JWT.
    setup+="INSERT INTO auth.users(id) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d') ON CONFLICT DO NOTHING;INSERT INTO public.users(id,username) VALUES('2d1cd6c3-5700-4af9-a271-d4863fdab20d','native_system_ledger_actor') ON CONFLICT DO NOTHING;"
    setup+=f"INSERT INTO auth.users(id) VALUES('{owner}');INSERT INTO public.users(id,username) VALUES('{owner}','native_additional_owner');INSERT INTO public.profiles(id,username,display_name) VALUES('{owner}','native_additional_owner','Native additional owner');INSERT INTO public.unions(id,name,owner_id,slug) VALUES('{union}','Native additional refund union','{owner}','native-additional-refund');INSERT INTO public.union_wallets(union_id,chip_balance) VALUES('{union}',1000);INSERT INTO public.clubs(id,club_id,name,owner_id,union_id,chip_treasury) VALUES('{club}',991039,'Native additional refund club','{owner}','{union}',0);SET LOCAL session_replication_role=origin;INSERT INTO public.union_clubs(union_id,club_id) VALUES('{union}','{club}');COMMIT;"
    sql_file(e,db,'additional-five-capital',setup)
    for i,(entries,addons,buyin,fee,addon,overlay,gross,totalfee) in enumerate(shapes):
        event,op,table=ident(f'event{i}'),ident(f'op{i}'),ident(f'table{i}')
        users=[ident(f'user{i}:{j}') for j in range(entries)]
        sql='BEGIN;'+SERVICE+'SET LOCAL session_replication_role=replica;'
        for j,user in enumerate(users):
            session=ident(f'session{i}:{j}')
            sql+=f"INSERT INTO auth.users(id) VALUES('{user}');INSERT INTO public.users(id,username) VALUES('{user}','native_additional_{i}_{j}');INSERT INTO public.profiles(id,username,display_name) VALUES('{user}','native_additional_{i}_{j}','Native additional entrant');INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES('{session}','{user}',now(),now());INSERT INTO public.club_members(club_id,user_id,role,status,chip_balance,joined_at) VALUES('{club}','{user}','player','active',1000,now()-interval '2 days');"
        guarantee=round(entries*buyin+overlay,2) if overlay else 0
        sql+=f"INSERT INTO public.tournaments(id,name,buy_in_amount,buy_in_fee,starting_chips,start_time,status,current_players,max_players,min_players,current_level,club_id,union_id,prize_pool,total_rake,bounty_pool,guaranteed_prize,entry_contract_locked,is_rebuy,is_reentry,rebuy_levels,late_reg_levels,late_reg_mins) VALUES('{event}','Native additional topology {i}',{buyin},{fee},1000,now()+interval '1 day','REGISTERING',0,100,2,1,'{club}','{union}',0,0,0,{guarantee},false,false,false,0,0,0);UPDATE public.tournaments SET blind_structure='[{{\"smallBlind\":1,\"bigBlind\":2,\"duration\":300}}]',payout_structure='[{{\"place\":1,\"percentage\":100}}]',payout_percent=20 WHERE id='{event}';SET LOCAL session_replication_role=origin;"
        for j,user in enumerate(users):
            claims=json.dumps({'sub':user,'role':'authenticated','session_id':ident(f'session{i}:{j}')})
            sql+=f"SELECT set_config('request.jwt.claims','{claims}',true),set_config('request.jwt.claim.role','authenticated',true),set_config('request.jwt.claim.sub','{user}',true);SET LOCAL ROLE authenticated;DO $$DECLARE r jsonb;BEGIN r:=public.fn_register_for_tournament_request('{event}','{ident(f'request{i}:{j}')}');IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'native registration refused:%',r;END IF;END$$;RESET ROLE;"
        sql+=SERVICE+f"SELECT set_config('request.jwt.claims','{{\"role\":\"service_role\",\"sub\":\"{owner}\"}}',true),set_config('request.jwt.claim.sub','{owner}',true);"
        # Actual addon money owners. Physical addon eligibility is not under test.
        for user in users[:addons]:
            sql+=f"SELECT set_config('app.ledger_club_id','{club}',true),set_config('app.ledger_category','addon',true),set_config('app.ledger_counterparty','prize_liability',true),set_config('app.ledger_counterparty_entity','{event}',true),set_config('app.ledger_tournament','{event}',true);DO $$BEGIN IF public.atomic_deduct_wallet_and_log('{user}',{addon},'addon','Native addon',NULL,NULL,'{event}') IS DISTINCT FROM true THEN RAISE EXCEPTION 'addon debit failed';END IF;END$$;SELECT public.log_wallet_transaction('{user}','PLAYER',{addon},'debit','addon','Native addon',NULL,NULL,'{event}');"
        sql+="SELECT set_config('app.ledger_club_id','',true),set_config('app.ledger_category','',true),set_config('app.ledger_counterparty','',true),set_config('app.ledger_counterparty_entity','',true),set_config('app.ledger_tournament','',true);"
        if overlay:
            sql+=f"CREATE TEMP TABLE native_additional_overlay ON COMMIT DROP AS SELECT * FROM public.tournaments WHERE id='{event}';CREATE TRIGGER actual_native_overlay BEFORE UPDATE OF status ON native_additional_overlay FOR EACH ROW EXECUTE FUNCTION public.fn_ca_fund_overlay_on_lock();UPDATE native_additional_overlay SET status='RUNNING',started_at=clock_timestamp();"
        sql+=f"SET LOCAL session_replication_role=replica;UPDATE public.tournaments SET status='RUNNING',started_at=clock_timestamp(),prize_pool={round(gross-totalfee+overlay,2)} WHERE id='{event}';SET LOCAL session_replication_role=origin;COMMIT;"
        sql_file(e,db,f'additional-{i}-real-charges',sql)
        money_hash=prepare_quiesced(e,db,event,op,table)
        query=f"SELECT jsonb_build_object('wallets',(SELECT jsonb_object_agg(user_id,chip_balance) FROM public.club_members WHERE club_id='{club}'),'escrow',(SELECT to_jsonb(x) FROM public.tournament_escrow x WHERE tournament_id='{event}'),'ledger',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.chip_ledger x WHERE tournament_id='{event}'),'receipts',(SELECT jsonb_agg(to_jsonb(x)) FROM public.tournament_cancellation_receipts x WHERE tournament_id='{event}'),'bank',(SELECT chip_balance FROM public.union_wallets WHERE union_id='{union}'));"
        def witness(label):
            _,out,_=e.sql(db,query,label=f'additional-{i}-{label}');return json.loads(out.strip())
        before=witness('before');escrow=before['escrow']
        assert float(escrow['gross_in'])==gross and float(escrow['fee_entries_in'])==totalfee and float(escrow['overlay_in'])==overlay
        prefix='BEGIN;'+SERVICE
        call=f"SELECT public.fn_ca_settle_tournament_abort('{op}','{event}','{money_hash}');"
        sql_file(e,db,f'additional-{i}-rollback',prefix+call+'ROLLBACK;')
        assert witness('rolled-back')==before
        _,out,_=sql_file(e,db,f'additional-{i}-commit',prefix+call+'COMMIT;')
        receipt=[json.loads(x) for x in out.splitlines() if x.startswith('{') and 'total_refunded' in x][-1]
        assert receipt['total_refunded']==gross and receipt['fees_reversed']==totalfee and receipt['refund_line_count']==entries+addons
        assert receipt['financial']['unused_overlay_returned']==overlay
        after=witness('after')
        assert all(after['wallets'][user]==1000 for user in users)
        assert float(after['bank'])==1000
        assert all(float(after['escrow'][key])==0 for key in ['prize_balance','fee_balance','bounty_balance'])
        assert after['escrow']['closed_at'] is not None
        sql_file(e,db,f'additional-{i}-replay',prefix+call+'COMMIT;')
        assert witness('replayed')==after
        e.report.setdefault('additional_five_refunds',[]).append({'topology':i,'entries':entries,'addons':addons,'refund':gross,'fees':totalfee,'overlay_returned':overlay,'rollback':True,'replay_unchanged':True})
    e.report['source_sha256'][str(__import__('pathlib').Path(__file__).relative_to(root))]=hashlib.sha256(__import__('pathlib').Path(__file__).read_bytes()).hexdigest()
